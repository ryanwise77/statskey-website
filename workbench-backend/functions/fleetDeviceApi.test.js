const test = require("node:test");
const assert = require("node:assert/strict");
const {generateKeyPairSync, sign} = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const fleet = require("./fleet");
const fleetAuth = require("./fleetAuth");
const fleetDeviceApi = require("./fleetDeviceApi");
const helperProtocol = require("./fleetHelperProtocol");
const {FakeDb} = require("./testHelpers");
const {
  FleetNodeSupervisor,
} = require("../../desktop/fleet-node-supervisor.cjs");
const {
  createFleetDeviceTransport,
} = require("../../desktop/fleet-node-client.cjs");
const {
  CommandFleetAdapter,
  createProcessRunner,
} = require("../../desktop/fleet-worker-adapters.cjs");

const NOW = Date.parse("2026-08-19T06:30:00.000Z");
const OWNER = "owner-device-api";
const COMMIT = "a".repeat(40);
const GRANT_ID = `grant_${"b".repeat(32)}`;

function fixture() {
  const db = new FakeDb();
  let at = NOW;
  let randomByte = 7;
  const coordinator = generateKeyPairSync("ed25519");
  const coordinatorPublicKeySpki = fleetAuth.exportPublicKeySpki(
      coordinator.publicKey,
  );
  const coordinatorKeyId = "workbench-2026-01";
  const context = {
    db,
    now: () => new Date(at),
    randomBytes: (size) => {
      const value = Buffer.alloc(size, randomByte);
      randomByte += 1;
      return value;
    },
    signDeviceResponse(response) {
      return fleetAuth.createSignedDeviceResponse({
        privateKey: coordinator.privateKey,
        keyId: coordinatorKeyId,
        deviceId: response.deviceId,
        requestId: response.requestId,
        action: response.action,
        result: response.result,
        issuedAt: at,
        expiresAt: at + 60_000,
      });
    },
    signFleetPayload(unsigned) {
      return sign(
          null,
          Buffer.from(fleetAuth.canonicalJson(unsigned)),
          coordinator.privateKey,
      ).toString("base64url");
    },
  };
  return {
    db,
    context,
    coordinatorKeyId,
    coordinatorPublicKeySpki,
    setTime(value) {
      at = value;
    },
  };
}

function bootstrapRequest() {
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const publicKeySpki = fleetAuth.exportPublicKeySpki(publicKey);
  const {deviceId} = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const device = {
    label: "Owner laptop",
    role: "hybrid",
    workerMode: "opt-in",
    platform: "darwin",
    publicKeySpki,
    maxConcurrentJobs: 2,
  };
  const authorization = {
    ownerUid: OWNER,
    audience: "statskey-workbench:fleet:v1",
  };
  return {
    deviceId,
    privateKey,
    payload: {
      device,
      authorization,
      proof: fleetAuth.createSignedDeviceRequest({
        privateKey,
        deviceId,
        action: "pairing.bootstrap",
        payload: {device, authorization},
        issuedAt: NOW,
        expiresAt: NOW + 60_000,
        requestId: `req_${"1".repeat(32)}`,
      }),
    },
  };
}

function workerRequest() {
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const publicKeySpki = fleetAuth.exportPublicKeySpki(publicKey);
  const identity = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  return {
    ...identity,
    privateKey,
    enrollment: {
      id: identity.deviceId,
      label: "Mac mini",
      role: "worker",
      workerMode: "dedicated",
      platform: "darwin",
      publicKeyFingerprint: identity.publicKeyFingerprint,
      publicKeySpki,
      maxConcurrentJobs: 2,
    },
  };
}

function signedBody({
  privateKey,
  deviceId,
  action,
  payload,
  request,
  issuedAt = NOW,
}) {
  return {
    action,
    payload,
    envelope: fleetAuth.createSignedDeviceRequest({
      privateKey,
      deviceId,
      action,
      payload,
      issuedAt,
      expiresAt: issuedAt + 60_000,
      requestId: `req_${request.repeat(32)}`,
    }),
  };
}

function heartbeat() {
  return {
    capabilities: [
      "workspace.read",
      "workspace.snapshot",
      "workspace.write",
      "terminal.run",
      "agent.statskey",
      "xcode.build",
      "xcode.test",
    ],
    executables: ["node"],
    resources: {
      cpuLogical: 12,
      cpuAvailable: 10,
      memoryBytes: 32 * 1024 ** 3,
      memoryAvailableBytes: 24 * 1024 ** 3,
      diskAvailableBytes: 500 * 1024 ** 3,
      gpuCount: 1,
    },
    activeJobs: 0,
    connection: "direct",
    protocolMinimum: 1,
    protocolMaximum: 1,
    softwareVersion: "0.1.0",
  };
}

function authorizeJob(controller, job, ownerUid = OWNER) {
  return {
    ...job,
    controllerAuthorization: {
      controllerDeviceId: controller.deviceId,
      proof: fleetAuth.createSignedDeviceRequest({
        privateKey: controller.privateKey,
        deviceId: controller.deviceId,
        action: "job.authorize",
        payload: {ownerUid, job},
        issuedAt: NOW,
        expiresAt: NOW + 5 * 60_000,
      }),
    },
  };
}

