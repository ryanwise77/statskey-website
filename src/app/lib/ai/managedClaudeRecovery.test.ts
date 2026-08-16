import { describe, expect, it } from 'vitest'
import type { AnthropicChatResponse } from './anthropic'
import {
  appendThinkingContinuation,
  isLegacyManagedClaudeEmptyError,
  isThinkingOnlyMaxTokenResponse,
  managedClaudeExhaustionPrompt,
} from './managedClaudeRecovery'

const base = {
  content: '',
  usage: { input_tokens: 10, output_tokens: 5_000 },
} satisfies AnthropicChatResponse

describe('managed Claude empty-response recovery', () => {
  it('recognizes only the canonical legacy provider-empty error', () => {
    expect(isLegacyManagedClaudeEmptyError(new Error('Empty response from Claude.'))).toBe(true)
    expect(isLegacyManagedClaudeEmptyError(new Error('  Empty response from Claude.  '))).toBe(true)
    expect(isLegacyManagedClaudeEmptyError(new Error('Claude error: Empty response from Claude.'))).toBe(false)
    expect(isLegacyManagedClaudeEmptyError(new Error('Monthly Claude limit reached'))).toBe(false)
    expect(isLegacyManagedClaudeEmptyError(new Error('deadline exceeded'))).toBe(false)
    expect(isLegacyManagedClaudeEmptyError(new Error('permission denied'))).toBe(false)
  })

  it('accepts only thinking-only max-token responses', () => {
    expect(isThinkingOnlyMaxTokenResponse({
      ...base,
      stopReason: 'max_tokens',
      contentBlocks: [{ type: 'thinking', thinking: 'private', signature: 'sig' }],
    })).toBe(true)
    expect(isThinkingOnlyMaxTokenResponse({
      ...base,
      stopReason: 'max_tokens',
      contentBlocks: [{ type: 'redacted_thinking', data: 'opaque' }],
    })).toBe(true)
    expect(isThinkingOnlyMaxTokenResponse({ ...base, stopReason: 'end_turn', contentBlocks: [] })).toBe(false)
    expect(isThinkingOnlyMaxTokenResponse({ ...base, stopReason: 'max_tokens', contentBlocks: [] })).toBe(false)
  })

  it('preserves signed blocks byte-for-byte before the continuation prompt', () => {
    const block = { type: 'thinking', thinking: 'private', signature: 'sig' }
    const response = {
      ...base,
      stopReason: 'max_tokens',
      contentBlocks: [block],
    } satisfies AnthropicChatResponse
    const messages: Array<{ role: 'user' | 'assistant'; content: string | typeof response.contentBlocks }> = []
    appendThinkingContinuation(messages, response)
    expect(messages[0]).toEqual({ role: 'assistant', content: [block] })
    expect(messages[1]).toEqual({ role: 'user', content: managedClaudeExhaustionPrompt() })
  })
})
