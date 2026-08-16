import type { Meal, WorkoutSession } from './types'
import type { HealthDaily } from './data/useHealthDaily'
import type { VitalKind, VitalSample } from './data/useVitalsRange'
import type { SleepDay } from './data/useSleepSessions'
import { dailyTotals } from './aggregates'
import { localDateString } from './firestore'

export interface MetricPoint {
  date: Date
  value: number
}

export interface MetricTrend {
  recent: number | null
  baseline: number | null
  points: MetricPoint[]
  recentDays: number
  baselineDays: number
  delta: number | null
  percentDelta: number | null
}

export interface TrainingLoadSnapshot {
  fitness: number
  fatigue: number
  form: number
  acwr: number
  weeklyLoad: number
  zone: 'insufficient' | 'detraining' | 'optimal' | 'caution' | 'highRisk'
  fitnessSeries: MetricPoint[]
  formSeries: MetricPoint[]
  hasData: boolean
}

export interface ReadinessPillar {
  id: 'sleep' | 'hrv' | 'rhr' | 'load' | 'fuel'
  name: string
  score: number
  weight: number
  detail: string
}

export interface ReadinessSnapshot {
  score: number
  band: 'prime' | 'high' | 'moderate' | 'low' | 'rest'
  title: string
  guidance: string
  headline: string
  pillars: ReadinessPillar[]
  hasData: boolean
}

export function vitalTrend(
  samples: VitalSample[],
  kind: VitalKind,
  reference: Date,
  baselineDays: number
): MetricTrend {
  return metricTrend(
    samples
      .filter((sample) => sample.kind === kind)
      .map((sample) => ({ date: sample.date, value: sample.value })),
    reference,
    baselineDays
  )
}

export function dailyHealthTrend(
  days: HealthDaily[],
  value: (day: HealthDaily) => number,
  reference: Date,
  baselineDays = 42,
  requireWear = false
): MetricTrend {
  return metricTrend(
    days
      .filter((day) => !requireWear || day.steps > 0)
      .map((day) => ({ date: day.date, value: value(day) }))
      .filter((point) => point.value > 0),
    reference,
    baselineDays
  )
}

export function metricTrend(
  rawPoints: MetricPoint[],
  reference: Date,
  baselineDays: number,
  recentDays = 14
): MetricTrend {
  const points = dailyMeans(rawPoints).sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  )
  const recentCutoff = addDays(reference, -recentDays)
  const baselineCutoff = addDays(recentCutoff, -baselineDays)
  const recentValues = points
    .filter((point) => point.date >= recentCutoff && point.date <= reference)
    .map((point) => point.value)
  const baselineValues = points
    .filter((point) => point.date >= baselineCutoff && point.date < recentCutoff)
    .map((point) => point.value)
  const recent = recentValues.length >= 3 ? mean(recentValues) : null
  const baseline = baselineValues.length >= 7 ? mean(baselineValues) : null
  const delta =
    recent != null && baseline != null ? recent - baseline : null
  const percentDelta =
    delta != null && baseline
      ? (delta / Math.abs(baseline)) * 100
      : null
  return {
    recent,
    baseline,
    points: points.filter((point) => point.date >= baselineCutoff),
    recentDays,
    baselineDays,
    delta,
    percentDelta,
  }
}

export function trainingLoadSnapshot(
  workouts: WorkoutSession[],
  reference = new Date(),
  lookbackDays = 120
): TrainingLoadSnapshot {
  const start = startOfDay(addDays(reference, -lookbackDays))
  const loadByDay = new Map<string, number>()
  for (const workout of workouts) {
    if (workout.startDate < start || workout.startDate > reference) continue
    const key = localDateString(workout.startDate)
    loadByDay.set(key, (loadByDay.get(key) ?? 0) + workoutLoad(workout))
  }

  const dates: Date[] = []
  const loads: number[] = []
  for (
    let day = start;
    day <= startOfDay(reference) && loads.length <= 800;
    day = addDays(day, 1)
  ) {
    dates.push(day)
    loads.push(loadByDay.get(localDateString(day)) ?? 0)
  }
  const last7 = loads.slice(-7).reduce((sum, value) => sum + value, 0)
  const last28 = loads.slice(-28).reduce((sum, value) => sum + value, 0)
  const chronicWeekly = last28 / 4
  const acwr = chronicWeekly > 0 ? last7 / chronicWeekly : 0
  const fitnessValues = ewma(loads, 42)
  const fatigueValues = ewma(loads, 7)
  const fitness = fitnessValues.at(-1) ?? 0
  const fatigue = fatigueValues.at(-1) ?? 0
  const form = fitness - fatigue
  const zone =
    last28 <= 0 || acwr === 0
      ? 'insufficient'
      : acwr < 0.8
        ? 'detraining'
        : acwr <= 1.3
          ? 'optimal'
          : acwr <= 1.5
            ? 'caution'
            : 'highRisk'
  return {
    fitness,
    fatigue,
    form,
    acwr,
    weeklyLoad: last7,
    zone,
    fitnessSeries: dates.map((date, index) => ({
      date,
      value: fitnessValues[index] ?? 0,
    })),
    formSeries: dates.map((date, index) => ({
      date,
      value: (fitnessValues[index] ?? 0) - (fatigueValues[index] ?? 0),
    })),
    hasData: last28 > 0,
  }
}

