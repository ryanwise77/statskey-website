import {
  anthropicChat,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicMonthlyUsage,
  type AnthropicToolUseBlock,
  type ClaudeModel,
} from './anthropic'
import { AGENT_TOOLS, SUBAGENT_TOOLS, AgentDataCache, executeTool } from './tools'

/**
 * The web Intelligence agent loop — the counterpart of the iOS
 * ChatToolRouter round-trip. Claude runs with the StatsKey toolbox; tool
 * calls execute client-side against the user's own Firestore record, and
 * every step is reported live to the UI (and persisted with the message).
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
}

export interface AgentTurnResult {
  content: string
  steps: AgentStep[]
  creditsCharged: number
  monthlyUsage?: AnthropicMonthlyUsage
  rounds: number
}

export interface AgentTurnParams {
  uid: string
  model: ClaudeModel
  systemPrompt: string
  /** Prior conversation turns as plain text. */
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>
  userText: string
  onStep: (steps: AgentStep[]) => void
  /** Optional cooperative stop: checked between rounds. */
  shouldStop?: () => boolean
}

const MAX_ROUNDS = 8
const SUBAGENT_MAX_ROUNDS = 5
const SUBAGENT_MODEL: ClaudeModel = 'claude-sonnet-4-6'

export function summarizeToolCall(name: string, input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (v == null || v === '') continue
    const rendered = typeof v === 'string' ? `"${v.length > 42 ? `${v.slice(0, 39)}…` : v}"` : Array.isArray(v) ? `[${v.length}]` : String(v)
    parts.push(`${k}: ${rendered}`)
  }
  return `${name}(${parts.join(', ')})`
}

export async function runAgentTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const { uid, model, systemPrompt, priorTurns, userText, onStep, shouldStop } = params
  const cache = new AgentDataCache(uid)
  const steps: AgentStep[] = []
  let creditsCharged = 0
  let monthlyUsage: AnthropicMonthlyUsage | undefined

  const emit = () => onStep([...steps])

  const messages: AnthropicMessage[] = [
    ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: userText },
  ]

  // Intermediate rounds often carry short preambles ("Checking your meals…");
  // the user-facing answer is the final round's text. Preambles are kept only
  // as a fallback if the loop ends without a closing text block.
  const preambles: string[] = []

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await anthropicChat({
      messages,
      systemPrompt,
      model,
      tools: AGENT_TOOLS,
      reasoning_effort: 'medium',
    })
    creditsCharged += resp.creditsCharged ?? 0
    if (resp.monthlyUsage) monthlyUsage = resp.monthlyUsage

    const toolUses = (resp.toolUse ?? []) as AnthropicToolUseBlock[]

    if (toolUses.length === 0 || resp.stopReason !== 'tool_use') {
      const content = resp.content?.trim() || preambles.join('\n\n').trim()
      return { content, steps, creditsCharged, monthlyUsage, rounds: round + 1 }
    }

    if (resp.content) preambles.push(resp.content)

    // Echo the assistant's blocks (text + tool_use) back verbatim, then
    // execute each requested tool and answer with tool_result blocks.
    messages.push({ role: 'assistant', content: (resp.contentBlocks ?? []) as AnthropicContentBlock[] })

    const resultBlocks: AnthropicContentBlock[] = []
    for (const call of toolUses) {
      const step: AgentStep = {
        id: call.id,
        name: call.name,
        summary: summarizeToolCall(call.name, call.input ?? {}),
        status: 'running',
      }
      steps.push(step)
      emit()

      if (call.name === 'run_subagent') {
        const objective = typeof call.input?.objective === 'string' ? call.input.objective : ''
        const finding = await runSubagent({
          uid,
          cache,
          objective,
          onSubStep: (subStep) => {
            steps.push(subStep)
            emit()
          },
          markDone: (subStepId, resultMeta, failed) => {
            const s = steps.find((x) => x.id === subStepId)
            if (s) {
              s.status = failed ? 'error' : 'done'
              s.resultMeta = resultMeta
            }
            emit()
          },
        })
        creditsCharged += finding.creditsCharged
        step.status = finding.isError ? 'error' : 'done'
        step.resultMeta = finding.isError ? 'failed' : `${finding.rounds} rounds · findings returned`
        resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: finding.content, is_error: finding.isError })
      } else {
        const result = await executeTool(uid, cache, call.name, call.input ?? {})
        step.status = result.isError ? 'error' : 'done'
        step.resultMeta = result.resultMeta
        resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: result.content, is_error: result.isError })
      }
      emit()
    }

    messages.push({ role: 'user', content: resultBlocks })

    if (shouldStop?.()) {
      return {
        content:
          preambles.join('\n\n').trim() ||
          'Stopped before the answer was finished. The tool activity above shows what was gathered.',
        steps,
        creditsCharged,
        monthlyUsage,
        rounds: round + 1,
      }
    }
  }

  return {
    content:
      preambles.join('\n\n').trim() ||
      'I hit the tool budget for one turn before finishing. Ask me to continue and I will pick up from what the tools found.',
    steps,
    creditsCharged,
    monthlyUsage,
    rounds: MAX_ROUNDS,
  }
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
  onSubStep: (step: AgentStep) => void
  markDone: (stepId: string, resultMeta: string, failed: boolean) => void
}): Promise<SubagentFinding> {
  const { uid, cache, objective, onSubStep, markDone } = params
  if (!objective.trim()) {
    return { content: JSON.stringify({ error: 'Missing objective' }), creditsCharged: 0, rounds: 0, isError: true }
  }

  const systemPrompt = [
    'You are a StatsKey Intelligence subagent. You were dispatched with ONE narrow investigation objective over the user\'s recorded data.',
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
        onSubStep({
          id: stepId,
          name: call.name,
          summary: summarizeToolCall(call.name, call.input ?? {}),
          status: 'running',
          sub: true,
        })
        const result = await executeTool(uid, cache, call.name, call.input ?? {})
        markDone(stepId, result.resultMeta, result.isError)
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
