'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  FleetNodeSupervisor,
  publicFailure,
  retryableError,
} = require('./fleet-node-supervisor.cjs')

const DEVICE_ID = `dev_${'a'.repeat(32)}`
const JOB_ID = `job_${'b'.repeat(40)}`
const GRANT_ID = `grant_${'c'.repeat(32)}`

test('transport failures with status zero remain retryable', () => {
  assert.equal(retryableError({ code: 'offline', status: 0 }), true)
  assert.equal(retryableError({ code: 'timeout', status: 0 }), true)
  assert.equal(retryableError({ code: 'invalid_response', status: 0 }), false)
})

test('lease cancellation aborts transport without a stale retry', async () => {
  const controller = new AbortController()
  const reason = { code: 'lease-expired' }
  let requests = 0
  let sleeps = 0
  const supervisor = new FleetNodeSupervisor({
    deviceId: DEVICE_ID,
    postAction: async (_action, _payload, options) => {
      requests += 1
      assert.equal(options.signal, controller.signal)
      controller.abort(reason)
      const error = new Error('unavailable')
      error.status = 503
      throw error
    },
    adapters: {},
    collectHeartbeat: async () => ({}),
    softwareVersion: '1.0.0',
    sleep: async () => {
      sleeps += 1
    },
  })

  await assert.rejects(
    () =>
      supervisor.send('job.event', {}, {
        signal: controller.signal,
      }),
    (error) => error === reason
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

function job(overrides = {}) {
  return {
    id: JOB_ID,
    type: 'test.run',
    objective: 'Run the focused worker test.',
    eventSequence: 0,
    attempt: 1,
    deadlineAt: '2026-08-19T07:00:00.000Z',
    cage: { enabled: true },
    ...overrides,
  }
}

function createHarness({
  adapter,
  renewResult,
  renewHandler,
  transientClaim = false,
  pollResults = null,
  timers = globalThis,
  rejectedEventTypes = [],
  actionError,
  artifactUploader,
  onExecutionStart,
  onExecutionSettled,
  onLeaseAuthorityStart,
  onLeaseAuthorityRenewed,
  onLeaseAuthoritySettled,
} = {}) {
  const calls = []
  let claimAttempts = 0
  let randomCounter = 0
  const transitions = []
  const events = []
  const postAction = async (action, payload) => {
    calls.push({ action, payload })
    const injectedError = actionError?.(action, payload)
    if (injectedError) throw injectedError
    if (action === 'job.poll') {
      if (Array.isArray(pollResults) && pollResults.length > 0) {
        return pollResults.shift()
      }
      return {
        assignment: {
          protocolVersion: 1,
          jobId: JOB_ID,
          jobRevision: 1,
          grantId: GRANT_ID,
        },
        retryAfterMs: 0,
      }
    }
    if (action === 'job.claim') {
      claimAttempts += 1
      if (transientClaim && claimAttempts === 1) {
        const error = new Error('unavailable')
        error.status = 503
        throw error
      }
      return {
        job: job(),
        lease: {
          id: payload.leaseId,
          nonce: payload.leaseNonce,
          jobId: payload.jobId,
          deviceId: DEVICE_ID,
          attempt: 1,
          expiresAt: '2026-08-19T06:31:30.000Z',
        },
      }
    }
    if (action === 'lease.renew') {
      if (renewHandler) return renewHandler(payload)
      return renewResult ? { ...renewResult, leaseId: payload.leaseId } : {
        leaseId: payload.leaseId,
        expiresAt: '2026-08-19T06:31:30.000Z',
        cancellationRequested: false,
        deadlineAt: '2026-08-19T07:00:00.000Z',
      }
    }
    if (action === 'job.event') {
      if (rejectedEventTypes.includes(payload.event.type)) {
        const error = new Error('event rejected')
        error.code = 'permission_denied'
        error.status = 403
        throw error
      }
      events.push(payload.event)
      return {
        accepted: true,
        duplicate: false,
        sequence: payload.event.sequence,
      }
    }
    if (action === 'job.transition') {
      transitions.push(payload)
      return job({ state: payload.state })
    }
    if (action === 'artifact.reserve') {
      return {
        artifact: {
          ...payload.artifact,
          jobId: payload.jobId,
          state: 'uploading',
        },
        upload: { method: 'PUT', url: 'https://storage.googleapis.com/signed' },
      }
    }
    if (action === 'artifact.commit') {
      return {
        id: payload.artifactId,
        jobId: payload.jobId,
        kind: 'xcresult',
        contentHash: 'f'.repeat(64),
        sizeBytes: 42,
        mediaType: 'application/zip',
        state: 'ready',
      }
    }
    if (action === 'heartbeat') {
      return { id: DEVICE_ID, ...payload }
    }
    throw new Error(`Unexpected action ${action}`)
  }
  const supervisor = new FleetNodeSupervisor({
    deviceId: DEVICE_ID,
    postAction,
    adapters: adapter ? { 'test.run': adapter } : {},
    collectHeartbeat: async () => ({
      capabilities: ['workspace.read'],
      resources: {
        cpuLogical: 8,
        cpuAvailable: 6,
        memoryBytes: 16_000_000_000,
        memoryAvailableBytes: 8_000_000_000,
        diskAvailableBytes: 100_000_000_000,
        gpuCount: 0,
        labels: [],
      },
    }),
    softwareVersion: '1.0.0-test',
    now: () => Date.parse('2026-08-19T06:30:00.000Z'),
    timers,
    logger: { warn() {} },
    sleep: async () => {},
    randomHexImpl(bytes) {
      randomCounter += 1
      return randomCounter.toString(16).padStart(bytes * 2, '0')
    },
    randomTokenImpl: () => 'e'.repeat(43),
    artifactUploader,
    onExecutionStart,
    onExecutionSettled,
    onLeaseAuthorityStart,
    onLeaseAuthorityRenewed,
    onLeaseAuthoritySettled,
  })
  return {
    calls,
    events,
    postAction,
    supervisor,
    transitions,
    get claimAttempts() {
      return claimAttempts
    },
  }
}

test('idle polling carries and clears a bounded backend cursor', async () => {
  const cursorJobId = `job_${'d'.repeat(32)}`
  const h = createHarness({
    pollResults: [
      { assignment: null, cursorJobId, retryAfterMs: 250 },
      { assignment: null, cursorJobId: null, retryAfterMs: 5_000 },
    ],
  })
  assert.deepEqual(await h.supervisor.runOnce(), {
    status: 'idle',
    retryAfterMs: 250,
  })
  assert.deepEqual(await h.supervisor.runOnce(), {
    status: 'idle',
    retryAfterMs: 5_000,
  })
  const polls = h.calls.filter((call) => call.action === 'job.poll')
  assert.deepEqual(polls[0].payload, { limit: 20 })
  assert.deepEqual(polls[1].payload, { limit: 20, cursorJobId })
  assert.equal(h.supervisor.pollCursorJobId, null)
})

test('stopping during claim fences the old supervisor before execution', async () => {
  let finishClaim
  let adapterRan = false
  const supervisor = new FleetNodeSupervisor({
    deviceId: DEVICE_ID,
    postAction: async (action, payload) => {
      if (action === 'job.poll') {
        return {
          assignment: {
            protocolVersion: 1,
            jobId: JOB_ID,
            jobRevision: 1,
            grantId: GRANT_ID,
          },
        }
      }
      if (action === 'job.claim') {
        return new Promise((resolve) => {
          finishClaim = () =>
            resolve({
              job: job(),
              lease: {
                id: payload.leaseId,
                nonce: payload.leaseNonce,
                jobId: payload.jobId,
                deviceId: DEVICE_ID,
                attempt: 1,
                expiresAt: '2026-08-19T06:31:30.000Z',
              },
            })
        })
      }
      throw new Error(`Unexpected action ${action}`)
    },
    adapters: {
      'test.run': {
        async run() {
          adapterRan = true
        },
      },
    },
    collectHeartbeat: async () => ({}),
    softwareVersion: '1.0.0',
    now: () => Date.parse('2026-08-19T06:30:00.000Z'),
    sleep: async () => {},
  })

  const pending = supervisor.runOnce()
  await new Promise((resolve) => setImmediate(resolve))
  supervisor.stop()
  finishClaim()
  await assert.rejects(pending, { code: 'local-stop' })
  assert.equal(adapterRan, false)
  assert.equal(supervisor.status().activeJobId, null)
})

test('a worker claims, renews, emits ordered events, and completes a job', async () => {
  let cleaned = 0
  const markerEvents = []
  const authorityEvents = []
  const h = createHarness({
    adapter: {
      async prepare({ emit }) {
        await emit('checkpoint', { phase: 'prepared' })
      },
      async run({ emit, signal }) {
        assert.equal(signal.aborted, false)
        await emit('test', { passed: 4, failed: 0 })
        return { summary: 'Focused tests passed.', passed: 4, failed: 0 }
      },
      async cleanup() {
        cleaned += 1
      },
    },
    transientClaim: true,
    async onExecutionStart(record) {
      markerEvents.push({ type: 'start', record })
    },
    async onExecutionSettled(record) {
      markerEvents.push({ type: 'settled', record })
    },
    async onLeaseAuthorityStart(record) {
      authorityEvents.push({ type: 'start', record })
    },
    async onLeaseAuthorityRenewed(record) {
      authorityEvents.push({ type: 'renewed', record })
    },
    async onLeaseAuthoritySettled(record) {
      authorityEvents.push({ type: 'settled', record })
    },
  })
  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'succeeded')
  assert.equal(h.claimAttempts, 2)
  const claims = h.calls.filter(({ action }) => action === 'job.claim')
  assert.deepEqual(claims[0].payload, claims[1].payload)
  assert.match(claims[0].payload.leaseId, /^lease_[a-f0-9]{32}$/)
  assert.equal(claims[0].payload.leaseNonce, 'e'.repeat(43))
  assert.deepEqual(
    h.transitions.map(({ state }) => state),
    ['preparing', 'running', 'succeeded']
  )
  assert.ok(h.transitions.every(({ transitionId }) => /^op_[a-f0-9]{32}$/.test(transitionId)))
  assert.deepEqual(
    h.events.map(({ sequence, type }) => ({ sequence, type })),
    [
      { sequence: 1, type: 'accepted' },
      { sequence: 2, type: 'preparation' },
      { sequence: 3, type: 'checkpoint' },
      { sequence: 4, type: 'process-start' },
      { sequence: 5, type: 'test' },
      { sequence: 6, type: 'result' },
    ]
  )
  assert.equal(h.supervisor.status().activeJobId, null)
  assert.equal(cleaned, 1)
  assert.deepEqual(markerEvents, [
    {
      type: 'start',
      record: { reason: 'job-active', jobId: JOB_ID, attempt: 1 },
    },
    {
      type: 'settled',
      record: { jobId: JOB_ID, attempt: 1 },
    },
  ])
  assert.deepEqual(
    authorityEvents.map(({ type }) => type),
    ['start', 'renewed', 'renewed', 'renewed', 'settled']
  )
  assert.ok(
    authorityEvents.every(
      ({ record }) =>
        record.jobId === JOB_ID &&
        /^lease_[a-f0-9]{32}$/.test(record.leaseId)
    )
  )
})

test('settlement waits for an in-flight lease renewal before clearing fences', async () => {
  const scheduled = []
  const timers = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false }
      scheduled.push(timer)
      return timer
    },
    clearTimeout(timer) {
      timer.cleared = true
    },
  }
  let renewalCalls = 0
  let releaseRenewal
  let fenceCleared = false
  const h = createHarness({
    timers,
    renewHandler(payload) {
      renewalCalls += 1
      if (renewalCalls === 2) {
        return new Promise((resolve) => {
          releaseRenewal = () =>
            resolve({
              leaseId: payload.leaseId,
              expiresAt: '2026-08-19T06:31:30.000Z',
              cancellationRequested: false,
              deadlineAt: '2026-08-19T07:00:00.000Z',
            })
        })
      }
      return {
        leaseId: payload.leaseId,
        expiresAt: '2026-08-19T06:31:30.000Z',
        cancellationRequested: false,
        deadlineAt: '2026-08-19T07:00:00.000Z',
      }
    },
    adapter: {
      async run() {
        const renewalTimer = scheduled.find(({ delay }) => delay === 20_000)
        void renewalTimer.callback()
        await Promise.resolve()
        return { summary: 'done' }
      },
    },
    async onLeaseAuthorityStart() {},
    async onLeaseAuthorityRenewed() {},
    async onLeaseAuthoritySettled() {
      fenceCleared = true
    },
  })
  let settled = false
  const execution = h.supervisor.runOnce().finally(() => {
    settled = true
  })
  while (renewalCalls < 2) await Promise.resolve()
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(fenceCleared, false)
  releaseRenewal()
  assert.equal((await execution).status, 'succeeded')
  assert.equal(fenceCleared, true)
})

