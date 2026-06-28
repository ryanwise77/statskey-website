// Nutrient trust & provenance — TypeScript mirror of
// biometrics/StatsKey/Models/NutrientProvenance.swift and the derive/clear/
// portion logic in FoodItem.swift. Keeps web-recorded meals carrying the same
// trust metadata the iOS 4.7 app writes, and lets the web read back the
// per-nutrient confidence, sources, and photo-portion uncertainty it produces.

import type {
  FoodItem,
  FoodNutrientEvidence,
  FoodSource,
  FoodTrustLevel,
  FoodTrustMetadata,
} from './types'

// MARK: - Confidence

export type NutrientConfidence = 'unknown' | 'low' | 'medium' | 'high' | 'full'

const CONFIDENCE_RANK: Record<NutrientConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  full: 4,
}

const CONFIDENCE_WEIGHT: Record<NutrientConfidence, number> = {
  full: 1.0,
  high: 0.9,
  medium: 0.6,
  low: 0.35,
  unknown: 0.5,
}

/** Hex colors chosen to read distinctly from the RDI-adequacy palette. */
const CONFIDENCE_COLOR: Record<NutrientConfidence, string> = {
  full: '#30d5c8',
  high: '#6e8eff',
  medium: '#ffce6b',
  low: '#ff6b61',
  unknown: '#8ea3b8',
}

const CONFIDENCE_LABEL: Record<NutrientConfidence, string> = {
  full: 'Authoritative',
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  unknown: 'Unverified',
}

const CONFIDENCE_SHORT: Record<NutrientConfidence, string> = {
  full: 'Authoritative',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unverified',
}

export function confidenceRank(c: NutrientConfidence): number {
  return CONFIDENCE_RANK[c]
}

export function confidenceColor(c: NutrientConfidence): string {
  return CONFIDENCE_COLOR[c]
}

export function confidenceLabel(c: NutrientConfidence): string {
  return CONFIDENCE_LABEL[c]
}

export function confidenceShortLabel(c: NutrientConfidence): string {
  return CONFIDENCE_SHORT[c]
}

/** Bucket a 0...1 rolled-up score into a level for display. */
export function confidenceFromScore(score: number): NutrientConfidence {
  if (score >= 0.95) return 'full'
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  if (score >= 0.4) return 'low'
  return 'unknown'
}

// MARK: - Source

export type NutrientSource =
  | 'usda'
  | 'label'
  | 'webMicro'
  | 'webPer100'
  | 'aiGrounded'
  | 'barcodeDatabase'
  | 'nutritionLabel'
  | 'savedLibrary'
  | 'userEntered'
  | 'aiSearch'
  | 'photoEstimate'
  | 'unknown'

/** Maps the raw `nutrientFillSources` string the cascade/backfill persisted. */
export function sourceFromFillRaw(raw: string): NutrientSource {
  switch (raw) {
    case 'usda':
      return 'usda'
    case 'web':
      return 'label'
    case 'web_micro':
      return 'webMicro'
    case 'web_per100':
      return 'webPer100'
    case 'ai_grounded':
      return 'aiGrounded'
    default:
      return 'aiGrounded'
  }
}

/** Maps the food item's own capture source for values not filled by enrichment. */
export function sourceFromRecorded(source: FoodSource): NutrientSource {
  switch (source) {
    case 'barcode':
      return 'barcodeDatabase'
    case 'labelScan':
      return 'nutritionLabel'
    case 'library':
      return 'savedLibrary'
    case 'manual':
    case 'supplement':
      return 'userEntered'
    case 'aiSearch':
      return 'aiSearch'
    case 'camera':
    case 'photoLibrary':
      return 'photoEstimate'
  }
}

export function sourceConfidence(source: NutrientSource): NutrientConfidence {
  switch (source) {
    case 'usda':
    case 'barcodeDatabase':
    case 'nutritionLabel':
    case 'userEntered':
      return 'full'
    case 'label':
    case 'savedLibrary':
      return 'high'
    case 'webMicro':
    case 'webPer100':
    case 'aiGrounded':
    case 'aiSearch':
    case 'photoEstimate':
      return 'medium'
    case 'unknown':
      return 'unknown'
  }
}

/** Whether StatsKey *estimated* this value (vs. a measured/declared fact). */
export function sourceIsEstimated(source: NutrientSource): boolean {
  switch (source) {
    case 'usda':
    case 'barcodeDatabase':
    case 'nutritionLabel':
    case 'userEntered':
    case 'savedLibrary':
      return false
    default:
      return true
  }
}

