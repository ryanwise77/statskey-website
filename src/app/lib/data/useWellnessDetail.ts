import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeWellness } from '../decoders'
import type { WellnessEntry } from '../types'

export interface WellnessDetailState {
  entry: WellnessEntry | null
  loading: boolean
  error: string | null
  notFound: boolean
}

export function useWellnessDetail(
  uid: string | undefined,
  entryId: string | undefined
): WellnessDetailState {
  const [state, setState] = useState<WellnessDetailState>({
    entry: null,
    loading: true,
    error: null,
    notFound: false,
  })

  useEffect(() => {
    if (!uid || !entryId) {
      setState({ entry: null, loading: false, error: null, notFound: false })
      return
    }

    const unsub = onSnapshot(
      doc(db, 'users', uid, 'wellness', entryId),
      (snap) => {
        if (!snap.exists()) {
          setState({ entry: null, loading: false, error: null, notFound: true })
          return
        }
        const entry = decodeWellness(snap.data() as Record<string, unknown>, snap.id)
        setState({
          entry: entry ?? null,
          loading: false,
          error: null,
          notFound: entry == null,
        })
      },
      (err) => setState({ entry: null, loading: false, error: err.message, notFound: false })
    )
    return () => unsub()
  }, [uid, entryId])

  return state
}