test('known lease expiry aborts local work without publishing stale output', async () => {
  const scheduled = []
  const timers = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false }
      scheduled.push(timer)
      return timer
    },
    clearTimeout(timer) {
      timer.cleared = true
    },
  }
  const h = createHarness({
    timers,
    adapter: {
      async run({ signal }) {
        const expiry = scheduled.find(
          (timer) => timer.delay === 90_000 && !timer.cleared
        )
        assert.ok(expiry)
        expiry.callback()
        assert.equal(signal.aborted, true)
        throw signal.reason
      },
    },
  })
  const result = await h.supervisor.runOnce()
  assert.deepEqual(result, {
    status: 'abandoned',
    jobId: JOB_ID,
    reason: 'lease-expired',
  })
  assert.deepEqual(
    h.transitions.map(({ state }) => state),
    ['preparing', 'running']
  )
  assert.equal(
    h.events.some(({ type }) => type === 'result' || type === 'failure'),
    false
  )
})

test('definitive lease renewal denial aborts local work immediately', async () => {
  const scheduled = []
  let renewCalls = 0
  const timers = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false }
      scheduled.push(timer)
      return timer
    },
    clearTimeout(timer) {
      timer.cleared = true
    },
  }
  const denied = new Error('Grant was revoked.')
  denied.code = 'permission_denied'
  denied.status = 403
  const h = createHarness({
    timers,
    actionError(action) {
      if (action !== 'lease.renew') return null
      renewCalls += 1
      return renewCalls > 1 ? denied : null
    },
    adapter: {
      async run({ signal }) {
        const renewal = scheduled.find(
          (timer) => timer.delay === 20_000 && !timer.cleared
        )
        assert.ok(renewal)
        await renewal.callback()
        assert.equal(signal.aborted, true)
        throw signal.reason
      },
    },
  })

  const result = await h.supervisor.runOnce()
  assert.deepEqual(result, {
    status: 'abandoned',
    jobId: JOB_ID,
    reason: 'lease-authority-lost',
  })
})

