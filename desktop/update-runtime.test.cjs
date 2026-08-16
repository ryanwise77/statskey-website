const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  DesktopUpdateRuntime,
  updateFeedUrl,
  safeVersion,
} = require('./update-runtime.cjs')

class FakeUpdater extends EventEmitter {
  constructor() {
    super()
    this.feed = null
    this.installed = false
  }

  setFeedURL(feed) {
    this.feed = feed
  }

  async checkForUpdates() {
    this.emit('checking-for-update')
    this.emit('update-available', {
      version: '0.8.1',
      releaseDate: '2026-08-07T01:00:00.000Z',
      releaseNotes:
        '- Simulator Lab can exercise iOS and Android apps.\n' +
        '- Completed work now includes a proof summary.',
    })
  }

  async downloadUpdate() {
    this.emit('download-progress', {
      percent: 43.27,
      transferred: 430,
      total: 1000,
    })
    this.emit('update-downloaded', {
      version: '0.8.1',
      releaseDate: '2026-08-07T01:00:00.000Z',
    })
  }

  quitAndInstall() {
    this.installed = true
  }
}

test('architecture-specific feeds stay on the trusted HTTPS bucket', () => {
  const root =
    'https://storage.googleapis.com/statskey-workbench-downloads/updates'
  assert.equal(
    updateFeedUrl(root, 'darwin', 'arm64'),
    `${root}/mac-arm64`
  )
  assert.equal(updateFeedUrl(root, 'darwin', 'x64'), `${root}/mac-x64`)
  assert.equal(updateFeedUrl(root, 'win32', 'x64'), `${root}/win-x64`)
  assert.equal(updateFeedUrl('http://example.com', 'darwin', 'arm64'), null)
  assert.equal(updateFeedUrl(root, 'linux', 'x64'), null)
  assert.equal(safeVersion('../../bad'), null)
})

test('manual checks expose an available update and remember Later', async () => {
  const updater = new FakeUpdater()
  let dismissedVersion = null
  const states = []
  const runtime = new DesktopUpdateRuntime({
    updater,
    currentVersion: '0.8.0',
    platform: 'darwin',
    arch: 'arm64',
    isPackaged: true,
    feedRoot:
      'https://storage.googleapis.com/statskey-workbench-downloads/updates',
    publishState: (state) => states.push(state),
    getDismissedVersion: () => dismissedVersion,
    setDismissedVersion: (value) => {
      dismissedVersion = value
    },
    logger: { error() {} },
  })

  runtime.initialize()
  await runtime.check(true)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.disableWebInstaller, true)
  assert.deepEqual(updater.feed, {
    provider: 'generic',
    url:
      'https://storage.googleapis.com/' +
      'statskey-workbench-downloads/updates/mac-arm64',
    useMultipleRangeRequest: false,
  })
  assert.equal(runtime.getState().status, 'available')
  assert.equal(runtime.getState().latestVersion, '0.8.1')
  assert.deepEqual(runtime.getState().releaseNotes, [
    'Simulator Lab can exercise iOS and Android apps.',
    'Completed work now includes a proof summary.',
  ])
  assert.equal(runtime.getState().manual, true)
  runtime.dismiss()
  assert.equal(dismissedVersion, '0.8.1')
  assert.equal(runtime.getState().dismissed, true)
  assert.ok(states.length >= 3)
})

