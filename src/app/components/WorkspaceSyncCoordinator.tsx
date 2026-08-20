// Headless controller for Workspace Sync & Backup. Mounted once (desktop +
// signed-in only): keeps the device registry warm, boots one live-sync engine
// per linked link-state, surfaces incoming transfers as toasts, cleans up
// transfers this device sent, and registers the action registry that
// WorkspaceSyncSettings drives. Never opens dialogs — background loops may
// only toast, rate-limited per distinct message.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getDesktopBridge, type DesktopWorkspaceState } from '../lib/desktop'
import { showToast } from '../lib/ui/dialogs'
import { announceWorkspaceMutation } from '../lib/workspaceContext'
import { createSnapshotStore, randomSyncId } from '../lib/sync/snapshotStore'
import { getSyncDeviceId, getSyncDeviceLabel } from '../lib/sync/deviceIdentity'
import {
  createLiveSyncEngine,
  type LiveSyncEngine,
} from '../lib/sync/liveSyncEngine'
import {
  getWorkspaceSyncActions,
  initialEngineStatus,
  isBootableLinkState,
  isPathUnderAnyRoot,
  publishSyncStatus,
  registerWorkspaceSyncActions,
  removeSyncStatus,
  type WorkspaceSyncActions,
} from '../lib/sync/useWorkspaceSync'
import type {
  DesktopSyncLinkState,
  DesktopSyncRootMapping,
  LiveSyncContainer,
  LiveSyncStatus,
  SnapshotStore,
  SyncDeviceRef,
} from '../lib/sync/types'

const DEVICE_HEARTBEAT_MS = 5 * 60_000
const ERROR_TOAST_INTERVAL_MS = 30_000
const FETCH_CONTAINER_TIMEOUT_MS = 15_000

// Session-scoped so a settings visit (remount) never re-toasts a transfer or
// re-deletes a container another emission already handled.
const seenTransferToasts = new Set<string>()
const seenDetachToasts = new Set<string>()
const attemptedTransferCleanup = new Set<string>()
const lastErrorToastAt = new Map<string, number>()

function showRateLimitedErrorToast(message: string) {
  const now = Date.now()
  if (now - (lastErrorToastAt.get(message) ?? 0) < ERROR_TOAST_INTERVAL_MS) {
    return
  }
  lastErrorToastAt.set(message, now)
  showToast(message, { kind: 'error' })
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// Root mapping paths are native absolute paths while sync relPaths are always
// '/'-separated; keep the announced paths in the platform's separator so the
// workspace mutation reconciler can match open files.
function joinAbsolute(base: string, relPath: string): string {
  if (base.includes('\\') && !base.includes('/')) {
    return `${base.replace(/[\\]+$/, '')}\\${relPath.replace(/\//g, '\\')}`
  }
  return `${base.replace(/\/+$/, '')}/${relPath}`
}

function randomRootId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

// Bounded container fetch: a dead listen/permission failure must surface as
// an error the caller can toast instead of hanging its action forever.
async function fetchLiveSyncContainer(
  store: SnapshotStore,
  syncId: string
): Promise<LiveSyncContainer | null> {
  let timer: number | undefined
  try {
    return await Promise.race([
      store.fetchLiveSyncContainer(syncId),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          reject(
            new Error(
              'Your cloud did not respond — check your connection and try again.'
            )
          )
        }, FETCH_CONTAINER_TIMEOUT_MS)
      }),
    ])
  } finally {
    window.clearTimeout(timer)
  }
}

