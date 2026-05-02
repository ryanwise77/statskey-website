import { Link } from 'react-router-dom'
import type { WorkoutSession } from '../lib/types'

interface WorkoutRowProps {
  workout: WorkoutSession
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s > 0 && m < 10 ? `${s}s` : ''}`.trim()
  return `${s}s`
}

function formatPace(secondsPerMile: number): string | undefined {
  if (!secondsPerMile || !isFinite(secondsPerMile)) return undefined
  const m = Math.floor(secondsPerMile / 60)
  const s = Math.round(secondsPerMile % 60)
  return `${m}:${String(s).padStart(2, '0')} /mi`
}

function formatDate(d: Date): string {
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 1 && d.getDate() === now.getDate()) return 'Today'
  if (diffDays < 2) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function WorkoutRow({ workout }: WorkoutRowProps) {
  const pace = formatPace(workout.averagePace)
  const distance = workout.distance > 0 ? `${workout.distance.toFixed(2)} mi` : undefined
  const duration = workout.duration > 0 ? formatDuration(workout.duration) : undefined

  return (
    <Link
      to={`/workouts/${workout.userId}/${workout.id}`}
      className="workout-row hover:bg-white/[0.02] transition-colors px-3 -mx-3 rounded-md"
    >
      <div>
        <div className="workout-title">{workout.title || workout.sportType || 'Workout'}</div>
        <div className="workout-sub">
          {formatDate(workout.startDate)}
          {workout.sportType && ` · ${workout.sportType}`}
          {workout.isIndoor && ' · Indoor'}
        </div>
      </div>
      <div className="workout-metrics">
        <div>
          {distance && <span>{distance}</span>}
          {distance && duration && ' · '}
          {duration && <span>{duration}</span>}
        </div>
        {(pace || workout.calories > 0) && (
          <div className="text-text-muted">
            {pace}
            {pace && workout.calories > 0 && ' · '}
            {workout.calories > 0 && `${Math.round(workout.calories)} cal`}
          </div>
        )}
      </div>
    </Link>
  )
}
