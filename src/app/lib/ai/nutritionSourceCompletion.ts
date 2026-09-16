import type { FoodItem } from '../types'
import { copyNutritionMetadata } from '../nutritionMetadata'

type Row = Record<string, unknown>
const record = (value: unknown): Row => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const numericMap = (value: unknown): Record<string, number> => Object.fromEntries(Object.entries(record(value))
  .filter((row): row is [string, number] => typeof row[1] === 'number' && Number.isFinite(row[1]) && row[1] >= 0))
const stringMap = (value: unknown): Record<string, string> => Object.fromEntries(Object.entries(record(value))
  .filter((row): row is [string, string] => typeof row[1] === 'string'))
const units: Record<string, number> = { ml: 1, l: 1000, cup: 236.5882365, tbsp: 14.78676478125, tsp: 4.92892159375, 'fl oz': 29.5735295625 }
export function canonicalServingUnit(value: string): string {
  const unit = value.toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ')
  return /^(?:fl ?oz|fluid ounces?)$/.test(unit) ? 'fl oz' : unit
}
export function sourceNutritionRequest(item: FoodItem): { food: Row } {
  const unit = canonicalServingUnit(item.servingUnit)
  const label = record(item.printedLabel)
  const ingredients = typeof item.enrichmentIngredients === 'string' ? item.enrichmentIngredients : undefined
  const food: Row = {
    name: item.name, ...(item.brand ? { brand: item.brand } : {}), ...(item.barcode ? { barcode: item.barcode } : {}),
    searchName: [item.brand, item.name].filter(Boolean).join(' '), source: item.source,
    serving: `${item.servingSize} ${unit}`, servingSize: item.servingSize, servingUnit: unit,
    baseServingSize: item.baseServingSize ?? item.servingSize, baseServingUnit: item.baseServingUnit ?? unit,
    quantityWasExplicit: item.quantityWasUserAdjusted === true || item.source === 'manual',
    quantityWasUserAdjusted: item.quantityWasUserAdjusted === true, sourceServingContractVersion: 1,
    ...(item.quantityBasis != null ? { quantityBasis: item.quantityBasis } : {}),
    ...(item.source === 'aiSearch' && item.quantityBasis === 'model_default' ? { sourceDefaultHouseholdVersion: 1 } : {}),
    ...(units[unit] ? { servingVolumeMl: item.servingSize * units[unit] } : {}),
    ...(item.gramWeight != null ? { gramWeight: item.gramWeight } : {}),
    ...(ingredients ? { ingredients } : {}),
    ...(typeof item.preparation === 'string' ? { preparation: item.preparation } : {}),
    ...(Array.isArray(item.visibleProductClaims) ? { productClaims: item.visibleProductClaims } : {}),
    ...(Object.keys(label).length ? { labelNutrition: label } : {}),
  }
  return { food }
}

