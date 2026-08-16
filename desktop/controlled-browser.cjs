const { randomUUID } = require('node:crypto')
const { lookup } = require('node:dns').promises
const net = require('node:net')

const CONTROL_WORLD_ID = 1004
const MAX_URL_LENGTH = 2048
const MAX_TYPE_LENGTH = 12_000
const MAX_PAGE_TEXT = 60_000
const MAX_ELEMENTS = 160
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
const MAX_SCREENSHOT_DIMENSION = 2_048
const MIN_SCREENSHOT_DIMENSION = 64
const MAX_BROWSER_TABS = 12
const CONTROLLED_BROWSER_PARTITION = 'persist:statskey-controlled-browser'

class ControlledBrowserRuntime {
  constructor({
    requestApproval,
    onState,
    createWindow,
    lookupHost,
    settleWindow,
  } = {}) {
    this.requestApproval =
      typeof requestApproval === 'function'
        ? requestApproval
        : async () => false
    this.onState = typeof onState === 'function' ? onState : () => {}
    this.createWindow =
      typeof createWindow === 'function'
        ? createWindow
        : createDefaultBrowserWindow
    this.lookupHost = typeof lookupHost === 'function' ? lookupHost : lookup
    this.settleWindow =
      typeof settleWindow === 'function' ? settleWindow : waitForSettled
    this.tabs = new Map()
    this.activeTabId = null
    this.configuredSessions = new WeakSet()
  }

  state(origin) {
    this.pruneDestroyedTabs()
    const tabs = this.list(origin)
    const active =
      tabs.find((tab) => tab.id === this.activeTabId) || tabs[0] || null
    return {
      open: tabs.length > 0,
      // Preserve the legacy singleton state fields while exposing the tab model.
      url: active?.url ?? null,
      title: active?.title ?? null,
      activeTabId: active?.id ?? null,
      tabs,
    }
  }

  list(origin) {
    this.pruneDestroyedTabs()
    const owner = normalizedBrowserOwner(origin)
    return [...this.tabs.values()]
      .filter((tab) => browserOwnerCanAccess(owner, tab))
      .map((tab) => this.tabState(tab))
  }

  async open(rawUrl, approvalMode = 'review', origin, options = {}) {
    let createdTab = null
    try {
      const url = await validatedBrowserUrl(rawUrl, this.lookupHost)
      const approved = await this.requestApproval(
        {
          kind: 'browser',
          title: 'Open controlled browser',
          description: url.origin,
          command: url.toString(),
          before: '',
          after: '',
        },
        approvalMode
      )
      if (!approved) return { ok: false, cancelled: true }

      const owner = normalizedBrowserOwner(origin)
      assertUsableBrowserOwner(owner)
      const requestedTabId = validTabId(options?.tabId)
      let tab = null
      if (requestedTabId) {
        tab = this.requireTab(requestedTabId, origin)
      } else if (options?.newTab !== true) {
        tab = this.resolveTab(null, origin)
      }
      if (!tab) {
        if (this.tabs.size >= MAX_BROWSER_TABS) {
          throw new Error(
            `Close a controlled browser tab before opening more than ${MAX_BROWSER_TABS}.`
          )
        }
        tab = this.createTab(owner)
        createdTab = tab
      }
      tab.allowedOrigin = url.origin
      tab.blockedNavigation = null
      tab.lastError = null
      this.clearSnapshot(tab)
      await tab.window.loadURL(url.toString())
      this.showTab(tab)
      const snapshot = await this.snapshot(tab.id, origin)
      return { ok: true, tabId: tab.id, snapshot }
    } catch (error) {
      if (createdTab) this.destroyTab(createdTab)
      return { ok: false, error: safeError(error) }
    }
  }

