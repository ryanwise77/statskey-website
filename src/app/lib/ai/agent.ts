import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import {
  anthropicChat,
  type AnthropicChatResponse,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicMonthlyUsage,
  type AnthropicToolDef,
  type AnthropicToolUseBlock,
  type ClaudeModel,
} from './anthropic'
import {
  AGENT_TOOLS,
  SIDE_EFFECT_TOOL_NAMES,
  SUBAGENT_TOOLS,
  AgentDataCache,
  executeTool,
  previewForToolCall,
  sanitizeToolPreviewText,
  type AgentToolPreview,
} from './tools'
import type { ChatProvider, ReasoningEffort } from './providers'
import {
  getDesktopBridge,
  type DesktopApprovalMode,
  type DesktopProviderId,
  type DesktopWorkspaceBinding,
} from '../desktop'
import { adaptiveDelegationAllowed } from './orchestration'
import {
  completionHandoffPrompt,
  fallbackCompletionHandoff,
  fallbackStoppedHandoff,
  hasReviewableWorkspaceChange,
  hasOutstandingFileMutationFailure,
  hasSuccessfulFileChange,
  implementationCheckpoint as implementationPersistenceCheckpoint,
  implementationProgressKey,
  implementationReadyForHandoff,
  implementationRecoveryPrompt,
  implementationToolPhase,
  providerTimeoutRecoveryPrompt,
  workspaceChangeExpected,
  workspaceWriteRecoveryReadNeeded,
  type AgentTaskExpectation,
} from './agentPersistence'
import {
  MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
  automaticImplementationContinuationPrompt,
  independentImplementationContinuationDecision,
  requiredClaimIdentifiersWithoutEvidence,
  unsupportedImplementationClaimObligations,
  userContentWithAutomaticContinuation,
} from './agentContinuation'
import {
  createWorkspaceExecutionLease,
  toolNeedsWorkspaceLease,
  type WorkspaceExecutionLease,
} from './workspaceExecutionCoordinator'
import {
  ProviderRoundTimeoutError,
  withProviderRoundWatchdog,
  type ProviderWatchdogSignal,
} from './providerWatchdog'
import {
  AgentRoundCancelledError,
  isAgentRoundDeadline,
  withCancellableAgentRound,
} from './agentLifecycle'
import {
  workspaceManifestAlreadyLoaded,
  workspaceSearchMissBudgetExhausted,
} from './workspaceSearchRecovery'
import { withProviderTools } from './providerRequest'
import {
  appendThinkingContinuation,
  isLegacyManagedClaudeEmptyError,
  isThinkingOnlyMaxTokenResponse,
  managedClaudeExhaustionPrompt,
} from './managedClaudeRecovery'

/**
 * The web Intelligence agent loop — the counterpart of the iOS
 * ChatToolRouter round-trip, for every managed provider:
 *
 *   - Claude routes through the same reliable callable tool loop iOS uses.
 *     Only the finished answer is progressively revealed in the chat UI.
 *   - ChatGPT, Grok, and Kimi route through their callables with Chat-Completions
 *     tool calling (converted server-side to the Responses API).
 *
 * Tool calls execute client-side against the user's own Firestore record,
 * and every step is reported live to the UI (and persisted with the message).
 */

export interface AgentStep {
  id: string
  name: string
  /** Human-readable one-liner of the call, e.g. keyword_search("oatmeal"). */
  summary: string
  /** Short result line, e.g. "12 matches". */
  resultMeta?: string
  status: 'running' | 'done' | 'error'
  /** Professional role responsible for this action. */
  agent: string
  /** Concise, user-visible decision rationale; never hidden chain-of-thought. */
  rationale: string
  /** Bounded local-only evidence shown while this turn is active. */
  preview?: AgentToolPreview
  /** True when the step ran inside a dispatched subagent. */
  sub?: boolean
  /** Elapsed milliseconds once finished. */
  ms?: number
  startedAt?: number
}

export interface AgentTurnResult {
  content: string
  steps: AgentStep[]
  creditsCharged: number
  monthlyUsage?: AnthropicMonthlyUsage
  citations: string[]
  rounds: number
}

export interface AgentTurnParams {
  uid: string
  provider: ChatProvider
  modelId: string
  serviceTier?: 'fast'
  reasoningEffort: ReasoningEffort
  contextWindowTokens: number
  executionRoute: 'managed' | 'direct'
  directProvider: DesktopProviderId
  reasoningMode: 'standard' | 'pro'
  agentMode: 'ask' | 'plan' | 'debug' | 'agent'
  taskExpectation?: AgentTaskExpectation
  contextScope: 'personal' | 'work'
  /** Per-workspace opt-in. Never enables inbox, calendar, or personal memory. */
  includePersonalHealth?: boolean
  approvalMode: DesktopApprovalMode
  orchestrationMode: 'focused' | 'adaptive' | 'parallel'
  systemPrompt: string
  /** Prior conversation turns as plain text. */
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>
  userText: string
  userContent?: string | AnthropicContentBlock[]
  sessionId?: string
  messageId?: string
  workspaceRoots?: string[]
  workspaceLabel?: string
  /** Electron workspace identity captured at send; never included in model input. */
  workspaceBinding?: DesktopWorkspaceBinding
  onStep: (steps: AgentStep[]) => void
  /** Live streamed text of the answer-in-progress (Claude routes). */
  onText?: (text: string) => void
  /** User-facing operational commentary emitted before a final answer. */
  onProgress?: (text: string) => void
  /** Action-level provider state for activity UI; never hidden reasoning. */
  onStatus?: (status: {
    phase: 'queued' | 'thinking' | 'finishing' | 'responding'
    message: string
    queuePosition?: number
    round?: number
  }) => void
  /** Reports when older turns were condensed instead of silently discarded. */
  onContextCompacted?: (summary: {
    compactedTurns: number
    retainedTurns: number
  }) => void
  /** Optional cooperative stop: checked between rounds. */
  shouldStop?: () => boolean
  /**
   * Drains user follow-ups that arrived while a provider/tool round was in
   * progress. Follow-ups are incorporated at the next safe model boundary;
   * they never cancel an in-flight tool or provider request.
   */
  consumeSteering?: () => Array<{ id: string; text: string }>
  /** Supplies immediate cancellation for a native streaming request. */
  registerCancel?: (cancel: (() => void) | null, key?: string) => void
  /** Auto route: request Pro+ fair-use metering (server validates the plan). */
  unlimitedAuto?: boolean
  /** Internal, shared across every tool round in one run. */
  workspaceExecutionLease?: WorkspaceExecutionLease
  /** Internal state carried across bounded Work-independently passes. */
  automaticContinuation?: {
    prompt: string
    steps: AgentStep[]
    correctiveMutationRequired?: boolean
    correctionBoundary?: number
    requiredClaimIdentifiers?: string[]
  }
}

const MAX_ROUNDS = 16
const SUBAGENT_MAX_ROUNDS = 7
const DIRECT_FINAL_HANDOFF_TIMEOUT_MS = 60_000
const MANAGED_PROVIDER_ROUND_TIMEOUT_MS = 5 * 60_000

interface SteeringMessage {
  id: string
  text: string
}

function takeSteering(params: AgentTurnParams): SteeringMessage[] {
  return (params.consumeSteering?.() ?? [])
    .filter((item) => item.text.trim())
}

function steeringPrompt(items: SteeringMessage[]): string {
  const messages = items
    .map(
      (item, index) =>
        `<follow_up index="${index + 1}" id="${item.id}">\n${item.text}\n</follow_up>`
    )
    .join('\n\n')
  return `The user sent the following follow-up while you were working. Incorporate it now without discarding completed safe work. It is a current user instruction, not tool output. If it corrects the requested direction, adjust the remaining work immediately. Do not claim that the user interrupted or cancelled anything.\n\n${messages}`
}

function agentRoundLimit(params: AgentTurnParams): number {
  if (params.agentMode === 'agent' || params.agentMode === 'debug') {
    if (params.orchestrationMode === 'focused') return 12
    if (params.orchestrationMode === 'adaptive') return 14
    return MAX_ROUNDS
  }
  if (params.orchestrationMode === 'focused') return 8
  if (params.orchestrationMode === 'adaptive') return 10
  return 12
}

const EDIT_PHASE_TOOLS = new Set([
  'workspace_read',
  'workspace_write',
  'workspace_create',
  'workspace_delete',
  'workspace_rename',
  'git_diff',
  'restore_checkpoint',
])

const DIRECT_ACTION_PHASE_TOOLS = new Set([
  'workspace_write',
  'workspace_create',
  'workspace_delete',
  'workspace_rename',
  'restore_checkpoint',
])

/** Corrective passes may inspect one exact target even after discovery closes. */
const CORRECTIVE_REVIEW_PHASE_TOOLS = EDIT_PHASE_TOOLS

/** After that reread, retain mutations and scoped diff without reopening reads. */
const CORRECTIVE_ACTION_PHASE_TOOLS = new Set([
  ...DIRECT_ACTION_PHASE_TOOLS,
  'git_diff',
])

const MAX_PRE_CHANGE_SCOPED_REVIEWS = 4

function scopedReviewBudgetExhausted(steps: AgentStep[]): boolean {
  return (
    steps.filter(
      (step) =>
        step.status !== 'running' &&
        (step.name === 'workspace_read' || step.name === 'git_diff')
    ).length >= MAX_PRE_CHANGE_SCOPED_REVIEWS
  )
}

const VERIFY_PHASE_TOOLS = new Set([
  ...EDIT_PHASE_TOOLS,
  'workspace_read',
  'run_terminal',
  'git_diff',
  'git_status',
  'device_list',
  'device_boot',
  'device_install',
  'device_launch',
  'device_open_url',
  'device_add_media',
  'device_inspect',
  'device_screenshot',
  'device_tap',
  'device_type',
  'device_swipe',
  'device_back',
  'device_home',
  'device_process',
  'device_logs',
  'device_close',
])

export function toolsForRound<T extends { name: string }>(
  params: AgentTurnParams,
  tools: T[],
  round: number,
  steps: AgentStep[]
): T[] {
  const searchExhausted = workspaceSearchMissBudgetExhausted(steps)
  const manifestLoaded = workspaceManifestAlreadyLoaded(steps)
  const boundedTools = tools.filter(
    (tool) =>
      !(searchExhausted && tool.name === 'workspace_search') &&
      !(manifestLoaded && tool.name === 'workspace_manifest')
  )
  const correctionPending = automaticCorrectionPending(params, steps)
  const claimEvidencePending = automaticClaimEvidencePending(params, steps)
  const outstandingMutationFailure = hasOutstandingFileMutationFailure(steps)
  if (
    correctionPending ||
    claimEvidencePending ||
    outstandingMutationFailure
  ) {
    const boundary = Math.max(
      0,
      Math.floor(
        params.automaticContinuation?.correctionBoundary ??
          params.automaticContinuation?.steps.length ??
          0
      )
    )
    const continuationReadNeeded =
      (correctionPending || claimEvidencePending) &&
      !steps.slice(boundary).some(
        (step) =>
          step.name === 'workspace_read' && step.status === 'done'
      )
    const allowed =
      workspaceWriteRecoveryReadNeeded(steps) || continuationReadNeeded
        ? CORRECTIVE_REVIEW_PHASE_TOOLS
        : CORRECTIVE_ACTION_PHASE_TOOLS
    return boundedTools.filter((tool) => allowed.has(tool.name))
  }
  const phase = implementationToolPhase(
    completionModeForTurn(params),
    round,
    steps,
    correctionPending || claimEvidencePending
  )
  if (phase === 'edit') {
    const allowed = scopedReviewBudgetExhausted(steps)
      ? DIRECT_ACTION_PHASE_TOOLS
      : EDIT_PHASE_TOOLS
    return boundedTools.filter((tool) => allowed.has(tool.name))
  }
  if (phase === 'verify') {
    return boundedTools.filter((tool) => VERIFY_PHASE_TOOLS.has(tool.name))
  }
  return boundedTools
}

