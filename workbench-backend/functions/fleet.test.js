const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash, generateKeyPairSync, sign} = require("node:crypto");
const fleet = require("./fleet");
const fleetAuth = require("./fleetAuth");
const protocol = require("./fleetProtocol");
const helperProtocol = require("./fleetHelperProtocol");
const {FakeDb} = require("./testHelpers");
const desktopProtocol = require("../../desktop/fleet-runtime.cjs");

const NOW = Date.parse("2026-08-19T05:00:00.000Z");
const OWNER = "owner-123";
const OTHER_OWNER = "owner-456";
const CONTROLLER_KEY_PAIR = generateKeyPairSync("ed25519");
const CONTROLLER_PUBLIC_KEY_SPKI = fleetAuth.exportPublicKeySpki(
    CONTROLLER_KEY_PAIR.publicKey,
);
const CONTROLLER_IDENTITY = fleetAuth.deviceIdentityForPublicKey(
    CONTROLLER_PUBLIC_KEY_SPKI,
);
const CONTROLLER = CONTROLLER_IDENTITY.deviceId;
const OTHER_CONTROLLER_KEY_PAIR = generateKeyPairSync("ed25519");
const OTHER_CONTROLLER_PUBLIC_KEY_SPKI = fleetAuth.exportPublicKeySpki(
    OTHER_CONTROLLER_KEY_PAIR.publicKey,
);
const OTHER_CONTROLLER_IDENTITY = fleetAuth.deviceIdentityForPublicKey(
    OTHER_CONTROLLER_PUBLIC_KEY_SPKI,
);
const MAC = `dev_${"2".repeat(32)}`;
const WINDOWS = `dev_${"3".repeat(32)}`;
const GRANT = `grant_${"a".repeat(32)}`;
const COMMIT = "b".repeat(40);
const CONTROLLER_KEY = CONTROLLER_IDENTITY.publicKeyFingerprint;
const MAC_KEY = `sha256:${"d".repeat(43)}`;

function fixture() {
  const db = new FakeDb();
  let at = NOW;
  let randomByte = 1;
  const coordinator = generateKeyPairSync("ed25519");
  const context = {
    db,
    allowLegacyFingerprintEnrollment: true,
    now: () => new Date(at),
    randomBytes: (size) => {
      const value = Buffer.alloc(size, randomByte);
      randomByte += 1;
      return value;
    },
    artifactStore: {
      async preflight() {
        return {ready: true};
      },
      async createUploadGrant() {
        throw new Error("Artifact upload was not configured for this test.");
      },
      async inspectObject() {
        throw new Error("Artifact inspection was not configured for this test.");
      },
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
    coordinatorPublicKeySpki: fleetAuth.exportPublicKeySpki(coordinator.publicKey),
    setTime(value) {
      at = value;
    },
  };
}

function jobPayload(overrides = {}, {
  ownerUid = OWNER,
  controllerDeviceId = CONTROLLER,
  controllerPrivateKey = CONTROLLER_KEY_PAIR.privateKey,
} = {}) {
  const {
    controllerAuthorization,
    ...jobOverrides
  } = overrides;
  const job = {
    workspaceId: "statskey-website",
    type: "xcode-test",
    objective: "Run focused Xcode tests and retain structured evidence.",
    workspaceSnapshot: {
      kind: "git",
      repository: "statskey/website",
      commit: COMMIT,
    },
    execution: {
      kind: "xcode",
      containerKind: "project",
      containerPath: "biometrics/StatsKey.xcodeproj",
      scheme: "StatsKey",
      destination: "platform=iOS Simulator,name=iPhone 17 Pro",
      onlyTesting: [],
      timeoutMs: 60_000,
    },
    requiredCapabilities: [
      "workspace.read",
      "workspace.snapshot",
      "xcode.test",
    ],
    resources: {
      cpuLogical: 4,
      memoryBytes: 8 * 1024 ** 3,
      diskAvailableBytes: 20 * 1024 ** 3,
    },
    exclusiveResources: ["xcode:simulator-lane-1"],
    dependencies: [],
    target: {},
    deadlineAt: NOW + 2 * 60 * 60 * 1000,
    maxAttempts: 2,
    approvalPolicy: "independent",
    reconciliationPolicy: "lead",
    idempotencyKey: "fleet-test:job:001",
    ...jobOverrides,
  };
  return {
    ...job,
    controllerAuthorization: controllerAuthorization === undefined ?
      {
        controllerDeviceId,
        proof: fleetAuth.createSignedDeviceRequest({
          privateKey: controllerPrivateKey,
          deviceId: controllerDeviceId,
          action: "job.authorize",
          payload: {ownerUid, job},
          issuedAt: NOW,
          expiresAt: NOW + 5 * 60_000,
        }),
      } :
      controllerAuthorization,
  };
}

async function enrollTestController(f, {
  ownerUid = OWNER,
  identity = CONTROLLER_IDENTITY,
  publicKeySpki = CONTROLLER_PUBLIC_KEY_SPKI,
} = {}) {
  return fleet.enrollDevice(
      ownerUid,
      {
        id: identity.deviceId,
        label: "Test controller",
        role: "controller",
        workerMode: "disabled",
        platform: "darwin",
        publicKeyFingerprint: identity.publicKeyFingerprint,
        publicKeySpki,
        maxConcurrentJobs: 1,
      },
      f.context,
  );
}

function enrollment(id, overrides = {}) {
  return {
    id,
    label: id === CONTROLLER ? "Laptop" : "Mac mini",
    role: id === CONTROLLER ? "controller" : "worker",
    workerMode: id === CONTROLLER ? "disabled" : "dedicated",
    platform: id === CONTROLLER ? "darwin" : "darwin",
    publicKeyFingerprint: id === CONTROLLER ? CONTROLLER_KEY : MAC_KEY,
    ...(id === CONTROLLER ?
      {publicKeySpki: CONTROLLER_PUBLIC_KEY_SPKI} :
      {}),
    maxConcurrentJobs: 2,
    ...overrides,
  };
}

function heartbeat(overrides = {}) {
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
    ...overrides,
  };
}

function grantPayload(overrides = {}) {
  return {
    id: GRANT,
    controllerDeviceId: CONTROLLER,
    workerDeviceId: MAC,
    workspaceIds: ["statskey-website"],
    repositoryIdentities: ["github.com/statskey/website"],
    capabilities: [
      "workspace.read",
      "workspace.snapshot",
      "xcode.test",
    ],
    unattended: true,
    policyVersion: 1,
    expiresAt: NOW + 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function identity(overrides = {}) {
  return {
    ownerUid: OWNER,
    deviceId: MAC,
    publicKeyFingerprint: MAC_KEY,
    ...overrides,
  };
}

function bootstrapPayload(overrides = {}) {
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const publicKeySpki = fleetAuth.exportPublicKeySpki(publicKey);
  const {deviceId} = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const device = {
    label: "Owner laptop",
    role: "hybrid",
    workerMode: "opt-in",
    platform: "darwin",
    publicKeySpki,
    maxConcurrentJobs: 1,
    ...overrides,
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
        requestId: `req_${"f".repeat(32)}`,
      }),
    },
  };
}

function pairingPayload(controller, overrides = {}) {
  const {
    candidate: candidateOverrides = {},
    ...receiptOverrides
  } = overrides;
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const publicKeySpki = fleetAuth.exportPublicKeySpki(publicKey);
  const {deviceId, publicKeyFingerprint} =
    fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const receipt = {
    pairingNonce: "n".repeat(43),
    ownerUid: OWNER,
    controllerDeviceId: controller.deviceId,
    candidate: {
      label: "Mac mini",
      role: "worker",
      workerMode: "dedicated",
      platform: "darwin",
      publicKeySpki,
      maxConcurrentJobs: 2,
      ...candidateOverrides,
    },
    workspaceIds: ["statskey-website"],
    repositoryIdentities: ["github.com/statskey/website"],
    capabilities: ["workspace.read", "workspace.snapshot", "xcode.test"],
    unattended: true,
    grantExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    policyVersion: 1,
    ...receiptOverrides,
  };
  return {
    deviceId,
    publicKeyFingerprint,
    privateKey,
    payload: {
      receipt,
      candidateProof: fleetAuth.createSignedDeviceRequest({
        privateKey,
        deviceId,
        action: "pairing.candidate",
        payload: receipt,
        issuedAt: NOW,
        expiresAt: NOW + 60_000,
        requestId: `req_${"a".repeat(32)}`,
      }),
      controllerProof: fleetAuth.createSignedDeviceRequest({
        privateKey: controller.privateKey,
        deviceId: controller.deviceId,
        action: "pairing.approve",
        payload: receipt,
        issuedAt: NOW,
        expiresAt: NOW + 60_000,
        requestId: `req_${"b".repeat(32)}`,
      }),
    },
  };
}

function recoveryPayload(expectedControllerDeviceId, overrides = {}) {
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const publicKeySpki = fleetAuth.exportPublicKeySpki(publicKey);
  const {deviceId} = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const device = {
    label: "Replacement controller",
    role: "hybrid",
    workerMode: "opt-in",
    platform: "darwin",
    publicKeySpki,
    maxConcurrentJobs: 1,
    ...overrides,
  };
  const authorization = {
    ownerUid: OWNER,
    audience: "statskey-workbench:fleet-recovery:v1",
    expectedControllerDeviceId,
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
        action: "controller.recover",
        payload: {device, authorization},
        issuedAt: NOW,
        expiresAt: NOW + 60_000,
        requestId: `req_${"e".repeat(32)}`,
      }),
    },
  };
}

async function prepareFleet(f) {
  await fleet.enrollDevice(OWNER, enrollment(CONTROLLER), f.context);
  await fleet.enrollDevice(OWNER, enrollment(MAC), f.context);
  await fleet.recordDeviceHeartbeat(identity(), heartbeat(), f.context);
  await fleet.createGrant(OWNER, grantPayload(), f.context);
}

const LINUX_SERVICE_ID = `svc_${"5".repeat(32)}`;
const LINUX_HELPER_INSTANCE_ID = `hi_${"6".repeat(32)}`;
const LINUX_HELPER_KEY_PAIR = generateKeyPairSync("ed25519");
const LINUX_HELPER_PUBLIC_KEY_SPKI = fleetAuth.exportPublicKeySpki(
    LINUX_HELPER_KEY_PAIR.publicKey,
);
const OTHER_HELPER_KEY_PAIR = generateKeyPairSync("ed25519");
const LINUX_HELPER_BUILD_ID = `sha256:${"7".repeat(64)}`;
const LINUX_RUNNER_BUILD_ID = `sha256:${"8".repeat(64)}`;
const LINUX_ATTESTED_CAPABILITIES = [
  "terminal.run",
  "workspace.read",
  "workspace.snapshot",
  "workspace.write",
];

function linuxAttestationDoc(overrides = {}) {
  return {
    schemaVersion: 1,
    ownerUid: OWNER,
    deviceId: MAC,
    executionServiceId: LINUX_SERVICE_ID,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    bootIdDigest: `sha256:${"9".repeat(43)}`,
    helperProtocol: 1,
    helperBuildId: LINUX_HELPER_BUILD_ID,
    runnerBuildId: LINUX_RUNNER_BUILD_ID,
    policyEpoch: 1,
    platform: {
      id: "ubuntu",
      versionId: "26.04",
      arch: "x86_64",
      kernelRelease: "6.8.0-52-generic",
      cgroupVersion: 2,
      systemdVersion: "255",
    },
    security: {
      cgroupKill: true,
      delegated: false,
      apparmorEnforcing: true,
      apparmorProfileDigest: `sha256:${"a".repeat(64)}`,
    },
    helperKeyId: `sha256:${"b".repeat(43)}`,
    attestationDigest: "c".repeat(64),
    issuedAt: new Date(NOW - 60_000),
    expiresAt: new Date(NOW + 5 * 60_000),
    acceptedAt: new Date(NOW - 60_000),
    ...overrides,
  };
}

function linuxBindingDoc(overrides = {}) {
  return {
    schemaVersion: 1,
    ownerUid: OWNER,
    deviceId: MAC,
    helperPublicKeySpki: LINUX_HELPER_PUBLIC_KEY_SPKI,
    helperKeyId: `sha256:${"b".repeat(43)}`,
    executionServiceId: LINUX_SERVICE_ID,
    helperBuildId: LINUX_HELPER_BUILD_ID,
    runnerBuildId: LINUX_RUNNER_BUILD_ID,
    policyEpoch: 1,
    boundAt: new Date(NOW - 120_000),
    updatedAt: new Date(NOW - 120_000),
    ...overrides,
  };
}

async function prepareLinuxFleet(f, {
  attestation = linuxAttestationDoc(),
  grantOverrides = {},
} = {}) {
  await fleet.enrollDevice(OWNER, enrollment(CONTROLLER), f.context);
  await fleet.enrollDevice(OWNER, enrollment(MAC, {platform: "linux"}), f.context);
  if (attestation) {
    f.db.docs.set(`fleetHelperAttestations/${MAC}`, attestation);
  }
  await fleet.recordDeviceHeartbeat(identity(), heartbeat(), f.context);
  await fleet.createGrant(OWNER, grantPayload({
    capabilities: [
      "workspace.read",
      "workspace.snapshot",
      "workspace.write",
      "terminal.run",
    ],
    ...grantOverrides,
  }), f.context);
}