/** Server amounts already describe this request. Never scale them a second time. */
export function applySourceNutrition(item: FoodItem, response: unknown): FoodItem {
  const result = record(response)
  const sourceDescription = `${result.resolvedName ?? ''} ${record(result.commodityReferenceBasis).description ?? ''}`
  if (item.preparation === 'raw' && /\b(?:canned|pasteurized|pasteurised|concentrate)\b/i.test(
      sourceDescription.replace(/\b(?:non[-\s]?pasteuri[sz]ed|unpasteuri[sz]ed)\b/gi, 'raw'))) {
    return { ...item, nutritionSourceCompletion: 'unavailable' }
  }
  if (result.wrongProductSuspect === true || result.verificationOutcome === 'source_conflict') return { ...item, nutritionSourceCompletion: 'unavailable' }
  if (result.sourceSelectedDefaultServing === true) {
    const selected = validatedSourceDefault(item, result)
    if (!selected) return { ...item, nutritionSourceCompletion: 'unavailable' }
    item = { ...item, servingSize: selected.size, servingUnit: selected.unit, gramWeight: selected.grams,
      baseServingSize: selected.size, baseServingUnit: selected.unit,
      quantityBasis: 'source_serving', sourceServingReceipt: selected.receipt }
  }
  if (typeof result.servingSize === 'number' && typeof result.servingUnit === 'string' &&
      (canonicalServingUnit(result.servingUnit) !== canonicalServingUnit(item.servingUnit) ||
       Math.abs(result.servingSize - item.servingSize) > 1e-8)) {
    return { ...item, nutritionSourceCompletion: 'unavailable' }
  }
  const target = record(record(result.commodityReferenceBasis).targetServing)
  if (Object.keys(target).length && (target.size !== item.servingSize ||
      canonicalServingUnit(String(target.unit)) !== canonicalServingUnit(item.servingUnit))) {
    return { ...item, nutritionSourceCompletion: 'unavailable' }
  }
  const sources = stringMap(result.nutrientSources)
  const acceptedSources = new Set(['usda', 'usda_branded', 'usda_analog', 'web', 'product_claim', 'web_micro', 'web_per100', 'ingredient_estimate', 'ai_grounded'])
  const values = numericMap(result.nutrients)
  if (Array.isArray(result.explicitZeroNutrientKeys)) for (const key of result.explicitZeroNutrientKeys) {
    if (typeof key === 'string' && !Object.hasOwn(values, key)) values[key] = 0
  }
  const accepted = Object.fromEntries(Object.entries(values).filter(([key]) => acceptedSources.has(sources[key])))
  if (!Object.keys(accepted).length) return { ...item, nutritionSourceCompletion: 'unavailable' }
  // Original observed/manual facts (including zero) remain occupied. Fresh
  // recognition carries no unsupported model nutrition into this merger.
  const nutrients = { ...accepted, ...item.nutrients }
  const held = new Set(Object.keys(item.nutrients))
  const fill = { ...Object.fromEntries(Object.entries(sources).filter(([key]) => !held.has(key) && Object.hasOwn(accepted, key))), ...item.nutrientFillSources }
  const map = (incoming: unknown, previous: unknown) => ({ ...Object.fromEntries(Object.entries(record(incoming))
    .filter(([key]) => !held.has(key) && Object.hasOwn(accepted, key))), ...record(previous) })
  const estimatedSources = new Set(['usda_analog', 'web_micro', 'web_per100', 'ingredient_estimate', 'ai_grounded'])
  const estimated = [...new Set([...(item.aiEstimatedNutrientKeys ?? []), ...Object.keys(accepted)
    .filter(key => !held.has(key) && estimatedSources.has(sources[key]))])]
  const hasCompatibleBase = item.baseNutrients && item.baseServingSize != null && item.baseServingSize > 0 &&
    canonicalServingUnit(item.baseServingUnit ?? '') === canonicalServingUnit(item.servingUnit)
  const factor = hasCompatibleBase ? item.baseServingSize! / item.servingSize : 1
  const baseNutrients = { ...Object.fromEntries(Object.entries(accepted).filter(([key]) => !held.has(key))
    .map(([key, value]) => [key, value * factor])), ...(hasCompatibleBase ? item.baseNutrients : item.nutrients) }
  return { ...copyNutritionMetadata(result), ...item,
    nutrients, baseNutrients,
    baseServingSize: hasCompatibleBase ? item.baseServingSize : item.servingSize,
    baseServingUnit: hasCompatibleBase ? item.baseServingUnit : item.servingUnit,
    nutrientFillSources: fill, aiEstimatedNutrientKeys: estimated,
    nutrientErrPct: map(result.nutrientErr, item.nutrientErrPct) as Record<string, number>,
    nutrientCitations: map(result.nutrientCitations, item.nutrientCitations),
    nutrientProvenance: map(result.nutrientProvenance, item.nutrientProvenance),
    nutrientRanges: map(result.nutrientRanges, item.nutrientRanges),
    nutrientBasis: map(result.nutrientBasis, item.nutrientBasis),
    nutrientDefinitionEvidence: map(result.nutrientDefinitionEvidence, item.nutrientDefinitionEvidence),
    nutrientUnknownReason: Object.fromEntries(Object.entries({ ...record(result.nutrientUnknownReason), ...record(item.nutrientUnknownReason) })
      .filter(([key]) => !Object.hasOwn(nutrients, key))),
    explicitZeroNutrientKeys: Object.keys(nutrients).filter(key => nutrients[key] === 0),
    enrichmentMethod: typeof result.method === 'string' ? result.method : item.enrichmentMethod,
    enrichmentCitation: typeof result.citation === 'string' ? result.citation : item.enrichmentCitation,
    enrichmentFdcId: result.fdcId ?? item.enrichmentFdcId,
    enrichmentIngredients: item.enrichmentIngredients ?? result.ingredients,
    nutritionSourceCompletion: result.partial === true || result.sourceProcessingVersion !== 1 || result.sourceProcessingStatus !== 'processed' ? 'partial' : 'processed',
  }
}

