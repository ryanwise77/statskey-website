import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export interface TokenBalance {
  balance: number
  lifetimeUsed: number
  currentMonth?: string
  lastStripeCheckoutSessionId?: string
  lastStripeTestCheckoutSessionId?: string
  raw: Record<string, unknown>
}

export interface TokenBalanceState {
  tokens: TokenBalance | null
  loading: boolean
  error: string | null
}

export function useTokenBalance(uid: string | undefined): TokenBalanceState {
  const [state, setState] = useState<TokenBalanceState>({ tokens: null, loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ tokens: null, loading: false, error: null })
      return
    }

    const unsub = onSnapshot(
      doc(db, 'users', uid, 'tokens', 'balance'),
      (snap) => {
        if (!snap.exists()) {
          setState({
            tokens: { balance: 0, lifetimeUsed: 0, raw: {} },
            loading: false,
            error: null,
          })
          return
        }

        const raw = snap.data() as Record<string, unknown>
        setState({
          tokens: {
            balance: toNumber(raw.balance),
            lifetimeUsed: toNumber(raw.lifetimeUsed),
            currentMonth: typeof raw.currentMonth === 'string' ? raw.currentMonth : undefined,
            lastStripeCheckoutSessionId:
              typeof raw.lastStripeCheckoutSessionId === 'string' ? raw.lastStripeCheckoutSessionId : undefined,
            lastStripeTestCheckoutSessionId:
              typeof raw.lastStripeTestCheckoutSessionId === 'string' ? raw.lastStripeTestCheckoutSessionId : undefined,
            raw,
          },
          loading: false,
          error: null,
        })
      },
      (err) => setState({ tokens: null, loading: false, error: err.message })
    )

    return () => unsub()
  }, [uid])

  return state
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    const value = count / 1_000_000
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`
  }
  if (count >= 1_000) {
    const value = count / 1_000
    return Number.isInteger(value) ? `${value}K` : `${value.toFixed(1)}K`
  }
  return count.toLocaleString()
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
