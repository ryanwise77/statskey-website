import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import {
  anthropicChat,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicModelRouting,
  type AnthropicMonthlyUsage,
  type AnthropicToolUseBlock,
  type ClaudeModel,
} from './anthropic'
import { AGENT_TOOLS, SUBAGENT_TOOLS, AgentDataCache, executeTool } from './tools'
import type { ChatProvider } from './providers'

/**
 * The web Intelligence agent loop — the counterpart of the iOS
 * ChatToolRouter round-trip, for every managed provider:
 *
 *   - Claude routes through the same reliable callable tool loop iOS uses.
 *     Only the finished answer is progressively revealed in the chat UI.
 *   - ChatGPT and Grok route through their callables with Chat-Completions
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
  /** Model that actually answered (Claude routes; after live-catalog routing). */
  servedModel?: string
  modelRouting?: AnthropicModelRouting
}

export interface AgentTurnParams {
  uid: string
  provider: ChatProvider
  modelId: string
  systemPrompt: string
  /** Prior conversation turns as plain text. */
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>
  userText: string
  onStep: (steps: AgentStep[]) => void
  /** Live streamed text of the answer-in-progress (Claude routes). */
  onText?: (text: string) => void
  /** Optional cooperative stop: checked between rounds. */
  shouldStop?: () => boolean
  /** Auto route: request Pro+ fair-use metering (server validates the plan). */
  unlimitedAuto?: boolean
}

const MAX_ROUNDS = 8
const SUBAGENT_MAX_ROUNDS = 5
const SUBAGENT_MODEL: ClaudeModel = 'claude-sonnet-5'

export function summarizeToolCall(name: string, input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (v == null || v === '') continue
    const rendered =
      typeof v === 'string' ? `"${v.length > 42 ? `${v.slice(0, 39)}…` : v}"` : Array.isArray(v) ? `[${v.length}]` : String(v)
    parts.push(`${k}: ${rendered}`)
  }
  return `${name}(${parts.join(', ')})`
}

export async function runAgentTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  if (params.provider === 'claude') return runClaudeTurn(params)
  return runOpenAIStyleTurn(params)
}

// ---------------------------------------------------------------------------
// Shared step bookkeeping
// ---------------------------------------------------------------------------

class StepLog {
  steps: AgentStep[] = []
  constructor(private onStep: (steps: AgentStep[]) => void) {}

  emit() {
    this.onStep([...this.steps])
  }

  open(id: string, name: string, summary: string, sub?: boolean): AgentStep {
    const existing = this.steps.find((s) => s.id === id)
    if (existing) return existing
    const step: AgentStep = { id, name, summary, status: 'running', sub, startedAt: Date.now() }
    this.steps.push(step)
    this.emit()
    return step
  }

  close(id: string, resultMeta: string, failed: boolean) {
    const step = this.steps.find((s) => s.id === id)
    if (!step) return
    step.status = failed ? 'error' : 'done'
    step.resultMeta = resultMeta
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

async function executeToolWithSubagent(
  uid: string,
  cache: AgentDataCache,
  call: { id: string; name: string; input: Record<string, unknown> },
  log: StepLog
): Promise<{ content: string; isError: boolean; credits: number }> {
  if (call.name === 'run_subagent') {
    const objective = typeof call.input?.objective === 'string' ? call.input.objective : ''
    const finding = await runSubagent({ uid, cache, objective, log })
    log.close(call.id, finding.isError ? 'failed' : `${finding.rounds} rounds · findings returned`, finding.isError)
    return { content: finding.content, isError: finding.isError, credits: finding.creditsCharged }
  }
  const result = await executeTool(uid, cache, call.name, call.input ?? {})
  log.close(call.id, result.resultMeta, result.isError)
  return { content: result.content, isError: result.isError, credits: 0 }
}

// ---------------------------------------------------------------------------
// Claude — reliable callable rounds; only the final answer is revealed
// ---------------------------------------------------------------------------

async function runClaudeTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const { uid, modelId, systemPrompt, priorTurns, userText, onStep, onText, shouldStop, unlimitedAuto } = params
  const cache = new AgentDataCache(uid)
  const log = new StepLog(onStep)
  let creditsCharged = 0
  let monthlyUsage: AnthropicMonthlyUsage | undefined
  let servedModel: string | undefined
  let modelRouting: AnthropicModelRouting | undefined
  const citations = new Set<string>()

  const messages: AnthropicMessage[] = [
    ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: userText },
  ]

