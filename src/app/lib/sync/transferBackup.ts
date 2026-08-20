import {
  type BackupContainer,
  type DesktopSyncRootMapping,
  type DesktopWorkspaceSyncBridge,
  type SnapshotStore,
  type SyncContainerKind,
  type SyncDeviceRef,
  type SyncProgress,
  type SyncRootRef,
  type TransferContainer,
} from './types'
import { base64ToBytes, bytesToBase64, randomSyncId } from './snapshotStore'

const UPLOAD_CONCURRENCY = 4

// Container roots use short ids: they only need to be unique within one
// container and they appear in every file key.
function randomRootId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('')
}

function rootNameFromPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0)
  const name = parts[parts.length - 1] ?? 'Workspace'
  return name.slice(0, 120)
}

// Workers stop pulling new items after the first failure; the first error is
// rethrown once every in-flight item has settled so no write lands after the
// caller sees the rejection.
async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let index = 0
  let failed = false
  let failure: unknown = null
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (!failed) {
        const current = index
        if (current >= items.length) return
        index += 1
        try {
          await worker(items[current])
        } catch (error) {
          if (!failed) {
            failed = true
            failure = error
          }
        }
      }
    }
  )
  await Promise.all(runners)
  if (failed) throw failure
}

// One-shot flows authorize the main process for their roots through a
// temporary bk_/tr_ link state; the finally block guarantees the
// authorization is revoked even when the flow fails midway.
async function withTempState<T>(
  bridge: DesktopWorkspaceSyncBridge,
  syncId: string,
  name: string,
  rootMappings: DesktopSyncRootMapping[],
  run: () => Promise<T>
): Promise<T> {
  const saved = await bridge.saveState(syncId, {
    version: 1,
    syncId,
    name,
    rootMappings,
    lastSynced: {},
  })
  if (!saved) {
    throw new Error('Could not authorize workspace folders for sync')
  }
  try {
    return await run()
  } finally {
    try {
      await bridge.removeState(syncId)
    } catch {
      // Best-effort cleanup; stale temp states are never watched.
    }
  }
}

async function uploadContainerFiles(input: {
  store: SnapshotStore
  bridge: DesktopWorkspaceSyncBridge
  device: SyncDeviceRef
  kind: SyncContainerKind
  containerId: string
  tempStateId: string
  onProgress?: (p: SyncProgress) => void
}): Promise<{ fileCount: number; totalBytes: number }> {
  const { store, bridge, device, kind, containerId, tempStateId } = input
  const scan = await bridge.scan(tempStateId)
  if (!scan.ok) throw new Error(scan.error || 'Workspace scan failed')
  if (scan.missingRoots.length > 0) {
    throw new Error('Some workspace folders no longer exist on disk')
  }
  const total = scan.entries.length
  let done = 0
  let fileCount = 0
  let totalBytes = 0
  input.onProgress?.({ done, total, currentPath: '' })
  await forEachWithConcurrency(scan.entries, UPLOAD_CONCURRENCY, async (entry) => {
    const read = await bridge.read(tempStateId, entry.rootId, entry.path)
    if (!read.ok) {
      throw new Error(read.error || `Could not read ${entry.path}`)
    }
    // A file deleted between scan and read is skipped, not fatal.
    if (!read.missing && typeof read.base64 === 'string') {
      const bytes = base64ToBytes(read.base64)
      await store.uploadFile(kind, containerId, {
        rootId: entry.rootId,
        path: entry.path,
        bytes,
        hash: read.hash ?? entry.hash,
        executable: read.executable === true,
        mtimeMs: read.mtimeMs ?? entry.mtimeMs,
        rev: 1,
        expectedBaseRev: 'unconditional',
        device,
      })
      fileCount += 1
      totalBytes += bytes.length
    }
    done += 1
    input.onProgress?.({ done, total, currentPath: entry.path })
  })
  return { fileCount, totalBytes }
}

