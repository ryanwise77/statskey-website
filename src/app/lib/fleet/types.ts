/**
 * Portable StatsKey Fleet protocol contracts.
 *
 * Fleet device identity is intentionally separate from Workspace Sync's
 * browser-profile id. A Fleet id represents an OS-protected key enrollment and
 * is derived from the enrolled public key.
 */
export const FLEET_PROTOCOL_VERSION = 1 as const

export const FLEET_CAPABILITIES = [
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
] as const

export type FleetCapability = (typeof FLEET_CAPABILITIES)[number]
export const FLEET_REPOSITORY_HOSTS = [
  'github.com',
  'origin.cursor.com',
] as const
const FLEET_REPOSITORY_HOST_SET = new Set<string>(FLEET_REPOSITORY_HOSTS)

export type FleetDeviceRole = 'controller' | 'worker' | 'hybrid'
export type FleetWorkerMode = 'dedicated' | 'opt-in' | 'disabled'
export type FleetPlatform = 'darwin' | 'win32' | 'linux' | 'ios' | 'android'
export type FleetConnection = 'direct' | 'relay' | 'offline'

export interface FleetResources {
  cpuLogical: number
  cpuAvailable: number
  memoryBytes: number
  memoryAvailableBytes: number
  diskAvailableBytes: number
  gpuCount: number
}

