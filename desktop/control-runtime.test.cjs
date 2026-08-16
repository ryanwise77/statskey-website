const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  boundedPngPayload,
  browserApprovalCommand,
  ControlledBrowserRuntime,
  isPrivateHost,
  networkRequestAllowed,
  normalizeNavigation,
  validatedBrowserUrl,
} = require('./controlled-browser.cjs')
const {
  BLOCKED_APPLICATION_PATTERN,
  safeApplications,
} = require('./controlled-applications.cjs')

test('controlled browser permits reviewed local development URLs', async () => {
  const url = await validatedBrowserUrl('http://localhost:4173/preview')
  assert.equal(url.origin, 'http://localhost:4173')
})

test('controlled browser blocks unsafe protocols, credentials, and private networks', async () => {
  await assert.rejects(
    validatedBrowserUrl('file:///Users/example/private.txt'),
    /HTTP or HTTPS/
  )
  await assert.rejects(
    validatedBrowserUrl('https://user:secret@example.com/'),
    /Credentials/
  )
  await assert.rejects(
    validatedBrowserUrl('https://192.168.1.20/admin'),
    /Private-network/
  )
  assert.equal(isPrivateHost('10.0.0.4'), true)
  assert.equal(isPrivateHost('8.8.8.8'), false)
  assert.equal(isPrivateHost('100.64.0.1'), true)
  assert.equal(isPrivateHost('::ffff:7f00:1'), true)
  assert.equal(isPrivateHost('64:ff9b::7f00:1'), true)
  assert.equal(isPrivateHost('2001:db8::1'), true)
})

test('controlled browser rejects DNS answers that resolve to private space', async () => {
  await assert.rejects(
    validatedBrowserUrl('https://public-name.example/', async () => [
      { address: '203.0.113.9', family: 4 },
      { address: '10.0.0.9', family: 4 },
    ]),
    /Private-network/
  )
})

test('controlled browser network policy blocks unsafe schemes, insecure public sockets, and rebinding', async () => {
  const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }]
  assert.equal(
    await networkRequestAllowed('https://cdn.example/app.js', {
      allowedOrigin: 'https://example.com',
      lookupHost: publicLookup,
    }),
    true
  )
  assert.equal(
    await networkRequestAllowed('wss://stream.example/socket', {
      allowedOrigin: 'https://example.com',
      lookupHost: publicLookup,
    }),
    true
  )
  assert.equal(
    await networkRequestAllowed('ws://stream.example/socket', {
      allowedOrigin: 'https://example.com',
      lookupHost: publicLookup,
    }),
    false
  )
  assert.equal(
    await networkRequestAllowed('file:///Users/example/private.txt', {
      allowedOrigin: 'https://example.com',
      lookupHost: publicLookup,
    }),
    false
  )
  assert.equal(
    await networkRequestAllowed('https://metadata.example/latest', {
      allowedOrigin: 'https://example.com',
      lookupHost: async () => [{ address: '169.254.169.254', family: 4 }],
    }),
    false
  )
  assert.equal(
    await networkRequestAllowed('http://localhost:4173/socket', {
      allowedOrigin: 'https://example.com',
      lookupHost: publicLookup,
    }),
    false
  )
  assert.equal(
    await networkRequestAllowed('http://localhost:4173/socket', {
      allowedOrigin: 'http://localhost:4173',
      lookupHost: publicLookup,
    }),
    true
  )
})

test('browser navigation accepts only the bounded public action contract', () => {
  assert.deepEqual(normalizeNavigation({ action: 'back' }), { action: 'back' })
  assert.deepEqual(normalizeNavigation({ action: 'url', url: 'https://example.com' }), {
    action: 'url',
    url: 'https://example.com',
  })
  assert.throws(() => normalizeNavigation({ action: 'script' }), /valid browser navigation/)
  assert.throws(() => normalizeNavigation({ action: 'url' }), /valid browser URL/)
})

test('browser typing approvals disclose only target and character count', () => {
  const secret = 'MARKER-123 private text'
  const command = browserApprovalCommand('type', 'field-4', secret)
  assert.equal(command, `type ${secret.length} characters into field-4`)
  assert.equal(command.includes(secret), false)
})

