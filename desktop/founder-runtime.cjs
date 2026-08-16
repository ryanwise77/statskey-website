const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { runBoundedChildProcess } = require('./child-process-runtime.cjs')

const FOUNDER_CHECKS = new Set([
  'oil-storage',
  'macremote-doctor',
  'macremote-connectivity',
])
const FOUNDER_ACTIONS = new Set([
  'open-truenas',
  'open-idrac',
  'mount-oil-share',
  'open-mac-screen',
  'stop-mac-screen',
])

class FounderRuntime {
  constructor({
    homeDirectory = os.homedir(),
    userDataDirectory = path.join(homeDirectory, 'Library', 'Application Support', 'StatsKey Founder'),
    platform = process.platform,
    runProcess = runBoundedChildProcess,
    spawnProcess = spawn,
    openExternal = async () => {},
    probeTcp = tcpProbe,
    fileSystem = fs,
    environment = process.env,
  } = {}) {
    this.homeDirectory = homeDirectory
    this.userDataDirectory = userDataDirectory
    this.platform = platform
    this.runProcess = runProcess
    this.spawnProcess = spawnProcess
    this.openExternal = openExternal
    this.probeTcp = probeTcp
    this.fileSystem = fileSystem
    this.environment = environment
    this.screenProcess = null
    this.screenProcessError = null
  }

  configurationPath() {
    return path.join(this.userDataDirectory, 'founder-config.json')
  }

