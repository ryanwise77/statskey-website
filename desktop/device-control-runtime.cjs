const { randomUUID } = require('node:crypto')
const {
  accessSync,
  constants: fsConstants,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEVICE_ACTIONS = new Set([
  'boot', 'install', 'launch', 'inspect', 'screenshot', 'tap', 'type',
  'swipe', 'back', 'home', 'open_url', 'add_media', 'process', 'logs', 'close',
])
const MUTATING_ACTIONS = new Set([
  'boot', 'install', 'launch', 'tap', 'type', 'swipe', 'back', 'home',
  'open_url', 'add_media', 'close',
])
const DEVICE_MEDIA_EXTENSIONS = new Set([
  '.bmp', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.m4v', '.mov', '.mp4',
  '.png', '.tif', '.tiff', '.webp',
])
const BLOCKED_URL_SCHEMES = new Set([
  'about', 'blob', 'chrome', 'data', 'file', 'javascript', 'resource', 'shell',
])
const MAX_OUTPUT_CHARACTERS = 100_000
const MAX_HIERARCHY_CHARACTERS = 60_000
const MAX_LOG_CHARACTERS = 60_000
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 30_000
const BOOT_TIMEOUT_MS = 120_000

class DeviceControlRuntime {
  constructor({
    runProcess,
    requestApproval,
    validateArtifact,
    validateMedia,
    spawnDetached,
    delay,
    now,
  } = {}) {
    this.runProcess = typeof runProcess === 'function' ? runProcess : unavailableRunner
    this.requestApproval =
      typeof requestApproval === 'function' ? requestApproval : async () => false
    this.validateArtifact =
      typeof validateArtifact === 'function'
        ? validateArtifact
        : () => { throw new Error('Workspace artifact validation is unavailable.') }
    this.validateMedia =
      typeof validateMedia === 'function'
        ? validateMedia
        : () => { throw new Error('Workspace media validation is unavailable.') }
    this.spawnDetached =
      typeof spawnDetached === 'function' ? spawnDetached : defaultSpawnDetached
    this.delay = typeof delay === 'function' ? delay : defaultDelay
    this.now = typeof now === 'function' ? now : Date.now
    this.ownerDevices = new Map()
    this.queues = new Map()
    this.toolCache = null
  }

  async list(origin) {
    try {
      const owner = normalizedOwner(origin)
      const tools = await this.discoverTools()
      const discovered = []
      if (tools.xcrun) discovered.push(...await this.discoverIos(tools))
      if (tools.adb) discovered.push(...await this.discoverAndroid(tools))
      const handles = this.refreshOwnerDevices(owner, discovered)
      return {
        ok: true,
        action: 'list',
        marker: 'DEVICE_DISCOVERY_COMPLETE',
        devices: handles.map(publicDevice),
        tools: publicTools(tools),
        buildEnvironment: buildEnvironment(tools),
      }
    } catch (error) {
      return failed(error, 'list')
    }
  }

  async act(rawRequest, approvalMode = 'review', origin, assertBinding = () => {}) {
    const request = normalizedRequest(rawRequest)
    if (!request.ok) return failed(request.error, rawRequest?.action)
    let owner
    let device
    try {
      owner = normalizedOwner(origin)
      device = this.requireDevice(owner, request.value)
    } catch (error) {
      return failed(error, request.value.action, request.value.platform)
    }
    return this.enqueue(device.key, async () => {
      try {
        await Promise.resolve(assertBinding())
        const tools = await this.discoverTools()
        let actionableRequest = request.value
        if (request.value.action === 'install') {
          if (!request.value.artifactPath) {
            throw new Error('Choose an exact workspace app artifact.')
          }
          const validatedArtifactPath = await Promise.resolve(
            this.validateArtifact(request.value.artifactPath, device.platform)
          )
          if (typeof validatedArtifactPath !== 'string' || !path.isAbsolute(validatedArtifactPath)) {
            throw new Error('Workspace artifact validation returned an invalid path.')
          }
          actionableRequest = { ...request.value, validatedArtifactPath }
        } else if (request.value.action === 'add_media') {
          if (!request.value.mediaPath) {
            throw new Error('Choose an exact workspace photo or video file.')
          }
          const validatedMediaPath = await Promise.resolve(
            this.validateMedia(request.value.mediaPath, device.platform)
          )
          if (typeof validatedMediaPath !== 'string' || !path.isAbsolute(validatedMediaPath)) {
            throw new Error('Workspace media validation returned an invalid path.')
          }
          actionableRequest = { ...request.value, validatedMediaPath }
        }
        if (MUTATING_ACTIONS.has(request.value.action)) {
          const operation = approvalOperation(actionableRequest, device)
          const approved = await this.requestApproval(operation, approvalMode)
          if (!approved) {
            return {
              ok: false,
              cancelled: true,
              platform: device.platform,
              action: request.value.action,
              marker: 'DEVICE_ACTION_REJECTED',
            }
          }
          // The renderer may switch workspaces while an approval is visible.
          // Revalidate immediately before every approved side effect.
          await Promise.resolve(assertBinding())
        }
        await Promise.resolve(assertBinding())
        return await this.perform(device, actionableRequest, tools)
      } catch (error) {
        return failed(error, request.value.action, device.platform)
      }
    })
  }

  closeAll() {
    this.ownerDevices.clear()
    this.queues.clear()
  }

  async discoverTools() {
    if (this.toolCache) return this.toolCache
    const defaults = defaultAndroidToolCandidates()
    const androidSdk = firstDirectory(defaults.androidSdk)
    const javaHome = firstJavaHome(defaults.javaHomes)
    const candidates = {
      xcrun: process.platform === 'darwin' ? firstExecutable(['/usr/bin/xcrun']) : null,
      open: process.platform === 'darwin' ? firstExecutable(['/usr/bin/open']) : null,
      adb: firstExecutable([
        androidSdk && path.join(androidSdk, 'platform-tools', executableName('adb')),
        ...executablesFromPath('adb'),
        '/opt/homebrew/bin/adb', '/usr/local/bin/adb', '/usr/bin/adb',
      ]),
      emulator: firstExecutable([
        androidSdk && path.join(androidSdk, 'emulator', executableName('emulator')),
        ...executablesFromPath('emulator'),
        '/opt/homebrew/bin/emulator', '/usr/local/bin/emulator',
      ]),
      maestro: firstExecutable([
        process.env.MAESTRO_HOME && path.join(process.env.MAESTRO_HOME, 'bin', executableName('maestro')),
        path.join(os.homedir(), '.maestro', 'bin', executableName('maestro')),
        '/opt/homebrew/bin/maestro', '/usr/local/bin/maestro',
      ]),
      javaHome,
      androidSdk,
    }
    if (candidates.maestro) {
      const health = await this.run(candidates.maestro, ['--version'], {
        timeoutMilliseconds: 10_000,
        env: toolEnvironment(candidates),
      })
      if (!health.ok) candidates.maestro = null
    }
    this.toolCache = candidates
    return candidates
  }

  async discoverIos(tools) {
    const result = await this.run(tools.xcrun, [
      'simctl', 'list', 'devices', 'available', '--json',
    ])
    if (!result.ok) return []
    let parsed
    try { parsed = JSON.parse(result.stdout) } catch { return [] }
    const devices = []
    for (const [runtime, entries] of Object.entries(parsed?.devices || {})) {
      if (!/\.SimRuntime\.iOS-/i.test(runtime) || !Array.isArray(entries)) continue
      for (const entry of entries) {
        if (!entry?.isAvailable || !validIosUdid(entry.udid)) continue
        devices.push({
          key: `ios:${entry.udid}`,
          platform: 'ios',
          rawId: entry.udid,
          name: boundedText(entry.name, 160) || 'iOS Simulator',
          state: String(entry.state || '').toLowerCase() === 'booted' ? 'booted' : 'shutdown',
          runtime: runtime.split('.').pop()?.replace(/^iOS-/, 'iOS ').replaceAll('-', '.') || 'iOS',
          available: true,
        })
      }
    }
    return devices
  }

  async discoverAndroid(tools) {
    const devices = []
    const runningNames = new Set()
    const result = await this.run(tools.adb, ['devices', '-l'])
    if (result.ok) {
      for (const line of result.stdout.split(/\r?\n/).slice(1)) {
        const match = line.trim().match(/^(emulator-\d+)\s+(device|offline|unauthorized)\b(.*)$/)
        if (!match) continue
        const serial = match[1]
        const qemu = await this.run(tools.adb, ['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu'])
        if (!qemu.ok || qemu.stdout.trim() !== '1') continue
        const avd = await this.run(tools.adb, ['-s', serial, 'emu', 'avd', 'name'])
        const avdName = validAvdName(firstOutputLine(avd.stdout)) ? firstOutputLine(avd.stdout) : null
        if (avdName) runningNames.add(avdName)
        const model = fieldFromAdbLine(match[3], 'model')
        devices.push({
          key: `android:${serial}`,
          platform: 'android',
          rawId: serial,
          avdName,
          name: boundedText(model || avdName, 160) || 'Android Emulator',
          state: match[2] === 'device' ? 'booted' : match[2],
          runtime: fieldFromAdbLine(match[3], 'product') || undefined,
          available: match[2] === 'device',
        })
      }
    }
    if (tools.emulator) {
      const avds = await this.run(tools.emulator, ['-list-avds'])
      if (avds.ok) {
        for (const value of avds.stdout.split(/\r?\n/)) {
          const avdName = value.trim()
          if (!validAvdName(avdName) || runningNames.has(avdName)) continue
          devices.push({
            key: `android-avd:${avdName}`,
            platform: 'android',
            rawId: null,
            avdName,
            name: avdName,
            state: 'shutdown',
            runtime: 'Android',
            available: true,
          })
        }
      }
    }
    return devices
  }

  refreshOwnerDevices(owner, discovered) {
    const previous = this.ownerDevices.get(owner.key) || new Map()
    const next = new Map()
    const byKey = new Map([...previous.values()].map((entry) => [entry.key, entry]))
    for (const device of discovered.slice(0, 80)) {
      const avdTransitions = device.avdName
        ? [...previous.values()].filter(
            (entry) =>
              entry.platform === 'android' &&
              entry.avdName === device.avdName
          )
        : []
      const existing =
        byKey.get(device.key) ||
        (avdTransitions.length === 1 ? avdTransitions[0] : null)
      const entry = {
        ...device,
        id: existing?.id || `device-${randomUUID()}`,
        ownerKey: owner.key,
      }
      next.set(entry.id, entry)
    }
    this.ownerDevices.set(owner.key, next)
    return [...next.values()]
  }

  requireDevice(owner, request) {
    const entry = this.ownerDevices.get(owner.key)?.get(request.deviceId)
    if (!entry || entry.platform !== request.platform) {
      throw new Error('That simulator or emulator reference is unavailable. Run device_list again.')
    }
    return entry
  }

  async perform(device, request, tools) {
    if (device.platform === 'ios' && !tools.xcrun) {
      throw new Error('Xcode Simulator tools are unavailable.')
    }
    if (device.platform === 'android' && !tools.adb) {
      throw new Error('Android platform tools are unavailable.')
    }
    switch (request.action) {
      case 'boot': return this.boot(device, tools)
      case 'install': return this.install(device, request, tools)
      case 'launch': return this.launch(device, request, tools)
      case 'inspect': return this.inspect(device, request, tools)
      case 'screenshot': return this.screenshot(device, tools)
      case 'tap': return this.tap(device, request, tools)
      case 'type': return this.type(device, request, tools)
      case 'swipe': return this.swipe(device, request, tools)
      case 'back': return this.key(device, request, tools, 'back')
      case 'home': return this.key(device, request, tools, 'home')
      case 'open_url': return this.openUrl(device, request, tools)
      case 'add_media': return this.addMedia(device, request, tools)
      case 'process': return this.process(device, request, tools)
      case 'logs': return this.logs(device, request, tools)
      case 'close': return this.close(device, request, tools)
      default: throw new Error('Unsupported device action.')
    }
  }

  async boot(device, tools) {
    if (device.platform === 'ios') {
      if (device.state !== 'booted') {
        const boot = await this.run(tools.xcrun, ['simctl', 'boot', device.rawId])
        if (!boot.ok && !/current state:\s*Booted/i.test(`${boot.stdout}\n${boot.stderr}`)) {
          throw processError(boot, 'The iOS Simulator could not boot.')
        }
      }
      const ready = await this.run(tools.xcrun, ['simctl', 'bootstatus', device.rawId, '-b'], {
        timeoutMilliseconds: BOOT_TIMEOUT_MS,
      })
      if (!ready.ok) throw processError(ready, 'The iOS Simulator did not finish booting.')
      device.state = 'booted'
      if (tools.open) {
        const revealed = await this.run(tools.open, [
          '-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.rawId,
        ])
        if (!revealed.ok) {
          throw processError(revealed, 'The iOS Simulator booted but could not be opened.')
        }
      }
    } else if (device.rawId) {
      await this.assertAndroidEmulator(device, tools)
      device.state = 'booted'
    } else {
      if (!tools.emulator || !validAvdName(device.avdName)) {
        throw new Error('The Android Emulator executable or AVD is unavailable.')
      }
      await Promise.resolve(this.spawnDetached({
        executable: tools.emulator,
        args: ['-avd', device.avdName, '-no-snapshot-save'],
        env: toolEnvironment(tools),
      }))
      device.state = 'starting'
      await this.waitForAndroidAvd(device, tools)
    }
    return success(
      device,
      'boot',
      'DEVICE_BOOTED',
      { device: publicDevice(device) }
    )
  }

  async install(device, request, tools) {
    const before = request.validatedArtifactPath
    if (typeof before !== 'string' || !path.isAbsolute(before)) {
      throw new Error('Choose an exact workspace app artifact.')
    }
    const after = await Promise.resolve(this.validateArtifact(request.artifactPath, device.platform))
    if (after !== before) throw new Error('The app artifact changed while awaiting review.')
    await this.ensureReady(device, tools)
    const result = device.platform === 'ios'
      ? await this.run(tools.xcrun, ['simctl', 'install', device.rawId, after], { timeoutMilliseconds: BOOT_TIMEOUT_MS })
      : await this.run(tools.adb, ['-s', device.rawId, 'install', '-r', after], { timeoutMilliseconds: BOOT_TIMEOUT_MS })
    if (!result.ok) throw processError(result, 'The app artifact could not be installed.')
    return success(device, 'install', 'DEVICE_APP_INSTALLED', { installed: true })
  }

  async launch(device, request, tools) {
    const appId = validAppId(request.appId)
    await this.ensureReady(device, tools)
    let result
    if (device.platform === 'ios') {
      const environment = appEnvironment(request.environment, tools)
      result = await this.run(tools.xcrun, [
        'simctl', 'launch', '--terminate-running-process', device.rawId, appId,
      ], { env: environment })
    } else {
      if (request.environment && Object.keys(request.environment).length > 0) {
        throw new Error('Android app environment injection is not supported.')
      }
      await this.run(tools.adb, ['-s', device.rawId, 'shell', 'am', 'force-stop', appId])
      const activity = request.activity
        ? validActivity(request.activity)
        : await this.resolveAndroidLaunchActivity(device, appId, tools)
      result = await this.run(tools.adb, [
        '-s', device.rawId, 'shell', 'am', 'start', '-W', '-n',
        `${appId}/${activity}`,
      ])
    }
    if (!result.ok) throw processError(result, 'The app could not be launched.')
    const pid = device.platform === 'ios'
      ? integerMatch(result.stdout, /:\s*(\d+)\s*$/m)
      : await this.androidPid(device, appId, tools)
    return success(device, 'launch', 'DEVICE_APP_LAUNCHED', {
      appId, launched: true, ...(pid ? { pid, alive: true } : {}),
    })
  }

  async inspect(device, request, tools) {
    await this.ensureReady(device, tools)
    let result
    if (device.platform === 'ios') {
      if (!tools.maestro) throw new Error('Maestro with a working Java runtime is required for iOS UI inspection.')
      result = await this.run(tools.maestro, ['--device', device.rawId, 'hierarchy'], {
        env: toolEnvironment(tools), timeoutMilliseconds: 45_000,
      })
    } else {
      result = await this.run(tools.adb, [
        '-s', device.rawId, 'exec-out', 'uiautomator', 'dump', '/dev/tty',
      ], { timeoutMilliseconds: 45_000 })
    }
    if (!result.ok) throw processError(result, 'The device UI hierarchy is unavailable.')
    const hierarchy = boundedHierarchy(result.stdout, MAX_HIERARCHY_CHARACTERS)
    const response = { hierarchy }
    if (request.appId) {
      const process = await this.process(device, request, tools)
      Object.assign(response, { appId: process.appId, alive: process.alive })
    }
    return success(device, 'inspect', 'DEVICE_UI_INSPECTED', response)
  }

  async screenshot(device, tools) {
    await this.ensureReady(device, tools)
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'statskey-device-shot-'))
    const screenshotPath = path.join(temporaryDirectory, 'screenshot.png')
    const remotePath = `/data/local/tmp/statskey-${randomUUID()}.png`
    try {
      let result
      if (device.platform === 'ios') {
        result = await this.run(tools.xcrun, [
          'simctl', 'io', device.rawId, 'screenshot', '--type=png', screenshotPath,
        ])
      } else {
        result = await this.run(tools.adb, [
          '-s', device.rawId, 'shell', 'screencap', '-p', remotePath,
        ])
        if (result.ok) {
          result = await this.run(tools.adb, [
            '-s', device.rawId, 'pull', remotePath, screenshotPath,
          ])
        }
      }
      if (!result.ok) throw processError(result, 'The device screenshot could not be captured.')
      const stats = statSync(screenshotPath)
      if (!stats.isFile() || stats.size < 24 || stats.size > MAX_SCREENSHOT_BYTES) {
        throw new Error('The device returned an invalid or oversized PNG screenshot.')
      }
      const bytes = readFileSync(screenshotPath)
      if (!isPng(bytes)) throw new Error('The device returned an invalid PNG screenshot.')
      const size = pngSize(bytes)
      return success(device, 'screenshot', 'DEVICE_SCREENSHOT_CAPTURED', {
        screenshot: {
          mediaType: 'image/png',
          data: bytes.toString('base64'),
          ...(size ? size : {}),
        },
      })
    } finally {
      if (device.platform === 'android') {
        await this.run(tools.adb, ['-s', device.rawId, 'shell', 'rm', '-f', remotePath])
      }
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }

  async tap(device, request, tools) {
    const x = coordinate(request.x, 'x')
    const y = coordinate(request.y, 'y')
    await this.ensureReady(device, tools)
    const result = device.platform === 'android'
      ? await this.run(tools.adb, ['-s', device.rawId, 'shell', 'input', 'tap', String(x), String(y)])
      : await this.runMaestro(device, request, tools, `appId: ${yamlScalar(validAppId(request.appId))}\n---\n- tapOn:\n    point: "${x},${y}"\n`)
    if (!result.ok) throw processError(result, 'The device tap did not complete.')
    return success(device, 'tap', 'DEVICE_TAP_COMPLETED')
  }

  async type(device, request, tools) {
    const text = validInputText(request.text)
    await this.ensureReady(device, tools)
    const result = device.platform === 'android'
      ? await this.run(tools.adb, ['-s', device.rawId, 'shell', 'input', 'text', androidInputText(text)])
      : await this.runMaestro(device, request, tools, `appId: ${yamlScalar(validAppId(request.appId))}\n---\n- inputText: ${yamlScalar(text)}\n`)
    if (!result.ok) throw processError(result, 'Device text entry did not complete.')
    return success(device, 'type', 'DEVICE_TEXT_ENTERED')
  }

  async swipe(device, request, tools) {
    const x = coordinate(request.x, 'x')
    const y = coordinate(request.y, 'y')
    const endX = coordinate(request.endX, 'endX')
    const endY = coordinate(request.endY, 'endY')
    const duration = boundedInteger(request.durationMs, 50, 5_000, 400)
    await this.ensureReady(device, tools)
    const result = device.platform === 'android'
      ? await this.run(tools.adb, [
          '-s', device.rawId, 'shell', 'input', 'swipe',
          String(x), String(y), String(endX), String(endY), String(duration),
        ])
      : await this.runMaestro(device, request, tools,
          `appId: ${yamlScalar(validAppId(request.appId))}\n---\n- swipe:\n    start: "${x},${y}"\n    end: "${endX},${endY}"\n    duration: ${duration}\n`)
    if (!result.ok) throw processError(result, 'The device swipe did not complete.')
    return success(device, 'swipe', 'DEVICE_SWIPE_COMPLETED')
  }

  async key(device, request, tools, key) {
    await this.ensureReady(device, tools)
    let result
    if (device.platform === 'android') {
      result = await this.run(tools.adb, [
        '-s', device.rawId, 'shell', 'input', 'keyevent', key === 'back' ? '4' : '3',
      ])
    } else {
      if (!tools.maestro) throw new Error('Maestro with a working Java runtime is required for iOS UI control.')
      if (key === 'back') {
        result = await this.runMaestro(device, request, tools,
          `appId: ${yamlScalar(validAppId(request.appId))}\n---\n- back\n`)
      } else {
        result = await this.runMaestro(device, request, tools,
          `appId: ${yamlScalar(validAppId(request.appId))}\n---\n- pressKey: HOME\n`)
      }
    }
    if (!result.ok) throw processError(result, `The device ${key} action did not complete.`)
    return success(device, key, `DEVICE_${key.toUpperCase()}_COMPLETED`)
  }

  async openUrl(device, request, tools) {
    const target = validDeviceUrl(request.url, device.platform)
    await this.ensureReady(device, tools)
    const result = device.platform === 'ios'
      ? await this.run(tools.xcrun, [
          'simctl', 'openurl', device.rawId, target.serialized,
        ])
      : await this.run(tools.adb, [
          '-s', device.rawId, 'shell', 'am', 'start', '-W',
          '-a', 'android.intent.action.VIEW', '-d', target.serialized,
        ])
    if (!result.ok) throw processError(result, 'The URL could not be opened on the device.')
    return success(device, 'open_url', 'DEVICE_URL_OPENED', {
      opened: true,
      scheme: target.scheme,
    })
  }

  async addMedia(device, request, tools) {
    const before = request.validatedMediaPath
    if (typeof before !== 'string' || !path.isAbsolute(before)) {
      throw new Error('Choose an exact workspace photo or video file.')
    }
    const after = await Promise.resolve(
      this.validateMedia(request.mediaPath, device.platform)
    )
    if (after !== before) {
      throw new Error('The media file changed while awaiting review.')
    }
    const extension = path.extname(after).toLowerCase()
    if (!DEVICE_MEDIA_EXTENSIONS.has(extension)) {
      throw new Error('Choose a supported workspace photo or video file.')
    }
    await this.ensureReady(device, tools)
    if (device.platform === 'ios') {
      const result = await this.run(tools.xcrun, [
        'simctl', 'addmedia', device.rawId, after,
      ], { timeoutMilliseconds: BOOT_TIMEOUT_MS })
      if (!result.ok) throw processError(result, 'The media file could not be added to the iOS Simulator.')
    } else {
      const remotePath = `/sdcard/Pictures/StatsKey/${randomUUID()}${extension}`
      const directory = '/sdcard/Pictures/StatsKey'
      const createDirectory = await this.run(tools.adb, [
        '-s', device.rawId, 'shell', 'mkdir', '-p', directory,
      ])
      if (!createDirectory.ok) {
        throw processError(createDirectory, 'The Android Emulator media folder is unavailable.')
      }
      const pushed = await this.run(tools.adb, [
        '-s', device.rawId, 'push', after, remotePath,
      ], { timeoutMilliseconds: BOOT_TIMEOUT_MS })
      if (!pushed.ok) throw processError(pushed, 'The media file could not be added to the Android Emulator.')
      const scanned = await this.run(tools.adb, [
        '-s', device.rawId, 'shell', 'am', 'broadcast',
        '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
        '-d', `file://${remotePath}`,
      ])
      if (!scanned.ok) {
        throw processError(scanned, 'Android could not register the added media file.')
      }
    }
    return success(device, 'add_media', 'DEVICE_MEDIA_ADDED', {
      added: true,
      mediaType: mediaKindForExtension(extension),
      fileName: path.basename(after).slice(0, 240),
    })
  }

  async process(device, request, tools) {
    const appId = validAppId(request.appId)
    await this.ensureReady(device, tools)
    const result = device.platform === 'ios'
      ? await this.run(tools.xcrun, ['simctl', 'spawn', device.rawId, 'launchctl', 'list'])
      : await this.run(tools.adb, ['-s', device.rawId, 'shell', 'pidof', appId])
    if (!result.ok && device.platform === 'ios') {
      throw processError(result, 'The app process could not be inspected.')
    }
    const pid = device.platform === 'ios'
      ? iosLaunchctlPid(result.stdout, appId)
      : integerMatch(result.stdout, /\b(\d+)\b/)
    return success(device, 'process', pid ? 'DEVICE_PROCESS_ALIVE' : 'DEVICE_PROCESS_NOT_RUNNING', {
      appId, alive: Boolean(pid), ...(pid ? { pid } : {}),
    })
  }

  async logs(device, request, tools) {
    const appId = validAppId(request.appId)
    const since = boundedInteger(request.logSinceSeconds, 1, 600, 120)
    await this.ensureReady(device, tools)
    // A crash-free log window is meaningful only while the exact requested
    // app is still alive. Resolve and validate that PID before reading logs.
    const processState = await this.process(device, { ...request, appId }, tools)
    if (processState.alive !== true || !processState.pid) {
      return {
        ok: false,
        platform: device.platform,
        action: 'logs',
        marker: 'DEVICE_PROCESS_NOT_RUNNING',
        appId,
        alive: false,
        error: 'The app process is not running; crash-free verification is unavailable.',
      }
    }
    const pid = processState.pid
    const result = device.platform === 'ios'
      ? await this.run(tools.xcrun, [
          'simctl', 'spawn', device.rawId, 'log', 'show', '--style', 'compact',
          '--last', `${since}s`, '--predicate', `processIdentifier == ${pid}`,
        ], { timeoutMilliseconds: 45_000 })
      : await this.run(tools.adb, [
          '-s', device.rawId, 'logcat', '-d', `--pid=${pid}`, '-t',
          String(Math.min(4_000, since * 12)),
        ], { timeoutMilliseconds: 45_000 })
    if (!result.ok) throw processError(result, 'Recent device logs are unavailable.')
    const logs = boundedText(`${result.stdout}\n${result.stderr}`.trim(), MAX_LOG_CHARACTERS)
    const crashMarkers = detectedCrashMarkers(logs, appId, true)
    const finalProcessState = await this.process(
      device,
      { ...request, appId },
      tools
    )
    if (finalProcessState.alive !== true || finalProcessState.pid !== pid) {
      return {
        ok: false,
        platform: device.platform,
        action: 'logs',
        marker: 'DEVICE_PROCESS_NOT_RUNNING',
        appId,
        alive: false,
        logs,
        crashFree: false,
        crashMarkers,
        error: 'The app process stopped while recent logs were being checked.',
      }
    }
    return success(device, 'logs', crashMarkers.length ? 'DEVICE_CRASH_MARKERS_FOUND' : 'DEVICE_LOGS_CRASH_FREE', {
      appId,
      logs,
      alive: true,
      pid,
      crashFree: crashMarkers.length === 0,
      crashMarkers,
    })
  }

  async close(device, request, tools) {
    const appId = validAppId(request.appId)
    await this.ensureReady(device, tools)
    const result = device.platform === 'ios'
      ? await this.run(tools.xcrun, ['simctl', 'terminate', device.rawId, appId])
      : await this.run(tools.adb, ['-s', device.rawId, 'shell', 'am', 'force-stop', appId])
    const output = `${result.stdout}\n${result.stderr}`
    if (!result.ok && !/not running|found nothing to terminate/i.test(output)) {
      throw processError(result, 'The app could not be closed.')
    }
    return success(device, 'close', 'DEVICE_APP_CLOSED', { appId, closed: true, alive: false })
  }

  async runMaestro(device, request, tools, flow) {
    if (!tools.maestro) throw new Error('Maestro with a working Java runtime is required for iOS UI control.')
    if (!request.appId) throw new Error('iOS UI automation requires the app bundle ID.')
    const boundedFlow = String(flow || '')
    if (!boundedFlow || boundedFlow.length > 16_000 || boundedFlow.includes('\0')) {
      throw new Error('The generated device automation flow is invalid.')
    }
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'statskey-maestro-'))
    const flowPath = path.join(temporaryDirectory, 'flow.yaml')
    try {
      writeFileSync(flowPath, boundedFlow, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      return await this.run(tools.maestro, [
        '--device', device.rawId, 'test', flowPath,
      ], { env: toolEnvironment(tools), timeoutMilliseconds: 60_000 })
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }

  async ensureReady(device, tools) {
    if (device.state !== 'booted' || !device.rawId) {
      throw new Error('Boot the selected simulator or emulator before this action.')
    }
    if (device.platform === 'android') await this.assertAndroidEmulator(device, tools)
  }

  async assertAndroidEmulator(device, tools) {
    if (!/^emulator-\d+$/.test(device.rawId || '')) {
      throw new Error('Physical Android devices are never available for control.')
    }
    const qemu = await this.run(tools.adb, [
      '-s', device.rawId, 'shell', 'getprop', 'ro.kernel.qemu',
    ])
    if (!qemu.ok || qemu.stdout.trim() !== '1') {
      throw new Error('The selected Android target is not a verified emulator.')
    }
  }

  async waitForAndroidAvd(device, tools) {
    const deadline = this.now() + BOOT_TIMEOUT_MS
    while (this.now() < deadline) {
      const listed = await this.run(tools.adb, ['devices', '-l'], {
        timeoutMilliseconds: 1_000,
      })
      if (listed.ok) {
        for (const line of listed.stdout.split(/\r?\n/).slice(1, 9)) {
          const match = line.trim().match(/^(emulator-\d+)\s+device\b/)
          if (!match) continue
          const serial = match[1]
          const avd = await this.run(tools.adb, [
            '-s', serial, 'emu', 'avd', 'name',
          ], { timeoutMilliseconds: 1_000 })
          if (!avd.ok || firstOutputLine(avd.stdout) !== device.avdName) continue
          const qemu = await this.run(tools.adb, [
            '-s', serial, 'shell', 'getprop', 'ro.kernel.qemu',
          ], { timeoutMilliseconds: 1_000 })
          if (!qemu.ok || qemu.stdout.trim() !== '1') continue
          const completed = await this.run(tools.adb, [
            '-s', serial, 'shell', 'getprop', 'sys.boot_completed',
          ], { timeoutMilliseconds: 1_000 })
          if (!completed.ok || completed.stdout.trim() !== '1') continue
          device.rawId = serial
          device.state = 'booted'
          device.available = true
          return
        }
      }
      if (this.now() < deadline) {
        await this.delay(Math.min(1_000, Math.max(1, deadline - this.now())))
      }
    }
    throw new Error(
      'The Android Emulator did not report a matching booted AVD within 120 seconds.'
    )
  }

  async androidPid(device, appId, tools) {
    const result = await this.run(tools.adb, ['-s', device.rawId, 'shell', 'pidof', appId])
    return result.ok ? integerMatch(result.stdout, /\b(\d+)\b/) : null
  }

  async resolveAndroidLaunchActivity(device, appId, tools) {
    const result = await this.run(tools.adb, [
      '-s', device.rawId, 'shell', 'cmd', 'package', 'resolve-activity',
      '--brief', '-c', 'android.intent.category.LAUNCHER', appId,
    ])
    if (!result.ok) {
      throw processError(result, 'The Android launcher activity could not be resolved.')
    }
    const prefix = `${appId}/`
    const components = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(prefix))
    if (components.length !== 1) {
      throw new Error('The Android package did not expose one unambiguous launcher activity.')
    }
    const activity = components[0].slice(prefix.length)
    return validActivity(activity)
  }

  run(executable, args, options = {}) {
    if (!executable || !path.isAbsolute(executable)) {
      return Promise.resolve({ ok: false, stdout: '', stderr: '', error: 'Required device tool is unavailable.' })
    }
    return Promise.resolve(this.runProcess({
      executable,
      args: args.map(String),
      cwd: os.tmpdir(),
      env: options.env || toolEnvironment({}),
      stdio: ['ignore', 'pipe', 'pipe'],
      input: options.input,
      timeoutMilliseconds: options.timeoutMilliseconds || PROCESS_TIMEOUT_MS,
      maxOutputCharacters: options.maxOutputCharacters || MAX_OUTPUT_CHARACTERS,
    })).then(normalizedProcessResult)
  }

  enqueue(key, task) {
    const previous = this.queues.get(key) || Promise.resolve()
    const current = previous.catch(() => {}).then(task)
    this.queues.set(key, current)
    return current.finally(() => {
      if (this.queues.get(key) === current) this.queues.delete(key)
    })
  }
}