function linuxJobPayload(overrides = {}) {
  return jobPayload({
    type: "command",
    objective: "Run an attested Linux command job.",
    requiredCapabilities: [
      "workspace.read",
      "workspace.snapshot",
      "terminal.run",
    ],
    execution: {
      kind: "command",
      executable: "node",
      arguments: ["--version"],
      workingDirectory: ".",
      timeoutMs: 60_000,
    },
    idempotencyKey: "fleet-test:linux-command",
    ...overrides,
  });
}

function helperSign(unsigned, privateKey = LINUX_HELPER_KEY_PAIR.privateKey) {
  return sign(
      null,
      Buffer.from(fleetAuth.canonicalJson(unsigned)),
      privateKey,
  ).toString("base64url");
}

function terminationReceipt(overrides = {}, privateKey) {
  const ticketId = `ticket_${"1".repeat(32)}`;
  const unsigned = {
    domain: "statskey.fleet.termination-receipt.v1",
    ticketId,
    jobId: `job_${"0".repeat(32)}`,
    attempt: 1,
    leaseId: `lease_${"2".repeat(32)}`,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    highestLeaseSequence: 0,
    exitStatus: 1,
    terminationReason: "lease-expired",
    unitName: `statskey-fleet-job-${ticketId}.service`,
    cgroupPath:
      `/sys/fs/cgroup/system.slice/statskey-fleet-job-${ticketId}.service`,
    populated: false,
    accounting: {
      cpuUsageNs: 1_000_000,
      memoryPeakBytes: 4096,
      pidsPeak: 12,
      ioReadBytes: 1024,
      ioWriteBytes: 2048,
    },
    finishedAt: new Date(NOW).toISOString(),
    finishedAtMonotonicMs: 123_456,
    ...overrides,
  };
  return {...unsigned, signature: helperSign(unsigned, privateKey)};
}

test("desktop and service enforce the same protocol version and capability names", () => {
  assert.equal(protocol.PROTOCOL_VERSION, desktopProtocol.FLEET_PROTOCOL_VERSION);
  assert.deepEqual(protocol.CAPABILITIES, desktopProtocol.FLEET_CAPABILITIES);
  assert.deepEqual(
      protocol.REPOSITORY_HOSTS,
      desktopProtocol.FLEET_REPOSITORY_HOSTS,
  );
  for (const [repository, identity] of [
    ["StatsKey/Website.git", "github.com/statskey/website"],
    ["git@github.com:StatsKey/Website.git", "github.com/statskey/website"],
    [
      "https://origin.cursor.com/StatsKey/Website.git",
      "origin.cursor.com/statskey/website",
    ],
  ]) {
    assert.equal(protocol.normalizeRepositoryIdentity(repository), identity);
    assert.equal(
        desktopProtocol.normalizeRepositoryIdentity(repository),
        identity,
    );
    assert.equal(protocol.normalizeRepositoryIdentity(identity), identity);
  }
  for (const repository of [
    "git://github.com/StatsKey/Website",
    "https://gitlab.com/StatsKey/Website",
    "file:///tmp/StatsKey",
    "https://github.com/evil/%2e%2e/StatsKey/Website",
    "https://github.com/evil/../StatsKey/Website",
    "https://github.com/evil\\..\\StatsKey\\Website",
    "https://github.com/StatsKey/\tWebsite",
    "https://github.com/StatsKey/\nWebsite",
    "https://github.com/StatsKey/\rWebsite",
  ]) {
    assert.throws(() => protocol.normalizeRepositoryIdentity(repository));
    assert.throws(
        () => desktopProtocol.normalizeRepositoryIdentity(repository),
    );
  }
  const validExecutions = [
    {
      type: "xcode-test",
      execution: {
        kind: "xcode",
        containerKind: "project",
        containerPath: "StatsKey.xcodeproj",
        scheme: "StatsKey",
        onlyTesting: ["StatsKeyTests/FocusedTests"],
      },
    },
    {
      type: "command",
      execution: {
        kind: "command",
        executable: "node",
        arguments: ["test", "--runInBand"],
        workingDirectory: ".",
        timeoutMs: 60_000,
      },
    },
    {
      type: "windows-build",
      execution: {
        kind: "command",
        executable: "MSBuild",
        arguments: ["StatsKey.sln"],
        workingDirectory: "src",
      },
    },
  ];
  for (const fixture of validExecutions) {
    assert.deepEqual(
        protocol.normalizeExecution(fixture.execution, fixture.type),
        desktopProtocol.normalizeExecution(fixture.execution, fixture.type),
    );
  }
  const {
    controllerAuthorization: _controllerAuthorization,
    ...createInput
  } = jobPayload();
  const serviceCreate = protocol.normalizeCreateJob(createInput, OWNER, NOW);
  const desktopCreate = desktopProtocol.normalizeCreateJob(createInput, {
    ownerUid: OWNER,
    at: NOW,
  });
  const {schemaVersion, ...serviceCreateFields} = serviceCreate;
  const {version, ...desktopCreateFields} = desktopCreate;
  assert.equal(version, schemaVersion);
  assert.deepEqual(
      {
        ...desktopCreateFields,
        deadlineAt: Date.parse(desktopCreateFields.deadlineAt),
      },
      serviceCreateFields,
  );
  for (const malformed of [
    {approvalPolicy: ""},
    {reconciliationPolicy: ""},
    {dependencies: false},
    {exclusiveResources: false},
    {target: {deviceIds: false}},
    {target: {platforms: false}},
  ]) {
    assert.throws(
        () => protocol.normalizeCreateJob(
            {...createInput, ...malformed},
            OWNER,
            NOW,
        ),
    );
    assert.throws(
        () => desktopProtocol.normalizeCreateJob(
            {...createInput, ...malformed},
            {ownerUid: OWNER, at: NOW},
        ),
    );
  }
  const invalidExecutions = [
    {
      type: "xcode-test",
      execution: {
        kind: "xcode",
        containerKind: "project",
        containerPath: "StatsKey.xcodeproj",
        scheme: "StatsKey",
        onlyTesting: "",
      },
    },
    {
      type: "command",
      execution: {
        kind: "command",
        executable: "node",
        arguments: Array.from({length: 7}, () => "x".repeat(2_000)),
      },
    },
    {
      type: "command",
      execution: {
        kind: "command",
        executable: "/bin/sh",
        arguments: [],
      },
    },
  ];
  for (const fixture of invalidExecutions) {
    let serviceCode = null;
    let desktopCode = null;
    try {
      protocol.normalizeExecution(fixture.execution, fixture.type);
    } catch (error) {
      serviceCode = error.code;
    }
    try {
      desktopProtocol.normalizeExecution(fixture.execution, fixture.type);
    } catch (error) {
      desktopCode = error.code;
    }
    assert.equal(serviceCode, desktopCode);
    assert.ok(serviceCode);
  }
});

test("event validation rejects structured and embedded credential formats", () => {
  const payloads = [
    {githubToken: `ghp_${"a".repeat(36)}`},
    {environment: {OPENAI_API_KEY: `sk-${"b".repeat(40)}`}},
    {line: `AWS_ACCESS_KEY_ID=AKIA${"C".repeat(16)}`},
    {line: `token: eyJ${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`},
    {line: "DATABASE_URL=https://owner:password123@example.test/database"},
    {line: "-----BEGIN OPENSSH PRIVATE KEY-----"},
  ];
  for (const payload of payloads) {
    assert.throws(
        () => protocol.normalizeEvent({
          sequence: 1,
          type: "log",
          payload,
        }),
        {code: "invalid_argument"},
    );
  }
  assert.doesNotThrow(() => protocol.normalizeEvent({
    sequence: 1,
    type: "artifact",
    payload: {
      contentHash: "a".repeat(64),
      artifactId: `artifact_${"b".repeat(32)}`,
    },
  }));
});

