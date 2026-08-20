import { describe, expect, it } from 'vitest'
import { planReconcile } from './syncPlan'
import {
  conflictCopyPath,
  syncFileKey,
  type DesktopSyncLastSyncedEntry,
  type DesktopSyncScanEntry,
  type SyncFileDoc,
  type SyncPlanInput,
} from './types'

const NOW = new Date(2026, 0, 15, 9, 5)

function local(
  rootId: string,
  path: string,
  hash: string,
  extra: Partial<DesktopSyncScanEntry> = {}
): DesktopSyncScanEntry {
  return {
    rootId,
    path,
    size: 10,
    mtimeMs: 1000,
    hash,
    executable: false,
    ...extra,
  }
}

function remote(
  rootId: string,
  path: string,
  hash: string,
  extra: Partial<SyncFileDoc> = {}
): SyncFileDoc {
  return {
    id: `${rootId}-${path}`,
    rootId,
    path,
    deleted: false,
    size: 10,
    contentHash: hash,
    executable: false,
    chunkCount: 1,
    rev: 1,
    modifiedAt: null,
    updatedAt: null,
    device: { id: 'dev_remote', label: 'MacBook Pro' },
    ...extra,
  }
}

function tombstone(
  rootId: string,
  path: string,
  extra: Partial<SyncFileDoc> = {}
): SyncFileDoc {
  return remote(rootId, path, '', {
    deleted: true,
    size: 0,
    chunkCount: 0,
    rev: 2,
    ...extra,
  })
}

function synced(
  hash: string,
  extra: Partial<DesktopSyncLastSyncedEntry> = {}
): DesktopSyncLastSyncedEntry {
  return { hash, rev: 1, mtimeMs: 1000, size: 10, ...extra }
}

function input(partial: Partial<SyncPlanInput> = {}): SyncPlanInput {
  return {
    localEntries: [],
    missingRoots: [],
    skipped: [],
    remoteFiles: [],
    lastSynced: {},
    deviceLabel: 'Home Server',
    now: NOW,
    ...partial,
  }
}

function emptyPlanShape() {
  return {
    uploads: [],
    applies: [],
    deletesLocal: [],
    deletesRemote: [],
    settled: [],
    droppedKeys: [],
    guard: null,
    guardedDeletes: [],
  }
}

const KEY = syncFileKey('aaaa1111', 'src/app.ts')

