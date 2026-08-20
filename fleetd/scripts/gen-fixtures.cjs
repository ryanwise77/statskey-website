#!/usr/bin/env node
// Dev-time fixture generator for the Go fleetd implementation.
//
// Reads the canonical JS implementation (workbench-backend/functions/fleetAuth.js)
// and produces committed test vectors proving byte-identical canonical JSON and
// Ed25519/SPKI interop between Go and node:crypto.
//
// Usage:
//   node scripts/gen-fixtures.mjs <path-to-fleetAuth.js> <fleetd-root>
//
// Outputs:
//   internal/canon/testdata/canonical_vectors.json
//   internal/keys/testdata/key_vectors.json
//   internal/fleetclient/testdata/protocol_vectors.json

const fs = require('node:fs')
const path = require('node:path')
const {
  createPrivateKey,
  createPublicKey,
  sign,
} = require('node:crypto')

const fleetAuthPath = process.argv[2]
const fleetdRoot = process.argv[3]
if (!fleetAuthPath || !fleetdRoot) {
  console.error('usage: gen-fixtures.mjs <fleetAuth.js> <fleetd-root>')
  process.exit(2)
}
const fleetAuth = require(path.resolve(fleetAuthPath))

// ---------------------------------------------------------------------------
// Canonical JSON vectors
// ---------------------------------------------------------------------------

const canonical = []
function vec(name, value) {
  canonical.push({
    name,
    value,
    json: fleetAuth.canonicalJson(value),
    sha256: fleetAuth.digestCanonical(value),
  })
}

vec('null', null)
vec('true', true)
vec('false', false)
vec('zero', 0)
vec('int', 42)
vec('negative-int', -17)
vec('max-safe-int', 9007199254740991)
vec('min-safe-int', -9007199254740991)
vec('empty-string', '')
vec('empty-array', [])
vec('empty-object', {})
vec('simple-object', { b: 2, a: 1 })
vec('nested', { a: [1, { b: [true, null, 'x'] }], c: { d: [{}, []] } })
vec('string-escapes', 'quote" backslash\\ slash/ bs\b tab\t nl\n ff\f cr\r')
vec('control-chars', '\x00\x01\x02\x07\x0b\x0e\x1f')
vec('del-raw', 'a\x7fb')
vec('c1-raw', 'a\x80\x9fb')
vec('unicode-bmp', 'é中文')
vec('unicode-non-bmp', 'emoji 😀🚀 end')
vec('utf16-sort-order', {
  A: 1,
  z: 2,
  á: 3,
  '': 4,
  '\u{10000}': 5,
  '': 6,
  aa: 7,
})
vec('key-escapes', { 'a"b': 1, 'c\\d': 2, '\n': 3 })
vec('array-of-ints', [0, 1, -1, 123456789, 8589934592, 21474836480])
vec('ticket-like', {
  domain: 'statskey.fleet.execution-ticket.v1',
  ticketId: 'ticket_0123456789abcdef0123456789abcdef',
  attempt: 1,
  leaseSequence: 0,
  command: { executable: 'node', arguments: ['--version'], workingDirectory: '.' },
  resources: {
    cpuMilli: 4000,
    memoryBytes: 8589934592,
    pids: 256,
    diskBytes: 21474836480,
    wallTimeMs: 3600000,
  },
})
// Depth exactly at the JS limit (root depth 0, values allowed through depth 12).
{
  let deep = 'leaf'
  for (let i = 0; i < 12; i++) deep = [deep]
  vec('depth-12-ok', deep)
}
// Exactly 512 items is allowed.
vec('items-512-ok', Array.from({ length: 512 }, (_, i) => i))

fs.writeFileSync(
  path.join(fleetdRoot, 'internal/canon/testdata/canonical_vectors.json'),
  JSON.stringify({ canonical }, null, 2) + '\n'
)

// ---------------------------------------------------------------------------
// Key / signature vectors
// ---------------------------------------------------------------------------

function keyFromSeed(seedHex) {
  const seed = Buffer.from(seedHex, 'hex')
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ])
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey(privateKey)
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' })
  return { privateKey, publicKey, spkiDer }
}

const seeds = [
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  'fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0',
]

