import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { newId, saveWellness } from '../../lib/writers'
import type {
  BowelMovementEntry,
  BristolType,
  EnergyEntry,
  MoodEntry,
  StoolColor,
  SymptomEntry,
  WellnessData,
  WellnessEntry,
  WellnessType,
} from '../../lib/types'

type Kind = WellnessType
const KINDS: Kind[] = ['mood', 'energy', 'symptom', 'bowelMovement']

const STOOL_COLORS: StoolColor[] = [
  'brown',
  'darkBrown',
  'lightBrown',
  'yellow',
  'green',
  'black',
  'red',
  'clay',
]

const STOOL_COLOR_LABELS: Record<StoolColor, string> = {
  brown: 'Brown',
  darkBrown: 'Dark brown',
  lightBrown: 'Light brown',
  yellow: 'Yellow',
  green: 'Green',
  black: 'Black',
  red: 'Red',
  clay: 'Clay',
}

const BRISTOL_LABELS: Record<number, string> = {
  1: 'Type 1 — Hard lumps',
  2: 'Type 2 — Lumpy sausage',
  3: 'Type 3 — Cracked sausage',
  4: 'Type 4 — Smooth snake',
  5: 'Type 5 — Soft pieces',
  6: 'Type 6 — Mushy',
  7: 'Type 7 — Liquid',
}

const DURATION_QUICK_MINUTES = [1, 2, 5, 10, 15, 20]

interface WellnessLogFormProps {
  onSaved: (entry: WellnessEntry) => void
  initialEntry?: WellnessEntry
  onCancel?: () => void
}

