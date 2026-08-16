import { describe, expect, it } from 'vitest'
import { CHAT_MODELS } from './providers'

describe('model catalog', () => {
  it('uses stable unique identities for model variants', () => {
    const ids = CHAT_MODELS.map((model) => model.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes managed and direct ChatGPT Fast routes', () => {
    const fast = CHAT_MODELS.find(
      (model) => model.id === 'gpt-5.6-sol-fast'
    )
    expect(fast).toMatchObject({
      modelId: 'gpt-5.6-sol',
      directProvider: 'openai',
      managedAvailable: true,
      serviceTier: 'fast',
    })
  })

  it('includes Kimi K3 through a user-owned Moonshot key', () => {
    const kimi = CHAT_MODELS.find((model) => model.id === 'kimi-k3')
    expect(kimi).toMatchObject({
      provider: 'kimi',
      modelId: 'kimi-k3',
      directProvider: 'moonshot',
      managedAvailable: false,
      maxContextTokens: 1_000_000,
    })
  })

  it('publishes verified provider pricing for every curated option', () => {
    for (const model of CHAT_MODELS) {
      expect(model.pricing?.inputUsdPer1M).toBeGreaterThan(0)
      expect(model.pricing?.outputUsdPer1M).toBeGreaterThan(0)
      expect(model.pricing?.sourceUrl).toMatch(/^https:\/\//)
    }
  })
})