async function applyContainerFiles(input: {
  store: SnapshotStore
  bridge: DesktopWorkspaceSyncBridge
  kind: SyncContainerKind
  container: { id: string; name: string; roots: SyncRootRef[] }
  destBase: string | null
  tempPrefix: 'bk' | 'tr'
  onProgress?: (p: SyncProgress) => void
  afterApply?: () => Promise<void>
}): Promise<{ rootPaths: string[] }> {
  const { store, bridge, kind, container, destBase } = input
  const files = (await store.listFiles(kind, container.id)).filter(
    (file) => !file.deleted
  )
  const pathByRootId = new Map<string, string>()
  const rootMappings: DesktopSyncRootMapping[] = []
  for (const root of container.roots) {
    const created = await bridge.createRootFolder(destBase ?? '', root.name)
    if (!created.ok || !created.path) {
      throw new Error(created.error || `Could not create folder ${root.name}`)
    }
    pathByRootId.set(root.id, created.path)
    rootMappings.push({ rootId: root.id, path: created.path })
  }

  const tempStateId = randomSyncId(input.tempPrefix)
  await withTempState(
    bridge,
    tempStateId,
    container.name,
    rootMappings,
    async () => {
      const known = files.filter((file) => pathByRootId.has(file.rootId))
      const total = known.length
      let done = 0
      input.onProgress?.({ done, total, currentPath: '' })
      await forEachWithConcurrency(known, UPLOAD_CONCURRENCY, async (file) => {
        const bytes = await store.fetchFileContent(kind, container.id, file)
        const applied = await bridge.apply(tempStateId, file.rootId, file.path, {
          base64: bytesToBase64(bytes),
          executable: file.executable,
        })
        if (!applied.ok) {
          throw new Error(applied.error || `Could not write ${file.path}`)
        }
        done += 1
        input.onProgress?.({ done, total, currentPath: file.path })
      })
      if (input.afterApply) await input.afterApply()
    }
  )

  return {
    rootPaths: container.roots.map(
      (root) => pathByRootId.get(root.id) as string
    ),
  }
}

export async function sendWorkspace(deps: {
  store: SnapshotStore
  bridge: DesktopWorkspaceSyncBridge
  device: SyncDeviceRef
  name: string
  rootPaths: string[]
  targetDeviceId: string | null
  onProgress?: (p: SyncProgress) => void
}): Promise<{ transferId: string }> {
  const { store, bridge, device } = deps
  const transferId = randomSyncId('tr')
  const roots: SyncRootRef[] = []
  const rootMappings: DesktopSyncRootMapping[] = []
  for (const path of deps.rootPaths) {
    const rootId = randomRootId()
    roots.push({ id: rootId, name: rootNameFromPath(path) })
    rootMappings.push({ rootId, path })
  }
  await withTempState(bridge, transferId, deps.name, rootMappings, async () => {
    await store.createTransfer({
      transferId,
      name: deps.name,
      roots,
      device,
      targetDeviceId: deps.targetDeviceId,
    })
    const stats = await uploadContainerFiles({
      store,
      bridge,
      device,
      kind: 'transfer',
      containerId: transferId,
      tempStateId: transferId,
      onProgress: deps.onProgress,
    })
    await store.markTransferReady(transferId, stats)
  })
  return { transferId }
}

export async function receiveTransfer(deps: {
  store: SnapshotStore
  bridge: DesktopWorkspaceSyncBridge
  device: SyncDeviceRef
  transfer: TransferContainer
  destBase: string | null
  onProgress?: (p: SyncProgress) => void
}): Promise<{ rootPaths: string[] }> {
  const { store, bridge, device, transfer } = deps
  const claimed = await store.claimTransfer(transfer.id, device)
  if (!claimed) {
    throw new Error('This workspace transfer was claimed by another device.')
  }
  try {
    return await applyContainerFiles({
      store,
      bridge,
      kind: 'transfer',
      container: transfer,
      destBase: deps.destBase,
      tempPrefix: 'tr',
      onProgress: deps.onProgress,
      afterApply: async () => {
        await store.markTransferReceived(transfer.id, device)
      },
    })
  } catch (error) {
    await store.releaseTransferClaim(transfer.id, device).catch(() => {})
    throw error
  }
}

export async function createBackup(deps: {
  store: SnapshotStore
  bridge: DesktopWorkspaceSyncBridge
  device: SyncDeviceRef
  name: string
  rootPaths: string[]
  onProgress?: (p: SyncProgress) => void
}): Promise<{ backupId: string }> {
  const { store, bridge, device } = deps
  const backupId = randomSyncId('bk')
  const roots: SyncRootRef[] = []
  const rootMappings: DesktopSyncRootMapping[] = []
  for (const path of deps.rootPaths) {
    const rootId = randomRootId()
    roots.push({ id: rootId, name: rootNameFromPath(path) })
    rootMappings.push({ rootId, path })
  }
  await withTempState(bridge, backupId, deps.name, rootMappings, async () => {
    await store.createBackup({ backupId, name: deps.name, roots, device })
    const stats = await uploadContainerFiles({
      store,
      bridge,
      device,
      kind: 'backup',
      containerId: backupId,
      tempStateId: backupId,
      onProgress: deps.onProgress,
    })
    await store.finishBackup(backupId, stats)
  })
  return { backupId }
}

export async function restoreBackup(deps: {
  store: SnapshotStore
  bridge: DesktopWorkspaceSyncBridge
  device: SyncDeviceRef
  backup: BackupContainer
  destBase: string | null
  onProgress?: (p: SyncProgress) => void
}): Promise<{ rootPaths: string[] }> {
  return applyContainerFiles({
    store: deps.store,
    bridge: deps.bridge,
    kind: 'backup',
    container: deps.backup,
    destBase: deps.destBase,
    tempPrefix: 'bk',
    onProgress: deps.onProgress,
  })
}
