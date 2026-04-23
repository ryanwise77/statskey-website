import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { addWaterOz } from '../../lib/writers'
import { useTodayWater } from '../../lib/data/useTodayWater'

const QUICK_AMOUNTS = [8, 12, 16, 20, 32]

export function WaterLogForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const { water } = useTodayWater(user?.uid)
  const current = water?.amount ?? 0
  const [custom, setCustom] = useState(8)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(oz: number) {
    if (!user || oz <= 0) return
    setSaving(true)
    setError(null)
    try {
      await addWaterOz(user.uid, oz)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <span className="card-title">Today's total</span>
        <div className="card-number card-number-md mt-1">{Math.round(current)} fl oz</div>
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

      {error && <div className="error-banner">{error}</div>}
    </div>
  )
}
