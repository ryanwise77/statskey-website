import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeMacroTargets } from '../decoders'
import type { MacroTargets } from '../types'
import { DEFAULT_MACRO_TARGETS } from '../types'

export interface MacroTargetsState {
  targets: MacroTargets
  loading: boolean
  error: string | null
  exists: boolean
}

/**
 * users/{uid}/settings/macroTargets. Falls back to DEFAULT_MACRO_TARGETS (the same
 * defaults as biometrics/StatsKey/Models/UserProfile.swift:261) when the doc
 * is missing so the dashboard can still render.
 */
export function useMacroTargets(uid: string | undefined): MacroTargetsState {
  const [state, setState] = useState<MacroTargetsState>({
    targets: DEFAULT_MACRO_TARGETS,
    loading: true,
    error: null,
    exists: false,
  })

  useEffect(() => {
    if (!uid) {
      setState({ targets: DEFAULT_MACRO_TARGETS, loading: false, error: null, exists: false })
      return
    }

    const unsub = onSnapshot(
      doc(db, 'users', uid, 'settings', 'macroTargets'),
      (snap) => {
        if (!snap.exists()) {
          setState({ targets: DEFAULT_MACRO_TARGETS, loading: false, error: null, exists: false })
          return
        }
        const targets = decodeMacroTargets(snap.data() as Record<string, unknown>)
        setState({ targets, loading: false, error: null, exists: true })
      },
      (err) => setState({
        targets: DEFAULT_MACRO_TARGETS,
        loading: false,
        error: err.message,
        exists: false,
      })
    )
    return () => unsub()
  }, [uid])

  return state
}