  const preambles: string[] = []

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const request = {
      messages,
      systemPrompt,
      model: modelId as ClaudeModel,
      tools: AGENT_TOOLS,
      reasoning_effort: 'medium' as const,
      ...(unlimitedAuto ? { unlimitedAuto: true } : {}),
    }

    const resp = await anthropicChat(request)
    const text = resp.content ?? ''
    const toolUses = (resp.toolUse ?? []) as AnthropicToolUseBlock[]
    creditsCharged += resp.creditsCharged ?? 0
    if (resp.monthlyUsage) monthlyUsage = resp.monthlyUsage
    if (resp.model) servedModel = resp.model
    if (resp.modelRouting) modelRouting = resp.modelRouting
    for (const c of resp.citations ?? []) citations.add(c)

    if (toolUses.length === 0) {
      const content = text.trim() || preambles.join('\n\n').trim()
      await revealAnswer(content, onText, shouldStop)
      return {
        content,
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
        servedModel,
        modelRouting,
      }
    }

    if (text) preambles.push(text)

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
      const step = log.open(call.id, call.name, summarizeToolCall(call.name, call.input ?? {}))
      log.refineSummary(step.id, summarizeToolCall(call.name, call.input ?? {}))
      const result = await executeToolWithSubagent(uid, cache, call, log)
      creditsCharged += result.credits
      resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: result.content, is_error: result.isError })
    }
    messages.push({ role: 'user', content: resultBlocks })

    if (shouldStop?.()) {
      return {
        content: preambles.join('\n\n').trim() || 'Stopped before the answer was finished. The tool activity above shows what was gathered.',
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
        servedModel,
        modelRouting,
      }
    }
  }

  return {
    content:
      preambles.join('\n\n').trim() ||
      'I hit the tool budget for one turn before finishing. Ask me to continue and I will pick up from what the tools found.',
    steps: log.steps,
    creditsCharged,
    monthlyUsage,
    citations: [...citations],
    rounds: MAX_ROUNDS,
    servedModel,
    modelRouting,
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
}

interface OpenAIStyleResponse {
  choices?: Array<{ message?: { content?: string; tool_calls?: OpenAIStyleToolCall[] }; finish_reason?: string }>
  citations?: string[]
  creditsCharged?: number
  monthlyUsage?: AnthropicMonthlyUsage
}

/** Chat-Completions tool defs — the callables convert these to Responses tools. */
const OPENAI_STYLE_TOOLS = AGENT_TOOLS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}))

const functions = getFunctions(firebaseApp, 'us-central1')
const openAICall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(functions, 'openAIChat')
const grokCall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(functions, 'grokChat')

async function runOpenAIStyleTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const { uid, provider, modelId, systemPrompt, priorTurns, userText, onStep, onText, shouldStop } = params
  const cache = new AgentDataCache(uid)
  const log = new StepLog(onStep)
  const call = provider === 'chatgpt' ? openAICall : grokCall
  let creditsCharged = 0
  let monthlyUsage: AnthropicMonthlyUsage | undefined
  const citations = new Set<string>()

  const messages: OpenAIStyleMessage[] = [
    { role: 'system', content: systemPrompt },
    ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: userText },
  ]

  const preambles: string[] = []

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data } = await call({ messages, model: modelId, tools: OPENAI_STYLE_TOOLS })
    creditsCharged += data.creditsCharged ?? 0
    if (data.monthlyUsage) monthlyUsage = data.monthlyUsage
    for (const c of data.citations ?? []) citations.add(c)

    const choice = data.choices?.[0]
    const message = choice?.message
    const toolCalls = message?.tool_calls ?? []
    const text = typeof message?.content === 'string' ? message.content : ''

    if (toolCalls.length === 0) {
      const content = text.trim() || preambles.join('\n\n').trim()
      await revealAnswer(content, onText, shouldStop)
      return { content, steps: log.steps, creditsCharged, monthlyUsage, citations: [...citations], rounds: round + 1 }
    }

    if (text) preambles.push(text)

    messages.push({ role: 'assistant', ...(text ? { content: text } : {}), tool_calls: toolCalls })

    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
      } catch {
        /* malformed args — execute with empty input and let the tool report */
      }
      log.open(tc.id, tc.function.name, summarizeToolCall(tc.function.name, input))
      const result = await executeToolWithSubagent(
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
        content: preambles.join('\n\n').trim() || 'Stopped before the answer was finished. The tool activity above shows what was gathered.',
        steps: log.steps,
        creditsCharged,
        monthlyUsage,
        citations: [...citations],
        rounds: round + 1,
      }
    }
  }

  return {
    content:
      preambles.join('\n\n').trim() ||
      'I hit the tool budget for one turn before finishing. Ask me to continue and I will pick up from what the tools found.',
    steps: log.steps,
    creditsCharged,
    monthlyUsage,
    citations: [...citations],
    rounds: MAX_ROUNDS,
  }
}

