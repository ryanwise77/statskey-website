// Per-nutrient provenance roll-up — TypeScript mirror of
// biometrics/StatsKey/Services/NutrientProvenanceAggregator.swift and the
// NutrientProvenanceBadge in NutrientProvenance.swift. Answers, for every
// nutrient across a meal: who contributed, how trustworthy the total is, and
// where any doubt comes from. Drives the nutrition facts label's per-row
// accuracy markers and the sources-and-confidence drill-down.

import type { Meal } from './types'
import {
  confidenceColor,
  confidenceFromScore,
  confidenceWeight,
  portionErrorPct,
  portionGramRange,
  resolvedNutrientSource,
  type NutrientConfidence,
  type ResolvedNutrientSource,
} from './provenance'
import { declaredZeroNutrientKeys, effectiveNutrientValue, shouldSuppressEstimatedNutrient } from './nutritionFacts'

// MARK: - Results

/** One food's contribution to a nutrient's total. */
export interface NutrientContribution {
  id: string
  name: string
  brand?: string
  totalAmount: number
  occurrences: number
  resolved: ResolvedNutrientSource
  portionErrorPct?: number
  portionLowGram?: number
  portionHighGram?: number
}

export function contributionHasPortionEstimate(c: NutrientContribution): boolean {
  return (c.portionErrorPct ?? 0) > 0
}

/** Source and portion errors combined in quadrature (independent errors). */
export function contributionCombinedErrorPct(c: NutrientContribution): number | undefined {
  const s = c.resolved.estErrorPct ?? 0
  const p = c.portionErrorPct ?? 0
  const combined = Math.sqrt(s * s + p * p)
  return combined > 0 ? combined : undefined
}

export function contributionLowerAmount(c: NutrientContribution): number {
  const error = Math.min(100, contributionCombinedErrorPct(c) ?? 0) / 100
  return Math.max(0, c.totalAmount * (1 - error))
}

export function contributionUpperAmount(c: NutrientContribution): number {
  const error = Math.min(200, contributionCombinedErrorPct(c) ?? 0) / 100
  return c.totalAmount * (1 + error)
}

/** Rolled-up provenance for a single nutrient over a meal. */
export interface NutrientProvenanceSummary {
  key: string
  total: number
  /** Sorted by amount, descending. */
  contributions: NutrientContribution[]
  overallConfidence: NutrientConfidence
  overallScore: number
  estimatedFraction: number
  authoritativeFraction: number
  portionEstimatedFraction: number
  /** Calorie-weighted share of recorded foods that explicitly carry this key. */
  coverageFraction: number
  lowerBound?: number
  upperBound?: number
}

/** Estimated on either axis: the nutrient source, or the photographed amount. */
export function summaryContainsEstimates(s: NutrientProvenanceSummary): boolean {
  return s.estimatedFraction > 0.0001 || s.portionEstimatedFraction > 0.0001
}

/** Fully authoritative — neither the source nor the amount is estimated. */
export function summaryIsFullyAuthoritative(s: NutrientProvenanceSummary): boolean {
  return (
    !summaryContainsEstimates(s) &&
    s.authoritativeFraction > 0.999 &&
    s.coverageFraction > 0.999 &&
    s.contributions.every((c) => (contributionCombinedErrorPct(c) ?? 0) <= 2)
  )
}

/** Contributions that introduce uncertainty, largest first. */
export function summaryDoubtContributions(s: NutrientProvenanceSummary): NutrientContribution[] {
  return s.contributions
    .filter(
      (c) =>
        c.resolved.isEstimated ||
        confidenceRankOf(c.resolved.confidence) <= confidenceRankOf('medium') ||
        contributionHasPortionEstimate(c)
    )
    .sort((a, b) => b.totalAmount - a.totalAmount)
}

function confidenceRankOf(c: NutrientConfidence): number {
  switch (c) {
    case 'unknown':
      return 0
    case 'low':
      return 1
    case 'medium':
      return 2
    case 'high':
      return 3
    case 'full':
      return 4
  }
}

// MARK: - Badge (NutrientProvenanceBadge mirror)

export type BadgeIconKind = 'coverage' | 'sparkles' | 'sealCheck' | 'checkCircle' | 'questionCircle'

export interface ProvenanceBadge {
  confidence: NutrientConfidence
  containsEstimates: boolean
  coverageFraction: number
  /** Only hide the neutral high-confidence middle. */
  showsIndicator: boolean
  icon: BadgeIconKind
  color: string
  accessibilityText: string
}

function confidenceIconKind(c: NutrientConfidence): BadgeIconKind {
  switch (c) {
    case 'full':
      return 'sealCheck'
    case 'high':
      return 'checkCircle'
    case 'medium':
      return 'sparkles'
    case 'low':
    case 'unknown':
      return 'questionCircle'
  }
}

const COVERAGE_TINT = '#8ea3b8'

export function summaryBadge(s: NutrientProvenanceSummary): ProvenanceBadge {
  const containsEstimates = summaryContainsEstimates(s)
  const lowCoverage = s.coverageFraction < 0.8
  const accessibilityText = lowCoverage
    ? `Incomplete food coverage, ${Math.round(s.coverageFraction * 100)} percent`
    : containsEstimates
      ? 'Includes estimated values'
      : 'From recorded sources'
  return {
    confidence: s.overallConfidence,
    containsEstimates,
    coverageFraction: s.coverageFraction,
    showsIndicator: lowCoverage || containsEstimates || s.overallConfidence !== 'high',
    icon: lowCoverage ? 'coverage' : containsEstimates ? 'sparkles' : confidenceIconKind(s.overallConfidence),
    color: lowCoverage ? COVERAGE_TINT : confidenceColor(s.overallConfidence),
    accessibilityText,
  }
}

