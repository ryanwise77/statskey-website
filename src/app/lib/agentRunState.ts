import {
  durableGetItem,
  durableRemoveItem,
  durableSetItem,
} from './durableRendererStorage'

export type AgentRunPhase =
  | 'starting'
  | 'queued'
  | 'thinking'
  | 'working'
  | 'needs-input'
  | 'finishing'
  | 'responding'
  | 'stopping'

export interface AgentRunStepSummary {
  id: string
  name?: string
  label: string
  summary?: string
  resultMeta?: string
  status: 'running' | 'done' | 'error'
  agent?: string
  rationale?: string
  preview?: AgentRunPreview
  ms?: number
  startedAt?: number
}

export interface AgentRunPreview {
  kind:
    | 'files'
    | 'code'
    | 'diff'
    | 'command'
    | 'browser'
    | 'text'
    | 'investigation'
  title: string
  body?: string
  before?: string
  after?: string
  language?: string
  additions?: number
  deletions?: number
  items?: Array<{ label: string; detail?: string }>
  filePath?: string
  line?: number
  checkpointId?: string
  objective?: string
  summary?: string
  sourceUrls?: string[]
}

export interface ActiveAgentRun {
  sessionId: string
  /** User message that started this run; keeps live work in transcript order. */
  messageId?: string
  /** Renderer lifetime that owns the live callbacks; persisted runs remain recoverable. */
  ownerId?: string
  title: string
  startedAt: number
  contextScope: 'personal' | 'work'
  objective?: string
  workspaceId?: string
  workspaceLabel?: string
  workspaceRoots?: string[]
  phase?: AgentRunPhase
  currentAction?: string
  currentLocation?: string
  lastCompleted?: string
  nextAction?: string
  lastActivityAt?: number
  completedSteps?: number
  totalSteps?: number
  recentSteps?: AgentRunStepSummary[]
  providerQueuePosition?: number
  queuedPromptCount?: number
  orchestrationMode?: 'focused' | 'adaptive' | 'parallel'
  agentMode?: 'ask' | 'plan' | 'debug' | 'agent'
  taskExpectation?: 'workspace-change' | 'external-action' | 'answer'
  modelLabel?: string
  providerRound?: number
  outputCharacters?: number
  liveUpdate?: string
}

const ACTIVE_RUN_KEY = 'statskey.agent.activeRuns.v2'
const LEGACY_ACTIVE_RUN_KEY = 'statskey.agent.activeRun.v1'
const LAST_SESSION_KEY = 'statskey.agent.lastSession.v1'
export const AGENT_RUN_STATE_EVENT = 'statskey:agent-run-state'
export const AGENT_STEERING_CONSUMED_EVENT =
  'statskey:agent-steering-consumed'
const MAX_ACTIVE_AGE_MS = 12 * 60 * 60 * 1_000
const MAX_RECENT_STEPS = 24
const INPUT_PAUSE_ACTION = 'Waiting for your approval to continue'
const INPUT_PAUSE_NEXT_ACTION = 'Approve or reject the request to continue.'
const runControls = new Map<string, () => void>()
interface AgentRunInputPause {
  sessionId: string
  startedAt: number
  previousPhase: Exclude<AgentRunPhase, 'needs-input'>
  previousCurrentAction?: string
  previousNextAction?: string
  operationIds: Set<string>
}
const inputPausesByRun = new Map<string, AgentRunInputPause>()
const inputPauseRunByOperation = new Map<string, string>()
const rendererOwnerId = crypto.randomUUID()
export interface AgentRunSteeringMessage {
  /** Queue identity used to acknowledge consumption. */
  id: string
  /** Transcript identity shared by every mounted copy of the chat. */
  messageId: string
  text: string
  content: string
  timestamp: number
  attachments?: Array<{
    name: string
    mediaType: string
    size: number
    kind: 'text' | 'image' | 'pdf' | 'opaque'
    readable: boolean
  }>
}
const runSteeringControls = new Map<
  string,
  (message: AgentRunSteeringMessage) => void
>()

export type AgentTranscriptEntry<T extends { id: string }> =
  | { kind: 'message'; message: T }
  | { kind: 'run'; run: ActiveAgentRun }

