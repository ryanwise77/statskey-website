import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  WorkbenchCommandPalette,
  type WorkbenchCommand,
} from '../components/assistant/WorkbenchCommandPalette'
import {
  MonacoWorkspaceEditor,
  type WorkspaceInlineSelection,
} from '../components/workspace/MonacoWorkspaceEditor'
import {
  WorkspaceInlineEdit,
  type WorkspaceInlineEditRequest,
} from '../components/workspace/WorkspaceInlineEdit'
import { GitHubCloudWorkspace } from '../components/workspace/GitHubCloudWorkspace'
import { WorkspaceQuickOpen } from '../components/workspace/WorkspaceQuickOpen'
import { WorkspaceAgentRail } from '../components/workspace/WorkspaceAgentRail'
import { WorkspaceBottomDock } from '../components/workspace/WorkspaceBottomDock'
import { WorkspaceLayoutControls } from '../components/workspace/WorkspaceLayoutControls'
import { WorkspaceTabs } from '../components/workspace/WorkspaceTabs'
import {
  clampAgentWidth,
  clampBottomHeight,
  clampExplorerWidth,
  useWorkspaceLayout,
} from '../components/workspace/useWorkspaceLayout'
import type { OpenWorkspaceDocument } from '../components/workspace/workspaceTypes'
import {
  getDesktopBridge,
  AGENT_PREFILL_EVENT,
  SUMMON_FOCUS_EVENT,
  type DesktopWorkspaceFile,
  type DesktopWorkspaceCheckpoint,
  type DesktopWorkspaceNode,
  type DesktopWorkspaceSearchResult,
  type DesktopWorkspaceSearchMode,
  type DesktopWorkspaceIndexState,
  type DesktopRecentProject,
  type DesktopWorkspaceState,
} from '../lib/desktop'
import {
  announceWorkspaceMutation,
  consumeWorkspaceFileOpenRequest,
  consumeWorkspaceQuickTool,
  getWorkspaceAttachments,
  setActiveWorkspaceDocument,
  toggleWorkspaceAttachment,
  workspaceImportResultError,
  WORKSPACE_CONTEXT_EVENT,
  WORKSPACE_MUTATION_EVENT,
  WORKSPACE_OPEN_FILE_EVENT,
  WORKSPACE_QUICK_TOOL_EVENT,
  type WorkspaceFileOpenRequest,
  type WorkspaceQuickTool,
  type WorkspaceMutation,
} from '../lib/workspaceContext'
import {
  durableWorkspaceEditorSession,
  resolveWorkspaceEditorSession,
  type StoredWorkspaceEditorSession,
} from '../lib/workspaceEditorSession'
import {
  mergeWorkspaceSearchResults,
  shouldUseDirectWorkspaceSearch,
} from '../lib/workspaceSearch'
import {
  choiceDialog,
  confirmDialog,
  promptDialog,
  showToast,
} from '../lib/ui/dialogs'

const ACTIVE_WORKSPACE_FILE_KEY = 'statskey.workspace.activeFile'
const WORKSPACE_SESSION_KEY = 'statskey.workspace.editorSession.v1'
const WORKSPACE_TAB_ORDER_KEY = 'statskey.workspace.tabOrder.v1'
const WORKSPACE_SESSION_MIGRATION_KEY =
  'statskey.workspace.sessionMigration.v2'
const MAX_PERSISTED_DRAFT_CHARACTERS = 1_500_000
const WORKSPACE_PERSIST_DEBOUNCE_MS = 500
const WORKSPACE_PERSIST_MAX_WAIT_MS = 5_000
const WORKSPACE_SAVE_EVENT = 'statskey:workspace-save-active'

