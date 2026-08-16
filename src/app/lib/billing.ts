import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { getDesktopBridge } from './desktop'

export type TokenPackId = '1m' | '5m' | '25m' | '100m'
export type SubscriptionCheckoutPlan =
  | 'pro'
  | 'proPlusMonthly'
  | 'proPlusAnnual'

interface TokenPackCheckoutRequest {
  pack: TokenPackId
  successUrl: string
  cancelUrl: string
}

interface CheckoutResponse {
  url?: string
  sessionId?: string
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

export async function startTokenPackCheckout(
  pack: TokenPackId,
  options: { testMode?: boolean; returnToApp?: boolean } = {}
): Promise<void> {
  const origin = checkoutReturnOrigin()
  const path = options.testMode ? '/app/tokens-test' : '/app/tokens'
  const callable = options.testMode ? createTokenPackCheckoutTest : createTokenPackCheckout
  // Carry the "return=app" flag through Stripe so the post-checkout page can
  // deep-link the user back into the iOS app instead of stranding them on web.
  const returnSuffix = options.returnToApp ? '&return=app' : ''
  const { data } = await callable({
    pack,
    successUrl: `${origin}${path}?checkout=success${returnSuffix}`,
    cancelUrl: `${origin}${path}?checkout=cancelled${returnSuffix}`,
  })

  if (!data.url) {
    throw new Error('Stripe did not return a checkout URL.')
  }

  await openStripeHostedPage(data.url)
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
