const assert = require('node:assert/strict')
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const {
  assertPublicDesktopBundle,
} = require('./public-release-boundary.cjs')

function loadPreload(argv = []) {
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
    process: {
      platform: 'darwin',
      versions: { electron: '43.2.0' },
      env: {},
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
})
