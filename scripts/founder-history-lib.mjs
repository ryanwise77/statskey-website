const DAY_MS = 86_400_000

const CATEGORY_ORDER = [
  'Energy',
  'Macros',
  'Carbohydrates',
  'Vitamins',
  'Minerals',
  'Fats & Lipids',
  'Amino Acids',
  'Carotenoids',
  'Hydration',
  'Other',
]

const CORE_NUTRIENTS = [
  ['calories', 'Calories', 'kcal', 'Energy'],
  ['protein', 'Protein', 'g', 'Macros'],
  ['carbohydrates', 'Carbohydrates', 'g', 'Macros'],
  ['total_fat', 'Total Fat', 'g', 'Macros'],
]

const rounded = (value, digits = 2) => {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  const factor = 10 ** digits
  return Math.round(amount * factor) / factor
}

const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

const dayDate = (day) => validDay(day)
  ? new Date(`${day}T12:00:00.000Z`)
  : null

export const shiftDay = (day, amount) => {
  const date = dayDate(day)
  if (!date) return day
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

const inclusiveDays = (startDay, endDay) => {
  const start = dayDate(startDay)
  const end = dayDate(endDay)
  if (!start || !end || end < start) return 0
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
}

const mondayStart = (day) => {
  const date = dayDate(day)
  if (!date) return day
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

const titleCaseKey = (key) => String(key || '')
  .split('_')
  .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
  .join(' ')

const inferredCategory = (key) => {
  if (key === 'calories' || key === 'energy_kj') return 'Energy'
  if ([
    'protein', 'carbohydrates', 'total_fat', 'dietary_fiber',
    'total_sugars', 'added_sugars', 'sugar_alcohols', 'alcohol',
    'caffeine',
  ].includes(key)) return 'Macros'
  if ([
    'starch', 'sucrose', 'glucose_sugar', 'fructose', 'lactose',
    'maltose', 'galactose', 'net_carbs', 'soluble_fiber',
    'insoluble_fiber', 'resistant_starch', 'beta_glucan', 'pectin',
  ].includes(key)) return 'Carbohydrates'
  if (key.startsWith('vitamin_') || key === 'choline') return 'Vitamins'
  if ([
    'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium',
    'zinc', 'copper', 'manganese', 'selenium', 'chromium', 'molybdenum',
    'iodine', 'fluoride',
  ].includes(key)) return 'Minerals'
  if ([
    'saturated_fat', 'monounsaturated_fat', 'polyunsaturated_fat',
    'trans_fat', 'cholesterol', 'omega_3', 'omega_6', 'dha', 'epa',
    'ala', 'cla', 'phytosterols', 'butyric_acid', 'capric_acid',
    'lauric_acid', 'myristic_acid', 'palmitic_acid', 'stearic_acid',
    'oleic_acid', 'linoleic_acid', 'linolenic_acid',
  ].includes(key)) return 'Fats & Lipids'
  if ([
    'histidine', 'isoleucine', 'leucine', 'lysine', 'methionine',
    'phenylalanine', 'threonine', 'tryptophan', 'valine', 'alanine',
    'arginine', 'aspartic_acid', 'cysteine', 'glutamic_acid', 'glycine',
    'proline', 'serine', 'tyrosine', 'hydroxyproline', 'taurine',
  ].includes(key)) return 'Amino Acids'
  if ([
    'beta_carotene', 'alpha_carotene', 'beta_cryptoxanthin', 'lycopene',
    'lutein_zeaxanthin', 'retinol', 'zeaxanthin',
  ].includes(key)) return 'Carotenoids'
  if (key === 'water') return 'Hydration'
  return 'Other'
}

const inferredUnit = (key) => {
  if (key === 'calories') return 'kcal'
  if (key === 'energy_kj') return 'kJ'
  if ([
    'vitamin_a', 'vitamin_d', 'vitamin_k', 'vitamin_b7', 'vitamin_b9',
    'vitamin_b12', 'selenium', 'chromium', 'molybdenum', 'iodine',
    'beta_carotene', 'alpha_carotene', 'beta_cryptoxanthin', 'lycopene',
    'lutein_zeaxanthin', 'retinol', 'zeaxanthin',
  ].includes(key)) return 'mcg'
  if ([
    'vitamin_c', 'vitamin_e', 'vitamin_b1', 'vitamin_b2', 'vitamin_b3',
    'vitamin_b5', 'vitamin_b6', 'choline', 'calcium', 'iron', 'magnesium',
    'phosphorus', 'potassium', 'sodium', 'zinc', 'copper', 'manganese',
    'fluoride', 'cholesterol', 'caffeine', 'theobromine',
  ].includes(key)) return 'mg'
  return 'g'
}

const normalizedNutrientMap = (nutrients, usdaMap) => {
  if (!nutrients || typeof nutrients !== 'object' || Array.isArray(nutrients)) {
    return {}
  }
  const output = {}
  const priorities = new Map()
  for (const [rawKey, rawValue] of Object.entries(nutrients)) {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0) continue
    const mapped = usdaMap[String(rawKey)]
    const key = mapped || String(rawKey)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    if (!key || /^\d+$/.test(key) || key === 'vitamin_a_iu') continue
    const priority = mapped ? 0 : 1
    if ((priorities.get(key) ?? -1) > priority) continue
    output[key] = value
    priorities.set(key, priority)
  }
  return output
}

export function parseUSDANutrientMap(swiftSource) {
  return Object.fromEntries(
    Array.from(String(swiftSource || '').matchAll(/^\s*(\d+):\s*"([^"]+)"\s*,?/gm))
      .map((match) => [match[1], match[2]])
  )
}

/**
 * Adapts the original `foods` meal shape to the current projection contract.
 * The source object is never mutated.
 */
export function normalizeMealForProjection(rawMeal, usdaMap = {}) {
  if (!rawMeal || typeof rawMeal !== 'object') return rawMeal
  if (Array.isArray(rawMeal.items)) return rawMeal
  if (!Array.isArray(rawMeal.foods)) return rawMeal
  const normalizedOverride = normalizedNutrientMap(
    rawMeal.totalNutrientsOverride,
    usdaMap
  )
  return {
    ...rawMeal,
    date: rawMeal.time || rawMeal.date,
    name: rawMeal.name || rawMeal.mealName,
    items: rawMeal.foods.map((rawItem) => ({
      ...rawItem,
      name: rawItem?.name || rawItem?.description,
      servingSize: rawItem?.servingSize ?? rawItem?.quantity,
      servingUnit: rawItem?.servingUnit || rawItem?.unit,
      nutrients: normalizedNutrientMap(rawItem?.nutrients, usdaMap),
      baseNutrients: normalizedNutrientMap(rawItem?.baseNutrients, usdaMap),
    })),
    ...(Object.keys(normalizedOverride).length
      ? { totalNutrientsOverride: normalizedOverride }
      : {}),
  }
}

export function mergeRecordsById(records, key = 'mealId') {
  const merged = new Map()
  for (const record of records || []) {
    const id = record?.[key]
    if (!id) continue
    merged.set(id, record)
  }
  return Array.from(merged.values())
}

const compareMeals = (left, right) => (
  String(right.day || '').localeCompare(String(left.day || '')) ||
  String(right.timeLabel || '').localeCompare(String(left.timeLabel || '')) ||
  String(right.mealId || '').localeCompare(String(left.mealId || ''))
)

const aggregateMeals = (meals) => {
  const aggregate = {
    mealCount: 0,
    itemCount: 0,
    calories: 0,
    protein: 0,
    carbohydrates: 0,
    totalFat: 0,
    nutrients: new Map(),
  }
  for (const meal of meals) {
    aggregate.mealCount += 1
    aggregate.itemCount += Number(meal.itemCount || meal.items?.length || 0)
    aggregate.calories += Number(meal.calories) || 0
    aggregate.protein += Number(meal.protein) || 0
    aggregate.carbohydrates += Number(meal.carbohydrates) || 0
    aggregate.totalFat += Number(meal.totalFat) || 0
    const nutrients = new Map(
      (meal.nutrients || [])
        .filter((nutrient) => nutrient?.key)
        .map((nutrient) => [nutrient.key, nutrient])
    )
    for (const [key, label, unit, category] of CORE_NUTRIENTS) {
      const value = key === 'calories'
        ? meal.calories
        : key === 'protein'
          ? meal.protein
          : key === 'carbohydrates'
            ? meal.carbohydrates
            : meal.totalFat
      if (!nutrients.has(key) && Number(value) > 0) {
        nutrients.set(key, { key, label, unit, category, value })
      }
    }
    for (const nutrient of nutrients.values()) {
      const value = Number(nutrient.value)
      if (!Number.isFinite(value) || value <= 0) continue
      const previous = aggregate.nutrients.get(nutrient.key)
      aggregate.nutrients.set(nutrient.key, {
        key: nutrient.key,
        label: nutrient.label || previous?.label || titleCaseKey(nutrient.key),
        unit: nutrient.unit || previous?.unit || inferredUnit(nutrient.key),
        category: nutrient.category || previous?.category || inferredCategory(nutrient.key),
        value: (previous?.value || 0) + value,
      })
    }
  }
  return aggregate
}

const compactAggregate = (aggregate) => ({
  mealCount: aggregate.mealCount,
  itemCount: aggregate.itemCount,
  calories: rounded(aggregate.calories, 1),
  protein: rounded(aggregate.protein, 1),
  carbohydrates: rounded(aggregate.carbohydrates, 1),
  totalFat: rounded(aggregate.totalFat, 1),
  nutrients: Object.fromEntries(
    Array.from(aggregate.nutrients.entries())
      .map(([key, nutrient]) => [key, rounded(nutrient.value, 4)])
  ),
})

const referenceStatus = ({ average, coverageDays, recordedDays, reference, direction }) => {
  if (!coverageDays) return 'limited'
  if (coverageDays / Math.max(1, recordedDays) < 0.6) return 'limited'
  if (!(reference > 0)) return 'recorded'
  if (direction === 'limit') return average <= reference ? 'within' : 'watch'
  if (average >= reference) return 'strong'
  if (average >= reference * 0.75) return 'near'
  return 'watch'
}

const monthLabel = (month) => {
  const date = new Date(`${month}-01T12:00:00.000Z`)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : month
}

export function buildFounderHistory(projectedMeals, options = {}) {
  const {
    generatedAt = new Date().toISOString(),
    historyStartDay = '2025-08-25',
    reliableThroughDay = null,
    nutritionReferences = [],
  } = options
  const meals = mergeRecordsById(projectedMeals)
    .filter((meal) => validDay(meal?.day) && meal.day >= historyStartDay)
    .sort(compareMeals)
  if (!meals.length) throw new Error('No projectable founder meals were available')

  const earliestDay = meals.at(-1).day
  const latestDay = meals[0].day
  const definitions = new Map()
  const mealsByDay = new Map()
  const mealsByMonth = new Map()
  const mealsByWeek = new Map()
  const contributors = new Map()

  for (const meal of meals) {
    const dayMeals = mealsByDay.get(meal.day) || []
    dayMeals.push(meal)
    mealsByDay.set(meal.day, dayMeals)

    const month = meal.day.slice(0, 7)
    const monthMeals = mealsByMonth.get(month) || []
    monthMeals.push(meal)
    mealsByMonth.set(month, monthMeals)

    const week = mondayStart(meal.day)
    const weekMeals = mealsByWeek.get(week) || []
    weekMeals.push(meal)
    mealsByWeek.set(week, weekMeals)

    for (const nutrient of meal.nutrients || []) {
      if (!nutrient?.key) continue
      definitions.set(nutrient.key, {
        key: nutrient.key,
        label: nutrient.label || definitions.get(nutrient.key)?.label || titleCaseKey(nutrient.key),
        unit: nutrient.unit || definitions.get(nutrient.key)?.unit || inferredUnit(nutrient.key),
        category: nutrient.category || definitions.get(nutrient.key)?.category || inferredCategory(nutrient.key),
      })
    }
    for (const item of meal.items || []) {
      for (const nutrient of item.nutrients || []) {
        const value = Number(nutrient?.value)
        if (!nutrient?.key || !Number.isFinite(value) || value <= 0) continue
        const identity = `${nutrient.key}\u0000${String(item.name || 'Food').toLowerCase()}\u0000${String(item.brand || '').toLowerCase()}`
        const current = contributors.get(identity) || {
          key: nutrient.key,
          name: item.name || 'Food',
          brand: item.brand || '',
          amount: 0,
          occurrences: 0,
        }
        current.amount += value
        current.occurrences += 1
        contributors.set(identity, current)
      }
    }
  }

  for (const [key, label, unit, category] of CORE_NUTRIENTS) {
    if (!definitions.has(key)) definitions.set(key, { key, label, unit, category })
  }

  const daily = Array.from(mealsByDay.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, dayMeals]) => ({
      day,
      ...compactAggregate(aggregateMeals(dayMeals)),
    }))
  const dailyByDay = new Map(daily.map((day) => [day.day, day]))
  const referenceByKey = new Map(
    nutritionReferences.map((reference) => [reference.key, reference])
  )
  const recordedDays = daily.length
  const overall = aggregateMeals(meals)

  const weeks = Array.from(mealsByWeek.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([weekStart, weekMeals]) => {
      const weekEnd = shiftDay(weekStart, 6)
      const days = new Set(weekMeals.map((meal) => meal.day))
      const months = Array.from(new Set(
        Array.from({ length: 7 }, (_, index) => shiftDay(weekStart, index).slice(0, 7))
      ))
      return {
        weekStart,
        weekEnd,
        months,
        recordedDays: days.size,
        ...compactAggregate(aggregateMeals(weekMeals)),
      }
    })

  const monthAggregates = new Map()
  const months = Array.from(mealsByMonth.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, monthMeals]) => {
      const monthDays = Array.from(new Set(monthMeals.map((meal) => meal.day))).sort()
      const aggregate = aggregateMeals(monthMeals)
      monthAggregates.set(month, { aggregate, days: monthDays })
      return {
        month,
        label: monthLabel(month),
        startDay: monthDays[0],
        endDay: monthDays.at(-1),
        recordedDays: monthDays.length,
        weekStarts: weeks
          .filter((week) => week.months.includes(month))
          .map((week) => week.weekStart),
        path: `/statskey-app/founder-history/meals/${month}.json`,
        ...compactAggregate(aggregate),
      }
    })

  const ascendingMonths = [...months].reverse()
  const profileNutrients = Array.from(definitions.values())
    .map((definition) => {
      let total = 0
      let coverageDays = 0
      for (const day of daily) {
        const value = Number(day.nutrients[definition.key])
        if (!Number.isFinite(value)) continue
        total += value
        coverageDays += 1
      }
      const average = coverageDays ? total / coverageDays : 0
      const reference = referenceByKey.get(definition.key)
      const percent = reference?.target > 0
        ? average / reference.target * 100
        : null
      const monthly = ascendingMonths.map((month) => {
        const source = monthAggregates.get(month.month)
        let monthTotal = 0
        let monthCoverageDays = 0
        for (const day of source.days) {
          const value = Number(dailyByDay.get(day)?.nutrients?.[definition.key])
          if (!Number.isFinite(value)) continue
          monthTotal += value
          monthCoverageDays += 1
        }
        const monthAverage = monthCoverageDays
          ? monthTotal / monthCoverageDays
          : null
        const monthPercent = monthAverage != null && reference?.target > 0
          ? monthAverage / reference.target * 100
          : null
        return {
          month: month.month,
          average: monthAverage == null ? null : rounded(monthAverage, 4),
          coverageDays: monthCoverageDays,
          recordedDays: source.days.length,
          percent: monthPercent == null ? null : rounded(monthPercent, 1),
          status: monthAverage == null
            ? 'limited'
            : referenceStatus({
                average: monthAverage,
                coverageDays: monthCoverageDays,
                recordedDays: source.days.length,
                reference: reference?.target,
                direction: reference?.direction,
              }),
        }
      })
      const topFoods = Array.from(contributors.values())
        .filter((item) => item.key === definition.key)
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 12)
        .map(({ key: _key, ...item }) => ({
          ...item,
          amount: rounded(item.amount, 4),
        }))
      return {
        ...definition,
        total: rounded(total, 4),
        average: rounded(average, 4),
        coverageDays,
        coveragePercent: rounded(coverageDays / Math.max(1, recordedDays) * 100, 1),
        reference: reference?.target ?? null,
        direction: reference?.direction ?? null,
        percent: percent == null ? null : rounded(percent, 1),
        status: referenceStatus({
          average,
          coverageDays,
          recordedDays,
          reference: reference?.target,
          direction: reference?.direction,
        }),
        monthly,
        topFoods,
      }
    })
    .filter((nutrient) => nutrient.coverageDays > 0)
    .sort((left, right) => (
      CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category) ||
      left.label.localeCompare(right.label)
    ))

  const profile = {
    archive: true,
    startDay: earliestDay,
    endDay: latestDay,
    possibleDays: inclusiveDays(earliestDay, latestDay),
    recordedDays,
    mealCount: meals.length,
    itemCount: overall.itemCount,
    dailyAverage: {
      calories: rounded(overall.calories / Math.max(1, recordedDays), 1),
      proteinGrams: rounded(overall.protein / Math.max(1, recordedDays), 1),
      carbohydrateGrams: rounded(overall.carbohydrates / Math.max(1, recordedDays), 1),
      fatGrams: rounded(overall.totalFat / Math.max(1, recordedDays), 1),
      fiberGrams: rounded(
        daily.reduce((sum, day) => sum + (Number(day.nutrients.dietary_fiber) || 0), 0) /
          Math.max(1, recordedDays),
        1
      ),
    },
    nutrients: profileNutrients,
    disclaimer: 'Recorded public food only. Missing nutrient fields remain unknown, not zero. Supplements and medications are excluded. Not a diagnosis.',
  }

  const shards = Object.fromEntries(
    Array.from(mealsByMonth.entries()).map(([month, monthMeals]) => [
      month,
      {
        schemaVersion: 1,
        month,
        generatedAt,
        meals: monthMeals.sort(compareMeals),
      },
    ])
  )

  return {
    index: {
      schemaVersion: 1,
      generatedAt,
      historyStartDay,
      earliestDay,
      latestDay,
      reliableThroughDay: reliableThroughDay || latestDay,
      mealCount: meals.length,
      itemCount: overall.itemCount,
      recordedDays,
      possibleDays: inclusiveDays(earliestDay, latestDay),
      nutrientCount: profileNutrients.length,
      months,
      weeks,
      daily,
      nutritionProfile: profile,
      privacy: {
        scope: 'public-food-only',
        excluded: [
          'private notes',
          'photos',
          'medications',
          'supplements',
          'hidden items',
          'private Intelligence output',
        ],
      },
    },
    shards,
  }
}
