import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import { anthropicChat, type AnthropicMessage } from './anthropic'

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
}

export const CHAT_MODELS: ChatModelOption[] = [
  { provider: 'claude', modelId: 'claude-sonnet-4-6', label: 'Sonnet', providerLabel: 'Claude' },
  { provider: 'claude', modelId: 'claude-opus-4-7', label: 'Opus', providerLabel: 'Claude' },
  { provider: 'chatgpt', modelId: 'gpt-5.4', label: 'GPT-5.4', providerLabel: 'ChatGPT' },
  { provider: 'chatgpt', modelId: 'gpt-5.4-mini', label: 'GPT-5.4 mini', providerLabel: 'ChatGPT' },
  { provider: 'grok', modelId: 'grok-4.3', label: 'Grok', providerLabel: 'Grok' },
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
      model: model.modelId as 'claude-sonnet-4-6' | 'claude-opus-4-7',
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
