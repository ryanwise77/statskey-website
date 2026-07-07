import { useEffect, useState } from 'react'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from '../firebase'
import { decodeMeal, decodeWorkout } from '../decoders'
import { useHealthDailyForDay } from './useHealthDaily'
import { useWaterForDay } from './useTodayWater'
import type { Meal, WorkoutSession } from '../types'

export interface FriendMealsState {
  meals: Meal[]
  loading: boolean
  error: string | null
}

/**
 * Friend-visible meals. IMPORTANT: reads users/{friendUid}/friendMeals — the
 * redacted mirror kept by the mirrorFriendMeal Cloud Function — never the raw
 * meals collection, which rules deny to non-owners.
 */
export function useFriendMeals(friendUid: string | undefined, max = 20): FriendMealsState {
  const [state, setState] = useState<FriendMealsState>({ meals: [], loading: true, error: null })

  useEffect(() => {
    if (!friendUid) {
      setState({ meals: [], loading: false, error: null })
      return
    }
    const q = query(
      collection(db, 'users', friendUid, 'friendMeals'),
      orderBy('date', 'desc'),
      limit(max)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const meals = snap.docs.map((d) => decodeMeal(d.data() as Record<string, unknown>, d.id))
        setState({ meals, loading: false, error: null })
      },
      (err) => setState({ meals: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [friendUid, max])

  return state
}

export interface FriendWorkoutsState {
  workouts: WorkoutSession[]
  loading: boolean
  error: string | null
}

/** Friend's recent workouts — workoutSessions is friend-readable per rules. */
export function useFriendWorkouts(friendUid: string | undefined, max = 10): FriendWorkoutsState {
  const [state, setState] = useState<FriendWorkoutsState>({ workouts: [], loading: true, error: null })

  useEffect(() => {
    if (!friendUid) {
      setState({ workouts: [], loading: false, error: null })
      return
    }
    const q = query(
      collection(db, 'users', friendUid, 'workoutSessions'),
      orderBy('startDate', 'desc'),
      limit(max)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const workouts = snap.docs.map((d) =>
          decodeWorkout(d.data() as Record<string, unknown>, d.id, friendUid)
        )
        setState({ workouts, loading: false, error: null })
      },
      (err) => setState({ workouts: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [friendUid, max])

  return state
}

/** Friend's today summary (healthDaily + water are friend-readable). */
export function useFriendToday(friendUid: string | undefined) {
  const today = new Date()
  const health = useHealthDailyForDay(friendUid, today)
  const water = useWaterForDay(friendUid, today)
  return { health, water }
}
