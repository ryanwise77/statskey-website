'use strict'

// Fleet Remote Session runtime: host capture + input injection on the
// controlled machine, and the relay client shared by host and viewer.
//
// Security model (fleetd/REMOTE_SESSION.md):
//   - The relay channel carries only AES-256-GCM ciphertext under the
//     256-bit session key issued by the control plane; the relay stores only
//     the key's SHA-256 and forwards opaque frames.
//   - Both sides authenticate to the relay with a canonical-JSON hello
//     signed by their enrolled device key, binding session ID, role, a
//     per-session ephemeral public key, and a <= 10 minute expiry.
//   - Viewer input is validated (bounded coordinates, known event types and
//     key names, rate-limited) in this process before it reaches the
//     statskey-inputd helper, which re-validates and injects via SendInput.
//   - The host always shows a non-closable "remote session active" indicator
//     while streaming.
//
// This module is requireable in plain Node for tests: Electron is only ever
// reached through injected dependencies, never a top-level require.

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} = require('node:crypto')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { existsSync } = require('node:fs')
const {
  canonicalJson,
  deviceIdentityForPublicKey,
  exportPublicKeySpki,
} = require('./fleet-auth-runtime.cjs')

const SESSION_ID_PATTERN = /^rs_[a-f0-9]{32}$/
const DEVICE_ID_PATTERN = /^dev_[a-f0-9]{32}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const RELAY_ENDPOINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}:[0-9]{1,5}$/

const FRAME_CONTROL = 0x00
const FRAME_SESSION_CONTROL = 0x01
const FRAME_VIDEO = 0x02
const FRAME_INPUT = 0x03

const MAX_FRAME_BYTES = 2 * 1024 * 1024
const MAX_CONTROL_BYTES = 16 * 1024
const HELLO_LIFETIME_MS = 10 * 60_000
const CONNECT_TIMEOUT_MS = 15_000

const DEFAULT_CAPTURE_FPS = 8
const MAX_CAPTURE_FPS = 15
const DEFAULT_MAX_DIMENSION = 1600
const MAX_DIMENSION_LIMIT = 3840
const JPEG_QUALITY = 70

const INPUT_PIPE_PATH = '\\\\.\\pipe\\statskey-input'
const MAX_INPUT_COMMAND_BYTES = 4 * 1024
const MAX_INPUT_EVENTS_PER_SECOND = 240

const REMOTE_SESSION_STATES = Object.freeze([
  'requested',
  'approved',
  'active',
  'ended',
  'expired',
])

function remoteError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireRemote(condition, code, message) {
  if (!condition) throw remoteError(code, message)
}

// ---------------------------------------------------------------------------
// Session key + frame encryption (AES-256-GCM, end-to-end)
// ---------------------------------------------------------------------------

function normalizeSessionKey(sessionKey) {
  const key = Buffer.isBuffer(sessionKey)
    ? sessionKey
    : Buffer.from(String(sessionKey || ''), 'base64url')
  requireRemote(
    key.length === 32,
    'invalid_session_key',
    'The remote session key must be 32 bytes.'
  )
  return key
}

function sessionKeyHash(sessionKey) {
  return `sha256:${createHash('sha256')
    .update(normalizeSessionKey(sessionKey))
    .digest('base64url')}`
}

function frameAad(sessionId, type) {
  return Buffer.from(`${sessionId}${type}`, 'utf8')
}

// encryptFramePayload returns nonce(12) || ciphertext || tag(16). The AAD
// binds the session ID and frame type so ciphertext cannot be replayed
// across sessions or reinterpreted as another frame type.
function encryptFramePayload({ sessionKey, sessionId, type, payload }) {
  const key = normalizeSessionKey(sessionKey)
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  requireRemote(
    body.length + 12 + 16 + 1 <= MAX_FRAME_BYTES,
    'frame_too_large',
    'The remote session frame is too large.'
  )
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(frameAad(sessionId, type))
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()])
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()])
}

function decryptFramePayload({ sessionKey, sessionId, type, body }) {
  const key = normalizeSessionKey(sessionKey)
  requireRemote(
    Buffer.isBuffer(body) && body.length >= 12 + 16,
    'bad_frame',
    'The remote session frame is malformed.'
  )
  const nonce = body.subarray(0, 12)
  const tag = body.subarray(body.length - 16)
  const ciphertext = body.subarray(12, body.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(frameAad(sessionId, type))
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw remoteError('bad_frame', 'The remote session frame failed to decrypt.')
  }
}

// ---------------------------------------------------------------------------
// Wire framing toward the relay: uint32 BE length || type || payload
// ---------------------------------------------------------------------------

function encodeWireFrame(type, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const length = body.length + 1
  requireRemote(
    length <= MAX_FRAME_BYTES,
    'frame_too_large',
    'The remote session frame is too large.'
  )
  const frame = Buffer.allocUnsafe(4 + 1 + body.length)
  frame.writeUInt32BE(length, 0)
  frame.writeUInt8(type, 4)
  body.copy(frame, 5)
  return frame
}

