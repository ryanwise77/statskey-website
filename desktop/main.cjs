const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, Notification, ShareMenu, globalShortcut, safeStorage, session, shell, screen } = require('electron')
const { chmodSync, closeSync, constants: fsConstants, createReadStream, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync, mkdirSync } = require('node:fs')
const { renameSync, unlinkSync } = require('node:fs')
const { access, statfs } = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { execFileSync } = require('node:child_process')
const { AsyncLocalStorage } = require('node:async_hooks')
const { createHash } = require('node:crypto')
const {
  normalizeProviderModelList,
  runProviderRound,
} = require('./provider-runtime.cjs')
const {
  ProviderCancelledError,
  ProviderHardTimeoutError,
  createProviderRunGuard,
} = require('./provider-run-guard.cjs')
const {
  providerMetadataForConfig,
  providerStatusFromEntry,
} = require('./provider-vault-runtime.cjs')
const {
  integrationMetadataForConfig,
  integrationStatusFromEntry,
  mcpConfigForIntegration,
  sanitizeRemoteIntegration,
  serverNameForIntegration,
  validIntegrationId,
} = require('./integration-vault-runtime.cjs')
const { ProviderVaultCrypto } = require('./provider-vault-crypto.cjs')
const {
  SafeStorageCrypto,
  SafeStorageTimeoutError,
  SafeStorageUnavailableError,
} = require('./safe-storage-runtime.cjs')
const {
  WorkspaceCheckpointStore,
} = require('./workspace-checkpoint-runtime.cjs')
const {
  createWorkspaceCacheKeyProvider,
} = require('./workspace-cache-key-runtime.cjs')
const {
  MAIN_WINDOW_VISIBILITY_OPTIONS,
  installMainWindowRevealLifecycle,
} = require('./window-reveal-runtime.cjs')
const {
  LocalMcpManager,
  authorizeRemoteMcp,
} = require('./mcp-runtime.cjs')
const { minimatch } = require('minimatch')
const { autoUpdater } = require('electron-updater')
const {
  DesktopUpdateRuntime,
  desktopHealthPayload,
} = require('./update-runtime.cjs')
const { ControlledBrowserRuntime } = require('./controlled-browser.cjs')
const {
  ControlledApplicationsRuntime,
} = require('./controlled-applications.cjs')
const {
  TerminalRuntime,
  normalizeTerminalEnvironmentOverrides,
} = require('./terminal-runtime.cjs')
const { runBoundedChildProcess } = require('./child-process-runtime.cjs')
const { DeviceControlRuntime } = require('./device-control-runtime.cjs')
const {
  normalizeGitDiffPaths,
  parsePorcelainStatus,
} = require('./git-runtime.cjs')
const { shouldAutoApprove } = require('./approval-policy.cjs')
const {
  defaultDesktopPreferences,
  preferencesWithUpdate,
  sanitizeAgentMode,
  sanitizeDesktopModelSettings,
} = require('./preferences-runtime.cjs')
const {
  findStatsKeySource,
  inspectStatsKeySource,
} = require('./self-edit-runtime.cjs')
const {
  fetchCalendarFeed,
  parseCalendarFeedEvents,
  validateCalendarFeedUrl,
} = require('./calendar-feed-runtime.cjs')
const {
  assertUnprefixedWorkspaceCreatePath,
  currentWorkspaceIdentity,
  cursorWorkspaceLocations,
  defaultWorkspaceLabel,
  readWorkspaceDirectoryEntries,
  resolveWorkspaceDefinitionFile,
  workspaceDisplayPath,
  workspaceIdentity,
} = require('./workspace-runtime.cjs')
const {
  WorkspaceBindingRuntime,
} = require('./workspace-binding-runtime.cjs')
const {
  createProjectInDefaultRoot,
} = require('./workspace-create-runtime.cjs')
const { searchWorkspaceDirect } = require('./workspace-search-runtime.cjs')
const {
  createWorkspaceSyncRuntime,
} = require('./workspace-sync-runtime.cjs')
const {
  createSignedDeviceRequest,
  deviceIdentityForPublicKey,
  normalizePublicKeySpki,
} = require('./fleet-auth-runtime.cjs')
const { FleetIdentityStore } = require('./fleet-identity-store.cjs')
const {
  createFleetDeviceTransport,
  normalizeFleetDeviceEndpoint,
} = require('./fleet-node-client.cjs')
const { FleetNodeSupervisor } = require('./fleet-node-supervisor.cjs')
const {
  FleetPairingApprovalRegistry,
  createControllerPairingReceipt,
  createPairingReceipt,
  isControllerCandidateProfile,
  publicFleetDeviceIdentity,
  signPairingReceipt,
  validatePairingSigner,
} = require('./fleet-pairing-runtime.cjs')
const {
  DEFAULT_ALLOWED_REPOSITORY_HOSTS,
  FleetLeaseAuthorityStore,
  createFleetWorkerAdapters,
  directExecutableExtensions,
  kernelBackedFleetProcessContainment,
  listArtifactSpool,
  purgeArtifactSpoolEntry,
  revealArtifactSpoolEntry,
} = require('./fleet-worker-adapters.cjs')
const {
  validateDownloadGrant: validateFleetArtifactDownloadGrant,
} = require('./fleet-artifact-uploader.cjs')
const {
  fleetJobAuthorizationDetail,
  normalizeCreateJob: normalizeFleetCreateJob,
  normalizeGrant: normalizeFleetGrant,
} = require('./fleet-runtime.cjs')
const {
  FRAME_SESSION_CONTROL,
  FRAME_VIDEO,
  SESSION_ID_PATTERN: REMOTE_SESSION_ID_PATTERN,
  connectRelaySession,
  createInputHelperClient,
  createInputRateLimiter,
  createRemoteSessionHostRuntime,
  createScreenCapture,
  createSessionIndicator,
  decodeStreamHeader,
  generateEphemeralKeyPair,
  normalizeRelayEndpoint,
  normalizeRemoteInputEvent,
  normalizeSessionKey,
  parseSessionControl,
  remoteError: remoteSessionError,
  resolveInputHelperPath,
  spawnInputHelper,
} = require('./remote-session-runtime.cjs')

const APP_URL_OVERRIDE = app.isPackaged
  ? null
  : normalizeAppUrl(process.env.STATSKEY_DESKTOP_URL)
const DESKTOP_SERVER_PORT = configuredDesktopPort()
const SUMMON_ACCELERATOR = 'CmdOrCtrl+Shift+Space'
const UPDATE_FEED_ROOT =
  'https://storage.googleapis.com/statskey-workbench-downloads/updates'
const DESKTOP_HEALTH_PATH = '/.well-known/statskey-desktop-health'
const MAX_WORKSPACE_FILE_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_MEDIA_BYTES = Math.floor(3.5 * 1024 * 1024)
const MAX_WORKSPACE_SYNC_FILE_BYTES = 25 * 1024 * 1024
const MAX_WORKSPACE_SEARCH_FILES = 12_000
const MAX_WORKSPACE_SEARCH_BYTES = 96 * 1024 * 1024
const DURABLE_RENDERER_STATE_FILES = new Map([
  ['statskey.agent.activeRuns.v2', ['active-agent-runs.json', 2 * 1024 * 1024]],
  ['statskey.cad.recoveryDocument.v1', ['cad-recovery-document.json', 8 * 1024 * 1024]],
  ['statskey.cad.session.v1', ['cad-session.json', 32 * 1024 * 1024]],
])
const PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'xai',
  'moonshot',
  'azure-openai',
  'aws-bedrock',
  'openai-compatible',
])
const PROVIDER_FIELDS = {
  anthropic: ['apiKey'],
  openai: ['apiKey', 'organization', 'project'],
  google: ['apiKey'],
  xai: ['apiKey'],
  moonshot: ['apiKey'],
  'azure-openai': ['apiKey', 'endpoint', 'deployment', 'apiVersion'],
  'aws-bedrock': ['accessKeyId', 'secretAccessKey', 'sessionToken', 'region', 'model'],
  'openai-compatible': ['apiKey', 'baseUrl', 'model'],
}
const PROVIDER_SECRET_FIELDS = new Set([
  'apiKey',
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
])
const PROVIDER_REQUIRED_FIELDS = {
  anthropic: ['apiKey'],
  openai: ['apiKey'],
  google: ['apiKey'],
  xai: ['apiKey'],
  moonshot: ['apiKey'],
  'azure-openai': ['apiKey', 'endpoint', 'deployment'],
  'aws-bedrock': ['accessKeyId', 'secretAccessKey', 'region', 'model'],
  'openai-compatible': ['baseUrl', 'model'],
}
const WORKSPACE_IGNORED_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'DerivedData',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
])

const trustedAppOrigins = new Set([
  'https://statskey.ai',
  'https://www.statskey.ai',
])

const trustedAuthOrigins = new Set([
  ...trustedAppOrigins,
  'https://statskey.firebaseapp.com',
  'https://statskey.web.app',
  'https://accounts.google.com',
  'https://appleid.apple.com',
  'https://login.microsoftonline.com',
])

let mainWindow = null
let lastNormalWindowBounds = null
let windowStateSaveTimer = null
let pendingProtocolUrl = null
// True while a reload (View menu or crash recovery) is what triggered the
// next unload, so the unsaved-changes dialog can offer Reload, not Close.
let mainWindowReloadRequested = false
// Menu commands are queued until the renderer signals it subscribed to
// 'statskey-desktop:menu-command'; commands sent before that were dropped.
let menuRendererReady = false
const pendingMenuCommands = []
// Auto-reload timestamps after renderer crashes, for crash-loop protection.
let rendererCrashReloads = []
const RENDERER_CRASH_RELOAD_LIMIT = 3
const RENDERER_CRASH_RELOAD_WINDOW_MS = 2 * 60 * 1000
const SAVE_ALL_ACK_TIMEOUT_MS = 10_000
let appUrl = null
let desktopAppOrigin = null
let bundledWebServer = null
let updateRuntime = null
let workspaceIndexWorker = null
let workspaceIndexTimer = null
let workspaceIndexInterval = null
let workspaceFileSearchWorker = null
let workspaceSyncRuntime = null
let fleetIdentityStore = null
let fleetNodeSupervisor = null
const fleetPairingApprovalRegistry = new FleetPairingApprovalRegistry()
let fleetNodeInitializationPromise = null
let fleetNodeInitializationGeneration = 0
let fleetNodeInitializationTimer = null
let fleetNodeInitializationFailures = 0
let fleetQuitReady = false
let fleetQuitPromise = null
let fleetShutdownStarted = false
let remoteSessionHostRuntime = null
const remoteViewerSessions = new Map()
const remoteSessionEphemerals = new Map()
let workspaceIndexStatus = {
  status: 'idle',
  indexedFiles: 0,
  rootCount: 0,
  updatedAt: null,
}
const workspaceIndexRequests = new Map()
const workspaceFileSearchRequests = new Map()
const workspaceRoots = []
const workspaceLooseFiles = new Set()
let importedWorkspace = null
const recentWorkspaces = []
const activeProviderRuns = new Map()
const pendingProviderRuns = []
const preparingProviderRuns = new Map()
const providerConfigurationReads = new Map()
let providerVaultMutationTail = Promise.resolve()
const integrationConfigurationReads = new Map()
let integrationVaultMutationTail = Promise.resolve()
const MAX_ACTIVE_PROVIDER_RUNS = 4
const MAX_PENDING_PROVIDER_RUNS = 64
const workspaceIndexEncryptionKey = createWorkspaceCacheKeyProvider()
const pendingDesktopApprovals = new Map()
const desktopOperationOrigin = new AsyncLocalStorage()
const workspaceBindingRuntime = new WorkspaceBindingRuntime({
  currentSnapshot: activeWorkspaceOperationSnapshot,
  lookupSnapshot: recentWorkspaceOperationSnapshot,
})
const localMcpManager = new LocalMcpManager()
const controlledBrowser = new ControlledBrowserRuntime({
  requestApproval: requestDesktopOperationApproval,
  onState(state) {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('statskey-desktop:browser-state', state)
  },
})
const controlledApplications = new ControlledApplicationsRuntime({
  requestApproval: requestDesktopOperationApproval,
})
const deviceControl = new DeviceControlRuntime({
  requestApproval: requestDesktopOperationApproval,
  runProcess: runBoundedChildProcess,
  validateArtifact: validateDeviceArtifact,
  validateMedia: validateDeviceMedia,
})
const terminalRuntime = new TerminalRuntime({
  emit(event) {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('statskey-desktop:terminal-event', event)
  },
  async onExit(sessionSnapshot, metadata) {
    if (sessionSnapshot.status === 'exited') scheduleWorkspaceIndex()
    const root =
      typeof metadata.root === 'string'
        ? canonicalExistingPath(metadata.root)
        : null
    if (!root || !statSync(root).isDirectory()) return
    await runWorkspaceHooks(
      'afterShellExecution',
      {
        command: sessionSnapshot.command,
        cwd: sessionSnapshot.cwd,
        exit_code: sessionSnapshot.exitCode,
        stdout: sessionSnapshot.output.slice(-20_000),
        stderr: '',
      },
      root,
      metadata.approvalMode
    )
  },
})
const providerVaultCrypto = new ProviderVaultCrypto({
  safeStorage,
  platform: process.platform,
})
const safeStorageCrypto = new SafeStorageCrypto({
  safeStorage,
  platform: process.platform,
})
const approvedMcpConfigurations = new Set()
const approvedHookConfigurations = new Set()
const workspaceIgnoreCache = new Map()

app.enableSandbox()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  const initialProtocolUrl = process.argv.find((arg) =>
    arg.startsWith('statskey-desktop://')
  )
  if (initialProtocolUrl) pendingProtocolUrl = initialProtocolUrl

  app.on('second-instance', (_event, commandLine) => {
    const protocolUrl = commandLine.find((arg) => arg.startsWith('statskey-desktop://'))
    if (protocolUrl) routeProtocolUrl(protocolUrl)
    focusMainWindow()
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  routeProtocolUrl(url)
})

function fleetArtifactSpoolRoot() {
  return path.join(app.getPath('userData'), 'fleet-artifact-spool')
}

function fleetWorkerQuarantinePath() {
  return path.join(app.getPath('userData'), 'fleet-worker-quarantine.json')
}

function currentSystemBootAt() {
  return Date.now() - Math.max(0, Number(os.uptime()) || 0) * 1_000
}

let cachedSystemBootId

function currentSystemBootId() {
  if (cachedSystemBootId !== undefined) return cachedSystemBootId
  try {
    let source
    if (process.platform === 'darwin') {
      source = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], {
        encoding: 'utf8',
        timeout: 2_000,
      })
    } else if (process.platform === 'linux') {
      source = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8')
    } else if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT
      if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
        throw new Error('Windows system root is unavailable.')
      }
      source = execFileSync(
        path.win32.join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        ),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToFileTimeUtc()',
        ],
        { encoding: 'utf8', timeout: 5_000, windowsHide: true }
      )
    }
    const normalized = String(source || '').trim()
    cachedSystemBootId = normalized
      ? createHash('sha256').update(normalized).digest('hex')
      : null
  } catch {
    cachedSystemBootId = null
  }
  return cachedSystemBootId
}

function fsyncFleetSafetyPath(filePath) {
  const descriptor = openSync(filePath, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function fsyncFleetSafetyDirectory(directory) {
  try {
    fsyncFleetSafetyPath(directory)
  } catch (error) {
    if (
      process.platform === 'win32' &&
      ['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'EPERM'].includes(error?.code)
    ) {
      // Windows does not expose a regular fsync handle for directories.
      return
    }
    throw error
  }
}

function loadActiveFleetWorkerQuarantine() {
  const filePath = fleetWorkerQuarantinePath()
  try {
    const stat = lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) {
      return { reason: 'quarantine-record-invalid' }
    }
    const record = JSON.parse(readFileSync(filePath, 'utf8'))
    if (
      record?.version !== 1 ||
      !['job-active', 'process-termination-unconfirmed'].includes(
        record.reason
      ) ||
      !/^job_[a-f0-9]{32,64}$/.test(String(record.jobId || '')) ||
      !Number.isFinite(Number(record.systemBootAt)) ||
      (record.systemBootId != null &&
        !/^[a-f0-9]{64}$/.test(String(record.systemBootId))) ||
      (record.systemUptimeSeconds != null &&
        !Number.isFinite(Number(record.systemUptimeSeconds)))
    ) {
      return { reason: 'quarantine-record-invalid' }
    }
    const currentUptime = Math.max(0, Number(os.uptime()) || 0)
    const bootId = currentSystemBootId()
    if (record.systemBootId && bootId) {
      if (record.systemBootId === bootId) return record
      unlinkSync(filePath)
      fsyncFleetSafetyDirectory(path.dirname(filePath))
      return null
    }
    const bootTimeMatches =
      Math.abs(currentSystemBootAt() - Number(record.systemBootAt)) < 5 * 60_000
    const uptimeDidNotReset =
      record.systemUptimeSeconds != null &&
      currentUptime + 1 >= Number(record.systemUptimeSeconds)
    if (bootTimeMatches || uptimeDidNotReset) {
      if (record.systemUptimeSeconds == null) {
        persistFleetWorkerQuarantine(record)
      }
      return record
    }
    unlinkSync(filePath)
    fsyncFleetSafetyDirectory(path.dirname(filePath))
    return null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return { reason: 'quarantine-record-unreadable' }
  }
}

function persistFleetWorkerQuarantine({ reason, jobId, attempt }) {
  if (
    !['job-active', 'process-termination-unconfirmed'].includes(reason) ||
    !/^job_[a-f0-9]{32,64}$/.test(String(jobId || ''))
  ) {
    throw new Error('Fleet worker safety marker is invalid.')
  }
  const filePath = fleetWorkerQuarantinePath()
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const record = {
    version: 1,
    reason,
    jobId,
    attempt: Number(attempt || 0),
    recordedAt: new Date().toISOString(),
    systemBootAt: currentSystemBootAt(),
    systemBootId: currentSystemBootId(),
    systemUptimeSeconds: Math.max(0, Number(os.uptime()) || 0),
  }
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  fsyncFleetSafetyPath(temporary)
  renameSync(temporary, filePath)
  chmodSync(filePath, 0o600)
  fsyncFleetSafetyPath(filePath)
  fsyncFleetSafetyDirectory(path.dirname(filePath))
}

function clearFleetWorkerQuarantine() {
  const filePath = fleetWorkerQuarantinePath()
  try {
    unlinkSync(filePath)
    fsyncFleetSafetyDirectory(path.dirname(filePath))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function surfaceFleetWorkerQuarantine(record) {
  console.error(
    'StatsKey Fleet worker is quarantined until this computer restarts.',
    record
  )
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'Fleet worker paused',
    body:
      'StatsKey exited during Fleet work or could not confirm process shutdown. Restart this computer before running more Fleet jobs.',
  })
  notification.on('click', () => focusMainWindow())
  notification.show()
}

async function surfaceRetainedFleetArtifacts() {
  const retained = await listArtifactSpool({
    artifactSpoolRoot: fleetArtifactSpoolRoot(),
  })
  if (retained.length === 0) return
  console.warn(
    `StatsKey Fleet retained ${retained.length} artifact archive(s) after publication failures.`
  )
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'Fleet evidence retained',
    body: `${retained.length} artifact archive${
      retained.length === 1 ? ' is' : 's are'
    } waiting for review on this computer.`,
  })
  notification.on('click', () => focusMainWindow())
  notification.show()
}

app.whenReady().then(async () => {
  app.setAppUserModelId('ai.statskey.desktop')
  app.setAsDefaultProtocolClient('statskey-desktop')

  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular')
    await app.dock.show()
    if (!app.isPackaged) {
      const iconPath = path.resolve(__dirname, 'assets', 'AppIcon-1024.png')
      if (existsSync(iconPath)) app.dock.setIcon(iconPath)
    }
  }

  appUrl = APP_URL_OVERRIDE || (await startBundledWebServer())
  const activeOrigin = new URL(appUrl).origin
  desktopAppOrigin = activeOrigin
  trustedAppOrigins.add(activeOrigin)
  trustedAuthOrigins.add(activeOrigin)

  restoreWorkspaceState()
  configurePermissions()
  installApplicationMenu()
  createMainWindow()
  initializeDesktopUpdates()
  initializeWorkspaceIndex()
  scheduleWorkspaceIndex(250)
  void initializeFleetNode().catch(handleFleetNodeInitializationFailure)
  void surfaceRetainedFleetArtifacts().catch((error) => {
    console.error('StatsKey Fleet artifact spool inspection failed:', error)
  })

  globalShortcut.register(SUMMON_ACCELERATOR, summonStatsKey)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    } else {
      focusMainWindow()
    }
  })
}).catch((error) => {
  console.error('StatsKey desktop failed to start:', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  for (const activeRun of activeProviderRuns.values()) activeRun.cancel()
  activeProviderRuns.clear()
  pendingProviderRuns.splice(0)
  for (const pending of pendingDesktopApprovals.values()) {
    clearTimeout(pending.timeout)
    pending.resolve(false)
  }
  pendingDesktopApprovals.clear()
  updateRuntime?.stop()
  if (workspaceIndexTimer) clearTimeout(workspaceIndexTimer)
  if (workspaceIndexInterval) clearInterval(workspaceIndexInterval)
  workspaceIndexWorker?.terminate()
  workspaceIndexWorker = null
  workspaceFileSearchWorker?.terminate()
  workspaceFileSearchWorker = null
  controlledBrowser.closeAll?.()
  deviceControl.closeAll?.()
  terminalRuntime.closeAll()
  for (const sessionId of [...remoteViewerSessions.keys()]) {
    closeRemoteViewerSession(sessionId)
  }
  workspaceSyncRuntime?.dispose()
  workspaceSyncRuntime = null
  void invalidateFleetNodeRuntime()
  fleetIdentityStore?.dispose()
  fleetIdentityStore = null
  void localMcpManager.closeAll()
})

app.on('before-quit', (event) => {
  fleetShutdownStarted = true
  bundledWebServer?.close()
  bundledWebServer = null
  if (fleetQuitReady) return
  event.preventDefault()
  if (!fleetQuitPromise) {
    fleetQuitPromise = invalidateFleetNodeRuntime()
      .catch((error) => {
        console.error('StatsKey Fleet shutdown failed:', error)
      })
      .finally(() => {
        fleetQuitReady = true
        app.quit()
      })
  }
})

ipcMain.on('statskey-desktop:retry', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    void loadStatsKey(mainWindow)
  }
})

ipcMain.on('statskey-desktop:menu-ready', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return
  menuRendererReady = true
  flushPendingMenuCommands()
})

ipcMain.on('statskey-desktop:set-badge', (event, count) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  if (process.platform === 'darwin') {
    app.dock.setBadge(n > 0 ? String(n) : '')
  } else if (process.platform === 'linux') {
    app.setBadgeCount(n)
  }
})

ipcMain.on('statskey-desktop:notify', (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return
  if (!Notification.isSupported()) return
  const title = typeof payload?.title === 'string' ? payload.title.slice(0, 120) : 'StatsKey'
  const body = typeof payload?.body === 'string' ? payload.body.slice(0, 240) : ''
  const notification = new Notification({ title, body, silent: false })
  notification.on('click', () => summonStatsKey())
  notification.show()
  if (process.platform === 'win32' && mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true)
    mainWindow.once('focus', () => mainWindow?.flashFrame(false))
  }
})

ipcMain.on('statskey-desktop:durable-state-get', (event, key) => {
  event.returnValue = isMainRenderer(event)
    ? readDurableRendererState(key)
    : null
})

ipcMain.on('statskey-desktop:durable-state-set', (event, key, value) => {
  event.returnValue =
    isMainRenderer(event) && writeDurableRendererState(key, value)
})

ipcMain.handle('statskey-desktop:updates-state', (event) => {
  if (!isMainRenderer(event)) return null
  return desktopUpdateState()
})

ipcMain.handle('statskey-desktop:updates-check', async (event) => {
  if (!isMainRenderer(event) || !updateRuntime) return desktopUpdateState()
  return updateRuntime.check(true)
})

ipcMain.handle('statskey-desktop:updates-download', async (event) => {
  if (!isMainRenderer(event) || !updateRuntime) return desktopUpdateState()
  return updateRuntime.download()
})

ipcMain.handle('statskey-desktop:updates-install', (event) => {
  if (!isMainRenderer(event) || !updateRuntime) return false
  return updateRuntime.install()
})

ipcMain.handle('statskey-desktop:updates-dismiss', (event) => {
  if (!isMainRenderer(event) || !updateRuntime) return desktopUpdateState()
  return updateRuntime.dismiss()
})

ipcMain.handle('statskey-desktop:fleet-identity-state', async (event) => {
  if (!isMainRenderer(event)) return null
  return getFleetIdentityStore().getPublicState()
})

