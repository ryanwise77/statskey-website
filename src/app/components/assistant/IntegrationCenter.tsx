import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  openStripeBillingPortal,
  startSubscriptionCheckout,
  type SubscriptionCheckoutPlan,
} from '../../lib/billing'
import {
  getDesktopBridge,
  type DesktopIntegrationConnection,
  type DesktopProviderStatus,
} from '../../lib/desktop'
import { useAuth } from '../../lib/auth'
import { useGoogleAssistantConnection } from '../../lib/assistant/connections'
import { useGitHubWorkspaceConnection } from '../../lib/githubWorkspace'
import { useSubscription } from '../../lib/data/useSubscription'
import { formatTokens, useTokenBalance } from '../../lib/data/useTokenBalance'
import {
  filterIntegrationCatalog,
  type IntegrationCatalogItem,
} from '../../lib/integrationCatalog'
import { confirmDialog } from '../../lib/ui/dialogs'
import { AssistantConnections } from './AssistantConnections'
import './IntegrationCenter.css'

type ConnectionBusy =
  | 'billing'
  | 'portal'
  | 'save-tool'
  | `test:${string}`
  | `remove:${string}`
  | null

interface RemoteConnectionDraft {
  id: string | null
  name: string
  url: string
  authType: 'none' | 'bearer' | 'oauth'
  token: string
}

const EMPTY_CONNECTION: RemoteConnectionDraft = {
  id: null,
  name: '',
  url: '',
  authType: 'oauth',
  token: '',
}

const SUBSCRIPTION_OPTIONS: readonly {
  id: SubscriptionCheckoutPlan
  name: string
  price: string
}[] = [
  { id: 'pro', name: 'Pro', price: '$4.99 / month' },
  { id: 'proPlusMonthly', name: 'Pro+', price: '$19.99 / month' },
  { id: 'proPlusAnnual', name: 'Pro+ annual', price: '$149.99 / year' },
]