function automaticCorrectionPending(
  params: AgentTurnParams,
  steps: AgentStep[]
): boolean {
  const continuation = params.automaticContinuation
  if (!continuation?.correctiveMutationRequired) return false
  const boundary = Math.max(
    0,
    Math.floor(continuation.correctionBoundary ?? continuation.steps.length)
  )
  return !hasSuccessfulFileChange(steps.slice(boundary))
}

function automaticClaimEvidencePending(
  params: AgentTurnParams,
  steps: AgentStep[]
): boolean {
  const claims = params.automaticContinuation?.requiredClaimIdentifiers ?? []
  return requiredClaimIdentifiersWithoutEvidence(claims, steps).length > 0
}

function implementationReadyForTurn(
  params: AgentTurnParams,
  steps: AgentStep[]
): boolean {
  return (
    !automaticCorrectionPending(params, steps) &&
    !automaticClaimEvidencePending(params, steps) &&
    implementationReadyForHandoff(completionModeForTurn(params), steps)
  )
}

function isImplementationMode(
  mode: AgentTurnParams['agentMode']
): boolean {
  return mode === 'agent' || mode === 'debug'
}

function isWorkspaceChangeTurn(params: AgentTurnParams): boolean {
  return workspaceChangeExpected(params.agentMode, params.taskExpectation)
}

function completionModeForTurn(
  params: AgentTurnParams
): AgentTurnParams['agentMode'] {
  return isWorkspaceChangeTurn(params)
    ? params.agentMode
    : params.agentMode === 'plan'
      ? 'plan'
      : 'ask'
}

function implementationRecoveryUpdate(steps: AgentStep[]): string {
  return hasSuccessfulFileChange(steps) || hasReviewableWorkspaceChange(steps)
    ? 'The change set is present, but that pass tried to finish before verification. I’m running the smallest relevant check before I call the task complete.'
    : 'That pass tried to finish without implementing a file change. I’m continuing through the direct safe edit path before I call the task complete.'
}

class FinalHandoffTimeoutError extends Error {}

function providerWatchdogSignal(
  event: { type: 'queued' | 'open' | 'text' | 'activity' }
): ProviderWatchdogSignal {
  return event.type === 'queued' ? 'queued' : 'active'
}

export function isProviderRoundTimeout(error: unknown): boolean {
  return (
    error instanceof ProviderRoundTimeoutError ||
    (error instanceof Error && error.name === 'ProviderRoundTimeoutError') ||
    isAgentRoundDeadline(error)
  )
}

async function withFinalHandoffTimeout<T>(
  promise: Promise<T>,
  onTimeout?: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new FinalHandoffTimeoutError('Final handoff timed out.'))
        }, DIRECT_FINAL_HANDOFF_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function runManagedProviderRound<T>(
  params: AgentTurnParams,
  start: () => Promise<T>,
  timeoutMilliseconds = MANAGED_PROVIDER_ROUND_TIMEOUT_MS
): Promise<T> {
  return withCancellableAgentRound(start, {
    timeoutMilliseconds,
    shouldStop: params.shouldStop,
    registerCancel: params.registerCancel,
    cancellationKey: `managed-provider-${crypto.randomUUID()}`,
  })
}
const SUBAGENT_MODEL: ClaudeModel = 'claude-sonnet-5'

const PERSONAL_TOOL_NAMES = new Set([
  'index_manifest',
  'keyword_search',
  'semantic_search',
  'chunk_read',
  'get_unread_emails',
  'read_email_thread',
  'get_calendar_events',
  'get_meals',
  'get_meals_for_date',
  'get_daily_overview',
  'search_food_history',
  'get_workouts',
  'get_workout_detail',
  'analyze_run_segments',
  'get_glucose_readings',
  'get_wellness',
  'get_meals_before_event',
  'get_weight_history',
  'get_nutrient_totals',
  'get_scratch_pad',
  'update_scratch_pad',
  'propose_calendar_event',
  'propose_email',
])

const PERSONAL_HEALTH_TOOL_NAMES = new Set([
  'index_manifest',
  'keyword_search',
  'semantic_search',
  'chunk_read',
  'get_meals',
  'get_meals_for_date',
  'get_daily_overview',
  'search_food_history',
  'get_workouts',
  'get_workout_detail',
  'analyze_run_segments',
  'get_glucose_readings',
  'get_wellness',
  'get_meals_before_event',
  'get_weight_history',
  'get_nutrient_totals',
])

const WORK_TOOL_NAMES = new Set([
  'workspace_manifest',
  'workspace_search',
  'workspace_read',
  'workspace_write',
  'workspace_create',
  'workspace_delete',
  'workspace_rename',
  'run_terminal',
  'git_status',
  'git_diff',
  'list_checkpoints',
  'restore_checkpoint',
  'browser_list',
  'browser_open',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_screenshot',
  'browser_close',
  'application_list',
  'application_open',
  'device_list',
  'device_boot',
  'device_install',
  'device_launch',
  'device_open_url',
  'device_add_media',
  'device_inspect',
  'device_screenshot',
  'device_tap',
  'device_type',
  'device_swipe',
  'device_back',
  'device_home',
  'device_process',
  'device_logs',
  'device_close',
])

export function toolsForAgentMode(params: AgentTurnParams) {
  const modeTools = params.agentMode === 'agent' || params.agentMode === 'debug'
    ? AGENT_TOOLS
    : AGENT_TOOLS.filter((tool) => !SIDE_EFFECT_TOOL_NAMES.has(tool.name))
  return modeTools.filter((tool) => {
    const inScope =
      params.contextScope === 'work'
        ? !PERSONAL_TOOL_NAMES.has(tool.name) ||
          (params.includePersonalHealth === true &&
            PERSONAL_HEALTH_TOOL_NAMES.has(tool.name))
        : !WORK_TOOL_NAMES.has(tool.name)
    if (!inScope) return false
    if (params.orchestrationMode === 'focused') {
      return (
        tool.name !== 'run_subagent' &&
        tool.name !== 'run_parallel_investigations'
      )
    }
    if (params.orchestrationMode === 'adaptive') {
      if (!adaptiveDelegationAllowed(params.agentMode, params.userText)) {
        return (
          tool.name !== 'run_subagent' &&
          tool.name !== 'run_parallel_investigations'
        )
      }
      return true
    }
    return true
  })
}

function subagentToolsForScope(params: AgentTurnParams) {
  return SUBAGENT_TOOLS.filter((tool) =>
    params.contextScope === 'work'
      ? !PERSONAL_TOOL_NAMES.has(tool.name) ||
        (params.includePersonalHealth === true &&
          PERSONAL_HEALTH_TOOL_NAMES.has(tool.name))
      : !WORK_TOOL_NAMES.has(tool.name)
  )
}

async function toolsForAgentModeWithMcp(params: AgentTurnParams) {
  const tools = toolsForAgentMode(params)
  const bridge = getDesktopBridge()
  if (
    !bridge ||
    params.contextScope !== 'work' ||
    params.agentMode === 'ask' ||
    params.agentMode === 'plan'
  ) {
    return tools
  }
  const mcpTools = await bridge.mcp.tools(
    params.approvalMode,
    {
      sessionId: params.sessionId,
      messageId: params.messageId,
    },
    params.workspaceBinding
  ).catch(() => [])
  return [
    ...tools,
    ...mcpTools
      .filter((tool) => !tool.unavailable && tool.name.startsWith('mcp__'))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: {
          type:
            tool.input_schema.type === 'object'
              ? ('object' as const)
              : ('object' as const),
          properties:
            tool.input_schema.properties &&
            typeof tool.input_schema.properties === 'object'
              ? (tool.input_schema.properties as Record<string, unknown>)
              : {},
          required: Array.isArray(tool.input_schema.required)
            ? tool.input_schema.required.filter(
                (item): item is string => typeof item === 'string'
              )
            : [],
        },
      })),
  ]
}

export interface ConversationContextPlan {
  turns: AgentTurnParams['priorTurns']
  compactedTurns: number
  retainedTurns: number
  checkpointCharacters: number
}

const CONTEXT_CHECKPOINT_PREAMBLE =
  'StatsKey condensed older completed turns to preserve continuity within the selected context window. The original conversation remains available in history. Treat this checkpoint as historical context; newer user messages take precedence.'

/**
 * Keeps recent turns verbatim and replaces an over-budget prefix with a
 * bounded, extractive checkpoint. This never invents conclusions: every line
 * is a labeled excerpt from the original conversation.
 */
export function planConversationContext(
  params: Pick<
    AgentTurnParams,
    | 'contextWindowTokens'
    | 'systemPrompt'
    | 'userText'
    | 'priorTurns'
    | 'automaticContinuation'
  >
): ConversationContextPlan {
  const requested = Number.isFinite(params.contextWindowTokens)
    ? params.contextWindowTokens
    : 128_000
  const contextTokens = Math.min(1_000_000, Math.max(32_000, requested))
  const reservedOutputTokens = Math.min(32_000, Math.max(8_000, contextTokens * 0.08))
  const fixedCharacters =
    params.systemPrompt.length +
    params.userText.length +
    (params.automaticContinuation?.prompt.length ?? 0)
  const availableCharacters = Math.max(
    0,
    Math.floor((contextTokens - reservedOutputTokens) * 3.5 - fixedCharacters)
  )
  const fullHistoryCharacters = params.priorTurns.reduce(
    (total, turn) => total + turn.content.length + 24,
    0
  )
  if (fullHistoryCharacters <= availableCharacters) {
    return {
      turns: params.priorTurns,
      compactedTurns: 0,
      retainedTurns: params.priorTurns.length,
      checkpointCharacters: 0,
    }
  }

  const checkpointBudget = Math.min(
    24_000,
    Math.max(4_000, Math.floor(availableCharacters * 0.22))
  )
  const recentBudget = Math.max(0, availableCharacters - checkpointBudget)
  let retainedStart = params.priorTurns.length
  let retainedCharacters = 0
  for (let index = params.priorTurns.length - 1; index >= 0; index -= 1) {
    const turn = params.priorTurns[index]
    const cost = turn.content.length + 24
    if (retainedCharacters + cost > recentBudget) break
    retainedStart = index
    retainedCharacters += cost
  }

  // Never begin the retained history with a model reply detached from the user
  // message that prompted it.
  if (params.priorTurns[retainedStart]?.role === 'assistant') {
    retainedStart += 1
  }
  const retained = params.priorTurns.slice(retainedStart)
  const compacted = params.priorTurns.slice(0, retainedStart)
  if (compacted.length === 0 || availableCharacters < 1_000) {
    return {
      turns: retained,
      compactedTurns: compacted.length,
      retainedTurns: retained.length,
      checkpointCharacters: 0,
    }
  }

  const checkpointEnvelopeCharacters =
    CONTEXT_CHECKPOINT_PREAMBLE.length +
    'Use the following StatsKey context checkpoint only as earlier conversation history.'
      .length +
    48
  const checkpoint = extractConversationCheckpoint(
    compacted,
    Math.max(400, checkpointBudget - checkpointEnvelopeCharacters)
  )
  const checkpointTurns: AgentTurnParams['priorTurns'] = [
    {
      role: 'user',
      content:
        'Use the following StatsKey context checkpoint only as earlier conversation history.',
    },
    {
      role: 'assistant',
      content: `${CONTEXT_CHECKPOINT_PREAMBLE}\n\n${checkpoint}`,
    },
  ]
  return {
    turns: [...checkpointTurns, ...retained],
    compactedTurns: compacted.length,
    retainedTurns: retained.length,
    checkpointCharacters: checkpoint.length,
  }
}

