import { describe, expect, it } from 'vitest'
import { modelMatchesQuery } from './modelCatalog'

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
