import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { getDesktopBridge } from './desktop'

export type TokenPackId = '1m' | '5m' | '25m' | '100m'
export type SubscriptionCheckoutPlan =
  | 'pro'
  | 'proPlusMonthly'
  | 'proPlusAnnual'

export type AutoRechargeThresholdPercent = 10 | 25 | 50
export type AutoRechargeMonthlyLimit = 1 | 3 | 5

export interface AutoRechargeCheckoutSettings {
  enabled: true
  thresholdPercent: AutoRechargeThresholdPercent
  maxMonthlyRecharges: AutoRechargeMonthlyLimit
}

interface TokenPackCheckoutRequest {
  pack: TokenPackId
  checkoutAttemptId: string
  autoRecharge?: AutoRechargeCheckoutSettings
  successUrl: string
  cancelUrl: string
}

interface CheckoutResponse {
  url?: string
  sessionId?: string
  amountCents?: number
  currency?: string
}

export interface TokenPackCheckoutStatus {
  status: string
  terminal: boolean
  creditsGranted: boolean
}

export interface TokenPackCatalogEntry {
  credits: number
  amountCents: number
  baseAmountCents: number
  processingReserveAmountCents: number
  netOwnerMarginAmountCents: number
  currency: string
  pricingVersion: string
}

export interface TokenPackCatalog {
  pricingVersion: string
  packs: Record<TokenPackId, TokenPackCatalogEntry>
}

const createSubscriptionCheckout = httpsCallable<
  {
    plan: SubscriptionCheckoutPlan
    successUrl: string
    cancelUrl: string
  },
  CheckoutResponse
>(functions, 'createCheckoutSession')
const createTokenPackCheckout = httpsCallable<TokenPackCheckoutRequest, CheckoutResponse>(
  functions,
  'createTokenPackCheckoutSession'
)

const createTokenPackCheckoutTest = httpsCallable<TokenPackCheckoutRequest, CheckoutResponse>(
  functions,
  'createTokenPackCheckoutSessionTest'
)
const createBillingPortal = httpsCallable<
  { returnUrl: string },
  { url?: string }
>(functions, 'createBillingPortalSession')
const disableAutoRecharge = httpsCallable<
  Record<string, never>,
  { disabled?: boolean; pendingCharge?: boolean }
>(functions, 'disableTokenAutoRecharge')
const getTokenCheckoutStatus = httpsCallable<
  { sessionId: string; testMode: boolean },
  TokenPackCheckoutStatus
>(functions, 'getTokenPackCheckoutStatus')
const getTokenCatalog = httpsCallable<Record<string, never>, TokenPackCatalog>(
  functions,
  'getTokenPackCatalog'
)

export async function startTokenPackCheckout(
  pack: TokenPackId,
  options: {
    testMode?: boolean
    returnToApp?: boolean
    autoRecharge?: AutoRechargeCheckoutSettings
  } = {}
): Promise<void> {
  const origin = checkoutReturnOrigin()
  const path = options.testMode ? '/app/tokens-test' : '/app/tokens'
  const callable = options.testMode ? createTokenPackCheckoutTest : createTokenPackCheckout
  // Carry the "return=app" flag through Stripe so the post-checkout page can
  // deep-link the user back into the iOS app instead of stranding them on web.
  const returnSuffix = options.returnToApp ? '&return=app' : ''
  const { data } = await callable({
    pack,
    checkoutAttemptId: newCheckoutAttemptId(),
    ...(options.testMode || !options.autoRecharge
      ? {}
      : { autoRecharge: options.autoRecharge }),
    successUrl: `${origin}${path}?checkout=success${returnSuffix}`,
    cancelUrl: `${origin}${path}?checkout=cancelled${returnSuffix}`,
  })

  if (!data.url) {
    throw new Error('Stripe did not return a checkout URL.')
  }

  await openStripeHostedPage(data.url)
}

export async function disableTokenAutoRecharge(): Promise<{ pendingCharge: boolean }> {
  const { data } = await disableAutoRecharge({})
  if (!data.disabled) {
    throw new Error('StatsKey could not disable automatic re-up.')
  }
  return { pendingCharge: data.pendingCharge === true }
}

export async function fetchTokenPackCheckoutStatus(
  sessionId: string,
  testMode = false
): Promise<TokenPackCheckoutStatus> {
  const { data } = await getTokenCheckoutStatus({ sessionId, testMode })
  return data
}

export async function fetchTokenPackCatalog(): Promise<TokenPackCatalog> {
  const { data } = await getTokenCatalog({})
  return data
}

export async function startSubscriptionCheckout(
  plan: SubscriptionCheckoutPlan
): Promise<void> {
  const origin = checkoutReturnOrigin()
  const path = '/app/settings/connections'
  const { data } = await createSubscriptionCheckout({
    plan,
    successUrl: `${origin}${path}?billing=subscription-success`,
    cancelUrl: `${origin}${path}?billing=cancelled`,
  })
  if (!data.url) {
    throw new Error('Stripe did not return a subscription checkout URL.')
  }
  await openStripeHostedPage(data.url)
}

export async function openStripeBillingPortal(): Promise<void> {
  const { data } = await createBillingPortal({
    returnUrl: `${checkoutReturnOrigin()}/app/settings/connections`,
  })
  if (!data.url) {
    throw new Error('Stripe did not return a billing portal URL.')
  }
  await openStripeHostedPage(data.url)
}

function checkoutReturnOrigin(): string {
  return getDesktopBridge() ? 'https://statskey.ai' : window.location.origin
}

function newCheckoutAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const random = Math.random().toString(36).slice(2)
  return `checkout_${Date.now().toString(36)}_${random}_${random}`
}

async function openStripeHostedPage(url: string): Promise<void> {
  const desktop = getDesktopBridge()
  if (!desktop) {
    window.location.assign(url)
    return
  }
  if (!(await desktop.openExternal(url))) {
    throw new Error('StatsKey could not open the secure Stripe page.')
  }
}