// createWireFrameParser incrementally parses frames from a stream. Oversize
// or truncated-length frames are protocol violations and surface exactly one
// onError; the consumer must treat the stream as dead from that point.
function createWireFrameParser({ onFrame, onError }) {
  let buffer = Buffer.alloc(0)
  let failed = false
  return {
    feed(chunk) {
      if (failed) return
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0)
        if (length > MAX_FRAME_BYTES || length < 1) {
          failed = true
          onError(remoteError('bad_frame', 'The relay sent an invalid frame.'))
          return
        }
        if (buffer.length < 4 + length) return
        const type = buffer.readUInt8(4)
        const payload = buffer.subarray(5, 4 + length)
        buffer = buffer.subarray(4 + length)
        onFrame(type, payload)
      }
    },
    fail(error) {
      if (failed) return
      failed = true
      onError(error)
    },
  }
}

// ---------------------------------------------------------------------------
// RemoteHelloV1 (matches fleetd/internal/relay/hello.go byte-for-byte)
// ---------------------------------------------------------------------------

function formatWireTimestamp(millis) {
  requireRemote(
    Number.isSafeInteger(millis) && millis >= 0,
    'invalid_envelope',
    'Remote hello timestamps must be safe integers.'
  )
  return new Date(millis).toISOString()
}

function createRemoteHello({
  privateKey,
  publicKeySpki,
  ephemeralPublicKey,
  sessionId,
  role,
  sessionKey,
  issuedAt = Date.now(),
  expiresAt = issuedAt + 5 * 60_000,
}) {
  requireRemote(
    typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId),
    'invalid_session',
    'The remote session id is invalid.'
  )
  requireRemote(
    role === 'host' || role === 'viewer',
    'invalid_session',
    'The remote session role is invalid.'
  )
  const identity = deviceIdentityForPublicKey(publicKeySpki)
  const ephemeralIdentity = deviceIdentityForPublicKey(ephemeralPublicKey)
  requireRemote(
    ephemeralIdentity.publicKeySpki === ephemeralPublicKey,
    'invalid_session',
    'The remote session ephemeral key is invalid.'
  )
  requireRemote(
    expiresAt > issuedAt && expiresAt - issuedAt <= HELLO_LIFETIME_MS,
    'invalid_envelope',
    'The remote hello lifetime exceeds ten minutes.'
  )
  const unsigned = {
    domain: 'statskey.fleet.remote-hello.v1',
    deviceId: identity.deviceId,
    ephemeralPublicKey,
    expiresAt: formatWireTimestamp(expiresAt),
    issuedAt: formatWireTimestamp(issuedAt),
    publicKeySpki: identity.publicKeySpki,
    role,
    sessionId,
    sessionKeyHash: sessionKeyHash(sessionKey),
  }
  const signature = sign(
    null,
    Buffer.from(canonicalJson(unsigned), 'utf8'),
    privateKey
  )
  return { ...unsigned, signature: signature.toString('base64url') }
}

function generateEphemeralKeyPair() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeySpki: exportPublicKeySpki(pair.publicKey),
  }
}

// ---------------------------------------------------------------------------
// Relay client (host and viewer share this; the main process owns the socket)
// ---------------------------------------------------------------------------

function normalizeRelayEndpoint(endpoint) {
  const value = String(endpoint || '').trim()
  requireRemote(
    RELAY_ENDPOINT_PATTERN.test(value),
    'invalid_endpoint',
    'The remote session relay endpoint is invalid.'
  )
  const port = Number(value.slice(value.lastIndexOf(':') + 1))
  requireRemote(
    Number.isInteger(port) && port >= 1 && port <= 65535,
    'invalid_endpoint',
    'The remote session relay port is invalid.'
  )
  return value
}

function parseControlFrame(payload) {
  requireRemote(
    payload.length <= MAX_CONTROL_BYTES,
    'bad_frame',
    'The relay control frame is too large.'
  )
  let value
  try {
    value = JSON.parse(payload.toString('utf8'))
  } catch {
    throw remoteError('bad_frame', 'The relay control frame is not JSON.')
  }
  requireRemote(
    value && typeof value === 'object' && !Array.isArray(value),
    'bad_frame',
    'The relay control frame is not an object.'
  )
  return value
}

