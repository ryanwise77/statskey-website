import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import { anthropicChat, type AnthropicMessage, type ClaudeModel } from './anthropic'

const functions = getFunctions(firebaseApp, 'us-central1')

// Provider + model catalog mirroring the managed options in the iOS app
// (Views/Flow/ChatView.swift). All three run through the same Cloud Function
// proxies iOS uses, so token metering and tier limits apply identically.

export type ChatProvider = 'claude' | 'chatgpt' | 'grok'

export interface ChatModelOption {
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
}

// Latest managed models, matching the iOS picker exactly
// (biometrics/StatsKey/Models/AIContext.swift + AnthropicService.swift):
// Sonnet 5 / Opus 4.8, GPT-5.6 Terra / Sol, Grok 4.5.
export const CHAT_MODELS: ChatModelOption[] = [
  { provider: 'claude', modelId: 'claude-sonnet-5', label: 'Auto', providerLabel: 'Auto', agentic: true, dotColor: '#8B5CF6' },
  { provider: 'claude', modelId: 'claude-sonnet-5', label: 'Sonnet 5', providerLabel: 'Claude', agentic: true, dotColor: '#D97757' },
  { provider: 'claude', modelId: 'claude-opus-4-8', label: 'Opus 4.8', providerLabel: 'Claude', agentic: true, dotColor: '#D97757' },
  { provider: 'chatgpt', modelId: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', providerLabel: 'ChatGPT', agentic: true, dotColor: '#10A37F' },
  { provider: 'chatgpt', modelId: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', providerLabel: 'ChatGPT', agentic: true, dotColor: '#0F766E' },
  { provider: 'grok', modelId: 'grok-4.5', label: 'Grok 4.5', providerLabel: 'Grok', agentic: true, dotColor: '#f5f5f7' },
]

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

const openAICall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(functions, 'openAIChat')
const grokCall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(functions, 'grokChat')

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
    })
    return { content: resp.content, providerLabel: model.providerLabel }
  }

  const payload = {
    messages: toOpenAIMessages(systemPrompt, turns),
    model: model.modelId,
  }
  const call = model.provider === 'chatgpt' ? openAICall : grokCall
  const { data } = await call(payload)
  const content = contentFromOpenAIStyle(data)
  if (!content) throw new Error('The model returned an empty response. Please try again.')
  return { content, providerLabel: model.providerLabel }
}
