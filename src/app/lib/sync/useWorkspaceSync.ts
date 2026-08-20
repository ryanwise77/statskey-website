// Module-level stores connecting the headless WorkspaceSyncCoordinator (which
// owns the live-sync engines) to any UI that renders sync state. Statuses and
// the action registry live outside React so settings surfaces can reach them
// without prop plumbing; a window CustomEvent drives re-renders.

import { useEffect, useState } from 'react'
import { getDesktopBridge } from '../desktop'
import type {
  DesktopSyncLinkState,
  LiveSyncStatus,
  TransferContainer,
} from './types'

export const WORKSPACE_SYNC_STATUS_EVENT = 'statskey:workspace-sync-status'

export interface WorkspaceSyncActions {
  enableLiveSync(name: string, rootPaths: string[]): Promise<void>
  pauseLiveSync(syncId: string): Promise<void>
  resumeLiveSync(syncId: string): Promise<void>
  unlinkDevice(syncId: string): Promise<void>
  deleteLiveSync(syncId: string): Promise<void>
  downloadLiveSync(syncId: string, destBase: string | null): Promise<void>
  confirmGuardedDeletes(syncId: string): Promise<void>
  dismissGuardedDeletes(syncId: string): Promise<void>
}

// Live-sync link states are ws_-prefixed; bk_/tr_ states are temporary
// one-shot scan/apply authorizations (backups, transfers) that must never
// drive live-sync UI — a crashed backup would otherwise render a phantom
// "Live sync on" toggle forever.
export function isLiveSyncLinkState(
  state: Pick<DesktopSyncLinkState, 'syncId'>
): boolean {
  return state.syncId.startsWith('ws_')
}

// Engines may only boot link states created by the signed-in account; a state
// with no recorded owner is treated as another account's (never bootable), so
// signing in with a second account can never upload the workspace into it.
export function isBootableLinkState(
  state: Pick<DesktopSyncLinkState, 'syncId' | 'ownerUid'>,
  uid: string
): boolean {
  return isLiveSyncLinkState(state) && state.ownerUid === uid
}

// Placeholder status published the moment an engine is registered so settings
// surfaces see the link before the engine's first real status. A link whose
// persisted paused flag survived a restart must surface as Paused, never as a
// synthetic "starting" state that implies syncing is about to happen.
export function initialEngineStatus(
  state: Pick<DesktopSyncLinkState, 'syncId' | 'paused'>
): LiveSyncStatus {
  return {
    syncId: state.syncId,
    state: state.paused ? 'paused' : 'starting',
    pendingUploads: 0,
    pendingApplies: 0,
    lastSyncedAt: null,
    skippedCount: 0,
    error: null,
    guard: null,
    guardedDeleteCount: 0,
    detached: false,
  }
}

// Paused resolution order: a live engine status is authoritative; otherwise
// the persisted link-state flag (pause survives restarts); otherwise the
// cloud container status.
export function resolveLinkPaused(
  status: Pick<LiveSyncStatus, 'state'> | undefined,
  linked: Pick<DesktopSyncLinkState, 'paused'> | undefined,
  containerPaused: boolean
): boolean {
  if (status) return status.state === 'paused'
  if (linked?.paused != null) return linked.paused
  return containerPaused
}

export function guardBannerText(
  status: Pick<LiveSyncStatus, 'guardedDeleteCount'>
): string {
  const count = status.guardedDeleteCount
  if (count <= 0) return 'Sync wants to delete files on this device.'
  return `Sync wants to delete ${count} ${
    count === 1 ? 'file' : 'files'
  } on this device.`
}

