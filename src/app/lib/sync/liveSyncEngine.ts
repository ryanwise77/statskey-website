import {
  SyncRevConflictError,
  syncFileKey,
  type DesktopSyncChangeEvent,
  type DesktopSyncDeletedEntry,
  type DesktopSyncLastSyncedEntry,
  type DesktopSyncLinkState,
  type DesktopSyncScanEntry,
  type DesktopWorkspaceSyncBridge,
  type LiveSyncStatus,
  type SnapshotStore,
  type SyncDeviceRef,
  type SyncFileDoc,
  type SyncPlan,
  type SyncPlanDelete,
} from './types'
import { planReconcile } from './syncPlan'
import { base64ToBytes, bytesToBase64 } from './snapshotStore'

const EXPECTED_ECHO_CAP = 2048
const SAVE_DEBOUNCE_MS = 1000
const RETRY_MIN_MS = 5000
const RETRY_MAX_MS = 60_000

export interface LiveSyncMutation {
  rootId: string
  path: string
  kind: 'write' | 'delete'
}

export interface LiveSyncEngine {
  start(): Promise<void>
  stop(): void
  pause(): Promise<void>
  resume(): Promise<void>
  confirmGuardedDeletes(): Promise<void>
  dismissGuardedDeletes(): Promise<void>
}

function isDeletedEntry(
  entry: DesktopSyncScanEntry | DesktopSyncDeletedEntry
): entry is DesktopSyncDeletedEntry {
  return (entry as DesktopSyncDeletedEntry).deleted === true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }
  return /offline|network|unavailable|timed?[ -]?out|fetch/i.test(
    errorMessage(error)
  )
}

