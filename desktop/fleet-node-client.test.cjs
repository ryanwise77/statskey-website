const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const {
  deviceIdentityForPublicKey,
  createSignedDeviceResponse,
  exportPublicKeySpki,
  verifySignedDeviceRequest,
} = require('./fleet-auth-runtime.cjs')
const {
  createFleetDeviceTransport,
  FleetNodeClientError,
  normalizeFleetDeviceEndpoint,
  postFleetDeviceAction,
} = require('./fleet-node-client.cjs')

const NOW = Date.parse('2026-08-19T06:45:00.000Z')

function identity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeySpki = exportPublicKeySpki(publicKey)
  return {
    privateKey,
    publicKeySpki,
    ...deviceIdentityForPublicKey(publicKeySpki),
  }
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function signedSuccess(requestBody, coordinator, result, dataOverrides = {}) {
  const data = {
    action: requestBody.action,
    deviceId: requestBody.envelope.deviceId,
    requestId: requestBody.envelope.requestId,
    result,
    ...dataOverrides,
  }
  data.responseSignature = createSignedDeviceResponse({
    privateKey: coordinator.privateKey,
    keyId: 'workbench-2026-01',
    deviceId: data.deviceId,
    requestId: data.requestId,
    action: data.action,
    result: data.result,
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
  })
  return response(200, { data })
}

test('device transport signs an exact action without bearer headers', async () => {
  const device = identity()
  const coordinator = identity()
  const payload = {
    capabilities: ['workspace.read'],
    resources: { cpuLogical: 8 },
  }
  let captured
  const result = await postFleetDeviceAction({
    endpoint: 'https://us-central1.example.test/workbenchDeviceApi',
    privateKey: device.privateKey,
    deviceId: device.deviceId,
    coordinatorPublicKeySpki: coordinator.publicKeySpki,
    coordinatorKeyId: 'workbench-2026-01',
    action: 'heartbeat',
    payload,
    now: NOW,
    fetchImpl: async (_url, request) => {
      captured = request
      const body = JSON.parse(request.body)
      verifySignedDeviceRequest({
        publicKeySpki: device.publicKeySpki,
        envelope: body.envelope,
        payload: body.payload,
        expectedAction: 'heartbeat',
        now: NOW,
      })
      return signedSuccess(body, coordinator, { accepted: true })
    },
  })

  assert.deepEqual(result, { accepted: true })
  assert.equal(captured.method, 'POST')
  assert.equal(captured.redirect, 'error')
  assert.equal(captured.headers.Authorization, undefined)
  assert.equal(JSON.stringify(captured).includes('PRIVATE KEY'), false)
})

test('response signatures are verified at receipt time', async () => {
  const device = identity()
  const coordinator = identity()
  let clock = NOW
  const result = await postFleetDeviceAction({
    endpoint: 'https://fleet.statskey.ai/device',
    privateKey: device.privateKey,
    deviceId: device.deviceId,
    coordinatorPublicKeySpki: coordinator.publicKeySpki,
    coordinatorKeyId: 'workbench-2026-01',
    action: 'heartbeat',
    payload: {},
    now: () => clock,
    fetchImpl: async (_url, request) => {
      const requestBody = JSON.parse(request.body)
      assert.equal(requestBody.envelope.issuedAt, NOW)
      clock += 45_000
      const data = {
        action: requestBody.action,
        deviceId: requestBody.envelope.deviceId,
        requestId: requestBody.envelope.requestId,
        result: { accepted: true },
      }
      data.responseSignature = createSignedDeviceResponse({
        privateKey: coordinator.privateKey,
        keyId: 'workbench-2026-01',
        deviceId: data.deviceId,
        requestId: data.requestId,
        action: data.action,
        result: data.result,
        issuedAt: clock,
        expiresAt: clock + 60_000,
      })
      return response(200, { data })
    },
  })

  assert.deepEqual(result, { accepted: true })
})

test('a bound device transport supplies identity without exposing it to adapters', async () => {
  const device = identity()
  const coordinator = identity()
  const transport = createFleetDeviceTransport({
    endpoint: 'https://fleet.statskey.ai/device',
    privateKey: device.privateKey,
    deviceId: device.deviceId,
    coordinatorPublicKeySpki: coordinator.publicKeySpki,
    coordinatorKeyId: 'workbench-2026-01',
    now: NOW,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      return signedSuccess(body, coordinator, { accepted: true })
    },
  })
  assert.deepEqual(await transport('heartbeat', { activeJobs: 0 }), {
    accepted: true,
  })
})

test('device endpoints require credential-free HTTPS outside loopback', () => {
  const device = identity()
  const coordinator = identity()
  assert.equal(
    normalizeFleetDeviceEndpoint('https://fleet.statskey.ai/device/'),
    'https://fleet.statskey.ai/device'
  )
  assert.equal(
    normalizeFleetDeviceEndpoint('http://127.0.0.1:5001/device', {
      allowLoopback: true,
    }),
    'http://127.0.0.1:5001/device'
  )
  assert.doesNotThrow(() =>
    createFleetDeviceTransport({
      endpoint: 'http://127.0.0.1:5001/device',
      allowLoopback: true,
      privateKey: device.privateKey,
      deviceId: device.deviceId,
      coordinatorPublicKeySpki: coordinator.publicKeySpki,
      coordinatorKeyId: 'workbench-2026-01',
    })
  )
  for (const endpoint of [
    'http://fleet.statskey.ai/device',
    'https://user:pass@fleet.statskey.ai/device',
    'https://fleet.statskey.ai/device?token=secret',
    'file:///tmp/socket',
  ]) {
    assert.throws(() => normalizeFleetDeviceEndpoint(endpoint), {
      code: 'invalid_endpoint',
    })
  }
})

