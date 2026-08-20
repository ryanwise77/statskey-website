const test = require("node:test");
const assert = require("node:assert/strict");
const {generateKeyPairSync} = require("node:crypto");
const server = require("./fleetAuth");
const desktop = require("../../desktop/fleet-auth-runtime.cjs");

const NOW = Date.parse("2026-08-19T06:00:00.000Z");
const PAYLOAD = {
  resources: {cpuAvailable: 8, memoryAvailableBytes: 16 * 1024 ** 3},
  capabilities: ["workspace.read", "xcode.test"],
};

function keys() {
  return generateKeyPairSync("ed25519");
}

test("desktop and service canonicalize and identify Ed25519 keys identically", () => {
  const {publicKey} = keys();
  const spki = server.exportPublicKeySpki(publicKey);
  assert.equal(spki, desktop.exportPublicKeySpki(publicKey));
  assert.deepEqual(
      server.deviceIdentityForPublicKey(spki),
      desktop.deviceIdentityForPublicKey(spki),
  );
  assert.equal(
      server.canonicalJson({z: [3, {b: true, a: null}], a: "value"}),
      desktop.canonicalJson({a: "value", z: [3, {a: null, b: true}]}),
  );
});

test("desktop-signed requests verify on the service without a bearer secret", () => {
  const {publicKey, privateKey} = keys();
  const publicKeySpki = server.exportPublicKeySpki(publicKey);
  const {deviceId} = server.deviceIdentityForPublicKey(publicKeySpki);
  const envelope = desktop.createSignedDeviceRequest({
    privateKey,
    deviceId,
    action: "heartbeat",
    payload: PAYLOAD,
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
    requestId: `req_${"1".repeat(32)}`,
  });
  const verified = server.verifySignedDeviceRequest({
    publicKeySpki,
    envelope,
    payload: PAYLOAD,
    expectedAction: "heartbeat",
    now: NOW + 1_000,
  });

  assert.equal(verified.deviceId, deviceId);
  assert.match(verified.publicKeyFingerprint, /^sha256:[A-Za-z0-9_-]{43}$/);
  assert.match(verified.replayId, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(envelope).includes("PRIVATE"), false);
  assert.equal(envelope.privateKey, undefined);
});

test("service-signed requests verify in the desktop runtime", () => {
  const {publicKey, privateKey} = keys();
  const publicKeySpki = desktop.exportPublicKeySpki(publicKey);
  const {deviceId} = desktop.deviceIdentityForPublicKey(publicKeySpki);
  const envelope = server.createSignedDeviceRequest({
    privateKey,
    deviceId,
    action: "job.event",
    payload: {jobId: `job_${"a".repeat(32)}`, sequence: 1},
    issuedAt: NOW,
    expiresAt: NOW + 30_000,
    requestId: `req_${"2".repeat(32)}`,
  });
  assert.equal(
      desktop.verifySignedDeviceRequest({
        publicKeySpki,
        envelope,
        payload: {sequence: 1, jobId: `job_${"a".repeat(32)}`},
        expectedAction: "job.event",
        now: NOW,
      }).requestId,
      envelope.requestId,
  );
});

test("service responses are signed and verified across runtimes", () => {
  const coordinator = keys();
  const device = keys();
  const coordinatorPublicKeySpki = server.exportPublicKeySpki(
      coordinator.publicKey,
  );
  const {deviceId} = server.deviceIdentityForPublicKey(
      server.exportPublicKeySpki(device.publicKey),
  );
  const result = {
    leaseId: `lease_${"a".repeat(32)}`,
    expiresAt: "2026-08-19T06:01:00.000Z",
  };
  const envelope = server.createSignedDeviceResponse({
    privateKey: coordinator.privateKey,
    keyId: "workbench-2026-01",
    deviceId,
    requestId: `req_${"4".repeat(32)}`,
    action: "lease.renew",
    result,
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
  });
  assert.equal(
      desktop.verifySignedDeviceResponse({
        publicKeySpki: coordinatorPublicKeySpki,
        envelope,
        deviceId,
        requestId: `req_${"4".repeat(32)}`,
        action: "lease.renew",
        result,
        keyId: "workbench-2026-01",
        now: NOW + 1_000,
      }).requestId,
      `req_${"4".repeat(32)}`,
  );
  assert.throws(
      () => desktop.verifySignedDeviceResponse({
        publicKeySpki: coordinatorPublicKeySpki,
        envelope,
        deviceId,
        requestId: `req_${"4".repeat(32)}`,
        action: "lease.renew",
        result: {...result, leaseId: `lease_${"b".repeat(32)}`},
        keyId: "workbench-2026-01",
        now: NOW + 1_000,
      }),
      {code: "response_mismatch"},
  );
});

test("tampering, action substitution, expiry, and key substitution fail closed", () => {
  const first = keys();
  const second = keys();
  const publicKeySpki = server.exportPublicKeySpki(first.publicKey);
  const {deviceId} = server.deviceIdentityForPublicKey(publicKeySpki);
  const envelope = server.createSignedDeviceRequest({
    privateKey: first.privateKey,
    deviceId,
    action: "heartbeat",
    payload: PAYLOAD,
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
    requestId: `req_${"3".repeat(32)}`,
  });

  assert.throws(
      () => server.verifySignedDeviceRequest({
        publicKeySpki,
        envelope,
        payload: {...PAYLOAD, capabilities: ["terminal.run"]},
        expectedAction: "heartbeat",
        now: NOW,
      }),
      {code: "payload_mismatch"},
  );
  assert.throws(
      () => server.verifySignedDeviceRequest({
        publicKeySpki,
        envelope,
        payload: PAYLOAD,
        expectedAction: "job.event",
        now: NOW,
      }),
      {code: "action_mismatch"},
  );
  assert.throws(
      () => server.verifySignedDeviceRequest({
        publicKeySpki,
        envelope,
        payload: PAYLOAD,
        expectedAction: "heartbeat",
        now: NOW + 60_000,
      }),
      {code: "expired_request"},
  );
  assert.throws(
      () => server.verifySignedDeviceRequest({
        publicKeySpki: server.exportPublicKeySpki(second.publicKey),
        envelope,
        payload: PAYLOAD,
        expectedAction: "heartbeat",
        now: NOW,
      }),
      {code: "device_mismatch"},
  );
});

test("canonical payloads reject ambiguous or unbounded values", () => {
  assert.throws(
      () => server.canonicalJson({value: undefined}),
      {code: "invalid_payload"},
  );
  assert.throws(
      () => server.canonicalJson({value: Number.POSITIVE_INFINITY}),
      {code: "invalid_payload"},
  );
  assert.throws(
      () => server.canonicalJson({value: new Date()}),
      {code: "invalid_payload"},
  );
  const {privateKey, publicKey} = keys();
  const publicKeySpki = server.exportPublicKeySpki(publicKey);
  const {deviceId} = server.deviceIdentityForPublicKey(publicKeySpki);
  assert.throws(
      () => server.createSignedDeviceRequest({
        privateKey,
        deviceId,
        action: "heartbeat",
        payload: {},
        issuedAt: NOW,
        expiresAt: NOW + server.MAX_LIFETIME_MS + 1,
      }),
      {code: "invalid_envelope"},
  );
});