ipcMain.handle(
  'statskey-desktop:fleet-identity-ensure',
  async (event, profile) => {
    if (!isMainRenderer(event)) return null
    await getFleetIdentityStore().ensure(profile)
    return getFleetIdentityStore().getPublicState()
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-identity-replace',
  async (event) => {
    if (!isMainRenderer(event)) return null
    const identity = await getFleetIdentityStore().load()
    if (!identity?.enrollment) {
      throw new Error('Only an enrolled Fleet identity can be replaced.')
    }
    const controllerLike = ['controller', 'hybrid'].includes(
      identity.profile.role
    )
    const approved = await confirmFleetIdentityUse({
      message: 'Prepare a replacement Fleet identity?',
      detail: [
        `Current device ID: ${identity.deviceId}`,
        `Current key: ${identity.publicKeyFingerprint}`,
        'This replaces the current private key in StatsKey identity storage.',
        controllerLike
          ? 'The new key remains untrusted until you complete controller recovery or pairing.'
          : 'The new key remains untrusted until an enrolled controller pairs it.',
        'Active local Fleet work stops immediately.',
      ].join('\n'),
    })
    if (!approved) return null
    await invalidateFleetNodeRuntime()
    try {
      await getFleetIdentityStore().replace(identity.profile)
      return getFleetIdentityStore().getPublicState()
    } catch (error) {
      const persisted = await getFleetIdentityStore().reload().catch(() => null)
      if (
        persisted?.deviceId === identity.deviceId &&
        persisted.publicKeyFingerprint === identity.publicKeyFingerprint &&
        persisted.enrollment?.ownerUid === identity.enrollment.ownerUid &&
        persisted.enrollment?.endpoint === identity.enrollment.endpoint &&
        persisted.enrollment?.coordinatorKeyId ===
          identity.enrollment.coordinatorKeyId &&
        persisted.enrollment?.coordinatorPublicKeySpki ===
          identity.enrollment.coordinatorPublicKeySpki
      ) {
        void initializeFleetNode().catch(() => {})
      }
      throw error
    }
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-bootstrap-create',
  async (event, input) => {
    if (!isMainRenderer(event)) return null
    const identity = await getFleetIdentityStore().load()
    if (!identity || !['controller', 'hybrid'].includes(identity.profile.role)) {
      throw new Error('Create a controller identity before starting Fleet.')
    }
    const ownerUid = String(input?.ownerUid || '').trim()
    if (
      ownerUid.length === 0 ||
      ownerUid.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(ownerUid)
    ) {
      throw new Error('The signed-in Fleet account is invalid.')
    }
    const authorization = {
      ownerUid,
      audience: 'statskey-workbench:fleet:v1',
    }
    const approved = await confirmFleetIdentityUse({
      message: 'Start this device as your Fleet controller?',
      detail: [
        `StatsKey account: ${ownerUid}`,
        `Device ID: ${identity.deviceId}`,
        `Key fingerprint: ${identity.publicKeyFingerprint}`,
        'This registers only the public key. The private key remains protected by this device.',
      ].join('\n'),
    })
    if (!approved) return null
    const device = {
      ...identity.profile,
      publicKeySpki: identity.publicKeySpki,
    }
    return {
      device,
      authorization,
      proof: createSignedDeviceRequest({
        privateKey: identity.privateKey,
        deviceId: identity.deviceId,
        action: 'pairing.bootstrap',
        payload: { device, authorization },
      }),
    }
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-controller-recovery-create',
  async (event, input) => {
    if (!isMainRenderer(event)) return null
    const identity = await getFleetIdentityStore().load()
    if (
      !identity ||
      identity.enrollment ||
      !['controller', 'hybrid'].includes(identity.profile.role)
    ) {
      throw new Error(
        'Create a new, unenrolled controller identity before recovery.'
      )
    }
    const ownerUid = String(input?.ownerUid || '').trim()
    const expectedControllerDeviceId = String(
      input?.expectedControllerDeviceId || ''
    ).trim()
    if (
      ownerUid.length === 0 ||
      ownerUid.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(ownerUid) ||
      !/^dev_[a-f0-9]{32}$/.test(expectedControllerDeviceId) ||
      expectedControllerDeviceId === identity.deviceId
    ) {
      throw new Error('The Fleet controller recovery request is invalid.')
    }
    const authorization = {
      ownerUid,
      audience: 'statskey-workbench:fleet-recovery:v1',
      expectedControllerDeviceId,
    }
    const approved = await confirmFleetIdentityUse({
      message: 'Replace the lost Fleet controller?',
      detail: [
        `StatsKey account: ${ownerUid}`,
        `Controller being replaced: ${expectedControllerDeviceId}`,
        `Replacement device: ${identity.deviceId}`,
        `Replacement key: ${identity.publicKeyFingerprint}`,
        'The old key is revoked immediately. Grants it issued stop authorizing new work or lease renewals.',
        'You must have signed in to StatsKey recently to complete this recovery.',
      ].join('\n'),
    })
    if (!approved) return null
    const device = {
      ...identity.profile,
      publicKeySpki: identity.publicKeySpki,
    }
    return {
      device,
      authorization,
      proof: createSignedDeviceRequest({
        privateKey: identity.privateKey,
        deviceId: identity.deviceId,
        action: 'controller.recover',
        payload: { device, authorization },
      }),
    }
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-pairing-create-receipt',
  async (event, input) => {
    if (!isMainRenderer(event)) return null
    const controller = await getFleetIdentityStore().load()
    if (
      !controller?.enrollment ||
      !['controller', 'hybrid'].includes(controller.profile.role)
    ) {
      throw new Error('This device is not a Fleet controller.')
    }
    // A hybrid candidate with worker mode disabled is a controller-only
    // device (for example a phone): it authorizes jobs but never executes
    // them, so the receipt carries no workspace, repository, or capability
    // scope and pairing creates no grant.
    if (isControllerCandidateProfile(input?.candidate?.profile)) {
      const receipt = createControllerPairingReceipt({
        candidate: input.candidate,
        ownerUid: controller.enrollment.ownerUid,
        controller: publicFleetDeviceIdentity(controller),
      })
      return fleetPairingApprovalRegistry.retainControllerApproval(
        receipt,
        controller.deviceId
      )
    }
    const receipt = createPairingReceipt({
      ...input,
      ownerUid: controller.enrollment.ownerUid,
      controller: publicFleetDeviceIdentity(controller),
    })
    return fleetPairingApprovalRegistry.retainWorkerApproval(
      receipt,
      controller.deviceId
    )
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-local-grant-create',
  async (event, input) => {
    if (!isMainRenderer(event)) return null
    const identity = await getFleetIdentityStore().load()
    if (
      !identity?.enrollment ||
      identity.profile.role !== 'hybrid' ||
      identity.profile.workerMode !== 'opt-in'
    ) {
      throw new Error('This device is not an enrolled opt-in hybrid worker.')
    }
    const now = Date.now()
    const normalized = normalizeFleetGrant(
      {
        id: `grant_${'0'.repeat(32)}`,
        ownerUid: identity.enrollment.ownerUid,
        controllerDeviceId: identity.deviceId,
        workerDeviceId: identity.deviceId,
        workspaceIds: input?.workspaceIds,
        repositoryIdentities: input?.repositoryIdentities,
        capabilities: input?.capabilities,
        unattended: input?.unattended === true,
        expiresAt: input?.expiresAt,
        policyVersion: input?.policyVersion,
      },
      { at: now }
    )
    const receipt = {
      deviceId: identity.deviceId,
      workspaceIds: normalized.workspaceIds,
      repositoryIdentities: normalized.repositoryIdentities,
      capabilities: normalized.capabilities,
      unattended: normalized.unattended,
      expiresAt: normalized.expiresAt,
      policyVersion: normalized.policyVersion,
    }
    const approved = await confirmFleetIdentityUse({
      message: 'Enable this computer for local Fleet jobs?',
      detail: [
        `Device ID: ${identity.deviceId}`,
        `Workspaces: ${receipt.workspaceIds.join(', ')}`,
        `Repositories: ${receipt.repositoryIdentities.join(', ')}`,
        `Capabilities: ${receipt.capabilities.join(', ')}`,
        `Unattended work: ${receipt.unattended ? 'Allowed' : 'Not allowed'}`,
        ...(receipt.capabilities.some((capability) =>
          ['terminal.run', 'windows.build'].includes(capability)
        )
          ? [
              'Host command access: approved programs run as this OS user; use a dedicated worker account.',
            ]
          : []),
        `Grant expires: ${new Date(receipt.expiresAt).toISOString()}`,
        `Policy version: ${receipt.policyVersion}`,
      ].join('\n'),
    })
    if (!approved) return null
    return {
      receipt,
      proof: createSignedDeviceRequest({
        privateKey: identity.privateKey,
        deviceId: identity.deviceId,
        action: 'grant.local',
        payload: receipt,
      }),
    }
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-job-authorize',
  async (event, input) => {
    if (!isMainRenderer(event)) return null
    const identity = await getFleetIdentityStore().load()
    if (
      !identity?.enrollment ||
      !['controller', 'hybrid'].includes(identity.profile.role)
    ) {
      throw new Error(
        'This computer must be an enrolled Fleet controller to authorize jobs.'
      )
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.hasOwn(input, 'controllerAuthorization')
    ) {
      throw new Error('The Fleet job authorization request is invalid.')
    }
    const normalizedJob = normalizeFleetCreateJob(input, {
      ownerUid: identity.enrollment.ownerUid,
      at: Date.now(),
    })
    const approved = await confirmFleetIdentityUse({
      message: 'Authorize this exact Fleet job?',
      detail: fleetJobAuthorizationDetail(normalizedJob),
    })
    if (!approved) return null
    const payload = {
      ownerUid: identity.enrollment.ownerUid,
      job: input,
    }
    return {
      controllerDeviceId: identity.deviceId,
      proof: createSignedDeviceRequest({
        privateKey: identity.privateKey,
        deviceId: identity.deviceId,
        action: 'job.authorize',
        payload,
      }),
    }
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-pairing-sign',
  async (event, receipt, action) => {
    if (!isMainRenderer(event)) return null
    const identity = await getFleetIdentityStore().load()
    if (!identity) throw new Error('Create a Fleet identity before pairing.')
    if (
      action === 'pairing.approve' &&
      (
        !identity.enrollment ||
        identity.enrollment.ownerUid !== receipt?.ownerUid ||
        !['controller', 'hybrid'].includes(identity.profile.role)
      )
    ) {
      throw new Error(
        'Only the enrolled Fleet controller for this account can approve pairing.'
      )
    }
    const validated = validatePairingSigner({
      identity,
      receipt,
      action,
    })
    const claim =
      action === 'pairing.approve'
        ? fleetPairingApprovalRegistry.beginWorkerApproval(
            validated.normalizedReceipt,
            identity.deviceId
          )
        : null
    try {
      const approved = await confirmFleetIdentityUse({
        message:
          action === 'pairing.approve'
            ? 'Approve this device for Fleet work?'
            : 'Confirm this device pairing request?',
        detail: fleetPairingConfirmationDetail(validated.normalizedReceipt),
      })
      if (!approved) return null
      return signPairingReceipt({ identity, receipt, action })
    } finally {
      if (claim) fleetPairingApprovalRegistry.finishWorkerApproval(claim)
    }
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-identity-mark-enrolled',
  async (event, enrollment) => {
    if (!isMainRenderer(event)) return null
    const identity = await getFleetIdentityStore().load()
    if (!identity) throw new Error('Create a Fleet identity before enrollment.')
    const endpoint = trustedFleetDeviceEndpoint(enrollment?.endpoint)
    const transport = createFleetDeviceTransport({
      endpoint,
      privateKey: identity.privateKey,
      deviceId: identity.deviceId,
      allowLoopback: !app.isPackaged,
      coordinatorKeyId: enrollment?.coordinatorKeyId,
      coordinatorPublicKeySpki: enrollment?.coordinatorPublicKeySpki,
    })
    const verified = await transport('device.status', {})
    if (
      verified?.status !== 'active' ||
      verified.deviceId !== identity.deviceId ||
      verified.publicKeyFingerprint !== identity.publicKeyFingerprint ||
      verified.ownerUid !== enrollment?.ownerUid
    ) {
      throw new Error('Fleet enrollment could not be verified.')
    }
    const state = await getFleetIdentityStore().markEnrolled({
      ownerUid: verified.ownerUid,
      endpoint,
      coordinatorKeyId: enrollment?.coordinatorKeyId,
      coordinatorPublicKeySpki: enrollment?.coordinatorPublicKeySpki,
    })
    await initializeFleetNode({
      restart: true,
      verifiedIdentityFingerprint: identity.publicKeyFingerprint,
    })
    return state
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-artifact-download',
  async (event, grant) => {
    if (!isMainRenderer(event) || !mainWindow || mainWindow.isDestroyed()) {
      return false
    }
    const download = validateFleetArtifactDownloadGrant(grant)
    mainWindow.webContents.downloadURL(download.url)
    return true
  }
)

ipcMain.handle('statskey-desktop:fleet-artifact-spool-list', async (event) => {
  if (!isMainRenderer(event)) return []
  return listArtifactSpool({
    artifactSpoolRoot: fleetArtifactSpoolRoot(),
  })
})

ipcMain.handle(
  'statskey-desktop:fleet-artifact-spool-reveal',
  async (event, input) => {
    if (!isMainRenderer(event)) return false
    const archivePath = await revealArtifactSpoolEntry({
      artifactSpoolRoot: fleetArtifactSpoolRoot(),
      spoolId: input?.spoolId,
      kind: input?.kind,
    })
    shell.showItemInFolder(archivePath)
    return true
  }
)

ipcMain.handle(
  'statskey-desktop:fleet-artifact-spool-purge',
  async (event, input) => {
    if (!isMainRenderer(event) || !mainWindow || mainWindow.isDestroyed()) {
      return false
    }
    const retained = await listArtifactSpool({
      artifactSpoolRoot: fleetArtifactSpoolRoot(),
    })
    const selected = retained.find(
      (entry) => entry.spoolId === input?.spoolId
    )
    if (!selected) return false
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Keep Evidence', 'Delete Evidence'],
      defaultId: 0,
      cancelId: 0,
      message: 'Delete this retained Fleet evidence?',
      detail: [
        `Job: ${selected.jobId}`,
        `Artifact: ${selected.kind}`,
        `Size: ${selected.sizeBytes} bytes`,
        'This local archive cannot be recovered after deletion.',
      ].join('\n'),
    })
    if (confirmation.response !== 1) return false
    return purgeArtifactSpoolEntry({
      artifactSpoolRoot: fleetArtifactSpoolRoot(),
      spoolId: selected.spoolId,
    })
  }
)

// ---------------------------------------------------------------------------
// Fleet Remote Session. The main process owns every relay connection; the
// renderer never touches the socket. Video frames and session state flow to
// the renderer over IPC; input events are validated and rate-limited here
// before they are encrypted for the host.
// ---------------------------------------------------------------------------

function remoteViewerStatePayload(record) {
  return {
    sessionId: record.sessionId,
    state: record.state,
    paired: record.client?.paired === true,
    header: record.header || null,
    error: record.error || null,
  }
}

function sendRemoteViewerState(record) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isDestroyed()
  ) {
    return
  }
  mainWindow.webContents.send(
    'statskey-desktop:remote-session-state',
    remoteViewerStatePayload(record)
  )
}

function closeRemoteViewerSession(sessionId) {
  const record = remoteViewerSessions.get(sessionId)
  if (!record) return false
  remoteViewerSessions.delete(sessionId)
  try {
    record.client?.close()
  } catch {}
  return true
}

ipcMain.handle(
  'statskey-desktop:remote-session-prepare-request',
  async (event) => {
    if (!isMainRenderer(event)) return null
    const ephemeral = generateEphemeralKeyPair()
    if (remoteSessionEphemerals.size >= 64) {
      const oldest = remoteSessionEphemerals.keys().next().value
      remoteSessionEphemerals.delete(oldest)
    }
    remoteSessionEphemerals.set(ephemeral.publicKeySpki, ephemeral)
    return { controllerEphemeralKey: ephemeral.publicKeySpki }
  }
)

ipcMain.handle(
  'statskey-desktop:remote-session-connect',
  async (event, input) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    const sessionId = String(input?.sessionId || '')
    try {
      if (!REMOTE_SESSION_ID_PATTERN.test(sessionId)) {
        throw remoteSessionError('invalid_session', 'Invalid remote session.')
      }
      if (remoteViewerSessions.has(sessionId)) {
        return { ok: true }
      }
      const identity = await getFleetIdentityStore().load()
      if (
        !identity?.enrollment ||
        !['controller', 'hybrid'].includes(identity.profile.role)
      ) {
        throw remoteSessionError(
          'not_controller',
          'This device is not an enrolled Fleet controller.'
        )
      }
      const relayEndpoint = normalizeRelayEndpoint(input?.relayEndpoint)
      const sessionKey = normalizeSessionKey(input?.sessionKey)
      normalizePublicKeySpki(String(input?.controllerEphemeralKey || ''))
      const capabilities = Array.isArray(input?.capabilities)
        ? input.capabilities.filter((capability) =>
            ['screen.view', 'screen.input'].includes(capability)
          )
        : []
      if (!capabilities.includes('screen.view')) {
        throw remoteSessionError(
          'invalid_session',
          'The remote session capabilities are invalid.'
        )
      }
      const registered = remoteSessionEphemerals.get(
        String(input?.controllerEphemeralKey || '')
      )
      const ephemeral = registered || generateEphemeralKeyPair()
      const record = {
        sessionId,
        state: 'connecting',
        client: null,
        header: null,
        error: null,
        capabilities,
        rateLimiter: createInputRateLimiter({}),
      }
      remoteViewerSessions.set(sessionId, record)
      const { client, ready } = connectRelaySession({
        endpoint: relayEndpoint,
        privateKey: identity.privateKey,
        publicKeySpki: identity.publicKeySpki,
        ephemeralPublicKey: ephemeral.publicKeySpki,
        sessionId,
        role: 'viewer',
        sessionKey,
        onFrame: (type, plaintext) => {
          if (type === FRAME_VIDEO) {
            if (
              mainWindow &&
              !mainWindow.isDestroyed() &&
              !mainWindow.webContents.isDestroyed()
            ) {
              mainWindow.webContents.send(
                'statskey-desktop:remote-session-frame',
                { sessionId, jpeg: plaintext }
              )
            }
            return
          }
          if (type !== FRAME_SESSION_CONTROL) return
          try {
            const control = parseSessionControl(plaintext)
            if (control?.type === 'stream.header') {
              record.header = decodeStreamHeader(control)
              record.state = 'active'
              sendRemoteViewerState(record)
            }
          } catch {}
        },
        onPaired: () => {
          record.state = record.header ? 'active' : 'waiting'
          sendRemoteViewerState(record)
        },
        onControl: (control) => {
          if (control?.type === 'error') {
            record.state = 'failed'
            record.error = String(control.code || 'relay_error').slice(0, 64)
            sendRemoteViewerState(record)
          }
        },
        onClose: () => {
          if (record.state !== 'failed') {
            record.state = 'closed'
            sendRemoteViewerState(record)
          }
        },
      })
      record.client = client
      await ready
      record.state = 'waiting'
      sendRemoteViewerState(record)
      return { ok: true }
    } catch (error) {
      remoteViewerSessions.delete(sessionId)
      const code = typeof error?.code === 'string' ? error.code : 'failed'
      return { ok: false, error: code }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:remote-session-input',
  (event, sessionId, inputEvent) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    const record = remoteViewerSessions.get(String(sessionId || ''))
    if (!record?.client || record.state !== 'active' || !record.header) {
      return { ok: false, error: 'not_active' }
    }
    if (!record.capabilities.includes('screen.input')) {
      return { ok: false, error: 'view_only' }
    }
    try {
      const command = normalizeRemoteInputEvent(inputEvent, {
        width: record.header.width,
        height: record.header.height,
      })
      if (!record.rateLimiter.allow()) {
        return { ok: false, error: 'rate_limited' }
      }
      record.client.sendInput(command)
      return { ok: true }
    } catch {
      return { ok: false, error: 'invalid_input' }
    }
  }
)

ipcMain.handle('statskey-desktop:remote-session-end', (event, sessionId) => {
  if (!isMainRenderer(event)) return false
  return closeRemoteViewerSession(String(sessionId || ''))
})

ipcMain.handle('statskey-desktop:remote-session-state', (event, sessionId) => {
  if (!isMainRenderer(event)) return null
  const record = remoteViewerSessions.get(String(sessionId || ''))
  return record ? remoteViewerStatePayload(record) : null
})

// The host side of a remote session runs on this device when it is an
// enrolled worker: it polls the control plane, approves sessions under the
// Fleet consent model, streams the screen, and injects validated input.
function startRemoteSessionHostRuntime(identity, postAction) {
  if (remoteSessionHostRuntime) return
  if (process.platform === 'linux') return
  const runtime = createRemoteSessionHostRuntime({
    postAction,
    deviceId: identity.deviceId,
    privateKey: identity.privateKey,
    publicKeySpki: identity.publicKeySpki,
    platform: process.platform,
    electron: { BrowserWindow, desktopCapturer, screen },
    captureFactory: ({ electron: captureElectron, onFrame, onReady }) =>
      createScreenCapture({
        BrowserWindow: captureElectron.BrowserWindow,
        desktopCapturer: captureElectron.desktopCapturer,
        screen: captureElectron.screen,
        ipcMain,
        onFrame,
        onReady,
        onError: (message) => {
          console.error('[remote-session] capture error:', message)
        },
      }),
    inputClientFactory:
      process.platform === 'win32'
        ? () => {
            const helperPath = resolveInputHelperPath({
              resourcesPath: process.resourcesPath,
            })
            if (!existsSync(helperPath)) return null
            try {
              spawnInputHelper({ helperPath })
            } catch (error) {
              console.error('[remote-session] input helper failed to start:', error)
              return null
            }
            return createInputHelperClient({})
          }
        : null,
    indicatorFactory: ({ sessionId }) =>
      createSessionIndicator({ BrowserWindow, sessionId }),
    logger: console,
  })
  remoteSessionHostRuntime = runtime
  runtime.start()
}

ipcMain.handle('statskey-desktop:open-external', async (event, candidate) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false
  if (!isApprovedExternalAuthorization(candidate)) return false
  await shell.openExternal(new URL(candidate).toString())
  return true
})

ipcMain.handle(
  'statskey-desktop:browser-open',
  async (event, candidate, approvalMode, origin, options) => {
    if (!isMainRenderer(event)) {
      return { ok: false, error: 'Unavailable.' }
    }
    const result = await withDesktopOperationOrigin(origin, () =>
      controlledBrowser.open(candidate, approvalMode, origin, options)
    )
    return flattenBrowserSnapshotResult(result)
  }
)

ipcMain.handle('statskey-desktop:browser-list', (event, origin) => {
  if (!isMainRenderer(event)) return { tabs: [], activeTabId: null }
  const state = controlledBrowser.state(origin)
  return {
    tabs: Array.isArray(state?.tabs) ? state.tabs : [],
    activeTabId: state?.activeTabId ?? null,
  }
})

ipcMain.handle('statskey-desktop:browser-activate', async (event, tabId) => {
  if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
  if (!controlledBrowser.activate(tabId)) {
    return { ok: false, error: 'That browser tab is unavailable.' }
  }
  try {
    return await controlledBrowser.snapshot(tabId)
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
})

ipcMain.handle(
  'statskey-desktop:browser-navigate',
  async (event, tabId, navigation, approvalMode, origin) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    const result = await withDesktopOperationOrigin(origin, () =>
      controlledBrowser.navigate(tabId, navigation, approvalMode, origin)
    )
    return flattenBrowserSnapshotResult(result)
  }
)

ipcMain.handle('statskey-desktop:browser-snapshot', async (event, tabId, origin) => {
  if (!isMainRenderer(event)) {
    return { ok: false, error: 'Unavailable.' }
  }
  try {
    return await controlledBrowser.snapshot(tabId, origin)
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
})

ipcMain.handle(
  'statskey-desktop:browser-action',
  async (event, action, approvalMode, origin) => {
    if (!isMainRenderer(event)) {
      return { ok: false, error: 'Unavailable.' }
    }
    const result = await withDesktopOperationOrigin(origin, () =>
      controlledBrowser.act(action, approvalMode, origin)
    )
    return flattenBrowserSnapshotResult(result)
  }
)

ipcMain.handle('statskey-desktop:browser-screenshot', async (event, tabId, origin) => {
  if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
  try {
    const result = await controlledBrowser.screenshot(tabId, origin)
    return result?.mimeType && !result.mediaType
      ? { ...result, mediaType: result.mimeType }
      : result
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
})

ipcMain.handle('statskey-desktop:browser-close', (event, tabId, origin) => {
  if (!isMainRenderer(event)) return false
  return controlledBrowser.close(tabId, origin)
})

function flattenBrowserSnapshotResult(result) {
  if (!result || typeof result !== 'object' || !result.snapshot) return result
  return {
    ...result.snapshot,
    ok: result.ok === true,
    cancelled: result.cancelled === true || undefined,
    error: result.error,
    tabId: result.tabId || result.snapshot.tabId,
  }
}

ipcMain.handle('statskey-desktop:applications-list', (event) => {
  if (!isMainRenderer(event)) return []
  return controlledApplications.list()
})

ipcMain.handle(
  'statskey-desktop:applications-open',
  async (event, applicationName, approvalMode, origin) => {
    if (!isMainRenderer(event)) {
      return { ok: false, error: 'Unavailable.' }
    }
    return withDesktopOperationOrigin(origin, () =>
      controlledApplications.open(applicationName, approvalMode)
    )
  }
)

ipcMain.handle(
  'statskey-desktop:devices-list',
  async (event, binding, origin) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, async () => {
      try {
        assertCurrentWorkspaceBinding(binding)
        const result = await deviceControl.list(origin)
        assertCurrentWorkspaceBinding(binding)
        return result
      } catch (error) {
        return { ok: false, error: safeProviderError(error) }
      }
    }, binding)
  }
)

ipcMain.handle(
  'statskey-desktop:devices-act',
  async (event, request, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, async () => {
      try {
        assertCurrentWorkspaceBinding(binding)
        const result = await deviceControl.act(
          request,
          approvalMode,
          origin,
          () => assertCurrentWorkspaceBinding(binding)
        )
        assertCurrentWorkspaceBinding(binding)
        return result
      } catch (error) {
        return { ok: false, error: safeProviderError(error) }
      }
    }, binding)
  }
)

ipcMain.handle(
  'statskey-desktop:open-calendar-file',
  async (event, contents, requestedName) => {
    if (!isMainRenderer(event)) {
      return { ok: false, error: 'Unavailable.' }
    }
    if (!isPortableCalendarContents(contents)) {
      return { ok: false, error: 'Invalid calendar event.' }
    }
    try {
      const filePath = writeTemporaryCalendarFile(contents, requestedName)
      const openError = await shell.openPath(filePath)
      if (openError) {
        unlinkSync(filePath)
        return { ok: false, error: 'No calendar application could open this event.' }
      }
      scheduleTemporaryCalendarCleanup(filePath)
      return { ok: true }
    } catch {
      return { ok: false, error: 'StatsKey could not open the calendar event.' }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:share-calendar-file',
  async (event, contents, requestedName, description) => {
    if (!isMainRenderer(event)) {
      return { ok: false, error: 'Unavailable.' }
    }
    if (!isPortableCalendarContents(contents)) {
      return { ok: false, error: 'Invalid calendar event.' }
    }
    let filePath = null
    try {
      filePath = writeTemporaryCalendarFile(contents, requestedName)
      const text = typeof description === 'string'
        ? description.replace(/\0/g, '').slice(0, 4_000)
        : ''
      if (process.platform !== 'darwin' || typeof ShareMenu !== 'function') {
        shell.showItemInFolder(filePath)
        const mailto = new URL('mailto:')
        mailto.searchParams.set(
          'subject',
          `Calendar event: ${String(requestedName || 'Event').slice(0, 160)}`
        )
        mailto.searchParams.set(
          'body',
          `${text}${text ? '\n\n' : ''}Attach the highlighted .ics file to this message.`
        )
        await shell.openExternal(mailto.toString())
        scheduleTemporaryCalendarCleanup(filePath)
        return { ok: true, needsAttachment: true }
      }
      const shareMenu = new ShareMenu({
        filePaths: [filePath],
        ...(text ? { texts: [text] } : {}),
      })
      await new Promise((resolve) => {
        shareMenu.popup({
          browserWindow: mainWindow || undefined,
          callback: resolve,
        })
      })
      scheduleTemporaryCalendarCleanup(filePath)
      return { ok: true }
    } catch {
      if (filePath) {
        try {
          unlinkSync(filePath)
        } catch {
          // The file may already have been handed off to the sharing service.
        }
      }
      return { ok: false, error: 'StatsKey could not share the calendar event.' }
    }
  }
)

function isPortableCalendarContents(contents) {
  return (
    typeof contents === 'string' &&
    Buffer.byteLength(contents, 'utf8') <= 256 * 1024 &&
    contents.startsWith('BEGIN:VCALENDAR\r\n') &&
    contents.endsWith('END:VCALENDAR\r\n') &&
    !contents.includes('\0')
  )
}

function writeTemporaryCalendarFile(contents, requestedName) {
  const directory = path.join(app.getPath('temp'), 'StatsKey Calendar')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const safeName = String(requestedName || 'calendar-event')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 _.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'calendar-event'
  const fingerprint = createHash('sha256')
    .update(contents)
    .update(String(Date.now()))
    .digest('hex')
    .slice(0, 12)
  const filePath = path.join(directory, `${fingerprint}-${safeName}.ics`)
  writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o600 })
  return filePath
}

function scheduleTemporaryCalendarCleanup(filePath) {
  const cleanup = setTimeout(() => {
    try {
      unlinkSync(filePath)
    } catch {
      // The operating system may already have moved or removed the file.
    }
  }, 60 * 60 * 1000)
  cleanup.unref()
}

ipcMain.handle('statskey-desktop:workspace-state', (event, binding) => {
  if (!isMainRenderer(event)) return null
  return withWorkspaceOperationBinding(binding, () => {
    assertCurrentWorkspaceBinding(binding)
    return workspaceSnapshot()
  })
})

ipcMain.handle('statskey-desktop:workspace-recents', (event) => {
  if (!isMainRenderer(event)) return []
  return recentWorkspaces.map(publicRecentWorkspace)
})

ipcMain.handle('statskey-desktop:workspace-import-cursor', (event) => {
  if (!isMainRenderer(event)) {
    return { ok: false, error: 'Cursor workspace import is unavailable.' }
  }
  return importCursorWorkspaceCatalog()
})

ipcMain.handle(
  'statskey-desktop:workspace-open-recent',
  async (event, workspaceId) => {
    if (!isMainRenderer(event)) return null
    return openRecentWorkspace(workspaceId)
  }
)

ipcMain.handle('statskey-desktop:workspace-save-current', (event, name) => {
  if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
  return saveCurrentWorkspace(name)
})

ipcMain.handle(
  'statskey-desktop:workspace-rename-recent',
  (event, workspaceId, name) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return renameRecentWorkspace(workspaceId, name)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-remove-recent',
  (event, workspaceId) => {
    if (!isMainRenderer(event)) return false
    return removeRecentWorkspace(workspaceId)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-remove-root',
  async (event, rootPath) => {
    if (!isMainRenderer(event)) return null
    return removeWorkspaceRoot(rootPath)
  }
)

ipcMain.handle('statskey-desktop:workspace-close', async (event) => {
  if (!isMainRenderer(event)) return null
  workspaceRoots.length = 0
  workspaceLooseFiles.clear()
  importedWorkspace = null
  saveWorkspaceState()
  scheduleWorkspaceIndex(0)
  return workspaceSnapshot()
})

ipcMain.handle('statskey-desktop:workspace-choose-folder', async (event) => {
  if (!isMainRenderer(event) || !mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add workspace folders',
    buttonLabel: 'Add folders',
    properties: ['openDirectory', 'multiSelections'],
    securityScopedBookmarks: process.platform === 'darwin',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  for (const candidate of result.filePaths) {
    const selected = canonicalExistingPath(candidate)
    if (
      selected &&
      statSync(selected).isDirectory() &&
      !workspaceRoots.includes(selected)
    ) {
      workspaceRoots.push(selected)
    }
  }
  saveWorkspaceState()
  scheduleWorkspaceIndex()
  return workspaceSnapshot()
})

ipcMain.handle(
  'statskey-desktop:workspace-create-from-folders',
  async (event) => {
    if (!isMainRenderer(event) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add a workspace',
      message: 'Choose one or more folders to keep together as a workspace.',
      buttonLabel: 'Add workspace',
      properties: ['openDirectory', 'multiSelections'],
      securityScopedBookmarks: process.platform === 'darwin',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selected = [...new Set(
      result.filePaths
        .map(canonicalExistingPath)
        .filter(
          (candidate) =>
            candidate && statSync(candidate).isDirectory()
        )
    )]
    if (selected.length === 0) return null
    workspaceRoots.splice(0, workspaceRoots.length, ...selected)
    workspaceLooseFiles.clear()
    importedWorkspace = null
    saveWorkspaceState()
    saveCurrentWorkspace(defaultWorkspaceLabel(selected))
    scheduleWorkspaceIndex(0)
    return workspaceSnapshot()
  }
)

ipcMain.handle('statskey-desktop:workspace-open-project', async (event) => {
  if (!isMainRenderer(event) || !mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a project folder',
    buttonLabel: 'Open project',
    properties: ['openDirectory'],
    securityScopedBookmarks: process.platform === 'darwin',
  })
  if (result.canceled || result.filePaths.length !== 1) return null
  const selected = canonicalExistingPath(result.filePaths[0])
  if (!selected || !statSync(selected).isDirectory()) return null
  return activateWorkspaceRoot(selected)
})

ipcMain.handle(
  'statskey-desktop:workspace-open-statskey-source',
  async (event) => {
    if (!isMainRenderer(event) || !mainWindow) {
      return { ok: false, error: 'Unavailable.' }
    }
    const home = app.getPath('home')
    const source = findStatsKeySource([
      process.env.STATSKEY_SOURCE_DIR,
      ...workspaceRoots,
      ...recentWorkspaces.flatMap((workspace) => workspace.roots || []),
      app.isPackaged ? null : path.resolve(__dirname, '..'),
      process.cwd(),
      path.join(home, 'Projects', 'StatsKey Website'),
      path.join(home, 'Projects', 'StatsKey'),
      path.join(home, 'Developer', 'StatsKey Website'),
      path.join(home, 'Developer', 'StatsKey'),
      path.join(home, 'Documents', 'StatsKey Website'),
    ])
    if (source) {
      return {
        ok: true,
        source,
        workspace: activateWorkspaceRoot(source.rootPath),
      }
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the StatsKey source checkout',
      message:
        'Choose the folder containing desktop/package.json and src/app.',
      buttonLabel: 'Edit StatsKey',
      properties: ['openDirectory'],
      securityScopedBookmarks: process.platform === 'darwin',
    })
    if (result.canceled || result.filePaths.length !== 1) {
      return { ok: false, cancelled: true }
    }
    const chosen = inspectStatsKeySource(result.filePaths[0])
    if (!chosen) {
      return {
        ok: false,
        error:
          'That folder is not a StatsKey Desktop source checkout. Choose the project folder containing desktop/package.json and src/app.',
      }
    }
    return {
      ok: true,
      source: chosen,
      workspace: activateWorkspaceRoot(chosen.rootPath),
    }
  }
)

ipcMain.handle('statskey-desktop:workspace-create-project', async (event) => {
  if (!isMainRenderer(event) || !mainWindow) {
    return { ok: false, error: 'Unavailable.' }
  }
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Create a project folder',
      buttonLabel: 'Create project',
      defaultPath: path.join(app.getPath('documents'), 'Untitled Project'),
      showsTagField: false,
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true }
    }
    const target = path.resolve(result.filePath)
    const parent = canonicalExistingPath(path.dirname(target))
    if (!parent || !statSync(parent).isDirectory()) {
      throw new Error('Choose an available parent folder.')
    }
    if (existsSync(target) && !statSync(target).isDirectory()) {
      throw new Error('A file already uses that project name.')
    }
    mkdirSync(target, { recursive: true, mode: 0o700 })
    const selected = canonicalExistingPath(target)
    if (!selected) throw new Error('The project folder could not be opened.')
    workspaceRoots.splice(0, workspaceRoots.length, selected)
    workspaceLooseFiles.clear()
    importedWorkspace = null
    saveWorkspaceState()
    scheduleWorkspaceIndex(0)
    return { ok: true, workspace: workspaceSnapshot() }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
})

ipcMain.handle(
  'statskey-desktop:workspace-create-project-in-root',
  async (event, rawName) => {
    if (!isMainRenderer(event) || !mainWindow) {
      return { ok: false, error: 'Unavailable.' }
    }
    try {
      const created = createProjectInDefaultRoot({
        homeDirectory: app.getPath('home'),
        name: rawName,
      })
      if (!created.ok) return { ok: false, error: created.error }
      const selected = canonicalExistingPath(created.path)
      if (!selected) throw new Error('The project folder could not be opened.')
      workspaceRoots.splice(0, workspaceRoots.length, selected)
      workspaceLooseFiles.clear()
      importedWorkspace = null
      saveWorkspaceState()
      scheduleWorkspaceIndex(0)
      return { ok: true, workspace: workspaceSnapshot() }
    } catch (error) {
      return { ok: false, error: safeProviderError(error) }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-clone-project',
  async (event, repositoryUrl) => {
    if (!isMainRenderer(event) || !mainWindow) {
      return { ok: false, error: 'Unavailable.' }
    }
    return cloneWorkspaceProject(repositoryUrl)
  }
)

ipcMain.handle('statskey-desktop:workspace-import-file', async (event) => {
  if (!isMainRenderer(event) || !mainWindow) {
    return { ok: false, error: 'Workspace import is unavailable.' }
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import a workspace',
    message:
      'Choose a workspace definition or an exported multi-folder workspace file.',
    buttonLabel: 'Import workspace',
    properties: ['openFile'],
    filters: [
      { name: 'Workspace files', extensions: ['code-workspace', 'json'] },
      { name: 'All files', extensions: ['*'] },
    ],
    securityScopedBookmarks: process.platform === 'darwin',
  })
  if (result.canceled || result.filePaths.length !== 1) {
    return { ok: false, cancelled: true }
  }
  try {
    return {
      ok: true,
      workspace: importWorkspaceFile(result.filePaths[0]),
    }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
})

ipcMain.handle('statskey-desktop:workspace-add-files', async (event) => {
  if (!isMainRenderer(event) || !mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add files to StatsKey',
    buttonLabel: 'Add files',
    properties: ['openFile', 'multiSelections'],
    securityScopedBookmarks: process.platform === 'darwin',
  })
  if (result.canceled) return workspaceSnapshot()
  const beforeCount = workspaceLooseFiles.size
  for (const candidate of result.filePaths) {
    const selected = canonicalExistingPath(candidate)
    if (selected && statSync(selected).isFile()) workspaceLooseFiles.add(selected)
  }
  saveWorkspaceState()
  if (workspaceLooseFiles.size !== beforeCount) scheduleWorkspaceIndex(0)
  return workspaceSnapshot()
})

ipcMain.handle('statskey-desktop:workspace-list', (event, directoryPath) => {
  if (!isMainRenderer(event)) return []
  return listWorkspaceDirectory(directoryPath)
})

ipcMain.handle('statskey-desktop:workspace-read', async (event, filePath, runHooks, binding) => {
  if (!isMainRenderer(event)) return null
  return withWorkspaceOperationBinding(binding, async () => {
    assertCurrentWorkspaceBinding(binding)
    try {
      const resolved = canonicalExistingPath(filePath)
      const root = resolved ? workspaceRootForPath(resolved) : null
      if (root && runHooks === true) {
        await runWorkspaceHooks(
          'beforeReadFile',
          { file_path: resolved },
          root,
          'auto'
        )
      }
      assertCurrentWorkspaceBinding(binding)
      return readWorkspaceFile(filePath)
    } catch (error) {
      if (binding !== undefined && binding !== null) throw error
      return null
    }
  })
})

ipcMain.handle('statskey-desktop:workspace-read-media', (event, filePath, binding) => {
  if (!isMainRenderer(event)) return null
  return withWorkspaceOperationBinding(binding, () => {
    assertCurrentWorkspaceBinding(binding)
    return readWorkspaceMedia(filePath)
  })
})

ipcMain.handle('statskey-desktop:workspace-search', async (event, query, binding) => {
  if (!isMainRenderer(event)) return []
  return withWorkspaceOperationBinding(binding, () => {
    assertCurrentWorkspaceBinding(binding)
    // This path intentionally bypasses the asynchronous index. Agent file access
    // must remain usable while an index is cold, stale, rebuilding, or missing a
    // newly-created file. The scanner enforces the same bound-root boundary and
    // ignore rules as indexed search.
    const results = searchWorkspace(query)
    assertCurrentWorkspaceBinding(binding)
    return results
  })
})

ipcMain.handle('statskey-desktop:workspace-index-state', (event) => {
  if (!isMainRenderer(event)) return null
  return { ...workspaceIndexStatus }
})

ipcMain.handle('statskey-desktop:workspace-index-refresh', (event) => {
  if (!isMainRenderer(event)) return false
  scheduleWorkspaceIndex(0)
  return true
})

ipcMain.handle(
  'statskey-desktop:workspace-index-search',
  async (event, query, mode, binding) => {
    if (!isMainRenderer(event)) return []
    return withWorkspaceOperationBinding(binding, async () => {
      assertCurrentWorkspaceBinding(binding)
      const results = workspaceOperationUsesOpenWorkspace()
        ? await searchWorkspaceIndex(query, mode)
        : searchWorkspace(query)
      assertCurrentWorkspaceBinding(binding)
      return results
    })
  }
)

ipcMain.handle('statskey-desktop:workspace-reveal', (event, candidate) => {
  if (!isMainRenderer(event) || !allowedWorkspacePath(candidate)) return false
  shell.showItemInFolder(canonicalExistingPath(candidate))
  return true
})

ipcMain.handle(
  'statskey-desktop:workspace-write',
  async (event, filePath, content, approvalMode, expectedModifiedAt, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, () =>
      writeWorkspaceTextFile(
        filePath,
        content,
        approvalMode,
        expectedModifiedAt,
        binding
      ),
      binding
    )
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-create',
  async (event, rootPath, relativePath, content, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, () =>
      createWorkspaceTextFile(
        rootPath,
        relativePath,
        content,
        approvalMode,
        binding
      ),
      binding
    )
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-render-pdf',
  async (event, rootPath, relativePath, htmlBody, title, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, () =>
      renderWorkspacePdfFile(
        rootPath,
        relativePath,
        htmlBody,
        title,
        approvalMode,
        binding
      ),
      binding
    )
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-export-pdf',
  async (event, fileName, htmlBody, title, approvalMode, origin) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, () =>
      renderDesktopPdfFile(fileName, htmlBody, title, approvalMode)
    )
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-delete',
  async (event, filePath, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(
      origin,
      () => deleteWorkspaceFile(filePath, approvalMode, binding),
      binding
    )
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-rename',
  async (event, filePath, nextName, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(
      origin,
      () => renameWorkspaceFile(filePath, nextName, approvalMode, binding),
      binding
    )
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-run-command',
  async (event, command, cwd, approvalMode, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withWorkspaceOperationBinding(binding, () =>
      runWorkspaceCommand(command, cwd, approvalMode, binding)
    )
  }
)

ipcMain.handle(
  'statskey-desktop:terminal-start',
  async (event, command, cwd, approvalMode, dimensions, origin, binding, options) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, () =>
      startTerminalCommand(
        command,
        cwd,
        approvalMode,
        dimensions,
        binding,
        options
      ),
      binding
    )
  }
)

ipcMain.handle('statskey-desktop:terminal-list', async (event) => {
  if (!isMainRenderer(event)) return []
  return terminalRuntime.list()
})

ipcMain.handle(
  'statskey-desktop:terminal-write',
  async (event, sessionId, data) => {
    if (!isMainRenderer(event)) return false
    return terminalRuntime.write(sessionId, data)
  }
)

ipcMain.handle(
  'statskey-desktop:terminal-resize',
  async (event, sessionId, cols, rows) => {
    if (!isMainRenderer(event)) return false
    return terminalRuntime.resize(sessionId, cols, rows)
  }
)

ipcMain.handle(
  'statskey-desktop:terminal-cancel',
  async (event, sessionId) => {
    if (!isMainRenderer(event)) return false
    return terminalRuntime.cancel(sessionId)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-initialize',
  async (event, rootPath, approvalMode) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return initializeWorkspaceGit(rootPath, approvalMode)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-status',
  async (event, rootPath, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withWorkspaceOperationBinding(binding, async () => {
      assertCurrentWorkspaceBinding(binding)
      const result = await runFixedWorkspaceCommand(
        rootPath,
        'git status --short --branch'
      )
      assertCurrentWorkspaceBinding(binding)
      return result
    })
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-files',
  async (event, rootPath) => {
    if (!isMainRenderer(event)) return { ok: false, files: [], error: 'Unavailable.' }
    return listWorkspaceGitFiles(rootPath)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-diff',
  async (event, rootPath, staged, paths, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withWorkspaceOperationBinding(binding, async () => {
      assertCurrentWorkspaceBinding(binding)
      const pathspecs =
        paths === undefined ? [] : normalizeGitDiffPaths(paths)
      const result = await runFixedWorkspaceProcess(rootPath, 'git', [
        'diff',
        ...(staged === true ? ['--cached'] : []),
        '--no-ext-diff',
        '--no-color',
        ...(pathspecs.length > 0 ? ['--', ...pathspecs] : []),
      ])
      assertCurrentWorkspaceBinding(binding)
      return result
    })
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-stage-all',
  async (event, rootPath) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return runFixedWorkspaceProcess(rootPath, 'git', ['add', '--all'])
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-stage-paths',
  async (event, rootPath, paths) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return runWorkspaceGitPathOperation(rootPath, paths, true)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-unstage-all',
  async (event, rootPath) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return unstageAllWorkspaceChanges(rootPath)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-unstage-paths',
  async (event, rootPath, paths) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return runWorkspaceGitPathOperation(rootPath, paths, false)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-commit',
  async (event, rootPath, message, approvalMode) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return commitWorkspaceChanges(rootPath, message, approvalMode)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-git-push',
  async (event, rootPath, approvalMode) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return pushWorkspaceChanges(rootPath, approvalMode)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-worktrees',
  async (event, rootPath) => {
    if (!isMainRenderer(event)) return []
    return listWorkspaceWorktrees(rootPath)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-worktree-create',
  async (event, rootPath, label, approvalMode) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return createWorkspaceWorktree(rootPath, label, approvalMode)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-worktree-activate',
  async (event, rootPath, worktreePath) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return activateWorkspaceWorktree(rootPath, worktreePath)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-worktree-remove',
  async (event, rootPath, worktreePath, approvalMode) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return removeWorkspaceWorktree(rootPath, worktreePath, approvalMode)
  }
)

ipcMain.handle('statskey-desktop:workspace-checkpoints', async (event, binding) => {
  if (!isMainRenderer(event)) return []
  return withWorkspaceOperationBinding(binding, async () => {
    assertCurrentWorkspaceBinding(binding)
    return await listWorkspaceCheckpoints()
  })
})

ipcMain.handle('statskey-desktop:workspace-instructions', (event, binding) => {
  if (!isMainRenderer(event)) return { rules: [], skills: [], configuration: {} }
  return withWorkspaceOperationBinding(binding, () => {
    assertCurrentWorkspaceBinding(binding)
    return workspaceInstructions()
  })
})

ipcMain.handle(
  'statskey-desktop:workspace-run-hook',
  async (event, hookName, payload, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    const allowedHooks = new Set([
      'sessionStart',
      'sessionEnd',
      'beforeSubmitPrompt',
      'preCompact',
      'stop',
      'afterAgentResponse',
    ])
    if (!allowedHooks.has(hookName)) {
      return { ok: false, error: 'Unsupported hook event.' }
    }
    return withDesktopOperationOrigin(origin, async () => {
      try {
        assertCurrentWorkspaceBinding(binding)
        const boundRoots = workspaceOperationRoots()
        for (const root of boundRoots) {
          assertCurrentWorkspaceBinding(binding)
          await runWorkspaceHooks(
            hookName,
            payload && typeof payload === 'object' ? payload : {},
            root,
            approvalMode
          )
        }
        assertCurrentWorkspaceBinding(binding)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: safeProviderError(error) }
      }
    }, binding)
  }
)

ipcMain.handle(
  'statskey-desktop:mcp-tools',
  async (event, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return []
    return withDesktopOperationOrigin(origin, async () => {
      try {
        assertCurrentWorkspaceBinding(binding)
        const configurations = await allMcpConfigurations()
        const signature = JSON.stringify(configurations)
        const startsCommands = Object.entries(configurations)
          .filter(([, config]) => typeof config.command === 'string')
          .map(([name, config]) => `${name}: ${config.command} ${(config.args || []).join(' ')}`)
        if (
          startsCommands.length > 0 &&
          !approvedMcpConfigurations.has(signature)
        ) {
          const approved = await requestDesktopOperationApproval(
            {
              kind: 'terminal',
              title: 'Start workspace MCP servers',
              description: `${startsCommands.length} local server${
                startsCommands.length === 1 ? '' : 's'
              }`,
              command: startsCommands.join('\n'),
              before: '',
              after: '',
            },
            approvalMode
          )
          if (!approved) return []
          approvedMcpConfigurations.add(signature)
        }
        assertCurrentWorkspaceBinding(binding)
        return await localMcpManager.listTools(configurations)
      } catch (error) {
        return [{
          name: 'mcp_configuration_error',
          description: safeProviderError(error),
          input_schema: { type: 'object', properties: {}, required: [] },
          unavailable: true,
        }]
      }
    }, binding)
  }
)

ipcMain.handle(
  'statskey-desktop:mcp-call',
  async (event, toolName, args, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(origin, async () => {
      try {
        assertCurrentWorkspaceBinding(binding)
        const boundRoots = workspaceOperationRoots()
        const serializedArgs = JSON.stringify(
          args && typeof args === 'object' ? args : {}
        )
        if (serializedArgs.length > 30_000) {
          throw new Error('Connected tool arguments exceed the review limit.')
        }
        const approvedArgs = JSON.parse(serializedArgs)
        for (const root of boundRoots) {
          assertCurrentWorkspaceBinding(binding)
          await runWorkspaceHooks(
            'beforeMCPExecution',
            { tool_name: toolName, arguments: approvedArgs },
            root,
            approvalMode
          )
        }
        const approved = await requestDesktopOperationApproval(
          {
            kind: 'mcp',
            title: `Run ${String(toolName).slice(0, 120)}`,
            description: 'External tool request',
            command: JSON.stringify(approvedArgs, null, 2),
            before: '',
            after: '',
          },
          approvalMode
        )
        if (!approved) return { ok: false, cancelled: true }
        assertCurrentWorkspaceBinding(binding)
        const result = await localMcpManager.callTool(toolName, approvedArgs)
        assertCurrentWorkspaceBinding(binding)
        for (const root of boundRoots) {
          assertCurrentWorkspaceBinding(binding)
          await runWorkspaceHooks(
            'afterMCPExecution',
            { tool_name: toolName, arguments: approvedArgs, result },
            root,
            approvalMode
          )
        }
        assertCurrentWorkspaceBinding(binding)
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error: safeProviderError(error) }
      }
    }, binding)
  }
)

ipcMain.handle('statskey-desktop:integrations-status', (event) => {
  if (!isMainRenderer(event)) return []
  return integrationStatuses()
})

ipcMain.handle(
  'statskey-desktop:integrations-save',
  async (event, requestedId, input) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    try {
      const id = validIntegrationId(requestedId)
        ? requestedId
        : `connection_${crypto.randomUUID().replace(/-/g, '')}`
      await enqueueIntegrationVaultMutation(async () => {
        const existing = await integrationConfiguration(id)
        const config = sanitizeRemoteIntegration(input, existing || {})
        await writeIntegrationConfiguration(id, config, 'saving a connected tool')
      })
      await localMcpManager.closeAll()
      return { ok: true, connection: integrationStatus(id) }
    } catch (error) {
      return { ok: false, error: safeProviderError(error) }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:integrations-authorize',
  async (event, integrationId) => {
    if (!isMainRenderer(event) || !validIntegrationId(integrationId)) {
      return { ok: false, error: 'Invalid connection.' }
    }
    try {
      const config = await integrationConfiguration(integrationId)
      if (!config) throw new Error('Save this connection first.')
      if (config.authType !== 'oauth') {
        throw new Error('Choose browser sign-in for this connection.')
      }
      const server = serverNameForIntegration(integrationId, config.name)
      const result = await authorizeRemoteMcp(
        mcpConfigForIntegration(config),
        {
          openExternal: (url) => shell.openExternal(url),
          onStateChange: (oauth) =>
            updateIntegrationOAuth(integrationId, oauth),
        }
      )
      await localMcpManager.close(server)
      return {
        ok: true,
        toolCount: result.toolCount,
        tools: result.tools.map((tool) => tool.name).slice(0, 100),
      }
    } catch (error) {
      return { ok: false, error: safeProviderError(error) }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:integrations-test',
  async (event, integrationId) => {
    if (!isMainRenderer(event) || !validIntegrationId(integrationId)) {
      return { ok: false, error: 'Invalid connection.' }
    }
    try {
      const config = await integrationConfiguration(integrationId)
      if (!config) throw new Error('Save this connection first.')
      const server = serverNameForIntegration(integrationId, config.name)
      const tools = await localMcpManager.listTools({
        [server]: integrationMcpConfiguration(integrationId, config),
      })
      const available = tools.filter(
        (tool) => tool.server === server && tool.unavailable !== true
      )
      const failed = tools.find(
        (tool) => tool.server === server && tool.unavailable === true
      )
      if (available.length === 0 && failed) {
        throw new Error(failed.description || 'The MCP service is unavailable.')
      }
      return {
        ok: true,
        toolCount: available.length,
        tools: available.map((tool) => tool.originalName || tool.name).slice(0, 100),
      }
    } catch (error) {
      return { ok: false, error: safeProviderError(error) }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:integrations-remove',
  async (event, integrationId) => {
    if (!isMainRenderer(event) || !validIntegrationId(integrationId)) return false
    let removed = false
    await enqueueIntegrationVaultMutation(async () => {
      const vault = readIntegrationVault()
      if (!vault.connections[integrationId]) return
      delete vault.connections[integrationId]
      writeIntegrationVault(vault)
      removed = true
    })
    if (removed) await localMcpManager.closeAll()
    return removed
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-restore-checkpoint',
  async (event, checkpointId, approvalMode, origin, binding) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    return withDesktopOperationOrigin(
      origin,
      () => restoreWorkspaceCheckpoint(checkpointId, approvalMode, binding),
      binding
    )
  }
)

function getFleetIdentityStore() {
  if (!fleetIdentityStore) {
    fleetIdentityStore = new FleetIdentityStore({
      filePath: path.join(app.getPath('userData'), 'fleet-device-identity.json'),
      crypto: safeStorageCrypto,
      allowLoopback: !app.isPackaged,
    })
  }
  return fleetIdentityStore
}

function fleetRepositoryHosts() {
  return [...DEFAULT_ALLOWED_REPOSITORY_HOSTS]
}

function trustedFleetDeviceEndpoint(value) {
  const allowLoopback = !app.isPackaged
  const requested = normalizeFleetDeviceEndpoint(value, { allowLoopback })
  const allowed = [
    'https://us-central1-statskey-workbench.cloudfunctions.net/workbenchDeviceApi',
    process.env.STATSKEY_FLEET_DEVICE_ENDPOINT,
  ]
    .filter(Boolean)
    .map((endpoint) =>
      normalizeFleetDeviceEndpoint(endpoint, { allowLoopback })
    )
  if (!allowed.includes(requested)) {
    throw new Error('That Fleet coordinator is not trusted by this build.')
  }
  return requested
}

function fleetAllowedExecutables(profile) {
  const dedicatedWorkerDefaults =
    profile?.workerMode === 'dedicated'
      ? process.platform === 'win32'
        ? ['node', 'dotnet', 'msbuild']
        : ['node', 'npm', 'npx', 'pnpm', 'yarn', 'make', 'cmake', 'swift']
      : []
  const configured = String(process.env.STATSKEY_FLEET_ALLOWED_EXECUTABLES || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._+-]{0,119}$/.test(value))
    .map((value) => (process.platform === 'win32' ? value.toLowerCase() : value))
  return [...new Set([...dedicatedWorkerDefaults, ...configured])]
}

async function fleetExecutablePath(executable) {
  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const extensions = directExecutableExtensions({
    executable,
    platform: process.platform,
    pathExt: process.env.PATHEXT,
  })
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(
        entry,
        process.platform === 'win32'
          ? `${executable}${extension}`
          : executable
      )
      try {
        await access(candidate, fsConstants.X_OK)
        const resolved = realpathSync(candidate)
        const metadata = statSync(resolved)
        if (
          metadata.isFile() &&
          (process.platform !== 'win32' ||
            ['.com', '.exe'].includes(path.extname(resolved).toLowerCase()))
        ) {
          return resolved
        }
      } catch {}
    }
  }
  return null
}

function fleetNodeCapabilities(
  allowedExecutables,
  { gitAvailable = false, xcodeAvailable = false } = {}
) {
  if (!gitAvailable) return []
  const capabilities = [
    'workspace.read',
    'workspace.snapshot',
    'git.inspect',
  ]
  if (process.platform === 'darwin' && xcodeAvailable) {
    capabilities.push('xcode.build', 'xcode.test', 'xcode.archive')
  }
  if (allowedExecutables.length > 0) capabilities.push('terminal.run')
  if (
    process.platform === 'win32' &&
    allowedExecutables.some((executable) =>
      ['dotnet', 'msbuild'].includes(executable)
    )
  ) {
    capabilities.push('windows.build')
  }
  return capabilities
}

async function fleetDiskAvailableBytes() {
  try {
    const stats = await statfs(app.getPath('userData'))
    const available = Number(stats.bavail) * Number(stats.bsize)
    return Number.isFinite(available)
      ? Math.max(0, Math.min(available, 100 * 1024 ** 4))
      : 0
  } catch {
    return 0
  }
}

async function collectFleetHeartbeat(capabilities, executables) {
  const logicalCpu = Math.max(1, os.cpus()?.length || 1)
  const oneMinuteLoad = Number(os.loadavg?.()[0]) || 0
  const totalMemory = Math.max(0, os.totalmem())
  return {
    capabilities,
    executables,
    resources: {
      cpuLogical: logicalCpu,
      cpuAvailable: Math.max(0, Math.min(logicalCpu, logicalCpu - oneMinuteLoad)),
      memoryBytes: totalMemory,
      memoryAvailableBytes: Math.max(0, Math.min(totalMemory, os.freemem())),
      diskAvailableBytes: await fleetDiskAvailableBytes(),
      gpuCount: 0,
    },
  }
}

function clearFleetNodeInitializationRetry() {
  if (fleetNodeInitializationTimer) {
    clearTimeout(fleetNodeInitializationTimer)
    fleetNodeInitializationTimer = null
  }
  fleetNodeInitializationFailures = 0
}

function retryableFleetNodeInitialization(error) {
  const status = Number(error?.status)
  return (
    error?.code === 'offline' ||
    error?.code === 'timeout' ||
    error?.code === 'worker_authority_fence_unavailable' ||
    status === 408 ||
    status === 429 ||
    status >= 500
  )
}

function handleFleetNodeInitializationFailure(error) {
  console.warn('StatsKey Fleet node did not start:', error?.message || error)
  if (
    fleetShutdownStarted ||
    !retryableFleetNodeInitialization(error) ||
    fleetNodeInitializationTimer
  ) {
    return
  }
  fleetNodeInitializationFailures += 1
  const delay = Math.min(
    5 * 60_000,
    5_000 * 2 ** Math.min(fleetNodeInitializationFailures - 1, 6)
  )
  fleetNodeInitializationTimer = setTimeout(() => {
    fleetNodeInitializationTimer = null
    void initializeFleetNode().catch(handleFleetNodeInitializationFailure)
  }, delay)
  fleetNodeInitializationTimer.unref?.()
}

async function initializeFleetNode({
  restart = false,
  verifiedIdentityFingerprint = null,
} = {}) {
  if (fleetShutdownStarted) return false
  if (restart) await invalidateFleetNodeRuntime()
  if (fleetShutdownStarted) return false
  if (fleetNodeSupervisor) return true
  if (fleetNodeInitializationPromise) return fleetNodeInitializationPromise
  const generation = fleetNodeInitializationGeneration
  const pending = initializeFleetNodeCandidate({
    generation,
    verifiedIdentityFingerprint,
  })
  fleetNodeInitializationPromise = pending
  try {
    return await pending
  } catch (error) {
    if (generation !== fleetNodeInitializationGeneration) return false
    throw error
  } finally {
    if (fleetNodeInitializationPromise === pending) {
      fleetNodeInitializationPromise = null
    }
  }
}

async function invalidateFleetNodeRuntime() {
  fleetNodeInitializationGeneration += 1
  fleetNodeInitializationPromise = null
  const supervisor = fleetNodeSupervisor
  clearFleetNodeInitializationRetry()
  const hostRuntime = remoteSessionHostRuntime
  remoteSessionHostRuntime = null
  if (hostRuntime) {
    await hostRuntime.stop().catch((error) => {
      console.error('[remote-session] host runtime shutdown failed:', error)
    })
  }
  if (supervisor) await supervisor.stop()
  if (fleetNodeSupervisor === supervisor) fleetNodeSupervisor = null
}

async function initializeFleetNodeCandidate({
  generation,
  verifiedIdentityFingerprint,
}) {
  const identity = await getFleetIdentityStore().load()
  if (
    !identity?.enrollment ||
    !['worker', 'hybrid'].includes(identity.profile.role) ||
    identity.profile.workerMode === 'disabled'
  ) {
    clearFleetNodeInitializationRetry()
    return false
  }
  // Ubuntu is currently a controller/local-work platform only. Starting a
  // polling worker with empty capabilities can race a stale heartbeat and
  // consume a remote attempt even though the adapter will fail closed. A
  // future Linux worker must be gated on an attested privileged cgroup service.
  if (process.platform === 'linux') {
    clearFleetNodeInitializationRetry()
    return false
  }
  const quarantine = loadActiveFleetWorkerQuarantine()
  if (quarantine) {
    clearFleetNodeInitializationRetry()
    surfaceFleetWorkerQuarantine(quarantine)
    return false
  }
  const endpoint = trustedFleetDeviceEndpoint(identity.enrollment.endpoint)
  const postAction = createFleetDeviceTransport({
    endpoint,
    privateKey: identity.privateKey,
    deviceId: identity.deviceId,
    allowLoopback: !app.isPackaged,
    coordinatorKeyId: identity.enrollment.coordinatorKeyId,
    coordinatorPublicKeySpki:
      identity.enrollment.coordinatorPublicKeySpki,
  })
  if (verifiedIdentityFingerprint !== identity.publicKeyFingerprint) {
    const verified = await postAction('device.status', {})
    if (
      verified?.status !== 'active' ||
      verified.deviceId !== identity.deviceId ||
      verified.publicKeyFingerprint !== identity.publicKeyFingerprint ||
      verified.ownerUid !== identity.enrollment.ownerUid
    ) {
      throw new Error('Stored Fleet enrollment could not be verified.')
    }
  }
  const configuredExecutables = fleetAllowedExecutables(identity.profile)
  const executableAvailability = await Promise.all(
    configuredExecutables.map(async (executable) => ({
      executable,
      path: await fleetExecutablePath(executable),
    }))
  )
  // The current Windows Job Object owner shares the desktop user's security
  // token with its workload. It proves lifecycle behavior but is not an
  // adversarial execution boundary, so packaged clients stay fail-closed until
  // a separately privileged signed service owns the job and lease authority.
  //
  // Development-only escape hatch for a single-owner trusted macOS machine:
  // the best-effort POSIX owner enforces lease/deadline fencing for ordinary
  // process trees, but a job that creates a new session can escape it. This
  // is not containment and must never reach a packaged build or Linux.
  const allowBestEffortPosixOwner =
    !app.isPackaged &&
    process.platform === 'darwin' &&
    process.env.STATSKEY_FLEET_ALLOW_BEST_EFFORT_POSIX_OWNER === '1'
  const fleetProcessContainmentAvailable =
    (kernelBackedFleetProcessContainment(process.platform) ||
      allowBestEffortPosixOwner) &&
    !app.isPackaged
  const allowedExecutables = executableAvailability
    .filter((item) => fleetProcessContainmentAvailable && item.path)
    .map((item) => item.executable)
  const executablePaths = Object.fromEntries(
    executableAvailability
      .filter((item) => item.path)
      .map((item) => [item.executable, item.path])
  )
  const [gitPath, xcodePath, dittoPath] = await Promise.all([
    fleetExecutablePath('git'),
    process.platform === 'darwin'
      ? fleetExecutablePath('xcodebuild')
      : Promise.resolve(null),
    process.platform === 'darwin'
      ? fleetExecutablePath('ditto')
      : Promise.resolve(null),
  ])
  const capabilities = fleetNodeCapabilities(allowedExecutables, {
    gitAvailable: fleetProcessContainmentAvailable && Boolean(gitPath),
    xcodeAvailable:
      fleetProcessContainmentAvailable && Boolean(xcodePath && dittoPath),
  })
  if (gitPath) executablePaths.git = gitPath
  if (xcodePath) executablePaths.xcodebuild = xcodePath
  if (dittoPath) executablePaths.ditto = dittoPath
  const leaseAuthorityStore = new FleetLeaseAuthorityStore({
    directory: path.join(
      app.getPath('userData'),
      'fleet-lease-authority'
    ),
  })
  await leaseAuthorityStore.assertOwnerAvailable()
  const adapters = createFleetWorkerAdapters({
    workRoot: path.join(app.getPath('userData'), 'fleet-workspaces'),
    artifactSpoolRoot: fleetArtifactSpoolRoot(),
    allowedRepositoryHosts: fleetRepositoryHosts(),
    allowedExecutables,
    executablePaths,
    platform: process.platform,
    authorityFenceProvider: () => leaseAuthorityStore.current(),
    allowBestEffortPosixOwner,
  })
  const supervisor = new FleetNodeSupervisor({
    deviceId: identity.deviceId,
    postAction,
    adapters,
    collectHeartbeat: () =>
      collectFleetHeartbeat(capabilities, allowedExecutables),
    softwareVersion: app.getVersion(),
    logger: console,
    onExecutionStart: (record) => {
      persistFleetWorkerQuarantine(record)
    },
    onExecutionSettled: () => {
      clearFleetWorkerQuarantine()
    },
    onLeaseAuthorityStart: (record) => {
      return leaseAuthorityStore.activate(record)
    },
    onLeaseAuthorityRenewed: (record) => {
      return leaseAuthorityStore.renew(record)
    },
    onLeaseAuthoritySettled: (record) => {
      return leaseAuthorityStore.clear(record.leaseId)
    },
    onQuarantine: (record) => {
      persistFleetWorkerQuarantine(record)
      surfaceFleetWorkerQuarantine(record)
    },
  })
  const currentIdentity = await getFleetIdentityStore().load()
  if (
    fleetShutdownStarted ||
    generation !== fleetNodeInitializationGeneration ||
    currentIdentity?.deviceId !== identity.deviceId ||
    currentIdentity?.publicKeyFingerprint !== identity.publicKeyFingerprint ||
    currentIdentity?.enrollment?.endpoint !== identity.enrollment.endpoint ||
    currentIdentity?.enrollment?.coordinatorKeyId !==
      identity.enrollment.coordinatorKeyId ||
    currentIdentity?.enrollment?.coordinatorPublicKeySpki !==
      identity.enrollment.coordinatorPublicKeySpki ||
    currentIdentity?.profile?.role !== identity.profile.role ||
    currentIdentity?.profile?.workerMode !== identity.profile.workerMode
  ) {
    await supervisor.stop()
    return false
  }
  fleetNodeSupervisor = supervisor
  clearFleetNodeInitializationRetry()
  supervisor.start()
  startRemoteSessionHostRuntime(identity, postAction)
  return true
}

async function confirmFleetIdentityUse({ message, detail }) {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'StatsKey Fleet',
    message,
    detail,
    buttons: ['Approve', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  return result.response === 0
}

function fleetPairingConfirmationDetail(receipt) {
  const label =
    typeof receipt?.candidate?.label === 'string'
      ? receipt.candidate.label.trim().slice(0, 80)
      : 'Unknown device'
  const workspaces = Array.isArray(receipt?.workspaceIds)
    ? receipt.workspaceIds
        .filter((value) => typeof value === 'string')
        .join(', ')
    : ''
  const capabilities = Array.isArray(receipt?.capabilities)
    ? receipt.capabilities
        .filter((value) => typeof value === 'string')
        .join(', ')
    : ''
  const repositories = Array.isArray(receipt?.repositoryIdentities)
    ? receipt.repositoryIdentities
        .filter((value) => typeof value === 'string')
        .join(', ')
    : ''
  let candidateIdentity = null
  try {
    candidateIdentity = deviceIdentityForPublicKey(
      receipt?.candidate?.publicKeySpki
    )
  } catch {
    // The signing validator will reject malformed key material after denial.
  }
  return [
    `StatsKey account: ${String(receipt?.ownerUid || 'Invalid')}`,
    `Controller device ID: ${String(receipt?.controllerDeviceId || 'Invalid')}`,
    `Device: ${label || 'Unknown device'}`,
    `Device ID: ${candidateIdentity?.deviceId || 'Invalid'}`,
    `Key fingerprint: ${candidateIdentity?.publicKeyFingerprint || 'Invalid'}`,
    `Role: ${String(receipt?.candidate?.role || 'Invalid')}`,
    `Worker mode: ${String(receipt?.candidate?.workerMode || 'Invalid')}`,
    `Platform: ${String(receipt?.candidate?.platform || 'Invalid')}`,
    `Maximum concurrent jobs: ${String(
      receipt?.candidate?.maxConcurrentJobs ?? 'Invalid'
    )}`,
    `Workspaces: ${workspaces || 'None'}`,
    `Repositories: ${repositories || 'None'}`,
    `Capabilities: ${capabilities || 'None'}`,
    `Unattended work: ${receipt?.unattended === true ? 'Allowed' : 'Not allowed'}`,
    ...(Array.isArray(receipt?.capabilities) &&
    receipt.capabilities.some((capability) =>
      ['terminal.run', 'windows.build'].includes(capability)
    )
      ? [
          'Host command access: approved programs run as this OS user; use a dedicated worker account.',
        ]
      : []),
    `Grant expires: ${new Date(receipt?.grantExpiresAt).toISOString()}`,
    `Policy version: ${String(receipt?.policyVersion ?? 'Invalid')}`,
  ].join('\n')
}

// Workspace sync IPC: authorized roots come from the runtime's own persisted
// link-state files, independent of the currently open workspace.
function getWorkspaceSyncRuntime() {
  if (!workspaceSyncRuntime) {
    workspaceSyncRuntime = createWorkspaceSyncRuntime({
      userDataPath: app.getPath('userData'),
      ignoredNames: WORKSPACE_IGNORED_NAMES,
      maxFileBytes: MAX_WORKSPACE_SYNC_FILE_BYTES,
      onChanges(change) {
        if (
          !mainWindow ||
          mainWindow.isDestroyed() ||
          mainWindow.webContents.isDestroyed()
        ) {
          return
        }
        mainWindow.webContents.send(
          'statskey-desktop:workspace-sync-changed',
          change
        )
      },
    })
  }
  return workspaceSyncRuntime
}

ipcMain.handle('statskey-desktop:workspace-sync-device-info', (event) => {
  if (!isMainRenderer(event)) return null
  return getWorkspaceSyncRuntime().deviceInfo()
})

ipcMain.handle(
  'statskey-desktop:workspace-sync-state-load',
  (event, syncId) => {
    if (!isMainRenderer(event) || typeof syncId !== 'string') return null
    return getWorkspaceSyncRuntime().loadState(syncId)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-state-save',
  (event, syncId, state) => {
    if (!isMainRenderer(event) || typeof syncId !== 'string') return false
    return getWorkspaceSyncRuntime().saveState(syncId, state)
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-state-remove',
  (event, syncId) => {
    if (!isMainRenderer(event) || typeof syncId !== 'string') return false
    return getWorkspaceSyncRuntime().removeState(syncId)
  }
)

ipcMain.handle('statskey-desktop:workspace-sync-state-list', (event) => {
  if (!isMainRenderer(event)) return []
  return getWorkspaceSyncRuntime().listStates()
})

ipcMain.handle(
  'statskey-desktop:workspace-sync-scan',
  async (event, syncId) => {
    if (!isMainRenderer(event) || typeof syncId !== 'string') {
      return {
        ok: false,
        entries: [],
        missingRoots: [],
        skipped: [],
        error: 'Unavailable.',
      }
    }
    try {
      return await getWorkspaceSyncRuntime().scan(syncId)
    } catch {
      return {
        ok: false,
        entries: [],
        missingRoots: [],
        skipped: [],
        error: 'Sync scan failed.',
      }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-scan-paths',
  async (event, syncId, rootId, relPaths) => {
    if (
      !isMainRenderer(event) ||
      typeof syncId !== 'string' ||
      typeof rootId !== 'string' ||
      !Array.isArray(relPaths)
    ) {
      return { ok: false, entries: [], skipped: [], error: 'Unavailable.' }
    }
    try {
      return await getWorkspaceSyncRuntime().scanPaths(syncId, rootId, relPaths)
    } catch {
      return { ok: false, entries: [], skipped: [], error: 'Sync scan failed.' }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-read',
  async (event, syncId, rootId, relPath) => {
    if (
      !isMainRenderer(event) ||
      typeof syncId !== 'string' ||
      typeof rootId !== 'string' ||
      typeof relPath !== 'string'
    ) {
      return { ok: false, error: 'Unavailable.' }
    }
    try {
      return await getWorkspaceSyncRuntime().read(syncId, rootId, relPath)
    } catch {
      return { ok: false, error: 'Sync read failed.' }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-apply',
  async (event, syncId, rootId, relPath, content) => {
    if (
      !isMainRenderer(event) ||
      typeof syncId !== 'string' ||
      typeof rootId !== 'string' ||
      typeof relPath !== 'string' ||
      content == null ||
      typeof content !== 'object'
    ) {
      return { ok: false, error: 'Unavailable.' }
    }
    try {
      return await getWorkspaceSyncRuntime().apply(syncId, rootId, relPath, {
        base64: typeof content.base64 === 'string' ? content.base64 : '',
        executable: content.executable === true,
      })
    } catch {
      return { ok: false, error: 'Sync write failed.' }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-remove',
  async (event, syncId, rootId, relPath) => {
    if (
      !isMainRenderer(event) ||
      typeof syncId !== 'string' ||
      typeof rootId !== 'string' ||
      typeof relPath !== 'string'
    ) {
      return { ok: false, error: 'Unavailable.' }
    }
    try {
      return await getWorkspaceSyncRuntime().remove(syncId, rootId, relPath)
    } catch {
      return { ok: false, error: 'Sync delete failed.' }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-create-root-folder',
  (event, basePath, name) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
    try {
      const base =
        typeof basePath === 'string' && basePath
          ? basePath
          : path.join(os.homedir(), 'StatsKey Synced')
      if (!path.isAbsolute(base)) {
        return { ok: false, error: 'Choose an absolute destination folder.' }
      }
      mkdirSync(base, { recursive: true })
      const resolvedBase = realpathSync(base)
      const cleaned = String(typeof name === 'string' ? name : '')
        .replace(/[^A-Za-z0-9._ -]/g, '')
        .replace(/^[. ]+/, '')
        .trim()
        .slice(0, 120)
        .trim() || 'Synced Workspace'
      const target = path.join(resolvedBase, cleaned)
      const relative = path.relative(resolvedBase, target)
      if (
        !relative ||
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        relative.includes(path.sep)
      ) {
        return { ok: false, error: 'Invalid folder name.' }
      }
      mkdirSync(target, { recursive: true })
      return { ok: true, path: target }
    } catch {
      return { ok: false, error: 'Could not create the folder.' }
    }
  }
)

ipcMain.handle(
  'statskey-desktop:workspace-sync-choose-folder',
  async (event) => {
    if (!isMainRenderer(event) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a destination folder',
      buttonLabel: 'Choose folder',
      properties: ['openDirectory', 'createDirectory'],
      securityScopedBookmarks: process.platform === 'darwin',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  }
)

ipcMain.on(
  'statskey-desktop:operation-decision',
  (event, operationId, approved) => {
    if (!isMainRenderer(event) || typeof operationId !== 'string') return
    const pending = pendingDesktopApprovals.get(operationId)
    if (!pending) return
    pendingDesktopApprovals.delete(operationId)
    clearTimeout(pending.timeout)
    pending.resolve(approved === true)
  }
)

ipcMain.handle('statskey-desktop:providers-status', (event) => {
  if (!isMainRenderer(event)) return []
  return providerStatuses()
})

ipcMain.handle('statskey-desktop:preferences-get', (event) => {
  if (!isMainRenderer(event)) return null
  return readDesktopPreferences()
})

ipcMain.handle('statskey-desktop:preferences-save', (event, input) => {
  if (!isMainRenderer(event)) return false
  const current = readDesktopPreferences()
  const next = sanitizeDesktopPreferences(preferencesWithUpdate(current, input))
  writeDesktopPreferences(next)
  return true
})

ipcMain.handle('statskey-desktop:calendar-feeds-list', (event) => {
  if (!isMainRenderer(event)) return []
  return readCalendarFeedVault().feeds.map(publicCalendarFeed)
})

ipcMain.handle('statskey-desktop:calendar-feeds-add', async (event, input) => {
  if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
  try {
    const name = String(input?.name || '').trim().slice(0, 100)
    if (!name) throw new Error('Give this calendar a name.')
    const url = validateCalendarFeedUrl(input?.url)
    const encryptedUrl = await safeStorageCrypto.encryptString(
      url,
      'saving a calendar feed'
    )
    // Read after the asynchronous Keychain boundary. Everything from this read
    // through the synchronous write is one event-loop turn, so overlapping
    // additions cannot overwrite a feed saved while encryption was pending.
    const vault = readCalendarFeedVault()
    const feed = {
      id: crypto.randomUUID(),
      name,
      encryptedUrl: encryptedUrl.toString('base64'),
      createdAt: new Date().toISOString(),
    }
    vault.feeds.push(feed)
    vault.feeds = vault.feeds.slice(-24)
    writeCalendarFeedVault(vault)
    return { ok: true, feed: publicCalendarFeed(feed) }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
})

ipcMain.handle('statskey-desktop:calendar-feeds-remove', (event, feedId) => {
  if (!isMainRenderer(event) || typeof feedId !== 'string') return false
  const vault = readCalendarFeedVault()
  const next = vault.feeds.filter((feed) => feed.id !== feedId)
  if (next.length === vault.feeds.length) return false
  writeCalendarFeedVault({ version: 1, feeds: next })
  return true
})

ipcMain.handle(
  'statskey-desktop:calendar-feeds-events',
  async (event, input) => {
    if (!isMainRenderer(event)) return { events: [], errors: ['Unavailable.'] }
    const start = String(input?.start || '')
    const end = String(input?.end || '')
    const limit = Math.min(250, Math.max(1, Number(input?.limit) || 100))
    const events = []
    const errors = []
    const feeds = readCalendarFeedVault().feeds
    for (let index = 0; index < feeds.length; index += 1) {
      const feed = feeds[index]
      try {
        const decrypted = await safeStorageCrypto.decryptString(
          Buffer.from(feed.encryptedUrl, 'base64'),
          'unlocking calendar feeds'
        )
        const contents = await fetchCalendarFeed(decrypted.result)
        const parsed = parseCalendarFeedEvents(contents, start, end, limit)
        events.push(
          ...parsed.map((item) => ({
            ...item,
            calendarId: feed.id,
            calendarName: feed.name,
          }))
        )
      } catch (error) {
        errors.push(`${feed.name}: ${safeProviderError(error)}`)
        if (
          error instanceof SafeStorageTimeoutError ||
          error instanceof SafeStorageUnavailableError
        ) {
          for (const skipped of feeds.slice(index + 1)) {
            errors.push(
              `${skipped.name}: Secure calendar storage is temporarily unavailable.`
            )
          }
          break
        }
      }
    }
    events.sort((left, right) =>
      calendarEventStart(left).localeCompare(calendarEventStart(right))
    )
    return { events: events.slice(0, limit), errors }
  }
)

ipcMain.handle('statskey-desktop:providers-save', async (event, provider, input) => {
  if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
  try {
    await enqueueProviderVaultMutation(() =>
      saveProviderConfiguration(provider, input)
    )
    return { ok: true, status: providerStatus(provider) }
  } catch (error) {
    return {
      ok: false,
      error: safeProviderError(error),
    }
  }
})

ipcMain.handle('statskey-desktop:providers-remove', async (event, provider) => {
  if (!isMainRenderer(event) || !PROVIDER_IDS.has(provider)) return false
  await enqueueProviderVaultMutation(async () => {
    const vault = readProviderVault()
    delete vault.providers[provider]
    writeProviderVault(vault)
  })
  return true
})

ipcMain.handle('statskey-desktop:providers-test', async (event, provider) => {
  if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
  try {
    const config = await providerConfiguration(provider)
    if (!config) throw new Error('Add credentials first.')
    const result = await testProviderConfiguration(provider, config)
    return { ok: true, ...result }
  } catch (error) {
    return {
      ok: false,
      error: safeProviderError(error),
    }
  }
})

ipcMain.handle('statskey-desktop:providers-models', async (event, provider) => {
  if (!isMainRenderer(event)) return { ok: false, error: 'Unavailable.' }
  try {
    const config = await providerConfiguration(provider)
    if (!config) throw new Error('Add credentials first.')
    const models = await listProviderModels(provider, config)
    return { ok: true, models }
  } catch (error) {
    return {
      ok: false,
      error: safeProviderError(error),
    }
  }
})

ipcMain.on(
  'statskey-desktop:provider-run',
  async (event, requestId, provider, request) => {
    if (
      !isMainRenderer(event) ||
      typeof requestId !== 'string' ||
      !/^[a-f0-9-]{16,80}$/i.test(requestId) ||
      !PROVIDER_IDS.has(provider)
    ) {
      return
    }
    if (
      activeProviderRuns.has(requestId) ||
      preparingProviderRuns.has(requestId) ||
      pendingProviderRuns.some((pending) => pending.requestId === requestId)
    ) {
      event.sender.send('statskey-desktop:provider-event', requestId, {
        type: 'error',
        error: 'That provider request is already running.',
      })
      return
    }
    let requestBytes = 0
    try {
      requestBytes = Buffer.byteLength(JSON.stringify(request), 'utf8')
    } catch {
      requestBytes = Number.POSITIVE_INFINITY
    }
    if (requestBytes > 12 * 1024 * 1024) {
      event.sender.send('statskey-desktop:provider-event', requestId, {
        type: 'error',
        error: 'Provider request exceeds the 12 MB local limit.',
      })
      return
    }
    const preparation = {
      requestId,
      sender: event.sender,
      cancelled: false,
    }
    preparingProviderRuns.set(requestId, preparation)
    let config
    try {
      config = await providerConfiguration(provider)
    } catch (error) {
      if (!preparation.cancelled && !event.sender.isDestroyed()) {
        event.sender.send('statskey-desktop:provider-event', requestId, {
          type: 'error',
          error: safeProviderError(error),
        })
      }
      return
    } finally {
      if (preparingProviderRuns.get(requestId) === preparation) {
        preparingProviderRuns.delete(requestId)
      }
    }
    if (preparation.cancelled || event.sender.isDestroyed()) return
    if (!config) {
      event.sender.send('statskey-desktop:provider-event', requestId, {
        type: 'error',
        error: 'Add provider credentials in Models & keys.',
      })
      return
    }
    const pending = {
      requestId,
      provider,
      request,
      config,
      sender: event.sender,
    }
    if (activeProviderRuns.size >= MAX_ACTIVE_PROVIDER_RUNS) {
      if (pendingProviderRuns.length >= MAX_PENDING_PROVIDER_RUNS) {
        event.sender.send('statskey-desktop:provider-event', requestId, {
          type: 'error',
          error: 'The local provider queue is full. Stop a run or try again shortly.',
        })
        return
      }
      pendingProviderRuns.push(pending)
      sendProviderQueuePositions()
      return
    }
    void startProviderRun(pending)
  }
)

ipcMain.on('statskey-desktop:provider-cancel', (event, requestId) => {
  if (!isMainRenderer(event) || typeof requestId !== 'string') return
  const preparation = preparingProviderRuns.get(requestId)
  if (preparation) {
    preparation.cancelled = true
    preparingProviderRuns.delete(requestId)
    sendProviderEvent(preparation, {
      type: 'cancelled',
      error: 'Stopped.',
    })
    return
  }
  const activeRun = activeProviderRuns.get(requestId)
  if (activeRun) {
    activeRun.cancel()
    return
  }
  const pendingIndex = pendingProviderRuns.findIndex(
    (pending) => pending.requestId === requestId
  )
  if (pendingIndex < 0) return
  const [pending] = pendingProviderRuns.splice(pendingIndex, 1)
  sendProviderEvent(pending, {
    type: 'cancelled',
    error: 'Stopped.',
  })
  sendProviderQueuePositions()
})

async function startProviderRun(pending) {
  if (pending.sender.isDestroyed()) {
    drainProviderQueue()
    return
  }
  const { requestId, provider, request, config } = pending
  const controller = new AbortController()
  let acceptProviderEvents = true
  const providerStartedAt = Date.now()
  const providerHeartbeat = setInterval(() => {
    if (!acceptProviderEvents) return
    sendProviderEvent(pending, {
      type: 'activity',
      elapsedMs: Date.now() - providerStartedAt,
    })
  }, 4_000)
  providerHeartbeat.unref?.()
  let terminalEvent
  try {
    const providerPromise = runProviderRound({
      provider,
      config,
      request,
      signal: controller.signal,
      onDelta: (text) => {
        if (acceptProviderEvents) {
          sendProviderEvent(pending, { type: 'text', text })
        }
      },
    })
    const guard = createProviderRunGuard(providerPromise, {
      onAbort: () => controller.abort(),
    })
    activeProviderRuns.set(requestId, guard)
    sendProviderEvent(pending, {
      type: 'open',
      active: activeProviderRuns.size,
      limit: MAX_ACTIVE_PROVIDER_RUNS,
    })
    const result = await guard.result
    terminalEvent = { type: 'done', result }
  } catch (error) {
    terminalEvent =
      error instanceof ProviderHardTimeoutError
        ? {
            type: 'timeout',
            error: safeProviderError(error),
          }
        : error instanceof ProviderCancelledError
          ? { type: 'cancelled', error: 'Stopped.' }
          : { type: 'error', error: safeProviderError(error) }
  } finally {
    acceptProviderEvents = false
    clearInterval(providerHeartbeat)
    activeProviderRuns.delete(requestId)
    if (terminalEvent) sendProviderEvent(pending, terminalEvent)
    drainProviderQueue()
  }
}

function drainProviderQueue() {
  while (
    activeProviderRuns.size < MAX_ACTIVE_PROVIDER_RUNS &&
    pendingProviderRuns.length > 0
  ) {
    const pending = pendingProviderRuns.shift()
    if (!pending || pending.sender.isDestroyed()) continue
    void startProviderRun(pending)
  }
  sendProviderQueuePositions()
}

function sendProviderQueuePositions() {
  pendingProviderRuns.forEach((pending, index) => {
    sendProviderEvent(pending, {
      type: 'queued',
      position: index + 1,
      active: activeProviderRuns.size,
      limit: MAX_ACTIVE_PROVIDER_RUNS,
    })
  })
}

function sendProviderEvent(pending, payload) {
  if (pending.sender.isDestroyed()) return
  try {
    pending.sender.send(
      'statskey-desktop:provider-event',
      pending.requestId,
      payload
    )
  } catch {
    // A renderer can disappear between the destruction check and send.
  }
}

function cancelRendererOwnedWork() {
  for (const preparation of preparingProviderRuns.values()) {
    preparation.cancelled = true
  }
  preparingProviderRuns.clear()

  const queued = pendingProviderRuns.splice(0)
  for (const pending of queued) {
    sendProviderEvent(pending, {
      type: 'cancelled',
      error: 'Stopped because the StatsKey window reloaded.',
    })
  }
  for (const activeRun of activeProviderRuns.values()) activeRun.cancel()

  terminalRuntime.cancelWhere((metadata) =>
    Boolean(metadata?.origin?.sessionId || metadata?.origin?.messageId)
  )

  for (const pending of pendingDesktopApprovals.values()) {
    clearTimeout(pending.timeout)
    pending.resolve(false)
  }
  pendingDesktopApprovals.clear()
}

function createMainWindow() {
  const savedBounds = readWindowState()
  const window = new BrowserWindow({
    title: 'StatsKey',
    width: savedBounds?.width ?? 1280,
    height: savedBounds?.height ?? 860,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 980,
    minHeight: 680,
    fullscreen: savedBounds?.fullScreen === true,
    backgroundColor: '#f4f8ff',
    ...MAIN_WINDOW_VISIBILITY_OPTIONS,
    autoHideMenuBar: process.platform !== 'darwin',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 18, y: 23 },
        }
      : process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: {
              color: '#fbfdff',
              symbolColor: '#526b87',
              height: 52,
            },
          }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  })

  mainWindow = window
  menuRendererReady = false
  mainWindowReloadRequested = false
  hardenWindow(window)

  if (savedBounds?.maximized && !savedBounds?.fullScreen) window.maximize()

  let revealedMainWindow = false
  const revealMainWindow = (target) => {
    // Reinforcement reveals (ready-to-show, the fallback timer) must not yank
    // focus away from whatever the user switched to. Only the first reveal
    // and explicit summons steal focus.
    const alreadyOnScreen =
      revealedMainWindow && target.isVisible() && !target.isMinimized()
    revealedMainWindow = true
    if (alreadyOnScreen) return
    bringToCurrentSpace(target)
  }
  const stopRevealLifecycle = installMainWindowRevealLifecycle(
    window,
    revealMainWindow
  )

  const trackNormalWindowBounds = () => {
    if (
      window.isDestroyed() ||
      window.isFullScreen() ||
      window.isMaximized() ||
      window.isMinimized()
    ) {
      return
    }
    lastNormalWindowBounds = window.getBounds()
  }
  trackNormalWindowBounds()
  window.on('resize', trackNormalWindowBounds)
  window.on('move', trackNormalWindowBounds)
  for (const stateEvent of [
    'moved',
    'resized',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen',
  ]) {
    window.on(stateEvent, () => scheduleWindowStateSave(window))
  }

  window.webContents.on('will-prevent-unload', (event) => {
    // The renderer blocks unload while files have unsaved edits. Turn the raw
    // block into a native save prompt instead of silently refusing to close.
    // A reload (View menu, crash recovery) prompts to reload, not close.
    const reloading = mainWindowReloadRequested
    mainWindowReloadRequested = false
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: 'Unsaved changes',
      message: 'You have unsaved changes.',
      detail: reloading
        ? 'Save your open files before reloading, or discard the changes.'
        : 'Save your open files before closing, or discard the changes.',
      buttons: reloading
        ? ['Save All and Reload', 'Discard and Reload', 'Cancel']
        : ['Save All and Close', 'Discard and Close', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })
    if (choice === 0) {
      // Wait for the renderer to acknowledge the save before acting. On
      // failure or timeout the window stays open: the renderer already
      // surfaced the error, and destroying anyway would lose the edits the
      // user explicitly asked to keep.
      const contents = window.webContents
      let settled = false
      let ackTimer = null
      const onCommandComplete = (ackEvent, command, ok) => {
        if (ackEvent.sender !== contents || command !== 'save-all') return
        finish(ok === true)
      }
      const finish = (ok) => {
        if (settled) return
        settled = true
        if (ackTimer) clearTimeout(ackTimer)
        ipcMain.removeListener(
          'statskey-desktop:menu-command-complete',
          onCommandComplete
        )
        if (!ok || window.isDestroyed()) return
        if (reloading) {
          mainWindowReloadRequested = true
          contents.reload()
        } else {
          saveWindowState(window)
          window.destroy()
        }
      }
      ipcMain.on('statskey-desktop:menu-command-complete', onCommandComplete)
      ackTimer = setTimeout(() => finish(false), SAVE_ALL_ACK_TIMEOUT_MS)
      contents.send('statskey-desktop:menu-command', 'save-all')
    } else if (choice === 1) {
      if (reloading) mainWindowReloadRequested = true
      event.preventDefault()
    }
  })

  window.on('close', () => saveWindowState(window))
  window.on('closed', () => {
    cancelRendererOwnedWork()
    stopRevealLifecycle()
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer)
      windowStateSaveTimer = null
    }
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.on('did-start-loading', () => {
    // Each load must re-announce readiness before menu commands are sent.
    menuRendererReady = false
    if (mainWindowReloadRequested) cancelRendererOwnedWork()
  })

  window.webContents.on('did-finish-load', () => {
    // No reveal here: the reveal lifecycle covers startup and summons cover
    // user-initiated restores. A window hidden at did-finish-load (crash
    // auto-reload, offline retry) was hidden deliberately — do not steal
    // focus by re-showing it.
    mainWindowReloadRequested = false
    if (pendingProtocolUrl && isStatsKeyPage(window.webContents.getURL())) {
      sendProtocolUrl(pendingProtocolUrl)
      pendingProtocolUrl = null
    }
  })

  void loadStatsKey(window)
}

function bringToCurrentSpace(window) {
  if (window.isDestroyed()) return
  window.show()
  if (process.platform === 'darwin') {
    // Keep StatsKey attached to one Space. Making it visible on every
    // workspace causes duplicate-looking windows across Mac displays.
    window.setVisibleOnAllWorkspaces(false)
  }
  app.focus({ steal: true })
  window.focus()
  window.moveTop()
}

function summonStatsKey() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    const target = mainWindow
    target.webContents.once('did-finish-load', () => {
      if (!target.isDestroyed()) target.webContents.send('statskey-desktop:summon')
    })
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  bringToCurrentSpace(mainWindow)
  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('statskey-desktop:summon')
  }
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function readWindowState() {
  try {
    const raw = readFileSync(windowStatePath(), 'utf8')
    const state = JSON.parse(raw)
    if (!Number.isFinite(state?.width) || !Number.isFinite(state?.height)) return null
    const bounds = {
      width: Math.min(Math.max(state.width, 980), 5120),
      height: Math.min(Math.max(state.height, 680), 2880),
      x: Number.isFinite(state.x) ? state.x : undefined,
      y: Number.isFinite(state.y) ? state.y : undefined,
      maximized: state.maximized === true,
      fullScreen: state.fullScreen === true,
    }
    if (bounds.x !== undefined && bounds.y !== undefined) {
      const visible = screen.getAllDisplays().some((display) => {
        const area = display.workArea
        return (
          bounds.x >= area.x - 8 &&
          bounds.y >= area.y - 8 &&
          bounds.x < area.x + area.width &&
          bounds.y < area.y + area.height
        )
      })
      if (!visible) {
        bounds.x = undefined
        bounds.y = undefined
      }
    }
    return bounds
  } catch {
    return null
  }
}

function saveWindowState(window) {
  try {
    if (window.isDestroyed()) return
    const normalBounds =
      window.isFullScreen() || window.isMaximized() || window.isMinimized()
        ? lastNormalWindowBounds
        : window.getNormalBounds()
    if (!normalBounds) return
    const state = {
      ...normalBounds,
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    }
    mkdirSync(path.dirname(windowStatePath()), { recursive: true })
    writeFileSync(windowStatePath(), JSON.stringify(state))
  } catch {
    // Window placement memory is a convenience; never block closing on it.
  }
}

function scheduleWindowStateSave(window) {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null
    if (!window.isDestroyed()) saveWindowState(window)
  }, 1000)
  windowStateSaveTimer.unref?.()
}

function isMainRenderer(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !desktopAppOrigin
  ) {
    return false
  }
  try {
    const senderUrl = new URL(event.senderFrame.url)
    if (senderUrl.origin !== desktopAppOrigin) return false
    if (
      app.isPackaged &&
      !(
        senderUrl.protocol === 'http:' &&
        (senderUrl.hostname === 'localhost' ||
          senderUrl.hostname === '127.0.0.1')
      )
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function durableRendererStateDirectory() {
  return path.join(app.getPath('userData'), 'durable-renderer-state')
}

function durableRendererStateDescriptor(key) {
  return typeof key === 'string'
    ? DURABLE_RENDERER_STATE_FILES.get(key)
    : undefined
}

function readDurableRendererState(key) {
  const descriptor = durableRendererStateDescriptor(key)
  if (!descriptor) return null
  const [fileName, maximumBytes] = descriptor
  const filePath = path.join(durableRendererStateDirectory(), fileName)
  try {
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size > maximumBytes) return null
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

function writeDurableRendererState(key, value) {
  const descriptor = durableRendererStateDescriptor(key)
  if (!descriptor || (typeof value !== 'string' && value !== null)) return false
  const [fileName, maximumBytes] = descriptor
  const directory = durableRendererStateDirectory()
  const filePath = path.join(directory, fileName)
  try {
    if (value === null) {
      if (existsSync(filePath)) unlinkSync(filePath)
      return true
    }
    if (Buffer.byteLength(value, 'utf8') > maximumBytes) return false
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, value, {
      encoding: 'utf8',
      mode: 0o600,
    })
    renameSync(temporaryPath, filePath)
    return true
  } catch {
    return false
  }
}

function workspaceStatePath() {
  return path.join(app.getPath('userData'), 'workspace-state.json')
}

function cursorWorkspaceStoragePath() {
  return path.join(
    app.getPath('appData'),
    'Cursor',
    'User',
    'globalStorage',
    'storage.json'
  )
}

function importCursorWorkspaceCatalog() {
  try {
    let cursorLocations = []
    const storagePath = cursorWorkspaceStoragePath()
    if (existsSync(storagePath)) {
      try {
        cursorLocations = cursorWorkspaceLocations(
          JSON.parse(readFileSync(storagePath, 'utf8'))
        )
      } catch {
        cursorLocations = []
      }
    }

    const activeLocations = [...workspaceRoots].reverse()
    const activeLocationSet = new Set(activeLocations)
    const candidates = [
      ...cursorLocations.filter(
        (candidate) => !activeLocationSet.has(candidate)
      ),
      ...activeLocations,
    ]
    const uniqueCandidates = [...new Set(candidates)]
    const discoveredIds = new Set()
    const discoveredRootSets = []
    let imported = 0
    let skipped = 0
    const now = Date.now()

    uniqueCandidates.forEach((candidate, index) => {
      const definition = cursorWorkspaceDefinition(candidate)
      if (!definition) {
        skipped += 1
        return
      }
      const id = workspaceIdentity(definition.roots, [])
      if (discoveredIds.has(id)) return
      discoveredIds.add(id)
      discoveredRootSets.push(definition.roots)
      const existingIndex = recentWorkspaces.findIndex((item) => item.id === id)
      const existing =
        existingIndex >= 0 ? recentWorkspaces[existingIndex] : null
      const entry = {
        id,
        name: existing?.saved ? existing.name : definition.name,
        roots: definition.roots,
        looseFiles: [],
        importedWorkspace:
          definition.importedWorkspace ??
          (existing?.importedWorkspace
            ? { ...existing.importedWorkspace }
            : null),
        lastOpenedAt: new Date(
          now - Math.max(0, uniqueCandidates.length - index) * 1_000
        ).toISOString(),
        saved: true,
      }
      if (!existing || !existing.saved) imported += 1
      if (existingIndex >= 0) recentWorkspaces.splice(existingIndex, 1)
      recentWorkspaces.push(entry)
    })

    for (let index = recentWorkspaces.length - 1; index >= 0; index -= 1) {
      const workspace = recentWorkspaces[index]
      const generated =
        !workspace.saved &&
        workspace.roots.length > 1 &&
        workspace.name.replace(/\s*\+\s*/g, ' +') ===
          defaultWorkspaceLabel(workspace.roots).replace(/\s*\+\s*/g, ' +')
      const superseded =
        generated &&
        discoveredRootSets.some(
          (roots) =>
            roots.length > workspace.roots.length &&
            workspace.roots.every((root) => roots.includes(root))
        )
      if (superseded) recentWorkspaces.splice(index, 1)
    }

    if (discoveredIds.size === 0) {
      return {
        ok: false,
        imported: 0,
        total: 0,
        skipped,
        error: 'No available Cursor workspaces were found on this device.',
      }
    }

    trimRecentWorkspaces()
    saveWorkspaceState({ remember: false })
    return {
      ok: true,
      imported,
      total: discoveredIds.size,
      skipped,
    }
  } catch (error) {
    return {
      ok: false,
      imported: 0,
      total: 0,
      skipped: 0,
      error: safeProviderError(error),
    }
  }
}

function cursorWorkspaceDefinition(candidate) {
  const resolved = canonicalExistingPath(candidate)
  if (!resolved) return null
  const stats = statSync(resolved)
  if (stats.isDirectory()) {
    const home = path.resolve(app.getPath('home'))
    const broadContainers = new Set([
      home,
      path.join(home, 'Projects'),
    ])
    if (broadContainers.has(resolved)) return null
    return {
      name: path.basename(resolved).trim() || 'Workspace',
      roots: [resolved],
      importedWorkspace: null,
    }
  }
  if (
    !stats.isFile() ||
    path.extname(resolved).toLowerCase() !== '.code-workspace'
  ) {
    return null
  }
  try {
    const definition = resolveWorkspaceDefinitionFile(resolved, {
      readFile: (workspaceFile) => readFileSync(workspaceFile),
      resolveFile: (workspaceFile) => {
        const file = canonicalExistingPath(workspaceFile)
        return file && statSync(file).isFile() ? file : null
      },
      resolveDirectory: (workspaceFolder) => {
        const directory = canonicalExistingPath(workspaceFolder)
        return directory && statSync(directory).isDirectory()
          ? directory
          : null
      },
      maxBytes: MAX_WORKSPACE_FILE_BYTES,
    })
    const name = workspaceImportLabel(definition.name, definition.roots)
    return {
      name,
      roots: definition.roots,
      importedWorkspace: {
        name,
        sourcePath: definition.sourcePath,
        importedFolders: definition.roots.length,
        missingFolders: definition.missingFolders,
      },
    }
  } catch {
    return null
  }
}

function workspaceIndexPath() {
  return path.join(app.getPath('userData'), 'workspace-index', 'index-v1.json')
}

function initializeWorkspaceIndex() {
  if (workspaceIndexWorker) return
  workspaceIndexWorker = new Worker(
    path.join(__dirname, 'workspace-index-worker.cjs')
  )
  workspaceIndexWorker.on('message', (message) => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'status') {
      workspaceIndexStatus = {
        ...workspaceIndexStatus,
        ...message,
      }
      delete workspaceIndexStatus.type
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          'statskey-desktop:workspace-index-state',
          { ...workspaceIndexStatus }
        )
      }
      return
    }
    if (message.type === 'search-result') {
      const pending = workspaceIndexRequests.get(message.requestId)
      if (!pending) return
      workspaceIndexRequests.delete(message.requestId)
      clearTimeout(pending.timeout)
      pending.resolve(Array.isArray(message.results) ? message.results : [])
    }
  })
  workspaceIndexWorker.on('error', (error) => {
    workspaceIndexStatus = {
      ...workspaceIndexStatus,
      status: 'error',
      error: safeProviderError(error),
    }
  })
  workspaceIndexWorker.on('exit', () => {
    workspaceIndexWorker = null
    for (const pending of workspaceIndexRequests.values()) {
      clearTimeout(pending.timeout)
      pending.resolve([])
    }
    workspaceIndexRequests.clear()
  })
  if (!workspaceIndexInterval) {
    workspaceIndexInterval = setInterval(() => {
      if (workspaceIndexStatus.status !== 'indexing') {
        scheduleWorkspaceIndex(0)
      }
    }, 60_000)
    workspaceIndexInterval.unref?.()
  }
}

function scheduleWorkspaceIndex(delay = 900) {
  if (workspaceIndexTimer) clearTimeout(workspaceIndexTimer)
  workspaceIndexTimer = setTimeout(() => {
    workspaceIndexTimer = null
    initializeWorkspaceIndex()
    initializeWorkspaceFileSearch()
    const roots = workspaceRoots.map((root) => ({
      path: root,
      name: path.basename(root),
    }))
    const looseFiles = [...workspaceLooseFiles]
    workspaceIndexWorker?.postMessage({
      type: 'build',
      roots,
      looseFiles,
      cachePath: workspaceIndexPath(),
      cacheKey: workspaceIndexEncryptionKey(),
    })
    workspaceFileSearchWorker?.postMessage({
      type: 'build',
      roots,
      looseFiles,
    })
  }, Math.max(0, delay))
  workspaceIndexTimer.unref?.()
}

function searchWorkspaceIndex(rawQuery, rawMode) {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
  if (!query || query.length > 200) {
    return Promise.resolve([])
  }
  const normalizedMode = rawMode === 'concept' ? 'fuzzy' : rawMode
  const mode = ['hybrid', 'files', 'content', 'symbols', 'fuzzy'].includes(
    normalizedMode
  )
    ? normalizedMode
    : 'hybrid'
  if (mode === 'files') return searchWorkspaceFileNames(query)
  if (!workspaceIndexWorker) return Promise.resolve([])
  const requestId = crypto.randomUUID()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      workspaceIndexRequests.delete(requestId)
      resolve([])
    }, 10_000)
    workspaceIndexRequests.set(requestId, { resolve, timeout })
    workspaceIndexWorker.postMessage({
      type: 'search',
      requestId,
      query,
      mode,
    })
  })
}

function searchWorkspaceFileNames(query) {
  initializeWorkspaceFileSearch()
  if (!workspaceFileSearchWorker) return Promise.resolve([])
  const requestId = crypto.randomUUID()
  const worker = workspaceFileSearchWorker
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!workspaceFileSearchRequests.delete(requestId)) return
      resolve([])
      if (workspaceFileSearchWorker === worker) {
        workspaceFileSearchWorker = null
        void worker.terminate()
      }
      for (const pending of workspaceFileSearchRequests.values()) {
        clearTimeout(pending.timeout)
        pending.resolve([])
      }
      workspaceFileSearchRequests.clear()
    }, 1_200)
    workspaceFileSearchRequests.set(requestId, { resolve, timeout })
    worker.postMessage({
      type: 'search',
      requestId,
      query,
      roots: workspaceRoots.map((root) => ({
        path: root,
        name: path.basename(root),
      })),
      looseFiles: [...workspaceLooseFiles],
    })
  })
}

function initializeWorkspaceFileSearch() {
  if (workspaceFileSearchWorker) return
  const worker = new Worker(
    path.join(__dirname, 'workspace-file-search-worker.cjs')
  )
  workspaceFileSearchWorker = worker
  worker.on('message', (message) => {
    if (!message || message.type !== 'search-result') return
    const pending = workspaceFileSearchRequests.get(message.requestId)
    if (!pending) return
    workspaceFileSearchRequests.delete(message.requestId)
    clearTimeout(pending.timeout)
    pending.resolve(Array.isArray(message.results) ? message.results : [])
  })
  worker.on('error', () => {
    if (workspaceFileSearchWorker === worker) workspaceFileSearchWorker = null
  })
  worker.on('exit', () => {
    if (workspaceFileSearchWorker === worker) workspaceFileSearchWorker = null
    for (const [requestId, pending] of workspaceFileSearchRequests) {
      clearTimeout(pending.timeout)
      pending.resolve([])
      workspaceFileSearchRequests.delete(requestId)
    }
  })
}

function restoreWorkspaceState() {
  try {
    const state = JSON.parse(readFileSync(workspaceStatePath(), 'utf8'))
    const storedRoots = Array.isArray(state?.roots)
      ? state.roots
      : state?.root
        ? [state.root]
        : []
    for (const candidate of storedRoots) {
      const root = canonicalExistingPath(candidate)
      if (root && statSync(root).isDirectory() && !workspaceRoots.includes(root)) {
        workspaceRoots.push(root)
      }
    }
    for (const candidate of Array.isArray(state?.looseFiles) ? state.looseFiles : []) {
      const file = canonicalExistingPath(candidate)
      if (file && statSync(file).isFile()) workspaceLooseFiles.add(file)
    }
    importedWorkspace = decodeImportedWorkspace(
      state?.importedWorkspace ?? state?.cursorWorkspace
    )
    for (const candidate of Array.isArray(state?.recentWorkspaces)
      ? state.recentWorkspaces
      : []) {
      const recent = decodeRecentWorkspace(candidate)
      if (recent && !recentWorkspaces.some((item) => item.id === recent.id)) {
        recentWorkspaces.push(recent)
      }
    }
    rememberCurrentWorkspace()
  } catch {
    workspaceRoots.length = 0
    workspaceLooseFiles.clear()
    importedWorkspace = null
    recentWorkspaces.length = 0
  }
}

function saveWorkspaceState({ remember = true } = {}) {
  try {
    if (remember) rememberCurrentWorkspace()
    mkdirSync(path.dirname(workspaceStatePath()), { recursive: true })
    writeFileSync(
      workspaceStatePath(),
      JSON.stringify({
        roots: workspaceRoots,
        looseFiles: [...workspaceLooseFiles],
        importedWorkspace,
        recentWorkspaces,
      })
    )
  } catch {
    // Workspace recents are a convenience; never block file access on them.
  }
  announceWorkspaceStateChange()
}

function announceWorkspaceStateChange() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isDestroyed()
  ) {
    return
  }
  mainWindow.webContents.send(
    'statskey-desktop:workspace-state-changed',
    workspaceSnapshot()
  )
}

