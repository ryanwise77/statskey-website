import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import { anthropicChat, type AnthropicMessage, type ClaudeModel } from './anthropic'
import type { DesktopProviderId } from '../desktop'
import {
  MODEL_PRICING,
  type ModelProviderPricing,
} from './modelEconomics'

const functions = getFunctions(firebaseApp, 'us-central1')

// Provider + model catalog mirroring the managed options in the iOS app
// (Views/Flow/ChatView.swift). All three run through the same Cloud Function
// proxies iOS uses, so token metering and tier limits apply identically.

export type ChatProvider =
  | 'claude'
  | 'chatgpt'
  | 'grok'
  | 'kimi'
  | 'gemini'
  | 'azure'
  | 'bedrock'
  | 'compatible'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ChatModelOption {
  /** Stable picker identity. Variants can share a provider model ID. */
  id: string
  provider: ChatProvider
  /** Model ID sent to the Cloud Function. */
  modelId: string
  /** Short label for the picker. */
  label: string
  /** Provider display name persisted on messages. */
  providerLabel: string
  /** True when this route runs the full tool-calling agent loop. */
  agentic: boolean
  /** Dot color for the picker, mirroring the iOS provider colors. */
  dotColor: string
  /** Plain-language fit shown in the exact model picker. */
  description: string
  /** Maximum provider context supported by this route. */
  maxContextTokens: number
  /** User-selectable live-context budgets supported by this route. */
  contextOptions: number[]
  /** Reasoning levels accepted by this model route. */
  effortOptions: ReasoningEffort[]
  defaultEffort: ReasoningEffort
  /** Native provider used when the desktop "My key" route is selected. */
  directProvider: DesktopProviderId
  /** Whether StatsKey's optional managed route supports this model. */
  managedAvailable: boolean
  /** Public provider list price, independent of the selected billing route. */
  pricing?: ModelProviderPricing
  /** Optional provider processing tier applied to this route. */
  serviceTier?: 'fast'
  /** Short decision aids shown in the model catalog. */
  badges?: string[]
}

const STANDARD_CONTEXTS = [64_000, 128_000, 272_000, 1_000_000]