test("the first controller requires account approval plus key possession", async () => {
  const f = fixture();
  const bootstrap = bootstrapPayload();
  const enrolled = await fleet.bootstrapDevice(
      OWNER,
      bootstrap.payload,
      f.context,
  );
  assert.equal(enrolled.id, bootstrap.deviceId);
  assert.equal(enrolled.role, "hybrid");
  assert.equal(enrolled.resources.cpuLogical, 0);
  assert.equal(enrolled.publicKeySpki, undefined);
  assert.equal(
      f.db.docs.get(`fleetDevices/${bootstrap.deviceId}`).publicKeySpki,
      bootstrap.payload.device.publicKeySpki,
  );
  assert.equal(
      (await fleet.bootstrapDevice(OWNER, bootstrap.payload, f.context)).id,
      bootstrap.deviceId,
  );

  const different = bootstrapPayload({label: "Other controller"});
  await assert.rejects(
      () => fleet.bootstrapDevice(OWNER, different.payload, f.context),
      {code: "conflict", status: 409},
  );
  await assert.rejects(
      () => fleet.bootstrapDevice(
          OTHER_OWNER,
          {
            ...different.payload,
            device: {
              ...different.payload.device,
              label: "Tampered after signing",
            },
          },
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
});

test("recent account recovery atomically replaces a lost controller key", async () => {
  const f = fixture();
  f.context.accountAuthTimeMs = NOW;
  const controller = bootstrapPayload();
  await fleet.bootstrapDevice(OWNER, controller.payload, f.context);
  const pairing = pairingPayload(controller);
  const paired = await fleet.pairDevice(OWNER, pairing.payload, f.context);
  await fleet.recordDeviceHeartbeat(
      {
        ownerUid: OWNER,
        deviceId: pairing.deviceId,
        publicKeyFingerprint: pairing.publicKeyFingerprint,
      },
      heartbeat(),
      f.context,
  );
  const runnable = await fleet.createJob(
      OWNER,
      jobPayload({}, {
        controllerDeviceId: controller.deviceId,
        controllerPrivateKey: controller.privateKey,
      }),
      f.context,
  );
  assert.equal(
      (await fleet.pollJobs(
          {
            ownerUid: OWNER,
            deviceId: pairing.deviceId,
            publicKeyFingerprint: pairing.publicKeyFingerprint,
          },
          {limit: 20},
          f.context,
      )).assignment.jobId,
      runnable.id,
  );
  const activeLease = await fleet.leaseJob(
      OWNER,
      {
        jobId: runnable.id,
        deviceId: pairing.deviceId,
        grantId: paired.grant.id,
      },
      f.context,
  );
  const queued = await fleet.createJob(
      OWNER,
      jobPayload(
          {idempotencyKey: "fleet-test:recovery:queued"},
          {
            controllerDeviceId: controller.deviceId,
            controllerPrivateKey: controller.privateKey,
          },
      ),
      f.context,
  );

  const recovery = recoveryPayload(controller.deviceId);
  const replacement = await fleet.recoverController(
      OWNER,
      recovery.payload,
      f.context,
  );
  assert.equal(replacement.id, recovery.deviceId);
  assert.equal(replacement.status, "active");
  assert.equal(
      (await fleet.recoverController(OWNER, recovery.payload, f.context)).id,
      recovery.deviceId,
  );
  assert.equal(
      f.db.docs.get(`fleetDevices/${controller.deviceId}`).status,
      "revoked",
  );
  assert.equal(
      f.db.docs.get(`fleetDevices/${controller.deviceId}`).replacedByDeviceId,
      recovery.deviceId,
  );
  const owner = [...f.db.docs.entries()]
      .find(([path]) => path.startsWith("fleetOwners/"))[1];
  assert.equal(owner.bootstrapDeviceId, recovery.deviceId);
  assert.equal(owner.previousBootstrapDeviceId, controller.deviceId);
  assert.equal(paired.grant.revokedAt, null);
  await assert.rejects(
      () => fleet.renewLease(
          {
            ownerUid: OWNER,
            deviceId: pairing.deviceId,
            publicKeyFingerprint: pairing.publicKeyFingerprint,
          },
          {
            leaseId: activeLease.lease.id,
            nonce: activeLease.lease.nonce,
          },
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  assert.equal(
      (await fleet.pollJobs(
          {
            ownerUid: OWNER,
            deviceId: pairing.deviceId,
            publicKeyFingerprint: pairing.publicKeyFingerprint,
          },
          {limit: 20},
          f.context,
      )).assignment,
      null,
  );
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {
            jobId: queued.id,
            deviceId: pairing.deviceId,
            grantId: paired.grant.id,
          },
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
});

test("controller recovery requires recent account authentication", async () => {
  const f = fixture();
  const controller = bootstrapPayload();
  await fleet.bootstrapDevice(OWNER, controller.payload, f.context);
  f.context.accountAuthTimeMs = NOW - 10 * 60_000 - 1;
  await assert.rejects(
      () => fleet.recoverController(
          OWNER,
          recoveryPayload(controller.deviceId).payload,
          f.context,
      ),
      {code: "recent_authentication_required", status: 401},
  );
});

test("pairing requires matching candidate and trusted-controller signatures", async () => {
  const f = fixture();
  const controller = bootstrapPayload();
  await fleet.bootstrapDevice(OWNER, controller.payload, f.context);
  const pairing = pairingPayload(controller);
  const result = await fleet.pairDevice(OWNER, pairing.payload, f.context);
  assert.equal(result.device.id, pairing.deviceId);
  assert.equal(result.device.role, "worker");
  assert.equal(result.grant.controllerDeviceId, controller.deviceId);
  assert.equal(result.grant.workerDeviceId, pairing.deviceId);
  assert.deepEqual(result.grant.workspaceIds, ["statskey-website"]);
  assert.equal(result.grant.unattended, true);
  assert.equal(
      f.db.docs.get(`fleetDevices/${pairing.deviceId}`).publicKeySpki,
      pairing.payload.receipt.candidate.publicKeySpki,
  );
  assert.equal(
      (await fleet.pairDevice(OWNER, pairing.payload, f.context)).grant.id,
      result.grant.id,
  );
  await assert.rejects(
      () => fleet.pairDevice(OTHER_OWNER, pairing.payload, f.context),
      {code: "permission_denied", status: 403},
  );

  await assert.rejects(
      () => fleet.pairDevice(
          OWNER,
          {
            ...pairing.payload,
            receipt: {
              ...pairing.payload.receipt,
              workspaceIds: ["different-workspace"],
            },
          },
          f.context,
      ),
      {code: "payload_mismatch"},
  );
  await fleet.revokeGrant(OWNER, {grantId: result.grant.id}, f.context);
  await assert.rejects(
      () => fleet.pairDevice(OWNER, pairing.payload, f.context),
      {code: "conflict", status: 409},
  );
});

test("pairing a controller device creates no grant and cannot execute", async () => {
  const f = fixture();
  f.context.accountAuthTimeMs = NOW;
  const controller = bootstrapPayload();
  await fleet.bootstrapDevice(OWNER, controller.payload, f.context);
  const phone = pairingPayload(controller, {
    candidate: {
      label: "Ryan's iPhone",
      role: "hybrid",
      workerMode: "disabled",
      platform: "ios",
    },
    workspaceIds: [],
    repositoryIdentities: [],
    capabilities: [],
    unattended: false,
  });
  const paired = await fleet.pairDevice(OWNER, phone.payload, f.context);
  assert.equal(paired.device.id, phone.deviceId);
  assert.equal(paired.device.role, "hybrid");
  assert.equal(paired.device.workerMode, "disabled");
  assert.equal(paired.device.platform, "ios");
  assert.equal(paired.grant, undefined);
  assert.equal(
      [...f.db.docs.keys()].filter((key) => key.startsWith("fleetGrants/")).length,
      0,
  );

  const replay = await fleet.pairDevice(OWNER, phone.payload, f.context);
  assert.equal(replay.device.id, phone.deviceId);
  assert.equal(replay.grant, undefined);

  // A paired controller can authorize jobs with its own device key.
  const created = await fleet.createJob(
      OWNER,
      jobPayload({}, {
        controllerDeviceId: phone.deviceId,
        controllerPrivateKey: phone.privateKey,
      }),
      f.context,
  );
  assert.equal(created.authorizedByControllerDeviceId, phone.deviceId);

  // But it can never execute: worker mode is disabled and no grant exists.
  assert.equal(
      (await fleet.pollJobs(
          {
            ownerUid: OWNER,
            deviceId: phone.deviceId,
            publicKeyFingerprint: phone.publicKeyFingerprint,
          },
          {limit: 20},
          f.context,
      )).assignment,
      null,
  );
});

test("controller pairing rejects execution scope and worker modes", async () => {
  const f = fixture();
  f.context.accountAuthTimeMs = NOW;
  const controller = bootstrapPayload();
  await fleet.bootstrapDevice(OWNER, controller.payload, f.context);
  const phoneCandidate = {
    label: "Ryan's iPhone",
    role: "hybrid",
    workerMode: "disabled",
    platform: "ios",
  };
  for (const receiptOverrides of [
    {capabilities: ["workspace.read"]},
    {workspaceIds: ["statskey-website"]},
    {repositoryIdentities: ["github.com/ryanwise77/statskey-website"]},
    {unattended: true},
  ]) {
    const phone = pairingPayload(controller, {
      candidate: phoneCandidate,
      workspaceIds: [],
      repositoryIdentities: [],
      capabilities: [],
      unattended: false,
      ...receiptOverrides,
    });
    await assert.rejects(
        () => fleet.pairDevice(OWNER, phone.payload, f.context),
        {code: "invalid_argument"},
    );
  }
  const dedicatedPhone = pairingPayload(controller, {
    candidate: {...phoneCandidate, workerMode: "opt-in"},
    workspaceIds: [],
    repositoryIdentities: [],
    capabilities: [],
    unattended: false,
  });
  await assert.rejects(
      () => fleet.pairDevice(OWNER, dedicatedPhone.payload, f.context),
      {code: "invalid_argument"},
  );
});

test("owners can revoke a paired worker but not the bootstrap controller", async () => {
  const f = fixture();
  const controller = bootstrapPayload();
  await fleet.bootstrapDevice(OWNER, controller.payload, f.context);
  const worker = pairingPayload(controller);
  await fleet.pairDevice(OWNER, worker.payload, f.context);
  assert.equal(
      (await fleet.revokeDevice(
          OWNER,
          {deviceId: worker.deviceId},
          f.context,
      )).status,
      "revoked",
  );
  await assert.rejects(
      () => fleet.revokeDevice(
          OWNER,
          {deviceId: controller.deviceId},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
});

test("an opt-in hybrid controller can create a signed local worker grant", async () => {
  const f = fixture();
  const controller = bootstrapPayload();
  await fleet.bootstrapDevice(OWNER, controller.payload, f.context);
  const receipt = {
    deviceId: controller.deviceId,
    workspaceIds: ["statskey-website"],
    repositoryIdentities: ["github.com/statskey/website"],
    capabilities: ["workspace.read", "workspace.snapshot", "xcode.test"],
    unattended: true,
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    policyVersion: 1,
  };
  const proof = fleetAuth.createSignedDeviceRequest({
    privateKey: controller.privateKey,
    deviceId: controller.deviceId,
    action: "grant.local",
    payload: receipt,
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
    requestId: `req_${"c".repeat(32)}`,
  });
  const grant = await fleet.createLocalGrant(
      OWNER,
      {receipt, proof},
      f.context,
  );
  assert.equal(grant.controllerDeviceId, controller.deviceId);
  assert.equal(grant.workerDeviceId, controller.deviceId);
  assert.deepEqual(grant.workspaceIds, ["statskey-website"]);
  assert.equal(
      (await fleet.createLocalGrant(OWNER, {receipt, proof}, f.context)).id,
      grant.id,
  );
  await assert.rejects(
      () => fleet.createLocalGrant(
          OWNER,
          {
            receipt: {...receipt, workspaceIds: ["different-workspace"]},
            proof,
          },
          f.context,
      ),
      {code: "payload_mismatch"},
  );
});

test("job creation is owner-bound and exactly idempotent", async () => {
  const f = fixture();
  await enrollTestController(f);
  const first = await fleet.createJob(OWNER, jobPayload(), f.context);
  const second = await fleet.createJob(OWNER, jobPayload(), f.context);

  assert.equal(first.id, second.id);
  assert.equal(first.state, "queued");
  assert.equal(first.revision, 1);
  assert.equal(first.authorizedByControllerDeviceId, CONTROLLER);
  assert.equal(first.cancellationRequestedAt, null);
  assert.equal(first.finishedAt, null);
  assert.equal(f.db.docs.size, 2);
  assert.equal(
      f.db.docs.get(`fleetJobs/${first.id}`).idempotencyKey,
      undefined,
  );

  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({objective: "Different work, same idempotency key."}),
          f.context,
      ),
      {code: "conflict", status: 409},
  );
  await assert.rejects(
      () => fleet.getJob(OTHER_OWNER, {jobId: first.id}, f.context),
      {code: "not_found", status: 404},
  );
});

test("every immutable job snapshot requires the active controller signature", async () => {
  const f = fixture();
  await enrollTestController(f);
  await assert.rejects(
      () =>
        fleet.createJob(
            OWNER,
            jobPayload({
              controllerAuthorization: null,
              idempotencyKey: "fleet-test:job:unsigned",
            }),
            f.context,
        ),
      {code: "permission_denied", status: 403},
  );
  const authorized = jobPayload({
    idempotencyKey: "fleet-test:job:tampered-after-authorization",
  });
  authorized.workspaceSnapshot = {
    ...authorized.workspaceSnapshot,
    commit: "f".repeat(40),
  };
  await assert.rejects(
      () => fleet.createJob(OWNER, authorized, f.context),
      {code: "permission_denied", status: 403},
  );
});

test("job and device lists are owner isolated, bounded, and newest first", async () => {
  const f = fixture();
  await enrollTestController(f);
  await enrollTestController(f, {
    ownerUid: OTHER_OWNER,
    identity: OTHER_CONTROLLER_IDENTITY,
    publicKeySpki: OTHER_CONTROLLER_PUBLIC_KEY_SPKI,
  });
  const first = await fleet.createJob(OWNER, jobPayload(), f.context);
  f.setTime(NOW + 1_000);
  const second = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:job:002"}),
      f.context,
  );
  await fleet.createJob(
      OTHER_OWNER,
      jobPayload(
          {idempotencyKey: "fleet-test:other:001"},
          {
            ownerUid: OTHER_OWNER,
            controllerDeviceId: OTHER_CONTROLLER_IDENTITY.deviceId,
            controllerPrivateKey: OTHER_CONTROLLER_KEY_PAIR.privateKey,
          },
      ),
      f.context,
  );
  const jobs = await fleet.listJobs(OWNER, {limit: 10}, f.context);
  assert.deepEqual(jobs.jobs.map((job) => job.id), [second.id, first.id]);
  assert.equal(jobs.mayHaveMore, false);
  assert.deepEqual(
      (await fleet.listJobs(OWNER, {state: "queued", limit: 1}, f.context))
          .jobs.map((job) => job.id),
      [second.id],
  );

  await fleet.enrollDevice(OWNER, enrollment(CONTROLLER), f.context);
  f.setTime(NOW + 2_000);
  await fleet.enrollDevice(OWNER, enrollment(MAC), f.context);
  await fleet.enrollDevice(
      OTHER_OWNER,
      enrollment(WINDOWS, {
        label: "Windows server",
        platform: "win32",
        publicKeyFingerprint: `sha256:${"e".repeat(43)}`,
      }),
      f.context,
  );
  const devices = await fleet.listDevices(OWNER, {limit: 10}, f.context);
  assert.deepEqual(
      devices.devices.map((device) => device.id),
      [MAC, CONTROLLER],
  );
  assert.equal(devices.devices[0].publicKeyFingerprint, undefined);
});

test("job validation rejects local repositories and unbounded cage input", async () => {
  const f = fixture();
  await enrollTestController(f);
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            workspaceSnapshot: {
              kind: "git",
              repository: "../local",
              commit: COMMIT,
            },
          }),
          f.context,
      ),
      {code: "invalid_argument"},
  );
  for (const repository of [
    "https://gitlab.com/statskey/website.git",
    "git://github.com/statskey/website.git",
  ]) {
    await assert.rejects(
        () => fleet.createJob(
            OWNER,
            jobPayload({
              workspaceSnapshot: {
                kind: "git",
                repository,
                commit: COMMIT,
              },
              idempotencyKey:
                `fleet-test:unsupported-repository-${repository.length}`,
            }),
            f.context,
        ),
        {code: "invalid_argument"},
    );
  }
  for (const workspaceSnapshot of [
    {
      kind: "bundle",
      artifactId: `artifact_${"a".repeat(32)}`,
    },
    {
      kind: "git",
      repository: "StatsKey/Website",
      commit: COMMIT,
      submodules: true,
    },
  ]) {
    await assert.rejects(
        () => fleet.createJob(
            OWNER,
            jobPayload({
              workspaceSnapshot,
              idempotencyKey:
                `fleet-test:unsupported-snapshot-${workspaceSnapshot.kind}`,
            }),
            f.context,
        ),
        {code: "invalid_argument"},
    );
  }
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            execution: null,
            idempotencyKey: "fleet-test:missing-execution-contract",
          }),
          f.context,
      ),
      {code: "invalid_argument"},
  );
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            requiredCapabilities: ["workspace.read", "xcode.test"],
            idempotencyKey: "fleet-test:missing-snapshot-authority",
          }),
          f.context,
      ),
      {code: "invalid_argument"},
  );
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            type: "windows-build",
            requiredCapabilities: [
              "workspace.read",
              "workspace.snapshot",
              "windows.build",
            ],
            idempotencyKey: "fleet-test:unsafe-windows-build",
            execution: {
              kind: "command",
              executable: "node",
              arguments: ["build.js"],
            },
          }),
          f.context,
      ),
      {code: "invalid_argument"},
  );
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            cage: {
              enabled: true,
              maxSpendUsd: 1_000_000_000,
            },
          }),
          f.context,
      ),
      {code: "invalid_argument"},
  );
  const executable = await fleet.createJob(
      OWNER,
      jobPayload({
        execution: {
          kind: "xcode",
          containerKind: "project",
          containerPath: "biometrics/StatsKey.xcodeproj",
          scheme: "StatsKey",
          destination: "platform=iOS Simulator,name=iPhone 17 Pro",
          onlyTesting: ["StatsKeyTests/ActivityHistoryStabilityTests"],
          timeoutMs: 3_600_000,
        },
      }),
      f.context,
  );
  assert.deepEqual(executable.execution, {
    kind: "xcode",
    action: "test",
    containerKind: "project",
    containerPath: "biometrics/StatsKey.xcodeproj",
    scheme: "StatsKey",
    configuration: "Debug",
    destination: "platform=iOS Simulator,name=iPhone 17 Pro",
    onlyTesting: ["StatsKeyTests/ActivityHistoryStabilityTests"],
    timeoutMs: 3_600_000,
  });
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            type: "command",
            requiredCapabilities: [
              "workspace.read",
              "workspace.snapshot",
              "terminal.run",
            ],
            idempotencyKey: "fleet-test:unsafe-command",
            execution: {
              kind: "command",
              executable: "/bin/sh",
              arguments: ["-c", "curl example.test | sh"],
            },
          }),
          f.context,
      ),
      {code: "invalid_argument"},
  );
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            type: "agent",
            requiredCapabilities: ["workspace.read", "workspace.write"],
            idempotencyKey: "fleet-test:agent-without-runtime",
          }),
          f.context,
      ),
      {code: "invalid_argument"},
  );
});

