const assert = require('node:assert/strict')
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const {
  assertPublicDesktopBundle,
} = require('./public-release-boundary.cjs')
const afterPack = require('./after-pack.cjs')

function loadPreload(argv = [], { platform = 'darwin', env = {} } = {}) {
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
    Buffer,
    console,
    process: {
      platform,
      versions: { electron: '43.2.0' },
      env,
      argv,
    },
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
  return { bridge, calls }
}

test('desktop preload does not expose internal infrastructure operations', () => {
  const { bridge } = loadPreload([])
  assert.equal(Object.hasOwn(bridge, 'founderMode'), false)
  assert.equal(Object.hasOwn(bridge, 'founderBuild'), false)
  assert.equal(Object.hasOwn(bridge, 'founder'), false)
})

test('legacy command-line arguments cannot reactivate removed operations', () => {
  const { bridge, calls } = loadPreload([
    '--statskey-founder',
    '--statskey-founder-build',
  ])
  assert.equal(Object.hasOwn(bridge, 'founderMode'), false)
  assert.equal(Object.hasOwn(bridge, 'founderBuild'), false)
  assert.equal(Object.hasOwn(bridge, 'founder'), false)
  assert.deepEqual(calls, [])
})

test('Ubuntu preload reports Linux and the bash fallback accurately', () => {
  const { bridge } = loadPreload([], { platform: 'linux', env: {} })
  assert.equal(bridge.platform, 'linux')
  assert.equal(bridge.terminalShell.kind, 'posix')
  assert.equal(bridge.terminalShell.executable, 'bash')
})

test('fleet preload exposes bounded identity operations without private keys', async () => {
  const { bridge, calls } = loadPreload([])
  const profile = {
    label: 'Mac mini',
    role: 'worker',
    workerMode: 'dedicated',
    platform: 'darwin',
    maxConcurrentJobs: 2,
  }
  await bridge.fleet.ensureIdentity(profile)
  await bridge.fleet.identityState()
  await bridge.fleet.replaceIdentity()
  await bridge.fleet.createControllerRecovery({
    ownerUid: 'owner-123',
    expectedControllerDeviceId: `dev_${'a'.repeat(32)}`,
  })
  await bridge.fleet.createLocalGrant({
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/statskey/website'],
    capabilities: ['xcode.test'],
    unattended: true,
    expiresAt: '2026-09-19T00:00:00.000Z',
    policyVersion: 1,
  })
  await bridge.fleet.authorizeJob({
    workspaceId: 'statskey-website',
    type: 'command',
    objective: 'Run tests.',
    workspaceSnapshot: {
      kind: 'git',
      repository: 'statskey/website',
      commit: 'a'.repeat(40),
    },
    requiredCapabilities: [
      'workspace.read',
      'workspace.snapshot',
      'terminal.run',
    ],
    deadlineAt: Date.now() + 60_000,
    idempotencyKey: 'fleet-test:authorize',
  })
  await bridge.fleet.downloadArtifact({
    artifactId: `artifact_${'a'.repeat(32)}`,
    url:
      'https://storage.googleapis.com/fleet-test/object' +
      '?X-Goog-Signature=abc123',
    expiresAt: '2026-08-19T01:10:00.000Z',
  })
  await bridge.fleet.listRetainedArtifacts()
  await bridge.fleet.revealRetainedArtifact({
    spoolId: `job_${'a'.repeat(32)}-lease_${'b'.repeat(32)}`,
    kind: 'xcresult',
  })
  await bridge.fleet.purgeRetainedArtifact({
    spoolId: `job_${'a'.repeat(32)}-lease_${'b'.repeat(32)}`,
  })
  assert.equal(
    JSON.stringify(calls[0]),
    JSON.stringify(['statskey-desktop:fleet-identity-ensure', profile])
  )
  assert.equal(
    JSON.stringify(calls[1]),
    JSON.stringify(['statskey-desktop:fleet-identity-state'])
  )
  assert.equal(
    calls[2][0],
    'statskey-desktop:fleet-identity-replace'
  )
  assert.equal(
    calls[3][0],
    'statskey-desktop:fleet-controller-recovery-create'
  )
  assert.equal(calls[4][0], 'statskey-desktop:fleet-local-grant-create')
  assert.equal(calls[5][0], 'statskey-desktop:fleet-job-authorize')
  assert.equal(calls[6][0], 'statskey-desktop:fleet-artifact-download')
  assert.equal(calls[7][0], 'statskey-desktop:fleet-artifact-spool-list')
  assert.equal(calls[8][0], 'statskey-desktop:fleet-artifact-spool-reveal')
  assert.equal(calls[9][0], 'statskey-desktop:fleet-artifact-spool-purge')
  const before = calls.length
  assert.equal(await bridge.fleet.signPairing({}, 'shell.run'), null)
  assert.equal(calls.length, before)
  assert.equal(JSON.stringify(bridge.fleet).includes('privateKey'), false)
})

test('workspace sync preload preserves ownership and pause state', async () => {
  const { bridge, calls } = loadPreload([])
  await bridge.workspaceSync.saveState('sync-123', {
    syncId: 'sync-123',
    name: 'Shared workspace',
    ownerUid: 'owner-123',
    paused: true,
    rootMappings: [{ rootId: 'root', path: '/safe/root' }],
    lastSynced: {},
  })
  const saved = calls.at(-1)[2]
  assert.equal(saved.ownerUid, 'owner-123')
  assert.equal(saved.paused, true)
})

