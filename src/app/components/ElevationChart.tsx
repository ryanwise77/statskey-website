import { useMemo } from 'react'
import type { RoutePoint } from '../lib/types'

interface ElevationChartProps {
  route: RoutePoint[]
  /** Sport accent — used for area fill + stroke. */
  color: string
  elevationGain: number
  elevationLoss: number
}

const METERS_TO_FEET = 3.28084
const METERS_TO_MILES = 1 / 1609.344

/** Compute the (cumulativeMiles, elevationFeet) profile for a route. Same
 *  formula iOS uses in WorkoutSession.elevationProfile. */
function computeProfile(route: RoutePoint[]): { distance: number; elevation: number }[] {
  if (route.length < 2) return []
  const profile = [{ distance: 0, elevation: route[0].altitude * METERS_TO_FEET }]
  let cumulative = 0
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    cumulative += haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude) * METERS_TO_MILES
    profile.push({ distance: cumulative, elevation: b.altitude * METERS_TO_FEET })
  }
  return profile
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function ElevationChart({ route, color, elevationGain, elevationLoss }: ElevationChartProps) {
  const profile = useMemo(() => computeProfile(route), [route])
  if (profile.length < 2) return null

  const elevations = profile.map((p) => p.elevation)
  const rawMin = Math.min(...elevations)
  const rawMax = Math.max(...elevations)
  const padding = Math.max((rawMax - rawMin) * 0.1, 5)
  const minElev = rawMin - padding
  const maxElev = rawMax + padding
  const elevRange = Math.max(maxElev - minElev, 1)
  const maxDist = profile[profile.length - 1].distance || 1

  const W = 600
  const H = 150
  const PADDING_L = 38
  const PADDING_R = 8
  const PADDING_T = 6
  const PADDING_B = 18
  const chartW = W - PADDING_L - PADDING_R
  const chartH = H - PADDING_T - PADDING_B

  const xFor = (d: number) => PADDING_L + (d / maxDist) * chartW
  const yFor = (e: number) => PADDING_T + chartH - ((e - minElev) / elevRange) * chartH

  const linePath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(p.distance).toFixed(1)},${yFor(p.elevation).toFixed(1)}`)
    .join(' ')

  const baseY = (PADDING_T + chartH).toFixed(1)
  const firstX = xFor(0).toFixed(1)
  const lastX = xFor(maxDist).toFixed(1)
  const areaPath = `M${firstX},${baseY} ${linePath.slice(1)} L${lastX},${baseY} Z`

  const yTicks = [0, 1, 2, 3].map((i) => Math.round(rawMin + ((rawMax - rawMin) * i) / 3))

  return (
    <div className="panel">
      <div className="flex items-baseline justify-between">
        <span className="card-title">Elevation</span>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="text-text-secondary">
            <span style={{ color: '#137a55' }}>↑</span> {Math.round(elevationGain)} ft
          </span>
          <span className="text-text-secondary">
            <span style={{ color: '#b42318' }}>↓</span> {Math.round(elevationLoss)} ft
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full mt-3" style={{ height: H }}>
        {yTicks.map((elev) => {
          const y = yFor(elev)
          return (
            <g key={elev}>
              <text x={PADDING_L - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--app-chart-muted, #666)"
                    style={{ fontFamily: 'monospace' }}>
                {elev}
              </text>
              <line x1={PADDING_L} y1={y} x2={W - PADDING_R} y2={y} stroke="var(--app-chart-grid, #333)" strokeWidth="0.5" />
            </g>
          )
        })}

        <defs>
          <linearGradient id="elevAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.03" />
          </linearGradient>
        </defs>

        <path d={areaPath} fill="url(#elevAreaGradient)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />

        <text x={PADDING_L} y={H - 4} fontSize="9" fill="var(--app-chart-muted, #666)" textAnchor="start">0</text>
        {maxDist > 2 && (
          <text x={PADDING_L + chartW / 2} y={H - 4} fontSize="9" fill="var(--app-chart-muted, #666)" textAnchor="middle">
            {(maxDist / 2).toFixed(1)}
          </text>
        )}
        <text x={W - PADDING_R} y={H - 4} fontSize="9" fill="var(--app-chart-muted, #666)" textAnchor="end">
          {maxDist.toFixed(1)} mi
        </text>
      </svg>
    </div>
  )
}
