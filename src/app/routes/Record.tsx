import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MealLogForm } from '../components/log/MealLogForm'
import { SubstanceLogForm } from '../components/log/SubstanceLogForm'
import { SupplementLogForm } from '../components/log/SupplementLogForm'
import { WellnessLogForm } from '../components/log/WellnessLogForm'
import { WorkoutLogForm } from '../components/log/WorkoutLogForm'
import { WaterLogForm } from '../components/log/WaterLogForm'
import { WeightLogForm } from '../components/log/WeightLogForm'
import { GlucoseLogForm } from '../components/log/GlucoseLogForm'

type Tab = 'meal' | 'water' | 'wellness' | 'workout' | 'weight' | 'glucose' | 'supplements' | 'substances'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'meal', label: 'Food' },
  { id: 'water', label: 'Water' },
  { id: 'wellness', label: 'Wellness' },
  { id: 'workout', label: 'Workout' },
  { id: 'weight', label: 'Weight' },
  { id: 'glucose', label: 'Glucose' },
  { id: 'supplements', label: 'Supplements' },
  { id: 'substances', label: 'Substances' },
]

const VALID_TABS = new Set<string>(TABS.map((t) => t.id))

export function Record() {
  const navigate = useNavigate()
  const location = useLocation()
  const tabParam = new URLSearchParams(location.search).get('tab')
  const [tab, setTab] = useState<Tab>(
    tabParam && VALID_TABS.has(tabParam) ? (tabParam as Tab) : 'meal'
  )
  const initialMealDate = dateFromSearch(location.search)

  function handleSaved() {
    navigate(location.state?.returnTo ?? '/', { replace: true })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Record</h1>
        <p className="text-text-secondary text-[14px] mt-1">
          Record food, water, wellness, workouts, weight, glucose, supplements, and substances — the same
          inputs as the iOS app.
        </p>
      </header>

      <div className="tab-strip">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel">
        {tab === 'meal' && <MealLogForm initialDate={initialMealDate} onSaved={handleSaved} />}
        {tab === 'water' && <WaterLogForm onSaved={handleSaved} />}
        {tab === 'wellness' && <WellnessLogForm onSaved={handleSaved} />}
        {tab === 'workout' && <WorkoutLogForm onSaved={handleSaved} />}
        {tab === 'weight' && <WeightLogForm onSaved={handleSaved} />}
        {tab === 'glucose' && <GlucoseLogForm onSaved={handleSaved} />}
        {tab === 'supplements' && <SupplementLogForm onSaved={handleSaved} />}
        {tab === 'substances' && <SubstanceLogForm onSaved={handleSaved} />}
      </div>
    </div>
  )
}

function dateFromSearch(search: string): Date | undefined {
  const value = new URLSearchParams(search).get('date')
  if (!value) return undefined

  const parsed = new Date(`${value}T12:00`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}
