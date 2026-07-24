// Meal-level nutrition aggregation — TypeScript mirror of Meal.allNutrients /
// Meal.totalNutrient and the explicit product-claim suppression layer in
// biometrics/StatsKey/Models/FoodItem.swift. This is what the nutrition facts
// label reads, so web values match the iOS label exactly:
//
// - `totalNutrientsOverride` wins when present (friend copies / hidden items).
// - StatsKey estimates contradicted by an explicit product claim (for example
//   a lactose estimate on a "lactose free" product) are subtracted back out.
// - Intrinsic water is derived from the physical serving when sources omit it.

import type { FoodItem, Meal } from './types'
import { currentGramWeight } from './serving'

// MARK: - Explicit product-claim constraints (FoodItem.swift mirror)

const LACTOSE_FREE_SEQUENCES: string[][] = [
  ['lactose', 'free'],
  ['no', 'lactose'],
  ['zero', 'lactose'],
  ['without', 'lactose'],
  ['sin', 'lactosa'],
  ['sem', 'lactose'],
  ['sans', 'lactose'],
  ['senza', 'lattosio'],
  ['lactosefree'],
  ['laktosefrei'],
  ['lactosevrij'],
]

const CLAIM_NEGATION_WORDS = new Set(['not', 'isnt', 'never'])

const LOCALIZED_LACTOSE_FREE_CLAIMS = ['乳糖不使用', 'ラクトースフリー', 'लैक्टोज मुक्त', 'लैक्टोज़ मुक्त']

/** Fill sources that are StatsKey estimates (vs. measured/declared facts). */
const ESTIMATED_FILL_SOURCES = new Set([
  'usda_analog',
  'ingredient_estimate',
  'web_micro',
  'web_per100',
  'ai_grounded',
])

