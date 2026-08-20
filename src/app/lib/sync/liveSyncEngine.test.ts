import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DesktopSyncChangeEvent,
  type DesktopSyncLastSyncedEntry,
  type DesktopSyncLinkState,
  type DesktopSyncScanEntry,
  type DesktopWorkspaceSyncBridge,
  type LiveSyncContainer,
  type LiveSyncStatus,
  type SnapshotStore,
  type SnapshotStoreUploadInput,
  type SyncContainerKind,
  type SyncFileDoc,
} from './types'
import { createLiveSyncEngine } from './liveSyncEngine'

const SYNC_ID = `ws_${'a'.repeat(20)}`
const DEVICE = { id: `dev_${'1'.repeat(20)}`, label: 'TestMac' }

// Deterministic stand-in for content hashing: tests control both sides, so
// remote docs and the fake bridge share this convention.
const fakeHash = (base64: string) => `h_${base64}`
const b64 = (text: string) => btoa(text)
const byteLength = (base64: string) => atob(base64).length
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function drain(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function makeState(
  lastSynced: Record<string, DesktopSyncLastSyncedEntry> = {}
): DesktopSyncLinkState {
  return {
    version: 1,
    syncId: SYNC_ID,
    name: 'Test sync',
    rootMappings: [{ rootId: 'r1', path: '/ws/proj' }],
    lastSynced,
  }
}

function lastSyncedFor(
  text: string,
  rev: number,
  mtimeMs = 100
): DesktopSyncLastSyncedEntry {
  return {
    hash: fakeHash(b64(text)),
    rev,
    mtimeMs,
    size: byteLength(b64(text)),
  }
}

function remoteDoc(input: {
  rootId: string
  path: string
  content?: string
  deleted?: boolean
  rev: number
}): SyncFileDoc {
  const base64 = input.content == null ? '' : b64(input.content)
  const deleted = input.deleted === true
  return {
    id: `${input.rootId}:${input.path}`,
    rootId: input.rootId,
    path: input.path,
    deleted,
    size: deleted ? 0 : byteLength(base64),
    contentHash: deleted ? '' : fakeHash(base64),
    executable: false,
    chunkCount: deleted ? 0 : 1,
    rev: input.rev,
    modifiedAt: null,
    updatedAt: null,
    device: { id: `dev_${'2'.repeat(20)}`, label: 'Other device' },
  }
}

function createFakeBridge(
  options: {
    state?: DesktopSyncLinkState | null
    files?: Record<string, string>
    missingRoots?: string[]
  } = {}
) {
  const files = new Map<
    string,
    { base64: string; executable: boolean; mtimeMs: number }
  >()
  for (const [key, text] of Object.entries(options.files ?? {})) {
    files.set(key, { base64: b64(text), executable: false, mtimeMs: 100 })
  }
  const missingRoots = options.missingRoots ?? []
  const saveStateCalls: DesktopSyncLinkState[] = []
  const applyCalls: { rootId: string; path: string; base64: string }[] = []
  const removeCalls: { rootId: string; path: string }[] = []
  const listeners: ((event: DesktopSyncChangeEvent) => void)[] = []
  let state = options.state === undefined ? makeState() : options.state

  const entryFor = (key: string): DesktopSyncScanEntry => {
    const colon = key.indexOf(':')
    const rootId = key.slice(0, colon)
    const path = key.slice(colon + 1)
    const file = files.get(key)
    if (!file) throw new Error(`no fake file for ${key}`)
    return {
      rootId,
      path,
      size: byteLength(file.base64),
      mtimeMs: file.mtimeMs,
      hash: fakeHash(file.base64),
      executable: file.executable,
    }
  }

  const bridge: DesktopWorkspaceSyncBridge = {
    async deviceInfo() {
      return { label: 'TestMac', platform: 'darwin' }
    },
    async loadState() {
      return state
    },
    async saveState(_syncId, next) {
      state = next
      saveStateCalls.push(JSON.parse(JSON.stringify(next)))
      return true
    },
    async removeState() {
      state = null
      return true
    },
    async listStates() {
      return state ? [state] : []
    },
    async scan() {
      const entries = [...files.keys()]
        .filter((key) => !missingRoots.includes(key.slice(0, key.indexOf(':'))))
        .map(entryFor)
      return { ok: true, entries, missingRoots, skipped: [] }
    },
    async scanPaths(_syncId, rootId, relPaths) {
      return {
        ok: true,
        entries: relPaths.map((path) => {
          const key = `${rootId}:${path}`
          return files.has(key)
            ? entryFor(key)
            : { rootId, path, deleted: true as const }
        }),
        skipped: [],
      }
    },
    async read(_syncId, rootId, relPath) {
      const file = files.get(`${rootId}:${relPath}`)
      if (!file) return { ok: true, missing: true }
      return {
        ok: true,
        base64: file.base64,
        hash: fakeHash(file.base64),
        size: byteLength(file.base64),
        executable: file.executable,
        mtimeMs: file.mtimeMs,
      }
    },
    async apply(_syncId, rootId, relPath, content) {
      files.set(`${rootId}:${relPath}`, {
        base64: content.base64,
        executable: content.executable === true,
        mtimeMs: 200,
      })
      applyCalls.push({ rootId, path: relPath, base64: content.base64 })
      return { ok: true, hash: fakeHash(content.base64), mtimeMs: 200 }
    },
    async remove(_syncId, rootId, relPath) {
      files.delete(`${rootId}:${relPath}`)
      removeCalls.push({ rootId, path: relPath })
      return { ok: true }
    },
    async createRootFolder(basePath, name) {
      return { ok: true, path: `${basePath || '/base'}/${name}` }
    },
    async chooseFolder() {
      return null
    },
    onChanges(callback) {
      listeners.push(callback)
      return () => {
        const index = listeners.indexOf(callback)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }

  return {
    bridge,
    files,
    saveStateCalls,
    applyCalls,
    removeCalls,
    setFile(key: string, text: string, mtimeMs = 300) {
      files.set(key, { base64: b64(text), executable: false, mtimeMs })
    },
    deleteFile(key: string) {
      files.delete(key)
    },
    emitChange(event: DesktopSyncChangeEvent) {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

function createFakeStore(
  options: { files?: SyncFileDoc[]; listFilesFailures?: number } = {}
) {
  let remoteFiles = [...(options.files ?? [])]
  let listFilesFailures = options.listFilesFailures ?? 0
  let listFilesCalls = 0
  const uploadCalls: {
    kind: SyncContainerKind
    containerId: string
    input: SnapshotStoreUploadInput
  }[] = []
  const tombstoneCalls: {
    rootId: string
    path: string
    rev: number
    expectedBaseRev: number | null | 'unconditional'
  }[] = []
  const statsCalls: { fileCount: number; totalBytes: number }[] = []
  const statusCalls: ('active' | 'paused')[] = []
  const fileListeners: ((rows: SyncFileDoc[]) => void)[] = []
  const containerListeners: ((row: LiveSyncContainer | null) => void)[] = []
  let liveContainer: LiveSyncContainer | null = {
    id: SYNC_ID,
    name: 'Test sync',
    roots: [{ id: 'r1', name: 'proj' }],
    device: DEVICE,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    fileCount: remoteFiles.length,
    totalBytes: remoteFiles.reduce((sum, row) => sum + row.size, 0),
    status: 'active',
  }

  const upsertRemote = (doc: SyncFileDoc) => {
    remoteFiles = [
      ...remoteFiles.filter(
        (row) => !(row.rootId === doc.rootId && row.path === doc.path)
      ),
      doc,
    ]
  }

  const store: SnapshotStore = {
    async createLiveSync() {},
    async setLiveSyncStatus(_syncId, status) {
      statusCalls.push(status)
    },
    async createBackup() {},
    async finishBackup() {},
    async createTransfer() {},
    async markTransferReady() {},
    async markTransferReceived() {},
    async claimTransfer() {
      return true
    },
    async releaseTransferClaim() {},
    async fetchLiveSyncContainer() {
      return liveContainer
    },
    subscribeLiveSyncContainerDoc(_syncId, callback) {
      containerListeners.push(callback)
      return () => {
        const index = containerListeners.indexOf(callback)
        if (index >= 0) containerListeners.splice(index, 1)
      }
    },
    async updateContainerStats(_kind, _containerId, stats) {
      statsCalls.push(stats)
    },
    async deleteContainer() {},
    async uploadFile(kind, containerId, input) {
      uploadCalls.push({ kind, containerId, input })
      upsertRemote({
        id: `${input.rootId}:${input.path}`,
        rootId: input.rootId,
        path: input.path,
        deleted: false,
        size: input.bytes.length,
        contentHash: input.hash,
        executable: input.executable,
        chunkCount: 1,
        rev: input.rev,
        modifiedAt: null,
        updatedAt: null,
        device: input.device,
      })
    },
    async uploadTombstone(_kind, _containerId, input) {
      tombstoneCalls.push({
        rootId: input.rootId,
        path: input.path,
        rev: input.rev,
        expectedBaseRev: input.expectedBaseRev,
      })
    },
    async listFiles() {
      listFilesCalls += 1
      if (listFilesFailures > 0) {
        listFilesFailures -= 1
        throw new Error('network unavailable')
      }
      return [...remoteFiles]
    },
    async fetchFileContent(_kind, _containerId, file) {
      // Test convention: contentHash is 'h_' + base64 of the content.
      const binary = atob(file.contentHash.slice(2))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    },
    subscribeLiveSyncContainers() {
      return () => {}
    },
    subscribeBackups() {
      return () => {}
    },
    subscribeTransfers() {
      return () => {}
    },
    subscribeFiles(_kind, _containerId, callback) {
      fileListeners.push(callback)
      return () => {}
    },
    subscribeDevices() {
      return () => {}
    },
    async upsertDevice() {},
  }

  return {
    store,
    uploadCalls,
    tombstoneCalls,
    statsCalls,
    statusCalls,
    get listFilesCalls() {
      return listFilesCalls
    },
    emitFiles(rows: SyncFileDoc[]) {
      remoteFiles = [...rows]
      for (const listener of [...fileListeners]) listener([...rows])
    },
    emitContainer(row: LiveSyncContainer | null) {
      liveContainer = row
      for (const listener of [...containerListeners]) listener(row)
    },
  }
}

function makeEngine(
  bridgeFake: ReturnType<typeof createFakeBridge>,
  storeFake: ReturnType<typeof createFakeStore>
) {
  const statuses: LiveSyncStatus[] = []
  const announce = vi.fn()
  const engine = createLiveSyncEngine({
    store: storeFake.store,
    bridge: bridgeFake.bridge,
    syncId: SYNC_ID,
    device: DEVICE,
    onStatus: (status) => statuses.push(status),
    announceMutation: announce,
  })
  return { engine, statuses, announce }
}

describe('liveSyncEngine', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports an error status when no link state exists', async () => {
    const bridgeFake = createFakeBridge({ state: null })
    const storeFake = createFakeStore()
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()

    expect(statuses[0].state).toBe('starting')
    expect(statuses.at(-1)!.state).toBe('error')
    expect(statuses.at(-1)!.error).toMatch(/link state/i)
  })

  it('initial reconcile uploads local-only files and applies remote-only files', async () => {
    const bridgeFake = createFakeBridge({
      files: { 'r1:local.txt': 'local content' },
    })
    const storeFake = createFakeStore({
      files: [
        remoteDoc({
          rootId: 'r1',
          path: 'remote.txt',
          content: 'remote content',
          rev: 2,
        }),
      ],
    })
    const { engine, statuses, announce } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()

    expect(storeFake.uploadCalls).toHaveLength(1)
    const upload = storeFake.uploadCalls[0]
    expect(upload.kind).toBe('live')
    expect(upload.containerId).toBe(SYNC_ID)
    expect(upload.input.path).toBe('local.txt')
    expect(upload.input.rev).toBe(1)
    expect(upload.input.expectedBaseRev).toBeNull()
    expect(upload.input.hash).toBe(fakeHash(b64('local content')))
    expect(textOf(upload.input.bytes)).toBe('local content')

    expect(bridgeFake.applyCalls).toEqual([
      { rootId: 'r1', path: 'remote.txt', base64: b64('remote content') },
    ])
    expect(announce).toHaveBeenCalledWith([
      { rootId: 'r1', path: 'remote.txt', kind: 'write' },
    ])

    const saved = bridgeFake.saveStateCalls.at(-1)!
    expect(saved.lastSynced['r1:local.txt']).toMatchObject({ rev: 1 })
    expect(saved.lastSynced['r1:remote.txt']).toMatchObject({
      rev: 2,
      hash: fakeHash(b64('remote content')),
    })

    expect(statuses[0].state).toBe('starting')
    expect(statuses.some((status) => status.state === 'syncing')).toBe(true)
    const final = statuses.at(-1)!
    expect(final.state).toBe('idle')
    expect(final.lastSyncedAt).not.toBeNull()

    expect(storeFake.statsCalls.at(-1)).toEqual({
      fileCount: 2,
      totalBytes: 'local content'.length + 'remote content'.length,
    })

    engine.stop()
  })

  it('uploads a locally changed file with a bumped rev on a change event', async () => {
    const bridgeFake = createFakeBridge({
      state: makeState({ 'r1:a.txt': lastSyncedFor('v1', 3) }),
      files: { 'r1:a.txt': 'v1' },
    })
    const storeFake = createFakeStore({
      files: [remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v1', rev: 3 })],
    })
    const { engine } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()
    expect(storeFake.uploadCalls).toHaveLength(0)

    bridgeFake.setFile('r1:a.txt', 'v2', 400)
    bridgeFake.emitChange({ syncId: SYNC_ID, rootId: 'r1', paths: ['a.txt'] })
    await drain()

    expect(storeFake.uploadCalls).toHaveLength(1)
    const upload = storeFake.uploadCalls[0]
    expect(upload.input.path).toBe('a.txt')
    expect(upload.input.rev).toBe(4)
    expect(upload.input.expectedBaseRev).toBe(3)
    expect(upload.input.hash).toBe(fakeHash(b64('v2')))
    expect(bridgeFake.saveStateCalls.at(-1)!.lastSynced['r1:a.txt']).toEqual({
      hash: fakeHash(b64('v2')),
      rev: 4,
      mtimeMs: 400,
      size: 2,
    })

    engine.stop()
  })

  it('tombstones a local deletion against the exact remote revision', async () => {
    const bridgeFake = createFakeBridge({
      state: makeState({ 'r1:a.txt': lastSyncedFor('v1', 3) }),
      files: { 'r1:a.txt': 'v1' },
    })
    const storeFake = createFakeStore({
      files: [
        remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v1', rev: 3 }),
      ],
    })
    const { engine } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()
    bridgeFake.deleteFile('r1:a.txt')
    bridgeFake.emitChange({
      syncId: SYNC_ID,
      rootId: 'r1',
      paths: ['a.txt'],
    })
    await drain()

    expect(storeFake.tombstoneCalls).toEqual([
      {
        rootId: 'r1',
        path: 'a.txt',
        rev: 4,
        expectedBaseRev: 3,
      },
    ])
    engine.stop()
  })

  it('honors a persisted pause before any scan and resumes explicitly', async () => {
    const bridgeFake = createFakeBridge({
      state: { ...makeState(), paused: true },
      files: { 'r1:a.txt': 'v1' },
    })
    const storeFake = createFakeStore()
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()
    expect(storeFake.listFilesCalls).toBe(0)
    expect(statuses.at(-1)).toMatchObject({
      state: 'paused',
      guardedDeleteCount: 0,
      detached: false,
    })

    await engine.resume()
    await drain()
    expect(storeFake.statusCalls).toContain('active')
    expect(storeFake.listFilesCalls).toBe(1)
    expect(bridgeFake.saveStateCalls.at(-1)!.paused).toBe(false)
    engine.stop()
  })

  it('surfaces a deleted cloud container as a detached link', async () => {
    const bridgeFake = createFakeBridge()
    const storeFake = createFakeStore()
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()
    storeFake.emitContainer(null)
    await drain()

    expect(statuses.at(-1)).toMatchObject({
      state: 'attention',
      detached: true,
      pendingUploads: 0,
      pendingApplies: 0,
    })
    engine.stop()
  })

  it('applies a remote metadata row, updates lastSynced, and announces the mutation', async () => {
    const bridgeFake = createFakeBridge({
      state: makeState({ 'r1:a.txt': lastSyncedFor('v1', 3) }),
      files: { 'r1:a.txt': 'v1' },
    })
    const storeFake = createFakeStore({
      files: [remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v1', rev: 3 })],
    })
    const { engine, announce } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()

    storeFake.emitFiles([
      remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v2', rev: 4 }),
    ])
    await drain()

    expect(bridgeFake.applyCalls).toEqual([
      { rootId: 'r1', path: 'a.txt', base64: b64('v2') },
    ])
    expect(announce).toHaveBeenCalledWith([
      { rootId: 'r1', path: 'a.txt', kind: 'write' },
    ])
    expect(bridgeFake.saveStateCalls.at(-1)!.lastSynced['r1:a.txt']).toEqual({
      hash: fakeHash(b64('v2')),
      rev: 4,
      mtimeMs: 200,
      size: 2,
    })
    expect(storeFake.uploadCalls).toHaveLength(0)

    engine.stop()
  })

  it('suppresses the watcher echo of its own apply, then still reacts to real edits', async () => {
    const bridgeFake = createFakeBridge({
      state: makeState({ 'r1:a.txt': lastSyncedFor('v1', 3) }),
      files: { 'r1:a.txt': 'v1' },
    })
    const storeFake = createFakeStore({
      files: [remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v1', rev: 3 })],
    })
    const { engine } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()
    storeFake.emitFiles([
      remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v2', rev: 4 }),
    ])
    await drain()
    expect(bridgeFake.applyCalls).toHaveLength(1)

    // Watcher echo of the engine's own write: must not re-upload.
    bridgeFake.emitChange({ syncId: SYNC_ID, rootId: 'r1', paths: ['a.txt'] })
    await drain()
    expect(storeFake.uploadCalls).toHaveLength(0)

    // A real edit afterwards still syncs.
    bridgeFake.setFile('r1:a.txt', 'v3', 500)
    bridgeFake.emitChange({ syncId: SYNC_ID, rootId: 'r1', paths: ['a.txt'] })
    await drain()
    expect(storeFake.uploadCalls).toHaveLength(1)
    expect(storeFake.uploadCalls[0].input.rev).toBe(5)

    engine.stop()
  })

  it('writes a conflict copy and re-uploads the local original on a two-sided change', async () => {
    const bridgeFake = createFakeBridge({
      state: makeState({ 'r1:a.txt': lastSyncedFor('v1', 3) }),
      files: { 'r1:a.txt': 'v-local' },
    })
    const storeFake = createFakeStore({
      files: [
        remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v-remote', rev: 4 }),
      ],
    })
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()

    expect(bridgeFake.applyCalls).toHaveLength(1)
    const conflictWrite = bridgeFake.applyCalls[0]
    expect(conflictWrite.path).toMatch(/^a \(conflict from /)
    expect(conflictWrite.path.endsWith('.txt')).toBe(true)
    expect(conflictWrite.base64).toBe(b64('v-remote'))

    expect(storeFake.uploadCalls).toHaveLength(1)
    const upload = storeFake.uploadCalls[0]
    expect(upload.input.path).toBe('a.txt')
    expect(upload.input.hash).toBe(fakeHash(b64('v-local')))
    expect(upload.input.rev).toBe(5)
    expect(upload.input.expectedBaseRev).toBe(4)

    expect(bridgeFake.saveStateCalls.at(-1)!.lastSynced['r1:a.txt']).toMatchObject(
      { hash: fakeHash(b64('v-local')), rev: 5 }
    )
    expect(statuses.at(-1)!.state).toBe('attention')

    engine.stop()
  })

  it('holds a mass-delete behind the guard until confirmGuardedDeletes executes it', async () => {
    const files: Record<string, string> = {}
    const lastSynced: Record<string, DesktopSyncLastSyncedEntry> = {}
    const tombstones: SyncFileDoc[] = []
    for (let i = 0; i < 12; i += 1) {
      const path = `f${i}.txt`
      files[`r1:${path}`] = `content-${i}`
      lastSynced[`r1:${path}`] = lastSyncedFor(`content-${i}`, 1)
      tombstones.push(
        remoteDoc({ rootId: 'r1', path, deleted: true, rev: 2 })
      )
    }
    const bridgeFake = createFakeBridge({
      state: makeState(lastSynced),
      files,
    })
    const storeFake = createFakeStore({ files: tombstones })
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()

    expect(bridgeFake.removeCalls).toHaveLength(0)
    expect(statuses.at(-1)!.guard).toBe('mass-delete')
    expect(statuses.at(-1)!.guardedDeleteCount).toBe(12)
    expect(statuses.at(-1)!.state).toBe('attention')

    await engine.confirmGuardedDeletes()
    await drain()

    expect(bridgeFake.removeCalls).toHaveLength(12)
    expect(bridgeFake.saveStateCalls.at(-1)!.lastSynced).toEqual({})
    expect(storeFake.statsCalls.at(-1)).toEqual({ fileCount: 0, totalBytes: 0 })
    expect(statuses.at(-1)!.state).toBe('idle')
    expect(statuses.at(-1)!.guard).toBeNull()
    expect(statuses.at(-1)!.guardedDeleteCount).toBe(0)

    engine.stop()
  })

  it('dismissGuardedDeletes re-uploads the local files instead of deleting them', async () => {
    const files: Record<string, string> = {}
    const lastSynced: Record<string, DesktopSyncLastSyncedEntry> = {}
    const tombstones: SyncFileDoc[] = []
    for (let i = 0; i < 12; i += 1) {
      const path = `f${i}.txt`
      files[`r1:${path}`] = `content-${i}`
      lastSynced[`r1:${path}`] = lastSyncedFor(`content-${i}`, 1)
      tombstones.push(
        remoteDoc({ rootId: 'r1', path, deleted: true, rev: 2 })
      )
    }
    const bridgeFake = createFakeBridge({
      state: makeState(lastSynced),
      files,
    })
    const storeFake = createFakeStore({ files: tombstones })
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()
    expect(statuses.at(-1)!.guard).toBe('mass-delete')

    await engine.dismissGuardedDeletes()
    await drain()

    expect(bridgeFake.removeCalls).toHaveLength(0)
    expect(storeFake.uploadCalls).toHaveLength(12)
    for (const upload of storeFake.uploadCalls) {
      // Undelete semantics: rev bumps past the remote tombstone.
      expect(upload.input.rev).toBe(3)
    }
    expect(statuses.at(-1)!.state).toBe('idle')
    expect(statuses.at(-1)!.guard).toBeNull()

    engine.stop()
  })

  it('never tombstones remote files when the local root is missing', async () => {
    const bridgeFake = createFakeBridge({
      state: makeState({ 'r1:a.txt': lastSyncedFor('v1', 3) }),
      files: { 'r1:a.txt': 'v1' },
      missingRoots: ['r1'],
    })
    const storeFake = createFakeStore({
      files: [remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v1', rev: 3 })],
    })
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()

    expect(storeFake.tombstoneCalls).toHaveLength(0)
    expect(bridgeFake.applyCalls).toHaveLength(0)
    expect(bridgeFake.removeCalls).toHaveLength(0)
    expect(storeFake.uploadCalls).toHaveLength(0)
    expect(statuses.at(-1)!.state).toBe('idle')

    engine.stop()
  })

  it('goes offline on a network failure and recovers on the retry', async () => {
    vi.useFakeTimers()
    const bridgeFake = createFakeBridge({ files: { 'r1:a.txt': 'v1' } })
    const storeFake = createFakeStore({ listFilesFailures: 1 })
    const { engine, statuses } = makeEngine(bridgeFake, storeFake)

    await engine.start()

    expect(statuses.at(-1)!.state).toBe('offline')
    expect(storeFake.listFilesCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(5000)

    expect(storeFake.listFilesCalls).toBe(2)
    expect(storeFake.uploadCalls).toHaveLength(1)
    expect(storeFake.uploadCalls[0].input.path).toBe('a.txt')
    expect(statuses.at(-1)!.state).toBe('idle')

    engine.stop()
  })

  it('stop() flushes lastSynced to the bridge immediately', async () => {
    const bridgeFake = createFakeBridge({
      state: makeState({ 'r1:a.txt': lastSyncedFor('v1', 3) }),
      files: { 'r1:a.txt': 'v1' },
    })
    const storeFake = createFakeStore({
      files: [remoteDoc({ rootId: 'r1', path: 'a.txt', content: 'v1', rev: 3 })],
    })
    const { engine } = makeEngine(bridgeFake, storeFake)

    await engine.start()
    await drain()
    const savesBeforeStop = bridgeFake.saveStateCalls.length

    engine.stop()
    await drain()

    expect(bridgeFake.saveStateCalls).toHaveLength(savesBeforeStop + 1)
    expect(
      bridgeFake.saveStateCalls.at(-1)!.lastSynced['r1:a.txt']
    ).toMatchObject({ hash: fakeHash(b64('v1')), rev: 3 })
  })
})