test('transient renewal outage keeps work bounded by the acknowledged expiry', async () => {
  const scheduled = []
  let renewCalls = 0
  const timers = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false }
      scheduled.push(timer)
      return timer
    },
    clearTimeout(timer) {
      timer.cleared = true
    },
  }
  const offline = new Error('Coordinator is offline.')
  offline.code = 'offline'
  offline.status = 0
  const h = createHarness({
    timers,
    actionError(action) {
      if (action !== 'lease.renew') return null
      renewCalls += 1
      return renewCalls > 1 ? offline : null
    },
    adapter: {
      async run({ signal }) {
        const renewal = scheduled.find(
          (timer) => timer.delay === 20_000 && !timer.cleared
        )
        assert.ok(renewal)
        await renewal.callback()
        assert.equal(signal.aborted, false)
        const expiry = scheduled.find(
          (timer) => timer.delay === 90_000 && !timer.cleared
        )
        assert.ok(expiry)
        expiry.callback()
        throw signal.reason
      },
    },
  })

  const result = await h.supervisor.runOnce()
  assert.equal(renewCalls, 4)
  assert.deepEqual(result, {
    status: 'abandoned',
    jobId: JOB_ID,
    reason: 'lease-expired',
  })
})

test('lease cancellation aborts before the adapter starts', async () => {
  let ran = false
  let cleaned = false
  const h = createHarness({
    adapter: {
      async run() {
        ran = true
      },
      async cleanup() {
        cleaned = true
      },
    },
    renewResult: {
      leaseId: `lease_${'c'.repeat(32)}`,
      expiresAt: '2026-08-19T05:01:30.000Z',
      cancellationRequested: true,
      deadlineAt: '2026-08-19T07:00:00.000Z',
    },
  })
  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'cancelled')
  assert.equal(ran, false)
  assert.equal(cleaned, true)
  assert.deepEqual(
    h.transitions.map(({ state }) => state),
    ['preparing', 'cancelled']
  )
  assert.equal(
    h.events.some(({ type }) => type === 'cancellation-acknowledged'),
    false
  )
})