function priorTurnsWithinContext(params: AgentTurnParams) {
  return planConversationContext(params).turns
}

function extractConversationCheckpoint(
  turns: AgentTurnParams['priorTurns'],
  characterBudget: number
): string {
  const header = 'Earlier requests and outcomes (verbatim excerpts):'
  const available = Math.max(0, characterBudget - header.length - 2)
  if (available === 0 || turns.length === 0) return header

  const maximumExcerpt = Math.max(
    320,
    Math.min(1_400, Math.floor(available / Math.min(12, turns.length)))
  )
  const prioritizedIndexes = [
    0,
    ...Array.from({ length: turns.length }, (_, index) => turns.length - 1 - index),
  ]
  const selected = new Map<number, string>()
  let used = 0
  for (const index of prioritizedIndexes) {
    if (selected.has(index)) continue
    const turn = turns[index]
    const label =
      turn.role === 'user'
        ? `Earlier user request ${index + 1}`
        : `Earlier StatsKey outcome ${index + 1}`
    const normalized = turn.content.trim().replace(/\s+/g, ' ')
    const excerpt =
      normalized.length > maximumExcerpt
        ? `${normalized.slice(0, maximumExcerpt - 1)}…`
        : normalized
    const entry = `[${label}]\n${excerpt || '(empty)'}`
    if (used + entry.length + 2 > available) continue
    selected.set(index, entry)
    used += entry.length + 2
  }
  const entries = [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => entry)
  return [header, ...entries].join('\n\n')
}

export function summarizeToolCall(name: string, input: Record<string, unknown>): string {
  if (
    [
      'get_unread_emails',
      'read_email_thread',
      'get_calendar_events',
    ].includes(name)
  ) {
    return `${name}([private request])`
  }
  const sensitiveKeys =
    /(?:content|text|prompt|body|notes|password|secret|token|api[_-]?key|authorization)/i
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (v == null || v === '') continue
    if (k === 'command') {
      parts.push('command: [reviewed]')
      continue
    }
    if (sensitiveKeys.test(k)) {
      const size =
        typeof v === 'string'
          ? v.length
          : JSON.stringify(v)?.length ?? 0
      parts.push(`${k}: [${size} chars]`)
      continue
    }
    const safeString = typeof v === 'string' ? sanitizeToolPreviewText(v) : ''
    const rendered =
      typeof v === 'string'
        ? `"${safeString.slice(0, 42)}${safeString.length > 42 ? '…' : ''}"`
        : Array.isArray(v)
          ? `[${v.length}]`
          : String(v)
    parts.push(`${k}: ${rendered}`)
  }
  return `${name}(${parts.join(', ')})`
}

export async function runAgentTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const contextPlan = planConversationContext(params)
  const workspaceBinding = immutableWorkspaceBinding(params.workspaceBinding)
  if (
    params.contextScope === 'work' &&
    isImplementationMode(params.agentMode) &&
    !workspaceBinding
  ) {
    throw new Error(
      'Open the intended workspace before starting this build. StatsKey could not capture an exact workspace binding.'
    )
  }
  if (params.contextScope === 'work' && workspaceBinding) {
    const bridge = getDesktopBridge()
    if (!bridge) {
      throw new Error('Workspace runs require the StatsKey desktop app.')
    }
    await bridge.workspace.getState(workspaceBinding)
  }
  if (contextPlan.compactedTurns > 0) {
    params.onContextCompacted?.({
      compactedTurns: contextPlan.compactedTurns,
      retainedTurns: contextPlan.retainedTurns,
    })
  }
  const workspaceExecutionLease = createWorkspaceExecutionLease({
    runId: params.sessionId || crypto.randomUUID(),
    workspaceId: workspaceBinding?.workspaceId,
    roots: params.workspaceRoots,
    label: params.workspaceLabel,
    shouldStop: params.shouldStop,
    onWaiting: (position, activeLabel) => {
      params.onStatus?.({
        phase: 'queued',
        message: `Waiting for ${activeLabel || 'this workspace'} — another task is editing or testing it`,
        queuePosition: position,
      })
    },
    onAcquired: () => {
      params.onStatus?.({
        phase: 'thinking',
        message: 'Workspace reserved for this task · edits and builds run one at a time',
      })
    },
  })
  const scopedParams: AgentTurnParams = {
    ...params,
    priorTurns: contextPlan.turns,
    workspaceBinding,
    workspaceExecutionLease,
  }
  try {
    let passParams = scopedParams
    let completedPasses = 0
    let creditsCharged = 0
    let rounds = 0
    let monthlyUsage: AnthropicMonthlyUsage | undefined
    const citations = new Set<string>()

    while (true) {
      const passResult = await runProviderPass(passParams)
      completedPasses += 1
      creditsCharged += passResult.creditsCharged
      rounds += passResult.rounds
      if (passResult.monthlyUsage) monthlyUsage = passResult.monthlyUsage
      for (const citation of passResult.citations) citations.add(citation)

      const result: AgentTurnResult = {
        ...passResult,
        creditsCharged,
        rounds,
        ...(monthlyUsage ? { monthlyUsage } : {}),
        citations: [...citations],
      }
      const decision = independentImplementationContinuationDecision({
        approvalMode: params.approvalMode,
        mode: params.agentMode,
        workspaceChangeExpected: isWorkspaceChangeTurn(params),
        objective: params.userText,
        content: result.content,
        steps: result.steps,
        stopped: params.shouldStop?.() === true,
        completedPasses,
        correctiveMutationRequired:
          passParams.automaticContinuation?.correctiveMutationRequired,
        correctionBoundary:
          passParams.automaticContinuation?.correctionBoundary,
        requiredClaimIdentifiers:
          passParams.automaticContinuation?.requiredClaimIdentifiers,
      })
      if (!decision.shouldContinue) {
        return decision.reason === 'correction_cap'
          ? {
              ...result,
              content: [
                'Needs attention. StatsKey did not accept the completion claim because a requested file correction or claimed code detail still lacks trusted post-write evidence after the bounded Work independently passes. The task is not complete.',
                '',
                'The provider handoff is retained below as evidence, but unsupported file-level claims were not promoted to completed work.',
                '',
                result.content,
              ].join('\n'),
            }
          : decision.reason === 'required_verification_cap'
          ? {
              ...result,
              content: [
                'Needs attention. The requested workspace changes are present, but verification explicitly required by the objective remains incomplete after the bounded Work independently passes. The task is not complete.',
                '',
                'The final provider handoff is retained below as evidence, but its completion label was not accepted because it declares a required verification shortfall.',
                '',
                result.content,
              ].join('\n'),
            }
          : decision.reason === 'global_cap'
          ? {
              ...result,
              content: fallbackCompletionHandoff(
                completionModeForTurn(params),
                result.steps
              ),
            }
          : result
      }

      const carriedSteps = stepsForAutomaticContinuation(result.steps)
      const unsupportedClaims = [
        ...new Set([
          ...requiredClaimIdentifiersWithoutEvidence(
            passParams.automaticContinuation?.requiredClaimIdentifiers ?? [],
            carriedSteps
          ),
          ...unsupportedImplementationClaimObligations(
            result.content,
            carriedSteps
          ),
        ]),
      ]
      const correctiveMutationRequired =
        decision.reason === 'mutation_incomplete'
      const correctionBoundary = correctiveMutationRequired
        ? carriedSteps.length
        : undefined
      const nextPass = completedPasses + 1
      params.onText?.('')
      params.onStep(carriedSteps)
      params.onProgress?.(
        decision.reason === 'action_budget'
          ? `The bounded action budget ended before implementation completed. Work independently is continuing automatically in pass ${nextPass} of ${MAX_INDEPENDENT_IMPLEMENTATION_PASSES} with the same objective, attachments, and workspace.`
          : `That pass did not reach a completed, verified implementation. Work independently is continuing automatically in pass ${nextPass} of ${MAX_INDEPENDENT_IMPLEMENTATION_PASSES} with the same objective, attachments, and workspace.`
      )
      params.onStatus?.({
        phase: 'thinking',
        message: `Continuing implementation automatically · pass ${nextPass} of ${MAX_INDEPENDENT_IMPLEMENTATION_PASSES}`,
        round: rounds + 1,
      })
      passParams = {
        ...scopedParams,
        automaticContinuation: {
          steps: carriedSteps,
          ...(correctiveMutationRequired
            ? { correctiveMutationRequired: true, correctionBoundary }
            : {}),
          ...(unsupportedClaims.length > 0
            ? { requiredClaimIdentifiers: unsupportedClaims }
            : {}),
          prompt: automaticImplementationContinuationPrompt({
            objective: params.userText,
            previousContent: result.content,
            steps: carriedSteps,
            nextPass,
            correctiveMutationRequired,
            requiredClaimIdentifiers: unsupportedClaims,
          }),
        },
      }
    }
  } finally {
    workspaceExecutionLease.release()
  }
}

async function runProviderPass(
  params: AgentTurnParams
): Promise<AgentTurnResult> {
  if (params.executionRoute === 'direct') {
    return runDirectProviderTurn(params)
  }
  if (params.provider === 'claude') return runClaudeTurn(params)
  return runOpenAIStyleTurn(params)
}

function immutableWorkspaceBinding(
  binding: DesktopWorkspaceBinding | undefined
): DesktopWorkspaceBinding | undefined {
  const workspaceId = binding?.workspaceId?.trim()
  if (!workspaceId || !/^[a-f0-9]{20}$/.test(workspaceId)) return undefined
  return Object.freeze({ workspaceId })
}

function stepsForAutomaticContinuation(steps: AgentStep[]): AgentStep[] {
  return steps
    .filter((step) => step.name !== 'synthesize_answer')
    .map((step) =>
      step.status === 'running'
        ? {
            ...step,
            status: 'error' as const,
            resultMeta:
              step.resultMeta || 'previous pass ended before this action completed',
          }
        : { ...step }
    )
}

