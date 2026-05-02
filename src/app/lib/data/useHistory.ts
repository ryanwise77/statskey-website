import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { decodeMeal, decodeWellness, decodeWorkout } from '../decoders'
import { endOfDay, startOfDay } from '../firestore'
import type { Meal, WellnessEntry, WorkoutSession } from '../types'

export interface MealsHistoryState {
  meals: Meal[]
  loading: boolean
  error: string | null
}

export interface WellnessHistoryState {
  entries: WellnessEntry[]
  loading: boolean
  error: string | null
}

export interface WorkoutsHistoryState {
  workouts: WorkoutSession[]
  loading: boolean
  error: string | null
}

export function useMealsHistory(
  uid: string | undefined,
  start: Date,
  end: Date
): MealsHistoryState {
  const [state, setState] = useState<MealsHistoryState>({ meals: [], loading: true, error: null })
  const key = `${start.toDateString()}|${end.toDateString()}`

  useEffect(() => {
    if (!uid) {
      setState({ meals: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'meals'),
      where('date', '>=', Timestamp.fromDate(startOfDay(start))),
      where('date', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('date', 'desc')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}

export function useWellnessHistory(
  uid: string | undefined,
  start: Date,
  end: Date
): WellnessHistoryState {
  const [state, setState] = useState<WellnessHistoryState>({ entries: [], loading: true, error: null })
  const key = `${start.toDateString()}|${end.toDateString()}`

  useEffect(() => {
    if (!uid) {
      setState({ entries: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'wellness'),
      where('date', '>=', Timestamp.fromDate(startOfDay(start))),
      where('date', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('date', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const entries: WellnessEntry[] = []
        for (const d of snap.docs) {
          const decoded = decodeWellness(d.data() as Record<string, unknown>, d.id)
          if (decoded) entries.push(decoded)
        }
        setState({ entries, loading: false, error: null })
      },
      (err) => setState({ entries: [], loading: false, error: err.message })
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}

export function useWorkoutsHistory(
  uid: string | undefined,
  start: Date,
  end: Date
): WorkoutsHistoryState {
  const [state, setState] = useState<WorkoutsHistoryState>({ workouts: [], loading: true, error: null })
  const key = `${start.toDateString()}|${end.toDateString()}`

  useEffect(() => {
    if (!uid) {
      setState({ workouts: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'workoutSessions'),
      where('startDate', '>=', Timestamp.fromDate(startOfDay(start))),
      where('startDate', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('startDate', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const workouts = snap.docs.map((d) => decodeWorkout(d.data() as Record<string, unknown>, d.id, uid))
        setState({ workouts, loading: false, error: null })
      },
      (err) => setState({ workouts: [], loading: false, error: err.message })
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}
