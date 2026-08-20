const {
  createSignedDeviceRequest,
  DEVICE_ID_PATTERN,
  normalizePublicKeySpki,
  verifySignedDeviceResponse,
} = require('./fleet-auth-runtime.cjs')

const DEVICE_ACTIONS = new Set([
  'device.status',
  'heartbeat',
  'job.poll',
  'job.claim',
  'lease.renew',
  'job.event',
  'job.transition',
  'artifact.reserve',
  'artifact.commit',
  'remote-session.poll',
  'remote-session.approve',
  'remote-session.activate',
  'remote-session.end',
])
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 256 * 1024

function currentTime(clock) {
  const value = typeof clock === 'function' ? clock() : clock
  const millis = Number(value)
  if (!Number.isInteger(millis) || millis < 0) {
    throw new FleetNodeClientError('Fleet transport clock is invalid.', {
      code: 'invalid_clock',
    })
  }
  return millis
}

class FleetNodeClientError extends Error {
  constructor(message, { code = 'fleet_request_failed', status = 0 } = {}) {
    super(message)
    this.name = 'FleetNodeClientError'
    this.code = code
    this.status = status
  }
}

function normalizeFleetDeviceEndpoint(value, { allowLoopback = false } = {}) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw new FleetNodeClientError('Fleet device endpoint is invalid.', {
      code: 'invalid_endpoint',
    })
  }
  const loopback =
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost' ||
    url.hostname === '::1'
  if (
    (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    url.pathname.split('/').includes('..')
  ) {
    throw new FleetNodeClientError('Fleet device endpoint is not trusted.', {
      code: 'invalid_endpoint',
    })
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString()
}

function normalizeAction(action) {
  if (!DEVICE_ACTIONS.has(action)) {
    throw new FleetNodeClientError('Fleet device action is not supported.', {
      code: 'invalid_action',
    })
  }
  return action
}

async function postFleetDeviceAction({
  endpoint,
  privateKey,
  deviceId,
  action,
  payload,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  allowLoopback = false,
  coordinatorPublicKeySpki,
  coordinatorKeyId,
}) {
  const url = normalizeFleetDeviceEndpoint(endpoint, { allowLoopback })
  if (!DEVICE_ID_PATTERN.test(String(deviceId || ''))) {
    throw new FleetNodeClientError('Fleet device identity is invalid.', {
      code: 'invalid_device',
    })
  }
  const boundedTimeout = Math.max(
    1_000,
    Math.min(60_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  )
  if (typeof fetchImpl !== 'function') {
    throw new FleetNodeClientError('Fleet transport is unavailable.', {
      code: 'transport_unavailable',
    })
  }
  const actionName = normalizeAction(action)
  if (
    typeof coordinatorKeyId !== 'string' ||
    !/^[a-z][a-z0-9._-]{2,63}$/.test(coordinatorKeyId)
  ) {
    throw new FleetNodeClientError('Fleet coordinator trust is invalid.', {
      code: 'invalid_coordinator_trust',
    })
  }
  try {
    normalizePublicKeySpki(coordinatorPublicKeySpki)
  } catch {
    throw new FleetNodeClientError('Fleet coordinator trust is invalid.', {
      code: 'invalid_coordinator_trust',
    })
  }
  const requestTime = currentTime(now)
  const envelope = createSignedDeviceRequest({
    privateKey,
    deviceId,
    action: actionName,
    payload,
    issuedAt: requestTime,
    expiresAt: requestTime + Math.min(60_000, boundedTimeout + 15_000),
  })
  const requestBody = JSON.stringify({
    action: actionName,
    payload,
    envelope,
  })
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), boundedTimeout)
  timeout.unref?.()
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: requestBody,
      redirect: 'error',
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
    if (controller.signal.aborted) {
      throw new FleetNodeClientError(
        signal?.aborted ? 'Fleet request was cancelled.' : 'Fleet request timed out.',
        {
          code: signal?.aborted ? 'cancelled' : 'timeout',
        }
      )
    }
    throw new FleetNodeClientError('Fleet coordinator is unreachable.', {
      code: 'offline',
    })
  }

  let text
  try {
    text = await readBoundedResponse(response)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FleetNodeClientError(
        signal?.aborted ? 'Fleet request was cancelled.' : 'Fleet request timed out.',
        {
          code: signal?.aborted ? 'cancelled' : 'timeout',
        }
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new FleetNodeClientError('Fleet coordinator returned invalid JSON.', {
      code: 'invalid_response',
      status: response.status,
    })
  }
  if (!response.ok || !body?.data) {
    const serviceMessage =
      typeof body?.error?.message === 'string'
        ? body.error.message.trim().slice(0, 300)
        : ''
    const serviceCode =
      typeof body?.error?.code === 'string'
        ? body.error.code.trim().slice(0, 64)
        : 'fleet_request_failed'
    throw new FleetNodeClientError(
      serviceMessage || `Fleet request failed (${response.status}).`,
      {
        code: serviceCode,
        status: Number(response.status) || 0,
      }
    )
  }
  if (
    body.data.action !== actionName ||
    body.data.deviceId !== deviceId ||
    body.data.requestId !== envelope.requestId ||
    !body.data.responseSignature ||
    !Object.prototype.hasOwnProperty.call(body.data, 'result')
  ) {
    throw new FleetNodeClientError('Fleet coordinator response was not bound to this request.', {
      code: 'invalid_response',
      status: response.status,
    })
  }
  try {
    verifySignedDeviceResponse({
      publicKeySpki: coordinatorPublicKeySpki,
      envelope: body.data.responseSignature,
      deviceId,
      requestId: envelope.requestId,
      action: actionName,
      result: body.data.result,
      keyId: coordinatorKeyId,
      now: currentTime(now),
    })
  } catch {
    throw new FleetNodeClientError(
      'Fleet coordinator response signature is invalid.',
      {
        code: 'invalid_response_signature',
        status: response.status,
      }
    )
  }
  return body.data.result
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BYTES
  ) {
    try {
      await response.body?.cancel?.()
    } catch {}
    throw new FleetNodeClientError('Fleet coordinator response is too large.', {
      code: 'invalid_response',
      status: response.status,
    })
  }
  if (typeof response.body?.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {})
          throw new FleetNodeClientError(
            'Fleet coordinator response is too large.',
            {
              code: 'invalid_response',
              status: response.status,
            }
          )
        }
        chunks.push(chunk)
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks, size).toString('utf8')
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new FleetNodeClientError('Fleet coordinator response is too large.', {
      code: 'invalid_response',
      status: response.status,
    })
  }
  return text
}

function createFleetDeviceTransport(options = {}) {
  const endpoint = normalizeFleetDeviceEndpoint(options.endpoint, {
    allowLoopback: options.allowLoopback === true,
  })
  if (typeof options.deviceId !== 'string' || !DEVICE_ID_PATTERN.test(options.deviceId)) {
    throw new FleetNodeClientError('Fleet device id is invalid.', {
      code: 'invalid_device',
    })
  }
  if (!options.privateKey) {
    throw new FleetNodeClientError('Fleet private key is required.', {
      code: 'invalid_device',
    })
  }
  if (
    typeof options.coordinatorKeyId !== 'string' ||
    !options.coordinatorPublicKeySpki
  ) {
    throw new FleetNodeClientError('Fleet coordinator trust is required.', {
      code: 'invalid_coordinator_trust',
    })
  }
  return (action, payload, requestOptions = {}) =>
    postFleetDeviceAction({
      ...options,
      ...requestOptions,
      endpoint,
      action,
      payload,
    })
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEVICE_ACTIONS,
  FleetNodeClientError,
  createFleetDeviceTransport,
  normalizeFleetDeviceEndpoint,
  postFleetDeviceAction,
}
