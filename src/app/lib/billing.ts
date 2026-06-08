import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export type TokenPackId = '1m' | '5m' | '25m' | '100m'

interface TokenPackCheckoutRequest {
  pack: TokenPackId
  successUrl: string
  cancelUrl: string
}

interface CheckoutResponse {
  url?: string
  sessionId?: string
}

const createTokenPackCheckout = httpsCallable<TokenPackCheckoutRequest, CheckoutResponse>(
  functions,
  'createTokenPackCheckoutSession'
)

const createTokenPackCheckoutTest = httpsCallable<TokenPackCheckoutRequest, CheckoutResponse>(
  functions,
  'createTokenPackCheckoutSessionTest'
)

export async function startTokenPackCheckout(
  pack: TokenPackId,
  options: { testMode?: boolean; returnToApp?: boolean } = {}
): Promise<void> {
  const origin = window.location.origin
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

  window.location.assign(data.url)
}
