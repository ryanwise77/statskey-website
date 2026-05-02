export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function formatPace(secondsPerMile: number): string {
  if (!secondsPerMile || !isFinite(secondsPerMile) || secondsPerMile <= 0) return '--:--'
  const m = Math.floor(secondsPerMile / 60)
  const s = Math.round(secondsPerMile % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDistance(miles: number): string {
  if (miles <= 0) return '--'
  if (miles >= 1) return `${miles.toFixed(2)} mi`
  return `${Math.round(miles * 5280)} ft`
}

/** Same heuristic the iOS feed card uses to pick a relative-time label. */
export function formatRelative(date: Date): string {
  const interval = (Date.now() - date.getTime()) / 1000
  if (interval < 60) return 'just now'
  if (interval < 3600) return `${Math.floor(interval / 60)}m ago`
  if (interval < 86_400) return `${Math.floor(interval / 3600)}h ago`
  if (interval < 604_800) return `${Math.floor(interval / 86_400)}d ago`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