export function Workspace() {
  const bridge = getDesktopBridge()
  const navigate = useNavigate()
  const {
    layout,
    patchLayout,
    applyPreset,
    resetLayout,
  } = useWorkspaceLayout()
  const {
    editorOpen,
    agentOpen,
    agentWidth,
    agentSide,
    explorerOpen,
    explorerWidth,
    bottomPanel,
    bottomHeight,
    canvasMode,
  } = layout
  const terminalOpen = bottomPanel === 'terminal'
  const changesOpen = bottomPanel === 'changes'
  const [workspace, setWorkspace] = useState<DesktopWorkspaceState | null>(null)
  const [recentProjects, setRecentProjects] = useState<DesktopRecentProject[]>(
    []
  )
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [secondaryPath, setSecondaryPath] = useState<string | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenWorkspaceDocument[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DesktopWorkspaceSearchResult[]>([])
  const [searchMode, setSearchMode] =
    useState<DesktopWorkspaceSearchMode>('hybrid')
  const [indexState, setIndexState] =
    useState<DesktopWorkspaceIndexState | null>(null)
  const [searching, setSearching] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState(getWorkspaceAttachments)
  const [checkpoints, setCheckpoints] = useState<DesktopWorkspaceCheckpoint[]>([])
  const [checkpointsOpen, setCheckpointsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [pendingLines, setPendingLines] = useState<Record<string, number>>({})
  const [creatingFile, setCreatingFile] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [newFileRoot, setNewFileRoot] = useState('')
  const [renamingFile, setRenamingFile] =
    useState<DesktopWorkspaceNode | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloning, setCloning] = useState(false)
  const [treeVersion, setTreeVersion] = useState(0)
  const [sessionReady, setSessionReady] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<number | null>(null)
  const searchRequestRef = useRef(0)
  const initialFileOpening = useRef<string | null>(null)
  const summonRedispatch = useRef(false)
  const focusLayoutBeforeToggle = useRef<typeof layout | null>(null)
  const openFilesRef = useRef<OpenWorkspaceDocument[]>([])
  const mutationRefreshQueue = useRef<Promise<void>>(Promise.resolve())
  const workspaceRef = useRef<DesktopWorkspaceState | null>(null)
  const workspaceActivationGeneration = useRef(0)
  const localWorkspaceChangeDepth = useRef(0)
  const workspaceReconcileQueue = useRef<Promise<void>>(Promise.resolve())
  const workspaceReconcilerRef = useRef<
    (next: DesktopWorkspaceState) => Promise<void>
  >(
    async () => {}
  )
  const quickToolHandlerRef = useRef<(tool: WorkspaceQuickTool) => void>(
    () => {}
  )
  const recentlyClosedRef = useRef<Array<{ path: string; line: number | null }>>(
    []
  )
  const mruRef = useRef<string[]>([])
  const mruCycleRef = useRef<{ list: string[]; index: number } | null>(null)
  const pendingPersistRef = useRef<(() => void) | null>(null)
  const lastPersistFlushRef = useRef(Date.now())
  const closingPathsRef = useRef<Set<string>>(new Set())

  const primaryDocument = useMemo(
    () => openFiles.find((document) => document.file.path === selectedPath) ?? null,
    [openFiles, selectedPath]
  )
  const secondaryDocument = useMemo(
    () =>
      openFiles.find((document) => document.file.path === secondaryPath) ?? null,
    [openFiles, secondaryPath]
  )
  const selectedDocument = useMemo(
    () =>
      openFiles.find((document) => document.file.path === focusedPath) ??
      primaryDocument,
    [focusedPath, openFiles, primaryDocument]
  )
  const selectedFile = selectedDocument?.file ?? null

  const setAgentOpen = (next: SetStateAction<boolean>) =>
    patchLayout({
      agentOpen:
        typeof next === 'function' ? next(agentOpen) : next,
    })
  const setAgentWidth = (next: number) =>
    patchLayout({ agentWidth: clampAgentWidth(next) })
  const setExplorerOpen = (next: SetStateAction<boolean>) =>
    patchLayout({
      explorerOpen:
        typeof next === 'function' ? next(explorerOpen) : next,
    })
  function revealExplorer(focusSearch = false) {
    patchLayout({ explorerOpen: true })
    if (focusSearch) {
      window.setTimeout(() => searchRef.current?.focus(), 0)
    }
  }
  const setTerminalOpen = (next: SetStateAction<boolean>) => {
    const value = typeof next === 'function' ? next(terminalOpen) : next
    patchLayout({
      ...(value ? { editorOpen: true } : {}),
      bottomPanel: value
        ? 'terminal'
        : terminalOpen
          ? null
          : bottomPanel,
    })
  }
  const setChangesOpen = (next: SetStateAction<boolean>) => {
    const value = typeof next === 'function' ? next(changesOpen) : next
    patchLayout({
      ...(value ? { editorOpen: true } : {}),
      bottomPanel: value
        ? 'changes'
        : changesOpen
          ? null
          : bottomPanel,
    })
  }

  quickToolHandlerRef.current = (tool: WorkspaceQuickTool) => {
    if (tool === 'editor') {
      patchLayout({ editorOpen: true })
    } else if (tool === 'explorer') {
      patchLayout({ explorerOpen: true })
    } else if (tool === 'terminal') {
      patchLayout({ editorOpen: true, bottomPanel: 'terminal' })
    } else if (tool === 'changes') {
      patchLayout({ editorOpen: true, bottomPanel: 'changes' })
    } else if (tool === 'agent') {
      patchLayout({ agentOpen: true })
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
      }, 0)
    } else if (tool === 'more') {
      setCommandPaletteOpen(true)
    } else if (tool === 'open-project') {
      void openProject()
    } else if (tool === 'new-project') {
      void createProject()
    } else if (tool === 'quick-open') {
      setQuickOpenOpen(true)
    } else if (tool === 'search-files') {
      revealExplorer(true)
    } else if (tool === 'add-files') {
      void addFiles()
    }
  }

  useEffect(() => {
    setActiveWorkspaceDocument(
      selectedDocument
        ? {
            path: selectedDocument.file.path,
            name: selectedDocument.file.name,
            relativePath: selectedDocument.file.relativePath,
            content: selectedDocument.draft,
          }
        : null
    )
  }, [selectedDocument])

  useEffect(
    () => () => {
      setActiveWorkspaceDocument(null)
    },
    []
  )

  useEffect(() => {
    const onSummon = () => {
      if (summonRedispatch.current) {
        summonRedispatch.current = false
        return
      }
      if (!agentOpen) {
        setAgentOpen(true)
        summonRedispatch.current = true
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
        }, 0)
      }
    }
    window.addEventListener(SUMMON_FOCUS_EVENT, onSummon)
    return () => window.removeEventListener(SUMMON_FOCUS_EVENT, onSummon)
  }, [agentOpen])

  useEffect(() => {
    const pending = consumeWorkspaceQuickTool()
    if (pending) quickToolHandlerRef.current(pending)
    const onQuickTool = (event: Event) => {
      consumeWorkspaceQuickTool()
      const tool = (event as CustomEvent<WorkspaceQuickTool>).detail
      if (tool) quickToolHandlerRef.current(tool)
    }
    window.addEventListener(WORKSPACE_QUICK_TOOL_EVENT, onQuickTool)
    return () =>
      window.removeEventListener(WORKSPACE_QUICK_TOOL_EVENT, onQuickTool)
  }, [])

  useEffect(() => {
    if (!bridge) return
    let cancelled = false
    ;(async () => {
      try {
        const [next, recents] = await Promise.all([
          bridge.workspace.getState(),
          bridge.workspace.recentProjects(),
        ])
        if (cancelled) return
        commitWorkspaceState(next)
        setRecentProjects(recents)
        setNewFileRoot(next.roots[0]?.path ?? '')
        const restored = await restoreEditorSession(next)
        if (!restored) await ensureInitialFile(next)
        if (!cancelled) setSessionReady(true)
      } catch {
        if (!cancelled) commitWorkspaceState(null)
      }
    })()
    const unsubscribe = bridge.workspace.onState((next) => {
      if (cancelled) return
      if (
        localWorkspaceChangeDepth.current > 0 ||
        sameWorkspaceIdentity(workspaceRef.current, next)
      ) {
        commitWorkspaceState(next)
        setNewFileRoot((current) =>
          next.roots.some((root) => root.path === current)
            ? current
            : next.roots[0]?.path ?? ''
        )
        setTreeVersion((current) => current + 1)
        return
      }
      workspaceReconcileQueue.current = workspaceReconcileQueue.current
        .then(async () => {
          if (sameWorkspaceIdentity(workspaceRef.current, next)) {
            commitWorkspaceState(next)
            return
          }
          await workspaceReconcilerRef.current(next)
        })
        .catch((error) => {
          setWorkspaceError(
            error instanceof Error
              ? error.message
              : 'Could not switch to the selected workspace.'
          )
        })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bridge])

  useEffect(() => {
    if (searchTimerRef.current != null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }

    const requestId = ++searchRequestRef.current
    const trimmedQuery = query.trim()
    if (!bridge || !trimmedQuery) {
      setSearching(false)
      setResults([])
      return
    }

    setSearching(true)
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null
      void performWorkspaceSearch(
        trimmedQuery,
        searchMode,
        indexState?.status,
        requestId
      )
    }, 220)

    return () => {
      searchRequestRef.current += 1
      if (searchTimerRef.current != null) {
        window.clearTimeout(searchTimerRef.current)
        searchTimerRef.current = null
      }
    }
  }, [
    bridge,
    indexState?.status,
    query,
    searchMode,
    treeVersion,
  ])

  useEffect(() => {
    if (!bridge || !sessionReady) return
    const applyFileRequest = async (request: WorkspaceFileOpenRequest) => {
      patchLayout({ editorOpen: true })
      setWorkspaceError(null)
      try {
        const file = await bridge.workspace.readFile(request.path, false)
        if (!file) {
          setWorkspaceError('That changed file is no longer available in this workspace.')
          return
        }
        activateFile(file, request.line ?? null)
      } catch (error) {
        setWorkspaceError(
          error instanceof Error ? error.message : 'Could not open that changed file.'
        )
      }
    }
    const pending = consumeWorkspaceFileOpenRequest()
    if (pending) void applyFileRequest(pending)
    const onFileRequest = (event: Event) => {
      consumeWorkspaceFileOpenRequest()
      const request = (event as CustomEvent<WorkspaceFileOpenRequest>).detail
      if (request?.path) void applyFileRequest(request)
    }
    window.addEventListener(WORKSPACE_OPEN_FILE_EVENT, onFileRequest)
    return () =>
      window.removeEventListener(WORKSPACE_OPEN_FILE_EVENT, onFileRequest)
  }, [bridge, patchLayout, sessionReady])

  useEffect(() => {
    document.body.classList.toggle('workspace-canvas-mode', canvasMode)
    return () => document.body.classList.remove('workspace-canvas-mode')
  }, [canvasMode])

  useEffect(() => {
    if (!bridge) return
    let active = true
    void bridge.workspace.indexState().then((state) => {
      if (active && state) setIndexState(state)
    })
    const unsubscribe = bridge.workspace.onIndexState((state) => {
      if (active) setIndexState(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge])

  useEffect(() => {
    if (!sessionReady) return
    const flush = () => {
      const pending = pendingPersistRef.current
      pendingPersistRef.current = null
      if (!pending) return
      lastPersistFlushRef.current = Date.now()
      pending()
    }
    pendingPersistRef.current = () => persistEditorSession(workspace)
    // Trailing debounce with a max-wait: continuous edits must not defer the
    // crash-safety snapshot past WORKSPACE_PERSIST_MAX_WAIT_MS.
    const elapsed = Date.now() - lastPersistFlushRef.current
    const delay = Math.max(
      0,
      Math.min(
        WORKSPACE_PERSIST_DEBOUNCE_MS,
        WORKSPACE_PERSIST_MAX_WAIT_MS - elapsed
      )
    )
    const timer = window.setTimeout(flush, delay)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [
    focusedPath,
    openFiles,
    secondaryPath,
    selectedPath,
    sessionReady,
    workspace,
  ])

  useEffect(
    () => () => {
      const pending = pendingPersistRef.current
      pendingPersistRef.current = null
      pending?.()
    },
    []
  )

  useEffect(() => {
    if (!workspaceError) return
    showToast(workspaceError, { kind: 'error' })
  }, [workspaceError])

  useEffect(() => {
    const onMenuCloseTab = () => {
      if (focusedPath) void closeFile(focusedPath)
    }
    const onMenuSaveAll = () => {
      void saveAllFiles().then((ok) => {
        // Acknowledge the menu command so the main process can decide whether
        // it is safe to close the window ('Save All and Close').
        bridge?.menuCommandComplete?.('save-all', ok)
      })
    }
    window.addEventListener('statskey:menu-close-tab', onMenuCloseTab)
    window.addEventListener('statskey:menu-save-all', onMenuSaveAll)
    return () => {
      window.removeEventListener('statskey:menu-close-tab', onMenuCloseTab)
      window.removeEventListener('statskey:menu-save-all', onMenuSaveAll)
    }
  }, [focusedPath, openFiles, secondaryPath, selectedPath, workspace])

  function persistEditorSession(
    targetWorkspace: DesktopWorkspaceState | null,
    snapshot: {
      openFiles: OpenWorkspaceDocument[]
      selectedPath: string | null
      secondaryPath: string | null
      focusedPath: string | null
    } = { openFiles, selectedPath, secondaryPath, focusedPath }
  ) {
    let remainingDraftCharacters = MAX_PERSISTED_DRAFT_CHARACTERS
    const documents = snapshot.openFiles.slice(-12).map((document) => {
      const persistDraft =
        document.dirty && document.draft.length <= remainingDraftCharacters
      if (persistDraft) remainingDraftCharacters -= document.draft.length
      return {
        path: document.file.path,
        name: document.file.name,
        relativePath: document.file.relativePath,
        language: document.file.language,
        extension: document.file.extension,
        line: document.line,
        draft: persistDraft ? document.draft : null,
      }
    })
    const session: StoredWorkspaceEditorSession = {
      selectedPath: snapshot.selectedPath,
      secondaryPath: snapshot.secondaryPath,
      focusedPath: snapshot.focusedPath,
      documents,
    }
    try {
      sessionStorage.setItem(
        workspaceStorageKey(WORKSPACE_SESSION_KEY, targetWorkspace),
        JSON.stringify(session)
      )
      localStorage.setItem(
        workspaceStorageKey(WORKSPACE_TAB_ORDER_KEY, targetWorkspace),
        JSON.stringify(durableWorkspaceEditorSession(session))
      )
    } catch {
      // The editor remains usable if Chromium declines session storage.
    }
  }

  useEffect(() => {
    openFilesRef.current = openFiles
    if (
      selectedPath &&
      !openFiles.some((document) => document.file.path === selectedPath)
    ) {
      const fallback = openFiles[openFiles.length - 1]
      if (fallback) {
        selectFile(fallback.file.path)
      } else {
        setSelectedPath(null)
        localStorage.removeItem(
          workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, workspace)
        )
      }
    }
    if (
      secondaryPath &&
      !openFiles.some((document) => document.file.path === secondaryPath)
    ) {
      setSecondaryPath(null)
    }
    if (
      focusedPath &&
      !openFiles.some((document) => document.file.path === focusedPath)
    ) {
      setFocusedPath(selectedPath)
    }
  }, [
    agentOpen,
    bottomPanel,
    explorerOpen,
    layout,
    openFiles,
    focusedPath,
    secondaryPath,
    selectedPath,
    workspace,
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (quickOpenOpen || commandPaletteOpen || cloneDialogOpen) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        !target.closest('.monaco-editor') &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (event.ctrlKey && !event.metaKey && key === 'tab') {
        if (openFiles.length > 1) {
          event.preventDefault()
          cycleMruTab(event.shiftKey ? -1 : 1)
        }
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.altKey && event.code === 'KeyS') {
        event.preventDefault()
        void saveAllFiles()
        return
      }
      if (/^[1-9]$/.test(key)) {
        const document = openFiles[Number(key) - 1]
        if (document) {
          event.preventDefault()
          selectFile(document.file.path)
        }
      } else if (event.shiftKey && key === 'm') {
        event.preventDefault()
        toggleEditorFocus()
      } else if (event.shiftKey && key === 't') {
        event.preventDefault()
        void reopenLastClosedFile()
      } else if (key === 'w' && focusedPath) {
        event.preventDefault()
        void closeFile(focusedPath)
      } else if (key === 's' && focusedPath) {
        event.preventDefault()
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_SAVE_EVENT, {
            detail: { path: focusedPath },
          })
        )
      } else if (key === 'b') {
        event.preventDefault()
        setExplorerOpen((current) => !current)
      } else if (event.shiftKey && key === 'a') {
        event.preventDefault()
        setAgentOpen((current) => !current)
      } else if (event.shiftKey && key === 'p') {
        event.preventDefault()
        setCommandPaletteOpen(true)
      } else if (key === 'p') {
        event.preventDefault()
        setQuickOpenOpen(true)
      } else if (key === '\\') {
        event.preventDefault()
        if (secondaryPath) {
          setSecondaryPath(null)
          setFocusedPath(selectedPath)
        } else {
          splitEditor()
        }
      } else if (key === 'k') {
        const target = event.target
        if (
          target instanceof HTMLElement &&
          target.closest('.monaco-editor')
        ) {
          return
        }
        event.preventDefault()
        setCommandPaletteOpen(true)
      } else if (key === 'j') {
        event.preventDefault()
        setChangesOpen(false)
        setTerminalOpen((current) => !current)
      } else if (event.shiftKey && key === 'g') {
        event.preventDefault()
        setTerminalOpen(false)
        setChangesOpen((current) => !current)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Control' || !mruCycleRef.current) return
      const cycle = mruCycleRef.current
      mruCycleRef.current = null
      const settledPath = cycle.list[cycle.index]
      if (settledPath) touchMru(settledPath)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    cloneDialogOpen,
    commandPaletteOpen,
    focusedPath,
    openFiles,
    quickOpenOpen,
    secondaryPath,
    selectedPath,
  ])

  useEffect(() => {
    if (!openFiles.some((document) => document.dirty)) return
    const confirmClose = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', confirmClose)
    return () => window.removeEventListener('beforeunload', confirmClose)
  }, [openFiles])

  useEffect(() => {
    const refresh = () => setAttachments(getWorkspaceAttachments())
    window.addEventListener(WORKSPACE_CONTEXT_EVENT, refresh)
    return () => window.removeEventListener(WORKSPACE_CONTEXT_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (!bridge) return
    const refreshAfterMutation = (event: Event) => {
      const mutation = (event as CustomEvent<WorkspaceMutation>).detail
      if (!mutation) return
      mutationRefreshQueue.current = mutationRefreshQueue.current
        .then(async () => {
          const renamedPaths = new Map<string, string>()
          mutation.previousPaths?.forEach((previousPath, index) => {
            const nextPath = mutation.paths[index]
            if (nextPath) renamedPaths.set(previousPath, nextPath)
          })
          const affected = new Set([
            ...mutation.paths,
            ...(mutation.previousPaths ?? []),
          ])
          const shouldRefresh = (path: string) =>
            mutation.refreshAll ||
            affected.has(path) ||
            renamedPaths.has(path)

          const snapshot = openFilesRef.current
          const refreshedByPath = new Map<
            string,
            { targetPath: string; file: DesktopWorkspaceFile | null }
          >()
          for (const document of snapshot) {
            const currentPath = document.file.path
            if (!shouldRefresh(currentPath)) continue
            const targetPath = renamedPaths.get(currentPath) ?? currentPath
            const file = await bridge.workspace.readFile(targetPath, false)
            refreshedByPath.set(currentPath, { targetPath, file })
          }

          const nextWorkspace = await bridge.workspace.getState()
          commitWorkspaceState(nextWorkspace)
          setTreeVersion((current) => current + 1)

          const dirtyAffected = openFilesRef.current.find((document) =>
            shouldRefresh(document.file.path)
          )
          if (dirtyAffected?.dirty) {
            setWorkspaceError(
              `${dirtyAffected.file.name} changed on disk while you have unsaved edits. Your draft was preserved.`
            )
          }

          setOpenFiles((current) => {
            const next = current.flatMap((document) => {
              const refreshed = refreshedByPath.get(document.file.path)
              if (!refreshed) return [document]
              if (document.dirty) {
                return [
                  refreshed.file && refreshed.targetPath !== document.file.path
                    ? { ...document, file: refreshed.file }
                    : document,
                ]
              }
              if (!refreshed.file) return []
              return [
                {
                  file: refreshed.file,
                  draft: refreshed.file.content ?? '',
                  dirty: false,
                  line: document.line,
                },
              ]
            })
            openFilesRef.current = next
            return next
          })
          setSelectedPath((current) =>
            current ? renamedPaths.get(current) ?? current : current
          )
          setSecondaryPath((current) =>
            current ? renamedPaths.get(current) ?? current : current
          )
          setFocusedPath((current) =>
            current ? renamedPaths.get(current) ?? current : current
          )
        })
        .catch((error) => {
          setWorkspaceError(
            error instanceof Error
              ? error.message
              : 'Could not refresh workspace changes.'
          )
        })
    }
    window.addEventListener(WORKSPACE_MUTATION_EVENT, refreshAfterMutation)
    return () =>
      window.removeEventListener(WORKSPACE_MUTATION_EVENT, refreshAfterMutation)
  }, [bridge])

  async function restoreEditorSession(
    targetWorkspace: DesktopWorkspaceState,
    isCurrent: () => boolean = () => true
  ): Promise<boolean> {
    if (!bridge) return false
    try {
      const scopedSessionKey = workspaceStorageKey(
        WORKSPACE_SESSION_KEY,
        targetWorkspace
      )
      const scopedTabKey = workspaceStorageKey(
        WORKSPACE_TAB_ORDER_KEY,
        targetWorkspace
      )
      let transientRaw = sessionStorage.getItem(scopedSessionKey)
      let durableRaw = localStorage.getItem(scopedTabKey)
      if (
        transientRaw == null &&
        durableRaw == null &&
        localStorage.getItem(WORKSPACE_SESSION_MIGRATION_KEY) == null
      ) {
        transientRaw = sessionStorage.getItem(WORKSPACE_SESSION_KEY)
        durableRaw = localStorage.getItem(WORKSPACE_TAB_ORDER_KEY)
        if (transientRaw != null) {
          sessionStorage.setItem(scopedSessionKey, transientRaw)
        }
        if (durableRaw != null) {
          localStorage.setItem(scopedTabKey, durableRaw)
        }
        localStorage.setItem(WORKSPACE_SESSION_MIGRATION_KEY, scopedTabKey)
      }
      const resolved = resolveWorkspaceEditorSession(transientRaw, durableRaw)
      if (!resolved) return false
      const parsed = resolved.session
      if (parsed.documents.length === 0) {
        if (!isCurrent()) return false
        setOpenFiles([])
        openFilesRef.current = []
        setSelectedPath(null)
        setSecondaryPath(null)
        setFocusedPath(null)
        localStorage.removeItem(
          workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, targetWorkspace)
        )
        return true
      }
      const restored: OpenWorkspaceDocument[] = []
      for (const candidate of parsed.documents.slice(-12)) {
        if (
          candidate == null ||
          typeof candidate !== 'object' ||
          typeof (candidate as { path?: unknown }).path !== 'string'
        ) {
          continue
        }
        const stored = candidate as {
          path: string
          draft?: unknown
          line?: unknown
          name?: unknown
          relativePath?: unknown
          language?: unknown
          extension?: unknown
        }
        let file = await bridge.workspace.readFile(
          stored.path,
          false,
          targetWorkspace.workspaceId
            ? { workspaceId: targetWorkspace.workspaceId }
            : undefined
        )
        if (!isCurrent()) return false
        if (
          !file &&
          typeof stored.draft === 'string' &&
          typeof stored.name === 'string' &&
          typeof stored.relativePath === 'string'
        ) {
          file = {
            name: stored.name,
            path: stored.path,
            relativePath: stored.relativePath,
            kind: 'file',
            extension:
              typeof stored.extension === 'string' ? stored.extension : '',
            size: new TextEncoder().encode(stored.draft).length,
            modifiedAt: '',
            content: '',
            binary: false,
            tooLarge: false,
            language:
              typeof stored.language === 'string' ? stored.language : 'text',
          }
        }
        if (!file) continue
        const draft =
          file.content != null && typeof stored.draft === 'string'
            ? stored.draft
            : file.content ?? ''
        restored.push({
          file,
          draft,
          dirty: file.content != null && draft !== file.content,
          line:
            typeof stored.line === 'number' && Number.isInteger(stored.line)
              ? Math.max(1, stored.line)
              : null,
        })
      }
      if (restored.length === 0) return false
      if (!isCurrent()) return false
      const requestedPath =
        typeof parsed.selectedPath === 'string' ? parsed.selectedPath : null
      const active =
        restored.find((document) => document.file.path === requestedPath) ??
        restored[restored.length - 1]
      const restoredPendingLines: Record<string, number> = {}
      for (const document of restored) {
        if (document.line != null) {
          restoredPendingLines[document.file.path] = document.line
        }
      }
      setPendingLines(restoredPendingLines)
      setOpenFiles(restored)
      openFilesRef.current = restored
      setSelectedPath(active.file.path)
      const requestedSecondaryPath =
        typeof parsed.secondaryPath === 'string' &&
        parsed.secondaryPath !== active.file.path &&
        restored.some(
          (document) => document.file.path === parsed.secondaryPath
        )
          ? parsed.secondaryPath
          : null
      setSecondaryPath(requestedSecondaryPath)
      setFocusedPath(
        typeof parsed.focusedPath === 'string' &&
          restored.some(
            (document) => document.file.path === parsed.focusedPath
          )
          ? parsed.focusedPath
          : active.file.path
      )
      localStorage.setItem(
        workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, targetWorkspace),
        active.file.path
      )
      return true
    } catch {
      return false
    }
  }

  function requestLineJump(path: string, line: number) {
    setPendingLines((current) => ({ ...current, [path]: Math.max(1, line) }))
  }

  function clearPendingLine(path: string) {
    setPendingLines((current) => {
      if (current[path] == null) return current
      const next = { ...current }
      delete next[path]
      return next
    })
  }

  function touchMru(path: string) {
    mruRef.current = [
      path,
      ...mruRef.current.filter((candidate) => candidate !== path),
    ].slice(0, 32)
  }

  function cycleMruTab(direction: 1 | -1) {
    const openPaths = openFilesRef.current.map((document) => document.file.path)
    if (openPaths.length < 2) return
    let cycle = mruCycleRef.current
    if (!cycle) {
      const remembered = mruRef.current.filter((path) =>
        openPaths.includes(path)
      )
      const ordered = [
        ...remembered,
        ...openPaths.filter((path) => !remembered.includes(path)),
      ]
      const activePath = focusedPath ?? selectedPath
      const list =
        activePath && ordered.includes(activePath)
          ? [activePath, ...ordered.filter((path) => path !== activePath)]
          : ordered
      cycle = { list, index: 0 }
      mruCycleRef.current = cycle
    }
    cycle.index = (cycle.index + direction + cycle.list.length) % cycle.list.length
    const nextPath = cycle.list[cycle.index]
    if (nextPath) selectFile(nextPath, { updateMru: false })
  }

  function activateFile(
    file: DesktopWorkspaceFile,
    line: number | null = null,
    targetWorkspace: DesktopWorkspaceState | null = workspace
  ) {
    touchMru(file.path)
    if (line != null) requestLineJump(file.path, line)
    setOpenFiles((current) => {
      const existing = current.find((document) => document.file.path === file.path)
      if (existing) {
        return current.map((document) =>
          document.file.path === file.path
            ? { ...document, line: line ?? document.line }
            : document
        )
      }
      return [
        ...current,
        {
          file,
          draft: file.content ?? '',
          dirty: false,
          line,
        },
      ]
    })
    setSelectedPath(file.path)
    setFocusedPath(file.path)
    localStorage.setItem(
      workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, targetWorkspace),
      file.path
    )
  }

  async function ensureInitialFile(
    next: DesktopWorkspaceState,
    force = false,
    isCurrent: () => boolean = () => true
  ) {
    if (!bridge || (!force && selectedPath)) return
    const requestKey = `${next.workspaceId ?? 'no-project'}:${crypto.randomUUID()}`
    initialFileOpening.current = requestKey
    const binding = next.workspaceId
      ? { workspaceId: next.workspaceId }
      : undefined
    try {
      const activeFileKey = workspaceStorageKey(
        ACTIVE_WORKSPACE_FILE_KEY,
        next
      )
      const rememberedPath = localStorage.getItem(activeFileKey)
      if (rememberedPath) {
        const remembered = await bridge.workspace.readFile(
          rememberedPath,
          false,
          binding
        )
        if (!isCurrent()) return
        if (remembered && initialFileOpening.current === requestKey) {
          activateFile(remembered, null, next)
          return
        }
        if (initialFileOpening.current === requestKey) {
          localStorage.removeItem(activeFileKey)
        }
      }
      const candidates = await findInitialWorkspaceFiles(bridge, next)
      if (!isCurrent()) return
      for (const candidate of candidates.slice(0, 24)) {
        const file = await bridge.workspace.readFile(
          candidate.path,
          false,
          binding
        )
        if (!isCurrent()) return
        if (file && initialFileOpening.current === requestKey) {
          activateFile(file, null, next)
          return
        }
      }
    } finally {
      if (initialFileOpening.current === requestKey) {
        initialFileOpening.current = null
      }
    }
  }

  function commitWorkspaceState(next: DesktopWorkspaceState | null) {
    workspaceRef.current = next
    setWorkspace(next)
  }

  async function runLocalWorkspaceChange<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    localWorkspaceChangeDepth.current += 1
    try {
      return await operation()
    } finally {
      window.setTimeout(() => {
        localWorkspaceChangeDepth.current = Math.max(
          0,
          localWorkspaceChangeDepth.current - 1
        )
      }, 0)
    }
  }

  async function reconcileExternalWorkspace(next: DesktopWorkspaceState) {
    await activateWorkspace(next)
  }

  workspaceReconcilerRef.current = reconcileExternalWorkspace

  async function refreshRecentProjects() {
    if (!bridge) return
    setRecentProjects(await bridge.workspace.recentProjects())
  }

  async function activateWorkspace(
    next: DesktopWorkspaceState,
    options: { restore?: boolean; openInitial?: boolean } = {}
  ) {
    const generation = workspaceActivationGeneration.current + 1
    workspaceActivationGeneration.current = generation
    const isCurrent = () =>
      workspaceActivationGeneration.current === generation
    persistEditorSession(workspace)
    setSessionReady(false)
    setWorkspaceError(null)
    commitWorkspaceState(next)
    setNewFileRoot(next.roots[0]?.path ?? '')
    setOpenFiles([])
    openFilesRef.current = []
    setSelectedPath(null)
    setSecondaryPath(null)
    setFocusedPath(null)
    setResults([])
    setQuery('')
    setTreeVersion((current) => current + 1)
    try {
      const restored =
        options.restore === false
          ? false
          : await restoreEditorSession(next, isCurrent)
      if (!isCurrent()) return
      if (!restored && options.openInitial !== false) {
        await ensureInitialFile(next, true, isCurrent)
      }
      if (!isCurrent()) return
      await refreshRecentProjects()
    } catch (activationError) {
      if (!isCurrent()) return
      setWorkspaceError(
        activationError instanceof Error
          ? activationError.message
          : 'The project opened, but its editor state could not be restored.'
      )
    } finally {
      if (isCurrent()) setSessionReady(true)
    }
  }

  async function chooseFolder() {
    if (!bridge) return
    revealExplorer()
    const next = await runLocalWorkspaceChange(() =>
      bridge.workspace.chooseFolder()
    )
    if (next) {
      commitWorkspaceState(next)
      setNewFileRoot((current) =>
        next.roots.some((root) => root.path === current)
          ? current
          : next.roots[0]?.path ?? ''
      )
      setResults([])
      setQuery('')
      await ensureInitialFile(next)
      await refreshRecentProjects()
    }
  }

  async function openProject() {
    if (!bridge) return
    revealExplorer()
    const next = await runLocalWorkspaceChange(() =>
      bridge.workspace.openProject()
    )
    if (!next) return
    await activateWorkspace(next)
  }

  async function editStatsKey() {
    if (!bridge) return
    setWorkspaceError(null)
    const result = await runLocalWorkspaceChange(() =>
      bridge.workspace.openStatsKeySource()
    )
    if (!result.ok || !result.workspace) {
      if (!result.cancelled) {
        setWorkspaceError(
          result.error || 'The StatsKey Desktop source checkout could not be opened.'
        )
      }
      return
    }
    const alreadyOpen =
      workspace?.statsKeySource?.rootPath === result.source?.rootPath
    if (!alreadyOpen) {
      await activateWorkspace(result.workspace)
    }
    patchLayout({
      explorerOpen: true,
      editorOpen: true,
      agentOpen: true,
      simpleMode: false,
      bottomPanel: 'changes',
    })
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(AGENT_PREFILL_EVENT, {
          detail: { text: 'Change StatsKey Desktop: ' },
        })
      )
    }, 0)
  }

  async function createProject() {
    if (!bridge) return
    revealExplorer()
    setWorkspaceError(null)
    const result = await runLocalWorkspaceChange(() =>
      bridge.workspace.createProject()
    )
    if (!result.ok || !result.workspace) {
      if (!result.cancelled) {
        setWorkspaceError(
          result.error || 'The project folder could not be created.'
        )
      }
      return
    }
    await activateWorkspace(result.workspace, { restore: false })
    setCreatingFile(true)
  }

  function cloneProject() {
    setCloneDialogOpen(true)
    setCloneUrl('')
  }

  async function submitCloneProject(event: FormEvent) {
    event.preventDefault()
    if (!bridge || cloning || !cloneUrl.trim()) return
    setCloning(true)
    setWorkspaceError(null)
    const result = await runLocalWorkspaceChange(() =>
      bridge.workspace.cloneProject(cloneUrl.trim())
    )
    setCloning(false)
    if (!result.ok || !result.workspace) {
      if (!result.cancelled) {
        setWorkspaceError(result.error || 'The project could not be cloned.')
      }
      return
    }
    setCloneDialogOpen(false)
    setCloneUrl('')
    await activateWorkspace(result.workspace)
  }

  async function openRecentProject(project: DesktopRecentProject) {
    if (!bridge) return
    setWorkspaceError(null)
    const result = await runLocalWorkspaceChange(() =>
      bridge.workspace.openRecentProject(project.id)
    )
    if (!result.ok || !result.workspace) {
      setWorkspaceError(
        result.error || 'That recent project is no longer available.'
      )
      await refreshRecentProjects()
      return
    }
    await activateWorkspace(result.workspace)
  }

  async function saveCurrentWorkspace() {
    if (!bridge || !workspace?.roots.length) return
    const fallback =
      workspace.importedWorkspace?.name.replace(/\.code-workspace$/i, '') ||
      (workspace.roots.length === 1
        ? workspace.roots[0].name
        : `${workspace.roots[0].name} +${workspace.roots.length - 1}`)
    const name = await promptDialog({
      title: 'Save workspace',
      body: 'Save these folders together as a workspace.',
      label: 'Workspace name',
      initialValue: fallback,
      confirmLabel: 'Save',
    })
    if (!name) return
    const result = await bridge.workspace.saveWorkspace(name)
    if (!result.ok) {
      setWorkspaceError(result.error || 'The workspace could not be saved.')
      return
    }
    await refreshRecentProjects()
  }

  async function renameRecentProject(project: DesktopRecentProject) {
    if (!bridge) return
    const name = await promptDialog({
      title: 'Rename workspace',
      label: 'Workspace name',
      initialValue: project.name,
      confirmLabel: 'Rename',
    })
    if (!name || name === project.name) return
    const result = await bridge.workspace.renameRecentProject(
      project.id,
      name
    )
    if (!result.ok) {
      setWorkspaceError(result.error || 'The workspace could not be renamed.')
      return
    }
    await refreshRecentProjects()
  }

  async function forgetRecentProject(project: DesktopRecentProject) {
    if (!bridge) return
    const confirmed = await confirmDialog({
      title: `Remove “${project.name}” from saved workspaces?`,
      body: 'No files will be deleted.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    await bridge.workspace.removeRecentProject(project.id)
    await refreshRecentProjects()
  }

  async function removeRoot(rootPath: string) {
    if (!bridge) return
    setWorkspaceError(null)
    const result = await runLocalWorkspaceChange(() =>
      bridge.workspace.removeRoot(rootPath)
    )
    if (!result.ok || !result.workspace) {
      setWorkspaceError(result.error || 'The folder could not be removed.')
      return
    }
    await activateWorkspace(result.workspace)
  }

  async function closeWorkspace() {
    if (!bridge || !workspace?.roots.length) return
    const next = await runLocalWorkspaceChange(() =>
      bridge.workspace.closeWorkspace()
    )
    if (!next) return
    await activateWorkspace(next, { restore: false, openInitial: false })
  }

  async function addFiles() {
    if (!bridge) return
    revealExplorer()
    setWorkspaceError(null)
    const next = await runLocalWorkspaceChange(() =>
      bridge.workspace.addFiles()
    )
    if (next) {
      commitWorkspaceState(next)
      setTreeVersion((current) => current + 1)
      await Promise.all([
        ensureInitialFile(next),
        refreshRecentProjects(),
        bridge.workspace.refreshIndex().catch(() => false),
      ])
    }
  }

  async function importWorkspaceFile() {
    if (!bridge) return
    revealExplorer()
    setWorkspaceError(null)
    try {
      const result = await runLocalWorkspaceChange(() =>
        bridge.workspace.importWorkspaceFile()
      )
      if (result.cancelled) return
      const importError = workspaceImportResultError(result)
      if (importError || !result.workspace) {
        setWorkspaceError(
          importError || 'The workspace file could not be imported.'
        )
        return
      }
      const next = result.workspace
      await activateWorkspace(next)
    } catch (importError) {
      setWorkspaceError(
        importError instanceof Error
          ? importError.message
          : 'The workspace file could not be imported.'
      )
    }
  }

  async function createWorkspaceFromFolders() {
    if (!bridge) return
    revealExplorer()
    setWorkspaceError(null)
    try {
      const next = await runLocalWorkspaceChange(() =>
        bridge.workspace.createFromFolders()
      )
      if (next) await activateWorkspace(next)
    } catch (importError) {
      setWorkspaceError(
        importError instanceof Error ? importError.message : String(importError)
      )
    }
  }

  async function createFile(event: FormEvent) {
    event.preventDefault()
    if (!bridge || !newFileRoot || !newFilePath.trim()) return
    setWorkspaceError(null)
    const result = await bridge.workspace.createFile(
      newFileRoot,
      newFilePath.trim(),
      '',
      'auto'
    )
    if (!result.ok || !result.file) {
      setWorkspaceError(result.error || 'Could not create that file.')
      return
    }
    patchLayout({ editorOpen: true })
    const file = await bridge.workspace.readFile(result.file.path, false)
    if (file) {
      activateFile(file)
    } else {
      setWorkspaceError(`Created ${result.file.name}, but could not open it.`)
    }
    setNewFilePath('')
    setCreatingFile(false)
    setTreeVersion((current) => current + 1)
  }

  async function showCheckpoints() {
    if (!bridge) return
    setCheckpoints(await bridge.workspace.checkpoints())
    setCheckpointsOpen(true)
  }

  async function openFile(node: DesktopWorkspaceNode, line?: number | null) {
    if (!bridge || node.kind !== 'file') return
    if (!editorOpen) patchLayout({ editorOpen: true })
    setWorkspaceError(null)
    const existing = openFiles.find((document) => document.file.path === node.path)
    if (existing) {
      setOpenFiles((current) =>
        current.map((document) =>
          document.file.path === node.path
            ? { ...document, line: line ?? document.line }
            : document
        )
      )
      if (line != null) requestLineJump(node.path, line)
      touchMru(node.path)
      if (node.path !== secondaryPath) setSelectedPath(node.path)
      setFocusedPath(node.path)
      localStorage.setItem(
        workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, workspace),
        node.path
      )
      return
    }
    setLoadingFile(true)
    try {
      const file = await bridge.workspace.readFile(node.path, false)
      if (!file) {
        setWorkspaceError(`Could not open ${node.name}. It may have moved or become unavailable.`)
        return
      }
      activateFile(file, line ?? null)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : `Could not open ${node.name}.`
      )
    } finally {
      setLoadingFile(false)
    }
  }

  function beginFileInDirectory(directory: DesktopWorkspaceNode) {
    const root = workspace?.roots.find(
      (candidate) =>
        directory.path === candidate.path ||
        directory.path.startsWith(`${candidate.path}/`) ||
        directory.path.startsWith(`${candidate.path}\\`)
    )
    if (!root) return
    const relativeDirectory = directory.path
      .slice(root.path.length)
      .replace(/^[/\\]+/, '')
      .replaceAll('\\', '/')
    setNewFileRoot(root.path)
    setNewFilePath(relativeDirectory ? `${relativeDirectory}/` : '')
    setCreatingFile(true)
    revealExplorer()
  }

  function renameNavigatorFile(node: DesktopWorkspaceNode) {
    if (node.kind !== 'file') return
    setRenamingFile(node)
    setRenameValue(node.name)
  }

  async function submitNavigatorRename(event: FormEvent) {
    event.preventDefault()
    if (!bridge || !renamingFile) return
    const nextName = renameValue.trim()
    if (!nextName || nextName === renamingFile.name) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }
    setWorkspaceError(null)
    const result = await bridge.workspace.renameFile(
      renamingFile.path,
      nextName,
      'everything'
    )
    if (!result.ok) {
      if (!result.cancelled) {
        setWorkspaceError(result.error || 'Could not rename that file.')
      }
      return
    }
    const previousPath = renamingFile.path
    setRenamingFile(null)
    setRenameValue('')
    announceWorkspaceMutation({
      kind: 'rename',
      paths: result.file ? [result.file.path] : [],
      previousPaths: [previousPath],
      refreshAll: result.file == null,
    })
  }

  async function deleteNavigatorFile(node: DesktopWorkspaceNode) {
    if (!bridge || node.kind !== 'file') return
    const confirmed = await confirmDialog({
      title: `Delete "${node.name}" from disk?`,
      body: 'StatsKey will create a local safety checkpoint first.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    setWorkspaceError(null)
    const result = await bridge.workspace.deleteFile(node.path, 'everything')
    if (!result.ok) {
      if (!result.cancelled) {
        setWorkspaceError(result.error || 'Could not delete that file.')
      }
      return
    }
    announceWorkspaceMutation({
      kind: 'delete',
      paths: [node.path],
    })
  }

  function runSearch(event: FormEvent) {
    event.preventDefault()
    if (!bridge || !query.trim()) {
      searchRequestRef.current += 1
      setSearching(false)
      setResults([])
      return
    }
    if (searchTimerRef.current != null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
    const requestId = ++searchRequestRef.current
    setSearching(true)
    void performWorkspaceSearch(
      query.trim(),
      searchMode,
      indexState?.status,
      requestId
    )
  }

  async function performWorkspaceSearch(
    searchQuery: string,
    mode: DesktopWorkspaceSearchMode,
    indexStatus: DesktopWorkspaceIndexState['status'] | null | undefined,
    requestId: number
  ) {
    if (!bridge || requestId !== searchRequestRef.current) return
    setWorkspaceError(null)

    let indexFailure: unknown = null
    let directFailure: unknown = null
    const indexedPromise: Promise<DesktopWorkspaceSearchResult[]> =
      bridge.workspace.indexSearch(searchQuery, mode).catch((error: unknown) => {
        indexFailure = error
        return []
      })
    let directPromise: Promise<DesktopWorkspaceSearchResult[]> | null =
      indexStatus !== 'ready'
        ? bridge.workspace.search(searchQuery).catch((error: unknown) => {
            directFailure = error
            return []
          })
        : null

    const indexed = await indexedPromise
    if (
      shouldUseDirectWorkspaceSearch(
        indexStatus,
        indexed.length
      ) &&
      !directPromise
    ) {
      directPromise = bridge.workspace.search(searchQuery).catch((error: unknown) => {
        directFailure = error
        return []
      })
    }
    const direct = directPromise ? await directPromise : []

    if (requestId !== searchRequestRef.current) return
    setResults(mergeWorkspaceSearchResults(indexed, direct, mode))
    if (indexFailure && directFailure) {
      setWorkspaceError(
        directFailure instanceof Error
          ? directFailure.message
          : indexFailure instanceof Error
            ? indexFailure.message
            : 'Workspace search failed.'
      )
    }
    setSearching(false)
  }

  function selectFile(
    path: string,
    options: { updateMru?: boolean } = {}
  ) {
    if (options.updateMru !== false) touchMru(path)
    if (path === secondaryPath) {
      setFocusedPath(path)
      return
    }
    setSelectedPath(path)
    setFocusedPath(path)
    localStorage.setItem(
      workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, workspace),
      path
    )
  }

  function openFileBeside(path: string) {
    let targetPath = path
    if (targetPath === selectedPath) {
      const alternative = openFiles.find(
        (document) => document.file.path !== selectedPath
      )
      if (!alternative) return
      targetPath = alternative.file.path
    }
    setSecondaryPath(targetPath)
    setFocusedPath(targetPath)
  }

  function splitEditor() {
    if (secondaryDocument) {
      setFocusedPath(secondaryDocument.file.path)
      return
    }
    const alternative =
      openFiles.find((document) => document.file.path !== selectedPath) ?? null
    if (alternative) {
      setSecondaryPath(alternative.file.path)
      setFocusedPath(alternative.file.path)
    }
  }

  function revealAgent() {
    setAgentOpen(true)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
    }, 0)
  }

  function toggleEditorFocus() {
    const focused =
      editorOpen && !explorerOpen && !agentOpen && bottomPanel == null
    if (focused) {
      patchLayout(
        focusLayoutBeforeToggle.current ?? {
          explorerOpen: true,
          agentOpen: true,
        }
      )
      focusLayoutBeforeToggle.current = null
      return
    }
    focusLayoutBeforeToggle.current = layout
    patchLayout({
      editorOpen: true,
      explorerOpen: false,
      agentOpen: false,
      bottomPanel: null,
    })
  }

  function beginAgentResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = agentWidth
    const onMove = (moveEvent: PointerEvent) => {
      const delta =
        agentSide === 'right'
          ? startX - moveEvent.clientX
          : moveEvent.clientX - startX
      setAgentWidth(clampAgentWidth(startWidth + delta))
    }
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('workspace-resizing')
    }
    document.body.classList.add('workspace-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  function beginExplorerResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = explorerWidth
    const onMove = (moveEvent: PointerEvent) => {
      patchLayout({
        explorerWidth: clampExplorerWidth(
          startWidth + moveEvent.clientX - startX
        ),
      })
    }
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('workspace-resizing')
    }
    document.body.classList.add('workspace-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  function beginBottomResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = bottomHeight
    const onMove = (moveEvent: PointerEvent) => {
      patchLayout({
        bottomHeight: clampBottomHeight(
          startHeight + startY - moveEvent.clientY
        ),
      })
    }
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('workspace-resizing-vertical')
    }
    document.body.classList.add('workspace-resizing-vertical')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  async function saveDocument(
    document: OpenWorkspaceDocument
  ): Promise<boolean> {
    if (!bridge || document.file.content == null) return false
    if (!document.dirty) return true
    try {
      const result = await bridge.workspace.writeFile(
        document.file.path,
        document.draft,
        'auto',
        document.file.modifiedAt
      )
      if (!result.ok) {
        throw new Error(result.error || `Could not save ${document.file.name}.`)
      }
      const savedFile = {
        ...document.file,
        content: document.draft,
        size: new TextEncoder().encode(document.draft).length,
        modifiedAt: result.file?.modifiedAt ?? document.file.modifiedAt,
      }
      replaceSavedFile(savedFile)
      announceWorkspaceMutation({ kind: 'write', paths: [savedFile.path] })
      return true
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : `Could not save ${document.file.name}.`,
        { kind: 'error' }
      )
      return false
    }
  }

  async function saveAllFiles(): Promise<boolean> {
    const dirtyDocuments = openFilesRef.current.filter(
      (document) => document.dirty && document.file.content != null
    )
    let allSaved = true
    for (const document of dirtyDocuments) {
      if (!(await saveDocument(document))) allSaved = false
    }
    return allSaved
  }

  async function resolveDirtyBeforeClose(
    closing: OpenWorkspaceDocument[]
  ): Promise<boolean> {
    const dirty = closing.filter((document) => document.dirty)
    if (dirty.length === 0) return true
    const action = await choiceDialog({
      title:
        dirty.length === 1
          ? `Save changes to ${dirty[0].file.name}?`
          : `Save changes to ${dirty.length} files?`,
      body: 'Your changes will be lost if you don’t save them.',
      actions: [
        {
          id: 'save',
          label: dirty.length === 1 ? 'Save' : 'Save All',
          kind: 'primary',
        },
        { id: 'discard', label: 'Don’t Save', kind: 'destructive' },
        { id: 'cancel', label: 'Cancel', kind: 'cancel' },
      ],
      defaultActionId: 'save',
    })
    if (action == null || action === 'cancel') return false
    if (action === 'save') {
      for (const document of dirty) {
        // Re-resolve from current state: the document may have been closed,
        // saved, or edited while the dialog was open. Save the live document,
        // never the captured snapshot.
        const live = openFilesRef.current.find(
          (candidate) => candidate.file.path === document.file.path
        )
        if (!live || !live.dirty) continue
        if (!(await saveDocument(live))) return false
      }
    }
    return true
  }

  function finishCloseFiles(paths: string[], preferredPath?: string | null) {
    const closingSet = new Set(paths)
    const current = openFilesRef.current
    const closedDocuments = current.filter((document) =>
      closingSet.has(document.file.path)
    )
    if (closedDocuments.length === 0) return
    for (const document of closedDocuments) {
      recentlyClosedRef.current.push({
        path: document.file.path,
        line: document.line,
      })
      clearPendingLine(document.file.path)
    }
    if (recentlyClosedRef.current.length > 24) {
      recentlyClosedRef.current.splice(
        0,
        recentlyClosedRef.current.length - 24
      )
    }
    const remaining = current.filter(
      (document) => !closingSet.has(document.file.path)
    )
    const firstClosedIndex = current.findIndex((document) =>
      closingSet.has(document.file.path)
    )
    const fallbackPath =
      remaining[Math.min(firstClosedIndex, remaining.length - 1)]?.file.path ??
      null
    const nextSelectedPath =
      selectedPath && !closingSet.has(selectedPath)
        ? selectedPath
        : preferredPath &&
            remaining.some((document) => document.file.path === preferredPath)
          ? preferredPath
          : fallbackPath
    const nextSecondaryPath =
      secondaryPath && !closingSet.has(secondaryPath) ? secondaryPath : null
    const nextFocusedPath =
      focusedPath && !closingSet.has(focusedPath)
        ? focusedPath
        : nextSelectedPath
    openFilesRef.current = remaining
    setOpenFiles(remaining)
    setSecondaryPath(nextSecondaryPath)
    setFocusedPath(nextFocusedPath)
    setSelectedPath(nextSelectedPath)
    if (nextSelectedPath) {
      localStorage.setItem(
        workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, workspace),
        nextSelectedPath
      )
    } else {
      localStorage.removeItem(
        workspaceStorageKey(ACTIVE_WORKSPACE_FILE_KEY, workspace)
      )
    }
    persistEditorSession(workspace, {
      openFiles: remaining,
      selectedPath: nextSelectedPath,
      secondaryPath: nextSecondaryPath,
      focusedPath: nextFocusedPath,
    })
  }

  async function closeFilesWithGuard(
    closing: OpenWorkspaceDocument[],
    preferredPath?: string | null
  ) {
    if (closing.length === 0) return
    const paths = closing.map((document) => document.file.path)
    // Ignore close requests for paths whose dirty-close dialog is already
    // open, so repeated Cmd+W cannot queue duplicate dialogs.
    if (paths.some((path) => closingPathsRef.current.has(path))) return
    for (const path of paths) closingPathsRef.current.add(path)
    try {
      if (!(await resolveDirtyBeforeClose(closing))) return
      finishCloseFiles(paths, preferredPath)
    } finally {
      for (const path of paths) closingPathsRef.current.delete(path)
    }
  }

  async function closeFile(path: string) {
    const closing = openFilesRef.current.find(
      (document) => document.file.path === path
    )
    if (!closing) return
    await closeFilesWithGuard([closing])
  }

  async function closeOtherFiles(path: string) {
    const others = openFilesRef.current.filter(
      (document) => document.file.path !== path
    )
    await closeFilesWithGuard(others, path)
  }

  async function closeFilesToRight(path: string) {
    const current = openFilesRef.current
    const anchorIndex = current.findIndex(
      (document) => document.file.path === path
    )
    if (anchorIndex < 0) return
    await closeFilesWithGuard(current.slice(anchorIndex + 1), path)
  }

  async function reopenLastClosedFile() {
    if (!bridge) return
    const stack = recentlyClosedRef.current
    while (stack.length > 0) {
      const entry = stack.pop()
      if (!entry) return
      if (
        openFilesRef.current.some(
          (document) => document.file.path === entry.path
        )
      ) {
        continue
      }
      const file = await bridge.workspace
        .readFile(entry.path, false)
        .catch(() => null)
      if (file) {
        patchLayout({ editorOpen: true })
        activateFile(file, entry.line)
        return
      }
    }
  }

  function reorderOpenFiles(sourcePath: string, targetPath: string) {
    setOpenFiles((current) => {
      const sourceIndex = current.findIndex(
        (document) => document.file.path === sourcePath
      )
      const targetIndex = current.findIndex(
        (document) => document.file.path === targetPath
      )
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, moved)
      openFilesRef.current = next
      return next
    })
  }

  async function closeAllFiles() {
    await closeFilesWithGuard(openFilesRef.current)
  }

  function updateDraft(path: string, draft: string) {
    setOpenFiles((current) =>
      current.map((document) =>
        document.file.path === path
          ? {
              ...document,
              draft,
              dirty: draft !== (document.file.content ?? ''),
            }
          : document
      )
    )
  }

  function updateDocumentLine(path: string, line: number) {
    setOpenFiles((current) => {
      const index = current.findIndex(
        (document) => document.file.path === path
      )
      if (index < 0 || current[index].line === line) return current
      const next = [...current]
      next[index] = { ...next[index], line }
      return next
    })
  }

  function replaceSavedFile(file: DesktopWorkspaceFile) {
    setOpenFiles((current) =>
      current.map((document) =>
        document.file.path === file.path
          ? {
              // Keep the live draft: edits typed while the save was in flight
              // must survive, leaving the document dirty against the new base.
              ...document,
              file,
              dirty: document.draft !== (file.content ?? ''),
            }
          : document
      )
    )
  }

  const attached = useMemo(
    () => new Set(attachments.map((item) => item.path)),
    [attachments]
  )
  const workspaceCommands: WorkbenchCommand[] = [
    {
      id: 'editor-panel',
      label: editorOpen ? 'Hide editor panel' : 'Show editor panel',
      description:
        'Toggle the main editor without closing files or discarding drafts.',
      run: () => patchLayout({ editorOpen: !editorOpen }),
    },
    {
      id: 'open-project',
      label: 'Open project',
      description: 'Replace this view with a project folder.',
      run: () => void openProject(),
    },
    {
      id: 'edit-statskey',
      label: 'Edit StatsKey Desktop',
      description:
        'Open the real StatsKey source checkout, Intelligence, and reviewable changes.',
      run: () => void editStatsKey(),
    },
    {
      id: 'new-project',
      label: 'Create project',
      description: 'Create and open a new local project folder.',
      run: () => void createProject(),
    },
    {
      id: 'clone-project',
      label: 'Clone repository',
      description: 'Clone an HTTPS or SSH Git repository into a new folder.',
      run: () => void cloneProject(),
    },
    {
      id: 'find-file',
      label: 'Go to file',
      description: 'Open a file by name. Add :42 to jump to a line.',
      shortcut: '⌘P',
      run: () => setQuickOpenOpen(true),
    },
    {
      id: 'search-workspace',
      label: 'Search in files',
      description: 'Search names and file contents in this workspace.',
      run: () => {
        revealExplorer(true)
      },
    },
    {
      id: 'save-all',
      label: 'Save all files',
      description: 'Write every open file with unsaved changes to disk.',
      shortcut: '⌥⌘S',
      run: () => void saveAllFiles(),
    },
    {
      id: 'add-files',
      label: 'Add files',
      description: 'Add individual files without changing project folders.',
      run: () => void addFiles(),
    },
    {
      id: 'new-file',
      label: 'New file',
      description: 'Create a file inside an open workspace folder.',
      run: () => {
        revealExplorer()
        setCreatingFile(true)
      },
    },
    {
      id: 'terminal',
      label: 'Toggle terminal',
      description: 'Run a reviewed command in a workspace folder.',
      shortcut: '⌘J',
      run: () => {
        setChangesOpen(false)
        setTerminalOpen((current) => !current)
      },
    },
    {
      id: 'changes',
      label: 'Show changes',
      description: 'Review Git status and staged or unstaged diffs.',
      run: () => {
        setTerminalOpen(false)
        setChangesOpen(true)
      },
    },
    {
      id: 'checkpoints',
      label: 'Open checkpoints',
      description: 'Review local safety history and restore a checkpoint.',
      run: () => void showCheckpoints(),
    },
    ...(selectedFile
      ? [
          {
            id: 'context',
            label: attached.has(selectedFile.path)
              ? 'Remove current file from context'
              : 'Add current file to context',
            description: selectedFile.relativePath,
            run: () =>
              toggleWorkspaceAttachment({
                path: selectedFile.path,
                name: selectedFile.name,
                relativePath: selectedFile.relativePath,
              }),
          },
          {
            id: 'reveal',
            label: 'Show current file in Finder',
            description: selectedFile.relativePath,
            run: () => void bridge?.workspace.reveal(selectedFile.path),
          },
        ]
      : []),
    {
      id: 'agent',
      label: agentOpen ? 'Hide Intelligence' : 'Open Intelligence',
      description: 'Work with Intelligence without leaving the editor.',
      shortcut: '⌘⇧A',
      run: () => {
        if (agentOpen) setAgentOpen(false)
        else revealAgent()
      },
    },
    {
      id: 'split-editor',
      label: secondaryDocument ? 'Close split editor' : 'Split editor',
      description: secondaryDocument
        ? 'Return to one editor pane.'
        : 'Work in two open files at the same time.',
      shortcut: '⌘\\',
      run: () => {
        if (secondaryDocument) {
          setSecondaryPath(null)
          setFocusedPath(selectedPath)
        } else {
          splitEditor()
        }
      },
    },
    {
      id: 'editor-focus',
      label:
        editorOpen && !explorerOpen && !agentOpen && bottomPanel == null
          ? 'Restore workspace layout'
          : 'Focus current file',
      description: 'Toggle a distraction-free editor without losing panel state.',
      shortcut: '⌘⇧M',
      run: toggleEditorFocus,
    },
    {
      id: 'full-window',
      label: canvasMode ? 'Restore desktop sidebar' : 'Use full window',
      description: 'Let the workspace consume the complete desktop window.',
      run: () => patchLayout({ canvasMode: !canvasMode }),
    },
    {
      id: 'explorer',
      label: explorerOpen ? 'Hide Explorer' : 'Show Explorer',
      description:
        'Toggle the file explorer while keeping tabs and Intelligence open.',
      shortcut: '⌘B',
      run: () => setExplorerOpen((current) => !current),
    },
    {
      id: 'github-workspace',
      label: 'Open GitHub workspace',
      description: 'Choose a connected repository, branch, and file.',
      run: () => navigate('/github'),
    },
    {
      id: 'workspace-settings',
      label: 'Open workspace settings',
      description: 'Manage models, keys, rules, skills, hooks, and connected tools.',
      run: () => navigate('/customize'),
    },
  ]

  function renderEditorPane(
    document: OpenWorkspaceDocument,
    pane: 'primary' | 'secondary'
  ) {
    const file = document.file
    return (
      <div
        className={`workspace-editor-pane${
          focusedPath === file.path ? ' workspace-editor-pane--focused' : ''
        }`}
        onPointerDown={() => setFocusedPath(file.path)}
      >
        <WorkspaceFileViewer
          file={file}
          draft={document.draft}
          dirty={document.dirty}
          line={document.line}
          pendingLine={pendingLines[file.path] ?? null}
          onPendingLineApplied={() => clearPendingLine(file.path)}
          onFocus={() => setFocusedPath(file.path)}
          onClosePane={
            pane === 'secondary'
              ? () => {
                  setSecondaryPath(null)
                  setFocusedPath(selectedPath)
                }
              : undefined
          }
          onDraftChange={(draft) => updateDraft(file.path, draft)}
          onLineChange={(line) => updateDocumentLine(file.path, line)}
          onRevert={() => updateDraft(file.path, file.content ?? '')}
          attached={attached.has(file.path)}
          onToggleAttachment={() => {
            toggleWorkspaceAttachment({
              path: file.path,
              name: file.name,
              relativePath: file.relativePath,
            })
          }}
          onAsk={() => {
            if (!attached.has(file.path)) {
              toggleWorkspaceAttachment({
                path: file.path,
                name: file.name,
                relativePath: file.relativePath,
              })
            }
            revealAgent()
          }}
          onSendSelectionToAgent={(prompt) => {
            if (!attached.has(file.path)) {
              toggleWorkspaceAttachment({
                path: file.path,
                name: file.name,
                relativePath: file.relativePath,
              })
            }
            revealAgent()
            window.setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent(AGENT_PREFILL_EVENT, {
                  detail: { text: prompt },
                })
              )
            }, 0)
          }}
          onReveal={() => void bridge?.workspace.reveal(file.path)}
          onSaved={replaceSavedFile}
        />
      </div>
    )
  }

  if (!bridge) {
    return <GitHubCloudWorkspace />
  }

  const workspaceDisplayName =
    workspace?.importedWorkspace?.name.replace(/\.code-workspace$/i, '') ||
    (workspace?.roots.length === 1
      ? workspace.roots[0].name
      : workspace?.roots.length
        ? `${workspace.roots[0].name} +${workspace.roots.length - 1}`
        : 'Workspace')

  return (
    <div
      className={[
        'workspace-view',
        explorerOpen
          ? 'workspace-view--explorer-open'
          : 'workspace-view--explorer-closed',
        editorOpen
          ? 'workspace-view--editor-open'
          : 'workspace-view--editor-closed',
        agentOpen ? 'workspace-view--agent-open' : 'workspace-view--agent-closed',
        `workspace-view--agent-${agentSide}`,
        layout.simpleMode ? 'workspace-view--simple' : '',
      ].join(' ')}
      style={
        {
          '--workspace-agent-width': `${agentWidth}px`,
          '--workspace-explorer-width': `${explorerWidth}px`,
          '--workspace-bottom-height': `${bottomHeight}px`,
        } as CSSProperties
      }
    >
      {explorerOpen && <aside className="workspace-explorer">
        <header>
          <div className="workspace-explorer__project">
            <span>Project</span>
            <b>
              {workspace?.roots?.length
                ? workspace.importedWorkspace?.name.replace(
                    /\.code-workspace$/i,
                    ''
                  ) ||
                  (workspace.roots.length === 1
                    ? workspace.roots[0].name
                    : `${workspace.roots[0].name} +${workspace.roots.length - 1}`)
                : 'No project open'}
            </b>
          </div>
          <div className="workspace-explorer__header-actions">
            <button onClick={chooseFolder} title="Add folders" aria-label="Add folders">+</button>
            <button
              className="workspace-explorer__close"
              onClick={() => setExplorerOpen(false)}
              title="Close Files panel"
              aria-label="Close Files panel"
            >
              ×
            </button>
          </div>
        </header>

        {workspace?.roots.length ? (
          <div className="workspace-explorer__primary-actions">
            <button
              className="primary"
              onClick={() => setCreatingFile((current) => !current)}
              title="Create a file"
            >
              New
            </button>
            <button onClick={addFiles} title="Add individual files">
              Add
            </button>
            <details className="workspace-project-menu">
              <summary aria-label="Project actions" title="Project actions">
                •••
              </summary>
              <div
                onClickCapture={(event) =>
                  event.currentTarget
                    .closest('details')
                    ?.removeAttribute('open')
                }
              >
                <button onClick={chooseFolder}>Add folder…</button>
                <button onClick={() => void saveCurrentWorkspace()}>
                  Save workspace…
                </button>
                <button onClick={openProject}>Switch project…</button>
                <button onClick={() => void editStatsKey()}>
                  Edit StatsKey Desktop…
                </button>
                <button onClick={createProject}>Create new project…</button>
                <button onClick={cloneProject}>Clone from GitHub…</button>
                <button onClick={addFiles}>Add individual files…</button>
                <button onClick={importWorkspaceFile}>Import workspace file…</button>
                <button onClick={showCheckpoints}>Safety checkpoints</button>
                <button className="danger" onClick={closeWorkspace}>
                  Close this project
                </button>
              </div>
            </details>
          </div>
        ) : (
          <div className="workspace-explorer__start-actions">
            <button className="primary" onClick={() => void editStatsKey()}>
              Edit StatsKey Desktop
            </button>
            <button onClick={() => void createWorkspaceFromFolders()}>
              Add workspace
            </button>
            <button onClick={openProject}>Open one project folder</button>
            <button onClick={addFiles}>Add individual files</button>
            <button onClick={createProject}>Create a project</button>
            <button onClick={cloneProject}>Clone from GitHub</button>
            <button onClick={importWorkspaceFile}>Import workspace file</button>
          </div>
        )}
        {recentProjects.length > 0 && (
          <details className="workspace-recent-projects">
            <summary>Recent projects</summary>
            <div>
              {recentProjects.map((project) => (
                <div className="workspace-recent-project" key={project.id}>
                  <button
                    onClick={() => void openRecentProject(project)}
                    disabled={project.availableRootCount === 0}
                  >
                    <span>{project.name}</span>
                    <small>
                      {project.availableRootCount === 0
                        ? 'Folder unavailable'
                        : `${project.rootCount} ${
                            project.rootCount === 1 ? 'folder' : 'folders'
                          }${project.saved ? ' · Saved' : ''}`}
                    </small>
                  </button>
                  <details>
                    <summary aria-label={`Manage ${project.name}`}>•••</summary>
                    <div>
                      <button onClick={() => void renameRecentProject(project)}>
                        Rename and save
                      </button>
                      <button onClick={() => void forgetRecentProject(project)}>
                        Remove from list
                      </button>
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </details>
        )}
        {workspace?.importedWorkspace && (
          <div className="workspace-imported">
            <b>{workspace.importedWorkspace.name}</b>
            <span>
              {workspace.roots.length} folders ready
              {workspace.importedWorkspace.missingFolders > 0
                ? ` · ${workspace.importedWorkspace.missingFolders} missing`
                : ''}
            </span>
          </div>
        )}
        {workspaceError && (
          <div className="workspace-import-error">{workspaceError}</div>
        )}
        {creatingFile && (
          <form className="workspace-new-file" onSubmit={createFile}>
            {workspace && workspace.roots.length > 1 && (
              <select
                value={newFileRoot}
                onChange={(event) => setNewFileRoot(event.target.value)}
                aria-label="New file workspace folder"
              >
                {workspace.roots.map((root) => (
                  <option key={root.path} value={root.path}>
                    {root.name}
                  </option>
                ))}
              </select>
            )}
            <div>
              <input
                value={newFilePath}
                onChange={(event) => setNewFilePath(event.target.value)}
                placeholder="src/new-file.ts"
                aria-label="New file path"
                autoFocus
              />
              <button type="submit" disabled={!newFilePath.trim()}>Create</button>
              <button
                type="button"
                onClick={() => {
                  setCreatingFile(false)
                  setNewFilePath('')
                }}
                aria-label="Cancel new file"
              >
                ×
              </button>
            </div>
          </form>
        )}

        <form className="workspace-search" onSubmit={runSearch}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files and content"
            aria-label="Search workspace files"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setResults([])
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </form>
        <div className="workspace-search-modes">
          <details className="workspace-search-options">
            <summary>
              {(
                [
                  ['hybrid', 'All'],
                  ['files', 'File names'],
                  ['content', 'Inside files'],
                  ['symbols', 'Code symbols'],
                  ['fuzzy', 'Similar names'],
                ] as const
              ).find(([mode]) => mode === searchMode)?.[1] ?? 'All'}
            </summary>
            <div role="listbox" aria-label="Search in">
            {(
              [
                ['hybrid', 'All', 'Names, file contents, and code'],
                ['files', 'File names', 'Match file and folder names'],
                ['content', 'Inside files', 'Find exact text in files'],
                ['symbols', 'Code symbols', 'Find functions and types'],
                ['fuzzy', 'Similar names', 'Find approximate matches'],
              ] as const
            ).map(([mode, label, description]) => (
              <button
                key={mode}
                role="option"
                aria-selected={searchMode === mode}
                className={searchMode === mode ? 'active' : ''}
                onClick={(event) => {
                  setSearchMode(mode)
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }}
              >
                <b>{label}</b>
                <small>{description}</small>
              </button>
            ))}
            </div>
          </details>
          <button
            className={`workspace-index-state workspace-index-state--${
              indexState?.status ?? 'idle'
            }`}
            onClick={() => void bridge?.workspace.refreshIndex()}
            title="Refresh the encrypted local workspace index"
          >
            {indexState?.status === 'indexing'
              ? 'Preparing search…'
              : indexState?.status === 'ready'
                ? 'Search ready'
                : indexState?.status === 'error'
                  ? 'Search unavailable'
                  : 'Prepare search'}
          </button>
        </div>

        <div className="workspace-explorer__body">
          {searching ? (
            <p className="workspace-muted">Searching…</p>
          ) : results.length > 0 ? (
            <div className="workspace-results">
              <span>{results.length} results</span>
              {results.map((result, index) => (
                <button
                  key={`${result.path}-${result.line ?? 'name'}-${index}`}
                  onClick={() => openFile(result, result.line)}
                >
                  <b>{result.name}{result.line ? `:${result.line}` : ''}</b>
                  <i>{result.match}</i>
                  <small>{result.preview}</small>
                </button>
              ))}
            </div>
          ) : query.trim() ? (
            <div className="workspace-empty-tree">
              <p>No results in this workspace.</p>
              <button onClick={() => void bridge?.workspace.refreshIndex()}>
                Refresh index
              </button>
            </div>
          ) : (
            <>
              {workspace?.roots?.length ? (
                workspace.roots.map((root, index) => (
                  <WorkspaceDirectory
                    key={root.path}
                    node={root}
                    selectedPath={selectedFile?.path}
                    onOpenFile={openFile}
                    depth={0}
                    defaultOpen={index === 0}
                    refreshVersion={treeVersion}
                    onRemove={() => void removeRoot(root.path)}
                    onReveal={(node) => void bridge.workspace.reveal(node.path)}
                    onCreateFile={beginFileInDirectory}
                    onRenameFile={(node) => void renameNavigatorFile(node)}
                    onDeleteFile={(node) => void deleteNavigatorFile(node)}
                  />
                ))
              ) : (
                <div className="workspace-empty-tree">
                  <p>Add one or more folders to organize and search their files here.</p>
                  <button onClick={chooseFolder}>Choose folders</button>
                </div>
              )}

              {workspace && workspace.looseFiles.length > 0 && (
                <section className="workspace-loose-files">
                  <span>Added files</span>
                  {workspace.looseFiles.map((file) => (
                    <FileTreeButton
                      key={file.path}
                      node={file}
                      selected={selectedFile?.path === file.path}
                      onOpen={() => openFile(file)}
                      onReveal={() => void bridge.workspace.reveal(file.path)}
                      onRename={() => void renameNavigatorFile(file)}
                      onDelete={() => void deleteNavigatorFile(file)}
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
        <button
          className="workspace-explorer__resize"
          onPointerDown={beginExplorerResize}
          aria-label="Resize Explorer panel"
          title="Drag to resize Explorer"
        />
      </aside>}

      {editorOpen && <main className="workspace-editor">
        <header className="workspace-editor__toolbar">
          <div className="workspace-editor__context">
            {!explorerOpen && (
              <button
                className="workspace-editor__files"
                onClick={() => setExplorerOpen(true)}
                title="Open the Files panel"
              >
                Files
              </button>
            )}
            <span className="workspace-editor__identity">
              <b>{workspaceDisplayName}</b>
              <span>
                {workspace?.roots.length
                  ? `${workspace.roots.length} ${
                      workspace.roots.length === 1 ? 'folder' : 'folders'
                    }`
                  : 'No folder open'}
              </span>
            </span>
          </div>
          <div>
            {(secondaryDocument || openFiles.length >= 2) && (
              <button
                className={`workspace-editor__split${
                  secondaryDocument ? ' active' : ''
                }`}
                onClick={() => {
                  if (secondaryDocument) {
                    setSecondaryPath(null)
                    setFocusedPath(selectedPath)
                  } else {
                    splitEditor()
                  }
                }}
                title="Show two open files at once"
              >
                {secondaryDocument ? 'Unsplit' : 'Split'} <kbd>⌘\</kbd>
              </button>
            )}
            <WorkspaceLayoutControls
              layout={layout}
              onPatch={patchLayout}
              onPreset={applyPreset}
              onReset={resetLayout}
            />
            <button
              className="workspace-editor__close-panel"
              onClick={() => patchLayout({ editorOpen: false })}
              aria-label="Close editor panel"
              title="Close editor panel without closing files"
            >
              ×
            </button>
          </div>
        </header>

        {openFiles.length > 1 && (
          <WorkspaceTabs
            documents={openFiles}
            selectedPath={selectedPath}
            secondaryPath={secondaryPath}
            loading={loadingFile}
            onSelect={selectFile}
            onOpenBeside={openFileBeside}
            onClose={(path) => void closeFile(path)}
            onCloseOthers={(path) => void closeOtherFiles(path)}
            onCloseToRight={(path) => void closeFilesToRight(path)}
            onReorder={reorderOpenFiles}
            onCloseAll={() => void closeAllFiles()}
          />
        )}

        {primaryDocument ? (
          <div
            className={`workspace-editor-panes${
              secondaryDocument ? ' workspace-editor-panes--split' : ''
            }`}
          >
            {renderEditorPane(primaryDocument, 'primary')}
            {secondaryDocument &&
              renderEditorPane(secondaryDocument, 'secondary')}
          </div>
        ) : loadingFile ? (
          <div className="workspace-editor__empty">Opening file…</div>
        ) : (
          <div className="workspace-editor__empty workspace-editor__welcome">
            <span
              className={`workspace-editor__mark${
                workspace?.roots.length
                  ? ''
                  : ' workspace-editor__mark--folder'
              }`}
              aria-hidden="true"
            >
              {workspace?.roots.length ? '⌘P' : ''}
            </span>
            <h1>
              {workspace?.roots.length
                ? 'Start with the work in front of you.'
                : 'Open your work.'}
            </h1>
            <p>
              {workspace?.roots.length
                ? 'Open a file or ask Intelligence to find the right place. Files, changes, terminal, and split editing appear when you need them.'
                : 'Choose a project folder. Files, Intelligence, terminal, changes, and settings stay together.'}
            </p>
            <div>
              {workspace?.roots.length ? (
                <>
                  <button className="btn btn-primary" onClick={() => setQuickOpenOpen(true)}>
                    Find file
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      revealExplorer()
                      setCreatingFile(true)
                    }}
                  >
                    Create
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setChangesOpen(false)
                      setTerminalOpen(true)
                    }}
                  >
                    Terminal
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={openProject}>
                    Open a project
                  </button>
                  <button className="btn btn-secondary" onClick={createProject}>
                    Create a project
                  </button>
                </>
              )}
            </div>
            {!workspace?.roots.length && (
              <details className="workspace-editor__start-more">
                <summary>More ways to start</summary>
                <div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void createWorkspaceFromFolders()}
                  >
                    Add multiple folders
                  </button>
                  <button className="btn btn-secondary" onClick={cloneProject}>
                    Clone a repository
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={importWorkspaceFile}
                  >
                    Import workspace file
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void editStatsKey()}
                  >
                    Edit StatsKey Desktop
                  </button>
                </div>
              </details>
            )}
          </div>
        )}
        <WorkspaceBottomDock
          panel={bottomPanel}
          roots={workspace?.roots ?? []}
          hasUnsavedChanges={openFiles.some((document) => document.dirty)}
          onClose={() => patchLayout({ bottomPanel: null })}
          onResize={beginBottomResize}
        />
      </main>}
      {!explorerOpen && !editorOpen && (
        <button
          className="workspace-explorer-reopen"
          onClick={() => setExplorerOpen(true)}
          title="Reopen the Files panel"
        >
          <span>Files</span>
        </button>
      )}
      {!editorOpen && (
        <button
          className="workspace-editor-reopen"
          onClick={() => patchLayout({ editorOpen: true })}
          title="Reopen the editor with your tabs and drafts intact"
        >
          <span>Editor</span>
        </button>
      )}
      <WorkspaceAgentRail
        key={workspace?.workspaceId ?? 'no-project'}
        open={agentOpen}
        workspaceId={workspace?.workspaceId ?? undefined}
        workspaceLabel={
          workspace?.roots.length
            ? selectedFile?.relativePath ?? workspaceDisplayName
            : 'No project open'
        }
        side={agentSide}
        onClose={() => patchLayout({ agentOpen: false })}
        onChangeSide={(side) =>
          patchLayout({ agentSide: side, agentOpen: true })
        }
        onResize={beginAgentResize}
      />
      {checkpointsOpen && (
        <WorkspaceCheckpoints
          checkpoints={checkpoints}
          onClose={() => setCheckpointsOpen(false)}
          onRestore={async (checkpointId) => {
            if (!bridge) return
            const result = await bridge.workspace.restoreCheckpoint(checkpointId)
            if (!result.ok) {
              if (!result.cancelled) {
                showToast(
                  result.error || 'The checkpoint could not be restored.',
                  { kind: 'error' }
                )
              }
              return
            }
            setCheckpoints(await bridge.workspace.checkpoints())
            announceWorkspaceMutation({
              kind: 'restore',
              paths: [],
              refreshAll: true,
            })
          }}
        />
      )}
      {renamingFile && (
        <div
          className="workspace-rename-overlay"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setRenamingFile(null)
              setRenameValue('')
            }
          }}
        >
          <form
            className="workspace-rename-dialog"
            onSubmit={submitNavigatorRename}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-rename-title"
          >
            <header>
              <div>
                <span>File navigator</span>
                <h2 id="workspace-rename-title">Rename file</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRenamingFile(null)
                  setRenameValue('')
                }}
                aria-label="Cancel rename"
              >
                ×
              </button>
            </header>
            <label>
              <span>New name</span>
              <input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                autoFocus
                spellCheck={false}
              />
            </label>
            <footer>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setRenamingFile(null)
                  setRenameValue('')
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!renameValue.trim()}
              >
                Rename
              </button>
            </footer>
          </form>
        </div>
      )}
      {cloneDialogOpen && (
        <div
          className="workspace-rename-overlay"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !cloning) {
              setCloneDialogOpen(false)
              setCloneUrl('')
            }
          }}
        >
          <form
            className="workspace-rename-dialog"
            onSubmit={submitCloneProject}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-clone-title"
          >
            <header>
              <div>
                <span>Project workspace</span>
                <h2 id="workspace-clone-title">Clone repository</h2>
              </div>
              <button
                type="button"
                disabled={cloning}
                onClick={() => {
                  setCloneDialogOpen(false)
                  setCloneUrl('')
                }}
                aria-label="Cancel clone"
              >
                ×
              </button>
            </header>
            <label>
              <span>HTTPS or SSH repository URL</span>
              <input
                value={cloneUrl}
                onChange={(event) => setCloneUrl(event.target.value)}
                placeholder="https://github.com/organization/repository.git"
                autoFocus
                spellCheck={false}
              />
            </label>
            <footer>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={cloning}
                onClick={() => {
                  setCloneDialogOpen(false)
                  setCloneUrl('')
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={cloning || !cloneUrl.trim()}
              >
                {cloning ? 'Cloning…' : 'Choose location'}
              </button>
            </footer>
          </form>
        </div>
      )}
      <WorkspaceQuickOpen
        open={quickOpenOpen}
        onClose={() => setQuickOpenOpen(false)}
        onOpenFile={(file, line) => void openFile(file, line)}
      />
      <WorkbenchCommandPalette
        open={commandPaletteOpen}
        commands={workspaceCommands}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  )
}

