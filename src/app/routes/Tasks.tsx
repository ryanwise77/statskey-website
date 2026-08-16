import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getDesktopBridge,
  type DesktopWorkspaceNode,
  type DesktopWorkspaceWorktree,
} from '../lib/desktop'

export function Tasks() {
  const bridge = getDesktopBridge()
  const navigate = useNavigate()
  const [roots, setRoots] = useState<DesktopWorkspaceNode[]>([])
  const [rootPath, setRootPath] = useState('')
  const [worktrees, setWorktrees] = useState<DesktopWorkspaceWorktree[]>([])
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) {
      setLoading(false)
      return
    }
    void bridge.workspace.getState().then((workspace) => {
      setRoots(workspace.roots)
      setRootPath(workspace.roots[0]?.path ?? '')
      setLoading(false)
    })
  }, [bridge])

  useEffect(() => {
    if (!bridge || !rootPath) {
      setWorktrees([])
      return
    }
    setLoading(true)
    void bridge.workspace
      .worktrees(rootPath)
      .then(setWorktrees)
      .finally(() => setLoading(false))
  }, [bridge, rootPath])

  async function refresh() {
    if (!bridge || !rootPath) return
    setWorktrees(await bridge.workspace.worktrees(rootPath))
  }

  async function createTask(event: FormEvent) {
    event.preventDefault()
    if (!bridge || !rootPath || !label.trim() || working) return
    setWorking(true)
    setError(null)
    const result = await bridge.workspace.createWorktree(
      rootPath,
      label.trim(),
      'review'
    )
    setWorking(false)
    if (!result.ok) {
      if (!result.cancelled) {
        setError(result.error || result.stderr || 'Could not create the task.')
      }
      return
    }
    setLabel('')
    await refresh()
  }

  async function openTask(worktree: DesktopWorkspaceWorktree) {
    if (!bridge || working) return
    setWorking(true)
    setError(null)
    const result = await bridge.workspace.activateWorktree(
      rootPath,
      worktree.path
    )
    setWorking(false)
    if (!result.ok) {
      setError(result.error || 'Could not open the task workspace.')
      return
    }
    navigate('/workspace')
  }

  async function removeTask(worktree: DesktopWorkspaceWorktree) {
    if (!bridge || working) return
    setWorking(true)
    setError(null)
    const result = await bridge.workspace.removeWorktree(
      rootPath,
      worktree.path,
      'review'
    )
    setWorking(false)
    if (!result.ok) {
      if (!result.cancelled) {
        setError(result.error || result.stderr || 'Could not remove the task.')
      }
      return
    }
    await refresh()
  }

  if (!bridge) {
    return (
      <section className="task-workspaces task-workspaces--empty">
        <h1>Isolated tasks are available in the desktop app.</h1>
      </section>
    )
  }

  return (
    <section className="task-workspaces">
      <header>
        <div>
          <span>Local orchestration</span>
          <h1>Task workspaces</h1>
          <p>
            Create a clean Git worktree for independent Agent work. Your main
            workspace remains untouched until you review the branch.
          </p>
        </div>
        {roots.length > 1 && (
          <select
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            aria-label="Task repository"
          >
            {roots.map((root) => (
              <option key={root.path} value={root.path}>
                {root.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <form onSubmit={createTask}>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Name an isolated task"
          maxLength={120}
          aria-label="New task workspace name"
        />
        <button disabled={!rootPath || !label.trim() || working}>
          {working ? 'Working…' : 'Create task workspace'}
        </button>
      </form>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="task-workspaces__empty">Reading Git worktrees…</div>
      ) : !rootPath ? (
        <div className="task-workspaces__empty">
          Open a Git workspace before creating isolated tasks.
        </div>
      ) : worktrees.length === 0 ? (
        <div className="task-workspaces__empty">
          This workspace is not a Git worktree yet.
        </div>
      ) : (
        <div className="task-workspaces__list">
          {worktrees.map((worktree) => (
            <article key={worktree.path}>
              <div>
                <span>
                  {worktree.main
                    ? 'Main workspace'
                    : worktree.managed
                      ? 'Isolated task'
                      : 'External worktree'}
                </span>
                <b>{worktree.branch || worktree.name}</b>
                <small>{worktree.path}</small>
              </div>
              <div>
                {worktree.active ? (
                  <strong>Open now</strong>
                ) : (
                  <button onClick={() => void openTask(worktree)}>
                    Open
                  </button>
                )}
                {!worktree.main && worktree.managed && !worktree.active && (
                  <button
                    className="danger"
                    onClick={() => void removeTask(worktree)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