/** Negotiate only an unchanged unresolved typed default, never a photographed or user amount. */
function validatedSourceDefault(item: FoodItem, result: Row): {size:number;unit:string;grams:number;receipt:Row} | undefined {
  if (!['aiSearch', 'barcode'].includes(item.source) || item.quantityBasis !== 'model_default' ||
      item.quantityWasUserAdjusted || item.gramWeight != null || item.printedLabel || item.photoPackageQuantityContext ||
      Object.keys(item.nutrients).length || item.servingSize !== 1 || !/^servings?$/.test(item.servingUnit) ||
      result.basisChecked !== true || result.matchType !== 'exact' || result.labelVerification !== 'source_page' ||
      result.sourceServingReadVersion !== 2) return
  const size = result.selectedServingSize, unit = result.selectedServingUnit, grams = result.resolvedServingGramWeight
  if (typeof size !== 'number' || !(size > 0) || !Number.isFinite(size) || typeof grams !== 'number' || !(grams > 0) || !Number.isFinite(grams) ||
      grams !== result.sourceServingGramWeight || size !== result.sourceHouseholdServingCount ||
      typeof unit !== 'string' || canonicalServingUnit(unit) !== canonicalServingUnit(String(result.sourceHouseholdServingUnit))) return
  if (!/^(?:slice|strip|piece|link|patty|bar|cookie|cracker|wafer|packet|pouch|cup|tbsp|tsp)$/.test(canonicalServingUnit(unit))) return
  try { const url = new URL(String(result.citation)); if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.hostname.endsWith('.local') || url.username || url.password) return } catch { return }
  // A literal published relation is required; its mass cannot come from an unrelated reference tuple.
  const literal = typeof result.referenceServingText === 'string' ? result.referenceServingText.match(/^\s*(?:serving size:?\s*)?(\d+(?:\.\d+)?)\s+([a-z]+)s?\s*(?:\(\s*(\d+(?:\.\d+)?)\s*g\s*\)|=\s*(\d+(?:\.\d+)?)\s*g)\s*$/i) : null
  if (!literal || Number(literal[1]) !== size || Number(literal[3] ?? literal[4]) !== grams ||
      literal[2].replace(/s$/, '').toLowerCase() !== canonicalServingUnit(unit).replace(/s$/, '')) return
  const nutrition=numericMap(result.nutrients), zeros=Array.isArray(result.explicitZeroNutrientKeys)?result.explicitZeroNutrientKeys:[]
  if (!['calories','protein','carbohydrates','total_fat'].every(key=>Object.hasOwn(nutrition,key)||zeros.includes(key))) return
  return {size,unit:canonicalServingUnit(unit),grams,receipt:{version:1,citation:result.citation,referenceServingText:result.referenceServingText,size,unit,grams}}
}
