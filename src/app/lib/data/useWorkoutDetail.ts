import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeWorkout } from '../decoders'
import type { WorkoutSession } from '../types'

export interface WorkoutDetailState {
  workout: WorkoutSession | null
  loading: boolean
  error: string | null
  notFound: boolean
}

export function useWorkoutDetail(uid: string | undefined, workoutId: string | undefined): WorkoutDetailState {
  const [state, setState] = useState<WorkoutDetailState>({
    workout: null,
    loading: true,
    error: null,
    notFound: false,
  })

  useEffect(() => {
    if (!uid || !workoutId) {
      setState({ workout: null, loading: false, error: null, notFound: false })
      return
    }

    const unsub = onSnapshot(
      doc(db, 'users', uid, 'workoutSessions', workoutId),
      (snap) => {
        if (!snap.exists()) {
          setState({ workout: null, loading: false, error: null, notFound: true })
          return
        }
        const workout = decodeWorkout(snap.data() as Record<string, unknown>, snap.id)
        setState({ workout, loading: false, error: null, notFound: false })
      },
      (err) => setState({ workout: null, loading: false, error: err.message, notFound: false })
    )
    return () => unsub()
  }, [uid, workoutId])

  return state
}