function userContentForPass(
  params: AgentTurnParams
): string | AnthropicContentBlock[] {
  const original = params.userContent ?? params.userText
  return userContentWithAutomaticContinuation(
    original,
    params.automaticContinuation?.prompt
  )
}

// ---------------------------------------------------------------------------
// Shared step bookkeeping
// ---------------------------------------------------------------------------

class StepLog {
  steps: AgentStep[]
  constructor(
    private onStep: (steps: AgentStep[]) => void,
    initialSteps: AgentStep[] = []
  ) {
    this.steps = initialSteps.map((step) => ({ ...step }))
  }

  emit() {
    this.onStep([...this.steps])
  }

  open(
    id: string,
    name: string,
    summary: string,
    sub?: boolean,
    preview?: AgentToolPreview
  ): AgentStep {
    const existing = this.steps.find((s) => s.id === id)
    if (existing) return existing
    const step: AgentStep = {
      id,
      name,
      summary,
      status: 'running',
      agent: agentLabelForTool(name, sub),
      rationale: rationaleForTool(name),
      preview,
      sub,
      startedAt: Date.now(),
    }
    this.steps.push(step)
    this.emit()
    return step
  }

  close(
    id: string,
    resultMeta: string,
    failed: boolean,
    preview?: AgentToolPreview
  ) {
    const step = this.steps.find((s) => s.id === id)
    if (!step) return
    step.status = failed ? 'error' : 'done'
    step.resultMeta = resultMeta
    if (preview) step.preview = preview
    if (step.startedAt) step.ms = Date.now() - step.startedAt
    this.emit()
  }

  refineSummary(id: string, summary: string) {
    const step = this.steps.find((s) => s.id === id)
    if (step && summary) {
      step.summary = summary
      this.emit()
    }
  }
}

function agentLabelForTool(name: string, sub?: boolean): string {
  if (sub) return 'Investigator'
  if (name.startsWith('browser_')) return 'Browser agent'
  if (name.startsWith('application_')) return 'Desktop agent'
  if (name.startsWith('device_')) return 'Device agent'
  if (name === 'run_parallel_investigations' || name === 'run_subagent') {
    return 'Coordinator'
  }
  if (
    [
      'workspace_write',
      'workspace_create',
      'workspace_delete',
      'workspace_rename',
    ].includes(name)
  ) {
    return 'Builder'
  }
  if (name === 'run_terminal' || name.startsWith('git_')) return 'Verifier'
  if (name === 'synthesize_answer') return 'Lead agent'
  return 'Lead agent'
}

function rationaleForTool(name: string): string {
  if (name === 'browser_list') return 'Identify the exact isolated browser tab to use.'
  if (name === 'browser_open') return 'Open a visible isolated page under the active approval setting.'
  if (name === 'browser_navigate') return 'Move one exact browser tab through its visible history or URL.'
  if (name === 'browser_snapshot') return 'Read the current page without changing it.'
  if (name === 'browser_click') return 'Perform one exact browser action under the active approval setting.'
  if (name === 'browser_type') return 'Enter non-secret text under the active approval setting.'
  if (name === 'browser_screenshot') return 'Visually verify one isolated page without changing it.'
  if (name === 'browser_close') return 'End the isolated browser session.'
  if (name === 'application_list') return 'Find applications within the constrained launch policy.'
  if (name === 'application_open') return 'Launch one exact application after user approval.'
  if (name === 'device_list') return 'Discover secure local simulator and emulator capabilities.'
  if (name.startsWith('device_')) return 'Exercise and verify the app on one bound simulator or emulator.'
  if (name === 'workspace_manifest') return 'Establish the available workspace scope.'
  if (name === 'workspace_search') return 'Locate the strongest relevant local evidence.'
  if (name === 'workspace_read') return 'Verify source content before drawing a conclusion.'
  if (name === 'run_parallel_investigations') {
    return 'Compare independent lines of investigation concurrently.'
  }
  if (name === 'run_subagent') return 'Delegate a bounded read-only investigation.'
  if (name === 'investigation') {
    return 'Keep one research workstream inspectable from its brief through its final summary.'
  }
  if (name === 'run_terminal') return 'Verify behavior with an explicit reviewed command.'
  if (name.startsWith('git_')) return 'Inspect the exact workspace change state.'
  if (name === 'synthesize_answer') {
    return 'Turn the gathered evidence into a complete final response.'
  }
  if (name.startsWith('workspace_')) return 'Complete the requested workspace change.'
  return 'Gather evidence needed to answer accurately.'
}

async function executeToolWithSubagent(
  params: AgentTurnParams,
  uid: string,
  cache: AgentDataCache,
  call: { id: string; name: string; input: Record<string, unknown> },
  log: StepLog
): Promise<{ content: string; isError: boolean; credits: number }> {
  if (call.name === 'run_subagent') {
    const objective = typeof call.input?.objective === 'string' ? call.input.objective : ''
    const finding = await runSubagent({
      params,
      uid,
      cache,
      objective,
      log,
      idPrefix: call.id,
    })
    log.close(call.id, finding.isError ? 'failed' : `${finding.rounds} rounds · findings returned`, finding.isError)
    return { content: finding.content, isError: finding.isError, credits: finding.creditsCharged }
  }
  if (call.name === 'run_parallel_investigations') {
    const objectives = Array.isArray(call.input?.objectives)
      ? call.input.objectives
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 2)
      : []
    if (objectives.length !== 2) {
      log.close(call.id, 'failed', true)
      return {
        content: JSON.stringify({
          error: 'Parallel investigations require exactly two objectives.',
        }),
        isError: true,
        credits: 0,
      }
    }
    const findings = await Promise.all(
      objectives.map((objective, index) =>
        runSubagent({
          params,
          uid,
          cache,
          objective,
          log,
          idPrefix: `${call.id}-${index + 1}`,
        })
      )
    )
    const credits = findings.reduce(
      (sum, finding) => sum + finding.creditsCharged,
      0
    )
    const isError = findings.every((finding) => finding.isError)
    log.close(
      call.id,
      `${findings.length} parallel investigations returned`,
      isError
    )
    return {
      content: JSON.stringify(
        {
          investigations: findings.map((finding, index) => ({
            objective: objectives[index],
            findings: finding.content,
            rounds: finding.rounds,
            failed: finding.isError,
          })),
        },
        null,
        1
      ),
      isError,
      credits,
    }
  }
  const workspaceLease = toolNeedsWorkspaceLease(call.name)
    ? params.workspaceExecutionLease
    : undefined
  let workspaceLeaseAcquired = false
  if (workspaceLease) {
    const acquired = await workspaceLease.ensure()
    if (acquired === false) {
      log.close(call.id, 'cancelled before workspace access', true)
      return {
        content: JSON.stringify({ cancelled: true }),
        isError: true,
        credits: 0,
      }
    }
    workspaceLeaseAcquired = true
  }
  try {
    const result = await executeTool(uid, cache, call.name, call.input ?? {})
    log.close(call.id, result.resultMeta, result.isError, result.preview)
    return { content: result.content, isError: result.isError, credits: 0 }
  } finally {
    // Serialize only the mutating operation itself. Keeping the lease while the
    // provider thinks or writes its response makes unrelated tasks look stuck
    // even though no workspace operation is running.
    if (workspaceLeaseAcquired) workspaceLease?.release()
  }
}

// ---------------------------------------------------------------------------
// Native direct-provider loop — API key stays in Electron main process
// ---------------------------------------------------------------------------

