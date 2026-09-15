import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasProAccess, isSubscriptionCheckoutPlan, PRO_SUBSCRIPTION_OPTIONS, subscriptionPlanLabel, useProAccess } from './subscriptionOffer'

describe('single Pro offer and legacy service compatibility', () => {
  it('offers one service at the approved two cadences', () => {
    expect(PRO_SUBSCRIPTION_OPTIONS.map(({ id, amountCents, interval }) => ({ id, amountCents, interval }))).toEqual([
      { id: 'proAnnual', amountCents: 69900, interval: 'year' },
      { id: 'pro', amountCents: 6999, interval: 'month' },
    ])
    expect(PRO_SUBSCRIPTION_OPTIONS.every(({ id }) => isSubscriptionCheckoutPlan(id))).toBe(true)
  })
  it.each([
    { plan: 'pro', tier: 'pro' },
    { plan: 'proPlus', tier: 'pro' },
    { tier: 'pro' },
    { plan: 'proPlus' },
  ])('retains premium presentation/access for %j without mutating billing data', (identity) => {
    const subscription = Object.freeze({ ...identity, raw: Object.freeze({ subscriptionTier: identity.tier, subscriptionPlan: identity.plan, renewalAmountCents: 1499, stripePriceId: 'legacy_unchanged' }) })
    expect(hasProAccess(subscription)).toBe(true)
    expect(subscriptionPlanLabel(subscription)).toBe('Pro')
    expect(subscription.raw.renewalAmountCents).toBe(1499)
    expect(subscription.raw.stripePriceId).toBe('legacy_unchanged')
  })
  it.each([undefined, null, { plan: 'free', tier: 'free' }, { plan: 'not-pro', tier: 'approver' }, { plan: 'pro', tier: 'free' }, { plan: 'proPlus', tier: 'free' }])('does not confer access for %j', (value) => {
    expect(hasProAccess(value)).toBe(false)
    expect(subscriptionPlanLabel(value)).toBe('Free')
  })
  it.each(['proPlusMonthly', 'proPlusAnnual', 'proPlus', 'free', '', null, undefined])('does not treat legacy or invalid selector %s as a new sale', (value) => {
    expect(isSubscriptionCheckoutPlan(value)).toBe(false)
  })
})


// Execute the real production hook's Firestore callback, including its synthesized free tier.
const projection = vi.hoisted(() => ({ state: undefined as any, receive: undefined as any, cleanups: [] as (() => void)[], setCalls: 0 }))
vi.mock('react', () => ({
  useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, (value: any) => { projection.state = value; projection.setCalls += 1 }],
  useEffect: (effect: () => any) => { const cleanup = effect(); if (typeof cleanup === 'function') projection.cleanups.push(cleanup) },
}))
vi.mock('firebase/firestore', () => ({
  doc: (...parts: any[]) => parts,
  onSnapshot: (_doc: any, receive: any) => { projection.receive = receive; return () => {} },
}))
vi.mock('./firebase', () => ({ db: {} }))
import { useSubscription } from './data/useSubscription'
function actualProjection(raw: Record<string, unknown>) {
  useSubscription('fixture-only-user')
  projection.receive({ exists: () => true, data: () => raw })
  return projection.state.subscription
}

describe('actual subscription projection and timed complimentary access', () => {
  const now = Date.UTC(2026, 8, 15, 2, 0, 0)
  beforeEach(() => { projection.setCalls = 0; vi.useFakeTimers(); vi.setSystemTime(now) })
  afterEach(() => { for (const cleanup of projection.cleanups.splice(0)) cleanup(); vi.useRealTimers() })
  it.each(['pro', 'proPlus'])('keeps legacy %s plan-only service despite the hook default tier', (plan) => {
    const raw = Object.freeze({ subscriptionPlan: plan, agreedAmountCents: 1499 })
    const projected = actualProjection(raw)
    expect(projected.tier).toBe('free')
    expect(projected.raw).toBe(raw)
    expect(hasProAccess(projected)).toBe(true)
    expect(subscriptionPlanLabel(projected)).toBe('Pro')
    expect(raw.agreedAmountCents).toBe(1499)
  })
  it.each(['pro', 'proPlus'])('explicit stored free beats retained %s plan after cancellation', (plan) => {
    const projected = actualProjection({ subscriptionTier: 'free', subscriptionPlan: plan })
    expect(hasProAccess(projected)).toBe(false)
  })
  it('uses server fields rather than contradictory projected plan/tier fields', () => {
    expect(hasProAccess({ tier: 'pro', plan: 'proPlus', raw: { subscriptionTier: 'free', subscriptionPlan: 'proPlus' } })).toBe(false)
    expect(hasProAccess(actualProjection({ subscriptionTier: 'pro', subscriptionPlan: 'proPlus' }))).toBe(true)
    expect(hasProAccess(actualProjection({}))).toBe(false)
  })
  it.each([
    now + 1000, new Date(now + 1000), new Date(now + 1000).toISOString(),
    { seconds: (now + 1000) / 1000, nanoseconds: 0 },
    { _seconds: (now + 1000) / 1000, _nanoseconds: 0 },
    { toMillis: () => now + 1000 }, { toDate: () => new Date(now + 1000) },
  ])('honors active comp and expires at the exact boundary for %j', (compProUntil) => {
    const projected = actualProjection({ subscriptionTier: 'free', subscriptionPlan: 'proPlus', compProUntil })
    expect(hasProAccess(projected, now)).toBe(true)
    expect(hasProAccess(projected, now + 999)).toBe(true)
    expect(hasProAccess(projected, now + 1000)).toBe(false)
  })
  it.each([now - 1, now, 'invalid', NaN, {}, { toMillis: () => NaN }, { toMillis: () => { throw new Error('invalid timestamp') } }])('invalid or expired comp does not promote %j', (compProUntil) => {
    expect(hasProAccess(actualProjection({ subscriptionTier: 'free', compProUntil }))).toBe(false)
  })
  it('schedules an idle-screen reevaluation at comp expiry without changing subscription data', () => {
    const raw = Object.freeze({ subscriptionTier: 'free', compProUntil: now + 1000 })
    const projected = actualProjection(raw)
    projection.setCalls = 0
    expect(useProAccess(projected)).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(projection.setCalls).toBe(1)
    expect(useProAccess(projected)).toBe(false)
    expect(projected.raw).toBe(raw)
  })
  it('limits long comp timers to one minute for clock reevaluation', () => {
    const projected = actualProjection({ subscriptionTier: 'free', compProUntil: now + 90_000 })
    projection.setCalls = 0; expect(useProAccess(projected)).toBe(true)
    vi.advanceTimersByTime(59_999); expect(projection.setCalls).toBe(0)
    vi.advanceTimersByTime(1); expect(projection.setCalls).toBe(1)
  })
})
