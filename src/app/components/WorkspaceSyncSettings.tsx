// Body of the /settings/sync section. Reads everything from hooks and the
// desktop bridge itself so the integrator mounts it as a bare
// <WorkspaceSyncSettings />. Web builds (no bridge) get an explainer card
// pointing at the GitHub cloud workspace instead.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  getDesktopBridge,
  type DesktopWorkspaceState,
  type StatsKeyDesktopBridge,
} from '../lib/desktop'
import {
  choiceDialog,
  confirmDialog,
  promptDialog,
  showToast,
  type DialogAction,
} from '../lib/ui/dialogs'
import { formatRelative } from '../lib/format'
import { createSnapshotStore } from '../lib/sync/snapshotStore'
import {
  getSyncDeviceId,
  getSyncDeviceLabel,
  setSyncDeviceLabel,
} from '../lib/sync/deviceIdentity'
import { canUseLiveSync } from '../lib/sync/entitlements'
import {
  createBackup,
  receiveTransfer,
  restoreBackup,
  sendWorkspace,
} from '../lib/sync/transferBackup'
import {
  getWorkspaceSyncActions,
  isTransferClaimedError,
  useLinkedSyncStates,
  useWorkspaceSyncStatuses,
} from '../lib/sync/useWorkspaceSync'
import type {
  BackupContainer,
  DesktopSyncLinkState,
  DesktopWorkspaceSyncBridge,
  LiveSyncContainer,
  LiveSyncStatus,
  SnapshotStore,
  SyncDeviceDoc,
  SyncDeviceRef,
  SyncProgress,
  TransferContainer,
} from '../lib/sync/types'
import './WorkspaceSyncSettings.css'

const DEVICE_ONLINE_WINDOW_MS = 10 * 60_000

export function WorkspaceSyncSettings() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const bridge = getDesktopBridge()
  const sync = bridge?.workspaceSync

  if (!bridge || !sync) {
    return (
      <div className="sync-settings">
        <div className="settings-card">
          <b>Sync &amp; Backup lives in the desktop app</b>
          <p>
            Send a workspace straight to another of your computers, keep
            one-time backups, or live-sync folders in real time — all through
            your private StatsKey cloud storage. Install StatsKey Desktop on
            each device to use it.
          </p>
          <p>
            On the web, the repo-based option is your GitHub cloud workspace.
          </p>
          <div className="settings-card__actions">
            <button
              className="settings-card__button settings-card__button--primary"
              onClick={() => navigate('/github')}
            >
              Open GitHub workspace
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="sync-settings">
        <div className="settings-card">
          <b>Sign in to sync and back up workspaces</b>
          <p>
            Workspace files move through your own StatsKey account, so both
            devices sign in once and everything stays owner-only.
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
      </div>
    )
  }

  return <DesktopSyncSettings bridge={bridge} sync={sync} uid={user.uid} />
}