test('adapter failures publish only a bounded generic error', async () => {
  const secret = 'sk-' + 'x'.repeat(40)
  const h = createHarness({
    adapter: {
      async run() {
        throw new Error(`Provider leaked ${secret}`)
      },
    },
  })
  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(h.transitions.at(-1).state, 'failed')
  const failure = h.events.find(({ type }) => type === 'failure')
  assert.deepEqual(failure.payload, {
    code: 'adapter_failed',
    message: 'The worker adapter did not complete this job.',
    retryable: false,
  })
  assert.equal(JSON.stringify(h.calls).includes(secret), false)
})

test('an unavailable active-job marker prevents process execution', async () => {
  let ran = false
  const h = createHarness({
    adapter: {
      async run() {
        ran = true
      },
    },
    async onExecutionStart() {
      throw new Error('disk unavailable')
    },
  })

  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(ran, false)
  assert.equal(h.transitions.at(-1).state, 'failed')
  assert.equal(h.supervisor.status().pausedReason, 'worker-marker-unavailable')
})

test('an unavailable lease-authority fence prevents process execution', async () => {
  let ran = false
  let markerCleared = false
  const h = createHarness({
    adapter: {
      async run() {
        ran = true
      },
    },
    async onExecutionStart() {},
    async onExecutionSettled() {
      markerCleared = true
    },
    async onLeaseAuthorityStart() {
      throw new Error('disk unavailable')
    },
  })

  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(ran, false)
  assert.equal(markerCleared, false)
  assert.equal(
    h.supervisor.status().pausedReason,
    'worker-authority-fence-unavailable'
  )
})

