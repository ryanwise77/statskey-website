import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDateOrNow, endOfDay, startOfDay } from '../firestore'

export interface WaterDay {
  /** Rollup doc ID (YYYY-MM-DD, local timezone). */
  id: string
  amount: number
  date: Date
}

export interface WaterRangeState {
  days: WaterDay[]
  loading: boolean
  error: string | null
}

/** Daily water rollups (users/{uid}/water/{YYYY-MM-DD}) in [start, end]. */
export function useWaterRange(uid: string | undefined, start: Date, end: Date): WaterRangeState {
  const [state, setState] = useState<WaterRangeState>({ days: [], loading: true, error: null })
  const key = `${start.toDateString()}|${end.toDateString()}`

  useEffect(() => {
    if (!uid) {
      setState({ days: [], loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'water'),
      where('date', '>=', Timestamp.fromDate(startOfDay(start))),
      where('date', '<=', Timestamp.fromDate(endOfDay(end)))
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const days = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>
          return {
            id: d.id,
            amount: typeof raw.amount === 'number' ? raw.amount : 0,
            date: toDateOrNow(raw.date),
          }
        })
        days.sort((a, b) => a.date.getTime() - b.date.getTime())
        setState({ days, loading: false, error: null })
      },
      (err) => setState({ days: [], loading: false, error: err.message })
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}