/** Places live work immediately after the prompt that started it. */
export function interleaveActiveAgentRun<T extends { id: string }>(
  messages: T[],
  run: ActiveAgentRun | null | undefined
): AgentTranscriptEntry<T>[] {
  const entries: AgentTranscriptEntry<T>[] = []
  let inserted = false
  for (const message of messages) {
    entries.push({ kind: 'message', message })
    if (run?.messageId === message.id) {
      entries.push({ kind: 'run', run })
      inserted = true
    }
  }
  if (run && !inserted) entries.push({ kind: 'run', run })
  return entries
}

export function getActiveAgentRuns(): ActiveAgentRun[] {
  try {
    const raw =
      durableGetItem(ACTIVE_RUN_KEY) ??
      (() => {
        const legacy = localStorage.getItem(LEGACY_ACTIVE_RUN_KEY)
        return legacy ? `[${legacy}]` : '[]'
      })()
    const parsed = JSON.parse(raw) as Array<
      Partial<ActiveAgentRun> & { owner?: string }
    >
    const runs: ActiveAgentRun[] = (Array.isArray(parsed) ? parsed : [])
      .filter(
        (run) =>
          typeof run.sessionId === 'string' &&
          typeof run.title === 'string' &&
          typeof run.startedAt === 'number' &&
          Number.isFinite(run.startedAt) &&
          Date.now() - run.startedAt <= MAX_ACTIVE_AGE_MS
      )
      .map<ActiveAgentRun>((run) => ({
        sessionId: run.sessionId!,
        messageId:
          typeof run.messageId === 'string'
            ? run.messageId.slice(0, 160)
            : undefined,
        ownerId:
          typeof run.owner === 'string' ? run.owner.slice(0, 160) : undefined,
        title: run.title!.slice(0, 120),
        startedAt: run.startedAt!,
        contextScope: run.contextScope === 'work' ? 'work' : 'personal',
        objective:
          typeof run.objective === 'string'
            ? run.objective.slice(0, 600)
            : undefined,
        workspaceId:
          typeof run.workspaceId === 'string'
            ? run.workspaceId.slice(0, 160)
            : undefined,
        workspaceLabel:
          typeof run.workspaceLabel === 'string'
            ? run.workspaceLabel.slice(0, 120)
            : undefined,
        workspaceRoots: decodeWorkspaceRoots(run.workspaceRoots),
        phase: isAgentRunPhase(run.phase) ? run.phase : 'working',
        currentAction:
          typeof run.currentAction === 'string'
            ? run.currentAction.slice(0, 240)
            : undefined,
        currentLocation:
          typeof run.currentLocation === 'string'
            ? run.currentLocation.slice(0, 500)
            : undefined,
        lastCompleted:
          typeof run.lastCompleted === 'string'
            ? run.lastCompleted.slice(0, 500)
            : undefined,
        nextAction:
          typeof run.nextAction === 'string'
            ? run.nextAction.slice(0, 500)
            : undefined,
        lastActivityAt:
          typeof run.lastActivityAt === 'number' &&
          Number.isFinite(run.lastActivityAt)
            ? run.lastActivityAt
            : run.startedAt!,
        completedSteps: finiteNonNegativeInteger(run.completedSteps),
        totalSteps: finiteNonNegativeInteger(run.totalSteps),
        recentSteps: decodeRecentSteps(run.recentSteps),
        providerQueuePosition: positiveInteger(run.providerQueuePosition),
        queuedPromptCount: finiteNonNegativeInteger(run.queuedPromptCount),
        orchestrationMode:
          run.orchestrationMode === 'adaptive' ||
          run.orchestrationMode === 'parallel'
            ? run.orchestrationMode
            : 'focused',
        agentMode: isAgentMode(run.agentMode) ? run.agentMode : undefined,
        taskExpectation: isTaskExpectation(run.taskExpectation)
          ? run.taskExpectation
          : undefined,
        modelLabel:
          typeof run.modelLabel === 'string'
            ? run.modelLabel.slice(0, 120)
            : undefined,
        providerRound: positiveInteger(run.providerRound),
        outputCharacters: finiteNonNegativeInteger(run.outputCharacters),
        liveUpdate:
          typeof run.liveUpdate === 'string'
            ? run.liveUpdate.slice(0, 2_000)
            : undefined,
      }))
      .sort((left, right) => left.startedAt - right.startedAt)
    writeRuns(runs)
    localStorage.removeItem(LEGACY_ACTIVE_RUN_KEY)
    return runs
  } catch {
    return []
  }
}

