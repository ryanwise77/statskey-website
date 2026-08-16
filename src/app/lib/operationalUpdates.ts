import type { ChatSessionMessage } from './data/useChatSessions'

export type OperationalUpdateState = 'running' | 'done' | 'error'

export interface OperationalUpdateInput {
  id: string
  key: string
  content: string
  state: OperationalUpdateState
  timestamp: Date
  /** Parallel tool rows remain independently live until their own result. */
  settlePrevious?: boolean
}

/**
 * Keeps one concise transcript row per semantic operation. Starting a new
 * operation settles the previous live row, while a repeated tool updates its
 * existing row instead of growing an indefinite wall of near-duplicates.
 */
export function upsertOperationalUpdate(
  messages: ChatSessionMessage[],
  update: OperationalUpdateInput
): ChatSessionMessage[] {
  const content = update.content.trim()
  if (!content) return messages

  let existingIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    // A follow-up sent during a run is a real chronological boundary. Never
    // reach above it and mutate an older progress row in place, otherwise the
    // interface appears to keep working "above" the user's newest message.
    // The next progress event belongs after that message, just like a normal
    // conversation.
    if (message.role === 'user') break
    if (
      message.operational === true &&
      message.operationalKey === update.key
    ) {
      existingIndex = index
      break
    }
  }
  let changed = existingIndex < 0
  const next = messages.map((message, index) => {
    if (index === existingIndex) {
      if (
        message.content === content &&
        operationalUpdateState(message) === update.state
      ) {
        return message
      }
      changed = true
      return {
        ...message,
        content,
        timestamp: update.timestamp,
        operationalState: update.state,
      }
    }
    if (
      update.settlePrevious !== false &&
      message.operational === true &&
      operationalUpdateState(message) === 'running'
    ) {
      changed = true
      return { ...message, operationalState: 'done' as const }
    }
    return message
  })

  if (existingIndex < 0) {
    next.push({
      id: update.id,
      role: 'model',
      content,
      timestamp: update.timestamp,
      operational: true,
      operationalKey: update.key,
      operationalState: update.state,
    })
  }
  return changed ? next : messages
}

/** Removes every stale spinner before a final response or terminal error. */
export function settleOperationalUpdates(
  messages: ChatSessionMessage[],
  terminalState: Exclude<OperationalUpdateState, 'running'> = 'done'
): ChatSessionMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (
      message.operational !== true ||
      operationalUpdateState(message) !== 'running'
    ) {
      return message
    }
    changed = true
    return { ...message, operationalState: terminalState }
  })
  return changed ? next : messages
}

export const INTERRUPTED_RUN_MESSAGE =
  'I couldn’t finish this run because StatsKey closed or reloaded before the provider returned. Completed actions and the last objective were saved. Continue from saved progress to inspect the current state and resume without replaying completed actions.'

export interface InterruptedRunSnapshot {
  sessionId?: string
  messageId?: string
  startedAt: number
  workspaceId?: string
  workspaceLabel?: string
  workspaceRoots?: string[]
  agentMode?: 'ask' | 'plan' | 'debug' | 'agent'
  taskExpectation?: 'workspace-change' | 'external-action' | 'answer'
  recentSteps?: Array<{
    name?: string
    summary?: string
    resultMeta?: string
    status: 'running' | 'done' | 'error'
    agent?: string
    rationale?: string
    preview?: ChatSessionMessage['steps'] extends Array<infer T> | undefined
      ? T extends { preview?: infer P }
        ? P
        : never
      : never
    ms?: number
  }>
}

/**
 * A persisted spinner cannot represent live work when the desktop renderer has
 * no matching run. Turn it into a terminal error and add a normal assistant
 * message so the transcript exposes the existing retry action.
 */
export function recoverInterruptedOperationalTranscript(
  messages: ChatSessionMessage[],
  recovery: {
    id: string
    timestamp: Date
    run?: InterruptedRunSnapshot
  },
  force = false
): ChatSessionMessage[] {
  const settled = settleOperationalUpdates(messages, 'error')
  if (settled === messages && !force) return messages
  const runId = recovery.run?.sessionId
    ? `${recovery.run.sessionId}:${recovery.run.startedAt}`
    : recovery.id
  const existingIndex = settled.findIndex(
    (message) =>
      message.role === 'model' && message.interruptedRun?.runId === runId
  )
  const savedSteps = recovery.run?.recentSteps?.map((step) => ({
    name: step.name || 'interrupted_action',
    summary: step.summary || step.name || 'Saved action',
    resultMeta:
      step.status === 'running'
        ? 'run interrupted before this action completed'
        : step.resultMeta,
    failed: step.status === 'done' ? undefined : true,
    agent: step.agent,
    rationale: step.rationale,
    preview: step.preview,
    ms: step.ms,
  }))
  const interruption: ChatSessionMessage = {
    id: recovery.id,
    role: 'model',
    content: INTERRUPTED_RUN_MESSAGE,
    timestamp: recovery.timestamp,
    agentMode: recovery.run?.agentMode,
    taskExpectation: recovery.run?.taskExpectation,
    interruptedRun: {
      runId,
      sessionId: recovery.run?.sessionId,
      messageId: recovery.run?.messageId,
      workspaceId: recovery.run?.workspaceId,
      workspaceLabel: recovery.run?.workspaceLabel,
      workspaceRoots: recovery.run?.workspaceRoots,
    },
    durationMs: recovery.run
      ? Math.max(0, recovery.timestamp.getTime() - recovery.run.startedAt)
      : undefined,
    steps: savedSteps?.length ? savedSteps : undefined,
  }
  if (existingIndex >= 0) {
    if (
      settled[existingIndex].steps?.length ||
      !interruption.steps?.length
    ) {
      return settled
    }
    const enriched = [...settled]
    enriched[existingIndex] = {
      ...settled[existingIndex],
      ...interruption,
      id: settled[existingIndex].id,
      timestamp: settled[existingIndex].timestamp,
    }
    return enriched
  }
  return [...settled, interruption]
}

/** Persisted updates from older builds are historical, never secretly live. */
export function operationalUpdateState(
  message: Pick<ChatSessionMessage, 'operationalState'>
): OperationalUpdateState {
  return message.operationalState === 'running' ||
    message.operationalState === 'error'
    ? message.operationalState
    : 'done'
}