export function createLiveSyncEngine(deps: {
  store: SnapshotStore
  bridge: DesktopWorkspaceSyncBridge
  syncId: string
  device: SyncDeviceRef
  onStatus: (status: LiveSyncStatus) => void
  announceMutation?: (changes: LiveSyncMutation[]) => void
}): LiveSyncEngine {
  const { store, bridge, syncId, device } = deps

  let started = false
  let stopped = false
  let paused = false
  let linkState: DesktopSyncLinkState | null = null
  let lastSynced: Record<string, DesktopSyncLastSyncedEntry> = {}
  // Metadata cache of the remote files collection, keyed like lastSynced.
  // Uploads derive rev from here ((remote rev ?? 0) + 1).
  let remoteMeta = new Map<string, SyncFileDoc>()
  let guardedDeletes: SyncPlanDelete[] = []
  let unsubscribers: (() => void)[] = []
  let lastScanSkipped = 0

  // Echo suppression: after our own apply/remove/upload the same change comes
  // back through the watcher or the files listener; entries here are consumed
  // once and capped FIFO so a missed echo cannot grow the set forever.
  const expected = new Map<string, string>()

  let dirty = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryDelayMs = RETRY_MIN_MS

  let status: LiveSyncStatus = {
    syncId,
    state: 'starting',
    pendingUploads: 0,
    pendingApplies: 0,
    lastSyncedAt: null,
    skippedCount: 0,
    error: null,
    guard: null,
    guardedDeleteCount: 0,
    detached: false,
  }

  function setStatus(patch: Partial<LiveSyncStatus>): void {
    status = { ...status, ...patch }
    deps.onStatus(status)
  }

  function rememberExpected(key: string, mark: string): void {
    if (expected.has(key)) expected.delete(key)
    expected.set(key, mark)
    if (expected.size > EXPECTED_ECHO_CAP) {
      const oldest = expected.keys().next().value
      if (oldest !== undefined) expected.delete(oldest)
    }
  }

  function markDirty(): void {
    dirty = true
    if (saveTimer !== null || stopped) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (dirty && !stopped) void persistLastSynced()
    }, SAVE_DEBOUNCE_MS)
  }

  async function persistLastSynced(): Promise<void> {
    if (!linkState) return
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    dirty = false
    try {
      await bridge.saveState(syncId, {
        ...linkState,
        lastSynced: { ...lastSynced },
      })
    } catch {
      dirty = true
    }
  }

  // Single serialized work chain: reconciles never overlap, and errors are
  // absorbed here so a failed task can never reject into a caller or break
  // the chain for the next task.
  let chain: Promise<void> = Promise.resolve()
  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = chain
      .catch(() => {})
      .then(async () => {
        if (stopped) return
        try {
          await task()
          retryDelayMs = RETRY_MIN_MS
        } catch (error) {
          handleTaskError(error)
        }
        if (chain === run && dirty && !stopped) {
          await persistLastSynced()
        }
      })
    chain = run
    return run
  }

  function handleTaskError(error: unknown): void {
    if (stopped) return
    if (
      error instanceof SyncRevConflictError ||
      (error instanceof Error &&
        (error as Error & { code?: string }).code === 'sync-rev-conflict')
    ) {
      setStatus({
        state: 'attention',
        pendingUploads: 0,
        pendingApplies: 0,
        error: 'Workspace changed on another device; reconciling again.',
      })
      scheduleRetry()
    } else if (isOfflineError(error)) {
      setStatus({
        state: 'offline',
        pendingUploads: 0,
        pendingApplies: 0,
        error: null,
      })
      scheduleRetry()
    } else {
      setStatus({
        state: 'error',
        pendingUploads: 0,
        pendingApplies: 0,
        error: errorMessage(error),
      })
    }
  }

  function scheduleRetry(): void {
    if (stopped || paused || retryTimer !== null) return
    const delay = retryDelayMs
    retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void enqueue(reconcileAll)
    }, delay)
  }

  function nextRev(key: string): number {
    return (remoteMeta.get(key)?.rev ?? lastSynced[key]?.rev ?? 0) + 1
  }

  function synthesizeRemote(
    key: string,
    rootId: string,
    path: string,
    input: {
      deleted: boolean
      hash: string
      size: number
      rev: number
      executable: boolean
    }
  ): void {
    remoteMeta.set(key, {
      id: '',
      rootId,
      path,
      deleted: input.deleted,
      size: input.size,
      contentHash: input.hash,
      executable: input.executable,
      chunkCount: 0,
      rev: input.rev,
      modifiedAt: null,
      updatedAt: null,
      device,
    })
  }

  function statsFromLastSynced(): { fileCount: number; totalBytes: number } {
    let fileCount = 0
    let totalBytes = 0
    for (const key of Object.keys(lastSynced)) {
      fileCount += 1
      totalBytes += lastSynced[key].size
    }
    return { fileCount, totalBytes }
  }

  // Reads the file from disk and uploads it with a bumped rev. Returns false
  // when the file is unreadable or vanished (the caller counts it skipped);
  // store failures throw so the chain's offline/retry handling sees them.
  async function uploadLocalFile(
    rootId: string,
    path: string,
    key: string
  ): Promise<boolean> {
    const read = await bridge.read(syncId, rootId, path)
    if (!read.ok || read.missing || typeof read.base64 !== 'string') {
      return false
    }
    const bytes = base64ToBytes(read.base64)
    const hash = read.hash ?? ''
    const expectedBaseRev = remoteMeta.get(key)?.rev ?? null
    const rev = nextRev(key)
    const mtimeMs = read.mtimeMs ?? 0
    const size = read.size ?? bytes.length
    const executable = read.executable === true
    await store.uploadFile('live', syncId, {
      rootId,
      path,
      bytes,
      hash,
      executable,
      mtimeMs,
      rev,
      expectedBaseRev,
      device,
    })
    rememberExpected(key, hash)
    synthesizeRemote(key, rootId, path, {
      deleted: false,
      hash,
      size,
      rev,
      executable,
    })
    lastSynced[key] = { hash, rev, mtimeMs, size }
    markDirty()
    return true
  }

  async function executePlan(plan: SyncPlan): Promise<void> {
    // The planner emits a conflict as apply(conflictCopyPath) + upload of the
    // same key; the upload runs inline right after its conflict copy lands, so
    // filter it out of the regular upload pass.
    const conflictKeys = new Set(
      plan.applies
        .filter((apply) => apply.conflictCopyPath != null)
        .map((apply) => apply.key)
    )
    const uploads = plan.uploads.filter(
      (upload) => !conflictKeys.has(upload.key)
    )

    let pendingUploads = uploads.length + conflictKeys.size
    let pendingApplies = plan.applies.length + plan.deletesLocal.length
    const totalWork =
      pendingUploads + pendingApplies + plan.deletesRemote.length
    let failures = 0
    let conflicts = 0
    const mutations: LiveSyncMutation[] = []

    for (const settled of plan.settled) {
      const prev = lastSynced[settled.key]
      const next = settled.entry
      if (
        !prev ||
        prev.hash !== next.hash ||
        prev.rev !== next.rev ||
        prev.mtimeMs !== next.mtimeMs ||
        prev.size !== next.size
      ) {
        lastSynced[settled.key] = next
        markDirty()
      }
    }
    for (const key of plan.droppedKeys) {
      if (key in lastSynced) {
        delete lastSynced[key]
        markDirty()
      }
    }

    if (totalWork > 0) {
      setStatus({
        state: 'syncing',
        pendingUploads,
        pendingApplies,
        error: null,
      })
    }

    for (const upload of uploads) {
      if (!(await uploadLocalFile(upload.rootId, upload.path, upload.key))) {
        failures += 1
      }
      pendingUploads -= 1
      setStatus({ pendingUploads })
    }

    for (const apply of plan.applies) {
      const bytes = await store.fetchFileContent('live', syncId, apply.remote)
      const targetPath = apply.conflictCopyPath ?? apply.path
      const applied = await bridge.apply(syncId, apply.rootId, targetPath, {
        base64: bytesToBase64(bytes),
        executable: apply.remote.executable,
      })
      if (!applied.ok) {
        failures += 1
      } else {
        mutations.push({ rootId: apply.rootId, path: targetPath, kind: 'write' })
        rememberExpected(
          syncFileKey(apply.rootId, targetPath),
          applied.hash ?? apply.remote.contentHash
        )
        if (apply.conflictCopyPath != null) {
          conflicts += 1
          // Conflict rule: disk is truth — the local original stays on its
          // tracked path and re-uploads over the remote rev.
          if (!(await uploadLocalFile(apply.rootId, apply.path, apply.key))) {
            failures += 1
          }
          pendingUploads -= 1
          setStatus({ pendingUploads })
        } else {
          lastSynced[apply.key] = {
            hash: apply.remote.contentHash,
            rev: apply.remote.rev,
            mtimeMs: applied.mtimeMs ?? 0,
            size: apply.remote.size,
          }
          markDirty()
        }
      }
      pendingApplies -= 1
      setStatus({ pendingApplies })
    }

    for (const del of plan.deletesLocal) {
      const removed = await bridge.remove(syncId, del.rootId, del.path)
      if (!removed.ok) {
        failures += 1
      } else {
        mutations.push({ rootId: del.rootId, path: del.path, kind: 'delete' })
        rememberExpected(del.key, 'deleted')
        if (del.key in lastSynced) {
          delete lastSynced[del.key]
          markDirty()
        }
      }
      pendingApplies -= 1
      setStatus({ pendingApplies })
    }

    for (const del of plan.deletesRemote) {
      const expectedBaseRev = remoteMeta.get(del.key)?.rev ?? null
      const rev = nextRev(del.key)
      await store.uploadTombstone('live', syncId, {
        rootId: del.rootId,
        path: del.path,
        rev,
        expectedBaseRev,
        device,
      })
      rememberExpected(del.key, 'deleted')
      synthesizeRemote(del.key, del.rootId, del.path, {
        deleted: true,
        hash: '',
        size: 0,
        rev,
        executable: false,
      })
      if (del.key in lastSynced) {
        delete lastSynced[del.key]
        markDirty()
      }
    }

    if (plan.guard === 'mass-delete') {
      guardedDeletes = plan.guardedDeletes
    }

    if (totalWork > 0) {
      await store.updateContainerStats('live', syncId, statsFromLastSynced())
    }

    if (mutations.length > 0 && deps.announceMutation) {
      deps.announceMutation(mutations)
    }

    const skippedCount = lastScanSkipped + failures
    if (guardedDeletes.length > 0) {
      setStatus({
        state: 'attention',
        guard: 'mass-delete',
        pendingUploads: 0,
        pendingApplies: 0,
        skippedCount,
        lastSyncedAt: new Date(),
        error: null,
        guardedDeleteCount: guardedDeletes.length,
      })
    } else if (conflicts > 0 || skippedCount > 0) {
      setStatus({
        state: 'attention',
        guard: null,
        pendingUploads: 0,
        pendingApplies: 0,
        skippedCount,
        lastSyncedAt: new Date(),
        error: null,
        guardedDeleteCount: 0,
      })
    } else {
      setStatus({
        state: 'idle',
        guard: null,
        pendingUploads: 0,
        pendingApplies: 0,
        skippedCount: 0,
        lastSyncedAt: new Date(),
        error: null,
        guardedDeleteCount: 0,
      })
    }
  }

  async function reconcileAll(): Promise<void> {
    if (paused) return
    const remote = await store.listFiles('live', syncId)
    remoteMeta = new Map(
      remote.map((row) => [syncFileKey(row.rootId, row.path), row])
    )
    const scan = await bridge.scan(syncId)
    if (!scan.ok) throw new Error(scan.error || 'Workspace scan failed')
    lastScanSkipped = scan.skipped.length
    const plan = planReconcile({
      localEntries: scan.entries,
      missingRoots: scan.missingRoots,
      skipped: scan.skipped,
      remoteFiles: remote,
      lastSynced: { ...lastSynced },
      trackedCount: Object.keys(lastSynced).length,
      deviceLabel: device.label,
      now: new Date(),
    })
    await executePlan(plan)
  }

  function pickLastSynced(
    keys: Iterable<string>
  ): Record<string, DesktopSyncLastSyncedEntry> {
    const restricted: Record<string, DesktopSyncLastSyncedEntry> = {}
    for (const key of keys) {
      const entry = lastSynced[key]
      if (entry) restricted[key] = entry
    }
    return restricted
  }

  async function processRemoteRows(rows: SyncFileDoc[]): Promise<void> {
    if (paused) return
    remoteMeta = new Map(
      rows.map((row) => [syncFileKey(row.rootId, row.path), row])
    )
    const relevant: SyncFileDoc[] = []
    for (const row of rows) {
      const key = syncFileKey(row.rootId, row.path)
      const mark = row.deleted ? 'deleted' : row.contentHash
      if (expected.get(key) === mark) {
        expected.delete(key)
        continue
      }
      const prev = lastSynced[key]
      if (!row.deleted && prev && prev.hash === row.contentHash) {
        if (prev.rev !== row.rev) {
          lastSynced[key] = { ...prev, rev: row.rev }
          markDirty()
        }
        continue
      }
      if (row.deleted && !prev) continue
      relevant.push(row)
    }
    if (relevant.length === 0) return

    const keys = new Set(
      relevant.map((row) => syncFileKey(row.rootId, row.path))
    )
    const byRoot = new Map<string, SyncFileDoc[]>()
    for (const row of relevant) {
      const list = byRoot.get(row.rootId) ?? []
      list.push(row)
      byRoot.set(row.rootId, list)
    }
    const localEntries: DesktopSyncScanEntry[] = []
    for (const [rootId, rootRows] of byRoot) {
      const scanned = await bridge.scanPaths(
        syncId,
        rootId,
        rootRows.map((row) => row.path)
      )
      if (!scanned.ok) {
        throw new Error(scanned.error || 'Workspace scan failed')
      }
      for (const entry of scanned.entries) {
        if (!isDeletedEntry(entry)) localEntries.push(entry)
      }
    }
    const plan = planReconcile({
      localEntries,
      missingRoots: [],
      skipped: [],
      remoteFiles: relevant,
      lastSynced: pickLastSynced(keys),
      trackedCount: Object.keys(lastSynced).length,
      deviceLabel: device.label,
      now: new Date(),
    })
    await executePlan(plan)
  }

  async function processLocalChanges(
    event: DesktopSyncChangeEvent
  ): Promise<void> {
    if (paused) return

    if (event.paths.length === 0) {
      // Watcher overflow: rescan and reconcile this whole root against the
      // cached remote metadata.
      const scan = await bridge.scan(syncId)
      if (!scan.ok) throw new Error(scan.error || 'Workspace scan failed')
      lastScanSkipped = scan.skipped.length
      const prefix = `${event.rootId}:`
      const rootKeys = Object.keys(lastSynced).filter((key) =>
        key.startsWith(prefix)
      )
      const plan = planReconcile({
        localEntries: scan.entries.filter(
          (entry) => entry.rootId === event.rootId
        ),
        missingRoots: scan.missingRoots,
        skipped: scan.skipped.filter(
          (entry) => entry.rootId === event.rootId
        ),
        remoteFiles: [...remoteMeta.values()].filter(
          (row) => row.rootId === event.rootId
        ),
        lastSynced: pickLastSynced(rootKeys),
        trackedCount: Object.keys(lastSynced).length,
        deviceLabel: device.label,
        now: new Date(),
      })
      await executePlan(plan)
      return
    }

    const scanned = await bridge.scanPaths(syncId, event.rootId, event.paths)
    if (!scanned.ok) throw new Error(scanned.error || 'Workspace scan failed')
    const keys = new Set(
      event.paths.map((path) => syncFileKey(event.rootId, path))
    )
    const localEntries: DesktopSyncScanEntry[] = []
    for (const entry of scanned.entries) {
      const key = syncFileKey(entry.rootId, entry.path)
      keys.add(key)
      if (isDeletedEntry(entry)) {
        if (expected.get(key) === 'deleted') {
          expected.delete(key)
          keys.delete(key)
        }
        continue
      }
      if (expected.get(key) === entry.hash) {
        expected.delete(key)
        keys.delete(key)
        continue
      }
      localEntries.push(entry)
    }
    if (keys.size === 0) return

    const remoteFiles: SyncFileDoc[] = []
    for (const key of keys) {
      const row = remoteMeta.get(key)
      if (row) remoteFiles.push(row)
    }
    const plan = planReconcile({
      localEntries,
      missingRoots: [],
      skipped: [],
      remoteFiles,
      lastSynced: pickLastSynced(keys),
      trackedCount: Object.keys(lastSynced).length,
      deviceLabel: device.label,
      now: new Date(),
    })
    await executePlan(plan)
  }

  async function start(): Promise<void> {
    if (started || stopped) return
    started = true
    setStatus({ state: 'starting' })
    let loaded: DesktopSyncLinkState | null = null
    try {
      loaded = await bridge.loadState(syncId)
    } catch (error) {
      setStatus({ state: 'error', error: errorMessage(error) })
      return
    }
    if (!loaded) {
      setStatus({
        state: 'error',
        error: 'No local link state found for this sync',
      })
      return
    }
    linkState = loaded
    lastSynced = { ...loaded.lastSynced }
    paused = loaded.paused === true

    unsubscribers.push(
      store.subscribeLiveSyncContainerDoc(
        syncId,
        (container) => {
          if (stopped) return
          if (!container || container.status === 'deleted') {
            setStatus({
              state: 'attention',
              pendingUploads: 0,
              pendingApplies: 0,
              error: null,
              detached: true,
            })
            return
          }
          const cloudPaused = container.status === 'paused'
          if (cloudPaused === paused) return
          paused = cloudPaused
          linkState = linkState
            ? { ...linkState, paused: cloudPaused }
            : linkState
          if (retryTimer !== null) {
            clearTimeout(retryTimer)
            retryTimer = null
          }
          if (linkState) {
            void bridge.saveState(syncId, linkState).catch(() => {})
          }
          if (cloudPaused) {
            setStatus({
              state: 'paused',
              pendingUploads: 0,
              pendingApplies: 0,
              error: null,
            })
          } else {
            void enqueue(reconcileAll)
          }
        },
        (error) => {
          if (!stopped) handleTaskError(error)
        }
      )
    )

    if (paused) {
      setStatus({
        state: 'paused',
        pendingUploads: 0,
        pendingApplies: 0,
        error: null,
      })
    } else {
      await enqueue(reconcileAll)
    }
    if (stopped) return

    unsubscribers.push(
      store.subscribeFiles('live', syncId, (rows) => {
        void enqueue(() => processRemoteRows(rows))
      })
    )
    unsubscribers.push(
      bridge.onChanges((event) => {
        if (event.syncId !== syncId) return
        void enqueue(() => processLocalChanges(event))
      })
    )
    if (typeof window !== 'undefined') {
      const onOnline = () => {
        if (stopped || paused) return
        retryDelayMs = RETRY_MIN_MS
        if (retryTimer !== null) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        void enqueue(reconcileAll)
      }
      window.addEventListener('online', onOnline)
      unsubscribers.push(() => window.removeEventListener('online', onOnline))
    }
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch {
        // Listener teardown is best-effort.
      }
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (linkState) {
      dirty = false
      bridge
        .saveState(syncId, { ...linkState, lastSynced: { ...lastSynced } })
        .catch(() => {})
    }
  }

  async function pause(): Promise<void> {
    if (paused || stopped) return
    paused = true
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    setStatus({ state: 'paused', pendingUploads: 0, pendingApplies: 0 })
    if (linkState) {
      linkState = { ...linkState, paused: true }
      const saved = await bridge.saveState(syncId, linkState)
      if (!saved) {
        setStatus({
          state: 'error',
          error: 'Pause could not be saved on this device.',
        })
      }
    }
    try {
      await store.setLiveSyncStatus(syncId, 'paused')
    } catch {
      // Cloud status update is advisory; the engine is paused regardless.
    }
  }

  async function resume(): Promise<void> {
    if (!paused || stopped) return
    paused = false
    if (linkState) {
      linkState = { ...linkState, paused: false }
      const saved = await bridge.saveState(syncId, linkState)
      if (!saved) {
        paused = true
        linkState = { ...linkState, paused: true }
        setStatus({
          state: 'error',
          error: 'Resume could not be saved on this device.',
        })
        return
      }
    }
    try {
      await store.setLiveSyncStatus(syncId, 'active')
    } catch {
      // Reconcile below will surface real connectivity problems.
    }
    await enqueue(reconcileAll)
  }

  function confirmGuardedDeletes(): Promise<void> {
    return enqueue(async () => {
      const held = guardedDeletes
      guardedDeletes = []
      if (held.length === 0) {
        setStatus({ guard: null })
        return
      }
      setStatus({
        state: 'syncing',
        guard: null,
        pendingApplies: held.length,
      })
      const mutations: LiveSyncMutation[] = []
      for (const del of held) {
        const removed = await bridge.remove(syncId, del.rootId, del.path)
        if (!removed.ok) continue
        mutations.push({ rootId: del.rootId, path: del.path, kind: 'delete' })
        rememberExpected(del.key, 'deleted')
        if (del.key in lastSynced) {
          delete lastSynced[del.key]
          markDirty()
        }
      }
      await store.updateContainerStats('live', syncId, statsFromLastSynced())
      if (mutations.length > 0 && deps.announceMutation) {
        deps.announceMutation(mutations)
      }
      setStatus({
        state: 'idle',
        guard: null,
        guardedDeleteCount: 0,
        pendingUploads: 0,
        pendingApplies: 0,
        lastSyncedAt: new Date(),
        error: null,
      })
    })
  }

  function dismissGuardedDeletes(): Promise<void> {
    return enqueue(async () => {
      const held = guardedDeletes
      guardedDeletes = []
      if (held.length === 0) {
        setStatus({ guard: null })
        return
      }
      setStatus({
        state: 'syncing',
        guard: null,
        pendingUploads: held.length,
      })
      for (const del of held) {
        // Undelete: the surviving local copy wins over the remote tombstone,
        // re-uploaded with a bumped rev.
        await uploadLocalFile(del.rootId, del.path, del.key)
      }
      await store.updateContainerStats('live', syncId, statsFromLastSynced())
      setStatus({
        state: 'idle',
        guard: null,
        guardedDeleteCount: 0,
        pendingUploads: 0,
        pendingApplies: 0,
        lastSyncedAt: new Date(),
        error: null,
      })
    })
  }

  return {
    start,
    stop,
    pause,
    resume,
    confirmGuardedDeletes,
    dismissGuardedDeletes,
  }
}