const keys = seeds.map((seedHex) => {
  const { spkiDer } = keyFromSeed(seedHex)
  const spkiBase64url = spkiDer.toString('base64url')
  const identity = fleetAuth.deviceIdentityForPublicKey(spkiBase64url)
  return {
    seedHex,
    publicKeySpki: spkiBase64url,
    spkiDerHex: spkiDer.toString('hex'),
    keyId: identity.publicKeyFingerprint,
    deviceId: identity.deviceId,
  }
})

const messages = [
  {
    name: 'canonical-envelope',
    messageBase64url: Buffer.from(
      fleetAuth.canonicalJson({
        action: 'job.poll',
        deviceId: keys[0].deviceId,
        requestId: 'req_0123456789abcdef0123456789abcdef',
        protocolVersion: 1,
        issuedAt: 1780000000000,
        expiresAt: 1780000060000,
        payloadDigest: fleetAuth.digestCanonical({ maxJobs: 1 }),
      }),
      'utf8'
    ).toString('base64url'),
  },
  {
    name: 'binary-message',
    messageBase64url: Buffer.from(
      Array.from({ length: 256 }, (_, i) => i)
    ).toString('base64url'),
  },
]

const signatures = []
for (const key of keys) {
  const { privateKey } = keyFromSeed(key.seedHex)
  for (const msg of messages) {
    const message = Buffer.from(msg.messageBase64url, 'base64url')
    const sig = sign(null, message, privateKey)
    signatures.push({
      seedHex: key.seedHex,
      messageName: msg.name,
      messageBase64url: msg.messageBase64url,
      signatureBase64url: sig.toString('base64url'),
    })
  }
}

// Negative interop: a P-256 SPKI must be rejected by Ed25519-only parsing.
// Fixed value (a throwaway P-256 key's SPKI) so fixtures are reproducible;
// it is only ever used as a must-reject input.
const ecSpkiBase64url =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEh8ywI5Y26MlNcjdqgqIRoVX-SkARR-J04N8S96-hbQ3oO_i5rpTbn1OVPp5MKjICnFjYRi4UXG4YEcFsM1LrFw'

fs.writeFileSync(
  path.join(fleetdRoot, 'internal/keys/testdata/key_vectors.json'),
  JSON.stringify({ keys, signatures, ecSpkiBase64url }, null, 2) + '\n'
)

// ---------------------------------------------------------------------------
// Device protocol vectors (fleet-node-client.cjs transport shape)
// ---------------------------------------------------------------------------

const device = keyFromSeed(seeds[0])
const coordinator = keyFromSeed(seeds[1])
const deviceIdentity = fleetAuth.deviceIdentityForPublicKey(
  device.spkiDer.toString('base64url')
)
const coordinatorIdentity = fleetAuth.deviceIdentityForPublicKey(
  coordinator.spkiDer.toString('base64url')
)

const requestId = 'req_0123456789abcdef0123456789abcdef'
const issuedAt = 1780000000000
const expiresAt = 1780000060000
const pollPayload = { maxJobs: 1, capabilities: { linuxExecution: true } }

const requestEnvelope = fleetAuth.createSignedDeviceRequest({
  privateKey: device.privateKey,
  deviceId: deviceIdentity.deviceId,
  action: 'job.poll',
  payload: pollPayload,
  issuedAt,
  expiresAt,
  requestId,
})

const result = {
  jobs: [],
  serverTime: 1780000001000,
  attestation: { accepted: true, expiresAt: '2026-08-19T22:00:00.000Z' },
}
const responseEnvelope = fleetAuth.createSignedDeviceResponse({
  privateKey: coordinator.privateKey,
  keyId: 'coord-1',
  deviceId: deviceIdentity.deviceId,
  requestId,
  action: 'job.poll',
  result,
  issuedAt: issuedAt + 500,
  expiresAt: expiresAt + 500,
})

fs.writeFileSync(
  path.join(fleetdRoot, 'internal/fleetclient/testdata/protocol_vectors.json'),
  JSON.stringify(
    {
      deviceSeedHex: seeds[0],
      coordinatorSeedHex: seeds[1],
      deviceId: deviceIdentity.deviceId,
      coordinatorKeyId: 'coord-1',
      coordinatorPublicKeySpki: coordinator.spkiDer.toString('base64url'),
      request: {
        action: 'job.poll',
        payload: pollPayload,
        issuedAt,
        expiresAt,
        requestId,
        envelope: requestEnvelope,
      },
      response: {
        result,
        envelope: responseEnvelope,
      },
    },
    null,
    2
  ) + '\n'
)

console.log('fixtures written')