test('retryable failures requeue only after confirmed process termination', async () => {
  const h = createHarness({
    adapter: {
      async run() {
        const error = new Error('The isolated process failed transiently.')
        error.code = 'transient_process_failure'
        error.retryable = true
        error.result = { terminationConfirmed: true }
        throw error
      },
    },
  })

  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'retrying')
  assert.deepEqual(
    h.transitions.map(({ state }) => state),
    ['preparing', 'running', 'queued']
  )
  assert.deepEqual(h.transitions.at(-1).retry, {
    code: 'transient_process_failure',
    terminationConfirmed: true,
  })
})

test('ambiguous retryable execution terminates instead of running twice', async () => {
  const h = createHarness({
    adapter: {
      async run() {
        const error = new Error('The execution outcome is unknown.')
        error.code = 'ambiguous_execution'
        error.retryable = true
        throw error
      },
    },
  })

  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'failed')
  assert.deepEqual(
    h.transitions.map(({ state }) => state),
    ['preparing', 'running', 'failed']
  )
})

test('unconfirmed process termination quarantines the worker and workspace', async () => {
  let cleaned = false
  let quarantine = null
  const markerEvents = []
  const h = createHarness({
    adapter: {
      async run() {
        const error = new Error('The child process may still be running.')
        error.code = 'process_failed'
        error.result = { terminationConfirmed: false }
        throw error
      },
      async cleanup() {
        cleaned = true
      },
    },
    async onExecutionStart(record) {
      markerEvents.push({ type: 'start', record })
    },
    async onExecutionSettled(record) {
      markerEvents.push({ type: 'settled', record })
    },
  })
  h.supervisor.onQuarantine = async (record) => {
    quarantine = record
  }

  const result = await h.supervisor.runOnce()
  assert.deepEqual(result, {
    status: 'abandoned',
    jobId: JOB_ID,
    reason: 'process-termination-unconfirmed',
  })
  assert.equal(cleaned, false)
  assert.equal(h.supervisor.status().pausedReason, 'process-termination-unconfirmed')
  assert.deepEqual(quarantine, {
    reason: 'process-termination-unconfirmed',
    jobId: JOB_ID,
    attempt: 1,
  })
  assert.deepEqual(markerEvents, [
    {
      type: 'start',
      record: { reason: 'job-active', jobId: JOB_ID, attempt: 1 },
    },
  ])
  assert.deepEqual(
    h.transitions.map(({ state }) => state),
    ['preparing', 'running']
  )
})

test('terminal cleanup proceeds when a revoked grant rejects failure output', async () => {
  const h = createHarness({
    rejectedEventTypes: ['failure'],
    adapter: {
      async run() {
        const error = new Error('grant changed')
        error.code = 'permission_denied'
        throw error
      },
    },
  })
  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(h.transitions.at(-1).state, 'failed')
  assert.equal(h.events.some(({ type }) => type === 'failure'), false)
})

test('heartbeats report local work without changing coordinator capacity', async () => {
  const h = createHarness()
  const heartbeat = await h.supervisor.heartbeatOnce()
  assert.equal(heartbeat.activeJobs, 0)
  assert.equal(heartbeat.connection, 'relay')
  assert.equal(heartbeat.protocolMinimum, 1)
  assert.equal(heartbeat.softwareVersion, '1.0.0-test')
})

