import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { repairFounderNutritionFallback } from './founder-nutrition-fallback-lib.mjs'

const shiftDay = (day, count) => new Date(
  Date.parse(`${day}T00:00:00Z`) + count * 86_400_000
).toISOString().slice(0, 10)

function fixture() {
  const snapshotDay = '2026-06-01'
  const window = (days, includeToday) => ({
    scope: 'recordedFoodOnly',
    startDay: shiftDay(snapshotDay, (includeToday ? 1 : 0) - days),
    endDay: shiftDay(snapshotDay, includeToday ? 0 : -1),
    possibleDays: days,
    recordedDays: 0,
    includeToday,
    dailyAverage: {
      calories: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0,
      fiberGrams: 0, addedSugarGrams: 0, sodiumMilligrams: 0,
    },
    micronutrients: [
      { key: 'calcium', reference: 1_000, direction: 'minimum', average: 0 },
      { key: 'sodium', reference: 2_300, direction: 'limit', average: 0 },
      { key: 'vitamin_c', reference: 90, direction: 'minimum', average: 0 },
      { key: 'iron', reference: 18, direction: 'minimum', average: 0 },
    ],
    disclaimer: 'Recorded public food only.',
  })
  const payload = {
    root: {
      published: true,
      nutritionPublished: true,
      snapshotDay,
      generatedAt: '2026-06-01T18:00:00Z',
      timeZone: 'America/Chicago',
      trainingPublished: true,
      training: { periods: { last7Days: { activities: 5 } } },
      nutrition: {
        ...window(7, false),
        ranges: Object.fromEntries(['complete', 'includingToday'].map((mode) => [
          mode,
          Object.fromEntries([7, 14, 30, 90].map((days) => [
            String(days), window(days, mode === 'includingToday'),
          ])),
        ])),
      },
    },
    workouts: [{ workoutId: 'public-workout', day: '2026-05-30' }],
  }
  const history = {
    earliestDay: '2026-01-01',
    latestDay: snapshotDay,
    reliableThroughDay: snapshotDay,
    privacy: { scope: 'public-food-only' },
    daily: Array.from({ length: 9 }, (_, index) => ({
      day: shiftDay(snapshotDay, index - 8),
      mealCount: 2,
      calories: 100 * (index + 1),
      protein: 30,
      carbohydrates: 60,
      totalFat: 20,
      nutrients: { calcium: 1_400, sodium: 1_000, iron: 0 },
    })),
  }
  return { payload, history }
}

test('complete windows exclude snapshot day while includingToday shifts both boundaries', () => {
  const { payload, history } = fixture()
  const before = structuredClone({ payload, history })
  const result = repairFounderNutritionFallback(payload, history)
  const complete = result.root.nutrition.ranges.complete['7']
  const including = result.root.nutrition.ranges.includingToday['7']
  assert.equal(complete.startDay, '2026-05-25')
  assert.equal(complete.endDay, '2026-05-31')
  assert.equal(complete.recordedDays, 7)
  assert.equal(complete.dailyAverage.calories, 500)
  assert.equal(including.startDay, '2026-05-26')
  assert.equal(including.endDay, '2026-06-01')
  assert.equal(including.recordedDays, 7)
  assert.equal(including.dailyAverage.calories, 600)
  assert.deepEqual({ payload, history }, before, 'inputs remain unchanged')
  const { nutrition: _old, ...beforeRoot } = payload.root
  const { nutrition: _new, ...afterRoot } = result.root
  assert.deepEqual(beforeRoot, afterRoot)
  assert.deepEqual(result.workouts, payload.workouts)
  assert.deepEqual(result.root.nutrition, {
    ...complete,
    ranges: result.root.nutrition.ranges,
  })
})

test('missing days retain the calendar denominator and limited coverage stays limited', () => {
  const { payload, history } = fixture()
  history.daily = [history.daily.find((row) => row.day === '2026-05-31')]
  const result = repairFounderNutritionFallback(payload, history).root.nutrition
  assert.equal(result.recordedDays, 1)
  assert.equal(result.possibleDays, 7)
  assert.equal(result.dailyAverage.calories, 114)
  const calcium = result.micronutrients.find((item) => item.key === 'calcium')
  assert.equal(calcium.coverageDays, 1)
  assert.equal(calcium.average, 200)
  assert.equal(calcium.status, 'limited')
  assert.match(calcium.summary, /Values reported on 1 of 7 calendar days/)
})

