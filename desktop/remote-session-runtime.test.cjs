'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { generateKeyPairSync, randomBytes } = require('node:crypto')
const {
  FRAME_INPUT,
  FRAME_SESSION_CONTROL,
  FRAME_VIDEO,
  MAX_FRAME_BYTES,
  SESSION_ID_PATTERN,
  connectRelaySession,
  createInputHelperClient,
  createInputRateLimiter,
  createRemoteHello,
  createRemoteSessionHostRuntime,
  createRemoteSessionMachine,
  createWireFrameParser,
  decodeStreamHeader,
  decryptFramePayload,
  encodeStreamHeader,
  encodeWireFrame,
  encryptFramePayload,
  generateEphemeralKeyPair,
  normalizeRelayEndpoint,
  normalizeRemoteInputEvent,
  sessionKeyHash,
} = require('./remote-session-runtime.cjs')
const {
  canonicalJson,
  deviceIdentityForPublicKey,
  exportPublicKeySpki,
} = require('./fleet-auth-runtime.cjs')

const SESSION_ID = 'rs_0123456789abcdef0123456789abcdef'
const SESSION_KEY = randomBytes(32)
const NOW = Date.parse('2026-08-19T05:00:00.000Z')

function identity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeySpki = exportPublicKeySpki(publicKey)
  return { privateKey, publicKeySpki, ...deviceIdentityForPublicKey(publicKeySpki) }
}

// ---------------------------------------------------------------------------
// Frame encryption
// ---------------------------------------------------------------------------

test('session frames encrypt and decrypt round-trip', () => {
  const payload = Buffer.from('jpeg-bytes')
  const body = encryptFramePayload({
    sessionKey: SESSION_KEY,
    sessionId: SESSION_ID,
    type: FRAME_VIDEO,
    payload,
  })
  const decrypted = decryptFramePayload({
    sessionKey: SESSION_KEY,
    sessionId: SESSION_ID,
    type: FRAME_VIDEO,
    body,
  })
  assert.deepEqual(decrypted, payload)
})

test('session frames reject the wrong key, session, type, and tampering', () => {
  const body = encryptFramePayload({
    sessionKey: SESSION_KEY,
    sessionId: SESSION_ID,
    type: FRAME_VIDEO,
    payload: Buffer.from('frame'),
  })
  assert.throws(
    () =>
      decryptFramePayload({
        sessionKey: randomBytes(32),
        sessionId: SESSION_ID,
        type: FRAME_VIDEO,
        body,
      }),
    /failed to decrypt/
  )
  assert.throws(
    () =>
      decryptFramePayload({
        sessionKey: SESSION_KEY,
        sessionId: 'rs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        type: FRAME_VIDEO,
        body,
      }),
    /failed to decrypt/
  )
  assert.throws(
    () =>
      decryptFramePayload({
        sessionKey: SESSION_KEY,
        sessionId: SESSION_ID,
        type: FRAME_INPUT,
        body,
      }),
    /failed to decrypt/
  )
  const tampered = Buffer.from(body)
  tampered[tampered.length - 1] ^= 0x01
  assert.throws(
    () =>
      decryptFramePayload({
        sessionKey: SESSION_KEY,
        sessionId: SESSION_ID,
        type: FRAME_VIDEO,
        body: tampered,
      }),
    /failed to decrypt/
  )
  assert.throws(
    () =>
      decryptFramePayload({
        sessionKey: SESSION_KEY,
        sessionId: SESSION_ID,
        type: FRAME_VIDEO,
        body: Buffer.alloc(10),
      }),
    /malformed/
  )
})

test('session key hash matches the relay contract', () => {
  assert.match(sessionKeyHash(SESSION_KEY), /^sha256:[A-Za-z0-9_-]{43}$/)
  assert.equal(sessionKeyHash(SESSION_KEY), sessionKeyHash(Buffer.from(SESSION_KEY)))
  assert.throws(() => sessionKeyHash(randomBytes(16)), /32 bytes/)
})

// ---------------------------------------------------------------------------
// Wire framing
// ---------------------------------------------------------------------------

