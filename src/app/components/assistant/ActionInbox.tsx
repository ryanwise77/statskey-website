import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  approveAssistantAction,
  rejectAssistantAction,
  retryAssistantAction,
  type AssistantAction,
} from '../../lib/assistant/actions'
import { downloadCalendarAction } from '../../lib/assistant/calendarIcs'
import { useAuth } from '../../lib/auth'

interface ActionInboxProps {
  actions: AssistantAction[]
  loading: boolean
  error: string | null
}

const ACTIVE_STATUSES = new Set([
  'awaitingApproval',
  'approved',
  'executing',
  'awaitingResponse',
])

export function ActionInbox({ actions, loading, error }: ActionInboxProps) {
  const { user, profile } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const visible = useMemo(() => {
    const active = actions.filter((action) => ACTIVE_STATUSES.has(action.status))
    const history = actions
      .filter((action) => !ACTIVE_STATUSES.has(action.status))
      .slice(0, Math.max(0, 8 - active.length))
    return [...active, ...history]
  }, [actions])

  async function approve(action: AssistantAction) {
    if (
      action.kind === 'calendar.create' &&
      calendarProvider(action) !== 'google'
    ) {
      setMutationError(
        'Portable calendar proposals can only be opened as an .ics event.'
      )
      return
    }
    setBusyId(action.id)
    setMutationError(null)
    try {
      await approveAssistantAction(action.id, action.payloadHash)
    } catch (approvalError) {
      setMutationError(messageFor(approvalError))
    } finally {
      setBusyId(null)
    }
  }

  async function reject(action: AssistantAction) {
    setBusyId(action.id)
    setMutationError(null)
    try {
      await rejectAssistantAction(action.id)
    } catch (rejectionError) {
      setMutationError(messageFor(rejectionError))
    } finally {
      setBusyId(null)
    }
  }

  async function retry(action: AssistantAction) {
    setBusyId(action.id)
    setMutationError(null)
    try {
      await retryAssistantAction(action.id, action.payloadHash)
    } catch (retryError) {
      setMutationError(messageFor(retryError))
    } finally {
      setBusyId(null)
    }
  }

  async function exportCalendar(action: AssistantAction) {
    setMutationError(null)
    try {
      await downloadCalendarAction(action, {
        organizerEmail: profile?.email || user?.email || undefined,
      })
      if (action.status === 'awaitingApproval') {
        await rejectAssistantAction(
          action.id,
          'Opened as a portable calendar event.'
        )
      }
    } catch (exportError) {
      setMutationError(messageFor(exportError))
    }
  }

  return (
    <section className="assistant-inbox intel-in" aria-label="Assistant action approvals">
      <div className="assistant-inbox__header">
        <div>
          <h2>Action approvals</h2>
          <p>Nothing is sent, scheduled, or called without your explicit approval.</p>
        </div>
        <span className="assistant-inbox__count">
          {actions.filter((action) => action.status === 'awaitingApproval').length} pending
        </span>
      </div>

      {(error || mutationError) && (
        <div className="error-banner">{mutationError || error}</div>
      )}

      {loading ? (
        <div className="assistant-inbox__empty">Loading actions…</div>
      ) : visible.length === 0 ? (
        <div className="assistant-inbox__empty">
          Ask Intelligence to draft an email or calendar event. The exact proposal will appear here.
        </div>
      ) : (
        <div className="assistant-inbox__list">
          {visible.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              now={now}
              busy={busyId === action.id}
              onApprove={() => approve(action)}
              onReject={() => reject(action)}
              onRetry={() => retry(action)}
              onExportCalendar={() => void exportCalendar(action)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ActionCard({
  action,
  now,
  busy,
  onApprove,
  onReject,
  onRetry,
  onExportCalendar,
}: {
  action: AssistantAction
  now: number
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onRetry: () => void
  onExportCalendar: () => void
}) {
  const approvalExpired =
    action.status === 'approved' &&
    action.approval?.expiresAt != null &&
    action.approval.expiresAt.getTime() <= now
  const proposalExpired =
    action.status === 'awaitingApproval' &&
    action.expiresAt != null &&
    action.expiresAt.getTime() <= now
  const displayedExpired = approvalExpired || proposalExpired
  const portableCalendar =
    action.kind === 'calendar.create' &&
    calendarProvider(action) !== 'google'
  const canApprove =
    !portableCalendar &&
    ((action.status === 'awaitingApproval' && !proposalExpired) ||
      approvalExpired)
  const canReject = action.status === 'awaitingApproval' || action.status === 'approved'
  const canRetry = action.status === 'failed' && action.execution?.retryable === true
  const canExportCalendar =
    portableCalendar &&
    action.status === 'awaitingApproval' &&
    !proposalExpired
  const needsConnection =
    action.execution?.errorCode === 'connection_required' ||
    action.execution?.errorCode === 'provider_permission_denied'

  return (
    <article className="assistant-action">
      <div className="assistant-action__topline">
        <span
          className={`assistant-action__status status-${
            displayedExpired ? 'expired' : action.status
          }`}
        >
          {approvalExpired
            ? 'Approval expired'
            : proposalExpired
            ? 'Proposal expired'
            : statusLabel(action.status)}
        </span>
        <span className="assistant-action__kind">{kindLabel(action.kind)}</span>
      </div>

      <h3>{action.summary}</h3>
      <ActionPayload action={action} />

      {action.status === 'awaitingApproval' && !proposalExpired && (
        <p className="assistant-action__notice">
          {portableCalendar
            ? 'This portable proposal cannot execute on Google. Review it, then open the exact event in your calendar app.'
            : 'Review every field. Changing any material detail requires a new approval.'}
        </p>
      )}
      {action.status === 'approved' && !approvalExpired && (
        <p className="assistant-action__notice">
          Approved for the exact payload shown. The executor must still recheck policy,
          connection scope, expiration, and idempotency.
        </p>
      )}
      {approvalExpired && (
        <p className="assistant-action__notice">
          The payload is unchanged, but the approval window ended. Approve it again
          before an executor may act.
        </p>
      )}
      {proposalExpired && (
        <p className="assistant-action__notice">
          This proposal is no longer approvable. Ask the assistant to prepare a
          current version.
        </p>
      )}
      {action.status === 'executing' && (
        <p className="assistant-action__notice">Executing the approved action…</p>
      )}
      {action.status === 'failed' && action.execution?.userMessage && (
        <p
          className={`assistant-action__notice ${
            action.execution.deliveryUncertain ? 'assistant-action__notice--warning' : ''
          }`}
        >
          {action.execution.userMessage}
        </p>
      )}
      {action.status === 'succeeded' && (
        <ProviderResult action={action} />
      )}

      {(canApprove ||
        canReject ||
        canRetry ||
        needsConnection ||
        canExportCalendar) && (
        <div className="assistant-action__buttons">
          {canExportCalendar && (
            <button
              className="btn btn-secondary"
              onClick={onExportCalendar}
              disabled={busy}
            >
              Open in any calendar (.ics)
            </button>
          )}
          {needsConnection && (
            <Link className="btn btn-secondary" to="/profile">
              Connect account
            </Link>
          )}
          {canRetry && (
            <button className="btn btn-secondary" onClick={onRetry} disabled={busy}>
              {busy ? 'Retrying…' : 'Retry safely'}
            </button>
          )}
          {canReject && (
            <button className="btn btn-secondary" onClick={onReject} disabled={busy}>
              {action.status === 'approved' && !approvalExpired
                ? 'Revoke approval'
                : 'Reject'}
            </button>
          )}
          {canApprove && (
            <button className="btn btn-intel" onClick={onApprove} disabled={busy}>
              {busy
                ? 'Saving…'
                : approvalExpired
                ? 'Approve again'
                : 'Approve exact action'}
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function ProviderResult({ action }: { action: AssistantAction }) {
  const result = action.execution?.providerResult
  const eventUrl =
    typeof result?.eventUrl === 'string' && result.eventUrl.startsWith('https://')
      ? result.eventUrl
      : null
  return (
    <p className="assistant-action__notice assistant-action__notice--success">
      {action.kind === 'calendar.create'
        ? 'Calendar event created.'
        : action.kind === 'email.send'
        ? 'Email sent.'
        : 'Action completed.'}
      {eventUrl && (
        <>
          {' '}
          <a href={eventUrl} target="_blank" rel="noopener noreferrer" className="link">
            Open event
          </a>
        </>
      )}
    </p>
  )
}

function ActionPayload({ action }: { action: AssistantAction }) {
  const payload = action.payload

  if (action.kind === 'calendar.create') {
    const allDay = payload.allDay === true
    return (
      <dl className="assistant-action__details">
        <Detail label="Title" value={text(payload.title)} />
        <Detail
          label="Starts"
          value={allDay ? calendarDay(payload.start) : dateTime(payload.start, payload.timeZone)}
        />
        <Detail
          label={allDay ? 'Ends before' : 'Ends'}
          value={allDay ? calendarDay(payload.end) : dateTime(payload.end, payload.timeZone)}
        />
        <Detail
          label="Calendar"
          value={providerLabel(payload.provider, 'calendar')}
        />
        <Detail label="Location" value={text(payload.location)} />
        <Detail label="Attendees" value={list(payload.attendees)} />
        {Array.isArray(payload.attendees) && payload.attendees.length > 0 && (
          <Detail
            label="Invitation emails"
            value={
              payload.sendInvitations === true
                ? 'Send to all attendees'
                : 'Request no notifications (Google may still notify)'
            }
          />
        )}
        <Detail label="Notes" value={text(payload.notes)} multiline />
      </dl>
    )
  }

  if (action.kind === 'email.send') {
    return (
      <dl className="assistant-action__details">
        <Detail label="From" value={text(payload.fromAccount) || providerLabel(payload.provider)} />
        <Detail label="To" value={list(payload.to)} />
        <Detail label="Cc" value={list(payload.cc)} />
        <Detail label="Bcc" value={list(payload.bcc)} />
        <Detail label="Subject" value={text(payload.subject)} />
        <Detail label="Message" value={text(payload.bodyText)} multiline />
      </dl>
    )
  }

  if (action.kind === 'phone.call') {
    return (
      <dl className="assistant-action__details">
        <Detail label="Business" value={text(payload.businessName)} />
        <Detail label="Phone" value={text(payload.toNumber)} />
        <Detail label="Purpose" value={text(payload.purpose)} multiline />
        <Detail label="Disclosure" value={text(payload.disclosureText)} multiline />
        <Detail label="Permitted facts" value={list(payload.permittedFacts)} multiline />
        <Detail label="Voicemail" value={text(payload.voicemailText)} multiline />
      </dl>
    )
  }

  return (
    <pre className="assistant-action__raw">
      {JSON.stringify(action.payload, null, 2)}
    </pre>
  )
}

function Detail({
  label,
  value,
  multiline = false,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  if (!value) return null
  return (
    <div className={multiline ? 'multiline' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function kindLabel(kind: AssistantAction['kind']): string {
  switch (kind) {
    case 'calendar.create':
      return 'Calendar'
    case 'email.send':
      return 'Email'
    case 'phone.call':
      return 'Phone'
    default:
      return 'Action'
  }
}

function statusLabel(status: AssistantAction['status']): string {
  switch (status) {
    case 'awaitingApproval':
      return 'Needs approval'
    case 'approved':
      return 'Approved'
    case 'executing':
      return 'In progress'
    case 'awaitingResponse':
      return 'Waiting for response'
    case 'succeeded':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'rejected':
      return 'Rejected'
    case 'cancelled':
      return 'Cancelled'
    case 'expired':
      return 'Expired'
    case 'proposed':
      return 'Drafting'
    default:
      return 'Unknown'
  }
}

function providerLabel(
  value: unknown,
  use: 'calendar' | 'email' = 'email'
): string {
  switch (value) {
    case 'google':
      return 'Google'
    case 'microsoft':
      return 'Microsoft'
    case 'apple':
      return 'Apple'
    default:
      return use === 'calendar'
        ? 'Any calendar through .ics'
        : 'Choose when connecting'
  }
}

function calendarProvider(action: AssistantAction): string {
  return text(action.payload.provider).trim().toLowerCase() || 'unspecified'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function list(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join(', ')
    : ''
}

function dateTime(value: unknown, timeZone: unknown): string {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(typeof timeZone === 'string' ? { timeZone } : {}),
      timeZoneName: 'short',
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

function calendarDay(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, day, 12))
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