  async navigate(
    tabId,
    rawNavigation,
    approvalMode = 'review',
    origin
  ) {
    try {
      const tab = this.requireTab(tabId, origin)
      const navigation = normalizeNavigation(rawNavigation)
      let targetUrl = null
      if (navigation.action === 'url') {
        targetUrl = await validatedBrowserUrl(navigation.url, this.lookupHost)
      }
      const currentUrl = tab.window.webContents.getURL().slice(0, MAX_URL_LENGTH)
      const command =
        navigation.action === 'url'
          ? targetUrl.toString()
          : `${navigation.action} ${currentUrl}`.trim()
      const approved = await this.requestApproval(
        {
          kind: 'browser',
          title: browserNavigationTitle(navigation.action),
          description:
            navigation.action === 'url' ? targetUrl.origin : currentUrl,
          command,
          before: '',
          after: '',
        },
        approvalMode
      )
      if (!approved) return { ok: false, cancelled: true, tabId: tab.id }

      tab.blockedNavigation = null
      tab.lastError = null
      this.clearSnapshot(tab)
      if (navigation.action === 'url') {
        tab.allowedOrigin = targetUrl.origin
        await tab.window.loadURL(targetUrl.toString())
      } else if (navigation.action === 'back') {
        if (!canNavigateHistory(tab.window.webContents, 'back')) {
          throw new Error('There is no previous browser page.')
        }
        navigateHistory(tab.window.webContents, 'back')
      } else if (navigation.action === 'forward') {
        if (!canNavigateHistory(tab.window.webContents, 'forward')) {
          throw new Error('There is no next browser page.')
        }
        navigateHistory(tab.window.webContents, 'forward')
      } else {
        tab.window.webContents.reload()
      }
      this.showTab(tab)
      await this.settleWindow(tab.window)
      const snapshot = await this.snapshot(tab.id, origin)
      return { ok: true, tabId: tab.id, snapshot }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  }

  activate(tabId, origin) {
    try {
      const tab = this.requireTab(tabId, origin)
      this.showTab(tab)
      return true
    } catch {
      return false
    }
  }

  async snapshot(tabId, origin) {
    let tab
    try {
      tab = this.requireTab(tabId, origin)
    } catch (error) {
      return {
        ok: false,
        error: safeError(error),
      }
    }
    try {
      await this.settleWindow(tab.window)
      const revision = randomUUID()
      const result =
        await tab.window.webContents.executeJavaScriptInIsolatedWorld(
          CONTROL_WORLD_ID,
          [{ code: snapshotScript(revision) }]
        )
      if (!result || !Array.isArray(result.elements)) {
        throw new Error('The controlled browser could not read this page.')
      }
      tab.revision = revision
      tab.elements = new Map(
        result.elements.map((element) => [element.ref, element])
      )
      return {
        ok: true,
        tabId: tab.id,
        revision,
        url: String(result.url || tab.window.webContents.getURL()).slice(
          0,
          MAX_URL_LENGTH
        ),
        title: String(result.title || '').slice(0, 300),
        // Put references before page text so downstream bounded JSON keeps the
        // controls that make a subsequent action possible.
        elements: result.elements.slice(0, MAX_ELEMENTS),
        text: String(result.text || '').slice(0, MAX_PAGE_TEXT),
        blockedNavigation: tab.blockedNavigation,
        untrusted: true,
      }
    } catch (error) {
      return { ok: false, tabId: tab.id, error: safeError(error) }
    }
  }

  async act(rawAction, approvalMode = 'review', origin) {
    try {
      const action =
        rawAction && typeof rawAction === 'object' ? rawAction : {}
      const tab = this.requireTab(validTabId(action.tabId), origin)
      const revision =
        typeof action.revision === 'string' ? action.revision : ''
      const ref = typeof action.ref === 'string' ? action.ref : ''
      const kind =
        action.action === 'click' || action.action === 'type'
          ? action.action
          : null
      if (!kind || !ref || revision !== tab.revision) {
        throw new Error(
          'The page changed. Request a fresh browser snapshot before acting.'
        )
      }
      const element = tab.elements.get(ref)
      if (!element) throw new Error('That browser element is no longer available.')
      if (element.disabled) throw new Error('That browser element is disabled.')
      if (
        kind === 'type' &&
        (element.type === 'password' ||
          element.autocomplete === 'current-password' ||
          element.autocomplete === 'new-password')
      ) {
        throw new Error('StatsKey never types into password fields.')
      }
      if (
        kind === 'type' &&
        element.tag !== 'input' &&
        element.tag !== 'textarea' &&
        element.editable !== true
      ) {
        throw new Error('That page control does not accept typed text.')
      }
      const text =
        kind === 'type' && typeof action.text === 'string'
          ? action.text.slice(0, MAX_TYPE_LENGTH)
          : ''
      if (kind === 'type' && !text) {
        throw new Error('Typing requires non-empty text.')
      }

      const label = element.label || `${element.tag} ${ref}`
      const approved = await this.requestApproval(
        {
          kind: 'browser',
          title:
            kind === 'click'
              ? `Click “${label.slice(0, 100)}”`
              : `Type into “${label.slice(0, 100)}”`,
          description: tab.window.webContents
            .getURL()
            .slice(0, MAX_URL_LENGTH),
          command: browserApprovalCommand(kind, ref, text),
          before: '',
          after: '',
        },
        approvalMode
      )
      if (!approved) return { ok: false, cancelled: true, tabId: tab.id }

      this.showTab(tab)
      const result =
        await tab.window.webContents.executeJavaScriptInIsolatedWorld(
        CONTROL_WORLD_ID,
        [
          {
            code: actionScript({
              revision,
              ref,
              action: kind,
              text,
            }),
          },
        ],
        true
      )
      if (!result?.ok) {
        throw new Error(result?.error || 'The browser action did not complete.')
      }
      await this.settleWindow(tab.window)
      return {
        ok: true,
        tabId: tab.id,
        snapshot: await this.snapshot(tab.id, origin),
      }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  }

  async screenshot(tabId, origin) {
    try {
      const tab = this.requireTab(tabId, origin)
      await this.settleWindow(tab.window)
      const image = await tab.window.webContents.capturePage()
      const payload = boundedPngPayload(image)
      return {
        ok: true,
        tabId: tab.id,
        mimeType: 'image/png',
        ...payload,
      }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  }

  close(tabId, origin) {
    const tab = this.resolveTab(tabId, origin)
    if (!tab) return tabId == null
    this.destroyTab(tab)
    return true
  }

  closeAll() {
    for (const tab of [...this.tabs.values()]) this.destroyTab(tab)
    return true
  }

  createTab(owner) {
    const tabId = randomUUID()
    const window = this.createWindow({
      title: 'StatsKey Controlled Browser',
      width: 1180,
      height: 820,
      minWidth: 760,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: CONTROLLED_BROWSER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
      },
    })
    const tab = {
      id: tabId,
      window,
      ownerKey: owner.key,
      ownerSessionId: owner.sessionId,
      allowedOrigin: null,
      revision: null,
      elements: new Map(),
      blockedNavigation: null,
      loading: false,
      lastError: null,
      createdAt: Date.now(),
    }
    this.tabs.set(tabId, tab)
    this.activeTabId = tabId
    const contents = window.webContents
    const browserSession = contents.session
    this.configureSession(browserSession)
    contents.setWindowOpenHandler((details) => {
      tab.blockedNavigation = String(details?.url || '').slice(0, MAX_URL_LENGTH)
      this.emitState('blocked-navigation', tab)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, candidate) => {
      if (!this.isAllowedNavigation(candidate, tab.id)) {
        event.preventDefault()
        tab.blockedNavigation = String(candidate).slice(0, MAX_URL_LENGTH)
        this.emitState('blocked-navigation', tab)
      }
    })
    contents.on('will-redirect', (event, candidate) => {
      if (!this.isAllowedNavigation(candidate, tab.id)) {
        event.preventDefault()
        tab.blockedNavigation = String(candidate).slice(0, MAX_URL_LENGTH)
        this.emitState('blocked-navigation', tab)
      }
    })
    contents.on(
      'did-start-navigation',
      (_event, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false) this.clearSnapshot(tab)
      }
    )
    contents.on('did-navigate', () => {
      this.clearSnapshot(tab)
      this.updateWindowTitle(tab)
      this.emitState('navigated', tab)
    })
    contents.on('did-navigate-in-page', () => {
      this.clearSnapshot(tab)
      this.updateWindowTitle(tab)
      this.emitState('navigated', tab)
    })
    contents.on('page-title-updated', (event) => {
      event.preventDefault()
      this.updateWindowTitle(tab)
      this.emitState('title', tab)
    })
    contents.on('did-start-loading', () => {
      tab.loading = true
      this.emitState('loading', tab)
    })
    contents.on('did-stop-loading', () => {
      tab.loading = false
      this.emitState('loading', tab)
    })
    contents.on(
      'did-fail-load',
      (_event, _code, description, _url, isMainFrame) => {
        if (isMainFrame === false) return
        tab.loading = false
        tab.lastError = String(description || 'Page load failed.').slice(0, 300)
        this.emitState('error', tab)
      }
    )
    contents.on('will-prevent-unload', (event) => {
      event.preventDefault()
    })
    contents.on('before-input-event', (_event, input) => {
      if (
        input.type === 'keyDown' &&
        (input.key === 'F12' ||
          (input.key.toLowerCase() === 'i' &&
            ((input.meta && input.alt) || (input.control && input.shift))))
      ) {
        _event.preventDefault()
      }
    })
    try {
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    } catch {
      // Older Electron versions may not expose this hardening API.
    }
    window.on('focus', () => {
      this.activeTabId = tab.id
      this.emitState('activated', tab)
    })
    window.on('closed', () => {
      this.removeTab(tab)
    })
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(false)
    }
    this.emitState('created', tab)
    return tab
  }