test('wire frames round-trip through the incremental parser', () => {
  const frames = []
  const parser = createWireFrameParser({
    onFrame: (type, payload) => frames.push({ type, payload }),
    onError: (error) => {
      throw error
    },
  })
  const first = encodeWireFrame(FRAME_VIDEO, Buffer.from('one'))
  const second = encodeWireFrame(FRAME_INPUT, Buffer.from('two'))
  // Split across chunk boundaries.
  const whole = Buffer.concat([first, second])
  parser.feed(whole.subarray(0, 3))
  parser.feed(whole.subarray(3, 9))
  parser.feed(whole.subarray(9))
  assert.equal(frames.length, 2)
  assert.equal(frames[0].type, FRAME_VIDEO)
  assert.equal(frames[0].payload.toString(), 'one')
  assert.equal(frames[1].type, FRAME_INPUT)
  assert.equal(frames[1].payload.toString(), 'two')
})

test('wire frame parser rejects oversize frames', () => {
  let failure = null
  const parser = createWireFrameParser({
    onFrame: () => {},
    onError: (error) => {
      failure = error
    },
  })
  const header = Buffer.alloc(4)
  header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0)
  parser.feed(header)
  assert.equal(failure?.code, 'bad_frame')
})

// ---------------------------------------------------------------------------
// Hello construction
// ---------------------------------------------------------------------------

test('remote hello binds session, role, keys, and expiry', () => {
  const device = identity()
  const ephemeral = generateEphemeralKeyPair()
  const hello = createRemoteHello({
    privateKey: device.privateKey,
    publicKeySpki: device.publicKeySpki,
    ephemeralPublicKey: ephemeral.publicKeySpki,
    sessionId: SESSION_ID,
    role: 'host',
    sessionKey: SESSION_KEY,
    issuedAt: NOW,
    expiresAt: NOW + 5 * 60_000,
  })
  assert.equal(hello.domain, 'statskey.fleet.remote-hello.v1')
  assert.equal(hello.deviceId, device.deviceId)
  assert.equal(hello.role, 'host')
  assert.equal(hello.sessionKeyHash, sessionKeyHash(SESSION_KEY))
  assert.equal(hello.issuedAt, '2026-08-19T05:00:00.000Z')
  assert.match(hello.signature, /^[A-Za-z0-9_-]{86,88}$/)
  // The signed bytes must be canonical JSON (sorted keys, no whitespace).
  const unsigned = { ...hello }
  delete unsigned.signature
  const encoded = canonicalJson(unsigned)
  assert.equal(encoded, JSON.stringify(JSON.parse(encoded)))
  assert.deepEqual(
    Object.keys(JSON.parse(encoded)),
    Object.keys(JSON.parse(encoded)).sort()
  )
})

test('remote hello rejects bad roles, sessions, and lifetimes', () => {
  const device = identity()
  const ephemeral = generateEphemeralKeyPair()
  const base = {
    privateKey: device.privateKey,
    publicKeySpki: device.publicKeySpki,
    ephemeralPublicKey: ephemeral.publicKeySpki,
    sessionId: SESSION_ID,
    role: 'host',
    sessionKey: SESSION_KEY,
    issuedAt: NOW,
    expiresAt: NOW + 5 * 60_000,
  }
  assert.throws(() => createRemoteHello({ ...base, role: 'peer' }), /role/)
  assert.throws(
    () => createRemoteHello({ ...base, sessionId: 'nope' }),
    /session id/
  )
  assert.throws(
    () => createRemoteHello({ ...base, expiresAt: NOW + 11 * 60_000 }),
    /ten minutes/
  )
  assert.throws(
    () => createRemoteHello({ ...base, sessionKey: randomBytes(8) }),
    /32 bytes/
  )
})

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const BOUNDS = { width: 1920, height: 1080 }

test('input validation accepts bounded mouse and key events', () => {
  assert.deepEqual(normalizeRemoteInputEvent(
    { type: 'mousemove', x: 10, y: 20 },
    BOUNDS
  ), { type: 'mousemove', x: 10, y: 20 })
  assert.deepEqual(normalizeRemoteInputEvent(
    { type: 'mousedown', x: 0, y: 1079, button: 'right' },
    BOUNDS
  ), { type: 'mousedown', x: 0, y: 1079, button: 'right' })
  assert.deepEqual(normalizeRemoteInputEvent(
    { type: 'wheel', x: 5, y: 5, deltaY: -240 },
    BOUNDS
  ), { type: 'wheel', x: 5, y: 5, deltaY: -240 })
  assert.deepEqual(normalizeRemoteInputEvent(
    { type: 'keydown', key: 'KeyA' },
    BOUNDS
  ), { type: 'keydown', key: 'KeyA' })
  assert.deepEqual(normalizeRemoteInputEvent(
    { type: 'keyup', key: 'ShiftLeft' },
    BOUNDS
  ), { type: 'keyup', key: 'ShiftLeft' })
})