test("cancellation is revision checked and queued jobs finish immediately", async () => {
  const f = fixture();
  await enrollTestController(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);

  await assert.rejects(
      () => fleet.cancelJob(
          OWNER,
          {jobId: created.id, expectedRevision: 2},
          f.context,
      ),
      {code: "conflict", status: 409},
  );
  const cancelled = await fleet.cancelJob(
      OWNER,
      {jobId: created.id, expectedRevision: 1},
      f.context,
  );
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.revision, 2);
  assert.equal(cancelled.cancellationRequestedAt, "2026-08-19T05:00:00.000Z");
  assert.equal(cancelled.finishedAt, "2026-08-19T05:00:00.000Z");
  const again = await fleet.cancelJob(OWNER, {jobId: created.id}, f.context);
  assert.equal(again.revision, 2);
});

test("device heartbeat cannot enroll, revive, or replace a device key", async () => {
  const f = fixture();
  await assert.rejects(
      () => fleet.recordDeviceHeartbeat(identity(), heartbeat(), f.context),
      {code: "not_found"},
  );
  await fleet.enrollDevice(OWNER, enrollment(MAC), f.context);
  const updated = await fleet.recordDeviceHeartbeat(
      identity(),
      heartbeat(),
      f.context,
  );
  assert.equal(updated.connection, "direct");
  assert.equal(updated.resources.cpuAvailable, 10);
  assert.equal(updated.activeJobs, 0);
  assert.equal(
      f.db.docs.get(`fleetDevices/${MAC}`).reportedActiveJobs,
      0,
  );
  assert.equal(updated.lastSeenAt, "2026-08-19T05:00:00.000Z");

  await assert.rejects(
      () => fleet.recordDeviceHeartbeat(
          identity({publicKeyFingerprint: `sha256:${"x".repeat(43)}`}),
          heartbeat(),
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  const row = f.db.docs.get(`fleetDevices/${MAC}`);
  f.db.docs.set(`fleetDevices/${MAC}`, {...row, status: "revoked"});
  await assert.rejects(
      () => fleet.recordDeviceHeartbeat(identity(), heartbeat(), f.context),
      {code: "permission_denied", status: 403},
  );
});

test("Linux heartbeats cannot self-attest executable worker authority", async () => {
  const f = fixture();
  await fleet.enrollDevice(OWNER, enrollment(CONTROLLER), f.context);
  await fleet.enrollDevice(
      OWNER,
      enrollment(MAC, {platform: "linux"}),
      f.context,
  );
  const updated = await fleet.recordDeviceHeartbeat(
      identity(),
      heartbeat(),
      f.context,
  );
  assert.deepEqual(updated.capabilities, []);
  assert.deepEqual(updated.executables, []);
  assert.deepEqual(f.db.docs.get(`fleetDevices/${MAC}`).capabilities, []);
  assert.deepEqual(f.db.docs.get(`fleetDevices/${MAC}`).executables, []);

  await fleet.createGrant(OWNER, grantPayload(), f.context);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  assert.equal((await fleet.pollJobs(identity(), {}, f.context)).assignment, null);
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      (error) => {
        assert.equal(error.code, "failed_precondition");
        assert.equal(error.status, 409);
        assert.match(error.message, /execution-attestation-missing/);
        return true;
      },
  );
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).attempt, 0);

  f.db.docs.set(
      `fleetHelperAttestations/${MAC}`,
      linuxAttestationDoc({expiresAt: new Date(NOW - 1)}),
  );
  const expiredHeartbeat = await fleet.recordDeviceHeartbeat(
      identity(),
      heartbeat(),
      f.context,
  );
  assert.deepEqual(expiredHeartbeat.capabilities, []);
  assert.equal((await fleet.pollJobs(identity(), {}, f.context)).assignment, null);
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      (error) => {
        assert.equal(error.code, "failed_precondition");
        assert.equal(error.status, 409);
        assert.match(error.message, /execution-attestation-expired/);
        return true;
      },
  );
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).attempt, 0);
});

test("grants require already enrolled controller and worker roles", async () => {
  const f = fixture();
  await fleet.enrollDevice(OWNER, enrollment(CONTROLLER), f.context);
  await assert.rejects(
      () => fleet.createGrant(OWNER, grantPayload(), f.context),
      {code: "not_found"},
  );
  await fleet.enrollDevice(
      OWNER,
      enrollment(MAC, {role: "controller", workerMode: "disabled"}),
      f.context,
  );
  await assert.rejects(
      () => fleet.createGrant(OWNER, grantPayload(), f.context),
      {code: "failed_precondition", status: 409},
  );
});

test("owners can list and revoke grants and dedicated workers", async () => {
  const f = fixture();
  await prepareFleet(f);
  const listed = await fleet.listGrants(OWNER, {limit: 10}, f.context);
  assert.deepEqual(listed.grants.map((grant) => grant.id), [GRANT]);
  const storedGrant = f.db.docs.get(`fleetGrants/${GRANT}`);
  const authorizationJob = {
    ownerUid: OWNER,
    workspaceId: "statskey-website",
    requiredCapabilities: [],
  };
  assert.equal(
      fleet._test.grantAllows(
          {...storedGrant, receipt: {...storedGrant.receipt, unattended: false}},
          authorizationJob,
          {id: MAC},
          f.db.docs.get(`fleetDevices/${CONTROLLER}`),
          NOW,
      ),
      false,
  );
  assert.equal(
      fleet._test.grantAllows(
          {...storedGrant, receipt: {...storedGrant.receipt, policyVersion: 2}},
          authorizationJob,
          {id: MAC},
          f.db.docs.get(`fleetDevices/${CONTROLLER}`),
          NOW,
      ),
      false,
  );

  const revokedGrant = await fleet.revokeGrant(
      OWNER,
      {grantId: GRANT},
      f.context,
  );
  assert.ok(revokedGrant.revokedAt);
  assert.equal(
      fleet._test.grantAllows(
          f.db.docs.get(`fleetGrants/${GRANT}`),
          authorizationJob,
          {id: MAC},
          f.db.docs.get(`fleetDevices/${CONTROLLER}`),
          NOW,
      ),
      false,
  );

  const revokedDevice = await fleet.revokeDevice(
      OWNER,
      {deviceId: MAC},
      f.context,
  );
  assert.equal(revokedDevice.status, "revoked");
  await assert.rejects(
      () => fleet.revokeDevice(OWNER, {deviceId: CONTROLLER}, f.context),
      {code: "failed_precondition", status: 409},
  );
});

test("eligible jobs lease atomically and keep the nonce out of storage", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const result = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );

  assert.equal(result.job.state, "leased");
  assert.equal(result.job.attempt, 1);
  assert.equal(result.job.assignedDeviceId, MAC);
  assert.match(result.lease.id, /^lease_[a-f0-9]{32}$/);
  const storedLease = f.db.docs.get(`fleetLeases/${result.lease.id}`);
  assert.equal(JSON.stringify(storedLease).includes(result.lease.nonce), false);
  assert.match(storedLease.nonceHash, /^[a-f0-9]{64}$/);
  assert.equal(
      f.db.docs.get(`fleetDevices/${MAC}`).activeJobs,
      1,
  );
  await fleet.recordDeviceHeartbeat(
      identity(),
      heartbeat({activeJobs: 0}),
      f.context,
  );
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 1);
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).reportedActiveJobs, 0);
});

test("workspace grants bind execution to an exact repository identity", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(
      OWNER,
      jobPayload({
        workspaceSnapshot: {
          kind: "git",
          repository: "attacker/unreviewed-code",
          commit: COMMIT,
        },
        idempotencyKey: "fleet-test:repository-bound-grant",
      }),
      f.context,
  );
  assert.equal(
      created.workspaceSnapshot.repositoryIdentity,
      "github.com/attacker/unreviewed-code",
  );
  assert.equal((await fleet.pollJobs(identity(), {}, f.context)).assignment, null);
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).attempt, 0);
});

test("oversized jobs are rejected before entering the control plane", async () => {
  const f = fixture();
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({
            type: "command",
            objective: "x".repeat(12_000),
            requiredCapabilities: [
              "workspace.read",
              "workspace.snapshot",
              "terminal.run",
            ],
            execution: {
              kind: "command",
              executable: "node",
              arguments: Array.from({length: 48}, () => "x".repeat(2_000)),
              workingDirectory: ".",
              timeoutMs: 60_000,
            },
            idempotencyKey: "fleet-test:oversized-job",
          }),
          f.context,
      ),
      {code: "payload_too_large", status: 400},
  );
  assert.equal(
      [...f.db.docs.keys()].some((key) => key.startsWith("fleetJobs/")),
      false,
  );
});

test("legacy oversized jobs cannot mutate capacity before claim signing", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const stored = f.db.docs.get(`fleetJobs/${created.id}`);
  stored.execution = {
    kind: "command",
    executable: "node",
    arguments: Array.from({length: 128}, () => "x".repeat(2_000)),
    workingDirectory: ".",
    timeoutMs: 60_000,
  };

  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      {code: "payload_too_large", status: 400},
  );
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).state, "queued");
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).attempt, 0);
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
  assert.equal(
      [...f.db.docs.keys()].some((key) => key.startsWith("fleetLeases/")),
      false,
  );
});

test("artifact-producing work is fenced when storage is not ready", async () => {
  const f = fixture();
  await enrollTestController(f);
  const readyStore = f.context.artifactStore;
  f.context.artifactStore = null;
  await assert.rejects(
      () => fleet.createJob(
          OWNER,
          jobPayload({idempotencyKey: "fleet-test:no-artifact-store"}),
          f.context,
      ),
      {code: "failed_precondition", status: 503},
  );

  f.context.artifactStore = readyStore;
  await prepareFleet(f);
  const created = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:artifact-store-lost"}),
      f.context,
  );
  f.context.artifactStore = null;
  assert.equal((await fleet.pollJobs(identity(), {}, f.context)).assignment, null);
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      {code: "failed_precondition", status: 503},
  );
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).state, "queued");
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
});

test("review-only jobs cannot execute without a per-job approval protocol", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(
      OWNER,
      jobPayload({
        approvalPolicy: "review",
        idempotencyKey: "fleet-test:review-required",
      }),
      f.context,
  );
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
});

test("worker polling carries a cursor past a large ineligible head of line", async () => {
  const f = fixture();
  await prepareFleet(f);
  for (let index = 0; index < 101; index += 1) {
    f.setTime(NOW + index);
    await fleet.createJob(
        OWNER,
        jobPayload({
          approvalPolicy: "review",
          idempotencyKey: `fleet-test:blocked:${String(index).padStart(3, "0")}`,
        }),
        f.context,
    );
  }
  f.setTime(NOW + 101);
  const runnable = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:runnable-after-blocked"}),
      f.context,
  );
  const first = await fleet.pollJobs(identity(), {limit: 20}, f.context);
  assert.equal(first.assignment, null);
  assert.match(first.cursorJobId, /^job_[a-f0-9]{32}$/);
  assert.equal(first.retryAfterMs, 250);
  const result = await fleet.pollJobs(
      identity(),
      {limit: 20, cursorJobId: first.cursorJobId},
      f.context,
  );
  assert.equal(result.assignment.jobId, runnable.id);
});

test("worker polling bounds dependency reads and resumes with a cursor", async () => {
  const f = fixture();
  await prepareFleet(f);
  for (let group = 0; group < 4; group += 1) {
    const dependencies = Array.from({length: 128}, (_, index) => {
      const value = group * 128 + index;
      const dependencyId = `job_${value.toString(16).padStart(32, "0")}`;
      f.db.docs.set(`fleetJobs/${dependencyId}`, {
        ownerUid: OWNER,
        state: "leased",
      });
      return dependencyId;
    });
    f.setTime(NOW + group);
    await fleet.createJob(
        OWNER,
        jobPayload({
          idempotencyKey: `fleet-test:dependency-budget:${group}`,
          dependencies,
        }),
        f.context,
    );
  }
  f.setTime(NOW + 4);
  const boundaryDependency = `job_${"f".repeat(32)}`;
  f.db.docs.set(`fleetJobs/${boundaryDependency}`, {
    ownerUid: OWNER,
    state: "leased",
  });
  await fleet.createJob(
      OWNER,
      jobPayload({
        idempotencyKey: "fleet-test:dependency-budget:boundary",
        dependencies: [boundaryDependency],
      }),
      f.context,
  );
  f.setTime(NOW + 5);
  const runnable = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:dependency-budget:runnable"}),
      f.context,
  );
  const first = await fleet.pollJobs(identity(), {limit: 20}, f.context);
  assert.equal(first.assignment, null);
  assert.match(first.cursorJobId, /^job_[a-f0-9]{32}$/);
  assert.equal(first.retryAfterMs, 250);
  const result = await fleet.pollJobs(
      identity(),
      {limit: 20, cursorJobId: first.cursorJobId},
      f.context,
  );
  assert.equal(result.assignment.jobId, runnable.id);
});