  configureSession(browserSession) {
    if (!browserSession || this.configuredSessions.has(browserSession)) return
    this.configuredSessions.add(browserSession)
    browserSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    )
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.webRequest.onBeforeRequest(
      {
        urls: [
          'http://*/*',
          'https://*/*',
          'ws://*/*',
          'wss://*/*',
          'file://*/*',
          'ftp://*/*',
        ],
      },
      (details, callback) => {
        const tab = this.tabForWebContentsId(details.webContentsId)
        if (!tab) {
          callback({ cancel: true })
          return
        }
        void networkRequestAllowed(details.url, {
          allowedOrigin: tab.allowedOrigin,
          lookupHost: this.lookupHost,
        })
          .then((allowed) => callback({ cancel: !allowed }))
          .catch(() => callback({ cancel: true }))
      }
    )
    browserSession.on('will-download', (event, item) => {
      event.preventDefault()
      item?.cancel?.()
    })
  }

  isAllowedNavigation(candidate, tabId = this.activeTabId) {
    const tab = tabId ? this.tabs.get(tabId) : null
    if (!tab) return false
    try {
      const url = new URL(candidate)
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        url.origin === tab.allowedOrigin
      )
    } catch {
      return false
    }
  }

  updateWindowTitle(tab) {
    if (!this.isAvailableTab(tab)) return
    try {
      const hostname = new URL(tab.window.webContents.getURL()).hostname
      const pageTitle = String(tab.window.webContents.getTitle?.() || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
      tab.window.setTitle(
        pageTitle || hostname
          ? `StatsKey Controlled Browser — ${pageTitle || hostname}`
          : 'StatsKey Controlled Browser'
      )
    } catch {
      tab.window.setTitle('StatsKey Controlled Browser')
    }
  }

  clearSnapshot(tab) {
    tab.revision = null
    tab.elements.clear()
  }

  availableWindow(origin) {
    return this.resolveTab(null, origin)?.window ?? null
  }

  resolveTab(tabId, origin) {
    this.pruneDestroyedTabs()
    const owner = normalizedBrowserOwner(origin)
    if (owner.restricted && !owner.key) return null
    if (tabId) {
      const tab = this.tabs.get(tabId)
      return tab && browserOwnerCanAccess(owner, tab) ? tab : null
    }
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null
    if (active && browserOwnerCanAccess(owner, active)) return active
    return (
      [...this.tabs.values()].find((tab) => browserOwnerCanAccess(owner, tab)) ||
      null
    )
  }

  requireTab(tabId, origin) {
    const tab = this.resolveTab(validTabId(tabId), origin)
    if (!tab) {
      throw new Error(
        tabId
          ? 'That controlled browser tab is unavailable.'
          : 'Open the controlled browser before using it.'
      )
    }
    return tab
  }

  tabState(tab) {
    const contents = tab.window.webContents
    return {
      id: tab.id,
      title: String(contents.getTitle?.() || tab.window.getTitle?.() || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300),
      url: String(contents.getURL?.() || '').slice(0, MAX_URL_LENGTH),
      loading: Boolean(tab.loading || contents.isLoading?.()),
      canGoBack: canNavigateHistory(contents, 'back'),
      canGoForward: canNavigateHistory(contents, 'forward'),
      active: tab.id === this.activeTabId,
      ...(tab.ownerSessionId
        ? { ownerSessionId: tab.ownerSessionId }
        : {}),
      blockedNavigation: tab.blockedNavigation,
      error: tab.lastError,
    }
  }

  showTab(tab) {
    if (!this.isAvailableTab(tab)) return
    this.activeTabId = tab.id
    tab.window.show()
    tab.window.focus()
    this.emitState('activated', tab)
  }

  destroyTab(tab) {
    if (!tab) return
    if (this.isAvailableTab(tab)) tab.window.close()
    if (this.tabs.has(tab.id)) this.removeTab(tab)
  }

  removeTab(tab) {
    if (!this.tabs.has(tab.id)) return
    this.clearSnapshot(tab)
    this.tabs.delete(tab.id)
    if (this.activeTabId === tab.id) {
      this.activeTabId = [...this.tabs.keys()].at(-1) ?? null
    }
    this.emitState('closed', tab)
  }

  pruneDestroyedTabs() {
    for (const tab of [...this.tabs.values()]) {
      if (!this.isAvailableTab(tab)) this.removeTab(tab)
    }
  }

  isAvailableTab(tab) {
    return Boolean(tab?.window && !tab.window.isDestroyed())
  }

  tabForWebContentsId(webContentsId) {
    if (!Number.isFinite(webContentsId)) return null
    return (
      [...this.tabs.values()].find(
        (tab) =>
          this.isAvailableTab(tab) &&
          tab.window.webContents.id === webContentsId
      ) || null
    )
  }

  emitState(type, tab) {
    try {
      this.onState(this.state(), {
        type,
        tabId: tab?.id ?? null,
      })
    } catch {
      // UI state reporting must never make browser control fail.
    }
  }
}

