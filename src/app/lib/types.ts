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
  useCount: number
  lastUsed?: Date
  source: FoodSource
  itemCategory: ItemCategory
  notes?: string
  geminiExplanation?: string
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
  createdAt: Date
  updatedAt: Date
}

// MARK: - Water

export interface WaterDoc {
  amount: number // fluid ounces
  date: Date
}

// MARK: - MacroTargets (users/{uid}/settings/macroTargets)

export interface MacroTargets {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  water: number // fl oz
  isAIAdaptive: boolean
  isWaterCustom: boolean
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

export interface SymptomEntry {
  symptom: string
  severity: number // 1..5
  duration?: string
  bodyArea?: string
  triggers: string[]
}

export interface MoodEntry {
  rating: number // 1..5
  tags: string[]
  notes?: string
}

export interface EnergyEntry {
  level: number // 1..5
  crashTime?: Date
  notes?: string
}

export interface BowelMovementEntry {
  bristolType: BristolType
  color?: StoolColor
  urgency?: number
  durationInSeconds?: number
  notes?: string
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
