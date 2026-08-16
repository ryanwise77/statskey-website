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
  startAfter,
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
  selectedTab: 'fitness',
  view: 'home',
  range: 'week',
  selectedWorkout: null,
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
    limit(120)
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
    const history = []
    let cursor = null
    while (history.length < 5000) {
      const reference = collection(
        database,
        'publicFounderReplicas',
        'founder',
        'workouts'
      )
      const constraints = [orderBy('day', 'desc')]
      if (cursor) constraints.push(startAfter(cursor))
      constraints.push(limit(250))
      const snapshot = await getDocs(query(reference, ...constraints))
      history.push(...snapshot.docs.map((entry) => ({
        ...entry.data(),
        workoutId: entry.id,
      })))
      if (snapshot.size < 250) break
      cursor = snapshot.docs.at(-1)
    }
    state.historyWorkouts = history
  } catch (error) {
    console.warn('Complete founder workout history unavailable', error.code)
    state.historyError = 'The full workout list is unavailable; the complete monthly record is still shown.'
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
  if (key === 'allTime') return state.root?.training?.allTime ?? {}
  return state.root?.training?.periods?.[key] ?? {}
}

function rangeButtons() {
  return `
    <div class="ios-chip-row" role="group" aria-label="Fitness summary range">
      ${Object.entries(RANGE_LABELS).map(([key, label]) => `
        <button class="ios-chip ${state.range === key ? 'is-active' : ''}" type="button" data-live-range="${key}" aria-pressed="${state.range === key}">
          ${label}
        </button>
      `).join('')}
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

function lineChart(values, label) {
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
          <stop offset="0" stop-color="#1676d2" stop-opacity=".25"></stop>
          <stop offset="1" stop-color="#1676d2" stop-opacity=".015"></stop>
        </linearGradient>
      </defs>
      <line class="chart-grid" x1="5" x2="315" y1="24" y2="24"></line>
      <line class="chart-grid" x1="5" x2="315" y1="54" y2="54"></line>
      <polygon class="chart-area" points="${area}" style="fill:url(#${gradientId})"></polygon>
      <polyline class="chart-line" points="${line}"></polyline>
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

function pulseCard() {
  const training = state.root?.training
  const recent = training?.periods?.last7Days ?? {}
  const change = training?.pulse?.changePercent
  const changeText = change == null
    ? 'Building comparison'
    : `${change > 0 ? '↑' : change < 0 ? '↓' : '→'} ${Math.abs(number(change)).toFixed(0)}% vs prior 7 days`
  const values = (training?.weeklyMileage || []).slice(-12).map((week) => number(week.runningMiles))
  return `
    <button class="ios-card ios-card--tinted" type="button" data-live-action="intelligence">
      <div class="ios-card-head">
        <span>
          <span class="ios-card-icon">⌁</span>
          <span>
            <small class="ios-card-kicker">Training pulse</small>
            <span class="ios-card-title">Twelve-week volume</span>
          </span>
        </span>
        <span class="ios-card-chevron" aria-hidden="true">›</span>
      </div>
      <div class="ios-pulse-value">
        <strong>${number(recent.runningMiles).toFixed(1)}</strong>
        <span>mi · 7 days</span>
      </div>
      <span class="ios-pulse-delta">${changeText}</span>
      ${lineChart(values, 'Twelve-week running mileage')}
      <div class="ios-stat-grid">
        <div><small>Avg pace</small><strong>${formatPace(recent.averageRunningPaceSecondsPerMile)}</strong></div>
        <div><small>Active days</small><strong>${integer(recent.activeDays)}</strong></div>
        <div><small>Time</small><strong>${formatDuration(number(recent.activeHours) * 3600)}</strong></div>
      </div>
    </button>
  `
}

function summaryCard() {
  const stats = rangeStats()
  return `
    <div class="ios-card">
      <div class="ios-card-head">
        <span>
          <span class="ios-card-icon">▥</span>
          <span class="ios-card-title">Fitness Summary</span>
        </span>
        <span class="ios-card-kicker">${escapeHTML(RANGE_LABELS[state.range])}</span>
      </div>
      ${rangeButtons()}
      <div class="ios-summary-grid">
        <div class="ios-summary-tile"><small>Running</small><strong>${number(stats.runningMiles).toFixed(1)} mi</strong></div>
        <div class="ios-summary-tile"><small>Activities</small><strong>${integer(stats.activities)}</strong></div>
        <div class="ios-summary-tile"><small>Time</small><strong>${formatDuration(number(stats.activeHours) * 3600)}</strong></div>
        <div class="ios-summary-tile"><small>Elevation</small><strong>${integer(stats.elevationGainFeet)} ft</strong></div>
      </div>
    </div>
  `
}

function nutritionCard() {
  const nutrition = state.root?.nutrition
  const average = nutrition?.dailyAverage ?? {}
  if (!state.root?.nutritionPublished || !nutrition) {
    return `
      <button class="ios-card" type="button" data-live-action="nutrition">
        <div class="ios-card-head">
          <span><span class="ios-card-icon">◉</span><span class="ios-card-title">Recent Nutrition</span></span>
          <span class="ios-card-chevron" aria-hidden="true">›</span>
        </div>
        <p class="ios-card-copy">No public nutrition window is available.</p>
      </button>
    `
  }
  return `
    <button class="ios-card" type="button" data-live-action="nutrition">
      <div class="ios-card-head">
        <span><span class="ios-card-icon">◉</span><span class="ios-card-title">Recent Nutrition</span></span>
        <span class="ios-card-chevron" aria-hidden="true">›</span>
      </div>
      <p class="ios-card-copy">${integer(nutrition.recordedDays)} of ${integer(nutrition.possibleDays)} complete days · recorded food only</p>
      <div class="ios-stat-grid">
        <div><small>Calories</small><strong>${integer(average.calories)}</strong></div>
        <div><small>Carbs</small><strong>${integer(average.carbohydrateGrams)}g</strong></div>
        <div><small>Protein</small><strong>${integer(average.proteinGrams)}g</strong></div>
      </div>
    </button>
  `
}

function historicalCard() {
  const allTime = state.root?.training?.allTime ?? {}
  const months = state.root?.training?.monthlyMileage ?? []
  return `
    <button class="ios-card" type="button" data-live-action="history">
      <div class="ios-card-head">
        <span>
          <span class="ios-card-icon ios-card-icon--run">↗</span>
          <span>
            <small class="ios-card-kicker">Historical record</small>
            <span class="ios-card-title">${number(allTime.runningMiles).toFixed(1)} running miles</span>
          </span>
        </span>
        <span class="ios-card-chevron" aria-hidden="true">›</span>
      </div>
      ${historyBars(months, 12)}
      <p class="ios-card-copy" style="margin-top:9px">${integer(allTime.runningActivities)} runs since ${escapeHTML(dateLabel(allTime.firstDay))}</p>
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

function fitnessHome() {
  return `
    <div class="ios-screen-heading">
      <div><small>Ryan Sullivan</small><h3>Fitness</h3></div>
      <time>${escapeHTML(dateLabel(latestDay(), { short: true, year: false }))}</time>
    </div>
    ${pulseCard()}
    ${summaryCard()}
    ${nutritionCard()}
    ${historicalCard()}
    <div class="ios-section-label">
      <span>Recent Workouts</span>
      <button type="button" data-live-action="history">See All</button>
    </div>
    <div class="ios-workout-list">${workoutRows(state.workouts, 6)}</div>
    <p class="ios-card-copy" style="padding:14px 6px 4px;text-align:center">This public view contains day-level summaries. Private Health data, meal details, and unpublished routes never load here.</p>
  `
}

function activityHome() {
  const day = latestDay()
  const dayWorkouts = state.workouts.filter((workout) => workout.day === day)
  return `
    <div class="ios-screen-heading">
      <div><small>Ryan Sullivan</small><h3>Activity</h3></div>
      <time>${escapeHTML(dateLabel(day, { short: true, year: false }))}</time>
    </div>
    <div class="ios-segmented" style="--segments:2">
      <button class="is-active" type="button" aria-pressed="true">Today</button>
      <button type="button" data-live-switch-tab="fitness" aria-pressed="false">Fitness</button>
    </div>
    <div class="ios-card ios-card--orange">
      <div class="ios-card-head">
        <span><span class="ios-card-icon ios-card-icon--run">✓</span><span class="ios-card-title">Movement is recorded</span></span>
      </div>
      <p class="ios-card-copy">The newest completed day in the public projection is shown below. Exact workout start times stay private.</p>
    </div>
    <div class="ios-section-label"><span>Workouts</span></div>
    <div class="ios-workout-list">${workoutRows(dayWorkouts, 10)}</div>
    <div style="height:11px"></div>
    ${nutritionCard()}
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
    ${pulseCard()}
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
  return items.map((item) => {
    const color = NUTRIENT_COLORS[item.status] || NUTRIENT_COLORS.limited
    const width = Math.max(0, Math.min(number(item.percent), 100))
    return `
      <div class="ios-micro-row">
        <strong>${escapeHTML(item.label)}</strong>
        <span class="ios-micro-track"><i style="--micro-width:${width}%;--micro-color:${color}"></i></span>
        <span>${number(item.average).toLocaleString()} ${escapeHTML(item.unit)}</span>
      </div>
    `
  }).join('')
}

function nutritionHome() {
  const nutrition = state.root?.nutrition
  const average = nutrition?.dailyAverage ?? {}
  return `
    <div class="ios-screen-heading">
      <div><small>${escapeHTML(nutrition?.startDay ?? '')} — ${escapeHTML(nutrition?.endDay ?? '')}</small><h3>Nutrition</h3></div>
      <time>${integer(nutrition?.recordedDays)} days</time>
    </div>
    <div class="ios-card ios-card--tinted">
      <div class="ios-card-head">
        <span><span class="ios-card-icon">◉</span><span class="ios-card-title">Recorded Food Intake</span></span>
      </div>
      <div class="ios-summary-grid">
        <div class="ios-summary-tile"><small>Calories</small><strong>${integer(average.calories)}</strong></div>
        <div class="ios-summary-tile"><small>Carbs</small><strong>${integer(average.carbohydrateGrams)}g</strong></div>
        <div class="ios-summary-tile"><small>Protein</small><strong>${integer(average.proteinGrams)}g</strong></div>
        <div class="ios-summary-tile"><small>Fiber</small><strong>${number(average.fiberGrams).toFixed(1)}g</strong></div>
      </div>
    </div>
    <div class="ios-card">
      <div class="ios-card-head">
        <span><span class="ios-card-icon">◎</span><span class="ios-card-title">Recent Micronutrition</span></span>
      </div>
      <p class="ios-card-copy">Compared with standard daily references. Limited label coverage is labeled instead of treated as a deficiency.</p>
      <div style="margin-top:8px">${nutritionRows(nutrition?.micronutrients)}</div>
    </div>
    <p class="ios-card-copy" style="padding:0 5px 8px">${escapeHTML(nutrition?.disclaimer || 'Recorded intake estimate; not a diagnosis or a predictor of athletic potential.')}</p>
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
  const allTime = training.allTime ?? {}
  const history = state.historyWorkouts ?? state.workouts
  const listStatus = state.historyLoading
    ? '<div class="ios-empty">Loading the complete day-level record…</div>'
    : state.historyError
      ? `<div class="ios-empty">${escapeHTML(state.historyError)}</div>`
      : `<div class="ios-empty">${integer(history.length)} projected activities</div>`
  return `
    <div class="ios-screen-heading">
      <div><small>Complete projected history</small><h3>Fitness Record</h3></div>
      <time>${escapeHTML((allTime.firstDay || '').slice(0, 4))}—now</time>
    </div>
    <div class="ios-card ios-card--tinted">
      <div class="ios-pulse-value"><strong>${number(allTime.runningMiles).toFixed(1)}</strong><span>running miles</span></div>
      <div class="ios-stat-grid">
        <div><small>Runs</small><strong>${integer(allTime.runningActivities)}</strong></div>
        <div><small>Hours</small><strong>${number(allTime.activeHours).toFixed(0)}</strong></div>
        <div><small>Active days</small><strong>${integer(allTime.activeDays)}</strong></div>
      </div>
    </div>
    <div class="ios-card">
      <div class="ios-card-head">
        <span><span class="ios-card-icon ios-card-icon--run">↗</span><span class="ios-card-title">Monthly Running Mileage</span></span>
      </div>
      ${historyBars(training.monthlyMileage, 30)}
      <p class="ios-card-copy" style="margin-top:9px">The chart covers every projected month. Opening History loads the complete day-level public record on demand.</p>
    </div>
    <div class="ios-section-label"><span>Workout History</span></div>
    ${listStatus}
    <div class="ios-workout-list">${workoutRows(history, history.length)}</div>
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
    : 'This page never requests coordinates unless this run is explicitly published in StatsKey.'
  return `
    <div class="ios-private-route">
      <div><span aria-hidden="true">♙</span><strong>Route private</strong><p>${explanation}</p></div>
    </div>
  `
}

function workoutDetail() {
  const workout = state.selectedWorkout
  if (!workout) return fitnessHome()
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
  if (state.view === 'workout') {
    elements.title.textContent = sportLabel(state.selectedWorkout?.sport)
    elements.back.hidden = false
    elements.screen.innerHTML = workoutDetail()
    return
  }
  if (state.view === 'history') {
    elements.title.textContent = 'Fitness Record'
    elements.back.hidden = false
    elements.screen.innerHTML = historyHome()
    return
  }
  elements.back.hidden = true
  if (state.selectedTab === 'activity') {
    elements.title.textContent = 'Activity'
    elements.screen.innerHTML = activityHome()
  } else if (state.selectedTab === 'fitness') {
    elements.title.textContent = 'Fitness'
    elements.screen.innerHTML = fitnessHome()
  } else if (state.selectedTab === 'intelligence') {
    elements.title.textContent = 'Running Intelligence'
    elements.screen.innerHTML = intelligenceHome()
  } else if (state.selectedTab === 'friends') {
    elements.title.textContent = 'Friends'
    elements.screen.innerHTML = friendsHome()
  } else {
    elements.title.textContent = 'Fuel'
    elements.screen.innerHTML = nutritionHome()
  }
}

function renderRail() {
  const nutrition = state.root?.nutrition
  const average = nutrition?.dailyAverage ?? {}
  const macros = [
    ['Calories', integer(average.calories), 'daily avg'],
    ['Carbs', integer(average.carbohydrateGrams), 'g / day'],
    ['Protein', integer(average.proteinGrams), 'g / day'],
  ]
  elements.macros.innerHTML = macros.map(([label, value, unit]) => `
    <div><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>
  `).join('')

  const micronutrients = nutrition?.micronutrients || []
  const strong = micronutrients.filter((item) => ['strong', 'within'].includes(item.status)).length
  const watch = micronutrients.filter((item) => item.status === 'watch').length
  const limited = micronutrients.filter((item) => item.status === 'limited').length
  elements.microHeadline.textContent = micronutrients.length
    ? `${strong} strong · ${watch} to watch${limited ? ` · ${limited} limited` : ''}`
    : 'No public nutrition window'
  elements.microList.innerHTML = micronutrients.map((item) => {
    const color = NUTRIENT_COLORS[item.status] || NUTRIENT_COLORS.limited
    return `
      <div class="founder-micro-item" title="${escapeHTML(item.summary)}">
        <strong>${escapeHTML(item.label)}</strong>
        <span class="founder-micro-item__track"><i style="--micro-width:${Math.min(number(item.percent), 100)}%;--micro-color:${color}"></i></span>
        <span>${number(item.average).toLocaleString()} ${escapeHTML(item.unit)}</span>
      </div>
    `
  }).join('')
  elements.microNote.textContent = nutrition?.disclaimer ||
    'Recorded food only. Supplements, medications, meal names, and food names are not published.'
}

function render() {
  renderScreen()
  renderRail()
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
}

function setTab(tab) {
  stopRouteListener()
  state.selectedTab = tab
  state.view = 'home'
  state.selectedWorkout = null
  elements.tabs.forEach((button) => {
    const active = button.dataset.founderTab === tab
    button.classList.toggle('is-active', active)
    if (active) {
      button.setAttribute('aria-current', 'page')
    } else {
      button.removeAttribute('aria-current')
    }
  })
  elements.screen.scrollTop = 0
  renderScreen()
  if (tab === 'history') void loadCompleteWorkoutHistory()
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
  const switchTab = event.target.closest('[data-live-switch-tab]')
  if (switchTab) {
    setTab(switchTab.dataset.liveSwitchTab)
    return
  }
  const action = event.target.closest('[data-live-action]')?.dataset.liveAction
  if (action === 'history') {
    state.view = 'history'
    elements.screen.scrollTop = 0
    renderScreen()
    void loadCompleteWorkoutHistory()
  } else if (action === 'intelligence') {
    setTab('intelligence')
  } else if (action === 'nutrition') {
    setTab('fuel')
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
    status: document.getElementById('founder-live-status'),
    updated: document.getElementById('founder-live-updated'),
    tabs: Array.from(document.querySelectorAll('[data-founder-tab]')),
    macros: document.getElementById('founder-live-macros'),
    microHeadline: document.getElementById('founder-micro-headline'),
    microList: document.getElementById('founder-micro-list'),
    microNote: document.getElementById('founder-micro-note'),
    reset: document.getElementById('founder-live-reset'),
  }
  if (Object.values(elements).some((element) => element == null)) return

  elements.tabs.forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.founderTab))
  })
  elements.back.addEventListener('click', () => {
    stopRouteListener()
    state.view = 'home'
    state.selectedWorkout = null
    elements.screen.scrollTop = 0
    renderScreen()
  })
  elements.reset.addEventListener('click', (event) => {
    event.preventDefault()
    setTab('fitness')
    stage.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
  elements.screen.addEventListener('click', handleScreenClick)
  connectLiveRecord()
}