test("signed device actions consume replay ids before updating telemetry", async () => {
  const f = fixture();
  const bootstrap = bootstrapRequest();
  await fleet.bootstrapDevice(OWNER, bootstrap.payload, f.context);
  const body = signedBody({
    privateKey: bootstrap.privateKey,
    deviceId: bootstrap.deviceId,
    action: "heartbeat",
    payload: heartbeat(),
    request: "2",
  });
  const response = await fleetDeviceApi.handleDeviceRequest(body, f.context);
  assert.equal(response.action, "heartbeat");
  assert.equal(response.deviceId, bootstrap.deviceId);
  assert.equal(response.requestId, body.envelope.requestId);
  assert.equal(response.result.connection, "direct");
  assert.equal(response.result.capabilities.includes("xcode.test"), true);
  assert.equal(
      fleetAuth.verifySignedDeviceResponse({
        publicKeySpki: f.coordinatorPublicKeySpki,
        envelope: response.responseSignature,
        deviceId: bootstrap.deviceId,
        requestId: body.envelope.requestId,
        action: "heartbeat",
        result: response.result,
        keyId: f.coordinatorKeyId,
        now: NOW,
      }).requestId,
      body.envelope.requestId,
  );
  await assert.rejects(
      () => fleetDeviceApi.handleDeviceRequest(body, f.context),
      {code: "replayed_request", status: 409},
  );
  const replayRows = [...f.db.docs.entries()]
      .filter(([path]) => path.startsWith("fleetDeviceRequests/"))
      .map(([, row]) => row);
  assert.equal(replayRows.length, 1);
  assert.equal(JSON.stringify(replayRows[0]).includes("signature"), false);
  assert.equal(JSON.stringify(replayRows[0]).includes("private"), false);
});

test("an enrolled device can prove its authoritative owner before local activation", async () => {
  const f = fixture();
  const bootstrap = bootstrapRequest();
  await fleet.bootstrapDevice(OWNER, bootstrap.payload, f.context);
  const response = await fleetDeviceApi.handleDeviceRequest(
      signedBody({
        privateKey: bootstrap.privateKey,
        deviceId: bootstrap.deviceId,
        action: "device.status",
        payload: {},
        request: "e",
      }),
      f.context,
  );
  assert.deepEqual(response.result, {
    ownerUid: OWNER,
    deviceId: bootstrap.deviceId,
    publicKeyFingerprint: fleetAuth
        .deviceIdentityForPublicKey(bootstrap.payload.device.publicKeySpki)
        .publicKeyFingerprint,
    status: "active",
  });
});

test("rate-limited device requests do not consume replay storage", async () => {
  const f = fixture();
  const bootstrap = bootstrapRequest();
  await fleet.bootstrapDevice(OWNER, bootstrap.payload, f.context);
  const body = signedBody({
    privateKey: bootstrap.privateKey,
    deviceId: bootstrap.deviceId,
    action: "device.status",
    payload: {},
    request: "f",
  });
  f.context.enforceRateLimit = async () => {
    const error = new Error("rate limited");
    error.code = "resource_exhausted";
    throw error;
  };
  await assert.rejects(
      () => fleetDeviceApi.handleDeviceRequest(body, f.context),
      {code: "resource_exhausted"},
  );
  assert.equal(
      [...f.db.docs.keys()].some((path) => path.startsWith("fleetDeviceRequests/")),
      false,
  );
  delete f.context.enforceRateLimit;
  await assert.doesNotReject(
      () => fleetDeviceApi.handleDeviceRequest(body, f.context),
  );
});