test('input validation rejects bad events', () => {
  const bad = [
    null,
    'mousemove',
    { type: 'teleport', x: 1, y: 1 },
    { type: 'mousemove', x: -1, y: 0 },
    { type: 'mousemove', x: 0, y: 1080 },
    { type: 'mousemove', x: 1.5, y: 2 },
    { type: 'mousemove', x: 0, y: 0, extra: true }, // extra fields dropped, not rejected
    { type: 'mousedown', x: 0, y: 0, button: 'primary' },
    { type: 'wheel', x: 0, y: 0, deltaY: 0 },
    { type: 'wheel', x: 0, y: 0, deltaY: 5000 },
    { type: 'keydown', key: 'Sleep' },
    { type: 'keydown', key: 'KeyA", "x": 1' },
    { type: 'keyup' },
  ]
  for (const event of bad) {
    if (event && event.extra === true) continue // handled below
    assert.throws(
      () => normalizeRemoteInputEvent(event, BOUNDS),
      /remote input/i,
      JSON.stringify(event)
    )
  }
  // Extra fields are stripped, never forwarded.
  assert.deepEqual(
    normalizeRemoteInputEvent({ type: 'mousemove', x: 1, y: 2, extra: true }, BOUNDS),
    { type: 'mousemove', x: 1, y: 2 }
  )
})

test('input validation enforces the current screen bounds', () => {
  assert.throws(
    () => normalizeRemoteInputEvent({ type: 'mousemove', x: 800, y: 600 }, { width: 640, height: 480 }),
    /out of range/
  )
  assert.throws(
    () => normalizeRemoteInputEvent({ type: 'mousemove', x: 0, y: 0 }, { width: 0, height: 0 }),
    /bounds/
  )
})

test('input rate limiter caps the event rate', () => {
  let at = NOW
  const limiter = createInputRateLimiter({ maxPerSecond: 10, burst: 20, now: () => at })
  for (let i = 0; i < 20; i += 1) assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), false)
  at += 500 // half a second refills 5 tokens
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), false)
  at += 60_000
  assert.equal(limiter.allow(), true)
})

// ---------------------------------------------------------------------------
// Session state machine
// ---------------------------------------------------------------------------

test('session state machine follows requested → approved → active → ended', () => {
  let at = NOW
  const machine = createRemoteSessionMachine({
    sessionId: SESSION_ID,
    expiresAt: NOW + 10 * 60_000,
    now: () => at,
  })
  assert.equal(machine.getState(), 'requested')
  assert.throws(() => machine.activate(), /cannot become active/)
  assert.equal(machine.approve(), 'approved')
  assert.throws(() => machine.approve(), /cannot become approved/)
  assert.equal(machine.activate(), 'active')
  assert.equal(machine.end(), 'ended')
  assert.equal(machine.end(), 'ended') // idempotent
  assert.throws(() => machine.activate(), /cannot become active/)
})

test('session state machine expires before expiry-bound transitions', () => {
  let at = NOW
  const machine = createRemoteSessionMachine({
    sessionId: SESSION_ID,
    expiresAt: NOW + 60_000,
    now: () => at,
  })
  at = NOW + 61_000
  assert.equal(machine.getState(), 'expired')
  assert.throws(() => machine.approve(), /cannot become approved/)
  assert.equal(machine.end(), 'expired') // expired stays expired
  assert.equal(machine.isTerminal(), true)
})

test('session state machine validates its identifiers', () => {
  assert.throws(
    () => createRemoteSessionMachine({ sessionId: 'bad', expiresAt: NOW + 1 }),
    /session id/
  )
  assert.throws(
    () => createRemoteSessionMachine({ sessionId: SESSION_ID, expiresAt: -1 }),
    /expiry/
  )
})

// ---------------------------------------------------------------------------
// Input helper pipe client (mocked pipe)
// ---------------------------------------------------------------------------