test("worker polling filters revoked long-lived grants before its scan budget", async () => {
  const f = fixture();
  await prepareFleet(f);
  for (let index = 0; index < 51; index += 1) {
    const grantId = `grant_${index.toString(16).padStart(32, "0")}`;
    await fleet.createGrant(
        OWNER,
        grantPayload({
          id: grantId,
          expiresAt: NOW + 2 * 24 * 60 * 60 * 1000 + index,
        }),
        f.context,
    );
    await fleet.revokeGrant(OWNER, {grantId}, f.context);
  }
  const runnable = await fleet.createJob(OWNER, jobPayload(), f.context);
  const result = await fleet.pollJobs(identity(), {limit: 20}, f.context);
  assert.equal(result.assignment.jobId, runnable.id);
  assert.equal(result.assignment.grantId, GRANT);
});

test("exclusive resource leases reject concurrent jobs", async () => {
  const f = fixture();
  await prepareFleet(f);
  const first = await fleet.createJob(OWNER, jobPayload(), f.context);
  const second = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:job:002"}),
      f.context,
  );
  await fleet.leaseJob(
      OWNER,
      {jobId: first.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: second.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      {code: "conflict", status: 409},
  );
});

test("device capacity is reserved atomically across concurrent leases", async () => {
  const f = fixture();
  await prepareFleet(f);
  const resources = {
    cpuLogical: 6,
    memoryBytes: 16 * 1024 ** 3,
    diskAvailableBytes: 100 * 1024 ** 3,
    gpuCount: 0,
  };
  const first = await fleet.createJob(
      OWNER,
      jobPayload({
        resources,
        exclusiveResources: ["xcode:capacity-lane-1"],
        idempotencyKey: "fleet-test:capacity:001",
      }),
      f.context,
  );
  const second = await fleet.createJob(
      OWNER,
      jobPayload({
        resources,
        exclusiveResources: ["xcode:capacity-lane-2"],
        idempotencyKey: "fleet-test:capacity:002",
      }),
      f.context,
  );
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: first.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  assert.equal(
      f.db.docs.get(`fleetDevices/${MAC}`).reservedResources.cpuLogical,
      6,
  );
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: second.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      (error) => {
        assert.equal(error.code, "failed_precondition");
        assert.match(error.message, /cpu-insufficient|memory-insufficient/);
        return true;
      },
  );
  const credential = {
    jobId: first.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credential, state: "preparing"},
      f.context,
  );
  await fleet.transitionJob(
      identity(),
      {...credential, state: "running"},
      f.context,
  );
  await fleet.transitionJob(
      identity(),
      {...credential, state: "succeeded"},
      f.context,
  );
  assert.equal(
      f.db.docs.get(`fleetDevices/${MAC}`).reservedResources.cpuLogical,
      0,
  );
  assert.equal(
      (await fleet.leaseJob(
          OWNER,
          {jobId: second.id, deviceId: MAC, grantId: GRANT},
          f.context,
      )).job.state,
      "leased",
  );
});

test("a worker requeues only a safe retry with confirmed termination", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const credential = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credential, state: "preparing"},
      f.context,
  );
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            ...credential,
            state: "queued",
            retry: {
              code: "snapshot_materialization_failed",
              terminationConfirmed: false,
            },
          },
          f.context,
      ),
      {code: "invalid_argument"},
  );
  const retryPayload = {
    ...credential,
    state: "queued",
    transitionId: `op_${"a".repeat(32)}`,
    retry: {
      code: "snapshot_materialization_failed",
      terminationConfirmed: true,
    },
  };
  const retrying = await fleet.transitionJob(
      identity(),
      retryPayload,
      f.context,
  );
  assert.deepEqual(
      await fleet.transitionJob(identity(), retryPayload, f.context),
      retrying,
  );
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            ...retryPayload,
            retry: {
              code: "different_retry",
              terminationConfirmed: true,
            },
          },
          f.context,
      ),
      {code: "conflict"},
  );
  assert.equal(retrying.state, "queued");
  assert.equal(retrying.assignedDeviceId, null);
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).activeLeaseId, null);
  assert.equal(retrying.attempt, 1);
  assert.equal(retrying.lastFailure.code, "snapshot_materialization_failed");
  assert.equal(
      f.db.docs.get(`fleetDevices/${MAC}`).reservedResources.cpuLogical,
      0,
  );
  assert.equal(
      f.db.docs.get(`fleetLeases/${lease.id}`).releasedAt.getTime(),
      NOW,
  );
  const secondAttempt = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  assert.equal(secondAttempt.job.attempt, 2);
  assert.deepEqual(
      await fleet.transitionJob(identity(), retryPayload, f.context),
      retrying,
  );
});

test("jobs cannot lease until every owner-matched dependency succeeds", async () => {
  const f = fixture();
  await prepareFleet(f);
  const dependency = await fleet.createJob(OWNER, jobPayload(), f.context);
  const dependent = await fleet.createJob(
      OWNER,
      jobPayload({
        idempotencyKey: "fleet-test:job:dependent",
        dependencies: [dependency.id],
      }),
      f.context,
  );
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: dependent.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: dependency.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const credentials = {
    jobId: dependency.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credentials, state: "preparing"},
      f.context,
  );
  await fleet.transitionJob(
      identity(),
      {...credentials, state: "running"},
      f.context,
  );
  await fleet.transitionJob(
      identity(),
      {...credentials, state: "succeeded"},
      f.context,
  );
  assert.equal(
      (await fleet.leaseJob(
          OWNER,
          {jobId: dependent.id, deviceId: MAC, grantId: GRANT},
          f.context,
      )).job.state,
      "leased",
  );
});

test("offline and under-provisioned workers fail closed", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  f.setTime(NOW + protocol.DEVICE_ONLINE_WINDOW_MS + 1);
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      (error) => {
        assert.equal(error.code, "failed_precondition");
        assert.match(error.message, /device-offline/);
        return true;
      },
  );
});

test("command jobs require the worker to report the exact executable", async () => {
  const f = fixture();
  await prepareFleet(f);
  const commandGrant = `grant_${"e".repeat(32)}`;
  await fleet.createGrant(
      OWNER,
      grantPayload({
        id: commandGrant,
        capabilities: ["workspace.read", "workspace.snapshot", "terminal.run"],
      }),
      f.context,
  );
  const created = await fleet.createJob(
      OWNER,
      jobPayload({
        type: "command",
        requiredCapabilities: [
          "workspace.read",
          "workspace.snapshot",
          "terminal.run",
        ],
        execution: {
          kind: "command",
          executable: "node",
          arguments: ["--version"],
          workingDirectory: ".",
          timeoutMs: 60_000,
        },
        idempotencyKey: "fleet-test:executable-contract",
      }),
      f.context,
  );
  f.db.docs.get(`fleetDevices/${MAC}`).executables = [];

  assert.equal((await fleet.pollJobs(identity(), {}, f.context)).assignment, null);
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: commandGrant},
          f.context,
      ),
      (error) => {
        assert.equal(error.code, "failed_precondition");
        assert.match(error.message, /executable-unavailable/);
        return true;
      },
  );
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).attempt, 0);
});

test("leases renew only with the enrolled worker and correct nonce", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 30_000},
      f.context,
  );
  f.setTime(NOW + 10_000);
  const renewed = await fleet.renewLease(
      identity(),
      {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
      f.context,
  );
  assert.equal(renewed.expiresAt, "2026-08-19T05:01:10.000Z");
  assert.equal(renewed.cancellationRequested, false);
  assert.equal(renewed.deadlineAt, "2026-08-19T07:00:00.000Z");
  await assert.rejects(
      () => fleet.renewLease(
          identity(),
          {leaseId: lease.id, nonce: "wrong", ttlMs: 60_000},
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  await fleet.revokeGrant(OWNER, {grantId: GRANT}, f.context);
  await assert.rejects(
      () => fleet.renewLease(
          identity(),
          {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
});

test("an existing Linux lease cannot renew without execution attestation", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 30_000},
      f.context,
  );
  const leasePath = `fleetLeases/${lease.id}`;
  const originalExpiry = f.db.docs.get(leasePath).expiresAt.toISOString();
  const device = f.db.docs.get(`fleetDevices/${MAC}`);
  f.db.docs.set(`fleetDevices/${MAC}`, {...device, platform: "linux"});
  f.setTime(NOW + 10_000);

  await assert.rejects(
      () => fleet.renewLease(
          identity(),
          {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  assert.equal(
      f.db.docs.get(leasePath).expiresAt.toISOString(),
      originalExpiry,
  );
});

test("an existing Linux lease cannot start or self-confirm a retry", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 30_000},
      f.context,
  );
  const credential = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  const devicePath = `fleetDevices/${MAC}`;
  const device = f.db.docs.get(devicePath);
  f.db.docs.set(devicePath, {...device, platform: "linux"});
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {...credential, state: "preparing"},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );

  f.db.docs.set(devicePath, device);
  await fleet.transitionJob(
      identity(),
      {...credential, state: "preparing"},
      f.context,
  );
  f.db.docs.set(devicePath, {...device, platform: "linux"});
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            ...credential,
            state: "queued",
            retry: {
              code: "snapshot_materialization_failed",
              terminationConfirmed: true,
            },
          },
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  await assert.rejects(
      () => fleet.appendJobEvent(
          identity(),
          {
            ...credential,
            event: {
              sequence: 1,
              type: "checkpoint",
              payload: {phase: "preparing"},
            },
          },
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  const failed = await fleet.transitionJob(
      identity(),
      {...credential, state: "failed"},
      f.context,
  );
  assert.equal(failed.state, "failed");
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).activeLeaseId, null);
});

test("lease renewal fails closed when an exclusive lock is missing", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:lost-exclusive-lock"}),
      f.context,
  );
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 30_000},
      f.context,
  );
  const resourceKey = [...f.db.docs.keys()].find((key) =>
    key.startsWith("fleetResourceLeases/"));
  assert.ok(resourceKey);
  f.db.docs.delete(resourceKey);
  f.setTime(NOW + 10_000);

  await assert.rejects(
      () => fleet.renewLease(
          identity(),
          {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
          f.context,
      ),
      {code: "conflict", status: 409},
  );
  assert.equal(
      f.db.docs.get(`fleetLeases/${lease.id}`).expiresAt.toISOString(),
      "2026-08-19T05:00:30.000Z",
  );
});

test("leases can never extend beyond the job deadline", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(
      OWNER,
      jobPayload({
        deadlineAt: NOW + 20_000,
        idempotencyKey: "fleet-test:deadline-bound-lease",
      }),
      f.context,
  );
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 60_000},
      f.context,
  );
  assert.equal(lease.expiresAt, "2026-08-19T05:00:20.000Z");
  f.setTime(NOW + 10_000);
  assert.equal(
      (await fleet.renewLease(
          identity(),
          {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
          f.context,
      )).expiresAt,
      "2026-08-19T05:00:20.000Z",
  );
  f.setTime(NOW + 20_001);
  await assert.rejects(
      () => fleet.renewLease(
          identity(),
          {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
});

test("expired leases release capacity, requeue, and exhaust attempts safely", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const first = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      f.context,
  );
  await assert.rejects(
      () => fleet.recoverJob(OWNER, {jobId: created.id}, f.context),
      {code: "failed_precondition", status: 409},
  );

  f.setTime(NOW + 15_001);
  const requeued = await fleet.recoverJob(
      OWNER,
      {jobId: created.id},
      f.context,
  );
  assert.equal(requeued.state, "queued");
  assert.equal(requeued.assignedDeviceId, null);
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
  assert.ok(f.db.docs.get(`fleetLeases/${first.lease.id}`).releasedAt);

  const second = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      f.context,
  );
  assert.equal(second.job.attempt, 2);
  f.setTime(NOW + 30_002);
  const exhausted = await fleet.recoverJob(
      OWNER,
      {jobId: created.id},
      f.context,
  );
  assert.equal(exhausted.state, "failed");
  assert.equal(exhausted.finishedAt, "2026-08-19T05:00:30.002Z");
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
});

test("expired preparation fails closed after a native process may start", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      f.context,
  );
  await fleet.transitionJob(
      identity(),
      {
        jobId: created.id,
        leaseId: lease.id,
        nonce: lease.nonce,
        state: "preparing",
      },
      f.context,
  );
  f.setTime(NOW + 15_001);
  const recovered = await fleet.recoverJob(
      OWNER,
      {jobId: created.id},
      f.context,
  );
  assert.equal(recovered.state, "failed");
  assert.equal(
      recovered.lastFailure.code,
      "lease_expired_execution_ambiguous",
  );
  assert.equal(recovered.lastFailure.terminationConfirmed, false);
});

