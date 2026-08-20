import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveSyncStatus } from './types'
import {
  WORKSPACE_SYNC_STATUS_EVENT,
  _workspaceSyncStoreForTests,
  guardBannerText,
  getWorkspaceSyncActions,
  initialEngineStatus,
  isBootableLinkState,
  publishSyncStatus,
  registerWorkspaceSyncActions,
  removeSyncStatus,
  type WorkspaceSyncActions,
} from './useWorkspaceSync'

class TestCustomEvent<T> extends Event {
  readonly detail: T

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type)
    this.detail = init?.detail as T
  }
}

function status(syncId: string, overrides: Partial<LiveSyncStatus> = {}) {
  return {
    syncId,
    state: 'idle' as const,
    pendingUploads: 0,
    pendingApplies: 0,
    lastSyncedAt: null,
    skippedCount: 0,
    error: null,
    guard: null,
    guardedDeleteCount: 0,
    detached: false,
    ...overrides,
  }
}

function noopActions(): WorkspaceSyncActions {
  const reject = () => Promise.reject(new Error('not implemented'))
  return {
    enableLiveSync: reject,
    pauseLiveSync: reject,
    resumeLiveSync: reject,
    unlinkDevice: reject,
    deleteLiveSync: reject,
    downloadLiveSync: reject,
    confirmGuardedDeletes: reject,
    dismissGuardedDeletes: reject,
  }
}

describe('workspace sync safety helpers', () => {
  it('boots only a live link owned by the signed-in account', () => {
    expect(
      isBootableLinkState(
        { syncId: 'ws_123', ownerUid: 'owner-a' },
        'owner-a'
      )
    ).toBe(true)
    expect(
      isBootableLinkState(
        { syncId: 'ws_123', ownerUid: 'owner-b' },
        'owner-a'
      )
    ).toBe(false)
    expect(
      isBootableLinkState({ syncId: 'ws_legacy' }, 'owner-a')
    ).toBe(false)
    expect(
      isBootableLinkState(
        { syncId: 'bk_123', ownerUid: 'owner-a' },
        'owner-a'
      )
    ).toBe(false)
  })

  it('restores paused and guarded status details', () => {
    expect(
      initialEngineStatus({ syncId: 'ws_123', paused: true })
    ).toMatchObject({
      state: 'paused',
      guardedDeleteCount: 0,
      detached: false,
    })
    expect(guardBannerText({ guardedDeleteCount: 1 })).toContain('1 file')
    expect(guardBannerText({ guardedDeleteCount: 12 })).toContain('12 files')
  })
})

describe('workspace sync status store', () => {
  let windowTarget: EventTarget

  beforeEach(() => {
    windowTarget = new EventTarget()
    vi.stubGlobal('window', windowTarget)
    vi.stubGlobal('CustomEvent', TestCustomEvent)
    _workspaceSyncStoreForTests.reset()
  })

  it('publishes statuses sorted by syncId and replaces on re-publish', () => {
    publishSyncStatus(status('ws_bbb'))
    publishSyncStatus(status('ws_aaa'))
    expect(
      _workspaceSyncStoreForTests.readStatuses().map((row) => row.syncId)
    ).toEqual(['ws_aaa', 'ws_bbb'])

    publishSyncStatus(status('ws_bbb', { state: 'syncing', pendingUploads: 3 }))
    const rows = _workspaceSyncStoreForTests.readStatuses()
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      syncId: 'ws_bbb',
      state: 'syncing',
      pendingUploads: 3,
    })
  })

  it('dispatches the status event with the published status as detail', () => {
    const seen: unknown[] = []
    windowTarget.addEventListener(WORKSPACE_SYNC_STATUS_EVENT, (event) => {
      seen.push((event as unknown as { detail: unknown }).detail)
    })

    const published = status('ws_ccc', { state: 'offline' })
    publishSyncStatus(published)
    expect(seen).toEqual([published])
  })

  it('removes a status and announces the removal', () => {
    publishSyncStatus(status('ws_ddd'))
    const seen: unknown[] = []
    windowTarget.addEventListener(WORKSPACE_SYNC_STATUS_EVENT, (event) => {
      seen.push((event as unknown as { detail: unknown }).detail)
    })

    removeSyncStatus('ws_ddd')
    expect(_workspaceSyncStoreForTests.readStatuses()).toEqual([])
    expect(seen).toEqual([null])
  })

  it('re-dispatches on removing an unknown syncId so link listers re-load', () => {
    // The coordinator relies on this after removeState() resolves: even when
    // no engine status remains, listeners must re-list linked states.
    const seen: unknown[] = []
    windowTarget.addEventListener(WORKSPACE_SYNC_STATUS_EVENT, (event) => {
      seen.push((event as unknown as { detail: unknown }).detail)
    })

    removeSyncStatus('ws_never_published')
    expect(seen).toEqual([null])
  })

  it('does not throw when publishing without a window (defensive)', () => {
    vi.stubGlobal('window', undefined)
    expect(() => publishSyncStatus(status('ws_eee'))).not.toThrow()
    expect(
      _workspaceSyncStoreForTests.readStatuses().map((row) => row.syncId)
    ).toEqual(['ws_eee'])
  })
})

describe('workspace sync actions registry', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('CustomEvent', TestCustomEvent)
    _workspaceSyncStoreForTests.reset()
  })

  it('starts empty', () => {
    expect(getWorkspaceSyncActions()).toBeNull()
  })

  it('returns the registered actions object by reference', () => {
    const actions = noopActions()
    registerWorkspaceSyncActions(actions)
    expect(getWorkspaceSyncActions()).toBe(actions)
  })

  it('clears on registering null', () => {
    registerWorkspaceSyncActions(noopActions())
    registerWorkspaceSyncActions(null)
    expect(getWorkspaceSyncActions()).toBeNull()
  })

  it('later registrations replace earlier ones', () => {
    const first = noopActions()
    const second = noopActions()
    registerWorkspaceSyncActions(first)
    registerWorkspaceSyncActions(second)
    expect(getWorkspaceSyncActions()).toBe(second)
  })
})
