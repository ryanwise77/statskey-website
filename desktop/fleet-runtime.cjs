const {
  createHash,
  randomBytes,
  timingSafeEqual,
} = require('node:crypto')

const FLEET_PROTOCOL_VERSION = 1
const DEVICE_ONLINE_WINDOW_MS = 90_000
const DEFAULT_LEASE_TTL_MS = 45_000
const MIN_LEASE_TTL_MS = 15_000
const MAX_LEASE_TTL_MS = 120_000
const MAX_JOB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const MAX_EVENT_BYTES = 64 * 1024
const MAX_NORMALIZED_JOB_BYTES = 96 * 1024
const MAX_OBJECT_DEPTH = 8
const MAX_OBJECT_KEYS = 400
const MAX_COMMAND_ARGUMENT_BYTES = 12 * 1024
const FLEET_REPOSITORY_HOSTS = Object.freeze([
  'github.com',
  'origin.cursor.com',
])
const FLEET_REPOSITORY_HOST_SET = new Set(FLEET_REPOSITORY_HOSTS)

const DEVICE_ID_PATTERN = /^dev_[a-f0-9]{32}$/
const JOB_ID_PATTERN = /^job_[a-f0-9]{32}$/
const GRANT_ID_PATTERN = /^grant_[a-f0-9]{32}$/
const LEASE_ID_PATTERN = /^lease_[a-f0-9]{32}$/
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const PUBLIC_KEY_FINGERPRINT_PATTERN = /^sha256:[A-Za-z0-9_-]{32,96}$/

const FLEET_CAPABILITIES = Object.freeze([
  'workspace.read',
  'workspace.snapshot',
  'workspace.write',
  'terminal.run',
  'git.inspect',
  'git.mutate',
  'git.publish',
  'agent.statskey',
  'agent.claude-code',
  'agent.cursor',
  'xcode.build',
  'xcode.test',
  'xcode.archive',
  'appstore.upload',
  'windows.build',
  'service.host',
  'screen.view',
  'screen.input',
  'device.inspect',
  'device.mutate',
])
const CAPABILITY_SET = new Set(FLEET_CAPABILITIES)

const JOB_TYPES = new Set([
  'agent',
  'command',
  'xcode-build',
  'xcode-test',
  'xcode-archive',
  'windows-build',
  'reconcile',
  'service',
  'remote-session',
])
const JOB_TYPE_CAPABILITY = Object.freeze({
  command: 'terminal.run',
  'xcode-build': 'xcode.build',
  'xcode-test': 'xcode.test',
  'xcode-archive': 'xcode.archive',
  'windows-build': 'windows.build',
  reconcile: 'workspace.write',
  service: 'service.host',
  'remote-session': 'screen.view',
})

const JOB_STATES = Object.freeze([
  'queued',
  'leased',
  'preparing',
  'running',
  'needs_review',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
])
const TERMINAL_JOB_STATES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
])
const JOB_TRANSITIONS = Object.freeze({
  queued: new Set(['leased', 'cancelled', 'timed_out']),
  leased: new Set(['queued', 'preparing', 'cancelled', 'timed_out']),
  preparing: new Set(['running', 'failed', 'cancelled', 'timed_out']),
  running: new Set([
    'needs_review',
    'waiting',
    'succeeded',
    'failed',
    'cancelled',
    'timed_out',
  ]),
  needs_review: new Set(['running', 'failed', 'cancelled', 'timed_out']),
  waiting: new Set(['running', 'failed', 'cancelled', 'timed_out']),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  timed_out: new Set(),
})

const EVENT_TYPES = new Set([
  'accepted',
  'preparation',
  'process-start',
  'process-exit',
  'log',
  'test',
  'artifact',
  'approval-requested',
  'approval-resolved',
  'budget',
  'checkpoint',
  'result',
  'failure',
  'cancellation-acknowledged',
])

const SENSITIVE_EVENT_KEYS =
  /^(?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|refresh[-_]?token|secret|session[-_]?token|access[-_]?token)$/i

function fleetError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function fail(condition, code, message) {
  if (!condition) throw fleetError(code, message)
}

function nowMs(value = Date.now()) {
  const result =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : Number(value)
  fail(Number.isFinite(result) && result > 0, 'invalid_time', 'Invalid time.')
  return result
}

function isoTime(value) {
  return new Date(nowMs(value)).toISOString()
}

function cleanString(value, maximum, field, { minimum = 1 } = {}) {
  fail(typeof value === 'string', 'invalid_argument', `${field} is required.`)
  const cleaned = value.trim()
  fail(
    cleaned.length >= minimum && cleaned.length <= maximum,
    'invalid_argument',
    `${field} is invalid.`
  )
  fail(
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned),
    'invalid_argument',
    `${field} contains control characters.`
  )
  return cleaned
}

function boundedInteger(value, minimum, maximum, field, fallback) {
  const number = value === undefined ? fallback : Number(value)
  fail(
    Number.isInteger(number) && number >= minimum && number <= maximum,
    'invalid_argument',
    `${field} is invalid.`
  )
  return number
}

function boundedNumber(value, minimum, maximum, field, fallback = 0) {
  const number = value === undefined ? fallback : Number(value)
  fail(
    Number.isFinite(number) && number >= minimum && number <= maximum,
    'invalid_argument',
    `${field} is invalid.`
  )
  return number
}