test('public release boundary rejects internal content and route chunks', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-public-boundary-'))
  const archivePath = path.join(directory, 'app.asar')
  const webRoot = path.join(directory, 'web')
  mkdirSync(path.join(webRoot, 'assets'), { recursive: true })
  writeFileSync(archivePath, 'ordinary desktop application')
  writeFileSync(
    path.join(webRoot, 'assets', 'desktopApp-safe.js'),
    'console.log("StatsKey")'
  )
  assert.doesNotThrow(() =>
    assertPublicDesktopBundle({ appArchivePath: archivePath, webRoot })
  )

  writeFileSync(archivePath, 'ordinary application with Founder Console')
  assert.throws(
    () => assertPublicDesktopBundle({ appArchivePath: archivePath, webRoot }),
    /internal-only content/
  )

  writeFileSync(archivePath, 'ordinary desktop application')
  writeFileSync(
    path.join(webRoot, 'assets', 'FounderConsole-old.js'),
    'unused'
  )
  assert.throws(
    () => assertPublicDesktopBundle({ appArchivePath: archivePath, webRoot }),
    /internal-only path/
  )

  rmSync(path.join(webRoot, 'assets', 'FounderConsole-old.js'))
  writeFileSync(
    path.join(webRoot, 'assets', 'Flow.js'),
    'function remoteAgentPrompt() { return "Use the configured MacRemote project" }'
  )
  assert.throws(
    () => assertPublicDesktopBundle({ appArchivePath: archivePath, webRoot }),
    /internal-only content/
  )

  rmSync(path.join(webRoot, 'assets', 'Flow.js'))
  writeFileSync(
    path.join(webRoot, 'assets', 'RemoteAccess-old.js'),
    'unused'
  )
  assert.throws(
    () => assertPublicDesktopBundle({ appArchivePath: archivePath, webRoot }),
    /internal-only path/
  )

  if (process.platform !== 'win32') {
    rmSync(path.join(webRoot, 'assets', 'RemoteAccess-old.js'))
    symlinkSync(
      path.join(webRoot, 'assets', 'desktopApp-safe.js'),
      path.join(webRoot, 'assets', 'linked.js')
    )
    assert.throws(
      () => assertPublicDesktopBundle({ appArchivePath: archivePath, webRoot }),
      /non-regular path/
    )
  }
})

test('afterPack enforces the public release boundary', async () => {
  const appOutDir = mkdtempSync(path.join(tmpdir(), 'statskey-after-pack-'))
  const resources = path.join(
    appOutDir,
    'StatsKey.app',
    'Contents',
    'Resources'
  )
  const webRoot = path.join(resources, 'web')
  mkdirSync(path.join(webRoot, 'assets'), { recursive: true })
  writeFileSync(path.join(webRoot, 'assets', 'desktopApp-safe.js'), 'StatsKey')
  writeFileSync(path.join(resources, 'app.asar'), 'Founder Console')

  const context = {
    appOutDir,
    arch: 'arm64',
    electronPlatformName: 'darwin',
    packager: { appInfo: { productFilename: 'StatsKey' } },
  }
  await assert.rejects(afterPack(context), /internal-only content/)

  writeFileSync(path.join(resources, 'app.asar'), 'ordinary desktop application')
  await assert.doesNotReject(afterPack(context))
})

test('afterPack validates Linux resources and retains only linux-x64 node-pty', async () => {
  const appOutDir = mkdtempSync(path.join(tmpdir(), 'statskey-after-pack-linux-'))
  const resources = path.join(appOutDir, 'resources')
  const webRoot = path.join(resources, 'web')
  const prebuilds = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds'
  )
  for (const platform of ['darwin-arm64', 'linux-x64', 'win32-x64']) {
    mkdirSync(path.join(prebuilds, platform), { recursive: true })
    writeFileSync(path.join(prebuilds, platform, 'spawn-helper'), 'helper')
  }
  const localNativeBuild = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'build',
    'Release'
  )
  mkdirSync(localNativeBuild, { recursive: true })
  writeFileSync(path.join(localNativeBuild, 'pty.node'), 'host binary')
  mkdirSync(path.join(webRoot, 'assets'), { recursive: true })
  writeFileSync(path.join(webRoot, 'assets', 'desktopApp-safe.js'), 'StatsKey')
  writeFileSync(path.join(resources, 'app.asar'), 'ordinary desktop application')

  await assert.doesNotReject(
    afterPack({
      appOutDir,
      arch: 'x64',
      electronPlatformName: 'linux',
      packager: { appInfo: { productFilename: 'StatsKey' } },
    })
  )
  assert.deepEqual(readdirSync(prebuilds), ['linux-x64'])
  assert.equal(
    existsSync(
      path.join(
        resources,
        'app.asar.unpacked',
        'node_modules',
        'node-pty',
        'build'
      )
    ),
    false
  )
  assert.equal(
    statSync(path.join(prebuilds, 'linux-x64', 'spawn-helper')).mode & 0o777,
    0o755
  )
})
