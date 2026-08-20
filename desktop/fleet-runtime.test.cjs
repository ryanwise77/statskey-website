'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DEVICE_ONLINE_WINDOW_MS,
  FLEET_PROTOCOL_VERSION,
  canTransitionJob,
  createFleetEvent,
  createLease,
  evaluateCage,
  evaluateDeviceForJob,
  fleetJobAuthorizationDetail,
  grantAllows,
  leaseAuthorizes,
  normalizeCreateJob,
  normalizeDevice,
  normalizeGrant,
  normalizeJob,
  rankDevicesForJob,
  releaseLease,
  renewLease,
  transitionJob,
} = require('./fleet-runtime.cjs')

const NOW = Date.parse('2026-08-19T05:00:00.000Z')
const OWNER = 'owner-123'
const CONTROLLER = `dev_${'1'.repeat(32)}`
const MAC = `dev_${'2'.repeat(32)}`
const WINDOWS = `dev_${'3'.repeat(32)}`
const LAPTOP = `dev_${'4'.repeat(32)}`
const JOB = `job_${'a'.repeat(32)}`
const JOB_2 = `job_${'b'.repeat(32)}`
const GRANT = `grant_${'c'.repeat(32)}`
const COMMIT = 'd'.repeat(40)
const FINGERPRINT = `sha256:${'e'.repeat(43)}`

function device(overrides = {}) {
  return normalizeDevice(
    {
      id: MAC,
      ownerUid: OWNER,
      label: 'Mac mini',
      role: 'worker',
      workerMode: 'dedicated',
      platform: 'darwin',
      status: 'active',
      capabilities: [
        'workspace.read',
        'workspace.snapshot',
        'terminal.run',
        'agent.statskey',
        'xcode.build',
        'xcode.test',
      ],
      resources: {
        cpuLogical: 12,
        cpuAvailable: 10,
        memoryBytes: 32 * 1024 ** 3,
        memoryAvailableBytes: 24 * 1024 ** 3,
        diskAvailableBytes: 500 * 1024 ** 3,
        gpuCount: 1,
      },
      activeJobs: 0,
      maxConcurrentJobs: 2,
      cachedSnapshots: [],
      connection: 'direct',
      publicKeyFingerprint: FINGERPRINT,
      lastSeenAt: NOW,
      ...overrides,
    },
    { at: NOW }
  )
}

function job(overrides = {}) {
  return normalizeJob(
    {
      id: JOB,
      ownerUid: OWNER,
      workspaceId: 'statskey-website',
      type: 'xcode-test',
      objective: 'Run the focused iOS regression suite and retain the xcresult.',
      workspaceSnapshot: {
        kind: 'git',
        repository: 'statskey/website',
        commit: COMMIT,
      },
      execution: {
        kind: 'xcode',
        containerKind: 'project',
        containerPath: 'biometrics/StatsKey.xcodeproj',
        scheme: 'StatsKey',
      },
      requiredCapabilities: [
        'workspace.read',
        'workspace.snapshot',
        'xcode.test',
      ],
      resources: {
        cpuLogical: 4,
        memoryBytes: 8 * 1024 ** 3,
        diskAvailableBytes: 20 * 1024 ** 3,
      },
      dependencies: [],
      exclusiveResources: ['xcode:simulator-lane-1'],
      target: {},
      deadlineAt: NOW + 2 * 60 * 60 * 1000,
      maxAttempts: 2,
      approvalPolicy: 'independent',
      reconciliationPolicy: 'lead',
      idempotencyKey: 'test-run:statskey:001',
      ...overrides,
    },
    { at: NOW }
  )
}

function grant(overrides = {}) {
  return normalizeGrant(
    {
      id: GRANT,
      ownerUid: OWNER,
      controllerDeviceId: CONTROLLER,
      workerDeviceId: MAC,
      workspaceIds: ['statskey-website'],
      repositoryIdentities: ['github.com/statskey/website'],
      capabilities: [
        'workspace.read',
        'workspace.snapshot',
        'xcode.test',
      ],
      unattended: true,
      issuedAt: NOW - 60_000,
      expiresAt: NOW + 24 * 60 * 60 * 1000,
      policyVersion: 1,
      ...overrides,
    },
    { at: NOW }
  )
}

