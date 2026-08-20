import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDate } from '../firestore'
import {
  BACKUPS_COLLECTION,
  LIVE_SYNC_COLLECTION,
  SYNC_CHUNK_BYTES,
  SYNC_DEVICES_COLLECTION,
  SYNC_SCHEMA_VERSION,
  SyncRevConflictError,
  TRANSFERS_COLLECTION,
  type BackupContainer,
  type LiveSyncContainer,
  type SnapshotStore,
  type SnapshotStoreStats,
  type SnapshotStoreUploadInput,
  type SyncContainerBase,
  type SyncContainerKind,
  type SyncDeviceDoc,
  type SyncDeviceRef,
  type SyncFileDoc,
  type SyncRootRef,
  type TransferContainer,
} from './types'

const CONTAINER_COLLECTIONS: Record<SyncContainerKind, string> = {
  live: LIVE_SYNC_COLLECTION,
  backup: BACKUPS_COLLECTION,
  transfer: TRANSFERS_COLLECTION,
}

// Firestore batches cap at 500 ops; stay comfortably below.
const DELETE_BATCH_OPS = 400
const DELETE_PAGE_SIZE = 150
// 8 chunk docs × ~933KB base64 stays under the 10MiB commit payload cap.
const UPLOAD_CHUNKS_PER_BATCH = 8
const FETCH_CONCURRENCY = 4
const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Pure helpers.

// btoa/atob only handle code points 0-255, so raw bytes map 1:1 onto a binary
// string. Built in slices because String.fromCharCode(...bytes) overflows the
// argument limit on large files.
const BINARY_SLICE = 0x2000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BINARY_SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BINARY_SLICE))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function splitChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += SYNC_CHUNK_BYTES) {
    chunks.push(bytesToBase64(bytes.subarray(i, i + SYNC_CHUNK_BYTES)))
  }
  return chunks
}

export function joinChunks(chunks: string[]): Uint8Array {
  const parts = chunks.map(base64ToBytes)
  let total = 0
  for (const part of parts) total += part.length
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy so the digest input is always a plain ArrayBuffer-backed view
  // regardless of the caller's backing buffer.
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0')
  ).join('')
}

// File doc ids are content-addressed on the tracked key so every device
// derives the same id without coordination.
export async function syncFileDocId(
  rootId: string,
  path: string
): Promise<string> {
  const encoded = new TextEncoder().encode(`${rootId}:${path}`)
  return (await sha256Hex(encoded)).slice(0, 40)
}

export function randomSyncId(prefix: 'ws' | 'bk' | 'tr' | 'dev'): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('')
  return `${prefix}_${hex}`
}

function randomChunkVersion(): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('')
  return `up_${hex}`
}

// ---------------------------------------------------------------------------
// Defensive decoders. Cloud docs can be written by future/older clients, so
// every field falls back to a safe default; rows without a usable identity
// are skipped entirely.

export function decodeSyncFileDoc(
  raw: Record<string, unknown>,
  id: string
): SyncFileDoc | null {
  const rootId = typeof raw.rootId === 'string' ? raw.rootId : ''
  const path = typeof raw.path === 'string' ? raw.path : ''
  if (!rootId || !path || !isSafeRelPath(path)) return null
  return {
    id,
    rootId,
    path,
    deleted: raw.deleted === true,
    size: numberOr(raw.size, 0),
    contentHash: stringOr(raw.contentHash, ''),
    executable: raw.executable === true,
    chunkCount: Math.max(0, Math.floor(numberOr(raw.chunkCount, 0))),
    chunkVersion:
      typeof raw.chunkVersion === 'string' &&
      /^up_[a-f0-9]{20}$/.test(raw.chunkVersion)
        ? raw.chunkVersion
        : null,
    rev: numberOr(raw.rev, 0),
    modifiedAt: toDate(raw.modifiedAt) ?? null,
    updatedAt: toDate(raw.updatedAt) ?? null,
    device: decodeDeviceRef(raw.device),
  }
}