export function sourceDisplayName(source: NutrientSource): string {
  switch (source) {
    case 'usda':
      return 'USDA FoodData Central'
    case 'label':
      return 'Product label'
    case 'webMicro':
      return 'Web nutrition source'
    case 'webPer100':
      return 'Web reference (per 100g)'
    case 'aiGrounded':
      return 'AI estimate (grounded)'
    case 'barcodeDatabase':
      return 'Barcode database'
    case 'nutritionLabel':
      return 'Nutrition label'
    case 'savedLibrary':
      return 'Saved food'
    case 'userEntered':
      return 'You entered'
    case 'aiSearch':
      return 'AI search match'
    case 'photoEstimate':
      return 'Photo estimate'
    case 'unknown':
      return 'Source not recorded'
  }
}

function sourceDefaultErrPct(source: NutrientSource): number | undefined {
  switch (source) {
    case 'usda':
      return 0
    case 'label':
      return 7
    case 'webPer100':
      return 8
    case 'webMicro':
      return 12
    default:
      return undefined
  }
}

export interface ResolvedNutrientSource {
  source: NutrientSource
  estErrorPct?: number
  citation?: string
  confidence: NutrientConfidence
  isEstimated: boolean
}

function makeResolved(
  source: NutrientSource,
  estErrorPct?: number,
  citation?: string
): ResolvedNutrientSource {
  return {
    source,
    estErrorPct: estErrorPct ?? sourceDefaultErrPct(source),
    citation,
    confidence: sourceConfidence(source),
    isEstimated: sourceIsEstimated(source),
  }
}

/**
 * Resolved provenance for one nutrient key on this item, preferring the
 * cascade/backfill fill provenance, then the legacy AI-filled marker, then the
 * food's own capture source. Mirrors FoodItem.resolvedNutrientSource(for:).
 */
export function resolvedNutrientSource(item: FoodItem, key: string): ResolvedNutrientSource {
  const raw = item.nutrientFillSources?.[key]
  if (raw != null) {
    return makeResolved(sourceFromFillRaw(raw), item.nutrientErrPct?.[key], item.enrichmentCitation)
  }
  if ((item.aiEstimatedNutrientKeys ?? []).includes(key)) {
    return makeResolved('aiGrounded')
  }
  return makeResolved(sourceFromRecorded(item.source))
}

// MARK: - Portion (amount-eaten) uncertainty

export function portionGramRange(item: FoodItem): { low: number; high: number } | undefined {
  const est = item.portionEstimate
  if (!est) return undefined
  if (est.lowGram != null && est.highGram != null && est.highGram > est.lowGram && est.lowGram > 0) {
    return { low: est.lowGram, high: est.highGram }
  }
  const drafts = (est.draftGrams ?? []).filter((g) => Number.isFinite(g) && g > 0)
  if (drafts.length >= 2) {
    const low = Math.min(...drafts)
    const high = Math.max(...drafts)
    if (high > low) return { low, high }
  }
  return undefined
}

/**
 * Portion (amount-eaten) margin of error as a ± percent — distinct from the
 * per-nutrient source error. Only meaningful for an unconfirmed AI photo
 * estimate. Mirrors FoodItem.portionErrorPct.
 */
export function portionErrorPct(item: FoodItem): number | undefined {
  if (item.quantityWasUserAdjusted) return undefined
  if (item.source !== 'camera' && item.source !== 'photoLibrary') return undefined
  const range = portionGramRange(item)
  if (range && item.gramWeight != null && item.gramWeight > 0) {
    const halfSpan = (range.high - range.low) / 2
    if (halfSpan > 0) return Math.min(80, (halfSpan / item.gramWeight) * 100)
  }
  switch (item.trustMetadata?.quantityConfidence) {
    case 'high':
      return 8
    case 'medium':
      return 18
    case 'low':
      return 30
    default:
      return undefined
  }
}

// MARK: - Per-item trust summary (compact chip)

export interface FoodTrustSummary {
  containsEstimates: boolean
  isFullyAuthoritative: boolean
  confidence: NutrientConfidence
  hasPortionEstimate: boolean
  portionErrorPct?: number
  portionGramRange?: { low: number; high: number }
}

