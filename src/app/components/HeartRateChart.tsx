import { useMemo } from 'react'
import type { HeartRateSample } from '../lib/types'

interface HeartRateChartProps {
  samples: HeartRateSample[]
  averageBPM: number
  maxBPM: number
  /** Sport accent for the average reference line. */
  color: string
}

/** Visually compress a long series of samples to roughly `target` points using
 *  uniform stride sampling — same idea as iOS `downsampleHR`. */
function downsample(samples: HeartRateSample[], target: number): HeartRateSample[] {
  if (samples.length <= target) return samples
  const step = samples.length / target
  return Array.from({ length: target }, (_, i) =>
    samples[Math.min(Math.round(i * step), samples.length - 1)]
  )
}

const HR_ZONE_COLORS = {
  z2: '#51CF66',
  z3: '#FFD43B',
  z4: '#FFA94D',
  z5: '#FF6B6B',
}

export function HeartRateChart({ samples, averageBPM, maxBPM, color }: HeartRateChartProps) {
  const downsampled = useMemo(() => downsample(samples, 180), [samples])

  if (downsampled.length < 2) {
    return (
      <div className="flex items-center justify-around py-3">
        <div className="text-center">
          <div className="font-display text-[28px] font-bold tracking-tight">{averageBPM}</div>
          <div className="text-[11px] text-text-muted mt-1">Avg bpm</div>
        </div>
        <div className="text-center">
          <div className="font-display text-[28px] font-bold tracking-tight" style={{ color: HR_ZONE_COLORS.z5 }}>
            {maxBPM}
          </div>
          <div className="text-[11px] text-text-muted mt-1">Max bpm</div>
        </div>
      </div>
    )
  }

  const bpms = downsampled.map((s) => s.bpm)
  const minBPM = Math.max(40, Math.min(...bpms) - 10)
  const max = Math.min(220, Math.max(...bpms) + 10)
  const bpmRange = max - minBPM

  const startTime = downsampled[0].timestamp.getTime()
  const endTime = downsampled[downsampled.length - 1].timestamp.getTime()
  const totalDuration = Math.max(1, endTime - startTime)

  const W = 600
  const H = 160
  const PADDING_L = 30
  const PADDING_R = 8
  const PADDING_T = 6
  const PADDING_B = 18
  const chartW = W - PADDING_L - PADDING_R
  const chartH = H - PADDING_T - PADDING_B

  const xFor = (t: number) => PADDING_L + ((t - startTime) / totalDuration) * chartW
  const yFor = (bpm: number) => PADDING_T + chartH - ((bpm - minBPM) / Math.max(bpmRange, 1)) * chartH

  // Build the line path
  const linePath = downsampled
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${xFor(s.timestamp.getTime()).toFixed(1)},${yFor(s.bpm).toFixed(1)}`)
    .join(' ')

  // Closed area path
  const firstX = xFor(downsampled[0].timestamp.getTime()).toFixed(1)
  const lastX = xFor(downsampled[downsampled.length - 1].timestamp.getTime()).toFixed(1)
  const baseY = (PADDING_T + chartH).toFixed(1)
  const areaPath = `M${firstX},${baseY} ${linePath.slice(1)} L${lastX},${baseY} Z`

  // Y-axis labels — pick 4 evenly-spaced ticks
  const yTicks = [0, 1, 2, 3].map((i) => Math.round(minBPM + (bpmRange * i) / 3))

  const avgY = averageBPM > 0 ? yFor(averageBPM) : null
  const maxY = maxBPM > 0 ? yFor(maxBPM) : null

  const totalSeconds = totalDuration / 1000
  const timeLabels = ['0:00', formatChartTime(totalSeconds / 2), formatChartTime(totalSeconds)]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
      {yTicks.map((bpm) => {
        const y = yFor(bpm)
        return (
          <g key={bpm}>
            <text x={PADDING_L - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--app-chart-muted, #666)"
                  style={{ fontFamily: 'monospace' }}>
              {bpm}
            </text>
            <line x1={PADDING_L} y1={y} x2={W - PADDING_R} y2={y} stroke="var(--app-chart-grid, #333)" strokeWidth="0.5" />
          </g>
        )
      })}

      <path d={areaPath} fill="url(#hrAreaGradient)" />
      <defs>
        <linearGradient id="hrAreaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={HR_ZONE_COLORS.z5} stopOpacity="0.2" />
          <stop offset="100%" stopColor={HR_ZONE_COLORS.z5} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="hrLineGradient" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={HR_ZONE_COLORS.z2} />
          <stop offset="33%" stopColor={HR_ZONE_COLORS.z3} />
          <stop offset="66%" stopColor={HR_ZONE_COLORS.z4} />
          <stop offset="100%" stopColor={HR_ZONE_COLORS.z5} />
        </linearGradient>
      </defs>

      <path d={linePath} fill="none" stroke="url(#hrLineGradient)" strokeWidth="1.5" />

      {avgY != null && (
        <line
          x1={PADDING_L}
          y1={avgY}
          x2={W - PADDING_R}
          y2={avgY}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.6"
        />
      )}
      {maxY != null && (
        <line
          x1={PADDING_L}
          y1={maxY}
          x2={W - PADDING_R}
          y2={maxY}
          stroke={HR_ZONE_COLORS.z5}
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity="0.4"
        />
      )}

      {timeLabels.map((label, i) => (
        <text
          key={i}
          x={PADDING_L + (chartW * i) / (timeLabels.length - 1)}
          y={H - 4}
          textAnchor={i === 0 ? 'start' : i === timeLabels.length - 1 ? 'end' : 'middle'}
          fontSize="9"
          fill="var(--app-chart-muted, #666)"
        >
          {label}
        </text>
      ))}
    </svg>
  )
}

function formatChartTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}:${String(s).padStart(2, '0')}`
}
