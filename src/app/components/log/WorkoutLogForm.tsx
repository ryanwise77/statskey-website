import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { newId, saveWorkout } from '../../lib/writers'
import type { WorkoutSession } from '../../lib/types'

const SPORTS = [
  'running',
  'cycling',
  'walking',
  'hiking',
  'swimming',
  'strengthTraining',
  'yoga',
  'pilates',
  'rowing',
  'elliptical',
  'other',
]

export function WorkoutLogForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const now = new Date()
  const [title, setTitle] = useState('')
  const [sport, setSport] = useState('running')
  const [startDate, setStartDate] = useState(now)
  const [durationMin, setDurationMin] = useState(30)
  const [distance, setDistance] = useState(0)
  const [calories, setCalories] = useState(0)
  const [notes, setNotes] = useState('')
  const [isIndoor, setIsIndoor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!user) return
    if (!title.trim() && !sport) {
      setError('Enter a workout title or pick a sport.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const durationSec = Math.max(0, Math.round(durationMin * 60))
      const pace = distance > 0 && durationSec > 0 ? durationSec / distance : 0
      const speed = pace > 0 ? 3600 / pace : 0

      const workout: WorkoutSession = {
        id: newId(),
        userId: user.uid,
        title: title.trim() || sport,
        sportType: sport,
        startDate,
        endDate: new Date(startDate.getTime() + durationSec * 1000),
        duration: durationSec,
        movingTime: durationSec,
        distance,
        elevationGain: 0,
        elevationLoss: 0,
        calories,
        averagePace: pace,
        bestPace: pace,
        averageSpeed: speed,
        maxSpeed: speed,
        averageHeartRate: 0,
        maxHeartRate: 0,
        averageCadence: 0,
        isFavorite: false,
        notes: notes.trim() || undefined,
        relativeEffort: 0,
        gradeAdjustedPace: pace,
        photoURLs: [],
        source: 'manual',
        isIndoor,
        recordingMode: 'standard',
        createdAt: new Date(),
        routeCoordinates: [],
        splits: [],
      }
      await saveWorkout(user.uid, workout)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Title">
          <input
            className="input"
            placeholder="e.g. Morning run"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Sport">
          <select className="input" value={sport} onChange={(e) => setSport(e.target.value)}>
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <input
            className="input"
            type="datetime-local"
            value={toDatetimeLocal(startDate)}
            onChange={(e) => setStartDate(fromDatetimeLocal(e.target.value))}
          />
        </Field>
        <Field label="Duration (minutes)">
          <input
            className="input"
            type="number"
            min={0}
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          />
        </Field>
        <Field label="Distance (miles)">
          <input
            className="input"
            type="number"
            step="0.01"
            min={0}
            value={distance}
            onChange={(e) => setDistance(Number(e.target.value))}
          />
        </Field>
        <Field label="Calories">
          <input
            className="input"
            type="number"
            min={0}
            value={calories}
            onChange={(e) => setCalories(Number(e.target.value))}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          checked={isIndoor}
          onChange={(e) => setIsIndoor(e.target.checked)}
        />
        Indoor
      </label>

      <Field label="Notes (optional)">
        <textarea
          className="input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save workout'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(s: string): Date {
  return new Date(s)
}
