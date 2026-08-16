const { AsyncLocalStorage } = require('node:async_hooks')

const WORKSPACE_BINDING_UNAVAILABLE_ERROR =
  'The task’s original workspace is no longer available. Reopen it, then resume the task.'

class WorkspaceBindingRuntime {
  constructor(options = {}) {
    this.currentSnapshot =
      typeof options.currentSnapshot === 'function'
        ? options.currentSnapshot
        : () => null
    this.lookupSnapshot =
      typeof options.lookupSnapshot === 'function'
        ? options.lookupSnapshot
        : () => null
    this.maximumSnapshots = Number.isFinite(options.maximumSnapshots)
      ? Math.max(4, Math.min(256, Math.floor(options.maximumSnapshots)))
      : 80
    this.snapshots = new Map()
    this.context = new AsyncLocalStorage()
  }

  remember(snapshot) {
    const normalized = normalizeWorkspaceSnapshot(snapshot)
    if (!normalized) return null
    this.snapshots.delete(normalized.workspaceId)
    this.snapshots.set(normalized.workspaceId, normalized)
    while (this.snapshots.size > this.maximumSnapshots) {
      this.snapshots.delete(this.snapshots.keys().next().value)
    }
    return normalized
  }

  resolve(binding) {
    const workspaceId = workspaceIdFromBinding(binding)
    if (!workspaceId) {
      if (binding === undefined || binding === null) {
        return normalizeWorkspaceSnapshot(this.currentSnapshot())
      }
      throw workspaceBindingUnavailable()
    }

    const scoped = this.context.getStore()
    if (scoped?.workspaceId === workspaceId) return scoped

    const current = normalizeWorkspaceSnapshot(this.currentSnapshot())
    if (current?.workspaceId === workspaceId) {
      return this.remember(current)
    }

    const remembered = this.snapshots.get(workspaceId)
    if (remembered) return remembered

    const restored = normalizeWorkspaceSnapshot(
      this.lookupSnapshot(workspaceId)
    )
    if (restored?.workspaceId === workspaceId) {
      return this.remember(restored)
    }
    throw workspaceBindingUnavailable()
  }

  run(binding, task) {
    if (typeof task !== 'function') {
      throw new TypeError('A workspace operation must be a function.')
    }
    if (binding === undefined || binding === null) return task()
    return this.context.run(this.resolve(binding), task)
  }

  activeSnapshot() {
    return (
      this.context.getStore() ||
      normalizeWorkspaceSnapshot(this.currentSnapshot())
    )
  }

  assert(binding) {
    const workspaceId = workspaceIdFromBinding(binding)
    if (!workspaceId) {
      if (binding === undefined || binding === null) {
        return this.activeSnapshot()
      }
      throw workspaceBindingUnavailable()
    }
    const active = this.activeSnapshot()
    if (active?.workspaceId !== workspaceId) {
      throw workspaceBindingUnavailable()
    }
    return active
  }
}

function normalizeWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null
  const workspaceId =
    typeof snapshot.workspaceId === 'string' &&
    /^[a-f0-9]{20}$/.test(snapshot.workspaceId)
      ? snapshot.workspaceId
      : null
  if (!workspaceId) return null
  const roots = Object.freeze(
    Array.isArray(snapshot.roots)
      ? snapshot.roots
          .filter((value) => typeof value === 'string' && value)
          .slice(0, 100)
      : []
  )
  const looseFiles = new Set(
    snapshot.looseFiles instanceof Set
      ? [...snapshot.looseFiles]
      : Array.isArray(snapshot.looseFiles)
        ? snapshot.looseFiles
        : []
  )
  return {
    workspaceId,
    roots,
    looseFiles,
    importedWorkspace:
      snapshot.importedWorkspace &&
      typeof snapshot.importedWorkspace === 'object'
        ? { ...snapshot.importedWorkspace }
        : null,
  }
}

function workspaceIdFromBinding(binding) {
  return binding &&
    typeof binding === 'object' &&
    typeof binding.workspaceId === 'string' &&
    /^[a-f0-9]{20}$/.test(binding.workspaceId)
    ? binding.workspaceId
    : null
}

function workspaceBindingUnavailable() {
  const error = new Error(WORKSPACE_BINDING_UNAVAILABLE_ERROR)
  error.code = 'WORKSPACE_BINDING_UNAVAILABLE'
  return error
}

module.exports = {
  WORKSPACE_BINDING_UNAVAILABLE_ERROR,
  WorkspaceBindingRuntime,
  normalizeWorkspaceSnapshot,
  workspaceIdFromBinding,
}