test('native application control denies security-sensitive applications', () => {
  for (const name of [
    'Passwords',
    'Keychain Access',
    'System Settings',
    'Terminal',
    'Bank Portal',
  ]) {
    assert.equal(BLOCKED_APPLICATION_PATTERN.test(name), true)
  }
  assert.equal(BLOCKED_APPLICATION_PATTERN.test('Pages'), false)
})

test('Windows application discovery is bounded to safe Start Menu shortcuts', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'statskey-win-apps-'))
  const programs = path.join(fixture, 'Programs')
  const productFolder = path.join(programs, 'Acme')
  const installRoot = path.join(fixture, 'Installed Applications')
  const edgeExecutable = path.join(installRoot, 'Edge', 'msedge.exe')
  const codeExecutable = path.join(installRoot, 'VS Code', 'Code.exe')
  const outside = path.join(fixture, 'outside')
  mkdirSync(productFolder, { recursive: true })
  mkdirSync(path.dirname(edgeExecutable), { recursive: true })
  mkdirSync(path.dirname(codeExecutable), { recursive: true })
  mkdirSync(outside)
  writeFileSync(edgeExecutable, 'executable')
  writeFileSync(codeExecutable, 'executable')
  writeFileSync(path.join(programs, 'Microsoft Edge.lnk'), 'shortcut')
  writeFileSync(path.join(productFolder, 'Visual Studio Code.lnk'), 'shortcut')
  writeFileSync(path.join(programs, 'Windows PowerShell.lnk'), 'shortcut')
  writeFileSync(path.join(programs, 'Acme Uninstaller.lnk'), 'shortcut')
  writeFileSync(path.join(programs, 'Spoofed Calculator.lnk'), 'shortcut')
  writeFileSync(path.join(programs, 'Argument Launcher.lnk'), 'shortcut')
  writeFileSync(path.join(programs, 'Not an app.url'), 'https://example.com')
  const escapedShortcut = path.join(outside, 'Escaped App.lnk')
  const escapedExecutable = path.join(outside, 'escaped.exe')
  writeFileSync(escapedShortcut, 'shortcut')
  writeFileSync(escapedExecutable, 'executable')
  symlinkSync(
    outside,
    path.join(programs, 'escaped-directory'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  t.after(() => rmSync(fixture, { recursive: true, force: true }))

  const applications = safeApplications({
    platform: 'win32',
    roots: [programs],
    targetRoots: [installRoot],
    readShortcutLink(shortcutPath) {
      if (path.basename(shortcutPath) === 'Argument Launcher.lnk') {
        return { target: codeExecutable, args: '--run-unreviewed-command' }
      }
      const targets = {
        'Microsoft Edge.lnk': edgeExecutable,
        'Visual Studio Code.lnk': codeExecutable,
        'Spoofed Calculator.lnk': escapedExecutable,
      }
      return { target: targets[path.basename(shortcutPath)] || escapedExecutable }
    },
  })

  assert.deepEqual(
    applications.map((application) => application.name),
    ['Microsoft Edge', 'Visual Studio Code']
  )
  assert.equal(
    applications.every((application) => {
      const relative = path.relative(realpathSync(installRoot), application.path)
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    }),
    true
  )
})

