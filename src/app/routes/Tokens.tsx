import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { startTokenPackCheckout, type TokenPackId } from '../lib/billing'
import { auth } from '../lib/firebase'
import { useAuth } from '../lib/auth'
import { formatTokens, useTokenBalance } from '../lib/data/useTokenBalance'

// Deep link back into the iOS app after a web purchase.
const APP_RETURN_URL = 'statskey://tokens/success'

interface TokenPack {
  id: TokenPackId
  name: string
  credits: string
  price: string
  subtitle: string
  bestFor: string
  featured?: boolean
}

// Prices match the iOS App Store token packs ($12.99 / $59.99 / $299.99);
// the web-only 100M pack keeps the same ~$12/M unit rate.
const TOKEN_PACKS: TokenPack[] = [
  {
    id: '1m',
    name: 'Starter top-up',
    credits: '1M',
    price: '$12.99',
    subtitle: 'Small overflow pack for extra Intelligence questions.',
    bestFor: 'A few deeper chats',
  },
  {
    id: '5m',
    name: 'Power month',
    credits: '5M',
    price: '$59.99',
    subtitle: 'The cleanest option for heavy Intelligence use.',
    bestFor: 'Frequent deep analysis',
    featured: true,
  },
  {
    id: '25m',
    name: 'Research pack',
    credits: '25M',
    price: '$299.99',
    subtitle: 'Large one-time reserve for long context and bulk analysis.',
    bestFor: 'Power users and reports',
  },
  {
    id: '100m',
    name: 'Frontier reserve',
    credits: '100M',
    price: '$1,199.99',
    subtitle: 'High-volume reserve for users who do not want BYOK.',
    bestFor: 'Never think about credits',
  },
]

export function Tokens() {
  return <TokenPackStore testMode={false} />
}

export function TokensTest() {
  return <TokenPackStore testMode />
}

