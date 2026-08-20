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
    const maxFast = CHAT_MODELS.find(
      (model) => model.id === 'gpt-5.6-sol-max-fast'
    )
    expect(maxFast).toMatchObject({
      modelId: 'gpt-5.6-sol',
      defaultEffort: 'max',
      effortOptions: ['max'],
      directProvider: 'openai',
      managedAvailable: true,
      serviceTier: 'fast',
      pricing: {
        inputUsdPer1M: 10,
        cachedInputUsdPer1M: 1,
        outputUsdPer1M: 60,
      },
    })
  })

  it('includes the latest Grok and Gemini agent routes at verified rates', () => {
    expect(
      CHAT_MODELS.find((model) => model.id === 'grok-4.6')
    ).toMatchObject({
      modelId: 'grok-4.6',
      defaultEffort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh'],
      pricing: {
        inputUsdPer1M: 2,
        cachedInputUsdPer1M: 0.5,
        outputUsdPer1M: 6,
      },
    })
    expect(
      CHAT_MODELS.find((model) => model.id === 'gemini-3.7-flash')
    ).toMatchObject({
      modelId: 'gemini-3.7-flash',
      directProvider: 'google',
      managedAvailable: false,
      pricing: {
        inputUsdPer1M: 0.75,
        cachedInputUsdPer1M: 0.075,
        outputUsdPer1M: 3.75,
      },
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