function normalizedRequest(candidate) {
  if (!candidate || typeof candidate !== 'object') return { ok: false, error: 'Invalid device action.' }
  const platform = candidate.platform === 'ios' || candidate.platform === 'android' ? candidate.platform : null
  const action = DEVICE_ACTIONS.has(candidate.action) ? candidate.action : null
  const deviceId = validOpaqueId(candidate.deviceId)
  if (!platform || !action || !deviceId) return { ok: false, error: 'Invalid simulator or emulator action.' }
  return {
    ok: true,
    value: {
      platform, action, deviceId,
      artifactPath: boundedOptionalString(candidate.artifactPath, 4_000),
      mediaPath: boundedOptionalString(candidate.mediaPath, 4_000),
      url: boundedOptionalString(candidate.url, 2_048),
      appId: boundedOptionalString(candidate.appId, 240),
      activity: boundedOptionalString(candidate.activity, 300),
      text: boundedOptionalString(candidate.text, 2_000),
      x: candidate.x, y: candidate.y, endX: candidate.endX, endY: candidate.endY,
      durationMs: candidate.durationMs,
      logSinceSeconds: candidate.logSinceSeconds,
      environment: normalizedEnvironment(candidate.environment),
    },
  }
}

function normalizedOwner(origin) {
  if (origin === undefined || origin === null) return { key: 'legacy' }
  if (!origin || typeof origin !== 'object') throw new Error('A device agent action requires a conversation.')
  const sessionId = typeof origin.sessionId === 'string' ? origin.sessionId.trim().slice(0, 160) : ''
  if (!sessionId) throw new Error('A device agent action requires a conversation.')
  return { key: `session:${sessionId}` }
}

