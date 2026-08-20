export interface PersistenceStep {
  name: string
  summary?: string
  resultMeta?: string
  status: 'running' | 'done' | 'error'
  preview?: {
    kind?: string
    title?: string
    body?: string
    before?: string
    after?: string
    filePath?: string
    additions?: number
    deletions?: number
    items?: Array<{ label: string; detail?: string }>
  }
}

const FILE_MUTATION_TOOLS = new Set([
  'workspace_write',
  'workspace_create',
  'workspace_delete',
  'workspace_rename',
])

const IMPLEMENTATION_VERIFICATION_TOOLS = new Set([
  'run_terminal',
  'device_inspect',
  'device_process',
  'device_logs',
])

const PERSISTED_CHANGE_META = /^file changed · persisted [a-f0-9]{12}$/
const DEVICE_PROOF_META =
  /^device proof · (launch|inspect|process|logs) · (ios|android) · d:([a-f0-9]{12}) · a:([a-f0-9]{12}) · (launched|alive · crash-free|not-alive|crash-detected)$/

export interface DurableDeviceProof {
  action: 'launch' | 'inspect' | 'process' | 'logs'
  platform: 'ios' | 'android'
  deviceHash: string
  appHash: string
  state: 'launched' | 'alive · crash-free' | 'not-alive' | 'crash-detected'
}

export function durableDeviceProofForStep(
  step: PersistenceStep
): DurableDeviceProof | null {
  const match = DEVICE_PROOF_META.exec(step.resultMeta?.trim() ?? '')
  if (!match) return null
  return {
    action: match[1] as DurableDeviceProof['action'],
    platform: match[2] as DurableDeviceProof['platform'],
    deviceHash: match[3],
    appHash: match[4],
    state: match[5] as DurableDeviceProof['state'],
  }
}

export function hasStructuredDeviceRunVerification(
  steps: PersistenceStep[]
): boolean {
  const launched = new Set<string>()
  const verified = new Set<string>()
  for (const step of steps) {
    const proof = durableDeviceProofForStep(step)
    if (!proof) continue
    const key = `${proof.platform}:${proof.deviceHash}:${proof.appHash}`
    if (proof.action === 'launch') {
      if (step.status === 'done' && proof.state === 'launched') {
        launched.add(key)
      } else {
        launched.delete(key)
      }
      verified.delete(key)
      continue
    }
    if (!launched.has(key)) continue
    if (
      step.status === 'done' &&
      proof.state === 'alive · crash-free'
    ) {
      verified.add(key)
    } else {
      verified.delete(key)
    }
  }
  return verified.size > 0
}

const EXTERNAL_ACTION_TOOLS = new Set([
  'workspace_write',
  'workspace_create',
  'workspace_delete',
  'workspace_rename',
  'run_terminal',
  'restore_checkpoint',
  'browser_open',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_close',
  'application_open',
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
  'update_scratch_pad',
  'propose_calendar_event',
  'propose_email',
])

export type CompletionTerminalReason =
  | 'round_limit'
  | 'provider_timeout'
  | 'final_synthesis'
  | 'empty_response'

export type ImplementationToolPhase = 'full' | 'edit' | 'verify'

export type AgentMode = 'ask' | 'plan' | 'debug' | 'agent'
export type AgentModeSelection = 'auto' | AgentMode
export type AgentTaskExpectation =
  | 'workspace-change'
  | 'external-action'
  | 'answer'

export interface AgentRoutingContext {
  /** Resume an unfinished implementation for status or short continuation prompts. */
  pendingImplementationMode?: 'debug' | 'agent'
  /** Preserve whether unfinished work requires a workspace change or an external action. */
  pendingTaskExpectation?: Exclude<AgentTaskExpectation, 'answer'>
}

const IMPLEMENTATION_TARGET =
  '(?:app|application|software|program|product|prototype|implementation|tool|service|server|daemon|site|website|page|interface|ui|button|feature|file|folder|workspace|project|code|component|screen|layout|client|desktop|release|version|setting|mode|workflow|integration|tests?|search(?: bar)?|sidebar|header|login|form|report|document|canvas|artifact|diagram|patch|source)'

function isImplementationContinuation(prompt: string): boolean {
  return /^(?:(?:please|can you|could you)\s+)?(?:(?:continue|resume|finish|complete)(?:\s+(?:it|(?:the\s+)?(?:task|work)|what you started))?|keep going|try again|pick up where you left off)(?:\s+from where you left off)?(?:\s+please)?\??$/.test(
    prompt
  )
}

