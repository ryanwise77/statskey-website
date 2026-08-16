import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { proposeAssistantAction } from '../../lib/assistant/actions'
import { useGoogleAssistantConnection } from '../../lib/assistant/connections'
import { useAssistantActions } from '../../lib/data/useAssistantActions'
import { useIntelligenceConsent } from '../../lib/intelligenceConsent'

export function AssistantIntegrationTest() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const consent = useIntelligenceConsent(user?.uid)
  const connection = useGoogleAssistantConnection(user?.uid)
  const actions = useAssistantActions(user?.uid, 20)
  const [busy, setBusy] = useState<'calendar' | 'email' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const capabilities = connection.connection?.capabilities ?? []
  const calendarReady =
    consent.granted &&
    connection.connection?.status === 'connected' &&
    capabilities.includes('calendar')
  const emailReady =
    consent.granted &&
    connection.connection?.status === 'connected' &&
    capabilities.includes('email') &&
    !!connection.connection.accountEmail
  const syncReady = !!user && !actions.loading && !actions.error

  async function prepareCalendarTest() {
    if (!calendarReady || busy) return
    setBusy('calendar')
    setError(null)
    try {
      const start = roundedFutureDate(10)
      const end = new Date(start.getTime() + 15 * 60 * 1000)
      await proposeAssistantAction({
        kind: 'calendar.create',
        payload: {
          provider: 'google',
          title: 'StatsKey desktop integration test',
          start: start.toISOString(),
          end: end.toISOString(),
          timeZone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          allDay: false,
          sendInvitations: false,
          notes:
            'Created only after approval to verify StatsKey desktop and website synchronization.',
        },
        origin: integrationOrigin(),
      })
      navigate('/flow')
    } catch (testError) {
      setError(messageFor(testError))
    } finally {
      setBusy(null)
    }
  }

  async function prepareEmailTest() {
    const accountEmail = connection.connection?.accountEmail
    if (!emailReady || !accountEmail || busy) return
    setBusy('email')
    setError(null)
    try {
      await proposeAssistantAction({
        kind: 'email.send',
        payload: {
          provider: 'google',
          fromAccount: accountEmail,
          to: [accountEmail],
          cc: [],
          bcc: [],
          subject: 'StatsKey Assistant integration test',
          bodyText:
            'This message confirms that the StatsKey approval queue and Gmail send-only connection are working.',
        },
        origin: integrationOrigin(),
      })
      navigate('/flow')
    } catch (testError) {
      setError(messageFor(testError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel space-y-4">
      <div>
        <span className="card-title">Test desktop ↔ website integrations</span>
        <p className="text-text-muted text-[12px] mt-1">
          Prepare a safe proposal here, then open Actions on both surfaces. The
          same pending item and status should appear immediately in each.
          Nothing executes until you approve the exact action.
        </p>
      </div>

      <div className="assistant-test__status">
        <StatusRow label="Shared account record" ready={syncReady} />
        <StatusRow label="Assistant disclosure" ready={consent.granted} />
        <StatusRow label="Google Calendar" ready={calendarReady} />
        <StatusRow label="Gmail send-only" ready={emailReady} />
        <StatusRow
          label="Pending synchronized actions"
          ready={actions.pendingCount > 0}
          detail={String(actions.pendingCount)}
          neutral
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          onClick={prepareCalendarTest}
          disabled={!calendarReady || busy != null}
        >
          {busy === 'calendar'
            ? 'Preparing…'
            : 'Prepare 15-minute calendar test'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={prepareEmailTest}
          disabled={!emailReady || busy != null}
        >
          {busy === 'email' ? 'Preparing…' : 'Prepare email-to-self test'}
        </button>
      </div>

      {(!calendarReady || !emailReady) && (
        <p className="text-text-muted text-[11px]">
          Enable the Assistant disclosure and connect the corresponding Google
          capability above to activate each test.
        </p>
      )}
      {(error || actions.error || connection.error || consent.error) && (
        <div className="error-banner">
          {error || actions.error || connection.error || consent.error}
        </div>
      )}
    </div>
  )
}

function StatusRow({
  label,
  ready,
  detail,
  neutral = false,
}: {
  label: string
  ready: boolean
  detail?: string
  neutral?: boolean
}) {
  return (
    <div>
      <span>{label}</span>
      <b className={neutral ? 'neutral' : ready ? 'ready' : undefined}>
        {detail ?? (ready ? 'Ready' : 'Not ready')}
      </b>
    </div>
  )
}

function roundedFutureDate(minutesAhead: number): Date {
  const date = new Date(Date.now() + minutesAhead * 60 * 1000)
  date.setSeconds(0, 0)
  return date
}

function integrationOrigin() {
  return {
    sessionId: 'manual-integration-test',
    messageId: crypto.randomUUID(),
    model: 'manual-integration-test',
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
