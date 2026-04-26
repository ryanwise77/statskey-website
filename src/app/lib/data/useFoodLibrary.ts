import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeFoodItem } from '../decoders'
import type { FoodItem } from '../types'

export interface FoodLibraryState {
  items: FoodItem[]
  loading: boolean
  error: string | null
}

export function useFoodLibrary(uid: string | undefined): FoodLibraryState {
  const [state, setState] = useState<FoodLibraryState>({ items: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ items: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(collection(db, 'users', uid, 'foodLibrary'), orderBy('lastUsed', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => decodeFoodItem(d.data() as Record<string, unknown>, d.id))
        setState({ items, loading: false, error: null })
      },
      (err) => setState({ items: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}