export function computeReadiness({
  sleepDays,
  vitals,
  workouts,
  meals,
  calorieTarget,
  carbTarget,
  reference = new Date(),
}: {
  sleepDays: SleepDay[]
  vitals: VitalSample[]
  workouts: WorkoutSession[]
  meals: Meal[]
  calorieTarget: number
  carbTarget: number
  reference?: Date
}): ReadinessSnapshot {
  const pillars: Array<{ pillar: Omit<ReadinessPillar, 'weight'>; weight: number }> = []
  const referenceDay = startOfDay(reference)
  const referenceKey = localDateString(referenceDay)
  const yesterday = startOfDay(addDays(referenceDay, -1))
  const yesterdayKey = localDateString(yesterday)
  const readinessSleepDays = sleepDays
    .filter((day) => day.hours > 0)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
  // HealthKit assigns an overnight sleep session to its wake day. Match iOS:
  // today's rollup is last night's sleep, and older values never stand in for it.
  const lastSleep = readinessSleepDays.find(
    (day) => localDateString(day.date) === referenceKey
  )
  if (lastSleep) {
    const baseline = readinessSleepDays
      .filter((day) => startOfDay(day.date) < referenceDay)
      .slice(0, 30)
      .map((day) => day.hours)
    const need = Math.min(Math.max(median(baseline) ?? 7.5, 7), 9)
    const score = clamp01((lastSleep.hours - 4) / (need - 4)) * 100
    pillars.push({
      pillar: {
        id: 'sleep',
        name: 'Sleep',
        score,
        detail: `${lastSleep.hours.toFixed(1)} h vs ${need.toFixed(1)} h personal need`,
      },
      weight: 0.25,
    })
  }

  const hrvDaily = dailyMeans(
    vitals
      .filter((sample) => sample.kind === 'heartRateVariabilitySDNN')
      .map((sample) => ({ date: sample.date, value: sample.value }))
  ).sort((a, b) => b.date.getTime() - a.date.getTime())
  const hrv = currentReadinessMetric(hrvDaily, referenceDay)
  if (hrv && hrv.baseline.length >= 7) {
    const today = hrv.current.value
    const baseline = mean(hrv.baseline)
    const ratio = baseline > 0 ? today / baseline : 0
    pillars.push({
      pillar: {
        id: 'hrv',
        name: 'HRV',
        score: piecewise(ratio, [
          [0.6, 10], [0.7, 25], [0.85, 60], [1, 90], [1.05, 100],
        ]),
        detail: `${Math.round(today)} ms · ${Math.round(Math.abs(ratio - 1) * 100)}% ${ratio >= 1 ? 'above' : 'below'} baseline`,
      },
      weight: 0.25,
    })
  }

  const rhrDaily = dailyMeans(
    vitals
      .filter((sample) => sample.kind === 'restingHeartRate')
      .map((sample) => ({ date: sample.date, value: sample.value }))
  ).sort((a, b) => b.date.getTime() - a.date.getTime())
  const restingHR = currentReadinessMetric(rhrDaily, referenceDay)
  if (restingHR && restingHR.baseline.length >= 7) {
    const today = restingHR.current.value
    const baseline = mean(restingHR.baseline)
    const elevation = baseline > 0 ? today / baseline - 1 : 0
    pillars.push({
      pillar: {
        id: 'rhr',
        name: 'Resting HR',
        score: piecewise(elevation, [
          [-0.05, 100], [0, 100], [0.03, 80], [0.06, 55], [0.1, 25], [0.15, 5],
        ]),
        detail:
          elevation <= 0.005
            ? `${Math.round(today)} bpm · at baseline`
            : `${Math.round(today)} bpm · ${Math.round(elevation * 100)}% above baseline`,
      },
      weight: 0.15,
    })
  }

  const load = trainingLoadSnapshot(workouts, reference)
  const yesterdayLoad = workouts
    .filter((workout) => localDateString(workout.startDate) === yesterdayKey)
    .reduce((sum, workout) => sum + workoutLoad(workout), 0)
  if (load.hasData) {
    let score = piecewise(load.form, [
      [-30, 15], [-20, 35], [-10, 60], [0, 80], [5, 95], [15, 100],
    ])
    if (load.zone === 'highRisk') score = Math.min(score, 40)
    if (load.zone === 'caution') score = Math.min(score, 65)
    if (load.fitness > 0 && yesterdayLoad > load.fitness * 2) {
      score = Math.max(score - 12, 5)
    }
    pillars.push({
      pillar: {
        id: 'load',
        name: 'Training Load',
        score,
        detail:
          load.form >= 0
            ? `Form +${load.form.toFixed(0)} · fresh`
            : `Form ${load.form.toFixed(0)} · carrying fatigue`,
      },
      weight: 0.2,
    })
  }

  const yesterdayMeals = meals.filter(
    (meal) => localDateString(meal.date) === yesterdayKey
  )
  if (yesterdayMeals.length > 0 && calorieTarget > 0) {
    const totals = dailyTotals(yesterdayMeals)
    const energyRatio = totals.calories / calorieTarget
    const energyScore = piecewise(energyRatio, [
      [0.5, 15], [0.6, 30], [0.7, 55], [0.8, 80], [0.9, 100], [1.35, 100], [1.6, 88],
    ])
    let score = energyScore
    let note = ''
    if (carbTarget > 0 && totals.carbs > 0) {
      const carbRatio = totals.carbs / carbTarget
      const carbScore = piecewise(carbRatio, [
        [0.4, 20], [0.6, 50], [0.8, 85], [0.95, 100], [1.5, 100],
      ])
      const hardYesterday = load.fitness > 0 && yesterdayLoad > load.fitness * 1.2
      const carbWeight = hardYesterday ? 0.5 : 0.25
      score = energyScore * (1 - carbWeight) + carbScore * carbWeight
      if (hardYesterday && carbRatio < 0.8) note = ' · carbs ran light after a hard day'
    }
    pillars.push({
      pillar: {
        id: 'fuel',
        name: 'Fueling',
        score,
        detail: `${Math.round(energyRatio * 100)}% of energy target yesterday${note}`,
      },
      weight: 0.15,
    })
  }

  const hasPhysiology = pillars.some(
    ({ pillar }) => pillar.id === 'sleep' || pillar.id === 'hrv'
  )
  if (pillars.length < 2 || !hasPhysiology) return emptyReadiness()
  const weightTotal = pillars.reduce((sum, entry) => sum + entry.weight, 0)
  const normalized = pillars
    .map(({ pillar, weight }) => ({ ...pillar, weight: weight / weightTotal }))
    .sort((a, b) => b.weight - a.weight)
  const score = Math.min(
    100,
    Math.max(
      1,
      Math.round(
        normalized.reduce(
          (sum, pillar) => sum + pillar.score * pillar.weight,
          0
        )
      )
    )
  )
  const band = readinessBand(score)
  const weakest = [...normalized].sort((a, b) => a.score - b.score)[0]
  const strongest = [...normalized].sort((a, b) => b.score - a.score)[0]
  const title = readinessBandCopy(band).title
  const guidance = readinessBandCopy(band).guidance
  const headline =
    band === 'prime'
      ? 'Everything lines up — sleep, recovery, and fueling all say go.'
      : weakest.score >= 75
        ? guidance
        : band === 'high'
          ? `Strong day — ${strongest.name.toLowerCase()} leads; watch ${weakest.name.toLowerCase()}.`
          : band === 'moderate'
            ? `Workable day, but ${weakest.name.toLowerCase()} is holding you back.`
            : `Recovery first — ${weakest.name.toLowerCase()} needs attention before quality work.`
  return { score, band, title, guidance, headline, pillars: normalized, hasData: true }
}

