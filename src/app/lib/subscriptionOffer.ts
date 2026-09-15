import { useEffect, useState } from 'react'

/** New sales use one Pro service with two billing cadences.
 * Legacy subscription values are recognized for display/access only; no renewal
 * price, subscription record, or purchased-credit balance is changed here. */
export type SubscriptionCheckoutPlan = 'pro' | 'proAnnual'

export const PRO_SUBSCRIPTION_OPTIONS = [
  { id: 'proAnnual', name: 'Pro annual', price: '$699 / year, billed annually', amountCents: 69900, interval: 'year' },
  { id: 'pro', name: 'Pro monthly', price: '$69.99 / month', amountCents: 6999, interval: 'month' },
] as const satisfies readonly {
  id: SubscriptionCheckoutPlan
  name: string
  price: string
  amountCents: number
  interval: 'month' | 'year'
}[]

export function isSubscriptionCheckoutPlan(value: unknown): value is SubscriptionCheckoutPlan {
  return value === 'pro' || value === 'proAnnual'
}

type SubscriptionAccessInput = {
  plan?: unknown
  tier?: unknown
  compProUntil?: unknown
  raw?: Record<string, unknown>
} | null | undefined

function serverSubscriptionFields(subscription: SubscriptionAccessInput): Record<string, unknown> {
  // The deployed hook's tier defaults to free when the raw document omits it.
  // Raw server fields distinguish that default from an explicit cancellation.
  if (subscription?.raw && typeof subscription.raw === 'object' && !Array.isArray(subscription.raw)) return subscription.raw
  return { subscriptionTier: subscription?.tier, subscriptionPlan: subscription?.plan, compProUntil: subscription?.compProUntil }
}

function expiryMillis(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0
  if (typeof value === 'string') return Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0
  if (typeof value !== 'object') return 0
  const stamp = value as { toMillis?: () => unknown; toDate?: () => unknown; seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; _nanoseconds?: unknown }
  try {
    if (typeof stamp.toMillis === 'function') return expiryMillis(Number(stamp.toMillis()))
    if (typeof stamp.toDate === 'function') return expiryMillis(stamp.toDate())
    const seconds = Number(stamp.seconds ?? stamp._seconds)
    const nanos = Number(stamp.nanoseconds ?? stamp._nanoseconds ?? 0)
    return Number.isFinite(seconds) ? seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1_000_000 : 0) : 0
  } catch { return 0 }
}

export function hasProAccess(subscription: SubscriptionAccessInput, nowMs = Date.now()): boolean {
  const raw = serverSubscriptionFields(subscription)
  const hasStoredTier = raw.subscriptionTier != null
  const tier = hasStoredTier ? String(raw.subscriptionTier) : 'free'
  if (tier === 'pro') return true
  if (tier !== 'free') return false
  if (!hasStoredTier && (raw.subscriptionPlan === 'pro' || raw.subscriptionPlan === 'proPlus')) return true
  return expiryMillis(raw.compProUntil) > nowMs
}

/** Re-evaluate an active comp grant at its expiry, even on an idle screen. */
export function useProAccess(subscription: SubscriptionAccessInput): boolean {
  const [clock, setClock] = useState(() => Date.now())
  const expiry = expiryMillis(serverSubscriptionFields(subscription).compProUntil)
  useEffect(() => {
    const remaining = expiry - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(() => setClock(Date.now()), Math.min(remaining, 60_000))
    return () => clearTimeout(timer)
  }, [expiry, clock])
  return hasProAccess(subscription)
}

export function subscriptionPlanLabel(subscription: SubscriptionAccessInput, nowMs = Date.now()): string {
  return hasProAccess(subscription, nowMs) ? 'Pro' : 'Free'
}
