import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import type { TokenPackId } from '../billing'

export type AutoRechargeStatus =
  | 'active'
  | 'charging'
  | 'retrying'
  | 'monthly_cap_reached'
  | 'action_required'
  | 'payment_failed'
  | 'configuration_error'
  | 'manual_review'
  | 'billing_review'
  | 'reenrollment_required'
  | 'disabled'

export interface TokenAutoRecharge {
  enabled: boolean
  status: AutoRechargeStatus
  pack?: TokenPackId
  packTokens: number
  thresholdBasis: 'total'
  thresholdPercent: number
  thresholdTokens: number
  maxMonthlyRecharges: number
  amountCents: number
  baseAmountCents: number
  ownerMarginBps: number
  ownerMarginAmountCents: number
  processingReserveAmountCents: number
  netOwnerMarginAmountCents: number
  pricingVersion?: string
  currency: string
  monthlyRechargeMonthKey?: string
  monthlyRechargeCount: number
  monthlyAttemptCount: number
  paymentMethod?: {
    type?: string
    brand?: string | null
    last4?: string | null
    expMonth?: number | null
    expYear?: number | null
  }
  lastFailureCode?: string
  raw: Record<string, unknown>
}

export interface TokenAutoRechargeState {
  config: TokenAutoRecharge | null
  loading: boolean
  error: string | null
}

interface StoredTokenAutoRechargeState extends TokenAutoRechargeState {
  uid?: string
}

export function useTokenAutoRecharge(uid: string | undefined): TokenAutoRechargeState {
  const [state, setState] = useState<StoredTokenAutoRechargeState>({
    config: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!uid) {
      setState({ uid: undefined, config: null, loading: false, error: null })
      return
    }

    setState({ uid, config: null, loading: true, error: null })

    return onSnapshot(
      doc(db, 'users', uid, 'tokenAutoRecharge', 'config'),
      (snap) => {
        if (!snap.exists()) {
          setState({ uid, config: null, loading: false, error: null })
          return
        }
        const raw = snap.data() as Record<string, unknown>
        const pack = isTokenPackId(raw.pack) ? raw.pack : undefined
        const thresholdBasis = 'total' as const
        const status = raw.thresholdBasis === 'total' && isAutoRechargeStatus(raw.status)
          ? raw.status
          : 'configuration_error'
        const paymentMethod = isRecord(raw.paymentMethod)
          ? {
              type: text(raw.paymentMethod.type),
              brand: text(raw.paymentMethod.brand),
              last4: text(raw.paymentMethod.last4),
              expMonth: nullableNumber(raw.paymentMethod.expMonth),
              expYear: nullableNumber(raw.paymentMethod.expYear),
            }
          : undefined
        setState({
          uid,
          config: {
            enabled: raw.enabled === true,
            status,
            pack,
            packTokens: number(raw.packTokens),
            thresholdBasis,
            thresholdPercent: number(raw.thresholdPercent),
            thresholdTokens: number(raw.thresholdTokens),
            maxMonthlyRecharges: number(raw.maxMonthlyRecharges),
            amountCents: number(raw.amountCents),
            baseAmountCents: number(raw.baseAmountCents),
            ownerMarginBps: number(raw.ownerMarginBps),
            ownerMarginAmountCents: number(raw.ownerMarginAmountCents),
            processingReserveAmountCents: number(raw.processingReserveAmountCents),
            netOwnerMarginAmountCents: number(raw.netOwnerMarginAmountCents),
            pricingVersion: text(raw.pricingVersion),
            currency: text(raw.currency) ?? 'usd',
            monthlyRechargeMonthKey: text(raw.monthlyRechargeMonthKey),
            monthlyRechargeCount: number(raw.monthlyRechargeCount),
            monthlyAttemptCount: number(raw.monthlyAttemptCount),
            paymentMethod,
            lastFailureCode: text(raw.lastFailureCode),
            raw,
          },
          loading: false,
          error: null,
        })
      },
      (error) => setState({ uid, config: null, loading: false, error: error.message })
    )
  }, [uid])

  if (!uid) return { config: null, loading: false, error: null }
  if (state.uid !== uid) return { config: null, loading: true, error: null }
  return state
}

function isTokenPackId(value: unknown): value is TokenPackId {
  return value === '1m' || value === '5m' || value === '25m' || value === '100m'
}

function isAutoRechargeStatus(value: unknown): value is AutoRechargeStatus {
  return [
    'active',
    'charging',
    'retrying',
    'monthly_cap_reached',
    'action_required',
    'payment_failed',
    'configuration_error',
    'manual_review',
    'billing_review',
    'reenrollment_required',
    'disabled',
  ].includes(String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
