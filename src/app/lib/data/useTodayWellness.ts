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
import { decodeWellness } from '../decoders'
import { endOfDay, startOfDay } from '../firestore'
import type { WellnessEntry } from '../types'

export interface WellnessState {
  entries: WellnessEntry[]
  loading: boolean
  error: string | null
}

/**
 * users/{uid}/wellness listener for a given day. Mirrors
 * listenToWellnessEntries at biometrics/StatsKey/Services/DatabaseService.swift:337-347.
 * Scope note (per Phase 2 plan): we only query the modern `wellness` collection;
 * legacy `wellnessEntries`/`bowelMovements`/`stoolLogs` are skipped.
 */
export function useWellnessForDay(uid: string | undefined, day: Date): WellnessState {
  const [state, setState] = useState<WellnessState>({ entries: [], loading: true, error: null })
  const dayKey = day.toDateString()

  useEffect(() => {
    if (!uid) {
      setState({ entries: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'wellness'),
      where('date', '>=', Timestamp.fromDate(startOfDay(day))),
      where('date', '<=', Timestamp.fromDate(endOfDay(day))),
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
  }, [uid, dayKey])

  return state
}

export function useTodayWellness(uid: string | undefined): WellnessState {
  return useWellnessForDay(uid, new Date())
}