function approvalOperation(request, device) {
  const labels = {
    boot: 'Boot device', install: 'Install app on device', launch: 'Launch app on device',
    tap: 'Tap device screen', type: 'Type on device', swipe: 'Swipe device screen',
    back: 'Use device back action', home: 'Use device home action',
    open_url: 'Open URL on device', add_media: 'Add media to device',
    close: 'Close app on device',
  }
  return {
    kind: 'device',
    title: labels[request.action] || 'Control simulator or emulator',
    description: `${device.platform === 'ios' ? 'iOS Simulator' : 'Android Emulator'} · ${device.name}`,
    command: approvalCommand(request),
    before: '',
    after: '',
  }
}

function approvalCommand(request) {
  if (request.action === 'type') return `type ${request.text?.length || 0} characters`
  if (request.action === 'tap') return `tap ${request.x},${request.y}`
  if (request.action === 'swipe') return `swipe ${request.x},${request.y} to ${request.endX},${request.endY}`
  if (request.action === 'install') return `install ${path.basename(request.artifactPath || 'workspace artifact')}`
  if (request.action === 'add_media') return `add media ${path.basename(request.mediaPath || 'workspace file')}`
  if (request.action === 'open_url') {
    const target = validDeviceUrl(request.url, request.platform)
    return `open ${target.scheme} URL`
  }
  if (request.appId) return `${request.action} ${request.appId}`
  return request.action
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    state: device.state,
    ...(device.runtime ? { runtime: device.runtime, osVersion: device.runtime } : {}),
    available: device.available !== false,
  }
}

