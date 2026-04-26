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
}