test("expired running work fails closed instead of executing twice", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      f.context,
  );
  const credential = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credential, state: "preparing"},
      f.context,
  );
  await fleet.transitionJob(
      identity(),
      {...credential, state: "running"},
      f.context,
  );
  f.setTime(NOW + 15_001);
  const recovered = await fleet.recoverJob(
      OWNER,
      {jobId: created.id},
      f.context,
  );
  assert.equal(recovered.state, "failed");
  assert.equal(recovered.attempt, 1);
  assert.equal(
      recovered.lastFailure.code,
      "lease_expired_execution_ambiguous",
  );
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      {code: "failed_precondition"},
  );
});

test("lease recovery self-heals missing lease and device records", async () => {
  const missingLease = fixture();
  await prepareFleet(missingLease);
  const firstJob = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:missing-lease"}),
      missingLease.context,
  );
  const firstClaim = await fleet.leaseJob(
      OWNER,
      {jobId: firstJob.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      missingLease.context,
  );
  missingLease.db.docs.delete(`fleetLeases/${firstClaim.lease.id}`);
  const restartedPoll = await fleet.pollJobs(
      identity(),
      {limit: 20},
      missingLease.context,
  );
  assert.equal(restartedPoll.assignment.jobId, firstJob.id);
  assert.equal(missingLease.db.docs.get(`fleetJobs/${firstJob.id}`).state, "queued");
  assert.equal(
      missingLease.db.docs.get(`fleetJobs/${firstJob.id}`).activeLeaseId,
      null,
  );
  assert.equal(missingLease.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
  assert.deepEqual(
      missingLease.db.docs.get(`fleetDevices/${MAC}`).activeLeaseIds,
      [],
  );

  const missingDevice = fixture();
  await prepareFleet(missingDevice);
  const secondJob = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:missing-device"}),
      missingDevice.context,
  );
  await fleet.leaseJob(
      OWNER,
      {jobId: secondJob.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      missingDevice.context,
  );
  missingDevice.db.docs.delete(`fleetDevices/${MAC}`);
  missingDevice.setTime(NOW + 15_001);
  const secondRecovered = await fleet.recoverJob(
      OWNER,
      {jobId: secondJob.id},
      missingDevice.context,
  );
  assert.equal(secondRecovered.state, "queued");
  assert.equal(secondRecovered.assignedDeviceId, null);
});

test("the bounded sweeper recovers dead leases and queued deadlines", async () => {
  const f = fixture();
  await prepareFleet(f);
  const leased = await fleet.createJob(OWNER, jobPayload(), f.context);
  const lease = await fleet.leaseJob(
      OWNER,
      {jobId: leased.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      f.context,
  );
  const queued = await fleet.createJob(
      OWNER,
      jobPayload({
        deadlineAt: NOW + 60_000,
        idempotencyKey: "fleet-test:sweeper:queued",
      }),
      f.context,
  );
  f.setTime(NOW + 60_001);
  const summary = await fleet.sweepExpiredFleetWork(
      f.context,
      {limit: 10},
  );
  assert.deepEqual(summary, {
    scannedLeases: 1,
    scannedQueuedJobs: 1,
    recovered: 2,
    skipped: 0,
    failed: 0,
    hasMore: false,
  });
  assert.equal(f.db.docs.get(`fleetJobs/${leased.id}`).state, "queued");
  assert.equal(f.db.docs.get(`fleetJobs/${queued.id}`).state, "timed_out");
  assert.ok(f.db.docs.get(`fleetLeases/${lease.lease.id}`).releasedAt);
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
});

test("a restarted worker poll recovers its own expired lease automatically", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      f.context,
  );
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeLeaseIds.length, 1);
  f.setTime(NOW + 15_001);
  const result = await fleet.pollJobs(identity(), {limit: 20}, f.context);
  assert.equal(result.assignment.jobId, created.id);
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).state, "queued");
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
  assert.deepEqual(f.db.docs.get(`fleetDevices/${MAC}`).activeLeaseIds, []);
});

test("queued recovery expires deadlines and propagates terminal dependencies", async () => {
  const f = fixture();
  await enrollTestController(f);
  const expiring = await fleet.createJob(
      OWNER,
      jobPayload({
        deadlineAt: NOW + 60_000,
        idempotencyKey: "fleet-test:queued-expiry",
      }),
      f.context,
  );
  f.setTime(NOW + 60_001);
  assert.equal(
      (await fleet.recoverJob(OWNER, {jobId: expiring.id}, f.context)).state,
      "timed_out",
  );

  f.setTime(NOW);
  const dependency = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:dependency-failure"}),
      f.context,
  );
  const dependent = await fleet.createJob(
      OWNER,
      jobPayload({
        idempotencyKey: "fleet-test:dependent-failure",
        dependencies: [dependency.id],
      }),
      f.context,
  );
  await fleet.cancelJob(OWNER, {jobId: dependency.id}, f.context);
  assert.equal(
      (await fleet.recoverJob(OWNER, {jobId: dependent.id}, f.context)).state,
      "failed",
  );
});

test("an expired cancelled lease becomes terminal instead of requeueing", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 15_000},
      f.context,
  );
  await fleet.cancelJob(OWNER, {jobId: created.id}, f.context);
  f.setTime(NOW + 15_001);
  const recovered = await fleet.recoverJob(
      OWNER,
      {jobId: created.id},
      f.context,
  );
  assert.equal(recovered.state, "cancelled");
  assert.equal(recovered.assignedDeviceId, null);
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
});

