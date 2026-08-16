import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { useAuth } from '../../lib/auth'
import {
  choiceDialog,
  confirmDialog,
  promptDialog,
  showToast,
} from '../../lib/ui/dialogs'
import {
  clearStoredDraft,
  commitGitHubChanges,
  connectGitHubWorkspace,
  disconnectGitHubWorkspace,
  getGitHubTree,
  gitBlobSha,
  isGitHubConflictError,
  listGitHubBranches,
  listGitHubRepositories,
  pollGitHubDeviceAuthorization,
  readGitHubFile,
  readStoredDraft,
  startGitHubDeviceAuthorization,
  useGitHubWorkspaceConnection,
  writeStoredDraft,
  type GitHubBranch,
  type GitHubDeviceAuthorization,
  type GitHubFile,
  type GitHubRepository,
  type GitHubTree,
  type GitHubTreeFile,
} from '../../lib/githubWorkspace'
import {
  getDesktopBridge,
  type StatsKeyDesktopBridge,
} from '../../lib/desktop'
import { MonacoWorkspaceEditor } from './MonacoWorkspaceEditor'
import './GitHubCloudWorkspace.css'

const MAX_COMMIT_FILES = 25

/**
 * Save-all acknowledgment for the desktop close flow. Optional so older
 * packaged preloads keep working.
 */
type SaveAllAckBridge = StatsKeyDesktopBridge & {
  menuCommandComplete?: (command: string, ok: boolean) => void
}

interface CloudTreeNode {
  name: string
  path: string
  kind: 'directory' | 'file'
  children: CloudTreeNode[]
  file?: GitHubTreeFile
}

interface OpenWorkspaceFile {
  path: string
  base: GitHubFile
  draft: string
  isNew: boolean
  conflicted: boolean
}

function isDirtyFile(file: OpenWorkspaceFile): boolean {
  return file.isNew || file.draft !== file.base.content
}

