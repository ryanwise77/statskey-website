import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, LineChart } from '../components/SimpleCharts'
import { dailyTotals } from '../lib/aggregates'
import {
  computeReadiness,
  dailyHealthTrend,
  metricTrend,
  trainingLoadSnapshot,
  vitalTrend,
  type MetricTrend,
  type ReadinessSnapshot,
} from '../lib/healthInsights'
import { useAuth } from '../lib/auth'
import { useGlucoseRange, glucoseStats } from '../lib/data/useGlucoseRange'
import { useHealthDailyRange, type HealthDaily } from '../lib/data/useHealthDaily'
import { useSleepSessionsRange } from '../lib/data/useSleepSessions'
import {
  useMealsHistory,
  useWellnessHistory,
  useWorkoutsHistory,
} from '../lib/data/useHistory'
import { useMacroTargets } from '../lib/data/useMacroTargets'
import { useVitalsRange } from '../lib/data/useVitalsRange'
import { useWaterRange } from '../lib/data/useWaterRange'
import { useWeights } from '../lib/data/useWeights'
import { localDateString } from '../lib/firestore'
import {
  type GlucoseReading,
  type Meal,
  type WellnessEntry,
  type WorkoutSession,
} from '../lib/types'

type Range = 7 | 30 | 90
type Domain =
  | 'overview'
  | 'recovery'
  | 'capacity'
  | 'load'
  | 'movement'
  | 'nutrition'
  | 'wellness'
  | 'glucose'
type TrendKey = 'rhr' | 'hrv' | 'steps' | 'sleep'

const DOMAINS: Array<{ id: Domain; label: string; icon: string }> = [
  { id: 'overview', label: 'Overview', icon: '✦' },
  { id: 'recovery', label: 'Recovery', icon: '♥' },
  { id: 'capacity', label: 'Capacity', icon: '◉' },
  { id: 'load', label: 'Load', icon: '↗' },
  { id: 'movement', label: 'Movement', icon: '◎' },
  { id: 'nutrition', label: 'Nutrition', icon: '◒' },
  { id: 'wellness', label: 'Wellness', icon: '◇' },
  { id: 'glucose', label: 'Glucose', icon: '∿' },
]

