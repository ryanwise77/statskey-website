import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import {
  disableTokenAutoRecharge,
  fetchTokenPackCatalog,
  fetchTokenPackCheckoutStatus,
  startTokenPackCheckout,
  type AutoRechargeMonthlyLimit,
  type AutoRechargeThresholdPercent,
  type TokenPackCatalog,
  type TokenPackId,
} from '../lib/billing'
import { auth } from '../lib/firebase'
import { useAuth } from '../lib/auth'
import { formatTokens, useTokenBalance } from '../lib/data/useTokenBalance'
import { useTokenAutoRecharge } from '../lib/data/useTokenAutoRecharge'

// Deep link back into the iOS app after a web purchase.
const APP_RETURN_URL = 'statskey://tokens/success'

interface TokenPack {
  id: TokenPackId
  name: string
  credits: string
  basePriceCents: number
  subtitle: string
  bestFor: string
  featured?: boolean
}

// Base prices match the value delivered by the iOS packs. Web checkout recovers
// Stripe's published standard US online-card fee before applying StatsKey's
// disclosed 0.5% net margin. The server independently calculates and enforces
// the same amount; this client calculation is display-only.
const TOKEN_PACKS: TokenPack[] = [
  {
    id: '1m',
    name: 'Starter top-up',
    credits: '1M',
    basePriceCents: 1299,
    subtitle: 'Small overflow pack for extra Intelligence questions.',
    bestFor: 'A few deeper chats',
  },
  {
    id: '5m',
    name: 'Power month',
    credits: '5M',
    basePriceCents: 5999,
    subtitle: 'The cleanest option for heavy Intelligence use.',
    bestFor: 'Frequent frontier analysis',
    featured: true,
  },
  {
    id: '25m',
    name: 'Research pack',
    credits: '25M',
    basePriceCents: 29999,
    subtitle: 'Large one-time reserve for long context and bulk analysis.',
    bestFor: 'Power users and reports',
  },
  {
    id: '100m',
    name: 'Frontier reserve',
    credits: '100M',
    basePriceCents: 119999,
    subtitle: 'High-volume reserve for users who do not want BYOK.',
    bestFor: 'Never think about credits',
  },
]

const OWNER_MARGIN_BPS = 50
const STRIPE_PROCESSING_BPS = 290
const STRIPE_PROCESSING_FIXED_CENTS = 30

function processingReserveCents(checkoutAmountCents: number): number {
  return Math.ceil((checkoutAmountCents * STRIPE_PROCESSING_BPS) / 10_000)
    + STRIPE_PROCESSING_FIXED_CENTS
}

function netMarginCents(basePriceCents: number): number {
  return Math.ceil((basePriceCents * OWNER_MARGIN_BPS) / 10_000)
}

function checkoutUpliftCents(basePriceCents: number): number {
  const targetNetMargin = netMarginCents(basePriceCents)
  let checkoutAmount = Math.ceil(
    ((basePriceCents + targetNetMargin + STRIPE_PROCESSING_FIXED_CENTS) * 10_000)
      / (10_000 - STRIPE_PROCESSING_BPS)
  )
  while (
    checkoutAmount - processingReserveCents(checkoutAmount) - basePriceCents
      < targetNetMargin
  ) {
    checkoutAmount += 1
  }
  return checkoutAmount - basePriceCents
}

function checkoutTotalCents(pack: TokenPack): number {
  return pack.basePriceCents + checkoutUpliftCents(pack.basePriceCents)
}

function usd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function currentUtcMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

function autoRechargeStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Active'
    case 'charging': return 'Charge in progress'
    case 'retrying': return 'Retrying safely'
    case 'monthly_cap_reached': return 'Monthly limit reached'
    case 'action_required': return 'Payment authentication required'
    case 'payment_failed': return 'Payment failed · paused'
    case 'manual_review': return 'Paused for billing review'
    case 'billing_review': return 'Paused after a reversed payment'
    case 'reenrollment_required': return 'Re-enrollment required'
    case 'configuration_error': return 'Setup needs attention'
    case 'disabled': return 'Off'
    default: return 'Unknown'
  }
}

export function Tokens() {
  return <TokenPackStore testMode={false} />
}

export function TokensTest() {
  return <TokenPackStore testMode />
}

