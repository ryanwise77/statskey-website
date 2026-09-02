import { sportUsesPace } from '../types'
import type { SavedRoute, WorkoutSession } from '../types'

/**
 * Shared "where / when / how" description of a workout for the Intelligence
 * agent: the inline system-prompt line (context.ts) and the tool payloads
 * (tools.ts) both derive from these helpers so the model sees the same facts
 * — local date and start/end time, sport, distance, pace or speed, heart
 * rate, elevation, start/end coordinates, recording source, and any saved
 * route the session started on.
 */

export interface GeoPoint {
  lat: number
  lon: number
}

export function localTimeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'
  } catch {
    return 'local time'
  }
}

export function fmtLocalDate(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtLocalTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function timeOfDayLabel(d: Date): string {
  const h = d.getHours()
  if (h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'night'
}

/** End of the session; falls back to start + active duration when the record has no endDate. */
export function workoutEndDate(w: WorkoutSession): Date {
  if (w.endDate) return w.endDate
  return new Date(w.startDate.getTime() + Math.max(0, w.duration) * 1000)
}

export function formatPaceSeconds(secondsPerMile: number): string {
  const total = Math.round(secondsPerMile)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Pace for foot sports, speed for everything else (bikes, e-bikes, skiing…). */
export function paceOrSpeedLabel(w: WorkoutSession): string | null {
  if (sportUsesPace(w.sportType)) {
    if (w.averagePace > 0) return `${formatPaceSeconds(w.averagePace)}/mi`
    if (w.averageSpeed > 0) return `${w.averageSpeed.toFixed(1)} mph`
    return null
  }
  if (w.averageSpeed > 0) return `${w.averageSpeed.toFixed(1)} mph`
  if (w.averagePace > 0) return `${formatPaceSeconds(w.averagePace)}/mi`
  return null
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

export function workoutStartPoint(w: WorkoutSession): GeoPoint | null {
  const p = w.routeCoordinates[0]
  return p ? { lat: round4(p.latitude), lon: round4(p.longitude) } : null
}

export function workoutEndPoint(w: WorkoutSession): GeoPoint | null {
  const p = w.routeCoordinates[w.routeCoordinates.length - 1]
  return p ? { lat: round4(p.latitude), lon: round4(p.longitude) } : null
}

export function sourceLabel(source: string): string {
  switch (source) {
    case 'appleWatch':
      return 'StatsKey Watch app'
    case 'healthKit':
      return 'Apple Health import'
    case 'gps':
      return 'StatsKey iPhone GPS'
    case 'wearOS':
      return 'StatsKey Wear OS'
    case 'imported':
      return 'imported file'
    case 'manual':
      return 'manual entry'
    default:
      return source
  }
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface NearbySavedRoute {
  route_id: string
  name: string
  route_distance_mi: number
  start_offset_m: number
}

/** The saved route whose start is closest to this session's start, within maxMeters. */
export function nearbySavedRoute(
  w: WorkoutSession,
  routes: SavedRoute[],
  maxMeters = 300
): NearbySavedRoute | null {
  const start = workoutStartPoint(w)
  if (!start) return null
  let best: NearbySavedRoute | null = null
  for (const r of routes) {
    const p = r.routePoints[0]
    if (!p) continue
    const d = distanceMeters(start, { lat: p.latitude, lon: p.longitude })
    if (d <= maxMeters && (!best || d < best.start_offset_m)) {
      best = {
        route_id: r.id,
        name: r.name,
        route_distance_mi: Math.round(r.distance * 100) / 100,
        start_offset_m: Math.round(d),
      }
    }
  }
  return best
}

/** One system-prompt line: when, what, how far/fast/hard, where, from which device, and the id for tools. */
export function formatWorkoutContextLine(w: WorkoutSession): string {
  const end = workoutEndDate(w)
  const parts: string[] = []
  parts.push(`${fmtLocalDate(w.startDate)} ${fmtLocalTime(w.startDate)}–${fmtLocalTime(end)} (${timeOfDayLabel(w.startDate)})`)
  parts.push(`${w.sportType}${w.title ? ` "${w.title}"` : ''}${w.isIndoor ? ' (indoor)' : ''}`)
  const dist = w.distance > 0 ? `${w.distance.toFixed(2)} mi` : ''
  const dur = w.duration > 0 ? `${Math.round(w.duration / 60)} min` : ''
  if (dist || dur) parts.push([dist, dur].filter(Boolean).join(' in '))
  const pace = paceOrSpeedLabel(w)
  if (pace) parts.push(`avg ${pace}`)
  if (w.averageHeartRate > 0) {
    parts.push(`avg HR ${Math.round(w.averageHeartRate)}${w.maxHeartRate > 0 ? ` (max ${Math.round(w.maxHeartRate)})` : ''}`)
  }
  if (w.elevationGain > 0) parts.push(`+${Math.round(w.elevationGain)} ft`)
  if (w.calories > 0) parts.push(`${Math.round(w.calories)} cal`)
  const start = workoutStartPoint(w)
  parts.push(start ? `start ${start.lat},${start.lon}` : 'no GPS route')
  parts.push(sourceLabel(w.source))
  parts.push(`id ${w.id}`)
  return `  ${parts.join(' · ')}`
}
