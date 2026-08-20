import {
  conflictCopyPath,
  syncFileKey,
  type DesktopSyncLastSyncedEntry,
  type DesktopSyncScanEntry,
  type SyncFileDoc,
  type SyncPlan,
  type SyncPlanApply,
  type SyncPlanDelete,
  type SyncPlanInput,
  type SyncPlanUpload,
} from './types'

const MASS_DELETE_ABSOLUTE = 50
const MASS_DELETE_FRACTION = 0.25
const MASS_DELETE_MINIMUM = 10

// Pure three-way reconcile between the local scan, the remote metadata, and
// the per-device lastSynced baseline. "Changed" always means "hash differs
// from the lastSynced baseline" — no clocks, no revs, no I/O.
export function planReconcile(input: SyncPlanInput): SyncPlan {
  const missingRoots = new Set(input.missingRoots)
  const skippedKeys = new Set(
    input.skipped.map((entry) => syncFileKey(entry.rootId, entry.path))
  )

  const localByKey = new Map<string, DesktopSyncScanEntry>()
  for (const entry of input.localEntries) {
    localByKey.set(syncFileKey(entry.rootId, entry.path), entry)
  }
  const remoteByKey = new Map<string, SyncFileDoc>()
  for (const file of input.remoteFiles) {
    remoteByKey.set(syncFileKey(file.rootId, file.path), file)
  }

  const uploads: SyncPlanUpload[] = []
  const applies: SyncPlanApply[] = []
  const deletesLocal: SyncPlanDelete[] = []
  const deletesRemote: SyncPlanDelete[] = []
  const settled: { key: string; entry: DesktopSyncLastSyncedEntry }[] = []
  const droppedKeys: string[] = []

  const keys = new Set<string>([
    ...localByKey.keys(),
    ...remoteByKey.keys(),
    ...Object.keys(input.lastSynced),
  ])

  for (const key of keys) {
    const colon = key.indexOf(':')
    if (colon <= 0) continue
    const local = localByKey.get(key)
    const remote = remoteByKey.get(key)
    const last = input.lastSynced[key] as
      | DesktopSyncLastSyncedEntry
      | undefined
    const rootId = local?.rootId ?? remote?.rootId ?? key.slice(0, colon)
    const path = local?.path ?? remote?.path ?? key.slice(colon + 1)

    // A missing root means the directory itself is gone or unmounted — its
    // files must never be inferred as deletions (or touched at all). Skipped
    // files (too large / symlink / read error) are likewise absent from the
    // scan without being deleted, so they are excluded from every direction.
    if (missingRoots.has(rootId)) continue
    if (skippedKeys.has(key)) continue

    const remoteLive = remote != null && !remote.deleted ? remote : null
    const remoteTombstone = remote != null && remote.deleted

    if (local) {
      if (remoteLive) {
        if (local.hash === remoteLive.contentHash) {
          const entry: DesktopSyncLastSyncedEntry = {
            hash: local.hash,
            rev: remoteLive.rev,
            mtimeMs: local.mtimeMs,
            size: local.size,
          }
          if (
            !last ||
            last.hash !== entry.hash ||
            last.rev !== entry.rev ||
            last.mtimeMs !== entry.mtimeMs ||
            last.size !== entry.size
          ) {
            settled.push({ key, entry })
          }
          continue
        }
        const localChanged = !last || local.hash !== last.hash
        const remoteChanged = !last || remoteLive.contentHash !== last.hash
        if (localChanged && remoteChanged) {
          // True conflict: disk is truth, so the local file keeps the tracked
          // path (and re-uploads); the remote version lands beside it named
          // after the device that produced it.
          applies.push({
            key,
            rootId,
            path,
            remote: remoteLive,
            conflictCopyPath: conflictCopyPath(
              path,
              remoteLive.device.label || input.deviceLabel,
              input.now
            ),
          })
          uploads.push(uploadFor(key, local))
        } else if (localChanged) {
          uploads.push(uploadFor(key, local))
        } else {
          applies.push({ key, rootId, path, remote: remoteLive })
        }
        continue
      }
      if (remoteTombstone) {
        const localChanged = !last || local.hash !== last.hash
        if (localChanged) {
          // Local edit (or re-creation) outlives the tombstone: undelete.
          uploads.push(uploadFor(key, local))
        } else {
          deletesLocal.push({ key, rootId, path })
        }
        continue
      }
      // No remote doc: never uploaded (or remote store lost it). Upload.
      uploads.push(uploadFor(key, local))
      continue
    }

    // Local file absent from here down.
    if (!last) {
      if (remoteLive) applies.push({ key, rootId, path, remote: remoteLive })
      // A tombstone for a file this device never synced needs nothing.
      continue
    }
    if (remoteLive) {
      if (remoteLive.contentHash === last.hash) {
        deletesRemote.push({ key, rootId, path })
      } else {
        // Local delete raced a remote edit: restore the newer remote content
        // instead of tombstoning it.
        applies.push({ key, rootId, path, remote: remoteLive })
      }
      continue
    }
    // Gone on both sides (tombstone or missing remote): forget the key.
    droppedKeys.push(key)
  }

  const trackedCount =
    input.trackedCount ?? Object.keys(input.lastSynced).length
  const overAbsolute = deletesLocal.length > MASS_DELETE_ABSOLUTE
  const overFraction =
    deletesLocal.length >= MASS_DELETE_MINIMUM &&
    deletesLocal.length > trackedCount * MASS_DELETE_FRACTION
  if (overAbsolute || overFraction) {
    return {
      uploads,
      applies,
      deletesLocal: [],
      deletesRemote,
      settled,
      droppedKeys,
      guard: 'mass-delete',
      guardedDeletes: deletesLocal,
    }
  }

  return {
    uploads,
    applies,
    deletesLocal,
    deletesRemote,
    settled,
    droppedKeys,
    guard: null,
    guardedDeletes: [],
  }
}

function uploadFor(key: string, entry: DesktopSyncScanEntry): SyncPlanUpload {
  return {
    key,
    rootId: entry.rootId,
    path: entry.path,
    hash: entry.hash,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    executable: entry.executable,
  }
}
