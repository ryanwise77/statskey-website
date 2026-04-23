import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MealLogForm } from '../components/log/MealLogForm'
import { WellnessLogForm } from '../components/log/WellnessLogForm'
import { WorkoutLogForm } from '../components/log/WorkoutLogForm'
import { WaterLogForm } from '../components/log/WaterLogForm'

type Tab = 'meal' | 'water' | 'wellness' | 'workout'

export function Record() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('meal')

  function handleSaved() {
    navigate('/', { replace: true })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Log something</h1>
        <p className="text-text-secondary text-[14px] mt-1">
          Entries sync instantly to your iOS app.
        </p>
      </header>

      <div className="tab-strip">
        {(['meal', 'water', 'wellness', 'workout'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="panel">
        {tab === 'meal' && <MealLogForm onSaved={handleSaved} />}
        {tab === 'water' && <WaterLogForm onSaved={handleSaved} />}
        {tab === 'wellness' && <WellnessLogForm onSaved={handleSaved} />}
        {tab === 'workout' && <WorkoutLogForm onSaved={handleSaved} />}
      </div>
    </div>
  )
}
