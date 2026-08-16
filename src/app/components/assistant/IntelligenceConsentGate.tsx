import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import {
  grantAssistantActionConsent,
  grantBaseIntelligenceConsent,
  revokeIntelligenceConsent,
  useIntelligenceConsent,
} from '../../lib/intelligenceConsent'
import { confirmDialog } from '../../lib/ui/dialogs'

const PROVIDERS = [
  {
    name: 'Google Gemini and Vertex services',
    company: 'Google LLC',
    url: 'https://policies.google.com/privacy',
  },
  {
    name: 'Anthropic Claude',
    company: 'Anthropic, PBC',
    url: 'https://www.anthropic.com/legal/privacy',
  },
  {
    name: 'ChatGPT',
    company: 'OpenAI OpCo, LLC',
    url: 'https://openai.com/policies/row-privacy-policy/',
  },
  {
    name: 'Grok',
    company: 'xAI Corp.',
    url: 'https://x.ai/legal/privacy-policy',
  },
  {
    name: 'Kimi',
    company: 'MOONSHOT AI PTE. LTD.',
    url: 'https://platform.kimi.ai/docs/agreement/userprivacy',
  },
]

const BASE_DATA_CATEGORIES = [
  'Messages and prompts you type into StatsKey Intelligence or Deep Dive reports',
  'Relevant summaries from your nutrition, weight, hydration, supplements, workouts, pace, heart rate, wellness, and fitness plans',
  'Compact search results derived from the records you enable',
  'Profile basics you provided, such as name, body profile, weight, height, and goals',
]
const ASSISTANT_ACTION_CATEGORY =
  'Email recipients, message text, calendar details, and attendee addresses used for actions you ask the Assistant to prepare; and, only when you separately connect and request a read task, relevant Gmail message or thread content and calendar event details'

export function IntelligenceConsentGate({
  children,
  requireAssistantActions = true,
}: {
  children: ReactNode
  requireAssistantActions?: boolean
}) {
  const { user } = useAuth()
  const consent = useIntelligenceConsent(user?.uid)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (consent.loading) {
    return (
      <div className="panel text-text-secondary text-sm">
        Checking Intelligence data-sharing permission…
      </div>
    )
  }
  const enabled = requireAssistantActions
    ? consent.granted
    : consent.intelligenceGranted
  if (enabled) return <>{children}</>

  async function accept() {
    if (accepting) return
    setAccepting(true)
    setError(null)
    try {
      if (!consent.intelligenceGranted) {
        await grantBaseIntelligenceConsent()
      }
      if (requireAssistantActions && !consent.assistantGranted) {
        await grantAssistantActionConsent()
      }
    } catch (acceptError) {
      setError(messageFor(acceptError))
    } finally {
      setAccepting(false)
    }
  }

  return (
    <section className="intel-consent">
      <header>
        <span className="intel-mark w-12 h-12 text-[20px]" aria-hidden="true">✦</span>
        <div>
          <h1>Before you use Intelligence</h1>
          <p>
            Review what StatsKey may share, who receives it, and then choose
            whether to enable these features.
          </p>
        </div>
      </header>

      <div className="intel-consent__summary">
        StatsKey uses Intelligence services from outside companies to answer
        questions, search your enabled record, and generate Deep Dive reports.
        {requireAssistantActions
          ? ' The Assistant can also prepare reviewed external actions.'
          : ''}{' '}
        Relevant content is sent only when you use one of these features.
      </div>

      <ConsentSection title="What may be sent">
        <ul>
          {[
            ...BASE_DATA_CATEGORIES,
            ...(requireAssistantActions ? [ASSISTANT_ACTION_CATEGORY] : []),
          ].map((category) => (
            <li key={category}>{category}</li>
          ))}
        </ul>
      </ConsentSection>

      <ConsentSection title="Who may receive it">
        <div className="intel-consent__providers">
          {PROVIDERS.map((provider) => (
            <a
              key={provider.name}
              href={provider.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{provider.name}</span>
              <small>{provider.company} · Privacy policy</small>
            </a>
          ))}
        </div>
      </ConsentSection>

      <p className="intel-consent__fine-print">
        Providers process transmitted content under their own privacy policies.
        Raw connected-account read results are not copied into saved chat
        history, but reviewed action payloads and their audit history are saved.
        Disabling Intelligence requests deletion of StatsKey’s derived private
        search index. Manual recording and your saved data continue to work.
      </p>
      <a
        className="link text-sm"
        href="https://statskey.ai/privacy.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        Read the StatsKey Privacy Policy
      </a>

      {(error || consent.error) && (
        <div className="error-banner">{error || consent.error}</div>
      )}

      <div className="intel-consent__actions">
        <Link className="btn btn-secondary" to="/">Not now</Link>
        <button className="btn btn-intel" onClick={accept} disabled={accepting || !!consent.error}>
          {accepting
            ? 'Enabling…'
            : requireAssistantActions
            ? 'I Agree — Enable Assistant & Intelligence'
            : 'I Agree — Enable Intelligence Features'}
        </button>
      </div>
    </section>
  )
}

export function IntelligenceConsentSettings() {
  const { user } = useAuth()
  const consent = useIntelligenceConsent(user?.uid)
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function revoke() {
    if (revoking) return
    const confirmed = await confirmDialog({
      title: 'Disable Intelligence features?',
      body: 'Manual recording and saved data will remain available.',
      confirmLabel: 'Disable',
      destructive: true,
    })
    if (!confirmed) return
    setRevoking(true)
    setError(null)
    try {
      await revokeIntelligenceConsent()
    } catch (revokeError) {
      setError(messageFor(revokeError))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="panel space-y-3">
      <div>
        <span className="card-title">Intelligence data sharing</span>
        <p className="text-text-muted text-[12px] mt-1">
          Controls whether StatsKey may send relevant enabled content to the
          disclosed Intelligence providers.
        </p>
      </div>

      {consent.loading ? (
        <p className="text-text-secondary text-sm">Checking permission…</p>
      ) : consent.granted ? (
        <>
          <p className="text-text-secondary text-sm">
            Enabled
            {consent.acceptedAt
              ? ` · Accepted ${consent.acceptedAt.toLocaleDateString()}`
              : ''}
          </p>
          <button
            className="btn btn-secondary"
            onClick={revoke}
            disabled={revoking}
          >
            {revoking ? 'Disabling…' : 'Disable Intelligence features'}
          </button>
        </>
      ) : (
        <>
          <p className="text-text-secondary text-sm">
            {consent.intelligenceGranted
              ? 'Intelligence enabled · Assistant actions not enabled'
              : 'Not enabled'}
          </p>
          <Link className="btn btn-secondary" to="/flow">
            {consent.intelligenceGranted
              ? 'Review Assistant disclosure'
              : 'Review disclosure'}
          </Link>
          {consent.intelligenceGranted && (
            <button
              className="btn btn-secondary"
              onClick={revoke}
              disabled={revoking}
            >
              {revoking ? 'Disabling…' : 'Disable Intelligence features'}
            </button>
          )}
        </>
      )}

      {(error || consent.error) && (
        <div className="error-banner">{error || consent.error}</div>
      )}
    </div>
  )
}

function ConsentSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="intel-consent__section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