export function getActiveAgentRun(): ActiveAgentRun | null {
  return getActiveAgentRuns().at(-1) ?? null
}

export function setActiveAgentRun(run: ActiveAgentRun | null) {
  if (run) {
    const next = getActiveAgentRuns().filter(
      (candidate) => candidate.sessionId !== run.sessionId
    )
    next.push(run)
    writeRuns(next)
    rememberAgentSession(run.sessionId)
  } else {
    durableRemoveItem(ACTIVE_RUN_KEY)
  }
  window.dispatchEvent(
    new CustomEvent<ActiveAgentRun | null>(AGENT_RUN_STATE_EVENT, {
      detail: run,
    })
  )
}

export function clearActiveAgentRun(sessionId: string) {
  const current = getActiveAgentRuns()
  const next = current.filter((run) => run.sessionId !== sessionId)
  if (next.length === current.length) return
  for (const [runKey, pause] of inputPausesByRun) {
    if (pause.sessionId !== sessionId) continue
    inputPausesByRun.delete(runKey)
    for (const operationId of pause.operationIds) {
      inputPauseRunByOperation.delete(operationId)
    }
  }
  writeRuns(next)
  window.dispatchEvent(
    new CustomEvent<ActiveAgentRun[]>(AGENT_RUN_STATE_EVENT, {
      detail: next,
    })
  )
}

export function updateActiveAgentRun(
  sessionId: string,
  update: Partial<Omit<ActiveAgentRun, 'sessionId' | 'startedAt'>>
) {
  const current = getActiveAgentRuns()
  const index = current.findIndex((run) => run.sessionId === sessionId)
  if (index < 0) return
  const next = [...current]
  const run = next[index]
  const inputPause = inputPausesByRun.get(
    inputPauseKey(run.sessionId, run.startedAt)
  )
  let effectiveUpdate = update
  if (inputPause && update.phase !== 'stopping') {
    if (update.phase && update.phase !== 'needs-input') {
      inputPause.previousPhase = update.phase
    }
    if (update.currentAction && update.currentAction !== INPUT_PAUSE_ACTION) {
      inputPause.previousCurrentAction = update.currentAction
    }
    if (update.nextAction && update.nextAction !== INPUT_PAUSE_NEXT_ACTION) {
      inputPause.previousNextAction = update.nextAction
    }
    effectiveUpdate = {
      ...update,
      phase: 'needs-input',
      currentAction: INPUT_PAUSE_ACTION,
      nextAction: INPUT_PAUSE_NEXT_ACTION,
    }
  }
  next[index] = sanitizeRun({ ...run, ...effectiveUpdate })
  writeRuns(next)
  window.dispatchEvent(
    new CustomEvent<ActiveAgentRun>(AGENT_RUN_STATE_EVENT, {
      detail: next[index],
    })
  )
}

/**
 * Pause the run that requested an approval. Older clients do not include a
 * session id, so they retain the previous most-recent-run fallback.
 */
export function pauseLatestActiveAgentRunForInput(
  operationId: string,
  sessionId?: string
): string | null {
  const boundedOperationId = operationId.slice(0, 160)
  const existingRunKey = inputPauseRunByOperation.get(boundedOperationId)
  if (existingRunKey) {
    return inputPausesByRun.get(existingRunKey)?.sessionId ?? null
  }

  const runs = getActiveAgentRuns()
  const run = sessionId
    ? runs.find((candidate) => candidate.sessionId === sessionId)
    : runs.at(-1)
  if (!run) return null
  const runKey = inputPauseKey(run.sessionId, run.startedAt)
  let pause = inputPausesByRun.get(runKey)
  if (!pause) {
    pause = {
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      previousPhase:
        run.phase && run.phase !== 'needs-input' ? run.phase : 'working',
      previousCurrentAction: run.currentAction,
      previousNextAction: run.nextAction,
      operationIds: new Set(),
    }
    inputPausesByRun.set(runKey, pause)
  }
  pause.operationIds.add(boundedOperationId)
  inputPauseRunByOperation.set(boundedOperationId, runKey)
  updateActiveAgentRun(run.sessionId, {
    phase: 'needs-input',
    currentAction: INPUT_PAUSE_ACTION,
    nextAction: INPUT_PAUSE_NEXT_ACTION,
    lastActivityAt: Date.now(),
  })
  return run.sessionId
}