// Managed routes exposed by the server. "Auto" remains the safe default, while
// every exact route carries its own effort and context capabilities.
export const CHAT_MODELS: ChatModelOption[] = [
  {
    id: 'auto',
    provider: 'claude',
    modelId: 'claude-sonnet-5',
    label: 'Auto',
    providerLabel: 'Auto',
    agentic: true,
    dotColor: '#8B5CF6',
    description: 'Chooses the practical default for everyday work.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    directProvider: 'anthropic',
    managedAvailable: true,
    pricing: MODEL_PRICING['claude-sonnet-5'],
    badges: ['Recommended'],
  },
  {
    id: 'claude-fable-5',
    provider: 'claude',
    modelId: 'claude-fable-5',
    label: 'Fable 5',
    providerLabel: 'Claude',
    agentic: true,
    dotColor: '#B45309',
    description: 'Hardest long-running work and large workspaces.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    directProvider: 'anthropic',
    managedAvailable: true,
    pricing: MODEL_PRICING['claude-fable-5'],
    badges: ['Deepest work'],
  },
  {
    id: 'claude-sonnet-5',
    provider: 'claude',
    modelId: 'claude-sonnet-5',
    label: 'Sonnet 5',
    providerLabel: 'Claude',
    agentic: true,
    dotColor: '#D97757',
    description: 'Fast, strong daily analysis and implementation.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    directProvider: 'anthropic',
    managedAvailable: true,
    pricing: MODEL_PRICING['claude-sonnet-5'],
    badges: ['Best daily value'],
  },
  {
    id: 'claude-opus-5',
    provider: 'claude',
    modelId: 'claude-opus-5',
    label: 'Opus 5',
    providerLabel: 'Claude',
    agentic: true,
    dotColor: '#C2416C',
    description: 'Complex agent analysis with lower cost than Fable.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    directProvider: 'anthropic',
    managedAvailable: true,
    pricing: MODEL_PRICING['claude-opus-5'],
    badges: ['Complex agents'],
  },
  {
    id: 'gpt-5.6-terra',
    provider: 'chatgpt',
    modelId: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    providerLabel: 'ChatGPT',
    agentic: true,
    dotColor: '#10A37F',
    description: 'Balanced OpenAI route for broad work.',
    maxContextTokens: 1_050_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    directProvider: 'openai',
    managedAvailable: true,
    pricing: MODEL_PRICING['gpt-5.6-terra'],
    badges: ['Balanced'],
  },
  {
    id: 'gpt-5.6-sol',
    provider: 'chatgpt',
    modelId: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    providerLabel: 'ChatGPT',
    agentic: true,
    dotColor: '#0F766E',
    description: 'Highest-capability OpenAI route.',
    maxContextTokens: 1_050_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    directProvider: 'openai',
    managedAvailable: true,
    pricing: MODEL_PRICING['gpt-5.6-sol'],
    badges: ['Maximum capability'],
  },
  {
    id: 'gpt-5.6-sol-fast',
    provider: 'chatgpt',
    modelId: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol Fast',
    providerLabel: 'ChatGPT',
    agentic: true,
    dotColor: '#059669',
    description: 'The same Sol model with priority processing for lower latency.',
    maxContextTokens: 1_050_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    directProvider: 'openai',
    managedAvailable: true,
    pricing: MODEL_PRICING['gpt-5.6-sol-fast'],
    serviceTier: 'fast',
    badges: ['Fastest ChatGPT', '2× provider rate'],
  },
  {
    id: 'gpt-5.6-sol-max-fast',
    provider: 'chatgpt',
    modelId: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol Max Fast',
    providerLabel: 'ChatGPT',
    agentic: true,
    dotColor: '#047857',
    description: 'Maximum Sol reasoning with the lower-latency Fast tier.',
    maxContextTokens: 1_050_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['max'],
    defaultEffort: 'max',
    directProvider: 'openai',
    managedAvailable: true,
    pricing: MODEL_PRICING['gpt-5.6-sol-fast'],
    serviceTier: 'fast',
    badges: ['Max + Fast', '2× provider rate'],
  },
  {
    id: 'kimi-k3',
    provider: 'kimi',
    modelId: 'kimi-k3',
    label: 'Kimi K3',
    providerLabel: 'Kimi',
    agentic: true,
    dotColor: '#5B5BD6',
    description: 'Frontier long-context reasoning from Moonshot.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'high', 'max'],
    defaultEffort: 'high',
    directProvider: 'moonshot',
    managedAvailable: false,
    pricing: MODEL_PRICING['kimi-k3'],
    badges: ['New', '1M context', 'Use your key'],
  },
  {
    id: 'gemini-3.7-flash',
    provider: 'gemini',
    modelId: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    providerLabel: 'Gemini',
    agentic: true,
    dotColor: '#0F9D58',
    description: 'Google’s newest fast agentic route for coding and broad work.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    directProvider: 'google',
    managedAvailable: false,
    pricing: MODEL_PRICING['gemini-3.7-flash'],
    badges: ['New', 'Introductory rate', 'My key'],
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    modelId: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    providerLabel: 'Gemini',
    agentic: true,
    dotColor: '#4285F4',
    description: 'Google’s strongest general reasoning route.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    directProvider: 'google',
    managedAvailable: false,
    pricing: MODEL_PRICING['gemini-3.1-pro-preview'],
    badges: ['My key'],
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    modelId: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash',
    providerLabel: 'Gemini',
    agentic: true,
    dotColor: '#34A853',
    description: 'Fast, economical Google route.',
    maxContextTokens: 1_000_000,
    contextOptions: STANDARD_CONTEXTS,
    effortOptions: ['low', 'medium', 'high'],
    defaultEffort: 'low',
    directProvider: 'google',
    managedAvailable: false,
    pricing: MODEL_PRICING['gemini-3.1-flash-lite'],
    badges: ['Lowest cost', 'My key'],
  },
  {
    id: 'grok-4.6',
    provider: 'grok',
    modelId: 'grok-4.6',
    label: 'Grok 4.6',
    providerLabel: 'Grok',
    agentic: true,
    dotColor: '#1E293B',
    description: 'Newest Grok route for current-information synthesis.',
    maxContextTokens: 500_000,
    contextOptions: [64_000, 128_000, 272_000, 500_000],
    effortOptions: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'high',
    directProvider: 'xai',
    managedAvailable: true,
    pricing: MODEL_PRICING['grok-4.6'],
    badges: ['New', '500K context', 'Current information'],
  },
]

export function formatContextTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  return `${Math.round(tokens / 1000)}K`
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  providerLabel: string
}

interface OpenAIStyleMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenAIStyleResponse {
  choices?: Array<{ message?: { content?: string } }>
  content?: string
}

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

function toOpenAIMessages(systemPrompt: string, turns: ChatTurn[]): OpenAIStyleMessage[] {
  const messages: OpenAIStyleMessage[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  for (const t of turns) messages.push({ role: t.role, content: t.content })
  return messages
}

function contentFromOpenAIStyle(data: OpenAIStyleResponse): string {
  const fromChoices = data.choices?.[0]?.message?.content
  if (typeof fromChoices === 'string' && fromChoices.length > 0) return fromChoices
  if (typeof data.content === 'string') return data.content
  return ''
}

/** Sends one chat turn through the selected managed provider. */
export async function sendChat(params: {
  model: ChatModelOption
  systemPrompt: string
  turns: ChatTurn[]
}): Promise<ChatResult> {
  const { model, systemPrompt, turns } = params

  if (model.provider === 'claude') {
    const messages: AnthropicMessage[] = turns.map((t) => ({ role: t.role, content: t.content }))
    const resp = await anthropicChat({
      messages,
      systemPrompt,
      model: model.modelId as ClaudeModel,
      billingClient: 'statskey-desktop',
    })
    return { content: resp.content, providerLabel: model.providerLabel }
  }

  const payload = {
    messages: toOpenAIMessages(systemPrompt, turns),
    model: model.modelId,
    service_tier: model.serviceTier,
    billingClient: 'statskey-desktop',
  }
  const call =
    model.provider === 'chatgpt'
      ? openAICall
      : model.provider === 'kimi'
        ? kimiCall
        : grokCall
  const { data } = await call(payload)
  const content = contentFromOpenAIStyle(data)
  if (!content) throw new Error('The model returned an empty response. Please try again.')
  return { content, providerLabel: model.providerLabel }
}
