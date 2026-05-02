import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeSamplesPayload } from '../decoders'
import type { CadenceSample, HeartRateSample, WorkoutSession } from '../types'

export interface WorkoutSamplesState {
  heartRateSamples: HeartRateSample[]
  cadenceSamples: CadenceSample[]
  loading: boolean
}

/**
 * Loads the HR + cadence samples attached to a workout session. Matches
 * `fetchSampleData(sessionId:userId:)` in DatabaseService.swift:829-834.
 * Older sessions may not have any attachment, in which case we return empty
 * arrays.
 */
export function useWorkoutSamples(workout: WorkoutSession | null): WorkoutSamplesState {
  const [state, setState] = useState<WorkoutSamplesState>({
    heartRateSamples: [],
    cadenceSamples: [],
    loading: false,
  })

  const sessionId = workout?.id
  const userId = workout?.userId

  useEffect(() => {
    if (!workout || !sessionId || !userId) {
      setState({ heartRateSamples: [], cadenceSamples: [], loading: false })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    ;(async () => {
      try {
        const ref = doc(db, 'users', userId, 'workoutSessions', sessionId, 'attachments', 'samples')
        const snap = await getDoc(ref)
        if (cancelled) return
        if (snap.exists()) {
          const payload = decodeSamplesPayload(snap.data() as Record<string, unknown>)
          setState({ ...payload, loading: false })
        } else {
          setState({ heartRateSamples: [], cadenceSamples: [], loading: false })
        }
      } catch {
        if (!cancelled) setState({ heartRateSamples: [], cadenceSamples: [], loading: false })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workout, sessionId, userId])

  return state
}
