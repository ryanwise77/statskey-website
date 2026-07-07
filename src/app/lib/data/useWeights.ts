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
import { decodeWeightEntry } from '../decoders'
import { endOfDay, startOfDay } from '../firestore'
import type { WeightEntry } from '../types'

export interface WeightsState {
  weights: WeightEntry[]
  loading: boolean
  error: string | null
}

/** Live weight entries in [start, end], newest first (users/{uid}/weights). */
export function useWeights(uid: string | undefined, start: Date, end: Date): WeightsState {
  const [state, setState] = useState<WeightsState>({ weights: [], loading: true, error: null })
  const key = `${start.toDateString()}|${end.toDateString()}`

  useEffect(() => {
    if (!uid) {
      setState({ weights: [], loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'weights'),
      where('date', '>=', Timestamp.fromDate(startOfDay(start))),
      where('date', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('date', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const weights = snap.docs.map((d) => decodeWeightEntry(d.data() as Record<string, unknown>, d.id))
        setState({ weights, loading: false, error: null })
      },
      (err) => setState({ weights: [], loading: false, error: err.message })
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}
