import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeFoodItem } from '../decoders'
import type { FoodItem } from '../types'

export interface DailyItemsState {
  items: FoodItem[]
  loading: boolean
  error: string | null
}

/**
 * users/{uid}/dailyItems — the daily auto-record set (supplements/medications
 * recorded automatically each day; iOS's "medicine cabinet").
 */
export function useDailyItems(uid: string | undefined): DailyItemsState {
  const [state, setState] = useState<DailyItemsState>({ items: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ items: [], loading: false, error: null })
      return
    }
    const unsub = onSnapshot(
      collection(db, 'users', uid, 'dailyItems'),
      (snap) => {
        const items = snap.docs.map((d) => decodeFoodItem(d.data() as Record<string, unknown>, d.id))
        items.sort((a, b) => a.name.localeCompare(b.name))
        setState({ items, loading: false, error: null })
      },
      (err) => setState({ items: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}
