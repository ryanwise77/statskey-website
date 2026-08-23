import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'

const functions = getFunctions(firebaseApp, 'us-central1')

/**
 * Claude model IDs are resolved server-side against Anthropic's live catalog:
 * an ID the provider still serves is used exactly; a retired or unknown ID is
 * routed to the newest live model in the same family. The well-known IDs are
 * listed for editor completion, but any `claude-*` ID is accepted.
 */
export type ClaudeModel =
  | 'claude-sonnet-4-6'
  | 'claude-sonnet-5'
  | 'claude-opus-4-7'
  | 'claude-opus-4-8'
  | 'claude-opus-5'
  | 'claude-fable-5'
  | (string & {})

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
  reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
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

/** How the server mapped the requested model onto the live catalog. */
export interface AnthropicModelRouting {
  requested: string | null
  resolved: string
  substituted: boolean
  /** exact · legacy-forward · family-upgrade · family-fallback · provider-retired · default */
  reason: string
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
  /** The model that actually answered (after live-catalog routing). */
  model?: string
  modelRouting?: AnthropicModelRouting
}

/** One entry of the live Claude catalog served by `listModels`. */
export interface ClaudeCatalogModel {
  id: string
  displayName: string
  family: 'fable' | 'mythos' | 'opus' | 'sonnet' | 'haiku' | string
  version: number
  efforts: Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'>
  maxInputTokens: number | null
  maxTokens: number | null
  createdAt: string | null
}

export interface ClaudeCatalog {
  models: ClaudeCatalogModel[]
  defaultModel: string
  fetchedAt: number | null
  source: string
}

// Intelligence turns can run for minutes on the deepest models (adaptive
// thinking + tool rounds). The callable's default 70-second deadline produced
// spurious `deadline-exceeded` errors, so wait as long as the function itself
// may run (540 s).
const ANTHROPIC_CALLABLE_TIMEOUT_MS = 540_000

const call = httpsCallable<AnthropicChatRequest, AnthropicChatResponse>(
  functions,
  'anthropicChat',
  { timeout: ANTHROPIC_CALLABLE_TIMEOUT_MS }
)

const listModelsCall = httpsCallable<{ action: 'listModels' }, ClaudeCatalog>(
  functions,
  'anthropicChat',
  { timeout: 20_000 }
)

export async function anthropicChat(
  req: AnthropicChatRequest
): Promise<AnthropicChatResponse> {
  const { data } = await call(req)
  return data
}

/** Fetches the live Claude catalog (what the provider currently serves). */
export async function listClaudeModels(): Promise<ClaudeCatalog> {
  const { data } = await listModelsCall({ action: 'listModels' })
  return data
}
