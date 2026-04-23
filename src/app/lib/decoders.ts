import { toDate, toDateOrNow } from './firestore'
import type {
  AnalysisMode,
  BowelMovementEntry,
  BristolType,
  EnergyEntry,
  FoodItem,
  FoodSource,
  GlucoseReading,
  GlucoseResponse,
  GlucoseSource,
  GlucoseTrend,
  ItemCategory,
  MacroTargets,
  Meal,
  MoodEntry,
  StoolColor,
  SymptomEntry,
  WaterDoc,
  WellnessData,
  WellnessEntry,
  WellnessType,
  WorkoutSession,
  WorkoutSource,
} from './types'
import { DEFAULT_MACRO_TARGETS } from './types'

type Raw = Record<string, unknown>
const asRaw = (v: unknown): Raw | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  const raw = asRaw(v)
  if (!raw) return out
  for (const [k, val] of Object.entries(raw)) {
    // Skip legacy USDA numeric-id keys that iOS remaps via USDANutrientMap;
    // without that map here we drop unknown numeric keys instead of polluting
    // the totals with them.
    if (/^\d+$/.test(k)) continue
    if (typeof val === 'number') out[k] = val
  }
  return out
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

// MARK: - FoodItem

export function decodeFoodItem(raw: Raw, idFallback: string): FoodItem {
  const source = (str(raw.source) as FoodSource | undefined) ?? 'manual'
  const itemCategory = (str(raw.itemCategory) as ItemCategory | undefined) ?? 'food'
  // Legacy aliases from biometrics/StatsKey/Models/FoodItem.swift (description, quantity, unit).
  const name = str(raw.name) ?? str(raw.description) ?? ''
  const servingSize = num(raw.servingSize) ?? num(raw.quantity) ?? 1
  const servingUnit = str(raw.servingUnit) ?? str(raw.unit) ?? 'serving'

  return {
    id: str(raw.id) ?? idFallback,
    name,
    brand: str(raw.brand),
    servingSize,
    servingUnit,
    barcode: str(raw.barcode),
    nutrients: numMap(raw.nutrients),
    baseNutrients: asRaw(raw.baseNutrients) ? numMap(raw.baseNutrients) : undefined,
    baseServingSize: num(raw.baseServingSize),
    baseServingUnit: str(raw.baseServingUnit),
    gramWeight: num(raw.gramWeight),
    gramsPerCup: num(raw.gramsPerCup),
    isFavorite: bool(raw.isFavorite) ?? false,
    useCount: num(raw.useCount) ?? 0,
    lastUsed: toDate(raw.lastUsed),
    source,
    itemCategory,
    notes: str(raw.notes),
    geminiExplanation: str(raw.geminiExplanation),
    createdAt: toDateOrNow(raw.createdAt),
    updatedAt: toDateOrNow(raw.updatedAt),
  }
}

// MARK: - Meal

export function decodeMeal(raw: Raw, id: string): Meal {
  // Legacy aliases: `foods` is an older name for `items`, `mealName` for `name`.
  const rawItems = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.foods) ? raw.foods : []
  const items: FoodItem[] = rawItems
    .map((it, idx) => {
      const r = asRaw(it)
      if (!r) return undefined
      return decodeFoodItem(r, `${id}-item-${idx}`)
    })
    .filter((x): x is FoodItem => x != null)

  const glucoseResponseRaw = asRaw(raw.glucoseResponse)
  let glucoseResponse: GlucoseResponse | undefined
  if (glucoseResponseRaw) {
    glucoseResponse = {
      preReading: num(glucoseResponseRaw.preReading),
      postReading: num(glucoseResponseRaw.postReading),
      peakReading: num(glucoseResponseRaw.peakReading),
      timeToReturn: num(glucoseResponseRaw.timeToReturn),
      score: num(glucoseResponseRaw.score),
    }
  }

  return {
    id,
    userId: str(raw.userId) ?? '',
    name: str(raw.name) ?? str(raw.mealName),
    items,
    date: toDateOrNow(raw.date),
    multiplier: num(raw.multiplier) ?? 1,
    isFavorite: bool(raw.isFavorite) ?? false,
    glucoseResponse,
    photoURLs: strArray(raw.photoURLs).length ? strArray(raw.photoURLs) : undefined,
    analysisMode: str(raw.analysisMode) as AnalysisMode | undefined,
    createdAt: toDateOrNow(raw.createdAt),
    updatedAt: toDateOrNow(raw.updatedAt),
  }
}

// MARK: - Water

export function decodeWater(raw: Raw): WaterDoc {
  return {
    amount: num(raw.amount) ?? 0,
    date: toDateOrNow(raw.date),
  }
}

// MARK: - MacroTargets

export function decodeMacroTargets(raw: Raw): MacroTargets {
  return {
    calories: num(raw.calories) ?? DEFAULT_MACRO_TARGETS.calories,
    protein: num(raw.protein) ?? DEFAULT_MACRO_TARGETS.protein,
    carbs: num(raw.carbs) ?? DEFAULT_MACRO_TARGETS.carbs,
    fat: num(raw.fat) ?? DEFAULT_MACRO_TARGETS.fat,
    fiber: num(raw.fiber) ?? DEFAULT_MACRO_TARGETS.fiber,
    water: num(raw.water) ?? DEFAULT_MACRO_TARGETS.water,
    isAIAdaptive: bool(raw.isAIAdaptive) ?? true,
    isWaterCustom: bool(raw.isWaterCustom) ?? false,
  }
}

