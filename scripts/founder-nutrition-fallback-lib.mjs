// Repair the already-published snapshot from the already-public daily archive.
// This intentionally preserves its date windows, publication flags, timestamps,
// training data, and nutrient reference definitions.

const DAY_MS = 86_400_000
const MACROS = {
  calories: ['calories', 'calories', 0],
  proteinGrams: ['protein', 'protein', 0],
  carbohydrateGrams: ['carbohydrates', 'carbohydrates', 0],
  fatGrams: ['total_fat', 'totalFat', 0],
  fiberGrams: ['dietary_fiber', null, 1],
  addedSugarGrams: ['added_sugars', null, 1],
  sodiumMilligrams: ['sodium', null, 0],
}

function dayTime(day) {
  const time = Date.parse(`${day}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') ||
      !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new Error(`Invalid archive or snapshot day: ${day}`)
  }
  return time
}

const rounded = (value, digits = 0) => Number(value.toFixed(digits))
const knownAmount = (value) => typeof value === 'number' &&
  Number.isFinite(value) && value >= 0

function dailyAmount(row, key, macroField = null) {
  // The archive's aggregate macro fields default to zero, so an absent
  // nutrient plus a zero aggregate cannot establish known zero intake.
  const macro = macroField && row[macroField]
  if (knownAmount(macro) && macro > 0) return macro
  const nutrient = row.nutrients?.[key]
  return knownAmount(nutrient) ? nutrient : null
}

function nutrientAggregate(rows, key, possibleDays, macroField = null) {
  const amounts = rows.map((row) => dailyAmount(row, key, macroField))
    .filter((amount) => amount !== null)
  return {
    coverageDays: amounts.length,
    average: amounts.length
      ? amounts.reduce((total, amount) => total + amount, 0) / possibleDays
      : null,
  }
}

function repairNutrient(template, rows, possibleDays) {
  const { average, coverageDays } = nutrientAggregate(rows, template.key, possibleDays)
  const percent = average !== null && template.reference > 0
    ? rounded(average / template.reference * 100)
    : null
  const insufficient = coverageDays < Math.ceil(possibleDays / 2)
  let status = 'limited'
  if (!insufficient && percent !== null) {
    status = template.direction === 'limit'
      ? (percent <= 100 ? 'within' : 'watch')
      : percent >= 100 ? 'strong' : percent >= 75 ? 'near' : 'watch'
  }
  const coverage = `Values reported on ${coverageDays} of ${possibleDays} calendar days.`
  const interpretation = coverageDays === 0
    ? 'No reported values; the amount is unknown.'
    : insufficient
      ? 'Coverage is too limited for a reference comparison.'
      : 'The percentage compares reported amounts with a standard daily reference, not an individual nutritional assessment.'
  return {
    ...template,
    average: average === null ? null : rounded(average, template.reference < 10 ? 1 : 0),
    coverageDays,
    status,
    percent,
    summary: `${coverage} ${interpretation} Reported amounts are averaged across the selected calendar days; unreported amounts remain unknown.`,
  }
}

function repairWindow(template, daily, snapshotDay, includeToday) {
  const start = dayTime(template.startDay)
  const end = dayTime(template.endDay)
  const possibleDays = template.possibleDays
  if (!Number.isInteger(possibleDays) || possibleDays < 1 || possibleDays > 90 ||
      (end - start) / DAY_MS + 1 !== possibleDays) {
    throw new Error('Nutrition window length does not match its date boundaries')
  }
  if (end !== dayTime(snapshotDay) - (includeToday ? 0 : DAY_MS) ||
      template.includeToday !== includeToday) {
    throw new Error('Nutrition window does not match the snapshot-day inclusion mode')
  }
  const rows = daily.filter((row) => row.day >= template.startDay && row.day <= template.endDay)
  const dailyAverage = { ...template.dailyAverage }
  for (const [field, [key, macroField, digits]] of Object.entries(MACROS)) {
    if (!Object.hasOwn(dailyAverage, field)) continue
    const { average } = nutrientAggregate(rows, key, possibleDays, macroField)
    dailyAverage[field] = average === null ? null : rounded(average, digits)
  }
  return {
    ...template,
    recordedDays: rows.length,
    dailyAverage,
    micronutrients: template.micronutrients.map((nutrient) => (
      repairNutrient(nutrient, rows, possibleDays)
    )),
  }
}

export function repairFounderNutritionFallback(payload, history) {
  if (payload?.root?.published !== true || payload.root.nutritionPublished !== true) {
    throw new Error('Nutrition must already be publicly shared before repairing its snapshot')
  }
  if (history?.privacy?.scope !== 'public-food-only' || !Array.isArray(history.daily)) {
    throw new Error('Repair requires the published public-food-only daily archive')
  }
  const seen = new Set()
  for (const row of history.daily) {
    dayTime(row.day)
    if (seen.has(row.day)) throw new Error(`Duplicate archive day: ${row.day}`)
    if (!Number.isInteger(row.mealCount) || row.mealCount < 1) {
      throw new Error(`Archive day has no recorded food: ${row.day}`)
    }
    seen.add(row.day)
  }
  const snapshotDay = payload.root.snapshotDay
  dayTime(snapshotDay)
  const sourceEndDay = history.reliableThroughDay || history.latestDay
  dayTime(sourceEndDay)
  if (sourceEndDay < snapshotDay) {
    throw new Error('Public archive does not cover the snapshot day')
  }
  const original = payload.root.nutrition
  const ranges = {}
  for (const mode of ['complete', 'includingToday']) {
    if (!original?.ranges?.[mode]) throw new Error(`Missing nutrition ranges: ${mode}`)
    ranges[mode] = {}
    for (const days of [7, 14, 30, 90]) {
      const window = original.ranges[mode][String(days)]
      if (!window || window.possibleDays !== days) {
        throw new Error(`Missing or invalid ${mode} ${days}-day nutrition window`)
      }
      if (history.earliestDay > window.startDay) {
        throw new Error('Public archive starts after the nutrition window')
      }
      ranges[mode][String(days)] = repairWindow(
        window, history.daily, snapshotDay, mode === 'includingToday'
      )
    }
  }
  const base = repairWindow(original, history.daily, snapshotDay, original.includeToday)
  return {
    ...payload,
    root: {
      ...payload.root,
      nutrition: { ...base, ranges },
    },
  }
}
