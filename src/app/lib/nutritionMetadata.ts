/** Native nutrition evidence must survive web review, editing and persistence. */
export const NUTRITION_METADATA_KEYS = [
  'nutritionSourceCompletion', 'nutritionSnapshotLocked', 'nutritionSnapshotCalculation',
  'nutritionEvidence', 'defaultNutrientEvidenceID', 'nutritionSearchTrace', 'nutrientEvidenceIDs', 'quantityEvidenceID', 'nutrientProvenance',
  'nutrientCitations', 'nutrientDefinitionEvidence', 'nutrientRanges', 'nutrientBasis', 'nutrientUnknownReason',
  'explicitZeroNutrientKeys', 'printedLabel', 'photoPackageQuantityContext', 'photoPackageObservations',
  'quantityBasis', 'systemQuantityBasis', 'sourceServingContractVersion', 'densitySource',
  'enrichmentIngredients', 'enrichmentFdcId', 'enrichmentAttempts', 'enrichmentAttemptedAt',
  'ingredientLists', 'ingredientTokens', 'ingredientListSource', 'ingredientDrift',
  'ingredientSchemaVersion', 'allergenTags', 'wrongProductSuspect', 'sourceLabelBasisUnresolved',
  'commodityReferenceBasis', 'sourceLabelMassCalculation', 'genericPortionBasis',
  'householdUnitGramWeights', 'nutritionSourcePending', 'nutritionLookupCountryCode',
  'nutrientConstraintInvalidation', 'sourceProfileInvalidation', 'nutrientFillJobIds',
  'repairJobId', 'packageServingUnresolved', 'sourceServingReceipt', 'visibleProductClaims', 'preparation', 'usdaWaterConversion', 'usdaAnalogPortion',
] as const
export type NutritionMetadata = Partial<Record<typeof NUTRITION_METADATA_KEYS[number], unknown>>
export function copyNutritionMetadata(value: object): NutritionMetadata {
  const source = value as Record<string, unknown>
  return Object.fromEntries(NUTRITION_METADATA_KEYS.filter(key => source[key] !== undefined)
    .map(key => [key, source[key]]))
}

/** Ranges describe the current amount; historical source evidence stays on its original basis. */
export function rescaleCurrentNutritionMetadata(item: NutritionMetadata, factor: number): NutritionMetadata {
  if (!Number.isFinite(factor) || factor < 0 || !item.nutrientRanges || typeof item.nutrientRanges !== 'object') return {}
  return { nutrientRanges: Object.fromEntries(Object.entries(item.nutrientRanges).map(([key, value]) => {
    if (!value || typeof value !== 'object') return [key, value]
    const range = value as Record<string, unknown>
    return [key, { ...range, ...Object.fromEntries(['min', 'max'].filter(bound => typeof range[bound] === 'number' && Number.isFinite(range[bound]))
      .map(bound => [bound, (range[bound] as number) * factor])) }]
  })) }
}