// A transfer belongs in this device's inbox only while it is genuinely
// receivable here: ready, addressed to this device (or any), sent by another
// device, unexpired, and not already claimed by a DIFFERENT device — a claim
// by this device keeps the row visible while its own receive runs.
export function isReceivableTransfer(
  row: TransferContainer,
  deviceId: string,
  now: Date
): boolean {
  return (
    row.status === 'ready' &&
    (row.targetDeviceId === null || row.targetDeviceId === deviceId) &&
    row.device.id !== deviceId &&
    (row.claimedBy === null || row.claimedBy.id === deviceId) &&
    row.expiresAt.getTime() > now.getTime()
  )
}

// transferBackup's receive flow throws when another device already holds the
// transfer claim; that race is expected, so it gets a kind info toast rather
// than an error one.
export function isTransferClaimedError(error: unknown): boolean {
  return error instanceof Error && /claim/i.test(error.message)
}

// True when the absolute path sits at or under any of the given root paths.
// Used to drop sync mutation announcements for workspaces that are not open,
// so background engines cannot churn the open workspace's tree and search.
export function isPathUnderAnyRoot(path: string, roots: string[]): boolean {
  for (const root of roots) {
    const trimmed = root.replace(/[\\/]+$/, '')
    if (trimmed === '') continue
    if (
      path === trimmed ||
      path.startsWith(`${trimmed}/`) ||
      path.startsWith(`${trimmed}\\`)
    ) {
      return true
    }
  }
  return false
}

const statuses = new Map<string, LiveSyncStatus>()
let registeredActions: WorkspaceSyncActions | null = null

function snapshotStatuses(): LiveSyncStatus[] {
  return [...statuses.values()].sort((a, b) =>
    a.syncId < b.syncId ? -1 : a.syncId > b.syncId ? 1 : 0
  )
}

function dispatchStatusEvent(detail: LiveSyncStatus | null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<LiveSyncStatus | null>(WORKSPACE_SYNC_STATUS_EVENT, {
      detail,
    })
  )
}

export function registerWorkspaceSyncActions(
  actions: WorkspaceSyncActions | null
): void {
  registeredActions = actions
}

export function getWorkspaceSyncActions(): WorkspaceSyncActions | null {
  return registeredActions
}

export function publishSyncStatus(status: LiveSyncStatus): void {
  statuses.set(status.syncId, status)
  dispatchStatusEvent(status)
}

export function removeSyncStatus(syncId: string): void {
  statuses.delete(syncId)
  // Dispatch even when nothing was stored: the coordinator calls this after
  // bridge link-state changes so useLinkedSyncStates re-lists either way.
  dispatchStatusEvent(null)
}

export function useWorkspaceSyncStatuses(): LiveSyncStatus[] {
  const [rows, setRows] = useState<LiveSyncStatus[]>(snapshotStatuses)

  useEffect(() => {
    const refresh = () => setRows(snapshotStatuses())
    refresh()
    window.addEventListener(WORKSPACE_SYNC_STATUS_EVENT, refresh)
    return () => {
      window.removeEventListener(WORKSPACE_SYNC_STATUS_EVENT, refresh)
    }
  }, [])

  return rows
}

// Linked link-states double as "which live syncs exist on this device"; the
// coordinator dispatches WORKSPACE_SYNC_STATUS_EVENT after every link change,
// so re-listing on that event keeps this fresh without a bridge subscription.
export function useLinkedSyncStates(): DesktopSyncLinkState[] {
  const [states, setStates] = useState<DesktopSyncLinkState[]>([])

  useEffect(() => {
    const sync = getDesktopBridge()?.workspaceSync
    if (!sync) return
    let active = true
    const load = () => {
      sync
        .listStates()
        .then((rows) => {
          if (active) setStates(rows)
        })
        .catch(() => {})
    }
    load()
    window.addEventListener(WORKSPACE_SYNC_STATUS_EVENT, load)
    return () => {
      active = false
      window.removeEventListener(WORKSPACE_SYNC_STATUS_EVENT, load)
    }
  }, [])

  return states
}

export const _workspaceSyncStoreForTests = {
  readStatuses: snapshotStatuses,
  reset: () => {
    statuses.clear()
    registeredActions = null
  },
}