async function runDirectProviderTurn(
  params: AgentTurnParams
): Promise<AgentTurnResult> {
  const bridge = getDesktopBridge()
  if (!bridge) {
    throw new Error('Direct provider access requires the StatsKey desktop app.')
  }
  const cache = new AgentDataCache(params.uid, {
    sessionId: params.sessionId,
    messageId: params.messageId,
    model: params.modelId,
  }, {
    agentMode: params.agentMode,
    approvalMode: params.approvalMode,
    shouldStop: params.shouldStop,
    registerCancel: params.registerCancel,
    workspaceBinding: params.workspaceBinding,
  })
  const log = new StepLog(params.onStep, params.automaticContinuation?.steps)
  const tools = await toolsForAgentModeWithMcp(params)
  const messages: AnthropicMessage[] = [
    ...priorTurnsWithinContext(params).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: 'user', content: userContentForPass(params) },
  ]
  const preambles: string[] = []
  const citations = new Set<string>()
  const roundLimit = agentRoundLimit(params)
  let completionRecoveryAttempts = 0
  let completionRecoveryProgress = ''
  let providerTimeoutRecoveryAttempts = 0

  for (let round = 0; round < roundLimit; round++) {
    if (params.shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged: 0,
        citations: [...citations],
        rounds: round,
      }
    }
    const checkpoint = implementationPersistenceCheckpoint(
      completionModeForTurn(params),
      round,
      log.steps
    )
    if (checkpoint) messages.push({ role: 'user', content: checkpoint })
    const roundTools = toolsForRound(params, tools, round, log.steps)
    const requestId = crypto.randomUUID()
    let streamedText = ''
    params.registerCancel?.(
      () => bridge.providers.cancel(requestId),
      requestId
    )
    let acceptProviderEvents = true
    let response
    const providerRequest = withProviderTools(
      {
        model: params.modelId,
        systemPrompt: params.systemPrompt,
        messages: messages as Array<{
          role: 'user' | 'assistant'
          content: string | Array<Record<string, unknown>>
        }>,
        effort: params.reasoningEffort,
        serviceTier: params.serviceTier,
        reasoningMode: params.reasoningMode,
        maxOutputTokens: directMaxOutput(params.reasoningEffort),
        webSearch: true,
      },
      roundTools as unknown as Array<Record<string, unknown>>
    )
    try {
      response = await withProviderRoundWatchdog(
        (markAlive) =>
          bridge.providers.run(
            requestId,
            params.directProvider,
            providerRequest,
            (event) => {
          if (!acceptProviderEvents) return
          markAlive(providerWatchdogSignal(event))
          if (event.type === 'queued') {
            params.onStatus?.({
              phase: 'queued',
              message: `Waiting for provider slot${event.position ? ` · #${event.position}` : ''}`,
              queuePosition: event.position,
              round: round + 1,
            })
            return
          }
          if (event.type === 'open') {
            params.onStatus?.({
              phase: 'thinking',
              message: providerDecisionMessage(round, log.steps),
              round: round + 1,
            })
            return
          }
          if (event.type === 'activity') {
            params.onStatus?.({
              phase: streamedText ? 'responding' : 'thinking',
              message: streamedText
                ? 'Writing response · provider request is active'
                : `${providerDecisionMessage(round, log.steps)}${
                    typeof event.elapsedMs === 'number'
                      ? ` · ${providerElapsed(event.elapsedMs)}`
                      : ''
                  }`,
              round: round + 1,
            })
            return
          }
          if (event.type !== 'text' || !event.text) return
          if (!streamedText) {
            params.onStatus?.({
              phase: 'responding',
              message: 'Writing response',
              round: round + 1,
            })
          }
          streamedText += event.text
          params.onText?.(streamedText)
            }
          ),
        {
          onTimeout: () => {
            acceptProviderEvents = false
            bridge.providers.cancel(requestId)
          },
        }
      )
    } catch (error) {
      if (params.shouldStop?.()) {
        return {
          content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
          steps: log.steps,
          creditsCharged: 0,
          citations: [...citations],
          rounds: round + 1,
        }
      }
      if (isProviderRoundTimeout(error)) {
        const recovery = providerTimeoutRecoveryPrompt(
          completionModeForTurn(params),
          log.steps,
          providerTimeoutRecoveryAttempts
        )
        if (recovery) {
          providerTimeoutRecoveryAttempts += 1
          const steering = takeSteering(params)
          if (steering.length > 0) {
            messages.push({ role: 'user', content: steeringPrompt(steering) })
          }
          messages.push({ role: 'user', content: recovery })
          params.onText?.('')
          params.onProgress?.(
            'That provider request stopped reporting activity. I’m reconnecting once from the completed work instead of restarting the task.'
          )
          params.onStatus?.({
            phase: 'thinking',
            message: 'Reconnecting to provider · resuming from saved progress',
            round: round + 1,
          })
          // A request that returned no model result did not consume a useful
          // agent round. Reuse this bounded round once so a timeout on the
          // final slot cannot skip straight to a tool-free synthesis.
          round -= 1
          continue
        }
        const content = fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          'provider_timeout'
        )
        params.onStatus?.({
          phase: 'finishing',
          message: 'Provider unavailable · closing with a saved-work summary',
          round: round + 1,
        })
        params.onText?.(content)
        return {
          content,
          steps: log.steps,
          creditsCharged: 0,
          citations: [...citations],
          rounds: round + 1,
        }
      }
      throw error
    } finally {
      acceptProviderEvents = false
      params.registerCancel?.(null, requestId)
    }

    const text = response.content || streamedText
    for (const citation of response.citations || []) citations.add(citation)
    const toolUses = (response.toolUse || []) as AnthropicToolUseBlock[]
    if (params.shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged: 0,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    if (toolUses.length === 0) {
      const steering = takeSteering(params)
      if (steering.length > 0) {
        if (text.trim()) {
          preambles.push(text)
          params.onProgress?.(text)
          messages.push({ role: 'assistant', content: text })
        }
        messages.push({ role: 'user', content: steeringPrompt(steering) })
        params.onStatus?.({
          phase: 'thinking',
          message: `Incorporating ${steering.length} new message${steering.length === 1 ? '' : 's'}`,
          round: round + 1,
        })
        continue
      }
      const recoveryProgress = implementationProgressKey(log.steps)
      if (recoveryProgress !== completionRecoveryProgress) {
        completionRecoveryAttempts = 0
        completionRecoveryProgress = recoveryProgress
      }
      const recovery = implementationRecoveryPrompt(
        completionModeForTurn(params),
        log.steps,
        completionRecoveryAttempts
      )
      if (recovery) {
        completionRecoveryAttempts += 1
        if (text.trim()) messages.push({ role: 'assistant', content: text })
        messages.push({ role: 'user', content: recovery })
        const update = implementationRecoveryUpdate(log.steps)
        params.onProgress?.(update)
        params.onStatus?.({
          phase: 'thinking',
          message: 'Recovering from a premature no-edit finish',
          round: round + 1,
        })
        continue
      }
      if (isWorkspaceChangeTurn(params)) {
        if (text.trim()) {
          preambles.push(text)
          messages.push({ role: 'assistant', content: text })
        }
        break
      }
      const content =
        text.trim() ||
        preambles.join('\n\n').trim() ||
        fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          'empty_response'
        )
      if (!streamedText && content) params.onText?.(content)
      return {
        content,
        steps: log.steps,
        creditsCharged: 0,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    if (text) {
      preambles.push(text)
      params.onProgress?.(text)
    }

    messages.push({
      role: 'assistant',
      content: response.contentBlocks as AnthropicContentBlock[],
    })
    const resultBlocks: AnthropicContentBlock[] = []
    for (const call of toolUses) {
      const input = call.input ?? {}
      log.open(
        call.id,
        call.name,
        summarizeToolCall(call.name, input),
        undefined,
        previewForToolCall(call.name, input, cache)
      )
      const result = await executeToolWithSubagent(
        params,
        params.uid,
        cache,
        { id: call.id, name: call.name, input: call.input ?? {} },
        log
      )
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: result.content,
        is_error: result.isError,
      })
    }
    messages.push({ role: 'user', content: resultBlocks })
    if (params.shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged: 0,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    const steering = takeSteering(params)
    if (steering.length > 0) {
      messages.push({ role: 'user', content: steeringPrompt(steering) })
      params.onStatus?.({
        phase: 'thinking',
        message: `Incorporating ${steering.length} new message${steering.length === 1 ? '' : 's'}`,
        round: round + 1,
      })
    }

    if (
      steering.length === 0 &&
      implementationReadyForTurn(params, log.steps)
    ) {
      params.onProgress?.(
        'The requested changes are in place and the latest edit passed verification. I’m preparing the file-by-file handoff now.'
      )
      params.onStatus?.({
        phase: 'finishing',
        message: 'Preparing the completed-work summary',
        round: round + 1,
      })
      break
    }
  }

  if (params.shouldStop?.()) {
    return {
      content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
      steps: log.steps,
      creditsCharged: 0,
      citations: [...citations],
      rounds: roundLimit,
    }
  }
  const synthesisId = `synthesis-${crypto.randomUUID()}`
  params.onStatus?.({
    phase: 'finishing',
    message: 'Preparing the final summary',
    round: roundLimit + 1,
  })
  log.open(synthesisId, 'synthesize_answer', 'Complete the answer from gathered evidence')
  const remainingSteering = takeSteering(params)
  if (remainingSteering.length > 0) {
    messages.push({ role: 'user', content: steeringPrompt(remainingSteering) })
  }
  messages.push({
    role: 'user',
    content: completionHandoffPrompt(completionModeForTurn(params)),
  })
  const requestId = crypto.randomUUID()
  let streamedText = ''
  let acceptProviderEvents = true
  params.registerCancel?.(
    () => bridge.providers.cancel(requestId),
    requestId
  )
  const finalRequest = withProviderTools({
    model: params.modelId,
    systemPrompt: params.systemPrompt,
    messages: messages as Array<{
      role: 'user' | 'assistant'
      content: string | Array<Record<string, unknown>>
    }>,
    effort: params.reasoningEffort,
    serviceTier: params.serviceTier,
    reasoningMode: params.reasoningMode,
    maxOutputTokens: directMaxOutput(params.reasoningEffort),
    webSearch: false,
  })
  try {
    const response = await withFinalHandoffTimeout(
      withProviderRoundWatchdog(
        (markAlive) =>
          bridge.providers.run(
          requestId,
          params.directProvider,
          finalRequest,
          (event) => {
        if (!acceptProviderEvents) return
        markAlive(providerWatchdogSignal(event))
        if (event.type === 'queued') {
          params.onStatus?.({
            phase: 'queued',
            message: `Waiting for provider slot${event.position ? ` · #${event.position}` : ''}`,
            queuePosition: event.position,
            round: roundLimit + 1,
          })
          return
        }
        if (event.type === 'open') {
          params.onStatus?.({
            phase: 'finishing',
            message: 'Writing the final summary',
            round: roundLimit + 1,
          })
          return
        }
        if (event.type === 'activity') {
          params.onStatus?.({
            phase: streamedText ? 'responding' : 'finishing',
            message: streamedText
              ? 'Writing final response · provider request is active'
              : `Provider is still synthesizing${
                  typeof event.elapsedMs === 'number'
                    ? ` · ${providerElapsed(event.elapsedMs)}`
                    : ''
                }`,
            round: roundLimit + 1,
          })
          return
        }
        if (event.type !== 'text' || !event.text) return
        if (!streamedText) {
          params.onStatus?.({
            phase: 'responding',
            message: 'Writing final response',
            round: roundLimit + 1,
          })
        }
        streamedText += event.text
        params.onText?.(streamedText)
          }
          ),
        {
          onTimeout: () => {
            acceptProviderEvents = false
            bridge.providers.cancel(requestId)
          },
        },
      ),
      () => {
        acceptProviderEvents = false
        bridge.providers.cancel(requestId)
      }
    )
    if (params.shouldStop?.()) {
      const content = fallbackStoppedHandoff(
        completionModeForTurn(params),
        log.steps
      )
      log.close(synthesisId, 'stopped at a safe boundary', true)
      params.onText?.(content)
      return {
        content,
        steps: log.steps,
        creditsCharged: 0,
        citations: [...citations],
        rounds: roundLimit + 1,
      }
    }
    const content =
      (response.content || streamedText).trim() ||
      (isWorkspaceChangeTurn(params)
        ? fallbackCompletionHandoff(completionModeForTurn(params), log.steps)
        : preambles.join('\n\n').trim() ||
          fallbackCompletionHandoff(
            completionModeForTurn(params),
            log.steps,
            'empty_response'
          ))
    log.close(synthesisId, 'final response completed', false)
    if (!streamedText) params.onText?.(content)
    return {
      content,
      steps: log.steps,
      creditsCharged: 0,
      citations: [...citations],
      rounds: roundLimit + 1,
    }
  } catch (error) {
    log.close(synthesisId, 'final synthesis failed', true)
    const content = params.shouldStop?.()
      ? fallbackStoppedHandoff(completionModeForTurn(params), log.steps)
      : fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          isProviderRoundTimeout(error) ? 'provider_timeout' : 'final_synthesis'
        )
    // Replace any partial synthesis text. A timed-out paragraph is not a
    // terminal handoff and must never be left looking like the final answer.
    params.onText?.(content)
    return {
      content,
      steps: log.steps,
      creditsCharged: 0,
      citations: [...citations],
      rounds: roundLimit + 1,
    }
  } finally {
    acceptProviderEvents = false
    params.registerCancel?.(null, requestId)
  }
}

function directMaxOutput(effort: ReasoningEffort): number {
  if (effort === 'max' || effort === 'xhigh') return 64_000
  if (effort === 'high') return 32_000
  if (effort === 'medium') return 16_000
  return 8_000
}

function providerElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function providerDecisionMessage(round: number, steps: AgentStep[]): string {
  const last = [...steps].reverse().find((step) => step.status !== 'running')
  if (!last) {
    return round === 0
      ? 'Choosing the first concrete file, command, or evidence source'
      : 'Choosing the next concrete action'
  }
  const action =
    last.preview?.title ||
    (last.name === 'workspace_write'
      ? 'the file update'
      : last.name === 'workspace_read'
        ? 'reading the selected files'
        : last.name === 'workspace_search'
          ? 'the workspace search'
          : last.name === 'run_terminal'
            ? 'the verification check'
            : last.name === 'git_diff'
              ? 'reviewing the changes'
              : last.name === 'git_status'
                ? 'checking the workspace status'
                : last.summary)
  const result = last.resultMeta ? ` · ${last.resultMeta}` : ''
  return last.status === 'error'
    ? `Choosing an alternate path after ${action}${result}`.slice(0, 240)
    : `${action} finished${result}. Deciding whether another step is needed.`.slice(0, 240)
}