function publicTools(tools) {
  return Object.fromEntries(
    ['xcrun', 'adb', 'emulator', 'maestro', 'javaHome', 'androidSdk']
      .map((key) => [key, tools[key]])
      .filter(([, value]) => typeof value === 'string' && value)
  )
}

function buildEnvironment(tools) {
  return {
    ...(tools.javaHome ? { JAVA_HOME: tools.javaHome } : {}),
    ...(tools.androidSdk
      ? {
          ANDROID_HOME: tools.androidSdk,
          ANDROID_SDK_ROOT: tools.androidSdk,
        }
      : {}),
  }
}

function success(device, action, marker, extra = {}) {
  return { ok: true, platform: device.platform, action, marker, ...extra }
}

function failed(error, action, platform) {
  return {
    ok: false,
    ...(platform ? { platform } : {}),
    ...(action && DEVICE_ACTIONS.has(action) ? { action } : {}),
    error: safeError(error),
  }
}

function processError(result, fallback) {
  return new Error(boundedText(result.stderr || result.error || result.stdout, 500) || fallback)
}

function normalizedProcessResult(result) {
  const value = result && typeof result === 'object' ? result : {}
  return {
    ...value,
    ok: value.ok === true,
    stdout: Buffer.isBuffer(value.stdout) ? value.stdout : String(value.stdout || ''),
    stderr: Buffer.isBuffer(value.stderr) ? value.stderr : String(value.stderr || ''),
  }
}

