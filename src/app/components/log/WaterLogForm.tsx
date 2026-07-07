import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth'
import {
  deleteAllWaterEntries,
  deleteWaterEntry,
  logWaterEntry,
  materializeLegacyWaterIfNeeded,
  updateWaterEntry,
} from '../../lib/writers'
import { useWaterForDay } from '../../lib/data/useTodayWater'
import { useWaterEntries } from '../../lib/data/useWaterEntries'
import { localDateString } from '../../lib/firestore'
import type { WaterEntry } from '../../lib/types'

const QUICK_AMOUNTS = [8, 12, 16, 20, 32]

export function WaterLogForm({ onSaved }: { onSaved?: () => void }) {
  const { user } = useAuth()
  const uid = user?.uid
  const [day, setDay] = useState(new Date())
  const { water } = useWaterForDay(uid, day)
  const { entries, loading } = useWaterEntries(uid, day)
  const current = water?.amount ?? 0
  const [custom, setCustom] = useState(8)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const isToday = localDateString(day) === localDateString(new Date())

  // One-time backfill: turn a legacy daily total into a single entry so the
  // timeline below reflects reality (mirrors materializeLegacyWaterIfNeeded).
  useEffect(() => {
    if (!uid || loading) return
    if (entries.length === 0 && current > 0) {
      materializeLegacyWaterIfNeeded(uid, day).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, loading, entries.length, current, localDateString(day)])

  async function add(oz: number) {
    if (!uid || oz <= 0) return
    setSaving(true)
    setError(null)
    try {
      await logWaterEntry(uid, oz, dateForNewEntry(day))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(entry: WaterEntry) {
    if (!uid) return
    setError(null)
    try {
      await deleteWaterEntry(uid, entry.id, entry.date)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function reset() {
    if (!uid) return
    if (!window.confirm('Remove all water entries for this day?')) return
    setError(null)
    try {
      await deleteAllWaterEntries(uid, day)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function shiftDay(delta: number) {
    const next = new Date(day)
    next.setDate(next.getDate() + delta)
    setDay(next)
    setEditingId(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="card-title">
            {isToday ? "Today's total" : `${day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} total`}
          </span>
          <div className="card-number card-number-md mt-1">{Math.round(current)} fl oz</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary !px-3 !py-1.5" onClick={() => shiftDay(-1)}>←</button>
          <button className="btn btn-secondary !px-3 !py-1.5" onClick={() => shiftDay(1)} disabled={isToday}>→</button>
        </div>
      </div>

      <div>
        <span className="card-title block mb-2">Quick add</span>
        <div className="flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((oz) => (
            <button
              key={oz}
              className="btn btn-secondary"
              onClick={() => add(oz)}
              disabled={saving}
            >
              +{oz} oz
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="card-title block mb-2">Custom amount</span>
        <div className="flex gap-2 max-w-[280px]">
          <input
            className="input"
            type="number"
            step="1"
            min={1}
            value={custom}
            onChange={(e) => setCustom(Number(e.target.value))}
          />
          <button
            className="btn btn-primary"
            onClick={() => add(custom)}
            disabled={saving || custom <= 0}
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="card-title">Entries</span>
          {entries.length > 0 && (
            <button className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300" onClick={reset}>
              Reset day
            </button>
          )}
        </div>
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-text-muted text-[13px]">No water recorded for this day yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {entries.map((entry) =>
              editingId === entry.id ? (
                <WaterEntryEditor
                  key={entry.id}
                  entry={entry}
                  onDone={() => setEditingId(null)}
                  onError={setError}
                  uid={uid!}
                />
              ) : (
                <div key={entry.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="text-[14px] text-text-primary">
                    {Math.round(entry.amount)} fl oz
                    <span className="text-text-muted text-[12px] ml-2">
                      {entry.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="btn btn-ghost text-[12px] !py-1 !px-2"
                      onClick={() => setEditingId(entry.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300"
                      onClick={() => remove(entry)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {onSaved && (
        <div className="flex justify-end">
          <button className="btn btn-secondary" onClick={onSaved}>Done</button>
        </div>
      )}
    </div>
  )
}

function WaterEntryEditor({
  entry,
  uid,
  onDone,
  onError,
}: {
  entry: WaterEntry
  uid: string
  onDone: () => void
  onError: (msg: string | null) => void
}) {
  const [amount, setAmount] = useState(entry.amount)
  const [time, setTime] = useState(toTimeInput(entry.date))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    onError(null)
    try {
      const date = withTime(entry.date, time)
      await updateWaterEntry(uid, { ...entry, amount, date }, entry.date)
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="py-2.5 flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">Fl oz</span>
        <input
          className="input !w-24"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </label>
      <label className="block">
        <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">Time</span>
        <input
          className="input !w-32"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </label>
      <button className="btn btn-primary !py-2" onClick={save} disabled={saving || amount <= 0}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button className="btn btn-ghost !py-2" onClick={onDone} disabled={saving}>
        Cancel
      </button>
    </div>
  )
}

/** For past days, pin new entries to noon so they land inside that day. */
function dateForNewEntry(day: Date): Date {
  const today = new Date()
  if (localDateString(day) === localDateString(today)) return new Date()
  const d = new Date(day)
  d.setHours(12, 0, 0, 0)
  return d
}

function toTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function withTime(base: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(base)
  if (Number.isFinite(h) && Number.isFinite(m)) d.setHours(h, m, 0, 0)
  return d
}
