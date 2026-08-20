const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32'])
const UPDATE_CHECK_DELAY_MS = 45 * 1000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

class DesktopUpdateRuntime {
  constructor({
    updater,
    currentVersion,
    platform,
    arch,
    isPackaged,
    feedRoot,
    publishState = () => {},
    notifyDownloaded = () => {},
    getDismissedVersion = () => null,
    setDismissedVersion = () => {},
    logger = console,
  }) {
    this.updater = updater
    this.currentVersion = safeVersion(currentVersion) || '0.0.0'
    this.platform = platform
    this.arch = arch
    this.isPackaged = isPackaged === true
    this.feedRoot = feedRoot
    this.publishState = publishState
    this.notifyDownloaded = notifyDownloaded
    this.getDismissedVersion = getDismissedVersion
    this.setDismissedVersion = setDismissedVersion
    this.logger = logger
    this.initialized = false
    this.manualCheck = false
    this.checkTimer = null
    this.intervalTimer = null
    this.state = {
      status: 'disabled',
      currentVersion: this.currentVersion,
      manual: false,
      dismissed: false,
    }
  }

  initialize() {
    if (this.initialized) return this.getState()
    this.initialized = true
    const feedUrl = updateFeedUrl(
      this.feedRoot,
      this.platform,
      this.arch
    )
    if (this.isPackaged && this.platform === 'linux') {
      this.setState({
        status: 'disabled',
        message:
          'Ubuntu preview updates are installed manually from statskey.ai/download until signed package updates are available.',
      })
      return this.getState()
    }
    if (!this.isPackaged || !feedUrl) {
      this.setState({
        status: 'disabled',
        message: this.isPackaged
          ? 'Updates are not available for this platform.'
          : 'Updates are disabled in development builds.',
      })
      return this.getState()
    }

    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.disableWebInstaller = true
    this.updater.allowDowngrade = false
    this.updater.allowPrerelease = false
    this.updater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
      useMultipleRangeRequest: false,
    })

    this.updater.on('checking-for-update', () => {
      this.setState({
        status: 'checking',
        manual: this.manualCheck,
        message: undefined,
      })
    })
    this.updater.on('update-available', (info) => {
      const latestVersion = safeVersion(info?.version)
      if (!latestVersion) {
        this.handleError(new Error('Update metadata has an invalid version.'))
        return
      }
      const dismissed =
        !this.manualCheck &&
        this.getDismissedVersion() === latestVersion
      this.setState({
        status: 'available',
        latestVersion,
        releaseDate: safeDate(info?.releaseDate),
        releaseNotes: safeReleaseNotes(info?.releaseNotes),
        manual: this.manualCheck,
        dismissed,
        percent: undefined,
        transferred: undefined,
        total: undefined,
        message: undefined,
      })
      // Automatic checks fetch the update quietly in the background so the
      // user only ever decides when to restart. Dismissed versions stay
      // untouched — "Later" means later.
      if (!this.manualCheck && !dismissed) void this.download(true)
    })
    this.updater.on('update-not-available', () => {
      this.setState({
        status: 'current',
        latestVersion: this.currentVersion,
        releaseNotes: undefined,
        checkedAt: new Date().toISOString(),
        manual: this.manualCheck,
        dismissed: false,
        message: undefined,
      })
    })
    this.updater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        percent: clampPercent(progress?.percent),
        transferred: safeByteCount(progress?.transferred),
        total: safeByteCount(progress?.total),
        manual: this.manualCheck,
        dismissed: this.state.dismissed === true,
        message: undefined,
      })
    })
    this.updater.on('update-downloaded', (info) => {
      const latestVersion =
        safeVersion(info?.version) ||
        this.state.latestVersion ||
        this.currentVersion
      this.setDismissedVersion(null)
      this.setState({
        status: 'downloaded',
        latestVersion,
        releaseDate: safeDate(info?.releaseDate),
        releaseNotes:
          safeReleaseNotes(info?.releaseNotes) || this.state.releaseNotes,
        percent: 100,
        manual: true,
        dismissed: false,
        message: undefined,
      })
      this.notifyDownloaded(latestVersion)
    })
    this.updater.on('error', (error) => {
      this.handleError(error)
    })
    this.setState({ status: 'idle', message: undefined })
    return this.getState()
  }

  startAutomaticChecks() {
    if (this.state.status === 'disabled' || this.checkTimer) return
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null
      void this.check(false)
    }, UPDATE_CHECK_DELAY_MS)
    this.checkTimer.unref?.()
    this.intervalTimer = setInterval(() => {
      void this.check(false)
    }, UPDATE_CHECK_INTERVAL_MS)
    this.intervalTimer.unref?.()
  }

  stop() {
    if (this.checkTimer) clearTimeout(this.checkTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.checkTimer = null
    this.intervalTimer = null
  }

  getState() {
    return { ...this.state }
  }

  async check(manual = false) {
    if (this.state.status === 'disabled') return this.getState()
    // A dismissed 'available' state must not block background checks: only
    // that one version was declined, and a newer release should still be
    // discovered, surfaced, and auto-downloaded.
    if (
      !manual &&
      ((this.state.status === 'available' && !this.state.dismissed) ||
        this.state.status === 'downloaded')
    ) {
      return this.getState()
    }
    if (
      this.state.status === 'checking' ||
      this.state.status === 'downloading'
    ) {
      return this.getState()
    }
    this.manualCheck = manual === true
    if (this.manualCheck) this.setDismissedVersion(null)
    this.setState({
      status: 'checking',
      manual: this.manualCheck,
      dismissed: false,
      message: undefined,
    })
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.handleError(error)
    }
    return this.getState()
  }

  async download(automatic = false) {
    if (this.state.status !== 'available' && this.state.status !== 'error') {
      return this.getState()
    }
    if (!this.state.latestVersion) return this.getState()
    if (!automatic) {
      this.manualCheck = true
      this.setDismissedVersion(null)
    }
    this.updater.autoInstallOnAppQuit = this.platform !== 'linux'
    this.setState({
      status: 'downloading',
      percent: 0,
      transferred: 0,
      total: undefined,
      manual: automatic ? this.state.manual : true,
      dismissed: automatic ? this.state.dismissed : false,
      message: undefined,
    })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.handleError(error, !automatic)
    }
    return this.getState()
  }

  install() {
    if (this.state.status !== 'downloaded') return false
    setImmediate(() => this.updater.quitAndInstall(false, true))
    return true
  }

  dismiss() {
    if (this.state.latestVersion) {
      this.setDismissedVersion(this.state.latestVersion)
    }
    this.setState({
      ...this.state,
      dismissed: true,
      manual: false,
    })
    return this.getState()
  }

  handleError(error, forceVisible = false) {
    const detail = error instanceof Error ? error.message : String(error)
    this.logger.error?.('StatsKey update error:', detail)
    if (!this.manualCheck && !forceVisible) {
      this.setState({
        status: 'idle',
        manual: false,
        dismissed: false,
        message: undefined,
      })
      return
    }
    this.setState({
      status: 'error',
      manual: true,
      dismissed: false,
      message: 'StatsKey could not complete the update. Try again shortly.',
    })
  }

  setState(patch) {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: this.currentVersion,
    }
    this.publishState(this.getState())
  }
}