// ---------------------------------------------------------------------------
// Claude — reliable callable rounds; only the final answer is revealed
// ---------------------------------------------------------------------------

async function runClaudeTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const {
    uid,
    modelId,
    systemPrompt,
    onStep,
    onText,
    shouldStop,
    unlimitedAuto,
  } = params
  const priorTurns = priorTurnsWithinContext(params)
  const cache = new AgentDataCache(uid, {
    sessionId: params.sessionId,
    messageId: params.messageId,
    model: modelId,
  }, {
    agentMode: params.agentMode,
    approvalMode: params.approvalMode,
    shouldStop: params.shouldStop,
    registerCancel: params.registerCancel,
    workspaceBinding: params.workspaceBinding,
  })
  const log = new StepLog(onStep, params.automaticContinuation?.steps)
  const tools = await toolsForAgentModeWithMcp(params)
  let creditsCharged = 0
  let monthlyUsage: AnthropicMonthlyUsage | undefined
  const citations = new Set<string>()

  const messages: AnthropicMessage[] = [
    ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: userContentForPass(params) },
  ]

  const preambles: string[] = []
  const roundLimit = agentRoundLimit(params)
  let completionRecoveryAttempts = 0
  let completionRecoveryProgress = ''
  let managedEmptyRecoveryUsed = false

  for (let round = 0; round < roundLimit; round++) {
    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round,
      }
    }
    const checkpoint = implementationPersistenceCheckpoint(
      completionModeForTurn(params),
      round,
      log.steps
    )
    if (checkpoint) messages.push({ role: 'user', content: checkpoint })
    const roundTools = toolsForRound(params, tools, round, log.steps)
    params.onStatus?.({
      phase: 'thinking',
      message: providerDecisionMessage(round, log.steps),
      round: round + 1,
    })
    const request = withProviderTools(
      {
        messages,
        systemPrompt,
        model: modelId as ClaudeModel,
        reasoning_effort: managedEmptyRecoveryUsed
          ? 'low'
          : params.reasoningEffort,
        ...(managedEmptyRecoveryUsed ? { max_output_tokens: 8_000 } : {}),
        ...(unlimitedAuto ? { unlimitedAuto: true } : {}),
        billingClient: 'statskey-desktop' as const,
      },
      roundTools
    )

    let resp: AnthropicChatResponse
    try {
      resp = await runManagedProviderRound(params, () => anthropicChat(request))
    } catch (error) {
      if (shouldStop?.()) {
        return {
          content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
          steps: log.steps,
          creditsCharged,
          monthlyUsage,
          citations: [...citations],
          rounds: round + 1,
        }
      }
      if (isProviderRoundTimeout(error)) {
        const content = fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          'provider_timeout'
        )
        params.onStatus?.({
          phase: 'finishing',
          message: 'Provider unavailable · closing with a saved-work summary',
          round: round + 1,
        })
        await revealAnswer(content, onText, shouldStop)
        return {
          content,
          steps: log.steps,
          creditsCharged,
          monthlyUsage,
          citations: [...citations],
          rounds: round + 1,
        }
      }
      if (!isLegacyManagedClaudeEmptyError(error)) throw error
      if (!managedEmptyRecoveryUsed) {
        managedEmptyRecoveryUsed = true
        messages.push({ role: 'user', content: managedClaudeExhaustionPrompt() })
        params.onProgress?.(
          'The provider exhausted its reply budget before acting. Resuming from the recorded tool results without replaying them.'
        )
        params.onStatus?.({
          phase: 'thinking',
          message: 'Recovering a provider reply that ended before its next action',
          round: round + 1,
        })
        continue
      }
      // A repeated legacy empty is converted into a normal empty round so the
      // existing bounded implementation recovery and outer continuation can
      // settle truthfully. Never let it escape to Flow as an aborted run.
      resp = {
        content: '',
        contentBlocks: [],
        toolUse: [],
        stopReason: 'max_tokens',
        usage: { input_tokens: 0, output_tokens: 0 },
      }
    }
    const text = resp.content ?? ''
    const toolUses = (resp.toolUse ?? []) as AnthropicToolUseBlock[]
    creditsCharged += resp.creditsCharged ?? 0
    if (resp.monthlyUsage) monthlyUsage = resp.monthlyUsage
    for (const c of resp.citations ?? []) citations.add(c)

    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    if (isThinkingOnlyMaxTokenResponse(resp)) {
      if (!managedEmptyRecoveryUsed) {
        managedEmptyRecoveryUsed = true
        appendThinkingContinuation(messages, resp)
        params.onProgress?.(
          'The provider used its reply budget on reasoning only. Continuing from the preserved signed response.'
        )
        params.onStatus?.({
          phase: 'thinking',
          message: 'Continuing after a reasoning-only provider response',
          round: round + 1,
        })
        continue
      }
      // Preserve a second signed response, then let the ordinary bounded
      // no-tool recovery decide whether to act, continue a pass, or hand off.
      messages.push({ role: 'assistant', content: resp.contentBlocks ?? [] })
    }
    if (toolUses.length === 0) {
      const steering = takeSteering(params)
      if (steering.length > 0) {
        if (text.trim()) {
          preambles.push(text)
          params.onProgress?.(text)
          messages.push({ role: 'assistant', content: text })
        }
        messages.push({ role: 'user', content: steeringPrompt(steering) })
        params.onStatus?.({
          phase: 'thinking',
          message: `Incorporating ${steering.length} new message${steering.length === 1 ? '' : 's'}`,
          round: round + 1,
        })
        continue
      }
      const recoveryProgress = implementationProgressKey(log.steps)
      if (recoveryProgress !== completionRecoveryProgress) {
        completionRecoveryAttempts = 0
        completionRecoveryProgress = recoveryProgress
      }
      const recovery = implementationRecoveryPrompt(
        completionModeForTurn(params),
        log.steps,
        completionRecoveryAttempts
      )
      if (recovery) {
        completionRecoveryAttempts += 1
        if (text.trim()) messages.push({ role: 'assistant', content: text })
        messages.push({ role: 'user', content: recovery })
        const update = implementationRecoveryUpdate(log.steps)
        params.onProgress?.(update)
        params.onStatus?.({
          phase: 'thinking',
          message: 'Recovering from a premature no-edit finish',
          round: round + 1,
        })
        continue
      }
      if (isWorkspaceChangeTurn(params)) {
        if (text.trim()) {
          preambles.push(text)
          messages.push({ role: 'assistant', content: text })
        }
        break
      }
      const content =
        text.trim() ||
        preambles.join('\n\n').trim() ||
        fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          'empty_response'
        )
      await revealAnswer(content, onText, shouldStop)
      if (shouldStop?.()) {
        return {
          content: fallbackStoppedHandoff(
            completionModeForTurn(params),
            log.steps
          ),
          steps: log.steps,
          creditsCharged,
          monthlyUsage,
          citations: [...citations],
          rounds: round + 1,
        }
      }
      return { content, steps: log.steps, creditsCharged, monthlyUsage, citations: [...citations], rounds: round + 1 }
    }

    if (text) {
      preambles.push(text)
      params.onProgress?.(text)
    }

    // Mirror the proven iOS continuation shape. Prefer the callable's complete
    // content blocks (which preserve adaptive-thinking signatures); use a
    // strict text + tool_use fallback only when those blocks are unavailable.
    const fallbackContent: AnthropicContentBlock[] = [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...toolUses,
    ]
    const assistantContent =
      resp.contentBlocks && resp.contentBlocks.length > 0
        ? (resp.contentBlocks as AnthropicContentBlock[])
        : fallbackContent
    messages.push({ role: 'assistant', content: assistantContent })

    const resultBlocks: AnthropicContentBlock[] = []
    for (const call of toolUses) {
      const input = call.input ?? {}
      const step = log.open(
        call.id,
        call.name,
        summarizeToolCall(call.name, input),
        undefined,
        previewForToolCall(call.name, input, cache)
      )
      log.refineSummary(step.id, summarizeToolCall(call.name, call.input ?? {}))
      const result = await executeToolWithSubagent(params, uid, cache, call, log)
      creditsCharged += result.credits
      resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: result.content, is_error: result.isError })
    }
    messages.push({ role: 'user', content: resultBlocks })
    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    const steering = takeSteering(params)
    if (steering.length > 0) {
      messages.push({ role: 'user', content: steeringPrompt(steering) })
      params.onStatus?.({
        phase: 'thinking',
        message: `Incorporating ${steering.length} new message${steering.length === 1 ? '' : 's'}`,
        round: round + 1,
      })
    }

    if (
      steering.length === 0 &&
      implementationReadyForTurn(params, log.steps)
    ) {
      params.onProgress?.(
        'The requested changes are in place and the latest edit passed verification. I’m preparing the file-by-file handoff now.'
      )
      params.onStatus?.({
        phase: 'finishing',
        message: 'Preparing the completed-work summary',
        round: round + 1,
      })
      break
    }
  }

  if (shouldStop?.()) {
    return {
      content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
      steps: log.steps,
      creditsCharged,
      monthlyUsage,
      citations: [...citations],
      rounds: roundLimit,
    }
  }
  const synthesisId = `synthesis-${crypto.randomUUID()}`
  params.onStatus?.({
    phase: 'finishing',
    message: 'Provider is preparing the final response',
    round: roundLimit + 1,
  })
  log.open(synthesisId, 'synthesize_answer', 'Complete the answer from gathered evidence')
  const remainingSteering = takeSteering(params)
  if (remainingSteering.length > 0) {
    messages.push({ role: 'user', content: steeringPrompt(remainingSteering) })
  }
  messages.push({
    role: 'user',
    content: completionHandoffPrompt(completionModeForTurn(params)),
  })
  const finalRequest = withProviderTools({
    messages,
    systemPrompt,
    model: modelId as ClaudeModel,
    reasoning_effort: params.reasoningEffort,
    ...(unlimitedAuto ? { unlimitedAuto: true } : {}),
    billingClient: 'statskey-desktop' as const,
  })
  try {
    const finalResponse = await runManagedProviderRound(params, () =>
      anthropicChat(finalRequest)
    )
    creditsCharged += finalResponse.creditsCharged ?? 0
    if (finalResponse.monthlyUsage) monthlyUsage = finalResponse.monthlyUsage
    for (const citation of finalResponse.citations ?? []) citations.add(citation)
    if (shouldStop?.()) {
      const content = fallbackStoppedHandoff(
        completionModeForTurn(params),
        log.steps
      )
      log.close(synthesisId, 'stopped at a safe boundary', true)
      await revealAnswer(content, onText)
      return {
        content,
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: roundLimit + 1,
      }
    }
    const content =
      finalResponse.content?.trim() ||
      (isWorkspaceChangeTurn(params)
        ? fallbackCompletionHandoff(completionModeForTurn(params), log.steps)
        : preambles.join('\n\n').trim() ||
          fallbackCompletionHandoff(
            completionModeForTurn(params),
            log.steps,
            'empty_response'
          ))
    log.close(synthesisId, 'final response completed', false)
    await revealAnswer(content, onText, shouldStop)
    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: roundLimit + 1,
      }
    }
    return {
      content,
      steps: log.steps,
      creditsCharged,
      monthlyUsage,
      citations: [...citations],
      rounds: roundLimit + 1,
    }
  } catch {
    log.close(synthesisId, 'final synthesis failed; local handoff used', true)
    const content = params.shouldStop?.()
      ? fallbackStoppedHandoff(completionModeForTurn(params), log.steps)
      : fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          'final_synthesis'
        )
    await revealAnswer(content, onText, shouldStop)
    return {
      content,
      steps: log.steps,
      creditsCharged,
      monthlyUsage,
      citations: [...citations],
      rounds: roundLimit + 1,
    }
  }
}