export function IntegrationCenter() {
  const { user } = useAuth()
  const bridge = getDesktopBridge()
  const google = useGoogleAssistantConnection(user?.uid)
  const github = useGitHubWorkspaceConnection(user?.uid)
  const subscription = useSubscription(user?.uid)
  const credits = useTokenBalance(user?.uid)
  const [searchParams, setSearchParams] = useSearchParams()
  const [providers, setProviders] = useState<DesktopProviderStatus[]>([])
  const [connections, setConnections] = useState<
    DesktopIntegrationConnection[]
  >([])
  const [connectionDraft, setConnectionDraft] =
    useState<RemoteConnectionDraft>(EMPTY_CONNECTION)
  const [connectionFormOpen, setConnectionFormOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [busy, setBusy] = useState<ConnectionBusy>(null)
  const [notice, setNotice] = useState<{
    tone: 'success' | 'error' | 'neutral'
    text: string
  } | null>(null)

  const configuredProviders = providers.filter((provider) => provider.configured)
  const readyConnections = connections.filter(
    (connection) =>
      connection.authType !== 'oauth' || connection.credentials.oauth
  )
  const googleConnected = google.connection?.status === 'connected'
  const githubConnected = github.connection?.status === 'connected'
  const subscriptionTier = subscription.subscription?.tier || 'free'
  const readyCount =
    Number(Boolean(user)) +
    Number(googleConnected) +
    Number(githubConnected) +
    Number(configuredProviders.length > 0) +
    Number(readyConnections.length > 0)
  const catalog = useMemo(
    () => filterIntegrationCatalog(catalogQuery),
    [catalogQuery]
  )

  async function refreshDesktopConnections() {
    if (!bridge) return
    const [providerStatus, integrationStatus] = await Promise.all([
      bridge.providers.getStatus(),
      bridge.integrations?.getStatus() ?? Promise.resolve([]),
    ])
    setProviders(providerStatus)
    setConnections(integrationStatus)
  }

  useEffect(() => {
    void refreshDesktopConnections().catch((error) =>
      setNotice({ tone: 'error', text: messageFor(error) })
    )
  }, [bridge])

  useEffect(() => {
    const state = searchParams.get('billing')
    if (!state) return
    setNotice({
      tone: state === 'subscription-success' ? 'success' : 'neutral',
      text:
        state === 'subscription-success'
          ? 'Stripe checkout completed. Subscription status updates here after the verified webhook arrives.'
          : 'Stripe checkout was cancelled. No new charge was made.',
    })
    const next = new URLSearchParams(searchParams)
    next.delete('billing')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  async function beginSubscription(plan: SubscriptionCheckoutPlan) {
    setBusy('billing')
    setNotice(null)
    try {
      await startSubscriptionCheckout(plan)
      setNotice({
        tone: 'neutral',
        text: bridge
          ? 'Secure Stripe Checkout opened in your browser. StatsKey stays open and updates after payment.'
          : 'Opening secure Stripe Checkout…',
      })
    } catch (error) {
      setNotice({ tone: 'error', text: messageFor(error) })
    } finally {
      setBusy(null)
    }
  }

  async function openPortal() {
    setBusy('portal')
    setNotice(null)
    try {
      await openStripeBillingPortal()
      setNotice({
        tone: 'neutral',
        text: bridge
          ? 'The secure Stripe billing portal opened in your browser.'
          : 'Opening the secure Stripe billing portal…',
      })
    } catch (error) {
      setNotice({ tone: 'error', text: messageFor(error) })
    } finally {
      setBusy(null)
    }
  }

  function chooseCatalogItem(item: IntegrationCatalogItem) {
    setConnectionDraft({
      ...EMPTY_CONNECTION,
      name: item.name,
    })
    setConnectionFormOpen(true)
    window.setTimeout(() => {
      document
        .querySelector<HTMLInputElement>('[data-integration-endpoint]')
        ?.focus()
    })
  }

  function editConnection(connection: DesktopIntegrationConnection) {
    setConnectionDraft({
      id: connection.id,
      name: connection.name,
      url: connection.url,
      authType: connection.authType,
      token: '',
    })
    setConnectionFormOpen(true)
  }

  async function saveConnection(event: FormEvent) {
    event.preventDefault()
    if (!bridge?.integrations || busy) return
    setBusy('save-tool')
    setNotice(null)
    try {
      const saved = await bridge.integrations.save(connectionDraft.id, {
        name: connectionDraft.name,
        url: connectionDraft.url,
        authType: connectionDraft.authType,
        token: connectionDraft.token,
      })
      if (!saved.ok || !saved.connection) {
        throw new Error(saved.error || 'The connection could not be saved.')
      }
      const verified =
        saved.connection.authType === 'oauth'
          ? await bridge.integrations.authorize(saved.connection.id)
          : await bridge.integrations.test(saved.connection.id)
      if (!verified.ok) {
        throw new Error(
          `${saved.connection.name} was saved securely, but ${
            saved.connection.authType === 'oauth'
              ? 'browser authorization'
              : 'verification'
          } failed: ${
            verified.error || 'the service did not respond'
          }`
        )
      }
      await refreshDesktopConnections()
      setConnectionDraft(EMPTY_CONNECTION)
      setConnectionFormOpen(false)
      setNotice({
        tone: 'success',
        text: `${saved.connection.name} is connected${
          typeof verified.toolCount === 'number'
            ? ` with ${verified.toolCount} available tool${
                verified.toolCount === 1 ? '' : 's'
              }`
            : ''
        }.`,
      })
    } catch (error) {
      await refreshDesktopConnections().catch(() => {})
      setNotice({ tone: 'error', text: messageFor(error) })
    } finally {
      setBusy(null)
    }
  }

  async function testConnection(connection: DesktopIntegrationConnection) {
    if (!bridge?.integrations || busy) return
    setBusy(`test:${connection.id}`)
    setNotice(null)
    try {
      const result =
        connection.authType === 'oauth'
          ? await bridge.integrations.authorize(connection.id)
          : await bridge.integrations.test(connection.id)
      if (!result.ok) throw new Error(result.error || 'Connection failed.')
      setNotice({
        tone: 'success',
        text: `${connection.name} responded with ${result.toolCount ?? 0} tool${
          result.toolCount === 1 ? '' : 's'
        }.`,
      })
    } catch (error) {
      setNotice({ tone: 'error', text: messageFor(error) })
    } finally {
      setBusy(null)
    }
  }

  async function removeConnection(connection: DesktopIntegrationConnection) {
    if (!bridge?.integrations || busy) return
    const confirmed = await confirmDialog({
      title: `Disconnect ${connection.name}?`,
      body: 'Its locally encrypted endpoint and access token will be deleted from this computer.',
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(`remove:${connection.id}`)
    try {
      await bridge.integrations.remove(connection.id)
      await refreshDesktopConnections()
      if (connectionDraft.id === connection.id) {
        setConnectionDraft(EMPTY_CONNECTION)
        setConnectionFormOpen(false)
      }
      setNotice({
        tone: 'neutral',
        text: `${connection.name} was disconnected.`,
      })
    } catch (error) {
      setNotice({ tone: 'error', text: messageFor(error) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="integration-center">
      <section className="integration-center__hero">
        <div>
          <span>One-time setup</span>
          <h3>Connect accounts once. Keep control of every action.</h3>
          <p>
            Direct account connections, local provider keys, and universal MCP
            services stay authorized until you revoke them. Execute permissions
            still determine whether an external action runs automatically or
            waits for review.
          </p>
        </div>
        <div className="integration-center__score" aria-label={`${readyCount} connection areas ready`}>
          <b>{readyCount}</b>
          <span>areas ready</span>
          <small>Optional connections never block the app.</small>
        </div>
      </section>

      {notice && (
        <div
          className="integration-center__notice"
          data-tone={notice.tone}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </div>
      )}

      <section className="integration-billing">
        <header>
          <div>
            <span className="integration-mark integration-mark--stripe">S</span>
            <div>
              <b>Stripe billing</b>
              <p>
                Hosted Checkout, verified webhook fulfillment, subscriptions,
                invoices, payment methods, and self-service cancellation.
              </p>
            </div>
          </div>
          <ConnectionState
            connected={Boolean(user)}
            connectedLabel="Ready"
            disconnectedLabel="Sign in required"
          />
        </header>
        <div className="integration-billing__facts">
          <div>
            <span>Plan</span>
            <b>{subscription.loading ? 'Checking…' : planLabel(subscriptionTier)}</b>
          </div>
          <div>
            <span>Intelligence credits</span>
            <b>
              {credits.loading
                ? 'Checking…'
                : formatTokens(credits.tokens?.balance ?? 0)}
            </b>
          </div>
          <div>
            <span>Managed model pricing</span>
            <b>Cost-weighted</b>
          </div>
        </div>
        <div className="integration-billing__plans">
          {SUBSCRIPTION_OPTIONS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              disabled={!user || busy != null}
              onClick={() => void beginSubscription(plan.id)}
            >
              <b>{plan.name}</b>
              <span>{plan.price}</span>
            </button>
          ))}
        </div>
        <footer>
          <Link className="settings-card__button settings-card__button--primary" to="/tokens">
            Buy credits with Stripe
          </Link>
          <button
            className="settings-card__button"
            type="button"
            disabled={!user || busy != null}
            onClick={() => void openPortal()}
          >
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
          <small>
            1M $12.99 · 5M $59.99 · 25M $299.99 · 100M $1,199.99
          </small>
        </footer>
      </section>

      <section className="integration-overview" aria-label="Connection overview">
        <ConnectionOverviewCard
          mark="G"
          title="Google Workspace"
          detail={
            googleConnected
              ? google.connection?.accountEmail || 'Calendar and Gmail connected'
              : 'Calendar and Gmail permissions'
          }
          connected={googleConnected}
          action="#google-connection"
          actionLabel={googleConnected ? 'Review access' : 'Connect'}
        />
        <ConnectionOverviewCard
          mark="GH"
          title="GitHub"
          detail={
            githubConnected
              ? `@${github.connection?.login || 'connected'}`
              : 'One-time browser authorization'
          }
          connected={githubConnected}
          action="/github"
          actionLabel={githubConnected ? 'Open workspace' : 'Connect'}
        />
        <ConnectionOverviewCard
          mark="M"
          title="Model accounts"
          detail={
            configuredProviders.length > 0
              ? `${configuredProviders.length} provider${
                  configuredProviders.length === 1 ? '' : 's'
                } connected locally`
              : 'Anthropic, ChatGPT, Gemini, Grok, Kimi, Azure, Bedrock, or compatible'
          }
          connected={configuredProviders.length > 0}
          action="/settings/models"
          actionLabel="Manage keys"
        />
        <ConnectionOverviewCard
          mark="∞"
          title="Universal tools"
          detail={
            readyConnections.length > 0
              ? `${readyConnections.length} account-level MCP connection${
                  readyConnections.length === 1 ? '' : 's'
                }`
              : 'Any secure remote MCP service'
          }
          connected={readyConnections.length > 0}
          action="#universal-connections"
          actionLabel={
            readyConnections.length > 0 ? 'Manage tools' : 'Add service'
          }
        />
      </section>

      <section id="google-connection" className="integration-center__section">
        <header>
          <span>Built in</span>
          <h3>Google and calendar access</h3>
          <p>
            Choose the exact read, create, and send capabilities once. You can
            change or revoke them at any time.
          </p>
        </header>
        <AssistantConnections embedded />
      </section>

      <section
        id="universal-connections"
        className="integration-center__section integration-universal"
      >
        <header>
          <span>Universal connection layer</span>
          <h3>Connect almost any third-party service through MCP.</h3>
          <p>
            Add one HTTPS MCP endpoint and its access token. StatsKey encrypts
            the credential with this computer&apos;s operating system, discovers
            the service&apos;s tools, and makes them available across workspaces.
            Services without remote MCP support can still run through a project
            <code>.cursor/mcp.json</code> connector.
          </p>
        </header>

        {!bridge?.integrations ? (
          <div className="integration-universal__unavailable">
            Universal account connections require the latest StatsKey Desktop
            build. Project MCP tools remain available in{' '}
            <Link to="/settings/general">General → Connected tools</Link>.
          </div>
        ) : (
          <>
            {connections.length > 0 && (
              <div className="integration-universal__saved">
                {connections.map((connection) => (
                  <article key={connection.id}>
                    <div>
                      <ConnectionState
                        connected={
                          connection.authType !== 'oauth' ||
                          connection.credentials.oauth
                        }
                        connectedLabel="Connected"
                        disconnectedLabel="Finish sign-in"
                      />
                      <b>{connection.name}</b>
                      <span>{endpointHost(connection.url)}</span>
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => editConnection(connection)}
                      >
                        Manage
                      </button>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void testConnection(connection)}
                      >
                        {busy === `test:${connection.id}`
                          ? connection.authType === 'oauth'
                            ? 'Authorizing…'
                            : 'Testing…'
                          : connection.authType === 'oauth'
                            ? connection.credentials.oauth
                              ? 'Reconnect'
                              : 'Authorize'
                            : 'Test'}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy != null}
                        onClick={() => void removeConnection(connection)}
                      >
                        {busy === `remove:${connection.id}`
                          ? 'Removing…'
                          : 'Disconnect'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="integration-catalog">
              <div className="integration-catalog__head">
                <div>
                  <b>Choose a service or enter any MCP provider</b>
                  <span>
                    These are examples, not a closed list. The same connection
                    contract works for newer providers without an app update.
                  </span>
                </div>
                <input
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Search Slack, databases, CRM…"
                  aria-label="Search third-party integrations"
                />
              </div>
              <div className="integration-catalog__items">
                {catalog.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => chooseCatalogItem(item)}
                  >
                    <b>{item.name}</b>
                    <span>{item.group}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="integration-universal__add"
              onClick={() => {
                setConnectionDraft(EMPTY_CONNECTION)
                setConnectionFormOpen((open) => !open)
              }}
            >
              {connectionFormOpen ? 'Close connection form' : 'Add any remote MCP service'}
            </button>

            {connectionFormOpen && (
              <form
                className="integration-connection-form"
                onSubmit={saveConnection}
              >
                <div>
                  <label>
                    <span>Connection name</span>
                    <input
                      value={connectionDraft.name}
                      onChange={(event) =>
                        setConnectionDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Linear, Notion, internal tools…"
                      required
                    />
                  </label>
                  <label>
                    <span>Remote MCP endpoint</span>
                    <input
                      data-integration-endpoint
                      value={connectionDraft.url}
                      onChange={(event) =>
                        setConnectionDraft((current) => ({
                          ...current,
                          url: event.target.value,
                        }))
                      }
                      placeholder="https://service.example.com/mcp"
                      inputMode="url"
                      required
                    />
                  </label>
                </div>
                <div>
                  <label>
                    <span>Authorization</span>
                    <select
                      value={connectionDraft.authType}
                      onChange={(event) =>
                        setConnectionDraft((current) => ({
                          ...current,
                          authType:
                            event.target.value === 'none'
                              ? 'none'
                              : event.target.value === 'bearer'
                                ? 'bearer'
                                : 'oauth',
                        }))
                      }
                    >
                      <option value="oauth">Browser sign-in (OAuth)</option>
                      <option value="bearer">Bearer or access token</option>
                      <option value="none">No authorization</option>
                    </select>
                  </label>
                  {connectionDraft.authType === 'bearer' && (
                    <label>
                      <span>Access token</span>
                      <input
                        type="password"
                        value={connectionDraft.token}
                        onChange={(event) =>
                          setConnectionDraft((current) => ({
                            ...current,
                            token: event.target.value,
                          }))
                        }
                        placeholder={
                          connectionDraft.id
                            ? 'Stored securely · enter only to replace'
                            : 'Paste once'
                        }
                        autoComplete="off"
                        required={!connectionDraft.id}
                      />
                    </label>
                  )}
                </div>
                <footer>
                  <button
                    className="settings-card__button settings-card__button--primary"
                    disabled={busy != null}
                  >
                    {busy === 'save-tool'
                      ? 'Saving and verifying…'
                      : 'Connect and verify'}
                  </button>
                  <small>
                    HTTPS is required except for localhost. Browser sign-in uses
                    OAuth with PKCE; credentials are never returned to the
                    interface after saving.
                  </small>
                </footer>
              </form>
            )}

            <p className="integration-universal__footnote">
              Need a local command-based connector? Add it once per project in{' '}
              <Link to="/settings/general">General → Connected tools</Link>.
              StatsKey reviews server startup and every external tool action
              under your saved Execute permission.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

function ConnectionOverviewCard({
  mark,
  title,
  detail,
  connected,
  action,
  actionLabel,
}: {
  mark: string
  title: string
  detail: string
  connected: boolean
  action: string
  actionLabel: string
}) {
  const content = (
    <>
      <span className="integration-mark">{mark}</span>
      <div>
        <b>{title}</b>
        <p>{detail}</p>
      </div>
      <ConnectionState connected={connected} />
      <span className="integration-overview__action">{actionLabel}</span>
    </>
  )
  return action.startsWith('#') ? (
    <a href={action}>{content}</a>
  ) : (
    <Link to={action}>{content}</Link>
  )
}

function ConnectionState({
  connected,
  connectedLabel = 'Connected',
  disconnectedLabel = 'Available',
}: {
  connected: boolean
  connectedLabel?: string
  disconnectedLabel?: string
}) {
  return (
    <span className="integration-state" data-connected={connected}>
      <i aria-hidden="true" />
      {connected ? connectedLabel : disconnectedLabel}
    </span>
  )
}

function planLabel(tier: string): string {
  if (/pro.?plus/i.test(tier)) return 'Pro+'
  if (/pro/i.test(tier)) return 'Pro'
  return 'Free'
}

function endpointHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
