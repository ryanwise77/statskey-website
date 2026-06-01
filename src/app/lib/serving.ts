import type { FoodItem } from './types'

const WEIGHT_GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
}

const VOLUME_CUP_RATIO: Record<string, number> = {
  cup: 1,
  cups: 1,
  tbsp: 1 / 16,
  tablespoon: 1 / 16,
  tablespoons: 1 / 16,
  tsp: 1 / 48,
  teaspoon: 1 / 48,
  teaspoons: 1 / 48,
  ml: 1 / 236.588,
  milliliter: 1 / 236.588,
  milliliters: 1 / 236.588,
  l: 1000 / 236.588,
  liter: 1000 / 236.588,
  liters: 1000 / 236.588,
  'fl oz': 1 / 8,
  floz: 1 / 8,
  'fluid ounce': 1 / 8,
  'fluid ounces': 1 / 8,
}

const COMMON_UNITS = [
  'serving',
  'g',
  'oz',
  'cup',
  'tbsp',
  'tsp',
  'ml',
  'fl oz',
  'piece',
  'slice',
  'container',
  'bottle',
  'scoop',
  'lb',
  'kg',
]

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\./g, '').replace(/_/g, ' ').replace(/\s+/g, ' ')
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function gramsForOneUnit(item: Pick<FoodItem, 'gramWeight' | 'gramsPerCup' | 'baseServingSize' | 'baseServingUnit'>, unit: string): number | undefined {
  const normalized = normalizeUnit(unit)
  const weightGrams = WEIGHT_GRAMS_PER_UNIT[normalized]
  if (weightGrams != null) return weightGrams

  if (finitePositive(item.gramsPerCup)) {
    const cupRatio = VOLUME_CUP_RATIO[normalized]
    if (cupRatio != null) return item.gramsPerCup * cupRatio
  }

  if (
    finitePositive(item.gramWeight) &&
    finitePositive(item.baseServingSize) &&
    normalizeUnit(item.baseServingUnit ?? '') === normalized
  ) {
    return item.gramWeight / item.baseServingSize
  }

  return undefined
}

export function currentGramWeight(item: Pick<FoodItem, 'servingSize' | 'servingUnit' | 'gramWeight' | 'gramsPerCup' | 'baseServingSize' | 'baseServingUnit'>): number | undefined {
  const gramsPerUnit = gramsForOneUnit(item, item.servingUnit)
  return gramsPerUnit == null ? undefined : item.servingSize * gramsPerUnit
}

export function availableServingUnits(item: Pick<FoodItem, 'servingUnit' | 'gramWeight' | 'gramsPerCup' | 'baseServingSize' | 'baseServingUnit'>): string[] {
  const currentUnit = item.servingUnit.trim() || 'serving'
  const units = COMMON_UNITS.filter((unit) => gramsForOneUnit(item, unit) != null)
  if (!units.includes(currentUnit)) units.unshift(currentUnit)
  return units
}

export function convertServingAmount(
  item: Pick<FoodItem, 'gramWeight' | 'gramsPerCup' | 'baseServingSize' | 'baseServingUnit'>,
  amount: number,
  oldUnit: string,
  newUnit: string
): number | undefined {
  const oldGramsPerUnit = gramsForOneUnit(item, oldUnit)
  const newGramsPerUnit = gramsForOneUnit(item, newUnit)
  if (!finitePositive(oldGramsPerUnit) || !finitePositive(newGramsPerUnit)) return undefined
  return amount * oldGramsPerUnit / newGramsPerUnit
}

export function nutrientsForServing(
  item: Pick<FoodItem, 'servingSize' | 'servingUnit' | 'nutrients' | 'baseNutrients' | 'gramWeight' | 'gramsPerCup' | 'baseServingSize' | 'baseServingUnit'>,
  amount: number,
  unit: string
): Record<string, number> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return scaleNutrients(item.baseNutrients ?? item.nutrients, 0)
  }

  const baseNutrients = item.baseNutrients ?? item.nutrients

  if (item.baseNutrients) {
    const gramsPerUnit = gramsForOneUnit(item, unit)
    const baseGramWeight = gramWeightForBaseServing(item)
    if (finitePositive(gramsPerUnit) && finitePositive(baseGramWeight)) {
      const newGrams = amount * gramsPerUnit
      const scale = newGrams / baseGramWeight
      return scaleNutrients(baseNutrients, scale)
    }
  }

  if (finitePositive(item.baseServingSize) && normalizeUnit(item.baseServingUnit ?? '') === normalizeUnit(unit)) {
    return scaleNutrients(baseNutrients, amount / item.baseServingSize)
  }

  if (finitePositive(item.servingSize)) {
    return scaleNutrients(item.nutrients, amount / item.servingSize)
  }

  return scaleNutrients(baseNutrients, amount)
}

export function scaleNutrients(nutrients: Record<string, number>, scale: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(nutrients)) {
    out[key] = Number.isFinite(value) ? value * scale : 0
  }
  return out
}

function gramWeightForBaseServing(
  item: Pick<FoodItem, 'gramWeight' | 'gramsPerCup' | 'baseServingSize' | 'baseServingUnit'>
): number | undefined {
  if (finitePositive(item.baseServingSize) && item.baseServingUnit) {
    const baseGramsPerUnit = gramsForOneUnit(item, item.baseServingUnit)
    if (finitePositive(baseGramsPerUnit)) return item.baseServingSize * baseGramsPerUnit
  }
  return item.gramWeight
}
