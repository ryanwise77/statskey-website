import { ProgressBar } from './ProgressBar'

interface FiberCardProps {
  amount: number
  target: number
}

export function FiberCard({ amount, target }: FiberCardProps) {
  const pct = target > 0 ? Math.min(100, (amount / target) * 100) : 0
  return (
    <div className="panel">
      <div className="flex items-center justify-between">
        <span className="card-title">Fiber</span>
        <span className="card-subtext">{pct.toFixed(0)}%</span>
      </div>
      <div className="card-number card-number-md mt-2">
        {Math.round(amount)}
        <span className="text-text-muted text-[13px] font-normal"> / {Math.round(target)} g</span>
      </div>
      <div className="mt-3">
        <ProgressBar value={amount} target={target} />
      </div>
    </div>
  )
}