function explicitImplementationIntent(prompt: string): boolean {
  const selfDirectedQuestion =
    /^(?:how|what|where|why|when|which|who|is|are|do|does|did|can i|could i|should i|would i)\b/.test(
      prompt
    )
  const action =
    '(?:build|change|code|debug|delete|deploy|download|edit|execute|export|fix|implement|import|install|launch|modify|open|patch|publish|push|refactor|relaunch|remove|rename|repair|replace|restart|run|schedule|send|solve|upload)'
  const delegatedAction = new RegExp(
    `\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${action}\\b|\\b(?:i\\s+(?:need|want)\\s+you\\s+to|go\\s+ahead\\s+and|please)\\s+${action}\\b`
  )
  const imperativeAction = new RegExp(
    `(?:^|[.!?;:,]\\s*)(?:please\\s+)?(?:go\\s+ahead(?:\\s+and)?\\s+)?${action}\\b`
  )
  const createAction = new RegExp(
    `\\b(?:add|create|make|write)\\b[\\s\\S]{0,120}\\b${IMPLEMENTATION_TARGET}\\b`
  )
  const completionAction = new RegExp(
    `\\b(?:complete|continue|finish|resume)\\b[\\s\\S]{0,40}\\b(?:build(?:ing)?|implement(?:ation|ing)?|work(?:ing)?\\s+on)\\b[\\s\\S]{0,100}\\b${IMPLEMENTATION_TARGET}\\b`
  )
  const implementationContinuation =
    /\b(?:complete|continue|finish|resume)\s+(?:(?:the|this|that|my|your|our)\s+)?(?:(?:existing|current|unfinished|remaining)\s+|[a-z0-9][a-z0-9-]{1,50}\s+)?implementation\b/.test(
      prompt
    )
  const verificationAction =
    /(?:^|[.!?;:,]\s*)(?:please\s+)?(?:run|execute|rerun|test|verify|validate)\b[\s\S]{0,100}\b(?:tests?|checks?|build|typecheck|lint|app|application|code|implementation|fix|change)\b/.test(
      prompt
    ) ||
    /(?:^|[.!?;:,]\s*)(?:please\s+)?(?:test|verify|validate)\s+(?:it|this|that|the\s+(?:app|application|build|change|code|feature|fix|implementation|project|source|workspace))\b/.test(
      prompt
    )
  const explicitWorkspaceTool =
    /\bworkspace(?:\.|_)(?:patch|write|create|delete|rename)\b/.test(prompt)
  return (
    delegatedAction.test(prompt) ||
    (!selfDirectedQuestion &&
      (explicitWorkspaceTool ||
        imperativeAction.test(prompt) ||
        createAction.test(prompt) ||
        completionAction.test(prompt) ||
        implementationContinuation ||
        verificationAction))
  )
}

