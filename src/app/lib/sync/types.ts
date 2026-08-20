// Shared contracts for Workspace Sync & Backup: direct send, one-time backup,
// and live Firestore sync between the user's own devices. Cloud data lives in
// owner-only collections under users/{uid}; file content is chunked because
// Firestore caps documents at 1MiB.

export const SYNC_SCHEMA_VERSION = 1

// Raw bytes per chunk before base64 encoding (base64 of 700k ≈ 933KB < 1MiB).
export const SYNC_CHUNK_BYTES = 700_000

// Files larger than this are skipped and reported, never silently dropped.
export const SYNC_MAX_FILE_BYTES = 25 * 1024 * 1024

export type SyncContainerKind = 'live' | 'backup' | 'transfer'

export interface SyncDeviceRef {
  id: string
  label: string
}

export interface SyncRootRef {
  id: string
  name: string
}

export interface SyncContainerBase {
  id: string
  name: string
  roots: SyncRootRef[]
  device: SyncDeviceRef
  createdAt: Date
  updatedAt: Date
  fileCount: number
  totalBytes: number
}

export interface LiveSyncContainer extends SyncContainerBase {
  // 'deleted' is a permanent tombstone: the container doc survives a cloud
  // delete so still-linked devices detach instead of re-uploading everything.
  status: 'active' | 'paused' | 'deleted'
}

export interface BackupContainer extends SyncContainerBase {
  status: 'uploading' | 'complete'
}

export interface TransferContainer extends SyncContainerBase {
  status: 'uploading' | 'ready' | 'received'
  targetDeviceId: string | null
  claimedBy: SyncDeviceRef | null
  expiresAt: Date
}

export interface SyncFileDoc {
  id: string
  rootId: string
  path: string
  deleted: boolean
  size: number
  contentHash: string
  executable: boolean
  chunkCount: number
  // Versioned chunk prefix. Null reads legacy numeric chunk ids.
  chunkVersion?: string | null
  rev: number
  modifiedAt: Date | null
  updatedAt: Date | null
  device: SyncDeviceRef
}

export interface SyncDeviceDoc {
  id: string
  label: string
  platform: string
  appVersion: string
  createdAt: Date | null
  lastSeenAt: Date | null
}

// ---------------------------------------------------------------------------
// Desktop bridge (Electron IPC) contracts. The main process owns filesystem
// access, hashing, watching, and the per-device link-state files; it derives
// its authorized roots from those state files, independent of the currently
// open workspace.

export interface DesktopSyncRootMapping {
  rootId: string
  path: string
}

// State ids: ws_<20 hex> (live sync, watched), bk_/tr_<20 hex> (temporary
// scan/apply authorization for backups and transfers, never watched, removed
// when the one-shot operation finishes).
export interface DesktopSyncLinkState {
  version: 1
  syncId: string
  name: string
  // Firebase uid that created this link; engines must never run a link state
  // under a different signed-in account.
  ownerUid?: string
  // Pause survives app restarts.
  paused?: boolean
  rootMappings: DesktopSyncRootMapping[]
  lastSynced: Record<string, DesktopSyncLastSyncedEntry>
}

export interface DesktopSyncLastSyncedEntry {
  hash: string
  rev: number
  mtimeMs: number
  size: number
}

export interface DesktopSyncScanEntry {
  rootId: string
  path: string
  size: number
  mtimeMs: number
  hash: string
  executable: boolean
}

export interface DesktopSyncDeletedEntry {
  rootId: string
  path: string
  deleted: true
}

export interface DesktopSyncSkippedEntry {
  rootId: string
  path: string
  reason: 'too-large' | 'symlink' | 'error'
  size?: number
}

export interface DesktopSyncScanResult {
  ok: boolean
  entries: DesktopSyncScanEntry[]
  missingRoots: string[]
  skipped: DesktopSyncSkippedEntry[]
  error?: string
}

export interface DesktopSyncPathScanResult {
  ok: boolean
  entries: (DesktopSyncScanEntry | DesktopSyncDeletedEntry)[]
  // Paths that exist but cannot sync (oversized/symlink/error). Consumers must
  // treat these as "unknown, keep tracking" — never as deletions.
  skipped: DesktopSyncSkippedEntry[]
  error?: string
}

export interface DesktopSyncReadResult {
  ok: boolean
  base64?: string
  hash?: string
  size?: number
  executable?: boolean
  mtimeMs?: number
  missing?: boolean
  error?: string
}

export interface DesktopSyncApplyResult {
  ok: boolean
  hash?: string
  mtimeMs?: number
  error?: string
}

export interface DesktopSyncChangeEvent {
  syncId: string
  rootId: string
  // Relative '/'-separated paths; empty array means "rescan this root".
  paths: string[]
}

