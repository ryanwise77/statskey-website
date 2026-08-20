const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const {
  FLEET_AUTH_VERSION,
  canonicalJson,
  createSignedDeviceRequest,
  deviceIdentityForPublicKey,
  exportPublicKeySpki,
  verifySignedDeviceRequest,
} = require('./fleet-auth-runtime.cjs')

const NOW = Date.parse('2026-08-19T06:00:00.000Z')

test('Fleet request signatures are short-lived, payload-bound, and asymmetric', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeySpki = exportPublicKeySpki(publicKey)
  const identity = deviceIdentityForPublicKey(publicKeySpki)
  const payload = { capabilities: ['workspace.read'], activeJobs: 0 }
  const envelope = createSignedDeviceRequest({
    privateKey,
    deviceId: identity.deviceId,
    action: 'heartbeat',
    payload,
    issuedAt: NOW,
    expiresAt: NOW + 45_000,
    requestId: `req_${'a'.repeat(32)}`,
  })

  assert.equal(envelope.protocolVersion, FLEET_AUTH_VERSION)
  assert.equal(
    verifySignedDeviceRequest({
      publicKeySpki,
      envelope,
      payload,
      expectedAction: 'heartbeat',
      now: NOW + 1_000,
    }).deviceId,
    identity.deviceId
  )
  assert.throws(
    () =>
      verifySignedDeviceRequest({
        publicKeySpki,
        envelope,
        payload: { ...payload, activeJobs: 1 },
        expectedAction: 'heartbeat',
        now: NOW + 1_000,
      }),
    { code: 'payload_mismatch' }
  )
  assert.throws(
    () =>
      verifySignedDeviceRequest({
        publicKeySpki,
        envelope,
        payload,
        expectedAction: 'heartbeat',
        now: NOW + 45_000,
      }),
    { code: 'expired_request' }
  )
})

test('canonical JSON is stable and rejects unsupported values', () => {
  assert.equal(
    canonicalJson({ z: [2, 1], a: { y: true, x: null } }),
    '{"a":{"x":null,"y":true},"z":[2,1]}'
  )
  assert.throws(() => canonicalJson({ missing: undefined }), {
    code: 'invalid_payload',
  })
  assert.throws(() => canonicalJson(Buffer.from('not-json')), {
    code: 'invalid_payload',
  })
})