// connectRelaySession performs the hello handshake; ready resolves once the
// relay accepts the handshake (state "waiting" until the peer arrives, then
// "paired"). onPaired fires when the session pairs, including when it was
// already paired at handshake time. Frames after pairing are decrypted and
// delivered to onFrame(type, plaintext); relay control notices (for example
// idle-timeout errors) go to onControl.
function connectRelaySession({
  endpoint,
  privateKey,
  publicKeySpki,
  ephemeralPublicKey,
  sessionId,
  role,
  sessionKey,
  timeoutMs = CONNECT_TIMEOUT_MS,
  socketFactory,
  now = Date.now,
  onFrame,
  onControl,
  onPaired,
  onClose,
}) {
  const target = normalizeRelayEndpoint(endpoint)
  const key = normalizeSessionKey(sessionKey)
  const hello = createRemoteHello({
    privateKey,
    publicKeySpki,
    ephemeralPublicKey,
    sessionId,
    role,
    sessionKey: key,
    issuedAt: now(),
    expiresAt: now() + 5 * 60_000,
  })
  const host = target.slice(0, target.lastIndexOf(':'))
  const port = Number(target.slice(target.lastIndexOf(':') + 1))
  const connect = typeof socketFactory === 'function'
    ? socketFactory
    : (p, h) => net.connect(p, h)

  let socket = null
  let settled = false
  let closed = false
  let paired = false
  const markPaired = () => {
    if (paired) return
    paired = true
    if (typeof onPaired === 'function') onPaired()
  }

  const client = {
    get paired() {
      return paired
    },
    sendControl(value) {
      const payload = encryptFramePayload({
        sessionKey: key,
        sessionId,
        type: FRAME_SESSION_CONTROL,
        payload: Buffer.from(canonicalJson(value), 'utf8'),
      })
      socket.write(encodeWireFrame(FRAME_SESSION_CONTROL, payload))
    },
    sendVideo(jpeg) {
      const payload = encryptFramePayload({
        sessionKey: key,
        sessionId,
        type: FRAME_VIDEO,
        payload: jpeg,
      })
      socket.write(encodeWireFrame(FRAME_VIDEO, payload))
    },
    sendInput(event) {
      const payload = encryptFramePayload({
        sessionKey: key,
        sessionId,
        type: FRAME_INPUT,
        payload: Buffer.from(canonicalJson(event), 'utf8'),
      })
      socket.write(encodeWireFrame(FRAME_INPUT, payload))
    },
    close() {
      if (closed) return
      closed = true
      try {
        socket?.destroy()
      } catch {}
      if (typeof onClose === 'function') onClose()
    },
  }

  let handshakeTimer = null
  const ready = new Promise((resolve, reject) => {
    const succeed = (isPaired) => {
      if (handshakeTimer) clearTimeout(handshakeTimer)
      settled = true
      if (isPaired) markPaired()
      resolve(client)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      if (handshakeTimer) clearTimeout(handshakeTimer)
      try {
        socket?.destroy()
      } catch {}
      reject(error)
    }
    const parser = createWireFrameParser({
      onFrame(type, payload) {
        if (type === FRAME_CONTROL) {
          let control
          try {
            control = parseControlFrame(payload)
          } catch (error) {
            fail(error)
            return
          }
          if (control.type === 'error') {
            const code = typeof control.code === 'string' ? control.code : 'relay_error'
            if (!settled) {
              fail(remoteError(code, 'The relay rejected this session.'))
            } else if (typeof onControl === 'function') {
              onControl({ type: 'error', code })
            }
            return
          }
          if (control.type === 'waiting' || control.type === 'paired') {
            if (control.sessionId !== sessionId) {
              if (!settled) {
                fail(remoteError('bad_frame', 'The relay answered for the wrong session.'))
              }
              return
            }
            if (control.type === 'paired') markPaired()
            if (!settled) succeed(control.type === 'paired')
            return
          }
          if (typeof onControl === 'function') onControl(control)
          return
        }
        if (!paired) {
          fail(remoteError('bad_frame', 'The relay forwarded frames before pairing.'))
          return
        }
        if (
          type !== FRAME_SESSION_CONTROL &&
          type !== FRAME_VIDEO &&
          type !== FRAME_INPUT
        ) {
          fail(remoteError('bad_frame', 'The relay forwarded an unknown frame type.'))
          return
        }
        if (typeof onFrame !== 'function') return
        let plaintext
        try {
          plaintext = decryptFramePayload({ sessionKey: key, sessionId, type, body: payload })
        } catch (error) {
          fail(error)
          return
        }
        onFrame(type, plaintext)
      },
      onError(error) {
        fail(error)
      },
    })

    socket = connect(port, host)
    handshakeTimer = setTimeout(() => {
      fail(remoteError('timeout', 'The remote session relay did not answer.'))
    }, Math.max(1_000, Math.min(60_000, Number(timeoutMs) || CONNECT_TIMEOUT_MS)))
    handshakeTimer.unref?.()
    socket.on('connect', () => {
      socket.write(encodeWireFrame(FRAME_CONTROL, Buffer.from(canonicalJson(hello), 'utf8')))
    })
    socket.on('data', (chunk) => parser.feed(chunk))
    socket.on('error', () => {
      if (!settled) {
        fail(remoteError('offline', 'The remote session relay is unreachable.'))
      } else {
        client.close()
      }
    })
    socket.on('close', () => {
      if (!settled) {
        fail(remoteError('offline', 'The remote session relay disconnected.'))
      } else {
        client.close()
      }
    })
  })

  return { client, ready }
}

// ---------------------------------------------------------------------------
// Stream header frame (host → viewer, encrypted session control)
// ---------------------------------------------------------------------------

function encodeStreamHeader({ width, height, scale, hostname, platform }) {
  requireRemote(
    Number.isSafeInteger(width) && width >= 1 && width <= 16384 &&
      Number.isSafeInteger(height) && height >= 1 && height <= 16384,
    'invalid_header',
    'The stream header dimensions are invalid.'
  )
  requireRemote(
    typeof scale === 'number' && Number.isFinite(scale) && scale > 0 && scale <= 4,
    'invalid_header',
    'The stream header scale is invalid.'
  )
  requireRemote(
    ['darwin', 'win32', 'linux'].includes(platform),
    'invalid_header',
    'The stream header platform is invalid.'
  )
  return {
    type: 'stream.header',
    width,
    height,
    scale,
    hostname: String(hostname || '').slice(0, 128),
    platform,
  }
}