// MARK: - Aggregator

interface FoodAgg {
  name: string
  brand?: string
  total: number
  occurrences: number
  dominantAmount: number
  dominantResolved: ResolvedNutrientSource
  dominantPortionErr?: number
  dominantPortionLow?: number
  dominantPortionHigh?: number
}

/** Compute provenance summaries for every nutrient present across `meals`. */
export function allProvenanceSummaries(meals: Meal[]): Record<string, NutrientProvenanceSummary> {
  const builders = new Map<string, { total: number; foods: Map<string, FoodAgg> }>()
  let totalCoverageWeight = 0
  const coverageWeightByKey = new Map<string, number>()

  for (const meal of meals) {
    const scale = Number.isFinite(meal.multiplier) ? meal.multiplier : 1
    for (const item of meal.items) {
      const calories = Math.max(1, item.nutrients['calories'] ?? 0)
      const coverageWeight = calories * Math.max(0, scale)
      totalCoverageWeight += coverageWeight
      for (const key of Object.keys(item.nutrients)) {
        if (shouldSuppressEstimatedNutrient(item, key) && !declaredZeroNutrientKeys(item).has(key)) {
          continue
        }
        coverageWeightByKey.set(key, (coverageWeightByKey.get(key) ?? 0) + coverageWeight)
      }
      for (const [key, rawValue] of Object.entries(item.nutrients)) {
        const effective = effectiveNutrientValue(item, key)
        const value = Number.isFinite(rawValue) && Number.isFinite(effective) ? effective : 0
        if (value <= 0) continue
        const amount = value * scale
        const resolved = resolvedNutrientSource(item, key)
        const foodId = `${item.name.toLowerCase().trim()}|${(item.brand ?? '').toLowerCase().trim()}`

        let builder = builders.get(key)
        if (!builder) {
          builder = { total: 0, foods: new Map() }
          builders.set(key, builder)
        }
        builder.total += amount
        let food = builder.foods.get(foodId)
        if (!food) {
          food = {
            name: item.name,
            brand: item.brand,
            total: 0,
            occurrences: 0,
            dominantAmount: -1,
            dominantResolved: resolved,
          }
          builder.foods.set(foodId, food)
        }
        food.total += amount
        food.occurrences += 1
        if (amount >= food.dominantAmount) {
          food.dominantAmount = amount
          food.dominantResolved = resolved
          const portionErr = portionErrorPct(item)
          food.dominantPortionErr = portionErr
          const range = portionErr != null ? portionGramRange(item) : undefined
          food.dominantPortionLow = range?.low
          food.dominantPortionHigh = range?.high
        }
      }
    }
  }

  const result: Record<string, NutrientProvenanceSummary> = {}
  for (const [key, builder] of builders) {
    const coverage =
      totalCoverageWeight > 0 ? Math.min(1, (coverageWeightByKey.get(key) ?? 0) / totalCoverageWeight) : 0
    result[key] = finalize(key, builder.total, builder.foods, coverage)
  }
  return result
}

function finalize(
  key: string,
  total: number,
  foods: Map<string, FoodAgg>,
  coverageFraction: number
): NutrientProvenanceSummary {
  const contributions: NutrientContribution[] = [...foods.entries()]
    .map(([id, food]) => ({
      id,
      name: food.name,
      brand: food.brand,
      totalAmount: food.total,
      occurrences: food.occurrences,
      resolved: food.dominantResolved,
      portionErrorPct: food.dominantPortionErr,
      portionLowGram: food.dominantPortionLow,
      portionHighGram: food.dominantPortionHigh,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)

  const safeTotal = total > 0 ? total : 1
  // Confidence weight is the source confidence, lightly penalized when the
  // amount eaten is an uncertain photo-portion estimate.
  const weighted = contributions.reduce((acc, c) => {
    const sourcePenalty = Math.min(0.5, (c.resolved.estErrorPct ?? 0) / 100)
    const portionPenalty = Math.min(0.5, (c.portionErrorPct ?? 0) / 200)
    const w = Math.max(0.05, confidenceWeight(c.resolved.confidence) - sourcePenalty - portionPenalty)
    return acc + c.totalAmount * w
  }, 0)
  const estimated = contributions.reduce((acc, c) => acc + (c.resolved.isEstimated ? c.totalAmount : 0), 0)
  const authoritative = contributions.reduce(
    (acc, c) => acc + (c.resolved.confidence === 'full' ? c.totalAmount : 0),
    0
  )
  const portionEstimated = contributions.reduce(
    (acc, c) => acc + (contributionHasPortionEstimate(c) ? c.totalAmount : 0),
    0
  )
  const score = weighted / safeTotal

  return {
    key,
    total,
    contributions,
    overallConfidence: confidenceFromScore(score),
    overallScore: score,
    estimatedFraction: estimated / safeTotal,
    authoritativeFraction: authoritative / safeTotal,
    portionEstimatedFraction: portionEstimated / safeTotal,
    coverageFraction,
    lowerBound: contributions.reduce((acc, c) => acc + contributionLowerAmount(c), 0),
    upperBound: contributions.reduce((acc, c) => acc + contributionUpperAmount(c), 0),
  }
}
