import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check'
import {
  collection,
  doc,
  getFirestore,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyD7b9XKxV0Z7qdcdgMEVuE-fTTIoYsLCpc',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'statskey.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'statskey',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'statskey.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1081412767986',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:1081412767986:web:15dbdf5870c78be674c06b',
}

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
  quarter: '3 Mo',
  year: 'Year',
  all: 'All',
}

const NUTRITION_RANGE_DAYS = [7, 14, 30, 90]
const PUBLIC_HISTORY_START_DAY = '2025-09-01'
const PUBLIC_HISTORY_START_MONTH = '2025-09'
const PUBLIC_HISTORY_START_LABEL = 'September 2025'

const NUTRIENT_COLORS = {
  strong: '#34c759',
  within: '#34c759',
  near: '#1676d2',
  watch: '#ff9f0a',
  limited: '#8e8e93',
}

const SPORT_LABELS = {
  running: 'Run',
  trailRunning: 'Trail Run',
  cycling: 'Ride',
  swimming: 'Swim',
  walking: 'Walk',
  hiking: 'Hike',
  strength: 'Strength',
  yoga: 'Yoga',
  hiit: 'HIIT',
}

const state = {
  root: null,
  workouts: [],
  historyWorkouts: null,
  historyLoading: false,
  historyError: null,
  source: 'connecting',
  selectedTab: 'activity',
  activityView: 'fitness',
  view: 'home',
  range: 'year',
  nutritionRangeDays: 30,
  includeToday: false,
  nutritionSurface: 'insights',
  nutritionView: 'home',
  selectedNutrient: null,
  selectedWorkout: null,
  activityPositionLocked: false,
  route: null,
  routeLoading: false,
  unsubscribeRoot: null,
  unsubscribeWorkouts: null,
  unsubscribeRoute: null,
}

let elements = {}
let database = null
let chartSequence = 0

const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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

const dateLabel = (day, options = {}) => {
  if (!day) return 'No recorded date'
  const parsed = new Date(`${day}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) return day
  return new Intl.DateTimeFormat('en-US', {
    month: options.short ? 'short' : 'long',
    day: 'numeric',
    year: options.year === false ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
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

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(number(seconds)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
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

const formatPace = (seconds) => {
  const pace = number(seconds)
  if (pace <= 0) return '—'
  const total = Math.round(pace)
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

const sportLabel = (sport) => SPORT_LABELS[sport] || 'Activity'
const isRun = (workout) => ['running', 'trailRunning'].includes(workout?.sport)

const latestDay = () => state.workouts[0]?.day

const isoDay = (date) => date.toISOString().slice(0, 10)

function shiftISODate(day, amount) {
  const parsed = new Date(`${day}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) return day
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return isoDay(parsed)
}

function nutritionSnapshot(
  days = state.nutritionRangeDays,
  includeToday = state.includeToday
) {
  const nutrition = state.root?.nutrition
  if (!nutrition) return null
  const mode = includeToday ? 'includingToday' : 'complete'
  return nutrition.ranges?.[mode]?.[String(days)] ?? nutrition
}

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

function workoutsReference() {
  return query(
    collection(database, 'publicFounderReplicas', 'founder', 'workouts'),
    orderBy('day', 'desc'),
    limit(48)
  )
}

async function loadCompleteWorkoutHistory() {
  if (state.historyWorkouts || state.historyLoading) return
  if (state.source === 'snapshot' && state.workouts.length) {
    state.historyWorkouts = [...state.workouts]
    state.historyError = null
    renderScreen()
    return
  }
  if (!database) return
  state.historyLoading = true
  state.historyError = null
  renderScreen()
  try {
    const reference = collection(
      database,
      'publicFounderReplicas',
      'founder',
      'workouts'
    )
    const snapshot = await getDocs(query(
      reference,
      orderBy('day', 'desc'),
      limit(120)
    ))
    state.historyWorkouts = snapshot.docs.map((entry) => ({
        ...entry.data(),
        workoutId: entry.id,
      }))
  } catch (error) {
    console.warn('Founder workout history unavailable', error.code)
    state.historyError = 'Recent workout history is unavailable; the complete monthly record is still shown.'
  } finally {
    state.historyLoading = false
    renderScreen()
  }
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
      ? `Snapshot · ${dateLabel(state.root?.snapshotDay, { short: true, year: false })}`
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
    setConnectionState('snapshot', `${reason} · live connection pending`)
  } catch (error) {
    console.error('Founder live fallback failed', error)
    state.root = {
      trainingPublished: false,
      nutritionPublished: false,
      snapshotDay: null,
    }
    state.workouts = []
    setConnectionState('error', 'Live record temporarily unavailable')
  }
  render()
}

function connectLiveRecord() {
  try {
    database = initializeFirebase()
  } catch (error) {
    console.error('Founder live Firebase initialization failed', error)
    loadFallback('Published snapshot')
    return
  }

  let rootResolved = false
  const fallbackTimer = window.setTimeout(() => {
    if (!rootResolved) loadFallback('Published snapshot')
  }, 4500)

  state.unsubscribeRoot = onSnapshot(
    publicRootReference(),
    (snapshot) => {
      rootResolved = true
      window.clearTimeout(fallbackTimer)
      if (!snapshot.exists()) {
        loadFallback('Published snapshot')
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
      loadFallback('Published snapshot')
    }
  )

  state.unsubscribeWorkouts = onSnapshot(
    workoutsReference(),
    (snapshot) => {
      const workouts = snapshot.docs.map((entry) => ({
        ...entry.data(),
        workoutId: entry.id,
      }))
      state.workouts = workouts
      if (state.historyWorkouts) {
        const merged = new Map(
          [...state.historyWorkouts, ...workouts]
            .filter((workout) => workout.workoutId)
            .map((workout) => [workout.workoutId, workout])
        )
        state.historyWorkouts = Array.from(merged.values())
          .sort((left, right) => String(right.day).localeCompare(String(left.day)))
      }
      if (state.source === 'live') render()
    },
    (error) => {
      console.warn('Founder live workouts unavailable', error.code)
    }
  )
}

function rangeStats(range = state.range) {
  const key = RANGE_KEYS[range] || RANGE_KEYS.week
  if (key === 'allTime') {
    const publicRecord = publicHistorySummary()
    return {
      ...publicRecord,
      runningActivities: publicRecord.activities,
      elevationGainFeet: state.root?.training?.periods?.last365Days?.elevationGainFeet,
    }
  }
  return state.root?.training?.periods?.[key] ?? {}
}

function publicHistoryMonths(months = state.root?.training?.monthlyMileage ?? []) {
  return (months || []).filter((month) => (
    String(month.month || '') >= PUBLIC_HISTORY_START_MONTH
  ))
}

function publicHistorySummary(months = state.root?.training?.monthlyMileage ?? []) {
  const visible = publicHistoryMonths(months)
  return visible.reduce((summary, month) => ({
    runningMiles: summary.runningMiles + number(month.runningMiles),
    activities: summary.activities + number(month.activities),
    activeHours: summary.activeHours + number(month.activeHours),
    months: summary.months + 1,
  }), {
    runningMiles: 0,
    activities: 0,
    activeHours: 0,
    months: 0,
  })
}

function calendarYearSummary() {
  const day = latestDay() || state.root?.snapshotDay || isoDay(new Date())
  const year = day.slice(0, 4)
  const months = (state.root?.training?.monthlyMileage ?? [])
    .filter((month) => String(month.month || '').startsWith(`${year}-`))

  let runningMiles = months.reduce((sum, month) => sum + number(month.runningMiles), 0)
  let runningActivities = months.reduce((sum, month) => sum + number(month.activities), 0)

  if (months.length === 0) {
    const running = state.workouts.filter((workout) => (
      isRun(workout) && String(workout.day || '').startsWith(`${year}-`)
    ))
    runningMiles = running.reduce((sum, workout) => sum + number(workout.distanceMiles), 0)
    runningActivities = running.length
  }

  const start = new Date(`${year}-01-01T12:00:00Z`)
  const end = new Date(`${day}T12:00:00Z`)
  const elapsedDays = Math.max(1, Math.floor((end - start) / 86400000) + 1)

  return {
    year,
    throughDay: day,
    runningMiles,
    runningActivities,
    averageMilesPerWeek: runningMiles / (elapsedDays / 7),
  }
}

function previousCalendarWeek() {
  const anchorDay = latestDay() || state.root?.snapshotDay || isoDay(new Date())
  const anchor = new Date(`${anchorDay}T12:00:00Z`)
  const mondayOffset = (anchor.getUTCDay() + 6) % 7
  const currentWeekStart = shiftISODate(anchorDay, -mondayOffset)
  const startDay = shiftISODate(currentWeekStart, -7)
  const endDay = shiftISODate(currentWeekStart, -1)
  const workouts = state.workouts
    .filter((workout) => workout.day >= startDay && workout.day <= endDay)
    .sort((left, right) => right.day.localeCompare(left.day))

  return { startDay, endDay, workouts }
}

function rangeButtons() {
  return `
    <div class="ios-chip-row" role="group" aria-label="Fitness summary range">
      ${Object.entries(RANGE_LABELS).map(([key, label]) => `
        <button class="ios-chip ${state.range === key ? 'is-active' : ''}" type="button" data-live-range="${key}" aria-pressed="${state.range === key}">
          ${label}
        </button>
      `).join('')}
      <button class="ios-chip ios-chip--custom" type="button" disabled>
        <span aria-hidden="true">▦</span> Custom
      </button>
    </div>
  `
}

function chartPoints(values, width = 320, height = 82, padding = 5) {
  if (!values.length) return ''
  const maximum = Math.max(...values, 1)
  const minimum = Math.min(...values, 0)
  const span = Math.max(maximum - minimum, 1)
  return values.map((value, index) => {
    const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2)
    const y = height - padding - ((value - minimum) / span) * (height - padding * 2)
    return [x, y]
  })
}