test('transport rejects unsupported actions and unbound responses', async () => {
  const device = identity()
  const coordinator = identity()
  await assert.rejects(
    () =>
      postFleetDeviceAction({
        endpoint: 'https://fleet.statskey.ai/device',
        privateKey: device.privateKey,
        deviceId: device.deviceId,
        coordinatorPublicKeySpki: coordinator.publicKeySpki,
        coordinatorKeyId: 'workbench-2026-01',
        action: 'shell.run',
        payload: {},
        now: NOW,
        fetchImpl: async () => response(200, {}),
      }),
    { code: 'invalid_action' }
  )
  await assert.rejects(
    () =>
      postFleetDeviceAction({
        endpoint: 'https://fleet.statskey.ai/device',
        privateKey: device.privateKey,
        deviceId: device.deviceId,
        coordinatorPublicKeySpki: coordinator.publicKeySpki,
        coordinatorKeyId: 'workbench-2026-01',
        action: 'heartbeat',
        payload: {},
        now: NOW,
        fetchImpl: async () =>
          response(200, {
            data: {
              action: 'job.event',
              deviceId: device.deviceId,
              result: {},
            },
          }),
      }),
    { code: 'invalid_response' }
  )
  await assert.rejects(
    () =>
      postFleetDeviceAction({
        endpoint: 'https://fleet.statskey.ai/device',
        privateKey: device.privateKey,
        deviceId: device.deviceId,
        coordinatorPublicKeySpki: coordinator.publicKeySpki,
        coordinatorKeyId: 'workbench-2026-01',
        action: 'heartbeat',
        payload: {},
        now: NOW,
        fetchImpl: async (_url, request) => {
          const body = JSON.parse(request.body)
          return response(200, {
            data: {
              action: body.action,
              deviceId: body.envelope.deviceId,
              requestId: `req_${'f'.repeat(32)}`,
              result: {},
            },
          })
        },
      }),
    { code: 'invalid_response' }
  )
  await assert.rejects(
    () =>
      postFleetDeviceAction({
        endpoint: 'https://fleet.statskey.ai/device',
        privateKey: device.privateKey,
        deviceId: device.deviceId,
        coordinatorPublicKeySpki: coordinator.publicKeySpki,
        coordinatorKeyId: 'workbench-2026-01',
        action: 'heartbeat',
        payload: {},
        now: NOW,
        fetchImpl: async (_url, request) => {
          const body = JSON.parse(request.body)
          const signed = signedSuccess(body, coordinator, { accepted: true })
          const responseBody = JSON.parse(await signed.text())
          responseBody.data.result.accepted = false
          return response(200, responseBody)
        },
      }),
    { code: 'invalid_response_signature' }
  )
})

test('service failures stay bounded and cancellation aborts transport', async () => {
  const device = identity()
  const coordinator = identity()
  let streamCancelled = false
  let streamPulls = 0
  await assert.rejects(
    () =>
      postFleetDeviceAction({
        endpoint: 'https://fleet.statskey.ai/device',
        privateKey: device.privateKey,
        deviceId: device.deviceId,
        coordinatorPublicKeySpki: coordinator.publicKeySpki,
        coordinatorKeyId: 'workbench-2026-01',
        action: 'heartbeat',
        payload: {},
        now: NOW,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                streamPulls += 1
                controller.enqueue(new Uint8Array(70 * 1024))
              },
              cancel() {
                streamCancelled = true
              },
            }),
            { status: 200 }
          ),
      }),
    { code: 'invalid_response' }
  )
  assert.equal(streamCancelled, true)
  assert.equal(streamPulls < 10, true)

  await assert.rejects(
    () =>
      postFleetDeviceAction({
        endpoint: 'https://fleet.statskey.ai/device',
        privateKey: device.privateKey,
        deviceId: device.deviceId,
        coordinatorPublicKeySpki: coordinator.publicKeySpki,
        coordinatorKeyId: 'workbench-2026-01',
        action: 'heartbeat',
        payload: {},
        now: NOW,
        fetchImpl: async () =>
          response(409, {
            error: { code: 'replayed_request', message: 'Already used.' },
          }),
      }),
    (error) => {
      assert.equal(error instanceof FleetNodeClientError, true)
      assert.equal(error.code, 'replayed_request')
      assert.equal(error.status, 409)
      return true
    }
  )

  const controller = new AbortController()
  const pending = postFleetDeviceAction({
    endpoint: 'https://fleet.statskey.ai/device',
    privateKey: device.privateKey,
    deviceId: device.deviceId,
    coordinatorPublicKeySpki: coordinator.publicKeySpki,
    coordinatorKeyId: 'workbench-2026-01',
    action: 'heartbeat',
    payload: {},
    now: NOW,
    signal: controller.signal,
    fetchImpl: async (_url, request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
  })
  controller.abort()
  await assert.rejects(pending, { code: 'cancelled' })
})