test('normalizes a bounded, versioned worker record', () => {
  const result = device({
    capabilities: ['xcode.test', 'workspace.read', 'xcode.test'],
  })

  assert.equal(result.version, FLEET_PROTOCOL_VERSION)
  assert.deepEqual(result.capabilities, ['workspace.read', 'xcode.test'])
  assert.equal(result.workerMode, 'dedicated')
  assert.equal(result.resources.cpuAvailable, 10)
  assert.equal(result.lastSeenAt, '2026-08-19T05:00:00.000Z')
})

test('device validation rejects unknown support and unsafe identity metadata', () => {
  assert.throws(
    () => device({ capabilities: ['shell.unrestricted'] }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () => device({ status: 'trusted-forever' }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () => device({ publicKeyFingerprint: 'not-a-key' }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () =>
      device({
        resources: {
          cpuLogical: 4,
          cpuAvailable: 8,
          memoryBytes: 8,
          memoryAvailableBytes: 8,
        },
      }),
    { code: 'invalid_argument' }
  )
})

test('job validation binds owner, exact snapshot, deadline, and type capability', () => {
  const result = job()
  assert.equal(result.state, 'queued')
  assert.equal(result.ownerUid, OWNER)
  assert.equal(result.workspaceSnapshot.commit, COMMIT)
  assert.match(result.workspaceSnapshot.snapshotId, /^git:[a-f0-9]{64}$/)
  assert.equal(
    result.workspaceSnapshot.repositoryIdentity,
    'github.com/statskey/website'
  )
  assert.deepEqual(result.exclusiveResources, ['xcode:simulator-lane-1'])
  assert.equal(result.cage.enabled, false)
  assert.equal(result.execution.kind, 'xcode')
  assert.deepEqual(
    job({
      execution: {
        kind: 'xcode',
        containerKind: 'project',
        containerPath: 'biometrics/StatsKey.xcodeproj',
        scheme: 'StatsKey',
        destination: 'platform=iOS Simulator,name=iPhone 17 Pro',
        onlyTesting: ['StatsKeyTests/ActivityHistoryStabilityTests'],
      },
    }).execution,
    {
      kind: 'xcode',
      action: 'test',
      containerKind: 'project',
      containerPath: 'biometrics/StatsKey.xcodeproj',
      scheme: 'StatsKey',
      configuration: 'Debug',
      destination: 'platform=iOS Simulator,name=iPhone 17 Pro',
      onlyTesting: ['StatsKeyTests/ActivityHistoryStabilityTests'],
      timeoutMs: 60 * 60 * 1000,
    }
  )

  assert.throws(
    () =>
      job({
        workspaceSnapshot: {
          kind: 'git',
          repository: '/Users/me/project',
          commit: COMMIT,
        },
      }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () =>
      job({
        workspaceSnapshot: {
          kind: 'git',
          repository: 'https://gitlab.com/statskey/website.git',
          commit: COMMIT,
        },
      }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () =>
      job({
        type: 'windows-build',
        requiredCapabilities: [
          'workspace.read',
          'workspace.snapshot',
          'windows.build',
        ],
        execution: {
          kind: 'command',
          executable: 'node',
          arguments: ['build.js'],
        },
      }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () => job({ requiredCapabilities: ['workspace.read'] }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () =>
      job({
        type: 'agent',
        requiredCapabilities: ['workspace.read', 'workspace.write'],
        execution: null,
      }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () => job({ deadlineAt: NOW + 31 * 24 * 60 * 60 * 1000 }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () =>
      job({
        execution: {
          kind: 'command',
          executable: '/bin/sh',
        },
      }),
    { code: 'invalid_argument' }
  )
  assert.throws(
    () => normalizeJob({...job(), ownerUid: 'attacker'}, {ownerUid: OWNER, at: NOW}),
    { code: 'permission_denied' }
  )
})

test('create-job authorization normalizes input before coordinator ID assignment', () => {
  const createInput = { ...job() }
  delete createInput.id
  delete createInput.ownerUid
  const normalized = normalizeCreateJob(createInput, {
    ownerUid: OWNER,
    at: NOW,
  })
  assert.equal(normalized.id, undefined)
  assert.equal(normalized.ownerUid, OWNER)
  assert.match(
    fleetJobAuthorizationDetail(normalized),
    /Job ID: Assigned by coordinator/
  )
})

test('command arguments are bounded for the Windows process-owner transport', () => {
  assert.throws(
    () =>
      job({
        type: 'command',
        requiredCapabilities: [
          'workspace.read',
          'workspace.snapshot',
          'terminal.run',
        ],
        execution: {
          kind: 'command',
          executable: 'node',
          arguments: Array.from({ length: 7 }, () => 'x'.repeat(2_000)),
          workingDirectory: '.',
          timeoutMs: 60_000,
        },
      }),
    { code: 'payload_too_large' }
  )
})

test('native job approval discloses the complete bounded execution contract', () => {
  const command = job({
    type: 'command',
    objective: 'first line\nsecurity-sensitive tail',
    requiredCapabilities: [
      'workspace.read',
      'workspace.snapshot',
      'terminal.run',
    ],
    execution: {
      kind: 'command',
      executable: 'node',
      arguments: ['-e', 'process.stdout.write("ok")'],
      workingDirectory: 'scripts',
      timeoutMs: 90_000,
    },
  })
  const detail = fleetJobAuthorizationDetail(command)
  assert.match(
    detail,
    /Objective \(JSON\): "first line\\nsecurity-sensitive tail"/
  )
  assert.match(
    detail,
    /Arguments \(JSON\): \["-e","process\.stdout\.write\(\\?"ok\\?"\)"\]/
  )
  assert.match(detail, /Working directory \(JSON\): "scripts"/)
  assert.match(detail, /Execution timeout: 90000 ms/)

  const xcodeDetail = fleetJobAuthorizationDetail(
    job({
      execution: {
        kind: 'xcode',
        containerKind: 'workspace',
        containerPath: 'StatsKey.xcworkspace',
        scheme: 'StatsKey',
        configuration: 'Release',
        destination: 'platform=iOS Simulator,name=iPhone 17 Pro',
        onlyTesting: ['StatsKeyTests/AuthorizationTests'],
        timeoutMs: 120_000,
      },
    })
  )
  assert.match(xcodeDetail, /Configuration \(JSON\): "Release"/)
  assert.match(xcodeDetail, /Destination \(JSON\): "platform=iOS Simulator/)
  assert.match(
    xcodeDetail,
    /Only testing \(JSON\): \["StatsKeyTests\/AuthorizationTests"\]/
  )

  assert.throws(
    () => fleetJobAuthorizationDetail(job({ objective: 'x'.repeat(11_900) })),
    { code: 'invalid_argument' }
  )
})

test('grant authorization is owner, worker, workspace, capability, and time bound', () => {
  const candidate = job()
  const worker = device()
  assert.equal(grantAllows(grant(), candidate, worker, NOW), true)
  assert.equal(
    grantAllows(
      grant({workspaceIds: ['another-workspace']}),
      candidate,
      worker,
      NOW
    ),
    false
  )
  assert.equal(
    grantAllows(
      grant({repositoryIdentities: ['github.com/attacker/unreviewed-code']}),
      candidate,
      worker,
      NOW
    ),
    false
  )
  assert.equal(
    grantAllows(
      grant({capabilities: ['workspace.read', 'xcode.test']}),
      candidate,
      worker,
      NOW
    ),
    false
  )
  assert.equal(
    grantAllows(
      grant({
        issuedAt: NOW - 10_000,
        expiresAt: NOW - 1,
      }),
      candidate,
      worker,
      NOW
    ),
    false
  )
  assert.equal(grantAllows(grant({unattended: false}), candidate, worker, NOW), false)
  assert.throws(() => grant({ policyVersion: 2 }), { code: 'invalid_argument' })
})

test('scheduler excludes the laptop unless its workspace opted in', () => {
  const candidate = job()
  const mac = device()
  const laptop = device({
    id: LAPTOP,
    label: 'Laptop',
    role: 'hybrid',
    workerMode: 'opt-in',
    activeJobs: 0,
    resources: {
      cpuLogical: 24,
      cpuAvailable: 24,
      memoryBytes: 64 * 1024 ** 3,
      memoryAvailableBytes: 60 * 1024 ** 3,
      diskAvailableBytes: 900 * 1024 ** 3,
      gpuCount: 2,
    },
  })
  const grants = [
    grant(),
    grant({
      id: `grant_${'f'.repeat(32)}`,
      workerDeviceId: LAPTOP,
    }),
  ]
  const ranked = rankDevicesForJob(candidate, [laptop, mac], grants, {at: NOW})
  assert.equal(ranked[0].device.id, MAC)
  assert.equal(ranked[0].evaluation.eligible, true)
  assert.deepEqual(ranked[1].evaluation.reasons, ['worker-not-opted-in'])
})

test('an explicit target can opt the laptop into the active job', () => {
  const candidate = job({
    target: {
      deviceIds: [LAPTOP],
      allowControllerAsWorker: true,
    },
  })
  const laptop = device({
    id: LAPTOP,
    label: 'Laptop',
    role: 'hybrid',
    workerMode: 'opt-in',
  })
  const access = grant({
    workerDeviceId: LAPTOP,
  })
  const evaluation = evaluateDeviceForJob(candidate, laptop, [access], {at: NOW})
  assert.equal(evaluation.eligible, true)
  assert.ok(evaluation.score >= 10_000)
  const reviewOnly = evaluateDeviceForJob(
    job({
      approvalPolicy: 'review',
      target: {
        deviceIds: [LAPTOP],
        allowControllerAsWorker: true,
      },
    }),
    laptop,
    [access],
    {at: NOW}
  )
  assert.equal(reviewOnly.eligible, false)
  assert.ok(reviewOnly.reasons.includes('approval-required'))
})

test('scheduler reports capability, grant, resource, and presence failures', () => {
  const candidate = job()
  const unavailable = device({
    capabilities: ['workspace.read'],
    resources: {
      cpuLogical: 2,
      cpuAvailable: 1,
      memoryBytes: 4 * 1024 ** 3,
      memoryAvailableBytes: 2 * 1024 ** 3,
      diskAvailableBytes: 1,
      gpuCount: 0,
    },
    lastSeenAt: NOW - DEVICE_ONLINE_WINDOW_MS - 1,
  })
  const evaluation = evaluateDeviceForJob(candidate, unavailable, [], {at: NOW})
  assert.equal(evaluation.eligible, false)
  assert.deepEqual(
    new Set(evaluation.reasons),
    new Set([
      'device-offline',
      'capability-unavailable',
      'grant-missing',
      'cpu-insufficient',
      'memory-insufficient',
      'disk-insufficient',
    ])
  )
})

test('lease credentials are hashed, scoped, renewable, and expiring', () => {
  let byte = 1
  const random = (size) => {
    const value = Buffer.alloc(size, byte)
    byte += 1
    return value
  }
  const candidate = job()
  const worker = device()
  const {record, credential} = createLease({
    job: candidate,
    device: worker,
    attempt: 1,
    resourceKeys: candidate.exclusiveResources,
    at: NOW,
    ttlMs: 30_000,
    random,
  })

  assert.match(record.id, /^lease_[a-f0-9]{32}$/)
  assert.equal(JSON.stringify(record).includes(credential.nonce), false)
  assert.equal(
    leaseAuthorizes(record, credential, {
      jobId: JOB,
      deviceId: MAC,
      attempt: 1,
      at: NOW + 29_999,
    }),
    true
  )
  assert.equal(
    leaseAuthorizes(record, {...credential, nonce: 'wrong'}, {
      jobId: JOB,
      deviceId: MAC,
      attempt: 1,
      at: NOW,
    }),
    false
  )
  assert.equal(
    leaseAuthorizes(record, credential, {
      jobId: JOB,
      deviceId: MAC,
      attempt: 1,
      at: NOW + 30_000,
    }),
    false
  )

  const renewed = renewLease(record, credential, {
    at: NOW + 10_000,
    ttlMs: 60_000,
  })
  assert.equal(renewed.expiresAt, '2026-08-19T05:01:10.000Z')
  const released = releaseLease(renewed, NOW + 11_000)
  assert.equal(
    leaseAuthorizes(released, credential, {
      jobId: JOB,
      deviceId: MAC,
      attempt: 1,
      at: NOW + 12_000,
    }),
    false
  )
})

test('job state transitions are explicit and terminal states are immutable', () => {
  const candidate = job()
  assert.equal(canTransitionJob('queued', 'running'), false)
  const leased = transitionJob(candidate, 'leased', {
    deviceId: MAC,
    attempt: 1,
    at: NOW + 1,
  })
  const preparing = transitionJob(leased, 'preparing', {at: NOW + 2})
  const running = transitionJob(preparing, 'running', {at: NOW + 3})
  const review = transitionJob(running, 'needs_review', {at: NOW + 4})
  const resumed = transitionJob(review, 'running', {at: NOW + 5})
  const succeeded = transitionJob(resumed, 'succeeded', {at: NOW + 6})
  assert.equal(succeeded.assignedDeviceId, MAC)
  assert.equal(succeeded.attempt, 1)
  assert.equal(succeeded.finishedAt, '2026-08-19T05:00:00.006Z')
  assert.throws(
    () => transitionJob(succeeded, 'running', {at: NOW + 7}),
    { code: 'failed_precondition' }
  )
})

test('events require a current lease and exactly monotonic sequence', () => {
  let byte = 7
  const random = (size) => Buffer.alloc(size, byte++)
  const candidate = job()
  const worker = device()
  const {record, credential} = createLease({
    job: candidate,
    device: worker,
    attempt: 1,
    at: NOW,
    random,
  })
  const event = createFleetEvent({
    job: candidate,
    lease: record,
    credential,
    deviceId: MAC,
    attempt: 1,
    sequence: 1,
    type: 'test',
    payload: {suite: 'StatsKeyTests', passed: 42, failed: 0},
    at: NOW + 1,
  })
  assert.equal(event.sequence, 1)
  assert.match(event.payloadDigest, /^[a-f0-9]{64}$/)

  assert.throws(
    () =>
      createFleetEvent({
        job: candidate,
        lease: record,
        credential,
        deviceId: MAC,
        attempt: 1,
        sequence: 2,
        type: 'log',
        payload: {},
        at: NOW + 2,
      }),
    { code: 'conflict' }
  )
  assert.throws(
    () =>
      createFleetEvent({
        job: {...candidate, eventSequence: 1},
        lease: record,
        credential,
        deviceId: MAC,
        attempt: 1,
        sequence: 2,
        type: 'log',
        payload: {authorization: 'Bearer secret'},
        at: NOW + 2,
      }),
    { code: 'invalid_argument' }
  )
})

test('stale leases cannot emit results for a later attempt', () => {
  const random = (size) => Buffer.alloc(size, 9)
  const candidate = job()
  const {record, credential} = createLease({
    job: candidate,
    device: device(),
    attempt: 1,
    at: NOW,
    random,
  })
  assert.throws(
    () =>
      createFleetEvent({
        job: candidate,
        lease: record,
        credential,
        deviceId: MAC,
        attempt: 2,
        sequence: 1,
        type: 'result',
        payload: {ok: true},
        at: NOW + 1,
      }),
    { code: 'permission_denied' }
  )
})

test('the cage is opt-in and security boundaries stay hard', () => {
  assert.deepEqual(evaluateCage(null), {
    action: 'continue',
    reasons: [],
    enabled: false,
  })
  assert.deepEqual(
    evaluateCage(
      {enabled: true},
      {securityViolation: true}
    ),
    {
      action: 'cancel',
      reasons: ['hard-security-boundary'],
      enabled: true,
    }
  )
})

test('the cage gives nearly complete work bounded spend grace', () => {
  const policy = {
    enabled: true,
    maxSpendUsd: 10,
    maxOverrunFraction: 0.15,
  }
  const graceful = evaluateCage(policy, {
    spendUsd: 9.8,
    estimatedRemainingUsd: 1,
    completionRatio: 0.92,
  })
  assert.deepEqual(graceful, {
    action: 'stop-spawning',
    reasons: ['completion-grace'],
    enabled: true,
  })

  const incomplete = evaluateCage(policy, {
    spendUsd: 9,
    estimatedRemainingUsd: 1.8,
    completionRatio: 0.4,
  })
  assert.equal(incomplete.action, 'checkpoint-review')
  assert.deepEqual(incomplete.reasons, ['spend-soft-limit'])
})

test('the cage pauses for drift and stops new fan-out at soft limits', () => {
  assert.deepEqual(
    evaluateCage(
      {enabled: true},
      {objectiveDrift: true}
    ),
    {
      action: 'checkpoint-review',
      reasons: ['objective-drift'],
      enabled: true,
    }
  )
  const result = evaluateCage(
    {
      enabled: true,
      maxToolCalls: 10,
      maxChildJobs: 2,
    },
    {
      toolCalls: 10,
      childJobs: 2,
    }
  )
  assert.equal(result.action, 'stop-spawning')
  assert.deepEqual(result.reasons, ['tool-call-limit', 'child-job-limit'])
})

test('dependencies cannot self-reference', () => {
  assert.throws(
    () => job({dependencies: [JOB, JOB_2]}),
    { code: 'invalid_argument' }
  )
})
