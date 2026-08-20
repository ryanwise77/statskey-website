const test = require("node:test");
const assert = require("node:assert/strict");
const {generateKeyPairSync} = require("node:crypto");
const fleetRemoteSession = require("./fleetRemoteSession");
const fleetAuth = require("./fleetAuth");
const {FakeDb} = require("./testHelpers");

const NOW = Date.parse("2026-08-19T05:00:00.000Z");
const OWNER = "owner-123";
const OTHER_OWNER = "owner-456";
const CONTROLLER = `dev_${"1".repeat(32)}`;
const WORKER = `dev_${"2".repeat(32)}`;
const SESSION_ID = `rs_${"a".repeat(32)}`;
const RELAY = "relay.statskey.test:7447";

function ephemeralKey() {
  const pair = generateKeyPairSync("ed25519");
  return fleetAuth.exportPublicKeySpki(pair.publicKey);
}

const CONTROLLER_EPHEMERAL = ephemeralKey();
const WORKER_EPHEMERAL = ephemeralKey();

function fixture({relayEndpoint = RELAY} = {}) {
  const db = new FakeDb();
  let at = NOW;
  let randomByte = 7;
  const context = {
    db,
    remoteRelayEndpoint: relayEndpoint,
    now: () => new Date(at),
    randomBytes: (size) => {
      const value = Buffer.alloc(size, randomByte);
      randomByte += 1;
      return value;
    },
  };
  seedDevices(db);
  return {
    db,
    context,
    setTime(value) {
      at = value;
    },
  };
}

function seedDevices(db) {
  db.docs.set(`fleetDevices/${CONTROLLER}`, {
    schemaVersion: 1,
    id: CONTROLLER,
    ownerUid: OWNER,
    label: "Laptop",
    role: "controller",
    workerMode: "disabled",
    platform: "darwin",
    status: "active",
  });
  db.docs.set(`fleetDevices/${WORKER}`, {
    schemaVersion: 1,
    id: WORKER,
    ownerUid: OWNER,
    label: "Windows workstation",
    role: "worker",
    workerMode: "dedicated",
    platform: "win32",
    status: "active",
  });
}

function seedGrant(db, overrides = {}) {
  const grantId = `grant_${"b".repeat(32)}`;
  db.docs.set(`fleetGrants/${grantId}`, {
    schemaVersion: 1,
    ownerUid: OWNER,
    receipt: {
      id: grantId,
      controllerDeviceId: CONTROLLER,
      workerDeviceId: WORKER,
      workspaceIds: ["*"],
      repositoryIdentities: [],
      capabilities: ["screen.view", "screen.input"],
      unattended: true,
      policyVersion: 1,
      issuedAt: new Date(NOW - 60_000),
      expiresAt: new Date(NOW + 60 * 60_000),
    },
    revokedAt: null,
    ...overrides,
  });
  return grantId;
}

function requestPayload(overrides = {}) {
  return {
    controllerDeviceId: CONTROLLER,
    workerDeviceId: WORKER,
    capabilities: ["screen.view", "screen.input"],
    transport: "relay",
    controllerEphemeralKey: CONTROLLER_EPHEMERAL,
    ...overrides,
  };
}

async function requestSession(f, overrides = {}) {
  return fleetRemoteSession.requestRemoteSession(
      OWNER,
      requestPayload(overrides),
      f.context,
  );
}

// ---------------------------------------------------------------------------
// fleetRemoteSessionRequest
// ---------------------------------------------------------------------------

