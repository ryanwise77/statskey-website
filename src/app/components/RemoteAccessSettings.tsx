import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getDesktopBridge } from '../lib/desktop'
import {
  DEFAULT_REMOTE_ACCESS_PREFERENCES,
  isRemoteExecutorOnline,
  queueRemoteCommand,
  saveRemoteAccessPreferences,
  subscribeRemoteAccessPreferences,
  subscribeRemoteCommands,
  subscribeRemoteExecutors,
  type RemoteAccessPreferences,
  type RemoteAccessTarget,
  type RemoteCommand,
  type RemoteExecutor,
} from '../lib/remoteAccess'
import './RemoteAccessSettings.css'

export function RemoteAccessSettings() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const state = useRemoteAccessState(user?.uid)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!user) {
    return (
      <div className="settings-card">
        <b>Sign in to connect your private devices</b>
        <p>
          Your iPhone and Desktop use the same StatsKey account to exchange
          owner-only command metadata. SSH keys stay on this Mac.
        </p>
        <div className="settings-card__actions">
          <button
            className="settings-card__button settings-card__button--primary"
            onClick={() => navigate('/login')}
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  async function update(
    patch: Partial<
      Omit<RemoteAccessPreferences, 'schemaVersion' | 'updatedAt'>
    >
  ) {
    if (busy) return
    setBusy('save')
    setError(null)
    const current = state.preferences
    const next = {
      enabled: current.enabled,
      allowMacMini: current.allowMacMini,
      allowDataCenter: current.allowDataCenter,
      requireConfirmation: true,
      onboardingChoice: current.onboardingChoice,
      ...patch,
    }
    next.requireConfirmation = true
    if (next.enabled && !next.allowMacMini && !next.allowDataCenter) {
      next.allowMacMini = true
      next.allowDataCenter = true
    }
    try {
      await saveRemoteAccessPreferences(next)
    } catch (saveError) {
      setError(messageFor(saveError))
    } finally {
      setBusy(null)
    }
  }

  async function check(target: RemoteAccessTarget) {
    if (busy) return
    setBusy(target)
    setError(null)
    try {
      await queueRemoteCommand({
        target,
        kind: 'status.check',
        origin: 'desktop',
      })
    } catch (queueError) {
      setError(messageFor(queueError))
    } finally {
      setBusy(null)
    }
  }

  const onlineExecutors = state.executors.filter((executor) =>
    isRemoteExecutorOnline(executor)
  )
  const remoteEnabled = state.preferences.enabled

  return (
    <div className="remote-settings">
      <div className="settings-card remote-settings__primary">
        <div>
          <span className="remote-settings__eyebrow">Private preview</span>
          <h3>Access this setup from your iPhone</h3>
          <p>
            Send approved requests to your Mac mini or data center through the
            StatsKey apps. Private keys, passwords, and host addresses never
            sync.
          </p>
        </div>
        <label className="remote-settings__switch">
          <input
            type="checkbox"
            checked={remoteEnabled}
            disabled={busy != null}
            onChange={(event) =>
              void update({
                enabled: event.target.checked,
                onboardingChoice: event.target.checked ? 'enabled' : 'notNow',
              })
            }
          />
          <span>{remoteEnabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      {remoteEnabled && (
        <>
          <div className="settings-card remote-settings__permissions">
            <h3>Allowed from your signed-in devices</h3>
            <RemoteToggle
              title="Mac mini"
              detail="Status checks and read-only AI guidance"
              checked={state.preferences.allowMacMini}
              disabled={busy != null}
              onChange={(checked) => void update({ allowMacMini: checked })}
            />
            <RemoteToggle
              title="Data center"
              detail="Status checks and read-only Intelligence prompts"
              checked={state.preferences.allowDataCenter}
              disabled={busy != null}
              onChange={(checked) => void update({ allowDataCenter: checked })}
            />
            <RemoteToggle
              title="Confirm each request"
              detail="Always require a final Send confirmation on the requesting device"
              checked
              disabled
              onChange={() => undefined}
            />
          </div>

          <div className="settings-card">
            <div className="remote-settings__status">
              <span
                className={
                  onlineExecutors.length > 0
                    ? 'remote-settings__dot online'
                    : 'remote-settings__dot'
                }
                aria-hidden="true"
              />
              <div>
                <b>
                  {onlineExecutors.length > 0
                    ? 'This Desktop is available'
                    : 'Waiting for StatsKey Desktop'}
                </b>
                <small>
                  {onlineExecutors.length > 0
                    ? 'Your iPhone can hand requests to this private executor.'
                    : 'Leave your unified StatsKey Desktop app open and signed in.'}
                </small>
              </div>
            </div>
            <div className="settings-card__actions">
              {state.preferences.allowMacMini && (
                <button
                  className="settings-card__button"
                  disabled={busy != null}
                  onClick={() => void check('mac-mini')}
                >
                  {busy === 'mac-mini' ? 'Queuing…' : 'Check Mac mini'}
                </button>
              )}
              {state.preferences.allowDataCenter && (
                <button
                  className="settings-card__button"
                  disabled={busy != null}
                  onClick={() => void check('data-center')}
                >
                  {busy === 'data-center'
                    ? 'Queuing…'
                    : 'Check data center'}
                </button>
              )}
            </div>
          </div>

          <RemoteCommandHistory commands={state.commands} />
        </>
      )}

      {error && (
        <p className="remote-settings__error" role="alert">
          {error}
        </p>
      )}
      {state.error && (
        <p className="remote-settings__error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  )
}

export function RemoteAccessOnboardingPrompt() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const bridge = getDesktopBridge()
  const state = useRemoteAccessState(
    bridge?.founderMode === true ? user?.uid : undefined,
    false
  )
  const [saving, setSaving] = useState(false)

  if (
    !user ||
    bridge?.founderMode !== true ||
    state.preferences.onboardingChoice !== 'unset'
  ) {
    return null
  }

  async function choose(enabled: boolean) {
    if (saving) return
    setSaving(true)
    try {
      await saveRemoteAccessPreferences({
        enabled,
        allowMacMini: enabled,
        allowDataCenter: enabled,
        requireConfirmation: true,
        onboardingChoice: enabled ? 'enabled' : 'notNow',
      })
    } catch {
      // The synchronized preference remains unset, so the prompt can be
      // retried after connectivity returns.
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="remote-onboarding" aria-label="Remote Access setup">
      <button
        className="remote-onboarding__close"
        aria-label="Not now"
        disabled={saving}
        onClick={() => void choose(false)}
      >
        ×
      </button>
      <span className="remote-settings__eyebrow">Optional</span>
      <b>Use this Desktop from your iPhone?</b>
      <p>
        Send private Mac mini and data-center requests while you’re away.
      </p>
      <div>
        <button disabled={saving} onClick={() => void choose(true)}>
          Yes
        </button>
        <button
          disabled={saving}
          onClick={() => navigate('/settings/remote')}
        >
          Customize
        </button>
      </div>
    </aside>
  )
}

function RemoteToggle({
  title,
  detail,
  checked,
  disabled,
  onChange,
}: {
  title: string
  detail: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="remote-settings__permission">
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function RemoteCommandHistory({ commands }: { commands: RemoteCommand[] }) {
  if (commands.length === 0) return null
  return (
    <div className="settings-card remote-settings__history">
      <h3>Recent requests</h3>
      {commands.slice(0, 8).map((command) => (
        <article key={command.id}>
          <span data-status={command.status}>{command.status}</span>
          <div>
            <b>{command.summary}</b>
            {command.result?.summary && <p>{command.result.summary}</p>}
          </div>
        </article>
      ))}
    </div>
  )
}

function useRemoteAccessState(
  uid: string | undefined,
  includeHistory = true
): {
  preferences: RemoteAccessPreferences
  commands: RemoteCommand[]
  executors: RemoteExecutor[]
  error: string | null
} {
  const [preferences, setPreferences] = useState(
    DEFAULT_REMOTE_ACCESS_PREFERENCES
  )
  const [commands, setCommands] = useState<RemoteCommand[]>([])
  const [executors, setExecutors] = useState<RemoteExecutor[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setPreferences(DEFAULT_REMOTE_ACCESS_PREFERENCES)
      setCommands([])
      setExecutors([])
      setError(null)
      return
    }
    const onError = (subscriptionError: Error) =>
      setError(subscriptionError.message)
    const stops = [
      subscribeRemoteAccessPreferences(uid, setPreferences, onError),
      subscribeRemoteExecutors(uid, setExecutors, onError),
      ...(includeHistory
        ? [subscribeRemoteCommands(uid, setCommands, onError)]
        : []),
    ]
    return () => stops.forEach((stop) => stop())
  }, [includeHistory, uid])

  return useMemo(
    () => ({ preferences, commands, executors, error }),
    [commands, error, executors, preferences]
  )
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Remote Access could not save.'
}
