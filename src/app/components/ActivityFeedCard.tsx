import { Link } from 'react-router-dom'
import type { Friend } from '../lib/data/useFriends'
import {
  sportAccentColor,
  sportDisplayName,
  sportUsesGPS,
  sportUsesPace,
  sportUsesSpeed,
  type WorkoutSession,
} from '../lib/types'
import { formatDistance, formatDuration, formatPace, formatRelative } from '../lib/format'
import { RouteMap } from './RouteMap'

interface ActivityFeedCardProps {
  workout: WorkoutSession
  friend?: Friend
  isCurrentUser: boolean
}

function ownerName(workout: WorkoutSession, friend: Friend | undefined, isCurrentUser: boolean): string {
  if (isCurrentUser) return 'You'
  return (
    friend?.social.displayName ||
    friend?.social.username ||
    friend?.social.email ||
    workout.userId.slice(0, 8)
  )
}

function displayTitle(workout: WorkoutSession): string {
  if (workout.title) return workout.title
  const hour = workout.startDate.getHours()
  let timeOfDay = 'Night'
  if (hour >= 5 && hour < 12) timeOfDay = 'Morning'
  else if (hour < 17) timeOfDay = 'Afternoon'
  else if (hour < 21) timeOfDay = 'Evening'
  return `${timeOfDay} ${sportDisplayName(workout.sportType)}`
}

export function ActivityFeedCard({ workout, friend, isCurrentUser }: ActivityFeedCardProps) {
  const accent = sportAccentColor(workout.sportType)
  const route = workout.routeCoordinates
  const canShowMap = sportUsesGPS(workout.sportType) && !workout.isIndoor && route.length >= 2

  return (
    <Link
      to={`/workouts/${workout.userId}/${workout.id}`}
      className="block panel space-y-3 hover:border-white/[0.12] transition-colors"
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: `${accent}26` }}
        >
          <SportIcon sportType={workout.sportType} color={accent} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-text-primary">
            <span className="truncate">{ownerName(workout, friend, isCurrentUser)}</span>
            {isCurrentUser && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ color: '#30d5c8', background: 'rgba(48,213,200,0.12)' }}
              >
                You
              </span>
            )}
          </div>
          <div className="text-[12px] text-text-secondary mt-0.5">{displayTitle(workout)}</div>
        </div>

        <div className="text-[11px] text-text-muted whitespace-nowrap">{formatRelative(workout.startDate)}</div>
      </div>

      {canShowMap && <RouteMap route={route} color={accent} height={160} preview />}

      <MetricsRow workout={workout} />
    </Link>
  )
}

function MetricsRow({ workout }: { workout: WorkoutSession }) {
  const usesPace = sportUsesPace(workout.sportType)
  const usesSpeed = sportUsesSpeed(workout.sportType)

  const items: { value: string; label: string }[] = []
  if (workout.distance > 0) items.push({ value: formatDistance(workout.distance), label: 'Distance' })

  if (usesPace && workout.averagePace > 0) {
    items.push({ value: `${formatPace(workout.averagePace)} /mi`, label: 'Pace' })
  } else if (usesSpeed && workout.averageSpeed > 0) {
    items.push({ value: `${workout.averageSpeed.toFixed(1)} mph`, label: 'Speed' })
  }

  if (workout.duration > 0) items.push({ value: formatDuration(workout.duration), label: 'Time' })
  if (workout.elevationGain > 0) {
    items.push({ value: `${Math.round(workout.elevationGain)} ft`, label: 'Elev' })
  }
  if (workout.averageHeartRate > 0) {
    items.push({ value: `${workout.averageHeartRate}`, label: 'Avg HR' })
  }

  if (items.length === 0) return null

  return (
    <div className="grid grid-flow-col auto-cols-fr divide-x divide-white/[0.05] bg-white/[0.02] rounded-lg py-2">
      {items.map((item) => (
        <div key={item.label} className="text-center px-2">
          <div className="font-display font-bold text-[14px] tracking-tight">{item.value}</div>
          <div className="text-[10px] text-text-muted mt-0.5">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function SportIcon({ sportType, color }: { sportType: string; color: string }) {
  const path = sportPathD(sportType)
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill={color} aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

/** Hand-rolled glyphs that suggest the sport without pulling in an icon font.
 *  Mirrors the SF Symbols choices in iOS at a glance — runner, cyclist, swimmer,
 *  hiker, dumbbell — falling back to a generic spark. */
function sportPathD(sportType: string): string {
  switch (sportType) {
    case 'running':
    case 'trailRunning':
      return 'M13 4a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm-2.6 4 3-1.5 1.6.7 1.5 3 2.5 1V13l-3.5-1.4-1 2.4 2.5 2.4L17 22h-2l-1.6-4.4-3-2.6-1 4-3.6 3-1.4-1.4 3.6-3.6.6-3.6L8 13l-2 4-1.7-1L7 11l3.4-3Z'
    case 'cycling':
    case 'roadCycling':
    case 'mountainBiking':
      return 'M5 18a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm14 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM10 6h3l1.5 3H17l-2-4h-5v1Zm.5 4 1.5 4-2 1-2-3-3 2v-2.4l3-2L9 6 7 8H5V6h3l3.5 4Z'
    case 'swimming':
      return 'M3 18s2-1 3-1 1.5 1 3 1 2-1 3-1 1.5 1 3 1 2-1 3-1 2 1 3 1v2c-1 0-2-1-3-1s-2 1-3 1-2-1-3-1-2 1-3 1-1.5-1-3-1-2 1-3 1v-2Zm0-4s2-1 3-1 1.5 1 3 1 2-1 3-1 1.5 1 3 1 2-1 3-1 2 1 3 1v2c-1 0-2-1-3-1s-2 1-3 1-2-1-3-1-2 1-3 1-1.5-1-3-1-2 1-3 1v-2ZM18 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM7 7l4 2-3 2 1 3-3-1-1-3 2-3Z'
    case 'hiking':
      return 'M14 4a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm-3 5 3.5-1.5L17 8l1.5 3L21 12v2l-3-.5-1-2-1 2 1.5 3 .5 5h-2l-.5-4-3-2-1.5 3.5L8 23l-1.5-1L9 18l1-4-1-2-2 3-2-2 3-3 3-1Z'
    case 'strengthTraining':
    case 'crossfit':
    case 'hiit':
      return 'M3 10h2V8H3v2Zm4-4v12h2V6H7Zm4 2v8h2V8h-2Zm4-2v12h2V6h-2Zm4 4v2h2v-2h-2Z'
    default:
      return 'M12 2 14.5 9.5 22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z'
  }
}