/**
 * Restore the exact phase that was active before the approval request. Several
 * operations can queue for one run; resolving one must not clear the pause
 * while another approval for that same logical run is still waiting.
 */
export function resumeActiveAgentRunAfterInput(operationId: string): boolean {
  const boundedOperationId = operationId.slice(0, 160)
  const runKey = inputPauseRunByOperation.get(boundedOperationId)
  if (!runKey) return false
  inputPauseRunByOperation.delete(boundedOperationId)
  const pause = inputPausesByRun.get(runKey)
  if (!pause) return false
  pause.operationIds.delete(boundedOperationId)
  if (pause.operationIds.size > 0) return true
  inputPausesByRun.delete(runKey)

  const run = getActiveAgentRuns().find(
    (candidate) =>
      candidate.sessionId === pause.sessionId &&
      candidate.startedAt === pause.startedAt
  )
  if (!run || run.phase !== 'needs-input') return true
  updateActiveAgentRun(pause.sessionId, {
    phase: pause.previousPhase,
    currentAction: pause.previousCurrentAction,
    nextAction: pause.previousNextAction,
    lastActivityAt: Date.now(),
  })
  return true
}

/**
 * Keeps the live stop callback outside the mounted chat component. Switching
 * tabs can unmount Flow while its async turn continues, but the tab bar and a
 * newly mounted copy of the conversation can still stop that exact session.
 */
export function registerActiveAgentRunControl(
  sessionId: string,
  stop: () => void
): () => void {
  runControls.set(sessionId, stop)
  return () => {
    if (runControls.get(sessionId) === stop) runControls.delete(sessionId)
  }
}

export function requestActiveAgentRunStop(sessionId: string): boolean {
  const stop = runControls.get(sessionId)
  if (!stop) return false
  stop()
  return true
}

/**
 * Keeps steering attached to the active run even when its original chat view
 * unmounts. A newly opened copy of the tab can enqueue into the live turn
 * instead of creating a disconnected local queue.
 */
export function registerActiveAgentRunSteering(
  sessionId: string,
  enqueue: (message: AgentRunSteeringMessage) => void
): () => void {
  runSteeringControls.set(sessionId, enqueue)
  return () => {
    if (runSteeringControls.get(sessionId) === enqueue) {
      runSteeringControls.delete(sessionId)
    }
  }
}

export function requestActiveAgentRunSteering(
  sessionId: string,
  message: AgentRunSteeringMessage
): boolean {
  const enqueue = runSteeringControls.get(sessionId)
  if (!enqueue) return false
  enqueue({
    id: message.id.slice(0, 160),
    messageId: message.messageId.slice(0, 160),
    text: message.text.slice(0, 20_000),
    content: message.content.slice(0, 20_000),
    timestamp:
      Number.isFinite(message.timestamp) && message.timestamp > 0
        ? message.timestamp
        : Date.now(),
    attachments: message.attachments?.slice(0, 20).map((attachment) => ({
      name: attachment.name.slice(0, 255),
      mediaType: attachment.mediaType.slice(0, 120),
      size: Math.max(0, attachment.size),
      kind: attachment.kind,
      readable: attachment.readable,
    })),
  })
  return true
}

export function notifyAgentRunSteeringConsumed(
  sessionId: string,
  messageIds: string[]
) {
  window.dispatchEvent(
    new CustomEvent(AGENT_STEERING_CONSUMED_EVENT, {
      detail: {
        sessionId,
        messageIds: messageIds.slice(0, 32).map((id) => id.slice(0, 160)),
      },
    })
  )
}

export function hasActiveAgentRunControl(sessionId: string): boolean {
  return runControls.has(sessionId)
}

/**
 * A window reload mid-run keeps the persisted run entry while its live
 * controls die with the page, leaving a run nothing can stop or drain past.
 * Returns entries that have no registered control and have also been idle past
 * the grace period. The caller clears each entry only after its recovery note
 * is durably persisted, so a storage failure cannot discard the sole recovery
 * source.
 */
export function sweepOrphanedAgentRuns(
  maxIdleMs = 15_000,
  now = Date.now()
): ActiveAgentRun[] {
  const orphaned = getActiveAgentRuns().filter((run) => {
    if (runControls.has(run.sessionId)) return false
    const lastActivityAt = run.lastActivityAt ?? run.startedAt
    return now - lastActivityAt > maxIdleMs
  })
  return orphaned
}

