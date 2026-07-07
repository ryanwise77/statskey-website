import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  useMealsHistory,
  useWellnessHistory,
  useWorkoutsHistory,
} from '../lib/data/useHistory'
import { useSubstancesHistory } from '../lib/data/useSubstances'
import { useWeights } from '../lib/data/useWeights'
import { useGlucoseRange, glucoseStats } from '../lib/data/useGlucoseRange'
import { addDays, localDateString } from '../lib/firestore'
import { dailyTotals } from '../lib/aggregates'
import { deleteSubstanceEntry, deleteWeightEntry } from '../lib/writers'
import { MealTimelineRow, WellnessTimelineRow } from '../components/TimelineRow'
import { WorkoutCard } from '../components/WorkoutCard'
import { EmptyState } from '../components/EmptyState'
import type { Meal, SubstanceEntry, WellnessEntry } from '../lib/types'

type Tab = 'meals' | 'workouts' | 'wellness' | 'weight' | 'glucose' | 'substances'
type Range = 7 | 30 | 90
type MealBrowseMode = 'range' | 'day'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'meals', label: 'Meals' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'wellness', label: 'Wellness' },
  { id: 'weight', label: 'Weight' },
  { id: 'glucose', label: 'Glucose' },
  { id: 'substances', label: 'Substances' },
]

export function History() {
  const { user } = useAuth()
  const location = useLocation()
  const mealDateParam = new URLSearchParams(location.search).get('mealDate')
  const uid = user?.uid
  const [tab, setTab] = useState<Tab>('meals')
  const [range, setRange] = useState<Range>(7)
  const [selectedMealDay, setSelectedMealDay] = useState(mealDateParam ?? localDateString(new Date()))
  const [mealBrowseMode, setMealBrowseMode] = useState<MealBrowseMode>(mealDateParam ? 'day' : 'range')

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
          Browse everything you've recorded from the last {range} days.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="tab-strip">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'meals' ? (
          <div className="tab-strip">
            <button
              className={mealBrowseMode === 'range' ? 'active' : ''}
              onClick={() => setMealBrowseMode('range')}
            >
              Recent
            </button>
            <button
              className={mealBrowseMode === 'day' ? 'active' : ''}
              onClick={() => setMealBrowseMode('day')}
            >
              Day
            </button>
          </div>
        ) : (
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
        )}

        {tab === 'meals' && mealBrowseMode === 'range' && (
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
        )}

        {tab === 'meals' && (
          <div className="flex flex-wrap items-end gap-2 ml-auto">
            <label className="block">
              <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">Meal day</span>
              <input
                className="input !py-2"
                type="date"
                max={localDateString(new Date())}
                value={selectedMealDay}
                onChange={(e) => {
                  setSelectedMealDay(e.target.value)
                  setMealBrowseMode('day')
                }}
              />
            </label>
            <Link
              className="btn btn-primary"
              to={`/record?date=${selectedMealDay}`}
              state={{ returnTo: `/history?mealDate=${selectedMealDay}` }}
            >
              + Add Meal
            </Link>
          </div>
        )}
      </div>

      {tab === 'meals' && (
        <PanelWrap>
          <MealsHistory
            uid={uid}
            start={mealBrowseMode === 'day' ? dateFromLocalDateString(selectedMealDay) : start}
            end={mealBrowseMode === 'day' ? dateFromLocalDateString(selectedMealDay) : end}
          />
        </PanelWrap>
      )}
      {tab === 'workouts' && <WorkoutsHistory uid={uid} start={start} end={end} />}
      {tab === 'wellness' && <PanelWrap><WellnessHistory uid={uid} start={start} end={end} /></PanelWrap>}
      {tab === 'weight' && <PanelWrap><WeightHistory uid={uid} start={start} end={end} /></PanelWrap>}
      {tab === 'glucose' && <PanelWrap><GlucoseHistory uid={uid} start={start} end={end} /></PanelWrap>}
      {tab === 'substances' && <PanelWrap><SubstancesHistory uid={uid} start={start} end={end} /></PanelWrap>}
    </div>
  )
}

