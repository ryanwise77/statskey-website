// TypeScript mirrors of the iOS Firestore schemas. Field names match the
// Swift CodingKeys exactly so documents written by the iOS app decode as-is.

// MARK: - Nutrients

/**
 * Canonical USDA snake_case nutrient keys the iOS app uses. See
 * biometrics/StatsKey/Models/FoodItem.swift and USDANutrientMap.swift.
 * This is not an exhaustive list — nutrients[] may contain many more keys —
 * but these are the ones surfaced on the dashboard.
 */
export const NUTRIENT_KEYS = {
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbohydrates',
  fat: 'total_fat',
  fiber: 'dietary_fiber',
  sodium: 'sodium',
  sugars: 'total_sugars',
  addedSugars: 'added_sugars',
  saturatedFat: 'saturated_fat',
  cholesterol: 'cholesterol',
  potassium: 'potassium',
  calcium: 'calcium',
  iron: 'iron',
  vitaminD: 'vitamin_d',
  vitaminC: 'vitamin_c',
} as const

// MARK: - FoodItem (nested in Meal.items)

export type FoodSource =
  | 'manual'
  | 'camera'
  | 'photoLibrary'
  | 'barcode'
  | 'labelScan'
  | 'aiSearch'
  | 'library'
  | 'supplement'

export type ItemCategory = 'food' | 'supplement' | 'medication'

// MARK: - Trust & provenance (mirrors FoodItem.swift + NutrientProvenance.swift)

export type FoodTrustLevel = 'unknown' | 'low' | 'medium' | 'high'

export type FoodIdentityEvidence =
  | 'unknown'
  | 'userEntered'
  | 'visualRecognition'
  | 'barcodeMatch'
  | 'nutritionLabel'
  | 'groundedSearch'
  | 'savedLibrary'
  | 'sharedCache'

export type FoodNutrientEvidence =
  | 'unknown'
  | 'userEntered'
  | 'visualEstimate'
  | 'barcodeDatabase'
  | 'nutritionLabel'
  | 'groundedSource'
  | 'savedLibrary'
  | 'sharedCache'
  | 'aiEstimated'

export type FoodQuantityEvidence =
  | 'unknown'
  | 'userEntered'
  | 'userAdjusted'
  | 'visualEstimate'
  | 'labelServingAssumed'
  | 'databaseServingAssumed'
  | 'savedServingReused'

/**
 * Separates "what food/nutrients did we identify?" from "how sure are we about
 * the amount eaten?" Mirrors FoodTrustMetadata in
 * biometrics/StatsKey/Models/FoodItem.swift so iOS decodes web records natively.
 */
export interface FoodTrustMetadata {
  identityEvidence: FoodIdentityEvidence
  nutrientEvidence: FoodNutrientEvidence
  quantityEvidence: FoodQuantityEvidence
  identityConfidence: FoodTrustLevel
  nutrientConfidence: FoodTrustLevel
  quantityConfidence: FoodTrustLevel
  notes: string[]
}

/**
 * The AI's photo portion (amount-eaten) estimate. The spread between the
 * independent gram drafts is a confidence interval on the portion, kept
 * separate from the per-nutrient source error. Mirrors PortionEstimate.
 */
export interface PortionEstimate {
  draftGrams?: number[]
  lowGram?: number
  highGram?: number
}

export interface FoodItem {
  id: string
  name: string
  brand?: string
  servingSize: number
  servingUnit: string
  barcode?: string
  nutrients: Record<string, number>
  baseNutrients?: Record<string, number>
  baseServingSize?: number
  baseServingUnit?: string
  gramWeight?: number
  gramsPerCup?: number
  isFavorite: boolean
  hiddenFromFriends?: boolean
  useCount: number
  lastUsed?: Date
  source: FoodSource
  itemCategory: ItemCategory
  notes?: string
  geminiExplanation?: string
  /** True once the user confirms/adjusts the amount eaten — removes portion
   *  uncertainty for that item (mirrors FoodItem.scaled(by:)). */
  quantityWasUserAdjusted?: boolean
  trustMetadata?: FoodTrustMetadata
  /** Nutrient keys filled by the AI micronutrient estimator (badged estimated). */
  aiEstimatedNutrientKeys?: string[]
  /** Per-key data source for each filled nutrient ("usda", "web", "web_micro",
   *  "web_per100", "ai_grounded"). */
  nutrientFillSources?: Record<string, string>
  /** Per-key coarse confidence ("high"/"medium"). Firestore key: `nutrientConfidence`. */
  nutrientFillConfidence?: Record<string, string>
  /** Per-key estimated error (percent) for each filled nutrient. */
  nutrientErrPct?: Record<string, number>
  enrichmentMethod?: string
  enrichmentCitation?: string
  enrichmentSchemaVersion?: number
  portionEstimate?: PortionEstimate
  createdAt: Date
  updatedAt: Date
  consumedAt?: Date
}

