import { toDate, toDateOrNow } from './firestore'
import { deriveTrustMetadata } from './provenance'
import type {
  AnalysisMode,
  BowelControlStatus,
  BowelMovementEntry,
  BowelMovementSize,
  BowelSegment,
  BowelSegmentPortion,
  BristolType,
  CadenceSample,
  EnergyEntry,
  ExerciseCalorieStrategy,
  FoodIdentityEvidence,
  FoodItem,
  FoodNutrientEvidence,
  FoodQuantityEvidence,
  FoodSource,
  FoodTrustLevel,
  FoodTrustMetadata,
  GlucoseReading,
  GlucoseResponse,
  GlucoseSource,
  GlucoseTrend,
  HeartRateSample,
  HeartRateZoneDistribution,
  ItemCategory,
  MacroTargets,
  Meal,
  MoodEntry,
  NutritionCarbPreference,
  NutritionGoalType,
  PaceZoneDistribution,
  PortionEstimate,
  RouteDifficulty,
  RoutePoint,
  SavedReport,
  SavedRoute,
  Split,
  StoolColor,
  SubstanceEntry,
  SubstanceKind,
  SubstanceMethod,
  SymptomEntry,
  WaterDoc,
  WaterEntry,
  WeightEntry,
  WellnessData,
  WellnessEntry,
  WellnessType,
  WorkoutComment,
  WorkoutKudo,
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

function numArray(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = asRaw(v)
  if (!raw) return out
  for (const [k, val] of Object.entries(raw)) {
    if (typeof val === 'string') out[k] = val
  }
  return out
}

function optStrMap(v: unknown): Record<string, string> | undefined {
  const map = strMap(v)
  return Object.keys(map).length ? map : undefined
}

function optNumMap(v: unknown): Record<string, number> | undefined {
  const map = numMap(v)
  return Object.keys(map).length ? map : undefined
}

// MARK: - FoodItem

const TRUST_LEVELS = new Set<FoodTrustLevel>(['unknown', 'low', 'medium', 'high'])

function trustLevel(v: unknown): FoodTrustLevel {
  const s = str(v)
  return s && TRUST_LEVELS.has(s as FoodTrustLevel) ? (s as FoodTrustLevel) : 'unknown'
}

function decodeTrustMetadata(v: unknown): FoodTrustMetadata | undefined {
  const r = asRaw(v)
  if (!r) return undefined
  return {
    identityEvidence: (str(r.identityEvidence) as FoodIdentityEvidence | undefined) ?? 'unknown',
    nutrientEvidence: (str(r.nutrientEvidence) as FoodNutrientEvidence | undefined) ?? 'unknown',
    quantityEvidence: (str(r.quantityEvidence) as FoodQuantityEvidence | undefined) ?? 'unknown',
    identityConfidence: trustLevel(r.identityConfidence),
    nutrientConfidence: trustLevel(r.nutrientConfidence),
    quantityConfidence: trustLevel(r.quantityConfidence),
    notes: strArray(r.notes),
  }
}

function decodePortionEstimate(v: unknown): PortionEstimate | undefined {
  const r = asRaw(v)
  if (!r) return undefined
  const drafts = numArray(r.draftGrams)
  const est: PortionEstimate = {
    draftGrams: drafts.length ? drafts : undefined,
    lowGram: num(r.lowGram),
    highGram: num(r.highGram),
  }
  if (!est.draftGrams && est.lowGram == null && est.highGram == null) return undefined
  return est
}

export function decodeFoodItem(raw: Raw, idFallback: string): FoodItem {
  const source = (str(raw.source) as FoodSource | undefined) ?? 'manual'
  const itemCategory = (str(raw.itemCategory) as ItemCategory | undefined) ?? 'food'
  // Legacy aliases from biometrics/StatsKey/Models/FoodItem.swift (description, quantity, unit).
  const name = str(raw.name) ?? str(raw.description) ?? ''
  const servingSize = num(raw.servingSize) ?? num(raw.quantity) ?? 1
  const servingUnit = str(raw.servingUnit) ?? str(raw.unit) ?? 'serving'
  const aiEstimatedKeys = strArray(raw.aiEstimatedNutrientKeys)

  const item: FoodItem = {
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
    hiddenFromFriends: bool(raw.hiddenFromFriends),
    useCount: num(raw.useCount) ?? 0,
    lastUsed: toDate(raw.lastUsed),
    source,
    itemCategory,
    notes: str(raw.notes),
    geminiExplanation: str(raw.geminiExplanation),
    quantityWasUserAdjusted: bool(raw.quantityWasUserAdjusted),
    trustMetadata: decodeTrustMetadata(raw.trustMetadata),
    aiEstimatedNutrientKeys: aiEstimatedKeys.length ? aiEstimatedKeys : undefined,
    nutrientFillSources: optStrMap(raw.nutrientFillSources),
    // iOS persists `nutrientFillConfidence` under the Firestore key `nutrientConfidence`.
    nutrientFillConfidence: optStrMap(raw.nutrientConfidence),
    nutrientErrPct: optNumMap(raw.nutrientErrPct),
    enrichmentMethod: str(raw.enrichmentMethod),
    enrichmentCitation: str(raw.enrichmentCitation),
    enrichmentSchemaVersion: num(raw.enrichmentSchemaVersion),
    portionEstimate: decodePortionEstimate(raw.portionEstimate),
    createdAt: toDateOrNow(raw.createdAt),
    updatedAt: toDateOrNow(raw.updatedAt),
    consumedAt: toDate(raw.consumedAt),
  }
  // Mirror iOS: older records without persisted trust metadata derive it on read
  // so confidence/estimated badges work everywhere.
  if (!item.trustMetadata) item.trustMetadata = deriveTrustMetadata(item)
  return item
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
    totalNutrientsOverride: optNumMap(raw.totalNutrientsOverride),
    hiddenItemCount: num(raw.hiddenItemCount),
    aiExplanation: str(raw.aiExplanation),
    aiItemInsights: optStrMap(raw.aiItemInsights),
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

export function decodeWaterEntry(raw: Raw, id: string): WaterEntry {
  const date = toDateOrNow(raw.date)
  return {
    id: str(raw.id) ?? id,
    userId: str(raw.userId) ?? '',
    amount: num(raw.amount) ?? 0,
    date,
    createdAt: toDate(raw.createdAt) ?? date,
    updatedAt: toDate(raw.updatedAt) ?? date,
  }
}

// MARK: - Weight

export function decodeWeightEntry(raw: Raw, id: string): WeightEntry {
  return {
    id: str(raw.id) ?? id,
    weightLbs: num(raw.weightLbs) ?? 0,
    bodyFatPercent: num(raw.bodyFatPercent),
    muscleMassKg: num(raw.muscleMassKg),
    date: toDateOrNow(raw.date),
    source: str(raw.source),
  }
}

// MARK: - MacroTargets

const GOAL_TYPES = new Set<NutritionGoalType>(['maintain', 'fatLoss', 'muscleGain', 'performance'])
const CARB_PREFS = new Set<NutritionCarbPreference>(['balanced', 'performance', 'lowerCarb', 'ketogenic'])
const EXERCISE_STRATEGIES = new Set<ExerciseCalorieStrategy>(['activityInclusive', 'addAboveBaseline', 'fixedBudget'])

export function decodeMacroTargets(raw: Raw): MacroTargets {
  const goalType = str(raw.goalType)
  const carbPreference = str(raw.carbPreference)
  const strategy = str(raw.exerciseCalorieStrategy)
  return {
    calories: num(raw.calories) ?? DEFAULT_MACRO_TARGETS.calories,
    protein: num(raw.protein) ?? DEFAULT_MACRO_TARGETS.protein,
    carbs: num(raw.carbs) ?? DEFAULT_MACRO_TARGETS.carbs,
    fat: num(raw.fat) ?? DEFAULT_MACRO_TARGETS.fat,
    fiber: num(raw.fiber) ?? DEFAULT_MACRO_TARGETS.fiber,
    water: num(raw.water) ?? DEFAULT_MACRO_TARGETS.water,
    isAIAdaptive: bool(raw.isAIAdaptive) ?? true,
    isWaterCustom: bool(raw.isWaterCustom) ?? false,
    goalType: goalType && GOAL_TYPES.has(goalType as NutritionGoalType) ? (goalType as NutritionGoalType) : 'maintain',
    weeklyWeightChangeLbs: num(raw.weeklyWeightChangeLbs) ?? 0,
    proteinGramsPerKg: num(raw.proteinGramsPerKg) ?? 2.0,
    fatPercentage: num(raw.fatPercentage) ?? 0.25,
    carbPreference:
      carbPreference && CARB_PREFS.has(carbPreference as NutritionCarbPreference)
        ? (carbPreference as NutritionCarbPreference)
        : 'balanced',
    exerciseCalorieStrategy:
      strategy && EXERCISE_STRATEGIES.has(strategy as ExerciseCalorieStrategy)
        ? (strategy as ExerciseCalorieStrategy)
        : 'activityInclusive',
    calorieFloor: num(raw.calorieFloor) ?? 0,
    usesNetCarbs: bool(raw.usesNetCarbs) ?? false,
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

function clampBristol(value: number): BristolType {
  return Math.min(7, Math.max(1, Math.round(value))) as BristolType
}

const BOWEL_PORTIONS = new Set<BowelSegmentPortion>(['trace', 'some', 'most', 'all'])
const BOWEL_CONTROLS = new Set<BowelControlStatus>(['normal', 'rushed', 'hardToHold', 'nearAccident', 'accident'])

function decodeControl(v: unknown): BowelControlStatus | undefined {
  const s = str(v)
  return s && BOWEL_CONTROLS.has(s as BowelControlStatus) ? (s as BowelControlStatus) : undefined
}

function decodeBowelSegments(v: unknown): BowelSegment[] {
  if (!Array.isArray(v)) return []
  const out: BowelSegment[] = []
  for (const [idx, item] of v.entries()) {
    const r = asRaw(item)
    if (!r) continue
    const type = num(r.bristolType)
    if (type == null) continue
    const portionRaw = str(r.portion)
    // Mirror Swift's decodeIfPresent(portion) ?? .all fallback.
    const portion =
      portionRaw && BOWEL_PORTIONS.has(portionRaw as BowelSegmentPortion)
        ? (portionRaw as BowelSegmentPortion)
        : 'all'
    out.push({
      id: str(r.id) ?? `segment-${idx}`,
      bristolType: clampBristol(type),
      portion,
    })
  }
  return out
}

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
        stress: num(e.stress),
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
        tags: strArray(e.tags),
        notes: str(e.notes),
      }
      return { kind: 'energy', entry }
    }
    case 'bowelMovement': {
      const e = asRaw(raw.bowelMovement)
      if (!e) return undefined
      const bristolType = num(e.bristolType) ?? 4
      const entry: BowelMovementEntry = {
        bristolType: clampBristol(bristolType),
        color: str(e.color) as StoolColor | undefined,
        urgency: num(e.urgency),
        durationInSeconds: num(e.durationInSeconds),
        notes: str(e.notes),
        estimatedSize: str(e.estimatedSize) as BowelMovementSize | undefined,
        photoStoragePath: str(e.photoStoragePath),
        photoCreatedAt: toDate(e.photoCreatedAt),
        segments: decodeBowelSegments(e.segments),
        passageSymptoms: strArray(e.passageSymptoms),
        control: decodeControl(e.control),
        cleanup: strArray(e.cleanup),
        redFlags: strArray(e.redFlags),
        giBurdenScore: num(e.giBurdenScore),
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
    showInDashboardTimeline: bool(raw.showInDashboardTimeline),
    date: toDateOrNow(raw.date),
    createdAt: toDateOrNow(raw.createdAt),
  }
}

// MARK: - WorkoutSession

export function decodeRoutePoint(raw: Raw): RoutePoint | undefined {
  const lat = num(raw.latitude)
  const lon = num(raw.longitude)
  if (lat == null || lon == null) return undefined
  return {
    latitude: lat,
    longitude: lon,
    altitude: num(raw.altitude) ?? 0,
    timestamp: toDateOrNow(raw.timestamp),
    speed: num(raw.speed) ?? 0,
    heartRate: num(raw.heartRate),
  }
}

export function decodeRoutePoints(v: unknown): RoutePoint[] {
  if (!Array.isArray(v)) return []
  const out: RoutePoint[] = []
  for (const item of v) {
    const r = asRaw(item)
    if (!r) continue
    const p = decodeRoutePoint(r)
    if (p) out.push(p)
  }
  return out
}

export function decodeSavedRoute(raw: Raw, idFallback: string): SavedRoute {
  const difficulty = parseRouteDifficulty(str(raw.difficulty))
  return {
    id: str(raw.id) ?? idFallback,
    name: str(raw.name) ?? 'Untitled route',
    description: str(raw.description) ?? '',
    sportType: str(raw.sportType) ?? 'running',
    createdBy: str(raw.createdBy) ?? '',
    creatorName: str(raw.creatorName) ?? '',
    routePoints: decodeRoutePoints(raw.routePoints),
    distance: num(raw.distance) ?? 0,
    elevationGain: num(raw.elevationGain) ?? 0,
    elevationLoss: num(raw.elevationLoss) ?? 0,
    estimatedDuration: num(raw.estimatedDuration) ?? 0,
    difficulty,
    isPublic: bool(raw.isPublic) ?? false,
    rating: num(raw.rating) ?? 0,
    ratingCount: num(raw.ratingCount) ?? 0,
    timesCompleted: num(raw.timesCompleted) ?? 0,
    createdAt: toDateOrNow(raw.createdAt),
  }
}

function parseRouteDifficulty(value: string | undefined): RouteDifficulty {
  switch (value) {
    case 'easy':
    case 'moderate':
    case 'hard':
    case 'expert':
      return value
    default:
      return 'moderate'
  }
}

function decodeSplit(raw: Raw, idx: number): Split {
  return {
    id: str(raw.id) ?? `split-${idx}`,
    number: num(raw.number) ?? idx + 1,
    distance: num(raw.distance) ?? 0,
    duration: num(raw.duration) ?? 0,
    pace: num(raw.pace) ?? 0,
    elevationGain: num(raw.elevationGain) ?? 0,
    elevationLoss: num(raw.elevationLoss) ?? 0,
    averageHeartRate: num(raw.averageHeartRate),
    averageCadence: num(raw.averageCadence),
  }
}

function decodeSplits(v: unknown): Split[] {
  if (!Array.isArray(v)) return []
  return v
    .map((it, idx) => {
      const r = asRaw(it)
      return r ? decodeSplit(r, idx) : undefined
    })
    .filter((s): s is Split => s != null)
}

function decodeHRSamples(v: unknown): HeartRateSample[] {
  if (!Array.isArray(v)) return []
  const out: HeartRateSample[] = []
  for (const it of v) {
    const r = asRaw(it)
    if (!r) continue
    const bpm = num(r.bpm)
    if (bpm == null) continue
    out.push({ bpm, timestamp: toDateOrNow(r.timestamp) })
  }
  return out
}

function decodeCadenceSamples(v: unknown): CadenceSample[] {
  if (!Array.isArray(v)) return []
  const out: CadenceSample[] = []
  for (const it of v) {
    const r = asRaw(it)
    if (!r) continue
    const spm = num(r.spm)
    if (spm == null) continue
    out.push({ spm, timestamp: toDateOrNow(r.timestamp) })
  }
  return out
}

function decodeHRZones(raw: unknown): HeartRateZoneDistribution | undefined {
  const r = asRaw(raw)
  if (!r) return undefined
  const z1 = num(r.zone1Seconds) ?? 0
  const z2 = num(r.zone2Seconds) ?? 0
  const z3 = num(r.zone3Seconds) ?? 0
  const z4 = num(r.zone4Seconds) ?? 0
  const z5 = num(r.zone5Seconds) ?? 0
  if (z1 + z2 + z3 + z4 + z5 === 0) return undefined
  return { zone1Seconds: z1, zone2Seconds: z2, zone3Seconds: z3, zone4Seconds: z4, zone5Seconds: z5 }
}

function decodePaceZones(raw: unknown): PaceZoneDistribution | undefined {
  const r = asRaw(raw)
  if (!r) return undefined
  const easy = num(r.easySeconds) ?? 0
  const moderate = num(r.moderateSeconds) ?? 0
  const tempo = num(r.tempoSeconds) ?? 0
  const threshold = num(r.thresholdSeconds) ?? 0
  const sprint = num(r.sprintSeconds) ?? 0
  if (easy + moderate + tempo + threshold + sprint === 0) return undefined
  return {
    easySeconds: easy,
    moderateSeconds: moderate,
    tempoSeconds: tempo,
    thresholdSeconds: threshold,
    sprintSeconds: sprint,
  }
}

/**
 * Decode a workout document. Pass `userIdFallback` (the owner uid from the
 * Firestore path) when iterating per-user collections so that workouts without
 * an explicit `userId` field still link correctly to /workouts/:owner/:id.
 */
export function decodeWorkout(raw: Raw, id: string, userIdFallback?: string): WorkoutSession {
  return {
    id,
    userId: str(raw.userId) ?? userIdFallback ?? '',
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
    routeCoordinates: decodeRoutePoints(raw.routeCoordinates),
    splits: decodeSplits(raw.splits),
    heartRateZones: decodeHRZones(raw.heartRateZones),
    paceZones: decodePaceZones(raw.paceZones),
  }
}

export interface WorkoutSamplesPayload {
  heartRateSamples: HeartRateSample[]
  cadenceSamples: CadenceSample[]
}

export function decodeSamplesPayload(raw: Raw): WorkoutSamplesPayload {
  return {
    heartRateSamples: decodeHRSamples(raw.heartRateSamples),
    cadenceSamples: decodeCadenceSamples(raw.cadenceSamples),
  }
}

// MARK: - Substances

export function decodeSubstance(raw: Raw, id: string): SubstanceEntry {
  const date = toDateOrNow(raw.date)
  return {
    id: str(raw.id) ?? id,
    userId: str(raw.userId) ?? '',
    kind: (str(raw.kind) as SubstanceKind | undefined) ?? 'other',
    name: str(raw.name),
    method: str(raw.method) as SubstanceMethod | undefined,
    amount: num(raw.amount),
    unit: str(raw.unit),
    notes: str(raw.notes),
    isPrivate: bool(raw.isPrivate) ?? true,
    date,
    createdAt: toDate(raw.createdAt) ?? date,
    updatedAt: toDate(raw.updatedAt) ?? date,
  }
}

// MARK: - Workout social

export function decodeWorkoutKudo(raw: Raw, id: string): WorkoutKudo {
  return {
    id: str(raw.id) ?? id,
    userId: str(raw.userId) ?? id,
    userName: str(raw.userName) ?? '',
    workoutId: str(raw.workoutId) ?? '',
    createdAt: toDateOrNow(raw.createdAt),
  }
}

export function decodeWorkoutComment(raw: Raw, id: string): WorkoutComment {
  return {
    id: str(raw.id) ?? id,
    userId: str(raw.userId) ?? '',
    userName: str(raw.userName) ?? '',
    workoutId: str(raw.workoutId) ?? '',
    text: str(raw.text) ?? '',
    createdAt: toDateOrNow(raw.createdAt),
  }
}

// MARK: - Reports

export function decodeSavedReport(raw: Raw, id: string): SavedReport {
  return {
    id: str(raw.id) ?? id,
    userId: str(raw.userId) ?? '',
    topicRaw: str(raw.topicRaw) ?? 'Custom Analysis',
    title: str(raw.title) ?? str(raw.topicRaw) ?? 'Report',
    promptUsed: str(raw.promptUsed) ?? '',
    content: str(raw.content) ?? '',
    modelLabel: str(raw.modelLabel) ?? 'Claude',
    modelId: str(raw.modelId) ?? '',
    rangeStart: toDateOrNow(raw.rangeStart),
    rangeEnd: toDateOrNow(raw.rangeEnd),
    tokensUsed: num(raw.tokensUsed) ?? 0,
    createdAt: toDateOrNow(raw.createdAt),
  }
}