function TokenPackStore({ testMode }: { testMode: boolean }) {
  const { user } = useAuth()
  const tokenState = useTokenBalance(user?.uid)
  const autoRechargeState = useTokenAutoRecharge(user?.uid)
  const [searchParams, setSearchParams] = useSearchParams()
  const [busyPack, setBusyPack] = useState<TokenPackId | null>(null)
  const [autoRechargeOnPurchase, setAutoRechargeOnPurchase] = useState(false)
  const [thresholdPercent, setThresholdPercent] =
    useState<AutoRechargeThresholdPercent>(25)
  const [maxMonthlyRecharges, setMaxMonthlyRecharges] =
    useState<AutoRechargeMonthlyLimit>(3)
  const [disablingAutoRecharge, setDisablingAutoRecharge] = useState(false)
  const [autoRechargeNotice, setAutoRechargeNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tokenPackCatalog, setTokenPackCatalog] = useState<TokenPackCatalog | null>(null)
  const checkoutState = searchParams.get('checkout')
  const checkoutSessionId = searchParams.get('session_id')
  const returnToApp = searchParams.get('return') === 'app'
  const [checkoutVerification, setCheckoutVerification] = useState<{
    phase: 'idle' | 'checking' | 'fulfilled' | 'failed' | 'timed_out'
    status?: string
  }>({ phase: 'idle' })

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

  useEffect(() => {
    if (testMode) return
    let cancelled = false
    void fetchTokenPackCatalog()
      .then((catalog) => {
        if (!cancelled) setTokenPackCatalog(catalog)
      })
      .catch(() => {
        if (!cancelled) {
          setError('StatsKey could not load the current web pack prices. Please try again.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [testMode])

  useEffect(() => {
    let cancelled = false
    if (checkoutState !== 'success') {
      setCheckoutVerification({ phase: 'idle' })
      return
    }
    if (!checkoutSessionId) {
      setCheckoutVerification({ phase: 'failed', status: 'missing_session' })
      return
    }

    setCheckoutVerification({ phase: 'checking' })
    void (async () => {
      try {
        for (let attempt = 0; attempt < 45 && !cancelled; attempt += 1) {
          const result = await fetchTokenPackCheckoutStatus(checkoutSessionId, testMode)
          if (cancelled) return
          if (result.creditsGranted) {
            setCheckoutVerification({ phase: 'fulfilled', status: result.status })
            return
          }
          if (result.terminal) {
            setCheckoutVerification({ phase: 'failed', status: result.status })
            return
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1000))
        }
        if (!cancelled) {
          setCheckoutVerification({ phase: 'timed_out', status: 'pending' })
        }
      } catch {
        if (!cancelled) {
          setCheckoutVerification({ phase: 'failed', status: 'verification_error' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [checkoutSessionId, checkoutState, testMode])

  // Return to iOS only after the server-authoritative receipt confirms that
  // credits were granted. This avoids racing a delayed Stripe webhook.
  useEffect(() => {
    if (checkoutVerification.phase !== 'fulfilled' || !returnToApp) return
    const timer = setTimeout(() => {
      window.location.href = APP_RETURN_URL
    }, 500)
    return () => clearTimeout(timer)
  }, [checkoutVerification.phase, returnToApp])

  const status = useMemo(() => {
    if (checkoutState === 'success') {
      if (checkoutVerification.phase === 'fulfilled') {
        return {
          tone: 'success',
          title: 'Credits added',
          copy: testMode
            ? 'Stripe test mode confirmed the payment and the test credits were granted.'
            : 'Stripe confirmed the payment and StatsKey granted the credits to your account.',
        }
      }
      if (
        checkoutVerification.phase === 'checking' ||
        checkoutVerification.phase === 'idle'
      ) {
        return {
          tone: 'neutral',
          title: 'Confirming your credits…',
          copy: 'StatsKey is waiting for the signed Stripe webhook before updating your balance.',
        }
      }
      if (checkoutVerification.phase === 'timed_out') {
        return {
          tone: 'neutral',
          title: 'Payment is still processing',
          copy: 'Keep this page open or return later. Credits are added only after Stripe confirms payment.',
        }
      }
      return {
        tone: 'error',
        title: 'Credits were not added',
        copy: checkoutVerification.status === 'refunded_without_grant'
          ? 'The payment was refunded because StatsKey could not safely grant this pack.'
          : 'StatsKey could not verify this checkout. No credits are shown unless the server receipt confirms them.',
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
  }, [checkoutState, checkoutVerification, testMode])

  async function buy(pack: TokenPackId) {
    setBusyPack(pack)
    setError(null)
    try {
      await startTokenPackCheckout(pack, {
        testMode,
        returnToApp,
        ...(!testMode && autoRechargeOnPurchase
          ? {
              autoRecharge: {
                enabled: true as const,
                thresholdPercent,
                maxMonthlyRecharges,
              },
            }
          : {}),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyPack(null)
    }
  }

  const monthlyRechargeCount =
    autoRechargeState.config?.monthlyRechargeMonthKey === currentUtcMonthKey()
      ? autoRechargeState.config.monthlyRechargeCount
      : 0

  async function disableAutomaticReup() {
    setDisablingAutoRecharge(true)
    setError(null)
    setAutoRechargeNotice(null)
    try {
      const result = await disableTokenAutoRecharge()
      setAutoRechargeNotice(
        result.pendingCharge
          ? 'Automatic re-up is off. A charge already being processed may still complete.'
          : 'Automatic re-up is off. No new threshold charges will start.'
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDisablingAutoRecharge(false)
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
              : "Buy Stripe credit packs for StatsKey's managed Claude, ChatGPT, and Grok routes. Each purchase is one-time unless you explicitly opt in to threshold-based automatic re-up. Purchased credits unlock Data Agent and manually selected frontier models and stay separate from your monthly included allowance. Kimi uses your connected Moonshot key."}
          </p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="panel space-y-1">
          <span className="card-title">Remaining</span>
          <div className="font-display text-[30px] font-bold tracking-[-0.04em] text-text-primary">
            {tokenState.loading ? 'Loading…' : formatTokens(tokenState.tokens?.balance ?? 0)}
          </div>
          <p className="text-[12px] text-text-muted">Intelligence credit balance</p>
        </div>
        <div className="panel space-y-1">
          <span className="card-title">Included this month</span>
          <div className="font-display text-[30px] font-bold tracking-[-0.04em] text-text-primary">
            {tokenState.loading ? 'Loading…' : formatTokens(tokenState.tokens?.includedBalance ?? 0)}
          </div>
          <p className="text-[12px] text-text-muted">Ordinary managed conversations</p>
        </div>
        <div className="panel space-y-1">
          <span className="card-title">Purchased frontier</span>
          <div className="font-display text-[30px] font-bold tracking-[-0.04em] text-text-primary">
            {tokenState.loading ? 'Loading…' : formatTokens(tokenState.tokens?.purchasedBalance ?? 0)}
          </div>
          <p className="text-[12px] text-text-muted">Data Agent and frontier models</p>
        </div>
        <div className="panel space-y-1">
          <span className="card-title">Lifetime used</span>
          <div className="font-display text-[30px] font-bold tracking-[-0.04em] text-text-primary">
            {tokenState.loading ? 'Loading…' : formatTokens(tokenState.tokens?.lifetimeUsed ?? 0)}
          </div>
          <p className="text-[12px] text-text-muted">Deducted by app usage</p>
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
        <div className={
          status.tone === 'success'
            ? 'success-banner'
            : (status.tone === 'error' ? 'error-banner' : 'panel')
        }>
          <h2 className="font-display text-[18px] font-semibold text-text-primary">{status.title}</h2>
          <p className="mt-1 text-[13px] text-text-secondary">{status.copy}</p>
          {checkoutVerification.phase === 'fulfilled' && returnToApp && (
            <a href={APP_RETURN_URL} className="btn btn-primary mt-3 inline-flex">
              Return to StatsKey
            </a>
          )}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {!testMode && (
        <section className="panel space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-[650px] space-y-2">
              <span className="card-title">Automatic re-up</span>
              <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-text-primary">
                Keep your Intelligence balance ready.
              </h2>
              <p className="text-[13px] leading-relaxed text-text-secondary">
                Opt in on your next pack purchase and Stripe will save that payment method for
                off-session re-ups. StatsKey re-buys the same pack when your total balance reaches
                the threshold, subject to the monthly charge limit you choose.
              </p>
            </div>
            {autoRechargeState.config?.enabled && (
              <button
                className="btn btn-secondary"
                onClick={disableAutomaticReup}
                disabled={disablingAutoRecharge}
              >
                {disablingAutoRecharge ? 'Turning off…' : 'Turn off automatic re-up'}
              </button>
            )}
          </div>

          {autoRechargeState.error && <div className="error-banner">{autoRechargeState.error}</div>}
          {autoRechargeNotice && <div className="success-banner">{autoRechargeNotice}</div>}

          {autoRechargeState.config && (
            <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Status</div>
                <div className="mt-1 text-[14px] font-semibold text-text-primary">
                  {autoRechargeStatusLabel(autoRechargeState.config.status)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Pack</div>
                <div className="mt-1 text-[14px] font-semibold text-text-primary">
                  {formatTokens(autoRechargeState.config.packTokens)} · {usd(autoRechargeState.config.amountCents)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Trigger</div>
                <div className="mt-1 text-[14px] font-semibold text-text-primary">
                  Total balance ≤ {formatTokens(autoRechargeState.config.thresholdTokens)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Monthly guardrail</div>
                <div className="mt-1 text-[14px] font-semibold text-text-primary">
                  {monthlyRechargeCount} of {autoRechargeState.config.maxMonthlyRecharges} used
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  Up to {usd(autoRechargeState.config.amountCents * autoRechargeState.config.maxMonthlyRecharges)}
                </div>
              </div>
              {autoRechargeState.config.paymentMethod?.last4 && (
                <div className="sm:col-span-2 lg:col-span-4 text-[12px] text-text-muted">
                  Saved payment method: {autoRechargeState.config.paymentMethod.brand ?? autoRechargeState.config.paymentMethod.type}
                  {' '}•••• {autoRechargeState.config.paymentMethod.last4}
                </div>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--color-data)]"
              checked={autoRechargeOnPurchase}
              onChange={(event) => setAutoRechargeOnPurchase(event.target.checked)}
            />
            <span>
              <span className="block text-[14px] font-semibold text-text-primary">
                {autoRechargeState.config?.enabled
                  ? 'Replace my automatic re-up settings with my next purchase'
                  : 'Enable automatic re-up with my next purchase'}
              </span>
              <span className="mt-1 block text-[12px] leading-relaxed text-text-muted">
                This box is never preselected. Starting Stripe Checkout records this consent;
                automatic re-up activates only after payment succeeds.
                {autoRechargeState.config?.enabled
                  ? ' If left unchecked, your current automatic re-up stays active until you turn it off above.'
                  : ''}
              </span>
            </span>
          </label>

          {autoRechargeOnPurchase && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-[12px] text-text-secondary">
                <span className="block font-semibold text-text-primary">Re-up threshold</span>
                <select
                  className="input w-full"
                  value={thresholdPercent}
                  onChange={(event) => setThresholdPercent(Number(event.target.value) as AutoRechargeThresholdPercent)}
                >
                  <option value={10}>10% of the purchased pack</option>
                  <option value={25}>25% of the purchased pack</option>
                  <option value={50}>50% of the purchased pack</option>
                </select>
                <span className="block text-text-muted">Measured against your total remaining balance.</span>
              </label>
              <label className="space-y-2 text-[12px] text-text-secondary">
                <span className="block font-semibold text-text-primary">Maximum charges per UTC month</span>
                <select
                  className="input w-full"
                  value={maxMonthlyRecharges}
                  onChange={(event) => setMaxMonthlyRecharges(Number(event.target.value) as AutoRechargeMonthlyLimit)}
                >
                  <option value={1}>1 automatic charge</option>
                  <option value={3}>3 automatic charges</option>
                  <option value={5}>5 automatic charges</option>
                </select>
                <span className="block text-text-muted">A hard server-side loop and spend guardrail.</span>
              </label>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-text-muted">
            Every web pack price includes estimated Stripe processing and a 0.5% StatsKey net
            margin. Actual processing fees can vary by payment method. If Stripe requires
            authentication or a payment fails, automatic re-up pauses instead of retrying blindly.
            You can turn it off here at any time; a charge already processing may still complete.
          </p>
        </section>
      )}

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
                  {usd(
                    tokenPackCatalog?.packs[pack.id]?.amountCents
                      ?? checkoutTotalCents(pack)
                  )}
                </div>
                <p className="text-[11px] text-text-muted">
                  Includes estimated Stripe processing + {usd(
                    tokenPackCatalog?.packs[pack.id]?.netOwnerMarginAmountCents
                      ?? netMarginCents(pack.basePriceCents)
                  )} StatsKey margin
                </p>
                <p className="text-[12px] text-text-muted">{pack.bestFor}</p>
              </div>
              <button
                className={`${pack.featured ? 'btn btn-primary' : 'btn btn-secondary'} w-full sm:w-auto`}
                onClick={() => buy(pack.id)}
                disabled={
                  busyPack !== null ||
                  (!testMode && tokenPackCatalog === null)
                }
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
            StatsKey shows the in-app website shortcut only where the App Store storefront permits
            it. Apple purchase options remain available in the iOS app.
          </p>
        </div>

        <div className="panel space-y-3">
          <span className="card-title">Already subscribed?</span>
          <p className="text-[14px] leading-relaxed text-text-secondary">
            Pro+ unlimited applies only to eligible Auto-routed conversations under fair use.
            Data Agent, GPT-5.6 Sol, and other manually selected frontier models use purchased
            credits (or your own provider key), even on Pro+.
          </p>
          <p className="text-[12px] leading-relaxed text-text-muted">
            Credits are StatsKey usage units—not literal provider tokens. Purchases are one-time
            unless you explicitly enable threshold-based automatic re-up; automatic re-up can be
            disabled on this page at any time.
            Usage is cost-weighted by model and workload. Purchased credits do not expire while
            your StatsKey account remains active; refunds follow the purchase channel terms and applicable law.
          </p>
          <Link to="/profile" className="link text-[13px] font-medium">
            View profile and subscription status
          </Link>
        </div>
      </section>
    </div>
  )
}
