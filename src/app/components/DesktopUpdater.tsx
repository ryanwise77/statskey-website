import { useEffect, useState } from 'react'
import {
  getDesktopBridge,
  type DesktopUpdateState,
  type DesktopUpdateStatus,
} from '../lib/desktop'

const UPDATE_STATUSES = new Set<DesktopUpdateStatus>([
  'disabled',
  'idle',
  'checking',
  'current',
  'available',
  'downloading',
  'downloaded',
  'error',
])

export function DesktopUpdater() {
  const updates = getDesktopBridge()?.updates
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    if (!updates) return
    let active = true
    void updates.getState().then((value) => {
      if (active && isUpdateState(value)) setState(value)
    })
    const unsubscribe = updates.onState((value) => {
      if (active && isUpdateState(value)) setState(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [updates])

  useEffect(() => {
    if (!updates || state?.status !== 'current' || !state.manual) return
    const timer = window.setTimeout(() => {
      void updates.dismiss()
    }, 4_500)
    return () => window.clearTimeout(timer)
  }, [state?.manual, state?.status, updates])

  if (!updates || !state || !shouldShow(state)) return null

  async function perform(action: () => Promise<unknown>) {
    if (acting) return
    setActing(true)
    try {
      await action()
    } finally {
      setActing(false)
    }
  }

  const latest = state.latestVersion || 'the latest version'
  return (
    <aside
      className={`desktop-update desktop-update--${state.status}`}
      aria-live="polite"
      aria-label="StatsKey update"
    >
      <span className="desktop-update__mark" aria-hidden="true">
        {state.status === 'downloaded' ? '✓' : '↑'}
      </span>
      <div className="desktop-update__copy">
        <b>{updateTitle(state)}</b>
        <span>{updateMessage(state, latest)}</span>
        {(state.status === 'available' || state.status === 'downloaded') &&
          state.releaseNotes &&
          state.releaseNotes.length > 0 && (
            <ul className="desktop-update__notes" aria-label="What’s new">
              {state.releaseNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        {state.status === 'downloading' && (
          <div
            className="desktop-update__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.percent || 0)}
          >
            <i style={{ width: `${state.percent || 0}%` }} />
          </div>
        )}
      </div>
      <div className="desktop-update__actions">
        {state.status === 'available' && (
          <button
            className="primary"
            disabled={acting}
            onClick={() => void perform(() => updates.download())}
          >
            {acting ? 'Starting…' : 'Download'}
          </button>
        )}
        {state.status === 'downloaded' && (
          <button
            className="primary"
            disabled={acting}
            onClick={() => void perform(() => updates.install())}
          >
            Restart now
          </button>
        )}
        {state.status === 'error' && (
          <button
            className="primary"
            disabled={acting}
            onClick={() =>
              void perform(() =>
                state.latestVersion ? updates.download() : updates.check()
              )
            }
          >
            Try again
          </button>
        )}
        {state.status !== 'downloading' && state.status !== 'checking' && (
          <button
            disabled={acting}
            onClick={() => void perform(() => updates.dismiss())}
          >
            {state.status === 'current' ? 'OK' : 'Later'}
          </button>
        )}
      </div>
    </aside>
  )
}

export function checkForDesktopUpdates(): Promise<DesktopUpdateState | null> {
  return getDesktopBridge()?.updates?.check() ?? Promise.resolve(null)
}

function shouldShow(state: DesktopUpdateState): boolean {
  if (state.dismissed) return false
  if (state.status === 'available') return true
  if (state.status === 'downloading' || state.status === 'downloaded') {
    return true
  }
  return state.manual && ['checking', 'current', 'error'].includes(state.status)
}

function updateTitle(state: DesktopUpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for updates'
    case 'current':
      return 'StatsKey is up to date'
    case 'available':
      return `StatsKey ${state.latestVersion || ''} is available`.trim()
    case 'downloading':
      return `Downloading ${Math.round(state.percent || 0)}%`
    case 'downloaded':
      return 'Update ready'
    case 'error':
      return 'Update paused'
    default:
      return 'StatsKey update'
  }
}

function updateMessage(state: DesktopUpdateState, latest: string): string {
  switch (state.status) {
    case 'checking':
      return 'This should only take a moment.'
    case 'current':
      return `You have version ${state.currentVersion}.`
    case 'available':
      return `Version ${latest} can download in the background. Restart only when convenient.`
    case 'downloading':
      return state.total
        ? `${formatBytes(state.transferred || 0)} of ${formatBytes(state.total)} · Keep working.`
        : 'Downloading quietly. Keep working.'
    case 'downloaded':
      return `Version ${latest} is downloaded. Restart now or leave it for later.`
    case 'error':
      return state.message || 'The update did not finish. Your current version is unchanged.'
    default:
      return ''
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isUpdateState(value: unknown): value is DesktopUpdateState {
  if (value == null || typeof value !== 'object') return false
  const candidate = value as Partial<DesktopUpdateState>
  return (
    typeof candidate.status === 'string' &&
    UPDATE_STATUSES.has(candidate.status as DesktopUpdateStatus) &&
    typeof candidate.currentVersion === 'string' &&
    (candidate.releaseNotes === undefined ||
      (Array.isArray(candidate.releaseNotes) &&
        candidate.releaseNotes.every((note) => typeof note === 'string'))) &&
    typeof candidate.manual === 'boolean' &&
    typeof candidate.dismissed === 'boolean'
  )
}