export function WellnessLogForm({ onSaved, initialEntry, onCancel }: WellnessLogFormProps) {
  const { user } = useAuth()
  const isEditing = initialEntry != null
  const initialKind = initialEntry ? kindFromEntry(initialEntry) : 'mood'
  const initialBowel = initialEntry?.data.kind === 'bowelMovement' ? initialEntry.data.entry : undefined
  const initialDuration = initialBowel?.durationInSeconds ?? 0
  const [kind, setKind] = useState<Kind>(initialKind)
  const [date, setDate] = useState(initialEntry?.date ?? new Date())
  const [notes, setNotes] = useState(initialEntry?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mood, setMood] = useState<MoodEntry>(
    initialEntry?.data.kind === 'mood' ? initialEntry.data.entry : { rating: 3, tags: [], notes: undefined }
  )
  const [energy, setEnergy] = useState<EnergyEntry>(
    initialEntry?.data.kind === 'energy' ? initialEntry.data.entry : { level: 3, notes: undefined }
  )
  const [symptom, setSymptom] = useState<SymptomEntry>({
    symptom: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.symptom : '',
    severity: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.severity : 3,
    duration: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.duration : undefined,
    bodyArea: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.bodyArea : undefined,
    triggers: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.triggers : [],
  })
  // Match the iOS "don't default optional gut-check fields" behavior from BowelLogView.
  const [bowel, setBowel] = useState<BowelMovementEntry>({
    bristolType: initialBowel?.bristolType ?? 4,
    color: initialBowel?.color,
    urgency: initialBowel?.urgency,
    durationInSeconds: initialBowel?.durationInSeconds,
    notes: initialBowel?.notes,
  })
  const [bowelDurationMinutes, setBowelDurationMinutes] = useState(Math.floor(initialDuration / 60))
  const [bowelDurationSeconds, setBowelDurationSeconds] = useState(initialDuration % 60)

  async function save() {
    if (!user) return
    if (kind === 'symptom' && !symptom.symptom.trim()) {
      setError('Enter a symptom name.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      let data: WellnessData
      switch (kind) {
        case 'mood':
          data = { kind: 'mood', entry: mood }
          break
        case 'energy':
          data = { kind: 'energy', entry: energy }
          break
        case 'symptom':
          data = { kind: 'symptom', entry: { ...symptom, symptom: symptom.symptom.trim() } }
          break
        case 'bowelMovement':
          {
            const durationInSeconds = bowelDurationMinutes * 60 + bowelDurationSeconds
            const trimmedNotes = notes.trim()
            data = {
              kind: 'bowelMovement',
              entry: {
                ...bowel,
                durationInSeconds: durationInSeconds > 0 ? durationInSeconds : undefined,
                notes: trimmedNotes || undefined,
              },
            }
          }
          break
      }

      const entry: WellnessEntry = {
        id: initialEntry?.id ?? newId(),
        userId: user.uid,
        type: kind,
        data,
        notes: notes.trim() || undefined,
        date,
        createdAt: initialEntry?.createdAt ?? new Date(),
      }
      await saveWellness(user.uid, entry)
      onSaved(entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <span className="card-title block mb-2">Type</span>
        <div className="tab-strip">
          {KINDS.map((k) => (
            <button
              key={k}
              className={kind === k ? 'active' : ''}
              onClick={() => setKind(k)}
              disabled={isEditing}
              title={isEditing ? 'Create a new entry to change type.' : undefined}
            >
              {k === 'bowelMovement' ? 'Gut check' : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
        {isEditing && (
          <p className="text-text-muted text-[12px] mt-2">
            Entry type is fixed when editing, matching the iOS journal flow.
          </p>
        )}
      </div>

      {kind === 'mood' && (
        <RatingRow
          label="Mood"
          value={mood.rating}
          labels={['Very bad', 'Bad', 'Neutral', 'Good', 'Great']}
          onChange={(v) => setMood({ ...mood, rating: v })}
        />
      )}

      {kind === 'energy' && (
        <RatingRow
          label="Energy"
          value={energy.level}
          labels={['Exhausted', 'Low', 'Moderate', 'Good', 'Excellent']}
          onChange={(v) => setEnergy({ ...energy, level: v })}
        />
      )}

      {kind === 'symptom' && (
        <div className="space-y-3">
          <Field label="Symptom">
            <input
              className="input"
              placeholder="e.g. Headache"
              value={symptom.symptom}
              onChange={(e) => setSymptom({ ...symptom, symptom: e.target.value })}
            />
          </Field>
          <RatingRow
            label="Severity"
            value={symptom.severity}
            labels={['1', '2', '3', '4', '5']}
            onChange={(v) => setSymptom({ ...symptom, severity: v })}
          />
          <Field label="Body area (optional)">
            <input
              className="input"
              value={symptom.bodyArea ?? ''}
              onChange={(e) => setSymptom({ ...symptom, bodyArea: e.target.value || undefined })}
            />
          </Field>
        </div>
      )}

      {kind === 'bowelMovement' && (
        <div className="space-y-4">
          <Field label="Bristol type">
            <select
              className="input"
              value={bowel.bristolType}
              onChange={(e) =>
                setBowel({
                  ...bowel,
                  bristolType: Number(e.target.value) as BristolType,
                })
              }
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>{BRISTOL_LABELS[n]}</option>
              ))}
            </select>
          </Field>

          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Color {bowel.color ? '' : '(not recorded)'}
            </span>
            <div className="flex flex-wrap gap-2">
              {STOOL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={
                    'btn ' + (bowel.color === c ? 'btn-primary' : 'btn-secondary') + ' text-[12px]'
                  }
                  onClick={() => setBowel({ ...bowel, color: bowel.color === c ? undefined : c })}
                >
                  {STOOL_COLOR_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Urgency {bowel.urgency != null ? '' : '(not recorded)'}
            </span>
            <div className="flex gap-2">
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={
                    'btn ' + (bowel.urgency === level ? 'btn-primary' : 'btn-secondary')
                  }
                  onClick={() =>
                    setBowel({ ...bowel, urgency: bowel.urgency === level ? undefined : level })
                  }
                >
                  {level === 1 ? 'Normal' : level === 2 ? 'Moderate' : 'Urgent'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Duration {bowelDurationMinutes || bowelDurationSeconds ? '' : '(not recorded)'}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minutes">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={bowelDurationMinutes}
                  onChange={(e) => setBowelDurationMinutes(clampDurationPart(e.target.value, 59))}
                />
              </Field>
              <Field label="Seconds">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={bowelDurationSeconds}
                  onChange={(e) => setBowelDurationSeconds(clampDurationPart(e.target.value, 59))}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {DURATION_QUICK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={
                    'btn ' +
                    (bowelDurationMinutes === minutes && bowelDurationSeconds === 0
                      ? 'btn-primary'
                      : 'btn-secondary') +
                    ' text-[12px]'
                  }
                  onClick={() => {
                    setBowelDurationMinutes(minutes)
                    setBowelDurationSeconds(0)
                  }}
                >
                  {minutes}m
                </button>
              ))}
              <button
                type="button"
                className="btn btn-secondary text-[12px]"
                onClick={() => {
                  setBowelDurationMinutes(0)
                  setBowelDurationSeconds(0)
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      <Field label="Date & time">
        <input
          className="input"
          type="datetime-local"
          value={toDatetimeLocal(date)}
          onChange={(e) => setDate(fromDatetimeLocal(e.target.value))}
        />
      </Field>

      <Field label="Notes (optional)">
        <textarea
          className="input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any other details"
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
          {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Save entry'}
        </button>
      </div>
    </div>
  )
}

function RatingRow({
  label,
  value,
  labels,
  onChange,
}: {
  label: string
  value: number
  labels: string[]
  onChange: (v: number) => void
}) {
  return (
    <div>
      <span className="card-title block mb-2">{label}</span>
      <div className="flex gap-2">
        {labels.map((l, i) => {
          const n = i + 1
          return (
            <button
              key={n}
              type="button"
              className={'btn ' + (value === n ? 'btn-primary' : 'btn-secondary') + ' flex-1'}
              onClick={() => onChange(n)}
            >
              <span className="text-[11px]">{l}</span>
            </button>
          )
        })}
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

function clampDurationPart(value: string, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(max, Math.max(0, Math.floor(parsed)))
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(s: string): Date {
  return new Date(s)
}

function kindFromEntry(entry: WellnessEntry): Kind {
  switch (entry.data.kind) {
    case 'mood':
    case 'energy':
    case 'symptom':
    case 'bowelMovement':
      return entry.data.kind
    default:
      return entry.type
  }
}