export function workoutLoad(workout: WorkoutSession): number {
  if (workout.relativeEffort > 0) return workout.relativeEffort
  const durationMinutes =
    Number.isFinite(workout.duration) && workout.duration > 0
      ? workout.duration / 60
      : 0
  if (durationMinutes <= 0) return 0
  if (workout.averageHeartRate > 0) {
    const restingHeartRate = 60
    const maximumHeartRate = Math.max(workout.maxHeartRate, 190)
    const reserve = maximumHeartRate - restingHeartRate
    if (reserve > 0) {
      const fraction = clamp01(
        (workout.averageHeartRate - restingHeartRate) / reserve
      )
      return durationMinutes * fraction * 0.64 * Math.exp(1.92 * fraction)
    }
  }
  return durationMinutes * sportLoadIntensity(workout.sportType)
}

function currentReadinessMetric(
  points: MetricPoint[],
  referenceDay: Date
): { current: MetricPoint; baseline: number[] } | null {
  const todayKey = localDateString(referenceDay)
  const yesterdayKey = localDateString(addDays(referenceDay, -1))
  const current =
    points.find((point) => localDateString(point.date) === todayKey) ??
    points.find((point) => localDateString(point.date) === yesterdayKey)
  if (!current) return null
  return {
    current,
    baseline: points
      .filter((point) => startOfDay(point.date) < startOfDay(current.date))
      .slice(0, 30)
      .map((point) => point.value),
  }
}

