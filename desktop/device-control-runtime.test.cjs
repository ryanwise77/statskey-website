const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const {
  defaultAndroidToolCandidates,
  DeviceControlRuntime,
} = require('./device-control-runtime.cjs')

const IOS_UDID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
const ORIGIN = { sessionId: 'run-1' }
const IOS_TOOL_FIXTURE = Object.freeze({
  xcrun: path.resolve('test-tools', 'xcrun'),
  open: path.resolve('test-tools', 'open'),
  adb: null,
  emulator: null,
  maestro: path.resolve('test-tools', 'maestro'),
  javaHome: null,
  androidSdk: null,
})

test('Windows discovers the default Android SDK and Android Studio JBR locations', () => {
  const candidates = defaultAndroidToolCandidates({
    platform: 'win32',
    homeDirectory: 'C:\\Users\\Ryan',
    environment: {
      LOCALAPPDATA: 'C:\\Users\\Ryan\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\Ryan',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    },
  })

  assert.ok(
    candidates.androidSdk.includes(
      'C:\\Users\\Ryan\\AppData\\Local\\Android\\Sdk'
    )
  )
  assert.ok(
    candidates.javaHomes.includes(
      'C:\\Program Files\\Android\\Android Studio\\jbr'
    )
  )
  assert.ok(
    candidates.javaHomes.includes(
      'C:\\Program Files (x86)\\Android\\Android Studio\\jbr'
    )
  )
  assert.ok(
    candidates.javaHomes.includes(
      'C:\\Users\\Ryan\\AppData\\Local\\Programs\\Android Studio\\jbr'
    )
  )
})

test('discovers opaque session-owned iOS handles and never exposes raw UDIDs', async () => {
  const calls = []
  const runtime = runtimeWithIos(calls)
  const listed = await runtime.list(ORIGIN)
  assert.equal(listed.ok, true)
  assert.equal(listed.marker, 'DEVICE_DISCOVERY_COMPLETE')
  assert.equal(listed.devices.length, 1)
  assert.notEqual(listed.devices[0].id, IOS_UDID)
  assert.match(listed.devices[0].id, /^device-/)
  assert.equal(JSON.stringify(listed).includes(IOS_UDID), false)
  assert.equal(listed.tools.open, undefined)
  assert.ok(
    Object.keys(listed.buildEnvironment).every((key) =>
      ['JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT'].includes(key)
    )
  )
  if (listed.tools.javaHome) {
    assert.equal(listed.buildEnvironment.JAVA_HOME, listed.tools.javaHome)
  }
  if (listed.tools.androidSdk) {
    assert.equal(listed.buildEnvironment.ANDROID_HOME, listed.tools.androidSdk)
    assert.equal(listed.buildEnvironment.ANDROID_SDK_ROOT, listed.tools.androidSdk)
  }
  const otherOwner = await runtime.act(
    { platform: 'ios', action: 'screenshot', deviceId: listed.devices[0].id },
    'everything',
    { sessionId: 'run-2' }
  )
  assert.equal(otherOwner.ok, false)
  assert.match(otherOwner.error, /device_list again/)
})

test('discovery is read-only while mutations require approval and binding rechecks', async () => {
  const calls = []
  let approvals = 0
  let bindingChecks = 0
  const runtime = runtimeWithIos(calls, {
    requestApproval: async (operation) => {
      approvals += 1
      assert.equal(operation.kind, 'device')
      return true
    },
  })
  const listed = await runtime.list(ORIGIN)
  assert.equal(approvals, 0)
  const booted = await runtime.act(
    { platform: 'ios', action: 'boot', deviceId: listed.devices[0].id },
    'review',
    ORIGIN,
    () => { bindingChecks += 1 }
  )
  assert.equal(booted.ok, true)
  assert.equal(booted.marker, 'DEVICE_BOOTED')
  assert.equal(approvals, 1)
  assert.ok(bindingChecks >= 3)
  assert.deepEqual(
    calls.find((call) => call.args.includes('-CurrentDeviceUDID')).args,
    ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', IOS_UDID]
  )
})

