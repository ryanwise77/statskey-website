import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useTodayMeals } from '../lib/data/useTodayMeals'
import { useTodayWater } from '../lib/data/useTodayWater'
import { useMacroTargets } from '../lib/data/useMacroTargets'
import { useTodayWellness } from '../lib/data/useTodayWellness'
import { useRecentWorkouts } from '../lib/data/useRecentWorkouts'
import { useLatestGlucose } from '../lib/data/useLatestGlucose'
import { useHealthDailyForDay } from '../lib/data/useHealthDaily'
import { dailyTotals } from '../lib/aggregates'
import { addWaterOz } from '../lib/writers'
import { MacroCard } from '../components/MacroCard'
import { WaterCard } from '../components/WaterCard'
import { FiberCard } from '../components/FiberCard'
import { GlucoseCard } from '../components/GlucoseCard'
import { MealTimelineRow, WellnessTimelineRow } from '../components/TimelineRow'
import { WorkoutCard } from '../components/WorkoutCard'
import { EmptyState } from '../components/EmptyState'
import { ActivityCard } from '../components/ActivityCard'

export function Dashboard() {
  const { user, profile } = useAuth()
  const uid = user?.uid

  const mealsState = useTodayMeals(uid)
  const waterState = useTodayWater(uid)
  const targetsState = useMacroTargets(uid)
  const wellnessState = useTodayWellness(uid)
  const workoutsState = useRecentWorkouts(uid, 5)
  const glucoseState = useLatestGlucose(uid)
  const todayDate = useMemo(() => new Date(), [])
  const healthState = useHealthDailyForDay(uid, todayDate)
  const [showSensitiveTimelineDetails, setShowSensitiveTimelineDetails] = useState(false)

  const totals = useMemo(() => dailyTotals(mealsState.meals), [mealsState.meals])

  const timeline = useMemo(() => {
    type Item =
      | { kind: 'meal'; date: Date; id: string; meal: typeof mealsState.meals[number] }
      | { kind: 'wellness'; date: Date; id: string; entry: typeof wellnessState.entries[number] }
    const items: Item[] = []
    for (const m of mealsState.meals) items.push({ kind: 'meal', date: m.date, id: m.id, meal: m })
    for (const w of wellnessState.entries) items.push({ kind: 'wellness', date: w.date, id: w.id, entry: w })
    items.sort((a, b) => b.date.getTime() - a.date.getTime())
    return items
  }, [mealsState.meals, wellnessState.entries])

  const firstName = profile?.name?.split(' ')[0]
  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">
            {firstName ? `Hello, ${firstName}` : 'Today'}
          </h1>
          <p className="text-text-secondary text-[14px] mt-1">{today}</p>
        </div>
        <Link to="/record" className="btn btn-primary">+ Log</Link>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <MacroCard
            totals={totals}
            targets={targetsState.targets}
            mealsCount={mealsState.meals.length}
          />
        </div>
        <div className="grid grid-rows-[auto_auto] gap-4">
          <WaterCard
            amountOz={waterState.water?.amount ?? 0}
            targetOz={targetsState.targets.water}
            onAdd={uid ? (oz) => addWaterOz(uid, oz) : undefined}
          />
          <FiberCard amount={totals.fiber} target={targetsState.targets.fiber} />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <ActivityCard health={healthState.health} exists={healthState.exists} />
        </div>
        {glucoseState.reading && <GlucoseCard reading={glucoseState.reading} />}
      </div>

      <section className="panel">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h2 className="card-title">Today's timeline</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="link text-[12px]"
              onClick={() => setShowSensitiveTimelineDetails((show) => !show)}
            >
              {showSensitiveTimelineDetails ? 'Hide private details' : 'Show private details'}
            </button>
            <Link to="/history" className="link text-[12px]">View history →</Link>
          </div>
        </div>
        {mealsState.loading || wellnessState.loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : timeline.length === 0 ? (
          <EmptyState
            title="Nothing logged yet today"
            subtitle="Meals and wellness entries will show up here as you log them on iOS."
          />
        ) : (
          <div className="timeline">
            {timeline.map((item) =>
              item.kind === 'meal' ? (
                <MealTimelineRow key={`m-${item.id}`} meal={item.meal} />
              ) : (
                <WellnessTimelineRow
                  key={`w-${item.id}`}
                  entry={item.entry}
                  concealSensitive={!showSensitiveTimelineDetails}
                />
              )
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="card-title">Recent workouts</h2>
          <Link to="/history" className="link text-[12px]">All →</Link>
        </div>
        {workoutsState.loading ? (
          <div className="panel">
            <p className="text-text-muted text-[13px]">Loading…</p>
          </div>
        ) : workoutsState.workouts.length === 0 ? (
          <div className="panel">
            <EmptyState
              title="No workouts yet"
              subtitle="Runs, rides, and other sessions you log on iOS appear here."
            />
          </div>
        ) : (
          workoutsState.workouts.map((w) => <WorkoutCard key={w.id} workout={w} />)
        )}
      </section>
    </div>
  )
}
