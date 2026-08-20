import { describe, expect, it } from 'vitest'
import {
  MANAGED_TOKEN_PACKS,
  MODEL_PRICING,
  formatUsdPerMillion,
  managedCoverageTokens,
  managedCreditsForProviderCost,
  tokenPackFullRedemptionMargin,
} from './modelEconomics'

describe('model economics', () => {
  it('charges managed credits in proportion to provider cost', () => {
    expect(managedCreditsForProviderCost(3)).toBe(1_000_000)
    expect(managedCreditsForProviderCost(15)).toBe(5_000_000)
    expect(managedCoverageTokens(15)).toBe(200_000)
  })

  it('prices GPT-5.6 Sol Fast at twice the standard processing rate', () => {
    const standard = MODEL_PRICING['gpt-5.6-sol']
    const fast = MODEL_PRICING['gpt-5.6-sol-fast']

    expect(fast.inputUsdPer1M).toBe(standard.inputUsdPer1M * 2)
    expect(fast.cachedInputUsdPer1M).toBe(
      (standard.cachedInputUsdPer1M ?? 0) * 2
    )
    expect(fast.outputUsdPer1M).toBe(standard.outputUsdPer1M * 2)
  })

  it('does not round away sub-cent cached-input rates', () => {
    expect(formatUsdPerMillion(0.075)).toBe('$0.075')
    expect(formatUsdPerMillion(0.5)).toBe('$0.50')
    expect(formatUsdPerMillion(10)).toBe('$10')
  })

  it('keeps every Stripe token pack above a 70% full-redemption margin', () => {
    for (const pack of MANAGED_TOKEN_PACKS) {
      expect(tokenPackFullRedemptionMargin(pack)).toBeGreaterThanOrEqual(0.7)
    }
  })
})
