import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useIntelligenceConsent } from '../../lib/intelligenceConsent'
import {
  beginGoogleAssistantConnection,
  disconnectGoogleAssistantConnection,
  useGoogleAssistantConnection,
  type GoogleAssistantCapability,
} from '../../lib/assistant/connections'
import {
  getDesktopBridge,
  GOOGLE_CONNECTION_EVENT,
  type DesktopCalendarFeed,
} from '../../lib/desktop'
import {
  getAssistantContextPreferences,
  saveAssistantContextPreferences,
} from '../../lib/assistant/contextPreferences'
import { confirmDialog } from '../../lib/ui/dialogs'

export function AssistantConnections({
  embedded = false,
}: {
  embedded?: boolean
} = {}) {
  const { user } = useAuth()
  const desktopBridge = getDesktopBridge()
  const consent = useIntelligenceConsent(user?.uid)
  const state = useGoogleAssistantConnection(user?.uid)
  const [capabilities, setCapabilities] =
    useState<GoogleAssistantCapability[]>(['calendar'])
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [awaitingBrowser, setAwaitingBrowser] = useState(false)
  const [contextPreferences, setContextPreferences] = useState(
    getAssistantContextPreferences
  )
  const [calendarFeeds, setCalendarFeeds] = useState<DesktopCalendarFeed[]>([])
  const [calendarFeedName, setCalendarFeedName] = useState('')
  const [calendarFeedUrl, setCalendarFeedUrl] = useState('')
  const [calendarFeedBusy, setCalendarFeedBusy] = useState(false)

  function updateContextPreferences(
    next: Partial<typeof contextPreferences>
  ) {
    const value = { ...contextPreferences, ...next }
    setContextPreferences(value)
    saveAssistantContextPreferences(value)
  }

  useEffect(() => {
    if (!desktopBridge?.calendarFeeds) return
    void desktopBridge.calendarFeeds
      .list()
      .then(setCalendarFeeds)
      .catch(() => setCalendarFeeds([]))
  }, [desktopBridge])

  async function addCalendarFeed(event: FormEvent) {
    event.preventDefault()
    if (
      !desktopBridge?.calendarFeeds ||
      calendarFeedBusy ||
      !calendarFeedName.trim() ||
      !calendarFeedUrl.trim()
    ) {
      return
    }
    setCalendarFeedBusy(true)
    setError(null)
    try {
      const result = await desktopBridge.calendarFeeds.add(
        calendarFeedName.trim(),
        calendarFeedUrl.trim()
      )
      if (!result.ok) throw new Error(result.error || 'Calendar could not be connected.')
      setCalendarFeeds(await desktopBridge.calendarFeeds.list())
      setCalendarFeedName('')
      setCalendarFeedUrl('')
    } catch (feedError) {
      setError(messageFor(feedError))
    } finally {
      setCalendarFeedBusy(false)
    }
  }

  async function removeCalendarFeed(feed: DesktopCalendarFeed) {
    if (!desktopBridge?.calendarFeeds) return
    const confirmed = await confirmDialog({
      title: `Disconnect “${feed.name}”?`,
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (!confirmed) return
    await desktopBridge.calendarFeeds.remove(feed.id)
    setCalendarFeeds(await desktopBridge.calendarFeeds.list())
  }

  useEffect(() => {
    if (state.connection?.capabilities.length) {
      setCapabilities(state.connection.capabilities)
    }
    if (state.connection?.status === 'connected') setAwaitingBrowser(false)
  }, [
    state.connection?.capabilities.join('|'),
    state.connection?.status,
  ])

  useEffect(() => {
    const onConnectionResult = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status
      setAwaitingBrowser(false)
      if (status === 'failed') {
        setError('Google did not complete the connection. Try again or review the selected access.')
      }
    }
    window.addEventListener(GOOGLE_CONNECTION_EVENT, onConnectionResult)
    return () => window.removeEventListener(GOOGLE_CONNECTION_EVENT, onConnectionResult)
  }, [])

  function toggle(capability: GoogleAssistantCapability) {
    if (
      state.connection?.status === 'connected' &&
      state.connection.capabilities.includes(capability) &&
      capabilities.includes(capability)
    ) {
      setError('Disconnect Google first to remove previously granted access.')
      return
    }
    setError(null)
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability].sort()
    )
  }

  async function connect() {
    if (busy || capabilities.length === 0) return
    const popup = desktopBridge
      ? null
      : window.open('', 'statskey-google-connection', 'popup,width=560,height=760')
    if (popup) {
      popup.document.title = 'Connecting Google · StatsKey'
      popup.document.body.textContent = 'Preparing secure Google authorization…'
    }

    setBusy('connect')
    setError(null)
    try {
      const authorizationUrl = await beginGoogleAssistantConnection(capabilities)
      if (desktopBridge) {
        const opened = await desktopBridge.openExternal(authorizationUrl)
        if (!opened) throw new Error('StatsKey could not open Google securely.')
        setAwaitingBrowser(true)
      } else if (popup && !popup.closed) {
        popup.opener = null
        popup.location.replace(authorizationUrl)
      } else {
        window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (connectError) {
      popup?.close()
      setError(messageFor(connectError))
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (busy) return
    const confirmed = await confirmDialog({
      title: 'Disconnect Google from StatsKey Intelligence?',
      body: 'Pending actions will not execute until an account is reconnected.',
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (!confirmed) return
    setBusy('disconnect')
    setError(null)
    try {
      await disconnectGoogleAssistantConnection()
    } catch (disconnectError) {
      setError(messageFor(disconnectError))
    } finally {
      setBusy(null)
    }
  }

  const connected = state.connection?.status === 'connected'

  return (
    <div
      className={
        embedded
          ? 'assistant-connections assistant-connections--embedded'
          : 'assistant-connections panel space-y-4'
      }
    >
      {!embedded && <div>
        <span className="card-title">Intelligence connections</span>
        <p className="text-text-muted text-[12px] mt-1">
          Connect only the capabilities you want. StatsKey stores encrypted
          server credentials and uses them only for tasks you request. Reading
          is request-bound; creating or sending requires exact approval.
        </p>
      </div>}

      <section className="assistant-calendar-coverage" aria-label="Calendar integrations">
        <header>
          <div>
            <b>Calendars</b>
            <span>
              Direct Google scheduling plus a standard .ics route for every
              calendar app. Microsoft, Apple, and CalDAV events can be opened
              from each reviewed proposal without sharing another password.
            </span>
          </div>
          <small>Explicit approval remains required</small>
        </header>
        <div>
          <article>
            <strong>Google Calendar</strong>
            <span>{connected ? 'Direct sync connected' : 'Direct sync available'}</span>
          </article>
          <article>
            <strong>Microsoft 365 / Outlook</strong>
            <span>Universal .ics ready</span>
          </article>
          <article>
            <strong>Apple Calendar</strong>
            <span>Universal .ics ready</span>
          </article>
          <article>
            <strong>CalDAV and other apps</strong>
            <span>Universal .ics ready</span>
          </article>
        </div>
      </section>

      {desktopBridge?.calendarFeeds && (
        <section className="assistant-calendar-feeds">
          <div>
            <b>Connect any calendar feed</b>
            <span>
              Add a private read-only ICS subscription URL from Microsoft 365,
              Outlook, Apple Calendar, Fastmail, Nextcloud, Google, or another
              cloud calendar. The URL is encrypted on this computer and is
              never sent to the Intelligence provider.
            </span>
          </div>
          {calendarFeeds.length > 0 && (
            <ul>
              {calendarFeeds.map((feed) => (
                <li key={feed.id}>
                  <span>
                    <b>{feed.name}</b>
                    <small>Read-only subscription</small>
                  </span>
                  <button onClick={() => void removeCalendarFeed(feed)}>
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addCalendarFeed}>
            <input
              value={calendarFeedName}
              onChange={(event) => setCalendarFeedName(event.target.value)}
              placeholder="Calendar name"
              aria-label="Calendar name"
            />
            <input
              value={calendarFeedUrl}
              onChange={(event) => setCalendarFeedUrl(event.target.value)}
              placeholder="Private webcal:// or https:// ICS URL"
              aria-label="Private calendar subscription URL"
              inputMode="url"
            />
            <button
              className="btn btn-secondary"
              disabled={
                calendarFeedBusy ||
                !calendarFeedName.trim() ||
                !calendarFeedUrl.trim()
              }
            >
              {calendarFeedBusy ? 'Connecting…' : 'Connect feed'}
            </button>
          </form>
          <small>
            Subscription feeds are read-only. Creating events still uses a
            reviewed Google action or the portable “Open in any calendar” flow.
          </small>
        </section>
      )}

      {state.loading ? (
        <p className="text-text-secondary text-sm">Checking connections…</p>
      ) : (
        <>
          <div className="assistant-connection__identity">
            <div>
              <strong>Google</strong>
              <span>
                {connected
                  ? state.connection?.accountEmail
                  : state.connection?.status === 'reconnectRequired'
                  ? 'Reconnect required'
                  : 'Not connected'}
              </span>
            </div>
            <span className={`assistant-connection__state ${connected ? 'connected' : ''}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <fieldset className="assistant-connection__capabilities" disabled={busy != null}>
            <legend>Allow approved actions to use</legend>
            <label>
              <input
                type="checkbox"
                checked={capabilities.includes('calendar')}
                onChange={() => toggle('calendar')}
              />
              <span>
                <b>Google Calendar create</b>
                <small>Create reviewed events you own and optionally send approved invitations.</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={capabilities.includes('calendarRead')}
                onChange={() => toggle('calendarRead')}
              />
              <span>
                <b>Google Calendar availability</b>
                <small>
                  Read event titles, times, locations, organizers, and attendee
                  responses only when you ask about your schedule. Calendar
                  content needed for the task may be processed by your selected
                  Intelligence provider; raw results are not saved in chat history.
                </small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={capabilities.includes('email')}
                onChange={() => toggle('email')}
              />
              <span>
                <b>Gmail send-only</b>
                <small>Send the exact recipients, subject, and message you approved. No inbox access.</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={capabilities.includes('emailRead')}
                onChange={() => toggle('emailRead')}
              />
              <span>
                <b>Gmail inbox read</b>
                <small>Read unread subjects, senders, snippets, and threads you request so Intelligence can triage and draft replies. The requested content may be processed by your selected provider; raw results are not saved in chat history. Sending still requires separate approval.</small>
              </span>
            </label>
          </fieldset>

          <section className="assistant-email-context">
            <div>
              <b>Compact recent-email context</b>
              <span>
                Let Intelligence see a cached list of unread senders, subjects,
                dates, and short snippets automatically. Message bodies are not
                included unless it deliberately opens a relevant thread.
              </span>
            </div>
            <label>
              <input
                type="checkbox"
                checked={
                  contextPreferences.automaticEmailContext === 'automatic'
                }
                disabled={!capabilities.includes('emailRead')}
                onChange={(event) =>
                  updateContextPreferences({
                    automaticEmailContext: event.target.checked
                      ? 'automatic'
                      : 'off',
                  })
                }
              />
              <span>Include automatically</span>
            </label>
            <label>
              <span>Maximum messages</span>
              <select
                value={contextPreferences.emailDigestMessages}
                disabled={
                  contextPreferences.automaticEmailContext !== 'automatic'
                }
                onChange={(event) =>
                  updateContextPreferences({
                    emailDigestMessages: Number(event.target.value) as 3 | 5 | 10,
                  })
                }
              >
                <option value={3}>3 · smallest</option>
                <option value={5}>5 · balanced</option>
                <option value={10}>10 · broader</option>
              </select>
            </label>
            <small>
              Refreshes at most once every five minutes and remains off by
              default. Automatic inbox context is never added to project
              workspaces.
            </small>
          </section>

          {!consent.granted ? (
            <div className="assistant-connection__notice">
              Review and enable Intelligence data sharing before connecting an account.
              <Link className="link" to="/flow"> Review disclosure</Link>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary"
                  onClick={connect}
                  disabled={busy != null || capabilities.length === 0}
                >
                  {busy === 'connect'
                    ? 'Opening Google…'
                    : connected
                    ? 'Update Google access'
                    : awaitingBrowser
                    ? 'Open Google again'
                    : 'Connect Google'}
                </button>
                {connected && (
                  <button
                    className="btn btn-secondary"
                    onClick={disconnect}
                    disabled={busy != null}
                  >
                    {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                )}
              </div>
              {awaitingBrowser && !connected && (
                <div className="assistant-connection__notice">
                  Finish the connection in your browser. StatsKey will update here automatically.
                </div>
              )}
            </>
          )}
          {state.connection?.status === 'disconnected' &&
            state.connection.revocationConfirmed === false && (
              <div className="assistant-connection__notice">
                StatsKey removed its local credential, but Google did not confirm
                remote revocation. Revoke StatsKey from your Google Account
                {' '}
                <a
                  className="link"
                  href="https://myaccount.google.com/connections"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  connections page
                </a>
                {' '}to finish.
              </div>
            )}
        </>
      )}

      {(error || state.error) && (
        <div className="error-banner">{error || state.error}</div>
      )}

      <p className="text-text-muted text-[11px]">
        Calendar and inbox reads are optional and separate from create/send
        access. You can disconnect here or revoke StatsKey from your Google
        Account connections page.
      </p>
    </div>
  )
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
