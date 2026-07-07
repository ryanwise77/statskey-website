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
import { decodeSubstance } from '../decoders'
import { endOfDay, startOfDay } from '../firestore'
import type { SubstanceEntry } from '../types'

export interface SubstancesState {
  entries: SubstanceEntry[]
  loading: boolean
  error: string | null
}

/** Live substance entries in [start, end], newest first (users/{uid}/substances). */
export function useSubstancesHistory(uid: string | undefined, start: Date, end: Date): SubstancesState {
  const [state, setState] = useState<SubstancesState>({ entries: [], loading: true, error: null })
  const key = `${start.toDateString()}|${end.toDateString()}`

  useEffect(() => {
    if (!uid) {
      setState({ entries: [], loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'substances'),
      where('date', '>=', Timestamp.fromDate(startOfDay(start))),
      where('date', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('date', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const entries = snap.docs.map((d) => decodeSubstance(d.data() as Record<string, unknown>, d.id))
        setState({ entries, loading: false, error: null })
      },
      (err) => setState({ entries: [], loading: false, error: err.message })
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}