function rememberCurrentWorkspace() {
  if (workspaceRoots.length === 0) return
  const roots = [...workspaceRoots]
  const looseFiles = [...workspaceLooseFiles]
  const id = workspaceIdentity(roots, looseFiles)
  const existing = recentWorkspaces.find((item) => item.id === id)
  const entry = {
    id,
    name: existing?.saved
      ? existing.name
      : importedWorkspace?.name ||
        (roots.length === 1
          ? path.basename(roots[0])
          : `${path.basename(roots[0])} + ${roots.length - 1}`),
    roots,
    looseFiles,
    importedWorkspace: importedWorkspace
      ? { ...importedWorkspace }
      : null,
    lastOpenedAt: new Date().toISOString(),
    saved: existing?.saved === true,
  }
  const existingIndex = recentWorkspaces.findIndex((item) => item.id === id)
  if (existingIndex >= 0) recentWorkspaces.splice(existingIndex, 1)
  recentWorkspaces.unshift(entry)
  trimRecentWorkspaces()
}

function trimRecentWorkspaces() {
  const saved = recentWorkspaces.filter((item) => item.saved).slice(0, 80)
  const recent = recentWorkspaces
    .filter((item) => !item.saved)
    .slice(0, Math.max(0, 24 - Math.min(saved.length, 16)))
  recentWorkspaces.splice(0, recentWorkspaces.length, ...saved, ...recent)
  recentWorkspaces.sort(
    (left, right) =>
      Number(right.saved) - Number(left.saved) ||
      String(right.lastOpenedAt).localeCompare(String(left.lastOpenedAt))
  )
}