// ---------------------------------------------------------------------------
// ChatGPT / Grok — Chat-Completions tool loop through the managed callables
// ---------------------------------------------------------------------------

interface OpenAIStyleToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAIStyleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: OpenAIStyleToolCall[]
  tool_call_id?: string
  reasoning_content?: string
}

interface OpenAIStyleResponse {
  choices?: Array<{
    message?: {
      content?: string
      reasoning_content?: string
      tool_calls?: OpenAIStyleToolCall[]
    }
    finish_reason?: string
  }>
  citations?: string[]
  creditsCharged?: number
  monthlyUsage?: AnthropicMonthlyUsage
}

/** Chat-Completions tool defs — the callables convert these to Responses tools. */
function openAIStyleTools(tools: AnthropicToolDef[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

const functions = getFunctions(firebaseApp, 'us-central1')
const MANAGED_CALLABLE_TIMEOUT_MS = 4 * 60_000
const openAICall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(
  functions,
  'openAIChat',
  { timeout: MANAGED_CALLABLE_TIMEOUT_MS }
)
const grokCall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(
  functions,
  'grokChat',
  { timeout: MANAGED_CALLABLE_TIMEOUT_MS }
)
const kimiCall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(
  functions,
  'kimiChat',
  { timeout: MANAGED_CALLABLE_TIMEOUT_MS }
)

async function runOpenAIStyleTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const {
    uid,
    provider,
    modelId,
    systemPrompt,
    userText,
    onStep,
    onText,
    shouldStop,
  } = params
  const priorTurns = priorTurnsWithinContext(params)
  const cache = new AgentDataCache(uid, {
    sessionId: params.sessionId,
    messageId: params.messageId,
    model: modelId,
  }, {
    agentMode: params.agentMode,
    approvalMode: params.approvalMode,
    shouldStop: params.shouldStop,
    registerCancel: params.registerCancel,
    workspaceBinding: params.workspaceBinding,
  })
  const log = new StepLog(onStep, params.automaticContinuation?.steps)
  const tools = await toolsForAgentModeWithMcp(params)
  const call =
    provider === 'chatgpt'
      ? openAICall
      : provider === 'kimi'
        ? kimiCall
        : grokCall
  let creditsCharged = 0
  let monthlyUsage: AnthropicMonthlyUsage | undefined
  const citations = new Set<string>()

  const messages: OpenAIStyleMessage[] = [
    { role: 'system', content: systemPrompt },
    ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
    {
      role: 'user',
      content: params.automaticContinuation
        ? `${userText}\n\n${params.automaticContinuation.prompt}`
        : userText,
    },
  ]

  const preambles: string[] = []
  const roundLimit = agentRoundLimit(params)
  let completionRecoveryAttempts = 0
  let completionRecoveryProgress = ''

  for (let round = 0; round < roundLimit; round++) {
    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round,
      }
    }
    const checkpoint = implementationPersistenceCheckpoint(
      completionModeForTurn(params),
      round,
      log.steps
    )
    if (checkpoint) messages.push({ role: 'user', content: checkpoint })
    const roundTools = toolsForRound(params, tools, round, log.steps)
    params.onStatus?.({
      phase: 'thinking',
      message: providerDecisionMessage(round, log.steps),
      round: round + 1,
    })
    const providerRequest = withProviderTools(
      {
        messages,
        model: modelId,
        ...(params.serviceTier === 'fast'
          ? { service_tier: 'fast' }
          : {}),
        reasoning_effort: params.reasoningEffort,
        max_output_tokens:
          params.reasoningEffort === 'max' || params.reasoningEffort === 'xhigh'
            ? 16_000
            : params.reasoningEffort === 'high'
              ? 12_000
              : 6_000,
        billingClient: 'statskey-desktop',
        ...(params.unlimitedAuto ? { unlimitedAuto: true } : {}),
      },
      openAIStyleTools(roundTools)
    )
    let data: OpenAIStyleResponse
    try {
      ;({ data } = await runManagedProviderRound(params, () =>
        call(providerRequest)
      ))
    } catch (error) {
      if (
        error instanceof AgentRoundCancelledError ||
        params.shouldStop?.()
      ) {
        return {
          content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
          steps: log.steps,
          creditsCharged,
          monthlyUsage,
          citations: [...citations],
          rounds: round + 1,
        }
      }
      if (!isProviderRoundTimeout(error)) throw error
      const content = fallbackCompletionHandoff(
        completionModeForTurn(params),
        log.steps,
        'provider_timeout'
      )
      params.onStatus?.({
        phase: 'finishing',
        message: 'Provider unavailable · closing with a saved-work summary',
        round: round + 1,
      })
      await revealAnswer(content, onText, shouldStop)
      return {
        content,
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    creditsCharged += data.creditsCharged ?? 0
    if (data.monthlyUsage) monthlyUsage = data.monthlyUsage
    for (const c of data.citations ?? []) citations.add(c)

    const choice = data.choices?.[0]
    const message = choice?.message
    const toolCalls = message?.tool_calls ?? []
    const text = typeof message?.content === 'string' ? message.content : ''
    const preservedReasoning =
      typeof message?.reasoning_content === 'string'
        ? message.reasoning_content
        : undefined

    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    if (toolCalls.length === 0) {
      const steering = takeSteering(params)
      if (steering.length > 0) {
        if (text.trim() || preservedReasoning) {
          if (text.trim()) {
            preambles.push(text)
            params.onProgress?.(text)
          }
          messages.push({
            role: 'assistant',
            ...(text.trim() ? { content: text } : {}),
            ...(preservedReasoning
              ? { reasoning_content: preservedReasoning }
              : {}),
          })
        }
        messages.push({ role: 'user', content: steeringPrompt(steering) })
        params.onStatus?.({
          phase: 'thinking',
          message: `Incorporating ${steering.length} new message${steering.length === 1 ? '' : 's'}`,
          round: round + 1,
        })
        continue
      }
      const recoveryProgress = implementationProgressKey(log.steps)
      if (recoveryProgress !== completionRecoveryProgress) {
        completionRecoveryAttempts = 0
        completionRecoveryProgress = recoveryProgress
      }
      const recovery = implementationRecoveryPrompt(
        completionModeForTurn(params),
        log.steps,
        completionRecoveryAttempts
      )
      if (recovery) {
        completionRecoveryAttempts += 1
        if (text.trim() || preservedReasoning) {
          messages.push({
            role: 'assistant',
            ...(text.trim() ? { content: text } : {}),
            ...(preservedReasoning
              ? { reasoning_content: preservedReasoning }
              : {}),
          })
        }
        messages.push({ role: 'user', content: recovery })
        const update = implementationRecoveryUpdate(log.steps)
        params.onProgress?.(update)
        params.onStatus?.({
          phase: 'thinking',
          message: 'Recovering from a premature no-edit finish',
          round: round + 1,
        })
        continue
      }
      if (isWorkspaceChangeTurn(params)) {
        if (text.trim() || preservedReasoning) {
          if (text.trim()) preambles.push(text)
          messages.push({
            role: 'assistant',
            ...(text.trim() ? { content: text } : {}),
            ...(preservedReasoning
              ? { reasoning_content: preservedReasoning }
              : {}),
          })
        }
        break
      }
      const content =
        text.trim() ||
        preambles.join('\n\n').trim() ||
        fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          'empty_response'
        )
      await revealAnswer(content, onText, shouldStop)
      if (shouldStop?.()) {
        return {
          content: fallbackStoppedHandoff(
            completionModeForTurn(params),
            log.steps
          ),
          steps: log.steps,
          creditsCharged,
          monthlyUsage,
          citations: [...citations],
          rounds: round + 1,
        }
      }
      return { content, steps: log.steps, creditsCharged, monthlyUsage, citations: [...citations], rounds: round + 1 }
    }

    if (text) {
      preambles.push(text)
      params.onProgress?.(text)
    }

    messages.push({
      role: 'assistant',
      ...(text ? { content: text } : {}),
      ...(preservedReasoning
        ? { reasoning_content: preservedReasoning }
        : {}),
      tool_calls: toolCalls,
    })

    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
      } catch {
        /* malformed args — execute with empty input and let the tool report */
      }
      log.open(
        tc.id,
        tc.function.name,
        summarizeToolCall(tc.function.name, input),
        undefined,
        previewForToolCall(tc.function.name, input, cache)
      )
      const result = await executeToolWithSubagent(
        params,
        uid,
        cache,
        { id: tc.id, name: tc.function.name, input },
        log
      )
      creditsCharged += result.credits
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.content })
    }
    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
      }
    }
    const steering = takeSteering(params)
    if (steering.length > 0) {
      messages.push({ role: 'user', content: steeringPrompt(steering) })
      params.onStatus?.({
        phase: 'thinking',
        message: `Incorporating ${steering.length} new message${steering.length === 1 ? '' : 's'}`,
        round: round + 1,
      })
    }

    if (
      steering.length === 0 &&
      implementationReadyForTurn(params, log.steps)
    ) {
      params.onProgress?.(
        'The requested changes are in place and the latest edit passed verification. I’m preparing the file-by-file handoff now.'
      )
      params.onStatus?.({
        phase: 'finishing',
        message: 'Preparing the completed-work summary',
        round: round + 1,
      })
      break
    }
  }

  if (shouldStop?.()) {
    return {
      content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
      steps: log.steps,
      creditsCharged,
      monthlyUsage,
      citations: [...citations],
      rounds: roundLimit,
    }
  }
  const synthesisId = `synthesis-${crypto.randomUUID()}`
  params.onStatus?.({
    phase: 'finishing',
    message: 'Provider is preparing the final response',
    round: roundLimit + 1,
  })
  log.open(synthesisId, 'synthesize_answer', 'Complete the answer from gathered evidence')
  const remainingSteering = takeSteering(params)
  if (remainingSteering.length > 0) {
    messages.push({ role: 'user', content: steeringPrompt(remainingSteering) })
  }
  messages.push({
    role: 'user',
    content: completionHandoffPrompt(completionModeForTurn(params)),
  })
  const finalRequest = withProviderTools({
    messages,
    model: modelId,
    ...(params.serviceTier === 'fast' ? { service_tier: 'fast' } : {}),
    reasoning_effort: params.reasoningEffort,
    web_search: false,
    max_output_tokens:
      params.reasoningEffort === 'max' || params.reasoningEffort === 'xhigh'
        ? 16_000
        : params.reasoningEffort === 'high'
          ? 12_000
          : 6_000,
    billingClient: 'statskey-desktop',
    ...(params.unlimitedAuto ? { unlimitedAuto: true } : {}),
  })
  try {
    const { data: finalData } = await runManagedProviderRound(params, () =>
      call(finalRequest)
    )
    creditsCharged += finalData.creditsCharged ?? 0
    if (finalData.monthlyUsage) monthlyUsage = finalData.monthlyUsage
    for (const citation of finalData.citations ?? []) citations.add(citation)
    if (shouldStop?.()) {
      const content = fallbackStoppedHandoff(
        completionModeForTurn(params),
        log.steps
      )
      log.close(synthesisId, 'stopped at a safe boundary', true)
      await revealAnswer(content, onText)
      return {
        content,
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: roundLimit + 1,
      }
    }
    const content =
      finalData.choices?.[0]?.message?.content?.trim() ||
      (isWorkspaceChangeTurn(params)
        ? fallbackCompletionHandoff(completionModeForTurn(params), log.steps)
        : preambles.join('\n\n').trim() ||
          fallbackCompletionHandoff(
            completionModeForTurn(params),
            log.steps,
            'empty_response'
          ))
    log.close(synthesisId, 'final response completed', false)
    await revealAnswer(content, onText, shouldStop)
    if (shouldStop?.()) {
      return {
        content: fallbackStoppedHandoff(completionModeForTurn(params), log.steps),
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: roundLimit + 1,
      }
    }
    return {
      content,
      steps: log.steps,
      creditsCharged,
      monthlyUsage,
      citations: [...citations],
      rounds: roundLimit + 1,
    }
  } catch {
    log.close(synthesisId, 'final synthesis failed; local handoff used', true)
    const content = params.shouldStop?.()
      ? fallbackStoppedHandoff(completionModeForTurn(params), log.steps)
      : fallbackCompletionHandoff(
          completionModeForTurn(params),
          log.steps,
          'final_synthesis'
        )
    await revealAnswer(content, onText, shouldStop)
    return {
      content,
      steps: log.steps,
      creditsCharged,
      monthlyUsage,
      citations: [...citations],
      rounds: roundLimit + 1,
    }
  }
}

