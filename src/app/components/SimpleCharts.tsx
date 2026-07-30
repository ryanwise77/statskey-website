import { useMemo, useState } from 'react'

export interface BarDatum {
  label: string
  value: number
}

/** Minimal dependency-free bar chart tuned for app panels. */
export function BarChart({
  data,
  height = 140,
  color = 'var(--color-accent)',
  target,
  formatValue = (v: number) => String(Math.round(v)),
}: {
  data: BarDatum[]
  height?: number
  color?: string
  /** Optional horizontal target line. */
  target?: number
  formatValue?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = useMemo(() => {
    const m = Math.max(...data.map((d) => d.value), target ?? 0)
    return m > 0 ? m * 1.1 : 1
  }, [data, target])

  if (data.length === 0) {
    return <p className="text-text-muted text-[13px]">No data in this range.</p>
  }

  const width = 600
  const chartH = height - 22
  const gap = data.length > 40 ? 1 : 3
  const barW = Math.max(1, (width - gap * (data.length - 1)) / data.length)

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        {target != null && target > 0 && (
          <line
            x1={0}
            x2={width}
            y1={chartH - (target / max) * chartH}
            y2={chartH - (target / max) * chartH}
            stroke="var(--app-chart-grid, rgba(255,255,255,0.25))"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * chartH)
          const x = i * (barW + gap)
          return (
            <rect
              key={i}
              x={x}
              y={chartH - h}
              width={barW}
              height={h}
              rx={Math.min(3, barW / 3)}
              fill={color}
              opacity={hover === null || hover === i ? 0.9 : 0.35}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          )
        })}
        <text x={0} y={height - 6} fontSize={10} fill="var(--app-chart-muted, rgba(255,255,255,0.4))">
          {data[0].label}
        </text>
        <text x={width} y={height - 6} fontSize={10} fill="var(--app-chart-muted, rgba(255,255,255,0.4))" textAnchor="end">
          {data[data.length - 1].label}
        </text>
      </svg>
      <div className="text-[11px] text-text-muted h-4 mt-1">
        {hover != null && data[hover]
          ? `${data[hover].label}: ${formatValue(data[hover].value)}`
          : '\u00A0'}
      </div>
    </div>
  )
}

export interface LinePoint {
  x: number // 0..1 position
  y: number // raw value
  label?: string
}

/** Minimal line chart for trends (weight, glucose). */
export function LineChart({
  points,
  height = 140,
  color = 'var(--color-data)',
  bandLow,
  bandHigh,
  formatValue = (v: number) => String(Math.round(v)),
}: {
  points: LinePoint[]
  height?: number
  color?: string
  /** Optional shaded reference band (e.g. glucose 70–180). */
  bandLow?: number
  bandHigh?: number
  formatValue?: (v: number) => string
}) {
  const width = 600
  const chartH = height - 8

  const { min, max } = useMemo(() => {
    if (points.length === 0) return { min: 0, max: 1 }
    let lo = Math.min(...points.map((p) => p.y))
    let hi = Math.max(...points.map((p) => p.y))
    if (bandLow != null) lo = Math.min(lo, bandLow)
    if (bandHigh != null) hi = Math.max(hi, bandHigh)
    const pad = Math.max((hi - lo) * 0.12, 1)
    return { min: lo - pad, max: hi + pad }
  }, [points, bandLow, bandHigh])

  if (points.length === 0) {
    return <p className="text-text-muted text-[13px]">No data in this range.</p>
  }

  const yFor = (v: number) => chartH - ((v - min) / (max - min)) * (chartH - 8) - 4
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * width).toFixed(1)},${yFor(p.y).toFixed(1)}`)
    .join(' ')

  const first = points[0]
  const last = points[points.length - 1]

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        {bandLow != null && bandHigh != null && (
          <rect
            x={0}
            width={width}
            y={yFor(bandHigh)}
            height={Math.max(0, yFor(bandLow) - yFor(bandHigh))}
            fill="var(--app-chart-band, rgba(48,213,200,0.07))"
          />
        )}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {points.length <= 60 &&
          points.map((p, i) => (
            <circle key={i} cx={p.x * width} cy={yFor(p.y)} r={2.4} fill={color} />
          ))}
      </svg>
      <div className="flex justify-between text-[11px] text-text-muted mt-1">
        <span>{first.label ?? formatValue(first.y)}</span>
        <span>
          {formatValue(last.y)}
          {last.label ? ` · ${last.label}` : ''}
        </span>
      </div>
    </div>
  )
}
