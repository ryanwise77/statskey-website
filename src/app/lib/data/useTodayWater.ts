import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeWater } from '../decoders'
import { localDateString } from '../firestore'
import type { WaterDoc } from '../types'

export interface WaterState {
  water: WaterDoc | null
  loading: boolean
  error: string | null
}

/**
 * Live-listens to users/{uid}/water/{YYYY-MM-DD}. Doc ID format is the user's
 * local-timezone date string, matching biometrics/StatsKey/Services/DatabaseService.swift:1407-1416.
 */
export function useWaterForDay(uid: string | undefined, day: Date): WaterState {
  const [state, setState] = useState<WaterState>({ water: null, loading: true, error: null })
  const docId = localDateString(day)

  useEffect(() => {
    if (!uid) {
      setState({ water: null, loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'water', docId),
      (snap) => {
        if (!snap.exists()) {
          setState({ water: null, loading: false, error: null })
          return
        }
        const water = decodeWater(snap.data() as Record<string, unknown>)
        setState({ water, loading: false, error: null })
      },
      (err) => setState({ water: null, loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid, docId])

  return state
}

export function useTodayWater(uid: string | undefined): WaterState {
  return useWaterForDay(uid, new Date())
}
