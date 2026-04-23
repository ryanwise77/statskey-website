import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeWorkout } from '../decoders'
import type { WorkoutSession } from '../types'

export interface WorkoutsState {
  workouts: WorkoutSession[]
  loading: boolean
  error: string | null
}

/**
 * users/{uid}/workoutSessions ordered by startDate desc, limited.
 * Mirrors listenToWorkoutSessions at biometrics/StatsKey/Services/DatabaseService.swift:773-782.
 */
export function useRecentWorkouts(uid: string | undefined, max = 5): WorkoutsState {
  const [state, setState] = useState<WorkoutsState>({ workouts: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ workouts: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'workoutSessions'),
      orderBy('startDate', 'desc'),
      limit(max)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const workouts = snap.docs.map((d) => decodeWorkout(d.data() as Record<string, unknown>, d.id))
        setState({ workouts, loading: false, error: null })
      },
      (err) => setState({ workouts: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid, max])

  return state
}
