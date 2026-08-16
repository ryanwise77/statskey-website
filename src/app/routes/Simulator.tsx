import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  getDesktopBridge,
  type DesktopApprovalMode,
  type DesktopDeviceAction,
  type DesktopDeviceActionRequest,
  type DesktopDeviceActionResult,
  type DesktopDeviceSummary,
  type DesktopDevicesBridge,
  type DesktopOperationOrigin,
  type DesktopWorkspaceBinding,
} from '../lib/desktop'
import {
  captureWorkspaceBinding,
} from '../lib/workspaceContext'
import {
  desktopDeviceRunProof,
  type DesktopDeviceEvidenceEvent,
} from '../lib/desktopDeviceEvidence'

const DEVICE_ORIGIN: DesktopOperationOrigin = {
  sessionId: 'simulator-workspace',
}

export function Simulator() {
  const desktop = getDesktopBridge()
  const deviceBridge: DesktopDevicesBridge | undefined = desktop?.devices
  const [devices, setDevices] = useState<DesktopDeviceSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [binding, setBinding] = useState<DesktopWorkspaceBinding | undefined>()
  const [bindingLoaded, setBindingLoaded] = useState(false)
  const bindingIdRef = useRef<string | null>(null)
  const refreshGenerationRef = useRef(0)
  const [approvalMode, setApprovalMode] =
    useState<DesktopApprovalMode>('review')
  const [busyAction, setBusyAction] =
    useState<DesktopDeviceAction | 'list' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [artifactPath, setArtifactPath] = useState('')
  const [mediaPath, setMediaPath] = useState('')
  const [deviceUrl, setDeviceUrl] = useState('')
  const [appId, setAppId] = useState('')
  const [environmentText, setEnvironmentText] = useState(
    'STATSKEY_DEBUG_RECORD_SURFACE=library'
  )
  const [typeText, setTypeText] = useState('')
  const [screenshot, setScreenshot] = useState<
    DesktopDeviceActionResult['screenshot'] | null
  >(null)
  const [logs, setLogs] = useState('')
  const [hierarchy, setHierarchy] = useState('')
  const [events, setEvents] = useState<DesktopDeviceEvidenceEvent[]>([])

  const selected = useMemo(
    () => devices.find((device) => device.id === selectedId) ?? null,
    [devices, selectedId]
  )
  const runProof = selected
    ? desktopDeviceRunProof(events, selected.id, appId.trim() || undefined)
    : { ready: false, label: 'Choose a device' }

  useEffect(() => {
    if (!desktop) {
      setBindingLoaded(true)
      return
    }
    let active = true
    const applyWorkspace = (workspace: Parameters<
      Parameters<typeof desktop.workspace.onState>[0]
    >[0]) => {
      if (!active) return
      const next = captureWorkspaceBinding(workspace) ?? undefined
      const nextId = next?.workspaceId ?? null
      if (bindingIdRef.current !== nextId) {
        bindingIdRef.current = nextId
        refreshGenerationRef.current += 1
        setDevices([])
        setSelectedId('')
        setEvents([])
        setScreenshot(null)
        setLogs('')
        setHierarchy('')
        setError(null)
      }
      setBinding((current) =>
        current?.workspaceId === next?.workspaceId ? current : next
      )
      setBindingLoaded(true)
    }
    const unsubscribe = desktop.workspace.onState(applyWorkspace)
    void Promise.all([
      desktop.workspace.getState().catch(() => null),
      desktop.preferences.get().catch(() => null),
    ]).then(([workspace, preferences]) => {
      if (!active) return
      if (workspace) applyWorkspace(workspace)
      else setBindingLoaded(true)
      if (preferences) setApprovalMode(preferences.approvalMode)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [desktop])

  useEffect(() => {
    if (!deviceBridge || !bindingLoaded) return
    void refreshDevices()
    // Refresh when the exact workspace binding becomes available or changes;
    // device references are origin- and workspace-owned by the main process.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceBridge, binding, bindingLoaded])

  async function refreshDevices() {
    if (!deviceBridge) return
    const generation = ++refreshGenerationRef.current
    const requestedWorkspaceId = binding?.workspaceId ?? null
    setBusyAction('list')
    setError(null)
    try {
      const result = await deviceBridge.list(binding, DEVICE_ORIGIN)
      const rawDevices = result.devices ?? []
      if (!result.ok && result.error) {
        throw new Error(result.error)
      }
      if (
        generation !== refreshGenerationRef.current ||
        requestedWorkspaceId !== bindingIdRef.current
      ) {
        return
      }
      const next = rawDevices
        .map(normalizeDevice)
        .filter((device): device is DesktopDeviceSummary => device != null)
      setDevices(next)
      setSelectedId((current) =>
        next.some((device) => device.id === current)
          ? current
          : next.find((device) => device.state === 'booted')?.id ??
            next[0]?.id ??
            ''
      )
    } catch (listError) {
      if (generation !== refreshGenerationRef.current) return
      setError(
        listError instanceof Error
          ? listError.message
          : 'Could not discover simulator devices.'
      )
    } finally {
      if (generation === refreshGenerationRef.current) setBusyAction(null)
    }
  }

  async function act(
    action: DesktopDeviceAction,
    extra: Partial<DesktopDeviceActionRequest> = {}
  ): Promise<DesktopDeviceActionResult | null> {
    if (!deviceBridge || !selected) return null
    setBusyAction(action)
    setError(null)
    try {
      const result = await deviceBridge.act(
        {
          platform: selected.platform,
          action,
          deviceId: selected.id,
          ...(appId.trim() ? { appId: appId.trim() } : {}),
          ...extra,
        },
        approvalMode,
        DEVICE_ORIGIN,
        binding
      )
      const event: DesktopDeviceEvidenceEvent = {
        id: crypto.randomUUID(),
        at: Date.now(),
        deviceId: selected.id,
        action,
        ok: result.ok,
        cancelled: result.cancelled,
        marker: result.marker,
        appId: result.appId ?? (appId.trim() || undefined),
        alive: result.alive,
        crashFree: result.crashFree,
        crashMarkers: result.crashMarkers,
        error: result.error,
      }
      setEvents((current) => [...current, event].slice(-40))
      if (!result.ok && !result.cancelled) {
        setError(result.error || `${deviceActionLabel(action)} failed.`)
      }
      if (result.screenshot) setScreenshot(result.screenshot)
      if (typeof result.logs === 'string') setLogs(result.logs)
      if (typeof result.hierarchy === 'string') setHierarchy(result.hierarchy)
      if (result.appId && !appId.trim()) setAppId(result.appId)
      if (action === 'boot' || action === 'close') await refreshDevices()
      return result
    } catch (actionError) {
      const message =
        actionError instanceof Error
          ? actionError.message
          : `${deviceActionLabel(action)} failed.`
      setError(message)
      setEvents((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          at: Date.now(),
          deviceId: selected.id,
          action,
          ok: false,
          appId: appId.trim() || undefined,
          error: message,
        },
      ].slice(-40))
      return null
    } finally {
      setBusyAction(null)
    }
  }

  async function install() {
    if (!artifactPath.trim()) {
      setError('Choose an exact workspace artifact path before installing.')
      return
    }
    await act('install', { artifactPath: artifactPath.trim() })
  }

  async function launch() {
    if (!appId.trim()) {
      setError('Enter the app bundle ID before launching.')
      return
    }
    await act('launch', { environment: parseEnvironment(environmentText) })
  }

  async function openDeviceUrl() {
    if (!deviceUrl.trim()) {
      setError('Enter an absolute web or app deep-link URL before opening it.')
      return
    }
    await act('open_url', { url: deviceUrl.trim() })
  }

  async function addMedia() {
    if (!mediaPath.trim()) {
      setError('Choose an exact workspace photo or video path before adding it.')
      return
    }
    await act('add_media', { mediaPath: mediaPath.trim() })
  }

  async function tapScreenshot(event: MouseEvent<HTMLImageElement>) {
    if (!screenshot?.width || !screenshot.height) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.round(
      ((event.clientX - rect.left) / rect.width) * screenshot.width
    )
    const y = Math.round(
      ((event.clientY - rect.top) / rect.height) * screenshot.height
    )
    await act('tap', { x, y })
  }

  if (!deviceBridge) {
    return (
      <section className="simulator-workspace simulator-workspace--unavailable">
        <span aria-hidden="true">▣</span>
        <h1>Simulator controls require the latest StatsKey Desktop build.</h1>
        <p>
          Update the desktop runtime to discover devices, exercise app flows,
          capture screenshots and logs, and record crash-free run evidence.
        </p>
      </section>
    )
  }

  return (
    <section className="simulator-workspace">
      <header className="simulator-workspace__header">
        <div>
          <span>Device workspace</span>
          <h1>Simulator</h1>
          <p>Launch and exercise an app, then retain exact runtime proof.</p>
        </div>
        <button onClick={() => void refreshDevices()} disabled={busyAction != null}>
          {busyAction === 'list' ? 'Discovering…' : 'Refresh devices'}
        </button>
      </header>

      {error && <div className="simulator-workspace__error" role="alert">{error}</div>}

      <div className="simulator-workspace__layout">
        <aside className="simulator-workspace__devices" aria-label="Available devices">
          <b>Devices</b>
          {devices.length === 0 && <p>No available device runtime was found.</p>}
          {devices.map((device) => (
            <button
              key={device.id}
              className={device.id === selectedId ? 'active' : ''}
              onClick={() => setSelectedId(device.id)}
              aria-pressed={device.id === selectedId}
            >
              <span>{device.platform === 'ios' ? 'iOS' : 'Android'}</span>
              <b>{device.name}</b>
              <small>{[device.osVersion || device.runtime, device.state].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
        </aside>

        <main className="simulator-workspace__main">
          {selected ? (
            <>
              <section className="simulator-workspace__device-head">
                <div>
                  <span>{selected.platform.toUpperCase()} device</span>
                  <h2>{selected.name}</h2>
                  <code>{selected.id}</code>
                </div>
                <div>
                  <button onClick={() => void act('boot')} disabled={busyAction != null}>
                    Boot / start
                  </button>
                  <button
                    onClick={() => void act('close')}
                    disabled={busyAction != null || !appId.trim()}
                  >
                    Stop app
                  </button>
                </div>
              </section>

              <section className="simulator-workspace__setup">
                <label>
                  App artifact
                  <input
                    value={artifactPath}
                    onChange={(event) => setArtifactPath(event.target.value)}
                    placeholder="/workspace/build/StatsKey.app"
                  />
                </label>
                <button onClick={() => void install()} disabled={busyAction != null || !artifactPath.trim()}>
                  Install
                </button>
                <label>
                  Bundle ID
                  <input
                    value={appId}
                    onChange={(event) => setAppId(event.target.value)}
                    placeholder="com.example.app"
                  />
                </label>
                <button onClick={() => void launch()} disabled={busyAction != null || !appId.trim()}>
                  Launch
                </button>
                <label>
                  Deep link or URL
                  <input
                    value={deviceUrl}
                    onChange={(event) => setDeviceUrl(event.target.value)}
                    placeholder="statskey://record?surface=library"
                  />
                </label>
                <button onClick={() => void openDeviceUrl()} disabled={busyAction != null || !deviceUrl.trim()}>
                  Open URL
                </button>
                <label>
                  Workspace photo or video
                  <input
                    value={mediaPath}
                    onChange={(event) => setMediaPath(event.target.value)}
                    placeholder="/workspace/fixtures/food.jpg"
                  />
                </label>
                <button onClick={() => void addMedia()} disabled={busyAction != null || !mediaPath.trim()}>
                  Add media
                </button>
                <label className="simulator-workspace__environment">
                  Launch environment (one KEY=VALUE per line)
                  <textarea
                    value={environmentText}
                    onChange={(event) => setEnvironmentText(event.target.value)}
                    rows={2}
                  />
                </label>
              </section>

              <section className="simulator-workspace__proof" data-ready={runProof.ready || undefined}>
                <div>
                  <span>Test-run evidence</span>
                  <b>{runProof.ready ? 'Verified' : 'Not verified'}</b>
                  <p>{runProof.label}</p>
                </div>
                <button onClick={() => void act('process')} disabled={busyAction != null || !appId.trim()}>
                  Verify running app
                </button>
                <button
                  onClick={() => void act('logs', { logSinceSeconds: 120 })}
                  disabled={busyAction != null || !appId.trim()}
                >
                  Check crash logs
                </button>
              </section>

              <div className="simulator-workspace__workbench">
                <section className="simulator-workspace__screen">
                  <header>
                    <b>Screen</b>
                    <button onClick={() => void act('screenshot')} disabled={busyAction != null}>
                      Screenshot
                    </button>
                  </header>
                  {screenshot ? (
                    <img
                      src={`data:${screenshot.mediaType};base64,${screenshot.data}`}
                      alt={`Current screen of ${selected.name}`}
                      onClick={(event) => void tapScreenshot(event)}
                      title={screenshot.width ? 'Click to tap this coordinate' : undefined}
                    />
                  ) : (
                    <div><span aria-hidden="true">▱</span><p>Capture a screenshot to inspect and tap the device.</p></div>
                  )}
                </section>

                <section className="simulator-workspace__controls">
                  <header><b>Controls</b></header>
                  <div>
                    <button onClick={() => void act('home')} disabled={busyAction != null}>Home</button>
                    <button onClick={() => void act('back')} disabled={busyAction != null}>Back</button>
                    <button
                      onClick={() => void act('swipe', { x: 180, y: 540, endX: 180, endY: 180, durationMs: 350 })}
                      disabled={busyAction != null}
                    >
                      Swipe up
                    </button>
                    <button onClick={() => void act('inspect')} disabled={busyAction != null}>Inspect UI</button>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (typeText.trim()) void act('type', { text: typeText })
                    }}
                  >
                    <input
                      value={typeText}
                      onChange={(event) => setTypeText(event.target.value)}
                      placeholder="Text to type into the focused control"
                      aria-label="Device text input"
                    />
                    <button type="submit" disabled={busyAction != null || !typeText.trim()}>Type</button>
                  </form>
                  {hierarchy && <pre aria-label="Device UI hierarchy">{hierarchy}</pre>}
                  {logs && <pre aria-label="Device logs">{logs}</pre>}
                </section>
              </div>

              <section className="simulator-workspace__evidence">
                <header>
                  <b>Evidence log</b>
                  <button onClick={() => setEvents([])} disabled={events.length === 0}>Clear</button>
                </header>
                {events.length === 0 ? (
                  <p>No device action evidence recorded yet.</p>
                ) : (
                  <ol>
                    {events.slice().reverse().slice(0, 12).map((entry) => (
                      <li key={entry.id} data-ok={entry.ok || undefined}>
                        <b>{deviceActionLabel(entry.action)}</b>
                        <span>{entry.marker || entry.error || (entry.ok ? 'Completed by desktop runtime' : 'Failed')}</span>
                        <time>{new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          ) : (
            <section className="simulator-workspace__empty">
              <h2>Choose a device to begin.</h2>
              <p>Booted simulators appear first after discovery.</p>
            </section>
          )}
        </main>
      </div>
    </section>
  )
}

function normalizeDevice(value: unknown): DesktopDeviceSummary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = text(record.id) || text(record.deviceId) || text(record.udid)
  const rawPlatform = text(record.platform).toLowerCase()
  const platform: DesktopDeviceSummary['platform'] | null =
    rawPlatform === 'ios' || rawPlatform === 'android'
      ? rawPlatform
      : /iphone|ipad|ios|simulator/i.test(
            `${text(record.name)} ${text(record.runtime)}`
          )
        ? 'ios'
        : /android|emulator/i.test(`${text(record.name)} ${text(record.runtime)}`)
          ? 'android'
          : null
  if (!id || !platform) return null
  return {
    id,
    platform,
    name: text(record.name) || id,
    state: text(record.state) || 'unknown',
    osVersion: text(record.osVersion) || undefined,
    runtime: text(record.runtime) || undefined,
    available: record.available !== false,
  }
}

function parseEnvironment(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .slice(0, 20)
      .flatMap((line) => {
        const separator = line.indexOf('=')
        const key = line.slice(0, separator).trim()
        if (separator <= 0 || !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key)) {
          return []
        }
        return [[key, line.slice(separator + 1).slice(0, 2_000)]]
      })
  )
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 2_000) : ''
}

function deviceActionLabel(action: DesktopDeviceAction): string {
  switch (action) {
    case 'boot': return 'Boot / start device'
    case 'install': return 'Install app'
    case 'launch': return 'Launch app'
    case 'inspect': return 'Inspect UI'
    case 'screenshot': return 'Capture screenshot'
    case 'tap': return 'Tap screen'
    case 'type': return 'Type text'
    case 'swipe': return 'Swipe screen'
    case 'back': return 'Go back'
    case 'home': return 'Go home'
    case 'open_url': return 'Open device URL'
    case 'add_media': return 'Add media'
    case 'process': return 'Verify app process'
    case 'logs': return 'Check device logs'
    case 'close': return 'Stop app'
  }
}
