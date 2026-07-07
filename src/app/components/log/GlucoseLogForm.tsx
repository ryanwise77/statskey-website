import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { deleteGlucoseReading, newId, saveGlucoseReading } from '../../lib/writers'
import { useGlucoseRange } from '../../lib/data/useGlucoseRange'

export function GlucoseLogForm({ onSaved }: { onSaved?: () => void }) {
  const { user } = useAuth()
  const uid = user?.uid
  const [value, setValue] = useState(100)
  const [date, setDate] = useState(new Date())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date()
  const { readings, loading } = useGlucoseRange(uid, today, today)

  async function save() {
    if (!uid) return
    setSaving(true)
    setError(null)
    try {
      await saveGlucoseReading(uid, {
        id: newId(),
        value,
        timestamp: date,
        source: 'Manual',
      })
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!uid) return
    if (!window.confirm('Delete this reading?')) return
    try {
      await deleteGlucoseReading(uid, id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const manualToday = readings.filter((r) => r.source === 'Manual')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[480px]">
        <Field label="Glucose (mg/dL)">
          <input
            className="input"
            type="number"
            min={20}
            max={600}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
          />
        </Field>
        <Field label="Time">
          <input
            className="input"
            type="datetime-local"
            value={toDatetimeLocal(date)}
            onChange={(e) => setDate(new Date(e.target.value))}
          />
        </Field>
      </div>

      <p className="text-text-muted text-[12px]">
        Manual readings join your CGM history (Dexcom, Libre, and Nightscout connect in the iOS app) and
        appear in Insights and Intelligence.
      </p>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={saving || !(value >= 20 && value <= 600)}>
          {saving ? 'Saving…' : 'Save reading'}
        </button>
      </div>

      <div>
        <span className="card-title block mb-2">Today's manual readings</span>
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : manualToday.length === 0 ? (
          <p className="text-text-muted text-[13px]">No manual readings today.</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {manualToday.map((r) => (
              <div key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="text-[14px] text-text-primary">
                  {Math.round(r.value)} mg/dL
                  <span className="text-text-muted text-[12px] ml-2">
                    {r.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <button
                  className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300"
                  onClick={() => remove(r.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
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