function uniqueStrings(values, {
  maximum,
  field,
  validate,
}) {
  fail(Array.isArray(values), 'invalid_argument', `${field} must be a list.`)
  fail(values.length <= maximum, 'invalid_argument', `${field} is too large.`)
  const result = []
  const seen = new Set()
  for (const value of values) {
    const normalized = cleanString(value, 240, field)
    fail(validate(normalized), 'invalid_argument', `${field} contains an invalid value.`)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result.sort()
}

function normalizeCapabilities(values, field = 'capabilities') {
  return uniqueStrings(values ?? [], {
    maximum: FLEET_CAPABILITIES.length,
    field,
    validate: (value) => CAPABILITY_SET.has(value),
  })
}

function normalizeResources(input = {}, { device = false } = {}) {
  fail(
    input != null && typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'resources must be an object.'
  )
  const maximumBytes = 1024 * 1024 * 1024 * 1024
  const result = {
    cpuLogical: boundedInteger(
      input.cpuLogical,
      0,
      512,
      'resources.cpuLogical',
      0
    ),
    cpuAvailable: boundedNumber(
      input.cpuAvailable,
      0,
      512,
      'resources.cpuAvailable',
      0
    ),
    memoryBytes: boundedNumber(
      input.memoryBytes,
      0,
      maximumBytes * 4,
      'resources.memoryBytes',
      0
    ),
    memoryAvailableBytes: boundedNumber(
      input.memoryAvailableBytes,
      0,
      maximumBytes * 4,
      'resources.memoryAvailableBytes',
      0
    ),
    diskAvailableBytes: boundedNumber(
      input.diskAvailableBytes,
      0,
      maximumBytes * 100,
      'resources.diskAvailableBytes',
      0
    ),
    gpuCount: boundedInteger(
      input.gpuCount,
      0,
      32,
      'resources.gpuCount',
      0
    ),
  }
  if (device) {
    fail(
      result.cpuAvailable <= result.cpuLogical || result.cpuLogical === 0,
      'invalid_argument',
      'Available CPU exceeds total CPU.'
    )
    fail(
      result.memoryAvailableBytes <= result.memoryBytes ||
        result.memoryBytes === 0,
      'invalid_argument',
      'Available memory exceeds total memory.'
    )
  }
  return result
}

function normalizeDevice(input, { at = Date.now() } = {}) {
  fail(
    input != null && typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'Device is required.'
  )
  const id = cleanString(input.id, 64, 'device.id')
  fail(DEVICE_ID_PATTERN.test(id), 'invalid_argument', 'Invalid device id.')
  const ownerUid = cleanString(input.ownerUid, 128, 'device.ownerUid')
  const role = cleanString(input.role, 24, 'device.role')
  fail(
    ['controller', 'worker', 'hybrid'].includes(role),
    'invalid_argument',
    'Invalid device role.'
  )
  const workerMode = cleanString(
    input.workerMode ?? (role === 'controller' ? 'disabled' : 'dedicated'),
    24,
    'device.workerMode'
  )
  fail(
    ['dedicated', 'opt-in', 'disabled'].includes(workerMode),
    'invalid_argument',
    'Invalid worker mode.'
  )
  const platform = cleanString(input.platform, 24, 'device.platform')
  fail(
    ['darwin', 'win32', 'linux', 'ios', 'android'].includes(platform),
    'invalid_argument',
    'Invalid device platform.'
  )
  const status = cleanString(input.status ?? 'active', 16, 'device.status')
  fail(
    ['active', 'revoked'].includes(status),
    'invalid_argument',
    'Invalid device status.'
  )
  const lastSeenAt = nowMs(input.lastSeenAt ?? at)
  const protocolMinimum = boundedInteger(
    input.protocolMinimum,
    1,
    FLEET_PROTOCOL_VERSION,
    'device.protocolMinimum',
    FLEET_PROTOCOL_VERSION
  )
  const protocolMaximum = boundedInteger(
    input.protocolMaximum,
    protocolMinimum,
    1000,
    'device.protocolMaximum',
    FLEET_PROTOCOL_VERSION
  )
  const connection = cleanString(
    input.connection ?? 'offline',
    16,
    'device.connection'
  )
  fail(
    ['direct', 'relay', 'offline'].includes(connection),
    'invalid_argument',
    'Invalid device connection.'
  )
  const fingerprint = cleanString(
    input.publicKeyFingerprint,
    120,
    'device.publicKeyFingerprint'
  )
  fail(
    PUBLIC_KEY_FINGERPRINT_PATTERN.test(fingerprint),
    'invalid_argument',
    'Invalid public key fingerprint.'
  )
  return {
    version: FLEET_PROTOCOL_VERSION,
    id,
    ownerUid,
    label: cleanString(input.label, 80, 'device.label'),
    role,
    workerMode,
    platform,
    status,
    capabilities: normalizeCapabilities(input.capabilities),
    resources: normalizeResources(input.resources, { device: true }),
    activeJobs: boundedInteger(
      input.activeJobs,
      0,
      128,
      'device.activeJobs',
      0
    ),
    maxConcurrentJobs: boundedInteger(
      input.maxConcurrentJobs,
      1,
      128,
      'device.maxConcurrentJobs',
      1
    ),
    cachedSnapshots: uniqueStrings(input.cachedSnapshots ?? [], {
      maximum: 256,
      field: 'device.cachedSnapshots',
      validate: (value) => ARTIFACT_ID_PATTERN.test(value),
    }),
    connection,
    protocolMinimum,
    protocolMaximum,
    publicKeyFingerprint: fingerprint,
    lastSeenAt: isoTime(lastSeenAt),
  }
}

function normalizeRepository(value) {
  const repository = cleanString(
    value,
    240,
    'workspaceSnapshot.repository'
  )
  let host
  let repositoryPath
  const identity =
    /^([A-Za-z0-9.-]+)\/((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      repository
    )
  const shorthand =
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(repository)
  const scp =
    /^git@([A-Za-z0-9.-]+):([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      repository
    )
  if (identity) {
    host = identity[1]
    repositoryPath = identity[2]
  } else if (shorthand) {
    host = 'github.com'
    repositoryPath = `${shorthand[1]}/${shorthand[2]}`
  } else if (scp) {
    host = scp[1]
    repositoryPath = scp[2]
  } else {
    fail(
      !repository.includes('%') &&
        !repository.includes('\\') &&
        !/[\t\n\r]/.test(repository) &&
        !/\/\.{1,2}(?:\/|$)/.test(repository),
      'invalid_argument',
      'Repository identity is invalid.'
    )
    let parsed
    try {
      parsed = new URL(repository)
    } catch {
      fail(false, 'invalid_argument', 'Repository identity is invalid.')
    }
    fail(
      ['https:', 'ssh:'].includes(parsed.protocol) &&
        !parsed.password &&
        !parsed.port &&
        !parsed.search &&
        !parsed.hash &&
        (!parsed.username ||
          (parsed.protocol === 'ssh:' && parsed.username === 'git')) &&
        !parsed.pathname.includes('%') &&
        !parsed.pathname.includes('\\'),
      'invalid_argument',
      'Repository identity is invalid.'
    )
    host = parsed.hostname
    repositoryPath = parsed.pathname.replace(/^\/+|\/+$/g, '')
    if (repositoryPath.endsWith('.git')) {
      repositoryPath = repositoryPath.slice(0, -4)
    }
  }
  fail(
    /^[A-Za-z0-9.-]+$/.test(host) &&
      FLEET_REPOSITORY_HOST_SET.has(host.toLowerCase()) &&
      repositoryPath.split('/').length >= 2 &&
      repositoryPath.split('/').every(
        (part) =>
          /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'
      ),
    'invalid_argument',
    'Repository identity is invalid.'
  )
  return {
    repository,
    repositoryIdentity: `${host}/${repositoryPath}`.toLowerCase(),
  }
}

function normalizeRepositoryIdentity(value) {
  return normalizeRepository(value).repositoryIdentity
}

function normalizeSnapshot(input) {
  fail(
    input != null && typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'workspaceSnapshot is required.'
  )
  const kind = cleanString(input.kind, 16, 'workspaceSnapshot.kind')
  fail(kind === 'git', 'invalid_argument', 'Only Git snapshots are supported.')
  fail(
    input.submodules !== true,
    'invalid_argument',
    'Git submodules are not supported.'
  )
  const { repository, repositoryIdentity } = normalizeRepository(
    input.repository
  )
  const commit = cleanString(input.commit, 64, 'workspaceSnapshot.commit')
  fail(COMMIT_PATTERN.test(commit), 'invalid_argument', 'Invalid source commit.')
  return {
    kind,
    repository,
    repositoryIdentity,
    commit,
    submodules: false,
    snapshotId: `git:${createHash('sha256')
      .update(`${repository}\0${commit}`)
      .digest('hex')}`,
  }
}

function normalizeExecutionPath(value, field, suffixes = []) {
  const relativePath = cleanString(value, 500, field)
  fail(
    !relativePath.startsWith('.') &&
      !relativePath.startsWith('/') &&
      !relativePath.includes('\\') &&
      !relativePath.split('/').some((part) => !part || part === '.' || part === '..') &&
      (suffixes.length === 0 ||
        suffixes.some((suffix) => relativePath.endsWith(suffix))),
    'invalid_argument',
    `${field} is invalid.`
  )
  return relativePath
}

function normalizeExecutionArguments(
  values,
  field,
  maximum = 128,
  maximumBytes = Number.POSITIVE_INFINITY
) {
  fail(
    Array.isArray(values) && values.length <= maximum,
    'invalid_argument',
    `${field} is invalid.`
  )
  const normalized = values.map((value) => cleanString(value, 2_000, field))
  fail(
    Buffer.byteLength(JSON.stringify(normalized), 'utf8') <= maximumBytes,
    'payload_too_large',
    `${field} is too large for the worker process transport.`
  )
  return normalized
}

function normalizeExecution(input, type) {
  if (input == null) return null
  fail(
    typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'execution must be an object.'
  )
  const kind = cleanString(input.kind, 24, 'execution.kind')
  const timeoutMs = boundedInteger(
    input.timeoutMs,
    30_000,
    12 * 60 * 60 * 1000,
    'execution.timeoutMs',
    60 * 60 * 1000
  )
  if (kind === 'xcode') {
    fail(
      ['xcode-build', 'xcode-test', 'xcode-archive'].includes(type),
      'invalid_argument',
      'Xcode execution does not match this job type.'
    )
    const containerKind = cleanString(
      input.containerKind,
      16,
      'execution.containerKind'
    )
    fail(
      ['project', 'workspace'].includes(containerKind),
      'invalid_argument',
      'Invalid Xcode container kind.'
    )
    const suffix = containerKind === 'project' ? '.xcodeproj' : '.xcworkspace'
    return {
      kind,
      action: type.slice('xcode-'.length),
      containerKind,
      containerPath: normalizeExecutionPath(
        input.containerPath,
        'execution.containerPath',
        [suffix]
      ),
      scheme: cleanString(input.scheme, 160, 'execution.scheme'),
      configuration: cleanString(
        input.configuration ?? 'Debug',
        80,
        'execution.configuration'
      ),
      destination: cleanString(
        input.destination ?? 'platform=macOS',
        300,
        'execution.destination'
      ),
      onlyTesting: normalizeExecutionArguments(
        input.onlyTesting ?? [],
        'execution.onlyTesting',
        200
      ),
      timeoutMs,
    }
  }
  if (kind === 'command') {
    fail(
      ['command', 'windows-build'].includes(type),
      'invalid_argument',
      'Command execution does not match this job type.'
    )
    const executable = cleanString(
      input.executable,
      120,
      'execution.executable'
    )
    fail(
      /^[A-Za-z0-9][A-Za-z0-9._+-]{0,119}$/.test(executable),
      'invalid_argument',
      'Command executable must be a program name.'
    )
    fail(
      type !== 'windows-build' ||
        ['dotnet', 'msbuild'].includes(executable.toLowerCase()),
      'invalid_argument',
      'Windows build jobs require dotnet or msbuild.'
    )
    return {
      kind,
      executable,
      arguments: normalizeExecutionArguments(
        input.arguments ?? [],
        'execution.arguments',
        128,
        MAX_COMMAND_ARGUMENT_BYTES
      ),
      workingDirectory:
        input.workingDirectory && input.workingDirectory !== '.'
          ? normalizeExecutionPath(
              input.workingDirectory,
              'execution.workingDirectory'
            )
          : '.',
      timeoutMs,
    }
  }
  throw fleetError('invalid_argument', 'Invalid execution kind.')
}

function normalizeTarget(input = {}) {
  fail(
    input != null && typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'target must be an object.'
  )
  const deviceIds = uniqueStrings(input.deviceIds ?? [], {
    maximum: 16,
    field: 'target.deviceIds',
    validate: (value) => DEVICE_ID_PATTERN.test(value),
  })
  const platforms = uniqueStrings(input.platforms ?? [], {
    maximum: 5,
    field: 'target.platforms',
    validate: (value) =>
      ['darwin', 'win32', 'linux', 'ios', 'android'].includes(value),
  })
  return {
    deviceIds,
    platforms,
    allowControllerAsWorker: input.allowControllerAsWorker === true,
    preferDirect: input.preferDirect !== false,
  }
}

function normalizeCagePolicy(input) {
  if (input == null || input.enabled !== true) {
    return { enabled: false }
  }
  fail(
    typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'cage must be an object.'
  )
  return {
    enabled: true,
    maxSpendUsd: boundedNumber(
      input.maxSpendUsd,
      0.01,
      100_000,
      'cage.maxSpendUsd',
      25
    ),
    maxOverrunFraction: boundedNumber(
      input.maxOverrunFraction,
      0,
      0.5,
      'cage.maxOverrunFraction',
      0.1
    ),
    maxWallTimeMs: boundedInteger(
      input.maxWallTimeMs,
      30_000,
      7 * 24 * 60 * 60 * 1000,
      'cage.maxWallTimeMs',
      4 * 60 * 60 * 1000
    ),
    maxToolCalls: boundedInteger(
      input.maxToolCalls,
      1,
      1_000_000,
      'cage.maxToolCalls',
      2_000
    ),
    maxChildJobs: boundedInteger(
      input.maxChildJobs,
      0,
      1_000,
      'cage.maxChildJobs',
      16
    ),
    maxRepeatedFailures: boundedInteger(
      input.maxRepeatedFailures,
      1,
      100,
      'cage.maxRepeatedFailures',
      4
    ),
    noProgressMs: boundedInteger(
      input.noProgressMs,
      30_000,
      24 * 60 * 60 * 1000,
      'cage.noProgressMs',
      20 * 60 * 1000
    ),
  }
}

function normalizeCreateJob(input, {
  ownerUid,
  at = Date.now(),
} = {}) {
  fail(
    input != null && typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'Job is required.'
  )
  const createdAt = nowMs(at)
  const normalizedOwner = cleanString(ownerUid, 128, 'job.ownerUid')
  const workspaceId = cleanString(
    input.workspaceId,
    128,
    'job.workspaceId'
  )
  fail(
    WORKSPACE_ID_PATTERN.test(workspaceId),
    'invalid_argument',
    'Invalid workspace id.'
  )
  const type = cleanString(input.type, 32, 'job.type')
  fail(JOB_TYPES.has(type), 'invalid_argument', 'Invalid job type.')
  const deadlineAt = nowMs(input.deadlineAt)
  fail(
    deadlineAt > createdAt &&
      deadlineAt - createdAt <= MAX_JOB_LIFETIME_MS,
    'invalid_argument',
    'Job deadline is invalid.'
  )
  const requiredCapabilities = normalizeCapabilities(
    input.requiredCapabilities,
    'job.requiredCapabilities'
  )
  fail(
    requiredCapabilities.length > 0,
    'invalid_argument',
    'Job requires at least one capability.'
  )
  const typeCapability = JOB_TYPE_CAPABILITY[type]
  for (const capability of [
    'workspace.read',
    'workspace.snapshot',
    ...(typeCapability ? [typeCapability] : []),
  ]) {
    fail(
      requiredCapabilities.includes(capability),
      'invalid_argument',
      `${type} jobs require ${capability}.`
    )
  }
  fail(
    type !== 'agent' ||
      requiredCapabilities.some((capability) => capability.startsWith('agent.')),
    'invalid_argument',
    'Agent jobs require an agent runtime capability.'
  )
  const approvalPolicy = cleanString(
    input.approvalPolicy ?? 'review',
    24,
    'job.approvalPolicy'
  )
  fail(
    ['review', 'auto', 'independent', 'custom'].includes(approvalPolicy),
    'invalid_argument',
    'Invalid approval policy.'
  )
  const reconciliationPolicy = cleanString(
    input.reconciliationPolicy ?? 'lead',
    24,
    'job.reconciliationPolicy'
  )
  fail(
    ['lead', 'manual', 'best-of-n', 'adaptive'].includes(reconciliationPolicy),
    'invalid_argument',
    'Invalid reconciliation policy.'
  )
  const idempotencyKey = cleanString(
    input.idempotencyKey,
    128,
    'job.idempotencyKey'
  )
  fail(
    IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey),
    'invalid_argument',
    'Invalid idempotency key.'
  )
  const execution = normalizeExecution(input.execution, type)
  fail(
    ![
      'command',
      'windows-build',
      'xcode-build',
      'xcode-test',
      'xcode-archive',
    ].includes(type) || execution != null,
    'invalid_argument',
    `${type} jobs require a typed execution contract.`
  )
  const normalized = {
    version: FLEET_PROTOCOL_VERSION,
    ownerUid: normalizedOwner,
    workspaceId,
    type,
    objective: cleanString(input.objective, 12_000, 'job.objective'),
    workspaceSnapshot: normalizeSnapshot(input.workspaceSnapshot),
    execution,
    requiredCapabilities,
    target: normalizeTarget(input.target),
    resources: normalizeResources(input.resources),
    exclusiveResources: uniqueStrings(
      input.exclusiveResources ?? [],
      {
        maximum: 64,
        field: 'job.exclusiveResources',
        validate: (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),
      }
    ),
    dependencies: uniqueStrings(input.dependencies ?? [], {
      maximum: 128,
      field: 'job.dependencies',
      validate: (value) => JOB_ID_PATTERN.test(value),
    }),
    deadlineAt: isoTime(deadlineAt),
    maxAttempts: boundedInteger(
      input.maxAttempts,
      1,
      10,
      'job.maxAttempts',
      2
    ),
    approvalPolicy,
    reconciliationPolicy,
    cage: normalizeCagePolicy(input.cage),
    idempotencyKey,
  }
  fail(
    Buffer.byteLength(JSON.stringify(normalized), 'utf8') <=
      MAX_NORMALIZED_JOB_BYTES,
    'payload_too_large',
    'Job is too large for the signed worker transport.'
  )
  return normalized
}

function normalizeJob(input, {
  ownerUid,
  at = Date.now(),
} = {}) {
  fail(
    input != null && typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'Job is required.'
  )
  const createdAt = nowMs(at)
  const id = cleanString(input.id, 64, 'job.id')
  fail(JOB_ID_PATTERN.test(id), 'invalid_argument', 'Invalid job id.')
  const normalizedOwner = cleanString(
    ownerUid ?? input.ownerUid,
    128,
    'job.ownerUid'
  )
  if (ownerUid != null && input.ownerUid != null) {
    fail(
      input.ownerUid === ownerUid,
      'permission_denied',
      'Job owner cannot be changed.'
    )
  }
  const workspaceId = cleanString(
    input.workspaceId,
    128,
    'job.workspaceId'
  )
  fail(
    WORKSPACE_ID_PATTERN.test(workspaceId),
    'invalid_argument',
    'Invalid workspace id.'
  )
  const type = cleanString(input.type, 32, 'job.type')
  fail(JOB_TYPES.has(type), 'invalid_argument', 'Invalid job type.')
  const deadlineAt = nowMs(input.deadlineAt)
  fail(
    deadlineAt > createdAt &&
      deadlineAt - createdAt <= MAX_JOB_LIFETIME_MS,
    'invalid_argument',
    'Job deadline is invalid.'
  )
  const requiredCapabilities = normalizeCapabilities(
    input.requiredCapabilities,
    'job.requiredCapabilities'
  )
  fail(
    requiredCapabilities.length > 0,
    'invalid_argument',
    'Job requires at least one capability.'
  )
  const typeCapability = JOB_TYPE_CAPABILITY[type]
  for (const capability of [
    'workspace.read',
    'workspace.snapshot',
    ...(typeCapability ? [typeCapability] : []),
  ]) {
    fail(
      requiredCapabilities.includes(capability),
      'invalid_argument',
      `${type} jobs require ${capability}.`
    )
  }
  fail(
    type !== 'agent' ||
      requiredCapabilities.some((capability) => capability.startsWith('agent.')),
    'invalid_argument',
    'Agent jobs require an agent runtime capability.'
  )
  const dependencies = uniqueStrings(input.dependencies ?? [], {
    maximum: 128,
    field: 'job.dependencies',
    validate: (value) => JOB_ID_PATTERN.test(value) && value !== id,
  })
  const exclusiveResources = uniqueStrings(
    input.exclusiveResources ?? [],
    {
      maximum: 64,
      field: 'job.exclusiveResources',
      validate: (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),
    }
  )
  const approvalPolicy = cleanString(
    input.approvalPolicy ?? 'review',
    24,
    'job.approvalPolicy'
  )
  fail(
    ['review', 'auto', 'independent', 'custom'].includes(approvalPolicy),
    'invalid_argument',
    'Invalid approval policy.'
  )
  const reconciliationPolicy = cleanString(
    input.reconciliationPolicy ?? 'lead',
    24,
    'job.reconciliationPolicy'
  )
  fail(
    ['lead', 'manual', 'best-of-n', 'adaptive'].includes(reconciliationPolicy),
    'invalid_argument',
    'Invalid reconciliation policy.'
  )
  const idempotencyKey = cleanString(
    input.idempotencyKey,
    128,
    'job.idempotencyKey'
  )
  fail(
    IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey),
    'invalid_argument',
    'Invalid idempotency key.'
  )
  const workspaceSnapshot = normalizeSnapshot(input.workspaceSnapshot)
  const execution = normalizeExecution(input.execution, type)
  fail(
    ![
      'command',
      'windows-build',
      'xcode-build',
      'xcode-test',
      'xcode-archive',
    ].includes(type) || execution != null,
    'invalid_argument',
    `${type} jobs require a typed execution contract.`
  )
  return {
    version: FLEET_PROTOCOL_VERSION,
    id,
    ownerUid: normalizedOwner,
    workspaceId,
    type,
    objective: cleanString(input.objective, 12_000, 'job.objective'),
    state: 'queued',
    workspaceSnapshot,
    execution,
    requiredCapabilities,
    target: normalizeTarget(input.target),
    resources: normalizeResources(input.resources),
    exclusiveResources,
    dependencies,
    deadlineAt: isoTime(deadlineAt),
    maxAttempts: boundedInteger(
      input.maxAttempts,
      1,
      10,
      'job.maxAttempts',
      2
    ),
    approvalPolicy,
    reconciliationPolicy,
    cage: normalizeCagePolicy(input.cage),
    idempotencyKey,
    attempt: 0,
    eventSequence: 0,
    assignedDeviceId: null,
    createdAt: isoTime(createdAt),
    updatedAt: isoTime(createdAt),
  }
}

function fleetJobAuthorizationDetail(job) {
  fail(
    job != null && typeof job === 'object' && !Array.isArray(job),
    'invalid_argument',
    'Job approval is invalid.'
  )
  const execution = job.execution
  const executionLines =
    execution?.kind === 'command'
      ? [
          'Execution kind: command',
          `Program (JSON): ${JSON.stringify(execution.executable)}`,
          `Arguments (JSON): ${JSON.stringify(execution.arguments)}`,
          `Working directory (JSON): ${JSON.stringify(
            execution.workingDirectory
          )}`,
          `Execution timeout: ${execution.timeoutMs} ms`,
        ]
      : execution?.kind === 'xcode'
        ? [
            'Execution kind: xcode',
            `Xcode action: ${execution.action}`,
            `Container kind: ${execution.containerKind}`,
            `Container path (JSON): ${JSON.stringify(execution.containerPath)}`,
            `Scheme (JSON): ${JSON.stringify(execution.scheme)}`,
            `Configuration (JSON): ${JSON.stringify(execution.configuration)}`,
            `Destination (JSON): ${JSON.stringify(execution.destination)}`,
            `Only testing (JSON): ${JSON.stringify(execution.onlyTesting)}`,
            `Execution timeout: ${execution.timeoutMs} ms`,
          ]
        : ['Execution: None']
  const detail = [
    `StatsKey account: ${job.ownerUid}`,
    `Job ID: ${job.id || 'Assigned by coordinator'}`,
    `Workspace: ${job.workspaceId}`,
    `Repository (JSON): ${JSON.stringify(job.workspaceSnapshot?.repository)}`,
    `Repository identity: ${job.workspaceSnapshot?.repositoryIdentity}`,
    `Commit: ${job.workspaceSnapshot?.commit}`,
    `Job type: ${job.type}`,
    `Objective (JSON): ${JSON.stringify(job.objective)}`,
    ...executionLines,
    `Capabilities (JSON): ${JSON.stringify(job.requiredCapabilities)}`,
    `Target devices (JSON): ${JSON.stringify(job.target?.deviceIds)}`,
    `Target platforms (JSON): ${JSON.stringify(job.target?.platforms)}`,
    `Controller may work: ${job.target?.allowControllerAsWorker === true}`,
    `Prefer direct connection: ${job.target?.preferDirect === true}`,
    `Resources (JSON): ${JSON.stringify(job.resources)}`,
    `Exclusive resources (JSON): ${JSON.stringify(job.exclusiveResources)}`,
    `Dependencies (JSON): ${JSON.stringify(job.dependencies)}`,
    `Deadline: ${job.deadlineAt}`,
    `Maximum attempts: ${job.maxAttempts}`,
    `Approval policy: ${job.approvalPolicy}`,
    `Reconciliation policy: ${job.reconciliationPolicy}`,
    `Cage limits (JSON): ${JSON.stringify(job.cage)}`,
    `Idempotency key (JSON): ${JSON.stringify(job.idempotencyKey)}`,
    'Only the fields displayed above will be authorized.',
  ].join('\n')
  fail(
    Buffer.byteLength(detail, 'utf8') <= 12_000,
    'invalid_argument',
    'This Fleet job is too large for safe native review.'
  )
  return detail
}

function normalizeGrant(input, { at = Date.now() } = {}) {
  fail(
    input != null && typeof input === 'object' && !Array.isArray(input),
    'invalid_argument',
    'Grant is required.'
  )
  const id = cleanString(input.id, 64, 'grant.id')
  fail(GRANT_ID_PATTERN.test(id), 'invalid_argument', 'Invalid grant id.')
  const issuedAt = nowMs(input.issuedAt ?? at)
  const expiresAt = nowMs(input.expiresAt)
  fail(expiresAt > issuedAt, 'invalid_argument', 'Grant expiration is invalid.')
  const workspaceIds = uniqueStrings(input.workspaceIds ?? [], {
    maximum: 128,
    field: 'grant.workspaceIds',
    validate: (value) =>
      value === '*' || WORKSPACE_ID_PATTERN.test(value),
  })
  fail(
    workspaceIds.length > 0,
    'invalid_argument',
    'Grant requires a workspace scope.'
  )
  fail(
    Array.isArray(input.repositoryIdentities) &&
      input.repositoryIdentities.length <= 128,
    'invalid_argument',
    'grant.repositoryIdentities is invalid.'
  )
  const repositoryIdentities = [
    ...new Set(
      input.repositoryIdentities.map((value) =>
        normalizeRepositoryIdentity(value)
      )
    ),
  ].sort()
  fail(
    repositoryIdentities.length > 0,
    'invalid_argument',
    'Grant requires a repository identity.'
  )
  const controllerDeviceId = cleanString(
    input.controllerDeviceId,
    64,
    'grant.controllerDeviceId'
  )
  const workerDeviceId = cleanString(
    input.workerDeviceId,
    64,
    'grant.workerDeviceId'
  )
  fail(
    DEVICE_ID_PATTERN.test(controllerDeviceId) &&
      DEVICE_ID_PATTERN.test(workerDeviceId),
    'invalid_argument',
    'Grant devices are invalid.'
  )
  const capabilities = normalizeCapabilities(input.capabilities)
  fail(
    capabilities.length > 0,
    'invalid_argument',
    'Grant requires at least one capability.'
  )
  return {
    version: FLEET_PROTOCOL_VERSION,
    id,
    ownerUid: cleanString(input.ownerUid, 128, 'grant.ownerUid'),
    controllerDeviceId,
    workerDeviceId,
    workspaceIds,
    repositoryIdentities,
    capabilities,
    unattended: input.unattended === true,
    issuedAt: isoTime(issuedAt),
    expiresAt: isoTime(expiresAt),
    revokedAt: input.revokedAt == null ? null : isoTime(input.revokedAt),
    policyVersion: boundedInteger(
      input.policyVersion,
      1,
      1,
      'grant.policyVersion',
      1
    ),
  }
}

function grantAllows(grant, job, device, at = Date.now()) {
  const current = nowMs(at)
  if (
    grant.ownerUid !== job.ownerUid ||
    grant.workerDeviceId !== device.id ||
    grant.revokedAt != null ||
    grant.unattended !== true ||
    grant.policyVersion !== 1 ||
    nowMs(grant.issuedAt) > current ||
    nowMs(grant.expiresAt) <= current
  ) {
    return false
  }
  if (
    !grant.workspaceIds.includes('*') &&
    !grant.workspaceIds.includes(job.workspaceId)
  ) {
    return false
  }
  if (
    typeof job.workspaceSnapshot?.repositoryIdentity !== 'string' ||
    !grant.repositoryIdentities.includes(
      job.workspaceSnapshot.repositoryIdentity
    )
  ) {
    return false
  }
  const granted = new Set(grant.capabilities)
  return job.requiredCapabilities.every((capability) =>
    granted.has(capability)
  )
}

function evaluateDeviceForJob(job, device, grants, {
  at = Date.now(),
} = {}) {
  const current = nowMs(at)
  const reasons = []
  if (job.state !== 'queued') reasons.push('job-not-queued')
  if (job.ownerUid !== device.ownerUid) reasons.push('owner-mismatch')
  if (device.status !== 'active') reasons.push('device-revoked')
  if (!['auto', 'independent'].includes(job.approvalPolicy)) {
    reasons.push('approval-required')
  }
  if (nowMs(device.lastSeenAt) + DEVICE_ONLINE_WINDOW_MS < current) {
    reasons.push('device-offline')
  }
  if (
    !(
      device.protocolMinimum <= FLEET_PROTOCOL_VERSION &&
      device.protocolMaximum >= FLEET_PROTOCOL_VERSION
    )
  ) {
    reasons.push('protocol-incompatible')
  }
  if (device.workerMode === 'disabled') reasons.push('worker-disabled')
  if (
    device.workerMode === 'opt-in' &&
    job.target.allowControllerAsWorker !== true
  ) {
    reasons.push('worker-not-opted-in')
  }
  if (
    job.target.deviceIds.length > 0 &&
    !job.target.deviceIds.includes(device.id)
  ) {
    reasons.push('not-targeted')
  }
  if (
    job.target.platforms.length > 0 &&
    !job.target.platforms.includes(device.platform)
  ) {
    reasons.push('platform-mismatch')
  }
  const advertised = new Set(device.capabilities)
  if (
    job.requiredCapabilities.some((capability) => !advertised.has(capability))
  ) {
    reasons.push('capability-unavailable')
  }
  const matchingGrant = grants.some((grant) =>
    grantAllows(grant, job, device, current)
  )
  if (!matchingGrant) reasons.push('grant-missing')
  if (device.activeJobs >= device.maxConcurrentJobs) {
    reasons.push('concurrency-full')
  }
  if (device.resources.cpuAvailable < job.resources.cpuLogical) {
    reasons.push('cpu-insufficient')
  }
  if (
    device.resources.memoryAvailableBytes < job.resources.memoryBytes
  ) {
    reasons.push('memory-insufficient')
  }
  if (device.resources.diskAvailableBytes < job.resources.diskAvailableBytes) {
    reasons.push('disk-insufficient')
  }
  if (device.resources.gpuCount < job.resources.gpuCount) {
    reasons.push('gpu-insufficient')
  }
  if (nowMs(job.deadlineAt) <= current) reasons.push('deadline-expired')

  let score = 0
  if (reasons.length === 0) {
    if (job.target.deviceIds.includes(device.id)) score += 10_000
    if (device.workerMode === 'dedicated') score += 200
    if (device.cachedSnapshots.includes(job.workspaceSnapshot.snapshotId)) {
      score += 160
    }
    if (device.connection === 'direct') score += 80
    else if (device.connection === 'relay') score += 20
    if (job.target.preferDirect === false && device.connection === 'relay') {
      score += 60
    }
    const memoryRatio =
      device.resources.memoryBytes > 0
        ? device.resources.memoryAvailableBytes /
          device.resources.memoryBytes
        : 0
    const cpuRatio =
      device.resources.cpuLogical > 0
        ? device.resources.cpuAvailable / device.resources.cpuLogical
        : 0
    score += Math.round(memoryRatio * 40)
    score += Math.round(cpuRatio * 30)
    score -= device.activeJobs * 25
  }
  return { eligible: reasons.length === 0, reasons, score }
}

function rankDevicesForJob(job, devices, grants, options = {}) {
  const rows = devices.map((device) => ({
    device,
    evaluation: evaluateDeviceForJob(job, device, grants, options),
  }))
  rows.sort((left, right) => {
    if (left.evaluation.eligible !== right.evaluation.eligible) {
      return left.evaluation.eligible ? -1 : 1
    }
    if (left.evaluation.score !== right.evaluation.score) {
      return right.evaluation.score - left.evaluation.score
    }
    return left.device.id.localeCompare(right.device.id)
  })
  return rows
}

function digestLeaseNonce(nonce) {
  return createHash('sha256').update(nonce).digest('hex')
}

function safeDigestEqual(left, right) {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    left.length !== right.length
  ) {
    return false
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

function leaseTtl(value = DEFAULT_LEASE_TTL_MS) {
  return boundedInteger(
    value,
    MIN_LEASE_TTL_MS,
    MAX_LEASE_TTL_MS,
    'lease.ttlMs',
    DEFAULT_LEASE_TTL_MS
  )
}

function createLease({
  job,
  device,
  attempt,
  resourceKeys = [],
  at = Date.now(),
  ttlMs = DEFAULT_LEASE_TTL_MS,
  random = randomBytes,
}) {
  fail(job.state === 'queued', 'failed_precondition', 'Job is not queued.')
  fail(device.id, 'invalid_argument', 'Device is required.')
  const issuedAt = nowMs(at)
  const ttl = leaseTtl(ttlMs)
  const leaseId = `lease_${random(16).toString('hex')}`
  const nonce = random(32).toString('base64url')
  const normalizedResources = uniqueStrings(resourceKeys, {
    maximum: 64,
    field: 'lease.resourceKeys',
    validate: (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),
  })
  const normalizedAttempt = boundedInteger(
    attempt,
    1,
    job.maxAttempts,
    'lease.attempt',
    1
  )
  return {
    record: {
      version: FLEET_PROTOCOL_VERSION,
      id: leaseId,
      jobId: job.id,
      ownerUid: job.ownerUid,
      deviceId: device.id,
      attempt: normalizedAttempt,
      nonceHash: digestLeaseNonce(nonce),
      resourceKeys: normalizedResources,
      issuedAt: isoTime(issuedAt),
      heartbeatAt: isoTime(issuedAt),
      expiresAt: isoTime(issuedAt + ttl),
      releasedAt: null,
    },
    credential: { leaseId, nonce },
  }
}

function leaseAuthorizes(
  record,
  credential,
  {
    jobId,
    deviceId,
    attempt,
    at = Date.now(),
  }
) {
  if (
    !record ||
    !credential ||
    !LEASE_ID_PATTERN.test(String(record.id || '')) ||
    credential.leaseId !== record.id ||
    record.jobId !== jobId ||
    record.deviceId !== deviceId ||
    record.attempt !== attempt ||
    record.releasedAt != null ||
    nowMs(record.expiresAt) <= nowMs(at)
  ) {
    return false
  }
  return safeDigestEqual(
    record.nonceHash,
    digestLeaseNonce(String(credential.nonce || ''))
  )
}

function renewLease(
  record,
  credential,
  {
    at = Date.now(),
    ttlMs = DEFAULT_LEASE_TTL_MS,
  } = {}
) {
  const current = nowMs(at)
  fail(
    leaseAuthorizes(record, credential, {
      jobId: record.jobId,
      deviceId: record.deviceId,
      attempt: record.attempt,
      at: current,
    }),
    'permission_denied',
    'Lease is invalid or expired.'
  )
  const ttl = leaseTtl(ttlMs)
  return {
    ...record,
    heartbeatAt: isoTime(current),
    expiresAt: isoTime(current + ttl),
  }
}

function releaseLease(record, at = Date.now()) {
  if (record.releasedAt != null) return record
  return {
    ...record,
    releasedAt: isoTime(at),
  }
}

function canTransitionJob(from, to) {
  return JOB_TRANSITIONS[from]?.has(to) === true
}

function transitionJob(job, to, {
  at = Date.now(),
  deviceId,
  attempt,
} = {}) {
  fail(JOB_STATES.includes(to), 'invalid_argument', 'Unknown job state.')
  fail(
    canTransitionJob(job.state, to),
    'failed_precondition',
    `Job cannot transition from ${job.state} to ${to}.`
  )
  const current = nowMs(at)
  const next = {
    ...job,
    state: to,
    updatedAt: isoTime(current),
  }
  if (to === 'leased') {
    fail(
      DEVICE_ID_PATTERN.test(String(deviceId || '')),
      'invalid_argument',
      'Leased job requires a device.'
    )
    next.assignedDeviceId = deviceId
    next.attempt = boundedInteger(
      attempt,
      1,
      job.maxAttempts,
      'job.attempt',
      job.attempt + 1
    )
  }
  if (to === 'queued') {
    next.assignedDeviceId = null
  }
  if (TERMINAL_JOB_STATES.has(to)) {
    next.finishedAt = isoTime(current)
  }
  return next
}

function validateEventPayload(value, depth = 0, counter = { keys: 0 }) {
  fail(depth <= MAX_OBJECT_DEPTH, 'invalid_argument', 'Event payload is too deep.')
  if (
    value == null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    fail(
      typeof value !== 'number' || Number.isFinite(value),
      'invalid_argument',
      'Event payload contains a non-finite number.'
    )
    return
  }
  if (typeof value === 'string') {
    fail(
      value.length <= 32_000,
      'invalid_argument',
      'Event payload string is too large.'
    )
    return
  }
  if (Array.isArray(value)) {
    fail(value.length <= 400, 'invalid_argument', 'Event payload list is too large.')
    for (const item of value) validateEventPayload(item, depth + 1, counter)
    return
  }
  fail(
    typeof value === 'object',
    'invalid_argument',
    'Event payload contains an unsupported value.'
  )
  for (const [key, item] of Object.entries(value)) {
    counter.keys += 1
    fail(
      counter.keys <= MAX_OBJECT_KEYS,
      'invalid_argument',
      'Event payload has too many fields.'
    )
    fail(
      !SENSITIVE_EVENT_KEYS.test(key),
      'invalid_argument',
      'Secrets are not allowed in fleet events.'
    )
    validateEventPayload(item, depth + 1, counter)
  }
}

function createFleetEvent({
  job,
  lease,
  credential,
  deviceId,
  attempt,
  sequence,
  type,
  payload = {},
  at = Date.now(),
}) {
  fail(
    leaseAuthorizes(lease, credential, {
      jobId: job.id,
      deviceId,
      attempt,
      at,
    }),
    'permission_denied',
    'A current lease is required.'
  )
  const normalizedSequence = boundedInteger(
    sequence,
    1,
    10_000_000,
    'event.sequence',
    job.eventSequence + 1
  )
  fail(
    normalizedSequence === job.eventSequence + 1,
    'conflict',
    'Event sequence is not the next expected value.'
  )
  const normalizedType = cleanString(type, 64, 'event.type')
  fail(EVENT_TYPES.has(normalizedType), 'invalid_argument', 'Unknown event type.')
  validateEventPayload(payload)
  const encoded = JSON.stringify(payload)
  fail(
    Buffer.byteLength(encoded) <= MAX_EVENT_BYTES,
    'invalid_argument',
    'Event payload is too large.'
  )
  const occurredAt = isoTime(at)
  return {
    version: FLEET_PROTOCOL_VERSION,
    jobId: job.id,
    attempt,
    sequence: normalizedSequence,
    type: normalizedType,
    payload,
    payloadDigest: createHash('sha256').update(encoded).digest('hex'),
    deviceId,
    leaseId: lease.id,
    occurredAt,
  }
}

function evaluateCage(policyInput, usageInput = {}, {
  at = Date.now(),
} = {}) {
  const policy = normalizeCagePolicy(policyInput)
  if (!policy.enabled) {
    return { action: 'continue', reasons: [], enabled: false }
  }
  const usage = {
    spendUsd: boundedNumber(
      usageInput.spendUsd,
      0,
      1_000_000,
      'usage.spendUsd',
      0
    ),
    estimatedRemainingUsd: boundedNumber(
      usageInput.estimatedRemainingUsd,
      0,
      1_000_000,
      'usage.estimatedRemainingUsd',
      0
    ),
    wallTimeMs: boundedNumber(
      usageInput.wallTimeMs,
      0,
      365 * 24 * 60 * 60 * 1000,
      'usage.wallTimeMs',
      0
    ),
    toolCalls: boundedInteger(
      usageInput.toolCalls,
      0,
      10_000_000,
      'usage.toolCalls',
      0
    ),
    childJobs: boundedInteger(
      usageInput.childJobs,
      0,
      100_000,
      'usage.childJobs',
      0
    ),
    repeatedFailures: boundedInteger(
      usageInput.repeatedFailures,
      0,
      10_000,
      'usage.repeatedFailures',
      0
    ),
    noProgressMs: boundedNumber(
      usageInput.noProgressMs,
      0,
      365 * 24 * 60 * 60 * 1000,
      'usage.noProgressMs',
      0
    ),
    completionRatio: boundedNumber(
      usageInput.completionRatio,
      0,
      1,
      'usage.completionRatio',
      0
    ),
    objectiveDrift: usageInput.objectiveDrift === true,
    securityViolation: usageInput.securityViolation === true,
    deadlineAt:
      usageInput.deadlineAt == null ? null : nowMs(usageInput.deadlineAt),
  }
  if (usage.securityViolation) {
    return {
      action: 'cancel',
      reasons: ['hard-security-boundary'],
      enabled: true,
    }
  }
  if (usage.deadlineAt != null && usage.deadlineAt <= nowMs(at)) {
    return { action: 'cancel', reasons: ['deadline-expired'], enabled: true }
  }
  if (usage.objectiveDrift) {
    return {
      action: 'checkpoint-review',
      reasons: ['objective-drift'],
      enabled: true,
    }
  }

  const overrunLimit =
    policy.maxSpendUsd * (1 + policy.maxOverrunFraction)
  const projectedSpend =
    usage.spendUsd + usage.estimatedRemainingUsd
  if (usage.spendUsd >= overrunLimit) {
    return {
      action: 'checkpoint-review',
      reasons: ['spend-hard-limit'],
      enabled: true,
    }
  }
  if (projectedSpend > policy.maxSpendUsd) {
    if (
      usage.completionRatio >= 0.8 &&
      projectedSpend <= overrunLimit
    ) {
      return {
        action: 'stop-spawning',
        reasons: ['completion-grace'],
        enabled: true,
      }
    }
    return {
      action: 'checkpoint-review',
      reasons: ['spend-soft-limit'],
      enabled: true,
    }
  }
  if (usage.wallTimeMs >= policy.maxWallTimeMs) {
    return {
      action: 'checkpoint-review',
      reasons: ['wall-time-limit'],
      enabled: true,
    }
  }
  if (usage.repeatedFailures >= policy.maxRepeatedFailures) {
    return {
      action: 'checkpoint-review',
      reasons: ['repeated-failure'],
      enabled: true,
    }
  }
  if (usage.noProgressMs >= policy.noProgressMs) {
    return {
      action: 'checkpoint-review',
      reasons: ['no-progress'],
      enabled: true,
    }
  }
  if (
    usage.toolCalls >= policy.maxToolCalls ||
    usage.childJobs >= policy.maxChildJobs
  ) {
    return {
      action: 'stop-spawning',
      reasons: [
        ...(usage.toolCalls >= policy.maxToolCalls
          ? ['tool-call-limit']
          : []),
        ...(usage.childJobs >= policy.maxChildJobs
          ? ['child-job-limit']
          : []),
      ],
      enabled: true,
    }
  }
  return { action: 'continue', reasons: [], enabled: true }
}

module.exports = {
  DEVICE_ONLINE_WINDOW_MS,
  FLEET_CAPABILITIES,
  FLEET_PROTOCOL_VERSION,
  FLEET_REPOSITORY_HOSTS,
  JOB_STATES,
  canTransitionJob,
  createFleetEvent,
  createLease,
  evaluateCage,
  evaluateDeviceForJob,
  fleetJobAuthorizationDetail,
  fleetError,
  grantAllows,
  leaseAuthorizes,
  normalizeCagePolicy,
  normalizeCreateJob,
  normalizeDevice,
  normalizeExecution,
  normalizeGrant,
  normalizeJob,
  normalizeRepositoryIdentity,
  rankDevicesForJob,
  releaseLease,
  renewLease,
  transitionJob,
}