function dateFromLocalDateString(value: string): Date {
  const parsed = new Date(`${value}T12:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
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

function WeightHistory({ uid, start, end }: { uid?: string; start: Date; end: Date }) {
  const { weights, loading, error } = useWeights(uid, start, end)
  if (loading) return <p className="text-text-muted text-[13px]">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (weights.length === 0) {
    return (
      <EmptyState
        title="No weight entries in this range"
        subtitle="Record weight from the Record tab; entries synced from Apple Health show here too."
      />
    )
  }

  async function remove(id: string) {
    if (!uid) return
    if (!window.confirm('Delete this weight entry?')) return
    await deleteWeightEntry(uid, id).catch(() => {})
  }

  return (
    <div className="divide-y divide-white/[0.04]">
      {weights.map((w) => (
        <div key={w.id} className="py-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] text-text-primary">
              {w.weightLbs.toFixed(1)} lb
              {w.bodyFatPercent != null && (
                <span className="text-text-muted text-[12px] ml-2">{w.bodyFatPercent.toFixed(1)}% BF</span>
              )}
            </div>
            <div className="card-subtext mt-0.5">
              {w.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              {w.source && ` · ${w.source}`}
            </div>
          </div>
          <button className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300" onClick={() => remove(w.id)}>
            Delete
          </button>
        </div>
      ))}
    </div>
  )
}

function GlucoseHistory({ uid, start, end }: { uid?: string; start: Date; end: Date }) {
  const { readings, loading, error } = useGlucoseRange(uid, start, end)
  if (loading) return <p className="text-text-muted text-[13px]">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (readings.length === 0) {
    return (
      <EmptyState
        title="No glucose readings in this range"
        subtitle="Record readings manually from the Record tab, or connect a CGM in the iOS app."
      />
    )
  }

  const byDay = groupByDay(
    readings.map((r) => ({ ...r, date: r.timestamp }))
  )

  return (
    <div className="space-y-5">
      {Array.from(byDay.entries()).map(([dayKey, dayReadings]) => {
        const stats = glucoseStats(dayReadings)
        return (
          <div key={dayKey}>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="card-title">{formatDayHeader(dayKey)}</h3>
              {stats && (
                <span className="card-subtext">
                  {dayReadings.length} readings · avg {Math.round(stats.average)} · {Math.round(stats.min)}–
                  {Math.round(stats.max)} mg/dL · {Math.round(stats.timeInRangePercent)}% in range
                </span>
              )}
            </div>
          </div>
        )
      })}
      <p className="text-text-muted text-[12px]">
        Full glucose charts live on the Insights page.
      </p>
    </div>
  )
}

function SubstancesHistory({ uid, start, end }: { uid?: string; start: Date; end: Date }) {
  const { entries, loading, error } = useSubstancesHistory(uid, start, end)
  if (loading) return <p className="text-text-muted text-[13px]">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No substance entries in this range"
        subtitle="Substance entries stay private by default — only you can see them."
      />
    )
  }

  async function remove(entry: SubstanceEntry) {
    if (!uid) return
    if (!window.confirm('Delete this entry?')) return
    await deleteSubstanceEntry(uid, entry.id).catch(() => {})
  }

  const groups = groupByDay(entries)
  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([dayKey, dayEntries]: [string, SubstanceEntry[]]) => (
        <div key={dayKey}>
          <h3 className="card-title mb-1">{formatDayHeader(dayKey)}</h3>
          <div className="divide-y divide-white/[0.04]">
            {dayEntries.map((entry) => (
              <div key={entry.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] text-text-primary">
                    {substanceLabel(entry)}
                    {entry.isPrivate && <span className="timeline-badge ml-2">Private</span>}
                  </div>
                  <div className="card-subtext mt-0.5">
                    {entry.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    {entry.method && ` · ${entry.method}`}
                    {entry.amount != null && ` · ${entry.amount}${entry.unit ? ` ${entry.unit}` : ''}`}
                  </div>
                  {entry.notes && <div className="card-subtext mt-0.5">{entry.notes}</div>}
                </div>
                <button
                  className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300"
                  onClick={() => remove(entry)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function substanceLabel(entry: SubstanceEntry): string {
  const kind = entry.kind[0].toUpperCase() + entry.kind.slice(1)
  return entry.name ? `${entry.name} (${kind})` : kind
}
