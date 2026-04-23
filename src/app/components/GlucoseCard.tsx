import type { GlucoseReading } from '../lib/types'

interface GlucoseCardProps {
  reading: GlucoseReading
}

const trendArrow: Record<string, string> = {
  'Rising Fast': '↑↑',
  'Rising': '↑',
  'Stable': '→',
  'Falling': '↓',
  'Falling Fast': '↓↓',
}

function statusColor(value: number): string {
  if (value < 70 || value > 180) return '#ff6b61'
  if (value > 140) return '#f5b851'
  return 'var(--color-data)'
}

export function GlucoseCard({ reading }: GlucoseCardProps) {
  const arrow = reading.trend ? trendArrow[reading.trend] ?? '' : ''
  const relMinutes = Math.max(0, Math.round((Date.now() - reading.timestamp.getTime()) / 60000))
  const ago =
    relMinutes < 1
      ? 'just now'
      : relMinutes < 60
      ? `${relMinutes}m ago`
      : relMinutes < 60 * 24
      ? `${Math.floor(relMinutes / 60)}h ago`
      : `${Math.floor(relMinutes / (60 * 24))}d ago`

  return (
    <div className="panel">
      <div className="flex items-center justify-between">
        <span className="card-title">Glucose</span>
        <span className="card-subtext">{reading.source}</span>
      </div>
      <div className="flex items-end gap-3 mt-2">
        <div className="card-number card-number-md" style={{ color: statusColor(reading.value) }}>
          {Math.round(reading.value)}
          <span className="text-text-muted text-[12px] font-normal ml-1">mg/dL</span>
        </div>
        {arrow && <span className="text-[20px] text-text-secondary pb-0.5">{arrow}</span>}
      </div>
      <div className="card-subtext mt-1">{ago}</div>
    </div>
  )
}
