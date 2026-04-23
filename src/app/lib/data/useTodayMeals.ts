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
import { decodeMeal } from '../decoders'
import { endOfDay, startOfDay } from '../firestore'
import type { Meal } from '../types'

export interface MealsState {
  meals: Meal[]
  loading: boolean
  error: string | null
}

/**
 * Live-listens to users/{uid}/meals where `date` is within the given day.
 * Matches listenToMeals in biometrics/StatsKey/Services/DatabaseService.swift:95-105.
 */
export function useMealsForDay(uid: string | undefined, day: Date): MealsState {
  const [state, setState] = useState<MealsState>({ meals: [], loading: true, error: null })
  const dayKey = day.toDateString()

  useEffect(() => {
    if (!uid) {
      setState({ meals: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'meals'),
      where('date', '>=', Timestamp.fromDate(startOfDay(day))),
      where('date', '<=', Timestamp.fromDate(endOfDay(day))),
      orderBy('date', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const meals = snap.docs
          .map((d) => decodeMeal(d.data() as Record<string, unknown>, d.id))
        setState({ meals, loading: false, error: null })
      },
      (err) => setState({ meals: [], loading: false, error: err.message })
    )
    return () => unsub()
    // dayKey in deps so we only re-subscribe on day change, not on every Date object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, dayKey])

  return state
}

export function useTodayMeals(uid: string | undefined): MealsState {
  return useMealsForDay(uid, new Date())
}
