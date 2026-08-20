const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  FounderRuntime,
  defaultFounderConfiguration,
  quotePosixArgument,
  storageStatus,
  validateFounderConfiguration,
} = require('./founder-runtime.cjs')

function portablePath(value) {
  return value.replaceAll(path.sep, '/')
}

test('founder defaults contain only explicit local infrastructure endpoints', () => {
  const configuration = defaultFounderConfiguration('/Users/founder')
  validateFounderConfiguration(configuration)
  assert.equal(configuration.trueNas.host, '192.168.3.55')
  assert.equal(configuration.idrac.host, '192.168.3.56')
  assert.equal(configuration.macMini.host, 'ryans-mac-mini.local')
  assert.equal(configuration.gpu.host, '')
  assert.equal(
    portablePath(configuration.macRemote.configPath),
    '/Users/founder/Library/Application Support/MacRemote/config.json'
  )
})

test('founder configuration rejects embedded credentials and host pivots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'statskey-founder-'))
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(
      path.join(directory, 'founder-config.json'),
      JSON.stringify({
        trueNas: {
          password: 'must-never-live-here',
        },
      })
    )
    const runtime = new FounderRuntime({
      homeDirectory: '/Users/founder',
      userDataDirectory: directory,
    })
    assert.throws(
      () => runtime.configuration(),
      /must not contain passwords/
    )

    const configuration = defaultFounderConfiguration('/Users/founder')
    configuration.trueNas.webUrl = 'https://example.com'
    assert.throws(
      () => validateFounderConfiguration(configuration),
      /outside its configured host/
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('founder actions open only fixed configured destinations', async () => {
  const opened = []
  const runtime = new FounderRuntime({
    homeDirectory: '/Users/founder',
    platform: 'darwin',
    openExternal: async (url) => opened.push(url),
  })
  assert.deepEqual(await runtime.perform('open-truenas'), { ok: true })
  assert.deepEqual(await runtime.perform('open-idrac'), { ok: true })
  assert.deepEqual(await runtime.perform('mount-oil-share'), { ok: true })
  assert.deepEqual(opened, [
    'http://192.168.3.55',
    'https://192.168.3.56',
    'smb://192.168.3.55/StatsKey-Oil',
  ])
  assert.equal((await runtime.perform('run-anything')).ok, false)
})

test('oil diagnostic executes the fixed storage module with NAS environment', async () => {
  let invocation = null
  const fileSystem = {
    existsSync(candidate) {
      return !candidate.endsWith('founder-config.json')
    },
  }
  const runtime = new FounderRuntime({
    homeDirectory: '/Users/founder',
    fileSystem,
    runProcess: async (options) => {
      invocation = options
      return { ok: true, exitCode: 0, stdout: '{}', stderr: '' }
    },
  })
  const result = await runtime.runCheck('oil-storage')
  assert.equal(result.ok, true)
  assert.equal(
    portablePath(invocation.executable),
    '/Users/founder/Projects/Oil Data/oilfield-pipeline/.venv/bin/python'
  )
  assert.deepEqual(invocation.args, [
    '-m',
    'oilpipe.storage',
    'check',
    '--json',
  ])
  assert.equal(invocation.env.OILPIPE_DATA_DIR, '/Volumes/StatsKey-Oil')
  assert.equal(
    portablePath(invocation.env.PYTHONPATH),
    '/Users/founder/Projects/Oil Data/oilfield-pipeline/src'
  )
})

test('MacRemote connectivity executes only the fixed encrypted SSH probe', async () => {
  let invocation = null
  const runtime = new FounderRuntime({
    homeDirectory: '/Users/founder',
    fileSystem: {
      existsSync(candidate) {
        return !candidate.endsWith('founder-config.json')
      },
    },
    runProcess: async (options) => {
      invocation = options
      return { ok: true, exitCode: 0, stdout: '', stderr: '' }
    },
  })
  const result = await runtime.runCheck('macremote-connectivity')
  assert.equal(result.ok, true)
  assert.equal(
    portablePath(invocation.executable),
    '/Users/founder/Projects/MacRemote/.build/release/macremote'
  )
  assert.deepEqual(invocation.args.map(portablePath), [
    'ssh',
    '/Users/founder/Library/Application Support/MacRemote/config.json',
    '--',
    '/usr/bin/true',
  ])
  assert.equal(invocation.timeoutMilliseconds, 45_000)
})

test('storage reserve requires at least twenty percent free', () => {
  const fileSystem = {
    statSync() {
      return { isDirectory: () => true }
    },
    statfsSync() {
      return { blocks: 1_000, bavail: 199, bsize: 1_024 }
    },
  }
  assert.equal(storageStatus('/Volumes/lake', fileSystem).reserveHealthy, false)
  fileSystem.statfsSync = () => ({ blocks: 1_000, bavail: 200, bsize: 1_024 })
  assert.equal(storageStatus('/Volumes/lake', fileSystem).reserveHealthy, true)
})

test('MacRemote shell command quotes paths without exposing a shell pivot', () => {
  assert.equal(
    quotePosixArgument("/Users/founder's Tools/macremote"),
    `'/Users/founder'"'"'s Tools/macremote'`
  )
})
