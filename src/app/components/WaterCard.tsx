import { useState } from 'react'
import { ProgressBar } from './ProgressBar'

interface WaterCardProps {
  amountOz: number
  targetOz: number
  onAdd?: (oz: number) => Promise<void> | void
}

const QUICK = [8, 16]

export function WaterCard({ amountOz, targetOz, onAdd }: WaterCardProps) {
  const pct = targetOz > 0 ? Math.min(100, (amountOz / targetOz) * 100) : 0
  const [busy, setBusy] = useState(false)

  async function handleAdd(oz: number) {
    if (!onAdd) return
    setBusy(true)
    try {
      await onAdd(oz)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="flex items-center justify-between">
        <span className="card-title">Water</span>
        <span className="card-subtext">{pct.toFixed(0)}%</span>
      </div>
      <div className="card-number card-number-md mt-2">
        {Math.round(amountOz)}
        <span className="text-text-muted text-[13px] font-normal"> / {Math.round(targetOz)} fl oz</span>
      </div>
      <div className="mt-3">
        <ProgressBar value={amountOz} target={targetOz} variant="teal" />
      </div>
      {onAdd && (
        <div className="mt-3 flex gap-2">
          {QUICK.map((oz) => (
            <button
              key={oz}
              className="btn btn-secondary !py-1 !px-2 text-[12px]"
              onClick={() => handleAdd(oz)}
              disabled={busy}
            >
              +{oz}oz
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
