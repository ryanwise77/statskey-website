import { useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import {
  useMealsHistory,
  useWellnessHistory,
  useWorkoutsHistory,
} from '../lib/data/useHistory'
import { addDays } from '../lib/firestore'
import { dailyTotals } from '../lib/aggregates'
import { MealTimelineRow, WellnessTimelineRow } from '../components/TimelineRow'
import { WorkoutCard } from '../components/WorkoutCard'
import { EmptyState } from '../components/EmptyState'
import type { Meal, WellnessEntry } from '../lib/types'

type Tab = 'meals' | 'workouts' | 'wellness'
type Range = 7 | 30 | 90

export function History() {
  const { user } = useAuth()
  const uid = user?.uid
  const [tab, setTab] = useState<Tab>('meals')
  const [range, setRange] = useState<Range>(7)

  const { start, end } = useMemo(() => {
    const e = new Date()
    const s = addDays(e, -(range - 1))
    return { start: s, end: e }
  }, [range])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">History</h1>
        <p className="text-text-secondary text-[14px] mt-1">
          Browse meals, workouts, and wellness logs from the last {range} days.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="tab-strip">
          {(['meals', 'workouts', 'wellness'] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="tab-strip">
          {([7, 30, 90] as Range[]).map((r) => (
            <button
              key={r}
              className={range === r ? 'active' : ''}
              onClick={() => setRange(r)}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {tab === 'meals' && <PanelWrap><MealsHistory uid={uid} start={start} end={end} /></PanelWrap>}
      {tab === 'workouts' && <WorkoutsHistory uid={uid} start={start} end={end} />}
      {tab === 'wellness' && <PanelWrap><WellnessHistory uid={uid} start={start} end={end} /></PanelWrap>}
    </div>
  )
}

function PanelWrap({ children }: { children: ReactNode }) {
  return <div className="panel">{children}</div>
}

function groupByDay<T extends { date: Date }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = item.date.toDateString()
    const arr = groups.get(key)
    if (arr) arr.push(item)
    else groups.set(key, [item])
  }
  return groups
}

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function MealsHistory({ uid, start, end }: { uid?: string; start: Date; end: Date }) {
  const { meals, loading, error } = useMealsHistory(uid, start, end)
  if (loading) return <p className="text-text-muted text-[13px]">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (meals.length === 0) return <EmptyState title="No meals in this range" />

  const groups = groupByDay(meals)
  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([dayKey, dayMeals]: [string, Meal[]]) => {
        const totals = dailyTotals(dayMeals)
        return (
          <div key={dayKey}>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="card-title">{formatDayHeader(dayKey)}</h3>
              <span className="card-subtext">
                {Math.round(totals.calories)} cal · {Math.round(totals.protein)}g protein
              </span>
            </div>
            <div className="timeline">
              {dayMeals.map((meal) => (
                <MealTimelineRow key={meal.id} meal={meal} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WorkoutsHistory({ uid, start, end }: { uid?: string; start: Date; end: Date }) {
  const { workouts, loading, error } = useWorkoutsHistory(uid, start, end)
  if (loading) return <p className="text-text-muted text-[13px]">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (workouts.length === 0) return <EmptyState title="No workouts in this range" />

  return (
    <div className="space-y-3">
      {workouts.map((w) => (
        <WorkoutCard key={w.id} workout={w} />
      ))}
    </div>
  )
}

function WellnessHistory({ uid, start, end }: { uid?: string; start: Date; end: Date }) {
  const { entries, loading, error } = useWellnessHistory(uid, start, end)
  if (loading) return <p className="text-text-muted text-[13px]">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (entries.length === 0) return <EmptyState title="No wellness entries in this range" />

  const groups = groupByDay(entries)
  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([dayKey, dayEntries]: [string, WellnessEntry[]]) => (
        <div key={dayKey}>
          <h3 className="card-title mb-1">{formatDayHeader(dayKey)}</h3>
          <div className="timeline">
            {dayEntries.map((entry) => (
              <WellnessTimelineRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