function toolEnvironment(tools) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  if (tools.javaHome) env.JAVA_HOME = tools.javaHome
  if (tools.androidSdk) {
    env.ANDROID_HOME = tools.androidSdk
    env.ANDROID_SDK_ROOT = tools.androidSdk
  }
  return env
}

function appEnvironment(candidate, tools) {
  const env = toolEnvironment(tools)
  for (const [key, value] of Object.entries(candidate || {})) {
    env[`SIMCTL_CHILD_${key}`] = value
  }
  return env
}

function normalizedEnvironment(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {}
  const result = {}
  for (const [key, value] of Object.entries(candidate).slice(0, 24)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) || typeof value !== 'string') continue
    if (/^(?:HOME|PATH|SHELL|TMPDIR|DYLD_|LD_|NODE_|ELECTRON_|JAVA_|JDK_)/.test(key)) continue
    if (value.length > 2_000 || value.includes('\0')) continue
    result[key] = value
  }
  return result
}

function validAppId(candidate) {
  if (typeof candidate !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,239}$/.test(candidate)) {
    throw new Error('Choose a valid app bundle or package ID.')
  }
  return candidate
}

function validActivity(candidate) {
  if (typeof candidate !== 'string' || !/^[A-Za-z0-9_.$-]{1,300}$/.test(candidate)) {
    throw new Error('Choose a valid Android activity name.')
  }
  return candidate
}

