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
  options: { testMode?: boolean } = {}
): Promise<void> {
  const origin = window.location.origin
  const path = options.testMode ? '/app/tokens-test' : '/app/tokens'
  const callable = options.testMode ? createTokenPackCheckoutTest : createTokenPackCheckout
  const { data } = await callable({
    pack,
    successUrl: `${origin}${path}?checkout=success`,
    cancelUrl: `${origin}${path}?checkout=cancelled`,
  })

  if (!data.url) {
    throw new Error('Stripe did not return a checkout URL.')
  }

  window.location.assign(data.url)
}