function normalizedClaimTokens(raw: string | undefined): string[] {
  return (raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function containsUnnegatedSequence(sequence: string[], tokens: string[]): boolean {
  if (tokens.length < sequence.length) return false
  for (let index = 0; index <= tokens.length - sequence.length; index++) {
    let matches = true
    for (let j = 0; j < sequence.length; j++) {
      if (tokens[index + j] !== sequence[j]) {
        matches = false
        break
      }
    }
    if (!matches) continue
    const priorStart = Math.max(0, index - 4)
    const prior = tokens.slice(priorStart, index)
    if (!prior.some((t) => CLAIM_NEGATION_WORDS.has(t))) return true
  }
  return false
}

function explicitLactoseFreeClaimEvidence(item: FoodItem): string | undefined {
  const text = item.name.trim()
  if (!text) return undefined
  const tokens = normalizedClaimTokens(text)
  const latinClaim = LACTOSE_FREE_SEQUENCES.some((seq) => containsUnnegatedSequence(seq, tokens))
  const lowered = text.toLowerCase()
  const localizedClaim = LOCALIZED_LACTOSE_FREE_CLAIMS.some((claim) => lowered.includes(claim))
  return latinClaim || localizedClaim ? text : undefined
}

/** Nutrients an explicit product identity declares absent. */
export function declaredZeroNutrientKeys(item: FoodItem): Set<string> {
  return explicitLactoseFreeClaimEvidence(item) == null ? new Set() : new Set(['lactose'])
}

/** Keys for which an estimated value would contradict product identity. */
export function blockedEstimatedNutrientKeys(item: FoodItem): Set<string> {
  const keys = declaredZeroNutrientKeys(item)
  const hasLactaidIdentity = [item.name, item.brand]
    .filter((s): s is string => !!s)
    .some((s) => normalizedClaimTokens(s).includes('lactaid'))
  if (hasLactaidIdentity) keys.add('lactose')
  return keys
}

function shouldBlockIncomingEstimate(item: FoodItem, key: string, source: string | undefined): boolean {
  if (!blockedEstimatedNutrientKeys(item).has(key)) return false
  if (source == null) return true
  return ESTIMATED_FILL_SOURCES.has(source)
}

/**
 * Only StatsKey-filled values may be suppressed. A vendor value or a value the
 * user entered remains untouched, even when it conflicts with a claim.
 */
export function shouldSuppressEstimatedNutrient(item: FoodItem, key: string): boolean {
  if (!blockedEstimatedNutrientKeys(item).has(key)) return false
  const source = item.nutrientFillSources?.[key]
  if (source != null) return shouldBlockIncomingEstimate(item, key, source)
  return (item.aiEstimatedNutrientKeys ?? []).includes(key)
}

export function effectiveNutrientValue(item: FoodItem, key: string): number {
  return shouldSuppressEstimatedNutrient(item, key) ? 0 : (item.nutrients[key] ?? 0)
}

/** Positive persisted estimates hidden by a stronger product claim. */
export function suppressedEstimatedNutrients(item: FoodItem): Record<string, number> {
  const result: Record<string, number> = {}
  for (const key of blockedEstimatedNutrientKeys(item)) {
    if (!shouldSuppressEstimatedNutrient(item, key)) continue
    const value = item.nutrients[key]
    if (value != null && Number.isFinite(value) && value > 0) result[key] = value
  }
  return result
}

// MARK: - Intrinsic water (FoodItem.effectiveWaterMilliliters mirror)

const MILLILITERS_PER_VOLUME_UNIT: Record<string, number> = {
  ml: 1,
  'fl oz': 29.5735,
  cup: 236.588,
  tbsp: 14.7868,
  tsp: 4.92892,
}

/**
 * Total intrinsic water in the recorded portion. Prefers a sourced water
 * value capped by the item's physical mass; when labels omit water, derives a
 * conservative mass balance from the serving minus protein, carbohydrate,
 * fat, alcohol, and ash.
 */
export function effectiveWaterMilliliters(item: FoodItem): number {
  let servingMass: number | undefined
  const grams = currentGramWeight(item)
  if (grams != null && Number.isFinite(grams) && grams > 0) {
    servingMass = grams
  } else {
    const perUnit = MILLILITERS_PER_VOLUME_UNIT[item.servingUnit.toLowerCase()]
    servingMass = perUnit != null ? item.servingSize * perUnit : undefined
  }

  const explicit = item.nutrients['water']
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    if (servingMass == null || servingMass <= 0) return explicit
    return Math.min(explicit, servingMass)
  }

  if (servingMass == null || servingMass <= 0) return 0
  const mass = (key: string) => Math.max(0, item.nutrients[key] ?? 0)
  const dryMass = mass('protein') + mass('carbohydrates') + mass('total_fat') + mass('alcohol') + mass('ash')
  return Math.min(Math.max(servingMass - dryMass, 0), servingMass)
}

// MARK: - Meal aggregation (Meal.swift mirror)

export function mealTotalWaterMilliliters(meal: Meal): number {
  const override = meal.totalNutrientsOverride?.['water']
  if (override != null && Number.isFinite(override)) return Math.max(0, override)
  const scale = Number.isFinite(meal.multiplier) ? meal.multiplier : 1
  return meal.items.reduce((sum, item) => sum + effectiveWaterMilliliters(item), 0) * scale
}

function suppressedMealNutrientTotals(meal: Meal): Record<string, number> {
  const scale = Number.isFinite(meal.multiplier) ? Math.max(0, meal.multiplier) : 1
  const totals: Record<string, number> = {}
  for (const item of meal.items) {
    for (const [key, value] of Object.entries(suppressedEstimatedNutrients(item))) {
      totals[key] = (totals[key] ?? 0) + value * scale
    }
  }
  return totals
}

/**
 * Every nutrient total for a meal, mirroring Meal.allNutrients: the override
 * wins when present; otherwise items are summed and scaled by the multiplier
 * with intrinsic water derived; suppressed estimates are subtracted last.
 */
export function mealAllNutrients(meal: Meal): Record<string, number> {
  let totals: Record<string, number>
  if (meal.totalNutrientsOverride) {
    totals = { ...meal.totalNutrientsOverride }
  } else {
    totals = {}
    const scale = Number.isFinite(meal.multiplier) ? meal.multiplier : 1
    for (const item of meal.items) {
      for (const [key, value] of Object.entries(item.nutrients)) {
        const safe = Number.isFinite(value) ? value : 0
        totals[key] = (totals[key] ?? 0) + safe * scale
      }
    }
    totals['water'] = mealTotalWaterMilliliters(meal)
  }
  for (const [key, correction] of Object.entries(suppressedMealNutrientTotals(meal))) {
    if (totals[key] != null) totals[key] = Math.max(0, totals[key] - correction)
  }
  return totals
}

// MARK: - Macro math (NutritionCalculator mirror)

export function macroPercentages(
  protein: number,
  carbs: number,
  fat: number
): { protein: number; carbs: number; fat: number } {
  const totalCal = protein * 4 + carbs * 4 + fat * 9
  if (totalCal <= 0) return { protein: 0, carbs: 0, fat: 0 }
  return {
    protein: ((protein * 4) / totalCal) * 100,
    carbs: ((carbs * 4) / totalCal) * 100,
    fat: ((fat * 9) / totalCal) * 100,
  }
}

export function verifyCalories(protein: number, carbs: number, fat: number, alcohol = 0): number {
  return protein * 4 + carbs * 4 + fat * 9 + alcohol * 7
}
