import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFounderHistory,
  normalizeMealForProjection,
  parseUSDANutrientMap,
} from './founder-history-lib.mjs'

test('normalizes legacy meal names, timestamps, servings, and USDA nutrient IDs', () => {
  const map = parseUSDANutrientMap(`
    static let idToKey: [Int: String] = [
      1003: "protein",
      1008: "calories",
    ]
  `)
  const normalized = normalizeMealForProjection({
    id: 'legacy-meal',
    date: '2025-08-31T07:00:00.000Z',
    time: '2025-09-01T05:10:04.270Z',
    mealName: 'Dinner',
    foods: [{
      description: 'Salmon',
      quantity: 1,
      unit: 'serving',
      nutrients: { 1003: 20.3, 1008: 203, 9999: 12 },
    }],
  }, map)

  assert.equal(normalized.date, '2025-09-01T05:10:04.270Z')
  assert.equal(normalized.name, 'Dinner')
  assert.equal(normalized.items[0].name, 'Salmon')
  assert.equal(normalized.items[0].servingSize, 1)
  assert.equal(normalized.items[0].servingUnit, 'serving')
  assert.deepEqual(normalized.items[0].nutrients, {
    protein: 20.3,
    calories: 203,
  })
  assert.equal('totalNutrientsOverride' in normalized, false)
})

test('builds month shards, Monday weeks, and unknown-aware nutrient averages', () => {
  const meal = (mealId, day, calories, calcium = null) => ({
    mealId,
    day,
    timeLabel: '8:00 AM',
    title: 'Breakfast',
    calories,
    protein: 20,
    carbohydrates: 40,
    totalFat: 10,
    itemCount: 1,
    nutrients: [
      { key: 'calories', label: 'Calories', unit: 'kcal', category: 'Energy', value: calories },
      ...(calcium == null
        ? []
        : [{ key: 'calcium', label: 'Calcium', unit: 'mg', category: 'Minerals', value: calcium }]),
    ],
    items: [{
      name: 'Test food',
      nutrients: [
        { key: 'calories', value: calories },
        ...(calcium == null ? [] : [{ key: 'calcium', value: calcium }]),
      ],
    }],
  })
  const { index, shards } = buildFounderHistory([
    meal('a', '2025-08-31', 500, 100),
    meal('b', '2025-09-01', 700),
  ], {
    generatedAt: '2026-08-20T00:00:00.000Z',
    reliableThroughDay: '2025-09-01',
    nutritionReferences: [
      { key: 'calcium', target: 1_000, direction: 'minimum' },
    ],
  })

  assert.deepEqual(Object.keys(shards).sort(), ['2025-08', '2025-09'])
  assert.equal(index.mealCount, 2)
  assert.equal(index.recordedDays, 2)
  assert.equal(index.weeks[0].weekStart, '2025-09-01')
  assert.equal(index.weeks[1].weekStart, '2025-08-25')

  const calcium = index.nutritionProfile.nutrients
    .find((nutrient) => nutrient.key === 'calcium')
  assert.equal(calcium.average, 100)
  assert.equal(calcium.coverageDays, 1)
  assert.equal(calcium.coveragePercent, 50)
  assert.equal(calcium.status, 'limited')
})