function decodeStreamHeader(value) {
  requireRemote(
    value && typeof value === 'object' && !Array.isArray(value) &&
      value.type === 'stream.header',
    'invalid_header',
    'The stream header is missing.'
  )
  return encodeStreamHeader(value)
}

function parseSessionControl(plaintext) {
  let value
  try {
    value = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw remoteError('bad_frame', 'The session control frame is not JSON.')
  }
  requireRemote(
    value && typeof value === 'object' && !Array.isArray(value),
    'bad_frame',
    'The session control frame is not an object.'
  )
  return value
}

// ---------------------------------------------------------------------------
// Input validation + rate limiting (viewer events → host pipe commands)
// ---------------------------------------------------------------------------

const REMOTE_INPUT_KEYS = new Set((() => {
  const keys = [
    'Backspace', 'Tab', 'Enter', 'Escape', 'Space', 'CapsLock',
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Semicolon', 'Equal', 'Comma', 'Minus', 'Period', 'Slash',
    'Backquote', 'BracketLeft', 'Backslash', 'BracketRight', 'Quote',
  ]
  for (let i = 0; i < 26; i += 1) keys.push(`Key${String.fromCharCode(65 + i)}`)
  for (let i = 0; i <= 9; i += 1) keys.push(`Digit${i}`)
  for (let i = 1; i <= 12; i += 1) keys.push(`F${i}`)
  return keys
})())

const REMOTE_INPUT_BUTTONS = new Set(['left', 'middle', 'right'])
const MAX_WHEEL_DELTA = 4096

function normalizeInputBounds(bounds) {
  const width = Number(bounds?.width)
  const height = Number(bounds?.height)
  requireRemote(
    Number.isSafeInteger(width) && width >= 1 && width <= 32768 &&
      Number.isSafeInteger(height) && height >= 1 && height <= 32768,
    'invalid_bounds',
    'The remote session screen bounds are invalid.'
  )
  return { width, height }
}

function coordinate(value, limit) {
  requireRemote(
    Number.isSafeInteger(value) && value >= 0 && value < limit,
    'invalid_input',
    'The remote input coordinates are out of range.'
  )
  return value
}

// normalizeRemoteInputEvent validates a viewer input event against the
// current screen bounds and returns a fresh, minimal command object. Unknown
// types, extra fields, out-of-range coordinates, and unknown keys all fail
// closed. The output shape is exactly what statskey-inputd accepts.
function normalizeRemoteInputEvent(event, bounds) {
  const { width, height } = normalizeInputBounds(bounds)
  requireRemote(
    event && typeof event === 'object' && !Array.isArray(event),
    'invalid_input',
    'The remote input event is invalid.'
  )
  const type = event.type
  if (type === 'mousemove') {
    return {
      type,
      x: coordinate(event.x, width),
      y: coordinate(event.y, height),
    }
  }
  if (type === 'mousedown' || type === 'mouseup') {
    requireRemote(
      REMOTE_INPUT_BUTTONS.has(event.button),
      'invalid_input',
      'The remote input button is invalid.'
    )
    return {
      type,
      x: coordinate(event.x, width),
      y: coordinate(event.y, height),
      button: event.button,
    }
  }
  if (type === 'wheel') {
    const deltaY = Number(event.deltaY)
    const deltaX = event.deltaX === undefined ? 0 : Number(event.deltaX)
    requireRemote(
      Number.isSafeInteger(deltaY) && Math.abs(deltaY) <= MAX_WHEEL_DELTA &&
        Number.isSafeInteger(deltaX) && Math.abs(deltaX) <= MAX_WHEEL_DELTA &&
        (deltaY !== 0 || deltaX !== 0),
      'invalid_input',
      'The remote input wheel delta is invalid.'
    )
    const command = {
      type,
      x: coordinate(event.x, width),
      y: coordinate(event.y, height),
      deltaY,
    }
    if (deltaX !== 0) command.deltaX = deltaX
    return command
  }
  if (type === 'keydown' || type === 'keyup') {
    requireRemote(
      typeof event.key === 'string' && REMOTE_INPUT_KEYS.has(event.key),
      'invalid_input',
      'The remote input key is invalid.'
    )
    return { type, key: event.key }
  }
  throw remoteError('invalid_input', 'The remote input event type is invalid.')
}

// createInputRateLimiter is a token bucket: at most maxPerSecond events per
// second with a burst allowance, so a compromised or buggy viewer cannot
// flood the input pipe.
function createInputRateLimiter({
  maxPerSecond = MAX_INPUT_EVENTS_PER_SECOND,
  burst = 2 * MAX_INPUT_EVENTS_PER_SECOND,
  now = Date.now,
} = {}) {
  requireRemote(
    Number.isSafeInteger(maxPerSecond) && maxPerSecond >= 1 && maxPerSecond <= 10_000,
    'invalid_argument',
    'The input rate limit is invalid.'
  )
  let tokens = burst
  let last = now()
  return {
    allow() {
      const current = now()
      if (current > last) {
        tokens = Math.min(burst, tokens + ((current - last) * maxPerSecond) / 1000)
        last = current
      }
      if (tokens < 1) return false
      tokens -= 1
      return true
    },
  }
}

