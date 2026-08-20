import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check'
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyD7b9XKxV0Z7qdcdgMEVuE-fTTIoYsLCpc',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'statskey.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'statskey',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'statskey.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1081412767986',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:1081412767986:web:15dbdf5870c78be674c06b',
}

const PUBLIC_HISTORY_START_DAY = '2025-09-01'
const PUBLIC_HISTORY_START_MONTH = '2025-09'
const PUBLIC_HISTORY_START_LABEL = 'September 2025'
const FOUNDER_JOURNEY_TIME_ZONE = 'America/Chicago'
const NUTRITION_RANGE_DAYS = [7, 14, 30, 90]
const WORKOUT_PAGE_SIZE = 60
const WORKOUT_VISIBLE_STEP = 12
const MEAL_PAGE_SIZE = 50
const RANGE_KEYS = {
  week: 'last7Days',
  month: 'last30Days',
  quarter: 'last90Days',
  year: 'last365Days',
  all: 'allTime',
}
const RANGE_LABELS = {
  week: 'Week',
  month: 'Month',
  quarter: '3M',
  year: 'Year',
  all: 'All',
}
const SPORT_LABELS = {
  running: 'Run',
  trailRunning: 'Trail Run',
  cycling: 'Ride',
  roadCycling: 'Road Ride',
  mountainBiking: 'Mountain Bike',
  swimming: 'Swim',
  walking: 'Walk',
  hiking: 'Hike',
  strengthTraining: 'Strength',
  yoga: 'Yoga',
  hiit: 'HIIT',
}
const SPORT_SYMBOLS = {
  running: 'run',
  trailRunning: 'run',
  swimming: 'swim',
  cycling: 'bike',
  roadCycling: 'bike',
  mountainBiking: 'bike',
  walking: 'walk',
  hiking: 'mountain',
  strengthTraining: 'dumbbell',
  yoga: 'figure',
  hiit: 'figure',
}
const FITNESS_METRICS = {
  distance: { label: 'Distance', icon: 'route' },
  duration: { label: 'Duration', icon: 'clock' },
  calories: { label: 'Calories', icon: 'flame' },
  elevation: { label: 'Elevation', icon: 'elevation' },
}
const FITNESS_CHART_STYLES = {
  bars: { label: 'Bars', icon: 'bars' },
  line: { label: 'Line', icon: 'line' },
  area: { label: 'Area', icon: 'area' },
}
const NUTRIENT_COLORS = {
  strong: '#34c759',
  within: '#34c759',
  near: '#1676d2',
  watch: '#ff9f0a',
  limited: '#8e8e93',
  recorded: '#0a84ff',
}
const DAILY_MACRO_TARGETS = {
  calories: 2500,
  protein: 180,
  carbohydrates: 300,
  total_fat: 90,
  dietary_fiber: 38,
  water: 80,
}
const NUTRIENT_DAILY_VALUES = {
  total_fat: 78,
  saturated_fat: 20,
  cholesterol: 300,
  sodium: 2300,
  carbohydrates: 275,
  dietary_fiber: 28,
  protein: 50,
  vitamin_d: 20,
  calcium: 1300,
  iron: 18,
  potassium: 4700,
  vitamin_a: 900,
  vitamin_c: 90,
  vitamin_e: 15,
  vitamin_k: 120,
  vitamin_b1: 1.2,
  vitamin_b2: 1.3,
  vitamin_b3: 16,
  vitamin_b5: 5,
  vitamin_b6: 1.3,
  vitamin_b7: 30,
  vitamin_b9: 400,
  vitamin_b12: 2.4,
  choline: 550,
  magnesium: 420,
  phosphorus: 1250,
  zinc: 11,
  copper: 0.9,
  manganese: 2.3,
  selenium: 55,
  iodine: 150,
}
const STANDARD_NUTRIENT_IDS = new Set([
  'calories', 'total_fat', 'saturated_fat', 'trans_fat', 'cholesterol',
  'sodium', 'carbohydrates', 'dietary_fiber', 'total_sugars', 'protein',
  'vitamin_d', 'calcium', 'iron', 'potassium',
])
const SOURCE_META = {
  usda: { label: 'USDA FoodData Central', confidence: 'full', error: 0, estimated: false, filled: true },
  usda_branded: { label: 'USDA branded product record', confidence: 'full', error: 7, estimated: false, filled: true },
  usda_analog: { label: 'USDA comparable food', confidence: 'medium', error: 25, estimated: true, filled: true },
  web: { label: 'Product label', confidence: 'high', error: 7, estimated: true, filled: true },
  product_claim: { label: 'Product label', confidence: 'high', error: 0, estimated: false, filled: true },
  ingredient_estimate: { label: 'Ingredient-constrained estimate', confidence: 'medium', error: 30, estimated: true, filled: true },
  web_micro: { label: 'Web nutrition source', confidence: 'medium', error: 12, estimated: true, filled: true },
  web_per100: { label: 'Web reference (per 100g)', confidence: 'medium', error: 8, estimated: true, filled: true },
  ai_grounded: { label: 'Grounded nutrition estimate', confidence: 'medium', error: 12, estimated: true, filled: true },
  barcode: { label: 'Barcode database', confidence: 'full', error: 0, estimated: false, filled: false },
  labelScan: { label: 'Nutrition label', confidence: 'full', error: 0, estimated: false, filled: false },
  library: { label: 'Saved food', confidence: 'high', error: 0, estimated: false, filled: false },
  manual: { label: 'You entered', confidence: 'full', error: 0, estimated: false, filled: false },
  aiSearch: { label: 'Intelligent search estimate', confidence: 'medium', error: 12, estimated: true, filled: false },
  camera: { label: 'Photo estimate', confidence: 'medium', error: 15, estimated: true, filled: false },
  photoLibrary: { label: 'Photo estimate', confidence: 'medium', error: 15, estimated: true, filled: false },
  unknown: { label: 'Source not recorded', confidence: 'unknown', error: 0, estimated: true, filled: false },
}
const CONFIDENCE_META = {
  full: { label: 'Authoritative', short: 'Authoritative', score: 1, color: '#00bfa5', icon: 'seal' },
  high: { label: 'High confidence', short: 'High', score: 0.9, color: '#339af0', icon: 'check' },
  medium: { label: 'Medium confidence', short: 'Medium', score: 0.6, color: '#ffa94d', icon: 'sparkles' },
  low: { label: 'Low confidence', short: 'Low', score: 0.35, color: '#ff6b6b', icon: 'question' },
  unknown: { label: 'Unverified', short: 'Unverified', score: 0.5, color: '#8e8e93', icon: 'question' },
}

const state = {
  root: null,
  workouts: [],
  allWorkouts: null,
  workoutCursor: null,
  workoutsLoading: false,
  workoutHistoryExhausted: false,
  visibleWorkoutCount: WORKOUT_VISIBLE_STEP,
  workoutsError: null,
  meals: [],
  mealCursor: null,
  mealHistoryLoading: false,
  mealHistoryExhausted: false,
  mealHistoryError: null,
  plan: null,
  journey: null,
  source: 'connecting',
  range: 'year',
  fitnessMetric: 'distance',
  fitnessChartStyle: 'bars',
  fitnessMenu: null,
  nutritionRangeDays: 30,
  includeToday: false,
  runningView: 'home',
  selectedWorkout: null,
  selectedNutrient: null,
  mealsView: 'home',
  selectedMeal: null,
  selectedMealDay: null,
  expandedMealId: null,
  mealExpansionInitialized: false,
  dayNutrientCategory: 'All',
  selectedMealItemIndex: null,
  selectedMealNutrientKey: null,
  mealsReturnView: 'home',
  sourceReturnView: 'detail',
  mealsReturnScrollTop: 0,
  route: null,
  routeLoading: false,
  connected: false,
  unsubscribeRoot: null,
  unsubscribeWorkouts: null,
  unsubscribeMeals: null,
  unsubscribePlan: null,
  unsubscribeJourney: null,
  unsubscribeRoute: null,
  journeyWeekId: null,
  journeyWeekTimer: null,
}

let elements = {}
let database = null
let pageScrollFrame = null
let navigationSettleTimer = null
let pausePageLoadingUntil = 0

const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const positiveNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const integer = (value) => Math.round(number(value)).toLocaleString()