function updateFeedUrl(root, platform, arch) {
  if (
    typeof root !== 'string' ||
    !root.startsWith('https://storage.googleapis.com/')
  ) {
    return null
  }
  if (!SUPPORTED_PLATFORMS.has(platform)) return null
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `${root.replace(/\/+$/, '')}/mac-${arch}`
  }
  if (platform === 'win32' && arch === 'x64') {
    return `${root.replace(/\/+$/, '')}/win-x64`
  }
  return null
}

function desktopHealthPayload({
  rendererReady,
  currentVersion,
  platform,
  arch,
  feedRoot,
}) {
  return {
    status: rendererReady === true ? 'ready' : 'starting',
    version: safeVersion(currentVersion) || '0.0.0',
    architecture: arch,
    updateFeed: updateFeedUrl(feedRoot, platform, arch),
  }
}

function safeVersion(value) {
  if (typeof value !== 'string') return null
  const version = value.trim()
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)
    ? version.slice(0, 64)
    : null
}

function safeDate(value) {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

function safeByteCount(value) {
  return Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function safeReleaseNotes(value) {
  const rawNotes = []
  if (typeof value === 'string') {
    rawNotes.push(...value.split(/\r?\n/))
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') rawNotes.push(entry)
      else if (entry && typeof entry.note === 'string') {
        rawNotes.push(...entry.note.split(/\r?\n/))
      }
    }
  }
  const notes = []
  for (const raw of rawNotes) {
    const note = raw
      .replace(/<[^>]*>/g, ' ')
      .replace(/^\s*[-*•]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)
    if (!note || notes.includes(note)) continue
    notes.push(note)
    if (notes.length === 6) break
  }
  return notes.length > 0 ? notes : undefined
}

function clampPercent(value) {
  return Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value * 10) / 10))
    : 0
}

module.exports = {
  DesktopUpdateRuntime,
  desktopHealthPayload,
  updateFeedUrl,
  safeVersion,
  _test: {
    clampPercent,
    safeByteCount,
    safeDate,
    safeReleaseNotes,
  },
}