async function findInitialWorkspaceFiles(
  bridge: NonNullable<ReturnType<typeof getDesktopBridge>>,
  workspace: DesktopWorkspaceState
): Promise<DesktopWorkspaceNode[]> {
  const candidates: Array<{ node: DesktopWorkspaceNode; score: number }> = []
  let remainingDirectories = 120

  for (const file of workspace.looseFiles) {
    const score = initialFileScore(file)
    if (score > 0) candidates.push({ node: file, score: score + 1_000 })
  }

  async function inspectDirectory(
    directory: DesktopWorkspaceNode,
    depth: number,
    rootIndex: number
  ) {
    if (depth > 3 || remainingDirectories <= 0) return
    remainingDirectories -= 1
    const children = await bridge.workspace.listDirectory(directory.path)
    for (const child of children) {
      if (child.kind !== 'file') continue
      const score = initialFileScore(child)
      if (score > 0) {
        candidates.push({
          node: child,
          score: score - rootIndex * 8 - depth * 12,
        })
      }
    }
    const directories = children.filter(
      (child) =>
        child.kind === 'directory' &&
        !child.name.startsWith('.') &&
        !AUTO_OPEN_SKIPPED_DIRECTORIES.has(child.name.toLowerCase())
    )
    for (const child of directories.slice(0, 18)) {
      await inspectDirectory(child, depth + 1, rootIndex)
    }
  }

  for (const [index, root] of workspace.roots.entries()) {
    await inspectDirectory(root, 0, index)
    if (candidates.some((candidate) => candidate.score >= 900 - index * 8)) break
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.node)
}