function decodeImportedWorkspace(candidate) {
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.name !== 'string' ||
    !candidate.name.trim()
  ) {
    return null
  }
  return {
    name: candidate.name.trim().slice(0, 240),
    sourcePath:
      typeof candidate.sourcePath === 'string'
        ? candidate.sourcePath.slice(0, 4_096)
        : null,
    importedFolders: Math.max(0, Number(candidate.importedFolders || 0)),
    missingFolders: Math.max(0, Number(candidate.missingFolders || 0)),
  }
}

function decodeRecentWorkspace(candidate) {
  if (!candidate || typeof candidate !== 'object') return null
  const roots = Array.isArray(candidate.roots)
    ? candidate.roots.filter((value) => typeof value === 'string').slice(0, 24)
    : []
  if (roots.length === 0) return null
  const looseFiles = Array.isArray(candidate.looseFiles)
    ? candidate.looseFiles
        .filter((value) => typeof value === 'string')
        .slice(0, 100)
    : []
  return {
    id: workspaceIdentity(roots, looseFiles),
    name:
      typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim().slice(0, 240)
        : path.basename(roots[0]),
    roots,
    looseFiles,
    importedWorkspace: decodeImportedWorkspace(
      candidate.importedWorkspace ?? candidate.cursorWorkspace
    ),
    lastOpenedAt:
      typeof candidate.lastOpenedAt === 'string'
        ? candidate.lastOpenedAt
        : new Date(0).toISOString(),
    saved: candidate.saved === true,
  }
}