test("artifacts require a live lease and commit only verified object metadata", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const credential = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credential, state: "preparing"},
      f.context,
  );
  const descriptor = {
    id: `artifact_${"9".repeat(32)}`,
    kind: "xcresult",
    contentHash: "8".repeat(64),
    contentMd5: "YWFhYWFhYWFhYWFhYWFhYQ==",
    sizeBytes: 4096,
    mediaType: "application/zip",
  };
  let storedObjectKey;
  let downloadNotAfter;
  f.context.artifactStore = {
    async createUploadGrant(input) {
      storedObjectKey = input.objectKey;
      return {
        method: "PUT",
        url: "https://storage.googleapis.com/test/signed",
        headers: {},
        expiresAt: new Date(NOW + 60_000).toISOString(),
      };
    },
    async inspectObject(objectKey) {
      assert.equal(objectKey, storedObjectKey);
      return {
        sizeBytes: descriptor.sizeBytes,
        contentMd5: descriptor.contentMd5,
        contentHash: descriptor.contentHash,
        artifactId: descriptor.id,
        mediaType: descriptor.mediaType,
        generation: "7",
      };
    },
    async createDownloadGrant(input) {
      assert.equal(input.generation, "7");
      downloadNotAfter = input.notAfter;
      return {
        url: "https://storage.googleapis.com/test/read",
        expiresAt: new Date(NOW + 60_000).toISOString(),
      };
    },
  };
  const reservation = await fleet.reserveArtifact(
      identity(),
      {...credential, artifact: descriptor},
      f.context,
  );
  assert.equal(reservation.artifact.state, "uploading");
  assert.match(storedObjectKey, /^fleet\/v1\/[a-f0-9]{32}\//);
  assert.equal(storedObjectKey.includes(OWNER), false);
  const ownerEntry = [...f.db.docs.entries()]
      .find(([key]) => key.startsWith("fleetOwners/"));
  assert.equal(ownerEntry[1].fleetArtifactCount, 1);
  assert.equal(ownerEntry[1].fleetArtifactBytes, descriptor.sizeBytes);
  const firstUploadExpiry = protocol.toMillis(
      f.db.docs.get(`fleetArtifacts/${descriptor.id}`).uploadExpiresAt,
  );
  f.setTime(NOW + 1_000);
  await fleet.reserveArtifact(
      identity(),
      {...credential, artifact: descriptor},
      f.context,
  );
  assert.equal(
      protocol.toMillis(
          f.db.docs.get(`fleetArtifacts/${descriptor.id}`).uploadExpiresAt,
      ) > firstUploadExpiry,
      true,
  );

  const committed = await fleet.commitArtifact(
      identity(),
      {...credential, artifactId: descriptor.id},
      f.context,
  );
  assert.equal(committed.state, "ready");
  assert.equal(committed.generation, "7");
  assert.ok(committed.expiresAt);
  assert.equal(
      f.db.docs.get(`fleetArtifacts/${descriptor.id}`).objectKey,
      storedObjectKey,
  );
  assert.deepEqual(
      f.db.docs.get(`fleetJobs/${created.id}`).artifactIds,
      [descriptor.id],
  );
  const replayedCommit = await fleet.commitArtifact(
      identity(),
      {...credential, artifactId: descriptor.id},
      f.context,
  );
  assert.equal(replayedCommit.state, "ready");
  assert.deepEqual(
      f.db.docs.get(`fleetJobs/${created.id}`).artifactIds,
      [descriptor.id],
  );
  const budgetedJob = f.db.docs.get(`fleetJobs/${created.id}`);
  f.db.docs.set(`fleetJobs/${created.id}`, {
    ...budgetedJob,
    artifactReservationAttempt: budgetedJob.attempt,
    artifactReservationCount: 16,
    artifactBytesReserved: 0,
  });
  await assert.rejects(
      () => fleet.reserveArtifact(
          identity(),
          {
            ...credential,
            artifact: {
              ...descriptor,
              id: `artifact_${"7".repeat(32)}`,
            },
          },
          f.context,
      ),
      {code: "resource_exhausted", status: 429},
  );
  f.db.docs.set(`fleetJobs/${created.id}`, {
    ...budgetedJob,
    artifactReservationAttempt: budgetedJob.attempt,
    artifactReservationCount: 1,
    artifactBytesReserved: descriptor.sizeBytes,
  });
  f.db.docs.set(ownerEntry[0], {
    ...ownerEntry[1],
    fleetArtifactCount: 256,
  });
  await assert.rejects(
      () => fleet.reserveArtifact(
          identity(),
          {
            ...credential,
            artifact: {
              ...descriptor,
              id: `artifact_${"6".repeat(32)}`,
            },
          },
          f.context,
      ),
      (error) =>
        error?.code === "resource_exhausted" &&
        /storage quota/.test(error.message),
  );
  const download = await fleet.createArtifactDownload(
      OWNER,
      {artifactId: descriptor.id},
      f.context,
  );
  assert.equal(download.artifact.state, "ready");
  assert.equal(download.download.url, "https://storage.googleapis.com/test/read");
  assert.equal(downloadNotAfter, Date.parse(committed.expiresAt));
  await assert.rejects(
      () => fleet.createArtifactDownload(
          OTHER_OWNER,
          {artifactId: descriptor.id},
          f.context,
      ),
      {code: "not_found", status: 404},
  );
  const committedRow = f.db.docs.get(`fleetArtifacts/${descriptor.id}`);
  f.db.docs.set(`fleetArtifacts/${descriptor.id}`, {
    ...committedRow,
    expiresAt: null,
  });
  await assert.rejects(
      () => fleet.createArtifactDownload(
          OWNER,
          {artifactId: descriptor.id},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  f.db.docs.set(`fleetArtifacts/${descriptor.id}`, committedRow);
  f.setTime(Date.parse(committed.expiresAt) - 5 * 60_000 + 1);
  await assert.rejects(
      () => fleet.createArtifactDownload(
          OWNER,
          {artifactId: descriptor.id},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  f.setTime(Date.parse(committed.expiresAt) + 1);
  await assert.rejects(
      () => fleet.createArtifactDownload(
          OWNER,
          {artifactId: descriptor.id},
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
});

test("revoking a grant fences an uploaded artifact before commit", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const credential = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credential, state: "preparing"},
      f.context,
  );
  const descriptor = {
    id: `artifact_${"7".repeat(32)}`,
    kind: "xcresult",
    contentHash: "6".repeat(64),
    contentMd5: "YWFhYWFhYWFhYWFhYWFhYQ==",
    sizeBytes: 12,
    mediaType: "application/zip",
  };
  f.context.artifactStore = {
    async createUploadGrant() {
      return {
        method: "PUT",
        url: "https://storage.googleapis.com/test/signed",
        headers: {},
        expiresAt: new Date(NOW + 60_000).toISOString(),
      };
    },
    async inspectObject() {
      return {
        sizeBytes: descriptor.sizeBytes,
        contentMd5: descriptor.contentMd5,
        contentHash: descriptor.contentHash,
        artifactId: descriptor.id,
        mediaType: descriptor.mediaType,
        generation: "9",
      };
    },
  };
  await fleet.reserveArtifact(
      identity(),
      {...credential, artifact: descriptor},
      f.context,
  );
  await fleet.revokeGrant(OWNER, {grantId: GRANT}, f.context);
  await assert.rejects(
      () => fleet.commitArtifact(
          identity(),
          {...credential, artifactId: descriptor.id},
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  assert.equal(
      f.db.docs.get(`fleetArtifacts/${descriptor.id}`).state,
      "uploading",
  );
});

test("the artifact sweeper fences and removes expired incomplete uploads", async () => {
  const f = fixture();
  const removedId = `artifact_${"4".repeat(32)}`;
  const retryId = `artifact_${"5".repeat(32)}`;
  const graceId = `artifact_${"6".repeat(32)}`;
  const staleId = `artifact_${"7".repeat(32)}`;
  const retainedId = `artifact_${"8".repeat(32)}`;
  const legacyReadyId = `artifact_${"a".repeat(32)}`;
  const retainedJobId = `job_${"9".repeat(32)}`;
  for (const [artifactId, objectKey] of [
    [removedId, "fleet/v1/remove"],
    [retryId, "fleet/v1/retry"],
  ]) {
    f.db.docs.set(`fleetArtifacts/${artifactId}`, {
      state: "uploading",
      objectKey,
      uploadExpiresAt: new Date(NOW - 2 * 60_000 - 1),
    });
  }
  f.db.docs.set(`fleetArtifacts/${graceId}`, {
    state: "uploading",
    objectKey: "fleet/v1/grace",
    uploadExpiresAt: new Date(NOW - 1),
  });
  f.db.docs.set(`fleetArtifacts/${staleId}`, {
    state: "deleting",
    objectKey: "fleet/v1/stale",
    cleanupStartedAt: new Date(NOW - 5 * 60_000 - 1),
    cleanupPreviousState: "uploading",
  });
  f.db.docs.set(`fleetArtifacts/${retainedId}`, {
    state: "ready",
    objectKey: "fleet/v1/retained",
    jobId: retainedJobId,
    ownerUid: OWNER,
    sizeBytes: 7,
    quotaAccounted: true,
    expiresAt: new Date(NOW - 1),
  });
  f.db.docs.set(`fleetArtifacts/${legacyReadyId}`, {
    state: "ready",
    objectKey: "fleet/v1/legacy-ready",
  });
  f.db.docs.set(`fleetJobs/${retainedJobId}`, {
    artifactIds: [retainedId],
    updatedAt: new Date(NOW - 1_000),
  });
  const retainedOwnerPath =
    `fleetOwners/${createHash("sha256").update(OWNER).digest("hex")}`;
  f.db.docs.set(retainedOwnerPath, {
    ownerUid: OWNER,
    fleetArtifactCount: 1,
    fleetArtifactBytes: 7,
  });
  f.context.artifactStore = {
    async deleteObject(objectKey) {
      if (objectKey.endsWith("/retry")) throw new Error("storage unavailable");
    },
  };

  const result = await fleet.sweepExpiredArtifactUploads(
      f.context,
      {limit: 10},
  );
  assert.deepEqual(result, {
    configured: true,
    scanned: 5,
    deleted: 4,
    skipped: 0,
    failed: 1,
    hasMore: false,
  });
  assert.equal(f.db.docs.has(`fleetArtifacts/${removedId}`), false);
  assert.equal(
      f.db.docs.get(`fleetArtifacts/${retryId}`).state,
      "deleting",
  );
  assert.equal(f.db.docs.has(`fleetArtifacts/${staleId}`), false);
  assert.equal(f.db.docs.has(`fleetArtifacts/${retainedId}`), false);
  assert.equal(f.db.docs.has(`fleetArtifacts/${legacyReadyId}`), false);
  assert.deepEqual(
      f.db.docs.get(`fleetJobs/${retainedJobId}`).artifactIds,
      [],
  );
  assert.equal(f.db.docs.get(retainedOwnerPath).fleetArtifactCount, 0);
  assert.equal(f.db.docs.get(retainedOwnerPath).fleetArtifactBytes, 0);
  assert.equal(
      f.db.docs.get(`fleetArtifacts/${graceId}`).state,
      "uploading",
  );
});

test("an artifact claim failure does not block later cleanup candidates", async () => {
  const f = fixture();
  const failedId = `artifact_${"b".repeat(32)}`;
  const removedId = `artifact_${"c".repeat(32)}`;
  f.db.docs.set(`fleetArtifacts/${failedId}`, {
    state: "uploading",
    objectKey: "fleet/v1/claim-failure",
    uploadExpiresAt: new Date(NOW - 3 * 60_000),
  });
  f.db.docs.set(`fleetArtifacts/${removedId}`, {
    state: "uploading",
    objectKey: "fleet/v1/remove-after-failure",
    uploadExpiresAt: new Date(NOW - 2 * 60_000 - 1),
  });
  f.context.artifactStore = {
    async deleteObject() {},
  };
  const runTransaction = f.db.runTransaction.bind(f.db);
  let failNextTransaction = true;
  f.db.runTransaction = async (operation) => {
    if (failNextTransaction) {
      failNextTransaction = false;
      throw new Error("transaction unavailable");
    }
    return runTransaction(operation);
  };

  const result = await fleet.sweepExpiredArtifactUploads(
      f.context,
      {limit: 10},
  );
  assert.equal(result.scanned, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.deleted, 1);
  assert.equal(f.db.docs.has(`fleetArtifacts/${failedId}`), true);
  assert.equal(f.db.docs.has(`fleetArtifacts/${removedId}`), false);
});

test("artifact retention backfill reaches ready manifests with a missing field", async () => {
  const f = fixture();
  const retainedId = `artifact_${"1".repeat(32)}`;
  const legacyId = `artifact_${"f".repeat(32)}`;
  f.db.docs.set(`fleetArtifacts/${retainedId}`, {
    state: "ready",
    objectKey: "fleet/v1/retained",
    expiresAt: new Date(NOW + 60_000),
  });
  f.db.docs.set(`fleetArtifacts/${legacyId}`, {
    state: "ready",
    objectKey: "fleet/v1/legacy-missing-expiration",
  });
  f.context.artifactStore = {
    async deleteObject() {},
  };

  const first = await fleet.sweepExpiredArtifactUploads(
      f.context,
      {limit: 1},
  );
  assert.equal(first.scanned, 0);
  assert.equal(first.hasMore, true);
  const second = await fleet.sweepExpiredArtifactUploads(
      f.context,
      {limit: 1},
  );
  assert.equal(second.deleted, 1);
  assert.equal(f.db.docs.has(`fleetArtifacts/${legacyId}`), false);
  const third = await fleet.sweepExpiredArtifactUploads(
      f.context,
      {limit: 1},
  );
  assert.equal(third.hasMore, false);
  assert.equal(f.db.docs.has(`fleetArtifacts/${retainedId}`), true);
  assert.ok(
      f.db.docs.get("fleetMaintenance/artifactRetentionBackfill").completedAt,
  );
});

test("events are sequenced, idempotent, lease-bound, and secret rejecting", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const request = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
    event: {
      sequence: 1,
      type: "test",
      payload: {suite: "StatsKeyTests", passed: 42, failed: 0},
    },
  };
  assert.deepEqual(
      await fleet.appendJobEvent(identity(), request, f.context),
      {accepted: true, duplicate: false, sequence: 1},
  );
  assert.deepEqual(
      await fleet.appendJobEvent(identity(), request, f.context),
      {accepted: true, duplicate: true, sequence: 1},
  );
  await fleet.appendJobEvent(
      identity(),
      {
        ...request,
        event: {
          sequence: 2,
          type: "checkpoint",
          payload: {completed: 21, total: 42},
        },
      },
      f.context,
  );
  const listed = await fleet.listJobEvents(
      OWNER,
      {jobId: created.id, afterSequence: 1, limit: 10},
      f.context,
  );
  assert.deepEqual(listed.events, [{
    schemaVersion: 1,
    jobId: created.id,
    deviceId: MAC,
    attempt: 1,
    sequence: 2,
    type: "checkpoint",
    payload: {completed: 21, total: 42},
    occurredAt: "2026-08-19T05:00:00.000Z",
  }]);
  await assert.rejects(
      () => fleet.listJobEvents(
          OTHER_OWNER,
          {jobId: created.id},
          f.context,
      ),
      {code: "not_found", status: 404},
  );
  await assert.rejects(
      () => fleet.appendJobEvent(
          identity(),
          {
            ...request,
            event: {
              sequence: 1,
              type: "test",
              payload: {suite: "different"},
            },
          },
          f.context,
      ),
      {code: "conflict", status: 409},
  );
  await assert.rejects(
      () => fleet.appendJobEvent(
          identity(),
          {
            ...request,
            event: {
              sequence: 3,
              type: "log",
              payload: {line: `Bearer ${"z".repeat(40)}`},
            },
          },
          f.context,
      ),
      {code: "invalid_argument"},
  );
});

test("revoked grants block new output but still allow terminal cleanup", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  await fleet.revokeGrant(OWNER, {grantId: GRANT}, f.context);
  await assert.rejects(
      () => fleet.appendJobEvent(
          identity(),
          {
            jobId: created.id,
            leaseId: lease.id,
            nonce: lease.nonce,
            event: {sequence: 1, type: "checkpoint", payload: {phase: "late"}},
          },
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            jobId: created.id,
            leaseId: lease.id,
            nonce: lease.nonce,
            state: "preparing",
          },
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  assert.equal(
      (await fleet.transitionJob(
          identity(),
          {
            jobId: created.id,
            leaseId: lease.id,
            nonce: lease.nonce,
            state: "cancelled",
          },
          f.context,
      )).state,
      "cancelled",
  );
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
});

test("terminal transitions release the worker and exclusive resources", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const credentials = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credentials, state: "preparing"},
      f.context,
  );
  await fleet.transitionJob(
      identity(),
      {...credentials, state: "running"},
      f.context,
  );
  const complete = await fleet.transitionJob(
      identity(),
      {...credentials, state: "succeeded"},
      f.context,
  );
  assert.equal(complete.state, "succeeded");
  assert.equal(complete.finishedAt, "2026-08-19T05:00:00.000Z");
  assert.equal(f.db.docs.get(`fleetDevices/${MAC}`).activeJobs, 0);
  assert.ok(f.db.docs.get(`fleetLeases/${lease.id}`).releasedAt);
  const resourceId = fleet._test.resourceLeaseId(
      OWNER,
      "xcode:simulator-lane-1",
  );
  assert.ok(
      f.db.docs.get(`fleetResourceLeases/${resourceId}`).releasedAt,
  );
  await assert.rejects(
      () => fleet.renewLease(
          identity(),
          {leaseId: lease.id, nonce: lease.nonce},
          f.context,
      ),
      {code: "permission_denied"},
  );
});

test("a cancellation request prevents new running work", async () => {
  const f = fixture();
  await prepareFleet(f);
  const created = await fleet.createJob(OWNER, jobPayload(), f.context);
  const {lease} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  f.setTime(NOW + 10_000);
  await fleet.cancelJob(OWNER, {jobId: created.id}, f.context);
  const renewal = await fleet.renewLease(
      identity(),
      {leaseId: lease.id, nonce: lease.nonce},
      f.context,
  );
  assert.equal(renewal.cancellationRequested, true);
  assert.equal(renewal.expiresAt, lease.expiresAt);
  await assert.rejects(
      () => fleet.appendJobEvent(
          identity(),
          {
            jobId: created.id,
            leaseId: lease.id,
            nonce: lease.nonce,
            event: {sequence: 1, type: "result", payload: {status: "late"}},
          },
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            jobId: created.id,
            leaseId: lease.id,
            nonce: lease.nonce,
            state: "preparing",
          },
          f.context,
      ),
      {code: "failed_precondition", status: 409},
  );
  const cancelled = await fleet.transitionJob(
      identity(),
      {
        jobId: created.id,
        leaseId: lease.id,
        nonce: lease.nonce,
        state: "cancelled",
      },
      f.context,
  );
  assert.equal(cancelled.state, "cancelled");
});

test("a fresh Linux attestation derives capabilities and admits execution", async () => {
  const f = fixture();
  await prepareLinuxFleet(f);
  const deviceRow = f.db.docs.get(`fleetDevices/${MAC}`);
  assert.deepEqual(deviceRow.capabilities, LINUX_ATTESTED_CAPABILITIES);
  assert.deepEqual(deviceRow.executables, []);

  const created = await fleet.createJob(OWNER, linuxJobPayload(), f.context);
  const poll = await fleet.pollJobs(identity(), {}, f.context);
  assert.equal(poll.assignment.jobId, created.id);
  assert.equal(poll.assignment.grantId, GRANT);

  const claim = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const ticket = claim.executionTicket;
  assert.ok(ticket);
  const verified = helperProtocol.verifyExecutionTicket(
      ticket,
      f.coordinatorPublicKeySpki,
  );
  assert.equal(verified.ticketId, ticket.ticketId);
  assert.match(ticket.ticketId, /^ticket_[a-f0-9]{32}$/);
  assert.equal(ticket.domain, "statskey.fleet.execution-ticket.v1");
  assert.equal(ticket.jobId, created.id);
  assert.equal(ticket.attempt, 1);
  assert.equal(ticket.leaseId, claim.lease.id);
  assert.equal(ticket.leaseSequence, 0);
  const storedJob = f.db.docs.get(`fleetJobs/${created.id}`);
  const storedGrant = f.db.docs.get(`fleetGrants/${GRANT}`);
  assert.equal(ticket.jobRequestDigest, `sha256:${storedJob.requestDigest}`);
  assert.equal(ticket.grantReceiptDigest, `sha256:${storedGrant.receiptDigest}`);
  assert.equal(ticket.ownerUid, OWNER);
  assert.equal(ticket.workerDeviceId, MAC);
  assert.equal(ticket.controllerDeviceId, CONTROLLER);
  assert.equal(ticket.executionServiceId, LINUX_SERVICE_ID);
  assert.equal(ticket.helperInstanceId, LINUX_HELPER_INSTANCE_ID);
  assert.equal(ticket.repositoryIdentity, "github.com/statskey/website");
  assert.equal(ticket.commit, COMMIT);
  assert.equal(ticket.executorProfileId, "command-v1");
  assert.equal(ticket.sandboxProfileId, "ubuntu-build-v1");
  assert.equal(ticket.networkProfileId, "none");
  assert.deepEqual(ticket.command, {
    executable: "node",
    arguments: ["--version"],
    workingDirectory: ".",
  });
  assert.deepEqual(ticket.resources, {
    cpuMilli: 4_000,
    memoryBytes: 8 * 1024 ** 3,
    pids: 256,
    diskBytes: 20 * 1024 ** 3,
    wallTimeMs: 60_000,
  });
  assert.equal(ticket.serverIssuedAt, "2026-08-19T05:00:00.000Z");
  assert.equal(ticket.leaseExpiresAt, claim.lease.expiresAt);
  assert.equal(ticket.jobDeadlineAt, "2026-08-19T07:00:00.000Z");
  assert.equal(ticket.minimumHelperProtocol, 1);
  assert.equal(ticket.minimumPolicyEpoch, 1);
  const storedLease = f.db.docs.get(`fleetLeases/${claim.lease.id}`);
  assert.equal(storedLease.ticketId, ticket.ticketId);
  assert.equal(storedLease.helperInstanceId, LINUX_HELPER_INSTANCE_ID);
  assert.equal(storedLease.leaseSequence, 0);

  const replay = await fleet.leaseJob(
      OWNER,
      {
        jobId: created.id,
        deviceId: MAC,
        grantId: GRANT,
        leaseId: claim.lease.id,
        leaseNonce: claim.lease.nonce,
      },
      f.context,
  );
  assert.equal(replay.executionTicket.ticketId, ticket.ticketId);
  assert.equal(replay.executionTicket.leaseId, ticket.leaseId);
  assert.equal(replay.executionTicket.attempt, 1);
});

