import { useEffect, useState } from 'react'
import {
  getDesktopBridge,
  type DesktopApprovalMode,
  type DesktopGitFile,
  type DesktopOperationResult,
  type DesktopWorkspaceNode,
} from '../../lib/desktop'
import {
  WORKSPACE_MUTATION_EVENT,
  requestWorkspaceFileOpen,
} from '../../lib/workspaceContext'
import { showToast } from '../../lib/ui/dialogs'
import { composeCommitNotice, parseGitBranch } from './unifiedDiff'
import { WorkspaceDiffView } from './WorkspaceDiffView'
import './WorkspaceChanges.css'

export function WorkspaceChanges({
  roots,
  hasUnsavedChanges,
  active,
  onClose,
}: {
  roots: DesktopWorkspaceNode[]
  hasUnsavedChanges: boolean
  active: boolean
  onClose: () => void
}) {
  const bridge = getDesktopBridge()
  const [rootPath, setRootPath] = useState(roots[0]?.path ?? '')
  const [staged, setStaged] = useState(false)
  const [status, setStatus] = useState<DesktopOperationResult | null>(null)
  const [diff, setDiff] = useState<DesktopOperationResult | null>(null)
  const [files, setFiles] = useState<DesktopGitFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [approvalMode, setApprovalMode] =
    useState<DesktopApprovalMode>('review')
  const [commitMessage, setCommitMessage] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [rawOutput, setRawOutput] = useState<string | null>(null)

  useEffect(() => {
    if (!roots.some((root) => root.path === rootPath)) {
      setRootPath(roots[0]?.path ?? '')
    }
  }, [rootPath, roots])

  useEffect(() => {
    if (!active) return
    void refresh()
  }, [rootPath, staged, active, selectedPath])

  useEffect(() => {
    if (!active) return
    const refreshAfterMutation = () => void refresh()
    window.addEventListener(WORKSPACE_MUTATION_EVENT, refreshAfterMutation)
    return () =>
      window.removeEventListener(WORKSPACE_MUTATION_EVENT, refreshAfterMutation)
  }, [active, rootPath, staged, selectedPath])

  useEffect(() => {
    if (!bridge) return
    void bridge.preferences
      .get()
      .then((preferences) => setApprovalMode(preferences.approvalMode))
  }, [bridge])

  async function refresh() {
    if (!bridge || !rootPath) return
    setLoading(true)
    try {
      const [nextStatus, nextDiff, nextFiles] = await Promise.all([
        bridge.workspace.gitStatus(rootPath),
        bridge.workspace.gitDiff(
          rootPath,
          staged,
          selectedPath ? [selectedPath] : undefined
        ),
        bridge.workspace.gitFiles(rootPath),
      ])
      setStatus(nextStatus)
      setDiff(nextDiff)
      setFiles(nextFiles.files)
      if (!nextFiles.ok) {
        setNotice(nextFiles.error || 'Could not read changed files.')
      }
      if (
        selectedPath &&
        !nextFiles.files.some(
          (file) =>
            file.path === selectedPath &&
            (staged ? file.staged : file.unstaged)
        )
      ) {
        setSelectedPath(null)
      }
    } finally {
      setLoading(false)
    }
  }

  async function stageAll() {
    if (!bridge || !rootPath || mutating) return
    setMutating(true)
    setNotice(null)
    setRawOutput(null)
    const result = await bridge.workspace.gitStageAll(rootPath)
    setMutating(false)
    if (!result.ok) {
      setNotice(result.error || result.stderr || 'Could not stage changes.')
      return
    }
    setStaged(true)
    await refresh()
  }

  async function initializeVersionControl() {
    if (!bridge || !rootPath || initializing) return
    setInitializing(true)
    setNotice(null)
    setRawOutput(null)
    const result = await bridge.workspace.gitInitialize(rootPath, approvalMode)
    setInitializing(false)
    if (!result.ok) {
      if (!result.cancelled) {
        setNotice(result.error || result.stderr || 'Could not start version control.')
      }
      return
    }
    setNotice('Version control is ready. Stage and commit your project when ready.')
    await refresh()
  }

  async function unstageAll() {
    if (!bridge || !rootPath || mutating) return
    setMutating(true)
    setNotice(null)
    setRawOutput(null)
    const result = await bridge.workspace.gitUnstageAll(rootPath)
    setMutating(false)
    if (!result.ok) {
      setNotice(result.error || result.stderr || 'Could not unstage changes.')
      return
    }
    setStaged(false)
    await refresh()
  }

  async function stageFile(file: DesktopGitFile) {
    if (!bridge || !rootPath || mutating) return
    setMutating(true)
    setNotice(null)
    const result = await bridge.workspace.gitStagePaths(
      rootPath,
      file.originalPath ? [file.path, file.originalPath] : [file.path]
    )
    setMutating(false)
    if (!result.ok) {
      setNotice(result.error || result.stderr || 'Could not stage the file.')
      return
    }
    await refresh()
  }

  async function unstageFile(file: DesktopGitFile) {
    if (!bridge || !rootPath || mutating) return
    setMutating(true)
    setNotice(null)
    const result = await bridge.workspace.gitUnstagePaths(
      rootPath,
      file.originalPath ? [file.path, file.originalPath] : [file.path]
    )
    setMutating(false)
    if (!result.ok) {
      setNotice(result.error || result.stderr || 'Could not unstage the file.')
      return
    }
    await refresh()
  }

  async function commit() {
    const message = commitMessage.trim()
    if (!bridge || !rootPath || !message || mutating) return
    if (!files.some((file) => file.staged)) {
      setNotice('Stage at least one file before committing.')
      return
    }
    setMutating(true)
    setNotice(null)
    setRawOutput(null)
    const result = await bridge.workspace.gitCommit(
      rootPath,
      message,
      approvalMode
    )
    setMutating(false)
    if (!result.ok) {
      if (!result.cancelled) {
        setNotice(result.error || result.stderr || 'Could not create the commit.')
      }
      return
    }
    const raw = [result.stdout?.trim(), result.stderr?.trim()]
      .filter(Boolean)
      .join('\n')
    const summary = composeCommitNotice(raw)
    setCommitMessage('')
    setNotice(summary)
    setRawOutput(raw || null)
    showToast(summary, { kind: 'success' })
    await refresh()
  }

  async function push() {
    if (!bridge || !rootPath || mutating || pushing) return
    if (hasUnsavedChanges) {
      setNotice('Save every open file before publishing.')
      return
    }
    const currentFiles = await bridge.workspace.gitFiles(rootPath)
    if (!currentFiles.ok) {
      setNotice(currentFiles.error || 'Could not verify the project before publishing.')
      return
    }
    if (currentFiles.files.length > 0) {
      setFiles(currentFiles.files)
      setNotice('Commit every changed file before publishing.')
      return
    }
    setPushing(true)
    setNotice(null)
    setRawOutput(null)
    const result = await bridge.workspace.gitPush(rootPath, approvalMode)
    setPushing(false)
    if (!result.ok) {
      if (!result.cancelled) {
        setNotice(result.error || result.stderr || 'Could not push to origin.')
      }
      return
    }
    const raw = [result.stdout?.trim(), result.stderr?.trim()]
      .filter(Boolean)
      .join('\n')
    const summary = branch ? `Published ${branch} to origin.` : 'Published to origin.'
    setNotice(summary)
    setRawOutput(raw || null)
    showToast(summary, { kind: 'success' })
    await refresh()
  }

  function openFileInEditor(file: DesktopGitFile) {
    if (!rootPath) return
    const separator = rootPath.endsWith('/') ? '' : '/'
    requestWorkspaceFileOpen({ path: `${rootPath}${separator}${file.path}` })
  }

  const branch = parseGitBranch(status?.stdout)
  const statusText =
    status?.stdout?.trim() ||
    status?.stderr?.trim() ||
    status?.error ||
    'No changes.'
  const selectedFile = selectedPath
    ? files.find((file) => file.path === selectedPath)
    : undefined
  const diffStdout = diff?.stdout?.trim() || ''
  const diffFallback =
    selectedFile?.untracked && !staged
      ? 'New file — stage it to review its contents in the staged diff.'
      : diff?.stderr?.trim() || diff?.error || 'No diff for this selection.'
  const visibleFiles = files.filter((file) =>
    staged ? file.staged : file.unstaged
  )
  const stagedCount = files.filter((file) => file.staged).length
  const notGitRepository = Boolean(
    [status?.error, status?.stderr, diff?.error, diff?.stderr, notice]
      .filter(Boolean)
      .some((value) => /not a git repository/i.test(String(value)))
  )

  return (
    <section className="workspace-changes" aria-label="Workspace changes">
      <header>
        <div>
          <b>Changes</b>
          <span>
            {loading ? 'Refreshing…' : staged ? 'Staged diff' : 'Working tree diff'}
            {branch ? ` · ${branch}` : ''}
          </span>
        </div>
        <select
          value={rootPath}
          onChange={(event) => setRootPath(event.target.value)}
          aria-label="Changes workspace folder"
        >
          {roots.map((root) => (
            <option key={root.path} value={root.path}>
              {root.name}
            </option>
          ))}
        </select>
        <div className="workspace-changes__scope" role="tablist" aria-label="Diff scope">
          <button
            className={!staged ? 'active' : ''}
            onClick={() => setStaged(false)}
          >
            Unstaged
          </button>
          <button
            className={staged ? 'active' : ''}
            onClick={() => setStaged(true)}
          >
            Staged
          </button>
        </div>
        <button
          onClick={() => void push()}
          disabled={!rootPath || mutating || pushing || hasUnsavedChanges || files.length > 0}
          title={
            hasUnsavedChanges
              ? 'Save open files before publishing'
              : files.length > 0
                ? 'Commit every changed file before publishing'
                : 'Publish committed changes to GitHub'
          }
        >
          {pushing ? 'Publishing…' : 'Publish'}
        </button>
        <button onClick={() => void refresh()} disabled={loading}>Refresh</button>
        <button onClick={onClose} aria-label="Close changes">×</button>
      </header>
      {notGitRepository && (
        <div className="workspace-changes__onboarding" role="status">
          <div>
            <b>Protect and publish this project</b>
            <span>
              Start version control to review changes, restore earlier work, and publish to GitHub.
            </span>
          </div>
          <button
            className="primary"
            onClick={() => void initializeVersionControl()}
            disabled={initializing}
          >
            {initializing ? 'Starting…' : 'Start version control'}
          </button>
        </div>
      )}
      <form
        className="workspace-changes__commit"
        onSubmit={(event) => {
          event.preventDefault()
          void commit()
        }}
      >
        <button
          type="button"
          onClick={() => void stageAll()}
          disabled={loading || mutating || pushing}
        >
          Stage all
        </button>
        <button
          type="button"
          onClick={() => void unstageAll()}
          disabled={loading || mutating || pushing}
        >
          Unstage all
        </button>
        <input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          maxLength={240}
          placeholder="Commit message"
          aria-label="Commit message"
        />
        <button
          disabled={
            !commitMessage.trim() || mutating || pushing || stagedCount === 0
          }
          title={
            stagedCount === 0 ? 'Stage files before committing' : undefined
          }
        >
          {mutating ? 'Working…' : 'Commit staged'}
        </button>
        {notice && <span role="status">{notice}</span>}
      </form>
      <div className="workspace-changes__body">
        <aside>
          <span>{staged ? 'Staged files' : 'Changed files'}</span>
          <button
            type="button"
            className={`workspace-changes__all-changes${
              selectedPath === null
                ? ' workspace-changes__all-changes--selected'
                : ''
            }`}
            onClick={() => setSelectedPath(null)}
          >
            All changes
          </button>
          <div className="workspace-changes__files">
            {visibleFiles.map((file) => (
              <div
                key={`${staged ? 'staged' : 'working'}:${file.path}`}
                className={
                  selectedPath === file.path
                    ? 'workspace-changes__row--selected'
                    : undefined
                }
                onClick={() =>
                  setSelectedPath((current) =>
                    current === file.path ? null : file.path
                  )
                }
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setSelectedPath((current) =>
                    current === file.path ? null : file.path
                  )
                }}
                tabIndex={0}
                title="Review this file's diff"
              >
                <span title={file.path}>
                  <b>{gitStatusLabel(file, staged)}</b>
                  <button
                    type="button"
                    className="workspace-changes__open-file"
                    onClick={(event) => {
                      event.stopPropagation()
                      openFileInEditor(file)
                    }}
                    title={`Open ${file.path} in the editor`}
                  >
                    {file.path}
                  </button>
                </span>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void (staged ? unstageFile(file) : stageFile(file))
                  }}
                  disabled={mutating}
                >
                  {staged ? 'Unstage' : 'Stage'}
                </button>
              </div>
            ))}
            {visibleFiles.length === 0 && <p>No files in this section.</p>}
          </div>
          <details>
            <summary>Raw Git status</summary>
            <pre>{statusText}</pre>
          </details>
          {rawOutput && (
            <details>
              <summary>Raw command output</summary>
              <pre>{rawOutput}</pre>
            </details>
          )}
        </aside>
        <div className="workspace-changes__diff-pane">
          <header>
            <span title={selectedPath ?? undefined}>
              {selectedPath ?? 'All changes'}
            </span>
            {selectedPath && (
              <button type="button" onClick={() => setSelectedPath(null)}>
                Show all
              </button>
            )}
          </header>
          <WorkspaceDiffView diffText={diffStdout} fallback={diffFallback} />
          <details>
            <summary>Raw diff</summary>
            <pre>{diffStdout || diffFallback}</pre>
          </details>
        </div>
      </div>
    </section>
  )
}

function gitStatusLabel(file: DesktopGitFile, staged: boolean): string {
  if (file.untracked) return 'U'
  const value = staged ? file.indexStatus : file.workingStatus
  return value === ' ' ? 'M' : value
}