function publicRecentWorkspace(workspace) {
  const availableRoots = workspace.roots.filter((candidate) => {
    const root = canonicalExistingPath(candidate)
    return root ? statSync(root).isDirectory() : false
  })
  return {
    id: workspace.id,
    name: workspace.name,
    roots: workspace.roots,
    rootCount: workspace.roots.length,
    availableRootCount: availableRoots.length,
    lastOpenedAt: workspace.lastOpenedAt,
    saved: workspace.saved === true,
  }
}

function saveCurrentWorkspace(rawName) {
  try {
    if (workspaceRoots.length === 0) throw new Error('Open at least one folder first.')
    const name = typeof rawName === 'string' ? rawName.trim().slice(0, 120) : ''
    if (!name) throw new Error('Give this workspace a name.')
    rememberCurrentWorkspace()
    const id = workspaceIdentity([...workspaceRoots], [...workspaceLooseFiles])
    const entry = recentWorkspaces.find((item) => item.id === id)
    if (!entry) throw new Error('The workspace could not be saved.')
    entry.name = name
    entry.saved = true
    entry.lastOpenedAt = new Date().toISOString()
    trimRecentWorkspaces()
    saveWorkspaceState({ remember: false })
    return { ok: true, project: publicRecentWorkspace(entry) }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function renameRecentWorkspace(workspaceId, rawName) {
  try {
    const entry = recentWorkspaces.find((item) => item.id === workspaceId)
    if (!entry) throw new Error('That workspace is no longer available.')
    const name = typeof rawName === 'string' ? rawName.trim().slice(0, 120) : ''
    if (!name) throw new Error('Give this workspace a name.')
    entry.name = name
    entry.saved = true
    saveWorkspaceState({ remember: false })
    return { ok: true, project: publicRecentWorkspace(entry) }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function removeRecentWorkspace(workspaceId) {
  if (typeof workspaceId !== 'string') return false
  const index = recentWorkspaces.findIndex((item) => item.id === workspaceId)
  if (index < 0) return false
  recentWorkspaces.splice(index, 1)
  saveWorkspaceState({ remember: false })
  return true
}

function openRecentWorkspace(workspaceId) {
  try {
    if (typeof workspaceId !== 'string') {
      throw new Error('Choose a recent project.')
    }
    const recent = recentWorkspaces.find((item) => item.id === workspaceId)
    if (!recent) throw new Error('That recent project is no longer available.')
    const roots = recent.roots
      .map(canonicalExistingPath)
      .filter(
        (candidate) => candidate && statSync(candidate).isDirectory()
      )
    if (roots.length === 0) {
      throw new Error('The project folder is missing or unavailable.')
    }
    workspaceRoots.splice(0, workspaceRoots.length, ...roots)
    workspaceLooseFiles.clear()
    for (const candidate of recent.looseFiles) {
      const file = canonicalExistingPath(candidate)
      if (file && statSync(file).isFile()) workspaceLooseFiles.add(file)
    }
    importedWorkspace = recent.importedWorkspace
      ? { ...recent.importedWorkspace }
      : null
    saveWorkspaceState()
    scheduleWorkspaceIndex(0)
    return { ok: true, workspace: workspaceSnapshot() }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function removeWorkspaceRoot(rootPath) {
  try {
    const root = canonicalExistingPath(rootPath)
    const index = root ? workspaceRoots.indexOf(root) : -1
    if (index < 0) throw new Error('That folder is not in this workspace.')
    workspaceRoots.splice(index, 1)
    importedWorkspace = null
    saveWorkspaceState()
    scheduleWorkspaceIndex(0)
    return { ok: true, workspace: workspaceSnapshot() }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function cloneWorkspaceProject(repositoryUrl) {
  try {
    const normalizedUrl = validatedGitCloneUrl(repositoryUrl)
    const projectName = cloneProjectName(normalizedUrl)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Clone a project',
      buttonLabel: 'Clone here',
      defaultPath: path.join(app.getPath('documents'), projectName),
      showsTagField: false,
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true }
    }
    const target = path.resolve(result.filePath)
    const parent = canonicalExistingPath(path.dirname(target))
    if (!parent || !statSync(parent).isDirectory()) {
      throw new Error('Choose an available parent folder.')
    }
    if (
      existsSync(target) &&
      (!statSync(target).isDirectory() || readdirSync(target).length > 0)
    ) {
      throw new Error('Choose a new or empty project folder.')
    }
    const clone = await spawnWorkspaceProcess(
      'git',
      ['clone', '--progress', '--', normalizedUrl, target],
      parent,
      10 * 60 * 1000
    )
    if (!clone.ok) {
      throw new Error(
        clone.stderr || clone.error || 'Git could not clone this repository.'
      )
    }
    const selected = canonicalExistingPath(target)
    if (!selected || !statSync(selected).isDirectory()) {
      throw new Error('The cloned project folder is unavailable.')
    }
    workspaceRoots.splice(0, workspaceRoots.length, selected)
    workspaceLooseFiles.clear()
    importedWorkspace = null
    saveWorkspaceState()
    scheduleWorkspaceIndex(0)
    return { ok: true, workspace: workspaceSnapshot() }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function validatedGitCloneUrl(repositoryUrl) {
  if (
    typeof repositoryUrl !== 'string' ||
    !repositoryUrl.trim() ||
    repositoryUrl.length > 2_048 ||
    /[\r\n\0]/.test(repositoryUrl)
  ) {
    throw new Error('Enter a valid repository URL.')
  }
  const value = repositoryUrl.trim()
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+(?:\.git)?$/.test(value)) {
    return value
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Use an HTTPS or SSH repository URL.')
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') ||
    !parsed.hostname ||
    parsed.password ||
    (parsed.username && parsed.protocol === 'https:')
  ) {
    throw new Error('Use an HTTPS or SSH repository URL without embedded credentials.')
  }
  return parsed.toString()
}

function cloneProjectName(repositoryUrl) {
  const pathPart = repositoryUrl.includes('://')
    ? new URL(repositoryUrl).pathname
    : repositoryUrl.slice(repositoryUrl.indexOf(':') + 1)
  return (
    pathPart
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/\.git$/i, '')
      .replace(/[^A-Za-z0-9._ -]/g, '')
      .trim()
      .slice(0, 120) || 'Cloned Project'
  )
}

function canonicalExistingPath(candidate) {
  if (typeof candidate !== 'string' || !candidate) return null
  try {
    return realpathSync(candidate)
  } catch {
    return null
  }
}

function pathInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function allowedWorkspacePath(candidate) {
  const resolved = canonicalExistingPath(candidate)
  if (!resolved) return false
  if (workspaceOperationRoots().some((root) => pathInsideRoot(resolved, root))) {
    return true
  }
  return workspaceOperationLooseFiles().has(resolved)
}

function validateDeviceArtifact(candidate, platform) {
  const resolved = canonicalExistingPath(candidate)
  if (!resolved || !allowedWorkspacePath(resolved)) {
    throw new Error('Choose an existing app artifact inside the bound workspace.')
  }
  const stats = statSync(resolved)
  if (platform === 'ios') {
    if (!stats.isDirectory() || path.extname(resolved).toLowerCase() !== '.app') {
      throw new Error('iOS Simulator installs require a workspace .app bundle.')
    }
  } else if (platform === 'android') {
    if (!stats.isFile() || path.extname(resolved).toLowerCase() !== '.apk') {
      throw new Error('Android Emulator installs require a workspace .apk file.')
    }
  } else {
    throw new Error('Choose iOS Simulator or Android Emulator.')
  }
  return resolved
}

function validateDeviceMedia(candidate) {
  const resolved = canonicalExistingPath(candidate)
  if (!resolved || !allowedWorkspacePath(resolved)) {
    throw new Error('Choose an existing media file inside the bound workspace.')
  }
  const stats = statSync(resolved)
  const supportedExtensions = new Set([
    '.bmp', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.m4v', '.mov', '.mp4',
    '.png', '.tif', '.tiff', '.webp',
  ])
  if (!stats.isFile() || !supportedExtensions.has(path.extname(resolved).toLowerCase())) {
    throw new Error('Device media import requires a supported workspace photo or video file.')
  }
  return resolved
}

function workspaceRootForPath(candidate) {
  return (
    workspaceOperationRoots().find((root) => pathInsideRoot(candidate, root)) ||
    null
  )
}

function workspaceIgnoredPath(candidate) {
  const root = workspaceRootForPath(candidate)
  if (!root) return false
  const relative = path.relative(root, candidate).split(path.sep).join('/')
  if (!relative || relative === '.cursorignore' || relative === '.gitignore') {
    return false
  }
  const patterns = workspaceIgnorePatterns(root)
  let ignored = false
  for (const raw of patterns) {
    const negate = raw.startsWith('!')
    const pattern = negate ? raw.slice(1) : raw
    if (!pattern) continue
    const matches =
      minimatch(relative, pattern, { dot: true, matchBase: !pattern.includes('/') }) ||
      minimatch(`${relative}/`, pattern, { dot: true })
    if (matches) ignored = !negate
  }
  return ignored
}

function workspaceIgnorePatterns(root) {
  const files = [
    path.join(root, '.gitignore'),
    path.join(root, '.cursorignore'),
  ]
  const signature = files
    .map((file) => {
      try {
        return `${file}:${statSync(file).mtimeMs}`
      } catch {
        return `${file}:missing`
      }
    })
    .join('|')
  const cached = workspaceIgnoreCache.get(root)
  if (cached?.signature === signature) return cached.patterns
  const patterns = []
  for (const file of files) {
    const content = readBoundedText(file, 200_000)
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      patterns.push(trimmed.replace(/^\//, ''))
    }
  }
  workspaceIgnoreCache.set(root, { signature, patterns })
  return patterns
}

function workspaceNode(candidate) {
  const resolved = canonicalExistingPath(candidate)
  if (!resolved || !allowedWorkspacePath(resolved)) return null
  try {
    const stats = statSync(resolved)
    const containingRoot = workspaceRootForPath(resolved)
    return {
      name: path.basename(resolved),
      path: resolved,
      kind: stats.isDirectory() ? 'directory' : 'file',
      extension: stats.isFile() ? path.extname(resolved).slice(1).toLowerCase() : '',
      size: stats.isFile() ? stats.size : null,
      modifiedAt: stats.mtime.toISOString(),
      relativePath: containingRoot
        ? workspaceDisplayPath(resolved, workspaceOperationRoots())
        : path.basename(resolved),
    }
  } catch {
    return null
  }
}

function importWorkspaceFile(candidate) {
  const definition = resolveWorkspaceDefinitionFile(candidate, {
    readFile: (workspaceFile) => readFileSync(workspaceFile),
    resolveFile: (workspaceFile) => {
      const resolved = canonicalExistingPath(workspaceFile)
      return resolved && statSync(resolved).isFile() ? resolved : null
    },
    resolveDirectory: (workspaceFolder) => {
      const resolved = canonicalExistingPath(workspaceFolder)
      return resolved && statSync(resolved).isDirectory() ? resolved : null
    },
    maxBytes: MAX_WORKSPACE_FILE_BYTES,
  })
  const selectedRoots = definition.roots
  const importedName = workspaceImportLabel(definition.name, selectedRoots)
  workspaceRoots.splice(0, workspaceRoots.length, ...selectedRoots)
  workspaceLooseFiles.clear()
  importedWorkspace = {
    name: importedName,
    sourcePath: definition.sourcePath,
    importedFolders: selectedRoots.length,
    missingFolders: definition.missingFolders,
  }
  saveWorkspaceState()
  saveCurrentWorkspace(importedName)
  scheduleWorkspaceIndex()
  return workspaceSnapshot()
}

function workspaceImportLabel(sourceName, roots) {
  const label = String(sourceName || '')
    .replace(/\.(?:code-workspace|json)$/i, '')
    .trim()
  return !label || /^workspace$/i.test(label)
    ? defaultWorkspaceLabel(roots)
    : label.slice(0, 120)
}

function workspaceSnapshot() {
  const operation = workspaceBindingRuntime.activeSnapshot()
  const operationRoots = operation?.roots || workspaceRoots
  const operationLooseFiles = operation?.looseFiles || workspaceLooseFiles
  const operationImportedWorkspace = operation
    ? operation.importedWorkspace
    : importedWorkspace
  const roots = operationRoots
    .map(workspaceNode)
    .filter(Boolean)
  const statsKeySource = operationRoots
    .map(inspectStatsKeySource)
    .find(Boolean) || null
  const snapshot = {
    workspaceId:
      operation?.workspaceId ||
      currentWorkspaceIdentity(operationRoots, [...operationLooseFiles]),
    roots,
    root: roots[0] || null,
    statsKeySource,
    importedWorkspace: operationImportedWorkspace,
    looseFiles: [...operationLooseFiles]
      .map(workspaceNode)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
  if (snapshot.workspaceId) {
    workspaceBindingRuntime.remember({
      workspaceId: snapshot.workspaceId,
      roots: operationRoots,
      looseFiles: operationLooseFiles,
      importedWorkspace: operationImportedWorkspace,
    })
  }
  return snapshot
}

function currentWorkspaceId() {
  return currentWorkspaceIdentity(
    [...workspaceRoots],
    [...workspaceLooseFiles]
  )
}

function assertCurrentWorkspaceBinding(binding) {
  return workspaceBindingRuntime.assert(binding)
}

function withWorkspaceOperationBinding(binding, task) {
  return workspaceBindingRuntime.run(binding, task)
}

function activeWorkspaceOperationSnapshot() {
  const workspaceId = currentWorkspaceId()
  return workspaceId
    ? {
        workspaceId,
        roots: [...workspaceRoots],
        looseFiles: [...workspaceLooseFiles],
        importedWorkspace: importedWorkspace
          ? { ...importedWorkspace }
          : null,
      }
    : null
}

function recentWorkspaceOperationSnapshot(workspaceId) {
  const recent = recentWorkspaces.find((entry) => entry.id === workspaceId)
  if (!recent) return null
  const roots = recent.roots
    .map(canonicalExistingPath)
    .filter((candidate) => candidate && statSync(candidate).isDirectory())
  const looseFiles = recent.looseFiles
    .map(canonicalExistingPath)
    .filter((candidate) => candidate && statSync(candidate).isFile())
  if (
    roots.length !== recent.roots.length ||
    looseFiles.length !== recent.looseFiles.length ||
    currentWorkspaceIdentity(roots, looseFiles) !== workspaceId
  ) {
    return null
  }
  return {
    workspaceId,
    roots,
    looseFiles,
    importedWorkspace: recent.importedWorkspace
      ? { ...recent.importedWorkspace }
      : null,
  }
}

function workspaceOperationRoots() {
  return workspaceBindingRuntime.activeSnapshot()?.roots || workspaceRoots
}

function workspaceOperationLooseFiles() {
  return (
    workspaceBindingRuntime.activeSnapshot()?.looseFiles ||
    workspaceLooseFiles
  )
}

function workspaceOperationUsesOpenWorkspace() {
  const operation = workspaceBindingRuntime.activeSnapshot()
  return !operation || operation.workspaceId === currentWorkspaceId()
}

function activateWorkspaceRoot(rootPath) {
  const selected = canonicalExistingPath(rootPath)
  if (!selected || !statSync(selected).isDirectory()) return null
  workspaceRoots.splice(0, workspaceRoots.length, selected)
  workspaceLooseFiles.clear()
  importedWorkspace = null
  saveWorkspaceState()
  scheduleWorkspaceIndex(0)
  return workspaceSnapshot()
}

function listWorkspaceDirectory(directoryPath) {
  const listing = readWorkspaceDirectoryEntries(
    directoryPath || workspaceOperationRoots()[0],
    { isAllowed: allowedWorkspacePath }
  )
  return listing.entries
    .filter((entry) => !WORKSPACE_IGNORED_NAMES.has(entry.name))
    .map((entry) => workspaceNode(path.join(listing.path, entry.name)))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
}

function readWorkspaceFile(filePath) {
  const resolved = canonicalExistingPath(filePath)
  if (!resolved || !allowedWorkspacePath(resolved)) return null
  try {
    const stats = statSync(resolved)
    if (!stats.isFile()) return null
    if (stats.size > MAX_WORKSPACE_FILE_BYTES) {
      return {
        ...workspaceNode(resolved),
        content: null,
        binary: false,
        tooLarge: true,
        language: languageForPath(resolved),
      }
    }
    const bytes = readFileSync(resolved)
    const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
    const binary = sample.includes(0)
    return {
      ...workspaceNode(resolved),
      content: binary ? null : bytes.toString('utf8'),
      binary,
      tooLarge: false,
      language: languageForPath(resolved),
    }
  } catch {
    return null
  }
}

function readWorkspaceMedia(filePath) {
  const resolved = canonicalExistingPath(filePath)
  if (!resolved || !allowedWorkspacePath(resolved)) return null
  try {
    const stats = statSync(resolved)
    if (!stats.isFile() || stats.size > MAX_WORKSPACE_MEDIA_BYTES) return null
    const extension = path.extname(resolved).toLowerCase()
    const mediaTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
    }
    const mediaType = mediaTypes[extension]
    if (!mediaType) return null
    return {
      name: path.basename(resolved),
      relativePath: workspaceNode(resolved)?.relativePath || path.basename(resolved),
      mediaType,
      data: readFileSync(resolved).toString('base64'),
      size: stats.size,
    }
  } catch {
    return null
  }
}

function searchWorkspace(rawQuery) {
  return searchWorkspaceDirect(rawQuery, {
    roots: workspaceOperationRoots(),
    looseFiles: [...workspaceOperationLooseFiles()],
    canonicalize: canonicalExistingPath,
    isAllowed: allowedWorkspacePath,
    containingRootFor: workspaceRootForPath,
    isIgnored: workspaceIgnoredPath,
    nodeForPath: workspaceNode,
    ignoredNames: WORKSPACE_IGNORED_NAMES,
    maxFiles: MAX_WORKSPACE_SEARCH_FILES,
    maxBytes: MAX_WORKSPACE_SEARCH_BYTES,
  })
}

function languageForPath(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const names = {
    cjs: 'javascript',
    css: 'css',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    kt: 'kotlin',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'shell',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  }
  return names[extension] || extension || 'text'
}

function normalizedDesktopOperationOrigin(candidate) {
  if (!candidate || typeof candidate !== 'object') return null
  const sessionId =
    typeof candidate.sessionId === 'string'
      ? candidate.sessionId.slice(0, 160)
      : undefined
  const messageId =
    typeof candidate.messageId === 'string'
      ? candidate.messageId.slice(0, 160)
      : undefined
  return sessionId || messageId ? { sessionId, messageId } : null
}

function withDesktopOperationOrigin(origin, task, binding) {
  return withWorkspaceOperationBinding(binding, () =>
    desktopOperationOrigin.run(
      normalizedDesktopOperationOrigin(origin),
      task
    )
  )
}

async function requestDesktopOperationApproval(operation, approvalMode) {
  if (shouldAutoApprove(operation.kind, approvalMode)) return true
  if (!mainWindow || mainWindow.isDestroyed()) return false
  bringToCurrentSpace(mainWindow)
  const operationId = crypto.randomUUID()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDesktopApprovals.delete(operationId)
      resolve(false)
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send(
          'statskey-desktop:operation-settled',
          { id: operationId, reason: 'expired' }
        )
      }
    }, 5 * 60 * 1000)
    pendingDesktopApprovals.set(operationId, { resolve, timeout })
    mainWindow.webContents.send('statskey-desktop:operation-request', {
      ...operation,
      id: operationId,
      origin: desktopOperationOrigin.getStore() || undefined,
    })
  })
}

function checkpointDirectory() {
  return path.join(app.getPath('userData'), 'workspace-checkpoints')
}

let workspaceCheckpointStore = null

function currentWorkspaceCheckpointStore() {
  if (workspaceCheckpointStore) return workspaceCheckpointStore
  workspaceCheckpointStore = new WorkspaceCheckpointStore({
    directory: checkpointDirectory(),
    keyPath: path.join(app.getPath('userData'), 'workspace-checkpoints.key'),
    legacyCrypto: safeStorageCrypto,
  })
  return workspaceCheckpointStore
}

function captureCheckpointFile(filePath) {
  if (!existsSync(filePath)) {
    return { path: filePath, existed: false, content: null, mode: null }
  }
  const stats = statSync(filePath)
  if (!stats.isFile() || stats.size > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error('Checkpoint supports text files up to 2 MB.')
  }
  return {
    path: filePath,
    existed: true,
    content: readFileSync(filePath).toString('base64'),
    mode: stats.mode,
  }
}

async function createWorkspaceCheckpoint(paths, label) {
  const uniquePaths = [...new Set(paths)]
  const checkpoint = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    label: String(label || 'Workspace change').slice(0, 240),
    files: uniquePaths.map(captureCheckpointFile),
  }
  const metadata = await currentWorkspaceCheckpointStore().create(checkpoint)
  return { metadata, files: checkpoint.files }
}

async function readWorkspaceCheckpoint(checkpointId) {
  return await currentWorkspaceCheckpointStore().read(checkpointId)
}

async function listWorkspaceCheckpoints() {
  return await currentWorkspaceCheckpointStore().list(100)
}

function assertCheckpointFilesUnchanged(files) {
  for (const file of files) {
    if (!file.existed) {
      if (existsSync(file.path)) {
        throw new Error(
          `${path.basename(file.path)} changed while its safety checkpoint was being saved.`
        )
      }
      continue
    }
    if (!existsSync(file.path)) {
      throw new Error(
        `${path.basename(file.path)} changed while its safety checkpoint was being saved.`
      )
    }
    const stats = statSync(file.path)
    if (
      !stats.isFile() ||
      stats.mode !== file.mode ||
      readFileSync(file.path).toString('base64') !== file.content
    ) {
      throw new Error(
        `${path.basename(file.path)} changed while its safety checkpoint was being saved.`
      )
    }
  }
}

function atomicWriteText(filePath, content, mode) {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.statskey-${crypto.randomUUID()}.tmp`
  )
  writeFileSync(temporary, content, { encoding: 'utf8', mode: mode || 0o644 })
  renameSync(temporary, filePath)
}

async function writeWorkspaceTextFile(
  filePath,
  content,
  approvalMode,
  expectedModifiedAt,
  binding
) {
  try {
    assertCurrentWorkspaceBinding(binding)
    const resolved = canonicalExistingPath(filePath)
    if (!resolved || !allowedWorkspacePath(resolved)) {
      throw new Error('File is outside the open workspace.')
    }
    const stats = statSync(resolved)
    if (!stats.isFile()) throw new Error('Only files can be edited.')
    if (typeof expectedModifiedAt === 'string') {
      const expected = Date.parse(expectedModifiedAt)
      if (
        !Number.isFinite(expected) ||
        Math.abs(stats.mtimeMs - expected) > 2
      ) {
        throw new Error(
          'This file changed on disk after it was opened. Reopen it before saving.'
        )
      }
    }
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_WORKSPACE_FILE_BYTES) {
      throw new Error('Edits are limited to 2 MB text files.')
    }
    const before = readFileSync(resolved, 'utf8')
    if (before === content) return { ok: true, changed: false }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'write',
        title: `Edit ${path.basename(resolved)}`,
        description: workspaceNode(resolved)?.relativePath || path.basename(resolved),
        before: before.slice(0, 250_000),
        after: content.slice(0, 250_000),
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    const currentStats = statSync(resolved)
    const currentContent = readFileSync(resolved, 'utf8')
    if (
      currentContent !== before ||
      (typeof expectedModifiedAt === 'string' &&
        Math.abs(currentStats.mtimeMs - Date.parse(expectedModifiedAt)) > 2)
    ) {
      throw new Error(
        'This file changed while the edit was waiting. Reopen it and apply the change to the latest version.'
      )
    }
    const checkpointCapture = await createWorkspaceCheckpoint(
      [resolved],
      `Before editing ${path.basename(resolved)}`
    )
    assertCurrentWorkspaceBinding(binding)
    assertCheckpointFilesUnchanged(checkpointCapture.files)
    atomicWriteText(resolved, content, currentStats.mode)
    const root = workspaceRootForPath(resolved)
    if (root) {
      await runWorkspaceHooks(
        'afterFileEdit',
        { file_path: resolved, edits: [{ old_string: before, new_string: content }] },
        root,
        approvalMode
      )
    }
    scheduleWorkspaceIndex()
    return {
      ok: true,
      changed: true,
      checkpoint: checkpointCapture.metadata,
      file: workspaceNode(resolved),
    }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function resolveNewWorkspacePath(rootPath, relativePath) {
  const root = canonicalExistingPath(rootPath)
  if (!root || !workspaceOperationRoots().includes(root)) {
    throw new Error('Choose a valid workspace root.')
  }
  if (
    typeof relativePath !== 'string' ||
    !relativePath.trim() ||
    relativePath.includes('\0')
  ) {
    throw new Error('Choose a valid relative path.')
  }
  assertUnprefixedWorkspaceCreatePath(root, relativePath, {
    exists: existsSync,
  })
  const requestedTarget = path.resolve(root, relativePath.trim())
  if (!pathInsideRoot(requestedTarget, root) || requestedTarget === root) {
    throw new Error('Target is outside the workspace root.')
  }
  const missingSegments = [path.basename(requestedTarget)]
  let existingAncestor = path.dirname(requestedTarget)
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor)
    if (parent === existingAncestor) {
      throw new Error('Target parent is unavailable.')
    }
    missingSegments.unshift(path.basename(existingAncestor))
    existingAncestor = parent
  }
  const canonicalAncestor = canonicalExistingPath(existingAncestor)
  if (
    !canonicalAncestor ||
    !statSync(canonicalAncestor).isDirectory() ||
    !pathInsideRoot(canonicalAncestor, root)
  ) {
    throw new Error('Target resolves outside the workspace root.')
  }
  const target = path.join(canonicalAncestor, ...missingSegments)
  if (!pathInsideRoot(target, root)) {
    throw new Error('Target resolves outside the workspace root.')
  }
  return { root, target }
}

async function createWorkspaceTextFile(
  rootPath,
  relativePath,
  content,
  approvalMode,
  binding
) {
  try {
    assertCurrentWorkspaceBinding(binding)
    const { target } = resolveNewWorkspacePath(rootPath, relativePath)
    if (existsSync(target)) throw new Error('A file already exists at that path.')
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_WORKSPACE_FILE_BYTES) {
      throw new Error('New files are limited to 2 MB of text.')
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'create',
        title: `Create ${path.basename(target)}`,
        description: relativePath,
        before: '',
        after: content.slice(0, 250_000),
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    mkdirSync(path.dirname(target), { recursive: true })
    const checkpointCapture = await createWorkspaceCheckpoint(
      [target],
      `Before creating ${path.basename(target)}`
    )
    assertCurrentWorkspaceBinding(binding)
    assertCheckpointFilesUnchanged(checkpointCapture.files)
    atomicWriteText(target, content, 0o644)
    const root = workspaceRootForPath(target)
    if (root) {
      await runWorkspaceHooks(
        'afterFileEdit',
        { file_path: target, edits: [{ old_string: '', new_string: content }] },
        root,
        approvalMode
      )
    }
    scheduleWorkspaceIndex()
    return {
      ok: true,
      changed: true,
      checkpoint: checkpointCapture.metadata,
      file: workspaceNode(target),
    }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function atomicWriteBuffer(filePath, buffer, mode) {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.statskey-${crypto.randomUUID()}.tmp`
  )
  writeFileSync(temporary, buffer, { mode: mode || 0o644 })
  renameSync(temporary, filePath)
}

