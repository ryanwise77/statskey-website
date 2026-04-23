import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'

const functions = getFunctions(firebaseApp, 'us-central1')

export type ClaudeModel = 'claude-sonnet-4-6' | 'claude-opus-4-7'

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AnthropicChatRequest {
  messages: AnthropicMessage[]
  systemPrompt: string
  model?: ClaudeModel
  longContext?: boolean
}

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
}

export interface AnthropicMonthlyUsage {
  tokensUsed: number
  tokenLimit: number
  tier: string
}

export interface AnthropicChatResponse {
  content: string
  usage: AnthropicUsage
  monthlyUsage?: AnthropicMonthlyUsage
}

const call = httpsCallable<AnthropicChatRequest, AnthropicChatResponse>(functions, 'anthropicChat')

export async function anthropicChat(
  req: AnthropicChatRequest
): Promise<AnthropicChatResponse> {
  const { data } = await call(req)
  return data
}