// MARK: - Meal

export type AnalysisMode = 'photo' | 'text' | 'barcode' | 'manual' | 'quick'

export interface GlucoseResponse {
  preReading?: number
  postReading?: number
  peakReading?: number
  timeToReturn?: number
  score?: number
}

export interface Meal {
  id: string
  userId: string
  name?: string
  items: FoodItem[]
  date: Date
  multiplier: number
  isFavorite: boolean
  glucoseResponse?: GlucoseResponse
  photoURLs?: string[]
  analysisMode?: AnalysisMode
  /** Friend-privacy snapshot of totals when some items are hidden from friends. */
  totalNutrientsOverride?: Record<string, number>
  hiddenItemCount?: number
  /** Pro/Pro+ one-line AI meal summary, generated on demand. */
  aiExplanation?: string
  /** Pro/Pro+ per-food AI insight, keyed by FoodItem.id. */
  aiItemInsights?: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

// MARK: - Water

export interface WaterDoc {
  amount: number // fluid ounces
  date: Date
}

/** Single timestamped water record at users/{uid}/waterEntries/{id}.
 *  Mirrors biometrics/StatsKey/Models/WaterEntry.swift. */
export interface WaterEntry {
  id: string
  userId: string
  amount: number // fluid ounces
  date: Date
  createdAt: Date
  updatedAt: Date
}

// MARK: - Weight (users/{uid}/weights — validated field list in firestore.rules)

export interface WeightEntry {
  id: string
  weightLbs: number
  bodyFatPercent?: number
  muscleMassKg?: number
  date: Date
  source?: string
}

// MARK: - MacroTargets (users/{uid}/settings/macroTargets)

export type NutritionGoalType = 'maintain' | 'fatLoss' | 'muscleGain' | 'performance'
export type NutritionCarbPreference = 'balanced' | 'performance' | 'lowerCarb' | 'ketogenic'
export type ExerciseCalorieStrategy = 'activityInclusive' | 'addAboveBaseline' | 'fixedBudget'

export interface MacroTargets {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  water: number // fl oz
  isAIAdaptive: boolean
  isWaterCustom: boolean
  goalType: NutritionGoalType
  weeklyWeightChangeLbs: number
  proteinGramsPerKg: number
  fatPercentage: number
  carbPreference: NutritionCarbPreference
  exerciseCalorieStrategy: ExerciseCalorieStrategy
  calorieFloor: number
  usesNetCarbs: boolean
}

export const DEFAULT_MACRO_TARGETS: MacroTargets = {
  calories: 2000,
  protein: 50,
  carbs: 250,
  fat: 65,
  fiber: 30,
  water: 64,
  isAIAdaptive: true,
  isWaterCustom: false,
  goalType: 'maintain',
  weeklyWeightChangeLbs: 0,
  proteinGramsPerKg: 2.0,
  fatPercentage: 0.25,
  carbPreference: 'balanced',
  exerciseCalorieStrategy: 'activityInclusive',
  calorieFloor: 0,
  usesNetCarbs: false,
}

// MARK: - Glucose

export type GlucoseSource = 'Dexcom Share' | 'LibreLinkUp' | 'Nightscout' | 'Apple Health' | 'Manual'

export type GlucoseTrend = 'Rising Fast' | 'Rising' | 'Stable' | 'Falling' | 'Falling Fast'

export interface GlucoseReading {
  id: string
  value: number // mg/dL
  timestamp: Date
  source: GlucoseSource
  trend?: GlucoseTrend
}

// MARK: - WellnessEntry (users/{uid}/wellness)

export type WellnessType = 'symptom' | 'mood' | 'energy' | 'bowelMovement'

export type StoolColor =
  | 'brown'
  | 'darkBrown'
  | 'lightBrown'
  | 'yellow'
  | 'green'
  | 'black'
  | 'red'
  | 'clay'

// Bristol type is stored as an integer 1..7.
export type BristolType = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type BowelMovementSize = 'small' | 'medium' | 'large' | 'veryLarge'

export type BowelSegmentPortion = 'trace' | 'some' | 'most' | 'all'

export type BowelControlStatus = 'normal' | 'rushed' | 'hardToHold' | 'nearAccident' | 'accident'

/** One phase of a mixed bowel episode — mirrors BowelSegment in
 *  biometrics/StatsKey/Models/WellnessEntry.swift. */
export interface BowelSegment {
  id: string
  bristolType: BristolType
  portion: BowelSegmentPortion
}

export interface SymptomEntry {
  symptom: string
  /** Severity on the 0–10 numeric rating scale iOS uses (older entries were 1–5). */
  severity: number
  duration?: string
  bodyArea?: string
  triggers: string[]
}

export interface MoodEntry {
  rating: number // 1..5
  /** Perceived stress 0–10 — the gut-brain check-in pairs it with mood. */
  stress?: number
  tags: string[]
  notes?: string
}

export interface EnergyEntry {
  level: number // 1..5
  crashTime?: Date
  tags?: string[]
  notes?: string
}

export interface BowelMovementEntry {
  bristolType: BristolType
  color?: StoolColor
  /** Urgency 1–5 (Normal / Soon / Rushed / Hard to hold / Could not hold). */
  urgency?: number
  durationInSeconds?: number
  notes?: string
  estimatedSize?: BowelMovementSize
  /** iOS-only private photo attachment — preserved on web round-trips. */
  photoStoragePath?: string
  photoCreatedAt?: Date
  /** Mixed-episode phases; empty means a single episode of `bristolType`. */
  segments: BowelSegment[]
  /** "How It Passed" chips (Straining, Pain, Burning, Cramping, Gas, Bloating, Incomplete, Mucus). */
  passageSymptoms: string[]
  control?: BowelControlStatus
  /** "Cleanup & Comfort" chips (Easy cleanup, Messy, Wiped a lot, Bidet, ...). */
  cleanup: string[]
  /** "Worth Flagging" chips (Blood, Black/tarry, Pale/clay, Severe pain, Fever, Woke from sleep). */
  redFlags: string[]
  /** 0–10 burden score, persisted on save like iOS (computedGIBurdenScore). */
  giBurdenScore?: number
}

export type WellnessData =
  | { kind: 'symptom'; entry: SymptomEntry }
  | { kind: 'mood'; entry: MoodEntry }
  | { kind: 'energy'; entry: EnergyEntry }
  | { kind: 'bowelMovement'; entry: BowelMovementEntry }
  | { kind: 'sleep'; hours: number; quality: number }
  | { kind: 'hydration'; ozConsumed: number }
  | { kind: 'custom'; label: string; value: number; unit?: string }

export interface WellnessEntry {
  id: string
  userId: string
  type: WellnessType
  data: WellnessData
  mealId?: string
  notes?: string
  showInDashboardTimeline?: boolean
  date: Date
  createdAt: Date
}

// MARK: - SubstanceEntry (users/{uid}/substances)

export type SubstanceKind =
  | 'nicotine'
  | 'cannabis'
  | 'alcohol'
  | 'caffeine'
  | 'psychedelic'
  | 'other'

export type SubstanceMethod =
  | 'smoke'
  | 'vape'
  | 'edible'
  | 'drink'
  | 'oral'
  | 'sublingual'
  | 'nasal'
  | 'chew'
  | 'pouch'
  | 'patch'
  | 'pill'
  | 'tincture'
  | 'topical'
  | 'injection'
  | 'other'

export interface SubstanceEntry {
  id: string
  userId: string
  kind: SubstanceKind
  name?: string
  method?: SubstanceMethod
  amount?: number
  unit?: string
  notes?: string
  isPrivate: boolean
  date: Date
  createdAt: Date
  updatedAt: Date
}

// MARK: - WorkoutSession (users/{uid}/workoutSessions)

export type WorkoutSource = 'manual' | 'gps' | 'appleWatch' | 'healthKit' | 'imported'

/** Single GPS sample on a recorded route. Matches RoutePoint in
 *  biometrics/StatsKey/Models/WorkoutSession.swift. */
export interface RoutePoint {
  latitude: number
  longitude: number
  altitude: number // meters
  timestamp: Date
  speed: number // m/s
  heartRate?: number // bpm at this point
}

export type RouteDifficulty = 'easy' | 'moderate' | 'hard' | 'expert'

/** User-planned or imported route. Matches SavedRoute in
 *  biometrics/StatsKey/Models/Route.swift. */
export interface SavedRoute {
  id: string
  name: string
  description: string
  sportType: string
  createdBy: string
  creatorName: string
  routePoints: RoutePoint[]
  distance: number // miles
  elevationGain: number // feet
  elevationLoss: number // feet
  estimatedDuration: number // seconds
  difficulty: RouteDifficulty
  isPublic: boolean
  rating: number
  ratingCount: number
  timesCompleted: number
  createdAt: Date
}

/** Per-mile split. Matches Split. */
export interface Split {
  id: string
  number: number
  distance: number // miles
  duration: number // seconds
  pace: number // seconds/mile
  elevationGain: number // feet
  elevationLoss: number // feet
  averageHeartRate?: number
  averageCadence?: number
}

export interface HeartRateSample {
  timestamp: Date
  bpm: number
}

export interface CadenceSample {
  timestamp: Date
  spm: number
}

/** Cumulative seconds spent in each HR zone. Matches HeartRateZoneDistribution. */
export interface HeartRateZoneDistribution {
  zone1Seconds: number
  zone2Seconds: number
  zone3Seconds: number
  zone4Seconds: number
  zone5Seconds: number
}

export interface PaceZoneDistribution {
  easySeconds: number
  moderateSeconds: number
  tempoSeconds: number
  thresholdSeconds: number
  sprintSeconds: number
}

export interface WorkoutSession {
  id: string
  userId: string
  title: string
  sportType: string
  startDate: Date
  endDate?: Date
  duration: number // seconds
  movingTime: number // seconds
  pausedTime?: number // explicit manual/automatic pause seconds
  distance: number // miles
  elevationGain: number // feet
  elevationLoss: number // feet
  calories: number
  averagePace: number // seconds/mile
  bestPace: number
  averageSpeed: number // mph
  maxSpeed: number
  averageHeartRate: number // bpm
  maxHeartRate: number
  averageCadence: number
  averagePower?: number
  maxPower?: number
  averageStrideLength?: number
  averageVerticalOscillation?: number
  averageGroundContactTime?: number
  heartRateRecoveryOneMinute?: number
  workoutEffortScore?: number
  isFavorite: boolean
  notes?: string
  perceivedEffort?: number
  relativeEffort: number
  gradeAdjustedPace: number
  photoURLs: string[]
  source: WorkoutSource
  isIndoor: boolean
  healthKitUUID?: string
  structuredWorkoutId?: string
  recordingMode: string
  createdAt: Date

