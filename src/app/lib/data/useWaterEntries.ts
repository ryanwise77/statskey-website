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
import { decodeWaterEntry } from '../decoders'
import { endOfDay, localDateString, startOfDay } from '../firestore'
import type { WaterEntry } from '../types'

export interface WaterEntriesState {
  entries: WaterEntry[]
  loading: boolean
  error: string | null
}

/**
 * Live per-entry water timeline for a day. Mirrors listenToWaterEntries at
 * biometrics/StatsKey/Services/DatabaseService.swift:658-674.
 */
export function useWaterEntries(uid: string | undefined, day: Date): WaterEntriesState {
  const [state, setState] = useState<WaterEntriesState>({ entries: [], loading: true, error: null })
  const dayKey = localDateString(day)

  useEffect(() => {
    if (!uid) {
      setState({ entries: [], loading: false, error: null })
      return
    }
    const base = new Date(`${dayKey}T12:00`)
    const q = query(
      collection(db, 'users', uid, 'waterEntries'),
      where('date', '>=', Timestamp.fromDate(startOfDay(base))),
      where('date', '<=', Timestamp.fromDate(endOfDay(base))),
      orderBy('date', 'asc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const entries = snap.docs.map((d) => decodeWaterEntry(d.data() as Record<string, unknown>, d.id))
        setState({ entries, loading: false, error: null })
      },
      (err) => setState({ entries: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid, dayKey])

  return state
}
