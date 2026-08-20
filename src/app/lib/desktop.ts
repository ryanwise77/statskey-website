export interface DesktopWorkspaceNode {
  name: string
  path: string
  relativePath: string
  kind: 'directory' | 'file'
  extension: string
  size: number | null
  modifiedAt: string
}

export interface DesktopWorkspaceState {
  /** Exact Electron-owned identity for the current roots and loose files. */
  workspaceId: string | null
  roots: DesktopWorkspaceNode[]
  /** First root retained for compatibility with older desktop bundles. */
  root: DesktopWorkspaceNode | null
  statsKeySource?: {
    rootPath: string
    version: string
  } | null
  looseFiles: DesktopWorkspaceNode[]
  importedWorkspace: {
    name: string
    sourcePath: string | null
    importedFolders: number
    missingFolders: number
  } | null
}

/** Trusted runtime context captured when an agent turn is sent. */
export interface DesktopWorkspaceBinding {
  readonly workspaceId: string
}

export interface DesktopRecentProject {
  id: string
  name: string
  roots: string[]
  rootCount: number
  availableRootCount: number
  lastOpenedAt: string
  saved: boolean
}

export interface DesktopWorkspaceImportResult {
  ok: boolean
  cancelled?: boolean
  workspace?: DesktopWorkspaceState
  error?: string
}

export interface DesktopCursorWorkspaceImportResult {
  ok: boolean
  imported: number
  total: number
  skipped: number
  error?: string
}

export interface DesktopWorkspaceFile extends DesktopWorkspaceNode {
  content: string | null
  binary: boolean
  tooLarge: boolean
  language: string
}

export interface DesktopWorkspaceSearchResult extends DesktopWorkspaceNode {
  match: 'name' | 'content' | 'symbol' | 'fuzzy'
  line: number | null
  preview: string
  score?: number
  rootName?: string
}

export type DesktopWorkspaceSearchMode =
  | 'hybrid'
  | 'files'
  | 'content'
  | 'symbols'
  | 'fuzzy'

export interface DesktopWorkspaceIndexState {
  status: 'idle' | 'indexing' | 'ready' | 'error'
  indexedFiles: number
  filesSeen?: number
  indexed?: number
  reused?: number
  rootCount: number
  updatedAt: string | null
  error?: string
}

export interface DesktopWorkspaceWorktree {
  path: string
  name: string
  branch: string | null
  head: string | null
  main: boolean
  active: boolean
  managed: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
}

export type DesktopApprovalMode = 'review' | 'auto' | 'everything'

export interface DesktopOperationOrigin {
  sessionId?: string
  messageId?: string
}

export interface DesktopWorkspaceCheckpoint {
  id: string
  createdAt: string
  label: string
  fileCount: number
}

export interface DesktopOperationRequest {
  id: string
  kind:
    | 'write'
    | 'create'
    | 'delete'
    | 'rename'
    | 'mkdir'
    | 'terminal'
    | 'restore'
    | 'mcp'
    | 'hook'
    | 'git'
    | 'browser'
    | 'application'
    | 'device'
  title: string
  description: string
  before?: string
  after?: string
  command?: string
  decisionScope?: 'workspace-hooks'
  origin?: DesktopOperationOrigin
}

export interface DesktopOperationResult {
  ok: boolean
  changed?: boolean
  cancelled?: boolean
  error?: string
  checkpoint?: DesktopWorkspaceCheckpoint
  file?: DesktopWorkspaceNode
  exitCode?: number | null
  signal?: string | null
  stdout?: string
  stderr?: string
}

export interface DesktopWorkspaceInstructions {
  rules: Array<{
    name: string
    path: string
    description?: string
    alwaysApply?: boolean
    globs?: string
    content: string
  }>
  skills: Array<{
    name: string
    description: string
    relativePath: string
  }>
  configuration: {
    mcpFiles: Array<{ name: string; path: string; relativePath: string }>
    hookFiles: Array<{ name: string; path: string; relativePath: string }>
  }
}

export interface DesktopTerminalSession {
  id: string
  command: string
  cwd: string
  rootName: string
  failClosed?: boolean
  status: 'running' | 'cancelling' | 'exited' | 'failed' | 'cancelled'
  output: string
  exitCode: number | null
  signal: number | null
  startedAt: string
  updatedAt: string
}

