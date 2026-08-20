import { describe, expect, it } from 'vitest'
import {
  type BackupContainer,
  type DesktopWorkspaceSyncBridge,
  type SnapshotStore,
  type SnapshotStoreUploadInput,
  type SyncContainerKind,
  type SyncFileDoc,
  type SyncProgress,
  type SyncRootRef,
  type TransferContainer,
} from './types'
import {
  createBackup,
  receiveTransfer,
  restoreBackup,
  sendWorkspace,
} from './transferBackup'

const DEVICE = { id: `dev_${'1'.repeat(20)}`, label: 'TestMac' }
const SENDER = { id: `dev_${'2'.repeat(20)}`, label: 'Sender MacBook' }

// Same convention as the engine tests: contentHash is 'h_' + base64.
const fakeHash = (base64: string) => `h_${base64}`
const b64 = (text: string) => btoa(text)
const byteLength = (base64: string) => atob(base64).length
const bytesOf = (base64: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function expectMonotonic(progress: SyncProgress[], total: number): void {
  expect(progress.length).toBeGreaterThan(0)
  let previous = -1
  for (const step of progress) {
    expect(step.total).toBe(total)
    expect(step.done).toBeGreaterThanOrEqual(previous)
    previous = step.done
  }
  expect(progress[0].done).toBe(0)
  expect(progress.at(-1)!.done).toBe(total)
}

// Path-based fake of the desktop runtime: a flat "disk" of absolute paths, a
// set of existing directories, and link states that authorize roots exactly
// the way the real main process does.
function createFsBridge() {
  const disk = new Map<
    string,
    { base64: string; executable: boolean; mtimeMs: number }
  >()
  const dirs = new Set<string>()
  const states = new Map<
    string,
    { rootMappings: { rootId: string; path: string }[] }
  >()
  const saveStateCalls: string[] = []
  const removeStateCalls: string[] = []

  const mappingFor = (syncId: string, rootId: string) =>
    states.get(syncId)?.rootMappings.find((m) => m.rootId === rootId) ?? null

  const bridge: DesktopWorkspaceSyncBridge = {
    async deviceInfo() {
      return { label: 'TestMac', platform: 'darwin' }
    },
    async loadState() {
      return null
    },
    async saveState(syncId, state) {
      states.set(syncId, { rootMappings: state.rootMappings })
      saveStateCalls.push(syncId)
      return true
    },
    async removeState(syncId) {
      states.delete(syncId)
      removeStateCalls.push(syncId)
      return true
    },
    async listStates() {
      return []
    },
    async scan(syncId) {
      const state = states.get(syncId)
      if (!state) {
        return {
          ok: false,
          entries: [],
          missingRoots: [],
          skipped: [],
          error: 'unknown sync id',
        }
      }
      const entries = []
      const missingRoots: string[] = []
      for (const mapping of state.rootMappings) {
        if (!dirs.has(mapping.path)) {
          missingRoots.push(mapping.rootId)
          continue
        }
        for (const [absPath, file] of disk) {
          if (!absPath.startsWith(`${mapping.path}/`)) continue
          entries.push({
            rootId: mapping.rootId,
            path: absPath.slice(mapping.path.length + 1),
            size: byteLength(file.base64),
            mtimeMs: file.mtimeMs,
            hash: fakeHash(file.base64),
            executable: file.executable,
          })
        }
      }
      return { ok: true, entries, missingRoots, skipped: [] }
    },
    async scanPaths() {
      return { ok: true, entries: [], skipped: [] }
    },
    async read(syncId, rootId, relPath) {
      const mapping = mappingFor(syncId, rootId)
      const file = mapping ? disk.get(`${mapping.path}/${relPath}`) : undefined
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
    async apply(syncId, rootId, relPath, content) {
      const mapping = mappingFor(syncId, rootId)
      if (!mapping) return { ok: false, error: 'unauthorized root' }
      disk.set(`${mapping.path}/${relPath}`, {
        base64: content.base64,
        executable: content.executable === true,
        mtimeMs: 500,
      })
      return { ok: true, hash: fakeHash(content.base64), mtimeMs: 500 }
    },
    async remove(syncId, rootId, relPath) {
      const mapping = mappingFor(syncId, rootId)
      if (mapping) disk.delete(`${mapping.path}/${relPath}`)
      return { ok: true }
    },
    async createRootFolder(basePath, name) {
      const base = basePath || '/home/user/StatsKey Synced'
      let path = `${base}/${name}`
      let suffix = 2
      while (dirs.has(path)) {
        path = `${base}/${name} ${suffix}`
        suffix += 1
      }
      dirs.add(path)
      return { ok: true, path }
    },
    async chooseFolder() {
      return null
    },
    onChanges() {
      return () => {}
    },
  }

  return {
    bridge,
    states,
    saveStateCalls,
    removeStateCalls,
    addDir(path: string) {
      dirs.add(path)
    },
    writeFile(absPath: string, text: string) {
      disk.set(absPath, { base64: b64(text), executable: false, mtimeMs: 100 })
    },
    readText(absPath: string) {
      const file = disk.get(absPath)
      return file ? new TextDecoder().decode(bytesOf(file.base64)) : null
    },
  }
}

function createFakeStore() {
  const docs = new Map<string, SyncFileDoc[]>()
  const bytesByKey = new Map<string, Uint8Array>()
  const uploadCalls: {
    kind: SyncContainerKind
    containerId: string
    input: SnapshotStoreUploadInput
  }[] = []
  const createTransferCalls: {
    transferId: string
    name: string
    roots: SyncRootRef[]
    targetDeviceId: string | null
  }[] = []
  const markReadyCalls: {
    transferId: string
    stats: { fileCount: number; totalBytes: number }
  }[] = []
  const markReceivedCalls: { transferId: string; deviceId: string }[] = []
  const createBackupCalls: { backupId: string; roots: SyncRootRef[] }[] = []
  const finishBackupCalls: {
    backupId: string
    stats: { fileCount: number; totalBytes: number }
  }[] = []
  const claimCalls: { transferId: string; deviceId: string }[] = []
  const releaseClaimCalls: { transferId: string; deviceId: string }[] = []
  let claimAllowed = true
  let failFetch = false

  const store: SnapshotStore = {
    async createLiveSync() {},
    async setLiveSyncStatus() {},
    async createBackup(input) {
      createBackupCalls.push({ backupId: input.backupId, roots: input.roots })
    },
    async finishBackup(backupId, stats) {
      finishBackupCalls.push({ backupId, stats })
    },
    async createTransfer(input) {
      createTransferCalls.push({
        transferId: input.transferId,
        name: input.name,
        roots: input.roots,
        targetDeviceId: input.targetDeviceId,
      })
    },
    async markTransferReady(transferId, stats) {
      markReadyCalls.push({ transferId, stats })
    },
    async markTransferReceived(transferId, device) {
      markReceivedCalls.push({ transferId, deviceId: device.id })
    },
    async claimTransfer(transferId, device) {
      claimCalls.push({ transferId, deviceId: device.id })
      return claimAllowed
    },
    async releaseTransferClaim(transferId, device) {
      releaseClaimCalls.push({ transferId, deviceId: device.id })
    },
    async fetchLiveSyncContainer() {
      return null
    },
    subscribeLiveSyncContainerDoc() {
      return () => {}
    },
    async updateContainerStats() {},
    async deleteContainer() {},
    async uploadFile(kind, containerId, input) {
      uploadCalls.push({ kind, containerId, input })
      const containerKey = `${kind}/${containerId}`
      const list = docs.get(containerKey) ?? []
      list.push({
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
      docs.set(containerKey, list)
      bytesByKey.set(
        `${containerKey}/${input.rootId}:${input.path}`,
        input.bytes
      )
    },
    async uploadTombstone() {},
    async listFiles(kind, containerId) {
      return [...(docs.get(`${kind}/${containerId}`) ?? [])]
    },
    async fetchFileContent(kind, containerId, file) {
      if (failFetch) throw new Error('chunk fetch failed')
      const stored = bytesByKey.get(
        `${kind}/${containerId}/${file.rootId}:${file.path}`
      )
      if (stored) return stored
      // Seeded docs derive content from the test hash convention.
      return bytesOf(file.contentHash.slice(2))
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
    subscribeFiles() {
      return () => {}
    },
    subscribeDevices() {
      return () => {}
    },
    async upsertDevice() {},
  }

  return {
    store,
    docs,
    uploadCalls,
    createTransferCalls,
    markReadyCalls,
    markReceivedCalls,
    claimCalls,
    releaseClaimCalls,
    createBackupCalls,
    finishBackupCalls,
    seedFiles(kind: SyncContainerKind, containerId: string, rows: SyncFileDoc[]) {
      docs.set(`${kind}/${containerId}`, [...rows])
    },
    setFailFetch(value: boolean) {
      failFetch = value
    },
    setClaimAllowed(value: boolean) {
      claimAllowed = value
    },
  }
}

function transferContainer(input: {
  id: string
  roots: SyncRootRef[]
}): TransferContainer {
  return {
    id: input.id,
    name: 'My workspace',
    roots: input.roots,
    device: SENDER,
    createdAt: new Date('2026-08-18T10:00:00Z'),
    updatedAt: new Date('2026-08-18T10:00:00Z'),
    fileCount: 1,
    totalBytes: 5,
    status: 'ready',
    targetDeviceId: null,
    claimedBy: null,
    expiresAt: new Date('2026-08-25T10:00:00Z'),
  }
}

describe('sendWorkspace', () => {
  it('uploads every scanned file, marks the transfer ready, and removes the temp state', async () => {
    const fs = createFsBridge()
    fs.addDir('/ws/proj')
    fs.writeFile('/ws/proj/a.txt', 'alpha')
    fs.writeFile('/ws/proj/sub/b.txt', 'beta')
    const storeFake = createFakeStore()
    const progress: SyncProgress[] = []

    const result = await sendWorkspace({
      store: storeFake.store,
      bridge: fs.bridge,
      device: DEVICE,
      name: 'My workspace',
      rootPaths: ['/ws/proj'],
      targetDeviceId: 'dev_target',
      onProgress: (p) => progress.push(p),
    })

    expect(result.transferId).toMatch(/^tr_[0-9a-f]{20}$/)

    expect(storeFake.createTransferCalls).toHaveLength(1)
    const created = storeFake.createTransferCalls[0]
    expect(created.transferId).toBe(result.transferId)
    expect(created.name).toBe('My workspace')
    expect(created.targetDeviceId).toBe('dev_target')
    expect(created.roots).toHaveLength(1)
    expect(created.roots[0].id).toMatch(/^[0-9a-f]{8}$/)
    expect(created.roots[0].name).toBe('proj')

    expect(storeFake.uploadCalls).toHaveLength(2)
    const paths = storeFake.uploadCalls.map((call) => call.input.path).sort()
    expect(paths).toEqual(['a.txt', 'sub/b.txt'])
    for (const call of storeFake.uploadCalls) {
      expect(call.kind).toBe('transfer')
      expect(call.containerId).toBe(result.transferId)
      expect(call.input.rev).toBe(1)
      expect(call.input.expectedBaseRev).toBe('unconditional')
      expect(call.input.rootId).toBe(created.roots[0].id)
    }

    expect(storeFake.markReadyCalls).toEqual([
      {
        transferId: result.transferId,
        stats: { fileCount: 2, totalBytes: 'alpha'.length + 'beta'.length },
      },
    ])

    expect(fs.removeStateCalls).toEqual([result.transferId])
    expect(fs.states.size).toBe(0)

    expectMonotonic(progress, 2)
  })
})

describe('receiveTransfer', () => {
  it('creates root folders, applies non-deleted files, marks received, and cleans up', async () => {
    const fs = createFsBridge()
    const storeFake = createFakeStore()
    const transferId = `tr_${'b'.repeat(20)}`
    const roots: SyncRootRef[] = [{ id: 'aabbccdd', name: 'proj' }]
    storeFake.seedFiles('transfer', transferId, [
      {
        id: 'aabbccdd:a.txt',
        rootId: 'aabbccdd',
        path: 'a.txt',
        deleted: false,
        size: 5,
        contentHash: fakeHash(b64('alpha')),
        executable: false,
        chunkCount: 1,
        rev: 1,
        modifiedAt: null,
        updatedAt: null,
        device: SENDER,
      },
      {
        id: 'aabbccdd:gone.txt',
        rootId: 'aabbccdd',
        path: 'gone.txt',
        deleted: true,
        size: 0,
        contentHash: '',
        executable: false,
        chunkCount: 0,
        rev: 2,
        modifiedAt: null,
        updatedAt: null,
        device: SENDER,
      },
    ])
    const progress: SyncProgress[] = []

    const result = await receiveTransfer({
      store: storeFake.store,
      bridge: fs.bridge,
      device: DEVICE,
      transfer: transferContainer({ id: transferId, roots }),
      destBase: '/dest',
      onProgress: (p) => progress.push(p),
    })

    expect(result.rootPaths).toEqual(['/dest/proj'])
    expect(fs.readText('/dest/proj/a.txt')).toBe('alpha')
    expect(fs.readText('/dest/proj/gone.txt')).toBeNull()
    expect(storeFake.markReceivedCalls).toEqual([
      { transferId, deviceId: DEVICE.id },
    ])
    expect(storeFake.claimCalls).toEqual([
      { transferId, deviceId: DEVICE.id },
    ])
    expect(storeFake.releaseClaimCalls).toEqual([])
    expect(fs.states.size).toBe(0)
    expect(fs.removeStateCalls).toHaveLength(1)
    expect(fs.removeStateCalls[0]).toMatch(/^tr_[0-9a-f]{20}$/)
    expectMonotonic(progress, 1)
  })

  it('removes the temp state even when a download fails midway', async () => {
    const fs = createFsBridge()
    const storeFake = createFakeStore()
    const transferId = `tr_${'c'.repeat(20)}`
    const roots: SyncRootRef[] = [{ id: 'aabbccdd', name: 'proj' }]
    storeFake.seedFiles('transfer', transferId, [
      {
        id: 'aabbccdd:a.txt',
        rootId: 'aabbccdd',
        path: 'a.txt',
        deleted: false,
        size: 5,
        contentHash: fakeHash(b64('alpha')),
        executable: false,
        chunkCount: 1,
        rev: 1,
        modifiedAt: null,
        updatedAt: null,
        device: SENDER,
      },
    ])
    storeFake.setFailFetch(true)

    await expect(
      receiveTransfer({
        store: storeFake.store,
        bridge: fs.bridge,
        device: DEVICE,
        transfer: transferContainer({ id: transferId, roots }),
        destBase: '/dest',
      })
    ).rejects.toThrow('chunk fetch failed')

    expect(fs.states.size).toBe(0)
    expect(fs.removeStateCalls).toHaveLength(1)
    expect(storeFake.markReceivedCalls).toHaveLength(0)
    expect(storeFake.releaseClaimCalls).toEqual([
      { transferId, deviceId: DEVICE.id },
    ])
  })

  it('does not create local folders when another device owns the claim', async () => {
    const fs = createFsBridge()
    const storeFake = createFakeStore()
    const transferId = `tr_${'d'.repeat(20)}`
    const roots: SyncRootRef[] = [{ id: 'aabbccdd', name: 'proj' }]
    storeFake.setClaimAllowed(false)

    await expect(
      receiveTransfer({
        store: storeFake.store,
        bridge: fs.bridge,
        device: DEVICE,
        transfer: transferContainer({ id: transferId, roots }),
        destBase: '/dest',
      })
    ).rejects.toThrow(/claimed by another device/i)

    expect(fs.states.size).toBe(0)
    expect(fs.readText('/dest/proj/a.txt')).toBeNull()
    expect(storeFake.markReceivedCalls).toEqual([])
    expect(storeFake.releaseClaimCalls).toEqual([])
  })
})

describe('createBackup and restoreBackup', () => {
  it('round-trips workspace content through the fake cloud', async () => {
    const fs = createFsBridge()
    fs.addDir('/ws/proj')
    fs.writeFile('/ws/proj/a.txt', 'alpha')
    fs.writeFile('/ws/proj/nested/deep.txt', 'deep value')
    const storeFake = createFakeStore()
    const backupProgress: SyncProgress[] = []

    const { backupId } = await createBackup({
      store: storeFake.store,
      bridge: fs.bridge,
      device: DEVICE,
      name: 'Backup 1',
      rootPaths: ['/ws/proj'],
      onProgress: (p) => backupProgress.push(p),
    })

    expect(backupId).toMatch(/^bk_[0-9a-f]{20}$/)
    expect(storeFake.createBackupCalls).toHaveLength(1)
    expect(storeFake.finishBackupCalls).toEqual([
      {
        backupId,
        stats: {
          fileCount: 2,
          totalBytes: 'alpha'.length + 'deep value'.length,
        },
      },
    ])
    expect(fs.states.size).toBe(0)
    expectMonotonic(backupProgress, 2)

    const backup: BackupContainer = {
      id: backupId,
      name: 'Backup 1',
      roots: storeFake.createBackupCalls[0].roots,
      device: DEVICE,
      createdAt: new Date('2026-08-18T10:00:00Z'),
      updatedAt: new Date('2026-08-18T10:00:00Z'),
      fileCount: 2,
      totalBytes: 15,
      status: 'complete',
    }
    const restoreProgress: SyncProgress[] = []

    const restored = await restoreBackup({
      store: storeFake.store,
      bridge: fs.bridge,
      device: DEVICE,
      backup,
      destBase: null,
      onProgress: (p) => restoreProgress.push(p),
    })

    // destBase null falls back to the runtime's default destination base.
    expect(restored.rootPaths).toEqual(['/home/user/StatsKey Synced/proj'])
    expect(fs.readText('/home/user/StatsKey Synced/proj/a.txt')).toBe('alpha')
    expect(
      fs.readText('/home/user/StatsKey Synced/proj/nested/deep.txt')
    ).toBe('deep value')
    expect(fs.states.size).toBe(0)
    expectMonotonic(restoreProgress, 2)
  })
})