function buildPdfDocumentHtml(htmlBody, title) {
  const safeTitle = String(title || 'StatsKey document')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'" />',
    `<title>${safeTitle}</title>`,
    '<style>',
    '@page { margin: 0.75in; }',
    'body { margin: 0; color: #0b1f3a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.55; }',
    'h1, h2, h3, h4 { color: #0b1f3a; letter-spacing: -0.01em; line-height: 1.25; }',
    'h1 { font-size: 22px; margin: 0 0 12px; } h2 { font-size: 16px; margin: 20px 0 8px; } h3 { font-size: 13.5px; margin: 16px 0 6px; }',
    'a { color: #0066cc; text-decoration: none; }',
    'p { margin: 0 0 8px; } ul, ol { margin: 0 0 10px; padding-left: 20px; }',
    'table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 11px; }',
    'th, td { border: 1px solid rgba(11, 31, 58, 0.16); padding: 5px 8px; text-align: left; vertical-align: top; }',
    'th { background: rgba(0, 102, 204, 0.06); font-weight: 650; }',
    'code, pre { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px; }',
    'pre { border: 1px solid rgba(11, 31, 58, 0.12); border-radius: 6px; padding: 8px 10px; background: rgba(11, 31, 58, 0.03); white-space: pre-wrap; word-break: break-word; }',
    'blockquote { margin: 8px 0; border-left: 3px solid rgba(0, 102, 204, 0.4); padding: 2px 0 2px 10px; color: #526d88; }',
    'hr { border: none; border-top: 1px solid rgba(11, 31, 58, 0.14); margin: 14px 0; }',
    'img { max-width: 100%; }',
    'thead { display: table-header-group; } tr, pre, blockquote { break-inside: avoid; }',
    '</style>',
    '</head>',
    `<body>${String(htmlBody)}</body>`,
    '</html>',
  ].join('\n')
}