test("Linux eligibility fails closed on policy-blocked attestations", async () => {
  for (const [label, grantOverrides] of [
    ["epoch", {minimumPolicyEpoch: 2}],
    ["protocol", {minimumHelperProtocol: 2}],
    ["service", {executionServiceId: `svc_${"e".repeat(32)}`}],
    ["executor", {executorProfileIds: ["other-v1"]}],
    ["sandbox", {sandboxProfileIds: ["other-v1"]}],
    ["network", {networkProfileIds: ["egress-v1"]}],
  ]) {
    const f = fixture();
    await prepareLinuxFleet(f, {grantOverrides});
    const created = await fleet.createJob(
        OWNER,
        linuxJobPayload({idempotencyKey: `fleet-test:linux-policy:${label}`}),
        f.context,
    );
    assert.equal(
        (await fleet.pollJobs(identity(), {}, f.context)).assignment,
        null,
        label,
    );
    await assert.rejects(
        () => fleet.leaseJob(
            OWNER,
            {jobId: created.id, deviceId: MAC, grantId: GRANT},
            f.context,
        ),
        (error) => {
          assert.equal(error.code, "failed_precondition", label);
          assert.equal(error.status, 409, label);
          assert.match(error.message, /execution-attestation-policy/, label);
          return true;
        },
    );
    assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).attempt, 0, label);
  }
});

test("xcode jobs are never issued Linux execution tickets", async () => {
  const f = fixture();
  await prepareLinuxFleet(f);
  const created = await fleet.createJob(
      OWNER,
      jobPayload({idempotencyKey: "fleet-test:linux-xcode"}),
      f.context,
  );
  assert.equal((await fleet.pollJobs(identity(), {}, f.context)).assignment, null);
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: created.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      (error) => {
        assert.equal(error.code, "permission_denied");
        assert.equal(error.status, 403);
        return true;
      },
  );
  assert.equal(f.db.docs.get(`fleetJobs/${created.id}`).attempt, 0);

  const commandJob = await fleet.createJob(
      OWNER,
      linuxJobPayload({idempotencyKey: "fleet-test:linux-ticket-kind-guard"}),
      f.context,
  );
  const stored = f.db.docs.get(`fleetJobs/${commandJob.id}`);
  f.db.docs.set(`fleetJobs/${commandJob.id}`, {
    ...stored,
    execution: {...stored.execution, kind: "xcode"},
  });
  await assert.rejects(
      () => fleet.leaseJob(
          OWNER,
          {jobId: commandJob.id, deviceId: MAC, grantId: GRANT},
          f.context,
      ),
      (error) => {
        assert.equal(error.code, "failed_precondition");
        assert.match(error.message, /require a command job/);
        return true;
      },
  );
  assert.equal(f.db.docs.get(`fleetJobs/${commandJob.id}`).state, "queued");
  assert.equal(f.db.docs.get(`fleetJobs/${commandJob.id}`).attempt, 0);
});

test("Linux lease renewals return signed lease updates with increasing sequences", async () => {
  const f = fixture();
  await prepareLinuxFleet(f);
  const created = await fleet.createJob(OWNER, linuxJobPayload(), f.context);
  const {lease, executionTicket} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT, ttlMs: 30_000},
      f.context,
  );
  f.setTime(NOW + 10_000);
  const first = await fleet.renewLease(
      identity(),
      {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
      f.context,
  );
  assert.ok(first.leaseUpdate);
  const firstUpdate = helperProtocol.verifyLeaseUpdate(
      first.leaseUpdate,
      f.coordinatorPublicKeySpki,
  );
  assert.equal(firstUpdate.leaseSequence, 1);
  assert.equal(firstUpdate.ticketId, executionTicket.ticketId);
  assert.equal(firstUpdate.jobId, created.id);
  assert.equal(firstUpdate.leaseId, lease.id);
  assert.equal(firstUpdate.attempt, 1);
  assert.equal(firstUpdate.helperInstanceId, LINUX_HELPER_INSTANCE_ID);
  assert.equal(firstUpdate.cancelled, false);
  assert.equal(firstUpdate.leaseExpiresAt, first.expiresAt);
  assert.equal(firstUpdate.serverIssuedAt, "2026-08-19T05:00:10.000Z");

  f.setTime(NOW + 20_000);
  const second = await fleet.renewLease(
      identity(),
      {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
      f.context,
  );
  assert.equal(second.leaseUpdate.leaseSequence, 2);
  assert.equal(f.db.docs.get(`fleetLeases/${lease.id}`).leaseSequence, 2);

  const stale = f.db.docs.get(`fleetLeases/${lease.id}`);
  f.db.docs.set(`fleetLeases/${lease.id}`, {...stale, leaseSequence: "legacy"});
  f.setTime(NOW + 30_000);
  const recovered = await fleet.renewLease(
      identity(),
      {leaseId: lease.id, nonce: lease.nonce, ttlMs: 60_000},
      f.context,
  );
  assert.equal(recovered.leaseUpdate.leaseSequence, 1);
  helperProtocol.verifyLeaseUpdate(
      recovered.leaseUpdate,
      f.coordinatorPublicKeySpki,
  );

  await fleet.cancelJob(OWNER, {jobId: created.id}, f.context);
  f.setTime(NOW + 40_000);
  const cancelled = await fleet.renewLease(
      identity(),
      {leaseId: lease.id, nonce: lease.nonce},
      f.context,
  );
  assert.equal(cancelled.cancellationRequested, true);
  const cancelUpdate = helperProtocol.verifyLeaseUpdate(
      cancelled.leaseUpdate,
      f.coordinatorPublicKeySpki,
  );
  assert.equal(cancelUpdate.cancelled, true);
  assert.equal(cancelUpdate.leaseSequence, 2);
  assert.equal(cancelUpdate.leaseExpiresAt, cancelled.expiresAt);
});

test("Linux retries require a valid helper termination receipt", async () => {
  const f = fixture();
  await prepareLinuxFleet(f);
  f.db.docs.set(`fleetHelperBindings/${MAC}`, linuxBindingDoc());
  const created = await fleet.createJob(OWNER, linuxJobPayload(), f.context);
  const {lease, executionTicket} = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  const credential = {
    jobId: created.id,
    leaseId: lease.id,
    nonce: lease.nonce,
  };
  await fleet.transitionJob(
      identity(),
      {...credential, state: "preparing"},
      f.context,
  );
  const retryPayload = {
    ...credential,
    state: "queued",
    retry: {
      code: "snapshot_materialization_failed",
      terminationConfirmed: true,
    },
  };
  await assert.rejects(
      () => fleet.transitionJob(identity(), retryPayload, f.context),
      (error) => {
        assert.equal(error.code, "failed_precondition");
        assert.equal(error.status, 409);
        assert.match(error.message, /termination receipt/);
        return true;
      },
  );
  const receiptFields = {
    ticketId: executionTicket.ticketId,
    jobId: created.id,
    attempt: 1,
    leaseId: lease.id,
    helperInstanceId: LINUX_HELPER_INSTANCE_ID,
    highestLeaseSequence: 0,
    unitName: `statskey-fleet-job-${executionTicket.ticketId}.service`,
  };
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            ...retryPayload,
            retry: {
              ...retryPayload.retry,
              terminationReceipt: terminationReceipt(
                  receiptFields,
                  OTHER_HELPER_KEY_PAIR.privateKey,
              ),
            },
          },
          f.context,
      ),
      {code: "invalid_termination_signature", status: 403},
  );
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            ...retryPayload,
            retry: {
              ...retryPayload.retry,
              terminationReceipt: terminationReceipt({
                ...receiptFields,
                jobId: `job_${"f".repeat(32)}`,
              }),
            },
          },
          f.context,
      ),
      {code: "permission_denied", status: 403},
  );
  await assert.rejects(
      () => fleet.transitionJob(
          identity(),
          {
            ...retryPayload,
            retry: {
              ...retryPayload.retry,
              terminationReceipt: terminationReceipt({
                ...receiptFields,
                populated: true,
              }),
            },
          },
          f.context,
      ),
      {code: "invalid_argument", status: 400},
  );
  const retried = await fleet.transitionJob(
      identity(),
      {
        ...retryPayload,
        retry: {
          ...retryPayload.retry,
          terminationReceipt: terminationReceipt(receiptFields),
        },
      },
      f.context,
  );
  assert.equal(retried.state, "queued");
  assert.equal(
      f.db.docs.get(`fleetJobs/${created.id}`).lastFailure.terminationConfirmed,
      true,
  );

  const second = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  assert.equal(second.executionTicket.attempt, 2);
  assert.notEqual(second.executionTicket.ticketId, executionTicket.ticketId);
});

test("grant v2 fields validate and clamp Linux ticket resources", async () => {
  const rejected = fixture();
  await fleet.enrollDevice(OWNER, enrollment(CONTROLLER), rejected.context);
  await fleet.enrollDevice(OWNER, enrollment(MAC), rejected.context);
  for (const [label, overrides] of [
    ["service id", {executionServiceId: "not-a-service"}],
    ["executor profiles", {executorProfileIds: ["bad profile"]}],
    ["sandbox profiles", {sandboxProfileIds: ["UPPER"]}],
    ["network profiles", {networkProfileIds: ["-none"]}],
    ["cpu ceiling", {resourceCeilings: {cpuMilli: 0}}],
    ["pid ceiling", {resourceCeilings: {pids: 2 ** 30}}],
    ["unknown ceiling", {resourceCeilings: {gpuCount: 1}}],
    ["helper protocol", {minimumHelperProtocol: 0}],
    ["policy epoch", {minimumPolicyEpoch: 1.5}],
  ]) {
    await assert.rejects(
        () => fleet.createGrant(
            OWNER,
            grantPayload({id: `grant_${"0".repeat(32)}`, ...overrides}),
            rejected.context,
        ),
        {code: "invalid_argument", status: 400},
        label,
    );
  }

  const f = fixture();
  await prepareLinuxFleet(f, {
    grantOverrides: {
      executionServiceId: LINUX_SERVICE_ID,
      executorProfileIds: ["command-v1"],
      sandboxProfileIds: ["ubuntu-build-v1"],
      networkProfileIds: ["none"],
      resourceCeilings: {
        cpuMilli: 2_000,
        memoryBytes: 4 * 1024 ** 3,
        pids: 64,
      },
      minimumHelperProtocol: 1,
      minimumPolicyEpoch: 1,
    },
  });
  const granted = await fleet.listGrants(OWNER, {limit: 10}, f.context);
  assert.equal(granted.grants[0].executionServiceId, LINUX_SERVICE_ID);
  assert.deepEqual(granted.grants[0].resourceCeilings, {
    cpuMilli: 2_000,
    memoryBytes: 4 * 1024 ** 3,
    pids: 64,
  });
  const created = await fleet.createJob(OWNER, linuxJobPayload(), f.context);
  const claim = await fleet.leaseJob(
      OWNER,
      {jobId: created.id, deviceId: MAC, grantId: GRANT},
      f.context,
  );
  assert.deepEqual(claim.executionTicket.resources, {
    cpuMilli: 2_000,
    memoryBytes: 4 * 1024 ** 3,
    pids: 64,
    diskBytes: 20 * 1024 ** 3,
    wallTimeMs: 60_000,
  });
  helperProtocol.verifyExecutionTicket(
      claim.executionTicket,
      f.coordinatorPublicKeySpki,
  );
});