export interface DesktopTerminalEvent {
  type: 'data' | 'exit'
  sessionId: string
  data?: string
  session?: DesktopTerminalSession
}

export interface DesktopGitFile {
  path: string
  originalPath: string | null
  indexStatus: string
  workingStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export interface DesktopWorkspaceBridge {
  getState(binding?: DesktopWorkspaceBinding): Promise<DesktopWorkspaceState>
  onState(listener: (state: DesktopWorkspaceState) => void): () => void
  recentProjects(): Promise<DesktopRecentProject[]>
  importCursorWorkspaces?(): Promise<DesktopCursorWorkspaceImportResult>
  openRecentProject(workspaceId: string): Promise<{
    ok: boolean
    workspace?: DesktopWorkspaceState
    error?: string
  }>
  saveWorkspace(name: string): Promise<{
    ok: boolean
    project?: DesktopRecentProject
    error?: string
  }>
  renameRecentProject(workspaceId: string, name: string): Promise<{
    ok: boolean
    project?: DesktopRecentProject
    error?: string
  }>
  removeRecentProject(workspaceId: string): Promise<boolean>
  chooseFolder(): Promise<DesktopWorkspaceState | null>
  createFromFolders(): Promise<DesktopWorkspaceState | null>
  openProject(): Promise<DesktopWorkspaceState | null>
  openStatsKeySource(): Promise<{
    ok: boolean
    cancelled?: boolean
    source?: {
      rootPath: string
      version: string
    }
    workspace?: DesktopWorkspaceState
    error?: string
  }>
  createProject(): Promise<{
    ok: boolean
    cancelled?: boolean
    workspace?: DesktopWorkspaceState
    error?: string
  }>
  createProjectInRoot(name: string): Promise<{
    ok: boolean
    cancelled?: boolean
    workspace?: DesktopWorkspaceState
    error?: string
  }>
  cloneProject(repositoryUrl: string): Promise<{
    ok: boolean
    cancelled?: boolean
    workspace?: DesktopWorkspaceState
    error?: string
  }>
  removeRoot(rootPath: string): Promise<{
    ok: boolean
    workspace?: DesktopWorkspaceState
    error?: string
  }>
  closeWorkspace(): Promise<DesktopWorkspaceState | null>
  importWorkspaceFile(): Promise<DesktopWorkspaceImportResult>
  addFiles(): Promise<DesktopWorkspaceState | null>
  listDirectory(directoryPath: string): Promise<DesktopWorkspaceNode[]>
  readFile(
    filePath: string,
    runWorkspaceHooks?: boolean,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopWorkspaceFile | null>
  readMedia(filePath: string, binding?: DesktopWorkspaceBinding): Promise<{
    name: string
    relativePath: string
    mediaType: string
    data: string
    size: number
  } | null>
  search(
    query: string,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopWorkspaceSearchResult[]>
  indexState(): Promise<DesktopWorkspaceIndexState | null>
  refreshIndex(): Promise<boolean>
  indexSearch(
    query: string,
    mode?: DesktopWorkspaceSearchMode,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopWorkspaceSearchResult[]>
  onIndexState(
    listener: (state: DesktopWorkspaceIndexState) => void
  ): () => void
  reveal(filePath: string): Promise<boolean>
  writeFile(
    filePath: string,
    content: string,
    approvalMode?: DesktopApprovalMode,
    expectedModifiedAt?: string,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  createFile(
    rootPath: string,
    relativePath: string,
    content: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  renderPdf?(
    rootPath: string,
    relativePath: string,
    htmlBody: string,
    title?: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult & { bytes?: number; sha256?: string }>
  exportPdf?(
    fileName: string,
    htmlBody: string,
    title?: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin
  ): Promise<
    DesktopOperationResult & {
      bytes?: number
      sha256?: string
      destination?: 'desktop'
    }
  >
  deleteFile(
    filePath: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  renameFile(
    filePath: string,
    nextName: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  runCommand(
    command: string,
    cwd: string,
    approvalMode?: DesktopApprovalMode,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  startTerminal(
    command: string,
    cwd: string,
    approvalMode?: DesktopApprovalMode,
    dimensions?: { cols: number; rows: number },
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding,
    options?: {
      failClosed?: boolean
      environment?: Record<string, string>
    }
  ): Promise<{
    ok: boolean
    cancelled?: boolean
    error?: string
    session?: DesktopTerminalSession
  }>
  listTerminalSessions(): Promise<DesktopTerminalSession[]>
  writeTerminal(sessionId: string, data: string): Promise<boolean>
  resizeTerminal(
    sessionId: string,
    cols: number,
    rows: number
  ): Promise<boolean>
  cancelTerminal(sessionId: string): Promise<boolean>
  onTerminalEvent(
    listener: (event: DesktopTerminalEvent) => void
  ): () => void
  gitInitialize(
    rootPath: string,
    approvalMode?: DesktopApprovalMode
  ): Promise<DesktopOperationResult>
  gitStatus(
    rootPath: string,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  gitFiles(rootPath: string): Promise<{
    ok: boolean
    files: DesktopGitFile[]
    error?: string
  }>
  gitDiff(
    rootPath: string,
    staged?: boolean,
    paths?: string[],
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  gitStageAll(rootPath: string): Promise<DesktopOperationResult>
  gitStagePaths(
    rootPath: string,
    paths: string[]
  ): Promise<DesktopOperationResult>
  gitUnstageAll(rootPath: string): Promise<DesktopOperationResult>
  gitUnstagePaths(
    rootPath: string,
    paths: string[]
  ): Promise<DesktopOperationResult>
  gitCommit(
    rootPath: string,
    message: string,
    approvalMode?: DesktopApprovalMode
  ): Promise<DesktopOperationResult>
  gitPush(
    rootPath: string,
    approvalMode?: DesktopApprovalMode
  ): Promise<DesktopOperationResult>
  worktrees(rootPath: string): Promise<DesktopWorkspaceWorktree[]>
  createWorktree(
    rootPath: string,
    label: string,
    approvalMode?: DesktopApprovalMode
  ): Promise<
    DesktopOperationResult & { worktree?: DesktopWorkspaceWorktree }
  >
  activateWorktree(
    rootPath: string,
    worktreePath: string
  ): Promise<
    DesktopOperationResult & { workspace?: DesktopWorkspaceState }
  >
  removeWorktree(
    rootPath: string,
    worktreePath: string,
    approvalMode?: DesktopApprovalMode
  ): Promise<DesktopOperationResult>
  checkpoints(binding?: DesktopWorkspaceBinding): Promise<DesktopWorkspaceCheckpoint[]>
  instructions(binding?: DesktopWorkspaceBinding): Promise<DesktopWorkspaceInstructions>
  runHook(
    hookName:
      | 'sessionStart'
      | 'sessionEnd'
      | 'beforeSubmitPrompt'
      | 'preCompact'
      | 'stop'
      | 'afterAgentResponse',
    payload: Record<string, unknown>,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<{ ok: boolean; error?: string }>
  restoreCheckpoint(
    checkpointId: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopOperationResult>
  onOperationRequest(listener: (operation: DesktopOperationRequest) => void): () => void
  onOperationSettled(
    listener: (settlement: { id: string; reason: 'expired' }) => void
  ): () => void
  resolveOperation(operationId: string, approved: boolean): void
}

export type DesktopProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'moonshot'
  | 'azure-openai'
  | 'aws-bedrock'
  | 'openai-compatible'

export interface DesktopProviderStatus {
  provider: DesktopProviderId
  configured: boolean
  encryptionAvailable: boolean
  updatedAt: string | null
  credentials: Record<string, boolean>
  config: Record<string, string>
}

export interface DesktopProviderModel {
  id: string
  label: string
  createdAt?: string | null
}

export interface DesktopProviderBridge {
  getStatus(): Promise<DesktopProviderStatus[]>
  save(
    provider: DesktopProviderId,
    settings: Record<string, string>
  ): Promise<{ ok: boolean; status?: DesktopProviderStatus; error?: string }>
  remove(provider: DesktopProviderId): Promise<boolean>
  test(
    provider: DesktopProviderId
  ): Promise<{ ok: boolean; message?: string; modelCount?: number | null; error?: string }>
  models(
    provider: DesktopProviderId
  ): Promise<{ ok: boolean; models?: DesktopProviderModel[]; error?: string }>
  run(
    requestId: string,
    provider: DesktopProviderId,
    request: {
      model: string
      systemPrompt: string
      messages: Array<{
        role: 'user' | 'assistant'
        content: string | Array<Record<string, unknown>>
      }>
      tools?: Array<Record<string, unknown>>
      effort?: string
      serviceTier?: 'fast'
      reasoningMode?: 'standard' | 'pro'
      maxOutputTokens?: number
      webSearch?: boolean
    },
    onEvent?: (event: {
      type: 'queued' | 'open' | 'text' | 'activity'
      text?: string
      position?: number
      active?: number
      limit?: number
      elapsedMs?: number
    }) => void
  ): Promise<{
    provider: DesktopProviderId
    model: string
    content: string
    contentBlocks: Array<Record<string, unknown>>
    toolUse: Array<{
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }>
    stopReason?: string | null
    usage?: Record<string, unknown>
    citations?: string[]
  }>
  cancel(requestId: string): void
}

export interface DesktopIntegrationConnection {
  id: string
  name: string
  url: string
  authType: 'none' | 'bearer' | 'oauth'
  configured: boolean
  credentials: { token: boolean; oauth: boolean }
  updatedAt: string | null
}

export interface DesktopIntegrationBridge {
  getStatus(): Promise<DesktopIntegrationConnection[]>
  save(
    id: string | null,
    settings: {
      name: string
      url: string
      authType: 'none' | 'bearer' | 'oauth'
      token?: string
    }
  ): Promise<{
    ok: boolean
    connection?: DesktopIntegrationConnection
    error?: string
  }>
  authorize(id: string): Promise<{
    ok: boolean
    toolCount?: number
    tools?: string[]
    error?: string
  }>
  test(id: string): Promise<{
    ok: boolean
    toolCount?: number
    tools?: string[]
    error?: string
  }>
  remove(id: string): Promise<boolean>
}

export interface DesktopMcpTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  server?: string
  originalName?: string
  unavailable?: boolean
}

export interface DesktopMcpBridge {
  tools(
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopMcpTool[]>
  callTool(
    toolName: string,
    args: Record<string, unknown>,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<{
    ok: boolean
    cancelled?: boolean
    result?: unknown
    error?: string
  }>
}

export interface DesktopBrowserElement {
  ref: string
  tag: string
  type: string
  autocomplete: string
  editable: boolean
  label: string
  disabled: boolean
  href?: string
}

export interface DesktopBrowserSnapshot {
  ok: boolean
  cancelled?: boolean
  error?: string
  tabId?: string
  revision?: string
  url?: string
  title?: string
  text?: string
  elements?: DesktopBrowserElement[]
  blockedNavigation?: string | null
}

export interface DesktopBrowserTab {
  id: string
  title: string | null
  url: string | null
  loading: boolean
  active: boolean
  canGoBack: boolean
  canGoForward: boolean
  ownerSessionId?: string | null
}

export interface DesktopBrowserState {
  tabs: DesktopBrowserTab[]
  activeTabId: string | null
}

export type DesktopBrowserNavigation =
  | { action: 'url'; url: string }
  | { action: 'back' | 'forward' | 'reload' }

export interface DesktopBrowserBridge {
  open(
    url: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    options?: { newTab?: boolean }
  ): Promise<DesktopBrowserSnapshot>
  list(origin?: DesktopOperationOrigin): Promise<DesktopBrowserState>
  activate(tabId: string): Promise<DesktopBrowserSnapshot>
  navigate(
    tabId: string,
    navigation: DesktopBrowserNavigation,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin
  ): Promise<DesktopBrowserSnapshot>
  snapshot(
    tabId?: string,
    origin?: DesktopOperationOrigin
  ): Promise<DesktopBrowserSnapshot>
  click(
    revision: string,
    ref: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    tabId?: string
  ): Promise<DesktopBrowserSnapshot>
  type(
    revision: string,
    ref: string,
    text: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    tabId?: string
  ): Promise<DesktopBrowserSnapshot>
  screenshot(
    tabId?: string,
    origin?: DesktopOperationOrigin
  ): Promise<{
    ok: boolean
    tabId?: string
    mediaType?: 'image/png'
    data?: string
    width?: number
    height?: number
    error?: string
  }>
  close(tabId?: string, origin?: DesktopOperationOrigin): Promise<boolean>
  onState(listener: (state: DesktopBrowserState) => void): () => void
}

export interface DesktopApplicationsBridge {
  list(): Promise<Array<{ name: string }>>
  open(
    name: string,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin
  ): Promise<{
    ok: boolean
    cancelled?: boolean
    application?: string
    error?: string
  }>
}

export type DesktopDevicePlatform = 'ios' | 'android'

export type DesktopDeviceAction =
  | 'boot'
  | 'install'
  | 'launch'
  | 'inspect'
  | 'screenshot'
  | 'tap'
  | 'type'
  | 'swipe'
  | 'back'
  | 'home'
  | 'open_url'
  | 'add_media'
  | 'process'
  | 'logs'
  | 'close'

export interface DesktopDeviceSummary {
  /** Opaque, session-scoped reference. Never a raw UDID or adb serial. */
  id: string
  name: string
  platform: DesktopDevicePlatform
  state: string
  osVersion?: string
  runtime?: string
  available: boolean
}

export interface DesktopDeviceToolAvailability {
  xcrun?: string
  adb?: string
  emulator?: string
  maestro?: string
  javaHome?: string
  androidSdk?: string
}

export interface DesktopDeviceActionRequest {
  platform: DesktopDevicePlatform
  action: DesktopDeviceAction
  deviceId: string
  artifactPath?: string
  mediaPath?: string
  url?: string
  appId?: string
  activity?: string
  x?: number
  y?: number
  endX?: number
  endY?: number
  durationMs?: number
  text?: string
  environment?: Record<string, string>
  logSinceSeconds?: number
}

export interface DesktopDeviceActionResult {
  ok: boolean
  cancelled?: boolean
  platform?: DesktopDevicePlatform
  action?: DesktopDeviceAction | 'list'
  marker?: string
  error?: string
  device?: DesktopDeviceSummary
  devices?: DesktopDeviceSummary[]
  tools?: DesktopDeviceToolAvailability
  buildEnvironment?: Partial<
    Record<'JAVA_HOME' | 'ANDROID_HOME' | 'ANDROID_SDK_ROOT', string>
  >
  appId?: string
  pid?: number
  alive?: boolean
  crashFree?: boolean
  crashMarkers?: string[]
  hierarchy?: string
  screenshot?: {
    mediaType: 'image/png'
    data: string
    width?: number
    height?: number
  }
  logs?: string
  installed?: boolean
  launched?: boolean
  opened?: boolean
  scheme?: string
  added?: boolean
  mediaType?: 'image' | 'video'
  fileName?: string
  closed?: boolean
}

export interface DesktopDevicesBridge {
  list(
    binding?: DesktopWorkspaceBinding,
    origin?: DesktopOperationOrigin
  ): Promise<DesktopDeviceActionResult>
  act(
    request: DesktopDeviceActionRequest,
    approvalMode?: DesktopApprovalMode,
    origin?: DesktopOperationOrigin,
    binding?: DesktopWorkspaceBinding
  ): Promise<DesktopDeviceActionResult>
}

export interface DesktopCalendarFeed {
  id: string
  name: string
  createdAt: string
}

export interface DesktopCalendarFeedsBridge {
  list(): Promise<DesktopCalendarFeed[]>
  add(
    name: string,
    url: string
  ): Promise<{ ok: boolean; feed?: DesktopCalendarFeed; error?: string }>
  remove(feedId: string): Promise<boolean>
  events(
    start: string,
    end: string,
    limit?: number
  ): Promise<{
    events: Array<{
      id: string | null
      title: string
      start: {
        allDay: boolean
        date?: string
        dateTime?: string
        timeZone?: string | null
      }
      end: {
        allDay: boolean
        date?: string
        dateTime?: string
        timeZone?: string | null
      }
      location: string | null
      organizer: string | null
      attendees: Array<{
        email: string
        responseStatus: string | null
        self: boolean
      }>
      source: 'subscription'
      calendarId: string
      calendarName: string
    }>
    errors: string[]
  }>
}

export interface DesktopPreferences {
  version: 1
  orchestrationPolicyVersion: 2
  intelligenceUpdatesPolicyVersion: 2
  modelSettings: Record<string, unknown> | null
  /** Null keeps investigators on the current parent model and route. */
  subagentModelSettings: Record<string, unknown> | null
  inlineCompletions: boolean
  agentMode: 'auto' | 'ask' | 'plan' | 'debug' | 'agent'
  executePermissionGranted: boolean
  approvalMode: DesktopApprovalMode
  orchestrationMode: 'focused' | 'adaptive' | 'parallel'
  intelligenceUpdates: 'quiet' | 'live' | 'narrated'
  dismissedUpdateVersion?: string | null
}

export interface DesktopPreferencesBridge {
  get(): Promise<DesktopPreferences>
  save(preferences: Partial<DesktopPreferences>): Promise<boolean>
}

export type DesktopUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  currentVersion: string
  latestVersion?: string
  releaseDate?: string
  releaseNotes?: string[]
  checkedAt?: string
  percent?: number
  transferred?: number
  total?: number
  message?: string
  manual: boolean
  dismissed: boolean
}

export interface DesktopUpdateBridge {
  getState(): Promise<DesktopUpdateState | null>
  check(): Promise<DesktopUpdateState | null>
  download(): Promise<DesktopUpdateState | null>
  install(): Promise<boolean>
  dismiss(): Promise<DesktopUpdateState | null>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}

export type DesktopFounderCheck =
  | 'oil-storage'
  | 'macremote-doctor'
  | 'macremote-connectivity'

export type DesktopFounderAction =
  | 'open-truenas'
  | 'open-idrac'
  | 'mount-oil-share'
  | 'open-oil-workspace'
  | 'start-mac-ssh'
  | 'open-mac-screen'
  | 'stop-mac-screen'

export interface DesktopFounderPathStatus {
  path: string
  available: boolean
  kind: 'directory' | 'file' | 'other' | null
}

export interface DesktopFounderState {
  available: boolean
  generatedAt?: string
  error?: string
  configurationError?: string
  configuration?: {
    source: 'defaults' | 'file'
    path: string
  }
  services?: {
    trueNas?: {
      label: string
      host: string
      port: number
      online: boolean
      url: string
    }
    smb?: {
      label: string
      host: string
      port: number
      online: boolean
      url: string
    }
    idrac?: {
      label: string
      host: string
      port: number
      online: boolean
      url: string
    }
    macMini?: {
      label: string
      host: string
      sshPort: number
      screenPort: number
      sshOnline: boolean
      screenOnline: boolean
    }
    gpu?: {
      label: string
      host: string | null
      port: number
      configured: boolean
      online: boolean
    }
  }
  storage?: {
    path: string
    mounted: boolean
    totalBytes: number | null
    freeBytes: number | null
    freeRatio: number | null
    reserveHealthy: boolean
  }
  readiness?: {
    oilProject?: DesktopFounderPathStatus
    oilPython?: DesktopFounderPathStatus
    macRemoteProject?: DesktopFounderPathStatus
    macRemoteExecutable?: DesktopFounderPathStatus
    macRemoteConfig?: DesktopFounderPathStatus
    macScreenRunning?: boolean
    macScreenError?: string | null
  }
  paths?: {
    oilProject: string
    oilData: string
    macRemoteProject: string
  }
}

export interface DesktopFounderResult {
  ok: boolean
  changed?: boolean
  cancelled?: boolean
  error?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  timedOut?: boolean
  pid?: number
  workspace?: DesktopWorkspaceState | null
  session?: DesktopTerminalSession
}

export interface DesktopFounderBridge {
  state(): Promise<DesktopFounderState>
  runCheck(check: DesktopFounderCheck): Promise<DesktopFounderResult>
  perform(action: DesktopFounderAction): Promise<DesktopFounderResult>
}

export interface DesktopFleetIdentityProfile {
  label: string
  role: 'controller' | 'worker' | 'hybrid'
  workerMode: 'dedicated' | 'opt-in' | 'disabled'
  platform: 'darwin' | 'win32' | 'linux' | 'ios' | 'android'
  maxConcurrentJobs: number
}

export interface DesktopFleetIdentityState {
  deviceId: `dev_${string}`
  publicKeyFingerprint: string
  publicKeySpki: string
  profile: DesktopFleetIdentityProfile
  enrollment?: {
    ownerUid: string
    endpoint: string
    coordinatorKeyId: string
    coordinatorPublicKeySpki: string
    enrolledAt: string
  } | null
}

export interface DesktopFleetRetainedArtifact {
  spoolId: string
  jobId: `job_${string}`
  leaseId: `lease_${string}`
  attempt: number
  kind: string
  reasonCode: string
  createdAt: string
  sizeBytes: number
  contentHash: string | null
  integrity: 'recorded' | 'unverified'
}

export interface DesktopFleetBridge {
  identityState(): Promise<DesktopFleetIdentityState | null>
  ensureIdentity(
    profile: DesktopFleetIdentityProfile
  ): Promise<DesktopFleetIdentityState | null>
  replaceIdentity(): Promise<DesktopFleetIdentityState | null>
  createBootstrap(input: { ownerUid: string }): Promise<
    import('./fleet/types').BootstrapFleetDeviceInput | null
  >
  createControllerRecovery(input: {
    ownerUid: string
    expectedControllerDeviceId: `dev_${string}`
  }): Promise<import('./fleet/types').RecoverFleetControllerInput | null>
  createPairingReceipt(
    input:
      | (Omit<
          import('./fleet/types').PairFleetDeviceInput['receipt'],
          'controllerDeviceId' | 'pairingNonce' | 'candidate' | 'ownerUid'
        > & {
          candidate: DesktopFleetIdentityState
          pairingNonce?: string
        })
      // Controller-only candidates (hybrid with worker mode disabled, such
      // as a phone) pair without execution scope; the main process builds
      // the controller receipt variant.
      | { candidate: DesktopFleetIdentityState }
  ): Promise<import('./fleet/types').PairFleetDeviceInput['receipt'] | null>
  createLocalGrant(input: {
    workspaceIds: string[]
    repositoryIdentities: string[]
    capabilities: import('./fleet/types').FleetCapability[]
    unattended: boolean
    expiresAt: number | string
    policyVersion: number
  }): Promise<import('./fleet/types').CreateLocalFleetGrantInput | null>
  authorizeJob(
    input: Omit<
      import('./fleet/types').CreateFleetJobInput,
      'controllerAuthorization'
    >
  ): Promise<
    import('./fleet/types').CreateFleetJobInput['controllerAuthorization'] | null
  >
  signPairing(
    receipt: import('./fleet/types').PairFleetDeviceInput['receipt'],
    action: 'pairing.candidate' | 'pairing.approve'
  ): Promise<import('./fleet/types').FleetSignedDeviceEnvelope | null>
  downloadArtifact(grant: {
    artifactId: `artifact_${string}`
    url: string
    expiresAt: string
  }): Promise<boolean>
  listRetainedArtifacts(): Promise<DesktopFleetRetainedArtifact[]>
  revealRetainedArtifact(input: {
    spoolId: string
    kind: string
  }): Promise<boolean>
  purgeRetainedArtifact(input: { spoolId: string }): Promise<boolean>
  markEnrolled(enrollment: {
    ownerUid: string
    endpoint: string
    coordinatorKeyId: string
    coordinatorPublicKeySpki: string
  }): Promise<DesktopFleetIdentityState | null>
}

export interface DesktopRemoteSessionHeader {
  width: number
  height: number
  scale: number
  hostname: string
  platform: string
}

export interface DesktopRemoteSessionState {
  sessionId: string
  state: 'connecting' | 'waiting' | 'active' | 'closed' | 'failed'
  paired: boolean
  header: DesktopRemoteSessionHeader | null
  error: string | null
}

export interface DesktopRemoteSessionFrame {
  sessionId: string
  jpeg: Uint8Array
}

export type DesktopRemoteInputEvent =
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mousedown' | 'mouseup'; x: number; y: number; button: 'left' | 'middle' | 'right' }
  | { type: 'wheel'; x: number; y: number; deltaY: number; deltaX?: number }
  | { type: 'keydown' | 'keyup'; key: string }

export interface DesktopRemoteSessionBridge {
  prepareRequest(): Promise<{ controllerEphemeralKey: string } | null>
  connect(input: {
    sessionId: string
    relayEndpoint: string
    sessionKey: string
    controllerEphemeralKey: string
    capabilities: string[]
  }): Promise<{ ok: boolean; error?: string }>
  sendInput(
    sessionId: string,
    event: DesktopRemoteInputEvent
  ): Promise<{ ok: boolean; error?: string }>
  end(sessionId: string): Promise<boolean>
  getState(sessionId: string): Promise<DesktopRemoteSessionState | null>
  onFrame(listener: (frame: DesktopRemoteSessionFrame) => void): () => void
  onState(listener: (state: DesktopRemoteSessionState) => void): () => void
}

export interface StatsKeyDesktopBridge {
  platform: string
  terminalShell?: {
    kind: 'cmd' | 'posix'
    executable: string
  }
  electronVersion: string
  founderMode?: boolean
  founderBuild?: boolean
  founder?: DesktopFounderBridge
  retry(): void
  setBadge(count: number): void
  notify(payload: { title: string; body: string }): void
  durableState?: {
    get(key: string): string | null
    set(key: string, value: string | null): boolean
  }
  openExternal(url: string): Promise<boolean>
  openCalendarFile?(
    contents: string,
    fileName: string
  ): Promise<{ ok: boolean; error?: string }>
  shareCalendarFile?(
    contents: string,
    fileName: string,
    description: string
  ): Promise<{
    ok: boolean
    unsupported?: boolean
    needsAttachment?: boolean
    error?: string
  }>
  calendarFeeds?: DesktopCalendarFeedsBridge
  workspace: DesktopWorkspaceBridge
  /**
   * Workspace Sync & Backup runtime (direct send, backups, live sync).
   * Optional so older packaged preloads keep working.
   */
  workspaceSync?: import('./sync/types').DesktopWorkspaceSyncBridge
  fleet?: DesktopFleetBridge
  /**
   * Fleet Remote Session relay channel. Optional so older packaged preloads
   * keep working.
   */
  remoteSession?: DesktopRemoteSessionBridge
  providers: DesktopProviderBridge
  integrations?: DesktopIntegrationBridge
  preferences: DesktopPreferencesBridge
  updates?: DesktopUpdateBridge
  mcp: DesktopMcpBridge
  browser: DesktopBrowserBridge
  applications: DesktopApplicationsBridge
  devices?: DesktopDevicesBridge
  onOpenUrl(listener: (url: string) => void): () => void
  onSummon(listener: () => void): () => void
  /**
   * Native menu routing. Optional so older packaged preloads keep working.
   * Commands: 'new-chat' | 'close-tab' | 'open-settings' | 'save-all'.
   */
  onMenuCommand?(listener: (command: string) => void): () => void
  /**
   * Acknowledge a menu command finished ('save-all' today), so main can act
   * on the result — e.g. only close the window once saves truly succeeded.
   * Optional so older packaged preloads keep working.
   */
  menuCommandComplete?: (command: string, ok: boolean) => void
}

export const SUMMON_FOCUS_EVENT = 'statskey:focus-composer'
export const AGENT_PREFILL_EVENT = 'statskey:prefill-composer'
export const GOOGLE_CONNECTION_EVENT = 'statskey:google-connection'

export function getDesktopBridge(): StatsKeyDesktopBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as { statsKeyDesktop?: unknown }).statsKeyDesktop
  if (candidate == null || typeof candidate !== 'object') return null
  const bridge = candidate as Partial<StatsKeyDesktopBridge>
  if (
    typeof bridge.setBadge !== 'function' ||
    typeof bridge.openExternal !== 'function' ||
    typeof bridge.workspace?.readFile !== 'function' ||
    typeof bridge.providers?.getStatus !== 'function' ||
    typeof bridge.preferences?.get !== 'function' ||
    typeof bridge.mcp?.tools !== 'function' ||
    typeof bridge.onSummon !== 'function'
  ) {
    return null
  }
  return bridge as StatsKeyDesktopBridge
}
