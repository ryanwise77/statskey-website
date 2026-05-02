import type { Split } from '../lib/types'
import { formatPace } from '../lib/format'

interface SplitsTableProps {
  splits: Split[]
  /** True when this sport reports pace (run/walk/hike/swim). When false the
   *  pace column is hidden entirely. */
  usesPace: boolean
}

const OPTIMAL = '#51CF66'
const WARNING = '#FFA94D'
const ALERT = '#FF6B6B'

function paceColor(pace: number, best: number, worst: number): string {
  const range = Math.max(worst - best, 1)
  const normalized = (pace - best) / range
  if (normalized < 0.33) return OPTIMAL
  if (normalized < 0.66) return WARNING
  return ALERT
}

export function SplitsTable({ splits, usesPace }: SplitsTableProps) {
  if (splits.length === 0) return null

  const valid = splits.filter((s) => s.pace > 0)
  const bestPace = valid.length ? Math.min(...valid.map((s) => s.pace)) : 0
  const worstPace = valid.length ? Math.max(...valid.map((s) => s.pace)) : 0
  const hasHR = splits.some((s) => s.averageHeartRate != null)

  return (
    <div className="panel">
      <span className="card-title">Splits</span>
      <div className="mt-3">
        <div className="grid items-center gap-3 text-[11px] text-text-muted uppercase tracking-wider pb-2 border-b border-white/[0.06]"
             style={{ gridTemplateColumns: `28px 1fr ${usesPace ? '64px' : ''} 56px ${hasHR ? '40px' : ''}` }}>
          <div>Mi</div>
          <div></div>
          {usesPace && <div className="text-right">Pace</div>}
          <div className="text-right">Elev</div>
          {hasHR && <div className="text-right">HR</div>}
        </div>
        {splits.map((split) => {
          const c = usesPace ? paceColor(split.pace, bestPace, worstPace) : '#00BFA5'
          const range = Math.max(worstPace - bestPace, 1)
          const normalized = usesPace && split.pace > 0 ? (split.pace - bestPace) / range : 0
          const barPct = Math.max(0.06, 1 - normalized)
          return (
            <div
              key={split.id}
              className="grid items-center gap-3 py-2 border-b border-white/[0.04] last:border-0 text-[13px]"
              style={{ gridTemplateColumns: `28px 1fr ${usesPace ? '64px' : ''} 56px ${hasHR ? '40px' : ''}` }}
            >
              <div className="font-mono text-text-secondary">{split.number}</div>
              <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${barPct * 100}%`, background: c }} />
              </div>
              {usesPace && (
                <div className="text-right font-mono" style={{ color: c }}>
                  {formatPace(split.pace)}
                </div>
              )}
              <div className="text-right text-text-secondary text-[12px]">
                +{Math.round(split.elevationGain)}
              </div>
              {hasHR && (
                <div className="text-right text-text-muted text-[12px]">
                  {split.averageHeartRate ?? '—'}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