test('downloads report progress, notify quietly, and install on request', async () => {
  const updater = new FakeUpdater()
  const notifications = []
  const runtime = new DesktopUpdateRuntime({
    updater,
    currentVersion: '0.8.0',
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
    feedRoot:
      'https://storage.googleapis.com/statskey-workbench-downloads/updates',
    notifyDownloaded: (version) => notifications.push(version),
    logger: { error() {} },
  })

  runtime.initialize()
  await runtime.check(true)
  await runtime.download()
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.equal(runtime.getState().status, 'downloaded')
  assert.equal(runtime.getState().percent, 100)
  assert.equal(runtime.getState().releaseNotes?.length, 2)
  assert.deepEqual(notifications, ['0.8.1'])
  assert.equal(runtime.install(), true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(updater.installed, true)
})

test('automatic checks download the update in the background', async () => {
  const updater = new FakeUpdater()
  const notifications = []
  const runtime = new DesktopUpdateRuntime({
    updater,
    currentVersion: '0.8.0',
    platform: 'darwin',
    arch: 'arm64',
    isPackaged: true,
    feedRoot:
      'https://storage.googleapis.com/statskey-workbench-downloads/updates',
    notifyDownloaded: (version) => notifications.push(version),
    logger: { error() {} },
  })

  runtime.initialize()
  await runtime.check(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.getState().status, 'downloaded')
  assert.equal(runtime.getState().latestVersion, '0.8.1')
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.deepEqual(notifications, ['0.8.1'])
})

test('dismissed updates are not downloaded automatically', async () => {
  const updater = new FakeUpdater()
  let dismissedVersion = '0.8.1'
  const runtime = new DesktopUpdateRuntime({
    updater,
    currentVersion: '0.8.0',
    platform: 'darwin',
    arch: 'arm64',
    isPackaged: true,
    feedRoot:
      'https://storage.googleapis.com/statskey-workbench-downloads/updates',
    getDismissedVersion: () => dismissedVersion,
    setDismissedVersion: (value) => {
      dismissedVersion = value
    },
    logger: { error() {} },
  })

  runtime.initialize()
  await runtime.check(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.getState().status, 'available')
  assert.equal(runtime.getState().dismissed, true)
  assert.equal(dismissedVersion, '0.8.1')
})

test('a dismissed version does not wedge checks: a newer release still surfaces', async () => {
  const updater = new FakeUpdater()
  let latestVersion = '1.2.3'
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update')
    updater.emit('update-available', { version: latestVersion })
  }
  updater.downloadUpdate = async () => {
    updater.emit('update-downloaded', { version: latestVersion })
  }
  let dismissedVersion = '1.2.3'
  const runtime = new DesktopUpdateRuntime({
    updater,
    currentVersion: '1.2.0',
    platform: 'darwin',
    arch: 'arm64',
    isPackaged: true,
    feedRoot:
      'https://storage.googleapis.com/statskey-workbench-downloads/updates',
    getDismissedVersion: () => dismissedVersion,
    setDismissedVersion: (value) => {
      dismissedVersion = value
    },
    logger: { error() {} },
  })

  runtime.initialize()
  await runtime.check(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.getState().status, 'available')
  assert.equal(runtime.getState().dismissed, true)

  latestVersion = '1.2.4'
  await runtime.check(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.getState().status, 'downloaded')
  assert.equal(runtime.getState().latestVersion, '1.2.4')
  assert.equal(runtime.getState().dismissed, false)
})

test('failed automatic downloads stay quiet', async () => {
  const updater = new FakeUpdater()
  updater.downloadUpdate = async () => {
    throw new Error('bucket unreachable')
  }
  const runtime = new DesktopUpdateRuntime({
    updater,
    currentVersion: '0.8.0',
    platform: 'darwin',
    arch: 'arm64',
    isPackaged: true,
    feedRoot:
      'https://storage.googleapis.com/statskey-workbench-downloads/updates',
    logger: { error() {} },
  })

  runtime.initialize()
  await runtime.check(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.getState().status, 'idle')
  assert.equal(runtime.getState().message, undefined)
})

test('release notes are plain, bounded, and safe to render', () => {
  const { safeReleaseNotes } = require('./update-runtime.cjs')._test
  assert.deepEqual(
    safeReleaseNotes([
      { note: '<b>Visible</b> improvement' },
      { note: '- Visible improvement' },
      { note: '* A second improvement' },
      { note: '' },
    ]),
    ['Visible improvement', 'A second improvement']
  )
  assert.equal(safeReleaseNotes({ note: 'not accepted' }), undefined)
})

test('background failures stay quiet while manual failures are visible', async () => {
  const updater = new FakeUpdater()
  updater.checkForUpdates = async () => {
    throw new Error('offline')
  }
  const runtime = new DesktopUpdateRuntime({
    updater,
    currentVersion: '0.8.0',
    platform: 'darwin',
    arch: 'x64',
    isPackaged: true,
    feedRoot:
      'https://storage.googleapis.com/statskey-workbench-downloads/updates',
    logger: { error() {} },
  })

  runtime.initialize()
  await runtime.check(false)
  assert.equal(runtime.getState().status, 'idle')
  await runtime.check(true)
  assert.equal(runtime.getState().status, 'error')
  assert.match(runtime.getState().message, /could not complete/)
})