export interface FleetDevice {
  id: `dev_${string}`
  schemaVersion: typeof FLEET_PROTOCOL_VERSION
  label: string
  role: FleetDeviceRole
  workerMode: FleetWorkerMode
  platform: FleetPlatform
  status: 'active' | 'revoked'
  capabilities: FleetCapability[]
  executables: string[]
  resources: FleetResources
  activeJobs: number
  maxConcurrentJobs: number
  connection: FleetConnection
  protocolMinimum: number
  protocolMaximum: number
  softwareVersion: string
  lastSeenAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface FleetSignedDeviceEnvelope {
  protocolVersion: 1
  deviceId: `dev_${string}`
  requestId: `req_${string}`
  action: string
  issuedAt: number
  expiresAt: number
  payloadDigest: string
  signature: string
}

export interface BootstrapFleetDeviceInput {
  device: {
    label: string
    role: 'controller' | 'hybrid'
    workerMode: 'opt-in' | 'disabled'
    platform: Extract<FleetPlatform, 'darwin' | 'win32' | 'linux'>
    publicKeySpki: string
    maxConcurrentJobs: number
  }
  authorization: {
    ownerUid: string
    audience: 'statskey-workbench:fleet:v1'
  }
  proof: FleetSignedDeviceEnvelope
}

export interface RecoverFleetControllerInput {
  device: BootstrapFleetDeviceInput['device']
  authorization: {
    ownerUid: string
    audience: 'statskey-workbench:fleet-recovery:v1'
    expectedControllerDeviceId: `dev_${string}`
  }
  proof: FleetSignedDeviceEnvelope
}

export interface PairFleetDeviceInput {
  receipt: {
    pairingNonce: string
    ownerUid: string
    controllerDeviceId: `dev_${string}`
    candidate: {
      label: string
    role: 'worker'
    workerMode: 'dedicated'
      platform: FleetPlatform
      publicKeySpki: string
      maxConcurrentJobs: number
    }
    workspaceIds: string[]
    repositoryIdentities: string[]
    capabilities: FleetCapability[]
    unattended: boolean
    grantExpiresAt: number
    policyVersion: number
  }
  candidateProof: FleetSignedDeviceEnvelope
  controllerProof: FleetSignedDeviceEnvelope
}

export interface CreateLocalFleetGrantInput {
  receipt: {
    deviceId: `dev_${string}`
    workspaceIds: string[]
    repositoryIdentities: string[]
    capabilities: FleetCapability[]
    unattended: boolean
    expiresAt: number | string
    policyVersion: number
  }
  proof: FleetSignedDeviceEnvelope
}

export type FleetJobType =
  | 'agent'
  | 'command'
  | 'xcode-build'
  | 'xcode-test'
  | 'xcode-archive'
  | 'windows-build'
  | 'reconcile'
  | 'service'
  | 'remote-session'

export type FleetJobState =
  | 'queued'
  | 'leased'
  | 'preparing'
  | 'running'
  | 'needs_review'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export type FleetApprovalPolicy =
  | 'review'
  | 'auto'
  | 'independent'
  | 'custom'

export type FleetReconciliationPolicy =
  | 'lead'
  | 'manual'
  | 'best-of-n'
  | 'adaptive'

export interface FleetGitSnapshot {
  kind: 'git'
  /** Remote identity or URL; never an absolute local path. */
  repository: string
  repositoryIdentity: string
  commit: string
  submodules?: false
  snapshotId?: string
}

export interface FleetArtifact {
  id: `artifact_${string}`
  schemaVersion: number
  jobId: `job_${string}`
  attempt: number
  deviceId: `dev_${string}`
  kind:
    | 'snapshot'
    | 'patch'
    | 'commit'
    | 'log'
    | 'test-result'
    | 'xcresult'
    | 'build'
    | 'screenshot'
    | 'release'
  contentHash: string
  contentMd5: string
  sizeBytes: number
  mediaType: string
  state: 'uploading' | 'ready' | 'deleting'
  generation: string | null
  createdAt: string | null
  committedAt: string | null
  expiresAt: string | null
}

export interface FleetCoordinatorTrust {
  keyId: string
  publicKeySpki: string
  algorithm: 'Ed25519'
}

export type FleetWorkspaceSnapshot = FleetGitSnapshot

export interface FleetXcodeExecution {
  kind: 'xcode'
  action?: 'build' | 'test' | 'archive'
  containerKind: 'project' | 'workspace'
  containerPath: string
  scheme: string
  configuration?: string
  destination?: string
  onlyTesting?: string[]
  timeoutMs?: number
}

export interface FleetCommandExecution {
  kind: 'command'
  executable: string
  arguments?: string[]
  workingDirectory?: string
  timeoutMs?: number
}

export type FleetExecution = FleetXcodeExecution | FleetCommandExecution

export interface FleetTarget {
  deviceIds?: Array<`dev_${string}`>
  platforms?: FleetPlatform[]
  /**
   * Required for an opt-in controller/hybrid machine. Dedicated workers do
   * not need this flag.
   */
  allowControllerAsWorker?: boolean
  preferDirect?: boolean
}

export interface FleetResourceRequest {
  cpuLogical?: number
  memoryBytes?: number
  diskAvailableBytes?: number
  gpuCount?: number
}

export interface FleetCagePolicy {
  enabled: boolean
  maxSpendUsd?: number
  maxOverrunFraction?: number
  maxWallTimeMs?: number
  maxToolCalls?: number
  maxChildJobs?: number
  maxRepeatedFailures?: number
  noProgressMs?: number
}

export interface CreateFleetJobInput {
  workspaceId: string
  type: FleetJobType
  objective: string
  workspaceSnapshot: Omit<FleetGitSnapshot, 'repositoryIdentity'>
  execution?: FleetExecution
  requiredCapabilities: FleetCapability[]
  target?: FleetTarget
  resources?: FleetResourceRequest
  exclusiveResources?: string[]
  dependencies?: Array<`job_${string}`>
  deadlineAt: number | string
  maxAttempts?: number
  approvalPolicy?: FleetApprovalPolicy
  reconciliationPolicy?: FleetReconciliationPolicy
  cage?: FleetCagePolicy
  idempotencyKey: string
  controllerAuthorization: {
    controllerDeviceId: `dev_${string}`
    proof: FleetSignedDeviceEnvelope
  }
}

export interface FleetJob {
  id: `job_${string}`
  schemaVersion: typeof FLEET_PROTOCOL_VERSION
  ownerUid: string
  authorizedByControllerDeviceId: `dev_${string}`
  workspaceId: string
  type: FleetJobType
  objective: string
  workspaceSnapshot: Required<
    Pick<FleetWorkspaceSnapshot, 'kind' | 'snapshotId'>
  > &
    FleetWorkspaceSnapshot
  execution: FleetExecution | null
  requiredCapabilities: FleetCapability[]
  target: Required<FleetTarget>
  resources: FleetResources
  exclusiveResources: string[]
  dependencies: Array<`job_${string}`>
  deadlineAt: string
  maxAttempts: number
  approvalPolicy: FleetApprovalPolicy
  reconciliationPolicy: FleetReconciliationPolicy
  cage: FleetCagePolicy
  state: FleetJobState
  attempt: number
  eventSequence: number
  artifactIds: Array<`artifact_${string}`>
  assignedDeviceId: `dev_${string}` | null
  revision: number
  cancellationRequestedAt: string | null
  lastFailure: {
    code: string
    retryable: boolean
    terminationConfirmed: boolean
    attempt: number
    at: string | null
  } | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export type FleetEventType =
  | 'accepted'
  | 'preparation'
  | 'process-start'
  | 'process-exit'
  | 'log'
  | 'test'
  | 'artifact'
  | 'approval-requested'
  | 'approval-resolved'
  | 'budget'
  | 'checkpoint'
  | 'result'
  | 'failure'
  | 'cancellation-acknowledged'

export interface FleetJobEvent {
  schemaVersion: typeof FLEET_PROTOCOL_VERSION
  jobId: `job_${string}`
  deviceId: `dev_${string}`
  attempt: number
  sequence: number
  type: FleetEventType
  payload: unknown
  occurredAt: string
}

export interface FleetJobList {
  jobs: FleetJob[]
  limit: number
  mayHaveMore: boolean
}

export interface FleetDeviceList {
  devices: FleetDevice[]
  bootstrapDeviceId: `dev_${string}` | null
  limit: number
  mayHaveMore: boolean
}

export interface FleetJobEventList {
  events: FleetJobEvent[]
  afterSequence: number
  limit: number
  mayHaveMore: boolean
}

export interface FleetLeaseCredential {
  id: `lease_${string}`
  nonce: string
  deviceId: `dev_${string}`
  jobId: `job_${string}`
  attempt: number
  expiresAt: string
}

export interface FleetGrant {
  id: `grant_${string}`
  ownerUid: string
  controllerDeviceId: `dev_${string}`
  workerDeviceId: `dev_${string}`
  workspaceIds: string[]
  repositoryIdentities: string[]
  capabilities: FleetCapability[]
  unattended: boolean
  policyVersion: number
  issuedAt: string
  expiresAt: string
  revokedAt: string | null
}

export interface FleetGrantList {
  grants: FleetGrant[]
  limit: number
  mayHaveMore: boolean
}

export type FleetRemoteSessionState =
  | 'requested'
  | 'approved'
  | 'active'
  | 'ended'
  | 'expired'

export type FleetRemoteSessionCapability = 'screen.view' | 'screen.input'

export interface FleetRemoteSession {
  id: `rs_${string}`
  sessionId: `rs_${string}`
  schemaVersion: number
  controllerDeviceId: `dev_${string}`
  workerDeviceId: `dev_${string}`
  capabilities: FleetRemoteSessionCapability[]
  transport: 'relay'
  protocol: string
  state: FleetRemoteSessionState
  controllerEphemeralKey: string
  workerEphemeralKey: string | null
  approvalReceiptDigest: string | null
  expiresAt: string
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
  /** Present only for live sessions over the owner-authenticated API. */
  sessionKey?: string
  relayEndpoint?: string
}

export interface FleetRemoteSessionList {
  sessions: FleetRemoteSession[]
  limit: number
  mayHaveMore: boolean
}

export interface RequestFleetRemoteSessionInput {
  controllerDeviceId: `dev_${string}`
  workerDeviceId: `dev_${string}`
  capabilities: FleetRemoteSessionCapability[]
  transport: 'relay'
  controllerEphemeralKey: string
}

export const TERMINAL_FLEET_JOB_STATES: ReadonlySet<FleetJobState> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
])

