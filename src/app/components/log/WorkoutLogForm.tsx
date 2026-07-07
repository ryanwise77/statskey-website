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

interface WorkoutLogFormProps {
  onSaved: () => void
  /** When present the form edits this workout instead of creating a new one. */
  initialWorkout?: WorkoutSession
  onCancel?: () => void
}

export function WorkoutLogForm({ onSaved, initialWorkout, onCancel }: WorkoutLogFormProps) {
  const { user } = useAuth()
  const isEditing = initialWorkout != null
  const now = new Date()
  const [title, setTitle] = useState(initialWorkout?.title ?? '')
  const [sport, setSport] = useState(initialWorkout?.sportType ?? 'running')
  const [startDate, setStartDate] = useState(initialWorkout?.startDate ?? now)
  const [durationMin, setDurationMin] = useState(
    initialWorkout ? Math.round(initialWorkout.duration / 60) : 30
  )
  const [distance, setDistance] = useState(initialWorkout?.distance ?? 0)
  const [calories, setCalories] = useState(initialWorkout?.calories ?? 0)
  const [notes, setNotes] = useState(initialWorkout?.notes ?? '')
  const [isIndoor, setIsIndoor] = useState(initialWorkout?.isIndoor ?? false)
  const [perceivedEffort, setPerceivedEffort] = useState<number | undefined>(
    initialWorkout?.perceivedEffort
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A GPS/HealthKit recording's metrics come from sensors — only let the user
  // retitle/annotate those, matching WorkoutEditView on iOS.
  const metricsLocked = isEditing && initialWorkout!.source !== 'manual'

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

      const base: WorkoutSession = initialWorkout ?? {
        id: newId(),
        userId: user.uid,
        title: '',
        sportType: sport,
        startDate,
        duration: 0,
        movingTime: 0,
        distance: 0,
        elevationGain: 0,
        elevationLoss: 0,
        calories: 0,
        averagePace: 0,
        bestPace: 0,
        averageSpeed: 0,
        maxSpeed: 0,
        averageHeartRate: 0,
        maxHeartRate: 0,
        averageCadence: 0,
        isFavorite: false,
        relativeEffort: 0,
        gradeAdjustedPace: 0,
        photoURLs: [],
        source: 'manual',
        isIndoor: false,
        recordingMode: 'standard',
        createdAt: new Date(),
        routeCoordinates: [],
        splits: [],
      }

      const workout: WorkoutSession = {
        ...base,
        title: title.trim() || sport,
        sportType: sport,
        notes: notes.trim() || undefined,
        isIndoor,
        perceivedEffort,
      }

      if (!metricsLocked) {
        workout.startDate = startDate
        workout.endDate = new Date(startDate.getTime() + durationSec * 1000)
        workout.duration = durationSec
        workout.movingTime = durationSec
        workout.distance = distance
        workout.calories = calories
        workout.averagePace = pace
        workout.bestPace = pace
        workout.averageSpeed = speed
        workout.maxSpeed = speed
        workout.gradeAdjustedPace = pace
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
      {metricsLocked && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-text-secondary">
          This workout was recorded with sensors ({initialWorkout!.source}). Title, notes, effort, and
          sport can be edited; measured metrics stay as recorded.
        </div>
      )}

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
            {SPORTS.includes(sport) ? null : <option value={sport}>{sport}</option>}
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        {!metricsLocked && (
          <>
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
          </>
        )}
      </div>

      <div>
        <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
          Perceived effort {perceivedEffort != null ? `(${perceivedEffort}/10)` : '(not recorded)'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={
                'btn !px-3 !py-1.5 text-[12px] ' +
                (perceivedEffort === n ? 'btn-primary' : 'btn-secondary')
              }
              onClick={() => setPerceivedEffort(perceivedEffort === n ? undefined : n)}
            >
              {n}
            </button>
          ))}
        </div>
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

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save workout'}
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
