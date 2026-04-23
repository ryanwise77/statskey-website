import type { Meal } from './types'
import { NUTRIENT_KEYS } from './types'

/**
 * Sum of `key` across a meal's items, scaled by the meal multiplier.
 * Mirrors biometrics/StatsKey/Models/Meal.swift:59-61 exactly.
 */
export function mealTotal(meal: Meal, key: string): number {
  const sum = meal.items.reduce((s, it) => s + (it.nutrients[key] ?? 0), 0)
  return sum * (meal.multiplier ?? 1)
}

export interface DailyTotals {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sodium: number
  sugar: number
}

/**
 * Ports DailyNutrition's computed totals from biometrics/StatsKey/Models/Meal.swift:151-167.
 * Note: water is NOT included here — iOS treats water as a separate data source.
 */
export function dailyTotals(meals: Meal[]): DailyTotals {
  let calories = 0
  let protein = 0
  let carbs = 0
  let fat = 0
  let fiber = 0
  let sodium = 0
  let sugar = 0

  for (const meal of meals) {
    calories += mealTotal(meal, NUTRIENT_KEYS.calories)
    protein += mealTotal(meal, NUTRIENT_KEYS.protein)
    carbs += mealTotal(meal, NUTRIENT_KEYS.carbs)
    fat += mealTotal(meal, NUTRIENT_KEYS.fat)
    fiber += mealTotal(meal, NUTRIENT_KEYS.fiber)
    sodium += mealTotal(meal, NUTRIENT_KEYS.sodium)
    sugar += mealTotal(meal, NUTRIENT_KEYS.sugars)
  }

  return { calories, protein, carbs, fat, fiber, sodium, sugar }
}

/**
 * Short display name for a meal. Matches how the iOS app falls back to the
 * first food item's name when the user didn't name the meal explicitly.
 */
export function mealDisplayName(meal: Meal): string {
  if (meal.name && meal.name.trim().length > 0) return meal.name
  const first = meal.items[0]?.name
  if (first && first.trim().length > 0) return first
  if (meal.items.length > 1) return `${meal.items.length} items`
  return 'Meal'
}