/**
 * Reveal only the finished answer. Data retrieval stays invisible, while the
 * response still arrives with the smooth live-chat cadence the user expects.
 */
const ANSWER_REVEAL_FRAME_MS = 14
const ANSWER_REVEAL_MAX_FRAMES = 120

export interface AnswerRevealEnvironment {
  now: () => number
  setTimer: (
    callback: () => void,
    delayMilliseconds: number
  ) => ReturnType<typeof setTimeout>
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  isHidden: () => boolean
  addVisibilityListener: (listener: () => void) => void
  removeVisibilityListener: (listener: () => void) => void
}

function browserAnswerRevealEnvironment(): AnswerRevealEnvironment {
  return {
    now: () => performance.now(),
    setTimer: (callback, delayMilliseconds) =>
      window.setTimeout(callback, delayMilliseconds),
    clearTimer: (timer) => window.clearTimeout(timer),
    isHidden: () => document.visibilityState === 'hidden',
    addVisibilityListener: (listener) =>
      document.addEventListener('visibilitychange', listener),
    removeVisibilityListener: (listener) =>
      document.removeEventListener('visibilitychange', listener),
  }
}

export function revealAnswer(
  text: string,
  onText?: (text: string) => void,
  shouldStop?: () => boolean,
  environment: AnswerRevealEnvironment = browserAnswerRevealEnvironment()
): Promise<void> {
  if (!onText || !text || shouldStop?.()) return Promise.resolve()

  // Electron heavily throttles timers for occluded windows. A hidden task must
  // never wait on presentation animation before automatic continuation can run.
  if (environment.isHidden()) {
    onText(text)
    return Promise.resolve()
  }

  const chunks = text.match(/\S+\s*/g) ?? [text]
  const batchSize = Math.max(
    1,
    Math.ceil(chunks.length / ANSWER_REVEAL_MAX_FRAMES)
  )
  const frameCount = Math.ceil(chunks.length / batchSize)
  const startedAt = environment.now()

  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const cleanup = () => {
      if (timer !== undefined) environment.clearTimer(timer)
      timer = undefined
      environment.removeVisibilityListener(handleVisibilityChange)
    }

    const settle = (publishFullText: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      if (publishFullText && !shouldStop?.()) onText(text)
      resolve()
    }

    const revealForElapsedTime = () => {
      timer = undefined
      if (shouldStop?.()) {
        settle(false)
        return
      }
      if (environment.isHidden()) {
        settle(true)
        return
      }

      // Progress is derived from monotonic elapsed time, not callback count, so
      // a one-second-clamped Electron timer catches up instead of taking minutes.
      const elapsed = Math.max(0, environment.now() - startedAt)
      const visibleFrames = Math.min(
        frameCount,
        Math.max(1, Math.floor(elapsed / ANSWER_REVEAL_FRAME_MS) + 1)
      )
      const visibleChunks = Math.min(chunks.length, visibleFrames * batchSize)
      onText(chunks.slice(0, visibleChunks).join(''))

      if (visibleChunks >= chunks.length) {
        settle(true)
        return
      }
      timer = environment.setTimer(
        revealForElapsedTime,
        ANSWER_REVEAL_FRAME_MS
      )
    }

    function handleVisibilityChange() {
      if (!environment.isHidden()) return
      settle(!shouldStop?.())
    }

    environment.addVisibilityListener(handleVisibilityChange)
    revealForElapsedTime()
  })
}

// ---------------------------------------------------------------------------
// Subagent — a bounded nested loop with its own tool budget (mirrors the iOS
// run_subagent delegation tool).
// ---------------------------------------------------------------------------

interface SubagentFinding {
  content: string
  creditsCharged: number
  rounds: number
  isError: boolean
}

async function runSubagent(context: {
  params: AgentTurnParams
  uid: string
  cache: AgentDataCache
  objective: string
  log: StepLog
  idPrefix?: string
}): Promise<SubagentFinding> {
  const { params, uid, cache, objective, log, idPrefix = 'subagent' } = context
  if (!objective.trim()) {
    return { content: JSON.stringify({ error: 'Missing objective' }), creditsCharged: 0, rounds: 0, isError: true }
  }

  const investigationId = `${idPrefix}:investigation`
  log.open(
    investigationId,
    'investigation',
    objective.trim(),
    true,
    {
      kind: 'text',
      title: 'Investigator brief',
      body: objective.trim(),
    }
  )
  const finish = (finding: SubagentFinding) => {
    log.close(
      investigationId,
      finding.isError
        ? 'investigation failed'
        : `${finding.rounds} round${finding.rounds === 1 ? '' : 's'} · summary ready`,
      finding.isError,
      {
        kind: 'text',
        title: finding.isError
          ? 'Investigator could not finish'
          : 'Investigator summary',
        body: finding.content,
      }
    )
    return finding
  }

  const systemPrompt = [
    'You are a read-only StatsKey investigation subagent. You were dispatched with ONE narrow objective over the user record or local workspace.',
    'Work only through your read tools. Be surgical: as few tool calls as possible, then report.',
    'Reply with a concise executive summary followed by dense findings: the facts you established, dates and numbers, exact file paths or source identifiers, and explicit gaps. Distinguish evidence from inference. No generic preamble and no implementation — the lead agent handles decisions and changes.',
  ].join('\n')

  const messages: AnthropicMessage[] = [{ role: 'user', content: `Objective: ${objective}` }]
  let credits = 0

  try {
    for (let round = 0; round < SUBAGENT_MAX_ROUNDS; round++) {
      if (params.shouldStop?.()) throw new Error('Stopped.')
      const resp =
        params.executionRoute === 'direct'
          ? await runDirectSubagentRound(params, messages, systemPrompt)
          : await runManagedProviderRound(params, () =>
              anthropicChat({
                messages,
                systemPrompt,
                model: SUBAGENT_MODEL,
                tools: subagentToolsForScope(params),
                reasoning_effort: 'low',
                max_output_tokens: 3000,
            billingClient: 'statskey-desktop',
              })
            )
      credits += resp.creditsCharged ?? 0

      const toolUses = (resp.toolUse ?? []) as AnthropicToolUseBlock[]
      if (toolUses.length === 0 || resp.stopReason !== 'tool_use') {
        return finish({
          content: resp.content || '(no findings)',
          creditsCharged: credits,
          rounds: round + 1,
          isError: false,
        })
      }

      messages.push({ role: 'assistant', content: (resp.contentBlocks ?? []) as AnthropicContentBlock[] })
      const resultBlocks: AnthropicContentBlock[] = []
      for (const call of toolUses) {
        const stepId = `${idPrefix}-${call.id}-sub`
        const input = call.input ?? {}
        log.open(
          stepId,
          call.name,
          summarizeToolCall(call.name, input),
          true,
          previewForToolCall(call.name, input, cache)
        )
        const result = await executeTool(uid, cache, call.name, call.input ?? {})
        log.close(stepId, result.resultMeta, result.isError, result.preview)
        resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: result.content, is_error: result.isError })
      }
      messages.push({ role: 'user', content: resultBlocks })
    }
    return finish({
      content: 'Subagent hit its round budget. Partial findings may exist in its tool activity.',
      creditsCharged: credits,
      rounds: SUBAGENT_MAX_ROUNDS,
      isError: false,
    })
  } catch (e) {
    if (
      e instanceof AgentRoundCancelledError ||
      params.shouldStop?.()
    ) {
      log.close(investigationId, 'stopped at a safe boundary', true)
      throw e
    }
    return finish({
      content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      creditsCharged: credits,
      rounds: 0,
      isError: true,
    })
  }
}

async function runDirectSubagentRound(
  params: AgentTurnParams,
  messages: AnthropicMessage[],
  systemPrompt: string
) {
  const bridge = getDesktopBridge()
  if (!bridge) throw new Error('Direct subagents require the desktop app.')
  const requestId = crypto.randomUUID()
  params.registerCancel?.(
    () => bridge.providers.cancel(requestId),
    requestId
  )
  try {
    const response = await withProviderRoundWatchdog(
      (markAlive) =>
        bridge.providers.run(
          requestId,
          params.directProvider,
          {
            model: params.modelId,
            systemPrompt,
            messages: messages as Array<{
              role: 'user' | 'assistant'
              content: string | Array<Record<string, unknown>>
            }>,
            tools: subagentToolsForScope(params) as unknown as Array<
              Record<string, unknown>
            >,
            effort: 'low',
            serviceTier: params.serviceTier,
            reasoningMode: 'standard',
            maxOutputTokens: 4_000,
            webSearch: false,
          },
          (event) => markAlive(providerWatchdogSignal(event))
        ),
      { onTimeout: () => bridge.providers.cancel(requestId) }
    )
    return {
      content: response.content,
      contentBlocks: response.contentBlocks,
      toolUse: response.toolUse,
      stopReason: response.stopReason,
      creditsCharged: 0,
    }
  } finally {
    params.registerCancel?.(null, requestId)
  }
}
