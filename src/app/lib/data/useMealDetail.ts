import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeMeal } from '../decoders'
import type { Meal } from '../types'

export interface MealDetailState {
  meal: Meal | null
  loading: boolean
  error: string | null
  notFound: boolean
}

export function useMealDetail(uid: string | undefined, mealId: string | undefined): MealDetailState {
  const [state, setState] = useState<MealDetailState>({
    meal: null,
    loading: true,
    error: null,
    notFound: false,
  })

  useEffect(() => {
    if (!uid || !mealId) {
      setState({ meal: null, loading: false, error: null, notFound: false })
      return
    }

    const unsub = onSnapshot(
      doc(db, 'users', uid, 'meals', mealId),
      (snap) => {
        if (!snap.exists()) {
          setState({ meal: null, loading: false, error: null, notFound: true })
          return
        }
        const meal = decodeMeal(snap.data() as Record<string, unknown>, snap.id)
        setState({ meal, loading: false, error: null, notFound: false })
      },
      (err) => setState({ meal: null, loading: false, error: err.message, notFound: false })
    )
    return () => unsub()
  }, [uid, mealId])

  return state
}