function createDefaultBrowserWindow(options) {
  // Keep the module loadable under plain Node so URL and policy helpers can be
  // tested without booting Electron.
  const { BrowserWindow } = require('electron')
  return new BrowserWindow(options)
}

function normalizedBrowserOwner(origin) {
  if (origin === undefined || origin === null) {
    return {
      restricted: false,
      key: null,
      sessionId: null,
    }
  }
  if (typeof origin !== 'object') {
    return { restricted: true, key: null, sessionId: null }
  }
  const sessionId =
    typeof origin.sessionId === 'string' && origin.sessionId.trim()
      ? origin.sessionId.trim().slice(0, 160)
      : null
  return {
    restricted: true,
    key: sessionId ? `session:${sessionId}` : null,
    sessionId,
  }
}

function assertUsableBrowserOwner(owner) {
  if (owner.restricted && !owner.key) {
    throw new Error('A controlled browser agent tab requires a conversation.')
  }
}

function browserOwnerCanAccess(owner, tab) {
  if (!owner.restricted) return true
  return Boolean(owner.key && owner.key === tab.ownerKey)
}

function validTabId(candidate) {
  return typeof candidate === 'string' &&
    candidate.length > 0 &&
    candidate.length <= 160
    ? candidate
    : null
}

function normalizeNavigation(candidate) {
  const action = candidate?.action
  if (!['url', 'back', 'forward', 'reload'].includes(action)) {
    throw new Error('Choose a valid browser navigation action.')
  }
  if (action === 'url') {
    if (typeof candidate.url !== 'string' || !candidate.url.trim()) {
      throw new Error('Choose a valid browser URL.')
    }
    return { action, url: candidate.url }
  }
  return { action }
}

