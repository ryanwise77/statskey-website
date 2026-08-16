const { contextBridge, ipcRenderer } = require('electron')

function workspaceOperationBinding(value) {
  if (value === undefined || value === null) return undefined
  return {
    workspaceId:
      value && typeof value === 'object' &&
      typeof value.workspaceId === 'string'
        ? value.workspaceId.slice(0, 80)
        : '',
  }
}

const DEVICE_PLATFORMS = new Set(['ios', 'android'])
const DEVICE_ACTIONS = new Set([
  'boot', 'install', 'launch', 'inspect', 'screenshot', 'tap', 'type',
  'swipe', 'back', 'home', 'open_url', 'add_media', 'process', 'logs', 'close',
])
const FOUNDER_MODE =
  Array.isArray(process.argv) && process.argv.includes('--statskey-founder')
const FOUNDER_BUILD =
  Array.isArray(process.argv) && process.argv.includes('--statskey-founder-build')
const FOUNDER_CHECKS = new Set([
  'oil-storage',
  'macremote-doctor',
  'macremote-connectivity',
])
const FOUNDER_ACTIONS = new Set([
  'open-truenas',
  'open-idrac',
  'mount-oil-share',
  'open-oil-workspace',
  'start-mac-ssh',
  'open-mac-screen',
  'stop-mac-screen',
])
const DURABLE_RENDERER_STATE_KEYS = new Set([
  'statskey.agent.activeRuns.v2',
  'statskey.cad.recoveryDocument.v1',
  'statskey.cad.session.v1',
])

function terminalShellDescriptor() {
  const windows = process.platform === 'win32'
  const environment = process.env || {}
  const candidate = windows
    ? environment.ComSpec || environment.COMSPEC || 'cmd.exe'
    : environment.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
  const executable = String(candidate)
    .split(/[\\/]/)
    .filter(Boolean)
    .pop()
  return Object.freeze({
    kind: windows ? 'cmd' : 'posix',
    executable:
      executable && /^[A-Za-z0-9._+-]{1,80}$/.test(executable)
        ? executable
        : windows
          ? 'cmd.exe'
          : process.platform === 'darwin'
            ? 'zsh'
            : 'sh',
  })
}

function deviceActionRequest(value) {
  if (!value || typeof value !== 'object') return null
  if (!DEVICE_PLATFORMS.has(value.platform) || !DEVICE_ACTIONS.has(value.action)) {
    return null
  }
  const request = {
    platform: value.platform,
    action: value.action,
    deviceId: typeof value.deviceId === 'string' ? value.deviceId.slice(0, 160) : '',
  }
  for (const key of ['artifactPath', 'mediaPath', 'url', 'appId', 'activity', 'text']) {
    if (typeof value[key] === 'string') request[key] = value[key].slice(0, 4_000)
  }
  for (const key of ['x', 'y', 'endX', 'endY', 'durationMs', 'logSinceSeconds']) {
    if (Number.isFinite(value[key])) request[key] = value[key]
  }
  if (value.environment && typeof value.environment === 'object') {
    request.environment = Object.fromEntries(
      Object.entries(value.environment)
        .filter(([key, entry]) =>
          /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) &&
          !/^(?:HOME|PATH|SHELL|TMPDIR|DYLD_|LD_|NODE_|ELECTRON_|JAVA_|JDK_)/.test(key) &&
          typeof entry === 'string'
        )
        .slice(0, 24)
        .map(([key, entry]) => [key, entry.slice(0, 2_000)])
    )
  }
  return request
}

