import type {
  AnthropicChatResponse,
  AnthropicContentBlock,
} from './anthropic'

export function isLegacyManagedClaudeEmptyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.trim() === 'Empty response from Claude.'
}

export function isThinkingOnlyMaxTokenResponse(
  response: AnthropicChatResponse
): boolean {
  const blocks = response.contentBlocks
  return (
    response.stopReason === 'max_tokens' &&
    !response.content?.trim() &&
    (response.toolUse?.length ?? 0) === 0 &&
    Array.isArray(blocks) &&
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        block.type === 'thinking' || block.type === 'redacted_thinking'
    )
  )
}

export function managedClaudeExhaustionPrompt(): string {
  return [
    'Your previous response used its entire output budget on signed internal reasoning before producing text or a tool call.',
    'Resume directly from that preserved reasoning and the recorded tool results. Do not repeat completed tools or restart the task.',
    'Take the next smallest concrete action, or return the truthful final handoff if the recorded evidence already completes the objective.',
  ].join('\n')
}

export function appendThinkingContinuation(
  messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }>,
  response: AnthropicChatResponse
): void {
  if (!response.contentBlocks?.length) return
  messages.push({ role: 'assistant', content: response.contentBlocks })
  messages.push({ role: 'user', content: managedClaudeExhaustionPrompt() })
}