function browserNavigationTitle(action) {
  if (action === 'back') return 'Go back in controlled browser'
  if (action === 'forward') return 'Go forward in controlled browser'
  if (action === 'reload') return 'Reload controlled browser page'
  return 'Navigate controlled browser'
}

function navigationHistory(contents) {
  return contents?.navigationHistory || contents
}

function canNavigateHistory(contents, direction) {
  const history = navigationHistory(contents)
  try {
    return direction === 'back'
      ? Boolean(history?.canGoBack?.())
      : Boolean(history?.canGoForward?.())
  } catch {
    return false
  }
}

function navigateHistory(contents, direction) {
  const history = navigationHistory(contents)
  if (direction === 'back') history.goBack()
  else history.goForward()
}

async function validatedBrowserUrl(rawUrl, lookupHost = lookup) {
  if (typeof rawUrl !== 'string' || rawUrl.length > MAX_URL_LENGTH) {
    throw new Error('Choose a valid browser URL.')
  }
  const url = new URL(rawUrl)
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('The controlled browser only opens HTTP or HTTPS pages.')
  }
  if (url.username || url.password) {
    throw new Error('Credentials cannot be embedded in browser URLs.')
  }
  const hostname = url.hostname.toLowerCase()
  const local = isLocalHostname(hostname)
  if (url.protocol === 'http:' && !local) {
    throw new Error('Non-local browser pages must use HTTPS.')
  }
  if (!local) {
    if (isPrivateHost(hostname)) {
      throw new Error('Private-network browser destinations are blocked.')
    }
    const addresses = await lookupHost(hostname, {
      all: true,
      verbatim: true,
    })
    if (
      !Array.isArray(addresses) ||
      addresses.length === 0 ||
      addresses.some(
        (entry) =>
          !entry ||
          typeof entry.address !== 'string' ||
          isPrivateHost(entry.address)
      )
    ) {
      throw new Error('Private-network browser destinations are blocked.')
    }
  }
  url.hash = url.hash.slice(0, 500)
  return url
}