test("an authenticated worker can complete one lease-bound job", async () => {
  const f = fixture();
  f.context.artifactStore = {
    createUploadGrant: async () => {
      throw new Error("Artifact upload was not expected in this transport test.");
    },
    inspectObject: async () => null,
    preflight: async () => ({ready: true}),
  };
  const bootstrap = bootstrapRequest();
  const worker = workerRequest();
  await fleet.bootstrapDevice(OWNER, bootstrap.payload, f.context);
  await fleet.enrollDevice(OWNER, worker.enrollment, f.context);
  await fleetDeviceApi.handleDeviceRequest(
      signedBody({
        privateKey: worker.privateKey,
        deviceId: worker.deviceId,
        action: "heartbeat",
        payload: heartbeat(),
        request: "3",
      }),
      f.context,
  );
  await fleet.createGrant(OWNER, {
    id: GRANT_ID,
    controllerDeviceId: bootstrap.deviceId,
    workerDeviceId: worker.deviceId,
    workspaceIds: ["statskey-website"],
    repositoryIdentities: ["github.com/statskey/website"],
    capabilities: ["workspace.read", "workspace.snapshot", "xcode.test"],
    unattended: true,
    policyVersion: 1,
    expiresAt: NOW + 24 * 60 * 60 * 1000,
  }, f.context);
  const job = await fleet.createJob(OWNER, authorizeJob(bootstrap, {
    workspaceId: "statskey-website",
    type: "xcode-test",
    objective: "Run the signed node transport test.",
    workspaceSnapshot: {
      kind: "git",
      repository: "statskey/website",
      commit: COMMIT,
    },
    execution: {
      kind: "xcode",
      containerKind: "project",
      containerPath: "StatsKey.xcodeproj",
      scheme: "StatsKey",
    },
    requiredCapabilities: [
      "workspace.read",
      "workspace.snapshot",
      "xcode.test",
    ],
    target: {
      deviceIds: [worker.deviceId],
    },
    deadlineAt: NOW + 60 * 60 * 1000,
    maxAttempts: 1,
    approvalPolicy: "independent",
    idempotencyKey: "device-api:e2e:001",
  }), f.context);
  const poll = await fleetDeviceApi.handleDeviceRequest(
      signedBody({
        privateKey: worker.privateKey,
        deviceId: worker.deviceId,
        action: "job.poll",
        payload: {limit: 20},
        request: "4",
      }),
      f.context,
  );
  assert.deepEqual(poll.result.assignment, {
    protocolVersion: 1,
    jobId: job.id,
    jobRevision: 1,
    grantId: GRANT_ID,
  });
  const claimPayload = {
    jobId: poll.result.assignment.jobId,
    grantId: poll.result.assignment.grantId,
    leaseId: `lease_${"c".repeat(32)}`,
    leaseNonce: "d".repeat(43),
  };
  const claim = await fleetDeviceApi.handleDeviceRequest(
      signedBody({
        privateKey: worker.privateKey,
        deviceId: worker.deviceId,
        action: "job.claim",
        payload: claimPayload,
        request: "5",
      }),
      f.context,
  );
  const {lease} = claim.result;
  assert.equal(claim.result.job.state, "leased");
  const repeatedClaim = await fleetDeviceApi.handleDeviceRequest(
      signedBody({
        privateKey: worker.privateKey,
        deviceId: worker.deviceId,
        action: "job.claim",
        payload: claimPayload,
        request: "a",
      }),
      f.context,
  );
  assert.equal(repeatedClaim.result.lease.id, lease.id);
  assert.equal(repeatedClaim.result.lease.nonce, lease.nonce);

  const eventPayload = {
    jobId: job.id,
    leaseId: lease.id,
    nonce: lease.nonce,
    event: {
      sequence: 1,
      type: "test",
      payload: {suite: "FleetDeviceApi", passed: 1, failed: 0},
    },
  };
  const eventResult = await fleetDeviceApi.handleDeviceRequest(
      signedBody({
        privateKey: worker.privateKey,
        deviceId: worker.deviceId,
        action: "job.event",
        payload: eventPayload,
        request: "6",
      }),
      f.context,
  );
  assert.deepEqual(eventResult.result, {
    accepted: true,
    duplicate: false,
    sequence: 1,
  });

  let request = 7;
  let finalTransitionPayload = null;
  for (const [index, state] of ["preparing", "running", "succeeded"].entries()) {
    const transitionPayload = {
      jobId: job.id,
      leaseId: lease.id,
      nonce: lease.nonce,
      state,
      transitionId: `op_${String(index + 1).repeat(32)}`,
    };
    await fleetDeviceApi.handleDeviceRequest(
        signedBody({
          privateKey: worker.privateKey,
          deviceId: worker.deviceId,
          action: "job.transition",
          payload: transitionPayload,
          request: String(request),
        }),
        f.context,
    );
    if (state === "succeeded") finalTransitionPayload = transitionPayload;
    request += 1;
  }
  const repeatedTransition = await fleetDeviceApi.handleDeviceRequest(
      signedBody({
        privateKey: worker.privateKey,
        deviceId: worker.deviceId,
        action: "job.transition",
        payload: finalTransitionPayload,
        request: "b",
      }),
      f.context,
  );
  assert.equal(repeatedTransition.result.state, "succeeded");
  const completed = await fleet.getJob(OWNER, {jobId: job.id}, f.context);
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.eventSequence, 1);
  assert.equal(f.db.docs.get(`fleetDevices/${worker.deviceId}`).activeJobs, 0);
  assert.equal(
      JSON.stringify(f.db.docs.get(`fleetJobs/${job.id}/events/0000000001`))
          .includes(lease.nonce),
      false,
  );
});

