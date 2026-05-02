import type { HeartRateZoneDistribution, PaceZoneDistribution } from '../lib/types'

const HR_ZONE_COLORS = ['#88B5D2', '#51CF66', '#FFD43B', '#FFA94D', '#FF6B6B']
const HR_ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2 Max']

function formatZoneTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function HeartRateZones({ zones }: { zones: HeartRateZoneDistribution }) {
  const total =
    zones.zone1Seconds + zones.zone2Seconds + zones.zone3Seconds + zones.zone4Seconds + zones.zone5Seconds
  if (total <= 0) return null

  const seconds = [zones.zone1Seconds, zones.zone2Seconds, zones.zone3Seconds, zones.zone4Seconds, zones.zone5Seconds]

  // Display in reverse so highest intensity reads at the top, matching the iOS layout.
  const order = [4, 3, 2, 1, 0]

  return (
    <div className="panel">
      <span className="card-title">Heart rate zones</span>
      <div className="mt-3 space-y-2">
        {order.map((i) => {
          const pct = seconds[i] / total
          return (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: HR_ZONE_COLORS[i] }}
              >
                Z{i + 1}
              </div>
              <div className="w-[80px] text-text-secondary">{HR_ZONE_NAMES[i]}</div>
              <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(pct * 100, pct > 0 ? 1 : 0)}%`, background: HR_ZONE_COLORS[i] }}
                />
              </div>
              <div
                className="w-9 text-right font-mono text-[11px]"
                style={{ color: pct > 0.1 ? HR_ZONE_COLORS[i] : '#666' }}
              >
                {Math.round(pct * 100)}%
              </div>
              <div className="w-10 text-right font-mono text-[10px] text-text-muted">
                {formatZoneTime(seconds[i])}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const PACE_ZONE_COLORS = ['#51CF66', '#FFD43B', '#FFA94D', '#FF8C42', '#FF6B6B']

export function PaceZones({ zones }: { zones: PaceZoneDistribution }) {
  const data = [
    { name: 'Sprint', seconds: zones.sprintSeconds, color: PACE_ZONE_COLORS[4] },
    { name: 'Threshold', seconds: zones.thresholdSeconds, color: PACE_ZONE_COLORS[3] },
    { name: 'Tempo', seconds: zones.tempoSeconds, color: PACE_ZONE_COLORS[2] },
    { name: 'Moderate', seconds: zones.moderateSeconds, color: PACE_ZONE_COLORS[1] },
    { name: 'Easy', seconds: zones.easySeconds, color: PACE_ZONE_COLORS[0] },
  ]
  const total = data.reduce((acc, d) => acc + d.seconds, 0)
  if (total <= 0) return null

  return (
    <div className="panel">
      <span className="card-title">Pace zones</span>
      <div className="mt-3 space-y-2">
        {data.map((zone) => {
          const pct = zone.seconds / total
          return (
            <div key={zone.name} className="flex items-center gap-2 text-[12px]">
              <div className="w-[80px] text-text-secondary">{zone.name}</div>
              <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(pct * 100, pct > 0 ? 1 : 0)}%`, background: zone.color }}
                />
              </div>
              <div
                className="w-9 text-right font-mono text-[11px]"
                style={{ color: pct > 0.1 ? zone.color : '#666' }}
              >
                {Math.round(pct * 100)}%
              </div>
              <div className="w-10 text-right font-mono text-[10px] text-text-muted">
                {formatZoneTime(zone.seconds)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