  configuration() {
    const defaults = defaultFounderConfiguration(this.homeDirectory)
    const configPath = this.configurationPath()
    let source = 'defaults'
    let candidate = {}
    if (this.fileSystem.existsSync(configPath)) {
      const raw = this.fileSystem.readFileSync(configPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (containsSensitiveConfigurationKey(parsed)) {
        throw new Error('Founder configuration must not contain passwords, tokens, or private keys.')
      }
      candidate = parsed
      source = 'file'
    }
    const configuration = mergeFounderConfiguration(defaults, candidate)
    validateFounderConfiguration(configuration)
    return { ...configuration, source, configPath }
  }

  async state() {
    let configuration
    try {
      configuration = this.configuration()
    } catch (error) {
      return {
        available: true,
        generatedAt: new Date().toISOString(),
        configurationError: errorMessage(error),
        services: {},
        storage: storageUnavailable(''),
        readiness: {},
      }
    }

    const trueNasPort = portForUrl(configuration.trueNas.webUrl)
    const idracPort = portForUrl(configuration.idrac.webUrl)
    const [
      trueNasWeb,
      trueNasSmb,
      idrac,
      macSsh,
      macScreen,
      gpuSsh,
    ] = await Promise.all([
      this.probeTcp(configuration.trueNas.host, trueNasPort),
      this.probeTcp(configuration.trueNas.host, 445),
      this.probeTcp(configuration.idrac.host, idracPort),
      this.probeTcp(configuration.macMini.host, configuration.macMini.sshPort),
      this.probeTcp(configuration.macMini.host, configuration.macMini.screenPort),
      configuration.gpu.host
        ? this.probeTcp(configuration.gpu.host, configuration.gpu.sshPort)
        : Promise.resolve(false),
    ])

    return {
      available: true,
      generatedAt: new Date().toISOString(),
      configuration: {
        source: configuration.source,
        path: configuration.configPath,
      },
      services: {
        trueNas: {
          label: 'TrueNAS',
          host: configuration.trueNas.host,
          port: trueNasPort,
          online: trueNasWeb,
          url: configuration.trueNas.webUrl,
        },
        smb: {
          label: 'Oil Data SMB',
          host: configuration.trueNas.host,
          port: 445,
          online: trueNasSmb,
          url: configuration.trueNas.smbUrl,
        },
        idrac: {
          label: 'Dell iDRAC',
          host: configuration.idrac.host,
          port: idracPort,
          online: idrac,
          url: configuration.idrac.webUrl,
        },
        macMini: {
          label: 'Mac mini',
          host: configuration.macMini.host,
          sshPort: configuration.macMini.sshPort,
          screenPort: configuration.macMini.screenPort,
          sshOnline: macSsh,
          screenOnline: macScreen,
        },
        gpu: {
          label: 'RTX workstation',
          host: configuration.gpu.host || null,
          port: configuration.gpu.sshPort,
          configured: Boolean(configuration.gpu.host),
          online: gpuSsh,
        },
      },
      storage: storageStatus(
        configuration.trueNas.mountPath,
        this.fileSystem
      ),
      readiness: {
        oilProject: pathStatus(configuration.oil.projectPath, this.fileSystem),
        oilPython: pathStatus(configuration.oil.pythonPath, this.fileSystem),
        macRemoteProject: pathStatus(
          configuration.macRemote.projectPath,
          this.fileSystem
        ),
        macRemoteExecutable: pathStatus(
          configuration.macRemote.executable,
          this.fileSystem
        ),
        macRemoteConfig: pathStatus(
          configuration.macRemote.configPath,
          this.fileSystem
        ),
        macScreenRunning: Boolean(
          this.screenProcess && this.screenProcess.exitCode == null
        ),
        macScreenError: this.screenProcessError,
      },
      paths: {
        oilProject: configuration.oil.projectPath,
        oilData: configuration.oil.dataPath,
        macRemoteProject: configuration.macRemote.projectPath,
      },
    }
  }

  async runCheck(check) {
    if (!FOUNDER_CHECKS.has(check)) {
      return { ok: false, error: 'That Founder diagnostic is not allowed.' }
    }
    let configuration
    try {
      configuration = this.configuration()
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
    if (check === 'oil-storage') {
      if (!this.fileSystem.existsSync(configuration.oil.pythonPath)) {
        return { ok: false, error: 'The Oil Data Python environment is unavailable.' }
      }
      return this.runProcess({
        executable: configuration.oil.pythonPath,
        args: ['-m', 'oilpipe.storage', 'check', '--json'],
        cwd: configuration.oil.projectPath,
        env: {
          ...this.environment,
          OILPIPE_DATA_DIR: configuration.oil.dataPath,
          PYTHONPATH: path.join(configuration.oil.projectPath, 'src'),
        },
        timeoutMilliseconds: 20_000,
        maxOutputCharacters: 100_000,
      })
    }
    if (!this.fileSystem.existsSync(configuration.macRemote.executable)) {
      return { ok: false, error: 'The MacRemote executable is unavailable.' }
    }
    if (!this.fileSystem.existsSync(configuration.macRemote.configPath)) {
      return { ok: false, error: 'MacRemote still needs its private transport configuration.' }
    }
    const connectivity = check === 'macremote-connectivity'
    return this.runProcess({
      executable: configuration.macRemote.executable,
      args: connectivity
        ? [
            'ssh',
            configuration.macRemote.configPath,
            '--',
            '/usr/bin/true',
          ]
        : ['doctor', configuration.macRemote.configPath],
      cwd: configuration.macRemote.projectPath,
      env: this.environment,
      timeoutMilliseconds: connectivity ? 45_000 : 20_000,
      maxOutputCharacters: 100_000,
    })
  }

  async perform(action) {
    if (!FOUNDER_ACTIONS.has(action)) {
      return { ok: false, error: 'That Founder action is not allowed.' }
    }
    let configuration
    try {
      configuration = this.configuration()
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
    if (action === 'open-truenas') {
      await this.openExternal(configuration.trueNas.webUrl)
      return { ok: true }
    }
    if (action === 'open-idrac') {
      await this.openExternal(configuration.idrac.webUrl)
      return { ok: true }
    }
    if (action === 'mount-oil-share') {
      if (this.platform !== 'darwin') {
        return { ok: false, error: 'Finder SMB mounting is available only on macOS.' }
      }
      await this.openExternal(configuration.trueNas.smbUrl)
      return { ok: true }
    }
    if (action === 'stop-mac-screen') {
      if (!this.screenProcess || this.screenProcess.exitCode != null) {
        this.screenProcess = null
        return { ok: true, changed: false }
      }
      this.screenProcess.kill('SIGTERM')
      this.screenProcess = null
      return { ok: true, changed: true }
    }
    if (this.platform !== 'darwin') {
      return { ok: false, error: 'Mac Screen Sharing is available only on macOS.' }
    }
    if (this.screenProcess && this.screenProcess.exitCode == null) {
      return { ok: true, changed: false, pid: this.screenProcess.pid }
    }
    if (!this.fileSystem.existsSync(configuration.macRemote.executable)) {
      return { ok: false, error: 'The MacRemote executable is unavailable.' }
    }
    if (!this.fileSystem.existsSync(configuration.macRemote.configPath)) {
      return { ok: false, error: 'MacRemote still needs its private transport configuration.' }
    }
    return this.startMacScreen(configuration)
  }

  startMacScreen(configuration) {
    return new Promise((resolve) => {
      this.screenProcessError = null
      let child
      try {
        child = this.spawnProcess(
          configuration.macRemote.executable,
          ['screen', configuration.macRemote.configPath],
          {
            cwd: configuration.macRemote.projectPath,
            env: this.environment,
            stdio: 'ignore',
          }
        )
      } catch (error) {
        this.screenProcessError = errorMessage(error)
        resolve({ ok: false, error: this.screenProcessError })
        return
      }
      this.screenProcess = child
      const failed = (error) => {
        if (this.screenProcess === child) this.screenProcess = null
        this.screenProcessError = errorMessage(error)
        resolve({ ok: false, error: this.screenProcessError })
      }
      child.once('error', failed)
      child.once('spawn', () => {
        child.removeListener('error', failed)
        child.once('error', (error) => {
          this.screenProcessError = errorMessage(error)
        })
        child.once('exit', () => {
          if (this.screenProcess === child) this.screenProcess = null
        })
        resolve({ ok: true, changed: true, pid: child.pid })
      })
    })
  }

  macRemoteShellCommand() {
    const configuration = this.configuration()
    if (this.platform !== 'darwin') {
      throw new Error('MacRemote shell access is available only on macOS.')
    }
    if (!this.fileSystem.existsSync(configuration.macRemote.executable)) {
      throw new Error('The MacRemote executable is unavailable.')
    }
    if (!this.fileSystem.existsSync(configuration.macRemote.configPath)) {
      throw new Error('MacRemote still needs its private transport configuration.')
    }
    return {
      command: [
        quotePosixArgument(configuration.macRemote.executable),
        'ssh',
        quotePosixArgument(configuration.macRemote.configPath),
      ].join(' '),
      cwd: configuration.macRemote.projectPath,
    }
  }

  closeAll() {
    if (this.screenProcess && this.screenProcess.exitCode == null) {
      this.screenProcess.kill('SIGTERM')
    }
    this.screenProcess = null
  }
}

function defaultFounderConfiguration(homeDirectory) {
  const oilProject = path.join(
    homeDirectory,
    'Projects',
    'Oil Data',
    'oilfield-pipeline'
  )
  const macRemoteProject = path.join(homeDirectory, 'Projects', 'MacRemote')
  return {
    trueNas: {
      host: '192.168.3.55',
      webUrl: 'http://192.168.3.55',
      smbUrl: 'smb://192.168.3.55/StatsKey-Oil',
      mountPath: '/Volumes/StatsKey-Oil',
    },
    idrac: {
      host: '192.168.3.56',
      webUrl: 'https://192.168.3.56',
    },
    macMini: {
      host: 'ryans-mac-mini.local',
      sshPort: 22,
      screenPort: 5900,
    },
    macRemote: {
      projectPath: macRemoteProject,
      executable: path.join(macRemoteProject, '.build', 'release', 'macremote'),
      configPath: path.join(
        homeDirectory,
        'Library',
        'Application Support',
        'MacRemote',
        'config.json'
      ),
    },
    oil: {
      projectPath: oilProject,
      dataPath: '/Volumes/StatsKey-Oil',
      pythonPath: path.join(oilProject, '.venv', 'bin', 'python'),
    },
    gpu: {
      host: '',
      sshPort: 22,
    },
  }
}

function mergeFounderConfiguration(defaults, candidate) {
  const value = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    trueNas: { ...defaults.trueNas, ...plainObject(value.trueNas) },
    idrac: { ...defaults.idrac, ...plainObject(value.idrac) },
    macMini: { ...defaults.macMini, ...plainObject(value.macMini) },
    macRemote: { ...defaults.macRemote, ...plainObject(value.macRemote) },
    oil: { ...defaults.oil, ...plainObject(value.oil) },
    gpu: { ...defaults.gpu, ...plainObject(value.gpu) },
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function validateFounderConfiguration(configuration) {
  validateHost(configuration.trueNas.host, 'trueNas.host')
  validateUrl(configuration.trueNas.webUrl, ['http:', 'https:'], configuration.trueNas.host)
  validateUrl(configuration.trueNas.smbUrl, ['smb:'], configuration.trueNas.host)
  validatePath(configuration.trueNas.mountPath, 'trueNas.mountPath')
  validateHost(configuration.idrac.host, 'idrac.host')
  validateUrl(configuration.idrac.webUrl, ['https:'], configuration.idrac.host)
  validateHost(configuration.macMini.host, 'macMini.host')
  validatePort(configuration.macMini.sshPort, 'macMini.sshPort')
  validatePort(configuration.macMini.screenPort, 'macMini.screenPort')
  for (const [field, value] of [
    ['macRemote.projectPath', configuration.macRemote.projectPath],
    ['macRemote.executable', configuration.macRemote.executable],
    ['macRemote.configPath', configuration.macRemote.configPath],
    ['oil.projectPath', configuration.oil.projectPath],
    ['oil.dataPath', configuration.oil.dataPath],
    ['oil.pythonPath', configuration.oil.pythonPath],
  ]) {
    validatePath(value, field)
  }
  if (configuration.gpu.host) validateHost(configuration.gpu.host, 'gpu.host')
  validatePort(configuration.gpu.sshPort, 'gpu.sshPort')
}

function validateHost(value, field) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 253 ||
    value.startsWith('-') ||
    value.includes('..') ||
    !/^[a-z0-9.:-]+$/i.test(value)
  ) {
    throw new Error(`${field} is invalid.`)
  }
}

function validateUrl(value, protocols, expectedHost) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Founder service URL is invalid.')
  }
  if (
    !protocols.includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.toLowerCase() !== expectedHost.toLowerCase()
  ) {
    throw new Error('Founder service URL is outside its configured host.')
  }
}

