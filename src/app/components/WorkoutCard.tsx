import { Link } from 'react-router-dom'
import { sportAccentColor, sportDisplayName, type WorkoutSession } from '../lib/types'
import { SportIcon, WorkoutCardBody, displayTitle } from './ActivityFeedCard'

interface WorkoutCardProps {
  workout: WorkoutSession
}

/**
 * The personal "my workouts" card — same map preview + metrics as the friend
 * feed card, but the header is just sport icon + title + start time. No
 * owner name, no "You" badge, since the surface (Dashboard, History) is
 * already scoped to the viewer.
 */
export function WorkoutCard({ workout }: WorkoutCardProps) {
  const accent = sportAccentColor(workout.sportType)
  const formatted = workout.startDate.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

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
          <div className="text-[14px] font-semibold text-text-primary truncate">
            {workout.title || displayTitle(workout)}
          </div>
          <div className="text-[12px] text-text-secondary mt-0.5">
            {formatted} · {sportDisplayName(workout.sportType)}
            {workout.isIndoor && ' · Indoor'}
          </div>
        </div>
      </div>

      <WorkoutCardBody workout={workout} accent={accent} />
    </Link>
  )
}