// ---------------------------------------------------------------------------
// Session state machine: requested → approved → active → ended | expired
// ---------------------------------------------------------------------------

function createRemoteSessionMachine({ sessionId, expiresAt, now = Date.now }) {
  requireRemote(
    typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId),
    'invalid_session',
    'The remote session id is invalid.'
  )
  const expiry = Number(expiresAt)
  requireRemote(
    Number.isFinite(expiry) && expiry > 0,
    'invalid_session',
    'The remote session expiry is invalid.'
  )
  let state = 'requested'
  const refresh = () => {
    if (state !== 'ended' && state !== 'expired' && now() >= expiry) {
      state = 'expired'
    }
    return state
  }
  const transition = (from, to) => {
    refresh()
    requireRemote(
      state === from,
      'invalid_transition',
      `A remote session in ${state} cannot become ${to}.`
    )
    state = to
    return state
  }
  return {
    getState: refresh,
    isTerminal() {
      const current = refresh()
      return current === 'ended' || current === 'expired'
    },
    approve() {
      return transition('requested', 'approved')
    },
    activate() {
      return transition('approved', 'active')
    },
    end() {
      refresh()
      if (state === 'ended' || state === 'expired') return state
      state = 'ended'
      return state
    },
  }
}

// ---------------------------------------------------------------------------
// statskey-inputd pipe client (host side, Windows only)
// ---------------------------------------------------------------------------

