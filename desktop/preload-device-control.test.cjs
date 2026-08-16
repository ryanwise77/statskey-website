const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('preload exposes only bounded device requests and the terminal build env allowlist', async () => {
  const calls = []
  let bridge
  const source = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')
  vm.runInNewContext(source, {
    Object,
    Promise,
    Number,
    String,
    Array,
    RegExp,
    console,
    process: { platform: 'darwin', versions: { electron: '43.2.0' } },
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'statsKeyDesktop')
            bridge = value
          },
        },
        ipcRenderer: {
          invoke(...args) {
            calls.push(args)
            return Promise.resolve({ ok: true })
          },
          send() {},
          on() {},
          removeListener() {},
        },
      }
    },
  })

  await bridge.workspace.startTerminal(
    './gradlew test',
    '/workspace',
    'everything',
    {},
    { sessionId: 'session-1' },
    { workspaceId: 'workspace-1' },
    {
      failClosed: true,
      environment: {
        JAVA_HOME: '/safe/jdk',
        ANDROID_HOME: '/safe/sdk',
        ANDROID_SDK_ROOT: '/safe/sdk',
        HOME: '/malicious/home',
        PATH: '/malicious/bin',
        NODE_OPTIONS: '--require=/malicious/file',
        DYLD_INSERT_LIBRARIES: '/malicious/library',
      },
    }
  )
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).at(-1))), {
    failClosed: true,
    environment: {
      JAVA_HOME: '/safe/jdk',
      ANDROID_HOME: '/safe/sdk',
      ANDROID_SDK_ROOT: '/safe/sdk',
    },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.terminalShell)), {
    kind: 'posix',
    executable: 'zsh',
  })

  await bridge.shareCalendarFile(
    'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    'project-review',
    'Project review on Friday.'
  )
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), [
    'statskey-desktop:share-calendar-file',
    'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    'project-review',
    'Project review on Friday.',
  ])

  await bridge.devices.act(
    {
      platform: 'android',
      action: 'tap',
      deviceId: 'opaque-1',
      x: 42,
      y: 90,
      command: 'rm -rf /',
      executable: '/bin/sh',
      arbitrary: { nested: true },
      environment: {
        STATSKEY_DEBUG_RECORD_SURFACE: 'library',
        DYLD_INSERT_LIBRARIES: '/malicious/library',
        HOME: '/malicious/home',
      },
    },
    'everything',
    { sessionId: 'session-1' },
    { workspaceId: 'workspace-1' }
  )
  const request = calls.at(-1)[1]
  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    platform: 'android',
    action: 'tap',
    deviceId: 'opaque-1',
    x: 42,
    y: 90,
    environment: {
      STATSKEY_DEBUG_RECORD_SURFACE: 'library',
    },
  })

  await bridge.devices.act(
    {
      platform: 'ios',
      action: 'add_media',
      deviceId: 'opaque-2',
      mediaPath: '/workspace/fixtures/meal.jpg',
      url: 'statskey://ignored-for-this-action',
      command: 'xcrun simctl addmedia booted /etc/passwd',
    },
    'review',
    { sessionId: 'session-1' },
    { workspaceId: 'workspace-1' }
  )
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)[1])), {
    platform: 'ios',
    action: 'add_media',
    deviceId: 'opaque-2',
    mediaPath: '/workspace/fixtures/meal.jpg',
    url: 'statskey://ignored-for-this-action',
  })
})

test('preload exposes a bounded Windows cmd shell descriptor', () => {
  let bridge
  const source = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')
  vm.runInNewContext(source, {
    Object,
    Promise,
    Number,
    String,
    Array,
    RegExp,
    console,
    process: {
      platform: 'win32',
      versions: { electron: '43.2.0' },
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    },
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, value) => { bridge = value },
      },
      ipcRenderer: {
        invoke() {}, send() {}, on() {}, removeListener() {},
      },
    }),
  })

  assert.equal(bridge.platform, 'win32')
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.terminalShell)), {
    kind: 'cmd',
    executable: 'cmd.exe',
  })
})

test('preload rejects unknown device actions before IPC', async () => {
  let bridge
  let invocations = 0
  const source = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')
  vm.runInNewContext(source, {
    Object,
    Promise,
    Number,
    String,
    Array,
    RegExp,
    console,
    process: { platform: 'darwin', versions: { electron: '43.2.0' } },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value } },
      ipcRenderer: {
        invoke: () => { invocations += 1 },
        send() {}, on() {}, removeListener() {},
      },
    }),
  })
  const result = await bridge.devices.act({
    platform: 'ios',
    action: 'shell',
    deviceId: 'opaque-1',
  })
  assert.equal(result.ok, false)
  assert.equal(invocations, 0)
})