export function decodeLiveSyncContainer(
  raw: Record<string, unknown>,
  id: string
): LiveSyncContainer {
  return {
    ...decodeContainerBase(raw, id),
    status:
      raw.status === 'deleted'
        ? 'deleted'
        : raw.status === 'paused'
          ? 'paused'
          : 'active',
  }
}

export function decodeBackupContainer(
  raw: Record<string, unknown>,
  id: string
): BackupContainer {
  return {
    ...decodeContainerBase(raw, id),
    status: raw.status === 'complete' ? 'complete' : 'uploading',
  }
}

export function decodeTransferContainer(
  raw: Record<string, unknown>,
  id: string
): TransferContainer {
  const claimed = asRecord(raw.claimedBy)
  return {
    ...decodeContainerBase(raw, id),
    status:
      raw.status === 'ready'
        ? 'ready'
        : raw.status === 'received'
          ? 'received'
          : 'uploading',
    targetDeviceId:
      typeof raw.targetDeviceId === 'string' && raw.targetDeviceId.length > 0
        ? raw.targetDeviceId
        : null,
    claimedBy: claimed ? decodeDeviceRef(claimed) : null,
    expiresAt: toDate(raw.expiresAt) ?? new Date(0),
  }
}

export function decodeSyncDeviceDoc(
  raw: Record<string, unknown>,
  id: string
): SyncDeviceDoc {
  return {
    id,
    label: stringOr(raw.label, 'Unknown device').slice(0, 80),
    platform: stringOr(raw.platform, 'unknown'),
    appVersion: stringOr(raw.appVersion, 'unknown'),
    createdAt: toDate(raw.createdAt) ?? null,
    lastSeenAt: toDate(raw.lastSeenAt) ?? null,
  }
}

function decodeContainerBase(
  raw: Record<string, unknown>,
  id: string
): SyncContainerBase {
  return {
    id,
    name: stringOr(raw.name, 'Workspace').slice(0, 160),
    roots: decodeRoots(raw.roots),
    device: decodeDeviceRef(raw.device),
    createdAt: toDate(raw.createdAt) ?? new Date(0),
    updatedAt: toDate(raw.updatedAt) ?? toDate(raw.createdAt) ?? new Date(0),
    fileCount: numberOr(raw.fileCount, 0),
    totalBytes: numberOr(raw.totalBytes, 0),
  }
}

function decodeRoots(value: unknown): SyncRootRef[] {
  if (!Array.isArray(value)) return []
  const roots: SyncRootRef[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const id = record && typeof record.id === 'string' ? record.id : ''
    if (!id) continue
    roots.push({ id, name: stringOr(record?.name, id).slice(0, 120) })
  }
  return roots
}

function decodeDeviceRef(value: unknown): SyncDeviceRef {
  const record = asRecord(value)
  return {
    id: stringOr(record?.id, ''),
    label: stringOr(record?.label, ''),
  }
}