export function agentModeForPrompt(
  selectedMode: AgentModeSelection,
  prompt: string,
  context: AgentRoutingContext = {}
): AgentMode {
  const normalized = prompt
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
  const statusOnly = [
    /^(?:are you |is (?:it|this|that) )?done(?: yet)?\??$/,
    /^(?:did (?:you|it|this|that) )?finish(?:ed)?\??$/,
    /^(?:give me (?:a )?)?(?:status|status update)\??$/,
    /^(?:what(?:'s| is) (?:it|this|that|the ai|intelligence)|what are you) doing(?: right now)?\??$/,
    /^is (?:it|this|that|the ai|intelligence) still (?:working|running)\??$/,
    /^(?:please )?summari[sz]e (?:that|this|what you did|the changes)(?: for me)?\??$/,
    /^what (?:did|have) you (?:do|done|change|changed)\??$/,
    /^(?:show|list) (?:me )?(?:the )?(?:changed )?(?:files|changes)\??$/,
    /^(?:is|are) .{1,160}\b(?:fixed|resolved|complete|completed|done|working)(?: yet)?\??$/,
    /^has .{1,160}\bbeen (?:fixed|resolved|completed|finished)\??$/,
  ].some((pattern) => pattern.test(normalized))
  // A mode the user explicitly selected is authoritative. Automatic alone
  // applies language routing and may resume an unfinished implementation.
  if (selectedMode !== 'auto') return selectedMode

  if (statusOnly) return context.pendingImplementationMode ?? 'ask'
  if (isImplementationContinuation(normalized) && context.pendingImplementationMode) {
    return context.pendingImplementationMode
  }

  const explicitImplementation = explicitImplementationIntent(normalized)

  // Automatic is the calm default: factual questions and research remain
  // read-only, while clear requests to change something get the full
  // implementation path. Users should not need to understand agent modes.
  const planningOnly =
    /^(?:please\s+)?(?:plan|outline|brainstorm|propose|design a plan|give me a plan|make a plan|create a plan)\b/.test(
      normalized
    ) ||
    /\b(?:roadmap|implementation plan|step-by-step plan)\b/.test(normalized) ||
    /^(?:please\s+)?(?:create|make|draw|visualize|map|show)(?:\s+me)?\s+(?:a\s+)?(?:planning\s+)?(?:canvas|diagram)\b/.test(
      normalized
    )
  const buildAfterPlanning =
    planningOnly &&
    /\b(?:then|and(?: then)?|after(?:ward|wards)?|followed by)\b[\s\S]{0,80}\b(?:build|change|code|debug|edit|fix|implement|modify|patch|refactor|repair|update)\b/.test(
      normalized
    )
  if (planningOnly && !buildAfterPlanning) return 'plan'

  const informationalQuestion =
    /^(?:how|what|where|why|when|which|who|is|are|do|does|did|can i|could i|should i|would i)\b/.test(
      normalized
    ) || /\b(?:help me understand|help with|explain|teach me|learn about|want to know|tell me (?:how|what|where|why))\b/.test(normalized)

  const debugging =
    /\b(?:fix|repair|debug|broken|bug|crash(?:es|ed|ing)?|failing|fails?|not working|doesn['’]?t work)\b/.test(
      normalized
    )

  const directAction =
    /\b(?:implement|fix|repair|debug|solve|refactor|install|publish|deploy|push|relaunch|replace|delete|remove|rename|archive|move|upload|download|import|export|send|schedule|integrate)\b/.test(
      normalized
    )
  const completionAction = new RegExp(
    `\\b(?:complete|continue|finish|resume)\\b[\\s\\S]{0,40}\\b(?:build(?:ing)?|implement(?:ation|ing)?|work(?:ing)?\\s+on)\\b[\\s\\S]{0,100}\\b${IMPLEMENTATION_TARGET}\\b`
  ).test(normalized)
  const implementationContinuation =
    /\b(?:complete|continue|finish|resume)\s+(?:(?:the|this|that|my|your|our)\s+)?(?:(?:existing|current|unfinished|remaining)\s+|[a-z0-9][a-z0-9-]{1,50}\s+)?implementation\b/.test(
      normalized
    )
  const productAction =
    /\b(?:add|update|change|edit|modify|write|build|create|make|turn|convert)\b[\s\S]{0,100}\b(?:app|application|software|program|tool|service|server|daemon|site|website|page|interface|ui|button|feature|file|folder|workspace|project|code|component|screen|layout|client|desktop|release|version|setting|workflow|integration|test|search|sidebar|header|login|form|report|document|canvas|artifact|diagram)\b/.test(
      normalized
    )
  const passiveProductAction =
    /\b(?:i['’]?d like|i would like|i want|i need|we need|let me|allow me to|there should be)\b[\s\S]{0,140}\b(?:app|application|site|website|page|interface|ui|button|feature|file|folder|workspace|project|code|component|screen|layout|client|desktop|release|version|setting|mode|workflow|integration|test|search(?: bar)?|sidebar|header|login|form|report|document|canvas|artifact|diagram)\b/.test(
      normalized
    ) ||
    /\b(?:app|application|site|website|page|interface|ui|button|feature|file|folder|workspace|project|code|component|screen|layout|client|desktop|release|version|setting|mode|workflow|integration|test|search(?: bar)?|sidebar|header|login|form|report|document|canvas|artifact|diagram)\b[\s\S]{0,100}\b(?:should|needs? to|is missing|are missing|would be better|could be)\b/.test(
      normalized
    )
  const actionRequested =
    directAction ||
    completionAction ||
    implementationContinuation ||
    productAction ||
    passiveProductAction

  // Direct requests such as "Can you fix…?" are not informational questions,
  // while "How do I fix…?" remains Ask. A plain symptom statement asks
  // Automatic to debug; an explanatory question stays read-only.
  if (explicitImplementation) return debugging ? 'debug' : 'agent'
  if (debugging && !informationalQuestion) return 'debug'
  if (actionRequested && !informationalQuestion) return 'agent'
  if (informationalQuestion) return 'ask'

  return 'ask'
}

/** Completion is based on the requested outcome, not merely a tool-capable mode. */
export function agentTaskExpectationForPrompt(
  mode: AgentMode,
  prompt: string,
  context: AgentRoutingContext = {}
): AgentTaskExpectation {
  if (mode === 'debug') return 'workspace-change'
  if (mode !== 'agent') return 'answer'
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ')
  if (isImplementationContinuation(normalized.replace(/[.!]+$/g, ''))) {
    return context.pendingTaskExpectation ?? 'answer'
  }
  const fileMutationProhibition =
    /\b(?:do not|don['’]?t|must not)\s+(?:edit|change|modify|write(?:\s+to)?|patch)\s+(?:(?:any\s+other|any|a|the|other)\s+)?files?\b/
  // Remove only the explicit negative phrase before looking for positive
  // mutation intent. Otherwise "Do not modify any file" manufactures a
  // workspace-change objective merely because it contains "modify" + "file".
  // The rest of the prompt remains visible, so a real request such as "Edit
  // this file; do not modify any other files" still requires a mutation.
  const mutationIntentPrompt = normalized.replace(
    new RegExp(fileMutationProhibition.source, 'g'),
    ' '
  )
  const workspaceChange =
    /\bworkspace(?:\.|_)(?:patch|write|create|delete|rename)\b/.test(
      mutationIntentPrompt
    ) ||
    /^(?:please\s+)?(?:implement|fix|repair|refactor|build|code)(?:\b|$)/.test(
      mutationIntentPrompt
    ) ||
    /\b(?:implement(?:ing)?|write|fix|repair|debug|solve|refactor|add|update|change|edit|modify|build(?:ing)?|complete|continue|finish|resume|create|make|delete|remove|rename|archive|move)\b[\s\S]{0,120}\b(?:app|application|software|program|product|prototype|implementation|tool|service|server|daemon|site|website|page|interface|ui|button|feature|file|folder|workspace|project|code|component|screen|layout|client|desktop|release|version|setting|workflow|integration|test|search|sidebar|header|login|form|report|document|canvas|artifact|diagram|patch)\b/.test(
      mutationIntentPrompt
    ) ||
    /\b(?:file|code|component|test|interface|ui|app|application|website|page|search(?: bar)?|sidebar|header|button|feature)\b[\s\S]{0,100}\b(?:should|needs? to|is missing|are missing|broken)\b/.test(
      mutationIntentPrompt
    ) ||
    /\b(?:i['’]?d like|i would like|i want|i need|we need|let me|allow me to|there should be)\b[\s\S]{0,140}\b(?:app|application|site|website|page|interface|ui|button|feature|file|folder|workspace|project|code|component|screen|layout|client|desktop|release|version|setting|mode|workflow|integration|test|search(?: bar)?|sidebar|header|login|form|report|document|canvas|artifact|diagram)\b/.test(
      mutationIntentPrompt
    )
  if (workspaceChange) return 'workspace-change'
  const externalAction =
    /\b(?:publish|deploy|push|install|restart|relaunch|launch|open|send|schedule|upload|download|import|export|run|execute|rerun|test|verify|validate)\b/.test(
      normalized
    )
  return externalAction ? 'external-action' : 'answer'
}

/**
 * Agent/Debug describe tool capability; the task expectation describes the
 * outcome. Legacy messages without an expectation retain Execute/Fix semantics.
 */
export function workspaceChangeExpected(
  mode: AgentMode | undefined,
  expectation?: AgentTaskExpectation
): boolean {
  return (
    (mode === 'agent' || mode === 'debug') &&
    expectation !== 'external-action' &&
    expectation !== 'answer'
  )
}

/** External-action turns cannot be terminally Done on provider prose alone. */
export function externalActionReadyForHandoff(
  expectation: AgentTaskExpectation | undefined,
  steps: PersistenceStep[]
): boolean {
  if (expectation !== 'external-action') return true
  return steps.some(
    (step) =>
      step.status === 'done' &&
      (EXTERNAL_ACTION_TOOLS.has(step.name) || step.name.startsWith('mcp__'))
  )
}

export interface PriorAgentTurn {
  role?: 'user' | 'model'
  content?: string
  operational?: boolean
  agentMode?: AgentMode
  taskExpectation?: AgentTaskExpectation
  steps?: Array<{
    name: string
    summary?: string
    resultMeta?: string
    failed?: boolean
    preview?: PersistenceStep['preview']
  }>
}

/**
 * Find the most recent implementation turn and resume it only when its
 * recorded work lacks a verified completion boundary. Later read-only status
 * answers do not erase that pending work.
 */
export function pendingImplementationMode(
  turns: PriorAgentTurn[]
): 'debug' | 'agent' | undefined {
  return pendingImplementationRouting(turns)?.mode
}

export function pendingImplementationRouting(
  turns: PriorAgentTurn[]
):
  | {
      mode: 'debug' | 'agent'
      taskExpectation: Exclude<AgentTaskExpectation, 'answer'>
    }
  | undefined {
  let unresolvedFailureSeen = false
  let laterNonOperationalModelSeen = false
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn.agentMode === 'agent' || turn.agentMode === 'debug') {
      if (laterNonOperationalModelSeen && !unresolvedFailureSeen) {
        return undefined
      }
      const steps: PersistenceStep[] = (turn.steps ?? []).map((step) => ({
        ...step,
        status: step.failed ? 'error' : 'done',
      }))
      if (turn.taskExpectation === 'answer') return undefined
      const expectation =
        turn.taskExpectation === 'external-action'
          ? 'external-action'
          : 'workspace-change'
      const ready =
        expectation === 'external-action'
          ? externalActionReadyForHandoff(expectation, steps)
          : implementationReadyForHandoff(turn.agentMode, steps)
      return ready
        ? undefined
        : { mode: turn.agentMode, taskExpectation: expectation }
    }
    if (turn.role === 'model') {
      if (turn.operational) continue
      laterNonOperationalModelSeen = true
      if (looksLikeUnfinishedImplementation(turn.content)) {
        unresolvedFailureSeen = true
      }
      continue
    }
    // A provider timeout can leave only the original user request plus saved
    // operational updates. Recover the intended mode from that request rather
    // than letting a later status question silently become an audit.
    if (turn.role === 'user' && turn.content?.trim()) {
      const inferred = agentModeForPrompt('auto', turn.content)
      if (inferred === 'agent' || inferred === 'debug') {
        if (!unresolvedFailureSeen && laterNonOperationalModelSeen) {
          return undefined
        }
        const expectation = agentTaskExpectationForPrompt(inferred, turn.content)
        return expectation === 'answer'
          ? undefined
          : { mode: inferred, taskExpectation: expectation }
      }
    }
  }
  return undefined
}

function looksLikeUnfinishedImplementation(content?: string): boolean {
  if (!content?.trim()) return false
  return /(?:blocked\s*[—:-]|couldn['’]?t finish|could not finish|did not finish|could not edit files|could not execute verification|provider stopped making progress|needs attention|not conclusively resolved|(?:product|task|work|implementation) (?:is )?not (?:yet )?(?:completed|proven|verified|shipped|complete)|session was read-only|task still needs implementation|no files were changed)/i.test(
    content
  )
}

export function hasSuccessfulFileChange(steps: PersistenceStep[]): boolean {
  return steps.some(isSuccessfulFileChangeStep)
}

/**
 * A failed mutation after a persisted mutation is an unresolved correction,
 * not verification evidence. This covers a provider that splits one semantic
 * change across calls as well as older clients that could expose a partial
 * batch failure. Only a later, exactly read-back mutation clears the barrier.
 */
export function hasOutstandingFileMutationFailure(
  steps: PersistenceStep[]
): boolean {
  let latestFailure = -1
  let latestSuccess = -1
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (!FILE_MUTATION_TOOLS.has(step.name)) continue
    if (isSuccessfulFileChangeStep(step)) latestSuccess = index
    else if (step.status === 'error') latestFailure = index
  }
  return latestFailure >= 0 && latestFailure > latestSuccess
}

/** A reviewed non-empty diff can represent a patch made by an earlier run. */
export function hasReviewableWorkspaceChange(
  steps: PersistenceStep[]
): boolean {
  return steps.some((step) => {
    if (
      step.name !== 'git_diff' ||
      step.status !== 'done' ||
      step.resultMeta !== 'scoped diff read'
    ) {
      return false
    }
    const additions = step.preview?.additions ?? 0
    const deletions = step.preview?.deletions ?? 0
    const body = step.preview?.body ?? ''
    const scopedFiles = step.preview?.items?.filter((item) => item.label.trim()) ?? []
    return (
      scopedFiles.length > 0 &&
      (additions + deletions > 0 || /(?:^|\n)diff --git /m.test(body))
    )
  })
}

export interface ImplementationChangeEvidence<
  T extends PersistenceStep = PersistenceStep,
> {
  kind: 'authored' | 'inherited' | 'none'
  steps: T[]
}

/**
 * Prefer edits recorded in this run. Only when there are no such edits may a
 * reviewed, non-empty Git diff stand in for a patch inherited from an earlier
 * run. This distinction keeps UI copy honest about who authored the change.
 */
export function implementationChangeEvidence<T extends PersistenceStep>(
  steps: T[]
): ImplementationChangeEvidence<T> {
  const authored = steps.filter(isSuccessfulFileChangeStep)
  if (authored.length > 0) return { kind: 'authored', steps: authored }
  const inherited = steps.filter((step) =>
    hasReviewableWorkspaceChange([step])
  )
  return inherited.length > 0
    ? { kind: 'inherited', steps: inherited }
    : { kind: 'none', steps: [] }
}

function isSuccessfulFileChangeStep(step: PersistenceStep): boolean {
  if (!FILE_MUTATION_TOOLS.has(step.name) || step.status !== 'done') return false
  // This bounded token is emitted only after exact post-operation read-back.
  // It persists when local-only previews are stripped from saved sessions.
  if (!PERSISTED_CHANGE_META.test(step.resultMeta?.trim() ?? '')) return false
  return true
}

function implementationChangeIndex(steps: PersistenceStep[]): number {
  let latestMutation = -1
  let firstReviewedDiff = -1
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const successfulMutation = isSuccessfulFileChangeStep(step)
    const reviewedExistingChange =
      step.name === 'git_diff' &&
      step.status === 'done' &&
      hasReviewableWorkspaceChange([step])
    if (successfulMutation) latestMutation = index
    if (reviewedExistingChange && firstReviewedDiff < 0) {
      firstReviewedDiff = index
    }
  }
  // A diff is the change boundary only when this run inherited an existing
  // patch. Its first scoped review establishes that boundary; later reviews
  // observe the same patch and must not invalidate verification that already
  // passed. An authored mutation remains authoritative and resets the boundary.
  return latestMutation >= 0 ? latestMutation : firstReviewedDiff
}

/**
 * Execute/Fix work should stop asking the provider for more tools once the
 * latest reviewed file change has a successful verification after it. The
 * next request is deliberately tool-free so every run ends with a visible
 * handoff instead of falling back into "choosing the next action".
 */
export function implementationReadyForHandoff(
  mode: AgentMode | undefined,
  steps: PersistenceStep[]
): boolean {
  if (mode !== 'agent' && mode !== 'debug') return false
  if (hasOutstandingFileMutationFailure(steps)) return false

  const latestMutation = implementationChangeIndex(steps)
  if (latestMutation < 0) return false

  const validation = steps
    .slice(latestMutation + 1)
    .filter((step) => IMPLEMENTATION_VERIFICATION_TOOLS.has(step.name))
  let verified = false
  for (const step of validation) {
    if (step.status === 'error') {
      verified = false
      continue
    }
    if (isMeaningfulImplementationVerification(step)) {
      verified = true
      continue
    }
    // An unrelated successful command is not new verification evidence and
    // must not erase a passing focused check. A step that claims to be a
    // canonical verification but contains contradictory output does reset it.
    if (
      /^exit 0 · (?:tests?|build|type check|change check) passed(?:$| · )/i.test(
        step.resultMeta?.trim() ?? ''
      )
    ) {
      verified = false
    }
  }
  return (
    verified ||
    hasStructuredDeviceRunVerification(steps.slice(latestMutation + 1))
  )
}

export function isMeaningfulImplementationVerification(
  step: PersistenceStep
): boolean {
  if (step.name !== 'run_terminal' || step.status !== 'done') return false
  const resultMeta = step.resultMeta?.trim() ?? ''
  if (
    !/^exit 0 · (?:tests?|build|type check|change check) passed(?:$| · )/i.test(
      resultMeta
    )
  ) {
    return false
  }
  const output = step.preview?.body ?? ''
  return !/\*\*\s+(?:TEST|BUILD|ARCHIVE|ANALYZE) FAILED\s+\*\*|\bTesting failed:\s|\bxcodebuild:\s+error:|\bThe following build commands failed:|\bCommand .* failed with a nonzero exit code\b/i.test(
    output
  )
}

export function completionHandoffPrompt(
  mode: 'ask' | 'plan' | 'debug' | 'agent'
): string {
  const implementation = mode === 'agent' || mode === 'debug'
  return [
    'The tool phase is complete. Produce the final user-facing handoff now. Do not request another tool, ask the user to continue, or describe this instruction.',
    'Lead with the outcome in plain language and explicitly say whether the task is completed, stopped, or blocked.',
    implementation
      ? 'Then summarize what changed, list every changed file by its exact workspace-relative path, and report the verification performed with pass/fail results. Mention any remaining limitation honestly.'
      : 'Then summarize the answer and the strongest evidence used. Mention any remaining uncertainty honestly.',
    implementation
      ? 'Every file-level or code-construct claim must be supported by a successful write read-back, a later exact workspace_read, or a final task-scoped diff. Do not describe an attempted or failed edit as present.'
      : '',
    'Do not claim completion unless the recorded tool results support it.',
  ].join('\n')
}

export function implementationRecoveryPrompt(
  mode: 'ask' | 'plan' | 'debug' | 'agent',
  steps: PersistenceStep[],
  recoveryAttempt: number
): string | null {
  if (
    (mode !== 'agent' && mode !== 'debug') ||
    recoveryAttempt >= 3
  ) {
    return null
  }

  if (hasSuccessfulFileChange(steps) || hasReviewableWorkspaceChange(steps)) {
    if (hasOutstandingFileMutationFailure(steps)) {
      return [
        'Do not end the Execute/Fix run yet. A file mutation failed after an earlier persisted change, so the requested change set may be partial and prior verification is no longer sufficient.',
        'Read the exact affected file once, make the smallest remaining correction with a new workspace_write, then verify the corrected result.',
        'Do not claim that any construct or file-level change exists unless the successful write read-back or a later exact read/task-scoped diff contains it.',
      ].join('\n')
    }
    return implementationReadyForHandoff(mode, steps)
      ? null
      : [
          'Do not end the Execute/Fix run yet. A reviewable change set exists, but no focused verification has completed after the latest edit or diff review.',
          'Run the smallest relevant test, build, typecheck, or diff check now. If it fails, make the smallest correction and verify again.',
          'Then finish immediately with the changed files and pass/fail results.',
        ].join('\n')
  }

  const failed = steps.filter((step) => step.status === 'error')
  const indexOrReferenceFailure = failed.some((step) =>
    `${step.summary ?? ''} ${step.resultMeta ?? ''}`.match(
      /index|opaque|reference|expired|workspace_search/i
    )
  )
  const repeated = repeatedInvestigation(steps)

  return [
    'Do not end the Execute/Fix run yet. The user requested an implementation, but no reviewed file change has succeeded.',
    indexOrReferenceFailure
      ? 'A workspace index miss or expired opaque reference is recoverable. Search again using the exact relative path, or pass the safe workspace-relative/absolute file_path directly to workspace_read and workspace_write. The index is not an editing permission boundary.'
      : 'Continue with the smallest safe in-scope edit. Use workspace_write with exact old_text/new_text edits when a full-file replacement is unnecessary or the file is large.',
    repeated
      ? 'You are repeating the same investigation. Stop re-reading the same evidence; choose a different safe tool path and act on what is already known.'
      : 'If one tool path fails, try another safe in-scope path before calling the task blocked.',
    'Only stop without a change after exhausting the safe search, direct-path read/edit, and relevant verification paths, and then identify the external or permission blocker precisely.',
  ].join('\n')
}

/** Reset the bounded premature-finish counter whenever concrete work advances. */
export function implementationProgressKey(steps: PersistenceStep[]): string {
  const completed = steps.filter(
    (step) => step.status !== 'running' && step.name !== 'synthesize_answer'
  )
  const last = completed.at(-1)
  return `${completed.length}:${last?.name ?? ''}:${last?.status ?? ''}:${
    last?.resultMeta ?? ''
  }`
}

/**
 * A direct provider can occasionally lose a long-lived streaming request even
 * though all completed tool results are still valid locally. Retry that model
 * boundary once from the recorded transcript instead of discarding the run or
 * pretending that an implementation finished. The retry remains bounded so a
 * genuinely unavailable provider still ends with a deterministic handoff.
 */
export function providerTimeoutRecoveryPrompt(
  mode: 'ask' | 'plan' | 'debug' | 'agent',
  steps: PersistenceStep[],
  recoveryAttempt: number
): string | null {
  if (recoveryAttempt >= 1) return null
  if (implementationReadyForHandoff(mode, steps)) return null

  const implementation = mode === 'agent' || mode === 'debug'
  return [
    'The previous provider request became unresponsive and was safely closed. Resume from the conversation and recorded tool results below; do not restart the task or repeat completed reads and commands.',
    implementation
      ? hasSuccessfulFileChange(steps) || hasReviewableWorkspaceChange(steps)
        ? 'A reviewed file change already succeeded. Continue with the smallest focused verification, correct only if necessary, then produce the final changed-files handoff.'
        : 'No reviewed file change has succeeded yet. Use the evidence already gathered to take the next concrete safe edit path, verify it, then produce the final changed-files handoff.'
      : 'Complete the requested answer from the evidence already gathered and return a concise final response.',
    'Do not mention this recovery instruction to the user.',
  ].join('\n')
}

/**
 * Progressively narrows an Execute/Fix run from investigation to action. Models
 * still choose the exact edit, but they cannot spend an entire run repeating
 * searches and status commands after enough evidence has been collected.
 */
export function implementationToolPhase(
  mode: 'ask' | 'plan' | 'debug' | 'agent',
  round: number,
  steps: PersistenceStep[],
  correctiveMutationRequired = false
): ImplementationToolPhase {
  if (mode !== 'agent' && mode !== 'debug') return 'full'
  if (correctiveMutationRequired || hasOutstandingFileMutationFailure(steps)) {
    return 'edit'
  }
  if (hasSuccessfulFileChange(steps) || hasReviewableWorkspaceChange(steps)) {
    return implementationReadyForHandoff(mode, steps) ? 'full' : 'verify'
  }
  const completedEvidenceSteps = steps.filter(
    (step) => step.status !== 'running' && step.name !== 'synthesize_answer'
  ).length
  return round >= 6 || completedEvidenceSteps >= 10 ? 'edit' : 'full'
}

/** A provider-independent handoff guarantees that every terminal run ends. */
export function fallbackCompletionHandoff(
  mode: 'ask' | 'plan' | 'debug' | 'agent',
  steps: PersistenceStep[],
  terminalReason: CompletionTerminalReason = 'round_limit'
): string {
  const implementation = mode === 'agent' || mode === 'debug'
  if (!implementation) {
    if (terminalReason === 'empty_response') {
      return 'I could not complete this response because the provider returned no written answer. Any completed activity above is saved, and this run is closed rather than left looking active.'
    }
    if (terminalReason === 'final_synthesis') {
      return 'I could not complete this response because the provider did not return its final written summary. Any completed activity above is saved, and this run is closed rather than left looking active.'
    }
    if (terminalReason === 'provider_timeout') {
      return 'I could not complete this response because the provider did not finish before its server deadline. Any completed activity above is saved, and this run is closed rather than left looking active. Retry when the provider is available.'
    }
    return 'I finished reviewing the available evidence, but the provider did not return its written answer. The completed activity above remains available for review.'
  }

  const mutations = steps.filter(isSuccessfulFileChangeStep)
  const reviewedDiffs = steps.filter((step) =>
    hasReviewableWorkspaceChange([step])
  )
  const changeSteps = mutations.length > 0 ? mutations : reviewedDiffs
  if (changeSteps.length === 0) {
    if (terminalReason === 'provider_timeout') {
      const lastStep = [...steps]
        .reverse()
        .find((step) => step.status !== 'running')
      return [
        'I could not complete this Execute/Fix run because the provider did not finish before its server deadline. No files were changed.',
        lastStep
          ? `\nLast recorded action: ${lastStep.summary || lastStep.name}${
              lastStep.resultMeta ? ` · ${lastStep.resultMeta}` : ''
            }.`
          : '',
        '\nThe completed activity above is saved, and this run is closed rather than left looking active. Retry when the provider is available; the task still needs implementation.',
      ].join('')
    }
    return [
      'I could not complete this Execute/Fix run. No files were changed.',
      '',
      'The run exhausted its bounded implementation path without producing a safe reviewed edit. The completed searches, reads, and checks above remain available, but this task still needs implementation.',
    ].join('\n')
  }

  const files = [
    ...new Set(
      changeSteps
        .flatMap((step) => completionFileLabels(step))
        .filter((value): value is string => Boolean(value))
    ),
  ]
  const firstChange = steps.findIndex(
    (step) =>
      isSuccessfulFileChangeStep(step) ||
      hasReviewableWorkspaceChange([step])
  )
  const verification = steps
    .slice(firstChange + 1)
    .filter((step) => IMPLEMENTATION_VERIFICATION_TOOLS.has(step.name))
  const verified = implementationReadyForHandoff(mode, steps)
  return [
    verified
      ? mutations.length > 0
        ? 'Completed. The requested file changes were made and verified.'
        : 'Completed. The existing workspace changes were reviewed and verified.'
      : mutations.length > 0
        ? 'Needs attention. The requested file changes were made, but verification did not finish successfully.'
        : 'Needs attention. Existing workspace changes were found, but verification did not finish.',
    files.length > 0
      ? `\nChanged files:\n${files.map((file) => `- ${file}`).join('\n')}`
      : '\nThe reviewed change rows above contain the edited files.',
    verification.length > 0
      ? `\nVerification:\n${verification
          .map(
            (step) =>
              `- ${step.status === 'done' ? 'Passed' : 'Failed'}: ${
                step.resultMeta || step.summary || step.name
              }`
          )
          .join('\n')}`
      : '\nVerification did not complete after the final edit.',
    '\nThe provider did not return its written summary, so StatsKey generated this handoff from the recorded work instead of leaving the task running.',
  ].join('\n')
}

export function fallbackExternalActionHandoff(
  steps: PersistenceStep[],
  terminalReason: CompletionTerminalReason = 'round_limit'
): string {
  const actionSteps = steps.filter(
    (step) =>
      step.status !== 'running' &&
      (EXTERNAL_ACTION_TOOLS.has(step.name) || step.name.startsWith('mcp__'))
  )
  const completed = actionSteps.filter((step) => step.status === 'done')
  const failed = actionSteps.filter((step) => step.status === 'error')
  if (completed.length === 0) {
    return terminalReason === 'provider_timeout'
      ? 'I could not complete this Execute run because the provider stopped before any requested action succeeded. The gathered evidence is saved, and no action was left running.'
      : 'I could not complete this Execute run because no requested action reached a recorded success. The gathered evidence is saved, and no action was left running.'
  }

  const activity = [...completed, ...failed]
    .slice(-8)
    .map(
      (step) =>
        `- ${step.status === 'done' ? 'Completed' : 'Failed'}: ${
          step.summary || step.name
        }${step.resultMeta ? ` · ${step.resultMeta}` : ''}`
    )
    .join('\n')
  return [
    failed.length > 0
      ? 'Needs attention. Some requested actions completed, but a later action failed.'
      : 'One or more requested actions reached recorded success.',
    '',
    'Recorded activity:',
    activity,
    '',
    terminalReason === 'final_synthesis'
      ? 'The provider did not return its final written summary. StatsKey closed with this local receipt and did not repeat completed actions.'
      : 'The provider did not return a usable final handoff. StatsKey closed with this local receipt and did not repeat completed actions.',
  ].join('\n')
}

/** A stopped run still receives a truthful, reviewable saved-work handoff. */
export function fallbackStoppedHandoff(
  mode: 'ask' | 'plan' | 'debug' | 'agent',
  steps: PersistenceStep[]
): string {
  if (mode !== 'agent' && mode !== 'debug') {
    return 'Stopped at a safe boundary. The conversation and completed activity remain available for review.'
  }

  const mutations = steps.filter(isSuccessfulFileChangeStep)
  const reviewedDiffs = steps.filter((step) =>
    hasReviewableWorkspaceChange([step])
  )
  const changeSteps = mutations.length > 0 ? mutations : reviewedDiffs
  if (changeSteps.length === 0) {
    return 'Stopped at a safe boundary. No files were changed, and the conversation remains available for review.'
  }

  const files = [
    ...new Set(
      changeSteps
        .flatMap((step) => completionFileLabels(step))
        .filter((value): value is string => Boolean(value))
    ),
  ]
  const firstChange = steps.findIndex(
    (step) =>
      isSuccessfulFileChangeStep(step) ||
      hasReviewableWorkspaceChange([step])
  )
  const verification = steps
    .slice(firstChange + 1)
    .filter((step) => IMPLEMENTATION_VERIFICATION_TOOLS.has(step.name))
  return [
    'Stopped at a safe boundary. Work completed before the stop was preserved.',
    files.length > 0
      ? `\nSaved changed files:\n${files.map((file) => `- ${file}`).join('\n')}`
      : '\nThe reviewed change rows above contain the saved files.',
    verification.length > 0
      ? `\nVerification completed before the stop:\n${verification
          .map(
            (step) =>
              `- ${step.status === 'done' ? 'Passed' : 'Failed'}: ${
                step.resultMeta || step.summary || step.name
              }`
          )
          .join('\n')}`
      : '\nNo verification completed after the latest saved edit.',
  ].join('\n')
}

export function implementationCheckpoint(
  mode: 'ask' | 'plan' | 'debug' | 'agent',
  round: number,
  steps: PersistenceStep[]
): string | null {
  if (
    (mode !== 'agent' && mode !== 'debug') ||
    hasSuccessfulFileChange(steps) || hasReviewableWorkspaceChange(steps)
  ) {
    return null
  }
  if (round === 4) {
    return 'Execution checkpoint: four investigation rounds have passed without a reviewed file change. Evidence collection is now bounded: read the exact relevant file and review one task-scoped dirty diff with git_diff file_paths. If that scoped diff already implements the request, verify it instead of making a redundant edit; otherwise make the smallest correct change now. A stale search index is recoverable: use exact paths with workspace_read/workspace_write. Do not return to broad search or manifest discovery.'
  }
  const completedEvidenceSteps = steps.filter(
    (step) => step.status !== 'running' && step.name !== 'synthesize_answer'
  ).length
  if (
    round === 6 ||
    (round === 0 && completedEvidenceSteps >= 10) ||
    (round === 8 && repeatedInvestigation(steps))
  ) {
    return 'Action checkpoint: the evidence budget is closed and no reviewed file change exists. Stop repeating. Do not repeat terminal commands, searches, workspace reads, or task-scoped git_diff file_paths already recorded. Do not reopen broad search or manifest discovery. Perform the smallest real workspace_write, workspace_create, workspace_delete, or workspace_rename now. A plan, proposed helper, missing target, or empty file is not an implementation. After a successful mutation, the verification lane will restore run_terminal and final scoped-diff review.'
  }
  return null
}

function repeatedInvestigation(steps: PersistenceStep[]): boolean {
  const signatures = steps
    .filter(
      (step) =>
        !FILE_MUTATION_TOOLS.has(step.name) &&
        step.name !== 'run_terminal' &&
        step.status !== 'running'
    )
    .map((step) => `${step.name}:${step.summary ?? ''}`)
  const counts = new Map<string, number>()
  for (const signature of signatures) {
    const count = (counts.get(signature) ?? 0) + 1
    if (count >= 3) return true
    counts.set(signature, count)
  }
  return false
}

function canonicalToolValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalToolValue).join(',')}]`
  }
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalToolValue(item)}`
      )
      .join(',')}}`
  }
  return JSON.stringify(String(value))
}

/**
 * Produce a non-reversible, process-local comparison key for one exact write
 * payload. The source text itself never enters persisted activity metadata.
 */
export function workspaceWritePayloadFingerprint(
  input: Record<string, unknown>
): string {
  const payload = canonicalToolValue({
    file_ref: input.file_ref,
    file_path: input.file_path,
    content_present: Object.prototype.hasOwnProperty.call(input, 'content'),
    content: input.content,
    edits_present: Object.prototype.hasOwnProperty.call(input, 'edits'),
    edits: input.edits,
  })
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193)
    right = Math.imul(right ^ (code + index), 0x85ebca6b)
  }
  return `${payload.length.toString(36)}:${(left >>> 0)
    .toString(16)
    .padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Bounds retries for one exact malformed write without disabling the write
 * tool. A corrected payload remains available immediately, and an explicit
 * successful reread clears the stale failure history.
 */
export class WorkspaceWriteFailureGuard {
  private failures = new Map<string, number>()

  shouldSuppress(input: Record<string, unknown>, maximum = 2): boolean {
    return (
      (this.failures.get(workspaceWritePayloadFingerprint(input)) ?? 0) >=
      maximum
    )
  }

  recordFailure(input: Record<string, unknown>): void {
    const fingerprint = workspaceWritePayloadFingerprint(input)
    this.failures.set(fingerprint, (this.failures.get(fingerprint) ?? 0) + 1)
  }

  resetAfterSuccessfulReadOrWrite(): void {
    this.failures.clear()
  }
}

/** Keep one corrective reread available even after the run narrows to edits. */
export function workspaceWriteRecoveryReadNeeded(
  steps: PersistenceStep[]
): boolean {
  let lastFailedWrite = -1
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.name === 'workspace_write' && step.status === 'error') {
      lastFailedWrite = index
      break
    }
  }
  if (lastFailedWrite < 0) return false
  const reads = steps.filter(
    (step, index) =>
      index > lastFailedWrite &&
      step.name === 'workspace_read' &&
      step.status === 'done'
  )
  if (reads.length === 0) return true
  return reads.every(
    (step) =>
      /\btruncated\b/i.test(step.resultMeta ?? '') &&
      !/\blines\s+\d+-\d+\s+of\s+\d+/i.test(step.resultMeta ?? '') &&
      !/\b(?:start_line|end_line):/i.test(step.summary ?? '')
  )
}

function completionFileLabels(step: PersistenceStep): string[] {
  if (step.name === 'git_diff') {
    const body = step.preview?.body ?? ''
    const paths = [...body.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map(
      (match) => match[2]
    )
    if (paths.length > 0) return paths
  }
  const label = step.preview?.filePath || step.preview?.title || step.summary
  return label ? [label] : []
}