  /** Inline route — iOS downsamples to ≤200 points. Full route lives in
   *  the `attachments/route` subdocument; see useWorkoutRoute. */
  routeCoordinates: RoutePoint[]
  splits: Split[]
  heartRateZones?: HeartRateZoneDistribution
  paceZones?: PaceZoneDistribution
}

export interface WorkoutTimingBreakdown {
  elapsed: number
  moving: number
  paused: number
  swimRest: number
  hasPause: boolean
  hasSwimRest: boolean
  pauseBasis: 'explicit' | 'movingGap' | 'unavailable'
}

/**
 * Separates true workout pauses from sport-specific active-time gaps.
 * Pool-swim moving time is the length ledger, so duration - movingTime is
 * rest at the wall—not evidence that the swimmer paused the recording.
 */
export function workoutTiming(workout: Pick<
  WorkoutSession,
  'sportType' | 'isIndoor' | 'startDate' | 'endDate' | 'duration' | 'movingTime' | 'pausedTime'
>): WorkoutTimingBreakdown {
  const duration = Number.isFinite(workout.duration) ? Math.max(0, workout.duration) : 0
  const moving = Number.isFinite(workout.movingTime) ? Math.max(0, workout.movingTime) : 0
  const storedPause = Number.isFinite(workout.pausedTime)
    ? Math.max(0, workout.pausedTime ?? 0)
    : 0
  const explicitPause = storedPause
  const hasExplicitPause = explicitPause > 5
  const usesSwimLengthLedger = workout.sportType === 'swimming' && workout.isIndoor
  const swimRest = usesSwimLengthLedger && moving > 0 ? Math.max(0, duration - moving) : 0
  const movingGap = !usesSwimLengthLedger && moving > 0 ? Math.max(0, duration - moving) : 0
  const hasMovingGap = movingGap > 5
  const paused = hasExplicitPause ? explicitPause : (hasMovingGap ? movingGap : 0)

  return {
    elapsed: duration + explicitPause,
    moving,
    paused,
    swimRest,
    hasPause: paused > 5,
    hasSwimRest: swimRest > 5,
    pauseBasis: hasExplicitPause ? 'explicit' : (hasMovingGap ? 'movingGap' : 'unavailable'),
  }
}

/** Sport types that use GPS. Mirrors SportType.usesGPS in Swift. */
const GPS_SPORTS = new Set([
  'running', 'walking', 'cycling', 'swimming', 'hiking',
  'trailRunning', 'mountainBiking', 'roadCycling',
  'rowing', 'skiing', 'snowboarding', 'surfing',
  'paddleboarding', 'kayaking', 'skateboarding', 'golf',
])

const PACE_SPORTS = new Set(['running', 'walking', 'hiking', 'trailRunning', 'swimming'])

const SPEED_SPORTS = new Set([
  'cycling', 'roadCycling', 'mountainBiking',
  'skiing', 'snowboarding', 'surfing', 'skateboarding',
])

export function sportUsesGPS(sportType: string): boolean {
  return GPS_SPORTS.has(sportType)
}

export function sportUsesPace(sportType: string): boolean {
  return PACE_SPORTS.has(sportType)
}

export function sportUsesSpeed(sportType: string): boolean {
  return SPEED_SPORTS.has(sportType)
}

/** Display name + accent color, mirroring SportType in Swift. */
export function sportDisplayName(sportType: string): string {
  switch (sportType) {
    case 'running': return 'Run'
    case 'walking': return 'Walk'
    case 'cycling': return 'Ride'
    case 'swimming': return 'Swim'
    case 'hiking': return 'Hike'
    case 'trailRunning': return 'Trail Run'
    case 'mountainBiking': return 'Mountain Bike'
    case 'roadCycling': return 'Road Ride'
    case 'rowing': return 'Row'
    case 'elliptical': return 'Elliptical'
    case 'stairStepper': return 'Stair Stepper'
    case 'yoga': return 'Yoga'
    case 'pilates': return 'Pilates'
    case 'strengthTraining': return 'Strength'
    case 'hiit': return 'HIIT'
    case 'crossfit': return 'CrossFit'
    case 'basketball': return 'Basketball'
    case 'soccer': return 'Soccer'
    case 'tennis': return 'Tennis'
    case 'golf': return 'Golf'
    case 'volleyball': return 'Volleyball'
    case 'skiing': return 'Ski'
    case 'snowboarding': return 'Snowboard'
    case 'surfing': return 'Surf'
    case 'skateboarding': return 'Skateboard'
    case 'paddleboarding': return 'SUP'
    case 'kayaking': return 'Kayak'
    case 'rockClimbing': return 'Climb'
    case 'dance': return 'Dance'
    case 'martialArts': return 'Martial Arts'
    case 'boxing': return 'Boxing'
    case 'other': return 'Workout'
    default: return sportType.charAt(0).toUpperCase() + sportType.slice(1)
  }
}

// MARK: - Workout social (users/{owner}/workoutSessions/{id}/kudos|comments)

export interface WorkoutKudo {
  id: string
  userId: string
  userName: string
  workoutId: string
  createdAt: Date
}

export interface WorkoutComment {
  id: string
  userId: string
  userName: string
  workoutId: string
  text: string
  createdAt: Date
}

// MARK: - Deep Dive reports (users/{uid}/reports + reportJobs)

/** Raw topic strings match ReportTopic raw values in
 *  biometrics/StatsKey/Models/AIContext.swift. */
export const REPORT_TOPICS = [
  'GI & Digestion',
  'Nutrition Deep Dive',
  'Training & Performance',
  'Recovery & Wellness',
  'Body Composition',
  'Custom Analysis',
] as const

export type ReportTopic = (typeof REPORT_TOPICS)[number]

export interface SavedReport {
  id: string
  userId: string
  topicRaw: string
  title: string
  promptUsed: string
  content: string
  modelLabel: string
  modelId: string
  rangeStart: Date
  rangeEnd: Date
  tokensUsed: number
  createdAt: Date
}

export type ReportJobStatus = 'queued' | 'running' | 'done' | 'error'

export interface ReportJobState {
  status: ReportJobStatus
  error?: string
}

export function sportAccentColor(sportType: string): string {
  switch (sportType) {
    case 'running':
    case 'trailRunning':
      return '#FC5200'
    case 'cycling':
    case 'roadCycling':
    case 'mountainBiking':
      return '#339AF0'
    case 'swimming': return '#22B8CF'
    case 'hiking': return '#51CF66'
    case 'yoga':
    case 'pilates':
      return '#B5A0E8'
    case 'strengthTraining':
    case 'crossfit':
      return '#FF6B6B'
    default: return '#00BFA5'
  }
}
