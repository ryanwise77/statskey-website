import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { deleteWeightEntry, newId, saveWeightEntry } from '../../lib/writers'
import { useWeights } from '../../lib/data/useWeights'
import { addDays } from '../../lib/firestore'
import { confirmDialog } from '../../lib/ui/dialogs'

export function WeightLogForm({ onSaved }: { onSaved?: () => void }) {
  const { user, profile, saveProfile } = useAuth()
  const uid = user?.uid
  const [weightLbs, setWeightLbs] = useState<number>(() => Math.round((profile?.weightLbs ?? 160) * 10) / 10)
  const [bodyFat, setBodyFat] = useState<string>('')
  const [date, setDate] = useState(new Date())
  const [alsoUpdateProfile, setAlsoUpdateProfile] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const end = new Date()
  const { weights, loading } = useWeights(uid, addDays(end, -89), end)

  async function save() {
    if (!uid) return
    if (!(weightLbs > 0 && weightLbs < 1500)) {
      setError('Enter a weight between 0 and 1500 lb.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const bf = bodyFat.trim() ? Number(bodyFat) : undefined
      await saveWeightEntry(uid, {
        id: newId(),
        weightLbs,
        bodyFatPercent: bf != null && Number.isFinite(bf) ? bf : undefined,
        date,
        source: 'Manual',
      })
      if (alsoUpdateProfile && profile) {
        await saveProfile({ ...profile, weightLbs })
      }
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!uid) return
    const confirmed = await confirmDialog({
      title: 'Delete this weight entry?',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteWeightEntry(uid, id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-[560px]">
        <Field label="Weight (lb)">
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            value={weightLbs}
            onChange={(e) => setWeightLbs(Number(e.target.value))}
          />
        </Field>
        <Field label="Body fat % (optional)">
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            max={80}
            value={bodyFat}
            placeholder="—"
            onChange={(e) => setBodyFat(e.target.value)}
          />
        </Field>
        <Field label="Date & time">
          <input
            className="input"
            type="datetime-local"
            value={toDatetimeLocal(date)}
            onChange={(e) => setDate(new Date(e.target.value))}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          checked={alsoUpdateProfile}
          onChange={(e) => setAlsoUpdateProfile(e.target.checked)}
        />
        Also update my profile weight (used for targets and calculations)
      </label>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save weight'}
        </button>
      </div>

      <div>
        <span className="card-title block mb-2">Last 90 days</span>
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : weights.length === 0 ? (
          <p className="text-text-muted text-[13px]">No weight entries yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {weights.slice(0, 14).map((w) => (
              <div key={w.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="text-[14px] text-text-primary">
                  {w.weightLbs.toFixed(1)} lb
                  {w.bodyFatPercent != null && (
                    <span className="text-text-muted text-[12px] ml-2">{w.bodyFatPercent.toFixed(1)}% BF</span>
                  )}
                  <span className="text-text-muted text-[12px] ml-2">
                    {w.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                  {w.source && w.source !== 'Manual' && (
                    <span className="text-text-muted text-[11px] ml-2">{w.source}</span>
                  )}
                </div>
                <button
                  className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300"
                  onClick={() => remove(w.id)}
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