function isLocalHostname(hostname) {
  const normalized = normalizedHost(hostname)
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  )
}

function isPrivateHost(hostname) {
  const normalized = normalizedHost(hostname)
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true
  }
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mappedIpv4) return isPrivateHost(mappedIpv4[1])
  if (normalized.startsWith('::ffff:')) {
    const mapped = ipv4FromMappedIpv6(normalized)
    return mapped ? isPrivateHost(mapped) : true
  }
  const version = net.isIP(normalized)
  if (version === 4) {
    const parts = normalized.split('.').map(Number)
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
      parts[0] >= 224
    )
  }
  if (version === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('fec') ||
      normalized.startsWith('fed') ||
      normalized.startsWith('fee') ||
      normalized.startsWith('fef') ||
      normalized.startsWith('64:ff9b:') ||
      normalized.startsWith('2001:db8:') ||
      normalized.startsWith('ff')
    )
  }
  return false
}

function ipv4FromMappedIpv6(hostname) {
  const suffix = hostname.slice('::ffff:'.length)
  const parts = suffix.split(':')
  if (parts.length !== 2) return null
  const high = Number.parseInt(parts[0], 16)
  const low = Number.parseInt(parts[1], 16)
  if (
    !Number.isInteger(high) ||
    high < 0 ||
    high > 0xffff ||
    !Number.isInteger(low) ||
    low < 0 ||
    low > 0xffff
  ) {
    return null
  }
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

function normalizedHost(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

async function networkRequestAllowed(
  rawUrl,
  { allowedOrigin, lookupHost = lookup } = {}
) {
  try {
    const url = new URL(rawUrl)
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) {
      return false
    }
    if (url.username || url.password) return false
    const hostname = normalizedHost(url.hostname)
    const controlledHostname = allowedOrigin
      ? normalizedHost(new URL(allowedOrigin).hostname)
      : ''
    const controlledIsLocal = isLocalHostname(controlledHostname)
    const requestedIsLocal = isLocalHostname(hostname)
    if (requestedIsLocal && !controlledIsLocal) return false
    if (
      (url.protocol === 'http:' || url.protocol === 'ws:') &&
      !requestedIsLocal
    ) {
      return false
    }
    if (requestedIsLocal) return true
    if (isPrivateHost(hostname)) return false
    const addresses = await lookupHost(hostname, {
      all: true,
      verbatim: true,
    })
    return (
      Array.isArray(addresses) &&
      addresses.length > 0 &&
      addresses.every(
        (entry) =>
          entry &&
          typeof entry.address === 'string' &&
          !isPrivateHost(entry.address)
      )
    )
  } catch {
    return false
  }
}

function boundedPngPayload(sourceImage) {
  if (!sourceImage || typeof sourceImage.toPNG !== 'function') {
    throw new Error('The controlled browser could not capture this page.')
  }
  let image = sourceImage
  let size = normalizedImageSize(image.getSize?.())
  if (
    size.width > MAX_SCREENSHOT_DIMENSION ||
    size.height > MAX_SCREENSHOT_DIMENSION
  ) {
    const scale = Math.min(
      MAX_SCREENSHOT_DIMENSION / size.width,
      MAX_SCREENSHOT_DIMENSION / size.height
    )
    size = {
      width: Math.max(1, Math.floor(size.width * scale)),
      height: Math.max(1, Math.floor(size.height * scale)),
    }
    image = resizedImage(image, size)
  }
  let png = image.toPNG()
  while (
    Buffer.isBuffer(png) &&
    png.length > MAX_SCREENSHOT_BYTES &&
    (size.width > MIN_SCREENSHOT_DIMENSION ||
      size.height > MIN_SCREENSHOT_DIMENSION)
  ) {
    size = {
      width: Math.max(MIN_SCREENSHOT_DIMENSION, Math.floor(size.width * 0.75)),
      height: Math.max(
        MIN_SCREENSHOT_DIMENSION,
        Math.floor(size.height * 0.75)
      ),
    }
    image = resizedImage(image, size)
    png = image.toPNG()
  }
  if (!Buffer.isBuffer(png) || png.length === 0) {
    throw new Error('The controlled browser returned an invalid screenshot.')
  }
  if (png.length > MAX_SCREENSHOT_BYTES) {
    throw new Error('The controlled browser screenshot is too large to use safely.')
  }
  const finalSize = normalizedImageSize(image.getSize?.(), size)
  return {
    data: png.toString('base64'),
    width: finalSize.width,
    height: finalSize.height,
    byteLength: png.length,
  }
}

function normalizedImageSize(candidate, fallback = { width: 1, height: 1 }) {
  const width = Number(candidate?.width)
  const height = Number(candidate?.height)
  return {
    width:
      Number.isFinite(width) && width > 0
        ? Math.max(1, Math.floor(width))
        : fallback.width,
    height:
      Number.isFinite(height) && height > 0
        ? Math.max(1, Math.floor(height))
        : fallback.height,
  }
}

function resizedImage(image, size) {
  if (typeof image.resize !== 'function') {
    throw new Error('The controlled browser screenshot is too large to use safely.')
  }
  return image.resize({ ...size, quality: 'good' })
}

function snapshotScript(revision) {
  return `(() => {
    const revision = ${JSON.stringify(revision)};
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' &&
        rect.width > 1 && rect.height > 1;
    };
    const labelFor = (element) => {
      const aria = element.getAttribute('aria-label') || '';
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelled = labelledBy
        ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ')
        : '';
      const ownLabel = element.labels
        ? Array.from(element.labels).map((label) => label.innerText || '').join(' ')
        : '';
      return (aria || labelled || ownLabel || element.innerText ||
        element.getAttribute('placeholder') || element.getAttribute('title') ||
        element.getAttribute('name') || element.tagName).replace(/\\s+/g, ' ').trim().slice(0, 240);
    };
    const candidates = Array.from(document.querySelectorAll(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
    )).filter(visible).slice(0, ${MAX_ELEMENTS});
    const refs = new Map();
    const elements = candidates.map((element, index) => {
      const ref = 'e' + (index + 1);
      refs.set(ref, element);
      const tag = element.tagName.toLowerCase();
      const type = String(element.getAttribute('type') || '').toLowerCase();
      const autocomplete = String(element.getAttribute('autocomplete') || '').toLowerCase();
      return {
        ref,
        tag,
        type,
        autocomplete,
        editable: Boolean(element.isContentEditable),
        label: labelFor(element),
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        href: tag === 'a' ? String(element.href || '').slice(0, ${MAX_URL_LENGTH}) : undefined
      };
    });
    globalThis.__statsKeyControlledBrowser = { revision, refs };
    return {
      url: location.href,
      title: document.title,
      text: String(document.body?.innerText || '').slice(0, ${MAX_PAGE_TEXT}),
      elements
    };
  })()`
}

function actionScript(action) {
  return `(() => {
    const state = globalThis.__statsKeyControlledBrowser;
    if (!state || state.revision !== ${JSON.stringify(action.revision)}) {
      return { ok: false, error: 'The page changed.' };
    }
    const element = state.refs.get(${JSON.stringify(action.ref)});
    if (!element || !element.isConnected) {
      return { ok: false, error: 'The element is no longer available.' };
    }
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    element.focus();
    if (${JSON.stringify(action.action)} === 'click') {
      if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
        return { ok: false, error: 'The element is disabled.' };
      }
      element.click();
      return { ok: true };
    }
    const type = String(element.getAttribute('type') || '').toLowerCase();
    const autocomplete = String(element.getAttribute('autocomplete') || '').toLowerCase();
    if (type === 'password' || autocomplete === 'current-password' || autocomplete === 'new-password') {
      return { ok: false, error: 'Password fields are blocked.' };
    }
    const text = ${JSON.stringify(action.text)};
    if (element.isContentEditable) {
      element.textContent = text;
    } else if ('value' in element) {
      const prototype = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
    } else {
      return { ok: false, error: 'This element does not accept text.' };
    }
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text
    }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { ok: true };
  })()`
}

async function waitForSettled(window) {
  if (!window.webContents.isLoading()) {
    await delay(250)
    return
  }
  await Promise.race([
    new Promise((resolve) =>
      window.webContents.once('did-stop-loading', resolve)
    ),
    delay(8_000),
  ])
  await delay(250)
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(token|key|secret|password)=?[^,\s]*/gi, '$1=[redacted]')
    .slice(0, 500)
}

function browserApprovalCommand(kind, ref, text = '') {
  return kind === 'click'
    ? `click ${ref}`
    : `type ${text.length} characters into ${ref}`
}

module.exports = {
  boundedPngPayload,
  browserApprovalCommand,
  ControlledBrowserRuntime,
  isLocalHostname,
  isPrivateHost,
  networkRequestAllowed,
  normalizeNavigation,
  normalizedBrowserOwner,
  validatedBrowserUrl,
}