const escapeHTML = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const timestampDate = (value) => {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const dayDate = (day) => {
  const parsed = new Date(`${day}T12:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const shiftDay = (day, amount) => {
  const parsed = dayDate(day)
  if (!parsed) return day
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return parsed.toISOString().slice(0, 10)
}

const zonedDay = (date = new Date(), timeZone = FOUNDER_JOURNEY_TIME_ZONE) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    )
    return `${values.year}-${values.month}-${values.day}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

const founderJourneyWeek = (now = new Date()) => {
  const timeZone = state.root?.timeZone || FOUNDER_JOURNEY_TIME_ZONE
  const start = dayDate(PUBLIC_HISTORY_START_DAY)
  const today = dayDate(zonedDay(now, timeZone))
  const elapsedWeeks = Math.max(
    0,
    Math.floor((today.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
  )
  const weekNumber = elapsedWeeks + 1
  const weekStartDay = shiftDay(PUBLIC_HISTORY_START_DAY, elapsedWeeks * 7)
  const weekId = `week-${String(weekNumber).padStart(4, '0')}`
  const published = state.journey
  const currentPublished = published?.weekId === weekId ? published : null
  return {
    startDay: PUBLIC_HISTORY_START_DAY,
    weekId,
    weekNumber,
    weekStartDay,
    weekEndDay: shiftDay(weekStartDay, 6),
    note: typeof currentPublished?.note === 'string'
      ? currentPublished.note.trim()
      : '',
  }
}

const dateLabel = (day, options = {}) => {
  const parsed = dayDate(day)
  if (!parsed) return day || 'No recorded date'
  return new Intl.DateTimeFormat('en-US', {
    month: options.short ? 'short' : 'long',
    day: 'numeric',
    year: options.year === false ? undefined : 'numeric',
    weekday: options.weekday ? 'long' : undefined,
    timeZone: 'UTC',
  }).format(parsed)
}

const monthLabel = (month, short = true) => {
  const parsed = new Date(`${month}-15T12:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime())) return month
  return new Intl.DateTimeFormat('en-US', {
    month: short ? 'short' : 'long',
    year: short ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

const todayDay = () => {
  const timeZone = state.root?.timeZone || 'America/Chicago'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const relativeUpdate = (value) => {
  const date = timestampDate(value)
  if (!date) return 'Awaiting first update'
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'Updated just now'
  if (seconds < 3600) return `Updated ${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `Updated ${Math.floor(seconds / 3600)}h ago`
  return `Updated ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)}`
}

const formatClock = (seconds) => {
  const total = Math.max(0, Math.round(number(seconds)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(number(seconds)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatPace = (seconds) => {
  const pace = number(seconds)
  if (pace <= 0) return '—'
  const rounded = Math.round(pace)
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

const formatNutrientValue = (value, unit) => {
  const amount = number(value)
  const digits = Math.abs(amount) < 10 && amount % 1 !== 0 ? 1 : 0
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit || ''}`.trim()
}

const sportLabel = (sport) => SPORT_LABELS[sport] || 'Activity'
const sportSymbol = (sport) => SPORT_SYMBOLS[sport] || 'figure'
const isRun = (workout) => ['running', 'trailRunning'].includes(workout?.sport)
const isSwim = (workout) => workout?.sport === 'swimming'

const ICON_PATHS = {
  run: '<circle cx="14.2" cy="4.5" r="2.15" fill="currentColor" stroke="none"/><path d="m12.4 8.1-2.8 3.2-3.1 1.1m5.9-4.3 3.2 2.3 3.1.2m-6.1 2.1-2.3 3.2-3.7 3.1m6-6.3 2.2 3.5 3.8 2.1"/>',
  swim: '<path d="M3 11.2c1.4 0 1.9-1.2 3.3-1.2s1.9 1.2 3.3 1.2 1.9-1.2 3.3-1.2 1.9 1.2 3.3 1.2 1.9-1.2 3.3-1.2M3 15.2c1.4 0 1.9-1.2 3.3-1.2s1.9 1.2 3.3 1.2 1.9-1.2 3.3-1.2 1.9 1.2 3.3 1.2 1.9-1.2 3.3-1.2M8.1 7.6l2.4-2.2 3.2 2.1"/><circle cx="15.9" cy="4.5" r="1.6" fill="currentColor" stroke="none"/>',
  bike: '<circle cx="6" cy="15.5" r="3.2"/><circle cx="17.7" cy="15.5" r="3.2"/><circle cx="12.4" cy="5" r="1.7" fill="currentColor" stroke="none"/><path d="m11.3 8.4-2.5 3.2 3.3 1.8 2-3.1 3.6 5.2M8.8 11.6 6 15.5m6.1-2.1h5.6"/>',
  walk: '<circle cx="12.6" cy="4.3" r="2" fill="currentColor" stroke="none"/><path d="m11.4 8-2.2 4.3-3 2m5.2-6.3 3 3.2 2.7.7m-6.6.4.5 4.1-2.7 3.7m2.7-3.7 3.6 3.5"/>',
  figure: '<circle cx="12" cy="4.2" r="2" fill="currentColor" stroke="none"/><path d="M12 7v6m0-3-4.5 2m4.5-2 4.5 2m-4.5 1-3 6m3-6 3 6"/>',
  mountain: '<path d="m2.5 19 6.2-10 3.1 4.2 2.5-3.2 7.2 9H2.5Z"/><path d="m7.2 11.5 1.5 1.1 1.5-1.2m2.6 1.9 1.5 1.2 1.4-1.1"/>',
  dumbbell: '<path d="M7 8v8m10-8v8M4 10v4m16-4v4M7 12h10M2.5 11v2m19-2v2"/>',
  route: '<circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="6" r="1.8"/><path d="M6.7 17.2c3.1-1.1 1.4-5.3 4.8-5.4 2.4-.1 2.1 3.3 4.4 2.4 1.9-.7.5-4.5 2.2-6.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4v5l3.5 2"/>',
  heart: '<path d="M12 20S3.5 15.2 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8C20.5 15.2 12 20 12 20Z" fill="currentColor" stroke="none"/>',
  elevation: '<path d="m4 17 5.2-6 3.2 3.4L17.8 8"/><path d="M14 8h3.8v3.8"/>',
  flame: '<path d="M13.2 2.8c.8 4-2.9 5-1.3 8.1 1-1.1 2.3-1.9 3.2-3.5 2.7 2.2 4.1 4.5 3.4 7.7-.7 3.2-3.2 5.3-6.5 5.3-3.8 0-6.7-2.7-6.7-6.5 0-3.1 1.8-5.3 4.2-7.4-.1 2.3.7 3.5 1.8 4.2-.3-3.1.3-5.7 1.9-7.9Z"/>',
  cadence: '<path d="M5 17.5a8.5 8.5 0 1 1 14 0"/><path d="m12 12 4.2-3.1"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  power: '<path d="m13.4 2.7-7 10h5l-.8 8.6 7-11h-5l.8-7.6Z"/>',
  bars: '<path d="M5 19V9m4 10V5m4 14v-7m4 7V3m4 16v-9"/>',
  line: '<path d="m3 17 5-5 4 2 7-8"/><path d="M15.5 6H19v3.5"/>',
  area: '<path d="m3 18 5-6 4 2 7-8v12H3Z" fill="currentColor" opacity=".18"/><path d="m3 18 5-6 4 2 7-8"/>',
  selector: '<path d="m9 8 3-3 3 3m0 8-3 3-3-3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/>',
  scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="m8.2 8.2 11 7.3M8.2 15.8l11-7.3"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2m-16.2-6.7 1.4 1.4m10.6 10.6 1.4 1.4m0-13.4-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
  moon: '<path d="M19.5 15.2A8.2 8.2 0 0 1 8.8 4.5 8.3 8.3 0 1 0 19.5 15.2Z"/>',
  snack: '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.5v4.8l3 1.8"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  fork: '<path d="M7 3v6m3-6v6M5 3v4.8A3.2 3.2 0 0 0 8.2 11v10M16 3v18m0-18c2.4 2 3.6 4.3 3.2 7H16"/>',
  drop: '<path d="M12 2.8S6.5 9.1 6.5 13.7a5.5 5.5 0 0 0 11 0C17.5 9.1 12 2.8 12 2.8Z" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M7.5 3v4M16.5 3v4M3.5 9h17M8 12h.1M12 12h.1M16 12h.1M8 16h.1M12 16h.1M16 16h.1"/>',
  ellipsis: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  document: '<rect x="5.5" y="3" width="13" height="18" rx="1.8"/><path d="M8.5 7h7M8.5 10h7M8.5 13h5M8.5 16h5"/>',
  documentChart: '<path d="M6 3.5h9l3 3V20H6Z"/><path d="M15 3.5V7h3M9 16v-3m3 3v-5m3 5v-7"/>',
  seal: '<path d="m12 2.8 2.1 1.4 2.5-.2.9 2.3 2.2 1.2-.4 2.5 1.2 2-1.5 2 .2 2.5-2.3.9-1.2 2.2-2.5-.4-2 1.2-2-1.2-2.5.4-1.2-2.2-2.3-.9.2-2.5-1.5-2 1.2-2-.4-2.5 2.2-1.2.9-2.3 2.5.2Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12 2.5 2.5 5.2-5.3"/>',
  sparkles: '<path d="M8 3.5c.3 2.7 1.8 4.2 4.5 4.5C9.8 8.3 8.3 9.8 8 12.5 7.7 9.8 6.2 8.3 3.5 8 6.2 7.7 7.7 6.2 8 3.5ZM17 12c.2 2 1.3 3.1 3.3 3.3-2 .2-3.1 1.3-3.3 3.3-.2-2-1.3-3.1-3.3-3.3 2-.2 3.1-1.3 3.3-3.3Z"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.1.9-1.1 1.7M12 16.8h.1"/>',
  waveform: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M5.5 12h2l1.3-3.5 2.2 7 1.8-5 1.3 2.5h4.4"/>',
  leaf: '<path d="M19.5 4.5C12 4.7 6 8 5.2 13.2c-.6 3.9 2.6 6.5 6 5.4 4.8-1.6 6.8-7.3 8.3-14.1Z"/><path d="M5.5 19c2.2-4.5 5.5-7.4 10-9.2"/>',
  carrot: '<path d="m10 8 6 6-6.2 6.2c-1.7 1.7-4.5-1-2.8-2.8L13.2 11"/><path d="M13.5 8.5c-.3-2.5.7-4.2 3-5M15.5 10.5c2.5-.3 4.2.7 5 3"/>',
  strength: '<path d="M8 8v8m8-8v8M5 10v4m14-4v4M8 12h8M3 11v2m18-2v2"/>',
  link: '<path d="M9.5 14.5 14.5 9m-7.8 8.3-1 1a3.2 3.2 0 0 1-4.5-4.5l3.3-3.3A3.2 3.2 0 0 1 9 10m6-1a3.2 3.2 0 0 1 4.5-.5 3.2 3.2 0 0 1 .5 4.5l-3.3 3.3a3.2 3.2 0 0 1-4.5 0"/>',
}

function uiIcon(name, className = '') {
  const path = ICON_PATHS[name] || ICON_PATHS.figure
  return `<svg class="ios-symbol ${escapeHTML(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`
}

const sportIcon = (sport, className = '') => uiIcon(sportSymbol(sport), className)

function initializeFirebase() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(
        import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY ??
          '6LdJD3YtAAAAAOFCat_cVqBoWU5G1IL7qDeFUNEp'
      ),
      isTokenAutoRefreshEnabled: true,
    })
  } catch {
    // Another StatsKey surface or Vite hot reload may already own App Check.
  }
  return getFirestore(app)
}

function publicRootReference() {
  return doc(database, 'publicFounderReplicas', 'founder')
}

function workoutsReference(maximum = WORKOUT_PAGE_SIZE) {
  return query(
    collection(database, 'publicFounderReplicas', 'founder', 'workouts'),
    where('day', '>=', PUBLIC_HISTORY_START_DAY),
    orderBy('day', 'desc'),
    limit(maximum)
  )
}

function mealsReference(maximum = MEAL_PAGE_SIZE) {
  return query(
    collection(database, 'publicFounderReplicas', 'founder', 'meals'),
    orderBy('recordedAt', 'desc'),
    limit(maximum)
  )
}

function planReference() {
  return doc(database, 'publicFounderReplicas', 'founder', 'plans', 'current')
}

function journeyReference() {
  return doc(database, 'publicFounderReplicas', 'founder', 'journey', 'current')
}

function setConnectionState(source, message) {
  state.source = source
  elements.stage.classList.toggle('is-fallback', source === 'snapshot')
  elements.stage.classList.toggle('is-error', source === 'error')
  elements.status.textContent = message
  const updateValue = state.root?.updatedAt ?? state.root?.generatedAt
  elements.updated.textContent = source === 'live'
    ? relativeUpdate(updateValue)
    : source === 'snapshot'
      ? `Snapshot · ${dateLabel(state.root?.snapshotDay, { short: true })}`
      : message
}

async function loadFallback(reason = 'Published snapshot') {
  if (state.source === 'live') return
  try {
    const response = await fetch(elements.stage.dataset.source, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Fallback returned ${response.status}`)
    const payload = await response.json()
    state.root = payload.root ?? payload
    state.workouts = Array.isArray(payload.workouts) ? payload.workouts : []
    state.meals = Array.isArray(payload.meals) ? payload.meals : []
    state.workoutHistoryExhausted = true
    state.mealHistoryExhausted = true
    state.plan = payload.plan ?? null
    state.journey = null
    setConnectionState('snapshot', `${reason} · live connection pending`)
  } catch (error) {
    console.error('Founder live fallback failed', error)
    state.root = {
      trainingPublished: false,
      nutritionPublished: false,
      mealsPublished: false,
      trainingPlanPublished: false,
      snapshotDay: null,
    }
    state.workouts = []
    state.meals = []
    state.plan = null
    state.journey = null
    setConnectionState('error', 'Live record temporarily unavailable')
  }
  render()
}

function connectLiveRecord() {
  if (state.connected) return
  state.connected = true
  try {
    database = initializeFirebase()
  } catch (error) {
    console.error('Founder live Firebase initialization failed', error)
    void loadFallback('Published snapshot')
    return
  }

  let rootResolved = false
  const fallbackTimer = window.setTimeout(() => {
    if (!rootResolved) void loadFallback('Published snapshot')
  }, 4500)

  state.unsubscribeRoot = onSnapshot(
    publicRootReference(),
    (snapshot) => {
      rootResolved = true
      window.clearTimeout(fallbackTimer)
      if (!snapshot.exists()) {
        void loadFallback('Published snapshot')
        return
      }
      state.root = { ...snapshot.data(), id: snapshot.id }
      setConnectionState('live', 'Live from Ryan’s StatsKey record')
      render()
    },
    (error) => {
      rootResolved = true
      window.clearTimeout(fallbackTimer)
      console.warn('Founder live root unavailable', error.code)
      void loadFallback('Published snapshot')
    }
  )

  state.unsubscribeWorkouts = onSnapshot(
    workoutsReference(),
    (snapshot) => {
      const liveWorkouts = snapshot.docs
        .map((entry) => ({ ...entry.data(), workoutId: entry.id }))
        .filter((workout) => !workout.day || workout.day >= PUBLIC_HISTORY_START_DAY)
        .sort(compareRecorded)
      state.workouts = liveWorkouts
      if (state.allWorkouts) {
        state.allWorkouts = mergeRecords(state.allWorkouts, liveWorkouts, 'workoutId')
      } else {
        state.workoutCursor = snapshot.docs.at(-1) ?? null
        state.workoutHistoryExhausted = snapshot.size < WORKOUT_PAGE_SIZE
      }
      if (state.source === 'live') {
        renderRunning()
        renderPerformanceSummary()
      }
    },
    (error) => console.warn('Founder live workouts unavailable', error.code)
  )

  state.unsubscribeMeals = onSnapshot(
    mealsReference(),
    (snapshot) => {
      const historyWasLoaded = state.meals.length > MEAL_PAGE_SIZE
      const liveMeals = snapshot.docs
        .map((entry) => ({ ...entry.data(), mealId: entry.id }))
        .filter((meal) => !meal.day || meal.day >= PUBLIC_HISTORY_START_DAY)
        .sort(compareRecorded)
      if (!historyWasLoaded) {
        state.mealCursor = snapshot.docs.at(-1) ?? null
        state.mealHistoryExhausted = snapshot.size < MEAL_PAGE_SIZE
      }
      state.meals = historyWasLoaded
        ? mergeRecords(state.meals, liveMeals, 'mealId')
        : liveMeals
      if (state.source === 'live') {
        renderMeals()
        renderPerformanceSummary()
      }
    },
    (error) => {
      console.warn('Founder live meals unavailable', error.code)
      state.mealHistoryError = 'The live meal record is temporarily unavailable.'
      renderMeals()
    }
  )

  state.unsubscribePlan = onSnapshot(
    planReference(),
    (snapshot) => {
      state.plan = snapshot.exists() ? snapshot.data() : null
      if (state.source === 'live') {
        renderPlan()
        renderPerformanceSummary()
      }
    },
    (error) => {
      console.warn('Founder live plan unavailable', error.code)
      state.plan = null
      renderPlan()
    }
  )

  state.unsubscribeJourney = onSnapshot(
    journeyReference(),
    (snapshot) => {
      state.journey = snapshot.exists() ? snapshot.data() : null
      if (state.source === 'live') renderPlan()
    },
    (error) => {
      console.warn('Founder journey note unavailable', error.code)
      state.journey = null
      renderPlan()
    }
  )

  state.journeyWeekId = founderJourneyWeek().weekId
  state.journeyWeekTimer = window.setInterval(() => {
    const nextWeekId = founderJourneyWeek().weekId
    if (nextWeekId === state.journeyWeekId) return
    state.journeyWeekId = nextWeekId
    renderPlan()
  }, 60 * 1000)
}

function compareRecorded(left, right) {
  const day = String(right.day || '').localeCompare(String(left.day || ''))
  if (day !== 0) return day
  const minute = (record) => {
    const projected = Number(record?.startMinute)
    if (Number.isFinite(projected)) return projected
    const match = String(record?.timeLabel || '')
      .trim()
      .match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
    if (!match) return 0
    const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)
    return hour * 60 + Number(match[2])
  }
  const time = minute(right) - minute(left)
  if (time !== 0) return time
  const rightTime = timestampDate(right.recordedAt)?.getTime() ||
    timestampDate(right.startedAt)?.getTime() ||
    0
  const leftTime = timestampDate(left.recordedAt)?.getTime() ||
    timestampDate(left.startedAt)?.getTime() ||
    0
  return rightTime - leftTime
}

function mergeRecords(current, incoming, key) {
  const records = new Map(
    [...current, ...incoming]
      .filter((item) => item?.[key])
      .map((item) => [item[key], item])
  )
  return Array.from(records.values()).sort(compareRecorded)
}

function rangeStats(range = state.range) {
  const key = RANGE_KEYS[range] || RANGE_KEYS.year
  if (key === 'allTime') return publicHistorySummary()
  return state.root?.training?.periods?.[key] ?? {}
}

function publicHistoryMonths() {
  return (state.root?.training?.monthlyMileage ?? [])
    .filter((month) => String(month.month) >= PUBLIC_HISTORY_START_MONTH)
}

function publicHistorySummary() {
  const months = publicHistoryMonths()
  const projected = state.root?.training?.allTime ?? {}
  const monthlyMiles = months.reduce((sum, month) => sum + number(month.runningMiles), 0)
  const monthlyRuns = months.reduce((sum, month) => sum + number(month.activities), 0)
  const monthlyHours = months.reduce((sum, month) => sum + number(month.activeHours), 0)
  return {
    runningMiles: Number.isFinite(Number(projected.runningMiles))
      ? number(projected.runningMiles)
      : monthlyMiles,
    runningActivities: number(projected.runningActivities) || monthlyRuns,
    activeHours: number(projected.activeHours) || monthlyHours,
    activities: number(projected.activities) ||
      state.workouts.filter((workout) => workout.day >= PUBLIC_HISTORY_START_DAY).length,
    activeDays: number(projected.activeDays),
    firstDay: PUBLIC_HISTORY_START_DAY,
    latestDay: projected.latestDay,
  }
}

function publicHistoryWeeklyRate(history = publicHistorySummary()) {
  const start = dayDate(PUBLIC_HISTORY_START_DAY)
  const projectedEnd = dayDate(history.latestDay)
  const todayString = todayDay()
  const today = dayDate(todayString)
  const updateDate = timestampDate(
    state.root?.lastTrainingUpdateAt ||
    state.root?.updatedAt
  )
  const updateDay = updateDate
    ? zonedDay(updateDate, state.root?.timeZone || FOUNDER_JOURNEY_TIME_ZONE)
    : null
  const boundedUpdateDay = updateDay && updateDay <= todayString
    ? dayDate(updateDay)
    : today
  const end = projectedEnd && projectedEnd > boundedUpdateDay
    ? projectedEnd
    : boundedUpdateDay
  const elapsedDays = start && end
    ? Math.max(1, (end.getTime() - start.getTime()) / 86400000)
    : 7
  const elapsedWeeks = elapsedDays / 7
  const miles = number(history.runningMiles)
  return {
    average: miles / elapsedWeeks,
    elapsedDays,
    elapsedWeeks,
    endDay: end?.toISOString().slice(0, 10) || todayDay(),
    miles,
  }
}

function currentYearSummary() {
  const year = todayDay().slice(0, 4)
  const months = publicHistoryMonths().filter((month) => month.month.startsWith(year))
  const miles = months.reduce((sum, month) => sum + number(month.runningMiles), 0)
  const activities = months.reduce((sum, month) => sum + number(month.activities), 0)
  const start = new Date(`${year}-01-01T12:00:00.000Z`)
  const latest = dayDate(publicHistoryWeeklyRate().endDay)
  const now = latest?.getUTCFullYear() === Number(year)
    ? latest
    : dayDate(todayDay()) ?? new Date()
  const weeks = Math.max(1, (now.getTime() - start.getTime()) / 604800000)
  return { year, miles, activities, averagePerWeek: miles / weeks }
}

function monthSequence(startMonth, endMonth) {
  const values = []
  const cursor = new Date(`${startMonth}-01T12:00:00.000Z`)
  const end = new Date(`${endMonth}-01T12:00:00.000Z`)
  while (cursor <= end && values.length < 120) {
    values.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return values
}

function workoutFitnessValue(workout, metric = state.fitnessMetric) {
  if (metric === 'duration') return number(workout.movingTimeSeconds || workout.durationSeconds)
  if (metric === 'calories') return number(workout.calories)
  if (metric === 'elevation') return number(workout.elevationGainFeet)
  return number(workout.distanceMiles)
}

function formatFitnessMetric(value, metric = state.fitnessMetric, compact = false) {
  const amount = number(value)
  if (metric === 'duration') {
    if (amount >= 3600) {
      const hours = Math.floor(amount / 3600)
      const minutes = Math.round((amount % 3600) / 60)
      return compact ? `${hours}h${minutes ? ` ${minutes}m` : ''}` : `${hours}h ${minutes}m`
    }
    return formatClock(amount)
  }
  if (metric === 'calories') {
    return compact && amount >= 1000 ? `${(amount / 1000).toFixed(1)}k` : `${integer(amount)} cal`
  }
  if (metric === 'elevation') {
    return compact && amount >= 1000 ? `${(amount / 1000).toFixed(1)}k ft` : `${integer(amount)} ft`
  }
  return `${amount.toFixed(amount < 10 ? 2 : 1)} mi`
}

function mondayForDay(day) {
  const date = dayDate(day)
  if (!date) return day
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

function workoutBuckets(workouts, keyForWorkout, labelForKey) {
  const values = new Map()
  for (const workout of workouts) {
    const key = keyForWorkout(workout)
    if (!key) continue
    values.set(key, (values.get(key) || 0) + workoutFitnessValue(workout))
  }
  return Array.from(values.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value], index, entries) => ({
      key,
      label: labelForKey(key, index, entries),
      value,
    }))
}

function daySeries(endDay, count, step = 1) {
  const days = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    days.push(shiftDay(endDay, -offset * step))
  }
  return days
}

function dayValueTotals(workouts, start, end) {
  const totals = new Map()
  for (const workout of workouts) {
    if (workout.day < start || workout.day > end) continue
    totals.set(workout.day, (totals.get(workout.day) || 0) + workoutFitnessValue(workout))
  }
  return totals
}

// The live subscription only holds the newest page of workouts until history
// loads, so a dense axis must not backfill unfetched periods as zero training.
function workoutCoverageStart() {
  if (state.source !== 'live' || state.workoutHistoryExhausted) {
    return PUBLIC_HISTORY_START_DAY
  }
  let oldest = null
  for (const workout of state.allWorkouts ?? state.workouts) {
    if (workout.day && (!oldest || workout.day < oldest)) oldest = workout.day
  }
  return oldest ?? PUBLIC_HISTORY_START_DAY
}

function ensureWorkoutCoverage(startDay) {
  if (
    state.source !== 'live' ||
    state.workoutHistoryExhausted ||
    state.workoutsLoading ||
    workoutCoverageStart() <= startDay
  ) return
  window.setTimeout(() => { void loadMoreWorkouts() }, 0)
}

function timelineBuckets() {
  const today = todayDay()
  const workouts = (state.allWorkouts ?? state.workouts).filter(isRun)
  if (state.range === 'week') {
    const days = daySeries(today, 7)
    ensureWorkoutCoverage(days[0])
    const totals = dayValueTotals(workouts, days[0], today)
    return days.map((day) => ({
      key: day,
      label: new Intl.DateTimeFormat('en-US', {
        weekday: 'narrow',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(dayDate(day)),
      value: number(totals.get(day)),
      title: dateLabel(day, { short: true }),
    }))
  }
  if (state.range === 'month') {
    const allDays = daySeries(today, 30)
    ensureWorkoutCoverage(allDays[0])
    const coverage = workoutCoverageStart()
    const days = allDays.filter((day) => day >= coverage)
    const totals = dayValueTotals(workouts, days[0] ?? today, today)
    return days.map((day, index) => ({
      key: day,
      label: index % 5 === 0 || day === today ? String(Number(day.slice(-2))) : '',
      value: number(totals.get(day)),
      title: dateLabel(day, { short: true }),
    }))
  }
  if (state.range === 'quarter') {
    const allWeekStarts = daySeries(mondayForDay(today), 13, 7)
    if (state.fitnessMetric === 'distance') {
      const byWeek = new Map(
        (state.root?.training?.weeklyMileage ?? []).map((week) => [week.weekStart, number(week.runningMiles)])
      )
      return allWeekStarts.map((weekStart, index) => ({
        key: weekStart,
        label: index % 3 === 0 ? dateLabel(weekStart, { short: true, year: false }) : '',
        value: number(byWeek.get(weekStart)),
        title: `Week of ${dateLabel(weekStart, { short: true })}`,
      }))
    }
    ensureWorkoutCoverage(allWeekStarts[0])
    const coverage = workoutCoverageStart()
    const weekStarts = allWeekStarts.filter((weekStart) => weekStart >= coverage)
    const totals = dayValueTotals(workouts, weekStarts[0] ?? today, today)
    const byWeek = new Map()
    for (const [day, value] of totals) {
      const weekStart = mondayForDay(day)
      byWeek.set(weekStart, (byWeek.get(weekStart) || 0) + value)
    }
    return weekStarts.map((weekStart, index) => ({
      key: weekStart,
      label: index % 3 === 0 ? dateLabel(weekStart, { short: true, year: false }) : '',
      value: number(byWeek.get(weekStart)),
      title: `Week of ${dateLabel(weekStart, { short: true })}`,
    }))
  }

  const endMonth = today.slice(0, 7)
  const actualStart = state.range === 'all'
    ? PUBLIC_HISTORY_START_MONTH
    : (() => {
        const date = new Date(`${endMonth}-01T12:00:00.000Z`)
        date.setUTCMonth(date.getUTCMonth() - 11)
        return date.toISOString().slice(0, 7)
      })()
  const startMonth = actualStart < PUBLIC_HISTORY_START_MONTH
    ? PUBLIC_HISTORY_START_MONTH
    : actualStart
  const allMonths = monthSequence(startMonth, endMonth)
  if (state.fitnessMetric === 'distance') {
    const monthMap = new Map(publicHistoryMonths().map((month) => [month.month, month]))
    return allMonths.map((month, index) => ({
      key: month,
      label: index === 0 || index === allMonths.length - 1 || index % 3 === 0
        ? monthLabel(month)
        : '',
      value: number(monthMap.get(month)?.runningMiles),
      title: monthLabel(month, false),
    }))
  }
  ensureWorkoutCoverage(`${startMonth}-01`)
  const coverage = workoutCoverageStart()
  const months = allMonths.filter((month) => `${month}-01` >= coverage || month === endMonth)
  const byMonth = new Map(
    workoutBuckets(
      workouts.filter((workout) => workout.day.slice(0, 7) >= startMonth),
      (workout) => workout.day.slice(0, 7),
      () => ''
    ).map((bucket) => [bucket.key, bucket.value])
  )
  return months.map((month, index) => ({
    key: month,
    label: index === 0 || index === months.length - 1 || index % 3 === 0
      ? monthLabel(month)
      : '',
    value: number(byMonth.get(month)),
    title: monthLabel(month, false),
  }))
}

function chartPlot(buckets, maximum) {
  const width = 300
  const height = 104
  const points = buckets.map((bucket, index) => {
    const x = buckets.length <= 1 ? width / 2 : 4 + index / (buckets.length - 1) * (width - 8)
    const y = height - 4 - (bucket.value / maximum) * (height - 12)
    return { x, y }
  })
  const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const area = points.length
    ? `M ${points[0].x.toFixed(1)} ${height} L ${polyline.replaceAll(',', ' ')} L ${points.at(-1).x.toFixed(1)} ${height} Z`
    : ''
  return `
    <div class="ios-fitness-chart ios-fitness-chart--${escapeHTML(state.fitnessChartStyle)}" role="img">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <path class="ios-chart-grid" d="M0 34 H${width} M0 69 H${width} M0 103 H${width}"></path>
        ${state.fitnessChartStyle === 'area' ? `<path class="ios-chart-area" d="${area}"></path>` : ''}
        <polyline class="ios-chart-line" points="${polyline}"></polyline>
        ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.6"></circle>`).join('')}
      </svg>
      <div class="ios-fitness-chart-labels">
        ${buckets.map((bucket) => `<small>${escapeHTML(bucket.label)}</small>`).join('')}
      </div>
    </div>
  `
}

function fitnessTimeline() {
  const buckets = timelineBuckets()
  const maximum = Math.max(...buckets.map((bucket) => bucket.value), 1)
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0)
  const populated = buckets.filter((bucket) => bucket.value > 0)
  const peak = populated.reduce((best, bucket) => !best || bucket.value > best.value ? bucket : best, null)
  const average = populated.length ? total / populated.length : 0
  const metric = FITNESS_METRICS[state.fitnessMetric] || FITNESS_METRICS.distance
  const plot = state.fitnessChartStyle === 'bars'
    ? `
      <div class="ios-fitness-chart" role="img" aria-label="${escapeHTML(formatFitnessMetric(total))} in this range">
        <i class="ios-fitness-chart__grid ios-fitness-chart__grid--one"></i>
        <i class="ios-fitness-chart__grid ios-fitness-chart__grid--two"></i>
        ${buckets.map((bucket) => `
          <span class="ios-fitness-bar" title="${escapeHTML(bucket.title || bucket.key)} · ${escapeHTML(formatFitnessMetric(bucket.value))}">
            <i style="height:${bucket.value > 0 ? Math.max(3, bucket.value / maximum * 100) : 1}%"></i>
            <small>${escapeHTML(bucket.label)}</small>
          </span>
        `).join('')}
      </div>
    `
    : chartPlot(buckets, maximum)
  return `
    <div class="ios-fitness-timeline" aria-label="Running ${escapeHTML(metric.label.toLowerCase())} chart">
      <div class="ios-fitness-timeline__headline">
        <span>
          <small>${escapeHTML(metric.label.toUpperCase())}</small>
          <strong>${escapeHTML(formatFitnessMetric(total))}</strong>
        </span>
        <span>${peak ? `Peak ${escapeHTML(formatFitnessMetric(peak.value, state.fitnessMetric, true))}` : escapeHTML(RANGE_LABELS[state.range])}</span>
      </div>
      ${plot}
      <div class="ios-fitness-highlights">
        <span><small>Peak</small><strong>${escapeHTML(formatFitnessMetric(peak?.value || 0, state.fitnessMetric, true))}</strong></span>
        <span><small>Average</small><strong>${escapeHTML(formatFitnessMetric(average, state.fitnessMetric, true))}</strong></span>
        <span><small>Total</small><strong>${escapeHTML(formatFitnessMetric(total, state.fitnessMetric, true))}</strong></span>
      </div>
    </div>
  `
}

function chartCoordinates(
  values,
  width,
  height,
  horizontalPadding = 18,
  verticalPadding = 18,
  maximumOverride = null
) {
  const maximum = positiveNumber(maximumOverride, Math.max(...values.map(number), 1))
  const plotWidth = width - horizontalPadding * 2
  const plotHeight = height - verticalPadding * 2
  return values.map((value, index) => ({
    x: values.length <= 1
      ? width / 2
      : horizontalPadding + index / (values.length - 1) * plotWidth,
    y: height - verticalPadding - number(value) / maximum * plotHeight,
    value: number(value),
  }))
}

function longitudinalTrainingVisualizations() {
  const training = state.root?.training ?? {}
  const history = publicHistorySummary()
  const historyRate = publicHistoryWeeklyRate(history)
  const endMonth = todayDay().slice(0, 7)
  const monthMap = new Map(
    publicHistoryMonths().map((month) => [month.month, month])
  )
  const months = monthSequence(PUBLIC_HISTORY_START_MONTH, endMonth).map((month) => ({
    month,
    runningMiles: number(monthMap.get(month)?.runningMiles),
    activities: number(monthMap.get(month)?.activities),
  }))
  const monthlyBucketMiles = months.reduce((sum, month) => sum + month.runningMiles, 0)
  if (months.length && monthlyBucketMiles > 0) {
    months.at(-1).runningMiles += history.runningMiles - monthlyBucketMiles
  }
  let cumulativeMiles = 0
  const cumulative = months.map((month) => {
    cumulativeMiles += month.runningMiles
    return cumulativeMiles
  })
  const cumulativePoints = chartCoordinates(cumulative, 960, 250, 20, 22)
  const cumulativeLine = cumulativePoints
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ')
  const cumulativeArea = cumulativePoints.length
    ? `M ${cumulativePoints[0].x.toFixed(1)} 228 L ${cumulativePoints
      .map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(' L ')} L ${cumulativePoints.at(-1).x.toFixed(1)} 228 Z`
    : ''

  const weeks = (training.weeklyMileage ?? [])
    .filter((week) => (
      week.weekStart >= PUBLIC_HISTORY_START_DAY &&
      week.weekStart <= (history.latestDay || historyRate.endDay)
    ))
  const weeklyValues = weeks.map((week) => number(week.runningMiles))
  const weeklyMaximum = Math.max(...weeklyValues, historyRate.average, 1)
  const weeklyRolling = weeklyValues.map((_, index) => {
    const window = weeklyValues.slice(Math.max(0, index - 3), index + 1)
    return window.reduce((sum, value) => sum + value, 0) / window.length
  })
  const weeklyRollingPoints = chartCoordinates(
    weeklyRolling,
    960,
    250,
    18,
    24,
    weeklyMaximum
  )
  const rollingLine = weeklyRollingPoints
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ')
  const historyAverageY = 226 - historyRate.average / weeklyMaximum * 194
  const barSpace = weeks.length ? 924 / weeks.length : 0
  const barWidth = Math.max(3, barSpace - 3)
  const peakWeek = weeks.reduce((peak, week) => (
    !peak || number(week.runningMiles) > number(peak.runningMiles) ? week : peak
  ), null)
  const activeWeeks = weeks.filter((week) => number(week.runningMiles) > 0).length
  const recentFourWeekAverage = weeklyRolling.at(-1) || 0
  const activeDayRate = number(history.activities) > 0
    ? number(history.activeDays) / Math.max(
      1,
      Math.round(
        ((dayDate(historyRate.endDay)?.getTime() || Date.now()) -
          (dayDate(history.firstDay)?.getTime() || Date.now())) / 86400000
      ) + 1
    ) * 100
    : 0

  return `
    <div class="founder-viz-grid">
      <section class="founder-viz-card founder-viz-card--cumulative">
        <header>
          <span><small>LONGITUDINAL LOAD</small><strong>${cumulativeMiles.toFixed(1)} miles</strong></span>
          <em>${months.length} months · ${integer(history.runningActivities)} runs</em>
        </header>
        <svg class="founder-history-chart" viewBox="0 0 960 250" preserveAspectRatio="none" role="img" aria-label="${cumulativeMiles.toFixed(1)} cumulative running miles since September 2025">
          <defs>
            <linearGradient id="founder-cumulative-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#39a7ff" stop-opacity=".42"></stop>
              <stop offset="100%" stop-color="#39a7ff" stop-opacity=".02"></stop>
            </linearGradient>
          </defs>
          <path class="founder-chart-grid" d="M20 58 H940 M20 115 H940 M20 172 H940 M20 228 H940"></path>
          <path class="founder-chart-area" d="${cumulativeArea}"></path>
          <polyline class="founder-chart-line" points="${cumulativeLine}"></polyline>
          ${cumulativePoints.map((point, index) => `
            <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${index === cumulativePoints.length - 1 ? 5 : 3}">
              <title>${escapeHTML(monthLabel(months[index].month))}: ${cumulative[index].toFixed(1)} cumulative miles</title>
            </circle>
          `).join('')}
        </svg>
        <div class="founder-chart-axis founder-chart-axis--months" style="--founder-months:${months.length}">
          ${months.map((month, index) => `
            <span class="${index % 2 && months.length > 8 ? 'is-minor' : ''}">${escapeHTML(monthLabel(month.month))}</span>
          `).join('')}
        </div>
        <footer>
          <span><small>Measurement window</small><strong>${escapeHTML(dateLabel(PUBLIC_HISTORY_START_DAY, { short: true }))}</strong></span>
          <span><small>Active days</small><strong>${integer(history.activeDays)}</strong></span>
          <span><small>Training-day density</small><strong>${activeDayRate.toFixed(0)}%</strong></span>
        </footer>
      </section>

      <section class="founder-viz-card founder-viz-card--weekly">
        <header>
          <span><small>AVERAGE SINCE SEPTEMBER 1</small><strong>${historyRate.average.toFixed(1)} mi / week</strong></span>
          <em>${historyRate.miles.toFixed(1)} miles ÷ ${historyRate.elapsedWeeks.toFixed(1)} elapsed weeks · through ${escapeHTML(dateLabel(historyRate.endDay, { short: true, year: false }))}</em>
        </header>
        <svg class="founder-history-chart" viewBox="0 0 960 250" preserveAspectRatio="none" role="img" aria-label="Weekly running mileage, ${historyRate.average.toFixed(1)} mile historical average, and four-week moving average">
          <path class="founder-chart-grid" d="M18 58 H942 M18 115 H942 M18 172 H942 M18 226 H942"></path>
          ${weeks.map((week, index) => {
            const value = number(week.runningMiles)
            const height = value / weeklyMaximum * 194
            const x = 18 + index * barSpace + (barSpace - barWidth) / 2
            return `
              <rect class="founder-chart-bar" x="${x.toFixed(1)}" y="${(226 - height).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="${Math.min(4, barWidth / 2)}">
                <title>Week of ${escapeHTML(dateLabel(week.weekStart, { short: true }))}: ${value.toFixed(1)} miles · ${integer(week.activities)} runs</title>
              </rect>
            `
          }).join('')}
          <line class="founder-chart-average" x1="18" y1="${historyAverageY.toFixed(1)}" x2="942" y2="${historyAverageY.toFixed(1)}"></line>
          <polyline class="founder-chart-trend" points="${rollingLine}"></polyline>
        </svg>
        <div class="founder-chart-axis founder-chart-axis--weeks" style="--founder-weeks:${weeks.length}">
          ${weeks.map((week, index) => `
            <span class="${index !== 0 && index !== weeks.length - 1 && index % 8 ? 'is-minor' : ''}">
              ${index === 0 || index === weeks.length - 1 || index % 8 === 0
                ? escapeHTML(dateLabel(week.weekStart, { short: true, year: false }))
                : ''}
            </span>
          `).join('')}
        </div>
        <footer>
          <span><small>Completed four-week avg.</small><strong>${recentFourWeekAverage.toFixed(1)} mi/week</strong></span>
          <span><small>Peak week</small><strong>${number(peakWeek?.runningMiles).toFixed(1)} mi</strong></span>
          <span><small>Active weeks</small><strong>${activeWeeks} / ${weeks.length}</strong></span>
        </footer>
      </section>
    </div>
  `
}

function rangeButtons() {
  return `
    <div class="ios-range-pills" role="group" aria-label="Running range">
      ${Object.entries(RANGE_LABELS).map(([key, label]) => `
        <button class="${state.range === key ? 'is-active' : ''}" type="button" data-running-range="${key}" aria-pressed="${state.range === key}">
          ${label}
        </button>
      `).join('')}
    </div>
  `
}

function formatWorkoutDistance(workout) {
  if (isSwim(workout)) {
    if (workout.swim?.poolUnit === 'yd') return `${integer(number(workout.distanceMiles) * 1760)} yd`
    if (workout.swim?.poolUnit === 'm') return `${integer(number(workout.distanceMiles) * 1609.344)} m`
  }
  return `${number(workout.distanceMiles).toFixed(2)} mi`
}

function workoutMicroFacts(workout) {
  const facts = []
  if (number(workout.calories) > 0) {
    facts.push(`${uiIcon('flame')}<span>${integer(workout.calories)} cal</span>`)
  }
  if (number(workout.elevationGainFeet) > 0) {
    facts.push(`${uiIcon('elevation')}<span>${integer(workout.elevationGainFeet)} ft</span>`)
  }
  if (number(workout.averageCadenceSpm) > 0) {
    facts.push(`${uiIcon('cadence')}<span>${integer(workout.averageCadenceSpm)} spm</span>`)
  }
  if (number(workout.averagePowerWatts) > 0) {
    facts.push(`${uiIcon('power')}<span>${integer(workout.averagePowerWatts)} W</span>`)
  }
  if (number(workout.maxHeartRateBpm) > 0) {
    facts.push(`${uiIcon('heart')}<span>${integer(workout.maxHeartRateBpm)} max</span>`)
  }
  if (number(workout.pausedTimeSeconds) > 0) {
    facts.push(`${uiIcon('clock')}<span>${formatClock(workout.pausedTimeSeconds)} paused</span>`)
  }
  if ((workout.splits || []).length) {
    facts.push(`${uiIcon('bars')}<span>${integer(workout.splits.length)} splits</span>`)
  }
  if (workout.crop?.hasCrops) {
    facts.push(`${uiIcon('scissors')}<span>${formatClock(workout.crop.croppedSeconds)} cropped</span>`)
  }
  return facts
}

function workoutRows(workouts, maximum = 14) {
  const visible = workouts.slice(0, maximum)
  if (!visible.length) return '<div class="ios-empty">No public workout records in this range.</div>'
  return visible.map((workout) => {
    const paceOrDistance = isRun(workout)
      ? `${formatPace(workout.averagePaceSecondsPerMile)} /mi`
      : formatWorkoutDistance(workout)
    const heartOrCalories = number(workout.averageHeartRateBpm) > 0
      ? `${integer(workout.averageHeartRateBpm)} bpm`
      : `${integer(workout.calories)} cal`
    const microFacts = workoutMicroFacts(workout)
    return `
      <button class="ios-activity-card" type="button" data-live-workout="${escapeHTML(workout.workoutId)}">
        <span class="ios-activity-card__main">
          <span class="ios-activity-card__icon ios-activity-card__icon--${escapeHTML(workout.sport)}" aria-hidden="true">${sportIcon(workout.sport)}</span>
          <span class="ios-activity-card__body">
            <strong>${escapeHTML(sportLabel(workout.sport))}</strong>
            <small>${escapeHTML(dateLabel(workout.day, { short: true }))}${workout.timeLabel ? ` · ${escapeHTML(workout.timeLabel)}` : ''}</small>
          </span>
          <span class="ios-activity-card__distance">${escapeHTML(formatWorkoutDistance(workout))}</span>
          <span class="ios-card-chevron" aria-hidden="true">${uiIcon('chevron')}</span>
        </span>
        <span class="ios-activity-card__metrics">
          <span>${uiIcon(isRun(workout) ? 'cadence' : 'route')}<strong>${escapeHTML(paceOrDistance)}</strong></span>
          <span>${uiIcon('clock')}<strong>${formatClock(workout.movingTimeSeconds || workout.durationSeconds)}</strong></span>
          <span>${uiIcon(number(workout.averageHeartRateBpm) > 0 ? 'heart' : 'flame')}<strong>${escapeHTML(heartOrCalories)}</strong></span>
        </span>
        ${microFacts.length ? `<span class="ios-activity-card__micro">${microFacts.map((fact) => `<i>${fact}</i>`).join('')}</span>` : ''}
      </button>
    `
  }).join('')
}

function fitnessControls() {
  const metric = FITNESS_METRICS[state.fitnessMetric] || FITNESS_METRICS.distance
  const chart = FITNESS_CHART_STYLES[state.fitnessChartStyle] || FITNESS_CHART_STYLES.bars
  const control = (type, definition, values) => `
    <span class="ios-fitness-control">
      <button type="button" data-fitness-menu="${type}" aria-expanded="${state.fitnessMenu === type}">
        <i>${uiIcon(definition.icon)}</i>
        <span><small>${type === 'metric' ? 'DATA' : 'CHART'}</small><strong>${escapeHTML(definition.label)}</strong></span>
        <em>${uiIcon('selector')}</em>
      </button>
      ${state.fitnessMenu === type ? `
        <span class="ios-fitness-menu" role="menu">
          ${Object.entries(values).map(([key, item]) => `
            <button class="${key === (type === 'metric' ? state.fitnessMetric : state.fitnessChartStyle) ? 'is-selected' : ''}" type="button" role="menuitem" data-fitness-${type}="${key}">
              ${uiIcon(item.icon)}<span>${escapeHTML(item.label)}</span>
            </button>
          `).join('')}
        </span>
      ` : ''}
    </span>
  `
  return `
    <div class="ios-fitness-controls">
      ${control('metric', metric, FITNESS_METRICS)}
      ${control('style', chart, FITNESS_CHART_STYLES)}
    </div>
  `
}

function runningHome() {
  const stats = rangeStats()
  const allWorkouts = state.allWorkouts ?? state.workouts
  const visibleCount = Math.min(state.visibleWorkoutCount, allWorkouts.length)
  const totalActivities = number(state.root?.training?.allTime?.activities, allWorkouts.length)
  const historyComplete = state.workoutHistoryExhausted && visibleCount >= allWorkouts.length
  return `
    <div class="founder-record-heading">
      <span>
        <small>SEPTEMBER 2025 — PRESENT</small>
        <h3>The complete training record</h3>
        <p>${integer(totalActivities)} public workouts across ${integer(state.root?.training?.allTime?.activeDays)} active days.</p>
      </span>
      <time>${escapeHTML(dateLabel(state.root?.training?.allTime?.latestDay, { short: true }))}</time>
    </div>
    ${longitudinalTrainingVisualizations()}
    <section class="founder-analysis-lens" data-impressive-anchor>
      <header>
        <span><small>INTERACTIVE LENS</small><strong>${escapeHTML(RANGE_LABELS[state.range])} running analysis</strong></span>
        <em>${integer(stats.runningActivities || stats.activities)} runs in view</em>
      </header>
      <div class="founder-analysis-controls">
        ${rangeButtons()}
        ${fitnessControls()}
      </div>
      <div class="founder-analysis-layout">
        <div class="founder-analysis-stats">
          <span><i aria-hidden="true">${uiIcon('route')}</i><small>Distance</small><strong>${number(stats.runningMiles).toFixed(1)} mi</strong></span>
          <span><i aria-hidden="true">${uiIcon('clock')}</i><small>Active time</small><strong>${formatDuration(number(stats.activeHours) * 3600)}</strong></span>
          <span><i aria-hidden="true">${uiIcon('cadence')}</i><small>Average pace</small><strong>${formatPace(stats.averageRunningPaceSecondsPerMile)} /mi</strong></span>
          <span><i aria-hidden="true">${uiIcon('elevation')}</i><small>Elevation</small><strong>${integer(stats.elevationGainFeet)} ft</strong></span>
        </div>
        ${fitnessTimeline()}
      </div>
    </section>
    <div class="founder-history-heading">
      <span><small>RECORD LEVEL</small><strong>Every workout</strong><p>Tap any entry for splits, zones, crop edits, and all published telemetry.</p></span>
      <em>${integer(visibleCount)} of ${integer(totalActivities || allWorkouts.length)}</em>
    </div>
    <div class="ios-activity-list">${workoutRows(allWorkouts, visibleCount)}</div>
    <div class="ios-scroll-loader ${historyComplete ? 'is-complete' : ''}" data-running-history aria-live="polite">
      ${state.workoutsLoading ? '<i></i><span>Loading older activity…</span>' : historyComplete
        ? `<span>Full workout history · ${PUBLIC_HISTORY_START_LABEL} to present</span>`
        : `<i></i><span>Keep scrolling · full history since ${PUBLIC_HISTORY_START_LABEL}</span>`}
    </div>
    ${state.workoutsError ? `<p class="ios-inline-error">${escapeHTML(state.workoutsError)}</p>` : ''}
  `
}

function cropTimeline(workout) {
  const crop = workout.crop
  if (!crop?.hasCrops) return ''
  const raw = Math.max(1, number(crop.rawElapsedSeconds))
  return `
    <section class="ios-card ios-crop-card">
      <div class="ios-card-head"><span><span class="ios-card-icon ios-card-icon--swim">${uiIcon('scissors')}</span><span><small class="ios-card-kicker">Elapsed-time edit</small><strong class="ios-card-title">Workout Crop</strong></span></span></div>
      <div class="ios-crop-clock">
        <span><small>Displayed</small><strong>${formatClock(crop.displayElapsedSeconds)}</strong></span>
        <span><small>Original</small><strong>${formatClock(crop.rawElapsedSeconds)}</strong></span>
        <span><small>Removed</small><strong>−${formatClock(crop.croppedSeconds)}</strong></span>
      </div>
      <div class="ios-crop-timeline" role="img" aria-label="${formatClock(crop.croppedSeconds)} cropped from the workout elapsed time">
        <i></i>
        ${(crop.intervals || []).map((interval) => `
          <em style="left:${Math.max(0, number(interval.startOffsetSeconds) / raw * 100)}%;width:${Math.max(1, number(interval.durationSeconds) / raw * 100)}%"></em>
        `).join('')}
      </div>
      <p class="ios-card-copy">Hatched time is excluded from the displayed elapsed clock. The underlying recording remains intact.</p>
    </section>
  `
}

function swimMetrics(workout) {
  const swim = workout.swim
  if (!isSwim(workout) || !swim) return ''
  const pool = number(swim.poolLength) > 0
    ? `${number(swim.poolLength).toFixed(number(swim.poolLength) % 1 ? 1 : 0)} ${escapeHTML(swim.poolUnit || 'm')}`
    : '—'
  return `
    <section class="ios-card">
      <div class="ios-card-head"><span><span class="ios-card-icon ios-card-icon--swim">${sportIcon('swimming')}</span><span class="ios-card-title">Swim Details</span></span></div>
      <div class="ios-summary-grid">
        <div class="ios-summary-tile"><small>Pool</small><strong>${pool}</strong></div>
        <div class="ios-summary-tile"><small>Lengths</small><strong>${integer(swim.lengths) || '—'}</strong></div>
        <div class="ios-summary-tile"><small>Strokes</small><strong>${integer(swim.strokes) || '—'}</strong></div>
        <div class="ios-summary-tile"><small>Avg SWOLF</small><strong>${number(swim.averageSwolf) > 0 ? number(swim.averageSwolf).toFixed(1) : '—'}</strong></div>
      </div>
      ${(swim.stroke || number(swim.bestLengthSeconds) > 0) ? `
        <div class="ios-fact-list">
          ${swim.stroke ? `<span><small>Stroke</small><strong>${escapeHTML(swim.stroke)}</strong></span>` : ''}
          ${number(swim.bestLengthSeconds) > 0 ? `<span><small>Best length</small><strong>${formatClock(swim.bestLengthSeconds)}</strong></span>` : ''}
        </div>
      ` : ''}
    </section>
  `
}

function telemetryFact(label, value, include = true) {
  if (!include) return ''
  return `<span><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></span>`
}

function workoutTelemetry(workout) {
  const facts = [
    telemetryFact('Elapsed time', formatClock(workout.durationSeconds), number(workout.durationSeconds) > 0),
    telemetryFact('Moving time', formatClock(workout.movingTimeSeconds), number(workout.movingTimeSeconds) > 0),
    telemetryFact('Paused time', formatClock(workout.pausedTimeSeconds), number(workout.pausedTimeSeconds) > 0),
    telemetryFact('Pause count', integer(workout.pauseCount), number(workout.pauseCount) > 0),
    telemetryFact('Average pace', `${formatPace(workout.averagePaceSecondsPerMile)} /mi`, isRun(workout) && number(workout.averagePaceSecondsPerMile) > 0),
    telemetryFact('Best pace', `${formatPace(workout.bestPaceSecondsPerMile)} /mi`, isRun(workout) && number(workout.bestPaceSecondsPerMile) > 0),
    telemetryFact('Grade-adjusted pace', `${formatPace(workout.gradeAdjustedPaceSecondsPerMile)} /mi`, isRun(workout) && number(workout.gradeAdjustedPaceSecondsPerMile) > 0),
    telemetryFact('Average speed', `${number(workout.averageSpeedMph).toFixed(2)} mph`, number(workout.averageSpeedMph) > 0),
    telemetryFact('Max speed', `${number(workout.maxSpeedMph).toFixed(2)} mph`, number(workout.maxSpeedMph) > 0),
    telemetryFact('Elevation gain', `${integer(workout.elevationGainFeet)} ft`, number(workout.elevationGainFeet) > 0),
    telemetryFact('Elevation loss', `${integer(workout.elevationLossFeet)} ft`, number(workout.elevationLossFeet) > 0),
    telemetryFact('Average heart rate', `${integer(workout.averageHeartRateBpm)} bpm`, number(workout.averageHeartRateBpm) > 0),
    telemetryFact('Max heart rate', `${integer(workout.maxHeartRateBpm)} bpm`, number(workout.maxHeartRateBpm) > 0),
    telemetryFact('1-minute HR recovery', `${integer(workout.heartRateRecoveryBpm)} bpm`, number(workout.heartRateRecoveryBpm) > 0),
    telemetryFact('Average cadence', `${integer(workout.averageCadenceSpm)} spm`, number(workout.averageCadenceSpm) > 0),
    telemetryFact('Average power', `${integer(workout.averagePowerWatts)} W`, number(workout.averagePowerWatts) > 0),
    telemetryFact('Max power', `${integer(workout.maxPowerWatts)} W`, number(workout.maxPowerWatts) > 0),
    telemetryFact('Relative effort', number(workout.relativeEffort).toFixed(1), number(workout.relativeEffort) > 0),
    telemetryFact('Workout effort', number(workout.workoutEffortScore).toFixed(1), number(workout.workoutEffortScore) > 0),
    telemetryFact('Perceived effort', `${integer(workout.perceivedEffort)} / 10`, number(workout.perceivedEffort) > 0),
    telemetryFact('Environment', workout.isIndoor ? 'Indoor' : 'Outdoor', typeof workout.isIndoor === 'boolean'),
    telemetryFact('Recorded by', workout.sourceLabel, Boolean(workout.sourceLabel)),
    telemetryFact('Recording mode', workout.recordingMode, Boolean(workout.recordingMode)),
    telemetryFact('Consolidated sources', integer(workout.consolidatedSourceCount), number(workout.consolidatedSourceCount) > 0),
    telemetryFact('Defined intervals', integer(workout.definedIntervalCount), number(workout.definedIntervalCount) > 0),
    telemetryFact('Detected segments', integer(workout.segmentCount), number(workout.segmentCount) > 0),
    telemetryFact('Conditions', workout.weather?.condition, Boolean(workout.weather?.condition)),
    telemetryFact('Temperature', `${number(workout.weather?.temperatureFahrenheit).toFixed(1)} °F`, workout.weather != null),
    telemetryFact('Humidity', `${number(workout.weather?.humidityPercent).toFixed(0)}%`, number(workout.weather?.humidityPercent) > 0),
    telemetryFact('Wind', `${number(workout.weather?.windSpeedMph).toFixed(1)} mph`, number(workout.weather?.windSpeedMph) > 0),
    telemetryFact('Normalized power', `${integer(workout.indoorBike?.normalizedPowerWatts)} W`, number(workout.indoorBike?.normalizedPowerWatts) > 0),
    telemetryFact('Intensity factor', number(workout.indoorBike?.intensityFactor).toFixed(2), number(workout.indoorBike?.intensityFactor) > 0),
    telemetryFact('Training stress', number(workout.indoorBike?.trainingStressScore).toFixed(1), number(workout.indoorBike?.trainingStressScore) > 0),
    telemetryFact('Bike cadence', `${number(workout.indoorBike?.averageCadenceRpm).toFixed(0)} rpm`, number(workout.indoorBike?.averageCadenceRpm) > 0),
  ].filter(Boolean)
  if (!facts.length) return ''
  return `
    <section class="ios-card">
      <div class="ios-card-head"><span><span class="ios-card-icon ios-card-icon--run">${uiIcon('bars')}</span><span><small class="ios-card-kicker">ALL PUBLISHED TELEMETRY</small><strong class="ios-card-title">Workout Data</strong></span></span></div>
      <div class="ios-fact-list ios-fact-list--dense">${facts.join('')}</div>
    </section>
  `
}

function zoneDistribution(title, zones, definitions) {
  if (!zones) return ''
  const rows = definitions
    .map(([key, label, color]) => ({ key, label, color, value: number(zones[key]) }))
    .filter((item) => item.value > 0)
  if (!rows.length) return ''
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  return `
    <section class="ios-card">
      <div class="ios-card-head"><span><span class="ios-card-icon">${uiIcon('heart')}</span><span class="ios-card-title">${escapeHTML(title)}</span></span></div>
      <div class="ios-zone-list">
        ${rows.map((item) => `
          <div>
            <span><small>${escapeHTML(item.label)}</small><strong>${formatClock(item.value)}</strong></span>
            <i><b style="width:${Math.max(1, item.value / total * 100)}%;background:${item.color}"></b></i>
          </div>
        `).join('')}
      </div>
    </section>
  `
}

function workoutDetail() {
  const workout = state.selectedWorkout
  if (!workout) return runningHome()
  const splits = workout.splits || []
  const paces = splits.map((split) => number(split.paceSecondsPerMile)).filter((pace) => pace > 0)
  const fastest = paces.length ? Math.min(...paces) : 0
  const slowest = paces.length ? Math.max(...paces) : 0
  return `
    <div class="ios-detail-header ios-detail-header--activity">
      <span class="ios-detail-sport-icon ios-detail-sport-icon--${escapeHTML(workout.sport)}">${sportIcon(workout.sport)}</span>
      <small>${escapeHTML(dateLabel(workout.day, { weekday: true }))}${workout.timeLabel ? ` · ${escapeHTML(workout.timeLabel)}` : ''}</small>
      <h3>${escapeHTML(sportLabel(workout.sport))}</h3>
      <p>Complete workout record · location excluded</p>
    </div>
    <section class="ios-card">
      <div class="ios-card-head"><span><span class="ios-card-title">Workout Summary</span></span></div>
      <div class="ios-workout-hero-metrics">
        <span><small>Distance</small><strong>${escapeHTML(formatWorkoutDistance(workout))}</strong></span>
        <span><small>Moving</small><strong>${formatClock(workout.movingTimeSeconds || workout.durationSeconds)}</strong></span>
        <span><small>${isRun(workout) ? 'Avg pace' : 'Calories'}</small><strong>${isRun(workout) ? `${formatPace(workout.averagePaceSecondsPerMile)} /mi` : integer(workout.calories)}</strong></span>
      </div>
      <div class="ios-fact-list">
        <span><small>Calories</small><strong>${integer(workout.calories) || '—'}</strong></span>
        <span><small>Average HR</small><strong>${number(workout.averageHeartRateBpm) > 0 ? `${integer(workout.averageHeartRateBpm)} bpm` : '—'}</strong></span>
        <span><small>Max HR</small><strong>${number(workout.maxHeartRateBpm) > 0 ? `${integer(workout.maxHeartRateBpm)} bpm` : '—'}</strong></span>
        ${isRun(workout) ? `<span><small>Elevation</small><strong>${integer(workout.elevationGainFeet)} ft</strong></span>` : ''}
      </div>
    </section>
    ${cropTimeline(workout)}
    ${swimMetrics(workout)}
    ${workoutTelemetry(workout)}
    ${zoneDistribution('Heart Rate Zones', workout.heartRateZones, [
      ['zone1Seconds', 'Zone 1', '#64d2ff'],
      ['zone2Seconds', 'Zone 2', '#34c759'],
      ['zone3Seconds', 'Zone 3', '#ffcc00'],
      ['zone4Seconds', 'Zone 4', '#ff9f0a'],
      ['zone5Seconds', 'Zone 5', '#ff453a'],
    ])}
    ${zoneDistribution('Pace Zones', workout.paceZones, [
      ['easySeconds', 'Easy', '#64d2ff'],
      ['moderateSeconds', 'Moderate', '#34c759'],
      ['tempoSeconds', 'Tempo', '#ffcc00'],
      ['thresholdSeconds', 'Threshold', '#ff9f0a'],
      ['sprintSeconds', 'Sprint', '#ff453a'],
    ])}
    ${splits.length ? `
      <section class="ios-card">
        <div class="ios-card-head"><span><span class="ios-card-title">Splits</span></span></div>
        <div class="ios-splits">
          ${splits.slice(0, 24).map((split) => {
            const pace = number(split.paceSecondsPerMile)
            const width = slowest > fastest
              ? 58 + ((slowest - pace) / (slowest - fastest)) * 42
              : 82
            return `
              <div class="ios-split-row">
                <strong>${integer(split.number)}</strong>
                <span><b>${formatPace(pace)}</b><small>${number(split.distanceMiles).toFixed(2)} mi</small></span>
                <span class="ios-split-bar"><i style="--split-width:${width.toFixed(1)}%"></i></span>
                <span><b>${number(split.averageHeartRateBpm) > 0 ? `${integer(split.averageHeartRateBpm)} bpm` : '—'}</b><small>${number(split.averageCadenceSpm) > 0 ? `${integer(split.averageCadenceSpm)} spm` : `${integer(split.elevationGainFeet)} ft`}</small></span>
              </div>
            `
          }).join('')}
        </div>
      </section>
    ` : ''}
    ${(number(workout.averageCadenceSpm) > 0 || number(workout.averageStrideLengthMeters) > 0) ? `
      <section class="ios-card">
        <div class="ios-card-head"><span><span class="ios-card-icon ios-card-icon--run">${uiIcon('cadence')}</span><span class="ios-card-title">Running Dynamics</span></span></div>
        <div class="ios-summary-grid">
          <div class="ios-summary-tile"><small>Cadence</small><strong>${integer(workout.averageCadenceSpm)} spm</strong></div>
          <div class="ios-summary-tile"><small>Step length</small><strong>${number(workout.averageStrideLengthMeters).toFixed(2)} m</strong></div>
          <div class="ios-summary-tile"><small>Contact</small><strong>${integer(workout.averageGroundContactMilliseconds)} ms</strong></div>
          <div class="ios-summary-tile"><small>Vertical</small><strong>${number(workout.averageVerticalOscillationCentimeters).toFixed(1)} cm</strong></div>
        </div>
      </section>
    ` : ''}
  `
}

function nutritionSnapshot() {
  const mode = state.includeToday ? 'includingToday' : 'complete'
  return state.root?.nutrition?.ranges?.[mode]?.[String(state.nutritionRangeDays)] ??
    (state.nutritionRangeDays === 7 ? state.root?.nutrition : null)
}

function nutritionCategory(item) {
  if (item?.category) return item.category
  const key = String(item?.key || '')
  if (key.startsWith('vitamin_') || key === 'choline') return 'Vitamins'
  if ([
    'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium',
    'zinc', 'copper', 'manganese', 'selenium', 'chromium', 'molybdenum',
    'iodine', 'fluoride',
  ].includes(key)) return 'Minerals'
  return 'Other'
}

function nutrientStatusLabel(status) {
  return {
    strong: 'Reference met',
    within: 'Within reference limit',
    near: 'Near reference',
    watch: 'Review intake',
    limited: 'Limited coverage',
  }[status] || 'Recorded intake'
}

function nutrientRow(item) {
  const color = NUTRIENT_COLORS[item.status] || NUTRIENT_COLORS.limited
  const hasReference = Number.isFinite(Number(item.percent))
  const width = hasReference
    ? Math.max(0, Math.min(number(item.percent), 100))
    : Math.max(8, Math.min(number(item.coverageDays) * 12.5, 100))
  return `
    <button class="ios-insight-row" type="button" data-nutrient-key="${escapeHTML(item.key)}">
      <span class="ios-insight-row__icon" style="--nutrient-color:${color}" aria-hidden="true">●</span>
      <span class="ios-insight-row__body">
        <span><strong>${escapeHTML(item.label)}</strong><small>${escapeHTML(nutrientStatusLabel(item.status))}</small></span>
        <span class="ios-micro-track"><i style="--micro-width:${width}%;--micro-color:${color}"></i></span>
      </span>
      <span class="ios-insight-row__value"><strong>${formatNutrientValue(item.average, item.unit)}</strong><small>${hasReference ? `${integer(item.percent)}%` : `${integer(item.coverageDays)}d`}</small></span>
      <span class="ios-card-chevron" aria-hidden="true">${uiIcon('chevron')}</span>
    </button>
  `
}

function nutritionRows(items) {
  if (!items?.length) return '<div class="ios-empty">No micronutrient window is available.</div>'
  const preferredGroups = [
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
  const availableGroups = Array.from(new Set(items.map(nutritionCategory)))
  const groups = [
    ...preferredGroups.filter((group) => availableGroups.includes(group)),
    ...availableGroups.filter((group) => !preferredGroups.includes(group)),
  ]
  return groups.map((group) => {
    const values = items.filter((item) => nutritionCategory(item) === group)
    if (!values.length) return ''
    return `
      <div class="ios-nutrient-group">
        <div class="ios-section-label"><span>${group}</span><small>${values.length}</small></div>
        <div class="ios-insight-list">${values.map(nutrientRow).join('')}</div>
      </div>
    `
  }).join('')
}

function nutrientDetail(item) {
  if (!item) {
    state.selectedNutrient = null
    return nutritionHome()
  }
  const snapshot = nutritionSnapshot()
  const meals = state.meals.filter((meal) => (
    (!snapshot?.startDay || meal.day >= snapshot.startDay) &&
    (!snapshot?.endDay || meal.day <= snapshot.endDay)
  ))
  const summary = nutrientProvenance(meals, item.key)
  const hasReference = Number.isFinite(Number(item.reference))
  return `
    <button class="ios-inline-back" type="button" data-nutrition-back>${uiIcon('chevron', 'ios-symbol--back')} Insights</button>
    ${provenanceDetailView({
      ...item,
      category: nutritionCategory(item),
      reference: hasReference ? item.reference : null,
    }, summary, {
      days: state.nutritionRangeDays,
      displayValue: item.average,
      scopeLabel: `Average across the last ${state.nutritionRangeDays} days`,
      limit: item.direction === 'limit',
    })}
  `
}

function nutrientStatusVisualization(nutrients) {
  const definitions = [
    {
      key: 'reference',
      label: 'At reference',
      statuses: ['strong', 'within'],
      color: '#30d158',
    },
    {
      key: 'near',
      label: 'Near reference',
      statuses: ['near'],
      color: '#3aa7ff',
    },
    {
      key: 'review',
      label: 'Review',
      statuses: ['watch'],
      color: '#ff9f0a',
    },
    {
      key: 'limited',
      label: 'Limited coverage',
      statuses: ['limited'],
      color: '#8e8e93',
    },
    {
      key: 'recorded',
      label: 'Recorded only',
      statuses: ['recorded'],
      color: '#bf5af2',
    },
  ]
  const buckets = definitions.map((definition) => ({
    ...definition,
    count: nutrients.filter((nutrient) => (
      definition.statuses.includes(nutrient.status)
    )).length,
  }))
  const total = Math.max(1, nutrients.length)
  let offset = 0
  const segments = buckets.map((bucket) => {
    const length = bucket.count / total * 100
    const segment = {
      ...bucket,
      length,
      offset,
    }
    offset += length
    return segment
  })
  const referenceCount = buckets
    .filter((bucket) => bucket.key !== 'recorded')
    .reduce((sum, bucket) => sum + bucket.count, 0)
  const favorable = buckets
    .filter((bucket) => ['reference', 'near'].includes(bucket.key))
    .reduce((sum, bucket) => sum + bucket.count, 0)
  const favorablePercent = referenceCount > 0
    ? favorable / referenceCount * 100
    : 0

  return `
    <section class="founder-nutrient-spectrum">
      <div class="founder-nutrient-orbit">
        <svg viewBox="0 0 140 140" role="img" aria-label="${nutrients.length} recorded nutrients grouped by interpretation status">
          <circle class="founder-nutrient-orbit__track" cx="70" cy="70" r="54" pathLength="100"></circle>
          ${segments.filter((segment) => segment.count > 0).map((segment) => `
            <circle
              cx="70"
              cy="70"
              r="54"
              pathLength="100"
              fill="none"
              stroke="${segment.color}"
              stroke-width="14"
              stroke-linecap="round"
              stroke-dasharray="${Math.max(0, segment.length - 0.7).toFixed(2)} ${(100 - Math.max(0, segment.length - 0.7)).toFixed(2)}"
              stroke-dashoffset="${(-segment.offset).toFixed(2)}"
            >
              <title>${escapeHTML(segment.label)}: ${segment.count}</title>
            </circle>
          `).join('')}
        </svg>
        <span><strong>${nutrients.length}</strong><small>nutrients</small></span>
      </div>
      <div class="founder-nutrient-spectrum__copy">
        <small>${state.nutritionRangeDays}-DAY NUTRIENT SPECTRUM</small>
        <strong>${favorablePercent.toFixed(0)}% at or near reference</strong>
        <p>Every recorded nutrient remains visible below. Status reflects the selected food-record window, not a diagnosis.</p>
        <div class="founder-nutrient-legend">
          ${buckets.map((bucket) => `
            <span style="--nutrient-status:${bucket.color}">
              <i></i><small>${escapeHTML(bucket.label)}</small><strong>${bucket.count}</strong>
            </span>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function nutritionHome() {
  const nutrition = nutritionSnapshot()
  const average = nutrition?.dailyAverage ?? {}
  const micronutrients = nutrition?.nutrients ?? nutrition?.micronutrients ?? []
  const strong = micronutrients.filter((item) => ['strong', 'within'].includes(item.status)).length
  const watch = micronutrients.filter((item) => item.status === 'watch').length
  return `
    <div class="founder-record-heading">
      <span>
        <small>FOOD-ONLY INTAKE</small>
        <h3>${state.nutritionRangeDays}-day nutrition intelligence</h3>
        <p>${integer(nutrition?.recordedDays)} of ${integer(nutrition?.possibleDays)} days contain food recordings.</p>
      </span>
      <time>${escapeHTML(nutrition?.startDay || '')} — ${escapeHTML(nutrition?.endDay || '')}</time>
    </div>
    <div class="founder-nutrition-controls">
      <div class="ios-range-pills ios-range-pills--nutrition" role="group" aria-label="Nutrition range">
        ${NUTRITION_RANGE_DAYS.map((days) => `
          <button class="${state.nutritionRangeDays === days ? 'is-active' : ''}" type="button" data-nutrition-range="${days}" aria-pressed="${state.nutritionRangeDays === days}">${days}D</button>
        `).join('')}
      </div>
      <button class="ios-include-today" type="button" data-include-today aria-pressed="${state.includeToday}">
        <span><strong>Include today</strong><small>${state.includeToday ? 'Partial day included' : 'Complete days only'}</small></span>
        <i class="${state.includeToday ? 'is-on' : ''}" aria-hidden="true"></i>
      </button>
    </div>
    ${nutrientStatusVisualization(micronutrients)}
    <section class="founder-nutrition-averages">
      <header><span><small>DAILY AVERAGE</small><strong>Recorded food</strong></span><em>${strong} at reference · ${watch} review</em></header>
      <div>
        <span><small>Energy</small><strong>${integer(average.calories)}</strong><em>cal</em></span>
        <span><small>Carbohydrate</small><strong>${integer(average.carbohydrateGrams)}</strong><em>g</em></span>
        <span><small>Protein</small><strong>${integer(average.proteinGrams)}</strong><em>g</em></span>
        <span><small>Fiber</small><strong>${number(average.fiberGrams).toFixed(1)}</strong><em>g</em></span>
      </div>
    </section>
    <div class="founder-history-heading">
      <span><small>COMPLETE EXPLORER</small><strong>Every recorded nutrient</strong><p>Open any row to inspect its values and contributing food sources.</p></span>
      <em>${micronutrients.length} nutrients</em>
    </div>
    <div class="founder-nutrient-explorer">${nutritionRows(micronutrients)}</div>
    <p class="ios-disclaimer">${escapeHTML(nutrition?.disclaimer || 'Recorded food estimate; supplements are excluded. Not a diagnosis.')}</p>
  `
}

function mealTypeLabel(meal) {
  const raw = String(meal?.mealType || '').toLowerCase()
  if (raw === 'breakfast') return 'Breakfast'
  if (raw === 'lunch') return 'Lunch'
  if (raw === 'dinner') return 'Dinner'
  if (raw === 'snack') return 'Snack'
  return 'Meal'
}

function mealTypeIcon(meal) {
  return uiIcon({
    Breakfast: 'sun',
    Lunch: 'sun',
    Dinner: 'moon',
    Snack: 'snack',
    Meal: 'fork',
  }[mealTypeLabel(meal)] || 'figure')
}

function mealMicronutrients(meal) {
  return (meal?.nutrients || []).filter((item) => (
    ['Vitamins', 'Minerals'].includes(item.category)
  ))
}

function normalizedItemNutrients(item, meal) {
  if (Array.isArray(item?.nutrients) && item.nutrients.length) return item.nutrients
  const definitions = new Map((meal?.nutrients || []).map((nutrient) => [nutrient.key, nutrient]))
  return [
    ['calories', item?.calories, 'Calories', 'kcal', 'Energy'],
    ['protein', item?.protein, 'Protein', 'g', 'Macros'],
    ['carbohydrates', item?.carbohydrates, 'Total Carbohydrate', 'g', 'Macros'],
    ['total_fat', item?.totalFat, 'Total Fat', 'g', 'Fats & Lipids'],
  ].filter(([, value]) => number(value) > 0).map(([key, value, label, unit, category]) => ({
    key,
    value: number(value),
    label: definitions.get(key)?.label || label,
    unit: definitions.get(key)?.unit || unit,
    category: definitions.get(key)?.category || category,
  }))
}

function nutritionSelection(meal, itemIndex = null) {
  const item = Number.isInteger(itemIndex) ? meal?.items?.[itemIndex] : null
  if (!item) {
    return {
      title: meal?.title || 'Meal',
      servingText: number(meal?.itemCount || meal?.items?.length) === 1
        ? '1 item'
        : `${integer(meal?.itemCount || meal?.items?.length)} items`,
      nutrients: meal?.nutrients || [],
      calories: number(meal?.calories),
      protein: number(meal?.protein),
      carbohydrates: number(meal?.carbohydrates),
      totalFat: number(meal?.totalFat),
    }
  }
  return {
    title: item.name || 'Food',
    servingText: `${number(item.servingSize || 1).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${item.servingUnit || 'serving'}`,
    nutrients: normalizedItemNutrients(item, meal),
    calories: number(item.calories),
    protein: number(item.protein),
    carbohydrates: number(item.carbohydrates),
    totalFat: number(item.totalFat),
  }
}

function nutrientByKey(items, key) {
  return (items || []).find((item) => item.key === key)
}

function nutrientValue(items, key) {
  return number(nutrientByKey(items, key)?.value)
}

function itemSource(item, key) {
  const provenanceAvailable = Boolean(
    item?.provenance &&
    typeof item.provenance === 'object' &&
    Object.keys(item.provenance).length
  )
  const provenance = provenanceAvailable ? item.provenance : {}
  const filled = provenance.fillSources?.[key]
  const legacy = provenance.legacyEstimatedKeys?.includes?.(key)
  const sourceKey = filled || (legacy ? 'ai_grounded' : provenance.recordedSource) || 'unknown'
  const base = provenanceAvailable
    ? (SOURCE_META[sourceKey] || SOURCE_META.unknown)
    : {
        ...SOURCE_META.unknown,
        label: 'Source method unavailable in this snapshot',
        estimated: false,
      }
  const confidenceKey = base.confidence
  const confidence = CONFIDENCE_META[confidenceKey] || CONFIDENCE_META.unknown
  const sourceError = Number.isFinite(Number(provenance.sourceErrors?.[key]))
    ? number(provenance.sourceErrors[key])
    : base.error
  const portion = provenance.portion
  let portionError = 0
  let lowGrams = number(portion?.lowGrams)
  let highGrams = number(portion?.highGrams)
  const gramWeight = number(portion?.gramWeight)
  if (portion) {
    if (Number.isFinite(Number(portion.errorPercent))) {
      portionError = number(portion.errorPercent)
    } else if (portion.beforeAfter && gramWeight > 0 && highGrams >= lowGrams) {
      portionError = Math.max(
        Math.abs(gramWeight - lowGrams),
        Math.abs(highGrams - gramWeight)
      ) / gramWeight * 100
    } else {
      portionError = 25
      if (gramWeight > 0) {
        lowGrams = gramWeight * 0.75
        highGrams = gramWeight * 1.25
      }
    }
  }
  return {
    ...base,
    available: provenanceAvailable,
    key: sourceKey,
    confidenceKey,
    confidence,
    sourceError,
    portionError,
    lowGrams,
    highGrams,
    citation: provenance.citations?.[key] || null,
  }
}

function confidenceFromScore(score) {
  if (score >= 0.95) return 'full'
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  if (score >= 0.4) return 'low'
  return 'unknown'
}

function nutrientProvenance(meals, key, options = {}) {
  const contributions = new Map()
  let total = 0
  let totalCoverageWeight = 0
  let coveredWeight = 0
  const selectedMealId = options.mealId || null
  const selectedItemIndex = Number.isInteger(options.itemIndex) ? options.itemIndex : null
  for (const meal of meals || []) {
    if (selectedMealId && meal.mealId !== selectedMealId) continue
    for (const [index, item] of (meal.items || []).entries()) {
      if (selectedItemIndex != null && index !== selectedItemIndex) continue
      const nutrients = normalizedItemNutrients(item, meal)
      const calories = Math.max(1, nutrientValue(nutrients, 'calories') || number(item.calories))
      totalCoverageWeight += calories
      const nutrient = nutrientByKey(nutrients, key)
      if (!nutrient) continue
      coveredWeight += calories
      if (number(nutrient.value) <= 0) continue
      const amount = number(nutrient.value)
      const source = itemSource(item, key)
      const identity = `${String(item.name || 'Food').toLowerCase()}|${String(item.brand || '').toLowerCase()}`
      const existing = contributions.get(identity) || {
        name: item.name || 'Food',
        brand: item.brand || '',
        amount: 0,
        occurrences: 0,
        dominantAmount: -1,
        source,
      }
      existing.amount += amount
      existing.occurrences += 1
      if (amount >= existing.dominantAmount) {
        existing.dominantAmount = amount
        existing.source = source
      }
      contributions.set(identity, existing)
      total += amount
    }
  }
  const rows = Array.from(contributions.values())
    .sort((left, right) => right.amount - left.amount)
  const safeTotal = total || 1
  let weighted = 0
  let estimated = 0
  let authoritative = 0
  let portionEstimated = 0
  let lowerBound = 0
  let upperBound = 0
  let sourceMetadataAmount = 0
  for (const row of rows) {
    const source = row.source
    if (source.available) sourceMetadataAmount += row.amount
    const sourcePenalty = Math.min(0.5, number(source.sourceError) / 100)
    const portionPenalty = Math.min(0.5, number(source.portionError) / 200)
    const weight = Math.max(0.05, source.confidence.score - sourcePenalty - portionPenalty)
    const combinedError = Math.sqrt(source.sourceError ** 2 + source.portionError ** 2)
    weighted += row.amount * weight
    if (source.estimated) estimated += row.amount
    if (source.confidenceKey === 'full') authoritative += row.amount
    if (source.portionError > 0) portionEstimated += row.amount
    lowerBound += row.amount * Math.max(0, 1 - Math.min(100, combinedError) / 100)
    upperBound += row.amount * (1 + Math.min(200, combinedError) / 100)
  }
  const sourceMetadataFraction = sourceMetadataAmount / safeTotal
  const sourceMetadataAvailable = total > 0 && sourceMetadataFraction > 0.999
  const score = sourceMetadataAvailable && total > 0 ? weighted / safeTotal : 0.5
  const confidenceKey = sourceMetadataAvailable
    ? confidenceFromScore(score)
    : 'unknown'
  return {
    key,
    total,
    contributions: rows,
    confidenceKey,
    confidence: CONFIDENCE_META[confidenceKey],
    score,
    sourceMetadataAvailable,
    sourceMetadataFraction,
    estimatedFraction: estimated / safeTotal,
    authoritativeFraction: authoritative / safeTotal,
    portionEstimatedFraction: portionEstimated / safeTotal,
    coverageFraction: totalCoverageWeight > 0 ? coveredWeight / totalCoverageWeight : 0,
    lowerBound,
    upperBound,
  }
}

function nutrientScopeMeals(day = null) {
  return day ? state.meals.filter((meal) => meal.day === day) : state.meals
}

function nutritionPercent(value, key) {
  const reference = NUTRIENT_DAILY_VALUES[key]
  return reference > 0 ? Math.round(number(value) / reference * 100) : null
}

function factsValue(value, unit) {
  const amount = number(value)
  const formatted = Math.abs(amount) < 10 && amount % 1
    ? amount.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : integer(amount)
  return `${formatted}${unit || ''}`
}

function recordMacroPills(meal) {
  return `
    <span class="ios-record-macro-pills">
      <i class="is-calories">${integer(meal.calories)} cal</i>
      <i class="is-protein">${integer(meal.protein)} g P</i>
      <i class="is-carbs">${integer(meal.carbohydrates)} g C</i>
      <i class="is-fat">${integer(meal.totalFat)} g F</i>
    </span>
  `
}

function nutritionDoor(meal, itemIndex = null) {
  const itemAttribute = Number.isInteger(itemIndex)
    ? ` data-meal-item-index="${itemIndex}"`
    : ''
  return `
    <button class="ios-record-nutrition-door" type="button" data-meal-id="${escapeHTML(meal.mealId)}"${itemAttribute}>
      <span>${uiIcon('documentChart')}<strong>Nutrition Facts Label</strong></span>
      ${uiIcon('chevronDown')}
    </button>
  `
}

function recordMealRow(meal, featured = false) {
  const expanded = state.expandedMealId === meal.mealId
  return `
    <article class="ios-record-meal ${expanded ? 'is-expanded' : ''} ${featured ? 'is-featured' : ''}">
      <button class="ios-record-meal__summary" type="button" data-meal-expand="${escapeHTML(meal.mealId)}" aria-expanded="${expanded}">
        <span class="ios-record-meal__heading">
          <span><strong>${escapeHTML(meal.title || 'Meal')}</strong><small>${escapeHTML(meal.timeLabel || '')}${number(meal.itemCount || meal.items?.length) > 1 ? ` · ${integer(meal.itemCount || meal.items?.length)} items` : ''}</small></span>
          <span><strong>${integer(meal.calories)} cal</strong><i aria-hidden="true">${uiIcon('chevron')}</i></span>
        </span>
        ${recordMacroPills(meal)}
      </button>
      ${expanded ? `
        <div class="ios-record-meal__expanded">
          <div class="ios-record-food-items">
            ${(meal.items || []).map((item, index) => `
              <button type="button" data-meal-item-facts="${escapeHTML(meal.mealId)}" data-meal-item-index="${index}" aria-label="Full nutrition facts for ${escapeHTML(item.name)}">
                <i aria-hidden="true"></i>
                <span><strong>${escapeHTML(item.name)}</strong><small>${number(item.servingSize) > 0 ? `${number(item.servingSize).toFixed(number(item.servingSize) % 1 ? 1 : 0)} ${escapeHTML(item.servingUnit || '')}` : escapeHTML(item.brand || '')}</small></span>
                <span><strong>${integer(item.calories)} cal</strong>${uiIcon('documentChart')}</span>
              </button>
            `).join('')}
          </div>
          ${nutritionDoor(meal)}
        </div>
      ` : ''}
    </article>
  `
}

function mealTimeline(dayMeals, latestMealId) {
  if (!dayMeals.length) return ''
  const sections = []
  for (const meal of dayMeals) {
    const label = mealTypeLabel(meal)
    const current = sections.at(-1)
    if (current?.label === label) current.meals.push(meal)
    else sections.push({ label, meals: [meal] })
  }
  return sections.map((section) => `
    <section class="ios-record-slot">
      <header>
        <span>${mealTypeIcon(section.meals[0])}<strong>${escapeHTML(section.label)}</strong></span>
        <small>${integer(section.meals.length)}</small>
      </header>
      <div class="ios-record-slot__card">
        ${section.meals.map((meal) => recordMealRow(meal, meal.mealId === latestMealId)).join('')}
      </div>
    </section>
  `).join('')
}

function provenanceMarker(summary) {
  if (!summary?.total) return ''
  if (!summary.sourceMetadataAvailable) {
    return `<span class="ios-fda-source-marker" style="--source-tone:${CONFIDENCE_META.unknown.color}" aria-hidden="true">${uiIcon('question')}</span>`
  }
  const estimated = summary.estimatedFraction > 0.0001 || summary.portionEstimatedFraction > 0.0001
  const icon = estimated ? 'sparkles' : summary.confidence.icon
  return `<span class="ios-fda-source-marker" style="--source-tone:${summary.confidence.color}" aria-hidden="true">${uiIcon(icon)}</span>`
}

function fdaRow(meal, selection, key, label, options = {}) {
  const nutrient = nutrientByKey(selection.nutrients, key)
  const value = key === 'calories'
    ? selection.calories
    : key === 'protein'
      ? selection.protein
      : key === 'carbohydrates'
        ? selection.carbohydrates
        : key === 'total_fat'
          ? selection.totalFat
          : number(nutrient?.value)
  const unit = options.unit ?? nutrient?.unit ?? ''
  const percent = options.dailyValue === false ? null : nutritionPercent(value, key)
  const summary = nutrientProvenance([meal], key, {
    mealId: meal.mealId,
    itemIndex: state.selectedMealItemIndex,
  })
  return `
    <button class="ios-fda-row ${options.indented ? 'is-indented' : ''} ${options.bold ? 'is-bold' : ''} ${options.small ? 'is-small' : ''}" type="button" data-meal-source-key="${escapeHTML(key)}">
      <span><b>${escapeHTML(label)}</b>${options.hideValue ? '' : ` <i>${factsValue(value, unit)}</i>`}${provenanceMarker(summary)}</span>
      ${percent == null ? '<em></em>' : `<strong>${percent}%</strong>`}
    </button>
  `
}

function nutritionFactsLabel(meal) {
  const selection = nutritionSelection(meal, state.selectedMealItemIndex)
  const groups = ['Macros', 'Vitamins', 'Minerals', 'Fats & Lipids', 'Amino Acids', 'Carotenoids', 'Other']
  const additional = groups.map((category) => {
    const items = selection.nutrients
      .filter((item) => item.category === category && !STANDARD_NUTRIENT_IDS.has(item.key) && number(item.value) > 0)
    if (!items.length) return ''
    return `
      <h5>${escapeHTML(category)}</h5>
      ${items.map((item) => fdaRow(meal, selection, item.key, item.label, {
        unit: item.unit,
        small: true,
      })).join('')}
    `
  }).join('')
  return `
    <section class="ios-fda-label" aria-label="Nutrition Facts">
      <h3>Nutrition Facts</h3>
      <div class="ios-fda-rule ios-fda-rule--xl"></div>
      <div class="ios-fda-serving"><strong>Serving Size</strong><b>${escapeHTML(selection.servingText)}</b></div>
      <div class="ios-fda-rule ios-fda-rule--lg"></div>
      <button class="ios-fda-calories" type="button" data-meal-source-key="calories">
        <strong>Calories</strong>${provenanceMarker(nutrientProvenance([meal], 'calories', { mealId: meal.mealId, itemIndex: state.selectedMealItemIndex }))}<b>${integer(selection.calories)}</b>
      </button>
      <div class="ios-fda-dv">% Daily Value*</div>
      <h4>Core Nutrients</h4>
      ${fdaRow(meal, selection, 'total_fat', 'Total Fat', { unit: 'g', bold: true })}
      ${fdaRow(meal, selection, 'saturated_fat', 'Saturated Fat', { unit: 'g', indented: true })}
      ${fdaRow(meal, selection, 'trans_fat', 'Trans Fat', { unit: 'g', indented: true, dailyValue: false })}
      ${fdaRow(meal, selection, 'cholesterol', 'Cholesterol', { unit: 'mg', bold: true })}
      ${fdaRow(meal, selection, 'sodium', 'Sodium', { unit: 'mg', bold: true })}
      ${fdaRow(meal, selection, 'carbohydrates', 'Total Carbohydrate', { unit: 'g', bold: true })}
      ${fdaRow(meal, selection, 'dietary_fiber', 'Dietary Fiber', { unit: 'g', indented: true })}
      ${fdaRow(meal, selection, 'total_sugars', 'Total Sugars', { unit: 'g', indented: true, dailyValue: false })}
      ${fdaRow(meal, selection, 'protein', 'Protein', { unit: 'g', bold: true })}
      <div class="ios-fda-rule ios-fda-rule--lg"></div>
      <h4>Key Vitamins &amp; Minerals</h4>
      ${fdaRow(meal, selection, 'vitamin_d', 'Vitamin D', { unit: 'mcg', small: true })}
      ${fdaRow(meal, selection, 'calcium', 'Calcium', { unit: 'mg', small: true })}
      ${fdaRow(meal, selection, 'iron', 'Iron', { unit: 'mg', small: true })}
      ${fdaRow(meal, selection, 'potassium', 'Potassium', { unit: 'mg', small: true })}
      ${additional ? `
        <div class="ios-fda-rule ios-fda-rule--lg"></div>
        <h4>Detailed Nutrient Breakdown</h4>
        ${additional}
      ` : ''}
      <p>* Percent Daily Values are based on a 2,000 calorie diet.</p>
      <div class="ios-fda-legend">
        <span>${uiIcon('sparkles')} Includes estimates</span>
        <span>${uiIcon('seal')} Authoritative</span>
        <small>Marker color shows confidence. Tap a marked nutrient for its sources, margins &amp; confidence.</small>
      </div>
    </section>
  `
}

function nutritionItemPicker(meal) {
  if (meal?.isDailyTotal || (meal.items || []).length <= 1) return ''
  return `
    <div class="ios-nutrition-item-picker" role="group" aria-label="Nutrition label scope">
      <button class="${state.selectedMealItemIndex == null ? 'is-active' : ''}" type="button" data-nutrition-item="total">Total</button>
      ${(meal.items || []).map((item, index) => `
        <button class="${state.selectedMealItemIndex === index ? 'is-active' : ''}" type="button" data-nutrition-item="${index}">${escapeHTML(item.name)}</button>
      `).join('')}
    </div>
  `
}

function nutritionSummary(meal) {
  const selection = nutritionSelection(meal, state.selectedMealItemIndex)
  const proteinCalories = selection.protein * 4
  const carbCalories = selection.carbohydrates * 4
  const fatCalories = selection.totalFat * 9
  const total = proteinCalories + carbCalories + fatCalories || 1
  return `
    <section class="ios-card ios-fda-summary">
      <h3>Summary</h3>
      <div>
        <span><strong>${Math.round(proteinCalories / total * 100)}%</strong><small>Protein</small><i class="is-protein"></i></span>
        <span><strong>${Math.round(carbCalories / total * 100)}%</strong><small>Carbs</small><i class="is-carbs"></i></span>
        <span><strong>${Math.round(fatCalories / total * 100)}%</strong><small>Fat</small><i class="is-fat"></i></span>
      </div>
      <p>Calculated: ${integer(total)} cal</p>
    </section>
  `
}

function mealDetail() {
  const meal = state.selectedMeal
  if (!meal) return mealsHome()
  return `
    ${nutritionItemPicker(meal)}
    ${nutritionFactsLabel(meal)}
    ${nutritionSummary(meal)}
  `
}

function aggregateDayRecord(meals, day) {
  const values = {
    calories: 0,
    protein: 0,
    carbohydrates: 0,
    totalFat: 0,
    count: 0,
    nutrients: new Map(),
  }
  for (const meal of meals) {
    if (meal.day !== day) continue
    values.calories += number(meal.calories)
    values.protein += number(meal.protein)
    values.carbohydrates += number(meal.carbohydrates)
    values.totalFat += number(meal.totalFat)
    values.count += 1
    for (const nutrient of meal.nutrients || []) {
      if (!nutrient?.key || !Number.isFinite(Number(nutrient.value))) continue
      const previous = values.nutrients.get(nutrient.key)
      values.nutrients.set(nutrient.key, {
        ...nutrient,
        value: number(previous?.value) + number(nutrient.value),
      })
    }
  }
  values.nutrientList = Array.from(values.nutrients.values())
  values.waterFlOz = number(values.nutrients.get('water')?.value) / 29.5735
  return values
}

function recordWeekStrip(selectedDay) {
  const selected = dayDate(selectedDay) || dayDate(todayDay())
  const start = shiftDay(selectedDay, -selected.getUTCDay())
  const today = todayDay()
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(start, index))
  const nextWeek = shiftDay(selectedDay, 7)
  return `
    <section class="ios-record-date-strip">
      <header>
        <button type="button" data-meal-week="-7" aria-label="Previous week">${uiIcon('chevron', 'ios-symbol--back')}</button>
        <strong>${selectedDay === today ? 'This Week' : escapeHTML(dateLabel(selectedDay))}</strong>
        <button type="button" data-meal-week="7" aria-label="Next week" ${nextWeek > today ? 'disabled' : ''}>${uiIcon('chevron')}</button>
      </header>
      <div>
        ${days.map((day) => {
          const date = dayDate(day)
          const active = day === selectedDay
          return `
            <button class="${active ? 'is-active' : ''}" type="button" data-meal-day="${day}" aria-pressed="${active}">
              <small>${date.toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })}</small>
              <strong>${date.getUTCDate()}</strong>
            </button>
          `
        }).join('')}
      </div>
    </section>
  `
}

function dailyRecordSummary(meals, day) {
  const values = aggregateDayRecord(meals, day)
  const targets = state.root?.nutrition?.targets || {}
  const workouts = state.allWorkouts || state.workouts
  const burned = workouts
    .filter((workout) => workout.day === day)
    .reduce((sum, workout) => sum + number(workout.calories), 0)
  const net = values.calories - burned
  const fiber = number(values.nutrients.get('dietary_fiber')?.value)
  const metrics = [
    { label: 'Calories', value: integer(values.calories), unit: 'cal', tone: 'calories', target: positiveNumber(targets.calories, 2000) },
    { label: 'Protein', value: integer(values.protein), unit: 'g', tone: 'protein', target: positiveNumber(targets.protein, 50) },
    { label: 'Carbs', value: integer(values.carbohydrates), unit: 'g', tone: 'carbs', target: positiveNumber(targets.carbohydrates, 250) },
    { label: 'Fat', value: integer(values.totalFat), unit: 'g', tone: 'fat', target: positiveNumber(targets.totalFat, 65) },
  ]
  const title = day === todayDay() ? "Today's Totals" : dateLabel(day, { short: true })
  return `
    <button class="ios-record-total-card" type="button" data-day-nutrition="${day}">
      <header>
        <strong>${escapeHTML(title)}</strong>
        <span>${values.nutrientList.length ? `${integer(values.nutrientList.length)} nutrients` : ''}${uiIcon('chevron')}</span>
      </header>
      <div class="ios-record-rings">
        ${metrics.map((metric) => {
          const rawValue = metric.tone === 'calories'
            ? values.calories
            : metric.tone === 'protein'
              ? values.protein
              : metric.tone === 'carbs'
                ? values.carbohydrates
                : values.totalFat
          const ratio = Math.max(0, rawValue / metric.target)
          const progress = Math.min(ratio, 1)
          const overage = Math.min(Math.max(ratio - 1, 0), 1)
          return `
            <div class="ios-record-ring ios-record-ring--${metric.tone}" style="--record-progress:${progress.toFixed(4)};--record-overage:${overage.toFixed(4)}">
              <span class="ios-record-ring__canvas">
                <svg viewBox="0 0 58 58" aria-hidden="true">
                  <circle class="ios-record-ring__track" cx="29" cy="29" r="25.5" pathLength="1"></circle>
                  <circle class="ios-record-ring__progress" cx="29" cy="29" r="25.5" pathLength="1"></circle>
                  ${overage > 0 ? '<circle class="ios-record-ring__overage" cx="29" cy="29" r="25.5" pathLength="1"></circle>' : ''}
                </svg>
                <span class="ios-record-ring__value"><strong>${metric.value}</strong><small>${metric.unit}</small></span>
              </span>
              <em>${metric.label}</em>
            </div>
          `
        }).join('')}
      </div>
      ${(values.calories > 0 || burned > 0) ? `
        <div class="ios-record-energy">
          <header><strong>Energy Balance</strong><small>Workout energy only</small></header>
          <div>
            <span><small>Consumed</small><strong class="is-consumed">${integer(values.calories)}<i>cal</i></strong></span>
            <span><small>Burned</small><strong class="is-burned">${integer(burned)}<i>cal</i></strong></span>
            <span><small>Net</small><strong class="${net >= 0 ? 'is-positive' : 'is-burned'}">${net > 0 ? '+' : ''}${integer(net)}<i>cal</i></strong></span>
          </div>
        </div>
      ` : ''}
      <div class="ios-record-fiber">
        <span><small>Fiber</small><strong>${integer(fiber)}g / ${integer(positiveNumber(targets.fiber, 30))}g</strong></span>
        <i><b style="width:${Math.max(0, Math.min(fiber / positiveNumber(targets.fiber, 30) * 100, 100))}%"></b></i>
      </div>
    </button>
  `
}

function recordWaterCard(meals, day) {
  const values = aggregateDayRecord(meals, day)
  const water = values.waterFlOz
  const target = positiveNumber(state.root?.nutrition?.targets?.waterFlOz, 64)
  const progress = Math.max(0, Math.min(water / target, 1))
  return `
    <section class="ios-record-water">
      <span class="ios-record-water__icon" aria-hidden="true">${uiIcon('drop')}</span>
      <span><small>${day === todayDay() ? 'Water today' : `Water · ${escapeHTML(dateLabel(day, { short: true }))}`}</small><strong>${number(water).toFixed(water % 1 ? 1 : 0)} / ${target} fl oz</strong></span>
      <span><strong>${integer(progress * 100)}%</strong><i><b style="width:${progress * 100}%"></b></i></span>
      <i aria-hidden="true">${uiIcon('chevron')}</i>
    </section>
  `
}

function emptyRecordState(day) {
  return `
    <section class="ios-record-empty">
      <span aria-hidden="true">${uiIcon('fork')}</span>
      <div><strong>No meals recorded on ${escapeHTML(dateLabel(day, { short: true }))}</strong><p>${day === todayDay() ? 'Start with one meal. A useful record is built from repeated entries.' : 'No public food recordings are available for this date.'}</p></div>
    </section>
  `
}

function confidenceStatement(summary, nutrientName) {
  const name = String(nutrientName || 'nutrient').toLowerCase()
  if (!summary.sourceMetadataAvailable) {
    return `Food-level ${name} contributions are available, but source-method and confidence metadata are unavailable in this published snapshot.`
  }
  const estimated = Math.round(summary.estimatedFraction * 100)
  const authoritative = Math.round(summary.authoritativeFraction * 100)
  const portion = Math.round(summary.portionEstimatedFraction * 100)
  const sentences = []
  if (estimated > 0) {
    sentences.push(authoritative > 0
      ? `About ${estimated}% of this recorded ${name} value comes from estimated sources; ${authoritative}% from authoritative, measured ones.`
      : `About ${estimated}% of this recorded ${name} value comes from estimated sources.`)
  } else if (summary.authoritativeFraction > 0.999) {
    sentences.push(`This recorded ${name} value comes from authoritative, measured sources.`)
  } else {
    sentences.push(`This recorded ${name} value comes from recorded sources, though not all are independently authoritative.`)
  }
  if (portion > 0) {
    sentences.push(`For ${portion}%, the amount eaten was estimated from a photo — a separate portion margin of error, shown per food below.`)
  }
  if (summary.coverageFraction < 0.95) {
    sentences.push(`${Math.round(summary.coverageFraction * 100)}% of recorded food energy explicitly reports this nutrient; unreported foods remain unknown, not zero.`)
  }
  return sentences.join(' ')
}

function provenanceDetailView(definition, summary, options = {}) {
  const days = Math.max(1, number(options.days, 1))
  const value = Number.isFinite(Number(options.displayValue))
    ? number(options.displayValue)
    : summary.total / days
  const unit = definition?.unit || ''
  const reference = definition?.reference || NUTRIENT_DAILY_VALUES[definition?.key]
  const percent = reference > 0 ? Math.round(value / reference * 100) : null
  const scope = options.scopeLabel || `Average across the last ${days} days`
  const doubt = summary.contributions.filter((row) => (
    row.source.estimated ||
    ['medium', 'low', 'unknown'].includes(row.source.confidenceKey) ||
    row.source.portionError > 0
  ))
  return `
    <section class="ios-provenance-header ios-card">
      <div><strong>${factsValue(value, '')}</strong><span class="ios-provenance-unit">${escapeHTML(unit)}</span>${days > 1 ? '<small>/ day</small>' : ''}</div>
      ${percent == null ? '' : `<span>${percent}% ${options.limit ? 'of limit' : 'of daily reference'}</span>`}
      <p>${escapeHTML(scope)} · ${integer(summary.contributions.length)} ${summary.contributions.length === 1 ? 'food' : 'foods'}</p>
    </section>
    ${reference > 0 ? `
      <section class="ios-provenance-target ios-card">
        <header><strong>Daily Reference</strong><span><i></i>${percent >= 100 ? 'Reference met' : 'Recorded context'}</span></header>
        <div><span>${options.limit ? 'Stay under' : 'Public daily reference'}</span><strong>${formatNutrientValue(reference, unit)}</strong></div>
        <p>Shown as a daily nutrition reference. One recorded day is context; sustained patterns matter more.</p>
      </section>
    ` : ''}
    <section class="ios-provenance-confidence ios-card" style="--source-tone:${summary.confidence.color};--source-progress:${summary.sourceMetadataAvailable ? Math.max(4, summary.score * 100) : 4}%">
      <header>${uiIcon(summary.confidence.icon)}<strong>${escapeHTML(summary.confidence.label)}</strong><b>${summary.sourceMetadataAvailable ? `${Math.round(summary.score * 100)}%` : '—'}</b></header>
      <i><b></b></i>
      <p>${escapeHTML(confidenceStatement(summary, definition?.label))}</p>
      <div>
        <span><small>Food Coverage</small><strong>${Math.round(summary.coverageFraction * 100)}%</strong></span>
        <span><small>${summary.sourceMetadataAvailable ? (days > 1 ? 'Estimated Daily Range' : 'Estimated Range') : 'Source Metadata'}</small><strong>${summary.sourceMetadataAvailable ? `${factsValue(summary.lowerBound / days, '')}–${factsValue(summary.upperBound / days, '')} ${escapeHTML(unit)}` : 'Unavailable in snapshot'}</strong></span>
      </div>
    </section>
    <section class="ios-provenance-sources">
      <h3>Where It Comes From</h3>
      ${['Vitamins', 'Minerals'].includes(definition?.category) ? `
        <div class="ios-provenance-trace-note">${uiIcon('question')}<p>FDA labeling may treat vitamin or mineral amounts below 2% of the daily reference per serving as zero. StatsKey still shows and counts every recorded amount.</p></div>
      ` : ''}
      <div class="ios-provenance-source-list">
        ${summary.contributions.map((row) => {
          const share = summary.total > 0 ? Math.round(row.amount / summary.total * 100) : 0
          const source = row.source
          return `
            <article style="--source-tone:${source.confidence.color}">
              <header><span><strong>${escapeHTML(row.name)}</strong>${row.brand ? `<small>${escapeHTML(row.brand)}</small>` : ''}</span><span><strong>${formatNutrientValue(row.amount / days, unit)}</strong><small>${share}% of total</small></span></header>
              ${source.portionError > 0 ? `
                <div class="ios-provenance-portion">${uiIcon('strength')}<span><strong>±${Math.round(source.portionError)}%${source.lowGrams > 0 && source.highGrams > source.lowGrams ? ` · ≈${integer(source.lowGrams)}–${integer(source.highGrams)} g` : ''}</strong><small>Photo portion estimate — usually the biggest source of error</small></span></div>
              ` : ''}
              <footer><b>Source</b><span>${uiIcon(source.confidence.icon)} ${escapeHTML(source.label)}</span><small>${source.available ? `${source.estimated ? 'Estimated' : 'Measured'}${source.sourceError > 0 ? ` · ±${Math.round(source.sourceError)}% margin` : source.estimated ? '' : ' · authoritative'}` : 'Confidence unavailable in this snapshot'}</small></footer>
              ${source.citation ? `<a href="${escapeHTML(source.citation)}" target="_blank" rel="noopener">${uiIcon('link')} Source</a>` : ''}
            </article>
          `
        }).join('') || '<p class="ios-provenance-empty">Source details were not recorded for this nutrient.</p>'}
      </div>
    </section>
    <section class="ios-provenance-doubt">
      <h3>Where Doubt May Come From</h3>
      ${doubt.length ? doubt.map((row) => `
        <article>${uiIcon(row.source.portionError > 0 && !row.source.estimated ? 'strength' : row.source.filled ? 'sparkles' : 'question')}<span><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.source.label)} · ${escapeHTML(row.source.confidence.short)} confidence${row.source.sourceError > 0 ? ` · ±${Math.round(row.source.sourceError)}% source` : ''}${row.source.portionError > 0 ? ` · ±${Math.round(row.source.portionError)}% portion` : ''}</small></span><b>${summary.total > 0 ? Math.round(row.amount / summary.total * 100) : 0}%</b></article>
      `).join('') : `<article class="is-clear">${uiIcon('seal')}<span><strong>No major sources of doubt</strong><small>This nutrient is well sourced.</small></span></article>`}
    </section>
    <p class="ios-provenance-method">StatsKey separates two kinds of uncertainty. The source margin of error is on a nutrient’s value. The photo portion margin is on the amount eaten when a serving was estimated from a photo. Both are marked, and authoritative sources show full confidence.</p>
  `
}

function makeDayTotalMeal(day) {
  const meals = state.meals.filter((meal) => meal.day === day)
  const values = aggregateDayRecord(meals, day)
  return {
    mealId: `day-${day}`,
    day,
    title: day === todayDay() ? "Today's Total" : `${dateLabel(day, { short: true })} Total`,
    isDailyTotal: true,
    itemCount: meals.reduce((sum, meal) => sum + number(meal.itemCount || meal.items?.length), 0),
    items: meals.flatMap((meal) => meal.items || []),
    nutrients: values.nutrientList,
    calories: values.calories,
    protein: values.protein,
    carbohydrates: values.carbohydrates,
    totalFat: values.totalFat,
  }
}

function selectedMealNutrientDefinition() {
  if (!state.selectedMeal || !state.selectedMealNutrientKey) return null
  const selection = nutritionSelection(state.selectedMeal, state.selectedMealItemIndex)
  const recorded = nutrientByKey(selection.nutrients, state.selectedMealNutrientKey)
  if (recorded) return recorded
  const fallback = {
    calories: { label: 'Calories', unit: 'cal', category: 'Energy', value: selection.calories },
    protein: { label: 'Protein', unit: 'g', category: 'Macros', value: selection.protein },
    carbohydrates: { label: 'Carbohydrates', unit: 'g', category: 'Macros', value: selection.carbohydrates },
    total_fat: { label: 'Total Fat', unit: 'g', category: 'Macros', value: selection.totalFat },
    water: { label: 'Water', unit: 'fl oz', category: 'Other', value: 0 },
  }[state.selectedMealNutrientKey]
  return fallback ? { key: state.selectedMealNutrientKey, ...fallback } : null
}

function mealSourceDetail() {
  const meal = state.selectedMeal
  if (!meal || !state.selectedMealNutrientKey) return mealDetail()
  const selection = nutritionSelection(meal, state.selectedMealItemIndex)
  const definition = selectedMealNutrientDefinition()
  if (!definition) return mealDetail()
  const summary = nutrientProvenance([meal], definition.key, {
    mealId: meal.mealId,
    itemIndex: state.selectedMealItemIndex,
  })
  const displayValue = definition.key === 'calories'
    ? selection.calories
    : definition.key === 'protein'
      ? selection.protein
      : definition.key === 'carbohydrates'
        ? selection.carbohydrates
        : definition.key === 'total_fat'
          ? selection.totalFat
          : definition.value
  return provenanceDetailView(definition, summary, {
    days: 1,
    displayValue,
    scopeLabel: meal.isDailyTotal
      ? (meal.day === todayDay() ? 'Today' : dateLabel(meal.day, { short: true }))
      : meal.title,
  })
}

function dayNutritionDetail(day) {
  const dayMeals = state.meals.filter((meal) => meal.day === day)
  const values = aggregateDayRecord(dayMeals, day)
  const categoryOrder = ['Energy', 'Macros', 'Vitamins', 'Minerals', 'Fats & Lipids', 'Amino Acids', 'Carotenoids', 'Other']
  const categories = ['All', ...categoryOrder.filter((category) => (
    values.nutrientList.some((item) => item.category === category)
  ))]
  if (!categories.includes(state.dayNutrientCategory)) state.dayNutrientCategory = 'All'
  const selected = state.dayNutrientCategory
  const nutrients = values.nutrientList
    .filter((item) => selected === 'All' || item.category === selected)
    .sort((left, right) => (
      categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category) ||
      String(left.label).localeCompare(String(right.label))
    ))
  const summaries = new Map(values.nutrientList.map((item) => [
    item.key,
    nutrientProvenance(dayMeals, item.key),
  ]))
  const calorieSummary = summaries.get('calories') || nutrientProvenance(dayMeals, 'calories')
  const strongCount = Array.from(summaries.values()).filter((summary) => ['full', 'high'].includes(summary.confidenceKey)).length
  const estimatedCount = Array.from(summaries.values()).filter((summary) => summary.estimatedFraction > 0 || summary.portionEstimatedFraction > 0).length
  const incompleteCount = Array.from(summaries.values()).filter((summary) => summary.coverageFraction < 0.8).length
  const macroCards = [
    { key: 'calories', label: 'Energy', value: values.calories, unit: 'cal', tone: 'calories', icon: 'flame', target: DAILY_MACRO_TARGETS.calories },
    { key: 'protein', label: 'Protein', value: values.protein, unit: 'g', tone: 'protein', icon: 'strength', target: DAILY_MACRO_TARGETS.protein },
    { key: 'carbohydrates', label: 'Carbs', value: values.carbohydrates, unit: 'g', tone: 'carbs', icon: 'leaf', target: DAILY_MACRO_TARGETS.carbohydrates },
    { key: 'total_fat', label: 'Fat', value: values.totalFat, unit: 'g', tone: 'fat', icon: 'drop', target: DAILY_MACRO_TARGETS.total_fat },
    { key: 'dietary_fiber', label: 'Fiber', value: number(values.nutrients.get('dietary_fiber')?.value), unit: 'g', tone: 'fiber', icon: 'carrot', target: DAILY_MACRO_TARGETS.dietary_fiber },
    { key: 'water', label: 'Water', value: values.waterFlOz, unit: 'fl oz', tone: 'water', icon: 'drop', target: DAILY_MACRO_TARGETS.water },
  ]
  const signals = values.nutrientList
    .filter((item) => NUTRIENT_DAILY_VALUES[item.key] > 0)
    .map((item) => ({
      item,
      percent: number(item.value) / NUTRIENT_DAILY_VALUES[item.key] * 100,
      summary: summaries.get(item.key),
    }))
    .filter(({ percent }) => percent < 70 || percent > 120)
    .sort((left, right) => Math.abs(right.percent - 100) - Math.abs(left.percent - 100))
    .slice(0, 4)
  return `
    <section class="ios-daily-confidence ios-card" style="--source-tone:${calorieSummary.confidence.color};--source-progress:${Math.max(4, calorieSummary.score * 100)}%">
      <header>${uiIcon('waveform')}<span><small>Confidence &amp; Ranges</small><strong>${escapeHTML(calorieSummary.confidence.label)}</strong></span><b>${Math.round(calorieSummary.score * 100)}%</b></header>
      <i><b></b></i>
      <div><span><strong>${strongCount}</strong><small>high-confidence nutrients</small></span><span><strong>${estimatedCount}</strong><small>include estimates</small></span><span><strong>${incompleteCount}</strong><small>incomplete coverage</small></span></div>
      <aside><span>Estimated calorie range</span><strong>${integer(calorieSummary.lowerBound)}–${integer(calorieSummary.upperBound)} cal</strong></aside>
      <p>Ranges combine each food source’s stated uncertainty with any recorded portion range. They are not statistical 95% confidence intervals.</p>
    </section>
    <div class="ios-section-label"><span>Daily Totals</span></div>
    <section class="ios-daily-macro-grid">
      ${macroCards.map((metric) => {
        const summary = summaries.get(metric.key)
        const progress = Math.max(0, Math.min(number(metric.value) / metric.target * 100, 100))
        return `
          <button class="ios-daily-macro ios-daily-macro--${metric.tone}" type="button" data-day-source-key="${metric.key}" style="--macro-progress:${progress}%">
            <span>${uiIcon(metric.icon)}<small>${metric.label}</small>${summary?.total ? provenanceMarker(summary) : ''}</span>
            <strong>${number(metric.value) >= 100 ? integer(metric.value) : number(metric.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}<i>${metric.unit}</i></strong>
            <small>of ${integer(metric.target)} ${metric.unit} target</small>
            <i><b></b></i>
            ${summary?.upperBound - summary?.lowerBound > Math.max(0.1, number(metric.value) * 0.01) ? `<em>Range ${factsValue(summary.lowerBound, metric.unit)}–${factsValue(summary.upperBound, metric.unit)}</em>` : ''}
          </button>
        `
      }).join('')}
    </section>
    ${signals.length ? `
      <div class="ios-section-label"><span>What Stands Out</span></div>
      <section class="ios-daily-signals">
        ${signals.map(({ item, percent, summary }) => `
          <button type="button" data-day-source-key="${escapeHTML(item.key)}"><i class="${percent > 120 ? 'is-high' : ''}"></i><span><strong>${escapeHTML(item.label)} range is ${percent > 120 ? 'above' : 'low versus'} today’s reference</strong><small>One day is context; sustained patterns matter more.</small></span>${provenanceMarker(summary)}${uiIcon('chevron')}</button>
        `).join('')}
      </section>
    ` : ''}
    <div class="ios-section-label"><span>All Recorded Nutrients</span><small>${integer(nutrients.length)}</small></div>
    <div class="ios-daily-category-pills" role="group" aria-label="Nutrient category">
      ${categories.map((category) => `
        <button class="${category === selected ? 'is-active' : ''}" type="button" data-day-nutrient-category="${escapeHTML(category)}" aria-pressed="${category === selected}">${escapeHTML(category)}</button>
      `).join('')}
    </div>
    <section class="ios-daily-nutrient-grid">
      ${nutrients.length ? nutrients.map((item) => {
        const summary = summaries.get(item.key)
        const percent = nutritionPercent(item.value, item.key)
        return `
          <button type="button" data-day-source-key="${escapeHTML(item.key)}">
            <span><i></i><strong>${escapeHTML(item.label)}</strong>${provenanceMarker(summary)}</span>
            <b>${formatNutrientValue(item.value, item.unit)}</b>
            <small>${percent == null ? escapeHTML(item.category) : `${percent}% of reference`}</small>
            <em>${summary?.contributions.length ? `${integer(summary.contributions.length)} ${summary.sourceMetadataAvailable ? `exact food ${summary.contributions.length === 1 ? 'source' : 'sources'}` : 'contributing foods · source metadata unavailable in snapshot'} · tap to inspect` : 'Item-level source trace unavailable'}</em>
            ${summary?.upperBound - summary?.lowerBound > Math.max(0.01, number(item.value) * 0.01) ? `<em>Estimated range ${factsValue(summary.lowerBound, item.unit)}–${factsValue(summary.upperBound, item.unit)}</em>` : ''}
          </button>
        `
      }).join('') : '<p>No nutrients were recorded for this date.</p>'}
    </section>
    <button class="ios-daily-fda-door" type="button" data-day-fda="${day}">
      ${uiIcon('document')}<span><strong>FDA-style label</strong><small>Open the conventional label using these preserved daily totals.</small></span>${uiIcon('chevron')}
    </button>
  `
}

function mealsHome() {
  const meals = state.meals
  const today = todayDay()
  const selectedDay = state.selectedMealDay || today
  state.selectedMealDay = selectedDay
  const latestMealId = meals[0]?.mealId
  if (!state.mealExpansionInitialized) {
    state.expandedMealId = null
    state.mealExpansionInitialized = true
  }
  const selectedMeals = meals.filter((meal) => meal.day === selectedDay)
  const historyGroups = new Map()
  for (const meal of meals) {
    if (meal.day === selectedDay) continue
    const current = historyGroups.get(meal.day) || []
    current.push(meal)
    historyGroups.set(meal.day, current)
  }
  return `
    ${recordWeekStrip(selectedDay)}
    ${dailyRecordSummary(meals, selectedDay)}
    ${recordWaterCard(meals, selectedDay)}
    <div class="ios-record-selected-day">
      ${selectedMeals.length ? mealTimeline(selectedMeals, latestMealId) : emptyRecordState(selectedDay)}
    </div>
    <div class="ios-section-label ios-section-label--history">
      <span>Recent Record</span>
      <small>Since ${PUBLIC_HISTORY_START_LABEL}</small>
    </div>
    <div class="ios-meal-history">
      ${Array.from(historyGroups.entries()).map(([day, dayMeals]) => `
        <section class="ios-record-history-day">
          <header><strong>${escapeHTML(dateLabel(day, { weekday: true, short: true }))}</strong><small>${integer(dayMeals.length)} ${dayMeals.length === 1 ? 'meal' : 'meals'}</small></header>
          ${mealTimeline(dayMeals, latestMealId)}
        </section>
      `).join('') || '<div class="ios-empty">Older meals will appear here as history loads.</div>'}
    </div>
    <div class="ios-scroll-loader ${state.mealHistoryExhausted ? 'is-complete' : ''}" data-meal-history aria-live="polite">
      ${state.mealHistoryLoading ? '<i></i><span>Loading older meals…</span>' : state.mealHistoryExhausted
        ? '<span>Full public food record loaded</span>'
        : '<i></i><span>Keep scrolling for older meals</span>'}
    </div>
    ${state.mealHistoryError ? `<p class="ios-inline-error">${escapeHTML(state.mealHistoryError)}</p>` : ''}
    <p class="ios-disclaimer">Food only. Supplements, medications, hidden items, notes, photos, and private Intelligence output never load in this public view.</p>
  `
}

function foodArchiveGroups(meals = state.meals) {
  const grouped = new Map()
  for (const meal of meals) {
    if (!meal.day) continue
    const dayMeals = grouped.get(meal.day) || []
    dayMeals.push(meal)
    grouped.set(meal.day, dayMeals)
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, dayMeals]) => ({
      day,
      meals: dayMeals.sort(compareRecorded),
      totals: aggregateDayRecord(dayMeals, day),
    }))
}

function foodRecordTargets() {
  const targets = state.root?.nutrition?.targets || {}
  return {
    calories: positiveNumber(targets.calories, DAILY_MACRO_TARGETS.calories),
    protein: positiveNumber(targets.protein, DAILY_MACRO_TARGETS.protein),
    carbohydrates: positiveNumber(targets.carbohydrates, DAILY_MACRO_TARGETS.carbohydrates),
    totalFat: positiveNumber(targets.totalFat, DAILY_MACRO_TARGETS.total_fat),
    fiber: positiveNumber(targets.fiber, DAILY_MACRO_TARGETS.dietary_fiber),
    waterFlOz: positiveNumber(targets.waterFlOz, DAILY_MACRO_TARGETS.water),
  }
}

function foodMetricBars(values, options = {}) {
  const targets = foodRecordTargets()
  const fiber = number(values.nutrients?.get?.('dietary_fiber')?.value)
  const metrics = [
    { label: 'Energy', value: number(values.calories), target: targets.calories, unit: 'cal', tone: 'energy' },
    { label: 'Protein', value: number(values.protein), target: targets.protein, unit: 'g', tone: 'protein' },
    { label: 'Carbohydrate', value: number(values.carbohydrates), target: targets.carbohydrates, unit: 'g', tone: 'carbs' },
    { label: 'Fat', value: number(values.totalFat), target: targets.totalFat, unit: 'g', tone: 'fat' },
    { label: 'Fiber', value: fiber, target: targets.fiber, unit: 'g', tone: 'fiber' },
    { label: 'Water', value: number(values.waterFlOz), target: targets.waterFlOz, unit: 'fl oz', tone: 'water' },
  ]
  return `
    <section class="food-target-panel">
      <header>
        <div><small>${escapeHTML(options.eyebrow || 'DAILY INTAKE')}</small><h5>${escapeHTML(options.title || 'Recorded totals against live targets')}</h5></div>
        <span>Targets update with the public record</span>
      </header>
      <div class="food-target-grid">
        ${metrics.map((metric) => {
          const ratio = metric.target > 0 ? metric.value / metric.target : 0
          const width = Math.min(100, Math.max(0, ratio * 100))
          return `
            <article class="food-target food-target--${metric.tone}">
              <div><span>${metric.label}</span><strong>${metric.value.toLocaleString(undefined, { maximumFractionDigits: metric.value < 100 ? 1 : 0 })}<i>${metric.unit}</i></strong></div>
              <div class="food-target__track"><i style="width:${width.toFixed(2)}%"></i></div>
              <footer><span>${integer(metric.target)} ${metric.unit} target</span><b>${Math.round(ratio * 100)}%</b></footer>
            </article>
          `
        }).join('')}
      </div>
    </section>
  `
}

function foodIntakeTrend(groups) {
  if (!groups.length) return ''
  const latestDay = groups[0].day
  const oldestLoaded = groups.at(-1).day
  const firstDay = shiftDay(latestDay, -13) < oldestLoaded
    ? oldestLoaded
    : shiftDay(latestDay, -13)
  const days = []
  for (let day = firstDay; day <= latestDay && days.length < 14; day = shiftDay(day, 1)) {
    const group = groups.find((entry) => entry.day === day)
    days.push({
      day,
      calories: number(group?.totals.calories),
      meals: number(group?.meals.length),
    })
  }
  const target = foodRecordTargets().calories
  const maximum = Math.max(target, ...days.map((day) => day.calories), 1)
  const plotTop = 24
  const plotBottom = 220
  const plotHeight = plotBottom - plotTop
  const slot = 900 / Math.max(1, days.length)
  const barWidth = Math.max(12, Math.min(56, slot * 0.56))
  const moving = days.map((day, index) => {
    const window = days
      .slice(0, index + 1)
      .filter((entry) => entry.day !== todayDay())
      .slice(-3)
    if (!window.length) return day.calories
    return window.reduce((sum, day) => sum + day.calories, 0) / window.length
  })
  const points = moving.map((value, index) => ({
    x: 30 + slot * index + slot / 2,
    y: plotBottom - value / maximum * plotHeight,
  }))
  const completeDays = days.filter((day) => day.day !== todayDay())
  const average = completeDays.reduce((sum, day) => sum + day.calories, 0) /
    Math.max(1, completeDays.length)
  const targetY = plotBottom - target / maximum * plotHeight
  return `
    <section class="food-trend">
      <header>
        <div><small>RECENT INTAKE WINDOW</small><h5>Energy recorded by day</h5></div>
        <span><i></i> Three-day moving average</span>
      </header>
      <svg viewBox="0 0 960 250" preserveAspectRatio="none" role="img" aria-label="Daily recorded calories from ${escapeHTML(dateLabel(firstDay, { short: true }))} through ${escapeHTML(dateLabel(latestDay, { short: true }))}">
        <path class="food-trend__grid" d="M30 73 H930 M30 122 H930 M30 171 H930 M30 220 H930"></path>
        <line class="food-trend__target" x1="30" y1="${targetY.toFixed(1)}" x2="930" y2="${targetY.toFixed(1)}"></line>
        ${days.map((day, index) => {
          const height = day.calories / maximum * plotHeight
          const x = 30 + slot * index + (slot - barWidth) / 2
          return `
            <rect x="${x.toFixed(1)}" y="${(plotBottom - height).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="5">
              <title>${escapeHTML(dateLabel(day.day, { short: true }))}: ${integer(day.calories)} calories across ${integer(day.meals)} records</title>
            </rect>
          `
        }).join('')}
        <polyline class="food-trend__line" points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}"></polyline>
      </svg>
      <div class="food-trend__axis" style="--food-days:${days.length}">
        ${days.map((day, index) => `<span class="${index && index !== days.length - 1 && index % 3 ? 'is-minor' : ''}">${index === 0 || index === days.length - 1 || index % 3 === 0 ? escapeHTML(dateLabel(day.day, { short: true, year: false })) : ''}</span>`).join('')}
      </div>
      <footer>
        <span><small>Complete-day average</small><strong>${integer(average)} cal/day</strong></span>
        <span><small>Live target</small><strong>${integer(target)} cal/day</strong></span>
        <span><small>Loaded days</small><strong>${days.length}</strong></span>
      </footer>
    </section>
  `
}

function foodItemSource(item) {
  const provenance = item?.provenance
  if (!provenance || typeof provenance !== 'object' || !Object.keys(provenance).length) {
    return { label: 'Source metadata unavailable', confidence: CONFIDENCE_META.unknown }
  }
  const source = itemSource(item, 'calories')
  return {
    label: source.label,
    confidence: source.confidence,
  }
}

function foodRecordMealRow(meal, featured = false) {
  const expanded = state.expandedMealId === meal.mealId
  const items = meal.items || []
  const sourcedItems = items.filter((item) => (
    item.provenance &&
    typeof item.provenance === 'object' &&
    Object.keys(item.provenance).length
  )).length
  return `
    <article class="food-record-row ${expanded ? 'is-expanded' : ''} ${featured ? 'is-featured' : ''}">
      <div class="food-record-row__time">
        <strong>${escapeHTML(meal.timeLabel || '—')}</strong>
        <small>${escapeHTML(mealTypeLabel(meal))}</small>
      </div>
      <div class="food-record-row__identity">
        <strong>${escapeHTML(meal.title || 'Meal')}</strong>
        <span>${integer(items.length || meal.itemCount)} ${items.length === 1 ? 'item' : 'items'} · ${integer((meal.nutrients || []).length)} nutrient fields</span>
      </div>
      <div class="food-record-row__macros">
        <span><small>Energy</small><strong>${integer(meal.calories)} cal</strong></span>
        <span><small>Protein</small><strong>${number(meal.protein).toFixed(1)} g</strong></span>
        <span><small>Carbs</small><strong>${number(meal.carbohydrates).toFixed(1)} g</strong></span>
        <span><small>Fat</small><strong>${number(meal.totalFat).toFixed(1)} g</strong></span>
      </div>
      <div class="food-record-row__coverage">
        <small>Source metadata</small>
        <strong>${items.length ? Math.round(sourcedItems / items.length * 100) : 0}%</strong>
      </div>
      <div class="food-record-row__actions">
        <button type="button" data-meal-expand="${escapeHTML(meal.mealId)}" aria-expanded="${expanded}">${expanded ? 'Hide foods' : 'Show foods'}</button>
        <button class="is-primary" type="button" data-meal-id="${escapeHTML(meal.mealId)}">Inspect data</button>
      </div>
      ${expanded ? `
        <div class="food-record-items">
          <div class="food-record-items__head"><span>Food</span><span>Serving</span><span>Macronutrients</span><span>Recorded source</span><span></span></div>
          ${items.map((item, index) => {
            const source = foodItemSource(item)
            return `
              <div class="food-record-item">
                <span><strong>${escapeHTML(item.name || 'Food')}</strong><small>${escapeHTML(item.brand || '')}</small></span>
                <span>${number(item.servingSize).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHTML(item.servingUnit || 'serving')}</span>
                <span>${integer(item.calories)} cal · ${number(item.protein).toFixed(1)} P · ${number(item.carbohydrates).toFixed(1)} C · ${number(item.totalFat).toFixed(1)} F</span>
                <span style="--food-source:${source.confidence.color}"><i></i>${escapeHTML(source.label)}</span>
                <button type="button" data-meal-item-facts="${escapeHTML(meal.mealId)}" data-meal-item-index="${index}">All fields</button>
              </div>
            `
          }).join('') || '<p>No item-level records were published for this meal.</p>'}
        </div>
      ` : ''}
    </article>
  `
}

function foodArchiveDay(group, options = {}) {
  const latestMealId = state.meals[0]?.mealId
  return `
    <section class="food-archive-day">
      <header>
        <div><small>${escapeHTML(dayDate(group.day)?.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) || '')}</small><h5>${escapeHTML(dateLabel(group.day, { short: true }))}</h5></div>
        <div class="food-archive-day__totals">
          <span><small>Records</small><strong>${integer(group.meals.length)}</strong></span>
          <span><small>Energy</small><strong>${integer(group.totals.calories)} cal</strong></span>
          <span><small>Protein</small><strong>${integer(group.totals.protein)} g</strong></span>
          <span><small>Carbs</small><strong>${integer(group.totals.carbohydrates)} g</strong></span>
          <span><small>Fat</small><strong>${integer(group.totals.totalFat)} g</strong></span>
          <span><small>Nutrients</small><strong>${integer(group.totals.nutrientList.length)}</strong></span>
        </div>
        ${options.showDayAction === false ? '' : `<button type="button" data-day-nutrition="${group.day}">Inspect day</button>`}
      </header>
      <div class="food-record-table" role="table" aria-label="Food records for ${escapeHTML(dateLabel(group.day))}">
        <div class="food-record-table__head" role="row"><span>Time</span><span>Record</span><span>Macronutrients</span><span>Coverage</span><span>Actions</span></div>
        ${group.meals.map((meal) => foodRecordMealRow(meal, meal.mealId === latestMealId)).join('')}
      </div>
    </section>
  `
}

function foodRecordHome() {
  const groups = foodArchiveGroups()
  const metadata = state.root?.mealRecord || {}
  const latest = groups[0]
  const loadedItems = state.meals.reduce((sum, meal) => sum + number(meal.itemCount || meal.items?.length), 0)
  const uniqueNutrients = new Set(state.meals.flatMap((meal) => (
    (meal.nutrients || []).map((nutrient) => nutrient.key)
  ))).size
  if (!latest) {
    return '<section class="food-record-empty"><strong>No public food records are available.</strong><p>New published records will appear here automatically.</p></section>'
  }
  return `
    <section class="food-record-overview">
      <header>
        <div><small>PUBLIC FOOD DATASET</small><h5>A complete nutritional record, presented for the web</h5><p>Every published meal remains individually inspectable without reproducing the StatsKey app interface.</p></div>
        <span>Live through ${escapeHTML(dateLabel(
          !metadata.latestDay || latest.day > metadata.latestDay ? latest.day : metadata.latestDay,
          { short: true }
        ))}</span>
      </header>
      <div>
        <article><small>Historical records</small><strong>${integer(metadata.mealCount || state.meals.length)}</strong><span>since ${escapeHTML(dateLabel(metadata.startDay || PUBLIC_HISTORY_START_DAY, { short: true }))}</span></article>
        <article><small>Recorded days</small><strong>${integer(metadata.recordedDays || groups.length)}</strong><span>full archive loads on scroll</span></article>
        <article><small>Records loaded now</small><strong>${integer(state.meals.length)}</strong><span>${integer(loadedItems)} individual food items</span></article>
        <article><small>Nutrient fields</small><strong>${integer(uniqueNutrients)}</strong><span>preserved in the loaded window</span></article>
      </div>
    </section>
    ${foodIntakeTrend(groups)}
    ${foodMetricBars(latest.totals, {
      eyebrow: latest.day === todayDay() ? 'TODAY SO FAR' : 'LATEST COMPLETE DAY',
      title: dateLabel(latest.day, { weekday: true, short: true }),
    })}
    <section class="food-archive">
      <header><div><small>RECORD-LEVEL ARCHIVE</small><h5>Every meal and every food</h5></div><span>${integer(state.meals.length)} records loaded</span></header>
      ${groups.map((group) => foodArchiveDay(group)).join('')}
    </section>
    <div class="food-history-loader ${state.mealHistoryExhausted ? 'is-complete' : ''}" data-meal-history aria-live="polite">
      ${state.mealHistoryLoading ? '<i></i><span>Loading older records…</span>' : state.mealHistoryExhausted
        ? `<span>Full public food record loaded · ${integer(state.meals.length)} records</span>`
        : '<i></i><span>Continue scrolling to load the full historical record</span>'}
    </div>
    ${state.mealHistoryError ? `<p class="food-record-error">${escapeHTML(state.mealHistoryError)}</p>` : ''}
    <p class="food-record-disclaimer">Public food data only. Private notes, photos, medications, supplements, hidden items, and private Intelligence output are never requested by this page.</p>
  `
}

function completeNutritionSelection(meal) {
  const selection = nutritionSelection(meal, state.selectedMealItemIndex)
  const nutrients = new Map((selection.nutrients || []).map((nutrient) => [nutrient.key, nutrient]))
  const core = [
    { key: 'calories', label: 'Calories', unit: 'kcal', category: 'Energy', value: selection.calories },
    { key: 'protein', label: 'Protein', unit: 'g', category: 'Macros', value: selection.protein },
    { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g', category: 'Macros', value: selection.carbohydrates },
    { key: 'total_fat', label: 'Total Fat', unit: 'g', category: 'Macros', value: selection.totalFat },
  ]
  for (const nutrient of core) {
    if (!nutrients.has(nutrient.key)) nutrients.set(nutrient.key, nutrient)
  }
  return { ...selection, nutrients: Array.from(nutrients.values()) }
}

function foodCategoryOrder(nutrients) {
  const preferred = ['Energy', 'Macros', 'Carbohydrates', 'Vitamins', 'Minerals', 'Fats & Lipids', 'Amino Acids', 'Carotenoids', 'Hydration', 'Other']
  const available = Array.from(new Set(nutrients.map((nutrient) => nutrient.category || 'Other')))
  return [...preferred.filter((category) => available.includes(category)), ...available.filter((category) => !preferred.includes(category))]
}

function sortedFoodNutrients(nutrients) {
  const categories = foodCategoryOrder(nutrients)
  return [...nutrients].sort((left, right) => (
    categories.indexOf(left.category || 'Other') - categories.indexOf(right.category || 'Other') ||
    String(left.label).localeCompare(String(right.label))
  ))
}

function foodNutrientTable(nutrients, summaries, sourceAttribute) {
  return `
    <div class="food-nutrient-table" role="table">
      <div class="food-nutrient-table__head" role="row"><span>Nutrient</span><span>Recorded amount</span><span>Daily reference</span><span>Food coverage</span><span>Source detail</span></div>
      ${sortedFoodNutrients(nutrients).map((nutrient) => {
        const summary = summaries.get(nutrient.key)
        const percent = nutritionPercent(nutrient.value, nutrient.key)
        const coverage = summary?.total > 0 ? Math.round(summary.coverageFraction * 100) : null
        const sourceStatus = summary?.sourceMetadataAvailable
          ? summary.confidence.short
          : summary?.contributions.length
            ? 'Method unavailable'
            : 'No positive contribution'
        return `
          <div class="food-nutrient-row" role="row">
            <span><i>${escapeHTML(nutrient.category || 'Other')}</i><strong>${escapeHTML(nutrient.label || nutrient.key)}</strong></span>
            <strong>${formatNutrientValue(number(nutrient.value), nutrient.unit)}</strong>
            <span>${percent == null ? 'No public reference' : `${percent}% of reference`}</span>
            <span>${coverage == null ? '—' : `${coverage}%`}<small>${integer(summary?.contributions.length)} contributing ${summary?.contributions.length === 1 ? 'food' : 'foods'}</small></span>
            <button type="button" ${sourceAttribute}="${escapeHTML(nutrient.key)}" aria-label="Inspect source detail for ${escapeHTML(nutrient.label || nutrient.key)}: ${escapeHTML(sourceStatus)}">${escapeHTML(sourceStatus)}</button>
          </div>
        `
      }).join('')}
    </div>
  `
}

function foodRecordScopePicker(meal) {
  if (meal?.isDailyTotal || (meal.items || []).length <= 1) return ''
  return `
    <div class="food-record-scope" role="group" aria-label="Nutrition data scope">
      <span>Data scope</span>
      <button class="${state.selectedMealItemIndex == null ? 'is-active' : ''}" type="button" data-nutrition-item="total">Entire meal</button>
      ${(meal.items || []).map((item, index) => `
        <button class="${state.selectedMealItemIndex === index ? 'is-active' : ''}" type="button" data-nutrition-item="${index}">${escapeHTML(item.name || `Item ${index + 1}`)}</button>
      `).join('')}
    </div>
  `
}

function foodRecordDetail() {
  const meal = state.selectedMeal
  if (!meal) return foodRecordHome()
  const selection = completeNutritionSelection(meal)
  const summaries = new Map(selection.nutrients.map((nutrient) => [
    nutrient.key,
    nutrientProvenance([meal], nutrient.key, {
      mealId: meal.mealId,
      itemIndex: state.selectedMealItemIndex,
    }),
  ]))
  const values = {
    calories: selection.calories,
    protein: selection.protein,
    carbohydrates: selection.carbohydrates,
    totalFat: selection.totalFat,
    waterFlOz: nutrientValue(selection.nutrients, 'water') / 29.5735,
    nutrients: new Map(selection.nutrients.map((nutrient) => [nutrient.key, nutrient])),
  }
  return `
    <section class="food-report-heading">
      <small>${state.selectedMealItemIndex == null ? 'MEAL RECORD' : 'FOOD ITEM RECORD'}</small>
      <h5>${escapeHTML(selection.title)}</h5>
      <p>${escapeHTML(dateLabel(meal.day, { weekday: true, short: true }))}${meal.timeLabel ? ` · ${escapeHTML(meal.timeLabel)}` : ''} · ${escapeHTML(selection.servingText)}</p>
      <span>${integer(selection.nutrients.length)} preserved nutrient fields</span>
    </section>
    ${foodRecordScopePicker(meal)}
    ${foodMetricBars(values, { eyebrow: 'MACRONUTRIENT DATA', title: selection.title })}
    <section class="food-data-section">
      <header><div><small>COMPLETE NUTRIENT MATRIX</small><h5>Every published field</h5></div><span>Select any row for exact food sources and uncertainty</span></header>
      ${foodNutrientTable(selection.nutrients, summaries, 'data-meal-source-key')}
    </section>
    <section class="food-data-section">
      <header><div><small>FOOD COMPOSITION</small><h5>${integer((meal.items || []).length)} individual ${(meal.items || []).length === 1 ? 'item' : 'items'}</h5></div></header>
      <div class="food-composition-table">
        ${(meal.items || []).map((item, index) => {
          const source = foodItemSource(item)
          return `
            <article>
              <span><strong>${escapeHTML(item.name || 'Food')}</strong><small>${escapeHTML(item.brand || '')}</small></span>
              <span><small>Serving</small><strong>${number(item.servingSize).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHTML(item.servingUnit || 'serving')}</strong></span>
              <span><small>Energy</small><strong>${integer(item.calories)} cal</strong></span>
              <span><small>Nutrients</small><strong>${integer((item.nutrients || []).length)}</strong></span>
              <span style="--food-source:${source.confidence.color}"><i></i><small>Source</small><strong>${escapeHTML(source.label)}</strong></span>
              <button type="button" data-nutrition-item="${index}">Inspect item</button>
            </article>
          `
        }).join('')}
      </div>
    </section>
  `
}

function foodDayReport(day) {
  const dayMeals = state.meals.filter((meal) => meal.day === day)
  const totals = aggregateDayRecord(dayMeals, day)
  const categories = ['All', ...foodCategoryOrder(totals.nutrientList)]
  if (!categories.includes(state.dayNutrientCategory)) state.dayNutrientCategory = 'All'
  const selected = state.dayNutrientCategory
  const nutrients = totals.nutrientList.filter((nutrient) => (
    selected === 'All' || (nutrient.category || 'Other') === selected
  ))
  const summaries = new Map(totals.nutrientList.map((nutrient) => [
    nutrient.key,
    nutrientProvenance(dayMeals, nutrient.key),
  ]))
  const burned = (state.allWorkouts || state.workouts)
    .filter((workout) => workout.day === day)
    .reduce((sum, workout) => sum + number(workout.calories), 0)
  const group = { day, meals: dayMeals, totals }
  return `
    <section class="food-report-heading">
      <small>DAILY INTAKE REPORT</small>
      <h5>${escapeHTML(dateLabel(day, { weekday: true, short: true }))}</h5>
      <p>${integer(dayMeals.length)} food ${dayMeals.length === 1 ? 'record' : 'records'} · ${integer(totals.nutrientList.length)} nutrient fields</p>
      <span>Consumed ${integer(totals.calories)} cal · workout energy ${integer(burned)} cal · net ${totals.calories - burned >= 0 ? '+' : ''}${integer(totals.calories - burned)} cal</span>
    </section>
    ${foodMetricBars(totals, { eyebrow: 'DAILY TOTALS', title: dateLabel(day, { weekday: true, short: true }) })}
    <section class="food-data-section">
      <header><div><small>COMPLETE NUTRIENT MATRIX</small><h5>Daily totals and source coverage</h5></div><span>${integer(nutrients.length)} fields shown</span></header>
      <div class="food-category-filter" role="group" aria-label="Nutrient category">
        ${categories.map((category) => `<button class="${category === selected ? 'is-active' : ''}" type="button" data-day-nutrient-category="${escapeHTML(category)}">${escapeHTML(category)}</button>`).join('')}
      </div>
      ${foodNutrientTable(nutrients, summaries, 'data-day-source-key')}
    </section>
    <section class="food-archive food-archive--report">
      <header><div><small>CONSTITUENT RECORDS</small><h5>Meals included in this total</h5></div></header>
      ${foodArchiveDay(group, { showDayAction: false })}
    </section>
  `
}

function foodSourceReport() {
  const meal = state.selectedMeal
  const definition = selectedMealNutrientDefinition()
  if (!meal || !definition) return foodRecordDetail()
  const selection = nutritionSelection(meal, state.selectedMealItemIndex)
  const summary = nutrientProvenance([meal], definition.key, {
    mealId: meal.mealId,
    itemIndex: state.selectedMealItemIndex,
  })
  const value = definition.key === 'calories'
    ? selection.calories
    : definition.key === 'protein'
      ? selection.protein
      : definition.key === 'carbohydrates'
        ? selection.carbohydrates
        : definition.key === 'total_fat'
          ? selection.totalFat
          : number(definition.value)
  const reference = NUTRIENT_DAILY_VALUES[definition.key]
  const percent = reference > 0 ? value / reference * 100 : null
  return `
    <section class="food-report-heading food-report-heading--source">
      <small>NUTRIENT SOURCE REPORT</small>
      <h5>${escapeHTML(definition.label || definition.key)}</h5>
      <p>${escapeHTML(meal.isDailyTotal ? dateLabel(meal.day, { weekday: true, short: true }) : selection.title)}</p>
      <span>${formatNutrientValue(value, definition.unit)}${percent == null ? '' : ` · ${Math.round(percent)}% of daily reference`}</span>
    </section>
    <section class="food-source-summary">
      <article><small>Contributing foods</small><strong>${integer(summary.contributions.length)}</strong><span>${Math.round(summary.coverageFraction * 100)}% food coverage</span></article>
      <article><small>Source confidence</small><strong>${summary.sourceMetadataAvailable ? escapeHTML(summary.confidence.label) : 'Unavailable'}</strong><span>${summary.sourceMetadataAvailable ? `${Math.round(summary.score * 100)}% weighted score` : 'Not present in this published snapshot'}</span></article>
      <article><small>Estimated range</small><strong>${summary.sourceMetadataAvailable ? `${factsValue(summary.lowerBound, '')}–${factsValue(summary.upperBound, '')} ${escapeHTML(definition.unit || '')}` : '—'}</strong><span>source and portion uncertainty</span></article>
      <article><small>Daily reference</small><strong>${reference > 0 ? formatNutrientValue(reference, definition.unit) : 'Not established'}</strong><span>public context, not a personal prescription</span></article>
    </section>
    <section class="food-source-ledger">
      <header><div><small>CONTRIBUTION LEDGER</small><h5>Where this nutrient came from</h5></div><p>${escapeHTML(confidenceStatement(summary, definition.label))}</p></header>
      <div class="food-source-table">
        <div class="food-source-table__head"><span>Food</span><span>Amount</span><span>Share</span><span>Recorded method</span><span>Uncertainty</span></div>
        ${summary.contributions.map((row) => {
          const source = row.source
          const share = summary.total > 0 ? row.amount / summary.total * 100 : 0
          const uncertainty = source.available
            ? [source.sourceError > 0 ? `±${Math.round(source.sourceError)}% source` : 'source measured', source.portionError > 0 ? `±${Math.round(source.portionError)}% portion` : 'portion recorded'].join(' · ')
            : 'Method metadata unavailable'
          return `
            <article style="--food-source:${source.confidence.color}">
              <span><i></i><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.brand || '')}${row.occurrences > 1 ? ` · ${integer(row.occurrences)} entries` : ''}</small></span>
              <strong>${formatNutrientValue(row.amount, definition.unit)}</strong>
              <span>${Math.round(share)}%</span>
              <span><strong>${escapeHTML(source.label)}</strong><small>${source.available ? escapeHTML(source.confidence.short) : 'Unverified'}</small></span>
              <span>${escapeHTML(uncertainty)}${source.citation ? `<a href="${escapeHTML(source.citation)}" target="_blank" rel="noopener">Open source</a>` : ''}</span>
            </article>
          `
        }).join('') || '<p>No positive food-level contribution was recorded for this field.</p>'}
      </div>
    </section>
    <p class="food-record-disclaimer">Unreported nutrient values remain unknown, not zero. Estimated ranges combine recorded source uncertainty with portion uncertainty; they are not statistical 95% confidence intervals.</p>
  `
}

function planHome() {
  const plan = state.plan
  const recent = state.root?.training?.periods?.last7Days ?? {}
  const journey = founderJourneyWeek()
  if (!plan) {
    return `
      <div class="ios-native-heading"><span><small>FITNESS</small><h3>Training Plan</h3></span><time>Week ${integer(journey.weekNumber)} since Sep ’25</time></div>
      ${founderJourneyWeekCard(journey)}
      <div class="ios-empty ios-empty--plan"><span aria-hidden="true">${uiIcon('bars')}</span><strong>No public active plan</strong><p>The screen will populate from the active StatsKey plan when its public projection is enabled.</p></div>
      ${olympicCorrelation(null, recent)}
    `
  }
  const completed = (plan.days || []).filter((day) => day.completed).length
  const totalDays = Math.max(1, (plan.days || []).length)
  const progress = completed / totalDays * 100
  return `
    <div class="ios-native-heading">
      <span><small>FITNESS</small><h3>${escapeHTML(plan.title || 'Training Plan')}</h3></span>
      <time>Week ${integer(journey.weekNumber)} since Sep ’25</time>
    </div>
    ${founderJourneyWeekCard(journey)}
    <section class="ios-plan-hero">
      <span class="ios-plan-hero__eyebrow">CURRENT BLOCK</span>
      <h3>${escapeHTML(plan.phase || 'Progressive training')}</h3>
      <p>${escapeHTML(plan.goal || plan.goalDetails?.targetRace || 'Build durable fitness through structured progression.')}</p>
      <div class="ios-plan-progress"><i style="width:${Math.min(100, progress)}%"></i></div>
      <div class="ios-plan-progress__labels"><span>${completed} completed</span><span>${totalDays} planned days</span></div>
      <div class="ios-plan-metrics">
        <span><small>Planned</small><strong>${number(plan.plannedMiles || plan.targetWeeklyMiles).toFixed(1)} mi</strong></span>
        <span><small>Recorded · 7D</small><strong>${number(recent.runningMiles).toFixed(1)} mi</strong></span>
        <span><small>Plan</small><strong>${integer(plan.currentWeek)} / ${integer(plan.totalWeeks)}</strong></span>
      </div>
    </section>
    <div class="ios-section-label"><span>This Week</span><small>${escapeHTML(plan.weekStartDay ? dateLabel(plan.weekStartDay, { short: true, year: false }) : '')}</small></div>
    <div class="ios-plan-days">
      ${(plan.days || []).map((day) => `
        <article class="${day.completed ? 'is-complete' : ''} ${day.isRestDay ? 'is-rest' : ''}">
          <span class="ios-plan-day__status" aria-hidden="true">${day.completed ? '✓' : day.isRestDay ? '—' : '○'}</span>
          <span class="ios-plan-day__body">
            <small>${escapeHTML(day.day || '')}</small>
            <strong>${escapeHTML(day.title || 'Training')}</strong>
            ${day.description ? `<p>${escapeHTML(day.description)}</p>` : ''}
            ${day.paceGuidance ? `<em>${escapeHTML(day.paceGuidance)}</em>` : ''}
          </span>
          <span class="ios-plan-day__metric">
            <strong>${number(day.distanceMiles) > 0 ? `${number(day.distanceMiles).toFixed(1)} mi` : escapeHTML(day.durationLabel || '')}</strong>
            ${number(day.durationMinutes) > 0 ? `<small>${integer(day.durationMinutes)} min</small>` : ''}
          </span>
        </article>
      `).join('')}
    </div>
    ${olympicCorrelation(plan, recent)}
  `
}

function founderJourneyWeekCard(journey) {
  return `
    <section class="ios-founder-journey-week">
      <header>
        <span>
          <small>THE LONG EXPERIMENT</small>
          <strong>Week ${integer(journey.weekNumber)}</strong>
          <em>since September 1, 2025</em>
        </span>
        <time>${escapeHTML(dateLabel(journey.weekStartDay, { short: true, year: false }))}–${escapeHTML(dateLabel(journey.weekEndDay, { short: true, year: false }))}</time>
      </header>
      <p>Calendar week ${integer(journey.weekNumber)} in the live training record. The active plan’s own week stays separate below.</p>
      ${journey.note ? `
        <blockquote>
          <small>MILLER WEEK NOTE</small>
          <p>${escapeHTML(journey.note)}</p>
        </blockquote>
      ` : ''}
    </section>
  `
}

function olympicCorrelation(plan, recent) {
  const planned = number(plan?.plannedMiles || plan?.targetWeeklyMiles)
  const actual = number(recent?.runningMiles)
  const completion = planned > 0 ? Math.min(100, actual / planned * 100) : 0
  const goal = plan?.goalDetails ?? {}
  const goalTitle = goal.targetRace || plan?.goal || 'Olympic marathon experiment'
  const goalMeta = [
    goal.targetDate ? dateLabel(goal.targetDate) : null,
    number(goal.targetTimeSeconds) > 0
      ? `${formatDuration(number(goal.targetTimeSeconds))} target`
      : null,
    number(goal.targetWeeklyMileage) > 0
      ? `${number(goal.targetWeeklyMileage).toFixed(0)} mi/week goal`
      : null,
  ].filter(Boolean)
  return `
    <section class="ios-card ios-olympic-path">
      <div class="ios-card-head">
        <span><span class="ios-card-icon ios-card-icon--run">${uiIcon('target')}</span><span><small class="ios-card-kicker">THE LONG EXPERIMENT</small><strong class="ios-card-title">Path to an Olympic Marathon</strong></span></span>
      </div>
      <p class="ios-card-copy">This week is not a qualification claim. It is one live input in a benchmark-gated, multi-year attempt to build the durability required for marathon-specific training.</p>
      <div class="ios-olympic-goal">
        <small>LIVE GOAL CONTEXT</small>
        <strong>${escapeHTML(goalTitle)}</strong>
        ${goalMeta.length ? `<span>${goalMeta.map(escapeHTML).join(' · ')}</span>` : ''}
      </div>
      <div class="ios-olympic-ladder">
        <span class="is-current"><i>1</i><b>Consistency</b><small>Complete repeatable weeks and recover well.</small></span>
        <span><i>2</i><b>Durability</b><small>Raise sustainable volume and long-run capacity.</small></span>
        <span><i>3</i><b>Performance gates</b><small>Earn progression through verified race benchmarks.</small></span>
        <span><i>4</i><b>Marathon specificity</b><small>Only after the aerobic base supports the work.</small></span>
      </div>
      ${planned > 0 ? `
        <div class="ios-plan-correlation">
          <span><small>Current plan execution</small><strong>${actual.toFixed(1)} / ${planned.toFixed(1)} mi</strong></span>
          <i><b style="width:${completion}%"></b></i>
        </div>
      ` : ''}
      <p class="ios-card-copy ios-card-copy--benchmark">Long-term experiment benchmark: 2:16 marathon / 1:03 half marathon. The plan advances only when the evidence does.</p>
    </section>
  `
}

function renderPerformanceSummary() {
  if (!elements.summary || !state.root) return
  const year = currentYearSummary()
  const last7 = state.root?.training?.periods?.last7Days ?? {}
  const history = publicHistorySummary()
  const historyRate = publicHistoryWeeklyRate(history)
  const latestWorkout = state.workouts[0]
  const latestMeal = state.meals[0]
  elements.summary.innerHTML = `
    <article>
      <small>RUNNING SINCE SEP ’25</small>
      <strong>${number(history.runningMiles).toFixed(1)} <i>mi</i></strong>
      <span>${integer(history.runningActivities)} runs in the public record</span>
    </article>
    <article>
      <small>AVG. SINCE SEP 1</small>
      <strong>${historyRate.average.toFixed(1)} <i>mi/wk</i></strong>
      <span>${historyRate.miles.toFixed(1)} mi ÷ ${historyRate.elapsedWeeks.toFixed(1)} weeks · through ${escapeHTML(dateLabel(historyRate.endDay, { short: true, year: false }))}</span>
    </article>
    <article>
      <small>${escapeHTML(year.year)} RUNNING</small>
      <strong>${year.miles.toFixed(1)} <i>mi</i></strong>
      <span>${integer(year.activities)} runs · ${year.averagePerWeek.toFixed(1)} mi/week</span>
    </article>
    <article>
      <small>LAST 7 DAYS</small>
      <strong>${number(last7.runningMiles).toFixed(1)} <i>mi</i></strong>
      <span>${integer(last7.runningActivities || last7.activities)} runs · ${formatDuration(number(last7.activeHours) * 3600)}</span>
    </article>
    <article>
      <small>COMPLETE HISTORY</small>
      <strong>${integer(history.activities)}</strong>
      <span>Workouts · ${integer(history.activeDays)} active days</span>
    </article>
    <article>
      <small>LATEST LIVE RECORD</small>
      <strong>${latestWorkout ? escapeHTML(sportLabel(latestWorkout.sport)) : '—'}</strong>
      <span>${latestWorkout ? `${escapeHTML(dateLabel(latestWorkout.day, { short: true, year: false }))} · ${escapeHTML(formatWorkoutDistance(latestWorkout))}` : 'Awaiting workout'}${latestMeal ? ` · ${escapeHTML(latestMeal.title || 'Meal')}` : ''}</span>
    </article>
  `
}

function renderRunning() {
  if (!elements.runningScreen || !state.root) return
  const scrollTop = elements.runningScreen.scrollTop
  elements.runningTitle.textContent = state.runningView === 'detail'
    ? sportLabel(state.selectedWorkout?.sport)
    : 'Performance history'
  elements.runningBack.hidden = state.runningView !== 'detail'
  elements.runningScreen.innerHTML = state.runningView === 'detail'
    ? workoutDetail()
    : runningHome()
  elements.runningScreen.scrollTop = scrollTop
}

function renderNutrition() {
  if (!elements.nutritionScreen || !state.root) return
  const nutrition = nutritionSnapshot()
  const selected = (nutrition?.nutrients ?? nutrition?.micronutrients ?? [])
    .find((item) => item.key === state.selectedNutrient)
  elements.nutritionScreen.innerHTML = state.selectedNutrient
    ? nutrientDetail(selected)
    : nutritionHome()
}

function renderMeals() {
  if (!elements.mealsScreen || !state.root) return
  const scrollTop = elements.mealsScreen.scrollTop
  const sourceDefinition = selectedMealNutrientDefinition()
  elements.mealsTitle.textContent = state.mealsView === 'detail'
    ? 'Meal data'
    : state.mealsView === 'dayNutrition'
      ? 'Daily intake'
      : state.mealsView === 'sourceDetail'
        ? (sourceDefinition?.label || 'Nutrient source')
        : 'Food history'
  const sheetMode = state.mealsView !== 'home'
  elements.mealsNav.classList.toggle('is-sheet', sheetMode)
  elements.mealsBack.hidden = true
  elements.mealsDone.hidden = !sheetMode
  elements.mealsToday.hidden = true
  elements.mealsScreen.innerHTML = state.mealsView === 'detail'
    ? foodRecordDetail()
    : state.mealsView === 'dayNutrition'
      ? foodDayReport(state.selectedMealDay || todayDay())
      : state.mealsView === 'sourceDetail'
        ? foodSourceReport()
        : foodRecordHome()
  elements.mealsScreen.scrollTop = scrollTop
}

function renderPlan() {
  if (!elements.planScreen || !state.root) return
  elements.planScreen.innerHTML = planHome()
}

function render() {
  if (!state.root) return
  renderPerformanceSummary()
  renderRunning()
  renderNutrition()
  renderMeals()
  renderPlan()
  handleFounderPageScroll()
}

function stopRouteListener() {
  state.unsubscribeRoute?.()
  state.unsubscribeRoute = null
  state.route = null
  state.routeLoading = false
}

function openWorkout(workoutId) {
  const workout = (state.allWorkouts ?? state.workouts)
    .find((item) => item.workoutId === workoutId)
  if (!workout) return
  stopRouteListener()
  state.selectedWorkout = workout
  state.runningView = 'detail'
  elements.runningScreen.scrollTop = 0

  // Privacy invariant: the public viewer never requests route coordinates.
  renderRunning()
  scrollFounderPanel('founder-running-app')
}

async function loadMoreWorkouts() {
  if (
    state.workoutsLoading ||
    state.workoutHistoryExhausted ||
    !state.workoutCursor ||
    !database ||
    state.source !== 'live'
  ) return
  state.workoutsLoading = true
  state.workoutsError = null
  renderRunning()
  try {
    const reference = collection(database, 'publicFounderReplicas', 'founder', 'workouts')
    const snapshot = await getDocs(query(
      reference,
      where('day', '>=', PUBLIC_HISTORY_START_DAY),
      orderBy('day', 'desc'),
      startAfter(state.workoutCursor),
      limit(WORKOUT_PAGE_SIZE)
    ))
    const next = snapshot.docs
      .map((entry) => ({ ...entry.data(), workoutId: entry.id }))
      .filter((workout) => !workout.day || workout.day >= PUBLIC_HISTORY_START_DAY)
    state.allWorkouts = mergeRecords(
      state.allWorkouts ?? state.workouts,
      next,
      'workoutId'
    )
    state.workoutCursor = snapshot.docs.at(-1) ?? state.workoutCursor
    state.workoutHistoryExhausted = snapshot.size < WORKOUT_PAGE_SIZE
    state.visibleWorkoutCount = Math.min(
      state.allWorkouts.length,
      state.visibleWorkoutCount + WORKOUT_VISIBLE_STEP
    )
  } catch (error) {
    console.warn('Older founder workout history unavailable', error.code)
    state.workoutsError = 'Older activity is temporarily unavailable; the live summary remains current.'
  } finally {
    state.workoutsLoading = false
    renderRunning()
  }
}

function revealMoreWorkouts() {
  if (state.runningView !== 'home') return
  const workouts = state.allWorkouts ?? state.workouts
  if (state.visibleWorkoutCount < workouts.length) {
    state.visibleWorkoutCount = Math.min(
      workouts.length,
      state.visibleWorkoutCount + WORKOUT_VISIBLE_STEP
    )
    renderRunning()
  }
  if (
    state.visibleWorkoutCount >= workouts.length - 3 &&
    !state.workoutHistoryExhausted
  ) {
    void loadMoreWorkouts()
  }
}

async function loadMoreMeals() {
  if (
    state.mealHistoryLoading ||
    state.mealHistoryExhausted ||
    !state.mealCursor ||
    !database ||
    state.source !== 'live'
  ) return
  state.mealHistoryLoading = true
  state.mealHistoryError = null
  renderMeals()
  try {
    const reference = collection(database, 'publicFounderReplicas', 'founder', 'meals')
    const snapshot = await getDocs(query(
      reference,
      orderBy('recordedAt', 'desc'),
      startAfter(state.mealCursor),
      limit(MEAL_PAGE_SIZE)
    ))
    const next = snapshot.docs.map((entry) => ({ ...entry.data(), mealId: entry.id }))
    state.meals = mergeRecords(
      state.meals,
      next.filter((meal) => !meal.day || meal.day >= PUBLIC_HISTORY_START_DAY),
      'mealId'
    )
    state.mealCursor = snapshot.docs.at(-1) ?? state.mealCursor
    state.mealHistoryExhausted = snapshot.size < MEAL_PAGE_SIZE
  } catch (error) {
    console.warn('Founder meal history unavailable', error.code)
    state.mealHistoryError = 'More meal history is temporarily unavailable.'
  } finally {
    state.mealHistoryLoading = false
    renderMeals()
  }
}

function openMeal(mealId, itemIndex = null, returnView = 'home') {
  const meal = state.meals.find((item) => item.mealId === mealId)
  if (!meal) return
  state.selectedMeal = meal
  state.selectedMealItemIndex = Number.isInteger(itemIndex) ? itemIndex : null
  state.selectedMealNutrientKey = null
  state.mealsReturnView = returnView
  state.mealsView = 'detail'
  elements.mealsScreen.scrollTop = 0
  renderMeals()
  scrollFounderPanel('founder-meals-app')
}

function handleRunningClick(event) {
  const workoutButton = event.target.closest('[data-live-workout]')
  if (workoutButton) {
    openWorkout(workoutButton.dataset.liveWorkout)
    return
  }
  const rangeButton = event.target.closest('[data-running-range]')
  if (rangeButton) {
    state.range = rangeButton.dataset.runningRange
    state.fitnessMenu = null
    renderRunning()
    return
  }
  const menuButton = event.target.closest('[data-fitness-menu]')
  if (menuButton) {
    const menu = menuButton.dataset.fitnessMenu
    state.fitnessMenu = state.fitnessMenu === menu ? null : menu
    renderRunning()
    return
  }
  const metricButton = event.target.closest('[data-fitness-metric]')
  if (metricButton) {
    state.fitnessMetric = metricButton.dataset.fitnessMetric
    state.fitnessMenu = null
    renderRunning()
    return
  }
  const styleButton = event.target.closest('[data-fitness-style]')
  if (styleButton) {
    state.fitnessChartStyle = styleButton.dataset.fitnessStyle
    state.fitnessMenu = null
    renderRunning()
    return
  }
  if (event.target.closest('[data-running-history]')) {
    revealMoreWorkouts()
  }
}

function handleRunningScroll() {
  if (state.runningView !== 'home') return
  const remaining = elements.runningScreen.scrollHeight -
    elements.runningScreen.scrollTop -
    elements.runningScreen.clientHeight
  if (remaining < 260) revealMoreWorkouts()
}

function handleNutritionClick(event) {
  const rangeButton = event.target.closest('[data-nutrition-range]')
  if (rangeButton) {
    state.nutritionRangeDays = Number(rangeButton.dataset.nutritionRange)
    state.selectedNutrient = null
    renderNutrition()
    return
  }
  if (event.target.closest('[data-include-today]')) {
    state.includeToday = !state.includeToday
    state.selectedNutrient = null
    renderNutrition()
    return
  }
  const nutrient = event.target.closest('[data-nutrient-key]')
  if (nutrient) {
    state.selectedNutrient = nutrient.dataset.nutrientKey
    elements.nutritionScreen.scrollTop = 0
    renderNutrition()
    return
  }
  if (event.target.closest('[data-nutrition-back]')) {
    state.selectedNutrient = null
    elements.nutritionScreen.scrollTop = 0
    renderNutrition()
  }
}

function handleMealsClick(event) {
  const expand = event.target.closest('[data-meal-expand]')
  if (expand) {
    state.expandedMealId = state.expandedMealId === expand.dataset.mealExpand
      ? null
      : expand.dataset.mealExpand
    renderMeals()
    return
  }
  const itemFacts = event.target.closest('[data-meal-item-facts]')
  if (itemFacts) {
    openMeal(
      itemFacts.dataset.mealItemFacts,
      Number(itemFacts.dataset.mealItemIndex),
      'home'
    )
    return
  }
  const dayNutrition = event.target.closest('[data-day-nutrition]')
  if (dayNutrition) {
    state.selectedMealDay = dayNutrition.dataset.dayNutrition
    state.dayNutrientCategory = 'All'
    state.selectedMeal = null
    state.selectedMealNutrientKey = null
    state.mealsView = 'dayNutrition'
    elements.mealsScreen.scrollTop = 0
    renderMeals()
    return
  }
  const selectedDay = event.target.closest('[data-meal-day]')
  if (selectedDay) {
    state.selectedMealDay = selectedDay.dataset.mealDay
    elements.mealsScreen.scrollTop = 0
    renderMeals()
    return
  }
  const week = event.target.closest('[data-meal-week]')
  if (week && !week.disabled) {
    const shifted = shiftDay(state.selectedMealDay || todayDay(), number(week.dataset.mealWeek))
    state.selectedMealDay = shifted > todayDay() ? todayDay() : shifted
    elements.mealsScreen.scrollTop = 0
    renderMeals()
    return
  }
  const category = event.target.closest('[data-day-nutrient-category]')
  if (category) {
    state.dayNutrientCategory = category.dataset.dayNutrientCategory
    renderMeals()
    return
  }
  const nutritionItem = event.target.closest('[data-nutrition-item]')
  if (nutritionItem) {
    state.selectedMealItemIndex = nutritionItem.dataset.nutritionItem === 'total'
      ? null
      : Number(nutritionItem.dataset.nutritionItem)
    elements.mealsScreen.scrollTop = 0
    renderMeals()
    return
  }
  const daySource = event.target.closest('[data-day-source-key]')
  if (daySource) {
    const day = state.selectedMealDay || todayDay()
    state.selectedMeal = makeDayTotalMeal(day)
    state.selectedMealItemIndex = null
    state.selectedMealNutrientKey = daySource.dataset.daySourceKey
    state.sourceReturnView = 'dayNutrition'
    state.mealsView = 'sourceDetail'
    elements.mealsScreen.scrollTop = 0
    renderMeals()
    return
  }
  const mealSource = event.target.closest('[data-meal-source-key]')
  if (mealSource && state.selectedMeal) {
    const selection = nutritionSelection(state.selectedMeal, state.selectedMealItemIndex)
    const definition = nutrientByKey(selection.nutrients, mealSource.dataset.mealSourceKey)
    const isMacro = ['calories', 'protein', 'carbohydrates', 'total_fat'].includes(mealSource.dataset.mealSourceKey)
    if (definition || isMacro) {
      state.selectedMealNutrientKey = mealSource.dataset.mealSourceKey
      state.sourceReturnView = 'detail'
      state.mealsView = 'sourceDetail'
      elements.mealsScreen.scrollTop = 0
      renderMeals()
    }
    return
  }
  const dayFda = event.target.closest('[data-day-fda]')
  if (dayFda) {
    state.selectedMeal = makeDayTotalMeal(dayFda.dataset.dayFda)
    state.selectedMealItemIndex = null
    state.selectedMealNutrientKey = null
    state.mealsReturnView = 'dayNutrition'
    state.mealsView = 'detail'
    elements.mealsScreen.scrollTop = 0
    renderMeals()
    return
  }
  const meal = event.target.closest('[data-meal-id]')
  if (meal) {
    const itemIndex = meal.dataset.mealItemIndex == null
      ? null
      : Number(meal.dataset.mealItemIndex)
    openMeal(meal.dataset.mealId, itemIndex, 'home')
    return
  }
  if (event.target.closest('[data-meal-history]')) {
    void loadMoreMeals()
  }
}

function handleMealsScroll() {
  if (state.mealsView !== 'home') return
  const remaining = elements.mealsScreen.scrollHeight -
    elements.mealsScreen.scrollTop -
    elements.mealsScreen.clientHeight
  if (remaining < 320) void loadMoreMeals()
}

function handleFounderPageScroll() {
  if (pageScrollFrame != null) return
  pageScrollFrame = window.requestAnimationFrame(() => {
    pageScrollFrame = null
    if (Date.now() < pausePageLoadingUntil) return
    const threshold = window.innerHeight + 900
    const workoutLoader = elements.runningScreen
      ?.querySelector('[data-running-history]')
    const workoutBounds = workoutLoader?.getBoundingClientRect()
    if (
      state.runningView === 'home' &&
      workoutLoader &&
      workoutBounds.top < threshold &&
      workoutBounds.bottom > 160
    ) {
      revealMoreWorkouts()
    }
    const mealLoader = elements.mealsScreen
      ?.querySelector('[data-meal-history]')
    const mealBounds = mealLoader?.getBoundingClientRect()
    if (
      state.mealsView === 'home' &&
      mealLoader &&
      mealBounds.top < threshold &&
      mealBounds.bottom > 160
    ) {
      void loadMoreMeals()
    }
  })
}

function scrollFounderPanel(panelId, smooth = true) {
  const panel = document.getElementById(panelId)
  if (!panel) return
  pausePageLoadingUntil = Date.now() + 700
  window.requestAnimationFrame(() => {
    panel.scrollIntoView({
      block: 'start',
      behavior: smooth &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'instant',
    })
  })
}

function handleDataNavigation(event) {
  const link = event.target.closest('a[href^="#founder-"]')
  if (!link) return
  const panelId = link.hash.slice(1)
  if (!document.getElementById(panelId)) return
  event.preventDefault()
  pausePageLoadingUntil = Date.now() + 900
  window.history.replaceState(null, '', link.hash)
  scrollFounderPanel(panelId)
  if (navigationSettleTimer != null) {
    window.clearTimeout(navigationSettleTimer)
  }
  navigationSettleTimer = window.setTimeout(() => {
    navigationSettleTimer = null
    pausePageLoadingUntil = 0
    scrollFounderPanel(panelId, false)
  }, 520)
}

function cleanup() {
  state.unsubscribeRoot?.()
  state.unsubscribeWorkouts?.()
  state.unsubscribeMeals?.()
  state.unsubscribePlan?.()
  state.unsubscribeJourney?.()
  if (state.journeyWeekTimer != null) {
    window.clearInterval(state.journeyWeekTimer)
    state.journeyWeekTimer = null
  }
  window.removeEventListener('scroll', handleFounderPageScroll)
  window.removeEventListener('resize', handleFounderPageScroll)
  if (pageScrollFrame != null) {
    window.cancelAnimationFrame(pageScrollFrame)
    pageScrollFrame = null
  }
  if (navigationSettleTimer != null) {
    window.clearTimeout(navigationSettleTimer)
    navigationSettleTimer = null
  }
  elements.dataNav?.removeEventListener('click', handleDataNavigation)
  stopRouteListener()
}

export function initFounderLive() {
  const stage = document.getElementById('founder-live')
  if (!stage) return
  elements = {
    stage,
    status: document.getElementById('founder-live-status'),
    updated: document.getElementById('founder-live-updated'),
    summary: document.getElementById('founder-performance-summary'),
    dataNav: stage.querySelector('.founder-data-nav'),
    runningScreen: document.getElementById('founder-running-screen'),
    runningTitle: document.getElementById('founder-running-title'),
    runningBack: document.getElementById('founder-running-back'),
    nutritionScreen: document.getElementById('founder-nutrition-screen'),
    mealsNav: document.getElementById('founder-meals-nav'),
    mealsScreen: document.getElementById('founder-meals-screen'),
    mealsTitle: document.getElementById('founder-meals-title'),
    mealsBack: document.getElementById('founder-meals-back'),
    mealsToday: document.getElementById('founder-meals-today'),
    mealsDone: document.getElementById('founder-meals-done'),
    planScreen: document.getElementById('founder-plan-screen'),
  }
  if (Object.values(elements).some((element) => element == null)) return

  elements.runningScreen.addEventListener('click', handleRunningClick)
  elements.runningScreen.addEventListener('scroll', handleRunningScroll, { passive: true })
  elements.nutritionScreen.addEventListener('click', handleNutritionClick)
  elements.mealsScreen.addEventListener('click', handleMealsClick)
  elements.mealsScreen.addEventListener('scroll', handleMealsScroll, { passive: true })
  elements.dataNav.addEventListener('click', handleDataNavigation)
  window.addEventListener('scroll', handleFounderPageScroll, { passive: true })
  window.addEventListener('resize', handleFounderPageScroll, { passive: true })
  elements.runningBack.addEventListener('click', () => {
    stopRouteListener()
    state.runningView = 'home'
    state.selectedWorkout = null
    elements.runningScreen.scrollTop = 0
    renderRunning()
  })
  const closeMealsSheet = () => {
    if (state.mealsView === 'sourceDetail') {
      state.mealsView = state.sourceReturnView
      state.selectedMealNutrientKey = null
    } else if (state.mealsView === 'detail') {
      state.mealsView = state.mealsReturnView
      state.selectedMealItemIndex = null
      if (state.mealsView === 'home') state.selectedMeal = null
    } else {
      state.mealsView = 'home'
      state.selectedMeal = null
      state.selectedMealItemIndex = null
      state.selectedMealNutrientKey = null
    }
    elements.mealsScreen.scrollTop = 0
    renderMeals()
  }
  elements.mealsBack.addEventListener('click', closeMealsSheet)
  elements.mealsDone.addEventListener('click', closeMealsSheet)
  elements.mealsToday.addEventListener('click', () => {
    state.selectedMealDay = todayDay()
    state.mealsView = 'home'
    elements.mealsScreen.scrollTop = 0
    renderMeals()
  })

  if (window.location.hash === '#founder-live') {
    connectLiveRecord()
  } else if (typeof window.IntersectionObserver === 'function') {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      connectLiveRecord()
    }, { rootMargin: '900px 0px' })
    observer.observe(stage)
  } else {
    connectLiveRecord()
  }
  window.addEventListener('beforeunload', cleanup, { once: true })
}