test('missing, null, and invalid nutrient values are unknown; explicitly recorded zero has coverage', () => {
  const { payload, history } = fixture()
  const rows = history.daily.filter((row) => row.day >= '2026-05-25' && row.day <= '2026-05-31')
  rows[0].nutrients.vitamin_c = null
  rows[1].nutrients.vitamin_c = ''
  rows[2].nutrients.vitamin_c = Number.NaN
  rows[3].nutrients.vitamin_c = -1
  const { micronutrients } = repairFounderNutritionFallback(payload, history).root.nutrition
  const vitaminC = micronutrients.find((item) => item.key === 'vitamin_c')
  assert.equal(vitaminC.coverageDays, 0)
  assert.equal(vitaminC.average, null)
  assert.equal(vitaminC.percent, null)
  assert.equal(vitaminC.status, 'limited')
  assert.match(vitaminC.summary, /amount is unknown/)
  const iron = micronutrients.find((item) => item.key === 'iron')
  assert.equal(iron.coverageDays, 7)
  assert.equal(iron.average, 0)
  assert.equal(iron.percent, 0)
  assert.equal(iron.status, 'watch')
})

test('reference summaries describe reported amounts without claiming optimal individual intake', () => {
  const { payload, history } = fixture()
  const result = repairFounderNutritionFallback(payload, history).root.nutrition
  const calcium = result.micronutrients.find((item) => item.key === 'calcium')
  const sodium = result.micronutrients.find((item) => item.key === 'sodium')
  assert.equal(calcium.percent, 140)
  assert.equal(calcium.status, 'strong')
  assert.equal(sodium.percent, 43)
  assert.equal(sodium.status, 'within')
  assert.match(calcium.summary, /not an individual nutritional assessment/)
})

test('refuses private, insufficient, duplicate, and misaligned source data', () => {
  for (const [change, expected] of [
    [({ payload }) => { payload.root.nutritionPublished = false }, /already be publicly shared/],
    [({ history }) => { history.privacy.scope = 'private' }, /public-food-only/],
    [({ history }) => { history.reliableThroughDay = '2026-05-31' }, /does not cover/],
    [({ history }) => { history.daily.push(history.daily[0]) }, /Duplicate archive day/],
    [({ payload }) => { payload.root.nutrition.ranges.complete['7'].endDay = '2026-06-01' }, /window length/],
    [({ payload }) => { payload.root.nutrition.ranges.complete['7'].includeToday = true }, /inclusion mode/],
  ]) {
    const data = fixture()
    change(data)
    assert.throws(() => repairFounderNutritionFallback(data.payload, data.history), expected)
  }
})

test('checked-in fallback matches independently summed public history for all eight date windows', () => {
  const payload = JSON.parse(readFileSync(new URL('../public/statskey-app/founder-live-fallback.json', import.meta.url)))
  const history = JSON.parse(readFileSync(new URL('../public/statskey-app/founder-history/index.json', import.meta.url)))
  assert.deepEqual(payload, repairFounderNutritionFallback(payload, history))
  for (const ranges of Object.values(payload.root.nutrition.ranges)) {
    for (const [length, window] of Object.entries(ranges)) {
      const rows = history.daily.filter((row) => row.day >= window.startDay && row.day <= window.endDay)
      assert.equal(window.recordedDays, new Set(rows.map((row) => row.day)).size)
      assert.equal(window.recordedDays, Number(length))
      for (const [field, source] of [
        ['calories', 'calories'], ['proteinGrams', 'protein'],
        ['carbohydrateGrams', 'carbohydrates'], ['fatGrams', 'totalFat'],
      ]) {
        assert.equal(window.dailyAverage[field], Math.round(
          rows.reduce((total, row) => total + row[source], 0) / Number(length)
        ))
        assert.ok(window.dailyAverage[field] > 0)
      }
      for (const nutrient of window.micronutrients) {
        const known = rows.map((row) => row.nutrients[nutrient.key])
          .filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
        assert.equal(nutrient.coverageDays, known.length)
        const expected = known.reduce((total, value) => total + value, 0) / Number(length)
        assert.equal(nutrient.average, Number(expected.toFixed(nutrient.reference < 10 ? 1 : 0)))
      }
    }
  }
})