export function isTerminalFleetJob(job: Pick<FleetJob, 'state'>): boolean {
  return TERMINAL_FLEET_JOB_STATES.has(job.state)
}

export function fleetDeviceIsPresent(
  device: Pick<FleetDevice, 'status' | 'lastSeenAt'>,
  at = Date.now(),
  onlineWindowMs = 90_000
): boolean {
  if (device.status !== 'active' || !device.lastSeenAt) return false
  const seenAt = Date.parse(device.lastSeenAt)
  return Number.isFinite(seenAt) && seenAt + onlineWindowMs >= at
}

export function fleetRepositoryIdentity(repository: string): string | null {
  const value = repository.trim()
  if (!value || value.length > 240) return null
  const identity =
    /^([A-Za-z0-9.-]+)\/((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      value
    )
  if (identity) {
    if (!FLEET_REPOSITORY_HOST_SET.has(identity[1].toLowerCase())) return null
    return `${identity[1]}/${identity[2]}`.toLowerCase()
  }
  const shorthand =
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value)
  if (shorthand) {
    return `github.com/${shorthand[1]}/${shorthand[2]}`.toLowerCase()
  }
  const scp =
    /^git@([A-Za-z0-9.-]+):([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      value
    )
  if (scp) {
    if (!FLEET_REPOSITORY_HOST_SET.has(scp[1].toLowerCase())) return null
    return `${scp[1]}/${scp[2]}`.toLowerCase()
  }
  if (
    value.includes('%') ||
    value.includes('\\') ||
    /[\t\n\r]/.test(value) ||
    /\/\.{1,2}(?:\/|$)/.test(value)
  ) {
    return null
  }
  try {
    const parsed = new URL(value)
    if (
      !['https:', 'ssh:'].includes(parsed.protocol) ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash ||
      (parsed.username &&
        (parsed.protocol !== 'ssh:' || parsed.username !== 'git')) ||
      parsed.pathname.includes('%') ||
      parsed.pathname.includes('\\') ||
      !FLEET_REPOSITORY_HOST_SET.has(parsed.hostname.toLowerCase())
    ) {
      return null
    }
    let path = parsed.pathname.replace(/^\/+|\/+$/g, '')
    if (path.endsWith('.git')) path = path.slice(0, -4)
    const parts = path.split('/')
    if (
      !/^[A-Za-z0-9.-]+$/.test(parsed.hostname) ||
      parts.length < 2 ||
      parts.some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) ||
          part === '.' ||
          part === '..'
      )
    ) {
      return null
    }
    return `${parsed.hostname}/${path}`.toLowerCase()
  } catch {
    return null
  }
}

