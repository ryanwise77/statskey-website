import { ProgressBar } from './ProgressBar'

interface WaterCardProps {
  amountOz: number
  targetOz: number
}

export function WaterCard({ amountOz, targetOz }: WaterCardProps) {
  const pct = targetOz > 0 ? Math.min(100, (amountOz / targetOz) * 100) : 0
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
    </div>
  )
}