export function rememberAgentSession(sessionId: string) {
  if (!sessionId) return
  localStorage.setItem(LAST_SESSION_KEY, sessionId)
}

export function getLastAgentSessionId(): string | null {
  const value = localStorage.getItem(LAST_SESSION_KEY)
  return value && value.length <= 160 ? value : null
}

const LAST_SCOPE_KEY = 'statskey.agent.lastScope.v1'

export function rememberAgentScope(scope: 'personal' | 'work') {
  localStorage.setItem(LAST_SCOPE_KEY, scope)
}

export function getLastAgentScope(): 'personal' | 'work' | null {
  const value = localStorage.getItem(LAST_SCOPE_KEY)
  return value === 'work' || value === 'personal' ? value : null
}

function writeRuns(runs: ActiveAgentRun[]) {
  durableSetItem(
    ACTIVE_RUN_KEY,
    JSON.stringify(
      runs.map((run) => {
        const sanitized = sanitizeRun(run)
        const { ownerId, ...persisted } = sanitized
        return { ...persisted, owner: ownerId ?? rendererOwnerId }
      })
    )
  )
}

function sanitizeRun(run: ActiveAgentRun): ActiveAgentRun {
  return {
    ...run,
    messageId: run.messageId?.slice(0, 160),
    ownerId: run.ownerId?.slice(0, 160),
    title: run.title.slice(0, 120),
    objective: run.objective?.slice(0, 600),
    workspaceId: run.workspaceId?.slice(0, 160),
    workspaceLabel: run.workspaceLabel?.slice(0, 120),
    workspaceRoots: run.workspaceRoots?.slice(0, 16).map((root) => root.slice(0, 500)),
    currentAction: run.currentAction?.slice(0, 240),
    currentLocation: run.currentLocation?.slice(0, 500),
    lastCompleted: run.lastCompleted?.slice(0, 500),
    nextAction: run.nextAction?.slice(0, 500),
    modelLabel: run.modelLabel?.slice(0, 120),
    liveUpdate: run.liveUpdate?.slice(0, 2_000),
    recentSteps: run.recentSteps
      ?.slice(-MAX_RECENT_STEPS)
      .map((step) => ({
        id: step.id.slice(0, 160),
        name: step.name?.slice(0, 120),
        label: step.label.slice(0, 240),
        summary: step.summary?.slice(0, 360),
        resultMeta: step.resultMeta?.slice(0, 240),
        status: step.status,
        agent: step.agent?.slice(0, 120),
        rationale: step.rationale?.slice(0, 320),
        preview: sanitizePreview(step.preview),
        ms:
          typeof step.ms === 'number' && Number.isFinite(step.ms)
            ? Math.max(0, step.ms)
            : undefined,
        startedAt:
          typeof step.startedAt === 'number' && Number.isFinite(step.startedAt)
            ? step.startedAt
            : undefined,
      })),
  }
}

function isAgentRunPhase(value: unknown): value is AgentRunPhase {
  return (
    value === 'starting' ||
    value === 'queued' ||
    value === 'thinking' ||
    value === 'working' ||
    value === 'needs-input' ||
    value === 'finishing' ||
    value === 'responding' ||
    value === 'stopping'
  )
}

function inputPauseKey(sessionId: string, startedAt: number): string {
  return `${sessionId}\u0000${startedAt}`
}

function isAgentMode(value: unknown): value is NonNullable<ActiveAgentRun['agentMode']> {
  return value === 'ask' || value === 'plan' || value === 'debug' || value === 'agent'
}