async function renderHtmlToPdfBuffer(htmlBody, title) {
  const documentHtml = buildPdfDocumentHtml(htmlBody, title)
  const temporary = path.join(
    app.getPath('temp'),
    `statskey-pdf-${crypto.randomUUID()}.html`
  )
  writeFileSync(temporary, documentHtml, { encoding: 'utf8', mode: 0o600 })
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const timeout = setTimeout(() => {
    if (!window.isDestroyed()) window.destroy()
  }, 20_000)
  try {
    await window.loadFile(temporary)
    return await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      preferCSSPageSize: true,
    })
  } catch (error) {
    if (window.isDestroyed()) {
      throw new Error('PDF rendering timed out.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    if (!window.isDestroyed()) window.destroy()
    try {
      unlinkSync(temporary)
    } catch {
      // The temp document may already be gone; nothing else to clean up.
    }
  }
}

async function renderWorkspacePdfFile(
  rootPath,
  relativePath,
  htmlBody,
  title,
  approvalMode,
  binding
) {
  try {
    assertCurrentWorkspaceBinding(binding)
    const { target } = resolveNewWorkspacePath(rootPath, relativePath)
    if (!target.toLowerCase().endsWith('.pdf')) {
      throw new Error('PDF exports must use a .pdf file path.')
    }
    if (
      typeof htmlBody !== 'string' ||
      htmlBody.trim().length === 0 ||
      Buffer.byteLength(htmlBody) > MAX_WORKSPACE_FILE_BYTES
    ) {
      throw new Error('PDF content must be non-empty HTML up to 2 MB.')
    }
    const replacing = existsSync(target)
    if (replacing && !statSync(target).isFile()) {
      throw new Error('The PDF path points at a directory.')
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'create',
        title: `Export ${path.basename(target)}`,
        description: `Render a PDF at ${relativePath}${replacing ? ' (replaces the existing file)' : ''}`,
        before: '',
        after: htmlBody.slice(0, 250_000),
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    const pdf = await renderHtmlToPdfBuffer(htmlBody, title)
    if (!pdf || pdf.length < 8 || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('PDF rendering produced an invalid document.')
    }
    mkdirSync(path.dirname(target), { recursive: true })
    const checkpointCapture = await createWorkspaceCheckpoint(
      [target],
      `Before exporting ${path.basename(target)}`
    )
    assertCurrentWorkspaceBinding(binding)
    assertCheckpointFilesUnchanged(checkpointCapture.files)
    atomicWriteBuffer(target, pdf, 0o644)
    const persistedSha256 = createHash('sha256')
      .update(readFileSync(target))
      .digest('hex')
    const renderedSha256 = createHash('sha256').update(pdf).digest('hex')
    if (persistedSha256 !== renderedSha256) {
      throw new Error('The exported PDF did not read back intact.')
    }
    scheduleWorkspaceIndex()
    return {
      ok: true,
      changed: true,
      checkpoint: checkpointCapture.metadata,
      file: workspaceNode(target),
      bytes: pdf.length,
      sha256: persistedSha256,
    }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function renderDesktopPdfFile(
  fileName,
  htmlBody,
  title,
  approvalMode
) {
  try {
    const requestedName = String(fileName || '').trim()
    if (
      !requestedName ||
      requestedName.length > 180 ||
      path.basename(requestedName) !== requestedName ||
      requestedName.includes('\\') ||
      !requestedName.toLowerCase().endsWith('.pdf')
    ) {
      throw new Error('Desktop PDF exports require one safe .pdf file name.')
    }
    if (
      typeof htmlBody !== 'string' ||
      htmlBody.trim().length === 0 ||
      Buffer.byteLength(htmlBody) > MAX_WORKSPACE_FILE_BYTES
    ) {
      throw new Error('PDF content must be non-empty HTML up to 2 MB.')
    }
    const target = path.join(app.getPath('desktop'), requestedName)
    const replacing = existsSync(target)
    if (replacing && !statSync(target).isFile()) {
      throw new Error('The Desktop PDF path points at a directory.')
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'create',
        title: `Export ${requestedName}`,
        description: `Render a PDF on the Desktop${replacing ? ' (replaces the existing file)' : ''}`,
        before: '',
        after: htmlBody.slice(0, 250_000),
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    const pdf = await renderHtmlToPdfBuffer(htmlBody, title)
    if (!pdf || pdf.length < 8 || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('PDF rendering produced an invalid document.')
    }
    atomicWriteBuffer(target, pdf, 0o644)
    const persistedSha256 = createHash('sha256')
      .update(readFileSync(target))
      .digest('hex')
    const renderedSha256 = createHash('sha256').update(pdf).digest('hex')
    if (persistedSha256 !== renderedSha256) {
      throw new Error('The exported PDF did not read back intact.')
    }
    const stats = statSync(target)
    return {
      ok: true,
      changed: true,
      file: {
        name: requestedName,
        path: target,
        relativePath: requestedName,
        kind: 'file',
        extension: 'pdf',
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
      bytes: pdf.length,
      sha256: persistedSha256,
      destination: 'desktop',
    }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function deleteWorkspaceFile(filePath, approvalMode, binding) {
  try {
    assertCurrentWorkspaceBinding(binding)
    const resolved = canonicalExistingPath(filePath)
    if (!resolved || !allowedWorkspacePath(resolved)) {
      throw new Error('File is outside the open workspace.')
    }
    if (!statSync(resolved).isFile()) throw new Error('Only files can be deleted.')
    const boundLooseFiles = workspaceOperationLooseFiles()
    const wasLooseFile = boundLooseFiles.has(resolved)
    const before = readFileSync(resolved, 'utf8')
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'delete',
        title: `Delete ${path.basename(resolved)}`,
        description: workspaceNode(resolved)?.relativePath || path.basename(resolved),
        before: before.slice(0, 250_000),
        after: '',
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    const checkpointCapture = await createWorkspaceCheckpoint(
      [resolved],
      `Before deleting ${path.basename(resolved)}`
    )
    assertCurrentWorkspaceBinding(binding)
    assertCheckpointFilesUnchanged(checkpointCapture.files)
    unlinkSync(resolved)
    if (wasLooseFile) {
      boundLooseFiles.delete(resolved)
      if (workspaceOperationUsesOpenWorkspace()) {
        workspaceLooseFiles.delete(resolved)
        saveWorkspaceState()
      }
    }
    const root = workspaceRootForPath(resolved)
    if (root) {
      await runWorkspaceHooks(
        'afterFileEdit',
        { file_path: resolved, edits: [{ old_string: before, new_string: '' }] },
        root,
        approvalMode
      )
    }
    scheduleWorkspaceIndex()
    return { ok: true, changed: true, checkpoint: checkpointCapture.metadata }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function renameWorkspaceFile(filePath, nextName, approvalMode, binding) {
  try {
    assertCurrentWorkspaceBinding(binding)
    const resolved = canonicalExistingPath(filePath)
    if (!resolved || !allowedWorkspacePath(resolved)) {
      throw new Error('File is outside the open workspace.')
    }
    if (
      typeof nextName !== 'string' ||
      !nextName.trim() ||
      nextName !== path.basename(nextName) ||
      nextName.includes('\0')
    ) {
      throw new Error('Choose a valid file name.')
    }
    const boundLooseFiles = workspaceOperationLooseFiles()
    const wasLooseFile = boundLooseFiles.has(resolved)
    const target = path.join(path.dirname(resolved), nextName.trim())
    if (existsSync(target)) throw new Error('That file name is already in use.')
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'rename',
        title: `Rename ${path.basename(resolved)}`,
        description: `${path.basename(resolved)} → ${path.basename(target)}`,
        before: '',
        after: '',
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    const checkpointCapture = await createWorkspaceCheckpoint(
      [resolved, target],
      `Before renaming ${path.basename(resolved)}`
    )
    assertCurrentWorkspaceBinding(binding)
    assertCheckpointFilesUnchanged(checkpointCapture.files)
    renameSync(resolved, target)
    if (wasLooseFile) {
      boundLooseFiles.delete(resolved)
      const renamedLooseFile = canonicalExistingPath(target)
      if (renamedLooseFile) boundLooseFiles.add(renamedLooseFile)
      if (workspaceOperationUsesOpenWorkspace()) {
        workspaceLooseFiles.delete(resolved)
        if (renamedLooseFile) workspaceLooseFiles.add(renamedLooseFile)
        saveWorkspaceState()
      }
    }
    const root = workspaceRootForPath(target)
    if (root) {
      await runWorkspaceHooks(
        'afterFileEdit',
        {
          file_path: target,
          previous_path: resolved,
          edits: [],
        },
        root,
        approvalMode
      )
    }
    scheduleWorkspaceIndex()
    return {
      ok: true,
      changed: true,
      checkpoint: checkpointCapture.metadata,
      file: workspaceNode(target),
    }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function restoreWorkspaceCheckpoint(
  checkpointId,
  approvalMode = 'review',
  binding
) {
  try {
    assertCurrentWorkspaceBinding(binding)
    const checkpoint = await readWorkspaceCheckpoint(checkpointId)
    if (!checkpoint) throw new Error('Checkpoint is unavailable.')
    const paths = checkpoint.files.map((file) => file.path)
    if (!paths.every((filePath) => allowedOrCreatableWorkspacePath(filePath))) {
      throw new Error('A checkpoint file is outside the current workspace.')
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'restore',
        title: 'Restore checkpoint',
        description: checkpoint.label,
        before: '',
        after: '',
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    if (!paths.every((filePath) => allowedOrCreatableWorkspacePath(filePath))) {
      throw new Error('A checkpoint file moved outside the current workspace.')
    }
    const safetyCheckpointCapture = await createWorkspaceCheckpoint(
      paths,
      `Before restoring ${checkpoint.label}`
    )
    assertCurrentWorkspaceBinding(binding)
    if (!paths.every((filePath) => allowedOrCreatableWorkspacePath(filePath))) {
      throw new Error('A checkpoint file moved outside the current workspace.')
    }
    assertCheckpointFilesUnchanged(safetyCheckpointCapture.files)
    for (const file of checkpoint.files) {
      if (file.existed) {
        mkdirSync(path.dirname(file.path), { recursive: true })
        const bytes = Buffer.from(file.content, 'base64')
        const temporary = `${file.path}.statskey-${crypto.randomUUID()}.tmp`
        writeFileSync(temporary, bytes, { mode: file.mode || 0o644 })
        renameSync(temporary, file.path)
      } else if (existsSync(file.path) && statSync(file.path).isFile()) {
        unlinkSync(file.path)
      }
    }
    return { ok: true, checkpoint: safetyCheckpointCapture.metadata }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function allowedOrCreatableWorkspacePath(candidate) {
  if (typeof candidate !== 'string') return false
  const resolved = path.resolve(candidate)
  const existing = canonicalExistingPath(resolved)
  if (existing) return allowedWorkspacePath(existing)
  for (const root of workspaceOperationRoots()) {
    if (!pathInsideRoot(resolved, root) || resolved === root) continue
    try {
      const validated = resolveNewWorkspacePath(
        root,
        path.relative(root, resolved)
      )
      return validated.target === resolved
    } catch {
      return false
    }
  }
  return false
}

async function runWorkspaceCommand(command, cwd, approvalMode, binding) {
  try {
    assertCurrentWorkspaceBinding(binding)
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 20_000
    ) {
      throw new Error('Choose a valid command.')
    }
    const workingDirectory = canonicalExistingPath(
      cwd || workspaceOperationRoots()[0]
    )
    if (
      !workingDirectory ||
      !allowedWorkspacePath(workingDirectory) ||
      !statSync(workingDirectory).isDirectory()
    ) {
      throw new Error('Command directory is outside the workspace.')
    }
    const root = workspaceRootForPath(workingDirectory)
    if (root) {
      await runWorkspaceHooks(
        'beforeShellExecution',
        { command: command.trim(), cwd: workingDirectory },
        root,
        approvalMode
      )
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'terminal',
        title: 'Run terminal command',
        description: workspaceNode(workingDirectory)?.relativePath || workingDirectory,
        command: command.trim(),
        before: '',
        after: '',
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    const result = await spawnWorkspaceCommand(command.trim(), workingDirectory)
    assertCurrentWorkspaceBinding(binding)
    if (root) {
      await runWorkspaceHooks(
        'afterShellExecution',
        {
          command: command.trim(),
          cwd: workingDirectory,
          exit_code: result.exitCode ?? null,
          stdout: result.stdout?.slice(-20_000) || '',
          stderr: result.stderr?.slice(-20_000) || '',
        },
        root,
        approvalMode
      )
    }
    if (result.ok) scheduleWorkspaceIndex()
    return result
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function startTerminalCommand(
  command,
  cwd,
  approvalMode,
  dimensions,
  binding,
  options
) {
  try {
    assertCurrentWorkspaceBinding(binding)
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 12_000
    ) {
      throw new Error('Choose a valid command.')
    }
    const workingDirectory = canonicalExistingPath(
      cwd || workspaceOperationRoots()[0]
    )
    if (
      !workingDirectory ||
      !allowedWorkspacePath(workingDirectory) ||
      !statSync(workingDirectory).isDirectory()
    ) {
      throw new Error('Command directory is outside the workspace.')
    }
    const root = workspaceRootForPath(workingDirectory)
    if (root) {
      await runWorkspaceHooks(
        'beforeShellExecution',
        { command: command.trim(), cwd: workingDirectory },
        root,
        approvalMode
      )
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'terminal',
        title: 'Run terminal command',
        description:
          workspaceNode(workingDirectory)?.relativePath || workingDirectory,
        command: command.trim(),
        before: '',
        after: '',
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    assertCurrentWorkspaceBinding(binding)
    const session = terminalRuntime.start({
      command: command.trim(),
      cwd: workingDirectory,
      cols: dimensions?.cols,
      rows: dimensions?.rows,
      failClosed: options?.failClosed === true,
      environment: normalizeTerminalEnvironmentOverrides(options?.environment),
      metadata: {
        root,
        rootName: root ? path.basename(root) : path.basename(workingDirectory),
        approvalMode,
        origin: desktopOperationOrigin.getStore() || undefined,
      },
    })
    return { ok: true, session }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function runFixedWorkspaceCommand(rootPath, command) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceOperationRoots().includes(root)) {
      throw new Error('Choose a valid workspace root.')
    }
    return await spawnWorkspaceCommand(command, root)
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function listWorkspaceGitFiles(rootPath) {
  const result = await runFixedWorkspaceProcess(
    rootPath,
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all']
  )
  if (!result.ok) {
    return {
      ok: false,
      files: [],
      error: result.stderr || result.error || 'Could not read Git changes.',
    }
  }
  return { ok: true, files: parsePorcelainStatus(result.stdout) }
}

async function initializeWorkspaceGit(rootPath, approvalMode) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceRoots.includes(root)) {
      throw new Error('Choose a valid workspace root.')
    }
    const existing = await spawnWorkspaceProcess(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      root
    )
    if (existing.ok && existing.stdout.trim() === 'true') {
      return { ok: true, stdout: 'Version control is already active.' }
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'git',
        title: 'Start version control',
        description: `Track changes in ${path.basename(root)}`,
        command: 'git init --initial-branch=main',
        before: '',
        after: 'Creates local Git metadata. Project files are not changed.',
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    return await spawnWorkspaceProcess(
      'git',
      ['init', '--initial-branch=main'],
      root
    )
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function runWorkspaceGitPathOperation(rootPath, paths, stage) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceRoots.includes(root)) {
      throw new Error('Choose a valid workspace root.')
    }
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200) {
      throw new Error('Choose between 1 and 200 changed files.')
    }
    const normalized = paths.map((candidate) => {
      if (
        typeof candidate !== 'string' ||
        !candidate ||
        candidate.includes('\0') ||
        path.isAbsolute(candidate)
      ) {
        throw new Error('A Git path is invalid.')
      }
      const resolved = path.resolve(root, candidate)
      if (!pathInsideRoot(resolved, root) || resolved === root) {
        throw new Error('A Git path is outside the workspace.')
      }
      return candidate
    })
    if (stage) {
      return await spawnWorkspaceProcess('git', ['add', '--', ...normalized], root)
    }
    return await unstageWorkspacePaths(root, normalized)
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function unstageAllWorkspaceChanges(rootPath) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceRoots.includes(root)) {
      throw new Error('Choose a valid workspace root.')
    }
    return await unstageWorkspacePaths(root, ['.'])
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function unstageWorkspacePaths(root, paths) {
  const head = await spawnWorkspaceProcess(
    'git',
    ['rev-parse', '--verify', 'HEAD'],
    root
  )
  return await spawnWorkspaceProcess(
    'git',
    head.ok
      ? ['restore', '--staged', '--', ...paths]
      : ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...paths],
    root
  )
}

async function runFixedWorkspaceProcess(rootPath, executable, args) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceOperationRoots().includes(root)) {
      throw new Error('Choose a valid workspace root.')
    }
    return await spawnWorkspaceProcess(executable, args, root)
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function commitWorkspaceChanges(rootPath, message, approvalMode) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceRoots.includes(root)) {
      throw new Error('Choose a valid workspace root.')
    }
    const normalized =
      typeof message === 'string' ? message.trim() : ''
    if (
      !normalized ||
      normalized.length > 240 ||
      /[\r\n\0]/.test(normalized)
    ) {
      throw new Error('Use a one-line commit message up to 240 characters.')
    }
    const staged = await spawnWorkspaceProcess(
      'git',
      ['diff', '--cached', '--stat'],
      root
    )
    if (!staged.ok || !staged.stdout.trim()) {
      throw new Error('Stage at least one change before committing.')
    }
    const stagedDiff = await spawnWorkspaceProcess(
      'git',
      ['diff', '--cached', '--no-ext-diff', '--no-color'],
      root
    )
    if (!stagedDiff.ok) {
      throw new Error(stagedDiff.stderr || 'Could not review staged changes.')
    }
    const review = [
      staged.stdout.trim(),
      stagedDiff.stdout.trim() || '(Binary or metadata-only staged changes.)',
    ].join('\n\n')
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'git',
        title: 'Commit staged changes',
        description: normalized,
        before: review.slice(0, 250_000),
        after: '',
        command: `git commit -m ${JSON.stringify(normalized)}`,
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    return await spawnWorkspaceProcess(
      'git',
      ['commit', '-m', normalized],
      root
    )
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function pushWorkspaceChanges(rootPath, approvalMode) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceRoots.includes(root)) {
      throw new Error('Choose a valid workspace root.')
    }
    const uncommitted = await spawnWorkspaceProcess(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      root
    )
    if (!uncommitted.ok) {
      throw new Error(
        uncommitted.stderr || uncommitted.error || 'Could not verify project changes.'
      )
    }
    if (uncommitted.stdout.trim()) {
      throw new Error(
        'Commit every changed file before publishing. No local changes were omitted.'
      )
    }
    const branchResult = await spawnWorkspaceProcess(
      'git',
      ['branch', '--show-current'],
      root
    )
    const branch = branchResult.stdout.trim()
    if (
      !branchResult.ok ||
      !branch ||
      branch.length > 240 ||
      /[\r\n\0]/.test(branch)
    ) {
      throw new Error('Check out a named branch before pushing.')
    }
    const remote = await spawnWorkspaceProcess(
      'git',
      ['remote', 'get-url', '--push', 'origin'],
      root
    )
    if (!remote.ok || !remote.stdout.trim()) {
      throw new Error('Add an origin remote before pushing.')
    }
    const upstream = await spawnWorkspaceProcess(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      root
    )
    const args = upstream.ok
      ? ['push', '--porcelain']
      : ['push', '--porcelain', '--set-upstream', 'origin', branch]
    const status = await spawnWorkspaceProcess(
      'git',
      ['status', '--short', '--branch'],
      root
    )
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'git',
        title: `Push ${branch}`,
        description: `${branch} → origin`,
        command: `git ${args.join(' ')}`,
        before: status.stdout.slice(0, 30_000),
        after: '',
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    return await spawnWorkspaceProcess('git', args, root, 10 * 60 * 1000)
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function managedWorktreesRoot() {
  return path.join(app.getPath('userData'), 'task-worktrees')
}

async function listWorkspaceWorktrees(rootPath) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceRoots.includes(root)) return []
    const result = await spawnWorkspaceProcess(
      'git',
      ['worktree', 'list', '--porcelain'],
      root
    )
    if (!result.ok) return []
    const entries = []
    let current = null
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        if (current) entries.push(current)
        current = {
          path: line.slice('worktree '.length),
          branch: null,
          head: null,
          detached: false,
          locked: false,
          prunable: false,
        }
      } else if (current && line.startsWith('HEAD ')) {
        current.head = line.slice(5)
      } else if (current && line.startsWith('branch ')) {
        current.branch = line.slice(7).replace(/^refs\/heads\//, '')
      } else if (current && line === 'detached') {
        current.detached = true
      } else if (current && line.startsWith('locked')) {
        current.locked = true
      } else if (current && line.startsWith('prunable')) {
        current.prunable = true
      }
    }
    if (current) entries.push(current)
    const managedRoot = canonicalExistingPath(managedWorktreesRoot())
    return entries.map((entry, index) => {
      const resolved = canonicalExistingPath(entry.path) || path.resolve(entry.path)
      return {
        ...entry,
        path: resolved,
        name: path.basename(resolved),
        main: index === 0,
        active: workspaceRoots.includes(resolved),
        managed: Boolean(
          managedRoot && pathInsideRoot(resolved, managedRoot)
        ),
      }
    })
  } catch {
    return []
  }
}

async function createWorkspaceWorktree(rootPath, rawLabel, approvalMode) {
  try {
    const root = canonicalExistingPath(rootPath)
    if (!root || !workspaceRoots.includes(root)) {
      throw new Error('Choose a valid Git workspace root.')
    }
    const label =
      typeof rawLabel === 'string' ? rawLabel.trim().slice(0, 120) : ''
    const slug = label
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 48)
    if (!slug) throw new Error('Name the isolated task.')
    const baselineStatus = await spawnWorkspaceProcess(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=normal'],
      root
    )
    if (!baselineStatus.ok) {
      throw new Error('Isolated tasks require a Git workspace.')
    }
    if (baselineStatus.stdout.trim()) {
      throw new Error(
        'This workspace has uncommitted files. Commit them before creating an isolated task; StatsKey will not stash, stage, or omit your work.'
      )
    }
    const baselineHead = await spawnWorkspaceProcess(
      'git',
      ['rev-parse', '--verify', 'HEAD'],
      root
    )
    const headOid = baselineHead.stdout.trim()
    if (!baselineHead.ok || !/^[0-9a-f]{40,64}$/i.test(headOid)) {
      throw new Error('StatsKey could not identify the committed baseline.')
    }
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    const repositoryId = createHash('sha256')
      .update(root)
      .digest('hex')
      .slice(0, 12)
    const parent = path.join(managedWorktreesRoot(), repositoryId)
    const target = path.join(parent, `${slug}-${id}`)
    const branch = `statskey/${slug}-${id}`
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'git',
        title: 'Create isolated task workspace',
        description: `${label} · ${branch}`,
        command: `git worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(target)} ${headOid}`,
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    const currentStatus = await spawnWorkspaceProcess(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=normal'],
      root
    )
    const currentHead = await spawnWorkspaceProcess(
      'git',
      ['rev-parse', '--verify', 'HEAD'],
      root
    )
    if (
      !currentStatus.ok ||
      currentStatus.stdout.trim() ||
      !currentHead.ok ||
      currentHead.stdout.trim() !== headOid
    ) {
      throw new Error(
        'The workspace changed while this task was awaiting review. Review those changes, then try again.'
      )
    }
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    const result = await spawnWorkspaceProcess(
      'git',
      ['worktree', 'add', '-b', branch, target, headOid],
      root
    )
    if (!result.ok) return result
    return {
      ok: true,
      worktree: {
        path: target,
        name: path.basename(target),
        branch,
        head: null,
        main: false,
        active: false,
        managed: true,
        detached: false,
        locked: false,
        prunable: false,
      },
    }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function activateWorkspaceWorktree(rootPath, worktreePath) {
  try {
    const currentRoot = canonicalExistingPath(rootPath)
    const rootIndex = currentRoot ? workspaceRoots.indexOf(currentRoot) : -1
    if (rootIndex < 0) {
      throw new Error('Choose a task from an open workspace folder.')
    }
    const worktrees = await listWorkspaceWorktrees(rootPath)
    const selected = worktrees.find(
      (entry) => entry.path === canonicalExistingPath(worktreePath)
    )
    if (!selected) throw new Error('This task workspace is unavailable.')
    workspaceRoots.splice(rootIndex, 1, selected.path)
    saveWorkspaceState()
    scheduleWorkspaceIndex(0)
    return { ok: true, workspace: workspaceSnapshot() }
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

async function removeWorkspaceWorktree(
  rootPath,
  worktreePath,
  approvalMode
) {
  try {
    const worktrees = await listWorkspaceWorktrees(rootPath)
    const selected = worktrees.find(
      (entry) => entry.path === canonicalExistingPath(worktreePath)
    )
    if (!selected || selected.main || !selected.managed) {
      throw new Error('Only StatsKey-created task workspaces can be removed.')
    }
    if (workspaceRoots.includes(selected.path)) {
      throw new Error('Open the main workspace before removing this task.')
    }
    const clean = await spawnWorkspaceProcess(
      'git',
      ['-C', selected.path, 'status', '--porcelain'],
      rootPath
    )
    if (!clean.ok || clean.stdout.trim()) {
      throw new Error(
        'This task has uncommitted changes. Review or commit them before removal.'
      )
    }
    const approved = await requestDesktopOperationApproval(
      {
        kind: 'git',
        title: 'Remove isolated task workspace',
        description: selected.branch || selected.name,
        command: `git worktree remove ${JSON.stringify(selected.path)}`,
      },
      approvalMode
    )
    if (!approved) return { ok: false, cancelled: true }
    return await spawnWorkspaceProcess(
      'git',
      ['worktree', 'remove', selected.path],
      rootPath
    )
  } catch (error) {
    return { ok: false, error: safeProviderError(error) }
  }
}

function spawnWorkspaceProcess(
  executable,
  args,
  cwd,
  timeoutMilliseconds = 120_000
) {
  return runBoundedChildProcess({
    executable,
    args,
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMilliseconds,
    timeoutMessage: `Process exceeded its ${Math.round(
      timeoutMilliseconds / 1_000
    )}-second deadline.`,
  })
}

function spawnWorkspaceCommand(command, cwd) {
  const windows = process.platform === 'win32'
  const executable = windows
    ? process.env.ComSpec || 'cmd.exe'
    : process.env.SHELL ||
      (process.platform === 'linux' ? '/bin/bash' : '/bin/zsh')
  const args = windows ? ['/d', '/s', '/c', command] : ['-lc', command]
  return runBoundedChildProcess({
    executable,
    args,
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMilliseconds: 120_000,
    timeoutMessage: 'Command exceeded its 120-second deadline.',
  })
}

function canonicalWorkspaceFile(root, candidate) {
  const resolved = canonicalExistingPath(candidate)
  if (
    !resolved ||
    !pathInsideRoot(resolved, root) ||
    !statSync(resolved).isFile()
  ) {
    return null
  }
  return resolved
}

function canonicalWorkspaceDirectory(root, candidate) {
  const resolved = canonicalExistingPath(candidate)
  if (
    !resolved ||
    !pathInsideRoot(resolved, root) ||
    !statSync(resolved).isDirectory()
  ) {
    return null
  }
  return resolved
}

function workspaceInstructions() {
  const rules = []
  const skills = []
  const configuration = {
    mcpFiles: [],
    hookFiles: [],
  }
  let ruleCharacters = 0

  for (const root of workspaceOperationRoots()) {
    const agentsPath = canonicalWorkspaceFile(root, path.join(root, 'AGENTS.md'))
    if (agentsPath) {
      const content = readBoundedText(agentsPath, 80_000)
      if (content && ruleCharacters + content.length <= 300_000) {
        rules.push({
          name: `${path.basename(root)}/AGENTS.md`,
          path: agentsPath,
          content,
        })
        ruleCharacters += content.length
      }
    }

    const rulesDirectory = canonicalWorkspaceDirectory(
      root,
      path.join(root, '.cursor', 'rules')
    )
    if (rulesDirectory) {
      for (const entry of readdirSync(rulesDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.mdc')) continue
        const rulePath = canonicalWorkspaceFile(
          root,
          path.join(rulesDirectory, entry.name)
        )
        if (!rulePath) continue
        const content = readBoundedText(rulePath, 80_000)
        if (!content || ruleCharacters + content.length > 300_000) continue
        const frontmatter = markdownFrontmatter(content)
        rules.push({
          name: `${path.basename(root)}/.cursor/rules/${entry.name}`,
          path: rulePath,
          description: frontmatter.description || '',
          alwaysApply: frontmatter.alwaysApply === 'true',
          globs: frontmatter.globs || '',
          content,
        })
        ruleCharacters += content.length
      }
    }

    const skillsDirectory = canonicalWorkspaceDirectory(
      root,
      path.join(root, '.cursor', 'skills')
    )
    if (skillsDirectory) {
      for (const entry of readdirSync(skillsDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const skillPath = canonicalWorkspaceFile(
          root,
          path.join(skillsDirectory, entry.name, 'SKILL.md')
        )
        if (!skillPath) continue
        const content = readBoundedText(skillPath, 20_000)
        const frontmatter = markdownFrontmatter(content)
        skills.push({
          name: frontmatter.name || entry.name,
          description: frontmatter.description || '',
          relativePath: workspaceNode(skillPath)?.relativePath || entry.name,
        })
      }
    }

    for (const relative of [
      ['.cursor', 'mcp.json'],
      ['.cursor', 'hooks.json'],
    ]) {
      const configPath = canonicalWorkspaceFile(root, path.join(root, ...relative))
      if (!configPath) continue
      const target =
        relative[1] === 'mcp.json'
          ? configuration.mcpFiles
          : configuration.hookFiles
      target.push({
        name: path.basename(root),
        path: configPath,
        relativePath: workspaceNode(configPath)?.relativePath || relative.join('/'),
      })
    }
  }

  return { rules, skills, configuration }
}

async function allMcpConfigurations() {
  const configurations = workspaceMcpConfigurations()
  for (const status of integrationStatuses()) {
    if (!status.configured) continue
    const config = await integrationConfiguration(status.id).catch(() => null)
    if (!config) continue
    const baseName = serverNameForIntegration(status.id, config.name)
    const name = configurations[baseName] ? `account-${baseName}` : baseName
    configurations[name] = integrationMcpConfiguration(status.id, config)
  }
  return configurations
}

function workspaceMcpConfigurations() {
  const configurations = {}
  for (const root of workspaceOperationRoots()) {
    const configPath = canonicalWorkspaceFile(
      root,
      path.join(root, '.cursor', 'mcp.json')
    )
    if (!configPath) continue
    let parsed
    try {
      parsed = JSON.parse(readBoundedText(configPath, 200_000))
    } catch {
      continue
    }
    const servers = parsed?.mcpServers
    if (servers == null || typeof servers !== 'object' || Array.isArray(servers)) {
      continue
    }
    for (const [rawName, rawConfig] of Object.entries(servers)) {
      if (
        !rawName ||
        rawConfig == null ||
        typeof rawConfig !== 'object' ||
        Array.isArray(rawConfig)
      ) {
        continue
      }
      const name = configurations[rawName]
        ? `${path.basename(root)}-${rawName}`
        : rawName
      const config = {}
      if (typeof rawConfig.command === 'string' && rawConfig.command.trim()) {
        config.command = rawConfig.command.trim()
        config.args = Array.isArray(rawConfig.args)
          ? rawConfig.args.map(String).slice(0, 100)
          : []
        config.env =
          rawConfig.env && typeof rawConfig.env === 'object'
            ? Object.fromEntries(
                Object.entries(rawConfig.env)
                  .filter(([, value]) => typeof value === 'string')
                  .slice(0, 100)
              )
            : {}
        const requestedCwd =
          typeof rawConfig.cwd === 'string'
            ? path.resolve(root, rawConfig.cwd)
            : root
        const canonicalCwd = canonicalWorkspaceDirectory(root, requestedCwd)
        config.cwd = canonicalCwd || root
      } else if (typeof rawConfig.url === 'string') {
        const url = new URL(rawConfig.url)
        const local =
          url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname === '::1'
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
          continue
        }
        config.url = url.toString()
        config.type = rawConfig.type === 'sse' ? 'sse' : 'http'
        config.headers =
          rawConfig.headers && typeof rawConfig.headers === 'object'
            ? Object.fromEntries(
                Object.entries(rawConfig.headers)
                  .filter(([, value]) => typeof value === 'string')
                  .slice(0, 100)
              )
            : {}
      } else {
        continue
      }
      config.disabled = rawConfig.disabled === true
      configurations[name] = config
    }
  }
  return configurations
}

async function runWorkspaceHooks(
  eventName,
  payload,
  root,
  approvalMode = 'review'
) {
  const configPath = canonicalWorkspaceFile(
    root,
    path.join(root, '.cursor', 'hooks.json')
  )
  if (!configPath) return
  let parsed
  try {
    parsed = JSON.parse(readBoundedText(configPath, 200_000))
  } catch {
    return
  }
  const hooks = parsed?.hooks?.[eventName]
  if (!Array.isArray(hooks) || hooks.length === 0) return
  const signature = createHash('sha256')
    .update(JSON.stringify({ configPath, eventName, hooks }))
    .digest('hex')
  if (!approvedHookConfigurations.has(signature)) {
    if (shouldAutoApprove('hook', approvalMode)) {
      approvedHookConfigurations.add(signature)
    } else {
      const preferences = readDesktopPreferences()
      const stored = preferences.hookDecisions[signature]
      // Declined hooks are skipped silently; the operation itself continues.
      if (stored === 'deny') return
      if (stored === 'allow') {
        approvedHookConfigurations.add(signature)
      } else {
        const approved = await requestDesktopOperationApproval(
          {
            kind: 'hook',
            title: `Run ${path.basename(root)} project automation?`,
            description: `This project defines ${hooks.length} ${eventName} automation step${hooks.length === 1 ? '' : 's'}. StatsKey works normally without it. Your choice is remembered.`,
            command: hooks
              .map((hook) => hook.command || hook.prompt || hook.type || 'hook')
              .join('\n')
              .slice(0, 30_000),
            before: '',
            after: '',
            decisionScope: 'workspace-hooks',
          },
          approvalMode
        )
        const decisions = { ...preferences.hookDecisions }
        decisions[signature] = approved ? 'allow' : 'deny'
        writeDesktopPreferences({ ...preferences, hookDecisions: decisions })
        if (!approved) return
        approvedHookConfigurations.add(signature)
      }
    }
  }

  for (const hook of hooks.slice(0, 30)) {
    if (hook == null || typeof hook !== 'object') continue
    if (typeof hook.matcher === 'string' && hook.matcher) {
      try {
        const target = String(payload.command || payload.tool_name || payload.file_path || '')
        if (!new RegExp(hook.matcher).test(target)) continue
      } catch {
        continue
      }
    }
    if (hook.type === 'prompt' && typeof hook.prompt === 'string') {
      const approved = await requestDesktopOperationApproval(
        {
          kind: 'hook',
          title: `${eventName} policy check`,
          description: hook.prompt.slice(0, 500),
          command: JSON.stringify(payload, null, 2).slice(0, 30_000),
          before: '',
          after: '',
        },
        approvalMode
      )
      if (!approved) throw new Error(`Blocked by ${eventName} prompt hook.`)
      continue
    }
    if (typeof hook.command !== 'string' || !hook.command.trim()) continue
    const result = await spawnHookCommand(
      hook.command.trim(),
      root,
      payload,
      Math.min(120, Math.max(1, Number(hook.timeout) || 30))
    )
    if (result.timedOut) {
      throw new Error(`${eventName} hook exceeded its configured deadline.`)
    }
    if (result.error) {
      throw new Error(
        `${eventName} hook could not complete: ${safeProviderError(result.error)}`
      )
    }
    if (result.exitCode === 2) {
      throw new Error(result.output?.user_message || `Blocked by ${eventName} hook.`)
    }
    const permission = result.output?.permission
    if (result.output?.continue === false || permission === 'deny') {
      throw new Error(result.output?.user_message || `Blocked by ${eventName} hook.`)
    }
    if (permission === 'ask') {
      const approved = await requestDesktopOperationApproval(
        {
          kind: 'hook',
          title: `${eventName} hook requests approval`,
          description:
            result.output?.user_message ||
            result.output?.agent_message ||
            hook.command,
          command: JSON.stringify(payload, null, 2).slice(0, 30_000),
          before: '',
          after: '',
        },
        approvalMode
      )
      if (!approved) throw new Error(`Rejected by ${eventName} hook review.`)
    }
  }
}

async function spawnHookCommand(command, cwd, payload, timeoutSeconds) {
  const windows = process.platform === 'win32'
  const executable = windows
    ? process.env.ComSpec || 'cmd.exe'
    : process.env.SHELL ||
      (process.platform === 'linux' ? '/bin/bash' : '/bin/zsh')
  const args = windows ? ['/d', '/s', '/c', command] : ['-lc', command]
  const result = await runBoundedChildProcess({
    executable,
    args,
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: ['pipe', 'pipe', 'pipe'],
    input: JSON.stringify(payload),
    timeoutMilliseconds: timeoutSeconds * 1_000,
    maxOutputCharacters: 100_000,
    timeoutMessage: `Hook exceeded its ${timeoutSeconds}-second deadline.`,
  })
  let output = null
  if (!result.timedOut) {
    try {
      output = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null
    } catch {
      output = null
    }
  }
  return { ...result, output }
}

function readBoundedText(filePath, maximumBytes) {
  try {
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size > maximumBytes) return ''
    const bytes = readFileSync(filePath)
    if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) return ''
    return bytes.toString('utf8')
  } catch {
    return ''
  }
}

function markdownFrontmatter(content) {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end === -1) return {}
  const result = {}
  for (const line of content.slice(3, end).split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) result[key] = value
  }
  return result
}

function desktopPreferencesPath() {
  return path.join(app.getPath('userData'), 'desktop-preferences.json')
}

function calendarFeedVaultPath() {
  return path.join(app.getPath('userData'), 'calendar-feed-vault.json')
}

function readCalendarFeedVault() {
  try {
    const parsed = JSON.parse(readFileSync(calendarFeedVaultPath(), 'utf8'))
    return {
      version: 1,
      feeds: Array.isArray(parsed?.feeds)
        ? parsed.feeds
            .filter(
              (feed) =>
                feed &&
                typeof feed.id === 'string' &&
                typeof feed.name === 'string' &&
                typeof feed.encryptedUrl === 'string'
            )
            .slice(-24)
        : [],
    }
  } catch {
    return { version: 1, feeds: [] }
  }
}

function writeCalendarFeedVault(vault) {
  mkdirSync(path.dirname(calendarFeedVaultPath()), {
    recursive: true,
    mode: 0o700,
  })
  const temporary = `${calendarFeedVaultPath()}.${crypto.randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(vault), { mode: 0o600 })
  renameSync(temporary, calendarFeedVaultPath())
  chmodSync(calendarFeedVaultPath(), 0o600)
}

function publicCalendarFeed(feed) {
  return {
    id: feed.id,
    name: feed.name,
    createdAt:
      typeof feed.createdAt === 'string'
        ? feed.createdAt
        : new Date(0).toISOString(),
  }
}

function calendarEventStart(event) {
  return event?.start?.dateTime || `${event?.start?.date || ''}T00:00:00Z`
}

function readDesktopPreferences() {
  try {
    return sanitizeDesktopPreferences(
      JSON.parse(readFileSync(desktopPreferencesPath(), 'utf8'))
    )
  } catch {
    return defaultDesktopPreferences()
  }
}

function sanitizeDesktopPreferences(input) {
  const source =
    input != null && typeof input === 'object' && !Array.isArray(input)
      ? input
      : {}
  return {
    version: 1,
    orchestrationPolicyVersion: 2,
    intelligenceUpdatesPolicyVersion: 2,
    modelSettings: sanitizeDesktopModelSettings(source.modelSettings),
    subagentModelSettings: sanitizeDesktopModelSettings(
      source.subagentModelSettings,
      { requireIdentity: true }
    ),
    inlineCompletions: source.inlineCompletions === true,
    agentMode: sanitizeAgentMode(source.agentMode),
    executePermissionGranted:
      source.executePermissionGranted === true ||
      source.approvalMode === 'everything',
    approvalMode:
      source.approvalMode === 'auto' ||
      source.approvalMode === 'everything'
        ? source.approvalMode
        : 'review',
    orchestrationMode:
      source.orchestrationPolicyVersion === 2 &&
      (source.orchestrationMode === 'focused' ||
        source.orchestrationMode === 'adaptive' ||
        source.orchestrationMode === 'parallel')
        ? source.orchestrationMode
        : 'adaptive',
    intelligenceUpdates:
      source.intelligenceUpdatesPolicyVersion === 2 &&
      (source.intelligenceUpdates === 'quiet' ||
        source.intelligenceUpdates === 'live' ||
        source.intelligenceUpdates === 'narrated')
        ? source.intelligenceUpdates
        : 'narrated',
    dismissedUpdateVersion:
      typeof source.dismissedUpdateVersion === 'string' &&
      /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(
        source.dismissedUpdateVersion
      )
        ? source.dismissedUpdateVersion.slice(0, 64)
        : null,
    hookDecisions:
      source.hookDecisions != null &&
      typeof source.hookDecisions === 'object' &&
      !Array.isArray(source.hookDecisions)
        ? Object.fromEntries(
            Object.entries(source.hookDecisions)
              .filter(
                ([key, value]) =>
                  /^[a-f0-9]{64}$/.test(key) &&
                  (value === 'allow' || value === 'deny')
              )
              .slice(-200)
          )
        : {},
  }
}

function writeDesktopPreferences(preferences) {
  mkdirSync(path.dirname(desktopPreferencesPath()), { recursive: true })
  const temporary = `${desktopPreferencesPath()}.${crypto.randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(preferences), { mode: 0o600 })
  renameSync(temporary, desktopPreferencesPath())
  chmodSync(desktopPreferencesPath(), 0o600)
}

function integrationVaultPath() {
  return path.join(app.getPath('userData'), 'integration-vault.json')
}

function emptyIntegrationVault() {
  return { version: 1, connections: {} }
}

function readIntegrationVault() {
  try {
    const parsed = JSON.parse(readFileSync(integrationVaultPath(), 'utf8'))
    if (
      parsed?.version !== 1 ||
      parsed.connections == null ||
      typeof parsed.connections !== 'object' ||
      Array.isArray(parsed.connections)
    ) {
      return emptyIntegrationVault()
    }
    return {
      version: 1,
      connections: Object.fromEntries(
        Object.entries(parsed.connections)
          .filter(
            ([id, entry]) =>
              validIntegrationId(id) &&
              entry != null &&
              typeof entry === 'object' &&
              typeof entry.ciphertext === 'string'
          )
          .slice(-100)
      ),
    }
  } catch {
    return emptyIntegrationVault()
  }
}

function writeIntegrationVault(vault) {
  mkdirSync(path.dirname(integrationVaultPath()), {
    recursive: true,
    mode: 0o700,
  })
  const temporary = `${integrationVaultPath()}.${crypto.randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(vault), { mode: 0o600 })
  renameSync(temporary, integrationVaultPath())
  chmodSync(integrationVaultPath(), 0o600)
}

async function writeIntegrationConfiguration(integrationId, config, action) {
  const encrypted = await safeStorageCrypto.encryptString(
    JSON.stringify(config),
    action
  )
  const vault = readIntegrationVault()
  vault.connections[integrationId] = {
    ciphertext: encrypted.toString('base64'),
    updatedAt: new Date().toISOString(),
    metadata: integrationMetadataForConfig(config),
  }
  writeIntegrationVault(vault)
}

async function updateIntegrationOAuth(integrationId, oauth) {
  return enqueueIntegrationVaultMutation(async () => {
    const current = await integrationConfiguration(integrationId)
    if (!current || current.authType !== 'oauth') return
    const updated = sanitizeRemoteIntegration(
      { ...current, oauth },
      current
    )
    await writeIntegrationConfiguration(
      integrationId,
      updated,
      'saving connected-tool authorization'
    )
  })
}

function integrationMcpConfiguration(integrationId, config) {
  const mcp = mcpConfigForIntegration(config)
  if (config.authType === 'oauth') {
    mcp.onOAuthStateChange = (oauth) =>
      updateIntegrationOAuth(integrationId, oauth)
  }
  return mcp
}

async function integrationConfiguration(integrationId) {
  if (!validIntegrationId(integrationId)) return null
  const existingRead = integrationConfigurationReads.get(integrationId)
  if (existingRead) return await existingRead
  const read = readIntegrationConfiguration(integrationId)
  integrationConfigurationReads.set(integrationId, read)
  try {
    return await read
  } finally {
    if (integrationConfigurationReads.get(integrationId) === read) {
      integrationConfigurationReads.delete(integrationId)
    }
  }
}

async function readIntegrationConfiguration(integrationId) {
  const entry = readIntegrationVault().connections[integrationId]
  const ciphertext = entry?.ciphertext
  if (typeof ciphertext !== 'string' || !ciphertext) return null
  const { result: plaintext } = await safeStorageCrypto.decryptString(
    Buffer.from(ciphertext, 'base64'),
    'unlocking connected tools'
  )
  let parsed
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    return null
  }
  if (
    readIntegrationVault().connections[integrationId]?.ciphertext !== ciphertext
  ) {
    return null
  }
  try {
    return sanitizeRemoteIntegration(parsed)
  } catch {
    return null
  }
}

function enqueueIntegrationVaultMutation(operation) {
  const pending = integrationVaultMutationTail.then(operation, operation)
  integrationVaultMutationTail = pending.then(
    () => undefined,
    () => undefined
  )
  return pending
}

function integrationStatus(integrationId, vault = readIntegrationVault()) {
  return integrationStatusFromEntry(
    integrationId,
    vault.connections[integrationId]
  )
}

function integrationStatuses() {
  const vault = readIntegrationVault()
  return Object.keys(vault.connections)
    .map((integrationId) => integrationStatus(integrationId, vault))
    .filter((status) => status.configured)
    .sort((left, right) => left.name.localeCompare(right.name))
}

function providerVaultPath() {
  return path.join(app.getPath('userData'), 'provider-vault.json')
}

function emptyProviderVault() {
  return { version: 1, providers: {} }
}

function readProviderVault() {
  try {
    const parsed = JSON.parse(readFileSync(providerVaultPath(), 'utf8'))
    if (
      parsed?.version !== 1 ||
      parsed.providers == null ||
      typeof parsed.providers !== 'object'
    ) {
      return emptyProviderVault()
    }
    return parsed
  } catch {
    return emptyProviderVault()
  }
}

function writeProviderVault(vault) {
  mkdirSync(path.dirname(providerVaultPath()), { recursive: true })
  writeFileSync(providerVaultPath(), JSON.stringify(vault), { mode: 0o600 })
  chmodSync(providerVaultPath(), 0o600)
}

async function providerConfiguration(provider) {
  if (!PROVIDER_IDS.has(provider)) return null
  const existingRead = providerConfigurationReads.get(provider)
  if (existingRead) return await existingRead
  const read = readProviderConfiguration(provider)
  providerConfigurationReads.set(provider, read)
  try {
    return await read
  } finally {
    if (providerConfigurationReads.get(provider) === read) {
      providerConfigurationReads.delete(provider)
    }
  }
}

async function readProviderConfiguration(provider) {
  const entry = readProviderVault().providers[provider]
  const ciphertext = entry?.ciphertext
  if (typeof ciphertext !== 'string' || !ciphertext) return null
  const { result: plaintext } = await providerVaultCrypto.decryptString(
    Buffer.from(ciphertext, 'base64')
  )
  let parsed
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    return null
  }
  // A remove or replacement that completed while Keychain was responding
  // wins over this stale read; never resurrect or run with old credentials.
  if (readProviderVault().providers[provider]?.ciphertext !== ciphertext) {
    return null
  }
  try {
    return sanitizeProviderConfiguration(provider, parsed, false)
  } catch {
    return null
  }
}

function sanitizeProviderConfiguration(provider, input, requireComplete = true) {
  if (!PROVIDER_IDS.has(provider)) throw new Error('Unsupported provider.')
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid provider settings.')
  }
  const allowed = PROVIDER_FIELDS[provider]
  const config = {}
  for (const field of allowed) {
    const raw = input[field]
    if (raw == null) continue
    if (typeof raw !== 'string') throw new Error(`Invalid ${field}.`)
    const value = raw.trim()
    if (value.length > 8192) throw new Error(`${field} is too long.`)
    if (value) config[field] = value
  }

  const defaults = {
    anthropic: { baseUrl: 'https://api.anthropic.com' },
    openai: { baseUrl: 'https://api.openai.com/v1' },
    google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    xai: { baseUrl: 'https://api.x.ai/v1' },
    moonshot: { baseUrl: 'https://api.moonshot.ai/v1' },
    'azure-openai': { apiVersion: '2026-06-01' },
    'aws-bedrock': { region: 'us-east-1' },
  }
  Object.assign(config, defaults[provider] || {}, config)

  for (const field of ['baseUrl', 'endpoint']) {
    if (!config[field]) continue
    let url
    try {
      url = new URL(config[field])
    } catch {
      throw new Error(`${field} must be a valid URL.`)
    }
    const local =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      throw new Error(`${field} must use HTTPS, except for localhost.`)
    }
    config[field] = url.toString().replace(/\/+$/, '')
  }

  if (requireComplete) {
    const required = PROVIDER_REQUIRED_FIELDS[provider]
    const missing = required.filter((field) => !config[field])
    if (missing.length > 0) {
      throw new Error(`Missing ${missing.join(', ')}.`)
    }
  }
  return config
}

async function saveProviderConfiguration(provider, input) {
  const existing = (await providerConfiguration(provider)) || {}
  const submitted = sanitizeProviderConfiguration(provider, input, false)
  const endpointChanged =
    (provider === 'azure-openai' &&
      ((submitted.endpoint && submitted.endpoint !== existing.endpoint) ||
        (submitted.deployment &&
          submitted.deployment !== existing.deployment))) ||
    (provider === 'openai-compatible' &&
      ((submitted.baseUrl && submitted.baseUrl !== existing.baseUrl) ||
        (submitted.model && submitted.model !== existing.model)))
  if (endpointChanged && existing.apiKey && !submitted.apiKey) {
    throw new Error(
      'Re-enter the API key when changing an endpoint or deployment.'
    )
  }
  const merged = sanitizeProviderConfiguration(
    provider,
    { ...existing, ...submitted },
    true
  )
  const encrypted = await providerVaultCrypto.encryptString(
    JSON.stringify(merged)
  )
  const vault = readProviderVault()
  vault.providers[provider] = {
    ciphertext: encrypted.toString('base64'),
    updatedAt: new Date().toISOString(),
    metadata: providerMetadataForConfig({
      provider,
      config: merged,
      fields: PROVIDER_FIELDS,
      secretFields: PROVIDER_SECRET_FIELDS,
    }),
  }
  writeProviderVault(vault)
}

function enqueueProviderVaultMutation(operation) {
  const pending = providerVaultMutationTail.then(operation, operation)
  providerVaultMutationTail = pending.then(
    () => undefined,
    () => undefined
  )
  return pending
}

function providerStatus(provider, vault = readProviderVault()) {
  const entry = vault.providers[provider]
  return providerStatusFromEntry({
    provider,
    entry,
    fields: PROVIDER_FIELDS,
    secretFields: PROVIDER_SECRET_FIELDS,
    requiredFields: PROVIDER_REQUIRED_FIELDS,
  })
}

function providerStatuses() {
  const vault = readProviderVault()
  return [...PROVIDER_IDS].map((provider) => providerStatus(provider, vault))
}

function providerUrl(baseUrl, suffix) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

async function fetchProvider(url, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function testProviderConfiguration(provider, config) {
  let response
  if (provider === 'anthropic') {
    response = await fetchProvider(providerUrl(config.baseUrl, 'v1/models?limit=1'), {
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
  } else if (
    provider === 'openai' ||
    provider === 'xai' ||
    provider === 'moonshot'
  ) {
    response = await fetchProvider(providerUrl(config.baseUrl, 'models'), {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(provider === 'openai' && config.organization
          ? { 'OpenAI-Organization': config.organization }
          : {}),
        ...(provider === 'openai' && config.project
          ? { 'OpenAI-Project': config.project }
          : {}),
      },
    })
  } else if (provider === 'google') {
    const url = new URL(providerUrl(config.baseUrl, 'models'))
    url.searchParams.set('pageSize', '1')
    response = await fetchProvider(url, {
      headers: { 'x-goog-api-key': config.apiKey },
    })
  } else if (provider === 'azure-openai') {
    const url = new URL(providerUrl(config.endpoint, 'openai/deployments'))
    url.searchParams.set('api-version', config.apiVersion)
    response = await fetchProvider(url, {
      headers: { 'api-key': config.apiKey },
    })
  } else if (provider === 'openai-compatible') {
    response = await fetchProvider(providerUrl(config.baseUrl, 'models'), {
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {},
    })
  } else if (provider === 'aws-bedrock') {
    return {
      message: 'Credentials stored securely. Bedrock signing is checked on the first model request.',
      modelCount: null,
    }
  } else {
    throw new Error('Unsupported provider.')
  }

  const body = await response.text()
  if (!response.ok) {
    let message = `${provider} rejected the credentials (${response.status}).`
    try {
      const parsed = JSON.parse(body)
      message =
        parsed?.error?.message ||
        parsed?.error?.status ||
        parsed?.message ||
        message
    } catch {
      // Keep the status-only message; provider HTML can contain sensitive data.
    }
    throw new Error(message)
  }
  let modelCount = null
  try {
    const parsed = JSON.parse(body)
    const models = parsed.data || parsed.models || parsed.value
    if (Array.isArray(models)) modelCount = models.length
  } catch {
    // A successful provider response is sufficient.
  }
  return {
    message: modelCount == null
      ? 'Connection verified.'
      : `Connection verified · ${modelCount} model${modelCount === 1 ? '' : 's'} returned.`,
    modelCount,
  }
}

async function listProviderModels(provider, config) {
  if (
    provider === 'aws-bedrock' ||
    provider === 'azure-openai' ||
    provider === 'openai-compatible'
  ) {
    const configuredModel =
      provider === 'azure-openai' ? config.deployment : config.model
    return configuredModel
      ? [{ id: configuredModel, label: configuredModel, createdAt: null }]
      : []
  }

  let response
  if (provider === 'anthropic') {
    response = await fetchProvider(providerUrl(config.baseUrl, 'v1/models?limit=100'), {
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
  } else if (
    provider === 'openai' ||
    provider === 'xai' ||
    provider === 'moonshot'
  ) {
    response = await fetchProvider(providerUrl(config.baseUrl, 'models'), {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(provider === 'openai' && config.organization
          ? { 'OpenAI-Organization': config.organization }
          : {}),
        ...(provider === 'openai' && config.project
          ? { 'OpenAI-Project': config.project }
          : {}),
      },
    })
  } else if (provider === 'google') {
    const url = new URL(providerUrl(config.baseUrl, 'models'))
    url.searchParams.set('pageSize', '100')
    response = await fetchProvider(url, {
      headers: { 'x-goog-api-key': config.apiKey },
    })
  } else {
    throw new Error('Unsupported provider.')
  }

  const body = await response.text()
  if (!response.ok) {
    let message = `${provider} could not list models (${response.status}).`
    try {
      const parsed = JSON.parse(body)
      message =
        parsed?.error?.message ||
        parsed?.error?.status ||
        parsed?.message ||
        message
    } catch {
      // Do not expose provider HTML.
    }
    throw new Error(message)
  }

  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('The provider returned an invalid model list.')
  }
  const rawModels = parsed?.data || parsed?.models || parsed?.value || []
  if (!Array.isArray(rawModels)) return []

  return normalizeProviderModelList(provider, rawModels)
}

function safeProviderError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/sk-[a-z0-9_-]{12,}/gi, '[redacted]')
    .replace(/AIza[a-z0-9_-]{20,}/gi, '[redacted]')
    .slice(0, 500)
}

function hardenWindow(window) {
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isStatsKeyPage(url)) return
    event.preventDefault()
    void openExternal(url)
  })

  window.webContents.setWindowOpenHandler((details) => {
    if (isStatsKeyPage(details.url)) {
      void window.loadURL(details.url)
      return { action: 'deny' }
    }

    if (isTrustedAuthStart(details.url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: window,
          modal: false,
          width: 560,
          height: 720,
          minWidth: 420,
          minHeight: 560,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      }
    }

    void openExternal(details.url)
    return { action: 'deny' }
  })

  window.webContents.on('did-create-window', (childWindow) => {
    childWindow.removeMenu()
    childWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
    childWindow.webContents.on('will-navigate', (event, url) => {
      if (isTrustedAuthNavigation(url)) return
      event.preventDefault()
      void openExternal(url)
      childWindow.close()
    })
    childWindow.webContents.setWindowOpenHandler((details) => {
      void openExternal(details.url)
      return { action: 'deny' }
    })
  })

  window.webContents.on('context-menu', (_event, params) => {
    const template = []
    if (params.misspelledWord) {
      for (const suggestion of (params.dictionarySuggestions || []).slice(0, 6)) {
        template.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        })
      }
      template.push(
        {
          label: 'Add to Dictionary',
          click: () =>
            window.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord
            ),
        },
        { type: 'separator' }
      )
    }
    if (params.isEditable || params.editFlags.canCopy) {
      template.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      )
    }
    if (params.linkURL) {
      if (template.length > 0) template.push({ type: 'separator' })
      template.push(
        {
          label: 'Open Link',
          click: () => void openExternal(params.linkURL),
        },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(params.linkURL),
        }
      )
    }
    if (params.hasImageContents) {
      if (template.length > 0) template.push({ type: 'separator' })
      template.push({
        label: 'Copy Image',
        click: () => window.webContents.copyImageAt(params.x, params.y),
      })
    }
    if (template.length === 0) return
    Menu.buildFromTemplate(template).popup({ window })
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    if (window.isDestroyed()) return
    cancelRendererOwnedWork()
    if (details?.reason === 'clean-exit') return
    // Crash-loop protection: past the reload budget, show the startup-problem
    // page instead of burning CPU in a crash → reload → crash cycle.
    const now = Date.now()
    rendererCrashReloads = rendererCrashReloads.filter(
      (at) => now - at < RENDERER_CRASH_RELOAD_WINDOW_MS
    )
    if (rendererCrashReloads.length >= RENDERER_CRASH_RELOAD_LIMIT) {
      window
        .loadFile(path.join(__dirname, 'offline.html'))
        .catch(() => {})
      return
    }
    rendererCrashReloads.push(now)
    mainWindowReloadRequested = true
    void loadStatsKey(window)
  })

  let unresponsiveDialogOpen = false
  window.on('unresponsive', () => {
    if (unresponsiveDialogOpen || window.isDestroyed()) return
    unresponsiveDialogOpen = true
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        title: 'StatsKey is not responding',
        message: 'StatsKey is not responding.',
        detail: 'You can wait for it to recover or reload the app.',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        unresponsiveDialogOpen = false
        if (response === 1 && !window.isDestroyed()) {
          mainWindowReloadRequested = true
          window.webContents.reload()
        }
      })
  })
  window.on('responsive', () => {
    unresponsiveDialogOpen = false
  })
}

async function startBundledWebServer() {
  const webRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(__dirname, '..', 'dist')
  const appEntry = path.join(webRoot, 'desktop-app.html')
  if (!existsSync(appEntry)) {
    throw new Error(`Bundled StatsKey web client is missing: ${appEntry}`)
  }

  let expectedHost = null
  const server = http.createServer((request, response) => {
    if (expectedHost && request.headers.host !== expectedHost) {
      response.writeHead(403).end('Forbidden')
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed')
      return
    }

    try {
      const requestUrl = new URL(request.url || '/', `http://${expectedHost || 'localhost'}`)
      let pathname = decodeURIComponent(requestUrl.pathname)
      if (pathname === DESKTOP_HEALTH_PATH) {
        const ready = menuRendererReady === true
        const body = JSON.stringify(
          desktopHealthPayload({
            rendererReady: ready,
            currentVersion: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            feedRoot: UPDATE_FEED_ROOT,
          })
        )
        response.writeHead(ready ? 200 : 503, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Length': Buffer.byteLength(body),
          'Cross-Origin-Resource-Policy': 'same-origin',
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(request.method === 'HEAD' ? undefined : body)
        return
      }
      if (pathname === '/') {
        response.writeHead(302, { Location: '/app' }).end()
        return
      }
      if (pathname === '/app' || pathname.startsWith('/app/')) {
        pathname = '/desktop-app.html'
      }

      const resolved = path.resolve(webRoot, `.${pathname}`)
      const insideRoot =
        resolved === webRoot || resolved.startsWith(`${webRoot}${path.sep}`)
      if (!insideRoot || !existsSync(resolved) || !statSync(resolved).isFile()) {
        response.writeHead(404).end('Not Found')
        return
      }

      const isAsset = pathname.startsWith('/assets/')
      response.writeHead(200, {
        'Content-Type': contentTypeFor(resolved),
        'Cache-Control': isAsset
          ? 'public, max-age=31536000, immutable'
          : 'no-cache, no-store, must-revalidate',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': desktopContentSecurityPolicy(pathname),
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      createReadStream(resolved)
        .on('error', () => {
          if (!response.headersSent) response.writeHead(500)
          response.end()
        })
        .pipe(response)
    } catch {
      response.writeHead(400).end('Bad Request')
    }
  })
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })

  const listen = (port) =>
    new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      server.once('error', onError)
      server.listen(port, 'localhost', () => {
        server.removeListener('error', onError)
        resolve()
      })
    })
  try {
    await listen(DESKTOP_SERVER_PORT)
  } catch (error) {
    if (
      DESKTOP_SERVER_PORT !== 0 &&
      error &&
      typeof error === 'object' &&
      error.code === 'EADDRINUSE'
    ) {
      throw new Error(
        `StatsKey desktop could not reserve its persistent local address on port ${DESKTOP_SERVER_PORT}. Close the process using that port, then reopen StatsKey.`,
        { cause: error }
      )
    }
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('StatsKey desktop could not reserve a local port.')
  }
  expectedHost = `localhost:${address.port}`
  bundledWebServer = server
  return `http://${expectedHost}/app`
}

function desktopContentSecurityPolicy(pathname) {
  const isCadKernelWorker =
    /^\/assets\/cad\.worker-[a-zA-Z0-9_-]+\.js$/.test(pathname)
  return [
    "default-src 'self'",
    isCadKernelWorker
      ? "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'"
      : "script-src 'self' 'wasm-unsafe-eval' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    "frame-src https://statskey.firebaseapp.com https://statskey.web.app https://accounts.google.com https://appleid.apple.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    case '.wasm': return 'application/wasm'
    default: return 'application/octet-stream'
  }
}

async function loadStatsKey(window) {
  try {
    if (!appUrl) throw new Error('StatsKey app URL is unavailable')
    await window.loadURL(appUrl)
  } catch {
    try {
      if (!window.isDestroyed()) {
        await window.loadFile(path.join(__dirname, 'offline.html'))
      }
    } catch {
      // A concurrent navigation superseded the fallback; nothing to show.
    }
  }
}

function configurePermissions() {
  const desktopSession = session.defaultSession

  desktopSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      isTrustedAppOrigin(requestingOrigin) && permission === 'notifications'
  )

  desktopSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const source = details.requestingUrl || webContents.getURL()
    callback(isTrustedAppOrigin(source) && permission === 'notifications')
  })
}

