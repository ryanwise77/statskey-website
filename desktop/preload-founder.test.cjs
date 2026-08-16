const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

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

test('ordinary desktop preload does not expose Founder operations', () => {
  const { bridge } = loadPreload([])
  assert.equal(bridge.founderMode, false)
  assert.equal(bridge.founderBuild, false)
  assert.equal(bridge.founder, undefined)
})

test('unified Desktop exposes fixed Founder controls without changing editions', async () => {
  const { bridge, calls } = loadPreload(['--statskey-founder'])
  assert.equal(bridge.founderMode, true)
  assert.equal(bridge.founderBuild, false)

  await bridge.founder.state()
  await bridge.founder.runCheck('oil-storage')
  await bridge.founder.runCheck('macremote-connectivity')
  await bridge.founder.perform('start-mac-ssh')
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['statskey-desktop:founder-state'],
    ['statskey-desktop:founder-check', 'oil-storage'],
    ['statskey-desktop:founder-check', 'macremote-connectivity'],
    ['statskey-desktop:founder-action', 'start-mac-ssh'],
  ])

  const before = calls.length
  assert.equal((await bridge.founder.runCheck('shell')).ok, false)
  assert.equal((await bridge.founder.perform('rm-everything')).ok, false)
  assert.equal(calls.length, before)
})

test('isolated Founder build remains identifiable for compatibility', () => {
  const { bridge } = loadPreload([
    '--statskey-founder',
    '--statskey-founder-build',
  ])
  assert.equal(bridge.founderMode, true)
  assert.equal(bridge.founderBuild, true)
})