function TokenPackStore({ testMode }: { testMode: boolean }) {
  const { user } = useAuth()
  const tokenState = useTokenBalance(user?.uid)
  const [searchParams, setSearchParams] = useSearchParams()
  const [busyPack, setBusyPack] = useState<TokenPackId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const checkoutState = searchParams.get('checkout')
  const returnToApp = searchParams.get('return') === 'app'

  // Auth handoff: the iOS app opens this page with a one-time Firebase custom
  // token so the user is signed into the same account automatically — no second
  // login. Consume it once, then strip it from the URL so it can't be reused.
  useEffect(() => {
    const token = searchParams.get('signInToken')
    if (!token) return
    void signInWithCustomToken(auth, token)
      .catch(() => {})
      .finally(() => {
        const next = new URLSearchParams(searchParams)
        next.delete('signInToken')
        setSearchParams(next, { replace: true })
      })
  }, [searchParams, setSearchParams])

  // After a successful web purchase from the app, bounce back into the app so
  // the user isn't stranded in the browser.
  useEffect(() => {
    if (checkoutState !== 'success' || !returnToApp) return
    const timer = setTimeout(() => {
      window.location.href = APP_RETURN_URL
    }, 1500)
    return () => clearTimeout(timer)
  }, [checkoutState, returnToApp])

  const status = useMemo(() => {
    if (checkoutState === 'success') {
      return {
        tone: 'success',
        title: 'Checkout complete',
        copy: testMode
          ? 'Stripe test mode confirmed the fake-card payment. Tokens are granted only if your UID is in the test allowlist.'
          : 'Stripe confirmed your payment. Tokens are granted by the webhook and should appear in StatsKey shortly.',
      }
    }
    if (checkoutState === 'cancelled') {
      return {
        tone: 'neutral',
        title: 'Checkout cancelled',
        copy: 'No charge was made. Pick a pack below when you are ready.',
      }
    }
    return null
  }, [checkoutState, testMode])

  async function buy(pack: TokenPackId) {
    setBusyPack(pack)
    setError(null)
    try {
      await startTokenPackCheckout(pack, { testMode, returnToApp })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusyPack(null)
    }
  }

  return (
    <div className="max-w-[940px] space-y-8">
      <header className="space-y-3">
        <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-data">
          Store · Intelligence credits
        </div>
        {testMode && (
          <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
            Stripe test mode
          </div>
        )}
        <div className="space-y-2">
          <h1 className="font-display text-[34px] font-bold tracking-[-0.035em]">
            {testMode ? 'Test credit checkout before going live.' : 'More Intelligence credits, no API key.'}
          </h1>
          <p className="max-w-[680px] text-[15px] leading-relaxed text-text-secondary">
            {testMode
              ? 'This hidden route uses Stripe test keys and fake cards. It only grants credits for Firebase UIDs in the server allowlist.'
              : "Buy Stripe top-ups for StatsKey's managed Claude, ChatGPT, and Grok routes. Credits are cost-weighted by provider price and added to the same account you use in the iOS app. Kimi uses your connected Moonshot key."}
          </p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="panel space-y-1">
          <span className="card-title">Remaining</span>
          <div className="font-display text-[30px] font-bold tracking-[-0.04em] text-text-primary">
            {tokenState.loading ? 'Loading…' : formatTokens(tokenState.tokens?.balance ?? 0)}
          </div>
          <p className="text-[12px] text-text-muted">Intelligence credit balance</p>
        </div>
        <div className="panel space-y-1">
          <span className="card-title">Lifetime used</span>
          <div className="font-display text-[30px] font-bold tracking-[-0.04em] text-text-primary">
            {tokenState.loading ? 'Loading…' : formatTokens(tokenState.tokens?.lifetimeUsed ?? 0)}
          </div>
          <p className="text-[12px] text-text-muted">Deducted by app usage</p>
        </div>
        <div className="panel space-y-1">
          <span className="card-title">Billing period</span>
          <div className="font-display text-[30px] font-bold tracking-[-0.04em] text-text-primary">
            {tokenState.loading ? 'Loading…' : tokenState.tokens?.currentMonth ?? 'None'}
          </div>
          <p className="text-[12px] text-text-muted">
            {tokenState.tokens?.lastStripeCheckoutSessionId
              ? 'Latest web pack recorded'
              : tokenState.tokens?.lastStripeTestCheckoutSessionId
                ? 'Latest test pack recorded'
                : 'No web pack yet'}
          </p>
        </div>
      </section>

      {tokenState.error && <div className="error-banner">{tokenState.error}</div>}

      {testMode && (
        <div className="panel space-y-2">
          <h2 className="font-display text-[18px] font-semibold text-text-primary">Test card</h2>
          <p className="text-[13px] text-text-secondary">
            Use <span className="font-mono text-text-primary">4242 4242 4242 4242</span>,
            any future expiration date, and any CVC. No real money moves in this mode.
          </p>
        </div>
      )}

      {status && (
        <div className={status.tone === 'success' ? 'success-banner' : 'panel'}>
          <h2 className="font-display text-[18px] font-semibold text-text-primary">{status.title}</h2>
          <p className="mt-1 text-[13px] text-text-secondary">{status.copy}</p>
          {checkoutState === 'success' && returnToApp && (
            <a href={APP_RETURN_URL} className="btn btn-primary mt-3 inline-flex">
              Return to StatsKey
            </a>
          )}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <section className="grid gap-4 md:grid-cols-2">
        {TOKEN_PACKS.map((pack) => (
          <article
            key={pack.id}
            className={`token-pack-card ${pack.featured ? 'token-pack-card--featured' : ''}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-text-primary">
                    {pack.name}
                  </h2>
                  {pack.featured && <span className="token-pack-badge">Best fit</span>}
                </div>
                <p className="mt-1 text-[13px] text-text-secondary">{pack.subtitle}</p>
              </div>
              <div className="text-right">
                <div className="font-display text-[28px] font-bold tracking-[-0.04em] text-text-primary">
                  {pack.credits}
                </div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">credits</div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="font-display text-[24px] font-bold tracking-[-0.03em] text-text-primary">
                  {pack.price}
                </div>
                <p className="text-[12px] text-text-muted">{pack.bestFor}</p>
              </div>
              <button
                className={`${pack.featured ? 'btn btn-primary' : 'btn btn-secondary'} w-full sm:w-auto`}
                onClick={() => buy(pack.id)}
                disabled={busyPack !== null}
              >
                {busyPack === pack.id ? 'Opening Stripe…' : (testMode ? 'Test checkout' : 'Buy on web')}
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
        <div className="panel space-y-3">
          <span className="card-title">How this works</span>
          <p className="text-[14px] leading-relaxed text-text-secondary">
            Stripe handles the payment page. After payment succeeds, a Firebase webhook grants
            the credit pack to your StatsKey account and the iOS app picks it up from Firebase.
          </p>
          <p className="text-[12px] leading-relaxed text-text-muted">
            Do not open this checkout from inside the iOS app unless StatsKey has the relevant
            Apple external-purchase entitlement and review approval.
          </p>
        </div>

        <div className="panel space-y-3">
          <span className="card-title">Already subscribed?</span>
          <p className="text-[14px] leading-relaxed text-text-secondary">
            Pro+ remains the normal power-user plan with 2M Intelligence credits every month.
            Packs are for spikes when you need more without bringing your own provider key.
          </p>
          <Link to="/profile" className="link text-[13px] font-medium">
            View profile and subscription status
          </Link>
        </div>
      </section>
    </div>
  )
}
