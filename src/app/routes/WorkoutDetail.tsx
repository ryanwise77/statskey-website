import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useWorkoutDetail } from '../lib/data/useWorkoutDetail'
import type { WorkoutSession } from '../lib/types'

export function WorkoutDetail() {
  const { user } = useAuth()
  const { id } = useParams<{ id: string }>()
  const { workout, loading, notFound, error } = useWorkoutDetail(user?.uid, id)

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (notFound || !workout)
    return (
      <div className="panel">
        <p className="text-text-secondary text-[14px]">Workout not found.</p>
        <Link to="/" className="link text-[13px] mt-3 inline-block">← Back to dashboard</Link>
      </div>
    )

  const time = workout.startDate.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="space-y-6 max-w-[720px]">
      <header>
        <Link to="/" className="text-text-muted hover:text-text-primary text-[12px]">← Dashboard</Link>
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] mt-1">
          {workout.title || workout.sportType || 'Workout'}
        </h1>
        <p className="text-text-secondary text-[13px] mt-1">
          {time} · {workout.sportType}
          {workout.isIndoor && ' · Indoor'}
          {` · ${sourceLabel(workout.source)}`}
        </p>
      </header>

      <div className="panel grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
        {workout.distance > 0 && <Stat label="Distance" value={`${workout.distance.toFixed(2)} mi`} />}
        {workout.duration > 0 && <Stat label="Duration" value={formatDuration(workout.duration)} />}
        {workout.movingTime > 0 && workout.movingTime !== workout.duration && (
          <Stat label="Moving" value={formatDuration(workout.movingTime)} />
        )}
        {workout.averagePace > 0 && <Stat label="Avg pace" value={formatPace(workout.averagePace)} />}
        {workout.bestPace > 0 && workout.bestPace !== workout.averagePace && (
          <Stat label="Best pace" value={formatPace(workout.bestPace)} />
        )}
        {workout.averageHeartRate > 0 && <Stat label="Avg HR" value={`${workout.averageHeartRate} bpm`} />}
        {workout.maxHeartRate > 0 && <Stat label="Max HR" value={`${workout.maxHeartRate} bpm`} />}
        {workout.elevationGain > 0 && <Stat label="Elev gain" value={`${Math.round(workout.elevationGain)} ft`} />}
        {workout.calories > 0 && <Stat label="Calories" value={Math.round(workout.calories)} />}
      </div>

      {workout.notes && (
        <div className="panel">
          <span className="card-title">Notes</span>
          <p className="text-text-primary text-[14px] mt-2 whitespace-pre-wrap">{workout.notes}</p>
        </div>
      )}

      {workout.photoURLs.length > 0 && (
        <div className="panel">
          <span className="card-title">Photos</span>
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {workout.photoURLs.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="h-32 rounded-md border border-white/5"
                loading="lazy"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="card-subtext">{label}</div>
      <div className="card-number card-number-md mt-1">{value}</div>
    </div>
  )
}

function sourceLabel(src: WorkoutSession['source']): string {
  switch (src) {
    case 'gps': return 'GPS'
    case 'appleWatch': return 'Apple Watch'
    case 'healthKit': return 'Apple Health'
    case 'imported': return 'Imported'
    case 'manual':
    default: return 'Manual'
  }
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function formatPace(secondsPerMile: number): string {
  const m = Math.floor(secondsPerMile / 60)
  const s = Math.round(secondsPerMile % 60)
  return `${m}:${String(s).padStart(2, '0')} /mi`
}