// MARK: - Glucose

export function decodeGlucose(raw: Raw, id: string): GlucoseReading {
  return {
    id,
    value: num(raw.value) ?? 0,
    timestamp: toDateOrNow(raw.timestamp),
    source: (str(raw.source) as GlucoseSource | undefined) ?? 'Manual',
    trend: str(raw.trend) as GlucoseTrend | undefined,
  }
}

// MARK: - WellnessEntry

function decodeWellnessData(raw: Raw): WellnessData | undefined {
  const type = str(raw.type)
  switch (type) {
    case 'symptom': {
      const e = asRaw(raw.symptom)
      if (!e) return undefined
      const entry: SymptomEntry = {
        symptom: str(e.symptom) ?? '',
        severity: num(e.severity) ?? 3,
        duration: str(e.duration),
        bodyArea: str(e.bodyArea),
        triggers: strArray(e.triggers),
      }
      return { kind: 'symptom', entry }
    }
    case 'mood': {
      const e = asRaw(raw.mood)
      if (!e) return undefined
      const entry: MoodEntry = {
        rating: num(e.rating) ?? 3,
        tags: strArray(e.tags),
        notes: str(e.notes),
      }
      return { kind: 'mood', entry }
    }
    case 'energy': {
      const e = asRaw(raw.energy)
      if (!e) return undefined
      const entry: EnergyEntry = {
        level: num(e.level) ?? 3,
        crashTime: toDate(e.crashTime),
        notes: str(e.notes),
      }
      return { kind: 'energy', entry }
    }
    case 'bowelMovement': {
      const e = asRaw(raw.bowelMovement)
      if (!e) return undefined
      const bristolType = num(e.bristolType) ?? 4
      const entry: BowelMovementEntry = {
        bristolType: Math.min(7, Math.max(1, Math.round(bristolType))) as BristolType,
        color: str(e.color) as StoolColor | undefined,
        urgency: num(e.urgency),
        durationInSeconds: num(e.durationInSeconds),
        notes: str(e.notes),
      }
      return { kind: 'bowelMovement', entry }
    }
    case 'sleep': {
      return {
        kind: 'sleep',
        hours: num(raw.sleepHours) ?? 0,
        quality: num(raw.sleepQuality) ?? 0,
      }
    }
    case 'hydration': {
      return { kind: 'hydration', ozConsumed: num(raw.hydrationOz) ?? 0 }
    }
    case 'custom': {
      return {
        kind: 'custom',
        label: str(raw.customLabel) ?? '',
        value: num(raw.customValue) ?? 0,
        unit: str(raw.customUnit),
      }
    }
    default:
      return undefined
  }
}

export function decodeWellness(raw: Raw, id: string): WellnessEntry | undefined {
  const dataRaw = asRaw(raw.data)
  if (!dataRaw) return undefined
  const data = decodeWellnessData(dataRaw)
  if (!data) return undefined

  return {
    id,
    userId: str(raw.userId) ?? '',
    type: (str(raw.type) as WellnessType | undefined) ?? 'symptom',
    data,
    mealId: str(raw.mealId),
    notes: str(raw.notes),
    date: toDateOrNow(raw.date),
    createdAt: toDateOrNow(raw.createdAt),
  }
}

// MARK: - WorkoutSession

export function decodeWorkout(raw: Raw, id: string): WorkoutSession {
  return {
    id,
    userId: str(raw.userId) ?? '',
    title: str(raw.title) ?? '',
    sportType: str(raw.sportType) ?? 'running',
    startDate: toDateOrNow(raw.startDate),
    endDate: toDate(raw.endDate),
    duration: num(raw.duration) ?? 0,
    movingTime: num(raw.movingTime) ?? 0,
    distance: num(raw.distance) ?? 0,
    elevationGain: num(raw.elevationGain) ?? 0,
    elevationLoss: num(raw.elevationLoss) ?? 0,
    calories: num(raw.calories) ?? 0,
    averagePace: num(raw.averagePace) ?? 0,
    bestPace: num(raw.bestPace) ?? 0,
    averageSpeed: num(raw.averageSpeed) ?? 0,
    maxSpeed: num(raw.maxSpeed) ?? 0,
    averageHeartRate: num(raw.averageHeartRate) ?? 0,
    maxHeartRate: num(raw.maxHeartRate) ?? 0,
    averageCadence: num(raw.averageCadence) ?? 0,
    isFavorite: bool(raw.isFavorite) ?? false,
    notes: str(raw.notes),
    perceivedEffort: num(raw.perceivedEffort),
    relativeEffort: num(raw.relativeEffort) ?? 0,
    gradeAdjustedPace: num(raw.gradeAdjustedPace) ?? 0,
    photoURLs: strArray(raw.photoURLs),
    source: (str(raw.source) as WorkoutSource | undefined) ?? 'manual',
    isIndoor: bool(raw.isIndoor) ?? false,
    healthKitUUID: str(raw.healthKitUUID),
    structuredWorkoutId: str(raw.structuredWorkoutId),
    recordingMode: str(raw.recordingMode) ?? 'standard',
    createdAt: toDateOrNow(raw.createdAt),
  }
}
