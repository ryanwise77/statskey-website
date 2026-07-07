import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useWorkoutDetail } from '../lib/data/useWorkoutDetail'
import { useWorkoutRoute } from '../lib/data/useWorkoutRoute'
import { useWorkoutSamples } from '../lib/data/useWorkoutSamples'
import { useWorkoutSocial } from '../lib/data/useWorkoutSocial'
import { addWorkoutComment, deleteWorkout, newId, toggleWorkoutKudo } from '../lib/writers'
import {
  sportAccentColor,
  sportDisplayName,
  sportUsesGPS,
  sportUsesPace,
  sportUsesSpeed,
  type WorkoutComment,
  type WorkoutKudo,
  type WorkoutSession,
} from '../lib/types'
import { formatDistance, formatDuration, formatPace } from '../lib/format'
import { RouteMap } from '../components/RouteMap'
import { SplitsTable } from '../components/SplitsTable'
import { HeartRateChart } from '../components/HeartRateChart'
import { ElevationChart } from '../components/ElevationChart'
import { HeartRateZones, PaceZones } from '../components/ZoneBars'
import { WorkoutLogForm } from '../components/log/WorkoutLogForm'

export function WorkoutDetail() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const { ownerUid, id } = useParams<{ ownerUid: string; id: string }>()
  const { workout, loading, notFound, error } = useWorkoutDetail(ownerUid, id)
  const { route, loading: routeLoading } = useWorkoutRoute(workout)
  const { heartRateSamples } = useWorkoutSamples(workout)
  const social = useWorkoutSocial(ownerUid, id)
  const [isEditing, setIsEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (notFound || !workout) {
    return (
      <div className="panel">
        <p className="text-text-secondary text-[14px]">Workout not found.</p>
        <Link to="/" className="link text-[13px] mt-3 inline-block">← Back to dashboard</Link>
      </div>
    )
  }

  const accent = sportAccentColor(workout.sportType)
  const usesPace = sportUsesPace(workout.sportType)
  const usesSpeed = sportUsesSpeed(workout.sportType)
  const usesGPS = sportUsesGPS(workout.sportType) && !workout.isIndoor
  const isOwner = user?.uid === ownerUid

  const time = workout.startDate.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  async function handleDelete() {
    if (!user || !isOwner || deleting || !workout) return
    if (!window.confirm('Delete this workout? This cannot be undone.')) return
    setDeleting(true)
    setActionError(null)
    try {
      await deleteWorkout(user.uid, workout.id)
      navigate('/history', { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  if (isEditing && isOwner) {
    return (
      <div className="space-y-6 max-w-[760px]">
        <header>
          <button
            className="text-text-muted hover:text-text-primary text-[12px]"
            type="button"
            onClick={() => setIsEditing(false)}
          >
            ← Back to workout
          </button>
          <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] mt-1">Edit Workout</h1>
        </header>
        <div className="panel">
          <WorkoutLogForm
            initialWorkout={workout}
            onSaved={() => setIsEditing(false)}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-[760px]">
      <header>
        <Link
          to={isOwner ? '/' : '/friends'}
          className="text-text-muted hover:text-text-primary text-[12px]"
        >
          ← {isOwner ? 'Dashboard' : 'Friends'}
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-[16px] font-bold"
            style={{ background: `${accent}26`, color: accent }}
          >
            {sportDisplayName(workout.sportType)[0]}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-[24px] font-bold tracking-[-0.02em] truncate">
              {workout.title || displayTitle(workout)}
            </h1>
            <p className="text-text-secondary text-[13px] mt-0.5">
              {time} · {sportDisplayName(workout.sportType)}
              {workout.isIndoor && ' · Indoor'}
              {` · ${sourceLabel(workout.source)}`}
            </p>
          </div>
          {isOwner && (
            <div className="flex gap-2">
              <button
                className="btn btn-secondary text-[12px] !py-1.5 !px-3"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </button>
              <button
                className="btn btn-ghost text-[12px] !py-1.5 !px-3 text-red-300"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      </header>

      {actionError && <div className="error-banner">{actionError}</div>}

      {usesGPS && (
        route.length >= 2 ? (
          <RouteMap route={route} color={accent} height={260} />
        ) : routeLoading ? (
          <div
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-text-muted text-[12px]"
            style={{ height: 260 }}
          >
            Loading route…
          </div>
        ) : null
      )}

      <KeyMetrics workout={workout} usesPace={usesPace} usesSpeed={usesSpeed} accent={accent} />

      {workout.splits.length > 0 && <SplitsTable splits={workout.splits} usesPace={usesPace} />}

      {(heartRateSamples.length > 0 || workout.averageHeartRate > 0) && (
        <div className="panel">
          <div className="flex items-baseline justify-between">
            <span className="card-title">Heart rate</span>
            <div className="flex items-center gap-3 text-[12px]">
              {workout.averageHeartRate > 0 && (
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                  Avg {workout.averageHeartRate}
                </span>
              )}
              {workout.maxHeartRate > 0 && (
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#FF6B6B' }} />
                  Max {workout.maxHeartRate}
                </span>
              )}
            </div>
          </div>
          <div className="mt-3">
            <HeartRateChart
              samples={heartRateSamples}
              averageBPM={workout.averageHeartRate}
              maxBPM={workout.maxHeartRate}
              color={accent}
            />
          </div>
        </div>
      )}

      {workout.heartRateZones && <HeartRateZones zones={workout.heartRateZones} />}

      {workout.paceZones && usesPace && <PaceZones zones={workout.paceZones} />}

      {route.length >= 2 && workout.elevationGain + workout.elevationLoss > 0 && (
        <ElevationChart
          route={route}
          color={accent}
          elevationGain={workout.elevationGain}
          elevationLoss={workout.elevationLoss}
        />
      )}

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

      <SocialPanel
        ownerUid={ownerUid!}
        workout={workout}
        currentUid={user?.uid}
        currentName={profile?.name || user?.displayName || 'Someone'}
        kudos={social.kudos}
        comments={social.comments}
      />
    </div>
  )
}

function SocialPanel({
  ownerUid,
  workout,
  currentUid,
  currentName,
  kudos,
  comments,
}: {
  ownerUid: string
  workout: WorkoutSession
  currentUid?: string
  currentName: string
  kudos: WorkoutKudo[]
  comments: WorkoutComment[]
}) {
  const [commentDraft, setCommentDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [socialError, setSocialError] = useState<string | null>(null)
  const hasKudoed = currentUid != null && kudos.some((k) => k.userId === currentUid)

  async function onToggleKudo() {
    if (!currentUid) return
    setBusy(true)
    setSocialError(null)
    try {
      await toggleWorkoutKudo({
        workoutOwnerId: ownerUid,
        workoutId: workout.id,
        kudoUserId: currentUid,
        userName: currentName,
      })
    } catch (e) {
      setSocialError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onComment() {
    if (!currentUid) return
    const text = commentDraft.trim()
    if (!text) return
    setBusy(true)
    setSocialError(null)
    try {
      await addWorkoutComment({
        workoutOwnerId: ownerUid,
        comment: {
          id: newId(),
          userId: currentUid,
          userName: currentName,
          workoutId: workout.id,
          text,
          createdAt: new Date(),
        },
      })
      setCommentDraft('')
    } catch (e) {
      setSocialError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <span className="card-title">Kudos & comments</span>
        <button
          className={'btn text-[12px] !py-1.5 !px-3 ' + (hasKudoed ? 'btn-primary' : 'btn-secondary')}
          onClick={onToggleKudo}
          disabled={busy || !currentUid}
        >
          👍 {kudos.length > 0 ? kudos.length : ''} {hasKudoed ? 'Kudoed' : 'Kudos'}
        </button>
      </div>

      {kudos.length > 0 && (
        <p className="text-text-muted text-[12px]">
          {kudos.map((k) => k.userName || 'Someone').join(', ')} gave kudos
        </p>
      )}

      {comments.length > 0 && (
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="text-[13px]">
              <span className="text-text-primary font-medium">{c.userName || 'Someone'}</span>
              <span className="text-text-muted text-[11px] ml-2">
                {c.createdAt.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
              <p className="text-text-secondary mt-0.5">{c.text}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Add a comment…"
          value={commentDraft}
          onChange={(e) => setCommentDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onComment()
          }}
        />
        <button className="btn btn-secondary" onClick={onComment} disabled={busy || !commentDraft.trim()}>
          Post
        </button>
      </div>

      {socialError && <div className="error-banner">{socialError}</div>}
    </div>
  )
}

interface KeyMetricsProps {
  workout: WorkoutSession
  usesPace: boolean
  usesSpeed: boolean
  accent: string
}

function KeyMetrics({ workout, usesPace, usesSpeed, accent }: KeyMetricsProps) {
  const hadPauses = workout.movingTime > 0 && workout.duration - workout.movingTime > 5
  const movingPace = usesPace && workout.averagePace > 0 ? workout.averagePace : 0

  // Top row: Distance, Moving Time, Pace/Speed
  const topRow: { label: string; value: string }[] = []
  if (workout.distance > 0) topRow.push({ label: 'Distance', value: formatDistance(workout.distance) })
  if (workout.movingTime > 0) topRow.push({ label: 'Moving time', value: formatDuration(workout.movingTime) })
  if (movingPace > 0) {
    topRow.push({ label: 'Avg pace', value: `${formatPace(movingPace)} /mi` })
  } else if (usesSpeed && workout.averageSpeed > 0) {
    topRow.push({ label: 'Avg speed', value: `${workout.averageSpeed.toFixed(1)} mph` })
  } else if (workout.duration > 0 && workout.movingTime <= 0) {
    topRow.push({ label: 'Duration', value: formatDuration(workout.duration) })
  }

  const middleRow: { label: string; value: string }[] = []
  if (hadPauses) {
    middleRow.push({ label: 'Elapsed', value: formatDuration(workout.duration) })
    middleRow.push({ label: 'Paused', value: formatDuration(workout.duration - workout.movingTime) })
    if (usesPace && workout.distance > 0) {
      middleRow.push({
        label: 'Elapsed pace',
        value: `${formatPace(workout.duration / workout.distance)} /mi`,
      })
    }
  }

  const bottomRow: { label: string; value: string }[] = []
  if (workout.elevationGain > 0) {
    bottomRow.push({ label: 'Elev gain', value: `${Math.round(workout.elevationGain)} ft` })
  }
  if (workout.calories > 0) {
    bottomRow.push({ label: 'Calories', value: `${Math.round(workout.calories)}` })
  }
  if (workout.averageHeartRate > 0) {
    bottomRow.push({ label: 'Avg HR', value: `${workout.averageHeartRate} bpm` })
  }
  if (workout.maxHeartRate > 0 && workout.maxHeartRate !== workout.averageHeartRate) {
    bottomRow.push({ label: 'Max HR', value: `${workout.maxHeartRate} bpm` })
  }
  if (workout.bestPace > 0 && usesPace && workout.bestPace !== workout.averagePace) {
    bottomRow.push({ label: 'Best pace', value: `${formatPace(workout.bestPace)} /mi` })
  }
  if (workout.maxSpeed > 0 && usesSpeed) {
    bottomRow.push({ label: 'Max speed', value: `${workout.maxSpeed.toFixed(1)} mph` })
  }
  if (workout.elevationLoss > 0 && bottomRow.length < 4) {
    bottomRow.push({ label: 'Elev loss', value: `${Math.round(workout.elevationLoss)} ft` })
  }

  const showEffortRow = workout.relativeEffort > 0 || (workout.gradeAdjustedPace > 0 && usesPace)

  return (
    <div className="panel space-y-3">
      {topRow.length > 0 && <MetricRow items={topRow} />}
      {middleRow.length > 0 && (
        <>
          <Divider />
          <MetricRow items={middleRow} />
        </>
      )}
      {bottomRow.length > 0 && (
        <>
          <Divider />
          <MetricRow items={bottomRow} />
        </>
      )}
      {showEffortRow && (
        <>
          <Divider />
          <div className="grid grid-flow-col auto-cols-fr text-center">
            {workout.relativeEffort > 0 && (
              <div>
                <div className="font-display font-bold text-[18px]" style={{ color: accent }}>
                  {Math.round(workout.relativeEffort)}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">Rel. effort</div>
              </div>
            )}
            {workout.gradeAdjustedPace > 0 && usesPace && (
              <div>
                <div className="font-display font-bold text-[18px]" style={{ color: accent }}>
                  {formatPace(workout.gradeAdjustedPace)} /mi
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">GAP</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MetricRow({ items }: { items: { label: string; value: string | number }[] }) {
  return (
    <div className="grid grid-flow-col auto-cols-fr divide-x divide-white/[0.05] text-center">
      {items.map((it) => (
        <div key={it.label} className="px-2">
          <div className="font-display font-bold text-[18px] tracking-tight">{it.value}</div>
          <div className="text-[11px] text-text-muted mt-0.5">{it.label}</div>
        </div>
      ))}
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-white/[0.05]" />
}

function displayTitle(workout: WorkoutSession): string {
  const hour = workout.startDate.getHours()
  let timeOfDay = 'Night'
  if (hour >= 5 && hour < 12) timeOfDay = 'Morning'
  else if (hour < 17) timeOfDay = 'Afternoon'
  else if (hour < 21) timeOfDay = 'Evening'
  return `${timeOfDay} ${sportDisplayName(workout.sportType)}`
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
