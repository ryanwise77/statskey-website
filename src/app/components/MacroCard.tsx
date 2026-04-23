import type { DailyTotals } from '../lib/aggregates'
import type { MacroTargets } from '../lib/types'
import { ProgressRow } from './ProgressBar'

interface MacroCardProps {
  totals: DailyTotals
  targets: MacroTargets
  mealsCount: number
}

export function MacroCard({ totals, targets, mealsCount }: MacroCardProps) {
  const caloriesPct = targets.calories > 0 ? Math.min(100, (totals.calories / targets.calories) * 100) : 0

  return (
    <div className="panel">
      <div className="flex items-end justify-between">
        <div>
          <span className="card-title">Today</span>
          <div className="card-number card-number-big mt-1">{Math.round(totals.calories)}</div>
          <div className="card-subtext">
            of {Math.round(targets.calories)} cal
            {mealsCount > 0 && ` · ${mealsCount} ${mealsCount === 1 ? 'meal' : 'meals'}`}
          </div>
        </div>
        <div className="text-right">
          <div className="card-subtext">{caloriesPct.toFixed(0)}%</div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <ProgressRow label="Protein" value={totals.protein} target={targets.protein} />
        <ProgressRow label="Carbs" value={totals.carbs} target={targets.carbs} />
        <ProgressRow label="Fat" value={totals.fat} target={targets.fat} />
      </div>
    </div>
  )
}