const AUTO_OPEN_SKIPPED_DIRECTORIES = new Set([
  'archive',
  'build',
  'coverage',
  'deriveddata',
  'dist',
  'generated',
  'logs',
  'screenshots',
  'tmp',
])

const AUTO_OPEN_SOURCE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'go',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'm',
  'md',
  'mjs',
  'mm',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'swift',
  'ts',
  'tsx',
  'vue',
])

function initialFileScore(node: DesktopWorkspaceNode): number {
  if (node.kind !== 'file' || (node.size ?? 0) > 2 * 1024 * 1024) return -1
  const name = node.name.toLowerCase()
  if (name.startsWith('.') || ['lock', 'log', 'map'].includes(node.extension)) return -1
  if (/^readme(?:\.[a-z0-9]+)?$/.test(name)) return 1_000
  if (name === 'agents.md') return 980
  if (name === 'package.json') return 950
  if (['pyproject.toml', 'cargo.toml', 'go.mod', 'project.yml'].includes(name)) return 930
  if (name.endsWith('.code-workspace')) return 900
  if (AUTO_OPEN_SOURCE_EXTENSIONS.has(node.extension)) return 700
  if (['json', 'jsonc', 'toml', 'yaml', 'yml'].includes(node.extension)) return 550
  if (['makefile', 'dockerfile', 'gemfile'].includes(name)) return 500
  return -1
}