export function fleetDeviceCanRunGrantedJob(
  device: FleetDevice,
  grants: FleetGrant[],
  capabilities: FleetCapability[],
  workspaceId: string,
  repositoryIdentity: string,
  at = Date.now(),
  executable = ''
): boolean {
  if (
    !fleetDeviceIsPresent(device, at) ||
    device.workerMode === 'disabled' ||
    !['worker', 'hybrid'].includes(device.role)
  ) {
    return false
  }
  const reported = new Set(device.capabilities)
  if (capabilities.some((capability) => !reported.has(capability))) return false
  const needsExecutable = capabilities.some((capability) =>
    ['terminal.run', 'windows.build'].includes(capability)
  )
  if (needsExecutable && device.executables.length === 0) return false
  if (
    executable.trim() &&
    !device.executables.some(
      (candidate) =>
        candidate.toLowerCase() === executable.trim().toLowerCase()
    )
  ) {
    return false
  }
  const normalizedWorkspace = workspaceId.trim()
  const normalizedRepository = fleetRepositoryIdentity(repositoryIdentity)
  if (!normalizedRepository) return false
  return grants.some((grant) => {
    if (
      grant.workerDeviceId !== device.id ||
      grant.revokedAt != null ||
      grant.unattended !== true ||
      grant.policyVersion !== 1 ||
      Date.parse(grant.issuedAt) > at ||
      Date.parse(grant.expiresAt) <= at
    ) {
      return false
    }
    if (
      normalizedWorkspace &&
      !grant.workspaceIds.includes('*') &&
      !grant.workspaceIds.includes(normalizedWorkspace)
    ) {
      return false
    }
    if (
      !grant.repositoryIdentities?.includes(normalizedRepository)
    ) {
      return false
    }
    const granted = new Set(grant.capabilities)
    return capabilities.every((capability) => granted.has(capability))
  })
}

export function canCancelFleetJob(
  job: Pick<FleetJob, 'state' | 'cancellationRequestedAt'>
): boolean {
  return !isTerminalFleetJob(job) && job.cancellationRequestedAt == null
}