// The desktop main process re-validates every path, but hostile cloud rows
// should not survive past decode either: relative, '/'-separated, no '..' or
// empty segments, no backslashes.
function isSafeRelPath(path: string): boolean {
  if (path.length > 1024 || path.includes('\\')) return false
  const segments = path.split('/')
  return segments.every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function encodeDeviceRef(device: SyncDeviceRef): {
  id: string
  label: string
} {
  return { id: device.id.slice(0, 80), label: device.label.slice(0, 80) }
}

function encodeRoots(roots: SyncRootRef[]): { id: string; name: string }[] {
  return roots.map((root) => ({
    id: root.id.slice(0, 16),
    name: root.name.slice(0, 120),
  }))
}

// ---------------------------------------------------------------------------
// Firestore-backed store.

export function createSnapshotStore(uid: string): SnapshotStore {
  const containerRef = (
    kind: SyncContainerKind,
    containerId: string
  ): DocumentReference =>
    doc(db, 'users', uid, CONTAINER_COLLECTIONS[kind], containerId)

  const containersRef = (kind: SyncContainerKind): CollectionReference =>
    collection(db, 'users', uid, CONTAINER_COLLECTIONS[kind])

  const filesRef = (
    kind: SyncContainerKind,
    containerId: string
  ): CollectionReference =>
    collection(
      db,
      'users',
      uid,
      CONTAINER_COLLECTIONS[kind],
      containerId,
      'files'
    )

  const chunksRef = (
    kind: SyncContainerKind,
    containerId: string,
    fileId: string
  ): CollectionReference =>
    collection(
      db,
      'users',
      uid,
      CONTAINER_COLLECTIONS[kind],
      containerId,
      'files',
      fileId,
      'chunks'
    )

  const deleteRefsBatched = async (refs: DocumentReference[]) => {
    for (let start = 0; start < refs.length; start += DELETE_BATCH_OPS) {
      const batch = writeBatch(db)
      for (const ref of refs.slice(start, start + DELETE_BATCH_OPS)) {
        batch.delete(ref)
      }
      await batch.commit()
    }
  }

  const chunkDocId = (
    version: string | null,
    index: number
  ): string => (version ? `${version}_${index}` : String(index))

  const cleanupFileChunks = async (
    kind: SyncContainerKind,
    containerId: string,
    fileId: string,
    raw: Record<string, unknown> | null
  ) => {
    if (!raw) return
    const count = Math.max(0, Math.floor(numberOr(raw.chunkCount, 0)))
    const version =
      typeof raw.chunkVersion === 'string' &&
      /^up_[a-f0-9]{20}$/.test(raw.chunkVersion)
        ? raw.chunkVersion
        : null
    const refs: DocumentReference[] = []
    for (let index = 0; index < count; index += 1) {
      refs.push(
        doc(
          chunksRef(kind, containerId, fileId),
          chunkDocId(version, index)
        )
      )
    }
    await deleteRefsBatched(refs)
  }

  const commitFileMetadata = async (
    fileRef: DocumentReference,
    expectedBaseRev: number | null | 'unconditional',
    metadata: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> => {
    if (expectedBaseRev === 'unconditional') {
      const existing = await getDoc(fileRef)
      await setDoc(fileRef, metadata)
      return existing.exists()
        ? (existing.data() as Record<string, unknown>)
        : null
    }
    return runTransaction(db, async (transaction) => {
      const existing = await transaction.get(fileRef)
      const raw = existing.exists()
        ? (existing.data() as Record<string, unknown>)
        : null
      const actualRev = raw ? Math.floor(numberOr(raw.rev, 0)) : null
      if (actualRev !== expectedBaseRev) {
        throw new SyncRevConflictError(
          `Sync revision changed: expected ${String(
            expectedBaseRev
          )}, found ${String(actualRev)}.`
        )
      }
      transaction.set(fileRef, metadata)
      return raw
    })
  }

  return {
    async createLiveSync(input) {
      await setDoc(containerRef('live', input.syncId), {
        schemaVersion: SYNC_SCHEMA_VERSION,
        name: input.name.slice(0, 160),
        roots: encodeRoots(input.roots),
        device: encodeDeviceRef(input.device),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        fileCount: 0,
        totalBytes: 0,
        status: 'active',
      })
    },

    async setLiveSyncStatus(syncId, status) {
      await setDoc(
        containerRef('live', syncId),
        { status, updatedAt: serverTimestamp() },
        { merge: true }
      )
    },

    async createBackup(input) {
      await setDoc(containerRef('backup', input.backupId), {
        schemaVersion: SYNC_SCHEMA_VERSION,
        name: input.name.slice(0, 160),
        roots: encodeRoots(input.roots),
        device: encodeDeviceRef(input.device),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        fileCount: 0,
        totalBytes: 0,
        status: 'uploading',
      })
    },

    async finishBackup(backupId, stats) {
      await setDoc(
        containerRef('backup', backupId),
        {
          status: 'complete',
          fileCount: stats.fileCount,
          totalBytes: stats.totalBytes,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    },

    async createTransfer(input) {
      await setDoc(containerRef('transfer', input.transferId), {
        schemaVersion: SYNC_SCHEMA_VERSION,
        name: input.name.slice(0, 160),
        roots: encodeRoots(input.roots),
        device: encodeDeviceRef(input.device),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        fileCount: 0,
        totalBytes: 0,
        status: 'uploading',
        targetDeviceId: input.targetDeviceId,
        claimedBy: null,
        // serverTimestamp() cannot be offset, so the 7-day expiry is anchored
        // to the sender's clock.
        expiresAt: Timestamp.fromMillis(Date.now() + TRANSFER_TTL_MS),
      })
    },

    async markTransferReady(transferId, stats) {
      await setDoc(
        containerRef('transfer', transferId),
        {
          status: 'ready',
          fileCount: stats.fileCount,
          totalBytes: stats.totalBytes,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    },

    async markTransferReceived(transferId, device) {
      const ref = containerRef('transfer', transferId)
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists()) {
          throw new Error('Workspace transfer no longer exists')
        }
        const row = decodeTransferContainer(
          snapshot.data() as Record<string, unknown>,
          transferId
        )
        if (
          row.status !== 'ready' ||
          row.claimedBy?.id !== device.id ||
          row.expiresAt.getTime() <= Date.now()
        ) {
          throw new Error('Workspace transfer claim is no longer valid')
        }
        transaction.set(
          ref,
          {
            status: 'received',
            claimedBy: encodeDeviceRef(device),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      })
    },

    async claimTransfer(transferId, device) {
      const ref = containerRef('transfer', transferId)
      return runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists()) return false
        const row = decodeTransferContainer(
          snapshot.data() as Record<string, unknown>,
          transferId
        )
        if (
          row.status !== 'ready' ||
          row.expiresAt.getTime() <= Date.now() ||
          (row.targetDeviceId !== null &&
            row.targetDeviceId !== device.id) ||
          (row.claimedBy !== null && row.claimedBy.id !== device.id)
        ) {
          return false
        }
        transaction.set(
          ref,
          {
            claimedBy: encodeDeviceRef(device),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
        return true
      })
    },

    async releaseTransferClaim(transferId, device) {
      const ref = containerRef('transfer', transferId)
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists()) return
        const row = decodeTransferContainer(
          snapshot.data() as Record<string, unknown>,
          transferId
        )
        if (row.status !== 'ready' || row.claimedBy?.id !== device.id) {
          return
        }
        transaction.set(
          ref,
          {
            claimedBy: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      })
    },

    async fetchLiveSyncContainer(syncId) {
      const snapshot = await getDoc(containerRef('live', syncId))
      if (!snapshot.exists()) return null
      const container = decodeLiveSyncContainer(
        snapshot.data() as Record<string, unknown>,
        syncId
      )
      return container.status === 'deleted' ? null : container
    },

    async updateContainerStats(kind, containerId, stats: SnapshotStoreStats) {
      await setDoc(
        containerRef(kind, containerId),
        {
          fileCount: stats.fileCount,
          totalBytes: stats.totalBytes,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    },

    async deleteContainer(kind, containerId, onProgress) {
      if (kind === 'live') {
        // Publish the tombstone before cascading file data so every linked
        // engine detaches before an empty files snapshot can look like a
        // request to upload the whole local tree again.
        await setDoc(
          containerRef(kind, containerId),
          { status: 'deleted', updatedAt: serverTimestamp() },
          { merge: true }
        )
      }
      // Cascade chunks -> files -> container. Paged so arbitrarily large
      // snapshots delete without unbounded memory, and resumable: a partial
      // failure leaves docs a re-run will find again.
      let deletedFiles = 0
      for (;;) {
        const page = await getDocs(
          query(filesRef(kind, containerId), limit(DELETE_PAGE_SIZE))
        )
        if (page.empty) break
        for (const fileDoc of page.docs) {
          const chunkDocs = await getDocs(
            chunksRef(kind, containerId, fileDoc.id)
          )
          await deleteRefsBatched([
            ...chunkDocs.docs.map((chunkDoc) => chunkDoc.ref),
            fileDoc.ref,
          ])
          deletedFiles += 1
          onProgress?.(deletedFiles)
        }
      }
      if (kind !== 'live') {
        await deleteDoc(containerRef(kind, containerId))
      }
    },

    async uploadFile(kind, containerId, input: SnapshotStoreUploadInput) {
      if (input.path.length > 1024) {
        throw new Error(`Sync path exceeds 1024 characters: ${input.path.slice(0, 120)}…`)
      }
      const fileId = await syncFileDocId(input.rootId, input.path)
      const fileRef = doc(filesRef(kind, containerId), fileId)
      const chunks = splitChunks(input.bytes)
      const chunkVersion = randomChunkVersion()
      const uploadedRefs: DocumentReference[] = []

      // Chunk docs first, metadata last: a metadata doc must never reference
      // chunks that are not fully written yet. Every attempt gets an isolated
      // chunk prefix, so two writers racing for the same next rev cannot
      // overwrite the eventual winner's bytes.
      for (let start = 0; start < chunks.length; start += UPLOAD_CHUNKS_PER_BATCH) {
        const batch = writeBatch(db)
        for (
          let index = start;
          index < Math.min(start + UPLOAD_CHUNKS_PER_BATCH, chunks.length);
          index += 1
        ) {
          const chunkRef = doc(
            chunksRef(kind, containerId, fileId),
            chunkDocId(chunkVersion, index)
          )
          uploadedRefs.push(chunkRef)
          batch.set(chunkRef, { data: chunks[index] })
        }
        await batch.commit()
      }

      const metadata = {
        schemaVersion: SYNC_SCHEMA_VERSION,
        rootId: input.rootId,
        path: input.path,
        deleted: false,
        size: input.bytes.length,
        contentHash: input.hash,
        executable: input.executable,
        chunkCount: chunks.length,
        chunkVersion,
        rev: input.rev,
        modifiedAt: Timestamp.fromMillis(input.mtimeMs),
        updatedAt: serverTimestamp(),
        device: encodeDeviceRef(input.device),
      }
      let previous: Record<string, unknown> | null
      try {
        previous = await commitFileMetadata(
          fileRef,
          input.expectedBaseRev,
          metadata
        )
      } catch (error) {
        // This attempt never became visible. Its unique chunks are safe to
        // delete without touching the winning writer.
        await deleteRefsBatched(uploadedRefs).catch(() => {})
        throw error
      }
      // Metadata now points only at this attempt. Old chunks can be removed
      // without risking the current file version.
      await cleanupFileChunks(kind, containerId, fileId, previous)
    },

    async uploadTombstone(kind, containerId, input) {
      const fileId = await syncFileDocId(input.rootId, input.path)
      const fileRef = doc(filesRef(kind, containerId), fileId)
      // Tombstone metadata first (chunkCount 0), then chunk cleanup, so the
      // metadata never points at missing chunks mid-delete.
      const previous = await commitFileMetadata(
        fileRef,
        input.expectedBaseRev,
        {
        schemaVersion: SYNC_SCHEMA_VERSION,
        rootId: input.rootId,
        path: input.path,
        deleted: true,
        size: 0,
        contentHash: '',
        executable: false,
        chunkCount: 0,
        chunkVersion: null,
        rev: input.rev,
        updatedAt: serverTimestamp(),
        device: encodeDeviceRef(input.device),
        }
      )
      await cleanupFileChunks(kind, containerId, fileId, previous)
    },

    async listFiles(kind, containerId) {
      const snapshot = await getDocs(filesRef(kind, containerId))
      const rows: SyncFileDoc[] = []
      for (const item of snapshot.docs) {
        const decoded = decodeSyncFileDoc(
          item.data() as Record<string, unknown>,
          item.id
        )
        if (decoded) rows.push(decoded)
      }
      return rows
    },

    async fetchFileContent(kind, containerId, file) {
      const chunkCount = Math.max(0, Math.floor(file.chunkCount))
      const texts = new Array<string>(chunkCount)
      let nextIndex = 0
      const worker = async () => {
        for (;;) {
          const index = nextIndex
          if (index >= chunkCount) return
          nextIndex += 1
          const snapshot = await getDoc(
            doc(
              chunksRef(kind, containerId, file.id),
              chunkDocId(file.chunkVersion ?? null, index)
            )
          )
          const data = snapshot.exists()
            ? (snapshot.data() as Record<string, unknown>).data
            : null
          if (typeof data !== 'string') {
            throw new Error(
              `Sync chunk ${index}/${chunkCount} of ${file.path} is missing or malformed`
            )
          }
          texts[index] = data
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(FETCH_CONCURRENCY, chunkCount) }, worker)
      )
      let bytes: Uint8Array
      try {
        bytes = joinChunks(texts)
      } catch {
        throw new Error(`Sync content of ${file.path} is not valid base64`)
      }
      // Tombstones carry contentHash '' and no chunks; anything else must
      // verify end-to-end before touching disk.
      if (file.contentHash) {
        const hash = await sha256Hex(bytes)
        if (hash !== file.contentHash) {
          throw new Error(
            `Sync content hash mismatch for ${file.path}: expected ${file.contentHash}, got ${hash}`
          )
        }
      }
      return bytes
    },

    subscribeLiveSyncContainerDoc(syncId, callback, onError) {
      return onSnapshot(
        containerRef('live', syncId),
        (snapshot) => {
          callback(
            snapshot.exists()
              ? decodeLiveSyncContainer(
                  snapshot.data() as Record<string, unknown>,
                  syncId
                )
              : null
          )
        },
        (error) => onError?.(error)
      )
    },

    subscribeLiveSyncContainers(callback) {
      return onSnapshot(
        containersRef('live'),
        (snapshot) => {
          const rows = snapshot.docs
            .map((item) =>
              decodeLiveSyncContainer(
                item.data() as Record<string, unknown>,
                item.id
              )
            )
            .filter((row) => row.status !== 'deleted')
          // Sorted client-side: where()+orderBy() would need composite
          // indexes that are not provisioned for these collections.
          rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          callback(rows)
        },
        () => {
          // Transient listener errors keep the last delivered rows visible.
        }
      )
    },

    subscribeBackups(callback) {
      return onSnapshot(
        containersRef('backup'),
        (snapshot) => {
          const rows = snapshot.docs.map((item) =>
            decodeBackupContainer(
              item.data() as Record<string, unknown>,
              item.id
            )
          )
          rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          callback(rows)
        },
        () => {}
      )
    },

    subscribeTransfers(callback) {
      return onSnapshot(
        containersRef('transfer'),
        (snapshot) => {
          const rows = snapshot.docs.map((item) =>
            decodeTransferContainer(
              item.data() as Record<string, unknown>,
              item.id
            )
          )
          rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          callback(rows)
        },
        () => {}
      )
    },

    subscribeFiles(kind, containerId, callback) {
      return onSnapshot(
        filesRef(kind, containerId),
        (snapshot) => {
          const rows: SyncFileDoc[] = []
          for (const item of snapshot.docs) {
            const decoded = decodeSyncFileDoc(
              item.data() as Record<string, unknown>,
              item.id
            )
            if (decoded) rows.push(decoded)
          }
          rows.sort((a, b) =>
            a.rootId === b.rootId
              ? a.path.localeCompare(b.path)
              : a.rootId.localeCompare(b.rootId)
          )
          callback(rows)
        },
        () => {}
      )
    },

    subscribeDevices(callback) {
      return onSnapshot(
        collection(db, 'users', uid, SYNC_DEVICES_COLLECTION),
        (snapshot) => {
          const rows = snapshot.docs.map((item) =>
            decodeSyncDeviceDoc(
              item.data() as Record<string, unknown>,
              item.id
            )
          )
          rows.sort(
            (a, b) =>
              (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0)
          )
          callback(rows)
        },
        () => {}
      )
    },

    async upsertDevice(input) {
      const ref = doc(db, 'users', uid, SYNC_DEVICES_COLLECTION, input.id)
      const existing = await getDoc(ref)
      await setDoc(
        ref,
        {
          schemaVersion: SYNC_SCHEMA_VERSION,
          label: input.label.slice(0, 80),
          platform: input.platform,
          appVersion: input.appVersion,
          ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
          lastSeenAt: serverTimestamp(),
        },
        { merge: true }
      )
    },
  }
}