function validInputText(candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.length > 2_000 || candidate.includes('\0')) {
    throw new Error('Enter between 1 and 2,000 non-secret characters.')
  }
  return candidate
}

function validDeviceUrl(candidate, platform) {
  if (
    typeof candidate !== 'string' ||
    candidate.length < 3 ||
    candidate.length > 2_048 ||
    /[\u0000-\u001f\u007f\s]/.test(candidate)
  ) {
    throw new Error('Choose a valid bounded device URL without whitespace or control characters.')
  }
  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('Choose an absolute device URL with an explicit scheme.')
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  if (
    !/^[a-z][a-z0-9+.-]{0,31}$/.test(scheme) ||
    BLOCKED_URL_SCHEMES.has(scheme) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('That device URL scheme or credential form is not allowed.')
  }
  const serialized = parsed.href
  if (serialized.length > 2_048 || /[\u0000-\u001f\u007f\s]/.test(serialized)) {
    throw new Error('The normalized device URL is invalid or too long.')
  }
  if (
    platform === 'android' &&
    /[;&|`$<>(){}\[\]\\'"*!]/.test(serialized)
  ) {
    throw new Error('Android device URLs block remote-shell metacharacters.')
  }
  return { scheme, serialized }
}

function mediaKindForExtension(extension) {
  return ['.m4v', '.mov', '.mp4'].includes(extension) ? 'video' : 'image'
}

function androidInputText(value) {
  if (!/^[A-Za-z0-9 .,!?_@+%:\/-]+$/.test(value)) {
    throw new Error('Android device typing blocks shell metacharacters and control characters.')
  }
  return value.replaceAll(' ', '%s')
}

function coordinate(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`Device ${label} coordinate must be between 0 and 10,000.`)
  }
  return value
}

function boundedInteger(value, minimum, maximum, fallback) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback
}

function validIosUdid(value) {
  return typeof value === 'string' && /^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/i.test(value)
}

function validAvdName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._ -]{1,120}$/.test(value)
}

function validOpaqueId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value) ? value : null
}

function boundedOptionalString(value, maximum) {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\0') ? value : undefined
}

function boundedText(value, maximum) {
  return String(value || '').replace(/\0/g, '').slice(-maximum)
}

function boundedHierarchy(value, maximum) {
  const normalized = String(value || '').replace(/\0/g, '')
  if (normalized.length <= maximum) return normalized
  const separator = '\n… DEVICE HIERARCHY TRUNCATED …\n'
  const headLength = Math.floor((maximum - separator.length) * 0.75)
  const tailLength = maximum - separator.length - headLength
  return `${normalized.slice(0, headLength)}${separator}${normalized.slice(-tailLength)}`
}

function safeError(error) {
  return boundedText(error instanceof Error ? error.message : String(error), 500)
    .replace(
      /\b(token|key|secret|password)\b(\s*[:=]\s*)[^,\s]+/gi,
      '$1$2[redacted]'
    )
}

function defaultAndroidToolCandidates({
  platform = process.platform,
  environment = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path
  const join = (root, ...segments) =>
    typeof root === 'string' && root
      ? pathApi.join(root, ...segments)
      : null
  const androidSdk = [
    environment?.ANDROID_SDK_ROOT,
    environment?.ANDROID_HOME,
  ]
  const javaHomes = [environment?.JAVA_HOME]

  if (platform === 'win32') {
    androidSdk.push(
      join(environment?.LOCALAPPDATA, 'Android', 'Sdk'),
      join(environment?.USERPROFILE || homeDirectory, 'AppData', 'Local', 'Android', 'Sdk')
    )
    for (const root of [
      environment?.ProgramFiles,
      environment?.['ProgramFiles(x86)'],
    ]) {
      javaHomes.push(
        join(root, 'Android', 'Android Studio', 'jbr'),
        join(root, 'Android', 'Android Studio', 'jre')
      )
    }
    const localPrograms = join(environment?.LOCALAPPDATA, 'Programs')
    javaHomes.push(
      join(localPrograms, 'Android Studio', 'jbr'),
      join(localPrograms, 'Android Studio', 'jre'),
      join(localPrograms, 'Android', 'Android Studio', 'jbr')
    )
  } else if (platform === 'darwin') {
    androidSdk.push(
      join(homeDirectory, 'Library', 'Android', 'sdk'),
      join(homeDirectory, 'Android', 'Sdk')
    )
    javaHomes.push(
      '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
      join(homeDirectory, 'Library', 'Java', 'JavaVirtualMachines')
    )
  } else {
    androidSdk.push(join(homeDirectory, 'Android', 'Sdk'))
    javaHomes.push(
      '/opt/android-studio/jbr',
      '/usr/lib/jvm/default-java',
      join(homeDirectory, 'android-studio', 'jbr')
    )
  }

  return {
    androidSdk: uniquePaths(androidSdk),
    javaHomes: uniquePaths(javaHomes),
  }
}

function uniquePaths(candidates) {
  return [...new Set(candidates.filter((candidate) =>
    typeof candidate === 'string' && candidate.length > 0
  ))]
}

function executablesFromPath(name) {
  const value = process.env.PATH
  if (typeof value !== 'string' || !value) return []
  return value
    .split(path.delimiter)
    .filter(Boolean)
    .slice(0, 128)
    .map((directory) => path.join(directory, executableName(name)))
}

function executableName(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.exe` : name
}

function firstExecutable(candidates) {
  return candidates.filter(Boolean).find((candidate) => {
    if (!path.isAbsolute(candidate)) return false
    try {
      accessSync(candidate, fsConstants.X_OK)
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  }) || null
}

function firstDirectory(candidates) {
  return candidates.filter(Boolean).find((candidate) => {
    if (!path.isAbsolute(candidate)) return false
    try {
      return statSync(candidate).isDirectory()
    } catch {
      return false
    }
  }) || null
}

function firstJavaHome(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate) && existsSync(path.join(candidate, 'bin', executableName('java')))) return candidate
    if (!path.isAbsolute(candidate)) continue
    try {
      for (const entry of readdirSync(candidate).sort()) {
        const nested = path.join(candidate, entry, 'Contents', 'Home')
        if (existsSync(path.join(nested, 'bin', executableName('java')))) return nested
      }
    } catch {}
  }
  return null
}