describe('planReconcile directions', () => {
  it('uploads a fresh local file with no remote counterpart', () => {
    const plan = planReconcile(
      input({ localEntries: [local('aaaa1111', 'src/app.ts', 'h1')] })
    )
    expect(plan).toEqual({
      ...emptyPlanShape(),
      uploads: [
        {
          key: KEY,
          rootId: 'aaaa1111',
          path: 'src/app.ts',
          hash: 'h1',
          size: 10,
          mtimeMs: 1000,
          executable: false,
        },
      ],
    })
  })

  it('re-uploads a tracked local file whose remote doc vanished', () => {
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h1')],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.uploads.map((u) => u.key)).toEqual([KEY])
    expect(plan.deletesRemote).toEqual([])
    expect(plan.droppedKeys).toEqual([])
  })

  it('applies a fresh remote file this device has never seen', () => {
    const file = remote('aaaa1111', 'src/app.ts', 'h1')
    const plan = planReconcile(input({ remoteFiles: [file] }))
    expect(plan).toEqual({
      ...emptyPlanShape(),
      applies: [{ key: KEY, rootId: 'aaaa1111', path: 'src/app.ts', remote: file }],
    })
  })

  it('settles identical local and remote content without I/O', () => {
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h1', { mtimeMs: 2000 })],
        remoteFiles: [remote('aaaa1111', 'src/app.ts', 'h1', { rev: 3 })],
      })
    )
    expect(plan).toEqual({
      ...emptyPlanShape(),
      settled: [
        { key: KEY, entry: { hash: 'h1', rev: 3, mtimeMs: 2000, size: 10 } },
      ],
    })
  })

  it('emits nothing when identical content is already tracked exactly', () => {
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h1')],
        remoteFiles: [remote('aaaa1111', 'src/app.ts', 'h1', { rev: 1 })],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan).toEqual(emptyPlanShape())
  })

  it('uploads a local-only change', () => {
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h2')],
        remoteFiles: [remote('aaaa1111', 'src/app.ts', 'h1')],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.uploads.map((u) => u.hash)).toEqual(['h2'])
    expect(plan.applies).toEqual([])
    expect(plan.settled).toEqual([])
  })

  it('applies a remote-only change', () => {
    const file = remote('aaaa1111', 'src/app.ts', 'h2', { rev: 2 })
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h1')],
        remoteFiles: [file],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.applies).toEqual([
      { key: KEY, rootId: 'aaaa1111', path: 'src/app.ts', remote: file },
    ])
    expect(plan.applies[0].conflictCopyPath).toBeUndefined()
    expect(plan.uploads).toEqual([])
  })

  it('turns a both-changed key into a conflict copy plus re-upload', () => {
    const file = remote('aaaa1111', 'src/app.ts', 'h3', { rev: 2 })
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h2')],
        remoteFiles: [file],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.applies).toHaveLength(1)
    expect(plan.applies[0].remote).toBe(file)
    expect(plan.applies[0].conflictCopyPath).toBe(
      'src/app (conflict from MacBook Pro 2026-01-15 09.05).ts'
    )
    expect(plan.applies[0].conflictCopyPath).toBe(
      conflictCopyPath('src/app.ts', 'MacBook Pro', NOW)
    )
    expect(plan.uploads.map((u) => u.hash)).toEqual(['h2'])
    expect(plan.deletesLocal).toEqual([])
  })

  it('falls back to the planner deviceLabel when the remote device label is empty', () => {
    const file = remote('aaaa1111', 'src/app.ts', 'h3', {
      device: { id: '', label: '' },
    })
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h2')],
        remoteFiles: [file],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.applies[0].conflictCopyPath).toBe(
      conflictCopyPath('src/app.ts', 'Home Server', NOW)
    )
  })

  it('tombstones remotely when the local file was deleted and remote is unchanged', () => {
    const plan = planReconcile(
      input({
        remoteFiles: [remote('aaaa1111', 'src/app.ts', 'h1')],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.deletesRemote).toEqual([
      { key: KEY, rootId: 'aaaa1111', path: 'src/app.ts' },
    ])
    expect(plan.applies).toEqual([])
    expect(plan.droppedKeys).toEqual([])
  })

  it('deletes locally when remote tombstoned an unchanged local file', () => {
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h1')],
        remoteFiles: [tombstone('aaaa1111', 'src/app.ts')],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.deletesLocal).toEqual([
      { key: KEY, rootId: 'aaaa1111', path: 'src/app.ts' },
    ])
    expect(plan.uploads).toEqual([])
    expect(plan.guard).toBeNull()
  })

  it('undeletes by re-uploading when a tombstone meets a local edit', () => {
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h2')],
        remoteFiles: [tombstone('aaaa1111', 'src/app.ts')],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.uploads.map((u) => u.hash)).toEqual(['h2'])
    expect(plan.deletesLocal).toEqual([])
  })

  it('undeletes a never-synced local file that matches a tombstoned key', () => {
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h2')],
        remoteFiles: [tombstone('aaaa1111', 'src/app.ts')],
      })
    )
    expect(plan.uploads.map((u) => u.hash)).toEqual(['h2'])
    expect(plan.deletesLocal).toEqual([])
  })

  it('restores remote content when a local delete races a remote change', () => {
    const file = remote('aaaa1111', 'src/app.ts', 'h2', { rev: 2 })
    const plan = planReconcile(
      input({
        remoteFiles: [file],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.applies).toEqual([
      { key: KEY, rootId: 'aaaa1111', path: 'src/app.ts', remote: file },
    ])
    expect(plan.deletesRemote).toEqual([])
  })

  it('drops the key when both sides are gone', () => {
    const plan = planReconcile(
      input({
        remoteFiles: [tombstone('aaaa1111', 'src/app.ts')],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.droppedKeys).toEqual([KEY])
    expect(plan.deletesLocal).toEqual([])
    expect(plan.deletesRemote).toEqual([])
  })

  it('drops the key when local is deleted and the remote doc vanished', () => {
    const plan = planReconcile(input({ lastSynced: { [KEY]: synced('h1') } }))
    expect(plan.droppedKeys).toEqual([KEY])
  })

  it('ignores a tombstone for a file this device never synced', () => {
    const plan = planReconcile(
      input({ remoteFiles: [tombstone('aaaa1111', 'src/app.ts')] })
    )
    expect(plan).toEqual(emptyPlanShape())
  })
})

describe('planReconcile exclusions', () => {
  it('excludes missing roots from every direction, tombstones included', () => {
    const missingKey = syncFileKey('bbbb2222', 'notes.md')
    const plan = planReconcile(
      input({
        localEntries: [local('aaaa1111', 'src/app.ts', 'h1')],
        missingRoots: ['bbbb2222'],
        remoteFiles: [remote('bbbb2222', 'notes.md', 'h9', { rev: 4 })],
        lastSynced: {
          [missingKey]: synced('h8'),
          [syncFileKey('bbbb2222', 'other.md')]: synced('h7'),
        },
      })
    )
    // The healthy root still plans normally.
    expect(plan.uploads.map((u) => u.rootId)).toEqual(['aaaa1111'])
    // Nothing under the missing root: no tombstones, applies, or drops.
    expect(plan.deletesRemote).toEqual([])
    expect(plan.applies).toEqual([])
    expect(plan.deletesLocal).toEqual([])
    expect(plan.droppedKeys).toEqual([])
  })

  it('never infers deletion from a skipped file', () => {
    const plan = planReconcile(
      input({
        skipped: [
          { rootId: 'aaaa1111', path: 'src/app.ts', reason: 'too-large', size: 99 },
        ],
        remoteFiles: [remote('aaaa1111', 'src/app.ts', 'h1')],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan).toEqual(emptyPlanShape())
  })

  it('does not apply remote changes over a skipped file', () => {
    const plan = planReconcile(
      input({
        skipped: [{ rootId: 'aaaa1111', path: 'src/app.ts', reason: 'symlink' }],
        remoteFiles: [remote('aaaa1111', 'src/app.ts', 'h2', { rev: 2 })],
        lastSynced: { [KEY]: synced('h1') },
      })
    )
    expect(plan.applies).toEqual([])
  })
})

describe('planReconcile mass-delete guard', () => {
  function deletionScenario(deleteCount: number, trackedCount: number) {
    const localEntries: DesktopSyncScanEntry[] = []
    const remoteFiles: SyncFileDoc[] = []
    const lastSynced: Record<string, DesktopSyncLastSyncedEntry> = {}
    for (let i = 0; i < trackedCount; i += 1) {
      const path = `file-${i}.txt`
      const key = syncFileKey('aaaa1111', path)
      lastSynced[key] = synced('h1')
      if (i < deleteCount) {
        // Remote tombstoned; local unchanged -> planned local delete.
        localEntries.push(local('aaaa1111', path, 'h1'))
        remoteFiles.push(tombstone('aaaa1111', path))
      } else {
        // Unchanged everywhere -> no plan output.
        localEntries.push(local('aaaa1111', path, 'h1'))
        remoteFiles.push(remote('aaaa1111', path, 'h1'))
      }
    }
    return input({ localEntries, remoteFiles, lastSynced })
  }

  it('guards above the absolute threshold even in a huge workspace', () => {
    const plan = planReconcile(deletionScenario(51, 1000))
    expect(plan.guard).toBe('mass-delete')
    expect(plan.deletesLocal).toEqual([])
    expect(plan.guardedDeletes).toHaveLength(51)
  })

  it('does not guard at exactly the absolute threshold', () => {
    const plan = planReconcile(deletionScenario(50, 1000))
    expect(plan.guard).toBeNull()
    expect(plan.deletesLocal).toHaveLength(50)
    expect(plan.guardedDeletes).toEqual([])
  })

  it('guards above the 25% fraction threshold', () => {
    const plan = planReconcile(deletionScenario(11, 40))
    expect(plan.guard).toBe('mass-delete')
    expect(plan.deletesLocal).toEqual([])
    expect(plan.guardedDeletes).toHaveLength(11)
  })

  it('does not guard at exactly 25% of tracked files', () => {
    const plan = planReconcile(deletionScenario(10, 40))
    expect(plan.guard).toBeNull()
    expect(plan.deletesLocal).toHaveLength(10)
  })

  it('does not guard below the 10-file minimum even at a high fraction', () => {
    const plan = planReconcile(deletionScenario(9, 12))
    expect(plan.guard).toBeNull()
    expect(plan.deletesLocal).toHaveLength(9)
  })

  it('guards at the 10-file minimum when the fraction is exceeded', () => {
    const plan = planReconcile(deletionScenario(10, 12))
    expect(plan.guard).toBe('mass-delete')
    expect(plan.deletesLocal).toEqual([])
    expect(plan.guardedDeletes).toHaveLength(10)
  })

  it('uses the whole-workspace tracked count for an incremental reconcile', () => {
    const partial = deletionScenario(10, 10)
    const plan = planReconcile({
      ...partial,
      trackedCount: 1_000,
    })
    expect(plan.guard).toBeNull()
    expect(plan.deletesLocal).toHaveLength(10)
    expect(plan.guardedDeletes).toEqual([])
  })

  it('leaves remote tombstone plans untouched by the guard', () => {
    // 60 locally-deleted files -> deletesRemote, which the guard ignores.
    const lastSynced: Record<string, DesktopSyncLastSyncedEntry> = {}
    const remoteFiles: SyncFileDoc[] = []
    for (let i = 0; i < 60; i += 1) {
      const path = `gone-${i}.txt`
      lastSynced[syncFileKey('aaaa1111', path)] = synced('h1')
      remoteFiles.push(remote('aaaa1111', path, 'h1'))
    }
    const plan = planReconcile(input({ remoteFiles, lastSynced }))
    expect(plan.guard).toBeNull()
    expect(plan.deletesRemote).toHaveLength(60)
  })
})