// linePipe emulates statskey-inputd: one JSON command per line, one ack per
// line, lines over 4 KiB close the connection.
function linePipe() {
  // A minimal full-duplex double: writes from the client feed the helper
  // logic; helper acks flow back through the 'data' listener.
  const listeners = { data: [], error: [], close: [] }
  let buffer = Buffer.alloc(0)
  const received = []
  const socket = {
    write(data, callback) {
      buffer = Buffer.concat([buffer, Buffer.from(data)])
      while (true) {
        const newline = buffer.indexOf(0x0a)
        if (newline < 0) break
        const line = buffer.subarray(0, newline)
        buffer = buffer.subarray(newline + 1)
        if (line.length > 4 * 1024) {
          for (const listener of listeners.close) listener()
          return true
        }
        received.push(JSON.parse(line.toString('utf8')))
        const ack = Buffer.from('{"ok":true}\n')
        for (const listener of listeners.data) listener(ack)
      }
      if (callback) callback()
      return true
    },
    on(event, listener) {
      listeners[event]?.push(listener)
      return this
    },
    destroy() {
      for (const listener of listeners.close) listener()
      return this
    },
  }
  return { socket, received }
}

test('input helper client sends bounded commands and reads acks', async () => {
  const { socket, received } = linePipe()
  const client = createInputHelperClient({ connect: () => socket })
  await client.send({ type: 'mousemove', x: 10, y: 20 })
  await client.send({ type: 'keydown', key: 'KeyA' })
  assert.equal(received.length, 2)
  assert.deepEqual(received[0], { type: 'mousemove', x: 10, y: 20 })
  assert.deepEqual(received[1], { type: 'keydown', key: 'KeyA' })
  client.close()
})

test('input helper client rejects oversize commands before writing', async () => {
  const { socket, received } = linePipe()
  const client = createInputHelperClient({ connect: () => socket })
  await assert.rejects(
    client.send({ type: 'mousemove', x: 1, y: 1, pad: 'a'.repeat(8192) }),
    /too large/
  )
  assert.equal(received.length, 0)
  client.close()
})

test('input helper client serializes concurrent sends', async () => {
  const { socket, received } = linePipe()
  const client = createInputHelperClient({ connect: () => socket })
  await Promise.all([
    client.send({ type: 'mousemove', x: 1, y: 1 }),
    client.send({ type: 'mousemove', x: 2, y: 2 }),
    client.send({ type: 'mousemove', x: 3, y: 3 }),
  ])
  assert.equal(received.length, 3)
  client.close()
})

// ---------------------------------------------------------------------------
// Relay client against a protocol-faithful mock relay
// ---------------------------------------------------------------------------

// mockRelay implements the relay wire contract: hello control frame, waiting
// and paired notices, opaque typed forwarding between host and viewer.
function mockRelay() {
  const sessions = new Map()
  const connections = new Set()
  const server = net.createServer((conn) => {
    connections.add(conn)
    conn.on('close', () => connections.delete(conn))
    conn.on('error', () => {})
    let buffer = Buffer.alloc(0)
    let entry = null
    conn.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0)
        if (length < 1 || length > MAX_FRAME_BYTES || buffer.length < 4 + length) {
          if (length > MAX_FRAME_BYTES || length < 1) conn.destroy()
          break
        }
        const type = buffer.readUInt8(4)
        const payload = buffer.subarray(5, 4 + length)
        buffer = buffer.subarray(4 + length)
        if (!entry) {
          const hello = JSON.parse(payload.toString('utf8'))
          const key = `${hello.sessionId}:${hello.role}`
          const sessionKey = hello.sessionId
          let session = sessions.get(sessionKey)
          if (!session) {
            session = { keyHash: hello.sessionKeyHash, peers: new Map() }
            sessions.set(sessionKey, session)
          }
          if (session.peers.has(hello.role) || session.keyHash !== hello.sessionKeyHash) {
            conn.write(encodeWireFrame(0, Buffer.from(JSON.stringify({
              type: 'error',
              code: 'duplicate_role',
            }))))
            conn.destroy()
            return
          }
          entry = { session, role: hello.role, conn }
          session.peers.set(hello.role, entry)
          if (session.peers.size === 2) {
            for (const peer of session.peers.values()) {
              peer.conn.write(encodeWireFrame(0, Buffer.from(JSON.stringify({
                type: 'paired',
                role: peer.role,
                sessionId: sessionKey,
              }))))
            }
          } else {
            conn.write(encodeWireFrame(0, Buffer.from(JSON.stringify({
              type: 'waiting',
              role: hello.role,
              sessionId: sessionKey,
            }))))
          }
          continue
        }
        const peerRole = entry.role === 'host' ? 'viewer' : 'host'
        const peer = entry.session.peers.get(peerRole)
        if (peer) peer.conn.write(encodeWireFrame(type, payload))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        endpoint: `127.0.0.1:${server.address().port}`,
        close: () => {
          for (const conn of connections) conn.destroy()
          server.close()
        },
      })
    })
  })
}

