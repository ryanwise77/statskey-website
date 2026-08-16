import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getDesktopBridge,
  type DesktopFounderAction,
  type DesktopFounderCheck,
  type DesktopFounderResult,
  type DesktopFounderState,
} from '../lib/desktop'
import { requestWorkspaceQuickTool } from '../lib/workspaceContext'
import './FounderConsole.css'

type Operation =
  | DesktopFounderAction
  | DesktopFounderCheck
  | 'refresh'

export function FounderConsole() {
  const bridge = getDesktopBridge()
  const navigate = useNavigate()
  const [state, setState] = useState<DesktopFounderState | null>(null)
  const [busy, setBusy] = useState<Operation | null>('refresh')
  const [notice, setNotice] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState<{
    title: string
    result: DesktopFounderResult
  } | null>(null)

  const refresh = useCallback(async () => {
    if (!bridge?.founder) return
    setBusy('refresh')
    try {
      const next = await bridge.founder.state()
      setState(next)
      if (next.configurationError) setNotice(next.configurationError)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy((current) => (current === 'refresh' ? null : current))
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge?.founderMode || !bridge.founder) {
      navigate('/workspace', { replace: true })
      return
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(interval)
  }, [bridge, navigate, refresh])

  const readiness = state?.readiness
  const services = state?.services
  const storage = state?.storage
  const oilReady =
    readiness?.oilProject?.available === true &&
    readiness?.oilPython?.available === true
  const macRemoteReady =
    readiness?.macRemoteExecutable?.available === true &&
    readiness?.macRemoteConfig?.available === true
  const dataCenterSummary = useMemo(() => {
    if (!state) return 'Checking the private network…'
    if (state.configurationError) return 'Founder configuration needs attention.'
    if (services?.trueNas?.online && storage?.mounted) {
      return 'Storage and management are online.'
    }
    if (services?.trueNas?.online) {
      return 'TrueNAS is online; mount the Oil Data share on this Mac.'
    }
    return 'The data center is not reachable from this network.'
  }, [services?.trueNas?.online, state, storage?.mounted])

  async function perform(action: DesktopFounderAction) {
    if (!bridge?.founder || busy) return
    setBusy(action)
    setNotice(null)
    try {
      const result = await bridge.founder.perform(action)
      if (!result.ok) {
        setNotice(result.error || 'The Founder action did not complete.')
        return
      }
      if (action === 'open-oil-workspace') {
        navigate('/workspace')
        return
      }
      if (action === 'start-mac-ssh') {
        requestWorkspaceQuickTool('terminal')
        navigate('/workspace')
        return
      }
      if (action === 'mount-oil-share') {
        setNotice('Finder is opening the private SMB share.')
      } else if (action === 'open-mac-screen') {
        setNotice(
          result.changed === false
            ? 'The Mac mini Screen Sharing tunnel is already running.'
            : 'Opening Screen Sharing through pinned, key-only SSH.'
        )
      } else if (action === 'stop-mac-screen') {
        setNotice('Mac mini Screen Sharing tunnel stopped.')
      }
      await refresh()
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy((current) => (current === action ? null : current))
    }
  }

  async function runCheck(check: DesktopFounderCheck, title: string) {
    if (!bridge?.founder || busy) return
    setBusy(check)
    setNotice(null)
    try {
      const result = await bridge.founder.runCheck(check)
      setDiagnostic({ title, result })
      if (!result.ok) {
        setNotice(result.error || `${title} did not pass.`)
      }
      await refresh()
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy((current) => (current === check ? null : current))
    }
  }

  if (!bridge?.founderMode || !bridge.founder) return null

  return (
    <div className="founder-console">
      <header className="founder-console__hero">
        <div>
          <span className="founder-console__eyebrow">
            Private build · local controls
          </span>
          <h1>Founder Console</h1>
          <p>{dataCenterSummary}</p>
        </div>
        <button
          className="founder-button founder-button--quiet"
          onClick={() => void refresh()}
          disabled={busy != null}
        >
          {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
        </button>
      </header>

      {notice && (
        <div className="founder-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}

      <section className="founder-overview" aria-label="Founder quick status">
        <StatusMetric
          label="TrueNAS"
          value={services?.trueNas?.online ? 'Online' : 'Offline'}
          tone={services?.trueNas?.online ? 'good' : 'bad'}
          detail={services?.trueNas?.host ?? '192.168.3.55'}
        />
        <StatusMetric
          label="Oil Data"
          value={storage?.mounted ? 'Mounted' : 'Not mounted'}
          tone={storage?.mounted ? 'good' : 'warn'}
          detail={
            storage?.mounted
              ? `${formatBytes(storage.freeBytes)} free`
              : storage?.path ?? '/Volumes/StatsKey-Oil'
          }
        />
        <StatusMetric
          label="Mac mini"
          value={
            services?.macMini?.sshOnline
              ? 'Local online'
              : macRemoteReady
                ? 'MacRemote configured'
                : 'MacRemote pending'
          }
          tone={
            services?.macMini?.sshOnline || macRemoteReady ? 'good' : 'warn'
          }
          detail={services?.macMini?.host ?? 'ryans-mac-mini.local'}
        />
        <StatusMetric
          label="RTX workstation"
          value={
            services?.gpu?.configured
              ? services.gpu.online
                ? 'Online'
                : 'Offline'
              : 'Needs OS address'
          }
          tone={services?.gpu?.online ? 'good' : 'warn'}
          detail={services?.gpu?.host ?? 'SSH target not configured'}
        />
      </section>

      <section className="founder-grid">
        <FounderCard
          title="Oil Data lake"
          kicker="134.35 TiB RAIDZ2 pool"
          status={
            storage?.mounted
              ? storage.reserveHealthy
                ? 'Ready'
                : 'Reserve low'
              : services?.trueNas?.online
                ? 'Mount required'
                : 'Offline'
          }
          tone={
            storage?.mounted && storage.reserveHealthy
              ? 'good'
              : services?.trueNas?.online
                ? 'warn'
                : 'bad'
          }
        >
          <DefinitionList
            rows={[
              ['TrueNAS', endpointLabel(services?.trueNas)],
              ['SMB', services?.smb?.online ? 'Listening' : 'Not listening'],
              ['Mount', storage?.mounted ? storage.path : 'Not mounted'],
              [
                'Capacity',
                storage?.mounted
                  ? `${formatBytes(storage.freeBytes)} free of ${formatBytes(
                      storage.totalBytes
                    )}`
                  : 'Available after SMB setup',
              ],
              [
                '20% reserve',
                storage?.mounted
                  ? storage.reserveHealthy
                    ? 'Protected'
                    : 'Below guardrail'
                  : 'Pending',
              ],
            ]}
          />
          <div className="founder-actions">
            <ActionButton
              onClick={() => void perform('open-truenas')}
              busy={busy === 'open-truenas'}
            >
              Open TrueNAS
            </ActionButton>
            <ActionButton
              onClick={() => void perform('mount-oil-share')}
              busy={busy === 'mount-oil-share'}
            >
              Mount share
            </ActionButton>
            <ActionButton
              onClick={() => void perform('open-oil-workspace')}
              busy={busy === 'open-oil-workspace'}
              disabled={!oilReady}
            >
              Open Oil project
            </ActionButton>
            <ActionButton
              onClick={() =>
                void runCheck('oil-storage', 'Oil Data storage check')
              }
              busy={busy === 'oil-storage'}
              disabled={!oilReady}
            >
              Verify storage
            </ActionButton>
          </div>
        </FounderCard>

        <FounderCard
          title="Mac mini"
          kicker="MacRemote · zero-cost direct SSH"
          status={
            macRemoteReady
              ? readiness?.macScreenRunning
                ? 'Screen active'
                : 'Configured'
              : 'Setup pending'
          }
          tone={macRemoteReady ? 'good' : 'warn'}
        >
          <DefinitionList
            rows={[
              [
                'Local SSH',
                services?.macMini?.sshOnline ? 'Online · port 22' : 'Not local',
              ],
              [
                'Local Screen',
                services?.macMini?.screenOnline
                  ? 'Online · port 5900'
                  : 'Not local',
              ],
              [
                'MacRemote',
                readiness?.macRemoteExecutable?.available
                  ? 'Built'
                  : 'Build required',
              ],
              [
                'Transport config',
                readiness?.macRemoteConfig?.available
                  ? 'Installed'
                  : 'Not installed',
              ],
            ]}
          />
          <div className="founder-actions">
            <ActionButton
              onClick={() => void perform('start-mac-ssh')}
              busy={busy === 'start-mac-ssh'}
              disabled={!macRemoteReady}
            >
              SSH terminal
            </ActionButton>
            <ActionButton
              onClick={() => void perform('open-mac-screen')}
              busy={busy === 'open-mac-screen'}
              disabled={!macRemoteReady}
            >
              Screen Sharing
            </ActionButton>
            {readiness?.macScreenRunning && (
              <ActionButton
                onClick={() => void perform('stop-mac-screen')}
                busy={busy === 'stop-mac-screen'}
              >
                Stop tunnel
              </ActionButton>
            )}
            <ActionButton
              onClick={() =>
                void runCheck('macremote-doctor', 'MacRemote doctor')
              }
              busy={busy === 'macremote-doctor'}
              disabled={!macRemoteReady}
            >
              Run doctor
            </ActionButton>
          </div>
          {!macRemoteReady && (
            <p className="founder-card__note">
              Install the dedicated direct-access key and pinned transport
              configuration before using MacRemote.
            </p>
          )}
        </FounderCard>

        <FounderCard
          title="RTX workstation"
          kicker="5090 compute node"
          status={
            services?.gpu?.configured
              ? services.gpu.online
                ? 'Ready'
                : 'Offline'
              : 'Discovery pending'
          }
          tone={services?.gpu?.online ? 'good' : 'warn'}
        >
          <DefinitionList
            rows={[
              ['GPU', 'NVIDIA RTX 5090 · 32 GB'],
              ['Compute role', 'Seismic extraction and model execution'],
              [
                'SSH',
                services?.gpu?.configured
                  ? endpointLabel(services.gpu)
                  : 'Linux address not configured',
              ],
              ['Data path', state?.paths?.oilData ?? '/Volumes/StatsKey-Oil'],
            ]}
          />
          <p className="founder-card__note">
            This control becomes active after the workstation has Linux, an SSH
            host key, and the NAS mount. Jobs will run through named,
            reviewable pipeline commands rather than an unrestricted web shell.
          </p>
        </FounderCard>

        <FounderCard
          title="Hardware management"
          kicker="Out-of-band recovery"
          status={services?.idrac?.online ? 'Online' : 'Offline'}
          tone={services?.idrac?.online ? 'good' : 'bad'}
        >
          <DefinitionList
            rows={[
              ['Controller', 'Dell iDRAC'],
              ['Endpoint', endpointLabel(services?.idrac)],
              ['Use', 'Power, console, sensors, and recovery'],
              [
                'Access',
                services?.idrac?.online
                  ? 'Reachable on the management network'
                  : 'Not reachable from this Mac',
              ],
            ]}
          />
          <div className="founder-actions">
            <ActionButton
              onClick={() => void perform('open-idrac')}
              busy={busy === 'open-idrac'}
            >
              Open iDRAC
            </ActionButton>
          </div>
        </FounderCard>
      </section>

      <section className="founder-security">
        <div>
          <span className="founder-console__eyebrow">Security boundary</span>
          <h2>Founder controls stay local</h2>
        </div>
        <p>
          This build exposes only fixed, named infrastructure actions. It does
          not put NAS credentials in the renderer, open public management ports,
          or add an arbitrary remote-command API. The published StatsKey build
          does not load this bridge.
        </p>
      </section>

      {diagnostic && (
        <section className="founder-diagnostic" aria-live="polite">
          <header>
            <div>
              <span className="founder-console__eyebrow">Diagnostic</span>
              <h2>{diagnostic.title}</h2>
            </div>
            <span
              className={`founder-status founder-status--${
                diagnostic.result.ok ? 'good' : 'bad'
              }`}
            >
              {diagnostic.result.ok ? 'Passed' : 'Needs attention'}
            </span>
          </header>
          <pre>
            {diagnosticText(diagnostic.result) ||
              (diagnostic.result.ok
                ? 'Completed without output.'
                : 'No diagnostic output was returned.')}
          </pre>
        </section>
      )}

      <footer className="founder-console__footer">
        <span>
          Config:{' '}
          {state?.configuration?.source === 'file'
            ? state.configuration.path
            : 'private built-in defaults'}
        </span>
        <span>
          Last checked:{' '}
          {state?.generatedAt
            ? new Date(state.generatedAt).toLocaleTimeString()
            : 'pending'}
        </span>
      </footer>
    </div>
  )
}

function FounderCard({
  title,
  kicker,
  status,
  tone,
  children,
}: {
  title: string
  kicker: string
  status: string
  tone: 'good' | 'warn' | 'bad'
  children: ReactNode
}) {
  return (
    <article className="founder-card">
      <header>
        <div>
          <span>{kicker}</span>
          <h2>{title}</h2>
        </div>
        <span className={`founder-status founder-status--${tone}`}>
          {status}
        </span>
      </header>
      {children}
    </article>
  )
}

function StatusMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: 'good' | 'warn' | 'bad'
}) {
  return (
    <div className="founder-metric">
      <span>{label}</span>
      <strong>
        <i className={`founder-dot founder-dot--${tone}`} aria-hidden="true" />
        {value}
      </strong>
      <small>{detail}</small>
    </div>
  )
}

function DefinitionList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="founder-definition-list">
      {rows.map(([term, description]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  )
}

function ActionButton({
  children,
  onClick,
  busy,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  busy: boolean
  disabled?: boolean
}) {
  return (
    <button
      className="founder-button"
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

function endpointLabel(
  service:
    | {
        host?: string | null
        port?: number
        online?: boolean
      }
    | undefined
) {
  if (!service?.host) return 'Not configured'
  return `${service.online ? 'Online' : 'Offline'} · ${service.host}${
    service.port ? `:${service.port}` : ''
  }`
}

function formatBytes(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let amount = value
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  return `${amount.toFixed(index >= 4 ? 1 : 0)} ${units[index]}`
}

function diagnosticText(result: DesktopFounderResult) {
  return [result.stdout, result.stderr, result.error]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join('\n')
    .trim()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