function resolveInputHelperPath({ resourcesPath, dirname = __dirname } = {}) {
  const candidates = [
    resourcesPath
      ? path.join(resourcesPath, 'bin', 'statskey-inputd.exe')
      : null,
    path.join(dirname, 'bin', 'statskey-inputd.exe'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

// spawnInputHelper starts statskey-inputd as the current console user. It
// never elevates: a plain spawn with no shell, no runas, no sudo. The helper
// binary is a first-party Go executable built from fleetd/cmd/statskey-inputd.
function spawnInputHelper({
  helperPath,
  pipePath = INPUT_PIPE_PATH,
  spawn,
} = {}) {
  requireRemote(
    typeof helperPath === 'string' && helperPath.length > 0,
    'invalid_argument',
    'The input helper path is required.'
  )
  const spawnImpl =
    typeof spawn === 'function'
      ? spawn
      : require('node:child_process').spawn
  const child = spawnImpl(helperPath, ['--pipe', pipePath], {
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
    shell: false,
  })
  child.unref?.()
  return child
}

// createInputHelperClient talks to statskey-inputd over its named pipe: one
// JSON command per line, max 4 KiB, one JSON ack per line. Commands are
// serialized so acks pair with sends. connect is injectable for tests.
function createInputHelperClient({
  pipePath = INPUT_PIPE_PATH,
  connect,
  timeoutMs = 5_000,
} = {}) {
  const connectImpl = typeof connect === 'function'
    ? connect
    : (target) => net.connect(target)
  let stream = null
  let buffer = Buffer.alloc(0)
  let queue = Promise.resolve()
  const pending = []

  const rejectAll = (error) => {
    while (pending.length > 0) {
      const waiter = pending.shift()
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }

  const ensureStream = () => {
    if (stream) return stream
    stream = connectImpl(pipePath)
    buffer = Buffer.alloc(0)
    stream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (true) {
        const newline = buffer.indexOf(0x0a)
        if (newline < 0) break
        const line = buffer.subarray(0, newline)
        buffer = buffer.subarray(newline + 1)
        const waiter = pending.shift()
        if (!waiter) continue
        clearTimeout(waiter.timer)
        if (line.length > MAX_INPUT_COMMAND_BYTES) {
          waiter.reject(remoteError('bad_ack', 'The input helper ack is too large.'))
          continue
        }
        let ack
        try {
          ack = JSON.parse(line.toString('utf8'))
        } catch {
          waiter.reject(remoteError('bad_ack', 'The input helper ack is not JSON.'))
          continue
        }
        if (ack && ack.ok === true) {
          waiter.resolve()
        } else {
          const code = typeof ack?.error === 'string' ? ack.error : 'execute_failed'
          waiter.reject(remoteError(code, 'The input helper rejected a command.'))
        }
      }
      if (buffer.length > MAX_INPUT_COMMAND_BYTES) {
        // No newline within the bound: the helper violated the protocol.
        stream.destroy()
        rejectAll(remoteError('bad_ack', 'The input helper ack exceeded its bound.'))
      }
    })
    const onDead = () => {
      stream = null
      rejectAll(remoteError('offline', 'The input helper disconnected.'))
    }
    stream.on('error', onDead)
    stream.on('close', onDead)
    return stream
  }

  return {
    send(command) {
      let line
      try {
        line = JSON.stringify(command)
        requireRemote(
          Buffer.byteLength(line, 'utf8') + 1 <= MAX_INPUT_COMMAND_BYTES,
          'invalid_input',
          'The remote input command is too large.'
        )
      } catch (error) {
        return Promise.reject(error)
      }
      const run = queue.then(() => new Promise((resolve, reject) => {
        let active
        try {
          active = ensureStream()
        } catch (error) {
          reject(error)
          return
        }
        const waiter = { resolve, reject, timer: null }
        waiter.timer = setTimeout(() => {
          const index = pending.indexOf(waiter)
          if (index >= 0) pending.splice(index, 1)
          reject(remoteError('timeout', 'The input helper did not answer.'))
        }, timeoutMs)
        waiter.timer.unref?.()
        pending.push(waiter)
        active.write(`${line}\n`, (error) => {
          if (!error) return
          const index = pending.indexOf(waiter)
          if (index >= 0) {
            pending.splice(index, 1)
            clearTimeout(waiter.timer)
            reject(remoteError('offline', 'The input helper write failed.'))
          }
        })
      }))
      queue = run.catch(() => {})
      return run
    },
    close() {
      const current = stream
      stream = null
      rejectAll(remoteError('closed', 'The input helper client closed.'))
      try {
        current?.destroy()
      } catch {}
    },
  }
}

// ---------------------------------------------------------------------------
// Electron capture + indicator (host side; injected into this module's pure
// core by the main process)
// ---------------------------------------------------------------------------

// createScreenCapture runs the actual capture loop in a hidden BrowserWindow
// whose preload (remote-session-capture-preload.cjs) owns
// getUserMedia(chromeMediaSource: 'desktop') and JPEG encoding. Verified
// behavior notes live in fleetd/REMOTE_SESSION.md: capturePage on a hidden
// window does not repaint reliably, so the getUserMedia + canvas path is
// used instead.
async function createScreenCapture({
  BrowserWindow,
  desktopCapturer,
  screen,
  ipcMain,
  fps = DEFAULT_CAPTURE_FPS,
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = JPEG_QUALITY,
  onFrame,
  onReady,
  onError,
  preloadPath = path.join(__dirname, 'remote-session-capture-preload.cjs'),
  htmlPath = path.join(__dirname, 'remote-session-capture.html'),
}) {
  requireRemote(
    Number.isSafeInteger(fps) && fps >= 1 && fps <= MAX_CAPTURE_FPS,
    'invalid_argument',
    'The capture frame rate is outside 1-15 fps.'
  )
  requireRemote(
    Number.isSafeInteger(maxDimension) &&
      maxDimension >= 320 &&
      maxDimension <= MAX_DIMENSION_LIMIT,
    'invalid_argument',
    'The capture dimension is outside its allowed range.'
  )
  requireRemote(
    Number.isSafeInteger(quality) && quality >= 30 && quality <= 95,
    'invalid_argument',
    'The capture JPEG quality is outside its allowed range.'
  )
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false,
  })
  requireRemote(
    Array.isArray(sources) && sources.length > 0,
    'capture_unavailable',
    'No screen source is available for capture.'
  )
  const primary = screen?.getPrimaryDisplay?.()
  const source =
    sources.find(
      (candidate) =>
        primary && String(candidate.display_id) === String(primary.id)
    ) || sources[0]

  const window = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  const frameListener = (event, bytes) => {
    if (event.sender !== window.webContents) return
    const buffer = Buffer.from(bytes)
    if (buffer.length === 0 || buffer.length > MAX_FRAME_BYTES - 64) return
    onFrame(buffer)
  }
  const readyListener = (event, info) => {
    if (event.sender !== window.webContents) return
    if (typeof onReady === 'function') {
      onReady({
        width: Number(info?.width) || 0,
        height: Number(info?.height) || 0,
        scale: Number(info?.scale) || 1,
      })
    }
  }
  const errorListener = (event, message) => {
    if (event.sender !== window.webContents) return
    if (typeof onError === 'function') {
      onError(String(message || 'Capture failed.').slice(0, 300))
    }
  }
  ipcMain.on('statskey-desktop:remote-capture-frame', frameListener)
  ipcMain.on('statskey-desktop:remote-capture-ready', readyListener)
  ipcMain.on('statskey-desktop:remote-capture-error', errorListener)

  await window.loadFile(htmlPath, {
    query: {
      sourceId: String(source.id),
      fps: String(fps),
      maxDimension: String(maxDimension),
      quality: String(quality),
    },
  })

  let stopped = false
  return {
    sourceId: String(source.id),
    stop() {
      if (stopped) return
      stopped = true
      ipcMain.removeListener('statskey-desktop:remote-capture-frame', frameListener)
      ipcMain.removeListener('statskey-desktop:remote-capture-ready', readyListener)
      ipcMain.removeListener('statskey-desktop:remote-capture-error', errorListener)
      try {
        if (!window.isDestroyed()) window.destroy()
      } catch {}
    },
  }
}

