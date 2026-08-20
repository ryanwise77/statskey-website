import { describe, expect, it } from 'vitest'
import {
  isLikelyAgenticModelId,
  modelMatchesQuery,
} from './modelCatalog'

const chatGptFast = {
  label: 'GPT-5.6 Sol Fast',
  providerLabel: 'OpenAI',
  modelId: 'gpt-5.6-sol',
  description: 'Priority processing for lower latency.',
  badges: ['Fastest ChatGPT', '2× provider rate'],
}

describe('modelMatchesQuery', () => {
  it('matches useful terms even when they are not adjacent', () => {
    expect(modelMatchesQuery(chatGptFast, 'ChatGPT Fast')).toBe(true)
    expect(modelMatchesQuery(chatGptFast, 'OpenAI priority')).toBe(true)
  })

  it('requires every search term', () => {
    expect(modelMatchesQuery(chatGptFast, 'ChatGPT Kimi')).toBe(false)
  })
})

describe('isLikelyAgenticModelId', () => {
  it('admits future text models returned by known providers', () => {
    expect(isLikelyAgenticModelId('openai', 'gpt-5.7')).toBe(true)
    expect(isLikelyAgenticModelId('anthropic', 'claude-sonnet-6')).toBe(true)
    expect(isLikelyAgenticModelId('google', 'gemini-3.8-flash')).toBe(true)
    expect(isLikelyAgenticModelId('xai', 'grok-4.7')).toBe(true)
  })

  it('keeps non-chat catalog entries out of the selector', () => {
    expect(isLikelyAgenticModelId('openai', 'text-embedding-4-large')).toBe(
      false
    )
    expect(isLikelyAgenticModelId('openai', 'gpt-image-2')).toBe(false)
    expect(isLikelyAgenticModelId('google', 'gemini-embedding-002')).toBe(false)
  })

  it('requires manual model configuration for unknown-compatible providers', () => {
    expect(isLikelyAgenticModelId('openai-compatible', 'vendor-model-v1')).toBe(
      false
    )
    expect(isLikelyAgenticModelId('azure-openai', 'production-deployment')).toBe(
      false
    )
  })
})