/**
 * Rolls a single item's nutrient sources into one trust signal for a compact
 * chip — value-weighted confidence, whether any value is estimated, and the
 * separate photo-portion uncertainty. Mirrors the spirit of
 * NutrientProvenanceAggregator over one item.
 */
export function foodTrustSummary(item: FoodItem): FoodTrustSummary {
  const portionErr = portionErrorPct(item)
  const portionPenalty = Math.min(0.5, (portionErr ?? 0) / 200)

  let total = 0
  let weighted = 0
  let estimated = false
  let authoritativeTotal = 0

  for (const [key, rawValue] of Object.entries(item.nutrients)) {
    const value = Number.isFinite(rawValue) ? rawValue : 0
    if (value <= 0) continue
    const resolved = resolvedNutrientSource(item, key)
    total += value
    const w = Math.max(0.05, CONFIDENCE_WEIGHT[resolved.confidence] - portionPenalty)
    weighted += value * w
    if (resolved.isEstimated) estimated = true
    if (resolved.confidence === 'full') authoritativeTotal += value
  }

  const safeTotal = total > 0 ? total : 1
  const score = weighted / safeTotal
  const confidence = total > 0 ? confidenceFromScore(score) : 'unknown'
  const containsEstimates = estimated || portionErr != null
  const isFullyAuthoritative = !containsEstimates && authoritativeTotal / safeTotal > 0.999

  return {
    containsEstimates,
    isFullyAuthoritative,
    confidence,
    hasPortionEstimate: portionErr != null,
    portionErrorPct: portionErr,
    portionGramRange: portionGramRange(item),
  }
}

// MARK: - Trust metadata derivation (mirror of FoodTrustMetadata.derived)

const UNKNOWN_TRUST: FoodTrustMetadata = {
  identityEvidence: 'unknown',
  nutrientEvidence: 'unknown',
  quantityEvidence: 'unknown',
  identityConfidence: 'unknown',
  nutrientConfidence: 'unknown',
  quantityConfidence: 'unknown',
  notes: [],
}

function visualQuantityConfidence(explanation: string): FoodTrustLevel {
  if (
    explanation.includes('low confidence') ||
    explanation.includes('uncertain scale') ||
    explanation.includes('no scale reference') ||
    explanation.includes('ambiguous')
  ) {
    return 'low'
  }
  if (explanation.includes('high confidence') || explanation.includes('confidence: high')) {
    return 'medium'
  }
  return 'low'
}

/**
 * Derives the three-axis trust metadata from an item's capture source and
 * state. Faithful port of FoodTrustMetadata.derived(from:) so the web writes
 * the same metadata the iOS app does on persistence.
 */