async function connectClient({ endpoint, role, onFrame }) {
  const device = identity()
  const ephemeral = generateEphemeralKeyPair()
  let pairedResolve
  const paired = new Promise((resolve) => {
    pairedResolve = resolve
  })
  const { client, ready } = connectRelaySession({
    endpoint,
    privateKey: device.privateKey,
    publicKeySpki: device.publicKeySpki,
    ephemeralPublicKey: ephemeral.publicKeySpki,
    sessionId: SESSION_ID,
    role,
    sessionKey: SESSION_KEY,
    onFrame,
    onPaired: pairedResolve,
  })
  await ready
  return { client, paired }
}

test('relay client pairs and exchanges encrypted frames end-to-end', async () => {
  const relay = await mockRelay()
  try {
    const hostFrames = []
    const viewerFrames = []
    // The host handshakes first and waits; pairing completes when the
    // viewer arrives.
    const host = await connectClient({ endpoint: relay.endpoint, role: 'host', onFrame: (type, body) => hostFrames.push({ type, body }) })
    const viewer = await connectClient({ endpoint: relay.endpoint, role: 'viewer', onFrame: (type, body) => viewerFrames.push({ type, body }) })
    await Promise.all([host.paired, viewer.paired])

    host.client.sendVideo(Buffer.from('jpeg-frame'))
    viewer.client.sendInput({ type: 'mousemove', x: 1, y: 2 })
    host.client.sendControl(encodeStreamHeader({
      width: 1920,
      height: 1080,
      scale: 1,
      hostname: 'host',
      platform: 'win32',
    }))

    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(viewerFrames.length, 2)
    assert.equal(viewerFrames[0].type, FRAME_VIDEO)
    assert.equal(viewerFrames[0].body.toString(), 'jpeg-frame')
    assert.equal(viewerFrames[1].type, FRAME_SESSION_CONTROL)
    const header = decodeStreamHeader(JSON.parse(viewerFrames[1].body.toString()))
    assert.equal(header.width, 1920)
    assert.equal(header.platform, 'win32')
    assert.equal(hostFrames.length, 1)
    assert.equal(hostFrames[0].type, FRAME_INPUT)
    assert.deepEqual(JSON.parse(hostFrames[0].body.toString()), {
      type: 'mousemove',
      x: 1,
      y: 2,
    })
    host.client.close()
    viewer.client.close()
  } finally {
    relay.close()
  }
})

test('relay client rejects a bad endpoint shape', async () => {
  const device = identity()
  const ephemeral = generateEphemeralKeyPair()
  assert.throws(
    () =>
      connectRelaySession({
        endpoint: 'https://relay.example',
        privateKey: device.privateKey,
        publicKeySpki: device.publicKeySpki,
        ephemeralPublicKey: ephemeral.publicKeySpki,
        sessionId: SESSION_ID,
        role: 'viewer',
        sessionKey: SESSION_KEY,
      }),
    /endpoint/
  )
  assert.throws(() => normalizeRelayEndpoint('relay.example:99999'), /port/)
})

test('stream headers validate their shape', () => {
  const header = encodeStreamHeader({
    width: 1600,
    height: 900,
    scale: 0.5,
    hostname: 'desktop',
    platform: 'win32',
  })
  assert.deepEqual(decodeStreamHeader(header), header)
  assert.throws(
    () => encodeStreamHeader({ width: 0, height: 900, scale: 1, hostname: '', platform: 'win32' }),
    /dimensions/
  )
  assert.throws(
    () => encodeStreamHeader({ width: 100, height: 100, scale: 1, hostname: '', platform: 'ios' }),
    /platform/
  )
  assert.throws(() => decodeStreamHeader({ type: 'other' }), /missing/)
})

// ---------------------------------------------------------------------------
// Host runtime (all I/O injected)
// ---------------------------------------------------------------------------

