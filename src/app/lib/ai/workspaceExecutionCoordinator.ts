export interface WorkspaceExecutionLeaseOptions {
  runId: string
  workspaceId?: string
  roots?: string[]
  label?: string
  shouldStop?: () => boolean
  onWaiting?: (position: number, activeLabel?: string) => void
  onAcquired?: () => void
}

export interface WorkspaceExecutionLease {
  ensure(): Promise<boolean>
  release(): void
}

interface ActiveLease {
  runId: string
  workspaceId?: string
  roots: string[]
  label?: string
}

interface Waiter extends ActiveLease {
  resolve: (acquired: boolean) => void
  shouldStop?: () => boolean
  onWaiting?: WorkspaceExecutionLeaseOptions['onWaiting']
  onAcquired?: WorkspaceExecutionLeaseOptions['onAcquired']
  timer?: ReturnType<typeof setInterval>
}

const active: ActiveLease[] = []
const waiters: Waiter[] = []

const EXCLUSIVE_WORKSPACE_TOOLS = new Set([
  'workspace_write',
  'workspace_create',
  'workspace_delete',
  'workspace_rename',
  'restore_checkpoint',
  'run_terminal',
])

export function toolNeedsWorkspaceLease(name: string): boolean {
  return EXCLUSIVE_WORKSPACE_TOOLS.has(name)
}

export function workspaceRootsOverlap(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizedRoots(left)
  const normalizedRight = normalizedRoots(right)
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return true
  return normalizedLeft.some((first) =>
    normalizedRight.some(
      (second) =>
        first === second ||
        first.startsWith(`${second}/`) ||
        second.startsWith(`${first}/`)
    )
  )
}

export function createWorkspaceExecutionLease(
  options: WorkspaceExecutionLeaseOptions
): WorkspaceExecutionLease {
  const roots = normalizedRoots(options.roots ?? [])
  const workspaceId = normalizedWorkspaceId(options.workspaceId)
  let acquired = false
  let pending: Promise<boolean> | null = null

  return {
    ensure() {
      if (acquired) return Promise.resolve(true)
      if (pending) return pending
      if (options.shouldStop?.()) return Promise.resolve(false)

      const conflict = conflictingLease(roots, workspaceId)
      if (!conflict) {
        active.push({
          runId: options.runId,
          workspaceId,
          roots,
          label: options.label,
        })
        acquired = true
        options.onAcquired?.()
        return Promise.resolve(true)
      }

      pending = new Promise<boolean>((resolve) => {
        const waiter: Waiter = {
          runId: options.runId,
          workspaceId,
          roots,
          label: options.label,
          shouldStop: options.shouldStop,
          onWaiting: options.onWaiting,
          onAcquired: options.onAcquired,
          resolve: (result) => {
            if (waiter.timer) clearInterval(waiter.timer)
            acquired = result
            pending = null
            resolve(result)
          },
        }
        waiters.push(waiter)
        waiter.onWaiting?.(waiters.indexOf(waiter) + 1, conflict.label)
        waiter.timer = setInterval(() => {
          if (!waiter.shouldStop?.()) return
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          waiter.resolve(false)
          notifyWaiters()
        }, 100)
      })
      return pending
    },
    release() {
      const waitingIndex = waiters.findIndex(
        (waiter) => waiter.runId === options.runId
      )
      if (waitingIndex >= 0) {
        const [waiter] = waiters.splice(waitingIndex, 1)
        waiter.resolve(false)
      }
      const activeIndex = active.findIndex(
        (lease) => lease.runId === options.runId
      )
      if (activeIndex >= 0) active.splice(activeIndex, 1)
      acquired = false
      grantAvailableWaiters()
    },
  }
}

function conflictingLease(
  roots: string[],
  workspaceId?: string
): ActiveLease | undefined {
  return active.find((lease) =>
    workspaceScopesOverlap(
      lease.roots,
      roots,
      lease.workspaceId,
      workspaceId
    )
  )
}

export function workspaceScopesOverlap(
  leftRoots: string[],
  rightRoots: string[],
  leftWorkspaceId?: string,
  rightWorkspaceId?: string
): boolean {
  if (leftWorkspaceId && rightWorkspaceId && leftWorkspaceId === rightWorkspaceId) {
    return true
  }
  if (leftRoots.length > 0 && rightRoots.length > 0) {
    return workspaceRootsOverlap(leftRoots, rightRoots)
  }
  if (leftWorkspaceId && rightWorkspaceId) return false
  return true
}

function grantAvailableWaiters() {
  for (let index = 0; index < waiters.length; ) {
    const waiter = waiters[index]
    if (waiter.shouldStop?.()) {
      waiters.splice(index, 1)
      waiter.resolve(false)
      continue
    }
    if (conflictingLease(waiter.roots, waiter.workspaceId)) {
      index += 1
      continue
    }
    waiters.splice(index, 1)
    active.push({
      runId: waiter.runId,
      workspaceId: waiter.workspaceId,
      roots: waiter.roots,
      label: waiter.label,
    })
    waiter.onAcquired?.()
    waiter.resolve(true)
  }
  notifyWaiters()
}

function notifyWaiters() {
  waiters.forEach((waiter, index) => {
    waiter.onWaiting?.(
      index + 1,
      conflictingLease(waiter.roots, waiter.workspaceId)?.label
    )
  })
}

function normalizedRoots(roots: string[]): string[] {
  return [...new Set(roots.map(normalizePath).filter(Boolean))]
}

function normalizePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}

function normalizedWorkspaceId(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

/** Test-only reset for the module-local coordinator. */
export function resetWorkspaceExecutionCoordinatorForTests() {
  for (const waiter of waiters.splice(0)) waiter.resolve(false)
  active.splice(0)
}