test("the desktop supervisor runs a real process through the signed control plane", async (t) => {
  const f = fixture();
  const bootstrap = bootstrapRequest();
  const worker = workerRequest();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "fleet-e2e-"));
  t.after(() => fs.rm(workspace, {recursive: true, force: true}));
  await fs.writeFile(
      path.join(workspace, "verify-worker.cjs"),
      [
        "if (process.env.OPENAI_API_KEY) process.exit(2);",
        "if (process.cwd() !== __dirname) process.exit(3);",
      ].join("\n"),
  );
  await fleet.bootstrapDevice(OWNER, bootstrap.payload, f.context);
  await fleet.enrollDevice(OWNER, worker.enrollment, f.context);
  await fleet.recordDeviceHeartbeat(
      {
        ownerUid: OWNER,
        deviceId: worker.deviceId,
        publicKeyFingerprint: worker.publicKeyFingerprint,
      },
      heartbeat(),
      f.context,
  );
  await fleet.createGrant(OWNER, {
    id: GRANT_ID,
    controllerDeviceId: bootstrap.deviceId,
    workerDeviceId: worker.deviceId,
    workspaceIds: ["statskey-website"],
    repositoryIdentities: ["github.com/statskey/website"],
    capabilities: ["workspace.read", "workspace.snapshot", "terminal.run"],
    unattended: true,
    policyVersion: 1,
    expiresAt: NOW + 24 * 60 * 60 * 1000,
  }, f.context);
  const queued = await fleet.createJob(OWNER, authorizeJob(bootstrap, {
    workspaceId: "statskey-website",
    type: "command",
    objective: "Exercise the real supervisor and process adapter contract.",
    workspaceSnapshot: {
      kind: "git",
      repository: "statskey/website",
      commit: COMMIT,
    },
    requiredCapabilities: [
      "workspace.read",
      "workspace.snapshot",
      "terminal.run",
    ],
    execution: {
      kind: "command",
      executable: "node",
      arguments: ["verify-worker.cjs"],
      workingDirectory: ".",
      timeoutMs: 30_000,
    },
    target: {deviceIds: [worker.deviceId]},
    deadlineAt: NOW + 60 * 60 * 1000,
    maxAttempts: 1,
    approvalPolicy: "independent",
    idempotencyKey: "device-api:supervisor-e2e:001",
  }), f.context);

  let randomCounter = 0;
  let httpRequestCount = 0;
  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 160 * 1024) throw new Error("Request too large.");
          chunks.push(chunk);
        }
        httpRequestCount += 1;
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = await fleetDeviceApi.handleDeviceRequest(body, f.context);
        response.writeHead(200, {"Content-Type": "application/json"});
        response.end(JSON.stringify({data: result}));
      } catch (error) {
        response.writeHead(Number(error?.status) || 500, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({
          error: {
            code: error?.code || "internal",
            message: error?.message || "Device request failed.",
          },
        }));
      }
    })();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");
  const postAction = createFleetDeviceTransport({
    endpoint: `http://127.0.0.1:${address.port}/device`,
    allowLoopback: true,
    privateKey: worker.privateKey,
    deviceId: worker.deviceId,
    coordinatorPublicKeySpki: f.coordinatorPublicKeySpki,
    coordinatorKeyId: f.coordinatorKeyId,
    now: NOW,
  });
  const supervisor = new FleetNodeSupervisor({
    deviceId: worker.deviceId,
    postAction,
    adapters: {
      command: new CommandFleetAdapter({
        materializer: {
          async materialize() {
            return {workspace, commit: COMMIT};
          },
        },
        allowedExecutables: ["node"],
        processRunner: createProcessRunner({
          environment: {
            ...process.env,
            OPENAI_API_KEY: "must-not-reach-worker",
          },
        }),
      }),
    },
    collectHeartbeat: async () => heartbeat(),
    softwareVersion: "0.1.0-test",
    now: () => NOW,
    sleep: async () => {},
    randomHexImpl(bytes) {
      randomCounter += 1;
      return randomCounter.toString(16).padStart(bytes * 2, "0");
    },
    randomTokenImpl: () => "e".repeat(43),
  });
  const outcome = await supervisor.runOnce();
  assert.equal(outcome.status, "succeeded");
  assert.ok(httpRequestCount >= 10);
  const completed = await fleet.getJob(OWNER, {jobId: queued.id}, f.context);
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.eventSequence, 6);
  assert.equal(f.db.docs.get(`fleetDevices/${worker.deviceId}`).activeJobs, 0);
  const eventTypes = [...f.db.docs.entries()]
      .filter(([path]) => path.startsWith(`fleetJobs/${queued.id}/events/`))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, event]) => event.type);
  assert.deepEqual(eventTypes, [
    "accepted",
    "preparation",
    "checkpoint",
    "process-start",
    "process-exit",
    "result",
  ]);
  assert.equal(
      JSON.stringify([...f.db.docs.values()]).includes("e".repeat(43)),
      false,
  );
});

const HELPER_KEY_PAIR = generateKeyPairSync("ed25519");
const HELPER_PUBLIC_KEY_SPKI = fleetAuth.exportPublicKeySpki(
    HELPER_KEY_PAIR.publicKey,
);
const OTHER_HELPER_KEY_PAIR = generateKeyPairSync("ed25519");
const LINUX_SERVICE_ID = `svc_${"5".repeat(32)}`;
const LINUX_HELPER_INSTANCE_ID = `hi_${"6".repeat(32)}`;
const HELPER_BUILD_ID = `sha256:${"7".repeat(64)}`;
const RUNNER_BUILD_ID = `sha256:${"8".repeat(64)}`;

function linuxWorkerRequest() {
  const worker = workerRequest();
  worker.enrollment.platform = "linux";
  worker.enrollment.label = "Ubuntu runner";
  return worker;
}

function helperBindPayload(overrides = {}) {
  return {
    helperPublicKey: HELPER_PUBLIC_KEY_SPKI,
    executionServiceId: LINUX_SERVICE_ID,
    helperBuildId: HELPER_BUILD_ID,
    runnerBuildId: RUNNER_BUILD_ID,
    policyEpoch: 1,
    ...overrides,
  };
}