function WorkspaceDirectory({
  node,
  selectedPath,
  onOpenFile,
  depth,
  defaultOpen,
  refreshVersion,
  onRemove,
  onReveal,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
}: {
  node: DesktopWorkspaceNode
  selectedPath?: string
  onOpenFile: (node: DesktopWorkspaceNode) => void
  depth: number
  defaultOpen: boolean
  refreshVersion: number
  onRemove?: () => void
  onReveal: (node: DesktopWorkspaceNode) => void
  onCreateFile: (node: DesktopWorkspaceNode) => void
  onRenameFile: (node: DesktopWorkspaceNode) => void
  onDeleteFile: (node: DesktopWorkspaceNode) => void
}) {
  const bridge = getDesktopBridge()
  const [open, setOpen] = useState(defaultOpen)
  const [children, setChildren] = useState<DesktopWorkspaceNode[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    if (selectedPath && selectedPath !== node.path && selectedPath.startsWith(node.path)) {
      setOpen(true)
    }
  }, [node.path, selectedPath])

  useEffect(() => {
    if (!bridge || !open) return
    let active = true
    // Keep any previously loaded children rendered while refreshing; the
    // "Loading…" placeholder only appears the first time a folder opens.
    setLoadError(null)
    void bridge.workspace
      .listDirectory(node.path)
      .then((nextChildren) => {
        if (active) setChildren(nextChildren)
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadError(
          error instanceof Error && error.message.trim()
            ? error.message
            : `Could not read ${node.name}.`
        )
      })
    return () => {
      active = false
    }
  }, [bridge, loadAttempt, node.name, node.path, open, refreshVersion])

  return (
    <div className="workspace-directory">
      <div className="workspace-directory__heading">
        <button
          className="workspace-directory__row"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <span className={open ? 'open' : ''}>›</span>
          <FolderIcon />
          <b>{node.name}</b>
        </button>
        <div className="workspace-directory__actions">
          <button
            onClick={() => onCreateFile(node)}
            aria-label={`Create file in ${node.name}`}
            title="Create file in this folder"
          >
            +
          </button>
          <button
            onClick={() => onReveal(node)}
            aria-label={`Reveal ${node.name} in Finder`}
            title="Reveal in Finder"
          >
            ↗
          </button>
          {onRemove && (
          <button
            className="workspace-directory__remove"
            onClick={onRemove}
            aria-label={`Remove ${node.name} from workspace`}
            title="Remove folder from this workspace"
          >
            ×
          </button>
          )}
        </div>
      </div>
      {open && (
        <div className="workspace-directory__children">
          {loadError ? (
            <div className="workspace-empty-tree" role="alert">
              <p>Could not load {node.name}: {loadError}</p>
              <button
                type="button"
                onClick={() => setLoadAttempt((current) => current + 1)}
              >
                Retry
              </button>
            </div>
          ) : children == null ? (
            <span className="workspace-muted">Loading…</span>
          ) : children.length === 0 ? (
            <span className="workspace-muted">Empty folder</span>
          ) : (
            children.map((child) =>
              child.kind === 'directory' ? (
                <WorkspaceDirectory
                  key={child.path}
                  node={child}
                  selectedPath={selectedPath}
                  onOpenFile={onOpenFile}
                  depth={depth + 1}
                  defaultOpen={false}
                  refreshVersion={refreshVersion}
                  onReveal={onReveal}
                  onCreateFile={onCreateFile}
                  onRenameFile={onRenameFile}
                  onDeleteFile={onDeleteFile}
                />
              ) : (
                <FileTreeButton
                  key={child.path}
                  node={child}
                  selected={selectedPath === child.path}
                  onOpen={() => onOpenFile(child)}
                  onReveal={() => onReveal(child)}
                  onRename={() => onRenameFile(child)}
                  onDelete={() => onDeleteFile(child)}
                />
              )
            )
          )}
        </div>
      )}
    </div>
  )
}