test("request creates a session with ephemeral key material and relay endpoint", async () => {
  const f = fixture();
  const session = await requestSession(f);
  assert.match(session.sessionId, /^rs_[a-f0-9]{32}$/);
  assert.equal(session.state, "requested");
  assert.equal(session.controllerDeviceId, CONTROLLER);
  assert.equal(session.workerDeviceId, WORKER);
  assert.deepEqual(session.capabilities, ["screen.view", "screen.input"]);
  assert.equal(session.transport, "relay");
  assert.equal(session.protocol, "statskey.screen.v1");
  assert.equal(session.controllerEphemeralKey, CONTROLLER_EPHEMERAL);
  assert.equal(session.workerEphemeralKey, null);
  assert.equal(typeof session.sessionKey, "string");
  assert.match(session.sessionKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(session.relayEndpoint, RELAY);
  assert.equal(Date.parse(session.expiresAt), NOW + 10 * 60_000);
  const stored = f.db.docs.get(`fleetRemoteSessions/${session.sessionId}`);
  assert.equal(stored.ownerUid, OWNER);
  assert.equal(stored.state, "requested");
});

test("request fails closed when the relay is not configured", async () => {
  const f = fixture({relayEndpoint: ""});
  await assert.rejects(requestSession(f), (error) => {
    assert.equal(error.code, "failed_precondition");
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal([...f.db.docs.keys()].filter((k) => k.startsWith("fleetRemoteSessions/")).length, 0);
});

test("request rejects bad capabilities, transport, and devices", async () => {
  const f = fixture();
  await assert.rejects(requestSession(f, {capabilities: []}), /non-empty/);
  await assert.rejects(
      requestSession(f, {capabilities: ["screen.view", "terminal.run"]}),
      /limited to/,
  );
  await assert.rejects(
      requestSession(f, {capabilities: ["screen.input"]}),
      /always include screen.view/,
  );
  await assert.rejects(
      requestSession(f, {capabilities: ["screen.view", "screen.view"]}),
      /limited to/,
  );
  await assert.rejects(
      requestSession(f, {transport: "direct"}),
      (error) => error.code === "failed_precondition" && error.status === 412,
  );
  await assert.rejects(
      requestSession(f, {controllerEphemeralKey: "not-a-key"}),
      /ephemeral key/,
  );
  await assert.rejects(
      requestSession(f, {workerDeviceId: `dev_${"9".repeat(32)}`}),
      (error) => error.code === "not_found",
  );
});

test("request requires an active controller and worker of the same owner", async () => {
  const f = fixture();
  f.db.docs.get(`fleetDevices/${WORKER}`).status = "revoked";
  await assert.rejects(requestSession(f), /not active/);
  f.db.docs.get(`fleetDevices/${WORKER}`).status = "active";
  f.db.docs.get(`fleetDevices/${CONTROLLER}`).role = "worker";
  await assert.rejects(requestSession(f), /not a Fleet controller/);
});

test("request limits screen.input to Windows hosts in v1", async () => {
  const f = fixture();
  f.db.docs.get(`fleetDevices/${WORKER}`).platform = "darwin";
  await assert.rejects(
      requestSession(f),
      (error) => error.code === "failed_precondition" && error.status === 412,
  );
  const viewOnly = await requestSession(f, {capabilities: ["screen.view"]});
  assert.equal(viewOnly.state, "requested");
});

// ---------------------------------------------------------------------------
// Account approve / end / list
// ---------------------------------------------------------------------------

test("owner approve moves requested sessions to approved", async () => {
  const f = fixture();
  const session = await requestSession(f);
  const approved = await fleetRemoteSession.approveRemoteSession(
      OWNER,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(approved.state, "approved");
  assert.equal(approved.sessionKey, session.sessionKey);
  // Idempotent replay.
  const replay = await fleetRemoteSession.approveRemoteSession(
      OWNER,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(replay.state, "approved");
});

test("approve and end reject other owners", async () => {
  const f = fixture();
  const session = await requestSession(f);
  await assert.rejects(
      fleetRemoteSession.approveRemoteSession(
          OTHER_OWNER,
          {sessionId: session.sessionId},
          f.context,
      ),
      (error) => error.code === "not_found" && error.status === 404,
  );
  await assert.rejects(
      fleetRemoteSession.endRemoteSession(
          OTHER_OWNER,
          {sessionId: session.sessionId},
          f.context,
      ),
      (error) => error.code === "not_found",
  );
  const stored = f.db.docs.get(`fleetRemoteSessions/${session.sessionId}`);
  assert.equal(stored.state, "requested");
});

test("end terminates live sessions and is idempotent on terminal ones", async () => {
  const f = fixture();
  const session = await requestSession(f);
  const ended = await fleetRemoteSession.endRemoteSession(
      OWNER,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(ended.state, "ended");
  assert.ok(ended.endedAt);
  const again = await fleetRemoteSession.endRemoteSession(
      OWNER,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(again.state, "ended");
});

test("expiry folds into state for approve, end, and list", async () => {
  const f = fixture();
  const session = await requestSession(f);
  f.setTime(NOW + 11 * 60_000);
  await assert.rejects(
      fleetRemoteSession.approveRemoteSession(
          OWNER,
          {sessionId: session.sessionId},
          f.context,
      ),
      (error) => error.code === "failed_precondition" && /expired/.test(error.message),
  );
  const ended = await fleetRemoteSession.endRemoteSession(
      OWNER,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(ended.state, "expired");
  const list = await fleetRemoteSession.listRemoteSessions(OWNER, {}, f.context);
  assert.equal(list.sessions[0].state, "expired");
  assert.equal(list.sessions[0].sessionKey, undefined);
});

test("list is owner-scoped and carries key material only for live sessions", async () => {
  const f = fixture();
  const first = await requestSession(f);
  await fleetRemoteSession.approveRemoteSession(
      OWNER,
      {sessionId: first.sessionId},
      f.context,
  );
  const second = await requestSession(f);
  await fleetRemoteSession.endRemoteSession(
      OWNER,
      {sessionId: second.sessionId},
      f.context,
  );
  const list = await fleetRemoteSession.listRemoteSessions(OWNER, {}, f.context);
  assert.equal(list.sessions.length, 2);
  const byId = new Map(list.sessions.map((s) => [s.sessionId, s]));
  assert.equal(byId.get(first.sessionId).state, "approved");
  assert.equal(byId.get(first.sessionId).sessionKey, first.sessionKey);
  assert.equal(byId.get(second.sessionId).state, "ended");
  assert.equal(byId.get(second.sessionId).sessionKey, undefined);
  const other = await fleetRemoteSession.listRemoteSessions(OTHER_OWNER, {}, f.context);
  assert.equal(other.sessions.length, 0);
});

// ---------------------------------------------------------------------------
// Device-signed actions
// ---------------------------------------------------------------------------

const WORKER_IDENTITY = {ownerUid: OWNER, deviceId: WORKER};

test("device poll lists requested sessions without key material", async () => {
  const f = fixture();
  const session = await requestSession(f);
  const result = await fleetRemoteSession.pollRemoteSessions(
      WORKER_IDENTITY,
      {},
      f.context,
  );
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, session.sessionId);
  assert.equal(result.sessions[0].state, "requested");
  assert.equal(result.sessions[0].sessionKey, undefined);
  assert.equal(result.sessions[0].relayEndpoint, undefined);
});

test("device poll releases key material only after approval", async () => {
  const f = fixture();
  const session = await requestSession(f);
  await fleetRemoteSession.approveRemoteSession(
      OWNER,
      {sessionId: session.sessionId},
      f.context,
  );
  const result = await fleetRemoteSession.pollRemoteSessions(
      WORKER_IDENTITY,
      {},
      f.context,
  );
  assert.equal(result.sessions[0].state, "approved");
  assert.equal(result.sessions[0].sessionKey, session.sessionKey);
  assert.equal(result.sessions[0].relayEndpoint, RELAY);
});

test("device poll expires stale sessions and hides terminal ones", async () => {
  const f = fixture();
  const session = await requestSession(f);
  f.setTime(NOW + 11 * 60_000);
  const result = await fleetRemoteSession.pollRemoteSessions(
      WORKER_IDENTITY,
      {},
      f.context,
  );
  assert.equal(result.sessions.length, 0);
  assert.equal(
      f.db.docs.get(`fleetRemoteSessions/${session.sessionId}`).state,
      "expired",
  );
});

test("device approve stays pending without a grant", async () => {
  const f = fixture();
  const session = await requestSession(f);
  const result = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  assert.equal(result.approved, false);
  assert.equal(result.pending, true);
  assert.equal(result.session.state, "requested");
  assert.equal(result.session.sessionKey, undefined);
  assert.equal(
      f.db.docs.get(`fleetRemoteSessions/${session.sessionId}`).state,
      "requested",
  );
});

test("device approve requires the grant to cover the capabilities", async () => {
  const f = fixture();
  seedGrant(f.db, {
    receipt: {
      id: `grant_${"c".repeat(32)}`,
      controllerDeviceId: CONTROLLER,
      workerDeviceId: WORKER,
      workspaceIds: ["*"],
      repositoryIdentities: [],
      capabilities: ["screen.view"],
      unattended: true,
      policyVersion: 1,
      issuedAt: new Date(NOW - 60_000),
      expiresAt: new Date(NOW + 60 * 60_000),
    },
  });
  const session = await requestSession(f); // screen.view + screen.input
  const result = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  assert.equal(result.approved, false);
  assert.equal(result.pending, true);
});

test("device approve succeeds with an active covering grant", async () => {
  const f = fixture();
  seedGrant(f.db);
  const session = await requestSession(f);
  const result = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  assert.equal(result.approved, true);
  assert.equal(result.pending, false);
  assert.equal(result.session.state, "approved");
  assert.equal(result.session.workerEphemeralKey, WORKER_EPHEMERAL);
  assert.equal(result.session.sessionKey, session.sessionKey);
  assert.match(result.session.approvalReceiptDigest, /^[a-f0-9]{64}$/);
  // Idempotent replay with the same ephemeral key.
  const replay = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  assert.equal(replay.approved, true);
});

test("device approve rejects revoked and expired grants", async () => {
  const f = fixture();
  seedGrant(f.db, {revokedAt: new Date(NOW - 30_000)});
  const session = await requestSession(f);
  const revoked = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  assert.equal(revoked.approved, false);

  const f2 = fixture();
  seedGrant(f2.db, {
    receipt: {
      id: `grant_${"d".repeat(32)}`,
      controllerDeviceId: CONTROLLER,
      workerDeviceId: WORKER,
      workspaceIds: ["*"],
      repositoryIdentities: [],
      capabilities: ["screen.view", "screen.input"],
      unattended: true,
      policyVersion: 1,
      issuedAt: new Date(NOW - 2 * 60 * 60_000),
      expiresAt: new Date(NOW - 60_000),
    },
  });
  const session2 = await requestSession(f2);
  const expired = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session2.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f2.context,
  );
  assert.equal(expired.approved, false);
});

test("device approve rejects a revoked issuing controller", async () => {
  const f = fixture();
  seedGrant(f.db);
  const session = await requestSession(f);
  f.db.docs.get(`fleetDevices/${CONTROLLER}`).status = "revoked";
  const result = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  assert.equal(result.approved, false);
  assert.equal(result.pending, true);
});

test("device approve is isolated to the session worker and owner", async () => {
  const f = fixture();
  seedGrant(f.db);
  const session = await requestSession(f);
  await assert.rejects(
      fleetRemoteSession.approveRemoteSessionDevice(
          {ownerUid: OWNER, deviceId: CONTROLLER},
          {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
          f.context,
      ),
      (error) => error.code === "not_found",
  );
  await assert.rejects(
      fleetRemoteSession.approveRemoteSessionDevice(
          {ownerUid: OTHER_OWNER, deviceId: WORKER},
          {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
          f.context,
      ),
      (error) => error.code === "not_found",
  );
});

test("owner-approved sessions let the worker attach its ephemeral without a grant", async () => {
  const f = fixture();
  const session = await requestSession(f);
  await fleetRemoteSession.approveRemoteSession(
      OWNER,
      {sessionId: session.sessionId},
      f.context,
  );
  const attached = await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  assert.equal(attached.approved, true);
  assert.equal(attached.session.workerEphemeralKey, WORKER_EPHEMERAL);
  assert.equal(attached.session.sessionKey, session.sessionKey);
  assert.match(attached.session.approvalReceiptDigest, /^[a-f0-9]{64}$/);
});

test("device activate moves approved sessions to active", async () => {
  const f = fixture();
  seedGrant(f.db);
  const session = await requestSession(f);
  await assert.rejects(
      fleetRemoteSession.activateRemoteSessionDevice(
          WORKER_IDENTITY,
          {sessionId: session.sessionId},
          f.context,
      ),
      /cannot become active/,
  );
  await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  const active = await fleetRemoteSession.activateRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(active.state, "active");
  assert.ok(active.startedAt);
  assert.equal(active.sessionKey, session.sessionKey);
  const replay = await fleetRemoteSession.activateRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(replay.state, "active");
});

test("device end terminates the session", async () => {
  const f = fixture();
  seedGrant(f.db);
  const session = await requestSession(f);
  await fleetRemoteSession.approveRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId, workerEphemeralKey: WORKER_EPHEMERAL},
      f.context,
  );
  const ended = await fleetRemoteSession.endRemoteSessionDevice(
      WORKER_IDENTITY,
      {sessionId: session.sessionId},
      f.context,
  );
  assert.equal(ended.state, "ended");
  const poll = await fleetRemoteSession.pollRemoteSessions(
      WORKER_IDENTITY,
      {},
      f.context,
  );
  assert.equal(poll.sessions.length, 0);
});

test("device actions reject malformed payloads", async () => {
  const f = fixture();
  await assert.rejects(
      fleetRemoteSession.pollRemoteSessions(WORKER_IDENTITY, {extra: true}, f.context),
      /empty/,
  );
  await assert.rejects(
      fleetRemoteSession.approveRemoteSessionDevice(
          WORKER_IDENTITY,
          {sessionId: "nope", workerEphemeralKey: WORKER_EPHEMERAL},
          f.context,
      ),
      /Invalid remote session id/,
  );
  await assert.rejects(
      fleetRemoteSession.approveRemoteSessionDevice(
          WORKER_IDENTITY,
          {sessionId: SESSION_ID, workerEphemeralKey: "bad"},
          f.context,
      ),
      /ephemeral key/,
  );
});
