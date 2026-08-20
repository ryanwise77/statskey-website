import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { NavLink } from 'react-router-dom'
import {
  approveFleetRemoteSession,
  endFleetRemoteSession,
  listFleetDevices,
  listFleetRemoteSessions,
  requestFleetRemoteSession,
} from '../lib/fleet/workbenchFleetApi'
import {
  fleetDeviceIsPresent,
  type FleetDevice,
  type FleetRemoteSession,
  type FleetRemoteSessionCapability,
} from '../lib/fleet/types'
import {
  getDesktopBridge,
  type DesktopRemoteInputEvent,
  type DesktopRemoteSessionState,
} from '../lib/desktop'
import { confirmDialog, showToast } from '../lib/ui/dialogs'

const LIVE_STATES = new Set(['requested', 'approved', 'active'])
const MOUSE_BUTTONS = new Map<number, 'left' | 'middle' | 'right'>([
  [0, 'left'],
  [1, 'middle'],
  [2, 'right'],
])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Remote session failed.'
}

function stateLabel(session: FleetRemoteSession): string {
  switch (session.state) {
    case 'requested':
      return 'Waiting for approval'
    case 'approved':
      return 'Approved'
    case 'active':
      return 'Active'
    case 'ended':
      return 'Ended'
    case 'expired':
      return 'Expired'
  }
}