export function HealthInsights() {
  const { user } = useAuth()
  const uid = user?.uid
  const [range, setRange] = useState<Range>(30)
  const [includeToday, setIncludeToday] = useState(true)
  const [domain, setDomain] = useState<Domain>('overview')
  const [trendKey, setTrendKey] = useState<TrendKey>('rhr')

  const { start, end, baselineStart } = useMemo(() => {
    const endDate = includeToday ? new Date() : addDays(new Date(), -1)
    return {
      start: addDays(endDate, -(range - 1)),
      end: endDate,
      baselineStart: addDays(endDate, -120),
    }
  }, [includeToday, range])

  const mealsState = useMealsHistory(uid, start, end)
  const wellnessState = useWellnessHistory(uid, start, end)
  const workoutsState = useWorkoutsHistory(uid, baselineStart, end)
  const vitalsState = useVitalsRange(uid, baselineStart, end)
  const healthState = useHealthDailyRange(uid, baselineStart, end)
  const sleepState = useSleepSessionsRange(uid, baselineStart, end)
  const waterState = useWaterRange(uid, start, end)
  const weightsState = useWeights(uid, start, end)
  const glucoseState = useGlucoseRange(uid, start, end)
  const targetsState = useMacroTargets(uid)

  const trends = useMemo(() => {
    const vitals = vitalsState.samples
    const health = healthState.days
    return {
      rhr: vitalTrend(vitals, 'restingHeartRate', end, 76),
      hrv: vitalTrend(vitals, 'heartRateVariabilitySDNN', end, 76),
      walkingHR: vitalTrend(vitals, 'walkingHeartRateAverage', end, 42),
      respiratory: vitalTrend(vitals, 'respiratoryRate', end, 42),
      oxygen: vitalTrend(vitals, 'oxygenSaturationPercent', end, 42),
      vo2: vitalTrend(vitals, 'vo2Max', end, 166),
      steps: dailyHealthTrend(health, (day) => day.steps, end, 42, true),
      exercise: dailyHealthTrend(
        health,
        (day) => day.exerciseMinutes,
        end,
        42,
        true
      ),
      activeEnergy: dailyHealthTrend(
        health,
        (day) => day.activeCalories,
        end,
        42,
        true
      ),
      sleep: metricTrend(
        sleepState.days.map((day) => ({ date: day.date, value: day.hours })),
        end,
        42
      ),
    }
  }, [end, healthState.days, sleepState.days, vitalsState.samples])

  const load = useMemo(
    () => trainingLoadSnapshot(workoutsState.workouts, end),
    [end, workoutsState.workouts]
  )
  const readiness = useMemo(
    () =>
      computeReadiness({
        sleepDays: sleepState.days,
        vitals: vitalsState.samples,
        workouts: workoutsState.workouts,
        meals: mealsState.meals,
        calorieTarget: targetsState.targets.calories,
        carbTarget: targetsState.targets.carbs,
        reference: end,
      }),
    [
      end,
      mealsState.meals,
      sleepState.days,
      targetsState.targets.calories,
      targetsState.targets.carbs,
      vitalsState.samples,
      workoutsState.workouts,
    ]
  )

  const loading =
    mealsState.loading ||
    wellnessState.loading ||
    workoutsState.loading ||
    vitalsState.loading ||
    healthState.loading ||
    sleepState.loading
  const errors = [
    mealsState.error,
    wellnessState.error,
    workoutsState.error,
    vitalsState.error,
    healthState.error,
    sleepState.error,
  ].filter(Boolean)

  return (
    <div className="health-insights">
      <header className="health-insights__header">
        <div>
          <span>Health intelligence</span>
          <h1>Insights</h1>
          <p>Personal baselines, recovery, training, nutrition, and glucose.</p>
        </div>
        <div className="health-insights__range">
          <label>
            <input
              type="checkbox"
              checked={includeToday}
              onChange={(event) => setIncludeToday(event.target.checked)}
            />
            Include today
          </label>
          <div className="tab-strip">
            {([7, 30, 90] as Range[]).map((option) => (
              <button
                key={option}
                className={range === option ? 'active' : ''}
                onClick={() => setRange(option)}
              >
                {option}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav className="health-insights__domains" aria-label="Insight domains">
        {DOMAINS.map((item) => (
          <button
            key={item.id}
            className={domain === item.id ? 'active' : ''}
            onClick={() => setDomain(item.id)}
          >
            <i aria-hidden="true">{item.icon}</i>
            {item.label}
          </button>
        ))}
      </nav>

      {errors.length > 0 && (
        <div className="error-banner">{errors[0]}</div>
      )}
      {loading && (
        <div className="health-insights__loading">Updating personal baselines…</div>
      )}

      {domain === 'overview' && (
        <Overview
          readiness={readiness}
          trends={trends}
          trendKey={trendKey}
          onTrendKey={setTrendKey}
          load={load}
          workouts={workoutsState.workouts}
          onDomain={setDomain}
        />
      )}
      {domain === 'recovery' && (
        <Recovery readiness={readiness} trends={trends} />
      )}
      {domain === 'capacity' && (
        <Capacity
          trends={trends}
          workouts={workoutsState.workouts}
          end={end}
        />
      )}
      {domain === 'load' && (
        <Load
          load={load}
          workouts={workoutsState.workouts}
          end={end}
        />
      )}
      {domain === 'movement' && (
        <Movement
          trends={trends}
          days={healthState.days.filter(
            (day) => day.date >= start && day.date <= end
          )}
        />
      )}
      {domain === 'nutrition' && (
        <Nutrition
          meals={mealsState.meals}
          water={waterState.days}
          weights={weightsState.weights}
          targets={targetsState.targets}
          start={start}
          end={end}
        />
      )}
      {domain === 'wellness' && (
        <Wellness entries={wellnessState.entries} />
      )}
      {domain === 'glucose' && (
        <Glucose
          readings={glucoseState.readings}
          loading={glucoseState.loading}
        />
      )}

      <footer className="health-insights__footer">
        <span>Apple Health metrics appear after iOS sync and are compared only with your own baseline.</span>
        <Link to="/flow">Ask StatsKey about these signals →</Link>
      </footer>
    </div>
  )
}

function Overview({
  readiness,
  trends,
  trendKey,
  onTrendKey,
  load,
  workouts,
  onDomain,
}: {
  readiness: ReadinessSnapshot
  trends: TrendSet
  trendKey: TrendKey
  onTrendKey: (key: TrendKey) => void
  load: ReturnType<typeof trainingLoadSnapshot>
  workouts: WorkoutSession[]
  onDomain: (domain: Domain) => void
}) {
  const highlights = rankedHighlights(trends)
  const selected = trends[trendKey]
  const week = periodWorkoutSummary(workouts, 7)
  return (
    <div className="health-insights__stack">
      <ReadinessCard readiness={readiness} />

      <div className="health-insights__overview-grid">
        <section className="health-card">
          <CardHeading
            eyebrow="What changed"
            title="Largest shifts from your baseline"
            source="Blended"
          />
          {highlights.length === 0 ? (
            <EmptyCopy text="Your baseline is still building. Sync several worn days to unlock comparisons." />
          ) : (
            <div className="health-shifts">
              {highlights.map((highlight) => (
                <div key={highlight.key}>
                  <span>{highlight.label}</span>
                  <b>{highlight.value}</b>
                  <i data-tone={highlight.tone}>
                    {signedPercent(highlight.percent)}
                  </i>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="health-card">
          <CardHeading
            eyebrow="This week"
            title={`${week.count} sessions · ${week.hours.toFixed(1)} hours`}
            source="StatsKey"
          />
          <div className="health-stat-grid">
            <MiniStat label="Distance" value={`${week.distance.toFixed(1)} mi`} />
            <MiniStat label="Load" value={`${Math.round(week.load)}`} />
            <MiniStat
              label="Form"
              value={load.hasData ? signedNumber(load.form) : 'Building'}
            />
            <MiniStat
              label="ACWR"
              value={load.hasData ? load.acwr.toFixed(2) : '—'}
            />
          </div>
        </section>
      </div>

      <section className="health-card">
        <CardHeading
          eyebrow="Your baseline, over time"
          title={trendName(trendKey)}
          source="Apple Health sync"
        />
        <div className="health-trend-picker">
          {(['rhr', 'hrv', 'steps', 'sleep'] as TrendKey[]).map((key) => (
            <button
              key={key}
              className={trendKey === key ? 'active' : ''}
              onClick={() => onTrendKey(key)}
            >
              {trendName(key)}
            </button>
          ))}
        </div>
        <TrendChart trend={selected} keyName={trendKey} />
      </section>

      <section className="health-domain-grid">
        <DomainDoor
          title="Recovery"
          value={
            readiness.hasData
              ? `${readiness.score} · ${readiness.title}`
              : trendValue(trends.hrv, 'hrv')
          }
          onClick={() => onDomain('recovery')}
        />
        <DomainDoor
          title="Capacity"
          value={trendValue(trends.vo2, 'vo2')}
          onClick={() => onDomain('capacity')}
        />
        <DomainDoor
          title="Training load"
          value={load.hasData ? `${loadZone(load.zone)} · form ${signedNumber(load.form)}` : 'Building'}
          onClick={() => onDomain('load')}
        />
        <DomainDoor
          title="Movement"
          value={trendValue(trends.steps, 'steps')}
          onClick={() => onDomain('movement')}
        />
      </section>
    </div>
  )
}

function Recovery({
  readiness,
  trends,
}: {
  readiness: ReadinessSnapshot
  trends: TrendSet
}) {
  return (
    <div className="health-insights__stack">
      <ReadinessCard readiness={readiness} />
      <section className="health-card">
        <CardHeading eyebrow="Heart" title="Recovery signals" source="Apple Health sync" />
        <div className="health-metric-list">
          <TrendMetricCard
            label="Resting heart rate"
            trend={trends.rhr}
            format={(value) => `${Math.round(value)} bpm`}
            lowerBetter
          />
          <TrendMetricCard
            label="Heart-rate variability"
            trend={trends.hrv}
            format={(value) => `${Math.round(value)} ms`}
          />
          <TrendMetricCard
            label="Walking heart rate"
            trend={trends.walkingHR}
            format={(value) => `${Math.round(value)} bpm`}
            lowerBetter
          />
        </div>
      </section>
      <div className="health-insights__overview-grid">
        <section className="health-card">
          <CardHeading eyebrow="Sleep" title="Nightly recovery" source="Apple Health sync" />
          <TrendMetricCard
            label="Sleep duration"
            trend={trends.sleep}
            format={(value) => `${value.toFixed(1)} h/night`}
          />
        </section>
        <section className="health-card">
          <CardHeading eyebrow="Stability" title="Vitals versus your norm" source="Apple Health sync" />
          <div className="health-stat-grid">
            <MiniStat
              label="Respiratory"
              value={trendValue(trends.respiratory, 'respiratory')}
            />
            <MiniStat
              label="Blood oxygen"
              value={trendValue(trends.oxygen, 'oxygen')}
            />
          </div>
          <p className="health-card__note">
            Stability matters more than direction for respiratory rate and oxygen saturation.
          </p>
        </section>
      </div>
    </div>
  )
}

function Capacity({
  trends,
  workouts,
  end,
}: {
  trends: TrendSet
  workouts: WorkoutSession[]
  end: Date
}) {
  const recentVO2 = trends.vo2.points.at(-1)
  const recovery = workouts
    .filter((workout) => (workout.heartRateRecoveryOneMinute ?? 0) > 0)
    .slice(0, 6)
  const week = periodWorkoutSummary(workouts, 7, end)
  const prior = periodWorkoutSummary(
    workouts.filter((workout) => workout.startDate < addDays(end, -7)),
    21,
    addDays(end, -7)
  )
  return (
    <div className="health-insights__stack">
      <section className="health-card health-card--hero">
        <CardHeading eyebrow="Aerobic capacity" title="Cardio fitness" source="Apple Health sync" />
        <div className="health-capacity-value">
          <b>{recentVO2 ? recentVO2.value.toFixed(1) : '—'}</b>
          <span>ml/kg/min</span>
          {trends.vo2.percentDelta != null && (
            <i>{signedPercent(trends.vo2.percentDelta)} vs baseline</i>
          )}
        </div>
        <TrendChart trend={trends.vo2} keyName="vo2" />
      </section>
      <div className="health-insights__overview-grid">
        <section className="health-card">
          <CardHeading eyebrow="Volume" title="Current training capacity" source="StatsKey" />
          <div className="health-stat-grid">
            <MiniStat label="Sessions" value={`${week.count}`} />
            <MiniStat label="Hours" value={week.hours.toFixed(1)} />
            <MiniStat label="Distance" value={`${week.distance.toFixed(1)} mi`} />
            <MiniStat
              label="Prior 3-week avg"
              value={`${(prior.hours / 3).toFixed(1)} h`}
            />
          </div>
        </section>
        <section className="health-card">
          <CardHeading eyebrow="Cardio recovery" title="One-minute heart-rate drop" source="Apple Health sync" />
          {recovery.length === 0 ? (
            <EmptyCopy text="No synced cardio-recovery samples yet." />
          ) : (
            <div className="health-capacity-value health-capacity-value--small">
              <b>{Math.round(recovery[0].heartRateRecoveryOneMinute ?? 0)}</b>
              <span>bpm latest</span>
              <i>
                typical{' '}
                {Math.round(
                  recovery.reduce(
                    (sum, workout) =>
                      sum + (workout.heartRateRecoveryOneMinute ?? 0),
                    0
                  ) / recovery.length
                )}{' '}
                bpm
              </i>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Load({
  load,
  workouts,
  end,
}: {
  load: ReturnType<typeof trainingLoadSnapshot>
  workouts: WorkoutSession[]
  end: Date
}) {
  const week = periodWorkoutSummary(workouts, 7, end)
  return (
    <div className="health-insights__stack">
      <section className="health-card">
        <CardHeading eyebrow="Training load" title={loadZone(load.zone)} source="StatsKey" />
        <div className="health-load-grid">
          <LoadStat label="Fitness" value={load.fitness} tone="teal" />
          <LoadStat label="Fatigue" value={load.fatigue} tone="orange" />
          <LoadStat label="Form" value={load.form} tone={load.form >= 0 ? 'green' : 'violet'} signed />
          <LoadStat label="ACWR" value={load.acwr} tone={load.zone === 'highRisk' ? 'red' : 'blue'} decimals={2} />
        </div>
        {load.hasData ? (
          <LineChart
            points={chartPoints(load.fitnessSeries.slice(-84))}
            color="#18A999"
            height={180}
            formatValue={(value) => value.toFixed(1)}
          />
        ) : (
          <EmptyCopy text="Record more workouts to build fitness, fatigue, form, and ramping context." />
        )}
        <p className="health-card__note">
          Impulse-response model of recorded sessions. ACWR is ramping guidance, not an injury prediction.
        </p>
      </section>
      <section className="health-card">
        <CardHeading eyebrow="Last seven days" title={`${week.count} sessions · ${week.hours.toFixed(1)} hours`} source="StatsKey" />
        <div className="health-stat-grid">
          <MiniStat label="Load" value={`${Math.round(week.load)}`} />
          <MiniStat label="Distance" value={`${week.distance.toFixed(1)} mi`} />
          <MiniStat label="Elevation" value={`${Math.round(week.elevation)} ft`} />
          <MiniStat label="Active days" value={`${week.activeDays}`} />
        </div>
      </section>
    </div>
  )
}

function Movement({
  trends,
  days,
}: {
  trends: TrendSet
  days: HealthDaily[]
}) {
  return (
    <div className="health-insights__stack">
      <section className="health-card">
        <CardHeading eyebrow="Movement" title="Worn-day averages" source="Apple Health sync" />
        <div className="health-metric-list">
          <TrendMetricCard
            label="Steps"
            trend={trends.steps}
            format={(value) => `${Math.round(value).toLocaleString()} / day`}
          />
          <TrendMetricCard
            label="Exercise minutes"
            trend={trends.exercise}
            format={(value) => `${Math.round(value)} min / day`}
          />
          <TrendMetricCard
            label="Active energy"
            trend={trends.activeEnergy}
            format={(value) => `${Math.round(value)} kcal / day`}
          />
        </div>
      </section>
      <div className="health-insights__overview-grid">
        <section className="health-card">
          <CardHeading eyebrow="Steps" title="Daily movement" source="Apple Health sync" />
          <BarChart
            data={days.map((day) => ({
              label: shortLabel(day.date),
              value: day.steps,
            }))}
            color="#4C9AFF"
            height={150}
            formatValue={(value) => `${Math.round(value).toLocaleString()} steps`}
          />
        </section>
        <section className="health-card">
          <CardHeading eyebrow="Sleep" title="Nightly duration" source="Apple Health sync" />
          <BarChart
            data={days.map((day) => ({
              label: shortLabel(day.date),
              value: day.sleepHours,
            }))}
            color="#748FFC"
            target={8}
            height={150}
            formatValue={(value) => `${value.toFixed(1)} h`}
          />
        </section>
      </div>
    </div>
  )
}

function Nutrition({
  meals,
  water,
  weights,
  targets,
  start,
  end,
}: {
  meals: Meal[]
  water: Array<{ amount: number; date: Date }>
  weights: Array<{ weightLbs: number; date: Date }>
  targets: {
    calories: number
    protein: number
    carbs: number
    fat: number
    fiber: number
    water: number
  }
  start: Date
  end: Date
}) {
  const buckets = bucketMealsByDay(meals, start, end)
  const withMeals = buckets.filter((bucket) => bucket.meals.length > 0)
  const averages =
    withMeals.length > 0
      ? withMeals.reduce(
          (sum, bucket) => {
            const totals = dailyTotals(bucket.meals)
            sum.calories += totals.calories
            sum.protein += totals.protein
            sum.carbs += totals.carbs
            sum.fat += totals.fat
            sum.fiber += totals.fiber
            return sum
          },
          { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
        )
      : null
  if (averages) {
    for (const key of Object.keys(averages) as Array<keyof typeof averages>) {
      averages[key] /= withMeals.length
    }
  }
  const waterAverage =
    water.length > 0
      ? water.reduce((sum, day) => sum + day.amount, 0) / water.length
      : null
  return (
    <div className="health-insights__stack">
      <section className="health-card">
        <CardHeading eyebrow="Nutrition" title="Daily averages" source="StatsKey" />
        {!averages ? (
          <EmptyCopy text="No meals recorded in this period." />
        ) : (
          <div className="health-stat-grid health-stat-grid--five">
            <TargetStat label="Calories" value={averages.calories} target={targets.calories} />
            <TargetStat label="Protein" value={averages.protein} target={targets.protein} unit="g" />
            <TargetStat label="Carbs" value={averages.carbs} target={targets.carbs} unit="g" />
            <TargetStat label="Fat" value={averages.fat} target={targets.fat} unit="g" />
            <TargetStat label="Fiber" value={averages.fiber} target={targets.fiber} unit="g" />
          </div>
        )}
      </section>
      <div className="health-insights__overview-grid">
        <section className="health-card">
          <CardHeading eyebrow="Energy" title="Calories by day" source="StatsKey" />
          <BarChart
            data={buckets.map((bucket) => ({
              label: bucket.label,
              value: dailyTotals(bucket.meals).calories,
            }))}
            target={targets.calories}
            color="#FF9F43"
            formatValue={(value) => `${Math.round(value)} cal`}
          />
        </section>
        <section className="health-card">
          <CardHeading
            eyebrow="Hydration"
            title={waterAverage == null ? 'Water' : `${Math.round(waterAverage)} fl oz / day`}
            source="StatsKey"
          />
          <BarChart
            data={fillDays(start, end).map((day) => ({
              label: shortLabel(day),
              value:
                water.find(
                  (entry) =>
                    localDateString(entry.date) === localDateString(day)
                )?.amount ?? 0,
            }))}
            target={targets.water}
            color="#22B8CF"
            formatValue={(value) => `${Math.round(value)} fl oz`}
          />
        </section>
      </div>
      <section className="health-card">
        <CardHeading eyebrow="Body composition" title="Weight trend" source="StatsKey + Apple Health" />
        {weights.length === 0 ? (
          <EmptyCopy text="No weight entries in this period." />
        ) : (
          <LineChart
            points={chartPoints(
              [...weights]
                .sort((a, b) => a.date.getTime() - b.date.getTime())
                .map((weight) => ({ date: weight.date, value: weight.weightLbs }))
            )}
            color="#8B5CF6"
            formatValue={(value) => `${value.toFixed(1)} lb`}
          />
        )}
      </section>
    </div>
  )
}

function Wellness({ entries }: { entries: WellnessEntry[] }) {
  const mood = entries
    .filter((entry) => entry.data.kind === 'mood')
    .map((entry) => entry.data.kind === 'mood' ? entry.data.entry.rating : 0)
  const stress = entries
    .filter((entry) => entry.data.kind === 'mood' && entry.data.entry.stress != null)
    .map((entry) => entry.data.kind === 'mood' ? entry.data.entry.stress ?? 0 : 0)
  const energy = entries
    .filter((entry) => entry.data.kind === 'energy')
    .map((entry) => entry.data.kind === 'energy' ? entry.data.entry.level : 0)
  const bowel = entries.filter((entry) => entry.data.kind === 'bowelMovement')
  const burdens = bowel
    .map((entry) =>
      entry.data.kind === 'bowelMovement'
        ? entry.data.entry.giBurdenScore
        : undefined
    )
    .filter((value): value is number => value != null)
  const symptoms = entries.filter((entry) => entry.data.kind === 'symptom')
  const topSymptoms = [...new Set(
    symptoms.map((entry) =>
      entry.data.kind === 'symptom' ? entry.data.entry.symptom : ''
    )
  )].filter(Boolean).slice(0, 5)
  return (
    <div className="health-insights__stack">
      <section className="health-card">
        <CardHeading eyebrow="Wellness" title="How you felt" source="StatsKey" />
        <div className="health-stat-grid">
          <MiniStat label="Mood" value={mood.length ? `${mean(mood).toFixed(1)} / 5` : '—'} />
          <MiniStat label="Energy" value={energy.length ? `${mean(energy).toFixed(1)} / 5` : '—'} />
          <MiniStat label="Stress" value={stress.length ? `${mean(stress).toFixed(1)} / 10` : '—'} />
          <MiniStat label="Check-ins" value={`${entries.length}`} />
        </div>
      </section>
      <div className="health-insights__overview-grid">
        <section className="health-card">
          <CardHeading eyebrow="GI & digestion" title={`${bowel.length} recorded episodes`} source="StatsKey" />
          <div className="health-stat-grid">
            <MiniStat
              label="Avg burden"
              value={burdens.length ? `${mean(burdens).toFixed(1)} / 10` : '—'}
            />
            <MiniStat
              label="Flagged"
              value={`${bowel.filter((entry) => entry.data.kind === 'bowelMovement' && entry.data.entry.redFlags.length > 0).length}`}
            />
          </div>
          <p className="health-card__note">
            Bristol type alone is not treated as a readiness or medical verdict.
          </p>
        </section>
        <section className="health-card">
          <CardHeading eyebrow="Symptoms" title={`${symptoms.length} entries`} source="StatsKey" />
          {topSymptoms.length === 0 ? (
            <EmptyCopy text="No symptoms recorded in this period." />
          ) : (
            <div className="health-chip-list">
              {topSymptoms.map((symptom) => <span key={symptom}>{symptom}</span>)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Glucose({
  readings,
  loading,
}: {
  readings: GlucoseReading[]
  loading: boolean
}) {
  const stats = glucoseStats(readings)
  return (
    <section className="health-card">
      <CardHeading eyebrow="Glucose" title="CGM response" source="Connected source" />
      {loading ? (
        <EmptyCopy text="Loading glucose…" />
      ) : readings.length === 0 ? (
        <EmptyCopy text="No glucose readings in this period. Connect a CGM in the iOS app or record one manually." />
      ) : (
        <>
          <LineChart
            points={chartPoints(readings.map((reading) => ({
              date: reading.timestamp,
              value: reading.value,
            })))}
            bandLow={70}
            bandHigh={180}
            color="#30D5C8"
            height={220}
            formatValue={(value) => `${Math.round(value)} mg/dL`}
          />
          {stats && (
            <div className="health-stat-grid">
              <MiniStat label="Average" value={`${Math.round(stats.average)}`} />
              <MiniStat label="Range" value={`${Math.round(stats.min)}–${Math.round(stats.max)}`} />
              <MiniStat label="In range" value={`${Math.round(stats.timeInRangePercent)}%`} />
              <MiniStat label="Readings" value={`${stats.count}`} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

type TrendSet = {
  rhr: MetricTrend
  hrv: MetricTrend
  walkingHR: MetricTrend
  respiratory: MetricTrend
  oxygen: MetricTrend
  vo2: MetricTrend
  steps: MetricTrend
  exercise: MetricTrend
  activeEnergy: MetricTrend
  sleep: MetricTrend
}

function ReadinessCard({ readiness }: { readiness: ReadinessSnapshot }) {
  if (!readiness.hasData) {
    return (
      <section className="health-card health-readiness" data-band="building">
        <div>
          <span>Readiness</span>
          <b>—</b>
        </div>
        <div>
          <h2>Personal baseline building</h2>
          <p>{readiness.headline}</p>
        </div>
      </section>
    )
  }
  return (
    <section className="health-card health-readiness" data-band={readiness.band}>
      <div>
        <span>Readiness</span>
        <b>{readiness.score}</b>
        <small>of 100</small>
      </div>
      <div>
        <h2>{readiness.title}</h2>
        <p>{readiness.headline}</p>
        <div className="health-readiness__pillars">
          {readiness.pillars.map((pillar) => (
            <div key={pillar.id}>
              <span>{pillar.name}</span>
              <b>{Math.round(pillar.score)}</b>
              <i style={{ width: `${pillar.score}%` }} />
              <small>{pillar.detail}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function TrendMetricCard({
  label,
  trend,
  format,
  lowerBetter = false,
}: {
  label: string
  trend: MetricTrend
  format: (value: number) => string
  lowerBetter?: boolean
}) {
  const favorable =
    trend.delta != null && (lowerBetter ? trend.delta < 0 : trend.delta > 0)
  return (
    <div className="health-trend-metric">
      <div>
        <span>{label}</span>
        <b>{trend.recent == null ? 'Building' : format(trend.recent)}</b>
        {trend.percentDelta != null && (
          <i data-tone={Math.abs(trend.percentDelta) < 3 ? 'neutral' : favorable ? 'good' : 'watch'}>
            {signedPercent(trend.percentDelta)}
          </i>
        )}
      </div>
      {trend.points.length >= 3 && (
        <LineChart
          points={chartPoints(trend.points)}
          height={64}
          baseline={trend.baseline ?? undefined}
          formatValue={format}
        />
      )}
    </div>
  )
}

function TrendChart({ trend, keyName }: { trend: MetricTrend; keyName: TrendKey | 'vo2' }) {
  if (trend.points.length < 2) return <EmptyCopy text="Not enough synced days for this trend." />
  return (
    <>
      <div className="health-trend-headline">
        <b>{trend.recent == null ? 'Building' : trendValue(trend, keyName)}</b>
        <span>14-day mean</span>
        {trend.percentDelta != null && <i>{signedPercent(trend.percentDelta)} vs baseline</i>}
      </div>
      <LineChart
        points={chartPoints(trend.points)}
        height={190}
        baseline={trend.baseline ?? undefined}
        formatValue={(value) => formatTrendValue(value, keyName)}
      />
      <p className="health-card__note">
        Recent is a 14-day daily mean; baseline is the preceding {trend.baselineDays} days. Missing wear days are excluded.
      </p>
    </>
  )
}

function CardHeading({
  eyebrow,
  title,
  source,
}: {
  eyebrow: string
  title: string
  source: string
}) {
  return (
    <header className="health-card__heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <small>{source}</small>
    </header>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="health-mini-stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function TargetStat({
  label,
  value,
  target,
  unit = '',
}: {
  label: string
  value: number
  target: number
  unit?: string
}) {
  const percent = target > 0 ? Math.round((value / target) * 100) : null
  return (
    <div className="health-mini-stat">
      <span>{label}</span>
      <b>{Math.round(value)}{unit}</b>
      {percent != null && <small>{percent}% of target</small>}
    </div>
  )
}

function LoadStat({
  label,
  value,
  tone,
  decimals = 0,
  signed = false,
}: {
  label: string
  value: number
  tone: string
  decimals?: number
  signed?: boolean
}) {
  return (
    <div className="health-load-stat" data-tone={tone}>
      <b>{signed ? signedNumber(value) : value.toFixed(decimals)}</b>
      <span>{label}</span>
    </div>
  )
}

function DomainDoor({
  title,
  value,
  onClick,
}: {
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <button className="health-domain-door" onClick={onClick}>
      <span>{title}</span>
      <b>{value}</b>
      <i>→</i>
    </button>
  )
}

function EmptyCopy({ text }: { text: string }) {
  return <p className="health-empty-copy">{text}</p>
}

function rankedHighlights(trends: TrendSet) {
  const definitions = [
    ['rhr', 'Resting heart rate', trends.rhr, 'rhr'],
    ['hrv', 'Heart-rate variability', trends.hrv, 'hrv'],
    ['walking', 'Walking heart rate', trends.walkingHR, 'walkingHR'],
    ['steps', 'Steps', trends.steps, 'steps'],
    ['sleep', 'Sleep duration', trends.sleep, 'sleep'],
    ['respiratory', 'Respiratory rate', trends.respiratory, 'respiratory'],
  ] as const
  return definitions
    .filter(([, , trend]) => trend.percentDelta != null && trend.recent != null)
    .map(([key, label, trend, format]) => {
      const percent = trend.percentDelta!
      const lowerBetter = key === 'rhr' || key === 'walking'
      const favorable = lowerBetter ? percent < 0 : percent > 0
      return {
        key,
        label,
        value: formatTrendValue(trend.recent!, format),
        percent,
        tone: Math.abs(percent) < 3 ? 'neutral' : favorable ? 'good' : 'watch',
      }
    })
    .sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent))
    .slice(0, 3)
}

function periodWorkoutSummary(
  workouts: WorkoutSession[],
  days: number,
  reference = new Date()
) {
  const cutoff = addDays(reference, -days)
  const scoped = workouts.filter(
    (workout) => workout.startDate >= cutoff && workout.startDate <= reference
  )
  return {
    count: scoped.length,
    activeDays: new Set(scoped.map((workout) => localDateString(workout.startDate))).size,
    hours: scoped.reduce((sum, workout) => sum + workout.duration, 0) / 3600,
    distance: scoped.reduce((sum, workout) => sum + workout.distance, 0),
    elevation: scoped.reduce((sum, workout) => sum + workout.elevationGain, 0),
    load: scoped.reduce((sum, workout) => sum + workout.relativeEffort, 0),
  }
}

function trendName(key: TrendKey): string {
  return {
    rhr: 'Resting HR',
    hrv: 'HRV',
    steps: 'Steps',
    sleep: 'Sleep',
  }[key]
}

function trendValue(
  trend: MetricTrend,
  key: TrendKey | 'vo2' | 'walkingHR' | 'respiratory' | 'oxygen'
): string {
  return trend.recent == null
    ? 'Building baseline'
    : formatTrendValue(trend.recent, key)
}

function formatTrendValue(
  value: number,
  key: TrendKey | 'vo2' | 'walkingHR' | 'respiratory' | 'oxygen'
): string {
  switch (key) {
    case 'rhr':
    case 'walkingHR':
      return `${Math.round(value)} bpm`
    case 'hrv':
      return `${Math.round(value)} ms`
    case 'steps':
      return `${Math.round(value).toLocaleString()} steps/day`
    case 'sleep':
      return `${value.toFixed(1)} h/night`
    case 'vo2':
      return `${value.toFixed(1)} ml/kg/min`
    case 'respiratory':
      return `${value.toFixed(1)} br/min`
    case 'oxygen':
      return `${value.toFixed(1)}%`
  }
}

function chartPoints(points: Array<{ date: Date; value: number }>) {
  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime())
  const first = sorted[0]?.date.getTime() ?? 0
  const last = sorted.at(-1)?.date.getTime() ?? first
  const span = Math.max(1, last - first)
  return sorted.map((point) => ({
    x: (point.date.getTime() - first) / span,
    y: point.value,
    label: shortLabel(point.date),
  }))
}

function loadZone(zone: ReturnType<typeof trainingLoadSnapshot>['zone']): string {
  return {
    insufficient: 'Building load history',
    detraining: 'Below recent load',
    optimal: 'Productive range',
    caution: 'Ramping quickly',
    highRisk: 'Load spike',
  }[zone]
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(0)}%`
}

function signedNumber(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)}`
}

function fillDays(start: Date, end: Date): Date[] {
  const days: Date[] = []
  for (let day = startOfDay(start); day <= end; day = addDays(day, 1)) {
    days.push(day)
  }
  return days
}

function bucketMealsByDay(meals: Meal[], start: Date, end: Date) {
  const grouped = new Map<string, Meal[]>()
  for (const meal of meals) {
    const key = localDateString(meal.date)
    grouped.set(key, [...(grouped.get(key) ?? []), meal])
  }
  return fillDays(start, end).map((date) => ({
    label: shortLabel(date),
    meals: grouped.get(localDateString(date)) ?? [],
  }))
}

function shortLabel(date: Date): string {
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
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