export function WorkspaceSyncCoordinator() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const uid = user?.uid ?? null

  useEffect(() => {
    const bridge = getDesktopBridge()
    const sync = bridge?.workspaceSync
    if (!bridge || !sync || !uid) return

    let disposed = false
    const store = createSnapshotStore(uid)
    // Shared mutable ref: the label refines once deviceInfo resolves and when
    // the settings surface renames this device.
    let bridgeLabel: string | null = null
    const device: SyncDeviceRef = {
      id: getSyncDeviceId(),
      label: getSyncDeviceLabel(null),
    }
    const engines = new Map<string, LiveSyncEngine>()

    // Open-workspace roots, cached so mutation announcements can be dropped
    // for workspaces that are not open (background engines must never churn
    // the open workspace's tree/search with foreign paths).
    let workspaceRoots: string[] = []
    const cacheWorkspaceRoots = (state: DesktopWorkspaceState) => {
      workspaceRoots = state.roots.map((root) => root.path)
    }
    bridge.workspace
      .getState()
      .then((state) => {
        if (!disposed) cacheWorkspaceRoots(state)
      })
      .catch(() => {})
    const unsubscribeWorkspaceState =
      bridge.workspace.onState(cacheWorkspaceRoots)

    const stopEngine = (syncId: string): Promise<void> => {
      const engine = engines.get(syncId)
      if (!engine) return Promise.resolve()
      engines.delete(syncId)
      let result: unknown = null
      try {
        result = engine.stop()
      } catch {
        // Stop must never block teardown.
      }
      removeSyncStatus(syncId)
      // Re-clear after the engine drains so a late in-flight status publish
      // cannot leave a ghost row behind.
      return Promise.resolve(result).then(
        () => removeSyncStatus(syncId),
        () => removeSyncStatus(syncId)
      )
    }

    // The cloud container was deleted (or is missing): the engine stopped
    // itself, so unlink this device — local files stay — after a one-time
    // heads-up. Deliberately not gated on `disposed`: a detach observed just
    // before sign-out should still clear the dead link state.
    const detachEngine = async (state: DesktopSyncLinkState) => {
      if (!seenDetachToasts.has(state.syncId)) {
        seenDetachToasts.add(state.syncId)
        showToast(
          `Live sync for '${state.name}' was deleted in the cloud — this device kept its local files.`,
          { kind: 'info' }
        )
      }
      await stopEngine(state.syncId)
      await sync.removeState(state.syncId).catch(() => {})
      removeSyncStatus(state.syncId)
    }

    const startEngine = (state: DesktopSyncLinkState) => {
      if (
        disposed ||
        engines.has(state.syncId) ||
        !isBootableLinkState(state, uid)
      ) {
        return
      }
      const pathByRoot = new Map(
        state.rootMappings.map((mapping) => [mapping.rootId, mapping.path])
      )
      // Declared before the factory call so the status callback can compare;
      // engines never emit synchronously from the factory.
      let engine: LiveSyncEngine
      const handleStatus = (status: LiveSyncStatus) => {
        // Drop publishes from engines that already stopped/detached so a
        // draining plan cannot resurrect a removed status row.
        if (engines.get(state.syncId) !== engine) return
        publishSyncStatus(status)
        if (status.detached) void detachEngine(state)
      }
      engine = createLiveSyncEngine({
        store,
        bridge: sync,
        syncId: state.syncId,
        device,
        onStatus: handleStatus,
        announceMutation: (
          changes: { rootId: string; path: string; kind: 'write' | 'delete' }[]
        ) => {
          const writes: string[] = []
          const deletes: string[] = []
          for (const change of changes) {
            const base = pathByRoot.get(change.rootId)
            if (!base) continue
            const absolute = joinAbsolute(base, change.path)
            if (!isPathUnderAnyRoot(absolute, workspaceRoots)) continue
            const target = change.kind === 'delete' ? deletes : writes
            target.push(absolute)
          }
          if (writes.length > 0) {
            announceWorkspaceMutation({
              kind: 'write',
              paths: writes,
              refreshAll: false,
            })
          }
          if (deletes.length > 0) {
            announceWorkspaceMutation({
              kind: 'delete',
              paths: deletes,
              refreshAll: false,
            })
          }
        },
      })
      engines.set(state.syncId, engine)
      // Publish a placeholder immediately so settings surfaces see the link
      // (and useLinkedSyncStates re-lists) before the engine's first status;
      // a persisted pause surfaces as Paused, not "starting".
      publishSyncStatus(initialEngineStatus(state))
      engine.start().catch((error: unknown) => {
        showRateLimitedErrorToast(
          messageFor(error, `Live sync could not start for ${state.name}.`)
        )
      })
    }

    const actions: WorkspaceSyncActions = {
      async enableLiveSync(name, rootPaths) {
        const syncId = randomSyncId('ws')
        const rootMappings: DesktopSyncRootMapping[] = rootPaths.map(
          (path) => ({ rootId: randomRootId(), path })
        )
        const state: DesktopSyncLinkState = {
          version: 1,
          syncId,
          name,
          ownerUid: uid,
          rootMappings,
          lastSynced: {},
        }
        const saved = await sync.saveState(syncId, state)
        if (!saved) {
          throw new Error(
            'This device could not authorize the workspace folders for sync.'
          )
        }
        try {
          await store.createLiveSync({
            syncId,
            name,
            roots: rootMappings.map((mapping) => ({
              id: mapping.rootId,
              name: folderName(mapping.path),
            })),
            device,
          })
        } catch (error) {
          await sync.removeState(syncId).catch(() => {})
          throw error
        }
        startEngine(state)
      },
      async pauseLiveSync(syncId) {
        const engine = engines.get(syncId)
        if (engine) await engine.pause()
        else await store.setLiveSyncStatus(syncId, 'paused')
      },
      async resumeLiveSync(syncId) {
        const engine = engines.get(syncId)
        if (engine) await engine.resume()
        else await store.setLiveSyncStatus(syncId, 'active')
      },
      async unlinkDevice(syncId) {
        stopEngine(syncId)
        await sync.removeState(syncId)
        // Unconditional re-dispatch so useLinkedSyncStates re-lists after the
        // link state is actually gone.
        removeSyncStatus(syncId)
      },
      async deleteLiveSync(syncId) {
        stopEngine(syncId)
        await sync.removeState(syncId).catch(() => {})
        removeSyncStatus(syncId)
        await store.deleteContainer('live', syncId)
      },
      async downloadLiveSync(syncId, destBase) {
        const container = await fetchLiveSyncContainer(store, syncId)
        if (!container) {
          throw new Error(
            'This live-synced workspace was not found in your cloud.'
          )
        }
        const rootMappings: DesktopSyncRootMapping[] = []
        for (const root of container.roots) {
          const created = await sync.createRootFolder(
            destBase ?? '',
            root.name
          )
          if (!created.ok || !created.path) {
            throw new Error(
              created.error || `A folder for ${root.name} could not be created.`
            )
          }
          rootMappings.push({ rootId: root.id, path: created.path })
        }
        const state: DesktopSyncLinkState = {
          version: 1,
          syncId,
          name: container.name,
          ownerUid: uid,
          rootMappings,
          lastSynced: {},
        }
        const saved = await sync.saveState(syncId, state)
        if (!saved) {
          throw new Error(
            'This device could not authorize the new folders for sync.'
          )
        }
        startEngine(state)
      },
      async confirmGuardedDeletes(syncId) {
        await engines.get(syncId)?.confirmGuardedDeletes()
      },
      async dismissGuardedDeletes(syncId) {
        await engines.get(syncId)?.dismissGuardedDeletes()
      },
    }
    registerWorkspaceSyncActions(actions)

    const heartbeat = async () => {
      try {
        await store.upsertDevice({
          id: device.id,
          label: device.label,
          platform: bridge.platform,
          appVersion: bridge.electronVersion,
        })
      } catch {
        // Retried on the next interval; the registry tolerates gaps.
      }
    }
    const heartbeatTimer = window.setInterval(() => {
      device.label = getSyncDeviceLabel(bridgeLabel)
      void heartbeat()
    }, DEVICE_HEARTBEAT_MS)

    const boot = async () => {
      try {
        const info = await sync.deviceInfo()
        bridgeLabel = info.label || null
        device.label = getSyncDeviceLabel(bridgeLabel)
      } catch {
        // Keep the localStorage/default label.
      }
      if (disposed) return
      void heartbeat()
      try {
        const states = await sync.listStates()
        if (disposed) return
        for (const state of states) {
          if (isBootableLinkState(state, uid)) startEngine(state)
        }
      } catch (error) {
        showRateLimitedErrorToast(
          messageFor(error, 'Linked workspaces could not be loaded.')
        )
      }
    }
    void boot()

    let cleanupRunning = false
    const unsubscribeTransfers = store.subscribeTransfers((rows) => {
      if (disposed) return
      for (const row of rows) {
        const inbound =
          row.status === 'ready' &&
          (row.targetDeviceId === null || row.targetDeviceId === device.id) &&
          row.claimedBy === null &&
          row.device.id !== device.id
        if (!inbound || seenTransferToasts.has(row.id)) continue
        seenTransferToasts.add(row.id)
        showToast(`Workspace '${row.name}' sent from ${row.device.label}`, {
          kind: 'info',
          actionLabel: 'Review',
          onAction: () => navigateRef.current('/settings/sync'),
        })
      }
      const stale = rows.filter(
        (row) =>
          row.device.id === device.id &&
          !attemptedTransferCleanup.has(row.id) &&
          (row.status === 'received' ||
            row.expiresAt.getTime() < Date.now())
      )
      if (stale.length === 0 || cleanupRunning) return
      cleanupRunning = true
      void (async () => {
        try {
          for (const row of stale) {
            attemptedTransferCleanup.add(row.id)
            try {
              await store.deleteContainer('transfer', row.id)
            } catch {
              // Allow a later emission (or app run) to retry this one.
              attemptedTransferCleanup.delete(row.id)
            }
          }
        } finally {
          cleanupRunning = false
        }
      })()
    })

    return () => {
      disposed = true
      window.clearInterval(heartbeatTimer)
      unsubscribeWorkspaceState()
      unsubscribeTransfers()
      if (getWorkspaceSyncActions() === actions) {
        registerWorkspaceSyncActions(null)
      }
      for (const syncId of [...engines.keys()]) stopEngine(syncId)
    }
  }, [uid])

  return null
}