function initializeDesktopUpdates() {
  if (updateRuntime) return
  updateRuntime = new DesktopUpdateRuntime({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    feedRoot: UPDATE_FEED_ROOT,
    publishState: (state) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.setProgressBar(
        state.status === 'downloading' && Number.isFinite(state.percent)
          ? Math.min(1, Math.max(0, state.percent / 100))
          : -1
      )
      mainWindow.webContents.send('statskey-desktop:update-state', state)
    },
    notifyDownloaded: (version) => {
      if (
        !Notification.isSupported() ||
        (mainWindow?.isVisible() && mainWindow.isFocused())
      ) {
        return
      }
      const notification = new Notification({
        title: 'StatsKey update ready',
        body: `Version ${version} is ready. Restart whenever convenient.`,
        silent: true,
      })
      notification.on('click', () => summonStatsKey())
      notification.show()
    },
    getDismissedVersion: () =>
      readDesktopPreferences().dismissedUpdateVersion || null,
    setDismissedVersion: (version) => {
      const current = readDesktopPreferences()
      writeDesktopPreferences(
        sanitizeDesktopPreferences({
          ...current,
          dismissedUpdateVersion: version,
        })
      )
    },
  })
  updateRuntime.initialize()
  updateRuntime.startAutomaticChecks()
}

function desktopUpdateState() {
  return (
    updateRuntime?.getState() || {
      status: 'disabled',
      currentVersion: app.getVersion(),
      manual: false,
      dismissed: false,
    }
  )
}

function flushPendingMenuCommands() {
  if (!mainWindow || mainWindow.isDestroyed() || !menuRendererReady) return
  const queued = pendingMenuCommands.splice(0)
  for (const command of queued) {
    mainWindow.webContents.send('statskey-desktop:menu-command', command)
  }
}

function sendMenuCommand(command) {
  // Commands are queued until the renderer announces it subscribed
  // ('statskey-desktop:menu-ready'); did-finish-load alone fires before the
  // app has mounted its listener, and commands sent then were dropped.
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingMenuCommands.push(command)
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (menuRendererReady && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('statskey-desktop:menu-command', command)
    return
  }
  pendingMenuCommands.push(command)
}

function installApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'StatsKey',
            submenu: [
              { role: 'about' },
              {
                label: 'Check for Updates…',
                click: () => void updateRuntime?.check(true),
              },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendMenuCommand('open-settings'),
              },
              { type: 'separator' },
              {
                label: 'Ask StatsKey',
                accelerator: 'CmdOrCtrl+L',
                click: () => summonStatsKey(),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuCommand('new-chat'),
        },
        { type: 'separator' },
        {
          label: 'Save All',
          accelerator: 'Alt+CmdOrCtrl+S',
          click: () => sendMenuCommand('save-all'),
        },
        { type: 'separator' },
        ...(process.platform === 'darwin'
          ? []
          : [
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendMenuCommand('open-settings'),
              },
              { type: 'separator' },
            ]),
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendMenuCommand('close-tab'),
        },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          role: 'close',
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Not bare roles: the unsaved-changes dialog needs to know the unload
        // came from a reload so it offers Reload instead of Close.
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindowReloadRequested = true
            mainWindow.webContents.reload()
          },
        },
        {
          label: 'Force Reload',
          accelerator: 'Shift+CmdOrCtrl+R',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindowReloadRequested = true
            mainWindow.webContents.reloadIgnoringCache()
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    ...(process.platform === 'darwin'
      ? [{ role: 'windowMenu' }]
      : [
          {
            label: 'Window',
            submenu: [
              { role: 'minimize' },
              { role: 'zoom' },
              { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
            ],
          },
        ]),
    ...(process.platform === 'darwin'
      ? [
          {
            role: 'help',
            submenu: [
              {
                label: 'StatsKey Support',
                click: () =>
                  void openExternal('https://statskey.ai/support.html'),
              },
              {
                label: 'Check for Updates…',
                click: () => void updateRuntime?.check(true),
              },
            ],
          },
        ]
      : [
          {
            label: 'Help',
            submenu: [
              {
                label: 'StatsKey Support',
                click: () =>
                  void openExternal('https://statskey.ai/support.html'),
              },
              {
                label: 'Check for Updates…',
                click: () => void updateRuntime?.check(true),
              },
              { type: 'separator' },
              { role: 'about' },
            ],
          },
        ]),
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  if (process.platform === 'darwin') {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        { label: 'Ask StatsKey', click: () => summonStatsKey() },
        { label: 'New Chat', click: () => sendMenuCommand('new-chat') },
      ])
    )
  }
}

function normalizeAppUrl(candidate) {
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString()
  } catch {
    return null
  }
}

function configuredDesktopPort() {
  const configured = Number.parseInt(process.env.STATSKEY_DESKTOP_PORT || '', 10)
  if (Number.isInteger(configured) && configured >= 1024 && configured <= 65_535) {
    return configured
  }
  // Browser persistence is origin-scoped. Stable ports keep IndexedDB and
  // localStorage attached to the same desktop origin across app restarts.
  return app.isPackaged ? 43_127 : 43_128
}

function isStatsKeyPage(candidate) {
  try {
    const url = new URL(candidate)
    return trustedAppOrigins.has(url.origin) && (url.pathname === '/app' || url.pathname.startsWith('/app/'))
  } catch {
    return false
  }
}

function isTrustedAppOrigin(candidate) {
  try {
    return trustedAppOrigins.has(new URL(candidate).origin)
  } catch {
    return false
  }
}

function isTrustedAuthStart(candidate) {
  if (candidate === 'about:blank') return true
  try {
    const url = new URL(candidate)
    return (
      ((url.origin === 'https://statskey.firebaseapp.com' ||
        url.origin === 'https://statskey.web.app') &&
        url.pathname.startsWith('/__/auth/'))
    )
  } catch {
    return false
  }
}

function isGoogleAssistantAuthorization(candidate) {
  try {
    const url = new URL(candidate)
    return (
      url.origin === 'https://accounts.google.com' &&
      url.pathname === '/o/oauth2/v2/auth' &&
      url.searchParams.get('response_type') === 'code' &&
      url.searchParams.get('code_challenge_method') === 'S256'
    )
  } catch {
    return false
  }
}

function isApprovedExternalAuthorization(candidate) {
  if (isGoogleAssistantAuthorization(candidate)) return true
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:') return false
    if (url.hostname === 'checkout.stripe.com') {
      return url.pathname.startsWith('/c/pay/')
    }
    if (url.hostname === 'billing.stripe.com') {
      return url.pathname.startsWith('/p/session/')
    }
    return false
  } catch {
    return false
  }
}

function isTrustedAuthNavigation(candidate) {
  if (candidate === 'about:blank') return true
  try {
    return trustedAuthOrigins.has(new URL(candidate).origin)
  } catch {
    return false
  }
}

async function openExternal(candidate) {
  try {
    const url = new URL(candidate)
    if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) return
    await shell.openExternal(url.toString())
  } catch {
    // Ignore malformed or unsupported links.
  }
}

function routeProtocolUrl(url) {
  if (!url.startsWith('statskey-desktop://')) return
  if (!mainWindow || mainWindow.isDestroyed() || !isStatsKeyPage(mainWindow.webContents.getURL())) {
    pendingProtocolUrl = url
    return
  }
  sendProtocolUrl(url)
}

function sendProtocolUrl(url) {
  mainWindow?.webContents.send('statskey-desktop:open-url', url)
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  bringToCurrentSpace(mainWindow)
}