export interface DesktopSyncDeviceInfo {
  label: string
  platform: string
}

export interface DesktopWorkspaceSyncBridge {
  deviceInfo(): Promise<DesktopSyncDeviceInfo>
  loadState(syncId: string): Promise<DesktopSyncLinkState | null>
  saveState(syncId: string, state: DesktopSyncLinkState): Promise<boolean>
  removeState(syncId: string): Promise<boolean>
  listStates(): Promise<DesktopSyncLinkState[]>
  scan(syncId: string): Promise<DesktopSyncScanResult>
  scanPaths(
    syncId: string,
    rootId: string,
    relPaths: string[]
  ): Promise<DesktopSyncPathScanResult>
  read(
    syncId: string,
    rootId: string,
    relPath: string
  ): Promise<DesktopSyncReadResult>
  apply(
    syncId: string,
    rootId: string,
    relPath: string,
    content: { base64: string; executable?: boolean }
  ): Promise<DesktopSyncApplyResult>
  remove(
    syncId: string,
    rootId: string,
    relPath: string
  ): Promise<DesktopSyncApplyResult>
  // Empty basePath means the default destination base (~/StatsKey Synced).
  createRootFolder(
    basePath: string,
    name: string
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  chooseFolder(): Promise<string | null>
  onChanges(callback: (event: DesktopSyncChangeEvent) => void): () => void
}

// ---------------------------------------------------------------------------
// Firestore snapshot store contract (implemented in snapshotStore.ts, faked in
// tests). All methods operate on the signed-in user's own collections.

export interface SnapshotStoreStats {
  fileCount: number
  totalBytes: number
}

export interface SnapshotStoreUploadInput {
  rootId: string
  path: string
  bytes: Uint8Array
  hash: string
  executable: boolean
  mtimeMs: number
  rev: number
  // Rev the caller believes is current in the cloud (null = expects no doc).
  // Live-sync uploads run in a transaction that aborts with
  // SyncRevConflictError when the cloud doc's rev no longer matches, so a
  // concurrent upload from another device becomes a conflict instead of a
  // silent overwrite. Pass 'unconditional' for one-shot backup/transfer
  // snapshots that own their container exclusively.
  expectedBaseRev: number | null | 'unconditional'
  device: SyncDeviceRef
}

export class SyncRevConflictError extends Error {
  readonly code = 'sync-rev-conflict'
  constructor(message: string) {
    super(message)
    this.name = 'SyncRevConflictError'
  }
}

export interface SnapshotStore {
  createLiveSync(input: {
    syncId: string
    name: string
    roots: SyncRootRef[]
    device: SyncDeviceRef
  }): Promise<void>
  setLiveSyncStatus(syncId: string, status: 'active' | 'paused'): Promise<void>
  createBackup(input: {
    backupId: string
    name: string
    roots: SyncRootRef[]
    device: SyncDeviceRef
  }): Promise<void>
  finishBackup(backupId: string, stats: SnapshotStoreStats): Promise<void>
  createTransfer(input: {
    transferId: string
    name: string
    roots: SyncRootRef[]
    device: SyncDeviceRef
    targetDeviceId: string | null
  }): Promise<void>
  markTransferReady(
    transferId: string,
    stats: SnapshotStoreStats
  ): Promise<void>
  markTransferReceived(
    transferId: string,
    device: SyncDeviceRef
  ): Promise<void>
  // Transactionally claims a transfer for one device (claimedBy null → device).
  // Returns false when another device already holds the claim.
  claimTransfer(transferId: string, device: SyncDeviceRef): Promise<boolean>
  releaseTransferClaim(
    transferId: string,
    device: SyncDeviceRef
  ): Promise<void>
  fetchLiveSyncContainer(syncId: string): Promise<LiveSyncContainer | null>
  // Single-doc subscription used by engines to notice pause/delete from other
  // devices; emits null when the doc does not exist.
  subscribeLiveSyncContainerDoc(
    syncId: string,
    callback: (row: LiveSyncContainer | null) => void,
    onError?: (error: Error) => void
  ): () => void
  updateContainerStats(
    kind: SyncContainerKind,
    containerId: string,
    stats: SnapshotStoreStats
  ): Promise<void>
  deleteContainer(
    kind: SyncContainerKind,
    containerId: string,
    onProgress?: (deleted: number) => void
  ): Promise<void>
  uploadFile(
    kind: SyncContainerKind,
    containerId: string,
    input: SnapshotStoreUploadInput
  ): Promise<void>
  uploadTombstone(
    kind: SyncContainerKind,
    containerId: string,
    input: {
      rootId: string
      path: string
      rev: number
      expectedBaseRev: number | null | 'unconditional'
      device: SyncDeviceRef
    }
  ): Promise<void>
  listFiles(
    kind: SyncContainerKind,
    containerId: string
  ): Promise<SyncFileDoc[]>
  fetchFileContent(
    kind: SyncContainerKind,
    containerId: string,
    file: SyncFileDoc
  ): Promise<Uint8Array>
  subscribeLiveSyncContainers(
    callback: (rows: LiveSyncContainer[]) => void
  ): () => void
  subscribeBackups(callback: (rows: BackupContainer[]) => void): () => void
  subscribeTransfers(callback: (rows: TransferContainer[]) => void): () => void
  subscribeFiles(
    kind: SyncContainerKind,
    containerId: string,
    callback: (rows: SyncFileDoc[]) => void,
    onError?: (error: Error) => void
  ): () => void
  subscribeDevices(callback: (rows: SyncDeviceDoc[]) => void): () => void
  upsertDevice(input: {
    id: string
    label: string
    platform: string
    appVersion: string
  }): Promise<void>
}

// ---------------------------------------------------------------------------
// Live sync reconcile planner contracts (pure logic, no I/O).

export interface SyncPlanInput {
  localEntries: DesktopSyncScanEntry[]
  missingRoots: string[]
  skipped: DesktopSyncSkippedEntry[]
  remoteFiles: SyncFileDoc[]
  lastSynced: Record<string, DesktopSyncLastSyncedEntry>
  // Total tracked file count for the whole workspace. The mass-delete guard's
  // percentage denominator uses this, never the (possibly partial) size of
  // localEntries, so incremental reconciles cannot skew the threshold.
  trackedCount?: number
  deviceLabel: string
  now: Date
}

export interface SyncPlanUpload {
  key: string
  rootId: string
  path: string
  hash: string
  size: number
  mtimeMs: number
  executable: boolean
}

export interface SyncPlanApply {
  key: string
  rootId: string
  path: string
  remote: SyncFileDoc
  // When set, remote content is written to this sibling path instead of the
  // tracked path (conflict copy); the local file stays and is re-uploaded.
  conflictCopyPath?: string
}

export interface SyncPlanDelete {
  key: string
  rootId: string
  path: string
}

export interface SyncPlan {
  uploads: SyncPlanUpload[]
  applies: SyncPlanApply[]
  deletesLocal: SyncPlanDelete[]
  deletesRemote: SyncPlanDelete[]
  // Keys whose lastSynced entry should be updated even without I/O
  // (e.g. local and remote already match).
  settled: { key: string; entry: DesktopSyncLastSyncedEntry }[]
  droppedKeys: string[]
  guard: 'mass-delete' | null
  guardedDeletes: SyncPlanDelete[]
}

// ---------------------------------------------------------------------------
// Engine status surfaced to UI.

export type LiveSyncEngineState =
  | 'starting'
  | 'idle'
  | 'syncing'
  | 'paused'
  | 'offline'
  | 'attention'
  | 'error'

export interface LiveSyncStatus {
  syncId: string
  state: LiveSyncEngineState
  pendingUploads: number
  pendingApplies: number
  lastSyncedAt: Date | null
  skippedCount: number
  error: string | null
  guard: 'mass-delete' | null
  // Files held back by the mass-delete guard, so UI can say how many.
  guardedDeleteCount: number
  // Cloud container was deleted (or is missing) — engine stopped; the UI
  // should offer unlink.
  detached: boolean
}

export interface SyncProgress {
  done: number
  total: number
  currentPath: string
}

export const SYNC_DEVICE_ID_KEY = 'statskey.workspace-sync.device-id.v1'
export const SYNC_DEVICE_LABEL_KEY = 'statskey.workspace-sync.device-label.v1'

// Firestore collection names (under users/{uid}). These must stay absent from
// the default-subcollection exclusion list in the statskey project's
// firestore.rules, which is what makes them owner-writable from the client.
export const LIVE_SYNC_COLLECTION = 'workspaceLiveSync'
export const BACKUPS_COLLECTION = 'workspaceBackups'
export const TRANSFERS_COLLECTION = 'workspaceTransfers'
export const SYNC_DEVICES_COLLECTION = 'workspaceSyncDevices'

export function syncFileKey(rootId: string, path: string): string {
  return `${rootId}:${path}`
}

export function conflictCopyPath(
  path: string,
  deviceLabel: string,
  now: Date
): string {
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}.${pad(now.getMinutes())}`
  const label = deviceLabel.replace(/[/\\:]/g, '-').slice(0, 40) || 'device'
  return `${dir}${stem} (conflict from ${label} ${stamp})${ext}`
}