function lineChart(values, label, tone = '#1676d2') {
  const points = chartPoints(values)
  if (!points.length) return `<div class="ios-empty">No ${escapeHTML(label)} history yet.</div>`
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = [
    `5,82`,
    ...points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`),
    `315,82`,
  ].join(' ')
  chartSequence += 1
  const gradientId = `fitness-area-${chartSequence}`
  return `
    <svg class="ios-mini-chart" viewBox="0 0 320 86" role="img" aria-label="${escapeHTML(label)}">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${tone}" stop-opacity=".28"></stop>
          <stop offset="1" stop-color="${tone}" stop-opacity=".015"></stop>
        </linearGradient>
      </defs>
      <line class="chart-grid" x1="5" x2="315" y1="24" y2="24"></line>
      <line class="chart-grid" x1="5" x2="315" y1="54" y2="54"></line>
      <polygon class="chart-area" points="${area}" style="fill:url(#${gradientId})"></polygon>
      <polyline class="chart-line" points="${line}" style="stroke:${tone}"></polyline>
    </svg>
  `
}

function historyBars(months, count = 18) {
  const visible = (months || []).slice(-count)
  if (!visible.length) return '<div class="ios-empty">Historical mileage will appear after the first projection.</div>'
  const maximum = Math.max(...visible.map((month) => number(month.runningMiles)), 1)
  return `
    <div class="ios-history-bars" role="img" aria-label="Monthly running mileage history">
      ${visible.map((month) => `
        <span title="${escapeHTML(month.month)} · ${number(month.runningMiles).toFixed(1)} miles" aria-label="${escapeHTML(month.month)}, ${number(month.runningMiles).toFixed(1)} running miles">
          <i style="height:${Math.max(3, (number(month.runningMiles) / maximum) * 100).toFixed(1)}%"></i>
        </span>
      `).join('')}
    </div>
    <div class="ios-history-axis">
      <span>${escapeHTML(visible[0]?.month ?? '')}</span>
      <span>${escapeHTML(visible.at(-1)?.month ?? '')}</span>
    </div>
  `
}

function fitnessTimelineBuckets() {
  const training = state.root?.training ?? {}
  const anchor = latestDay() || state.root?.snapshotDay || isoDay(new Date())
  if (state.range === 'year' || state.range === 'all') {
    const months = publicHistoryMonths(training.monthlyMileage)
    const visible = state.range === 'year' ? months.slice(-12) : months
    return {
      unit: 'Monthly distance',
      buckets: visible.map((month) => ({
        key: month.month,
        label: new Intl.DateTimeFormat('en-US', {
          month: 'short',
          timeZone: 'UTC',
        }).format(new Date(`${month.month}-01T12:00:00Z`)),
        value: number(month.runningMiles),
      })),
    }
  }

  const dayCount = state.range === 'quarter' ? 90 : state.range === 'month' ? 30 : 7
  const cutoff = shiftISODate(anchor, -(dayCount - 1))
  return {
    unit: 'Weekly distance',
    buckets: (training.weeklyMileage ?? [])
      .filter((week) => String(week.weekStart || '') >= cutoff)
      .map((week) => ({
        key: week.weekStart,
        label: dateLabel(week.weekStart, { short: true, year: false }),
        value: number(week.runningMiles),
      })),
  }
}

function fitnessTimeline() {
  const timeline = fitnessTimelineBuckets()
  if (!timeline.buckets.length) {
    return '<div class="ios-empty">Running distance will appear after the next public projection.</div>'
  }
  const maximum = Math.max(...timeline.buckets.map((bucket) => bucket.value), 1)
  const total = timeline.buckets.reduce((sum, bucket) => sum + bucket.value, 0)
  const average = total / timeline.buckets.length
  const peak = timeline.buckets.reduce((best, bucket) => (
    bucket.value > best.value ? bucket : best
  ), timeline.buckets[0])
  return `
    <div class="ios-fitness-timeline">
      <div class="ios-fitness-timeline__head">
        <span>${escapeHTML(timeline.unit)}</span>
        <small>Peak: ${number(peak.value).toFixed(1)} mi · ${escapeHTML(peak.label)}</small>
      </div>
      <div class="ios-fitness-timeline__bars" role="img" aria-label="${escapeHTML(timeline.unit)} for running">
        ${timeline.buckets.map((bucket) => `
          <span aria-label="${escapeHTML(bucket.label)}, ${number(bucket.value).toFixed(1)} miles" title="${escapeHTML(bucket.key)} · ${number(bucket.value).toFixed(1)} miles">
            <i style="height:${Math.max(4, (bucket.value / maximum) * 100).toFixed(1)}%"></i>
          </span>
        `).join('')}
      </div>
      <div class="ios-fitness-timeline__axis">
        <span>${escapeHTML(timeline.buckets[0].label)}</span>
        <span>${escapeHTML(RANGE_LABELS[state.range])}</span>
        <span>${escapeHTML(timeline.buckets.at(-1).label)}</span>
      </div>
      <div class="ios-fitness-highlights">
        <span><small>Peak</small><strong>${number(peak.value).toFixed(1)} mi</strong></span>
        <span><small>Average</small><strong>${number(average).toFixed(1)} mi</strong></span>
        <span><small>Total</small><strong>${number(total).toFixed(1)} mi</strong></span>
      </div>
    </div>
  `
}

function summaryCard() {
  const stats = rangeStats()
  const activityCount = number(stats.runningActivities, stats.activities)
  return `
    <div class="ios-card ios-fitness-summary" data-impressive-anchor aria-label="Running ${escapeHTML(RANGE_LABELS[state.range])} fitness summary">
      <div class="ios-fitness-summary__head">
        <strong>Fitness Summary</strong>
        <span>${integer(activityCount)} ${activityCount === 1 ? 'activity' : 'activities'}</span>
      </div>
      <div class="ios-overview-grid">
        <div class="ios-overview-stat ios-overview-stat--distance">
          <span aria-hidden="true">⌁</span>
          <div><strong>${number(stats.runningMiles).toFixed(1)} mi</strong><small>Distance</small></div>
        </div>
        <div class="ios-overview-stat ios-overview-stat--time">
          <span aria-hidden="true">◷</span>
          <div><strong>${formatDuration(number(stats.activeHours) * 3600)}</strong><small>Time</small></div>
        </div>
        <div class="ios-overview-stat ios-overview-stat--calories">
          <span aria-hidden="true">↗</span>
          <div><strong>${integer(activityCount)}</strong><small>${state.range === 'all' ? 'Activities' : 'Runs'}</small></div>
        </div>
        <div class="ios-overview-stat ios-overview-stat--elevation">
          <span aria-hidden="true">↗</span>
          <div><strong>${integer(stats.elevationGainFeet)} ft</strong><small>Elevation</small></div>
        </div>
      </div>
      <div class="ios-fitness-filter">
        <small>EXERCISE TYPE</small>
        <span><i aria-hidden="true">↗</i> Run</span>
      </div>
      <div class="ios-fitness-controls" aria-hidden="true">
        <span><i>⌁</i><small>DATA</small><strong>Distance</strong><em>⌃⌄</em></span>
        <span><i>▥</i><small>CHART</small><strong>Bars</strong><em>⌃⌄</em></span>
      </div>
      ${fitnessTimeline()}
      ${activityCount ? '' : '<div class="ios-fitness-summary__empty"><span aria-hidden="true">▥</span>No activities in this range.</div>'}
    </div>
  `
}

function nutritionCard() {
  const nutrition = nutritionSnapshot()
  const average = nutrition?.dailyAverage ?? {}
  if (!state.root?.nutritionPublished || !nutrition) {
    return `
      <button class="ios-card" type="button" data-live-action="nutrition">
        <div class="ios-card-head">
          <span><span class="ios-card-icon">◉</span><span class="ios-card-title">Nutrition Intelligence</span></span>
          <span class="ios-card-chevron" aria-hidden="true">›</span>
        </div>
        <p class="ios-card-copy">No public nutrition window is available.</p>
      </button>
    `
  }
  return `
    <button class="ios-card" type="button" data-live-action="nutrition">
      <div class="ios-card-head">
        <span><span class="ios-card-icon">◉</span><span class="ios-card-title">Nutrition Intelligence</span></span>
        <span class="ios-card-chevron" aria-hidden="true">›</span>
      </div>
      <p class="ios-card-copy">${integer(nutrition.recordedDays)} of ${integer(nutrition.possibleDays)} days with recorded food</p>
      <div class="ios-stat-grid">
        <div><small>Calories</small><strong>${integer(average.calories)}</strong></div>
        <div><small>Carbs</small><strong>${integer(average.carbohydrateGrams)}g</strong></div>
        <div><small>Protein</small><strong>${integer(average.proteinGrams)}g</strong></div>
      </div>
    </button>
  `
}

function historicalCard() {
  const months = publicHistoryMonths()
  const history = publicHistorySummary(months)
  return `
    <button class="ios-card" type="button" data-live-action="history">
      <div class="ios-card-head">
        <span>
          <span class="ios-card-icon ios-card-icon--run">↗</span>
          <span>
            <small class="ios-card-kicker">Historical record</small>
            <span class="ios-card-title">${number(history.runningMiles).toFixed(1)} running miles</span>
          </span>
        </span>
        <span class="ios-card-chevron" aria-hidden="true">›</span>
      </div>
      ${historyBars(months, months.length)}
      <p class="ios-card-copy" style="margin-top:9px">${integer(history.activities)} projected activities since ${PUBLIC_HISTORY_START_LABEL}</p>
    </button>
  `
}

function workoutRows(workouts, maximum = 5) {
  const visible = workouts.slice(0, maximum)
  if (!visible.length) return '<div class="ios-empty">No public workout summaries yet.</div>'
  return visible.map((workout) => `
    <button class="ios-workout-row" type="button" data-live-workout="${escapeHTML(workout.workoutId)}">
      <span class="ios-workout-row__icon" aria-hidden="true">${isRun(workout) ? '↗' : '•'}</span>
      <span class="ios-workout-row__body">
        <strong>${escapeHTML(sportLabel(workout.sport))}</strong>
        <span>${escapeHTML(dateLabel(workout.day, { short: true }))} · ${formatDuration(workout.movingTimeSeconds || workout.durationSeconds)}</span>
        <span class="ios-route-badge ${workout.routePublished ? '' : 'ios-route-badge--private'}">${workout.routePublished ? '⌖ Published route' : '⌖ Route private'}</span>
      </span>
      <span class="ios-workout-row__metric">
        <strong>${number(workout.distanceMiles).toFixed(2)} mi</strong>
        <small>${formatPace(workout.averagePaceSecondsPerMile)} /mi</small>
      </span>
    </button>
  `).join('')
}

function activityWorkoutCards(workouts, maximum = 10) {
  const visible = workouts.slice(0, maximum)
  if (!visible.length) return '<div class="ios-empty">No public workout summaries yet.</div>'
  return visible.map((workout) => {
    const run = isRun(workout)
    const sportColor = run
      ? '#fc5200'
      : workout.sport === 'swimming'
        ? '#0a84ff'
        : workout.sport === 'cycling'
          ? '#30b0c7'
          : '#5856d6'
    const pace = run && number(workout.averagePaceSecondsPerMile) > 0
      ? `${formatPace(workout.averagePaceSecondsPerMile)} /mi`
      : number(workout.distanceMiles) > 0
        ? `${number(workout.distanceMiles).toFixed(2)} mi`
        : 'Recorded'
    const thirdMetric = number(workout.averageHeartRateBpm) > 0
      ? `<span><i style="color:#ff453a">♥</i><strong>${integer(workout.averageHeartRateBpm)} bpm</strong></span>`
      : number(workout.calories) > 0
        ? `<span><i style="color:#ff9f0a">◆</i><strong>${integer(workout.calories)} kcal</strong></span>`
        : `<span><i style="color:${sportColor}">↗</i><strong>${integer(workout.elevationGainFeet)} ft</strong></span>`
    return `
      <button class="ios-activity-workout" style="--sport-color:${sportColor}" type="button" data-live-workout="${escapeHTML(workout.workoutId)}">
        <span class="ios-activity-workout__head">
          <span class="ios-activity-workout__icon" aria-hidden="true">${run ? '↗' : workout.sport === 'swimming' ? '≈' : workout.sport === 'cycling' ? '◇' : '•'}</span>
          <span class="ios-activity-workout__identity">
            <strong>${escapeHTML(sportLabel(workout.sport))}</strong>
            <small>${escapeHTML(dateLabel(workout.day, { short: true }))}${workout.routePublished ? ' · ⌖ GPS' : ''}</small>
          </span>
          <strong class="ios-activity-workout__distance">${number(workout.distanceMiles).toFixed(2)} mi</strong>
        </span>
        <span class="ios-activity-workout__metrics">
          <span><i style="color:${sportColor}">⌁</i><strong>${pace}</strong></span>
          <span><i style="color:#1676d2">◷</i><strong>${formatClock(workout.movingTimeSeconds || workout.durationSeconds)}</strong></span>
          ${thirdMetric}
        </span>
      </button>
    `
  }).join('')
}

function startWorkoutCard() {
  return `
    <button class="ios-start-workout" type="button" data-live-action="start-workout">
      <span class="ios-start-workout__icon" aria-hidden="true">▶</span>
      <span>
        <strong>Start where you are</strong>
        <small>Any movement is worth recording — choose GPS, timer, or quick entry.</small>
      </span>
      <span class="ios-card-chevron" aria-hidden="true">›</span>
    </button>
  `
}

function activitySelector() {
  return `
    <div class="ios-segmented ios-segmented--activity" style="--segments:2" role="group" aria-label="Activity dashboard">
      <button class="${state.activityView === 'today' ? 'is-active' : ''}" type="button" data-live-activity-view="today" aria-pressed="${state.activityView === 'today'}">Today</button>
      <button class="${state.activityView === 'fitness' ? 'is-active' : ''}" type="button" data-live-activity-view="fitness" aria-pressed="${state.activityView === 'fitness'}">Fitness</button>
    </div>
  `
}

function fitnessPlannerCard() {
  return `
    <div class="ios-native-entry ios-planner-card">
      <span class="ios-native-entry__icon ios-native-entry__icon--planner" aria-hidden="true">▦</span>
      <span class="ios-native-entry__copy">
        <span><strong>Fitness Planner</strong><em>PRO</em></span>
        <small>Dated workouts, actual activity, block reviews, and plan notes</small>
      </span>
      <span class="ios-card-chevron" aria-hidden="true">›</span>
    </div>
  `
}

function fitnessDashboard() {
  return `
    ${rangeButtons()}
    ${summaryCard()}
    <div class="ios-section-label">
      <span>Recent Workouts</span>
      <button type="button" data-live-action="history">See All</button>
    </div>
    <div class="ios-activity-stack">${activityWorkoutCards(state.workouts, 8)}</div>
  `
}

function todayDashboard() {
  const day = latestDay()
  const dayWorkouts = state.workouts.filter((workout) => workout.day === day)
  const totalTime = dayWorkouts.reduce(
    (sum, workout) => sum + number(workout.movingTimeSeconds || workout.durationSeconds),
    0
  )
  const totalDistance = dayWorkouts.reduce(
    (sum, workout) => sum + number(workout.distanceMiles),
    0
  )
  return `
    <div class="ios-card ios-card--orange">
      <div class="ios-card-head">
        <span><span class="ios-card-icon ios-card-icon--run">✓</span><span class="ios-card-title">Daily Activity</span></span>
        <span class="ios-card-kicker">${escapeHTML(dateLabel(day, { short: true, year: false }))}</span>
      </div>
      <div class="ios-summary-grid">
        <div class="ios-summary-tile"><small>Workouts</small><strong>${integer(dayWorkouts.length)}</strong></div>
        <div class="ios-summary-tile"><small>Distance</small><strong>${number(totalDistance).toFixed(1)} mi</strong></div>
        <div class="ios-summary-tile"><small>Active time</small><strong>${formatDuration(totalTime)}</strong></div>
        <div class="ios-summary-tile"><small>Recorded</small><strong>${dayWorkouts.length ? 'Complete' : '—'}</strong></div>
      </div>
    </div>
    <div class="ios-section-label"><span>Workouts</span></div>
    <div class="ios-activity-stack">${activityWorkoutCards(dayWorkouts, 10)}</div>
  `
}

function activityHome() {
  return `
    <h3 class="ios-large-title">Activity</h3>
    ${activitySelector()}
    ${state.activityView === 'fitness' ? fitnessDashboard() : todayDashboard()}
  `
}

function nutritionRecordRing(label, value, unit, tone) {
  return `
    <div class="ios-record-ring" style="--record-tone:${tone}">
      <span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(unit)}</small></span>
      <b>${escapeHTML(label)}</b>
    </div>
  `
}

function nutritionRecordBars(items) {
  const preferred = ['dietary_fiber', 'vitamin_c', 'calcium', 'iron', 'potassium']
  const visible = preferred
    .map((key) => items?.find((item) => item.key === key))
    .filter(Boolean)
  if (!visible.length) return '<div class="ios-empty">Micronutrient coverage is still being built.</div>'
  return visible.map((item) => {
    const color = NUTRIENT_COLORS[item.status] || NUTRIENT_COLORS.limited
    return `
      <div class="ios-record-nutrient" style="--record-tone:${color}">
        <span><strong>${escapeHTML(item.label === 'Fiber' ? 'Dietary Fiber' : item.label)}</strong><small>${integer(item.percent)}%</small></span>
        <i><b style="width:${Math.max(0, Math.min(100, number(item.percent)))}%"></b></i>
        <em>${number(item.average).toLocaleString()} ${escapeHTML(item.unit)} daily average</em>
      </div>
    `
  }).join('')
}

function recordHome() {
  const nutrition = nutritionSnapshot(30, false) ?? nutritionSnapshot()
  const average = nutrition?.dailyAverage ?? {}
  const recordedDays = number(nutrition?.recordedDays)
  const possibleDays = number(nutrition?.possibleDays, 30)
  const active = state.root?.training?.periods?.last30Days ?? {}
  return `
    <div class="ios-founder-record">
      <div class="ios-founder-record__identity">
        <span class="ios-founder-record__avatar" aria-hidden="true">RS</span>
        <div>
          <h3>Ryan Sullivan <i aria-label="Verified founder">✓</i></h3>
          <p>Founder · builds and trains with StatsKey</p>
        </div>
      </div>
      <div class="ios-founder-record__tabs" role="group" aria-label="Founder record views">
        <button class="is-active" type="button" aria-pressed="true">Day View</button>
        <button type="button" data-live-jump="running">Records</button>
        <button type="button" data-live-nutrition-surface="insights">Progress</button>
      </div>
      <div class="ios-founder-record__window">
        <span aria-hidden="true">‹</span>
        <div>
          <strong>Nutrition Record</strong>
          <small>${escapeHTML(dateLabel(nutrition?.startDay, { short: true, year: false }))} – ${escapeHTML(dateLabel(nutrition?.endDay, { short: true, year: false }))}</small>
        </div>
        <span aria-hidden="true">›</span>
      </div>
      <div class="ios-card ios-founder-shared-day">
        <div class="ios-founder-shared-day__head">
          <strong>Shared Record</strong>
          <span>${integer(recordedDays)} of ${integer(possibleDays)} complete days</span>
        </div>
        <div class="ios-founder-shared-day__stats">
          <span><i style="--record-tone:#e98273">◆</i><small>Consumed</small><strong>${integer(average.calories)} cal</strong></span>
          <span><i style="--record-tone:#08a99d">▦</i><small>Recorded</small><strong>${integer(recordedDays)} days</strong></span>
          <span><i style="--record-tone:#ff673d">↗</i><small>Running</small><strong>${number(active.runningMiles).toFixed(1)} mi</strong></span>
          <span><i style="--record-tone:#319df0">◷</i><small>Training</small><strong>${formatDuration(number(active.activeHours) * 3600)}</strong></span>
        </div>
      </div>
      <div class="ios-card ios-founder-nutrition-card">
        <div class="ios-founder-nutrition-card__head">
          <strong>Nutrition</strong>
          <span>${integer(recordedDays)} recorded days</span>
        </div>
        <div class="ios-record-rings">
          ${nutritionRecordRing('Cal', integer(average.calories), '', '#e98273')}
          ${nutritionRecordRing('Protein', integer(average.proteinGrams), 'g', '#78acd0')}
          ${nutritionRecordRing('Carbs', integer(average.carbohydrateGrams), 'g', '#66bb7b')}
          ${nutritionRecordRing('Fat', integer(average.fatGrams), 'g', '#a57ad8')}
        </div>
      </div>
      <div class="ios-native-section-head ios-founder-record__nutrient-head">
        <strong>Micronutrient Record</strong>
        <small>30-day average</small>
      </div>
      <div class="ios-card ios-record-nutrients">
        ${nutritionRecordBars(nutrition?.micronutrients)}
      </div>
      <p class="ios-founder-record__footnote">The record and Insights reuse one public aggregate snapshot. No food-item detail or additional database request is made here.</p>
    </div>
  `
}

function longitudinalWeeklyChart(weeks) {
  const values = weeks.map((week) => number(week.runningMiles))
  const points = chartPoints(values, 920, 220, 18)
  if (!points.length) {
    return '<div class="founder-longitudinal__empty">Longitudinal mileage appears after the first projected week.</div>'
  }
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = [
    '18,220',
    ...points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`),
    '902,220',
  ].join(' ')
  const markerStride = Math.max(1, Math.floor(points.length / 8))
  chartSequence += 1
  const gradientId = `longitudinal-area-${chartSequence}`
  return `
    <svg class="founder-longitudinal-chart" viewBox="0 0 920 226" role="img" aria-label="Weekly running mileage across the latest year">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#30d5c8" stop-opacity=".5"></stop>
          <stop offset="1" stop-color="#30d5c8" stop-opacity=".025"></stop>
        </linearGradient>
      </defs>
      <line x1="18" x2="902" y1="58" y2="58"></line>
      <line x1="18" x2="902" y1="113" y2="113"></line>
      <line x1="18" x2="902" y1="168" y2="168"></line>
      <polygon points="${area}" style="fill:url(#${gradientId})"></polygon>
      <polyline points="${line}"></polyline>
      ${points.map(([x, y], index) => (
        index % markerStride === 0 || index === points.length - 1
          ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${index === points.length - 1 ? 5 : 3}"></circle>`
          : ''
      )).join('')}
    </svg>
    <div class="founder-longitudinal-chart__axis">
      <span>${escapeHTML(dateLabel(weeks[0]?.weekStart, { short: true, year: false }))}</span>
      <span>${integer(weeks.length)} weekly totals</span>
      <span>${escapeHTML(dateLabel(weeks.at(-1)?.weekStart, { short: true, year: false }))}</span>
    </div>
  `
}

function longitudinalMonthBars(months) {
  const visible = publicHistoryMonths(months)
  if (!visible.length) {
    return '<div class="founder-longitudinal__empty">Monthly history is still being assembled.</div>'
  }
  const maximum = Math.max(...visible.map((month) => number(month.runningMiles)), 1)
  return `
    <div class="founder-longitudinal-months" role="img" aria-label="Monthly running mileage across the complete projected record">
      ${visible.map((month) => `
        <span title="${escapeHTML(month.month)} · ${number(month.runningMiles).toFixed(1)} miles">
          <i style="height:${Math.max(2, (number(month.runningMiles) / maximum) * 100).toFixed(1)}%"></i>
        </span>
      `).join('')}
    </div>
    <div class="founder-longitudinal-chart__axis">
      <span>${escapeHTML(visible[0]?.month ?? '')}</span>
      <span>${integer(visible.length)} months</span>
      <span>${escapeHTML(visible.at(-1)?.month ?? '')}</span>
    </div>
  `
}

function longitudinalActivityRows(workouts) {
  if (!workouts.length) {
    return '<div class="founder-longitudinal__empty">Recent activity will appear with the next public projection.</div>'
  }
  return workouts.map((workout) => {
    const run = isRun(workout)
    const primary = number(workout.distanceMiles) > 0
      ? `${number(workout.distanceMiles).toFixed(2)} mi`
      : formatDuration(workout.movingTimeSeconds || workout.durationSeconds)
    const secondary = run && number(workout.averagePaceSecondsPerMile) > 0
      ? `${formatPace(workout.averagePaceSecondsPerMile)} /mi`
      : number(workout.averageHeartRateBpm) > 0
        ? `${integer(workout.averageHeartRateBpm)} bpm`
        : formatDuration(workout.movingTimeSeconds || workout.durationSeconds)
    return `
      <button class="founder-longitudinal-activity" type="button" data-live-workout="${escapeHTML(workout.workoutId)}">
        <span class="founder-longitudinal-activity__icon" aria-hidden="true">${run ? '↗' : workout.sport === 'swimming' ? '≈' : workout.sport === 'cycling' ? '◇' : '•'}</span>
        <span class="founder-longitudinal-activity__identity">
          <strong>${escapeHTML(sportLabel(workout.sport))}</strong>
          <small>${escapeHTML(dateLabel(workout.day, { short: true }))} · ${formatDuration(workout.movingTimeSeconds || workout.durationSeconds)}</small>
        </span>
        <span class="founder-longitudinal-activity__metric">
          <strong>${primary}</strong>
          <small>${secondary}</small>
        </span>
        <span class="founder-longitudinal-activity__privacy">${workout.routePublished ? 'Published route' : 'Route private'}</span>
        <span class="founder-longitudinal-activity__chevron" aria-hidden="true">›</span>
      </button>
    `
  }).join('')
}

function renderLongitudinalRecord() {
  if (!state.root || !elements.longitudinal) return
  const training = state.root.training ?? {}
  const month = training.periods?.last30Days ?? {}
  const weeks = (training.weeklyMileage || [])
    .filter((week) => String(week.weekStart || '') >= PUBLIC_HISTORY_START_DAY)
    .slice(-52)
  const months = publicHistoryMonths(training.monthlyMileage)
  const history = publicHistorySummary(months)
  const year = calendarYearSummary()
  const trailingYearMiles = weeks.reduce((sum, week) => sum + number(week.runningMiles), 0)
  const recentWorkouts = state.workouts
    .filter((workout) => String(workout.day || '') >= PUBLIC_HISTORY_START_DAY)
    .slice(0, 48)

  elements.longitudinal.innerHTML = `
    <header class="founder-longitudinal__head">
      <div>
        <span>Longitudinal founder record</span>
        <h4 id="founder-longitudinal-title">The trajectory, not a single day.</h4>
        <p>A live year-scale view of volume, continuity, and every recent projected activity. Select an activity to inspect its metrics in the phone above.</p>
      </div>
      <strong><i aria-hidden="true"></i> Live record</strong>
    </header>
    <div class="founder-longitudinal__metrics">
      <span><small>Since Sep 2025</small><strong>${number(trailingYearMiles).toFixed(1)}</strong><em>running miles</em></span>
      <span><small>${escapeHTML(year.year)} average</small><strong>${number(year.averageMilesPerWeek).toFixed(1)}</strong><em>miles / week</em></span>
      <span><small>Last 30 days</small><strong>${number(month.runningMiles).toFixed(1)}</strong><em>${integer(month.runningActivities)} runs</em></span>
      <span><small>Calendar year</small><strong>${number(year.runningMiles).toFixed(1)}</strong><em>running miles</em></span>
      <span><small>Projected record</small><strong>${number(history.runningMiles).toFixed(1)}</strong><em>${integer(history.activities)} activities</em></span>
    </div>
    <div class="founder-longitudinal__charts">
      <article class="founder-longitudinal__chart-card founder-longitudinal__chart-card--primary">
        <div class="founder-longitudinal__chart-head">
          <div><small>Weekly running volume</small><strong>Since September 2025</strong></div>
          <span>${number(trailingYearMiles / Math.max(weeks.length, 1)).toFixed(1)} mi / week</span>
        </div>
        ${longitudinalWeeklyChart(weeks)}
      </article>
      <article class="founder-longitudinal__chart-card">
        <div class="founder-longitudinal__chart-head">
          <div><small>Monthly running volume</small><strong>Since September 2025</strong></div>
          <span>${integer(months.length)} months</span>
        </div>
        ${longitudinalMonthBars(months)}
      </article>
    </div>
    <div class="founder-longitudinal__activity">
      <div class="founder-longitudinal__activity-head">
        <div><small>Recent activity</small><strong>Every current public workout summary</strong></div>
        <span>${integer(recentWorkouts.length)} activities · newest first</span>
      </div>
      <div class="founder-longitudinal__activity-list">
        ${longitudinalActivityRows(recentWorkouts)}
      </div>
    </div>
  `
}

function intelligenceHome() {
  const training = state.root?.training ?? {}
  const weeks = (training.weeklyMileage || []).slice(-24)
  const mechanics = state.workouts.filter((workout) => (
    isRun(workout) &&
    (number(workout.averageCadenceSpm) > 0 ||
      number(workout.averageStrideLengthMeters) > 0)
  ))
  const latest = mechanics[0]
  return `
    <div class="ios-screen-heading">
      <div><small>Running</small><h3>Intelligence</h3></div>
      <time>${escapeHTML(RANGE_LABELS[state.range])}</time>
    </div>
    ${rangeButtons()}
    ${summaryCard()}
    <div class="ios-card">
      <div class="ios-card-head">
        <span><span class="ios-card-icon ios-card-icon--run">⌁</span><span class="ios-card-title">Running Dynamics Intelligence</span></span>
      </div>
      <p class="ios-card-copy">${integer(mechanics.length)} recent public runs with stored dynamics · descriptive trends, not a universal running-form score.</p>
      <div class="ios-summary-grid" style="margin-top:10px">
        <div class="ios-summary-tile"><small>Cadence</small><strong>${number(latest?.averageCadenceSpm) > 0 ? `${integer(latest.averageCadenceSpm)} spm` : '—'}</strong></div>
        <div class="ios-summary-tile"><small>Step length</small><strong>${number(latest?.averageStrideLengthMeters) > 0 ? `${number(latest.averageStrideLengthMeters).toFixed(2)} m` : '—'}</strong></div>
      </div>
      ${lineChart(weeks.map((week) => number(week.runningMiles)), 'Twenty-four-week running mileage')}
    </div>
    ${historicalCard()}
  `
}

function nutritionRows(items) {
  if (!items?.length) return '<div class="ios-empty">No micronutrient window is available.</div>'
  const preferred = ['vitamin_c', 'dietary_fiber', 'vitamin_d', 'calcium', 'iron', 'potassium']
  const ordered = [
    ...preferred.map((key) => items.find((item) => item.key === key)).filter(Boolean),
    ...items.filter((item) => !preferred.includes(item.key)),
  ]
  return ordered.map((item) => {
    const color = NUTRIENT_COLORS[item.status] || NUTRIENT_COLORS.limited
    const status = item.status === 'strong'
      ? 'Optimal'
      : item.status === 'within'
        ? 'Within limit'
        : item.status === 'near'
          ? 'Near target'
          : item.status === 'watch' && item.direction === 'limit'
            ? 'Over limit'
            : item.status === 'watch'
              ? 'Below target'
              : 'Coverage incomplete'
    return `
      <button class="ios-micronutrient-card" style="--nutrient-color:${color}" type="button" data-live-nutrient="${escapeHTML(item.key)}">
        <span class="ios-micronutrient-card__title">
          <i aria-hidden="true"></i>
          <strong>${escapeHTML(item.label === 'Fiber' ? 'Dietary Fiber' : item.label)}</strong>
        </span>
        <span class="ios-micronutrient-card__value">${number(item.average).toLocaleString()} ${escapeHTML(item.unit)}</span>
        <span class="ios-micronutrient-card__status">
          <b>${integer(item.percent)}% of target</b>
          <small>— ${status}</small>
        </span>
      </button>
    `
  }).join('')
}

function nutritionRangeControls() {
  const nutrition = state.root?.nutrition
  const mode = state.includeToday ? 'includingToday' : 'complete'
  const available = nutrition?.ranges?.[mode]
  const todayAvailable = Boolean(nutrition?.ranges?.includingToday)
  return `
    <div class="ios-nutrition-controls">
      <div class="ios-nutrition-ranges" role="group" aria-label="Nutrition date range">
        ${NUTRITION_RANGE_DAYS.map((days) => {
          const enabled = Boolean(available?.[String(days)]) || (days === 7 && !nutrition?.ranges)
          return `
            <button class="${state.nutritionRangeDays === days ? 'is-active' : ''}" type="button" data-live-nutrition-range="${days}" aria-pressed="${state.nutritionRangeDays === days}" ${enabled ? '' : 'disabled'}>
              ${days} Days
            </button>
          `
        }).join('')}
      </div>
      <button class="ios-today-toggle ${state.includeToday ? 'is-on' : ''}" type="button" data-live-action="toggle-today" role="switch" aria-checked="${state.includeToday}" ${todayAvailable ? '' : 'disabled'}>
        <span class="ios-today-toggle__calendar" aria-hidden="true">▦</span>
        <span><strong>Include Today</strong><small>${state.includeToday ? `Past ${state.nutritionRangeDays - 1} days + today` : `Past ${state.nutritionRangeDays} complete days`}</small></span>
        <i aria-hidden="true"></i>
      </button>
    </div>
  `
}

function macroInsightCard(label, value, unit, tone, icon, coverage) {
  return `
    <div class="ios-macro-insight" style="--macro-tone:${tone}">
      <span class="ios-macro-insight__icon" aria-hidden="true">${icon}</span>
      <small>${escapeHTML(label)}</small>
      <span class="ios-macro-insight__value"><strong>${escapeHTML(value)}</strong><em>${escapeHTML(unit)}</em></span>
      <span class="ios-macro-insight__caption">recorded daily average</span>
      <i class="ios-macro-insight__track"><b style="width:${coverage}%"></b></i>
    </div>
  `
}

function nutritionHome() {
  const nutrition = nutritionSnapshot()
  const average = nutrition?.dailyAverage ?? {}
  const possibleDays = Math.max(1, number(nutrition?.possibleDays, state.nutritionRangeDays))
  const recordedDays = number(nutrition?.recordedDays)
  const coverage = Math.max(0, Math.min(100, (recordedDays / possibleDays) * 100)).toFixed(1)
  const fiber = nutrition?.micronutrients?.find((item) => item.key === 'dietary_fiber')
  const activeHours = number(state.root?.training?.periods?.last7Days?.activeHours)
  const signal = recordedDays >= possibleDays
    ? 'Strong record'
    : recordedDays > 0
      ? 'Developing'
      : 'Needs data'
  const recordedNutrients = nutrition?.micronutrients?.filter((item) => number(item.average) > 0).length ?? 0
  return `
    <h3 class="ios-large-title">Insights</h3>
    <div class="ios-insights-hero">
      <div>
        <h3>Nutrition Intelligence</h3>
        <p>Personal, evidence-aware analysis of recorded patterns</p>
      </div>
    </div>
    ${nutritionRangeControls()}
    <div class="ios-context-strip">
      <p><span aria-hidden="true">▧</span><strong>Signal</strong><b>${signal}</b><small>· Nutrition baseline</small></p>
      <p><span aria-hidden="true">▥</span><strong>Context</strong><small>${integer(activeHours * 60)} min training and ${integer(recordedDays)} recorded nutrition days</small></p>
    </div>
    <div class="ios-native-section-head"><strong>Daily Average Macronutrients</strong><small>${integer(recordedDays)} complete days</small></div>
    <div class="ios-macro-insights">
      ${macroInsightCard('Energy', integer(average.calories), 'kcal', '#ec8d7c', '◆', coverage)}
      ${macroInsightCard('Protein', integer(average.proteinGrams), 'g', '#82b9d7', '♟', coverage)}
      ${macroInsightCard('Carbs', integer(average.carbohydrateGrams), 'g', '#77c893', '⌁', coverage)}
      ${macroInsightCard('Fat', integer(average.fatGrams), 'g', '#ae8ce7', '●', coverage)}
    </div>
    <div class="ios-card ios-average-water">
      <div class="ios-average-water__head">
        <span><i aria-hidden="true">●</i>Average Water</span>
        <small>Not shared</small>
      </div>
      <div><strong>—</strong><span>fl oz</span></div>
      <p>Hydration entries stay private.</p>
      <i class="ios-average-water__track"></i>
    </div>
    ${fiber ? `
      <div class="ios-fiber-progress">
        <span>Fiber</span>
        <strong>${number(fiber.average).toFixed(1)}${escapeHTML(fiber.unit)} / ${number(fiber.reference).toFixed(0)}${escapeHTML(fiber.unit)}</strong>
        <i><b style="width:${Math.max(0, Math.min(100, number(fiber.percent)))}%"></b></i>
      </div>
    ` : ''}
    <div class="ios-glucose-card">
      <div class="ios-glucose-card__head">
        <span aria-hidden="true">⌁</span>
        <div><strong>Historical Glucose Intelligence</strong><small>Personal sensor patterns · source-aware</small></div>
        <em>NOT PUBLIC</em>
      </div>
      <div class="ios-glucose-card__empty">
        <span aria-hidden="true">〽</span>
        <strong>No public glucose in this range</strong>
        <p>Glucose records are not part of this public projection.</p>
      </div>
    </div>
    <div class="ios-micronutrient-heading">
      <strong>MICRONUTRIENT STATUS</strong>
      <p>Targets are individualized in StatsKey. Each average includes the available nutrient evidence in this public window.</p>
    </div>
    <div class="ios-micronutrient-grid">${nutritionRows(nutrition?.micronutrients)}</div>
    <div class="ios-micronutrient-note">
      <span>Vendors often omit vitamins and minerals, so some may read low.</span>
      <strong>Estimate missing</strong>
    </div>
    <button class="ios-all-nutrients" type="button" disabled>
      <strong>All Recorded Nutrients <span>⇅ Default</span></strong>
      <small>${integer(recordedNutrients)} nutrients</small>
    </button>
    <div class="ios-actionable-label">ACTIONABLE INSIGHTS</div>
    <div class="ios-card ios-local-insights">
      <span aria-hidden="true">✓</span>
      <strong>Local Insights</strong>
      <p>Rule-based checks from the nutrition record appear here.</p>
    </div>
    <p class="ios-card-copy" style="padding:0 5px 8px">${escapeHTML(nutrition?.disclaimer || 'Recorded intake estimate; not a diagnosis or a predictor of athletic potential.')}</p>
  `
}

function nutrientDetailHome() {
  const nutrition = nutritionSnapshot()
  const nutrient = nutrition?.micronutrients?.find((item) => item.key === state.selectedNutrient)
  if (!nutrient) return nutritionHome()
  const color = NUTRIENT_COLORS[nutrient.status] || NUTRIENT_COLORS.limited
  const percent = Math.max(0, number(nutrient.percent))
  const direction = nutrient.direction === 'limit' ? 'daily limit' : 'daily reference'
  return `
    <div class="ios-nutrient-detail">
      <div class="ios-nutrient-detail__hero" style="--nutrient-color:${color}">
        <span aria-hidden="true">●</span>
        <small>Daily average · ${integer(nutrition.possibleDays)} days</small>
        <h3>${escapeHTML(nutrient.label)}</h3>
        <strong>${number(nutrient.average).toLocaleString()} <em>${escapeHTML(nutrient.unit)}</em></strong>
        <p>${integer(percent)}% of the ${escapeHTML(direction)}</p>
      </div>
      <div class="ios-card">
        <div class="ios-nutrient-meter" style="--micro-width:${Math.min(percent, 100)}%;--micro-color:${color}">
          <span><i></i></span>
          <div><small>Reference</small><strong>${number(nutrient.reference).toLocaleString()} ${escapeHTML(nutrient.unit)}</strong></div>
        </div>
        <p class="ios-card-copy">${escapeHTML(nutrient.summary)}</p>
      </div>
      <div class="ios-card">
        <div class="ios-card-head"><span><span class="ios-card-icon">◔</span><span class="ios-card-title">Source confidence</span></span></div>
        <p class="ios-card-copy">This aggregate has nutrient values on ${integer(nutrient.coverageDays)} of ${integer(nutrition.recordedDays)} recorded days. Individual foods and meals stay private.</p>
      </div>
      <div class="ios-insights-guidance">
        <strong>Interpretation</strong>
        <p>This is a descriptive intake estimate from recorded food, not a diagnosis. Missing label values are not counted as zero-quality food.</p>
      </div>
    </div>
  `
}

function friendsHome() {
  const allTime = state.root?.training?.allTime ?? {}
  return `
    <div class="ios-screen-heading">
      <div><small>Public founder record</small><h3>Ryan</h3></div>
      <time>Live</time>
    </div>
    <div class="ios-card ios-card--tinted">
      <div class="ios-card-head">
        <span><span class="ios-card-icon">R</span><span class="ios-card-title">Ryan Sullivan</span></span>
      </div>
      <p class="ios-card-copy">Building StatsKey while training toward the far edge of personal possibility. This website view mirrors only the data deliberately projected for the public.</p>
      <div class="ios-stat-grid">
        <div><small>Runs</small><strong>${integer(allTime.runningActivities)}</strong></div>
        <div><small>Miles</small><strong>${number(allTime.runningMiles).toFixed(1)}</strong></div>
        <div><small>Since</small><strong>${escapeHTML((allTime.firstDay || '—').slice(0, 4))}</strong></div>
      </div>
    </div>
    ${historicalCard()}
  `
}

function historyHome() {
  const training = state.root?.training ?? {}
  const months = publicHistoryMonths(training.monthlyMileage)
  const summary = publicHistorySummary(months)
  const history = (state.historyWorkouts ?? state.workouts)
    .filter((workout) => String(workout.day || '') >= PUBLIC_HISTORY_START_DAY)
  const listStatus = state.historyLoading
    ? '<div class="ios-empty">Loading recent day-level activity…</div>'
    : state.historyError
      ? `<div class="ios-empty">${escapeHTML(state.historyError)}</div>`
      : `<div class="ios-empty">${integer(history.length)} recent projected activities</div>`
  return `
    <div class="ios-screen-heading">
      <div><small>Longitudinal record</small><h3>Fitness Record</h3></div>
      <time>Sep 2025—now</time>
    </div>
    <div class="ios-card ios-card--tinted">
      <div class="ios-pulse-value"><strong>${number(summary.runningMiles).toFixed(1)}</strong><span>running miles</span></div>
      <div class="ios-stat-grid">
        <div><small>Activities</small><strong>${integer(summary.activities)}</strong></div>
        <div><small>Hours</small><strong>${number(summary.activeHours).toFixed(0)}</strong></div>
        <div><small>Months</small><strong>${integer(summary.months)}</strong></div>
      </div>
    </div>
    <div class="ios-card">
      <div class="ios-card-head">
        <span><span class="ios-card-icon ios-card-icon--run">↗</span><span class="ios-card-title">Monthly Running Mileage</span></span>
      </div>
      ${historyBars(months, months.length)}
      <p class="ios-card-copy" style="margin-top:9px">The public record begins in September 2025. Detailed activity stays limited to recent projected workouts until it is requested.</p>
    </div>
    <div class="ios-section-label"><span>Recent Activity</span></div>
    ${listStatus}
    <div class="ios-activity-stack">${activityWorkoutCards(history, history.length)}</div>
  `
}

function routePath(segments) {
  const points = (segments || []).flatMap((segment) => (
    Array.isArray(segment?.points) ? segment.points : []
  ))
  if (points.length < 2) return ''
  const latitudes = points.map((point) => number(point.latitude))
  const longitudes = points.map((point) => number(point.longitude))
  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLon = Math.min(...longitudes)
  const maxLon = Math.max(...longitudes)
  const latSpan = Math.max(maxLat - minLat, 0.000001)
  const lonSpan = Math.max(maxLon - minLon, 0.000001)
  return (segments || []).map((segment) => {
    const segmentPoints = Array.isArray(segment?.points) ? segment.points : []
    if (segmentPoints.length < 2) return ''
    return segmentPoints.map((point, index) => {
      const longitudeRatio = Math.min(1, Math.max(0, (number(point.longitude) - minLon) / lonSpan))
      const latitudeRatio = Math.min(1, Math.max(0, (number(point.latitude) - minLat) / latSpan))
      const x = 8 + longitudeRatio * 84
      const y = 92 - latitudeRatio * 84
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    }).join(' ')
  }).filter(Boolean).join(' ')
}

function privateRouteCard(workout) {
  if (workout.routePublished && state.routeLoading) {
    return `
      <div class="ios-private-route">
        <div><span aria-hidden="true">⌖</span><strong>Loading published route</strong><p>The map request is separate from every private workout field.</p></div>
      </div>
    `
  }
  const explanation = workout.routePublished
    ? 'The publication is unavailable right now. No private-route fallback is attempted.'
    : 'This page never requests coordinates unless this workout is explicitly published in StatsKey.'
  return `
    <div class="ios-private-route">
      <div><span aria-hidden="true">♙</span><strong>Route private</strong><p>${explanation}</p></div>
    </div>
  `
}

function workoutDetail() {
  const workout = state.selectedWorkout
  if (!workout) return activityHome()
  const splits = workout.splits || []
  const paces = splits.map((split) => number(split.paceSecondsPerMile)).filter((pace) => pace > 0)
  const fastest = paces.length ? Math.min(...paces) : 0
  const slowest = paces.length ? Math.max(...paces) : 0
  const path = routePath(state.route?.segments)
  const route = workout.routePublished && path
    ? `
      <div class="ios-route-map">
        <span class="ios-route-map__label">⌖ Published route · privacy applied</span>
        <svg viewBox="0 0 100 100" role="img" aria-label="Sanitized route map for this published run">
          <path d="${path}"></path>
        </svg>
      </div>
    `
    : privateRouteCard(workout)

  return `
    <div class="ios-detail-header">
      <small>${escapeHTML(dateLabel(workout.day))}</small>
      <h3>${escapeHTML(sportLabel(workout.sport))}</h3>
      <p>${workout.routePublished ? 'Route explicitly published from StatsKey' : 'Day-level workout summary · route private'}</p>
    </div>
    ${route}
    <div class="ios-card">
      <div class="ios-card-head"><span><span class="ios-card-title">Key Metrics</span></span></div>
      <div class="ios-stat-grid">
        <div><small>Distance</small><strong>${number(workout.distanceMiles).toFixed(2)} mi</strong></div>
        <div><small>Moving</small><strong>${formatClock(workout.movingTimeSeconds || workout.durationSeconds)}</strong></div>
        <div><small>Pace</small><strong>${formatPace(workout.averagePaceSecondsPerMile)}</strong></div>
      </div>
      <div class="ios-stat-grid">
        <div><small>Elevation</small><strong>${integer(workout.elevationGainFeet)} ft</strong></div>
        <div><small>Avg HR</small><strong>${number(workout.averageHeartRateBpm) > 0 ? `${integer(workout.averageHeartRateBpm)}` : '—'}</strong></div>
        <div><small>Cadence</small><strong>${number(workout.averageCadenceSpm) > 0 ? `${integer(workout.averageCadenceSpm)}` : '—'}</strong></div>
      </div>
    </div>
    ${splits.length ? `
      <div class="ios-card">
        <div class="ios-card-head"><span><span class="ios-card-title">Splits</span></span></div>
        <div class="ios-splits">
          ${splits.slice(0, 16).map((split) => {
            const pace = number(split.paceSecondsPerMile)
            const width = slowest > fastest
              ? 58 + ((slowest - pace) / (slowest - fastest)) * 42
              : 82
            return `
              <div class="ios-split-row">
                <strong>${integer(split.number)}</strong>
                <span>${formatPace(pace)}</span>
                <span class="ios-split-bar"><i style="--split-width:${width.toFixed(1)}%"></i></span>
                <span>${number(split.averageHeartRateBpm) > 0 ? integer(split.averageHeartRateBpm) : '—'}</span>
              </div>
            `
          }).join('')}
        </div>
      </div>
    ` : ''}
    ${(number(workout.averageCadenceSpm) > 0 || number(workout.averageStrideLengthMeters) > 0) ? `
      <div class="ios-card">
        <div class="ios-card-head"><span><span class="ios-card-icon ios-card-icon--run">⌁</span><span class="ios-card-title">Running Dynamics</span></span></div>
        <div class="ios-summary-grid">
          <div class="ios-summary-tile"><small>Cadence</small><strong>${integer(workout.averageCadenceSpm)} spm</strong></div>
          <div class="ios-summary-tile"><small>Step length</small><strong>${number(workout.averageStrideLengthMeters).toFixed(2)} m</strong></div>
          <div class="ios-summary-tile"><small>Contact</small><strong>${integer(workout.averageGroundContactMilliseconds)} ms</strong></div>
          <div class="ios-summary-tile"><small>Vertical</small><strong>${number(workout.averageVerticalOscillationCentimeters).toFixed(1)} cm</strong></div>
        </div>
      </div>
    ` : ''}
  `
}

function renderScreen() {
  if (!state.root) return
  const toolbar = elements.back.closest('.ios-app-toolbar')
  const device = elements.stage.querySelector('[data-live-device="running"]')
  if (device) device.dataset.activityView = state.activityView
  if (state.view === 'workout') {
    elements.title.textContent = sportLabel(state.selectedWorkout?.sport)
    elements.title.hidden = false
    elements.back.hidden = false
    toolbar?.classList.add('is-detail')
    elements.screen.innerHTML = workoutDetail()
    return
  }
  if (state.view === 'history') {
    elements.title.textContent = 'Fitness Record'
    elements.title.hidden = false
    elements.back.hidden = false
    toolbar?.classList.add('is-detail')
    elements.screen.innerHTML = historyHome()
    return
  }
  elements.back.hidden = true
  elements.title.hidden = true
  toolbar?.classList.remove('is-detail')
  elements.title.textContent = 'Activity'
  elements.screen.innerHTML = activityHome()
  positionActivityAtYearSummary()
}

function renderNutritionScreen() {
  if (!state.root) return
  const toolbar = elements.nutritionBack.closest('.ios-app-toolbar')
  state.nutritionSurface = 'insights'
  toolbar?.classList.remove('is-profile')
  if (state.nutritionView === 'nutrient') {
    const nutrient = nutritionSnapshot()?.micronutrients
      ?.find((item) => item.key === state.selectedNutrient)
    elements.nutritionTitle.textContent = nutrient?.label || 'Nutrition'
    elements.nutritionTitle.hidden = false
    elements.nutritionBack.hidden = false
    toolbar?.classList.add('is-detail')
    elements.nutritionScreen.innerHTML = nutrientDetailHome()
    return
  }
  elements.nutritionTitle.textContent = 'Insights'
  elements.nutritionBack.hidden = true
  elements.nutritionTitle.hidden = true
  toolbar?.classList.remove('is-detail')
  elements.nutritionScreen.innerHTML = nutritionHome()
}

function renderTrainingRecord() {
  const year = calendarYearSummary()
  const recent = state.root?.training?.periods?.last7Days ?? {}
  const week = previousCalendarWeek()

  elements.yearLabel.textContent = `${year.year} through ${dateLabel(year.throughDay, {
    short: true,
    year: false,
  })}`
  elements.yearAverage.textContent = number(year.averageMilesPerWeek).toFixed(1)
  elements.yearMiles.textContent = number(year.runningMiles).toFixed(1)
  elements.last7.textContent = number(recent.runningMiles).toFixed(1)
  elements.yearRuns.textContent = integer(year.runningActivities)
  elements.weekWindow.textContent = `${dateLabel(week.startDay, {
    short: true,
    year: false,
  })} – ${dateLabel(week.endDay, { short: true, year: false })}`

  elements.weekWorkouts.innerHTML = week.workouts.length
    ? week.workouts.map((workout) => `
      <button class="founder-week-workout" type="button" data-live-workout="${escapeHTML(workout.workoutId)}">
        <span class="founder-week-workout__icon" aria-hidden="true">${isRun(workout) ? '↗' : '•'}</span>
        <span class="founder-week-workout__body">
          <strong>${escapeHTML(sportLabel(workout.sport))}</strong>
          <span>${escapeHTML(dateLabel(workout.day, { short: true, year: false }))} · ${formatDuration(workout.movingTimeSeconds || workout.durationSeconds)}</span>
        </span>
        <span class="founder-week-workout__metric">
          <strong>${number(workout.distanceMiles).toFixed(2)} mi</strong>
          <small>${isRun(workout) ? `${formatPace(workout.averagePaceSecondsPerMile)} /mi` : 'Open'}</small>
        </span>
      </button>
    `).join('')
    : '<div class="founder-week-empty">No public workouts in this calendar week.</div>'
}

function render() {
  renderScreen()
  renderNutritionScreen()
  renderLongitudinalRecord()
}

function positionActivityAtYearSummary() {
  if (
    state.activityPositionLocked ||
    state.view !== 'home' ||
    state.activityView !== 'fitness'
  ) return
  window.requestAnimationFrame(() => {
    if (state.activityPositionLocked) return
    const anchor = elements.screen.querySelector('[data-impressive-anchor]')
    if (!anchor) return
    elements.screen.scrollTop = Math.max(
      0,
      anchor.offsetTop - elements.screen.offsetTop - 8
    )
  })
}

function keepPhoneNavigationVisible(deviceName = 'running') {
  if (!window.matchMedia('(max-width: 760px)').matches) return
  const device = elements.stage.querySelector(`[data-live-device="${deviceName}"]`)
  if (!device) return
  const siteNavHeight = document.getElementById('nav')?.offsetHeight || 58
  const safeTop = siteNavHeight + 8
  const deviceTop = device.getBoundingClientRect().top
  if (deviceTop < safeTop) {
    window.scrollBy({ top: deviceTop - safeTop, behavior: 'auto' })
  }
}

function stopRouteListener() {
  state.unsubscribeRoute?.()
  state.unsubscribeRoute = null
  state.route = null
  state.routeLoading = false
}

function openWorkout(workoutId) {
  const workout = (state.historyWorkouts ?? state.workouts)
    .find((item) => item.workoutId === workoutId)
  if (!workout) return
  stopRouteListener()
  state.selectedWorkout = workout
  state.view = 'workout'
  elements.screen.scrollTop = 0

  // Privacy invariant: no coordinate document is requested unless this exact
  // public summary says the founder explicitly published its route.
  if (state.source === 'live' && workout.routePublished === true && database) {
    state.routeLoading = true
    state.unsubscribeRoute = onSnapshot(
      doc(database, 'publicFounderReplicas', 'founder', 'routes', workoutId),
      (snapshot) => {
        state.routeLoading = false
        state.route = snapshot.exists() ? snapshot.data() : null
        renderScreen()
      },
      (error) => {
        console.warn('Published founder route unavailable', error.code)
        state.routeLoading = false
        state.route = null
        renderScreen()
      }
    )
  }
  renderScreen()
  keepPhoneNavigationVisible()
}

function handleScreenClick(event) {
  const workoutButton = event.target.closest('[data-live-workout]')
  if (workoutButton) {
    openWorkout(workoutButton.dataset.liveWorkout)
    return
  }
  const rangeButton = event.target.closest('[data-live-range]')
  if (rangeButton) {
    state.range = rangeButton.dataset.liveRange
    renderScreen()
    return
  }
  const activityButton = event.target.closest('[data-live-activity-view]')
  if (activityButton) {
    state.activityView = activityButton.dataset.liveActivityView
    elements.screen.scrollTop = 0
    renderScreen()
    return
  }
  const action = event.target.closest('[data-live-action]')?.dataset.liveAction
  if (action === 'history') {
    state.view = 'history'
    elements.screen.scrollTop = 0
    renderScreen()
    keepPhoneNavigationVisible()
    void loadCompleteWorkoutHistory()
  } else if (action === 'start-workout') {
    const button = event.target.closest('[data-live-action="start-workout"]')
    button?.classList.add('is-explaining')
  }
}

function handleNutritionClick(event) {
  const surfaceButton = event.target.closest('[data-live-nutrition-surface]')
  if (surfaceButton) {
    state.nutritionSurface = surfaceButton.dataset.liveNutritionSurface
    state.nutritionView = 'home'
    state.selectedNutrient = null
    elements.nutritionScreen.scrollTop = 0
    renderNutritionScreen()
    return
  }
  const rangeButton = event.target.closest('[data-live-nutrition-range]')
  if (rangeButton && !rangeButton.disabled) {
    state.nutritionRangeDays = number(rangeButton.dataset.liveNutritionRange, 30)
    renderNutritionScreen()
    return
  }
  const nutrientButton = event.target.closest('[data-live-nutrient]')
  if (nutrientButton) {
    state.nutritionSurface = 'insights'
    state.selectedNutrient = nutrientButton.dataset.liveNutrient
    state.nutritionView = 'nutrient'
    elements.nutritionScreen.scrollTop = 0
    renderNutritionScreen()
    keepPhoneNavigationVisible('nutrition')
    return
  }
  const action = event.target.closest('[data-live-action]')?.dataset.liveAction
  if (action === 'toggle-today') {
    state.includeToday = !state.includeToday
    renderNutritionScreen()
  }
}

export function initFounderLive() {
  const stage = document.getElementById('founder-live')
  if (!stage) return
  elements = {
    stage,
    screen: document.getElementById('founder-live-screen'),
    title: document.getElementById('founder-live-title'),
    back: document.getElementById('founder-live-back'),
    nutritionScreen: document.getElementById('founder-nutrition-screen'),
    nutritionTitle: document.getElementById('founder-nutrition-title'),
    nutritionBack: document.getElementById('founder-nutrition-back'),
    longitudinal: document.getElementById('founder-longitudinal-record'),
    status: document.getElementById('founder-live-status'),
    updated: document.getElementById('founder-live-updated'),
  }
  if (Object.values(elements).some((element) => element == null)) return

  elements.back.addEventListener('click', () => {
    stopRouteListener()
    state.view = 'home'
    state.selectedWorkout = null
    elements.screen.scrollTop = 0
    renderScreen()
  })
  elements.nutritionBack.addEventListener('click', () => {
    state.nutritionSurface = 'insights'
    state.nutritionView = 'home'
    state.selectedNutrient = null
    elements.nutritionScreen.scrollTop = 0
    renderNutritionScreen()
  })
  elements.screen.addEventListener('click', handleScreenClick)
  ;['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((eventName) => {
    elements.screen.addEventListener(eventName, () => {
      state.activityPositionLocked = true
    }, { passive: true })
  })
  elements.nutritionScreen.addEventListener('click', handleNutritionClick)
  stage.addEventListener('click', (event) => {
    const longitudinalWorkout = event.target.closest(
      '#founder-longitudinal-record [data-live-workout]'
    )
    if (longitudinalWorkout) {
      state.activityPositionLocked = true
      openWorkout(longitudinalWorkout.dataset.liveWorkout)
      document.getElementById('founder-running-app')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      return
    }
    const jump = event.target.closest('[data-live-jump]')?.dataset.liveJump
    if (!jump) return
    document.getElementById(`founder-${jump}-app`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  })
  let connected = false
  const connect = () => {
    if (connected) return
    connected = true
    connectLiveRecord()
  }
  if (!('IntersectionObserver' in window)) {
    connect()
    return
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    observer.disconnect()
    connect()
  }, { rootMargin: '700px 0px' })
  observer.observe(stage)
}
