import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export interface Subscription {
  tier: string
  researchTokenLimit?: number
  raw: Record<string, unknown>
}

export interface SubscriptionState {
  subscription: Subscription | null
  loading: boolean
  error: string | null
}

/**
 * Reads the subscription status iOS writes to users/{uid}/subscription/data.
 * Used server-side by anthropicChat / grokChat / coachChat to determine token
 * limits (see biometrics/functions/index.js:482, 987, 1195). Fields include
 * `subscriptionTier` (free | pro | other) and optionally `researchTokenLimit`.
 */
export function useSubscription(uid: string | undefined): SubscriptionState {
  const [state, setState] = useState<SubscriptionState>({ subscription: null, loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ subscription: null, loading: false, error: null })
      return
    }
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'subscription', 'data'),
      (snap) => {
        if (!snap.exists()) {
          setState({
            subscription: { tier: 'free', raw: {} },
            loading: false,
            error: null,
          })
          return
        }
        const raw = snap.data() as Record<string, unknown>
        const tier = typeof raw.subscriptionTier === 'string' ? (raw.subscriptionTier as string) : 'free'
        const researchTokenLimit =
          typeof raw.researchTokenLimit === 'number' ? (raw.researchTokenLimit as number) : undefined
        setState({
          subscription: { tier, researchTokenLimit, raw },
          loading: false,
          error: null,
        })
      },
      (err) => setState({ subscription: null, loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}