function hostRuntimeFixture({ sessions, grantOk = true, approveResult } = {}) {
  const device = identity()
  const calls = []
  const postAction = async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'remote-session.poll') return { sessions }
    if (action === 'remote-session.approve') {
      if (typeof approveResult === 'function') return approveResult(payload)
      if (!grantOk) {
        return {
          approved: false,
          pending: true,
          session: { sessionId: payload.sessionId, state: 'requested' },
        }
      }
      return {
        approved: true,
        pending: false,
        session: approvedSession({ sessionId: payload.sessionId }),
      }
    }
    if (action === 'remote-session.activate') return { state: 'active' }
    if (action === 'remote-session.end') return { state: 'ended' }
    throw new Error(`unexpected action ${action}`)
  }
  const relayClient = {
    sendVideo() {},
    sendControl() {},
    sendInput() {},
    close() {},
  }
  const runtime = createRemoteSessionHostRuntime({
    postAction,
    deviceId: device.deviceId,
    privateKey: device.privateKey,
    publicKeySpki: device.publicKeySpki,
    platform: 'win32',
    electron: { BrowserWindow: class {}, desktopCapturer: {}, screen: {} },
    captureFactory: async ({ onReady }) => {
      onReady({ width: 1920, height: 1080, scale: 1 })
      return { stop() {} }
    },
    inputClientFactory: () => ({ send: async () => {}, close() {} }),
    indicatorFactory: () => ({ close() {} }),
    relayConnect: () => ({ client: relayClient, ready: Promise.resolve(relayClient) }),
    sleep: () => new Promise(() => {}),
    now: () => NOW,
    logger: { info() {}, warn() {} },
  })
  return { runtime, calls, device }
}

function approvedSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    state: 'approved',
    capabilities: ['screen.view', 'screen.input'],
    transport: 'relay',
    relayEndpoint: 'relay.example:7447',
    sessionKey: SESSION_KEY.toString('base64url'),
    expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    ...overrides,
  }
}

test('host runtime leaves requested sessions pending without a grant', async () => {
  const { runtime, calls } = hostRuntimeFixture({
    sessions: [{ sessionId: SESSION_ID, state: 'requested', capabilities: ['screen.view'] }],
    grantOk: false,
  })
  await runtime.pollOnce()
  const approve = calls.find((call) => call.action === 'remote-session.approve')
  assert.ok(approve)
  assert.equal(approve.payload.sessionId, SESSION_ID)
  assert.match(approve.payload.workerEphemeralKey, /^[A-Za-z0-9_-]{40,64}$/)
  assert.equal(runtime.hostingCount(), 0)
  assert.equal(
    calls.filter((call) => call.action === 'remote-session.activate').length,
    0
  )
})

test('host runtime approves, starts hosting, and activates granted sessions', async () => {
  const { runtime, calls } = hostRuntimeFixture({
    sessions: [{ sessionId: SESSION_ID, state: 'requested', capabilities: ['screen.view'] }],
  })
  await runtime.pollOnce()
  assert.equal(runtime.hostingCount(), 1)
  assert.ok(calls.find((call) => call.action === 'remote-session.approve'))
  assert.ok(calls.find((call) => call.action === 'remote-session.activate'))
  // A second poll does not double-start the same session.
  await runtime.pollOnce()
  assert.equal(runtime.hostingCount(), 1)
  assert.equal(
    calls.filter((call) => call.action === 'remote-session.activate').length,
    1
  )
  await runtime.stop()
  assert.equal(runtime.hostingCount(), 0)
})

test('host runtime picks up owner-approved sessions from the poll listing', async () => {
  const { runtime, calls } = hostRuntimeFixture({ sessions: [approvedSession()] })
  await runtime.pollOnce()
  assert.equal(runtime.hostingCount(), 1)
  assert.ok(calls.find((call) => call.action === 'remote-session.approve'))
  await runtime.stop()
})

test('host runtime tears down sessions that leave the poll listing', async () => {
  const sessions = [approvedSession()]
  const { runtime } = hostRuntimeFixture({ sessions })
  await runtime.pollOnce()
  assert.equal(runtime.hostingCount(), 1)
  sessions.length = 0
  await runtime.pollOnce()
  assert.equal(runtime.hostingCount(), 0)
  await runtime.stop()
})

test('host runtime skips malformed poll entries and unusable approvals', async () => {
  const sessions = [
    null,
    { sessionId: 'not-a-session' },
    { sessionId: 'rs_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', state: 'ended' },
    { sessionId: 'rs_ffffffffffffffffffffffffffffffff', state: 'active' },
  ]
  const { runtime, calls } = hostRuntimeFixture({
    sessions,
    approveResult: () => ({ approved: true, session: { sessionId: SESSION_ID } }),
  })
  await runtime.pollOnce()
  assert.equal(runtime.hostingCount(), 0)
  assert.equal(
    calls.filter((call) => call.action === 'remote-session.approve').length,
    0
  )
  await runtime.stop()
})
