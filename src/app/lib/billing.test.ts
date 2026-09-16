import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubscriptionCheckoutPlan } from './subscriptionOffer'

const state = vi.hoisted(() => ({ calls: new Map<string, ReturnType<typeof vi.fn>>(), bridge: null as null | { openExternal: ReturnType<typeof vi.fn> } }))
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions: unknown, name: string) => {
  const call = vi.fn(async () => ({ data: { url: 'https://checkout.stripe.com/c/pay/test_session' } }))
  state.calls.set(name, call)
  return call
} }))
vi.mock('./firebase', () => ({ functions: {} }))
import { openStripeBillingPortal, startSubscriptionCheckout } from './billing'

describe('distinct Pro and Pro+ hosted checkout requests', () => {
  beforeEach(() => {
    for (const call of state.calls.values()) call.mockClear()
    state.bridge = null
    vi.stubGlobal('window', { location: { origin: 'https://statskey.ai', assign: vi.fn() } })
  })
  afterEach(() => { vi.unstubAllGlobals() })
  it.each(['pro', 'proAnnual', 'proPlusMonthly', 'proPlusAnnual'] as const)('sends %s to existing authenticated callable with no client price or entitlement override', async (plan) => {
    await startSubscriptionCheckout(plan)
    expect(state.calls.get('createCheckoutSession')).toHaveBeenCalledExactlyOnceWith({
      plan,
      successUrl: 'https://statskey.ai/app/profile?billing=subscription-success',
      cancelUrl: 'https://statskey.ai/app/profile?billing=cancelled',
    })
    expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test_session')
  })
  it.each(['proPlus', 'free', 'unexpected'])('rejects new-sale selector %s before a callable or navigation', async (plan) => {
    await expect(startSubscriptionCheckout(plan as SubscriptionCheckoutPlan)).rejects.toThrow('Choose Pro or Pro+ with monthly or annual billing')
    expect(state.calls.get('createCheckoutSession')).not.toHaveBeenCalled()
    expect(window.location.assign).not.toHaveBeenCalled()
  })
  it('opens existing billing management without a target price, product, or subscription migration', async () => {
    await openStripeBillingPortal()
    expect(state.calls.get('createBillingPortalSession')).toHaveBeenCalledExactlyOnceWith({ returnUrl: 'https://statskey.ai/app/profile' })
    expect(state.calls.get('createCheckoutSession')).not.toHaveBeenCalled()
  })

})