function validatePath(value, field) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.length > 4_096 ||
    /[\0\r\n]/.test(value)
  ) {
    throw new Error(`${field} must be a safe absolute path.`)
  }
}

function validatePort(value, field) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${field} must be a valid TCP port.`)
  }
}

function portForUrl(value) {
  const url = new URL(value)
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

function containsSensitiveConfigurationKey(value) {
  if (!value || typeof value !== 'object') return false
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:password|passphrase|token|secret|private.?key|credential)/i.test(key)) {
      return true
    }
    if (containsSensitiveConfigurationKey(entry)) return true
  }
  return false
}

function pathStatus(candidate, fileSystem) {
  try {
    const stats = fileSystem.statSync(candidate)
    return {
      path: candidate,
      available: true,
      kind: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
    }
  } catch {
    return { path: candidate, available: false, kind: null }
  }
}

function storageUnavailable(candidate) {
  return {
    path: candidate,
    mounted: false,
    totalBytes: null,
    freeBytes: null,
    freeRatio: null,
    reserveHealthy: false,
  }
}

function storageStatus(candidate, fileSystem) {
  try {
    const stats = fileSystem.statSync(candidate)
    if (!stats.isDirectory()) return storageUnavailable(candidate)
    const usage = fileSystem.statfsSync(candidate)
    const totalBytes = Number(usage.blocks) * Number(usage.bsize)
    const freeBytes = Number(usage.bavail) * Number(usage.bsize)
    const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0
    return {
      path: candidate,
      mounted: true,
      totalBytes,
      freeBytes,
      freeRatio,
      reserveHealthy: freeRatio >= 0.2,
    }
  } catch {
    return storageUnavailable(candidate)
  }
}

function tcpProbe(host, port, timeoutMilliseconds = 1_200) {
  return new Promise((resolve) => {
    let settled = false
    const socket = net.createConnection({ host, port })
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMilliseconds)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function quotePosixArgument(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

module.exports = {
  FOUNDER_ACTIONS,
  FOUNDER_CHECKS,
  FounderRuntime,
  containsSensitiveConfigurationKey,
  defaultFounderConfiguration,
  mergeFounderConfiguration,
  quotePosixArgument,
  storageStatus,
  validateFounderConfiguration,
}
