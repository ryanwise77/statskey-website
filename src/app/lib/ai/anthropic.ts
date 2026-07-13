import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'

const functions = getFunctions(firebaseApp, 'us-central1')

export type ClaudeModel = 'claude-sonnet-4-6' | 'claude-sonnet-5' | 'claude-opus-4-7' | 'claude-opus-4-8'

// Anthropic content blocks — the server passes message content through
// verbatim, so tool_use / tool_result rounds work end-to-end.

export interface AnthropicTextBlock {
  type: 'text'
  text: string
}

export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string; [key: string]: unknown }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

/** JSON-schema tool definition in Anthropic's format. */
export interface AnthropicToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

export interface AnthropicChatRequest {
  messages: AnthropicMessage[]
  systemPrompt: string
  model?: ClaudeModel
  longContext?: boolean
  tools?: AnthropicToolDef[]
  max_output_tokens?: number
  reasoning_effort?: 'low' | 'medium' | 'high'
  /** Pro+ fair-use flag for the Auto route (validated server-side). */
  unlimitedAuto?: boolean
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
  /** Raw Anthropic content array (text + tool_use blocks). */
  contentBlocks?: AnthropicContentBlock[]
  /** Present when the model requested tool calls. */
  toolUse?: AnthropicToolUseBlock[]
  stopReason?: string
  creditsCharged?: number
  citations?: string[]
}

const call = httpsCallable<AnthropicChatRequest, AnthropicChatResponse>(functions, 'anthropicChat')

export async function anthropicChat(
  req: AnthropicChatRequest
): Promise<AnthropicChatResponse> {
  const { data } = await call(req)
  return data
}