export function deriveTrustMetadata(item: FoodItem): FoodTrustMetadata {
  const explanation = item.geminiExplanation?.toLowerCase() ?? ''
  const hasNutrients = Object.keys(item.nutrients).length > 0
  const hasBarcode = !!item.barcode && item.barcode.length > 0
  const adjusted = item.quantityWasUserAdjusted ?? false
  const nutrientEvidenceIfPresent = (present: FoodNutrientEvidence): FoodNutrientEvidence =>
    hasNutrients ? present : 'unknown'

  const m: FoodTrustMetadata = { ...UNKNOWN_TRUST, notes: [] }

  switch (item.source) {
    case 'barcode':
      m.identityEvidence = 'barcodeMatch'
      m.nutrientEvidence = 'barcodeDatabase'
      m.quantityEvidence = adjusted ? 'userAdjusted' : 'databaseServingAssumed'
      m.identityConfidence = hasBarcode ? 'high' : 'medium'
      m.nutrientConfidence = hasNutrients ? 'high' : 'unknown'
      m.quantityConfidence = adjusted ? 'medium' : 'low'
      m.notes.push(
        adjusted
          ? 'User adjusted amount after barcode lookup.'
          : 'Barcode improves product match; consumed amount is still assumed.'
      )
      break
    case 'labelScan':
      m.identityEvidence = 'nutritionLabel'
      m.nutrientEvidence = 'nutritionLabel'
      m.quantityEvidence = adjusted ? 'userAdjusted' : 'labelServingAssumed'
      m.identityConfidence = 'medium'
      m.nutrientConfidence = hasNutrients ? 'high' : 'unknown'
      m.quantityConfidence = adjusted ? 'medium' : 'low'
      m.notes.push(
        adjusted
          ? 'User adjusted amount after label scan.'
          : 'Label improves nutrient facts; consumed amount is still assumed.'
      )
      break
    case 'camera':
    case 'photoLibrary':
      m.identityEvidence = 'visualRecognition'
      m.nutrientEvidence = hasNutrients ? 'groundedSource' : 'visualEstimate'
      m.quantityEvidence = adjusted ? 'userAdjusted' : 'visualEstimate'
      m.identityConfidence =
        explanation.includes('uncertain') || explanation.includes('ambiguous') ? 'low' : 'medium'
      m.nutrientConfidence = hasNutrients ? 'medium' : 'low'
      m.quantityConfidence = adjusted ? 'medium' : visualQuantityConfidence(explanation)
      m.notes.push(
        adjusted
          ? 'User adjusted amount after visual estimate.'
          : 'Portion is visually estimated and should stay conservative.'
      )
      break
    case 'aiSearch':
      m.identityEvidence = 'groundedSearch'
      m.nutrientEvidence = nutrientEvidenceIfPresent('groundedSource')
      m.quantityEvidence = adjusted ? 'userAdjusted' : 'databaseServingAssumed'
      m.identityConfidence = 'medium'
      m.nutrientConfidence = hasNutrients ? 'medium' : 'unknown'
      m.quantityConfidence = adjusted ? 'medium' : 'low'
      m.notes.push(
        adjusted
          ? 'User adjusted amount after search result.'
          : 'Search improves nutrition source; consumed amount is still assumed.'
      )
      break
    case 'library':
      m.identityEvidence = 'savedLibrary'
      m.nutrientEvidence = 'savedLibrary'
      m.quantityEvidence = adjusted ? 'userAdjusted' : 'savedServingReused'
      m.identityConfidence = 'medium'
      m.nutrientConfidence = hasNutrients ? 'medium' : 'unknown'
      m.quantityConfidence = adjusted ? 'medium' : 'low'
      m.notes.push('Saved item reused; consumed amount may differ from the stored serving.')
      break
    case 'manual':
    case 'supplement':
      m.identityEvidence = 'userEntered'
      m.nutrientEvidence = nutrientEvidenceIfPresent('userEntered')
      m.quantityEvidence = 'userEntered'
      m.identityConfidence = 'medium'
      m.nutrientConfidence = hasNutrients ? 'medium' : 'unknown'
      m.quantityConfidence = 'medium'
      m.notes.push('User-entered record; trust depends on entry accuracy.')
      break
  }

  return m
}

// MARK: - Fill provenance maintenance

/** The subset of fields enrichment provenance lives on — shared by `FoodItem`
 *  and the meal-form `Draft`, so the clear helper works on either. */
export type FillProvenanceFields = Pick<
  FoodItem,
  | 'aiEstimatedNutrientKeys'
  | 'nutrientFillSources'
  | 'nutrientFillConfidence'
  | 'nutrientErrPct'
  | 'enrichmentMethod'
  | 'enrichmentCitation'
  | 'enrichmentSchemaVersion'
>

/**
 * Returns a copy of the item with enrichment/backfill provenance removed for
 * the given keys — used when a user hand-corrects a value so the badge and
 * drill-down stop treating those keys as estimated. Mirrors
 * FoodItem.clearFillProvenance(for:).
 */
export function clearFillProvenance<T extends FillProvenanceFields>(
  item: T,
  keys: Iterable<string>
): T {
  const drop = new Set(keys)
  if (drop.size === 0) return item

  const next = { ...item } as T

  if (next.aiEstimatedNutrientKeys) {
    const remaining = next.aiEstimatedNutrientKeys.filter((k) => !drop.has(k))
    next.aiEstimatedNutrientKeys = remaining.length ? remaining : undefined
  }

  next.nutrientFillSources = withoutKeys(next.nutrientFillSources, drop)
  next.nutrientFillConfidence = withoutKeys(next.nutrientFillConfidence, drop)
  next.nutrientErrPct = withoutKeys(next.nutrientErrPct, drop)

  if (next.aiEstimatedNutrientKeys == null) {
    next.enrichmentMethod = undefined
    next.enrichmentCitation = undefined
    next.enrichmentSchemaVersion = undefined
  }

  return next
}

function withoutKeys<T>(
  map: Record<string, T> | undefined,
  drop: Set<string>
): Record<string, T> | undefined {
  if (!map) return undefined
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(map)) {
    if (!drop.has(k)) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}