export function GitHubCloudWorkspace() {
  const { user } = useAuth()
  const state = useGitHubWorkspaceConnection(user?.uid)
  const connected = state.connection?.status === 'connected'
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [repository, setRepository] = useState('')
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [branchesRepository, setBranchesRepository] = useState('')
  const [tree, setTree] = useState<GitHubTree | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenWorkspaceFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [repositoryFilter, setRepositoryFilter] = useState('')
  const [commitReviewOpen, setCommitReviewOpen] = useState(false)
  const [reviewPath, setReviewPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loadingTree, setLoadingTree] = useState(false)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const repositorySeq = useRef(0)
  const branchSeq = useRef(0)
  const treeSeq = useRef(0)
  const openSeq = useRef(0)
  const contextRef = useRef({ repository: '', branch: '' })
  const storageWarnedRef = useRef(false)
  const commitRef = useRef<() => void>(() => {})
  const refreshConflictRef = useRef<() => void>(() => {})
  const confirmLeaveRef = useRef<() => Promise<boolean>>(() =>
    Promise.resolve(true)
  )
  const committingRef = useRef(false)
  const menuCloseConfirmRef = useRef(false)
  const latestRef = useRef({ repository, branch, openFiles, activePath })
  const reviewPrimaryRef = useRef<HTMLButtonElement>(null)

  const selectedRepository = repositories.find(
    (candidate) => candidate.fullName === repository
  )
  const selectedBranch = branches.find(
    (candidate) => candidate.name === branch
  )
  const activeFile =
    openFiles.find((candidate) => candidate.path === activePath) ?? null
  const dirtyFiles = openFiles.filter(isDirtyFile)
  const conflictedCount = dirtyFiles.filter(
    (candidate) => candidate.conflicted
  ).length

  useEffect(() => {
    contextRef.current = { repository, branch }
  }, [repository, branch])

  useEffect(() => {
    commitRef.current = () => void commit()
    refreshConflictRef.current = () => void refreshBranchWithConflictScan()
    confirmLeaveRef.current = () => confirmLeaveContext()
    committingRef.current = committing
    latestRef.current = { repository, branch, openFiles, activePath }
  })

  useEffect(() => {
    if (!connected) {
      setRepositories([])
      return
    }
    const seq = ++repositorySeq.current
    listGitHubRepositories()
      .then((items) => {
        if (seq !== repositorySeq.current) return
        const ordered = [...items].sort((left, right) =>
          String(right.updatedAt || '').localeCompare(
            String(left.updatedAt || '')
          )
        )
        setRepositories(ordered)
        const previous = localStorage.getItem('statskey.github.repository')
        const first =
          ordered.find((item) => item.fullName === previous) ?? ordered[0]
        if (first) setRepository(first.fullName)
      })
      .catch((loadError) => {
        if (seq === repositorySeq.current) {
          showToast(messageFor(loadError), { kind: 'error' })
        }
      })
  }, [connected])

  useEffect(() => {
    if (!repository || !connected) return
    localStorage.setItem('statskey.github.repository', repository)
    const seq = ++branchSeq.current
    openSeq.current++
    treeSeq.current++
    setBranches([])
    setBranchesRepository('')
    setBranch('')
    setTree(null)
    setOpenFiles([])
    setActivePath(null)
    setOpeningPath(null)
    setCommitReviewOpen(false)
    listGitHubBranches(repository)
      .then((items) => {
        if (seq !== branchSeq.current) return
        const names = items.map((item) => item.name)
        setBranches(items)
        setBranchesRepository(repository)
        const rememberedBranch = localStorage.getItem(
          `statskey.github.branch:${repository}`
        )
        setBranch(
          rememberedBranch && names.includes(rememberedBranch)
            ? rememberedBranch
            : names.includes(selectedRepository?.defaultBranch ?? '')
            ? selectedRepository!.defaultBranch
            : names[0] ?? ''
        )
      })
      .catch((loadError) => {
        if (seq === branchSeq.current) {
          showToast(messageFor(loadError), { kind: 'error' })
        }
      })
  }, [repository, connected, selectedRepository?.defaultBranch])

  useEffect(() => {
    if (!repository || !branch || branchesRepository !== repository) return
    localStorage.setItem(`statskey.github.branch:${repository}`, branch)
    openSeq.current++
    setOpenFiles([])
    setActivePath(null)
    setOpeningPath(null)
    setCommitReviewOpen(false)
    void refreshTree(repository, branch)
  }, [repository, branch, branchesRepository])

  useEffect(() => {
    if (!tree || openFiles.length > 0 || !repository || !branch) return
    const rememberedFile = localStorage.getItem(
      `statskey.github.file:${repository}:${branch}`
    )
    if (
      rememberedFile &&
      tree.files.some((candidate) => candidate.path === rememberedFile)
    ) {
      void openFile(rememberedFile)
    }
  }, [tree?.headSha, repository, branch])

  useEffect(() => {
    if (dirtyFiles.length === 0) return
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [dirtyFiles.length])

  useEffect(() => {
    if (!repository || !branch || openFiles.length === 0) return
    const timer = window.setTimeout(() => {
      for (const candidate of openFiles) {
        if (candidate.isNew) continue
        if (isDirtyFile(candidate)) {
          const saved = writeStoredDraft(
            repository,
            branch,
            candidate.path,
            candidate.draft
          )
          if (!saved && !storageWarnedRef.current) {
            storageWarnedRef.current = true
            showToast(
              'Browser storage is full — drafts stay in this tab only until committed.',
              { kind: 'info', timeoutMs: 6000 }
            )
          }
        } else {
          clearStoredDraft(repository, branch, candidate.path)
        }
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [openFiles, repository, branch])

  useEffect(() => {
    return () => {
      const latest = latestRef.current
      if (!latest.repository || !latest.branch) return
      for (const candidate of latest.openFiles) {
        if (!candidate.isNew && isDirtyFile(candidate)) {
          writeStoredDraft(
            latest.repository,
            latest.branch,
            candidate.path,
            candidate.draft
          )
        }
      }
    }
  }, [])

  // Native menu 'Save All' (also 'Save All and Close' in the desktop close
  // flow). Synchronously flush every restorable dirty draft to browser
  // storage — never depend on the 600ms debounce — then acknowledge so the
  // desktop shell knows it can continue closing the window.
  useEffect(() => {
    const onMenuSaveAll = () => {
      const latest = latestRef.current
      if (latest.repository && latest.branch) {
        for (const candidate of latest.openFiles) {
          if (!candidate.isNew && isDirtyFile(candidate)) {
            writeStoredDraft(
              latest.repository,
              latest.branch,
              candidate.path,
              candidate.draft
            )
          }
        }
      }
      const bridge = getDesktopBridge() as SaveAllAckBridge | null
      bridge?.menuCommandComplete?.('save-all', true)
    }
    window.addEventListener('statskey:menu-save-all', onMenuSaveAll)
    return () =>
      window.removeEventListener('statskey:menu-save-all', onMenuSaveAll)
  }, [])

  // Native menu Close Tab (Cmd+W). Shell dispatches a cancelable event first:
  // with no dirty drafts we let Shell close the GitHub surface tab directly;
  // with dirty drafts we take over, stash/confirm (counting new files that
  // cannot be restored), and only then tell Shell to close the surface tab.
  useEffect(() => {
    const onMenuCloseTab = (event: Event) => {
      if (!latestRef.current.openFiles.some(isDirtyFile)) return
      event.preventDefault()
      if (menuCloseConfirmRef.current) return
      menuCloseConfirmRef.current = true
      void confirmLeaveRef.current().then((confirmed) => {
        menuCloseConfirmRef.current = false
        if (confirmed) {
          window.dispatchEvent(
            new CustomEvent('statskey:menu-close-tab-confirmed')
          )
        }
      })
    }
    window.addEventListener('statskey:menu-close-tab', onMenuCloseTab)
    return () =>
      window.removeEventListener('statskey:menu-close-tab', onMenuCloseTab)
  }, [])

  useEffect(() => {
    if (commitReviewOpen && dirtyFiles.length === 0) {
      setCommitReviewOpen(false)
    }
  }, [commitReviewOpen, dirtyFiles.length])

  useEffect(() => {
    if (!commitReviewOpen) return
    reviewPrimaryRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // Never dismiss the review while a commit is in flight — reaching
        // the editor mid-commit lets edits be silently marked committed.
        if (!committingRef.current) setCommitReviewOpen(false)
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        commitRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commitReviewOpen])

  function rememberActiveFile(path: string) {
    if (!repository || !branch) return
    try {
      localStorage.setItem(`statskey.github.file:${repository}:${branch}`, path)
    } catch {
      // Remembering the last file is best-effort.
    }
  }

  function activateFile(path: string) {
    setActivePath(path)
    rememberActiveFile(path)
  }

  function updateDraft(path: string, value: string) {
    setOpenFiles((files) =>
      files.map((candidate) =>
        candidate.path === path ? { ...candidate, draft: value } : candidate
      )
    )
  }

  function stashDirtyDrafts(): boolean {
    let allSaved = true
    for (const candidate of openFiles) {
      if (candidate.isNew || !isDirtyFile(candidate)) continue
      if (!writeStoredDraft(repository, branch, candidate.path, candidate.draft)) {
        allSaved = false
      }
    }
    return allSaved
  }

  async function confirmLeaveContext(): Promise<boolean> {
    const dirty = openFiles.filter(isDirtyFile)
    if (dirty.length === 0) return true
    const newFiles = dirty.filter((candidate) => candidate.isNew)
    const stashed = stashDirtyDrafts()
    if (newFiles.length === 0 && stashed) {
      showToast(
        `Kept ${dirty.length} unsaved draft${
          dirty.length === 1 ? '' : 's'
        } — reopen the file${dirty.length === 1 ? '' : 's'} to continue.`,
        { kind: 'info' }
      )
      return true
    }
    return confirmDialog({
      title: 'Discard unsaved changes?',
      body:
        newFiles.length > 0
          ? newFiles.length === 1
            ? `The new file ${newFiles[0].path} has not been committed and will be discarded.`
            : `${newFiles.length} new files have not been committed and will be discarded.`
          : 'Your drafts could not be saved to browser storage and will be lost.',
      confirmLabel: 'Discard',
      destructive: true,
    })
  }

  async function selectRepository(next: string) {
    if (next === repository) return
    if (!(await confirmLeaveContext())) return
    setCommitReviewOpen(false)
    setRepository(next)
    setRepositoryFilter('')
  }

  async function selectBranch(next: string) {
    if (next === branch) return
    if (!(await confirmLeaveContext())) return
    setCommitReviewOpen(false)
    setBranch(next)
  }

  async function refreshTree(nextRepository = repository, nextBranch = branch) {
    if (!nextRepository || !nextBranch) return
    const seq = ++treeSeq.current
    setLoadingTree(true)
    try {
      const next = await getGitHubTree(nextRepository, nextBranch)
      if (seq !== treeSeq.current) return
      setTree(next)
    } catch (loadError) {
      if (seq === treeSeq.current) {
        showToast(messageFor(loadError), { kind: 'error' })
      }
    } finally {
      if (seq === treeSeq.current) setLoadingTree(false)
    }
  }

  async function openFile(path: string) {
    if (!repository || !branch) return
    if (openFiles.some((candidate) => candidate.path === path)) {
      activateFile(path)
      return
    }
    const seq = ++openSeq.current
    setOpeningPath(path)
    try {
      const next = await readGitHubFile(repository, branch, path)
      if (seq !== openSeq.current) return
      const stored = readStoredDraft(repository, branch, path)
      const restored = stored != null && stored !== next.content
      if (stored != null && !restored) {
        clearStoredDraft(repository, branch, path)
      }
      setOpenFiles((files) =>
        files.some((candidate) => candidate.path === path)
          ? files
          : [
              ...files,
              {
                path,
                base: next,
                draft: restored ? stored : next.content,
                isNew: false,
                conflicted: false,
              },
            ]
      )
      activateFile(path)
      if (restored) {
        showToast(`Restored unsaved draft · ${fileName(path)}`, { kind: 'info' })
      }
    } catch (loadError) {
      if (seq === openSeq.current) {
        showToast(messageFor(loadError), { kind: 'error' })
      }
    } finally {
      if (seq === openSeq.current) setOpeningPath(null)
    }
  }

  async function closeTab(path: string) {
    const target = openFiles.find((candidate) => candidate.path === path)
    if (!target) return
    if (isDirtyFile(target)) {
      const confirmed = await confirmDialog({
        title: `Discard changes to ${fileName(path)}?`,
        body: target.isNew
          ? `${path} has not been committed. Closing this tab discards it.`
          : `Unsaved edits to ${path} will be lost.`,
        confirmLabel: 'Discard changes',
        destructive: true,
      })
      if (!confirmed) return
      clearStoredDraft(repository, branch, path)
    }
    const remaining = openFiles.filter((candidate) => candidate.path !== path)
    setOpenFiles((files) => files.filter((candidate) => candidate.path !== path))
    if (activePath === path) {
      const index = openFiles.findIndex((candidate) => candidate.path === path)
      const next =
        remaining[Math.min(index, remaining.length - 1)] ?? null
      setActivePath(next?.path ?? null)
      if (next) rememberActiveFile(next.path)
    }
    if (remaining.length === 0 && repository && branch) {
      try {
        localStorage.removeItem(`statskey.github.file:${repository}:${branch}`)
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  async function createNewFile() {
    if (!repository || !branch || !tree) return
    const input = await promptDialog({
      title: 'New file',
      body: `Committed to ${repository} on ${branch} together with your other changes.`,
      label: 'File path',
      placeholder: 'docs/notes.md',
      confirmLabel: 'Create',
      maxLength: 300,
    })
    if (input == null) return
    const path = normalizeNewFilePath(input)
    if (!path) {
      showToast('Enter a valid file path, for example docs/notes.md.', {
        kind: 'error',
      })
      return
    }
    if (openFiles.some((candidate) => candidate.path === path)) {
      activateFile(path)
      return
    }
    if (tree.files.some((candidate) => candidate.path === path)) {
      showToast(`${path} already exists — opened the existing file.`, {
        kind: 'info',
      })
      void openFile(path)
      return
    }
    setOpenFiles((files) => [
      ...files,
      {
        path,
        base: {
          path,
          sha: '',
          size: 0,
          encoding: 'utf-8',
          content: '',
          downloadUrl: null,
        },
        draft: '',
        isNew: true,
        conflicted: false,
      },
    ])
    activateFile(path)
  }

  function openReview() {
    if (!selectedRepository?.canPush || tree?.truncated === true) return
    const dirty = openFiles.filter(isDirtyFile)
    if (dirty.length === 0) return
    if (!commitMessage.trim()) setCommitMessage(defaultCommitMessage(dirty))
    setReviewPath(
      activePath && dirty.some((candidate) => candidate.path === activePath)
        ? activePath
        : dirty[0].path
    )
    setCommitReviewOpen(true)
  }

  async function commit() {
    const targetRepository = repository
    const targetBranch = branch
    const baseTree = tree
    const dirty = openFiles.filter(isDirtyFile)
    if (
      !targetRepository ||
      !targetBranch ||
      !baseTree ||
      dirty.length === 0 ||
      committing
    ) {
      return
    }
    if (dirty.some((candidate) => candidate.conflicted)) {
      showToast('Resolve the conflicted files before committing.', {
        kind: 'error',
      })
      return
    }
    if (dirty.length > MAX_COMMIT_FILES) {
      showToast(
        `Commit at most ${MAX_COMMIT_FILES} files at once — close or revert some drafts first.`,
        { kind: 'error' }
      )
      return
    }
    const message = commitMessage.trim() || defaultCommitMessage(dirty)
    setCommitting(true)
    try {
      const result = await commitGitHubChanges({
        repository: targetRepository,
        branch: targetBranch,
        baseCommitSha: baseTree.headSha,
        message,
        changes: dirty.map((candidate) => ({
          path: candidate.path,
          content: candidate.draft,
        })),
      })
      const encoder = new TextEncoder()
      const committed = new Map<
        string,
        { sha: string; size: number; content: string }
      >()
      for (const candidate of dirty) {
        committed.set(candidate.path, {
          sha: (await gitBlobSha(candidate.draft)) ?? candidate.base.sha,
          size: encoder.encode(candidate.draft).byteLength,
          content: candidate.draft,
        })
      }
      for (const candidate of dirty) {
        clearStoredDraft(targetRepository, targetBranch, candidate.path)
      }
      if (
        contextRef.current.repository === targetRepository &&
        contextRef.current.branch === targetBranch
      ) {
        setOpenFiles((files) =>
          files.map((candidate) => {
            const entry = committed.get(candidate.path)
            if (!entry) return candidate
            // Rebase onto the SNAPSHOT that was actually pushed, keeping the
            // live draft: edits typed while the commit was in flight leave
            // the file dirty against the new base instead of being silently
            // marked committed.
            return {
              ...candidate,
              base: {
                ...candidate.base,
                content: entry.content,
                sha: entry.sha || candidate.base.sha,
                size: entry.size,
              },
              isNew: false,
              conflicted: false,
            }
          })
        )
        setTree((current) =>
          current
            ? {
                ...current,
                headSha: result.commitSha,
                files: mergeCommittedTreeFiles(current.files, committed),
              }
            : current
        )
        setCommitReviewOpen(false)
        setCommitMessage('')
      }
      showToast(
        `Committed ${result.commitSha.slice(0, 7)} · ${dirty.length} file${
          dirty.length === 1 ? '' : 's'
        }`,
        {
          kind: 'success',
          actionLabel: 'View on GitHub',
          onAction: () => {
            window.open(result.commitUrl, '_blank', 'noopener,noreferrer')
          },
        }
      )
    } catch (commitError) {
      if (isGitHubConflictError(commitError)) {
        showToast('This branch moved ahead on GitHub while you were editing.', {
          kind: 'error',
          actionLabel: 'Refresh branch',
          onAction: () => refreshConflictRef.current(),
        })
      } else {
        showToast(messageFor(commitError), { kind: 'error' })
      }
    } finally {
      setCommitting(false)
    }
  }

  async function refreshBranchWithConflictScan() {
    const targetRepository = repository
    const targetBranch = branch
    if (!targetRepository || !targetBranch) return
    const seq = ++treeSeq.current
    setLoadingTree(true)
    let refreshed: GitHubTree
    try {
      refreshed = await getGitHubTree(targetRepository, targetBranch)
    } catch (refreshError) {
      if (seq === treeSeq.current) {
        setLoadingTree(false)
        showToast(messageFor(refreshError), { kind: 'error' })
      }
      return
    }
    if (seq !== treeSeq.current) return
    setLoadingTree(false)
    setTree(refreshed)
    const refreshedShas = new Map(
      refreshed.files.map((file) => [file.path, file.sha] as const)
    )
    const conflictedPaths: string[] = []
    const staleCleanPaths: string[] = []
    const deletedPaths: string[] = []
    for (const candidate of openFiles) {
      if (isDirtyFile(candidate)) {
        if (
          !candidate.isNew &&
          !refreshed.truncated &&
          !refreshedShas.has(candidate.path)
        ) {
          // Deleted upstream — resolvable without re-reading the file
          // (which would 404 and leave the conflict stuck forever).
          deletedPaths.push(candidate.path)
          continue
        }
        const upstreamChanged = candidate.isNew
          ? refreshedShas.has(candidate.path)
          : refreshedShas.get(candidate.path) !== candidate.base.sha
        if (upstreamChanged) conflictedPaths.push(candidate.path)
      } else if (
        refreshedShas.has(candidate.path) &&
        refreshedShas.get(candidate.path) !== candidate.base.sha
      ) {
        staleCleanPaths.push(candidate.path)
      }
    }
    for (const path of staleCleanPaths) {
      try {
        const fresh = await readGitHubFile(targetRepository, targetBranch, path)
        if (seq !== treeSeq.current) return
        setOpenFiles((files) =>
          files.map((candidate) =>
            candidate.path === path && !isDirtyFile(candidate)
              ? {
                  path,
                  base: fresh,
                  draft: fresh.content,
                  isNew: false,
                  conflicted: false,
                }
              : candidate
          )
        )
      } catch {
        // The next open or refresh retries; the stale base stays unchanged.
      }
    }
    if (conflictedPaths.length === 0 && deletedPaths.length === 0) {
      if (openFiles.some(isDirtyFile)) {
        showToast(
          'Branch refreshed — your drafts apply cleanly to the latest files.',
          { kind: 'success' }
        )
      }
      return
    }
    setOpenFiles((files) =>
      files.map((candidate) =>
        conflictedPaths.includes(candidate.path)
          ? { ...candidate, conflicted: true }
          : candidate
      )
    )
    for (const path of conflictedPaths) {
      await resolveConflict(path)
    }
    for (const path of deletedPaths) {
      await resolveDeletedUpstream(path)
    }
  }

  async function resolveDeletedUpstream(path: string) {
    const targetRepository = repository
    const targetBranch = branch
    if (!targetRepository || !targetBranch) return
    const choice = await choiceDialog({
      title: `${fileName(path)} was deleted on GitHub`,
      body: `${path} no longer exists on ${targetBranch}. Keep your draft to re-create the file on the next commit, or discard it.`,
      actions: [
        { id: 'keep', label: 'Keep mine (re-create the file)', kind: 'primary' },
        { id: 'discard', label: 'Discard mine', kind: 'destructive' },
      ],
      defaultActionId: 'keep',
    })
    if (
      contextRef.current.repository !== targetRepository ||
      contextRef.current.branch !== targetBranch
    ) {
      return
    }
    if (choice === 'keep') {
      setOpenFiles((files) =>
        files.map((candidate) =>
          candidate.path === path
            ? { ...candidate, isNew: true, conflicted: false }
            : candidate
        )
      )
      return
    }
    if (choice !== 'discard') return
    clearStoredDraft(targetRepository, targetBranch, path)
    const current = latestRef.current.openFiles
    const index = current.findIndex((candidate) => candidate.path === path)
    const remaining = current.filter((candidate) => candidate.path !== path)
    setOpenFiles((files) => files.filter((candidate) => candidate.path !== path))
    if (latestRef.current.activePath === path) {
      const next = remaining[Math.min(index, remaining.length - 1)] ?? null
      setActivePath(next?.path ?? null)
      if (next) rememberActiveFile(next.path)
    }
    if (remaining.length === 0) {
      try {
        localStorage.removeItem(
          `statskey.github.file:${targetRepository}:${targetBranch}`
        )
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  async function resolveConflict(path: string) {
    const targetRepository = repository
    const targetBranch = branch
    if (!targetRepository || !targetBranch) return
    const choice = await choiceDialog({
      title: `${fileName(path)} changed on GitHub`,
      body: `Your unsaved edits to ${path} are based on an older version. Load their version to discard your edits, or keep yours to replace theirs on the next commit.`,
      actions: [
        { id: 'theirs', label: 'Load their version', kind: 'destructive' },
        { id: 'mine', label: 'Keep mine', kind: 'primary' },
        { id: 'later', label: 'Decide later', kind: 'cancel' },
      ],
      defaultActionId: 'mine',
    })
    if (choice !== 'theirs' && choice !== 'mine') return
    try {
      const fresh = await readGitHubFile(targetRepository, targetBranch, path)
      if (
        contextRef.current.repository !== targetRepository ||
        contextRef.current.branch !== targetBranch
      ) {
        return
      }
      setOpenFiles((files) =>
        files.map((candidate) =>
          candidate.path === path
            ? {
                path,
                base: fresh,
                draft: choice === 'theirs' ? fresh.content : candidate.draft,
                isNew: false,
                conflicted: false,
              }
            : candidate
        )
      )
      if (choice === 'theirs') {
        clearStoredDraft(targetRepository, targetBranch, path)
      }
    } catch (loadError) {
      showToast(messageFor(loadError), { kind: 'error' })
    }
  }

  async function disconnect() {
    const dirty = openFiles.filter(isDirtyFile)
    const newFiles = dirty.filter((candidate) => candidate.isNew)
    const restorableCount = dirty.length - newFiles.length
    // Stash before asking so the dialog only claims drafts are safe when
    // they actually made it into browser storage. New files are never
    // restorable, so they get an explicit loss warning instead.
    const stashed = stashDirtyDrafts()
    const warnings: string[] = []
    if (newFiles.length > 0) {
      warnings.push(
        newFiles.length === 1
          ? `The unsaved new file ${newFiles[0].path} will be lost.`
          : `${newFiles.length} unsaved new files will be lost.`
      )
    }
    if (restorableCount > 0) {
      warnings.push(
        stashed
          ? `${restorableCount} draft${
              restorableCount === 1 ? '' : 's'
            } stay on this device and restore when you reconnect and reopen the file${
              restorableCount === 1 ? '' : 's'
            }.`
          : `${restorableCount} draft${
              restorableCount === 1 ? '' : 's'
            } could not be saved to browser storage and will be lost.`
      )
    }
    const confirmed = await confirmDialog({
      title: 'Disconnect GitHub from StatsKey?',
      body:
        warnings.length > 0
          ? warnings.join(' ')
          : 'You can reconnect at any time. StatsKey keeps no repository access after disconnecting.',
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await disconnectGitHubWorkspace()
    } catch (disconnectError) {
      showToast(messageFor(disconnectError), { kind: 'error' })
    }
  }

  if (state.loading) {
    return <div className="github-workspace-loading">Opening GitHub workspace…</div>
  }

  if (!connected) {
    return (
      <GitHubConnectionSetup
        error={state.error || connectError}
        busy={connecting}
        onConnect={async (token) => {
          setConnecting(true)
          setConnectError(null)
          try {
            await connectGitHubWorkspace(token)
          } catch (connectFailure) {
            setConnectError(messageFor(connectFailure))
            throw connectFailure
          } finally {
            setConnecting(false)
          }
        }}
      />
    )
  }

  const cloudTree = buildTree(tree?.files ?? [])
  const repositoryOptions = repositories.filter((candidate) =>
    candidate.fullName
      .toLocaleLowerCase()
      .includes(repositoryFilter.trim().toLocaleLowerCase())
  )
  const displayedRepositoryOptions =
    selectedRepository &&
    !repositoryOptions.some(
      (candidate) => candidate.fullName === selectedRepository.fullName
    )
      ? [selectedRepository, ...repositoryOptions]
      : repositoryOptions
  const filteredTree = query.trim()
    ? filterTree(cloudTree, query.trim().toLowerCase())
    : cloudTree
  const reviewFile = commitReviewOpen
    ? dirtyFiles.find((candidate) => candidate.path === reviewPath) ??
      dirtyFiles[0] ??
      null
    : null

  return (
    <div className="github-workspace">
      <aside className="github-workspace__explorer">
        <header>
          <div>
            <span>
              GitHub workspace
              {state.connection?.login
                ? ` · @${state.connection.login}`
                : ''}
            </span>
            <b>{repository || 'Choose repository'}</b>
          </div>
          <button onClick={() => void disconnect()}>
            Disconnect
          </button>
        </header>
        <label>
          <span>Find repository</span>
          <input
            value={repositoryFilter}
            onChange={(event) => setRepositoryFilter(event.target.value)}
            placeholder={`Search ${repositories.length} repositories`}
            aria-label="Search GitHub repositories"
          />
        </label>
        <label>
          <span>Repository</span>
          <select
            value={repository}
            onChange={(event) => {
              void selectRepository(event.target.value)
            }}
          >
            {displayedRepositoryOptions.map((item) => (
              <option key={item.id} value={item.fullName}>
                {item.fullName}{item.private ? ' · private' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="github-workspace__recent">
          {repositories.slice(0, 4).map((item) => (
            <button
              key={item.id}
              className={item.fullName === repository ? 'active' : ''}
              onClick={() => {
                void selectRepository(item.fullName)
              }}
              title={item.fullName}
            >
              {item.name}
            </button>
          ))}
        </div>
        <label>
          <span>Branch</span>
          <select
            value={branch}
            onChange={(event) => void selectBranch(event.target.value)}
          >
            {branches.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
                {item.protected ? ' · protected' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="github-workspace__search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter repository files"
          />
          <button
            onClick={() =>
              void (dirtyFiles.length > 0
                ? refreshBranchWithConflictScan()
                : refreshTree())
            }
            disabled={loadingTree}
            title="Refresh branch"
          >
            ↻
          </button>
        </div>
        <div className="github-explorer-actions">
          <button
            onClick={() => void createNewFile()}
            disabled={!tree || loadingTree}
          >
            + New file
          </button>
        </div>
        {tree?.truncated && (
          <div className="github-workspace__tree-warning">
            This repository tree is truncated. Narrow access or open a smaller branch before editing.
          </div>
        )}
        <nav>
          {loadingTree ? (
            <span>Reading repository…</span>
          ) : filteredTree.length === 0 ? (
            <span>No matching files.</span>
          ) : (
            filteredTree.map((node) => (
              <CloudTree
                key={node.path}
                node={node}
                selectedPath={activePath ?? undefined}
                openingPath={openingPath ?? undefined}
                onOpen={openFile}
              />
            ))
          )}
        </nav>
      </aside>

      <main className="github-workspace__editor">
        {openFiles.length > 0 && (
          <div className="github-editor-tabs" role="tablist" aria-label="Open files">
            {openFiles.map((candidate) => {
              const dirty = isDirtyFile(candidate)
              return (
                <div
                  key={candidate.path}
                  className={[
                    'github-editor-tab',
                    candidate.path === activePath ? 'active' : '',
                    candidate.conflicted ? 'conflicted' : dirty ? 'dirty' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    role="tab"
                    aria-selected={candidate.path === activePath}
                    title={candidate.path}
                    onClick={() => activateFile(candidate.path)}
                  >
                    <span className="github-editor-tab__dot" aria-hidden="true" />
                    <b>{fileName(candidate.path)}</b>
                  </button>
                  <button
                    className="github-editor-tab__close"
                    aria-label={`Close ${candidate.path}`}
                    onClick={() => void closeTab(candidate.path)}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            {openingPath &&
              !openFiles.some((candidate) => candidate.path === openingPath) && (
                <div className="github-editor-tab--opening">
                  Opening {fileName(openingPath)}…
                </div>
              )}
          </div>
        )}
        {activeFile ? (
          <>
            <header>
              <div>
                <b>{activeFile.path}</b>
                <span>
                  {repository} · {branch} · {tree?.headSha.slice(0, 7)}
                  {activeFile.isNew ? ' · new file' : ''}
                </span>
              </div>
              <div>
                {!selectedRepository?.canPush && <span>Read only</span>}
                {selectedBranch?.protected && <span>Protected branch</span>}
                {!activeFile.isNew && (
                  <a
                    href={`https://github.com/${repository}/blob/${encodeURIComponent(
                      branch
                    )}/${activeFile.path
                      .split('/')
                      .map(encodeURIComponent)
                      .join('/')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open on GitHub ↗
                  </a>
                )}
                <button
                  onClick={() => {
                    updateDraft(activeFile.path, activeFile.base.content)
                    clearStoredDraft(repository, branch, activeFile.path)
                  }}
                  disabled={
                    activeFile.isNew ||
                    activeFile.draft === activeFile.base.content ||
                    committing
                  }
                >
                  Revert
                </button>
              </div>
            </header>
            <MonacoWorkspaceEditor
              path={`github://${repository}/${branch}/${activeFile.path}`}
              language={languageFor(activeFile.path)}
              value={activeFile.draft}
              onChange={(value) => updateDraft(activeFile.path, value)}
              onSave={openReview}
            />
            <footer>
              <input
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
                maxLength={500}
              />
              <span>
                {dirtyFiles.length === 0
                  ? 'No changes'
                  : `${dirtyFiles.length} changed file${
                      dirtyFiles.length === 1 ? '' : 's'
                    }`}
              </span>
              <button
                onClick={openReview}
                disabled={
                  committing ||
                  dirtyFiles.length === 0 ||
                  !selectedRepository?.canPush ||
                  tree?.truncated === true
                }
              >
                Review changes
                {dirtyFiles.length > 0 ? ` (${dirtyFiles.length})` : ''}
              </button>
            </footer>
          </>
        ) : (
          <div className="github-workspace__empty">
            {openingPath ? (
              <>
                <span className="github-opening-spinner" aria-hidden="true" />
                <h1>Opening {fileName(openingPath)}…</h1>
                <p>{openingPath}</p>
              </>
            ) : (
              <>
                <span aria-hidden="true">⌘</span>
                <h1>Choose a repository file.</h1>
                <p>
                  Open one or more files from the tree — edits stay as local
                  drafts until you commit them to the selected GitHub branch.
                </p>
              </>
            )}
          </div>
        )}
        {commitReviewOpen && tree && reviewFile && (
          <div
            className="github-commit-review"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget && !committing) {
                setCommitReviewOpen(false)
              }
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="github-commit-review-title"
            >
              <header>
                <div>
                  <span>Remote commit review</span>
                  <h2 id="github-commit-review-title">
                    {dirtyFiles.length === 1
                      ? reviewFile.path
                      : `${dirtyFiles.length} changed files`}
                  </h2>
                  <p>
                    {repository} · {branch} · base {tree.headSha.slice(0, 7)}
                    {selectedBranch?.protected ? ' · protected branch' : ''}
                  </p>
                </div>
                <button
                  onClick={() => setCommitReviewOpen(false)}
                  aria-label="Close commit review"
                  disabled={committing}
                >
                  ×
                </button>
              </header>
              <div className="github-review-body">
                <aside className="github-review-files" aria-label="Changed files">
                  {dirtyFiles.map((candidate) => (
                    <button
                      key={candidate.path}
                      className={
                        candidate.path === reviewFile.path ? 'active' : ''
                      }
                      onClick={() => setReviewPath(candidate.path)}
                      title={candidate.path}
                    >
                      <b>{fileName(candidate.path)}</b>
                      <span className={candidate.conflicted ? 'conflict' : ''}>
                        {candidate.conflicted
                          ? 'Conflict'
                          : candidate.isNew
                          ? 'New file'
                          : 'Edited'}
                      </span>
                    </button>
                  ))}
                </aside>
                <div className="github-review-pane">
                  {reviewFile.conflicted && (
                    <div className="github-review-conflict">
                      <span>
                        {fileName(reviewFile.path)} changed on GitHub after you
                        started editing.
                      </span>
                      <button onClick={() => void resolveConflict(reviewFile.path)}>
                        Resolve conflict
                      </button>
                    </div>
                  )}
                  <div className="github-commit-review__diff">
                    <DiffEditor
                      original={reviewFile.base.content}
                      modified={reviewFile.draft}
                      language={languageFor(reviewFile.path)}
                      theme="vs"
                      options={{
                        automaticLayout: true,
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 11,
                        lineHeight: 18,
                      }}
                    />
                  </div>
                </div>
              </div>
              <footer>
                <div>
                  <span>Commit message</span>
                  <b>{commitMessage.trim() || defaultCommitMessage(dirtyFiles)}</b>
                  {dirtyFiles.length > MAX_COMMIT_FILES && (
                    <small className="github-review-limit">
                      Commit at most {MAX_COMMIT_FILES} files at once — close or
                      revert some drafts first.
                    </small>
                  )}
                </div>
                <div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setCommitReviewOpen(false)}
                    disabled={committing}
                  >
                    Keep editing
                  </button>
                  <button
                    ref={reviewPrimaryRef}
                    className="btn btn-primary"
                    onClick={() => void commit()}
                    disabled={
                      committing ||
                      conflictedCount > 0 ||
                      dirtyFiles.length > MAX_COMMIT_FILES
                    }
                  >
                    {committing
                      ? 'Committing…'
                      : conflictedCount > 0
                      ? 'Resolve conflicts to commit'
                      : 'Commit directly to GitHub'}
                  </button>
                </div>
              </footer>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

function GitHubConnectionSetup({
  error,
  busy,
  onConnect,
}: {
  error: string | null
  busy: boolean
  onConnect: (token: string) => Promise<void>
}) {
  const [token, setToken] = useState('')
  const [showTokenForm, setShowTokenForm] = useState(false)
  const [device, setDevice] = useState<GitHubDeviceAuthorization | null>(null)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!device) return
    let active = true
    let delayMs = Math.max(device.interval, 5) * 1000
    const poll = async () => {
      try {
        const result = await pollGitHubDeviceAuthorization()
        if (!active) return
        if (result.status === 'connected') return
        if (result.status === 'expired') {
          setDevice(null)
          setDeviceNotice('The GitHub code expired. Start again when ready.')
          return
        }
        if (result.status === 'denied') {
          setDevice(null)
          setDeviceNotice('GitHub reported the request was declined.')
          return
        }
        if (result.interval) delayMs = Math.max(result.interval, 5) * 1000
      } catch (pollError) {
        if (!active) return
        setDevice(null)
        setDeviceNotice(messageFor(pollError))
        return
      }
      pollTimer.current = window.setTimeout(() => void poll(), delayMs)
    }
    pollTimer.current = window.setTimeout(() => void poll(), delayMs)
    return () => {
      active = false
      if (pollTimer.current != null) window.clearTimeout(pollTimer.current)
    }
  }, [device])

  async function startDeviceFlow() {
    setDeviceBusy(true)
    setDeviceNotice(null)
    setCodeCopied(false)
    try {
      const authorization = await startGitHubDeviceAuthorization()
      setDevice(authorization)
      try {
        await navigator.clipboard.writeText(authorization.userCode)
        setCodeCopied(true)
      } catch {
        // Clipboard access is optional; the code stays visible either way.
      }
      window.open(authorization.verificationUri, '_blank', 'noopener,noreferrer')
    } catch (startError) {
      setDeviceNotice(messageFor(startError))
      setShowTokenForm(true)
    } finally {
      setDeviceBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!token.trim()) return
    try {
      await onConnect(token.trim())
      setToken('')
    } catch {
      // Keep the token in the field so a transient failure can be retried.
    }
  }

  return (
    <div className="github-setup">
      <section>
        <span>Browser workspaces</span>
        <h1>Connect GitHub</h1>
        <p>
          StatsKey edits GitHub repositories directly. Approve access once on
          GitHub and this workspace stays connected — access is encrypted
          server-side and revocable from GitHub at any time.
        </p>
        {device ? (
          <div className="github-device">
            <span>Enter this code on GitHub to approve</span>
            <b className="github-device__code">{device.userCode}</b>
            <a
              href={device.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {device.verificationUri.replace('https://', '')} ↗
            </a>
            <p>
              {codeCopied ? 'Code copied to your clipboard. ' : ''}
              Waiting for approval…
            </p>
            <button
              type="button"
              className="github-setup__alt"
              onClick={() => {
                setDevice(null)
                setDeviceNotice(null)
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="github-setup__actions">
            <button
              type="button"
              className="github-setup__connect"
              onClick={() => void startDeviceFlow()}
              disabled={deviceBusy}
            >
              {deviceBusy ? 'Contacting GitHub…' : 'Connect with GitHub'}
            </button>
            <button
              type="button"
              className="github-setup__alt"
              onClick={() => setShowTokenForm((value) => !value)}
            >
              {showTokenForm
                ? 'Hide fine-grained token setup'
                : 'Use a fine-grained token instead'}
            </button>
          </div>
        )}
        {deviceNotice && <div className="github-setup__error">{deviceNotice}</div>}
        {showTokenForm && !device && (
          <>
            <ol>
              <li>
                <b>1</b>
                <span>
                  Open{' '}
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub fine-grained token setup ↗
                  </a>
                </span>
              </li>
              <li><b>2</b><span>Select only the repositories you want in StatsKey.</span></li>
              <li>
                <b>3</b>
                <span>Grant repository “Contents” read/write and “Metadata” read.</span>
              </li>
              <li><b>4</b><span>Paste the token below. It is encrypted server-side.</span></li>
            </ol>
            <form onSubmit={submit}>
              <label>
                Fine-grained GitHub token
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="github_pat_…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button type="submit" disabled={busy || !token.trim()}>
                {busy ? 'Connecting…' : 'Connect GitHub'}
              </button>
            </form>
          </>
        )}
        {error && <div className="github-setup__error">{error}</div>}
        <small>
          Nothing is stored in browser storage or client-readable Firestore.
          Revoke StatsKey&apos;s access anytime from GitHub settings.
        </small>
      </section>
    </div>
  )
}

function CloudTree({
  node,
  selectedPath,
  openingPath,
  onOpen,
}: {
  node: CloudTreeNode
  selectedPath?: string
  openingPath?: string
  onOpen: (path: string) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  if (node.kind === 'file') {
    const opening = openingPath === node.path
    return (
      <button
        className={[
          selectedPath === node.path ? 'active' : '',
          opening ? 'github-tree-loading' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => void onOpen(node.path)}
        title={node.path}
      >
        <span>{opening ? '…' : extensionBadge(node.name)}</span>
        <b>{node.name}</b>
      </button>
    )
  }
  return (
    <div className="github-tree-folder">
      <button onClick={() => setOpen((value) => !value)}>
        <span>{open ? '⌄' : '›'}</span>
        <b>{node.name}</b>
      </button>
      {open && (
        <div>
          {node.children.map((child) => (
            <CloudTree
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              openingPath={openingPath}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function buildTree(files: GitHubTreeFile[]): CloudTreeNode[] {
  const root: CloudTreeNode = {
    name: '',
    path: '',
    kind: 'directory',
    children: [],
  }
  for (const file of files) {
    const parts = file.path.split('/')
    let current = root
    parts.forEach((part, index) => {
      const partPath = parts.slice(0, index + 1).join('/')
      let child = current.children.find((item) => item.name === part)
      if (!child) {
        child = {
          name: part,
          path: partPath,
          kind: index === parts.length - 1 ? 'file' : 'directory',
          children: [],
          ...(index === parts.length - 1 ? { file } : {}),
        }
        current.children.push(child)
      }
      current = child
    })
  }
  const sort = (nodes: CloudTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    nodes.forEach((node) => sort(node.children))
  }
  sort(root.children)
  return root.children
}

function filterTree(nodes: CloudTreeNode[], query: string): CloudTreeNode[] {
  const filtered: CloudTreeNode[] = []
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.path.toLowerCase().includes(query)) filtered.push(node)
      continue
    }
    const children = filterTree(node.children, query)
    if (children.length > 0 || node.path.toLowerCase().includes(query)) {
      filtered.push({ ...node, children })
    }
  }
  return filtered
}

function mergeCommittedTreeFiles(
  files: GitHubTreeFile[],
  committed: Map<string, { sha: string; size: number }>
): GitHubTreeFile[] {
  const merged = files.map((file) => {
    const entry = committed.get(file.path)
    return entry ? { ...file, sha: entry.sha || file.sha, size: entry.size } : file
  })
  for (const [path, entry] of committed) {
    if (!merged.some((file) => file.path === path)) {
      merged.push({ path, sha: entry.sha, size: entry.size })
    }
  }
  return merged
}

function defaultCommitMessage(dirty: OpenWorkspaceFile[]): string {
  if (dirty.length === 1) {
    return `${dirty[0].isNew ? 'Add' : 'Update'} ${dirty[0].path}`
  }
  return `Update ${dirty.length} files`
}

function normalizeNewFilePath(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^\.?\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
  if (!trimmed || trimmed.includes('\\')) return null
  if ([...trimmed].some((char) => char.charCodeAt(0) < 32)) return null
  const parts = trimmed.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return null
  }
  return trimmed
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

function extensionBadge(name: string): string {
  const extension = name.split('.').pop()?.toUpperCase() ?? 'TXT'
  return extension.length <= 4 ? extension : extension.slice(0, 3)
}

function languageFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  return {
    cjs: 'javascript',
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rs: 'rust',
    sh: 'shell',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  }[extension ?? ''] ?? 'plaintext'
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
