import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeRoutePoints } from '../decoders'
import type { RoutePoint, WorkoutSession } from '../types'

export interface WorkoutRouteState {
  route: RoutePoint[]
  loading: boolean
}

/**
 * Resolves the route for a workout. Prefers the full `attachments/route` doc
 * (the inline `routeCoordinates` field on the session is downsampled to ≤200
 * points by iOS for cheap previews). Falls back to inline when the attachment
 * is missing or unreadable. Mirrors `fetchRouteData(sessionId:userId:)` in
 * biometrics/StatsKey/Services/DatabaseService.swift:808-826.
 *
 * The hook seeds with the inline route immediately so the map can render
 * something while the higher-fidelity attachment loads.
 */
export function useWorkoutRoute(workout: WorkoutSession | null): WorkoutRouteState {
  const inline = workout?.routeCoordinates ?? []
  const [state, setState] = useState<WorkoutRouteState>({
    route: inline,
    loading: inline.length === 0,
  })

  const sessionId = workout?.id
  const userId = workout?.userId

  useEffect(() => {
    if (!workout || !sessionId || !userId) {
      setState({ route: [], loading: false })
      return
    }

    setState({ route: inline, loading: true })

    let cancelled = false
    ;(async () => {
      try {
        const ref = doc(db, 'users', userId, 'workoutSessions', sessionId, 'attachments', 'route')
        const snap = await getDoc(ref)
        if (cancelled) return
        if (snap.exists()) {
          const raw = snap.data() as Record<string, unknown>
          const route = decodeRoutePoints(raw.routeCoordinates)
          if (route.length > 0) {
            setState({ route, loading: false })
            return
          }
        }
        setState({ route: inline, loading: false })
      } catch {
        if (!cancelled) setState({ route: inline, loading: false })
      }
    })()

    return () => {
      cancelled = true
    }
    // `inline` is derived from workout.routeCoordinates; the workout reference
    // is enough to refresh both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout, sessionId, userId])

  return state
}