function fieldFromAdbLine(line, key) {
  const match = String(line || '').match(new RegExp(`(?:^|\\s)${key}:([^\\s]+)`))
  return match?.[1] || null
}

function firstOutputLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
}

function integerMatch(value, pattern) {
  const number = Number.parseInt(String(value || '').match(pattern)?.[1] || '', 10)
  return Number.isInteger(number) && number > 0 ? number : null
}

function iosLaunchctlPid(output, appId) {
  const escaped = appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return integerMatch(output, new RegExp(`^\\s*(\\d+)\\s+[-\\d]+\\s+.*${escaped}.*$`, 'm'))
}

function detectedCrashMarkers(logs, appId, alreadyScopedToProcess = false) {
  const patterns = [
    ['fatal-error', /\bFatal error:|fatal exception/i],
    ['uncaught-exception', /uncaught exception|terminating app due to uncaught/i],
    ['signal-crash', /\bSIG(?:ABRT|SEGV|BUS|ILL)\b|signal (?:6|11)/i],
    ['android-fatal', /\bFATAL EXCEPTION\b|force finishing activity/i],
    ['ios-crash', /\bcrash(?:ed|ing)?\b|EXC_BAD_ACCESS/i],
  ]
  if (
    !alreadyScopedToProcess &&
    !String(logs).toLowerCase().includes(String(appId).toLowerCase())
  ) return []
  return patterns.filter(([, pattern]) => pattern.test(logs)).map(([name]) => name)
}

function isPng(bytes) {
  return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

function pngSize(bytes) {
  if (!isPng(bytes)) return null
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 10_000 || height > 10_000) return null
  return { width, height }
}

function yamlScalar(value) {
  return JSON.stringify(String(value))
}

function defaultSpawnDetached({ executable, args, env }) {
  const child = spawn(executable, args, { env, detached: true, stdio: 'ignore' })
  child.unref()
  return true
}

function defaultDelay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref?.()
  })
}

async function unavailableRunner() {
  return { ok: false, stdout: '', stderr: '', error: 'Device process runner is unavailable.' }
}

module.exports = {
  defaultAndroidToolCandidates,
  DeviceControlRuntime,
}
