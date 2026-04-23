import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeGlucose } from '../decoders'
import type { GlucoseReading } from '../types'

export interface GlucoseState {
  reading: GlucoseReading | null
  loading: boolean
  error: string | null
}

/**
 * users/{uid}/glucoseReadings ordered by timestamp desc, limit 1. No Firestore
 * "latest-single" helper exists on the Swift side (see the explore report);
 * this is the closest equivalent.
 */
export function useLatestGlucose(uid: string | undefined): GlucoseState {
  const [state, setState] = useState<GlucoseState>({ reading: null, loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ reading: null, loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'glucoseReadings'),
      orderBy('timestamp', 'desc'),
      limit(1)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const first = snap.docs[0]
        if (!first) {
          setState({ reading: null, loading: false, error: null })
          return
        }
        const reading = decodeGlucose(first.data() as Record<string, unknown>, first.id)
        setState({ reading, loading: false, error: null })
      },
      (err) => setState({ reading: null, loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}