function DesktopSyncSettings({
  bridge,
  sync,
  uid,
}: {
  bridge: StatsKeyDesktopBridge
  sync: DesktopWorkspaceSyncBridge
  uid: string
}) {
  const navigate = useNavigate()
  const store = useMemo(() => createSnapshotStore(uid), [uid])
  const deviceId = useMemo(() => getSyncDeviceId(), [])
  const bridgeLabelRef = useRef<string | null>(null)
  const [label, setLabel] = useState(() => getSyncDeviceLabel(null))
  const [devices, setDevices] = useState<SyncDeviceDoc[]>([])
  const [liveRows, setLiveRows] = useState<LiveSyncContainer[]>([])
  const [backups, setBackups] = useState<BackupContainer[]>([])
  const [transfers, setTransfers] = useState<TransferContainer[]>([])
  const [workspace, setWorkspace] = useState<DesktopWorkspaceState | null>(
    null
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const linkedStates = useLinkedSyncStates()
  const statuses = useWorkspaceSyncStatuses()

  useEffect(() => {
    const stops = [
      store.subscribeDevices(setDevices),
      store.subscribeLiveSyncContainers(setLiveRows),
      store.subscribeBackups(setBackups),
      store.subscribeTransfers(setTransfers),
    ]
    return () => stops.forEach((stop) => stop())
  }, [store])

  useEffect(() => {
    let active = true
    bridge.workspace
      .getState()
      .then((state) => {
        if (active) setWorkspace(state)
      })
      .catch(() => {})
    const unsubscribe = bridge.workspace.onState((state) => {
      if (active) setWorkspace(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge])

  useEffect(() => {
    let active = true
    sync
      .deviceInfo()
      .then((info) => {
        if (!active) return
        bridgeLabelRef.current = info.label || null
        setLabel(getSyncDeviceLabel(bridgeLabelRef.current))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [sync])

  const device: SyncDeviceRef = { id: deviceId, label }
  const rootPaths = workspace?.roots.map((root) => root.path) ?? []
  const workspaceName =
    workspace?.importedWorkspace?.name ||
    workspace?.roots[0]?.name ||
    'Current workspace'
  const hasLooseFiles = (workspace?.looseFiles.length ?? 0) > 0
  const linkedForCurrent = linkedStates.find((state) =>
    sameRootSet(
      state.rootMappings.map((mapping) => mapping.path),
      rootPaths
    )
  )
  const incomingTransfers = transfers.filter(
    (row) =>
      row.status === 'ready' &&
      (row.targetDeviceId === null || row.targetDeviceId === deviceId) &&
      row.device.id !== deviceId
  )

  async function run(
    key: string,
    work: () => Promise<void>,
    failureMessage: string
  ) {
    if (busy) return
    setBusy(key)
    setProgress(null)
    try {
      await work()
    } catch (error) {
      showToast(messageFor(error, failureMessage), { kind: 'error' })
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function editDeviceLabel() {
    const next = await promptDialog({
      title: 'Name this device',
      body: 'The name other devices see when this one sends, backs up, or syncs a workspace.',
      label: 'Device name',
      initialValue: label,
      maxLength: 80,
    })
    if (next == null || next === '' || next === label) return
    setSyncDeviceLabel(next)
    const resolved = getSyncDeviceLabel(bridgeLabelRef.current)
    setLabel(resolved)
    void store
      .upsertDevice({
        id: deviceId,
        label: resolved,
        platform: bridge.platform,
        appVersion: bridge.electronVersion,
      })
      .catch(() => {})
  }

  async function sendToDevice() {
    if (rootPaths.length === 0) return
    const targets = devices.filter((row) => row.id !== deviceId)
    const actions: DialogAction[] = [
      ...targets.map((row) => ({
        id: `dev:${row.id}`,
        label: deviceOnline(row) ? row.label : `${row.label} (offline)`,
      })),
      { id: 'any', label: 'Any device', kind: 'primary' as const },
      { id: 'cancel', label: 'Cancel', kind: 'cancel' as const },
    ]
    const choice = await choiceDialog({
      title: `Send '${workspaceName}' to…`,
      body: 'The workspace is staged in your private cloud and offered to the device you pick.',
      actions,
    })
    if (!choice || choice === 'cancel') return
    const targetDeviceId = choice === 'any' ? null : choice.slice(4)
    await run(
      'send',
      async () => {
        await sendWorkspace({
          store,
          bridge: sync,
          device,
          name: workspaceName,
          rootPaths,
          targetDeviceId,
          onProgress: setProgress,
        })
        showToast(
          `Sent '${workspaceName}' — it shows up on the receiving device right away.`,
          { kind: 'success' }
        )
      },
      'The workspace could not be sent.'
    )
  }

  async function backUpNow() {
    if (rootPaths.length === 0) return
    await run(
      'backup',
      async () => {
        await createBackup({
          store,
          bridge: sync,
          device,
          name: workspaceName,
          rootPaths,
          onProgress: setProgress,
        })
        showToast(`Backed up '${workspaceName}' to your cloud.`, {
          kind: 'success',
        })
      },
      'The backup did not finish.'
    )
  }

  async function toggleLiveSync() {
    if (busy) return
    const actions = getWorkspaceSyncActions()
    if (!actions) {
      showToast('Sync is still starting — try again in a moment.', {
        kind: 'info',
      })
      return
    }
    if (linkedForCurrent) {
      const confirmed = await confirmDialog({
        title: 'Turn off live sync on this device?',
        body: 'This device stops syncing. Your files here and the cloud copy both stay, and other linked devices keep syncing.',
        confirmLabel: 'Turn off',
      })
      if (!confirmed) return
      await run(
        'live',
        () => actions.unlinkDevice(linkedForCurrent.syncId),
        'Live sync could not be turned off.'
      )
      return
    }
    const gate = canUseLiveSync()
    if (!gate.allowed) {
      showToast(gate.reason || 'Live sync is not available right now.', {
        kind: 'info',
      })
      return
    }
    await run(
      'live',
      async () => {
        await actions.enableLiveSync(workspaceName, rootPaths)
        showToast(`Live sync is on for '${workspaceName}'.`, {
          kind: 'success',
        })
      },
      'Live sync could not be enabled.'
    )
  }

  return (
    <div className="sync-settings">
      <div className="settings-card">
        <div className="sync-settings__row-head">
          <div>
            <h3>This device</h3>
            <p>
              Signed-in devices appear here for everyone sharing your account —
              which is just you.
            </p>
          </div>
        </div>
        <div className="sync-settings__device">
          <span className="sync-settings__dot online" aria-hidden="true" />
          <div>
            <b>{label}</b>
            <small>{platformName(bridge.platform)}</small>
          </div>
          <span className="sync-settings__tag">This device</span>
          <button
            className="settings-card__button"
            disabled={busy != null}
            onClick={() => void editDeviceLabel()}
          >
            Edit
          </button>
        </div>
        {devices
          .filter((row) => row.id !== deviceId)
          .map((row) => (
            <div key={row.id} className="sync-settings__device">
              <span
                className={
                  deviceOnline(row)
                    ? 'sync-settings__dot online'
                    : 'sync-settings__dot'
                }
                aria-hidden="true"
              />
              <div>
                <b>{row.label}</b>
                <small>
                  {platformName(row.platform)}
                  {row.lastSeenAt
                    ? ` · seen ${formatRelative(row.lastSeenAt)}`
                    : ''}
                </small>
              </div>
            </div>
          ))}
      </div>

      <div className="settings-card">
        <div className="sync-settings__row-head">
          <div>
            <h3>Current workspace</h3>
            <p>
              {rootPaths.length > 0
                ? workspaceName
                : 'Open a project folder to send, back up, or live-sync it.'}
            </p>
          </div>
        </div>
        {rootPaths.length > 0 && (
          <ul className="sync-settings__roots">
            {workspace?.roots.map((root) => (
              <li key={root.path} title={root.path}>
                {root.name}
              </li>
            ))}
          </ul>
        )}
        {hasLooseFiles && (
          <p className="sync-settings__note">
            Loose files are not synced — only folders.
          </p>
        )}
        <label className="sync-settings__toggle">
          <span>
            <b>Live sync</b>
            <small>
              Keeps this workspace in sync on every linked device in real time
            </small>
          </span>
          <input
            type="checkbox"
            checked={linkedForCurrent != null}
            disabled={busy != null || rootPaths.length === 0}
            onChange={() => void toggleLiveSync()}
          />
        </label>
        <div className="settings-card__actions">
          <button
            className="settings-card__button"
            disabled={busy != null || rootPaths.length === 0}
            onClick={() => void sendToDevice()}
          >
            {busy === 'send' ? 'Sending…' : 'Send to a device…'}
          </button>
          <button
            className="settings-card__button"
            disabled={busy != null || rootPaths.length === 0}
            onClick={() => void backUpNow()}
          >
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </button>
          <button
            className="settings-card__button"
            onClick={() => navigate('/github')}
          >
            GitHub workspace →
          </button>
        </div>
        {(busy === 'send' || busy === 'backup') && (
          <ProgressNote
            label={busy === 'send' ? 'Uploading' : 'Backing up'}
            progress={progress}
          />
        )}
      </div>

      <div className="settings-card">
        <div className="sync-settings__row-head">
          <div>
            <h3>Live-synced workspaces</h3>
            <p>
              Every workspace kept in sync through your cloud, on this device
              or others.
            </p>
          </div>
        </div>
        {liveRows.length === 0 && (
          <p className="sync-settings__note">No live-synced workspaces yet.</p>
        )}
        {liveRows.map((row) => (
          <LiveSyncRow
            key={row.id}
            row={row}
            linked={linkedStates.find((state) => state.syncId === row.id)}
            status={statuses.find((status) => status.syncId === row.id)}
            busy={busy}
            setBusy={setBusy}
            sync={sync}
          />
        ))}
      </div>

      <div className="settings-card">
        <div className="sync-settings__row-head">
          <div>
            <h3>Backups</h3>
            <p>One-time snapshots you can restore to any device.</p>
          </div>
        </div>
        {backups.length === 0 && (
          <p className="sync-settings__note">
            No backups yet — use “Back up now” above.
          </p>
        )}
        {backups.map((row) => (
          <BackupRow
            key={row.id}
            row={row}
            store={store}
            sync={sync}
            device={device}
            busy={busy}
            setBusy={setBusy}
          />
        ))}
      </div>

      {incomingTransfers.length > 0 && (
        <div className="settings-card">
          <div className="sync-settings__row-head">
            <div>
              <h3>Incoming transfers</h3>
              <p>Workspaces another of your devices sent here.</p>
            </div>
          </div>
          {incomingTransfers.map((row) => (
            <TransferRow
              key={row.id}
              row={row}
              store={store}
              sync={sync}
              device={device}
              busy={busy}
              setBusy={setBusy}
            />
          ))}
        </div>
      )}

      <p className="sync-settings__footer">
        Files sync through your private StatsKey cloud storage. Build folders,
        node_modules, .git, and files over 25 MB are skipped.
      </p>
    </div>
  )
}

function LiveSyncRow({
  row,
  linked,
  status,
  busy,
  setBusy,
  sync,
}: {
  row: LiveSyncContainer
  linked: DesktopSyncLinkState | undefined
  status: LiveSyncStatus | undefined
  busy: string | null
  setBusy: (value: string | null) => void
  sync: DesktopWorkspaceSyncBridge
}) {
  const pill = statusPill(row, linked, status)
  const paused =
    status?.state === 'paused' || (!status && row.status === 'paused')

  async function act(
    key: string,
    work: () => Promise<void>,
    failureMessage: string
  ) {
    if (busy) return
    const actions = getWorkspaceSyncActions()
    if (!actions) {
      showToast('Sync is still starting — try again in a moment.', {
        kind: 'info',
      })
      return
    }
    setBusy(key)
    try {
      await work()
    } catch (error) {
      showToast(messageFor(error, failureMessage), { kind: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    const destination = await chooseDestination(sync)
    if (!destination) return
    await act(
      `download:${row.id}`,
      () =>
        getWorkspaceSyncActions()!.downloadLiveSync(
          row.id,
          destination.destBase
        ),
      'The workspace could not be downloaded.'
    )
  }

  async function removeFromDevice() {
    const confirmed = await confirmDialog({
      title: `Remove '${row.name}' from this device?`,
      body: 'Files already on this device stay where they are, and the cloud copy keeps syncing for your other devices.',
      confirmLabel: 'Remove',
    })
    if (!confirmed) return
    await act(
      `unlink:${row.id}`,
      () => getWorkspaceSyncActions()!.unlinkDevice(row.id),
      'The workspace could not be removed from this device.'
    )
  }

  async function deleteFromCloud() {
    const confirmed = await confirmDialog({
      title: `Delete '${row.name}' from your cloud?`,
      body: 'The cloud copy is permanently removed and every device stops syncing it. Files already on your devices stay.',
      confirmLabel: 'Delete from cloud',
      destructive: true,
    })
    if (!confirmed) return
    await act(
      `delete:${row.id}`,
      () => getWorkspaceSyncActions()!.deleteLiveSync(row.id),
      'The cloud copy could not be deleted.'
    )
  }

  return (
    <div className="sync-settings__workspace">
      <div className="sync-settings__workspace-main">
        <div>
          <b>{row.name}</b>
          <small>
            {row.roots.map((root) => root.name).join(', ')} ·{' '}
            {row.fileCount} files · {formatSyncBytes(row.totalBytes)}
          </small>
        </div>
        <span className="sync-settings__pill" data-tone={pill.tone}>
          {pill.text}
        </span>
      </div>
      {status?.guard === 'mass-delete' && (
        <div className="sync-settings__guard" role="alert">
          <span>
            {status.pendingApplies > 0
              ? `Sync wants to delete ${status.pendingApplies} files on this device.`
              : 'Sync wants to delete files on this device.'}
          </span>
          <div>
            <button
              disabled={busy != null}
              onClick={() =>
                void act(
                  `guard:${row.id}`,
                  () => getWorkspaceSyncActions()!.confirmGuardedDeletes(row.id),
                  'The deletions could not be confirmed.'
                )
              }
            >
              Confirm
            </button>
            <button
              disabled={busy != null}
              onClick={() =>
                void act(
                  `guard:${row.id}`,
                  () => getWorkspaceSyncActions()!.dismissGuardedDeletes(row.id),
                  'The files could not be kept.'
                )
              }
            >
              Keep my files
            </button>
          </div>
        </div>
      )}
      <div className="settings-card__actions">
        {linked ? (
          <>
            <button
              className="settings-card__button"
              disabled={busy != null}
              onClick={() =>
                void act(
                  `pause:${row.id}`,
                  () =>
                    paused
                      ? getWorkspaceSyncActions()!.resumeLiveSync(row.id)
                      : getWorkspaceSyncActions()!.pauseLiveSync(row.id),
                  paused
                    ? 'Sync could not resume.'
                    : 'Sync could not be paused.'
                )
              }
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="settings-card__button"
              disabled={busy != null}
              onClick={() => void removeFromDevice()}
            >
              Remove from this device
            </button>
          </>
        ) : (
          <button
            className="settings-card__button"
            disabled={busy != null}
            onClick={() => void download()}
          >
            {busy === `download:${row.id}`
              ? 'Downloading…'
              : 'Download to this device…'}
          </button>
        )}
        <button
          className="settings-card__button sync-settings__danger"
          disabled={busy != null}
          onClick={() => void deleteFromCloud()}
        >
          Delete from cloud
        </button>
      </div>
      {busy === `download:${row.id}` && (
        <p className="sync-settings__progress" role="status">
          Creating folders and starting the first sync — files stream in over
          the next moments.
        </p>
      )}
    </div>
  )
}

function BackupRow({
  row,
  store,
  sync,
  device,
  busy,
  setBusy,
}: {
  row: BackupContainer
  store: SnapshotStore
  sync: DesktopWorkspaceSyncBridge
  device: SyncDeviceRef
  busy: string | null
  setBusy: (value: string | null) => void
}) {
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  async function restore() {
    if (busy) return
    const destination = await chooseDestination(sync)
    if (!destination) return
    setBusy(`restore:${row.id}`)
    setProgress(null)
    try {
      const result = await restoreBackup({
        store,
        bridge: sync,
        device,
        backup: row,
        destBase: destination.destBase,
        onProgress: setProgress,
      })
      showToast(`Restored '${row.name}' to ${result.rootPaths.join(', ')}`, {
        kind: 'success',
      })
    } catch (error) {
      showToast(messageFor(error, 'The backup could not be restored.'), {
        kind: 'error',
      })
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function remove() {
    if (busy) return
    const confirmed = await confirmDialog({
      title: `Delete the backup of '${row.name}'?`,
      body: 'The snapshot is permanently removed from your cloud.',
      confirmLabel: 'Delete backup',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(`delete-backup:${row.id}`)
    try {
      await store.deleteContainer('backup', row.id)
    } catch (error) {
      showToast(messageFor(error, 'The backup could not be deleted.'), {
        kind: 'error',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sync-settings__workspace">
      <div className="sync-settings__workspace-main">
        <div>
          <b>{row.name}</b>
          <small>
            {row.device.label} · {formatRelative(row.createdAt)} ·{' '}
            {row.fileCount} files · {formatSyncBytes(row.totalBytes)}
          </small>
        </div>
        {row.status === 'uploading' && (
          <span className="sync-settings__pill" data-tone="busy">
            Uploading…
          </span>
        )}
      </div>
      <div className="settings-card__actions">
        <button
          className="settings-card__button"
          disabled={busy != null || row.status !== 'complete'}
          onClick={() => void restore()}
        >
          {busy === `restore:${row.id}` ? 'Restoring…' : 'Restore…'}
        </button>
        <button
          className="settings-card__button sync-settings__danger"
          disabled={busy != null}
          onClick={() => void remove()}
        >
          Delete
        </button>
      </div>
      {busy === `restore:${row.id}` && (
        <ProgressNote label="Restoring" progress={progress} />
      )}
    </div>
  )
}

function TransferRow({
  row,
  store,
  sync,
  device,
  busy,
  setBusy,
}: {
  row: TransferContainer
  store: SnapshotStore
  sync: DesktopWorkspaceSyncBridge
  device: SyncDeviceRef
  busy: string | null
  setBusy: (value: string | null) => void
}) {
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  async function receive() {
    if (busy) return
    const destination = await chooseDestination(sync)
    if (!destination) return
    setBusy(`receive:${row.id}`)
    setProgress(null)
    try {
      const result = await receiveTransfer({
        store,
        bridge: sync,
        device,
        transfer: row,
        destBase: destination.destBase,
        onProgress: setProgress,
      })
      showToast(`Received '${row.name}' to ${result.rootPaths.join(', ')}`, {
        kind: 'success',
      })
    } catch (error) {
      showToast(messageFor(error, 'The transfer could not be received.'), {
        kind: isTransferClaimedError(error) ? 'info' : 'error',
      })
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function dismiss() {
    if (busy) return
    const confirmed = await confirmDialog({
      title: `Dismiss '${row.name}'?`,
      body: 'The staged copy is removed from your cloud without being downloaded here.',
      confirmLabel: 'Dismiss',
    })
    if (!confirmed) return
    setBusy(`dismiss:${row.id}`)
    try {
      await store.deleteContainer('transfer', row.id)
    } catch (error) {
      showToast(messageFor(error, 'The transfer could not be dismissed.'), {
        kind: 'error',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sync-settings__workspace">
      <div className="sync-settings__workspace-main">
        <div>
          <b>{row.name}</b>
          <small>
            From {row.device.label} · {formatRelative(row.createdAt)} ·{' '}
            {row.fileCount} files · {formatSyncBytes(row.totalBytes)}
          </small>
        </div>
      </div>
      <div className="settings-card__actions">
        <button
          className="settings-card__button settings-card__button--primary"
          disabled={busy != null}
          onClick={() => void receive()}
        >
          {busy === `receive:${row.id}` ? 'Receiving…' : 'Receive…'}
        </button>
        <button
          className="settings-card__button"
          disabled={busy != null}
          onClick={() => void dismiss()}
        >
          Dismiss
        </button>
      </div>
      {busy === `receive:${row.id}` && (
        <ProgressNote label="Downloading" progress={progress} />
      )}
    </div>
  )
}

function ProgressNote({
  label,
  progress,
}: {
  label: string
  progress: SyncProgress | null
}) {
  if (!progress) {
    return (
      <p className="sync-settings__progress" role="status">
        {label}…
      </p>
    )
  }
  return (
    <p className="sync-settings__progress" role="status">
      {label} {Math.min(progress.done, progress.total)}/{progress.total}
      {progress.currentPath ? ` · ${progress.currentPath}` : ''}
    </p>
  )
}

async function chooseDestination(
  sync: DesktopWorkspaceSyncBridge
): Promise<{ destBase: string | null } | null> {
  const choice = await choiceDialog({
    title: 'Where should the folders go?',
    body: 'Each workspace root becomes a folder in the destination you pick.',
    actions: [
      {
        id: 'default',
        label: 'Default folder (~/StatsKey Synced)',
        kind: 'primary',
      },
      { id: 'choose', label: 'Choose folder…' },
      { id: 'cancel', label: 'Cancel', kind: 'cancel' },
    ],
  })
  if (choice === 'default') return { destBase: null }
  if (choice === 'choose') {
    const picked = await sync.chooseFolder()
    return picked ? { destBase: picked } : null
  }
  return null
}

function statusPill(
  row: LiveSyncContainer,
  linked: DesktopSyncLinkState | undefined,
  status: LiveSyncStatus | undefined
): { text: string; tone: 'ok' | 'busy' | 'muted' | 'warn' | 'error' } {
  if (!linked) return { text: 'Not on this device', tone: 'muted' }
  if (status) {
    switch (status.state) {
      case 'idle':
        return { text: 'Synced ✓', tone: 'ok' }
      case 'starting':
        return { text: 'Syncing…', tone: 'busy' }
      case 'syncing':
        return {
          text: `Syncing ${status.pendingUploads + status.pendingApplies}`,
          tone: 'busy',
        }
      case 'paused':
        return { text: 'Paused', tone: 'muted' }
      case 'offline':
        return { text: 'Offline', tone: 'muted' }
      case 'attention':
        return { text: 'Attention', tone: 'warn' }
      case 'error':
        return { text: status.error || 'Error', tone: 'error' }
    }
  }
  return row.status === 'paused'
    ? { text: 'Paused', tone: 'muted' }
    : { text: 'Starting…', tone: 'busy' }
}

function deviceOnline(row: SyncDeviceDoc): boolean {
  return (
    row.lastSeenAt != null &&
    Date.now() - row.lastSeenAt.getTime() < DEVICE_ONLINE_WINDOW_MS
  )
}

function sameRootSet(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

function platformName(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

function formatSyncBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
