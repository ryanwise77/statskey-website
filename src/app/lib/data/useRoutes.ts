import { useEffect, useState } from 'react'
import { collection, limit as limitQuery, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeSavedRoute } from '../decoders'
import type { SavedRoute } from '../types'

export interface RoutesState {
  routes: SavedRoute[]
  loading: boolean
  error: string | null
}

export function useSavedRoutes(uid: string | undefined): RoutesState {
  const [state, setState] = useState<RoutesState>({ routes: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ routes: [], loading: false, error: null })
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(collection(db, 'users', uid, 'routes'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const routes = snap.docs.map((d) => decodeSavedRoute(d.data() as Record<string, unknown>, d.id))
        setState({ routes, loading: false, error: null })
      },
      (err) => setState({ routes: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}

export function usePublicRoutes(maxRoutes = 20): RoutesState {
  const [state, setState] = useState<RoutesState>({ routes: [], loading: true, error: null })

  useEffect(() => {
    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(collection(db, 'publicRoutes'), orderBy('timesCompleted', 'desc'), limitQuery(maxRoutes))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const routes = snap.docs.map((d) => decodeSavedRoute(d.data() as Record<string, unknown>, d.id))
        setState({ routes, loading: false, error: null })
      },
      (err) => setState({ routes: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [maxRoutes])

  return state
}