/**
 * Reveal only the finished answer. Data retrieval stays invisible, while the
 * response still arrives with the smooth live-chat cadence the user expects.
 */
async function revealAnswer(
  text: string,
  onText?: (text: string) => void,
  shouldStop?: () => boolean
): Promise<void> {
  if (!onText || !text) return

  const chunks = text.match(/\S+\s*/g) ?? [text]
  const batchSize = Math.max(1, Math.ceil(chunks.length / 120))
  let visible = ''

  for (let i = 0; i < chunks.length; i += batchSize) {
    if (shouldStop?.()) break
    visible += chunks.slice(i, i + batchSize).join('')
    onText(visible)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 14))
  }

  if (!shouldStop?.()) onText(text)
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

async function runSubagent(params: {
  uid: string
  cache: AgentDataCache
  objective: string
  log: StepLog
}): Promise<SubagentFinding> {
  const { uid, cache, objective, log } = params
  if (!objective.trim()) {
    return { content: JSON.stringify({ error: 'Missing objective' }), creditsCharged: 0, rounds: 0, isError: true }
  }

  const systemPrompt = [
    "You are a StatsKey Intelligence subagent. You were dispatched with ONE narrow investigation objective over the user's recorded data.",
    'Work only through your tools. Be surgical: as few tool calls as possible, then report.',
    'Reply with dense findings: the facts you established, with dates and numbers, plus explicit gaps. No preamble, no advice — the main agent handles the user.',
  ].join('\n')

  const messages: AnthropicMessage[] = [{ role: 'user', content: `Objective: ${objective}` }]
  let credits = 0

  try {
    for (let round = 0; round < SUBAGENT_MAX_ROUNDS; round++) {
      const resp = await anthropicChat({
        messages,
        systemPrompt,
        model: SUBAGENT_MODEL,
        tools: SUBAGENT_TOOLS,
        reasoning_effort: 'low',
        max_output_tokens: 3000,
      })
      credits += resp.creditsCharged ?? 0

      const toolUses = (resp.toolUse ?? []) as AnthropicToolUseBlock[]
      if (toolUses.length === 0 || resp.stopReason !== 'tool_use') {
        return { content: resp.content || '(no findings)', creditsCharged: credits, rounds: round + 1, isError: false }
      }

      messages.push({ role: 'assistant', content: (resp.contentBlocks ?? []) as AnthropicContentBlock[] })
      const resultBlocks: AnthropicContentBlock[] = []
      for (const call of toolUses) {
        const stepId = `${call.id}-sub`
        log.open(stepId, call.name, summarizeToolCall(call.name, call.input ?? {}), true)
        const result = await executeTool(uid, cache, call.name, call.input ?? {})
        log.close(stepId, result.resultMeta, result.isError)
        resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: result.content, is_error: result.isError })
      }
      messages.push({ role: 'user', content: resultBlocks })
    }
    return {
      content: 'Subagent hit its round budget. Partial findings may exist in its tool activity.',
      creditsCharged: credits,
      rounds: SUBAGENT_MAX_ROUNDS,
      isError: false,
    }
  } catch (e) {
    return {
      content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      creditsCharged: credits,
      rounds: 0,
      isError: true,
    }
  }
}