function FileTreeButton({
  node,
  selected,
  onOpen,
  onReveal,
  onRename,
  onDelete,
}: {
  node: DesktopWorkspaceNode
  selected: boolean
  onOpen: () => void
  onReveal: () => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className={`workspace-file-entry${selected ? ' active' : ''}`}>
      <button
        className={`workspace-file-row${selected ? ' active' : ''}`}
        onClick={onOpen}
        title={node.relativePath}
      >
        <FileIcon extension={node.extension} />
        <span>{node.name}</span>
      </button>
      <div className="workspace-file-entry__actions">
        <button onClick={onReveal} aria-label={`Reveal ${node.name} in Finder`} title="Reveal in Finder">↗</button>
        <button onClick={onRename} aria-label={`Rename ${node.name}`} title="Rename">✎</button>
        <button className="danger" onClick={onDelete} aria-label={`Delete ${node.name}`} title="Delete from disk">×</button>
      </div>
    </div>
  )
}

function WorkspaceFileViewer({
  file,
  draft,
  dirty,
  line,
  pendingLine,
  onPendingLineApplied,
  onFocus,
  onClosePane,
  onDraftChange,
  onLineChange,
  onRevert,
  attached,
  onToggleAttachment,
  onAsk,
  onSendSelectionToAgent,
  onReveal,
  onSaved,
}: {
  file: DesktopWorkspaceFile
  draft: string
  dirty: boolean
  line: number | null
  pendingLine: number | null
  onPendingLineApplied: () => void
  onFocus: () => void
  onClosePane?: () => void
  onDraftChange: (draft: string) => void
  onLineChange: (line: number) => void
  onRevert: () => void
  attached: boolean
  onToggleAttachment: () => void
  onAsk: () => void
  onSendSelectionToAgent: (prompt: string) => void
  onReveal: () => void
  onSaved: (file: DesktopWorkspaceFile) => void
}) {
  const bridge = getDesktopBridge()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ line: line ?? 1, column: 1 })
  const [inlineEdit, setInlineEdit] =
    useState<WorkspaceInlineEditRequest | null>(null)
  const saveRef = useRef<() => void>(() => {})

  useEffect(() => {
    setSaveError(null)
    setCursor({ line: line ?? 1, column: 1 })
    setInlineEdit(null)
  }, [file.path])

  useEffect(() => {
    saveRef.current = () => void save()
  })

  useEffect(() => {
    const onSave = (event: Event) => {
      const targetPath = (
        event as CustomEvent<{ path?: string }>
      ).detail?.path
      if (!targetPath || targetPath === file.path) saveRef.current()
    }
    window.addEventListener(WORKSPACE_SAVE_EVENT, onSave)
    return () => window.removeEventListener(WORKSPACE_SAVE_EVENT, onSave)
  }, [file.path])

  async function save() {
    if (!bridge || file.content == null || !dirty || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await bridge.workspace.writeFile(
        file.path,
        draft,
        'auto',
        file.modifiedAt
      )
      if (!result.ok) throw new Error(result.error || 'Could not save the file.')
      const savedFile = {
        ...file,
        content: draft,
        size: new TextEncoder().encode(draft).length,
        modifiedAt: result.file?.modifiedAt ?? file.modifiedAt,
      }
      onSaved(savedFile)
      announceWorkspaceMutation({ kind: 'write', paths: [savedFile.path] })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="workspace-file-viewer" onPointerDown={onFocus}>
      <header>
        <div className="workspace-file-viewer__identity">
          <b>
            {file.name}
            {dirty && <i>Unsaved</i>}
          </b>
          <span>{file.relativePath}</span>
        </div>
        <div className="workspace-file-viewer__actions">
          {!file.binary && !file.tooLarge && file.content != null && (
            <>
              {dirty && (
                <>
                  <button
                    className="primary"
                    onClick={() => void save()}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save ⌘S'}
                  </button>
                  <button
                    onClick={() => {
                      void confirmDialog({
                        title: `Discard unsaved changes to "${file.name}"?`,
                        body: 'The file will return to its last saved contents.',
                        confirmLabel: 'Revert',
                        destructive: true,
                      }).then((confirmed) => {
                        if (!confirmed) return
                        onRevert()
                        setSaveError(null)
                      })
                    }}
                    disabled={saving}
                  >
                    Revert
                  </button>
                </>
              )}
            </>
          )}
          <button
            className={attached ? 'active' : ''}
            onClick={onToggleAttachment}
            aria-pressed={attached}
            title={
              attached
                ? 'Remove this file from Intelligence context'
                : 'Include this file in Intelligence context'
            }
          >
            {attached ? 'Included' : 'Include'}
          </button>
          <button className="workspace-file-viewer__ask" onClick={onAsk}>
            Ask Intelligence
          </button>
          <button className="workspace-file-viewer__reveal" onClick={onReveal}>
            Reveal
          </button>
          {onClosePane && (
            <button
              className="workspace-file-viewer__unsplit"
              onClick={onClosePane}
              title="Close split editor"
            >
              Unsplit
            </button>
          )}
        </div>
      </header>

      {saveError && <div className="workspace-file-viewer__error">{saveError}</div>}

      {file.binary ? (
        <div className="workspace-file-viewer__message">
          This file is binary. Open it in its native application to make changes.
        </div>
      ) : file.tooLarge ? (
        <div className="workspace-file-viewer__message">
          This file is larger than 2 MB. Use search to find relevant text or open it in its
          native application.
        </div>
      ) : file.content == null ? (
        <div className="workspace-file-viewer__message">This file could not be read.</div>
      ) : (
        <>
          {inlineEdit && (
            <WorkspaceInlineEdit
              request={inlineEdit}
              currentSource={draft}
              fileName={file.relativePath}
              language={file.language}
              onApply={(replacement) => {
                if (draft !== inlineEdit.source) return
                onDraftChange(
                  `${inlineEdit.source.slice(
                    0,
                    inlineEdit.startOffset
                  )}${replacement}${inlineEdit.source.slice(
                    inlineEdit.endOffset
                  )}`
                )
                setInlineEdit(null)
              }}
              onClose={() => setInlineEdit(null)}
              onEscalate={(prompt) => {
                onSendSelectionToAgent(prompt)
                setInlineEdit(null)
              }}
            />
          )}
          <MonacoWorkspaceEditor
            path={file.path}
            language={file.language}
            value={draft}
            pendingLine={pendingLine}
            onPendingLineApplied={onPendingLineApplied}
            onChange={onDraftChange}
            onSave={() => void save()}
            onCursorChange={(nextLine, column) => {
              setCursor({ line: nextLine, column })
              onLineChange(nextLine)
            }}
            onInlineEdit={(selection: WorkspaceInlineSelection) =>
              setInlineEdit({ ...selection, source: draft })
            }
          />
          <footer className="workspace-statusbar">
            <span>{dirty ? 'Modified' : 'Saved'}</span>
            <div>
              <span>Ln {cursor.line}, Col {cursor.column}</span>
              <span>UTF-8</span>
              <span>{file.language || 'text'}</span>
              <span>⌘K Inline edit</span>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

function FolderIcon() {
  return (
    <svg className="workspace-tree-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.5h6l2 2h9v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-12Z" />
    </svg>
  )
}

function FileIcon({ extension }: { extension: string }) {
  return (
    <span className="workspace-file-icon" data-extension={extension || 'txt'}>
      {shortExtension(extension)}
    </span>
  )
}

function shortExtension(extension: string): string {
  const normalized = extension.toUpperCase()
  if (!normalized) return 'TXT'
  return normalized.length <= 4 ? normalized : normalized.slice(0, 3)
}

function WorkspaceCheckpoints({
  checkpoints,
  onClose,
  onRestore,
}: {
  checkpoints: DesktopWorkspaceCheckpoint[]
  onClose: () => void
  onRestore: (checkpointId: string) => Promise<void>
}) {
  const [restoring, setRestoring] = useState<string | null>(null)
  return (
    <aside className="workspace-checkpoints">
      <header>
        <div>
          <span>Local safety history</span>
          <b>Checkpoints</b>
        </div>
        <button onClick={onClose} aria-label="Close checkpoints">×</button>
      </header>
      <div>
        {checkpoints.length === 0 ? (
          <p>No file changes have created checkpoints yet.</p>
        ) : (
          checkpoints.map((checkpoint) => (
            <article key={checkpoint.id}>
              <div>
                <b>{checkpoint.label}</b>
                <span>
                  {new Date(checkpoint.createdAt).toLocaleString()} ·{' '}
                  {checkpoint.fileCount} {checkpoint.fileCount === 1 ? 'file' : 'files'}
                </span>
              </div>
              <button
                disabled={restoring != null}
                onClick={async () => {
                  setRestoring(checkpoint.id)
                  await onRestore(checkpoint.id)
                  setRestoring(null)
                }}
              >
                {restoring === checkpoint.id ? 'Restoring…' : 'Restore'}
              </button>
            </article>
          ))
        )}
      </div>
    </aside>
  )
}

function workspaceStorageKey(
  base: string,
  workspace: DesktopWorkspaceState | null
): string {
  const paths = [
    ...(workspace?.roots.map((root) => root.path) ?? []),
    ...(workspace?.looseFiles.map((file) => file.path) ?? []),
  ].sort()
  if (paths.length === 0) return `${base}.empty`
  let hash = 2_166_136_261
  for (const character of paths.join('\u0000')) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${base}.${(hash >>> 0).toString(36)}`
}

function sameWorkspaceIdentity(
  left: DesktopWorkspaceState | null,
  right: DesktopWorkspaceState | null
): boolean {
  if (!left || !right) return left === right
  if (left.workspaceId || right.workspaceId) {
    return left.workspaceId === right.workspaceId
  }
  const paths = (workspace: DesktopWorkspaceState) =>
    [
      ...workspace.roots.map((root) => root.path),
      ...workspace.looseFiles.map((file) => file.path),
    ].sort()
  const leftPaths = paths(left)
  const rightPaths = paths(right)
  return (
    leftPaths.length === rightPaths.length &&
    leftPaths.every((path, index) => path === rightPaths[index])
  )
}