test('install validates the exact artifact before approval and again before argv execution', async () => {
  const calls = []
  const validations = []
  const runtime = runtimeWithIos(calls, {
    requestApproval: async () => true,
    validateArtifact(candidate, platform) {
      validations.push({ candidate, platform })
      return '/workspace/Build/StatsKey.app'
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'install', deviceId: listed.devices[0].id,
      artifactPath: '/workspace/Build/StatsKey.app',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.marker, 'DEVICE_APP_INSTALLED')
  assert.equal(validations.length, 2)
  assert.deepEqual(
    calls.find((call) => call.args.includes('install')).args,
    ['simctl', 'install', IOS_UDID, '/workspace/Build/StatsKey.app']
  )
})

test('iOS opens a validated deep link with fixed simctl argv and approval', async () => {
  const calls = []
  const approvals = []
  const runtime = runtimeWithIos(calls, {
    requestApproval: async (operation) => {
      approvals.push(operation)
      return true
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'open_url', deviceId: listed.devices[0].id,
      url: 'statskey://record?surface=library',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.equal(result.marker, 'DEVICE_URL_OPENED')
  assert.equal(result.scheme, 'statskey')
  assert.deepEqual(
    calls.find((call) => call.args.includes('openurl')).args,
    ['simctl', 'openurl', IOS_UDID, 'statskey://record?surface=library']
  )
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0].command, 'open statskey URL')
  assert.equal(approvals[0].command.includes('surface=library'), false)
})

test('device URL validation rejects executable schemes, credentials, and control input', async () => {
  const calls = []
  const runtime = runtimeWithIos(calls, { requestApproval: async () => true })
  const listed = await runtime.list(ORIGIN)
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:secret@example.com/path',
    'statskey://record\nnext',
  ]) {
    const result = await runtime.act(
      { platform: 'ios', action: 'open_url', deviceId: listed.devices[0].id, url },
      'everything',
      ORIGIN
    )
    assert.equal(result.ok, false)
  }
  assert.equal(calls.some((call) => call.args.includes('openurl')), false)
})

test('iOS media import validates the same workspace file twice and uses fixed simctl argv', async () => {
  const calls = []
  const validations = []
  const runtime = runtimeWithIos(calls, {
    requestApproval: async () => true,
    validateMedia(candidate, platform) {
      validations.push({ candidate, platform })
      return '/workspace/fixtures/meal.jpg'
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'add_media', deviceId: listed.devices[0].id,
      mediaPath: '/workspace/fixtures/meal.jpg',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.equal(result.marker, 'DEVICE_MEDIA_ADDED')
  assert.equal(result.mediaType, 'image')
  assert.equal(result.fileName, 'meal.jpg')
  assert.equal(validations.length, 2)
  assert.deepEqual(
    calls.find((call) => call.args.includes('addmedia')).args,
    ['simctl', 'addmedia', IOS_UDID, '/workspace/fixtures/meal.jpg']
  )
})

test('media import rejects unsupported extensions before invoking device tools', async () => {
  const calls = []
  const runtime = runtimeWithIos(calls, {
    requestApproval: async () => true,
    validateMedia: () => '/workspace/fixtures/payload.sh',
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'add_media', deviceId: listed.devices[0].id,
      mediaPath: '/workspace/fixtures/payload.sh',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /supported workspace photo or video/)
  assert.equal(calls.some((call) => call.args.includes('addmedia')), false)
})

test('iOS inspect uses Maestro global device argv', async () => {
  const calls = []
  const runtime = runtimeWithIos(calls)
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    { platform: 'ios', action: 'inspect', deviceId: listed.devices[0].id },
    'review',
    ORIGIN
  )
  assert.equal(result.marker, 'DEVICE_UI_INSPECTED')
  assert.deepEqual(
    calls.find(
      (call) => call.executable === IOS_TOOL_FIXTURE.maestro && call.args.includes('hierarchy')
    ).args,
    ['--device', IOS_UDID, 'hierarchy']
  )
})

test('large iOS hierarchy preserves top app controls and keyboard tail within its bound', async () => {
  const calls = []
  const headControl = '<TextField value="banana" hintText="Search foods..."/>'
  const keyboardTail = '<Keyboard><Key label="Done"/></Keyboard>'
  const runtime = runtimeWithIos(calls, {
    processResponse(call) {
      if (call.args.includes('hierarchy')) {
        return {
          ok: true,
          stdout: `${headControl}${'x'.repeat(80_000)}${keyboardTail}`,
          stderr: '',
        }
      }
      return responseForIos(call)
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    { platform: 'ios', action: 'inspect', deviceId: listed.devices[0].id },
    'review',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.ok(result.hierarchy.length <= 60_000)
  assert.match(result.hierarchy, /value="banana"/)
  assert.match(result.hierarchy, /label="Done"/)
  assert.match(result.hierarchy, /DEVICE HIERARCHY TRUNCATED/)
})

test('iOS tap writes a private bounded Maestro flow and always deletes it', async () => {
  const calls = []
  let flowPath
  let flow
  const runtime = runtimeWithIos(calls, {
    runProcess: async (call) => {
      calls.push(call)
      if (call.executable === IOS_TOOL_FIXTURE.maestro && call.args.includes('test')) {
        flowPath = call.args.at(-1)
        assert.equal(existsSync(flowPath), true)
        flow = readFileSync(flowPath, 'utf8')
      }
      return responseForIos(call)
    },
    requestApproval: async () => true,
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'tap', deviceId: listed.devices[0].id,
      appId: 'statskey.biometrics', x: 87, y: 190,
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.marker, 'DEVICE_TAP_COMPLETED')
  assert.match(flow, /appId: "statskey\.biometrics"/)
  assert.match(flow, /point: "87,190"/)
  assert.equal(existsSync(flowPath), false)
})

test('iOS screenshot returns validated PNG dimensions/base64 and removes temp files', async () => {
  const calls = []
  let capturedPath
  const png = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
  png.writeUInt32BE(1179, 16)
  png.writeUInt32BE(2556, 20)
  const runtime = runtimeWithIos(calls, {
    runProcess: async (call) => {
      calls.push(call)
      if (call.args.includes('screenshot')) {
        capturedPath = call.args.at(-1)
        writeFileSync(capturedPath, png)
      }
      return responseForIos(call)
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    { platform: 'ios', action: 'screenshot', deviceId: listed.devices[0].id },
    'review',
    ORIGIN
  )
  assert.equal(result.marker, 'DEVICE_SCREENSHOT_CAPTURED')
  assert.deepEqual(result.screenshot, {
    mediaType: 'image/png',
    data: png.toString('base64'),
    width: 1179,
    height: 2556,
  })
  assert.equal(existsSync(capturedPath), false)
})

test('invalid iOS screenshot fails closed and still removes temp files', async () => {
  const calls = []
  let capturedPath
  const runtime = runtimeWithIos(calls, {
    runProcess: async (call) => {
      calls.push(call)
      if (call.args.includes('screenshot')) {
        capturedPath = call.args.at(-1)
        writeFileSync(capturedPath, Buffer.alloc(24, 7))
      }
      return responseForIos(call)
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    { platform: 'ios', action: 'screenshot', deviceId: listed.devices[0].id },
    'review',
    ORIGIN
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /invalid PNG/)
  assert.equal(existsSync(capturedPath), false)
})

test('PID-scoped logs combine fresh liveness with crash-free evidence', async () => {
  const calls = []
  const runtime = runtimeWithIos(calls)
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'logs', deviceId: listed.devices[0].id,
      appId: 'statskey.biometrics', logSinceSeconds: 30,
    },
    'review',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.equal(result.marker, 'DEVICE_LOGS_CRASH_FREE')
  assert.equal(result.alive, true)
  assert.equal(result.crashFree, true)
  assert.deepEqual(result.crashMarkers, [])
  const logCall = calls.find((call) => call.args.includes('log'))
  assert.ok(logCall.args.includes('processIdentifier == 9123'))
})

test('PID-scoped fatal output invalidates logs even without a bundle ID string', async () => {
  const calls = []
  const runtime = runtimeWithIos(calls, {
    processResponse(call) {
      if (call.args.includes('log')) {
        return { ok: true, stdout: 'StatsKey: Fatal error: index out of range', stderr: '' }
      }
      return responseForIos(call)
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'logs', deviceId: listed.devices[0].id,
      appId: 'statskey.biometrics',
    },
    'review',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.equal(result.marker, 'DEVICE_CRASH_MARKERS_FOUND')
  assert.equal(result.alive, true)
  assert.equal(result.crashFree, false)
  assert.deepEqual(result.crashMarkers, ['fatal-error'])
})

test('logs fail closed when the app dies during the log read', async () => {
  const calls = []
  let launchctlReads = 0
  const runtime = runtimeWithIos(calls, {
    processResponse(call) {
      if (call.args.includes('launchctl')) {
        launchctlReads += 1
        return {
          ok: true,
          stdout: launchctlReads === 1
            ? '9123\t0\tUIKitApplication:statskey.biometrics[0x1]'
            : '',
          stderr: '',
        }
      }
      return responseForIos(call)
    },
  })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'ios', action: 'logs', deviceId: listed.devices[0].id,
      appId: 'statskey.biometrics',
    },
    'review',
    ORIGIN
  )
  assert.equal(result.ok, false)
  assert.equal(result.marker, 'DEVICE_PROCESS_NOT_RUNNING')
  assert.equal(result.alive, false)
})

test('Android typing rejects remote-shell metacharacters before adb input', async () => {
  const calls = []
  const runtime = runtimeWithAndroid(calls, { requestApproval: async () => true })
  const listed = await runtime.list(ORIGIN)
  const result = await runtime.act(
    {
      platform: 'android', action: 'type', deviceId: listed.devices[0].id,
      text: 'safe; rm -rf /',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /shell metacharacters/)
  assert.equal(calls.some((call) => call.args.includes('input')), false)
})

test('Android opens safe URLs and blocks remote-shell metacharacters', async () => {
  const calls = []
  const runtime = runtimeWithAndroid(calls, { requestApproval: async () => true })
  const listed = await runtime.list(ORIGIN)
  const running = listed.devices.find((device) => device.state === 'booted')
  const opened = await runtime.act(
    {
      platform: 'android', action: 'open_url', deviceId: running.id,
      url: 'statskey://record?surface=library',
    },
    'everything',
    ORIGIN
  )
  assert.equal(opened.marker, 'DEVICE_URL_OPENED')
  assert.deepEqual(
    calls.find((call) => call.args.includes('android.intent.action.VIEW')).args,
    [
      '-s', 'emulator-5554', 'shell', 'am', 'start', '-W',
      '-a', 'android.intent.action.VIEW', '-d', 'statskey://record?surface=library',
    ]
  )
  const blocked = await runtime.act(
    {
      platform: 'android', action: 'open_url', deviceId: running.id,
      url: 'statskey://record?surface=library&next=evil',
    },
    'everything',
    ORIGIN
  )
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /remote-shell metacharacters/)
})

test('Android media import uses bounded push and media-scan argv', async () => {
  const calls = []
  const validations = []
  const runtime = runtimeWithAndroid(calls, {
    requestApproval: async () => true,
    validateMedia(candidate, platform) {
      validations.push({ candidate, platform })
      return '/workspace/fixtures/meal.png'
    },
  })
  const listed = await runtime.list(ORIGIN)
  const running = listed.devices.find((device) => device.state === 'booted')
  const result = await runtime.act(
    {
      platform: 'android', action: 'add_media', deviceId: running.id,
      mediaPath: '/workspace/fixtures/meal.png',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.equal(result.marker, 'DEVICE_MEDIA_ADDED')
  assert.equal(validations.length, 2)
  const pushed = calls.find((call) => call.args.includes('push'))
  assert.equal(pushed.args[3], '/workspace/fixtures/meal.png')
  assert.match(pushed.args[4], /^\/sdcard\/Pictures\/StatsKey\/[a-f0-9-]+\.png$/)
  const scanned = calls.find(
    (call) => call.args.includes('android.intent.action.MEDIA_SCANNER_SCAN_FILE')
  )
  assert.deepEqual(scanned.args.slice(0, 9), [
    '-s', 'emulator-5554', 'shell', 'am', 'broadcast',
    '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d',
    `file://${pushed.args[4]}`,
  ])
})

test('Android launch resolves one strict launcher component and never falls back to monkey', async () => {
  const calls = []
  const runtime = runtimeWithAndroid(calls, { requestApproval: async () => true })
  const listed = await runtime.list(ORIGIN)
  const running = listed.devices.find((device) => device.state === 'booted')
  const result = await runtime.act(
    {
      platform: 'android', action: 'launch', deviceId: running.id,
      appId: 'com.statskey.wear',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.equal(result.marker, 'DEVICE_APP_LAUNCHED')
  assert.equal(result.alive, true)
  assert.deepEqual(
    calls.find((call) => call.args.includes('resolve-activity')).args,
    [
      '-s', 'emulator-5554', 'shell', 'cmd', 'package', 'resolve-activity',
      '--brief', '-c', 'android.intent.category.LAUNCHER', 'com.statskey.wear',
    ]
  )
  assert.deepEqual(
    calls.find((call) => call.args.includes('start')).args,
    [
      '-s', 'emulator-5554', 'shell', 'am', 'start', '-W', '-n',
      'com.statskey.wear/com.statskey.phone.MainActivity',
    ]
  )
  assert.equal(calls.some((call) => call.args.includes('monkey')), false)
})

test('Android launch rejects ambiguous or unsafe resolved components', async () => {
  const calls = []
  const runtime = runtimeWithAndroid(calls, {
    requestApproval: async () => true,
    processResponse(call) {
      if (call.args.includes('resolve-activity')) {
        return {
          ok: true,
          stdout: [
            'com.statskey.wear/com.statskey.phone.MainActivity',
            'com.statskey.wear/com.statskey.phone.OtherActivity',
          ].join('\n'),
          stderr: '',
        }
      }
    },
  })
  const listed = await runtime.list(ORIGIN)
  const running = listed.devices.find((device) => device.state === 'booted')
  const result = await runtime.act(
    {
      platform: 'android', action: 'launch', deviceId: running.id,
      appId: 'com.statskey.wear',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /unambiguous launcher activity/)
  assert.equal(calls.some((call) => call.args.includes('start')), false)
})

test('safe errors preserve package names while redacting explicit secret assignments', async () => {
  const calls = []
  const runtime = runtimeWithAndroid(calls, {
    requestApproval: async () => true,
    processResponse(call) {
      if (call.args.includes('start')) {
        return {
          ok: false,
          stdout: '',
          stderr: 'Could not launch com.statskey.wear; password=hunter2',
        }
      }
    },
  })
  const listed = await runtime.list(ORIGIN)
  const running = listed.devices.find((device) => device.state === 'booted')
  const result = await runtime.act(
    {
      platform: 'android', action: 'launch', deviceId: running.id,
      appId: 'com.statskey.wear',
    },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /com\.statskey\.wear/)
  assert.match(result.error, /password=\[redacted\]/)
  assert.doesNotMatch(result.error, /hunter2/)
})

test('cold Android boot waits for the matching AVD and updates the same opaque handle', async () => {
  const calls = []
  let emulatorSpawns = 0
  const runtime = runtimeWithAndroid(calls, {
    requestApproval: async () => true,
    spawnDetached() { emulatorSpawns += 1 },
  })
  const listed = await runtime.list(ORIGIN)
  const cold = listed.devices.find((device) => device.state === 'shutdown')
  const result = await runtime.act(
    { platform: 'android', action: 'boot', deviceId: cold.id },
    'everything',
    ORIGIN
  )
  assert.equal(result.ok, true)
  assert.equal(result.marker, 'DEVICE_BOOTED')
  assert.equal(result.device.id, cold.id)
  assert.equal(result.device.state, 'booted')
  assert.equal(emulatorSpawns, 1)
  const refreshed = await runtime.list(ORIGIN)
  const transitioned = refreshed.devices.find(
    (device) => device.platform === 'android' && device.name === 'Pixel_10'
  )
  assert.equal(transitioned.id, cold.id)
  assert.equal(transitioned.state, 'booted')
})

function runtimeWithIos(calls, overrides = {}) {
  const processResponse = overrides.processResponse ?? responseForIos
  const runtime = new DeviceControlRuntime({
    runProcess: overrides.runProcess ?? (async (call) => {
      calls.push(call)
      return processResponse(call)
    }),
    requestApproval: overrides.requestApproval ?? (async () => true),
    validateArtifact: overrides.validateArtifact ?? ((candidate) => candidate),
    validateMedia: overrides.validateMedia ?? ((candidate) => candidate),
    spawnDetached: overrides.spawnDetached,
    delay: overrides.delay,
    now: overrides.now,
  })
  // These tests exercise the iOS command contract, not host tool discovery.
  // Inject host-absolute fake executable paths so the same fixture is valid on
  // macOS, Linux, and Windows without pretending that Xcode exists there.
  runtime.toolCache = { ...IOS_TOOL_FIXTURE }
  return runtime
}

function responseForIos(call) {
  if (call.args.includes('--version')) return { ok: true, stdout: '2.7.0', stderr: '' }
  if (call.args.includes('devices') && call.args.includes('--json')) {
    return {
      ok: true,
      stdout: JSON.stringify({ devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{
          udid: IOS_UDID, name: 'iPhone 17', state: 'Booted', isAvailable: true,
        }],
      } }),
      stderr: '',
    }
  }
  if (call.args.includes('launchctl')) {
    return { ok: true, stdout: '9123\t0\tUIKitApplication:statskey.biometrics[0x1]', stderr: '' }
  }
  if (call.args.includes('hierarchy')) {
    return { ok: true, stdout: '<App><Button text="Save"/></App>', stderr: '' }
  }
  return { ok: true, stdout: '', stderr: '' }
}

function runtimeWithAndroid(calls, overrides = {}) {
  let discoveryCount = 0
  return new DeviceControlRuntime({
    requestApproval: overrides.requestApproval ?? (async () => true),
    validateArtifact: (candidate) => candidate,
    validateMedia: overrides.validateMedia ?? ((candidate) => candidate),
    spawnDetached: overrides.spawnDetached ?? (() => true),
    delay: async () => {},
    now: (() => {
      let value = 0
      return () => (value += 100)
    })(),
    async runProcess(call) {
      calls.push(call)
      const custom = overrides.processResponse?.(call)
      if (custom) return custom
      if (call.args.includes('--version')) return { ok: true, stdout: '2.7.0', stderr: '' }
      if (call.args[0] === 'devices') {
        discoveryCount += 1
        return {
          ok: true,
          stdout: discoveryCount === 1
            ? 'List of devices attached\nemulator-5554 device product:sdk model:Pixel_9\n'
            : 'List of devices attached\nemulator-5554 device product:sdk model:Pixel_9\nemulator-5556 device product:sdk model:Pixel_10\n',
          stderr: '',
        }
      }
      if (call.args.includes('-list-avds')) {
        return { ok: true, stdout: 'Pixel_10\n', stderr: '' }
      }
      if (call.args.includes('ro.kernel.qemu')) {
        return { ok: true, stdout: '1\n', stderr: '' }
      }
      if (call.args.includes('avd') && call.args.includes('name')) {
        const serial = call.args[1]
        return { ok: true, stdout: serial === 'emulator-5556' ? 'Pixel_10\nOK\n' : 'Pixel_9\nOK\n', stderr: '' }
      }
      if (call.args.includes('sys.boot_completed')) {
        return { ok: true, stdout: '1\n', stderr: '' }
      }
      if (call.args.includes('resolve-activity')) {
        return {
          ok: true,
          stdout: 'com.statskey.wear/com.statskey.phone.MainActivity\n',
          stderr: '',
        }
      }
      if (call.args.includes('pidof')) {
        return { ok: true, stdout: '2222\n', stderr: '' }
      }
      return { ok: true, stdout: '', stderr: '' }
    },
  })
}