// createSessionIndicator shows the always-on-top, non-closable red banner
// required while a host is streaming. The window ignores close requests
// until the session ends.
function createSessionIndicator({ BrowserWindow, sessionId }) {
  const window = new BrowserWindow({
    width: 420,
    height: 64,
    show: true,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setMenu(null)
  let active = true
  window.on('close', (event) => {
    if (active) event.preventDefault()
  })
  const shortId = String(sessionId || '').slice(0, 12)
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;background:#b91c1c;color:#fff;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;letter-spacing:.02em}</style></head><body>Remote session active &middot; ${shortId} &middot; this screen is being shared</body></html>`
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return {
    close() {
      active = false
      try {
        if (!window.isDestroyed()) window.destroy()
      } catch {}
    },
  }
}

// ---------------------------------------------------------------------------
// Host runtime: poll the control plane, approve with a grant, stream.
// ---------------------------------------------------------------------------

// createRemoteSessionHostRuntime drives the host lifecycle for the device
// this desktop is enrolled as. Everything Electron- or network-specific is
// injectable so the state transitions are testable in plain Node.
function createRemoteSessionHostRuntime({
  postAction,
  deviceId,
  privateKey,
  publicKeySpki,
  platform = process.platform,
  electron = null,
  captureFactory = null,
  inputClientFactory = null,
  indicatorFactory = null,
  relayConnect = connectRelaySession,
  ephemeralKeyFactory = generateEphemeralKeyPair,
  pollIntervalMs = 5_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  hostname = os.hostname(),
}) {
  requireRemote(
    typeof postAction === 'function',
    'invalid_argument',
    'A Fleet device transport is required.'
  )
  requireRemote(
    typeof deviceId === 'string' && DEVICE_ID_PATTERN.test(deviceId),
    'invalid_argument',
    'The host device id is invalid.'
  )
  const hosted = new Map() // sessionId → hosting record
  const approveAttempts = new Map() // sessionId → last attempt ms
  const pendingEphemerals = new Map() // sessionId → ephemeral keypair
  let running = false
  let stopped = false

  const stopHosting = async (sessionId, reason) => {
    const record = hosted.get(sessionId)
    if (!record) return
    hosted.delete(sessionId)
    record.machine.end()
    try {
      record.capture?.stop()
    } catch {}
    try {
      record.indicator?.close()
    } catch {}
    try {
      record.client?.close()
    } catch {}
    try {
      record.inputClient?.close()
    } catch {}
    logger.info?.(`[remote-session] host ${sessionId} stopped: ${reason}`)
  }

  const stopAll = async () => {
    for (const sessionId of [...hosted.keys()]) {
      await stopHosting(sessionId, 'shutdown')
    }
  }

  const startHosting = async (session, ephemeral) => {
    const sessionId = session.sessionId
    const machine = createRemoteSessionMachine({
      sessionId,
      expiresAt: Date.parse(session.expiresAt),
      now,
    })
    machine.approve()
    const record = {
      session,
      machine,
      client: null,
      capture: null,
      indicator: null,
      inputClient: null,
      rateLimiter: createInputRateLimiter({ now }),
      bounds: null,
    }

    const handleInputFrame = async (rec, plaintext) => {
      if (rec.machine.getState() !== 'active' || !rec.bounds) return
      if (!rec.session.capabilities.includes('screen.input')) return
      try {
        const event = parseSessionControl(plaintext)
        const command = normalizeRemoteInputEvent(event, rec.bounds)
        if (!rec.rateLimiter.allow()) return
        if (!rec.inputClient) return
        await rec.inputClient.send(command)
      } catch (error) {
        logger.warn?.(
          `[remote-session] dropped input for ${sessionId}: ${error?.code || 'invalid'}`
        )
      }
    }
    const handleControlFrame = async (rec, plaintext) => {
      try {
        const control = parseSessionControl(plaintext)
        if (control.type === 'session.end') {
          await postAction('remote-session.end', { sessionId }).catch(() => {})
          await stopHosting(sessionId, 'viewer ended the session')
        }
      } catch {}
    }

    const { client, ready } = relayConnect({
      endpoint: session.relayEndpoint,
      privateKey,
      publicKeySpki,
      ephemeralPublicKey: ephemeral.publicKeySpki,
      sessionId,
      role: 'host',
      sessionKey: session.sessionKey,
      onFrame: (type, plaintext) => {
        const current = hosted.get(sessionId)
        if (!current) return
        if (type === FRAME_INPUT) {
          void handleInputFrame(current, plaintext)
        } else if (type === FRAME_SESSION_CONTROL) {
          void handleControlFrame(current, plaintext)
        }
      },
      onClose: () => {
        void stopHosting(sessionId, 'relay closed')
      },
    })
    record.client = client
    hosted.set(sessionId, record)

    await ready // throws if the relay rejected the handshake

    // The host may pair before the viewer is watching; streaming starts once
    // the session is active regardless, and the viewer picks frames up when
    // it arrives.
    await postAction('remote-session.activate', { sessionId })
    machine.activate()

    const supportsInput = session.capabilities.includes('screen.input')
    if (supportsInput && platform === 'win32' && typeof inputClientFactory === 'function') {
      record.inputClient = inputClientFactory()
    }
    if (typeof captureFactory !== 'function' || !electron) {
      throw remoteError(
        'capture_unavailable',
        'Screen capture is not available on this device.'
      )
    }
    record.capture = await captureFactory({
      electron,
      onFrame: (jpeg) => {
        const rec = hosted.get(sessionId)
        if (!rec || rec.machine.getState() !== 'active') return
        try {
          client.sendVideo(jpeg)
        } catch {}
      },
      onReady: ({ width, height, scale }) => {
        const rec = hosted.get(sessionId)
        if (!rec) return
        rec.bounds = { width, height }
        try {
          client.sendControl(
            encodeStreamHeader({
              width,
              height,
              scale,
              hostname,
              platform,
            })
          )
        } catch {}
      },
    })
    if (typeof indicatorFactory === 'function') {
      record.indicator = indicatorFactory({ sessionId })
    }
  }

  const pollOnce = async () => {
    const result = await postAction('remote-session.poll', {})
    const sessions = Array.isArray(result?.sessions) ? result.sessions : []
    const seen = new Set()
    for (const session of sessions) {
      const sessionId = session?.sessionId
      if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        continue
      }
      seen.add(sessionId)
      if (hosted.has(sessionId)) continue
      // Active sessions this process is not hosting belong to a previous
      // lifetime; the relay channel is gone, so they cannot be rejoined.
      // End them so the control plane does not strand them forever.
      if (session.state === 'active') {
        await postAction('remote-session.end', { sessionId }).catch(() => {})
        continue
      }
      if (session.state !== 'requested' && session.state !== 'approved') continue

      // Attach this device's per-session ephemeral key and, once approved,
      // receive the session key material. Requested sessions require an
      // active grant (unattended path); owner-approved sessions attach the
      // ephemeral directly (attended path).
      let ephemeral = pendingEphemerals.get(sessionId)
      if (!ephemeral) {
        ephemeral = ephemeralKeyFactory()
        pendingEphemerals.set(sessionId, ephemeral)
      }
      const lastAttempt = approveAttempts.get(sessionId) || 0
      if (approveAttempts.has(sessionId) && now() - lastAttempt < 30_000) {
        continue
      }
      approveAttempts.set(sessionId, now())
      let approval
      try {
        approval = await postAction('remote-session.approve', {
          sessionId,
          workerEphemeralKey: ephemeral.publicKeySpki,
        })
      } catch (error) {
        logger.warn?.(
          `[remote-session] approve ${sessionId} failed: ${error?.code || 'failed'}`
        )
        continue
      }
      const approved = approval?.session
      if (
        approval?.approved !== true ||
        typeof approved?.sessionKey !== 'string' ||
        typeof approved?.relayEndpoint !== 'string' ||
        typeof approved?.expiresAt !== 'string'
      ) {
        continue // pending owner consent or an unusable record
      }
      pendingEphemerals.delete(sessionId)
      try {
        await startHosting(approved, ephemeral)
      } catch (error) {
        logger.warn?.(
          `[remote-session] host ${sessionId} failed: ${error?.code || 'failed'}`
        )
        await stopHosting(sessionId, 'start failed')
        await postAction('remote-session.end', { sessionId }).catch(() => {})
      }
    }
    for (const sessionId of [...hosted.keys()]) {
      if (!seen.has(sessionId)) {
        await stopHosting(sessionId, 'session no longer listed')
      }
    }
    for (const sessionId of [...pendingEphemerals.keys()]) {
      if (!seen.has(sessionId)) pendingEphemerals.delete(sessionId)
    }
  }

  const loop = async () => {
    while (running && !stopped) {
      try {
        await pollOnce()
      } catch (error) {
        logger.warn?.(
          `[remote-session] poll failed: ${error?.code || error?.message || 'failed'}`
        )
      }
      await sleep(pollIntervalMs)
    }
  }

  return {
    start() {
      if (running) return
      running = true
      void loop()
    },
    async stop() {
      stopped = true
      running = false
      await stopAll()
    },
    pollOnce,
    hostingCount() {
      return hosted.size
    },
  }
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  DEFAULT_CAPTURE_FPS,
  DEFAULT_MAX_DIMENSION,
  FRAME_CONTROL,
  FRAME_INPUT,
  FRAME_SESSION_CONTROL,
  FRAME_VIDEO,
  HELLO_LIFETIME_MS,
  INPUT_PIPE_PATH,
  JPEG_QUALITY,
  MAX_CAPTURE_FPS,
  MAX_CONTROL_BYTES,
  MAX_FRAME_BYTES,
  MAX_INPUT_COMMAND_BYTES,
  MAX_INPUT_EVENTS_PER_SECOND,
  REMOTE_INPUT_BUTTONS,
  REMOTE_INPUT_KEYS,
  REMOTE_SESSION_STATES,
  SESSION_ID_PATTERN,
  connectRelaySession,
  createInputHelperClient,
  createInputRateLimiter,
  createRemoteHello,
  createRemoteSessionHostRuntime,
  createRemoteSessionMachine,
  createScreenCapture,
  createSessionIndicator,
  createWireFrameParser,
  decodeStreamHeader,
  decryptFramePayload,
  encodeStreamHeader,
  encodeWireFrame,
  encryptFramePayload,
  generateEphemeralKeyPair,
  normalizeRelayEndpoint,
  normalizeRemoteInputEvent,
  normalizeSessionKey,
  parseSessionControl,
  remoteError,
  resolveInputHelperPath,
  sessionKeyHash,
  spawnInputHelper,
}