test('controlled browser maintains owner-isolated tabs and per-tab revisions', async () => {
  const windows = []
  const stateEvents = []
  const runtime = new ControlledBrowserRuntime({
    requestApproval: async () => true,
    lookupHost: async () => [{ address: '8.8.8.8', family: 4 }],
    createWindow: () => {
      const window = fakeBrowserWindow(windows.length + 1)
      windows.push(window)
      return window
    },
    settleWindow: async () => {},
    onState: (_state, event) => stateEvents.push(event.type),
  })
  const alpha = { sessionId: 'alpha' }
  const beta = { sessionId: 'beta' }

  const first = await runtime.open(
    'https://one.example/path',
    'review',
    alpha,
    { newTab: true }
  )
  const second = await runtime.open(
    'https://two.example/path',
    'review',
    beta,
    { newTab: true }
  )
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.notEqual(first.tabId, second.tabId)
  assert.equal(runtime.list(alpha).length, 1)
  assert.equal(runtime.list(beta).length, 1)
  assert.equal(runtime.list().length, 2)
  assert.equal(runtime.list(alpha)[0].ownerSessionId, 'alpha')
  assert.equal((await runtime.snapshot(second.tabId, alpha)).ok, false)

  const firstSnapshot = await runtime.snapshot(first.tabId, alpha)
  const secondSnapshot = await runtime.snapshot(second.tabId, beta)
  assert.notEqual(firstSnapshot.revision, secondSnapshot.revision)
  const deniedCrossOwner = await runtime.act(
    {
      tabId: second.tabId,
      action: 'click',
      revision: secondSnapshot.revision,
      ref: 'e1',
    },
    'review',
    alpha
  )
  assert.equal(deniedCrossOwner.ok, false)
  assert.match(deniedCrossOwner.error, /unavailable/)

  const click = await runtime.act(
    {
      tabId: first.tabId,
      action: 'click',
      revision: firstSnapshot.revision,
      ref: 'e1',
    },
    'review',
    alpha
  )
  assert.equal(click.ok, true)
  assert.equal(click.tabId, first.tabId)
  assert.equal(runtime.activate(second.tabId, alpha), false)
  assert.equal(runtime.activate(second.tabId, beta), true)
  assert.equal(runtime.state(beta).activeTabId, second.tabId)
  assert.equal(runtime.close(first.tabId, beta), false)
  assert.equal(runtime.close(first.tabId, alpha), true)
  assert.equal(runtime.list().length, 1)
  assert.equal(runtime.closeAll(), true)
  assert.equal(runtime.state().open, false)
  assert.ok(stateEvents.includes('created'))
  assert.ok(stateEvents.includes('closed'))
})

test('controlled browser preserves legacy singleton calls and supports history navigation', async () => {
  const window = fakeBrowserWindow(1)
  const approvals = []
  const runtime = new ControlledBrowserRuntime({
    requestApproval: async (operation) => {
      approvals.push(operation.title)
      return true
    },
    lookupHost: async () => [{ address: '8.8.8.8', family: 4 }],
    createWindow: () => window,
    settleWindow: async () => {},
  })
  const opened = await runtime.open('https://example.com/one', 'review')
  assert.equal(opened.ok, true)
  assert.equal(runtime.state().tabs.length, 1)

  window.webContents.navigationHistory.canGoBack = () => true
  window.webContents.navigationHistory.canGoForward = () => true
  assert.equal(
    (await runtime.navigate(undefined, { action: 'back' }, 'review')).ok,
    true
  )
  assert.equal(window.webContents.historyActions.at(-1), 'back')
  assert.equal(
    (await runtime.navigate(undefined, { action: 'forward' }, 'review')).ok,
    true
  )
  assert.equal(window.webContents.historyActions.at(-1), 'forward')
  assert.equal(
    (await runtime.navigate(undefined, { action: 'reload' }, 'review')).ok,
    true
  )
  assert.equal(window.webContents.reloadCount, 1)
  assert.ok(approvals.includes('Open controlled browser'))
  assert.ok(approvals.includes('Go back in controlled browser'))
  assert.equal(runtime.close(), true)
})

test('controlled browser blocks cross-origin page navigation and popups', async () => {
  const window = fakeBrowserWindow(1)
  const runtime = new ControlledBrowserRuntime({
    requestApproval: async () => true,
    lookupHost: async () => [{ address: '8.8.8.8', family: 4 }],
    createWindow: () => window,
    settleWindow: async () => {},
  })
  const opened = await runtime.open('https://example.com/start')
  const tabId = opened.tabId
  const sameOriginEvent = preventableEvent()
  window.webContents.emit(
    'will-navigate',
    sameOriginEvent,
    'https://example.com/next'
  )
  assert.equal(sameOriginEvent.prevented, false)

  const crossOriginEvent = preventableEvent()
  window.webContents.emit(
    'will-navigate',
    crossOriginEvent,
    'https://other.example/next'
  )
  assert.equal(crossOriginEvent.prevented, true)
  assert.equal(runtime.state().tabs[0].blockedNavigation, 'https://other.example/next')
  assert.deepEqual(
    window.webContents.windowOpenHandler({ url: 'https://popup.example/' }),
    { action: 'deny' }
  )
  assert.equal(runtime.state().tabs[0].blockedNavigation, 'https://popup.example/')
  runtime.close(tabId)
})