function sportLoadIntensity(sportType: string): number {
  switch (sportType) {
    case 'running':
    case 'trailRunning':
      return 1.2
    case 'cycling':
    case 'roadCycling':
    case 'mountainBiking':
      return 1
    case 'hiit':
    case 'crossfit':
      return 1.5
    case 'swimming':
      return 1.1
    case 'strengthTraining':
      return 0.8
    case 'yoga':
    case 'pilates':
      return 0.3
    case 'walking':
      return 0.5
    default:
      return 0.7
  }
}

function dailyMeans(points: MetricPoint[]): MetricPoint[] {
  const buckets = new Map<string, { date: Date; total: number; count: number }>()
  for (const point of points) {
    if (!Number.isFinite(point.value) || point.value <= 0) continue
    const key = localDateString(point.date)
    const bucket = buckets.get(key) ?? {
      date: startOfDay(point.date),
      total: 0,
      count: 0,
    }
    bucket.total += point.value
    bucket.count += 1
    buckets.set(key, bucket)
  }
  return [...buckets.values()].map((bucket) => ({
    date: bucket.date,
    value: bucket.total / bucket.count,
  }))
}

function ewma(values: number[], timeConstant: number): number[] {
  const alpha = 2 / (timeConstant + 1)
  let current = 0
  return values.map((value) => {
    current += alpha * (value - current)
    return current
  })
}

function piecewise(value: number, anchors: Array<[number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1]
  if (value >= anchors.at(-1)![0]) return anchors.at(-1)![1]
  for (let index = 1; index < anchors.length; index += 1) {
    const lower = anchors[index - 1]
    const upper = anchors[index]
    if (value <= upper[0]) {
      const fraction = (value - lower[0]) / (upper[0] - lower[0])
      return lower[1] + fraction * (upper[1] - lower[1])
    }
  }
  return anchors.at(-1)![1]
}

function readinessBand(score: number): ReadinessSnapshot['band'] {
  if (score >= 90) return 'prime'
  if (score >= 75) return 'high'
  if (score >= 55) return 'moderate'
  if (score >= 35) return 'low'
  return 'rest'
}

function readinessBandCopy(band: ReadinessSnapshot['band']) {
  switch (band) {
    case 'prime': return { title: 'Prime', guidance: 'A day for your hardest work.' }
    case 'high': return { title: 'High', guidance: 'Ready for challenges — quality should go well.' }
    case 'moderate': return { title: 'Moderate', guidance: 'Good to go. Keep intensity honest.' }
    case 'low': return { title: 'Low', guidance: 'Easy volume only; protect recovery.' }
    case 'rest': return { title: 'Rest Day', guidance: 'Movement, not training.' }
  }
}

function emptyReadiness(): ReadinessSnapshot {
  return {
    score: 0,
    band: 'moderate',
    title: 'Baseline building',
    guidance: 'More synced recovery data is needed.',
    headline: 'Wear and sync your watch to build readiness.',
    pillars: [],
    hasData: false,
  }
}

function startOfDay(date: Date): Date {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function addDays(date: Date, days: number): Date {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
