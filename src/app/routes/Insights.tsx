import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useMealsHistory } from '../lib/data/useHistory'
import { useMacroTargets } from '../lib/data/useMacroTargets'
import { useWaterRange } from '../lib/data/useWaterRange'
import { useWeights } from '../lib/data/useWeights'
import { useGlucoseRange, glucoseStats } from '../lib/data/useGlucoseRange'
import { addDays, localDateString } from '../lib/firestore'
import { dailyTotals, mealTotal } from '../lib/aggregates'
import { NUTRIENT_KEYS, type Meal } from '../lib/types'
import { BarChart, LineChart } from '../components/SimpleCharts'

type Range = 7 | 30 | 90

export function Insights() {
  const { user } = useAuth()
  const uid = user?.uid
  const [range, setRange] = useState<Range>(7)
  const [includeToday, setIncludeToday] = useState(true)

  const { start, end } = useMemo(() => {
    const e = includeToday ? new Date() : addDays(new Date(), -1)
    return { start: addDays(e, -(range - 1)), end: e }
  }, [range, includeToday])

  const mealsState = useMealsHistory(uid, start, end)
  const targetsState = useMacroTargets(uid)
  const waterState = useWaterRange(uid, start, end)
  const weightsState = useWeights(uid, start, end)

  const dayBuckets = useMemo(() => bucketMealsByDay(mealsState.meals, start, end), [mealsState.meals, start, end])

  const averages = useMemo(() => {
    const daysWithData = dayBuckets.filter((d) => d.meals.length > 0)
    if (daysWithData.length === 0) return null
    const sum = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    for (const d of daysWithData) {
      const t = dailyTotals(d.meals)
      sum.calories += t.calories
      sum.protein += t.protein
      sum.carbs += t.carbs
      sum.fat += t.fat
      sum.fiber += t.fiber
    }
    const n = daysWithData.length
    return {
      days: n,
      calories: sum.calories / n,
      protein: sum.protein / n,
      carbs: sum.carbs / n,
      fat: sum.fat / n,
      fiber: sum.fiber / n,
    }
  }, [dayBuckets])

  const waterAvg = useMemo(() => {
    const days = waterState.days.filter((d) => d.amount > 0)
    if (days.length === 0) return null
    return days.reduce((s, d) => s + d.amount, 0) / days.length
  }, [waterState.days])

  const targets = targetsState.targets

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Insights</h1>
          <p className="text-text-secondary text-[14px] mt-1">
            Averages and trends from everything you've recorded.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              checked={includeToday}
              onChange={(e) => setIncludeToday(e.target.checked)}
            />
            Include today
          </label>
          <div className="tab-strip">
            {([7, 30, 90] as Range[]).map((r) => (
              <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                {r}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="panel">
        <div className="flex items-baseline justify-between">
          <h2 className="card-title">Daily averages</h2>
          {averages && <span className="card-subtext">{averages.days} days with recorded meals</span>}
        </div>
        {mealsState.loading ? (
          <p className="text-text-muted text-[13px] mt-3">Loading…</p>
        ) : !averages ? (
          <p className="text-text-muted text-[13px] mt-3">No meals recorded in this range yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 text-center">
            <AvgStat label="Calories" value={Math.round(averages.calories)} target={targets.calories} />
            <AvgStat label="Protein" value={Math.round(averages.protein)} target={targets.protein} unit="g" />
            <AvgStat label="Carbs" value={Math.round(averages.carbs)} target={targets.carbs} unit="g" />
            <AvgStat label="Fat" value={Math.round(averages.fat)} target={targets.fat} unit="g" />
            <AvgStat label="Fiber" value={Math.round(averages.fiber)} target={targets.fiber} unit="g" />
          </div>
        )}
      </section>

      <section className="panel">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="card-title">Calories by day</h2>
          <span className="card-subtext">Dashed line = target ({Math.round(targets.calories)})</span>
        </div>
        <BarChart
          data={dayBuckets.map((d) => ({
            label: d.label,
            value: Math.round(dailyTotals(d.meals).calories),
          }))}
          target={targets.calories}
          formatValue={(v) => `${Math.round(v)} cal`}
        />
      </section>

      <section className="panel">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="card-title">Protein by day</h2>
          <span className="card-subtext">Dashed line = target ({Math.round(targets.protein)}g)</span>
        </div>
        <BarChart
          data={dayBuckets.map((d) => ({
            label: d.label,
            value: Math.round(
              d.meals.reduce((s, m) => s + mealTotal(m, NUTRIENT_KEYS.protein), 0)
            ),
          }))}
          target={targets.protein}
          color="#B5A0E8"
          formatValue={(v) => `${Math.round(v)}g protein`}
        />
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="panel">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="card-title">Water</h2>
            {waterAvg != null && (
              <span className="card-subtext">avg {Math.round(waterAvg)} fl oz / day</span>
            )}
          </div>
          <BarChart
            data={fillDays(start, end).map((day) => {
              const match = waterState.days.find((d) => localDateString(d.date) === localDateString(day))
              return { label: shortLabel(day), value: Math.round(match?.amount ?? 0) }
            })}
            target={targets.water}
            color="#22B8CF"
            height={120}
            formatValue={(v) => `${Math.round(v)} fl oz`}
          />
        </section>

        <section className="panel">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="card-title">Weight</h2>
            {weightsState.weights.length > 0 && (
              <span className="card-subtext">
                latest {weightsState.weights[0].weightLbs.toFixed(1)} lb
              </span>
            )}
          </div>
          {weightsState.weights.length === 0 ? (
            <p className="text-text-muted text-[13px]">
              No weight entries in this range.{' '}
              <Link className="link" to="/record?tab=weight">Record weight →</Link>
            </p>
          ) : (
            <LineChart
              points={[...weightsState.weights]
                .sort((a, b) => a.date.getTime() - b.date.getTime())
                .map((w, i, arr) => ({
                  x: arr.length === 1 ? 0.5 : i / (arr.length - 1),
                  y: w.weightLbs,
                  label: shortLabel(w.date),
                }))}
              color="#8B5CF6"
              height={120}
              formatValue={(v) => `${v.toFixed(1)} lb`}
            />
          )}
        </section>
      </div>

      <GlucoseSection uid={uid} />
    </div>
  )
}

function GlucoseSection({ uid }: { uid?: string }) {
  const [day, setDay] = useState(new Date())
  const { readings, loading } = useGlucoseRange(uid, day, day)
  const stats = glucoseStats(readings)
  const isToday = localDateString(day) === localDateString(new Date())

  function shift(delta: number) {
    const next = new Date(day)
    next.setDate(next.getDate() + delta)
    setDay(next)
  }

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="card-title">
          Glucose — {isToday ? 'Today' : day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
        </h2>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary !px-3 !py-1" onClick={() => shift(-1)}>←</button>
          <button className="btn btn-secondary !px-3 !py-1" onClick={() => shift(1)} disabled={isToday}>→</button>
        </div>
      </div>

      {loading ? (
        <p className="text-text-muted text-[13px]">Loading…</p>
      ) : readings.length === 0 ? (
        <p className="text-text-muted text-[13px]">
          No readings this day. Connect a CGM in the iOS app or{' '}
          <Link className="link" to="/record?tab=glucose">record one manually</Link>.
        </p>
      ) : (
        <>
          <LineChart
            points={readings.map((r) => ({
              x: fractionOfDay(r.timestamp),
              y: r.value,
              label: r.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            }))}
            bandLow={70}
            bandHigh={180}
            color="#30D5C8"
            height={160}
            formatValue={(v) => `${Math.round(v)} mg/dL`}
          />
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-center">
              <div>
                <div className="card-subtext">Average</div>
                <div className="card-number card-number-md mt-1">{Math.round(stats.average)}</div>
              </div>
              <div>
                <div className="card-subtext">Range</div>
                <div className="card-number card-number-md mt-1">
                  {Math.round(stats.min)}–{Math.round(stats.max)}
                </div>
              </div>
              <div>
                <div className="card-subtext">In range (70–180)</div>
                <div className="card-number card-number-md mt-1">{Math.round(stats.timeInRangePercent)}%</div>
              </div>
              <div>
                <div className="card-subtext">Readings</div>
                <div className="card-number card-number-md mt-1">{stats.count}</div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function AvgStat({
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
  const pct = target > 0 ? Math.round((value / target) * 100) : null
  return (
    <div>
      <div className="card-subtext">{label}</div>
      <div className="card-number card-number-md mt-1">
        {value}
        {unit}
      </div>
      {pct != null && <div className="card-subtext mt-0.5">{pct}% of target</div>}
    </div>
  )
}

interface DayBucket {
  label: string
  meals: Meal[]
}

function fillDays(start: Date, end: Date): Date[] {
  const days: Date[] = []
  const cursor = new Date(start)
  cursor.setHours(12, 0, 0, 0)
  const endKey = localDateString(end)
  while (localDateString(cursor) <= endKey) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

function bucketMealsByDay(meals: Meal[], start: Date, end: Date): DayBucket[] {
  const byKey = new Map<string, Meal[]>()
  for (const m of meals) {
    const key = localDateString(m.date)
    const arr = byKey.get(key)
    if (arr) arr.push(m)
    else byKey.set(key, [m])
  }
  return fillDays(start, end).map((day) => ({
    label: shortLabel(day),
    meals: byKey.get(localDateString(day)) ?? [],
  }))
}

function fractionOfDay(d: Date): number {
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400
}