test('controlled browser never approves password typing and bounds PNG screenshots', async () => {
  let approvals = 0
  const window = fakeBrowserWindow(1)
  const runtime = new ControlledBrowserRuntime({
    requestApproval: async () => {
      approvals += 1
      return true
    },
    lookupHost: async () => [{ address: '8.8.8.8', family: 4 }],
    createWindow: () => window,
    settleWindow: async () => {},
  })
  const opened = await runtime.open('https://example.com')
  const tab = runtime.tabs.get(opened.tabId)
  tab.revision = 'password-revision'
  tab.elements.set('password', {
    ref: 'password',
    tag: 'input',
    type: 'password',
    autocomplete: '',
    disabled: false,
  })
  const denied = await runtime.act({
    tabId: opened.tabId,
    action: 'type',
    revision: 'password-revision',
    ref: 'password',
    text: 'do-not-type-this',
  })
  assert.equal(denied.ok, false)
  assert.match(denied.error, /never types into password/)
  assert.equal(approvals, 1, 'only browser opening reached approval')

  const captured = await runtime.screenshot(opened.tabId)
  assert.equal(captured.ok, true)
  assert.equal(captured.mimeType, 'image/png')
  assert.equal(captured.data, Buffer.from('small-png').toString('base64'))
  assert.equal(captured.byteLength, 9)
  assert.equal(captured.width, 800)
  assert.equal(captured.height, 600)

  assert.throws(
    () =>
      boundedPngPayload({
        getSize: () => ({ width: 800, height: 600 }),
        toPNG: () => Buffer.alloc(2 * 1024 * 1024 + 1),
      }),
    /too large/
  )
  runtime.closeAll()
})

function fakeBrowserWindow(id) {
  const window = new EventEmitter()
  const contents = new EventEmitter()
  const browserSession = new EventEmitter()
  let destroyed = false
  let url = ''
  let title = ''
  let permissionRequestHandler = null
  let permissionCheckHandler = null
  let requestHandler = null

  browserSession.setPermissionRequestHandler = (handler) => {
    permissionRequestHandler = handler
  }
  browserSession.setPermissionCheckHandler = (handler) => {
    permissionCheckHandler = handler
  }
  browserSession.webRequest = {
    onBeforeRequest(_filter, handler) {
      requestHandler = handler
    },
  }
  contents.id = id
  contents.session = browserSession
  contents.historyActions = []
  contents.reloadCount = 0
  contents.navigationHistory = {
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => contents.historyActions.push('back'),
    goForward: () => contents.historyActions.push('forward'),
  }
  contents.getURL = () => url
  contents.getTitle = () => title
  contents.isLoading = () => false
  contents.reload = () => {
    contents.reloadCount += 1
  }
  contents.setWebRTCIPHandlingPolicy = (policy) => {
    contents.webRtcPolicy = policy
  }
  contents.setWindowOpenHandler = (handler) => {
    contents.windowOpenHandler = handler
  }
  contents.executeJavaScriptInIsolatedWorld = async (_world, scripts) => {
    if (scripts[0].code.includes('__statsKeyControlledBrowser =')) {
      return {
        url,
        title,
        text: `Page at ${url}`,
        elements: [
          {
            ref: 'e1',
            tag: 'button',
            type: '',
            autocomplete: '',
            editable: false,
            label: 'Continue',
            disabled: false,
          },
        ],
      }
    }
    return { ok: true }
  }
  contents.capturePage = async () => ({
    getSize: () => ({ width: 800, height: 600 }),
    toPNG: () => Buffer.from('small-png'),
  })
  window.webContents = contents
  window.loadURL = async (nextUrl) => {
    url = nextUrl
    title = new URL(nextUrl).hostname
  }
  window.getTitle = () => title
  window.setTitle = (nextTitle) => {
    title = nextTitle
  }
  window.isDestroyed = () => destroyed
  window.show = () => {}
  window.focus = () => window.emit('focus')
  window.setVisibleOnAllWorkspaces = () => {}
  window.close = () => {
    if (destroyed) return
    destroyed = true
    window.emit('closed')
  }
  window.securityHandlers = () => ({
    permissionRequestHandler,
    permissionCheckHandler,
    requestHandler,
  })
  return window
}

function preventableEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}
