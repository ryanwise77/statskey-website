import type { HealthDaily } from '../lib/data/useHealthDaily'

interface ActivityCardProps {
  health: HealthDaily | null
  exists: boolean
}

// Apple's default ring targets. User-level custom targets aren't synced to
// Firestore today; iOS pulls them from HealthKit's ActivitySummary.
// 500 kcal / 30 min / 12 stand hrs matches the Apple Watch defaults.
const DEFAULT_MOVE = 500
const DEFAULT_EXERCISE = 30
const DEFAULT_STAND = 12

export function ActivityCard({ health, exists }: ActivityCardProps) {
  const move = health?.activeCalories ?? 0
  const exercise = health?.exerciseMinutes ?? 0
  const stand = health?.standHours ?? 0

  return (
    <div className="panel">
      <div className="flex items-center justify-between">
        <span className="card-title">Activity</span>
        <span className="card-subtext">{exists ? 'Apple Health' : 'Not synced'}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Ring
          label="Move"
          value={move}
          target={DEFAULT_MOVE}
          unit="cal"
          color="#ff3b30"
        />
        <Ring
          label="Exercise"
          value={exercise}
          target={DEFAULT_EXERCISE}
          unit="min"
          color="#a8e063"
        />
        <Ring
          label="Stand"
          value={stand}
          target={DEFAULT_STAND}
          unit="hr"
          color="#5ac8fa"
        />
      </div>

      {!exists && (
        <p className="text-text-muted text-[12px] mt-3">
          Activity data syncs from your iPhone's Apple Health. Open StatsKey on iOS to sync.
        </p>
      )}

      {exists && (
        <div className="mt-4 grid grid-cols-3 text-center text-[12px] text-text-muted">
          <div>
            <div className="text-text-primary">{(health?.steps ?? 0).toLocaleString()}</div>
            <div>steps</div>
          </div>
          <div>
            <div className="text-text-primary">{(health?.distanceMilesWalkingRunning ?? 0).toFixed(1)}</div>
            <div>mi walk/run</div>
          </div>
          <div>
            <div className="text-text-primary">{health?.flightsClimbed ?? 0}</div>
            <div>floors</div>
          </div>
        </div>
      )}
    </div>
  )
}

function Ring({ label, value, target, unit, color }: { label: string; value: number; target: number; unit: string; color: string }) {
  const pct = target > 0 ? Math.min(1, value / target) : 0
  const size = 72
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct)

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="text-[11px] text-text-muted mt-1">{label}</div>
      <div className="text-[13px] text-text-primary font-variant-numeric-tabular">
        {Math.round(value)}<span className="text-text-muted text-[10px]"> / {target}{unit}</span>
      </div>
    </div>
  )
}