contextBridge.exposeInMainWorld(
  'statsKeyDesktop',
  Object.freeze({
    platform: process.platform,
    terminalShell: terminalShellDescriptor(),
    electronVersion: process.versions.electron,
    founderMode: FOUNDER_MODE,
    founderBuild: FOUNDER_BUILD,
    ...(FOUNDER_MODE
      ? {
          founder: Object.freeze({
            state() {
              return ipcRenderer.invoke('statskey-desktop:founder-state')
            },
            runCheck(check) {
              if (!FOUNDER_CHECKS.has(check)) {
                return Promise.resolve({
                  ok: false,
                  error: 'That Founder diagnostic is not allowed.',
                })
              }
              return ipcRenderer.invoke(
                'statskey-desktop:founder-check',
                check
              )
            },
            perform(action) {
              if (!FOUNDER_ACTIONS.has(action)) {
                return Promise.resolve({
                  ok: false,
                  error: 'That Founder action is not allowed.',
                })
              }
              return ipcRenderer.invoke(
                'statskey-desktop:founder-action',
                action
              )
            },
          }),
        }
      : {}),
    retry() {
      ipcRenderer.send('statskey-desktop:retry')
    },
    setBadge(count) {
      if (!Number.isFinite(count)) return
      ipcRenderer.send('statskey-desktop:set-badge', count)
    },
    notify(payload) {
      if (payload == null || typeof payload !== 'object') return
      ipcRenderer.send('statskey-desktop:notify', {
        title: typeof payload.title === 'string' ? payload.title : '',
        body: typeof payload.body === 'string' ? payload.body : '',
      })
    },
    durableState: Object.freeze({
      get(key) {
        if (!DURABLE_RENDERER_STATE_KEYS.has(key)) return null
        return ipcRenderer.sendSync('statskey-desktop:durable-state-get', key)
      },
      set(key, value) {
        if (
          !DURABLE_RENDERER_STATE_KEYS.has(key) ||
          (typeof value !== 'string' && value !== null)
        ) {
          return false
        }
        return ipcRenderer.sendSync(
          'statskey-desktop:durable-state-set',
          key,
          value
        )
      },
    }),
    openExternal(url) {
      if (typeof url !== 'string') return Promise.resolve(false)
      return ipcRenderer.invoke('statskey-desktop:open-external', url)
    },
    openCalendarFile(contents, fileName) {
      if (typeof contents !== 'string' || typeof fileName !== 'string') {
        return Promise.resolve({ ok: false, error: 'Invalid calendar event.' })
      }
      return ipcRenderer.invoke(
        'statskey-desktop:open-calendar-file',
        contents,
        fileName
      )
    },
    shareCalendarFile(contents, fileName, description) {
      if (
        typeof contents !== 'string' ||
        typeof fileName !== 'string' ||
        typeof description !== 'string'
      ) {
        return Promise.resolve({ ok: false, error: 'Invalid calendar event.' })
      }
      return ipcRenderer.invoke(
        'statskey-desktop:share-calendar-file',
        contents,
        fileName,
        description
      )
    },
    calendarFeeds: Object.freeze({
      list() {
        return ipcRenderer.invoke('statskey-desktop:calendar-feeds-list')
      },
      add(name, url) {
        if (typeof name !== 'string' || typeof url !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid calendar feed.' })
        }
        return ipcRenderer.invoke('statskey-desktop:calendar-feeds-add', {
          name,
          url,
        })
      },
      remove(feedId) {
        if (typeof feedId !== 'string') return Promise.resolve(false)
        return ipcRenderer.invoke(
          'statskey-desktop:calendar-feeds-remove',
          feedId
        )
      },
      events(start, end, limit = 100) {
        if (typeof start !== 'string' || typeof end !== 'string') {
          return Promise.resolve({ events: [], errors: ['Invalid date range.'] })
        }
        return ipcRenderer.invoke('statskey-desktop:calendar-feeds-events', {
          start,
          end,
          limit,
        })
      },
    }),
    updates: Object.freeze({
      getState() {
        return ipcRenderer.invoke('statskey-desktop:updates-state')
      },
      check() {
        return ipcRenderer.invoke('statskey-desktop:updates-check')
      },
      download() {
        return ipcRenderer.invoke('statskey-desktop:updates-download')
      },
      install() {
        return ipcRenderer.invoke('statskey-desktop:updates-install')
      },
      dismiss() {
        return ipcRenderer.invoke('statskey-desktop:updates-dismiss')
      },
      onState(listener) {
        if (typeof listener !== 'function') return () => {}
        const wrapped = (_event, state) => listener(state)
        ipcRenderer.on('statskey-desktop:update-state', wrapped)
        return () =>
          ipcRenderer.removeListener('statskey-desktop:update-state', wrapped)
      },
    }),
    browser: Object.freeze({
      open(url, approvalMode = 'review', origin, options) {
        if (typeof url !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid browser URL.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:browser-open',
          url,
          approvalMode,
          origin,
          options && typeof options === 'object'
            ? { newTab: options.newTab === true }
            : undefined
        )
      },
      list(origin) {
        return ipcRenderer.invoke('statskey-desktop:browser-list', origin)
      },
      activate(tabId) {
        if (typeof tabId !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid browser tab.' })
        }
        return ipcRenderer.invoke('statskey-desktop:browser-activate', tabId)
      },
      navigate(tabId, navigation, approvalMode = 'review', origin) {
        if (
          typeof tabId !== 'string' ||
          !navigation ||
          typeof navigation !== 'object' ||
          !['url', 'back', 'forward', 'reload'].includes(navigation.action)
        ) {
          return Promise.resolve({ ok: false, error: 'Invalid browser navigation.' })
        }
        const safeNavigation =
          navigation.action === 'url'
            ? {
                action: 'url',
                url: typeof navigation.url === 'string' ? navigation.url : '',
              }
            : { action: navigation.action }
        return ipcRenderer.invoke(
          'statskey-desktop:browser-navigate',
          tabId,
          safeNavigation,
          approvalMode,
          origin
        )
      },
      snapshot(tabId, origin) {
        if (tabId !== undefined && typeof tabId !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid browser tab.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:browser-snapshot',
          tabId,
          origin
        )
      },
      click(revision, ref, approvalMode = 'review', origin, tabId) {
        if (typeof revision !== 'string' || typeof ref !== 'string') {
          return Promise.resolve({
            ok: false,
            error: 'Request a fresh browser snapshot.',
          })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:browser-action',
          { action: 'click', revision, ref, tabId },
          approvalMode,
          origin
        )
      },
      type(revision, ref, text, approvalMode = 'review', origin, tabId) {
        if (
          typeof revision !== 'string' ||
          typeof ref !== 'string' ||
          typeof text !== 'string'
        ) {
          return Promise.resolve({
            ok: false,
            error: 'Invalid browser typing request.',
          })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:browser-action',
          { action: 'type', revision, ref, text, tabId },
          approvalMode,
          origin
        )
      },
      screenshot(tabId, origin) {
        if (tabId !== undefined && typeof tabId !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid browser tab.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:browser-screenshot',
          tabId,
          origin
        )
      },
      close(tabId, origin) {
        if (tabId !== undefined && typeof tabId !== 'string') {
          return Promise.resolve(false)
        }
        return ipcRenderer.invoke('statskey-desktop:browser-close', tabId, origin)
      },
      onState(listener) {
        if (typeof listener !== 'function') return () => {}
        const handler = (_event, state) => listener(state)
        ipcRenderer.on('statskey-desktop:browser-state', handler)
        return () =>
          ipcRenderer.removeListener('statskey-desktop:browser-state', handler)
      },
    }),
    applications: Object.freeze({
      list() {
        return ipcRenderer.invoke('statskey-desktop:applications-list')
      },
      open(name, approvalMode = 'review', origin) {
        if (typeof name !== 'string') {
          return Promise.resolve({
            ok: false,
            error: 'Invalid application name.',
          })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:applications-open',
          name,
          approvalMode,
          origin
        )
      },
    }),
    devices: Object.freeze({
      list(binding, origin) {
        return ipcRenderer.invoke(
          'statskey-desktop:devices-list',
          workspaceOperationBinding(binding),
          origin
        )
      },
      act(request, approvalMode = 'review', origin, binding) {
        const safeRequest = deviceActionRequest(request)
        if (!safeRequest) {
          return Promise.resolve({
            ok: false,
            error: 'Invalid simulator or emulator action.',
          })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:devices-act',
          safeRequest,
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
    }),
    workspace: Object.freeze({
      getState(binding) {
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-state',
          workspaceOperationBinding(binding)
        )
      },
      onState(listener) {
        if (typeof listener !== 'function') return () => {}
        const handler = (_event, state) => listener(state)
        ipcRenderer.on('statskey-desktop:workspace-state-changed', handler)
        return () =>
          ipcRenderer.removeListener(
            'statskey-desktop:workspace-state-changed',
            handler
          )
      },
      recentProjects() {
        return ipcRenderer.invoke('statskey-desktop:workspace-recents')
      },
      importCursorWorkspaces() {
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-import-cursor'
        )
      },
      openRecentProject(workspaceId) {
        if (typeof workspaceId !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid recent project.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-open-recent',
          workspaceId
        )
      },
      saveWorkspace(name) {
        if (typeof name !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace name.' })
        }
        return ipcRenderer.invoke('statskey-desktop:workspace-save-current', name)
      },
      renameRecentProject(workspaceId, name) {
        if (typeof workspaceId !== 'string' || typeof name !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-rename-recent',
          workspaceId,
          name
        )
      },
      removeRecentProject(workspaceId) {
        if (typeof workspaceId !== 'string') return Promise.resolve(false)
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-remove-recent',
          workspaceId
        )
      },
      chooseFolder() {
        return ipcRenderer.invoke('statskey-desktop:workspace-choose-folder')
      },
      createFromFolders() {
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-create-from-folders'
        )
      },
      openProject() {
        return ipcRenderer.invoke('statskey-desktop:workspace-open-project')
      },
      openStatsKeySource() {
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-open-statskey-source'
        )
      },
      createProject() {
        return ipcRenderer.invoke('statskey-desktop:workspace-create-project')
      },
      cloneProject(repositoryUrl) {
        if (typeof repositoryUrl !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid repository URL.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-clone-project',
          repositoryUrl
        )
      },
      removeRoot(rootPath) {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace root.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-remove-root',
          rootPath
        )
      },
      closeWorkspace() {
        return ipcRenderer.invoke('statskey-desktop:workspace-close')
      },
      importWorkspaceFile() {
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-import-file'
        )
      },
      addFiles() {
        return ipcRenderer.invoke('statskey-desktop:workspace-add-files')
      },
      listDirectory(directoryPath) {
        if (typeof directoryPath !== 'string') return Promise.resolve([])
        return ipcRenderer.invoke('statskey-desktop:workspace-list', directoryPath)
      },
      readFile(filePath, runWorkspaceHooks = true, binding) {
        if (typeof filePath !== 'string') return Promise.resolve(null)
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-read',
          filePath,
          runWorkspaceHooks === true,
          workspaceOperationBinding(binding)
        )
      },
      readMedia(filePath, binding) {
        if (typeof filePath !== 'string') return Promise.resolve(null)
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-read-media',
          filePath,
          workspaceOperationBinding(binding)
        )
      },
      search(query, binding) {
        if (typeof query !== 'string') return Promise.resolve([])
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-search',
          query,
          workspaceOperationBinding(binding)
        )
      },
      indexState() {
        return ipcRenderer.invoke('statskey-desktop:workspace-index-state')
      },
      refreshIndex() {
        return ipcRenderer.invoke('statskey-desktop:workspace-index-refresh')
      },
      indexSearch(query, mode = 'hybrid', binding) {
        if (typeof query !== 'string') return Promise.resolve([])
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-index-search',
          query,
          mode,
          workspaceOperationBinding(binding)
        )
      },
      onIndexState(listener) {
        if (typeof listener !== 'function') return () => {}
        const handler = (_event, state) => listener(state)
        ipcRenderer.on('statskey-desktop:workspace-index-state', handler)
        return () =>
          ipcRenderer.removeListener(
            'statskey-desktop:workspace-index-state',
            handler
          )
      },
      reveal(filePath) {
        if (typeof filePath !== 'string') return Promise.resolve(false)
        return ipcRenderer.invoke('statskey-desktop:workspace-reveal', filePath)
      },
      writeFile(
        filePath,
        content,
        approvalMode = 'review',
        expectedModifiedAt,
        origin,
        binding
      ) {
        if (typeof filePath !== 'string' || typeof content !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid file edit.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-write',
          filePath,
          content,
          approvalMode,
          typeof expectedModifiedAt === 'string'
            ? expectedModifiedAt
            : undefined,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      createFile(rootPath, relativePath, content, approvalMode = 'review', origin, binding) {
        if (
          typeof rootPath !== 'string' ||
          typeof relativePath !== 'string' ||
          typeof content !== 'string'
        ) {
          return Promise.resolve({ ok: false, error: 'Invalid new file.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-create',
          rootPath,
          relativePath,
          content,
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      renderPdf(rootPath, relativePath, htmlBody, title, approvalMode = 'review', origin, binding) {
        if (
          typeof rootPath !== 'string' ||
          typeof relativePath !== 'string' ||
          typeof htmlBody !== 'string'
        ) {
          return Promise.resolve({ ok: false, error: 'Invalid PDF export.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-render-pdf',
          rootPath,
          relativePath,
          htmlBody,
          typeof title === 'string' ? title : '',
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      exportPdf(fileName, htmlBody, title, approvalMode = 'review', origin) {
        if (typeof fileName !== 'string' || typeof htmlBody !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid PDF export.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-export-pdf',
          fileName,
          htmlBody,
          typeof title === 'string' ? title : '',
          approvalMode,
          origin
        )
      },
      deleteFile(filePath, approvalMode = 'review', origin, binding) {
        if (typeof filePath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid file.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-delete',
          filePath,
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      renameFile(filePath, nextName, approvalMode = 'review', origin, binding) {
        if (typeof filePath !== 'string' || typeof nextName !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid file name.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-rename',
          filePath,
          nextName,
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      runCommand(command, cwd, approvalMode = 'review', binding) {
        if (typeof command !== 'string' || typeof cwd !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid command.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-run-command',
          command,
          cwd,
          approvalMode,
          workspaceOperationBinding(binding)
        )
      },
      startTerminal(
        command,
        cwd,
        approvalMode = 'review',
        dimensions = {},
        origin,
        binding,
        options = {}
      ) {
        if (typeof command !== 'string' || typeof cwd !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid command.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:terminal-start',
          command,
          cwd,
          approvalMode,
          {
            cols: Number.isFinite(dimensions.cols) ? dimensions.cols : 100,
            rows: Number.isFinite(dimensions.rows) ? dimensions.rows : 28,
          },
          origin,
          workspaceOperationBinding(binding),
          {
            failClosed: options?.failClosed === true,
            environment:
              options?.environment && typeof options.environment === 'object'
                ? Object.fromEntries(
                    Object.entries(options.environment)
                      .filter(([key, value]) =>
                        ['JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT'].includes(key) &&
                        typeof value === 'string' &&
                        !value.includes('\0')
                      )
                      .slice(0, 24)
                      .map(([key, value]) => [key, value.slice(0, 4_000)])
                  )
                : undefined,
          }
        )
      },
      listTerminalSessions() {
        return ipcRenderer.invoke('statskey-desktop:terminal-list')
      },
      writeTerminal(sessionId, data) {
        if (typeof sessionId !== 'string' || typeof data !== 'string') {
          return Promise.resolve(false)
        }
        return ipcRenderer.invoke(
          'statskey-desktop:terminal-write',
          sessionId,
          data
        )
      },
      resizeTerminal(sessionId, cols, rows) {
        if (
          typeof sessionId !== 'string' ||
          !Number.isFinite(cols) ||
          !Number.isFinite(rows)
        ) {
          return Promise.resolve(false)
        }
        return ipcRenderer.invoke(
          'statskey-desktop:terminal-resize',
          sessionId,
          cols,
          rows
        )
      },
      cancelTerminal(sessionId) {
        if (typeof sessionId !== 'string') return Promise.resolve(false)
        return ipcRenderer.invoke(
          'statskey-desktop:terminal-cancel',
          sessionId
        )
      },
      onTerminalEvent(listener) {
        if (typeof listener !== 'function') return () => {}
        const wrapped = (_event, payload) => listener(payload)
        ipcRenderer.on('statskey-desktop:terminal-event', wrapped)
        return () =>
          ipcRenderer.removeListener(
            'statskey-desktop:terminal-event',
            wrapped
          )
      },
      gitInitialize(rootPath, approvalMode = 'review') {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace root.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-initialize',
          rootPath,
          approvalMode
        )
      },
      gitStatus(rootPath, binding) {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace root.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-status',
          rootPath,
          workspaceOperationBinding(binding)
        )
      },
      gitFiles(rootPath) {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({
            ok: false,
            files: [],
            error: 'Invalid workspace root.',
          })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-files',
          rootPath
        )
      },
      gitDiff(rootPath, staged = false, paths, binding) {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace root.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-diff',
          rootPath,
          staged === true,
          Array.isArray(paths) ? paths : undefined,
          workspaceOperationBinding(binding)
        )
      },
      gitStageAll(rootPath) {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace root.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-stage-all',
          rootPath
        )
      },
      gitStagePaths(rootPath, paths) {
        if (typeof rootPath !== 'string' || !Array.isArray(paths)) {
          return Promise.resolve({ ok: false, error: 'Invalid Git paths.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-stage-paths',
          rootPath,
          paths
        )
      },
      gitUnstageAll(rootPath) {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace root.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-unstage-all',
          rootPath
        )
      },
      gitUnstagePaths(rootPath, paths) {
        if (typeof rootPath !== 'string' || !Array.isArray(paths)) {
          return Promise.resolve({ ok: false, error: 'Invalid Git paths.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-unstage-paths',
          rootPath,
          paths
        )
      },
      gitCommit(rootPath, message, approvalMode = 'review') {
        if (typeof rootPath !== 'string' || typeof message !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid commit.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-commit',
          rootPath,
          message,
          approvalMode
        )
      },
      gitPush(rootPath, approvalMode = 'review') {
        if (typeof rootPath !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid workspace root.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-git-push',
          rootPath,
          approvalMode
        )
      },
      worktrees(rootPath) {
        if (typeof rootPath !== 'string') return Promise.resolve([])
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-worktrees',
          rootPath
        )
      },
      createWorktree(rootPath, label, approvalMode = 'review') {
        if (typeof rootPath !== 'string' || typeof label !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid task workspace.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-worktree-create',
          rootPath,
          label,
          approvalMode
        )
      },
      activateWorktree(rootPath, worktreePath) {
        if (
          typeof rootPath !== 'string' ||
          typeof worktreePath !== 'string'
        ) {
          return Promise.resolve({ ok: false, error: 'Invalid task workspace.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-worktree-activate',
          rootPath,
          worktreePath
        )
      },
      removeWorktree(rootPath, worktreePath, approvalMode = 'review') {
        if (
          typeof rootPath !== 'string' ||
          typeof worktreePath !== 'string'
        ) {
          return Promise.resolve({ ok: false, error: 'Invalid task workspace.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-worktree-remove',
          rootPath,
          worktreePath,
          approvalMode
        )
      },
      checkpoints(binding) {
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-checkpoints',
          workspaceOperationBinding(binding)
        )
      },
      instructions(binding) {
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-instructions',
          workspaceOperationBinding(binding)
        )
      },
      runHook(hookName, payload, approvalMode = 'review', origin, binding) {
        if (typeof hookName !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid hook event.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-run-hook',
          hookName,
          payload && typeof payload === 'object' ? payload : {},
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      restoreCheckpoint(checkpointId, approvalMode = 'review', origin, binding) {
        if (typeof checkpointId !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid checkpoint.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:workspace-restore-checkpoint',
          checkpointId,
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      onOperationRequest(listener) {
        if (typeof listener !== 'function') return () => {}
        const handler = (_event, operation) => listener(operation)
        ipcRenderer.on('statskey-desktop:operation-request', handler)
        return () =>
          ipcRenderer.removeListener(
            'statskey-desktop:operation-request',
            handler
          )
      },
      onOperationSettled(listener) {
        if (typeof listener !== 'function') return () => {}
        const handler = (_event, settlement) => listener(settlement)
        ipcRenderer.on('statskey-desktop:operation-settled', handler)
        return () =>
          ipcRenderer.removeListener(
            'statskey-desktop:operation-settled',
            handler
          )
      },
      resolveOperation(operationId, approved) {
        if (typeof operationId !== 'string') return
        ipcRenderer.send(
          'statskey-desktop:operation-decision',
          operationId,
          approved === true
        )
      },
    }),
    providers: Object.freeze({
      getStatus() {
        return ipcRenderer.invoke('statskey-desktop:providers-status')
      },
      save(provider, settings) {
        if (typeof provider !== 'string' || settings == null || typeof settings !== 'object') {
          return Promise.resolve({ ok: false, error: 'Invalid provider settings.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:providers-save',
          provider,
          settings
        )
      },
      remove(provider) {
        if (typeof provider !== 'string') return Promise.resolve(false)
        return ipcRenderer.invoke('statskey-desktop:providers-remove', provider)
      },
      test(provider) {
        if (typeof provider !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid provider.' })
        }
        return ipcRenderer.invoke('statskey-desktop:providers-test', provider)
      },
      models(provider) {
        if (typeof provider !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid provider.' })
        }
        return ipcRenderer.invoke('statskey-desktop:providers-models', provider)
      },
      run(requestId, provider, request, onEvent) {
        if (
          typeof requestId !== 'string' ||
          typeof provider !== 'string' ||
          request == null ||
          typeof request !== 'object'
        ) {
          return Promise.reject(new Error('Invalid provider request.'))
        }
        return new Promise((resolve, reject) => {
          const handler = (_event, incomingId, payload) => {
            if (incomingId !== requestId) return
            if (
              payload?.type === 'text' ||
              payload?.type === 'open' ||
              payload?.type === 'queued' ||
              payload?.type === 'activity'
            ) {
              if (typeof onEvent === 'function') onEvent(payload)
              return
            }
            ipcRenderer.removeListener(
              'statskey-desktop:provider-event',
              handler
            )
            if (payload?.type === 'done') {
              resolve(payload.result)
            } else {
              const error = new Error(
                payload?.error || 'Provider request failed.'
              )
              if (payload?.type === 'timeout') {
                error.name = 'ProviderRoundTimeoutError'
              }
              reject(error)
            }
          }
          ipcRenderer.on('statskey-desktop:provider-event', handler)
          ipcRenderer.send(
            'statskey-desktop:provider-run',
            requestId,
            provider,
            request
          )
        })
      },
      cancel(requestId) {
        if (typeof requestId !== 'string') return
        ipcRenderer.send('statskey-desktop:provider-cancel', requestId)
      },
    }),
    integrations: Object.freeze({
      getStatus() {
        return ipcRenderer.invoke('statskey-desktop:integrations-status')
      },
      save(id, settings) {
        if (
          (id != null && typeof id !== 'string') ||
          settings == null ||
          typeof settings !== 'object'
        ) {
          return Promise.resolve({ ok: false, error: 'Invalid connection settings.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:integrations-save',
          id,
          {
            name:
              typeof settings.name === 'string'
                ? settings.name.slice(0, 80)
                : '',
            url:
              typeof settings.url === 'string'
                ? settings.url.slice(0, 4_096)
                : '',
            authType: ['none', 'bearer', 'oauth'].includes(settings.authType)
              ? settings.authType
              : 'none',
            token:
              typeof settings.token === 'string'
                ? settings.token.slice(0, 16_384)
                : '',
          }
        )
      },
      authorize(id) {
        if (typeof id !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid connection.' })
        }
        return ipcRenderer.invoke('statskey-desktop:integrations-authorize', id)
      },
      test(id) {
        if (typeof id !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid connection.' })
        }
        return ipcRenderer.invoke('statskey-desktop:integrations-test', id)
      },
      remove(id) {
        if (typeof id !== 'string') return Promise.resolve(false)
        return ipcRenderer.invoke('statskey-desktop:integrations-remove', id)
      },
    }),
    preferences: Object.freeze({
      get() {
        return ipcRenderer.invoke('statskey-desktop:preferences-get')
      },
      save(preferences) {
        if (preferences == null || typeof preferences !== 'object') {
          return Promise.resolve(false)
        }
        return ipcRenderer.invoke(
          'statskey-desktop:preferences-save',
          preferences
        )
      },
    }),
    mcp: Object.freeze({
      tools(approvalMode = 'review', origin, binding) {
        return ipcRenderer.invoke(
          'statskey-desktop:mcp-tools',
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
      callTool(toolName, args, approvalMode = 'review', origin, binding) {
        if (typeof toolName !== 'string') {
          return Promise.resolve({ ok: false, error: 'Invalid MCP tool.' })
        }
        return ipcRenderer.invoke(
          'statskey-desktop:mcp-call',
          toolName,
          args && typeof args === 'object' ? args : {},
          approvalMode,
          origin,
          workspaceOperationBinding(binding)
        )
      },
    }),
    onOpenUrl(listener) {
      if (typeof listener !== 'function') return () => {}
      const handler = (_event, url) => listener(url)
      ipcRenderer.on('statskey-desktop:open-url', handler)
      return () => ipcRenderer.removeListener('statskey-desktop:open-url', handler)
    },
    onSummon(listener) {
      if (typeof listener !== 'function') return () => {}
      const handler = () => listener()
      ipcRenderer.on('statskey-desktop:summon', handler)
      return () => ipcRenderer.removeListener('statskey-desktop:summon', handler)
    },
    onMenuCommand(listener) {
      if (typeof listener !== 'function') return () => {}
      const handler = (_event, command) => {
        if (typeof command === 'string') listener(command)
      }
      ipcRenderer.on('statskey-desktop:menu-command', handler)
      // Tell main a listener exists so queued menu commands can flush;
      // commands sent before this point were silently dropped.
      ipcRenderer.send('statskey-desktop:menu-ready')
      return () =>
        ipcRenderer.removeListener('statskey-desktop:menu-command', handler)
    },
    menuCommandComplete(command, ok) {
      if (typeof command !== 'string') return
      ipcRenderer.send(
        'statskey-desktop:menu-command-complete',
        command,
        ok === true
      )
    },
  })
)
