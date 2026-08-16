export interface ModelProviderPricing {
  inputUsdPer1M: number
  cachedInputUsdPer1M?: number
  outputUsdPer1M: number
  sourceUrl: string
  verifiedAt: string
  note?: string
}

export interface ManagedTokenPack {
  id: '1m' | '5m' | '25m' | '100m'
  credits: number
  priceUsd: number
}

export const MANAGED_CREDIT_COST_USD_PER_1M = 3
export const MODEL_PRICING_VERIFIED_AT = '2026-08-15'

export const MANAGED_TOKEN_PACKS: readonly ManagedTokenPack[] = [
  { id: '1m', credits: 1_000_000, priceUsd: 12.99 },
  { id: '5m', credits: 5_000_000, priceUsd: 59.99 },
  { id: '25m', credits: 25_000_000, priceUsd: 299.99 },
  { id: '100m', credits: 100_000_000, priceUsd: 1_199.99 },
] as const

const ANTHROPIC_PRICING_URL =
  'https://platform.claude.com/docs/en/about-claude/pricing'
const OPENAI_PRICING_URL = 'https://openai.com/api/pricing/'
const GOOGLE_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'
const XAI_PRICING_URL = 'https://docs.x.ai/developers/pricing'
const KIMI_PRICING_URL =
  'https://platform.moonshot.ai/docs/pricing/chat'

export const MODEL_PRICING = {
  'claude-sonnet-5': {
    inputUsdPer1M: 2,
    cachedInputUsdPer1M: 0.2,
    outputUsdPer1M: 10,
    sourceUrl: ANTHROPIC_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
  },
  'claude-opus-5': {
    inputUsdPer1M: 5,
    cachedInputUsdPer1M: 0.5,
    outputUsdPer1M: 25,
    sourceUrl: ANTHROPIC_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
  },
  'claude-fable-5': {
    inputUsdPer1M: 10,
    cachedInputUsdPer1M: 1,
    outputUsdPer1M: 50,
    sourceUrl: ANTHROPIC_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
  },
  'gpt-5.6-terra': {
    inputUsdPer1M: 2,
    cachedInputUsdPer1M: 0.2,
    outputUsdPer1M: 12,
    sourceUrl: OPENAI_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
  },
  'gpt-5.6-sol': {
    inputUsdPer1M: 5,
    cachedInputUsdPer1M: 0.5,
    outputUsdPer1M: 30,
    sourceUrl: OPENAI_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
  },
  'gpt-5.6-sol-fast': {
    inputUsdPer1M: 10,
    cachedInputUsdPer1M: 1,
    outputUsdPer1M: 60,
    sourceUrl: OPENAI_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
    note: 'Fast processing is 2× the standard GPT-5.6 Sol rate.',
  },
  'gemini-3.1-pro-preview': {
    inputUsdPer1M: 2,
    cachedInputUsdPer1M: 0.2,
    outputUsdPer1M: 12,
    sourceUrl: GOOGLE_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
    note: 'Rates shown are for prompts up to 200K tokens.',
  },
  'gemini-3.1-flash-lite': {
    inputUsdPer1M: 0.25,
    cachedInputUsdPer1M: 0.025,
    outputUsdPer1M: 1.5,
    sourceUrl: GOOGLE_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
  },
  'grok-4.6': {
    inputUsdPer1M: 2,
    cachedInputUsdPer1M: 0.5,
    outputUsdPer1M: 6,
    sourceUrl: XAI_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
    note: 'Rates shown are for prompts under 200K tokens.',
  },
  'grok-4.3': {
    inputUsdPer1M: 1.25,
    cachedInputUsdPer1M: 0.2,
    outputUsdPer1M: 2.5,
    sourceUrl: XAI_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
    note: 'Rates shown are for prompts under 200K tokens.',
  },
  'kimi-k3': {
    inputUsdPer1M: 3,
    cachedInputUsdPer1M: 0.3,
    outputUsdPer1M: 15,
    sourceUrl: KIMI_PRICING_URL,
    verifiedAt: MODEL_PRICING_VERIFIED_AT,
  },
} satisfies Record<string, ModelProviderPricing>

export type ModelPricingKey = keyof typeof MODEL_PRICING

export function formatUsdPerMillion(value: number): string {
  return `$${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`
}

export function managedCreditsForProviderCost(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0
  const rawCredits =
    (costUsd / MANAGED_CREDIT_COST_USD_PER_1M) * 1_000_000
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(rawCredits)) * 8
  return Math.ceil(rawCredits - tolerance)
}

export function managedCoverageTokens(costUsdPer1M: number): number {
  if (!Number.isFinite(costUsdPer1M) || costUsdPer1M <= 0) return 0
  return Math.floor(
    (MANAGED_CREDIT_COST_USD_PER_1M / costUsdPer1M) * 1_000_000
  )
}

export function tokenPackUnitPrice(pack: ManagedTokenPack): number {
  return pack.priceUsd / (pack.credits / 1_000_000)
}

export function tokenPackFullRedemptionMargin(
  pack: ManagedTokenPack,
  stripePercent = 0.036,
  stripeFixedUsd = 0.3
): number {
  const netRevenue =
    pack.priceUsd * (1 - Math.max(0, stripePercent)) -
    Math.max(0, stripeFixedUsd)
  const providerCost =
    (pack.credits / 1_000_000) * MANAGED_CREDIT_COST_USD_PER_1M
  if (netRevenue <= 0) return Number.NEGATIVE_INFINITY
  return (netRevenue - providerCost) / netRevenue
}
