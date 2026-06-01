import { useEffect, useState } from 'react'
import { collection, getCountFromServer, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeGlucose } from '../decoders'
import type { GlucoseReading, GlucoseSource } from '../types'

export interface GlucoseStatusState {
  latest: GlucoseReading | null
  dexcomCount: number | null
  loading: boolean
  error: string | null
}

export function useGlucoseStatus(uid: string | undefined): GlucoseStatusState {
  const [state, setState] = useState<GlucoseStatusState>({
    latest: null,
    dexcomCount: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!uid) {
      setState({ latest: null, dexcomCount: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    const glucoseCollection = collection(db, 'users', uid, 'glucoseReadings')
    const latestQuery = query(glucoseCollection, orderBy('timestamp', 'desc'), limit(1))

    getCountFromServer(query(glucoseCollection, where('source', '==', 'Dexcom Share' satisfies GlucoseSource)))
      .then((snap) => {
        if (!cancelled) {
          setState((s) => ({ ...s, dexcomCount: snap.data().count }))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
        }
      })

    const unsub = onSnapshot(
      latestQuery,
      (snap) => {
        if (cancelled) return
        const first = snap.docs[0]
        setState((s) => ({
          ...s,
          latest: first ? decodeGlucose(first.data() as Record<string, unknown>, first.id) : null,
          loading: false,
          error: null,
        }))
      },
      (err) => {
        if (!cancelled) {
          setState({ latest: null, dexcomCount: null, loading: false, error: err.message })
        }
      }
    )

    return () => {
      cancelled = true
      unsub()
    }
  }, [uid])

  return state
}