test('an unauthorized device pauses instead of hammering the coordinator', async () => {
  const unauthorized = new Error('Device is not enrolled.')
  unauthorized.code = 'unauthenticated'
  unauthorized.status = 401
  const h = createHarness({
    actionError(action) {
      return action === 'job.poll' ? unauthorized : null
    },
  })

  await assert.rejects(() => h.supervisor.runOnce(), unauthorized)
  assert.deepEqual(h.supervisor.status(), {
    running: false,
    activeJobId: null,
    activeAttempt: null,
    pausedReason: 'authorization-lost',
  })
  h.supervisor.start()
  assert.equal(h.supervisor.status().running, false)
})

test('a revoked device pauses on authoritative polling actions', async () => {
  const revoked = new Error('Device was revoked.')
  revoked.code = 'permission_denied'
  revoked.status = 403
  const h = createHarness({
    actionError(action) {
      return action === 'heartbeat' ? revoked : null
    },
  })

  await assert.rejects(() => h.supervisor.heartbeatOnce(), revoked)
  assert.equal(h.supervisor.status().pausedReason, 'authorization-lost')
})

test('an invalid coordinator signature pauses the worker trust boundary', async () => {
  const invalidSignature = new Error('Coordinator signature changed.')
  invalidSignature.code = 'invalid_response_signature'
  invalidSignature.status = 200
  const h = createHarness({
    actionError(action) {
      return action === 'heartbeat' ? invalidSignature : null
    },
  })

  await assert.rejects(() => h.supervisor.heartbeatOnce(), invalidSignature)
  assert.equal(
    h.supervisor.status().pausedReason,
    'coordinator-trust-lost'
  )
  h.supervisor.start()
  assert.equal(h.supervisor.status().running, false)
})

test('adapters publish lease-bound artifacts before job success', async () => {
  const uploads = []
  let releases = 0
  const h = createHarness({
    artifactUploader: {
      async describeFile(input) {
        return {
          id: input.artifactId,
          filePath: input.filePath,
          kind: input.kind,
          mediaType: input.mediaType,
          contentHash: 'f'.repeat(64),
          contentMd5: 'YWFhYWFhYWFhYWFhYWFhYQ==',
          sizeBytes: 42,
        }
      },
      async uploadFile(input) {
        uploads.push(input)
      },
      async releaseFile() {
        releases += 1
      },
    },
    adapter: {
      async run({ publishArtifact }) {
        const artifact = await publishArtifact({
          filePath: '/private/tmp/result.xcresult.zip',
          kind: 'xcresult',
          mediaType: 'application/zip',
        })
        return { summary: 'Retained.', artifactId: artifact.id }
      },
    },
  })

  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'succeeded')
  assert.equal(uploads.length, 1)
  assert.equal(releases, 1)
  assert.equal(
    h.calls.find(({ action }) => action === 'artifact.reserve').payload.leaseId,
    h.calls.find(({ action }) => action === 'job.claim').payload.leaseId
  )
  assert.equal(h.events.some(({ type }) => type === 'artifact'), true)
  assert.deepEqual(
    h.transitions.map(({ state }) => state),
    ['preparing', 'running', 'succeeded']
  )
})

test('an ambiguous storage response still commits a completed upload', async () => {
  const offline = new Error('Storage response was lost.')
  offline.code = 'artifact_upload_offline'
  const h = createHarness({
    artifactUploader: {
      async describeFile(input) {
        return {
          id: input.artifactId,
          filePath: input.filePath,
          kind: input.kind,
          mediaType: input.mediaType,
          contentHash: 'f'.repeat(64),
          contentMd5: 'YWFhYWFhYWFhYWFhYWFhYQ==',
          sizeBytes: 42,
        }
      },
      async uploadFile() {
        throw offline
      },
    },
    adapter: {
      async run({ publishArtifact }) {
        return publishArtifact({
          filePath: '/private/tmp/result.xcresult.zip',
          kind: 'xcresult',
          mediaType: 'application/zip',
        })
      },
    },
  })

  const result = await h.supervisor.runOnce()
  assert.equal(result.status, 'succeeded')
  assert.equal(h.events.some(({ type }) => type === 'artifact'), true)
})

test('public failures never forward exception messages', () => {
  assert.deepEqual(
    publicFailure({ code: 'tool_failed', message: 'secret password' }),
    {
      code: 'tool_failed',
      message: 'The worker adapter did not complete this job.',
      retryable: false,
    }
  )
})