function helperAttestation({
  challengeId,
  challengeNonce,
  deviceId,
  overrides = {},
  platform = {},
  security = {},
}) {
  return {
    domain: "statskey.fleet.helper-attestation.v1",
    challengeId,
    challengeNonce,
    deviceId,
    executionServiceId: LINUX_SERVICE_ID,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    bootIdDigest: `sha256:${"9".repeat(43)}`,
    helperProtocol: 1,
    helperBuildId: HELPER_BUILD_ID,
    runnerBuildId: RUNNER_BUILD_ID,
    policyEpoch: 1,
    platform: {
      id: "ubuntu",
      versionId: "26.04",
      arch: "x86_64",
      kernelRelease: "6.8.0-52-generic",
      cgroupVersion: 2,
      systemdVersion: "255",
      ...platform,
    },
    security: {
      cgroupKill: true,
      delegated: false,
      apparmorEnforcing: true,
      apparmorProfileDigest: `sha256:${"a".repeat(64)}`,
      ...security,
    },
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function signAttestation(unsigned, privateKey = HELPER_KEY_PAIR.privateKey) {
  return {
    ...unsigned,
    signature: sign(
        null,
        Buffer.from(fleetAuth.canonicalJson(unsigned)),
        privateKey,
    ).toString("base64url"),
  };
}

async function prepareLinuxWorker(f) {
  const bootstrap = bootstrapRequest();
  const worker = linuxWorkerRequest();
  await fleet.bootstrapDevice(OWNER, bootstrap.payload, f.context);
  await fleet.enrollDevice(OWNER, worker.enrollment, f.context);
  return {bootstrap, worker};
}

function signedRequest({privateKey, deviceId, action, payload, requestId, issuedAt = NOW}) {
  return {
    action,
    payload,
    envelope: fleetAuth.createSignedDeviceRequest({
      privateKey,
      deviceId,
      action,
      payload,
      issuedAt,
      expiresAt: issuedAt + 60_000,
      requestId,
    }),
  };
}

const PLACEHOLDER_SIGNATURE = "A".repeat(86);

test("helper.bind binds a helper key to an enrolled Linux device exactly once", async () => {
  const f = fixture();
  const {bootstrap, worker} = await prepareLinuxWorker(f);
  let requestCounter = 10;
  const nextRequestId = () =>
    `req_${(requestCounter++).toString(16).padStart(32, "0")}`;
  const bind = (privateKey, deviceId, payload) =>
    fleetDeviceApi.handleDeviceRequest(
        signedRequest({
          privateKey,
          deviceId,
          action: "helper.bind",
          payload,
          requestId: nextRequestId(),
        }),
        f.context,
    );
  const body = signedRequest({
    privateKey: worker.privateKey,
    deviceId: worker.deviceId,
    action: "helper.bind",
    payload: helperBindPayload(),
    requestId: nextRequestId(),
  });
  const response = await fleetDeviceApi.handleDeviceRequest(body, f.context);
  assert.equal(response.result.deviceId, worker.deviceId);
  assert.match(response.result.helperKeyId, /^sha256:[A-Za-z0-9_-]{43}$/);
  assert.equal(response.result.executionServiceId, LINUX_SERVICE_ID);
  assert.equal(response.result.policyEpoch, 1);
  const binding = f.db.docs.get(`fleetHelperBindings/${worker.deviceId}`);
  assert.equal(binding.helperPublicKeySpki, HELPER_PUBLIC_KEY_SPKI);
  assert.equal(binding.ownerUid, OWNER);
  await assert.rejects(
      () => fleetDeviceApi.handleDeviceRequest(body, f.context),
      {code: "replayed_request", status: 409},
  );
  const wrongKey = generateKeyPairSync("ed25519");
  await assert.rejects(
      () => bind(wrongKey.privateKey, worker.deviceId, helperBindPayload()),
      {code: "invalid_signature", status: 401},
  );
  f.db.docs.set(`fleetHelperAttestations/${worker.deviceId}`, {
    deviceId: worker.deviceId,
    expiresAt: new Date(NOW + 60_000),
  });
  const rebind = await bind(
      worker.privateKey,
      worker.deviceId,
      helperBindPayload({policyEpoch: 2}),
  );
  assert.equal(rebind.result.policyEpoch, 2);
  assert.equal(
      f.db.docs.get(`fleetHelperBindings/${worker.deviceId}`).policyEpoch,
      2,
  );
  assert.equal(
      f.db.docs.has(`fleetHelperAttestations/${worker.deviceId}`),
      false,
  );
  await assert.rejects(
      () => bind(bootstrap.privateKey, bootstrap.deviceId, helperBindPayload()),
      {code: "failed_precondition", status: 409},
  );
  await assert.rejects(
      () => bind(
          worker.privateKey,
          worker.deviceId,
          helperBindPayload({executionServiceId: "svc_bad"}),
      ),
      {code: "invalid_argument", status: 400},
  );
});

test("helper.attest verifies challenge, binding, signature, and platform", async () => {
  const f = fixture();
  const {worker} = await prepareLinuxWorker(f);
  let requestCounter = 100;
  const act = (action, payload) =>
    fleetDeviceApi.handleDeviceRequest(
        signedRequest({
          privateKey: worker.privateKey,
          deviceId: worker.deviceId,
          action,
          payload,
          requestId: `req_${(requestCounter++).toString(16).padStart(32, "0")}`,
          issuedAt: f.context.now().getTime(),
        }),
        f.context,
    );
  await act("helper.bind", helperBindPayload());
  const mintChallenge = async () => (await act("helper.challenge", {})).result;
  const attest = (attestation) => act("helper.attest", {attestation});

  const first = await mintChallenge();
  assert.match(first.challengeId, /^chal_[a-f0-9]{32}$/);
  const challengeRow = f.db.docs.get(`fleetHelperChallenges/${first.challengeId}`);
  assert.equal(challengeRow.consumedAt, null);
  assert.equal(challengeRow.expiresAt.getTime(), NOW + 120_000);
  assert.equal(challengeRow.deviceId, worker.deviceId);

  const accepted = await attest(signAttestation(helperAttestation({
    challengeId: first.challengeId,
    challengeNonce: first.nonce,
    deviceId: worker.deviceId,
  })));
  assert.equal(accepted.result.deviceId, worker.deviceId);
  assert.equal(accepted.result.helperInstanceId, LINUX_HELPER_INSTANCE_ID);
  assert.equal(accepted.result.policyEpoch, 1);
  const stored = f.db.docs.get(`fleetHelperAttestations/${worker.deviceId}`);
  assert.equal(stored.executionServiceId, LINUX_SERVICE_ID);
  assert.equal(stored.helperInstanceId, LINUX_HELPER_INSTANCE_ID);
  assert.match(stored.attestationDigest, /^[a-f0-9]{64}$/);
  assert.equal(stored.expiresAt.getTime(), NOW + 5 * 60_000);
  assert.ok(
      f.db.docs.get(`fleetHelperChallenges/${first.challengeId}`).consumedAt,
  );

  await assert.rejects(
      () => attest(signAttestation(helperAttestation({
        challengeId: first.challengeId,
        challengeNonce: first.nonce,
        deviceId: worker.deviceId,
      }))),
      {code: "failed_precondition", status: 409},
  );

  const wrongKey = await mintChallenge();
  await assert.rejects(
      () => attest(signAttestation(
          helperAttestation({
            challengeId: wrongKey.challengeId,
            challengeNonce: wrongKey.nonce,
            deviceId: worker.deviceId,
          }),
          OTHER_HELPER_KEY_PAIR.privateKey,
      )),
      {code: "invalid_attestation_signature", status: 403},
  );

  // Ubuntu 24.04 with systemd >= 255 is an allowed LTS profile.
  const lts24 = await mintChallenge();
  const accepted24 = await attest(signAttestation(helperAttestation({
    challengeId: lts24.challengeId,
    challengeNonce: lts24.nonce,
    deviceId: worker.deviceId,
    platform: {
      versionId: "24.04",
      kernelRelease: "6.8.0-79-generic",
      systemdVersion: "255",
    },
  })));
  assert.equal(accepted24.deviceId, worker.deviceId);

  for (const [label, mutate] of [
    ["ubuntu 23.10", (a) => {
      a.platform.versionId = "23.10";
    }],
    ["systemd 254", (a) => {
      a.platform.versionId = "24.04";
      a.platform.systemdVersion = "254";
    }],
    ["arm64", (a) => {
      a.platform.arch = "arm64";
    }],
    ["cgroup v1", (a) => {
      a.platform.cgroupVersion = 1;
    }],
    ["delegated cgroup", (a) => {
      a.security.delegated = true;
    }],
    ["apparmor unconfined", (a) => {
      a.security.apparmorEnforcing = false;
    }],
    ["cgroup kill disabled", (a) => {
      a.security.cgroupKill = false;
    }],
  ]) {
    const next = await mintChallenge();
    const attestation = helperAttestation({
      challengeId: next.challengeId,
      challengeNonce: next.nonce,
      deviceId: worker.deviceId,
    });
    mutate(attestation);
    await assert.rejects(
        () => attest(signAttestation(attestation)),
        {code: "failed_precondition", status: 409},
        label,
    );
  }

  const stale = await mintChallenge();
  f.setTime(NOW + 120_001);
  await assert.rejects(
      () => attest(signAttestation(helperAttestation({
        challengeId: stale.challengeId,
        challengeNonce: stale.nonce,
        deviceId: worker.deviceId,
      }))),
      {code: "failed_precondition", status: 409},
  );
  f.setTime(NOW);

  const mismatch = await mintChallenge();
  await assert.rejects(
      () => attest(signAttestation(helperAttestation({
        challengeId: mismatch.challengeId,
        challengeNonce: mismatch.nonce,
        deviceId: worker.deviceId,
        overrides: {executionServiceId: `svc_${"e".repeat(32)}`},
      }))),
      {code: "permission_denied", status: 403},
  );

  const oversized = await mintChallenge();
  await assert.rejects(
      () => attest(signAttestation(helperAttestation({
        challengeId: oversized.challengeId,
        challengeNonce: oversized.nonce,
        deviceId: worker.deviceId,
        overrides: {expiresAt: new Date(NOW + 10 * 60_000 + 1).toISOString()},
      }))),
      {code: "invalid_argument", status: 400},
  );

  const staleEpoch = await mintChallenge();
  await assert.rejects(
      () => attest(signAttestation(helperAttestation({
        challengeId: staleEpoch.challengeId,
        challengeNonce: staleEpoch.nonce,
        deviceId: worker.deviceId,
        overrides: {policyEpoch: 0},
      }))),
      {code: "invalid_argument", status: 400},
  );

  const extra = await mintChallenge();
  await assert.rejects(
      () => attest(signAttestation({
        ...helperAttestation({
          challengeId: extra.challengeId,
          challengeNonce: extra.nonce,
          deviceId: worker.deviceId,
        }),
        unexpected: true,
      })),
      {code: "invalid_argument", status: 400},
  );
});

test("helper wire structures reject unknown fields and malformed values", () => {
  const valid = helperAttestation({
    challengeId: `chal_${"1".repeat(32)}`,
    challengeNonce: "n".repeat(43),
    deviceId: `dev_${"2".repeat(32)}`,
  });
  const signed = signAttestation(valid);
  const verified = helperProtocol.verifyHelperAttestation(
      signed,
      HELPER_PUBLIC_KEY_SPKI,
  );
  assert.equal(verified.deviceId, `dev_${"2".repeat(32)}`);
  assert.equal(verified.helperProtocol, 1);
  assert.throws(
      () => helperProtocol.normalizeHelperAttestation({...valid, extra: 1}),
      {code: "invalid_argument"},
  );
  assert.throws(
      () => helperProtocol.normalizeHelperAttestation({
        ...valid,
        issuedAt: "2026-08-19T06:30:00Z",
      }),
      {code: "invalid_argument"},
  );
  assert.throws(
      () => helperProtocol.normalizeHelperAttestation({...valid, platform: {
        ...valid.platform,
        hypervisor: "none",
      }}),
      {code: "invalid_argument"},
  );
  assert.throws(
      () => helperProtocol.verifyHelperAttestation(
          signAttestation(valid, OTHER_HELPER_KEY_PAIR.privateKey),
          HELPER_PUBLIC_KEY_SPKI,
      ),
      {code: "invalid_attestation_signature", status: 403},
  );

  const ticket = {
    domain: "statskey.fleet.execution-ticket.v1",
    ticketId: `ticket_${"3".repeat(32)}`,
    jobRequestDigest: `sha256:${"4".repeat(64)}`,
    jobId: `job_${"5".repeat(32)}`,
    attempt: 1,
    leaseId: `lease_${"6".repeat(32)}`,
    leaseSequence: 0,
    grantReceiptDigest: `sha256:${"7".repeat(64)}`,
    ownerUid: OWNER,
    workerDeviceId: `dev_${"2".repeat(32)}`,
    controllerDeviceId: `dev_${"8".repeat(32)}`,
    executionServiceId: LINUX_SERVICE_ID,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    repositoryIdentity: "github.com/statskey/website",
    commit: "a".repeat(40),
    executorProfileId: "command-v1",
    sandboxProfileId: "ubuntu-build-v1",
    networkProfileId: "none",
    command: {executable: "node", arguments: ["--version"], workingDirectory: "."},
    resources: {
      cpuMilli: 4_000,
      memoryBytes: 8 * 1024 ** 3,
      pids: 256,
      diskBytes: 20 * 1024 ** 3,
      wallTimeMs: 3_600_000,
    },
    serverIssuedAt: "2026-08-19T06:30:00.000Z",
    leaseExpiresAt: "2026-08-19T06:30:45.000Z",
    jobDeadlineAt: "2026-08-19T07:30:00.000Z",
    minimumHelperProtocol: 1,
    minimumPolicyEpoch: 1,
  };
  assert.throws(
      () => helperProtocol.normalizeExecutionTicket({...ticket, signature: PLACEHOLDER_SIGNATURE, extra: 1}),
      {code: "invalid_argument"},
  );
  assert.throws(
      () => helperProtocol.normalizeExecutionTicket({
        ...ticket,
        leaseExpiresAt: "2026-08-19T07:30:00.001Z",
        signature: PLACEHOLDER_SIGNATURE,
      }),
      {code: "invalid_argument"},
  );
  const normalizedTicket = helperProtocol.normalizeExecutionTicket({
    ...ticket,
    signature: PLACEHOLDER_SIGNATURE,
  });
  assert.equal(normalizedTicket.executorProfileId, "command-v1");

  const receipt = {
    domain: "statskey.fleet.termination-receipt.v1",
    ticketId: ticket.ticketId,
    jobId: ticket.jobId,
    attempt: 1,
    leaseId: ticket.leaseId,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    highestLeaseSequence: 0,
    exitStatus: 0,
    terminationReason: "exited",
    unitName: `statskey-fleet-job-${ticket.ticketId}.service`,
    cgroupPath:
      `/sys/fs/cgroup/system.slice/statskey-fleet-job-${ticket.ticketId}.service`,
    populated: false,
    accounting: {
      cpuUsageNs: 1,
      memoryPeakBytes: 2,
      pidsPeak: 3,
      ioReadBytes: 4,
      ioWriteBytes: 5,
    },
    finishedAt: "2026-08-19T06:31:00.000Z",
    finishedAtMonotonicMs: 65_000,
  };
  assert.throws(
      () => helperProtocol.normalizeTerminationReceipt({
        ...receipt,
        populated: true,
        signature: PLACEHOLDER_SIGNATURE,
      }),
      {code: "invalid_argument"},
  );
  assert.throws(
      () => helperProtocol.normalizeTerminationReceipt({
        ...receipt,
        cgroupPath: "/sys/fs/cgroup/../escape",
        signature: PLACEHOLDER_SIGNATURE,
      }),
      {code: "invalid_argument"},
  );

  const started = {
    domain: "statskey.fleet.execution-started-receipt.v1",
    ticketId: ticket.ticketId,
    jobId: ticket.jobId,
    attempt: 1,
    leaseId: ticket.leaseId,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    unitName: `statskey-fleet-job-${ticket.ticketId}.service`,
    cgroupPath:
      `/sys/fs/cgroup/system.slice/statskey-fleet-job-${ticket.ticketId}.service`,
    effectiveLimits: ticket.resources,
    runnerBuildId: RUNNER_BUILD_ID,
    startedAt: "2026-08-19T06:30:05.000Z",
    startedAtMonotonicMs: 60_000,
  };
  const normalizedStart = helperProtocol.normalizeExecutionStartedReceipt({
    ...started,
    signature: PLACEHOLDER_SIGNATURE,
  });
  assert.equal(
      normalizedStart.unitName,
      `statskey-fleet-job-${ticket.ticketId}.service`,
  );
  assert.throws(
      () => helperProtocol.normalizeExecutionStartedReceipt({
        ...started,
        unitName: "bad unit",
        signature: PLACEHOLDER_SIGNATURE,
      }),
      {code: "invalid_argument"},
  );

  const update = {
    domain: "statskey.fleet.lease-update.v1",
    ticketId: ticket.ticketId,
    jobId: ticket.jobId,
    attempt: 1,
    leaseId: ticket.leaseId,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    leaseSequence: 3,
    cancelled: false,
    serverIssuedAt: "2026-08-19T06:30:10.000Z",
    leaseExpiresAt: "2026-08-19T06:31:10.000Z",
  };
  const normalizedUpdate = helperProtocol.normalizeLeaseUpdate({
    ...update,
    signature: PLACEHOLDER_SIGNATURE,
  });
  assert.equal(normalizedUpdate.leaseSequence, 3);
  assert.throws(
      () => helperProtocol.normalizeLeaseUpdate({
        ...update,
        cancelled: "no",
        signature: PLACEHOLDER_SIGNATURE,
      }),
      {code: "invalid_argument"},
  );
});

test("an attested Linux worker claims tickets and renews over the signed transport", async () => {
  const f = fixture();
  const {bootstrap, worker} = await prepareLinuxWorker(f);
  let requestCounter = 200;
  const act = (action, payload) =>
    fleetDeviceApi.handleDeviceRequest(
        signedRequest({
          privateKey: worker.privateKey,
          deviceId: worker.deviceId,
          action,
          payload,
          requestId: `req_${(requestCounter++).toString(16).padStart(32, "0")}`,
        }),
        f.context,
    );
  await act("helper.bind", helperBindPayload());
  const challenge = (await act("helper.challenge", {})).result;
  await act("helper.attest", {
    attestation: signAttestation(helperAttestation({
      challengeId: challenge.challengeId,
      challengeNonce: challenge.nonce,
      deviceId: worker.deviceId,
    })),
  });
  const heartbeatResponse = await act("heartbeat", heartbeat());
  assert.deepEqual(heartbeatResponse.result.capabilities, [
    "terminal.run",
    "workspace.read",
    "workspace.snapshot",
    "workspace.write",
  ]);
  assert.deepEqual(heartbeatResponse.result.executables, []);

  await fleet.createGrant(OWNER, {
    id: GRANT_ID,
    controllerDeviceId: bootstrap.deviceId,
    workerDeviceId: worker.deviceId,
    workspaceIds: ["statskey-website"],
    repositoryIdentities: ["github.com/statskey/website"],
    capabilities: ["workspace.read", "workspace.snapshot", "terminal.run"],
    unattended: true,
    policyVersion: 1,
    expiresAt: NOW + 24 * 60 * 60 * 1000,
  }, f.context);
  const job = await fleet.createJob(OWNER, authorizeJob(bootstrap, {
    workspaceId: "statskey-website",
    type: "command",
    objective: "Run an attested Linux command job through the device transport.",
    workspaceSnapshot: {
      kind: "git",
      repository: "statskey/website",
      commit: COMMIT,
    },
    execution: {
      kind: "command",
      executable: "node",
      arguments: ["--version"],
      workingDirectory: ".",
      timeoutMs: 60_000,
    },
    requiredCapabilities: [
      "workspace.read",
      "workspace.snapshot",
      "terminal.run",
    ],
    target: {deviceIds: [worker.deviceId]},
    deadlineAt: NOW + 60 * 60 * 1000,
    maxAttempts: 2,
    approvalPolicy: "independent",
    idempotencyKey: "device-api:linux-e2e:001",
  }), f.context);

  const poll = await act("job.poll", {limit: 20});
  assert.equal(poll.result.assignment.jobId, job.id);
  const claim = await act("job.claim", {
    jobId: job.id,
    grantId: GRANT_ID,
    leaseId: `lease_${"c".repeat(32)}`,
    leaseNonce: "d".repeat(43),
  });
  const ticket = claim.result.executionTicket;
  assert.ok(ticket);
  helperProtocol.verifyExecutionTicket(ticket, f.coordinatorPublicKeySpki);
  assert.equal(ticket.workerDeviceId, worker.deviceId);
  assert.equal(ticket.controllerDeviceId, bootstrap.deviceId);
  assert.equal(ticket.leaseId, claim.result.lease.id);
  assert.equal(ticket.attempt, 1);
  fleetAuth.verifySignedDeviceResponse({
    publicKeySpki: f.coordinatorPublicKeySpki,
    envelope: claim.responseSignature,
    deviceId: worker.deviceId,
    requestId: claim.requestId,
    action: "job.claim",
    result: claim.result,
    keyId: f.coordinatorKeyId,
    now: NOW,
  });

  f.setTime(NOW + 10_000);
  const renew = await act("lease.renew", {
    leaseId: claim.result.lease.id,
    nonce: claim.result.lease.nonce,
    ttlMs: 60_000,
  });
  const leaseUpdate = renew.result.leaseUpdate;
  assert.ok(leaseUpdate);
  helperProtocol.verifyLeaseUpdate(leaseUpdate, f.coordinatorPublicKeySpki);
  assert.equal(leaseUpdate.leaseSequence, 1);
  assert.equal(leaseUpdate.ticketId, ticket.ticketId);
  assert.equal(leaseUpdate.cancelled, false);
  assert.equal(leaseUpdate.leaseExpiresAt, renew.result.expiresAt);
  fleetAuth.verifySignedDeviceResponse({
    publicKeySpki: f.coordinatorPublicKeySpki,
    envelope: renew.responseSignature,
    deviceId: worker.deviceId,
    requestId: renew.requestId,
    action: "lease.renew",
    result: renew.result,
    keyId: f.coordinatorKeyId,
    now: NOW + 10_000,
  });
});
