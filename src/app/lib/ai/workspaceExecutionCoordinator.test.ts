import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceExecutionLease,
  resetWorkspaceExecutionCoordinatorForTests,
  toolNeedsWorkspaceLease,
  workspaceRootsOverlap,
  workspaceScopesOverlap,
} from './workspaceExecutionCoordinator'

afterEach(() => {
  resetWorkspaceExecutionCoordinatorForTests()
  vi.restoreAllMocks()
})

describe('workspace execution coordinator', () => {
  it('recognizes parent and child workspaces as overlapping', () => {
    expect(workspaceRootsOverlap(['/Projects/App'], ['/Projects/App/ios'])).toBe(true)
    expect(workspaceRootsOverlap(['/Projects/App'], ['/Projects/Other'])).toBe(false)
  })

  it('distinguishes loose-file-only workspaces by exact id', () => {
    expect(
      workspaceScopesOverlap([], [], 'workspace-a', 'workspace-b')
    ).toBe(false)
    expect(
      workspaceScopesOverlap([], [], 'workspace-a', 'workspace-a')
    ).toBe(true)
  })

  it('keeps read-only investigation outside the exclusive lane', () => {
    expect(toolNeedsWorkspaceLease('workspace_read')).toBe(false)
    expect(toolNeedsWorkspaceLease('run_subagent')).toBe(false)
    expect(toolNeedsWorkspaceLease('workspace_write')).toBe(true)
    expect(toolNeedsWorkspaceLease('run_terminal')).toBe(true)
  })

  it('serializes writes to an overlapping workspace and releases the next task', async () => {
    const first = createWorkspaceExecutionLease({ runId: 'first', roots: ['/Projects/App'] })
    const acquired: string[] = []
    const second = createWorkspaceExecutionLease({
      runId: 'second',
      roots: ['/Projects/App/ios'],
      onAcquired: () => acquired.push('second'),
    })
    expect(await first.ensure()).toBe(true)
    let resolved = false
    const waiting = second.ensure().then((value) => {
      resolved = true
      return value
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    first.release()
    expect(await waiting).toBe(true)
    expect(acquired).toEqual(['second'])
  })

  it('allows disjoint workspaces to enter simultaneously', async () => {
    const first = createWorkspaceExecutionLease({ runId: 'first', roots: ['/Projects/App'] })
    const second = createWorkspaceExecutionLease({ runId: 'second', roots: ['/Projects/Other'] })
    expect(await Promise.all([first.ensure(), second.ensure()])).toEqual([true, true])
  })

  it('captures the workspace id when the lease is created', async () => {
    const options = {
      runId: 'first',
      workspaceId: 'workspace-a',
      roots: [] as string[],
    }
    const first = createWorkspaceExecutionLease(options)
    options.workspaceId = 'workspace-b'
    const sameCapturedWorkspace = createWorkspaceExecutionLease({
      runId: 'second',
      workspaceId: 'workspace-a',
      roots: [],
    })
    expect(await first.ensure()).toBe(true)
    let resolved = false
    const waiting = sameCapturedWorkspace.ensure().then((value) => {
      resolved = true
      return value
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    first.release()
    expect(await waiting).toBe(true)
  })

  it('removes a cancelled waiter', async () => {
    vi.useFakeTimers()
    let stopped = false
    const first = createWorkspaceExecutionLease({ runId: 'first', roots: ['/Projects/App'] })
    const second = createWorkspaceExecutionLease({
      runId: 'second',
      roots: ['/Projects/App'],
      shouldStop: () => stopped,
    })
    await first.ensure()
    const waiting = second.ensure()
    stopped = true
    await vi.advanceTimersByTimeAsync(110)
    expect(await waiting).toBe(false)
    vi.useRealTimers()
  })
})