function isTaskExpectation(
  value: unknown
): value is NonNullable<ActiveAgentRun['taskExpectation']> {
  return (
    value === 'workspace-change' ||
    value === 'external-action' ||
    value === 'answer'
  )
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

function decodeWorkspaceRoots(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const roots = value
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
    .slice(0, 16)
    .map((root) => root.slice(0, 500))
  return roots.length > 0 ? roots : undefined
}

function decodeRecentSteps(value: unknown): AgentRunStepSummary[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .filter(
      (step): step is Record<string, unknown> =>
        step != null &&
        typeof step === 'object' &&
        typeof (step as Record<string, unknown>).id === 'string' &&
        typeof (step as Record<string, unknown>).label === 'string' &&
        ((step as Record<string, unknown>).status === 'running' ||
          (step as Record<string, unknown>).status === 'done' ||
          (step as Record<string, unknown>).status === 'error')
    )
    .slice(-MAX_RECENT_STEPS)
    .map((step) => ({
      id: String(step.id).slice(0, 160),
      name:
        typeof step.name === 'string' ? step.name.slice(0, 120) : undefined,
      label: String(step.label).slice(0, 240),
      summary:
        typeof step.summary === 'string'
          ? step.summary.slice(0, 360)
          : undefined,
      resultMeta:
        typeof step.resultMeta === 'string'
          ? step.resultMeta.slice(0, 240)
          : undefined,
      status: step.status as AgentRunStepSummary['status'],
      agent:
        typeof step.agent === 'string' ? step.agent.slice(0, 120) : undefined,
      rationale:
        typeof step.rationale === 'string'
          ? step.rationale.slice(0, 320)
          : undefined,
      preview: decodePreview(step.preview),
      ms:
        typeof step.ms === 'number' && Number.isFinite(step.ms)
          ? Math.max(0, step.ms)
          : undefined,
      startedAt:
        typeof step.startedAt === 'number' && Number.isFinite(step.startedAt)
          ? step.startedAt
          : undefined,
    }))
}

function sanitizePreview(preview: AgentRunPreview | undefined): AgentRunPreview | undefined {
  if (!preview) return undefined
  return {
    kind: preview.kind,
    title: preview.title.slice(0, 240),
    body: preview.body?.slice(0, 2_200),
    before: preview.before?.slice(0, 1_100),
    after: preview.after?.slice(0, 1_100),
    language: preview.language?.slice(0, 40),
    additions: finiteNonNegativeInteger(preview.additions),
    deletions: finiteNonNegativeInteger(preview.deletions),
    filePath: preview.filePath?.slice(0, 1_000),
    line: positiveInteger(preview.line),
    checkpointId:
      typeof preview.checkpointId === 'string' &&
      /^[a-f0-9-]{16,80}$/i.test(preview.checkpointId)
        ? preview.checkpointId
        : undefined,
    objective: preview.objective?.slice(0, 1_200),
    summary: preview.summary?.slice(0, 4_000),
    sourceUrls: preview.sourceUrls
      ?.map(sanitizeResearchUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 12),
    items: preview.items?.slice(0, 8).map((item) => ({
      label: item.label.slice(0, 140),
      detail: item.detail?.slice(0, 120),
    })),
  }
}

function decodePreview(value: unknown): AgentRunPreview | undefined {
  if (!value || typeof value !== 'object') return undefined
  const preview = value as Record<string, unknown>
  if (
    ![
      'files',
      'code',
      'diff',
      'command',
      'browser',
      'text',
      'investigation',
    ].includes(String(preview.kind)) ||
    typeof preview.title !== 'string'
  ) {
    return undefined
  }
  const items = Array.isArray(preview.items)
    ? preview.items
        .filter(
          (item): item is Record<string, unknown> =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).label === 'string'
        )
        .slice(0, 8)
        .map((item) => ({
          label: String(item.label).slice(0, 140),
          detail:
            typeof item.detail === 'string'
              ? item.detail.slice(0, 120)
              : undefined,
        }))
    : undefined
  return sanitizePreview({
    kind: preview.kind as AgentRunPreview['kind'],
    title: preview.title,
    body: typeof preview.body === 'string' ? preview.body : undefined,
    before: typeof preview.before === 'string' ? preview.before : undefined,
    after: typeof preview.after === 'string' ? preview.after : undefined,
    language:
      typeof preview.language === 'string' ? preview.language : undefined,
    additions: finiteNonNegativeInteger(preview.additions),
    deletions: finiteNonNegativeInteger(preview.deletions),
    filePath:
      typeof preview.filePath === 'string' ? preview.filePath : undefined,
    line: positiveInteger(preview.line),
    checkpointId:
      typeof preview.checkpointId === 'string'
        ? preview.checkpointId
        : undefined,
    objective:
      typeof preview.objective === 'string' ? preview.objective : undefined,
    summary: typeof preview.summary === 'string' ? preview.summary : undefined,
    sourceUrls: Array.isArray(preview.sourceUrls)
      ? preview.sourceUrls.filter(
          (url): url is string => typeof url === 'string'
        )
      : undefined,
    items,
  })
}

function sanitizeResearchUrl(value: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2_000) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return undefined
    }
    return parsed.toString()
  } catch {
    return undefined
  }
}
