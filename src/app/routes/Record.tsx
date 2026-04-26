import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MealLogForm } from '../components/log/MealLogForm'
import { SubstanceLogForm } from '../components/log/SubstanceLogForm'
import { SupplementLogForm } from '../components/log/SupplementLogForm'
import { WellnessLogForm } from '../components/log/WellnessLogForm'
import { WorkoutLogForm } from '../components/log/WorkoutLogForm'
import { WaterLogForm } from '../components/log/WaterLogForm'

type Tab = 'meal' | 'water' | 'wellness' | 'workout' | 'supplements' | 'substances'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'meal', label: 'Food' },
  { id: 'water', label: 'Water' },
  { id: 'wellness', label: 'Wellness' },
  { id: 'workout', label: 'Workout' },
  { id: 'supplements', label: 'Supplements' },
  { id: 'substances', label: 'Substances' },
]

export function Record() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('meal')

  function handleSaved() {
    navigate('/', { replace: true })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Record</h1>
        <p className="text-text-secondary text-[14px] mt-1">
          Use the same food, water, wellness, workout, supplement, and substance inputs as the iOS app.
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
        {tab === 'meal' && <MealLogForm onSaved={handleSaved} />}
        {tab === 'water' && <WaterLogForm onSaved={handleSaved} />}
        {tab === 'wellness' && <WellnessLogForm onSaved={handleSaved} />}
        {tab === 'workout' && <WorkoutLogForm onSaved={handleSaved} />}
        {tab === 'supplements' && <SupplementLogForm onSaved={handleSaved} />}
        {tab === 'substances' && <SubstanceLogForm onSaved={handleSaved} />}
      </div>
    </div>
  )
}