export function FleetRemote() {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const [sessions, setSessions] = useState<FleetRemoteSession[]>([])
  const [devices, setDevices] = useState<FleetDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workerDeviceId, setWorkerDeviceId] = useState('')
  const [withInput, setWithInput] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [activeSession, setActiveSession] = useState<FleetRemoteSession | null>(null)
  const [viewerState, setViewerState] = useState<DesktopRemoteSessionState | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [sessionResult, deviceResult] = await Promise.all([
        listFleetRemoteSessions({ limit: 25 }, { signal }),
        listFleetDevices({ limit: 50 }, { signal }),
      ])
      setSessions(sessionResult.sessions)
      setDevices(deviceResult.devices)
      setError(null)
    } catch (nextError) {
      if (signal?.aborted) return
      setError(errorMessage(nextError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | null = null
    let disposed = false
    const poll = async () => {
      await refresh(controller.signal)
      if (!disposed && !controller.signal.aborted) {
        timer = window.setTimeout(() => void poll(), 5_000)
      }
    }
    void poll()
    return () => {
      disposed = true
      controller.abort()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [refresh])

  // Track the desktop relay channel state for the active session.
  useEffect(() => {
    if (!desktop?.remoteSession) return
    return desktop.remoteSession.onState((state) => {
      if (activeSession && state.sessionId === activeSession.sessionId) {
        setViewerState(state)
      }
    })
  }, [desktop, activeSession])

  const deviceLabels = useMemo(
    () => new Map(devices.map((device) => [device.id, device.label])),
    [devices]
  )
  const controllers = useMemo(
    () =>
      devices.filter(
        (device) =>
          device.status === 'active' &&
          ['controller', 'hybrid'].includes(device.role)
      ),
    [devices]
  )
  const workers = useMemo(
    () =>
      devices.filter(
        (device) =>
          device.status === 'active' &&
          ['worker', 'hybrid'].includes(device.role) &&
          device.workerMode !== 'disabled'
      ),
    [devices]
  )
  const selectedWorker = workers.find((device) => device.id === workerDeviceId)
  const liveSessions = sessions.filter((session) => LIVE_STATES.has(session.state))
  const pastSessions = sessions.filter((session) => !LIVE_STATES.has(session.state))

  async function requestSession() {
    if (!selectedWorker) return
    if (!desktop?.remoteSession) {
      showToast('Remote sessions require the StatsKey desktop app.', {
        kind: 'error',
      })
      return
    }
    const capabilities: FleetRemoteSessionCapability[] = [
      'screen.view',
      ...(withInput && selectedWorker.platform === 'win32'
        ? (['screen.input'] as FleetRemoteSessionCapability[])
        : []),
    ]
    const confirmed = await confirmDialog({
      title: `Request a remote session on ${selectedWorker.label}?`,
      body: [
        'The host shows a visible indicator while the session is active.',
        capabilities.includes('screen.input')
          ? 'You are requesting screen viewing and remote input control.'
          : 'You are requesting screen viewing only.',
        'The host approves automatically when it holds your capability grant; otherwise the session waits for explicit approval.',
      ].join('\n'),
      confirmLabel: 'Request session',
    })
    if (!confirmed) return
    setRequesting(true)
    try {
      const prepared = await desktop.remoteSession.prepareRequest()
      if (!prepared) throw new Error('The desktop could not prepare the session.')
      const controller = controllers[0]
      if (!controller) {
        throw new Error('No active controller device is enrolled on this account.')
      }
      await requestFleetRemoteSession({
        controllerDeviceId: controller.id,
        workerDeviceId: selectedWorker.id,
        capabilities,
        transport: 'relay',
        controllerEphemeralKey: prepared.controllerEphemeralKey,
      })
      showToast('Remote session requested.', { kind: 'success' })
      await refresh()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setRequesting(false)
    }
  }

  async function approveSession(session: FleetRemoteSession) {
    try {
      await approveFleetRemoteSession(session.sessionId)
      showToast('Remote session approved.', { kind: 'success' })
      await refresh()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  async function endSession(session: FleetRemoteSession, { localOnly = false } = {}) {
    if (!localOnly) {
      const confirmed = await confirmDialog({
        title: 'End this remote session?',
        body: 'The screen stream stops immediately and the session key is discarded.',
        confirmLabel: 'End session',
        destructive: true,
      })
      if (!confirmed) return
    }
    try {
      await desktop?.remoteSession?.end(session.sessionId)
      await endFleetRemoteSession(session.sessionId)
      if (activeSession?.sessionId === session.sessionId) {
        setActiveSession(null)
        setViewerState(null)
      }
      await refresh()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  async function connectSession(session: FleetRemoteSession) {
    if (!desktop?.remoteSession) {
      showToast('Remote sessions require the StatsKey desktop app.', {
        kind: 'error',
      })
      return
    }
    if (!session.sessionKey || !session.relayEndpoint) {
      showToast('This session has no channel material yet.', { kind: 'error' })
      return
    }
    const workerLabel = deviceLabels.get(session.workerDeviceId) ?? session.workerDeviceId
    const confirmed = await confirmDialog({
      title: `Connect to ${workerLabel}?`,
      body: [
        `Session ${session.sessionId}`,
        session.capabilities.includes('screen.input')
          ? 'This session allows remote input control of the host.'
          : 'This session is view-only.',
        'All traffic is end-to-end encrypted; the relay cannot read it.',
      ].join('\n'),
      confirmLabel: 'Connect',
    })
    if (!confirmed) return
    const result = await desktop.remoteSession.connect({
      sessionId: session.sessionId,
      relayEndpoint: session.relayEndpoint,
      sessionKey: session.sessionKey,
      controllerEphemeralKey: session.controllerEphemeralKey,
      capabilities: session.capabilities,
    })
    if (!result.ok) {
      showToast(`Could not connect: ${result.error || 'failed'}.`, { kind: 'error' })
      return
    }
    setActiveSession(session)
    setViewerState(null)
  }

  if (activeSession) {
    return (
      <RemoteSessionViewer
        session={activeSession}
        viewerState={viewerState}
        workerLabel={
          deviceLabels.get(activeSession.workerDeviceId) ??
          activeSession.workerDeviceId
        }
        onEnd={() => void endSession(activeSession)}
        onDisconnect={() => {
          if (activeSession) {
            void desktop?.remoteSession?.end(activeSession.sessionId)
          }
          setActiveSession(null)
          setViewerState(null)
          void refresh()
        }}
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="card-title">Workspace control plane</span>
          <h1 className="mt-1 font-display text-[28px] font-bold tracking-[-0.025em]">
            Remote sessions
          </h1>
          <p className="mt-1 max-w-2xl text-[14px] text-text-secondary">
            End-to-end encrypted screen sharing between your enrolled devices.
            The relay forwards only ciphertext, and the host always shows a
            visible indicator while a session is active.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      <nav
        className="flex w-fit gap-1 rounded-lg border border-white/[0.07] bg-white/[0.025] p-1"
        aria-label="Fleet control plane"
      >
        {[
          { to: '/fleet', label: 'Fleet' },
          { to: '/jobs', label: 'Jobs' },
          { to: '/fleet/remote', label: 'Remote sessions' },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                isActive
                  ? 'bg-white/[0.1] text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <section className="panel !p-0 overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <span className="card-title">Request a session</span>
          <p className="mt-1 text-[12px] text-text-muted">
            Pick a host device. Sessions expire ten minutes after the request
            unless they become active.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-medium text-text-muted">Host device</span>
            <select
              className="input"
              value={workerDeviceId}
              onChange={(event) => setWorkerDeviceId(event.target.value)}
            >
              <option value="">Choose a host…</option>
              {workers.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label} · {device.platform}
                  {fleetDeviceIsPresent(device) ? '' : ' · offline'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              checked={withInput}
              onChange={(event) => setWithInput(event.target.checked)}
              disabled={selectedWorker?.platform !== 'win32'}
            />
            Allow input control
            {selectedWorker && selectedWorker.platform !== 'win32' && (
              <span className="text-[11px] text-text-muted">(Windows hosts only)</span>
            )}
          </label>
          <button
            className="btn btn-primary"
            onClick={() => void requestSession()}
            disabled={!selectedWorker || requesting || !desktop?.remoteSession}
          >
            {requesting ? 'Requesting…' : 'Request session'}
          </button>
        </div>
        {!desktop?.remoteSession && (
          <p className="border-t border-white/[0.06] px-5 py-3 text-[12px] text-text-muted">
            Connecting to a session requires the StatsKey desktop app; this
            browser can request, approve, and end sessions.
          </p>
        )}
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="panel !p-0 overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <span className="card-title">Live sessions</span>
        </div>
        {liveSessions.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-text-muted">
            No live remote sessions.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {liveSessions.map((session) => (
              <article
                key={session.sessionId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        session.state === 'active'
                          ? 'bg-emerald-400'
                          : session.state === 'approved'
                            ? 'bg-sky-400'
                            : 'bg-amber-300'
                      }`}
                      aria-hidden="true"
                    />
                    <h2 className="truncate text-[14px] font-medium text-text-primary">
                      {deviceLabels.get(session.workerDeviceId) ??
                        session.workerDeviceId}
                    </h2>
                  </div>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {stateLabel(session)} ·{' '}
                    {session.capabilities.includes('screen.input')
                      ? 'view + input'
                      : 'view only'}{' '}
                    · expires {new Date(session.expiresAt).toLocaleTimeString()}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
                    {session.sessionId}
                  </p>
                </div>
                <div className="flex gap-2">
                  {session.state === 'requested' && (
                    <button
                      className="btn btn-secondary text-[11px]"
                      onClick={() => void approveSession(session)}
                    >
                      Approve
                    </button>
                  )}
                  {(session.state === 'approved' || session.state === 'active') && (
                    <button
                      className="btn btn-primary text-[11px]"
                      onClick={() => void connectSession(session)}
                      disabled={!desktop?.remoteSession}
                    >
                      Connect
                    </button>
                  )}
                  <button
                    className="btn btn-ghost text-[11px] text-red-300"
                    onClick={() => void endSession(session)}
                  >
                    End
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {pastSessions.length > 0 && (
        <section className="panel !p-0 overflow-hidden">
          <div className="border-b border-white/[0.06] px-5 py-4">
            <span className="card-title">Recent sessions</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {pastSessions.slice(0, 10).map((session) => (
              <article
                key={session.sessionId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <p className="text-[12px] text-text-secondary">
                  {deviceLabels.get(session.workerDeviceId) ?? session.workerDeviceId}
                </p>
                <p className="text-[11px] text-text-muted">
                  {stateLabel(session)} · {new Date(session.updatedAt).toLocaleString()}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function RemoteSessionViewer({
  session,
  viewerState,
  workerLabel,
  onEnd,
  onDisconnect,
}: {
  session: FleetRemoteSession
  viewerState: DesktopRemoteSessionState | null
  workerLabel: string
  onEnd: () => void
  onDisconnect: () => void
}) {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const headerRef = useRef<DesktopRemoteSessionState['header']>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const lastMoveRef = useRef(0)
  const [frameCount, setFrameCount] = useState(0)

  const canInput = session.capabilities.includes('screen.input')
  const header = viewerState?.header ?? null
  headerRef.current = header
  const state = viewerState?.state ?? 'connecting'

  useEffect(() => {
    if (!desktop?.remoteSession) return
    return desktop.remoteSession.onFrame((frame) => {
      if (frame.sessionId !== session.sessionId) return
      const canvas = canvasRef.current
      const currentHeader = headerRef.current
      if (!canvas || !currentHeader) return
      const blob = new Blob([new Uint8Array(frame.jpeg)], {
        type: 'image/jpeg',
      })
      void createImageBitmap(blob)
        .then((bitmap) => {
          const context = canvas.getContext('2d')
          if (!context) {
            bitmap.close()
            return
          }
          if (
            canvas.width !== currentHeader.width ||
            canvas.height !== currentHeader.height
          ) {
            canvas.width = currentHeader.width
            canvas.height = currentHeader.height
          }
          context.drawImage(bitmap, 0, 0)
          bitmapRef.current?.close()
          bitmapRef.current = bitmap
          setFrameCount((count) => count + 1)
        })
        .catch(() => {})
    })
  }, [desktop, session.sessionId])

  useEffect(() => {
    const bitmap = bitmapRef.current
    return () => bitmap?.close()
  }, [])

  const sendInput = useCallback(
    (event: DesktopRemoteInputEvent) => {
      if (!canInput || state !== 'active') return
      void desktop?.remoteSession?.sendInput(session.sessionId, event)
    },
    [desktop, canInput, state, session.sessionId]
  )

  const framePoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current
      const currentHeader = headerRef.current
      if (!canvas || !currentHeader) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return null
      const x = Math.round(
        ((event.clientX - rect.left) * currentHeader.width) / rect.width
      )
      const y = Math.round(
        ((event.clientY - rect.top) * currentHeader.height) / rect.height
      )
      if (x < 0 || y < 0 || x >= currentHeader.width || y >= currentHeader.height) {
        return null
      }
      return { x, y }
    },
    []
  )

  const onMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const nowTs = Date.now()
    if (nowTs - lastMoveRef.current < 33) return
    lastMoveRef.current = nowTs
    const point = framePoint(event)
    if (point) sendInput({ type: 'mousemove', ...point })
  }
  const onMouseButton = (
    event: ReactMouseEvent<HTMLCanvasElement>,
    type: 'mousedown' | 'mouseup'
  ) => {
    const button = MOUSE_BUTTONS.get(event.button)
    const point = framePoint(event)
    if (!button || !point) return
    event.preventDefault()
    sendInput({ type, ...point, button })
  }
  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    const point = framePoint(event)
    if (!point) return
    event.preventDefault()
    const deltaY = Math.max(-4096, Math.min(4096, -Math.round(event.deltaY)))
    if (deltaY === 0) return
    sendInput({ type: 'wheel', ...point, deltaY })
  }
  const onKey = (
    event: ReactKeyboardEvent<HTMLCanvasElement>,
    type: 'keydown' | 'keyup'
  ) => {
    if (!canInput) return
    event.preventDefault()
    sendInput({ type, key: event.code })
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="card-title">Remote session</span>
          <h1 className="mt-1 font-display text-[22px] font-bold tracking-[-0.025em]">
            {workerLabel}
          </h1>
          <p className="mt-1 text-[12px] text-text-muted">
            {session.sessionId} ·{' '}
            {canInput ? 'view + input control' : 'view only'} ·{' '}
            {state === 'active'
              ? `streaming ${frameCount} frames`
              : state === 'waiting'
                ? 'paired, waiting for the host stream'
                : state === 'connecting'
                  ? 'connecting to the relay'
                  : state === 'failed'
                    ? `failed: ${viewerState?.error ?? 'relay error'}`
                    : 'connection closed'}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={onDisconnect}>
            Disconnect
          </button>
          <button
            className="btn bg-red-600 text-white hover:bg-red-500"
            onClick={onEnd}
          >
            End session
          </button>
        </div>
      </header>
      <div className="panel !p-3">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="block max-h-[70vh] w-full rounded-lg bg-black object-contain outline-none focus:ring-1 focus:ring-white/30"
          onMouseMove={onMouseMove}
          onMouseDown={(event) => onMouseButton(event, 'mousedown')}
          onMouseUp={(event) => onMouseButton(event, 'mouseup')}
          onWheel={onWheel}
          onKeyDown={(event) => onKey(event, 'keydown')}
          onKeyUp={(event) => onKey(event, 'keyup')}
          onContextMenu={(event) => event.preventDefault()}
        />
        <p className="mt-2 text-[11px] text-text-muted">
          {canInput
            ? 'Click the video to focus it; mouse and keyboard input is forwarded while focused.'
            : 'This session is view-only.'}{' '}
          All frames are end-to-end encrypted; the relay cannot read them.
        </p>
      </div>
    </div>
  )
}
