'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs/promises')
const { createHmac } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const {
  boundedArtifactDirectory,
  CommandFleetAdapter,
  createFleetWorkerAdapters,
  createProcessRunner,
  directExecutableExtensions,
  FleetLeaseAuthorityStore,
  GitSnapshotMaterializer,
  kernelBackedFleetProcessContainment,
  listArtifactSpool,
  purgeArtifactSpoolEntry,
  revealArtifactSpoolEntry,
  XcodeFleetAdapter,
  repositoryUrl,
  safeWorkspacePath,
  unpackedDesktopResource,
  windowsProcessOwnerInvocation,
  workerEnvironment,
} = require('./fleet-worker-adapters.cjs')

const JOB_ID = `job_${'a'.repeat(40)}`
const LEASE_ID = `lease_${'b'.repeat(32)}`
const COMMIT = 'c'.repeat(40)

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'statskey-fleet-worker-'))
}

function context(overrides = {}) {
  const events = []
  const value = {
    job: {
      id: JOB_ID,
      type: 'xcode-test',
      workspaceSnapshot: {
        kind: 'git',
        repository: 'statskey/website',
        commit: COMMIT,
      },
      execution: {
        kind: 'xcode',
        containerKind: 'project',
        containerPath: 'biometrics/StatsKey.xcodeproj',
        scheme: 'StatsKey',
        destination: 'platform=iOS Simulator,name=iPhone 17 Pro',
        onlyTesting: ['StatsKeyTests/ActivityHistoryStabilityTests'],
        timeoutMs: 60_000,
      },
      cage: { enabled: false },
    },
    lease: { id: LEASE_ID, attempt: 1 },
    signal: new AbortController().signal,
    now: () => 1_000,
    async emit(type, payload) {
      events.push({ type, payload })
    },
    ...overrides,
  }
  return { context: value, events }
}

test('repository URLs are allowlisted and cannot carry credentials', () => {
  assert.deepEqual(
    repositoryUrl('statskey/website'),
    'https://github.com/statskey/website.git'
  )
  assert.equal(
    repositoryUrl('git@github.com:statskey/website.git'),
    'git@github.com:statskey/website.git'
  )
  assert.equal(
    repositoryUrl('github.com/statskey/website'),
    'https://github.com/statskey/website.git'
  )
  for (const candidate of [
    'https://user:secret@github.com/statskey/website.git',
    'https://github.com/statskey/website.git?token=secret',
    'https://example.test/statskey/website.git',
    'https://github.com/evil/%2e%2e/statskey/website',
    'https://github.com/evil/../statskey/website',
    'https://github.com/evil\\..\\statskey\\website',
    'https://github.com/statskey/\twebsite',
    '/Users/me/project',
  ]) {
    assert.throws(() => repositoryUrl(candidate), {
      code: 'invalid_snapshot',
    })
  }
})

test('snapshot materialization fetches and verifies one exact commit', async () => {
  const root = await temporaryDirectory()
  const calls = []
  try {
    const materializer = new GitSnapshotMaterializer({
      workRoot: root,
      processRunner: async (request) => {
        calls.push(request)
        if (request.args.at(-1) === 'HEAD') {
          return { ok: true, stdout: `${COMMIT}\n`, stderr: '', exitCode: 0 }
        }
        if (request.args.includes('remote') && request.args.length === 3) {
          return { ok: true, stdout: '', stderr: '', exitCode: 0 }
        }
        return { ok: true, stdout: '', stderr: '', exitCode: 0 }
      },
    })
    const result = await materializer.materialize(
      context().context.job,
      { id: LEASE_ID },
      new AbortController().signal
    )
    assert.equal(result.commit, COMMIT)
    assert.equal(
      calls.every(
        ({ environmentOverrides }) =>
          environmentOverrides.HOME ===
            path.join(result.workspace, '.statskey-runtime', 'home') &&
          environmentOverrides.TMPDIR ===
            path.join(result.workspace, '.statskey-runtime', 'tmp') &&
          environmentOverrides.USERPROFILE ===
            path.join(result.workspace, '.statskey-runtime', 'home')
      ),
      true
    )
    await materializer.cleanup(context().context.job, { id: LEASE_ID })
    await assert.rejects(() => fs.lstat(result.workspace), { code: 'ENOENT' })
    assert.equal(calls.every(({ executable }) => executable === 'git'), true)
    assert.equal(calls.some(({ args }) => args.includes('--depth=1')), true)
    assert.equal(
      calls.some(({ args }) =>
        args.includes('https://github.com/statskey/website.git')
      ),
      true
    )
    assert.equal(JSON.stringify(calls).includes('sh -c'), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('materialization rejects a pre-positioned workspace symlink', async () => {
  const root = await temporaryDirectory()
  const outside = await temporaryDirectory()
  try {
    await fs.symlink(outside, path.join(root, `${JOB_ID}-${LEASE_ID}`))
    const materializer = new GitSnapshotMaterializer({
      workRoot: root,
      processRunner: async () => {
        throw new Error('must not execute')
      },
    })
    await assert.rejects(
      () =>
        materializer.materialize(
          context().context.job,
          { id: LEASE_ID },
          new AbortController().signal
        ),
      { code: 'unsafe_workspace_path' }
    )
    await assert.rejects(
      () => fs.lstat(path.join(root, `${JOB_ID}-${LEASE_ID}`)),
      { code: 'ENOENT' }
    )
    assert.equal((await fs.lstat(outside)).isDirectory(), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('snapshot verification rejects a longer hash sharing the requested prefix', async () => {
  const root = await temporaryDirectory()
  try {
    const materializer = new GitSnapshotMaterializer({
      workRoot: root,
      processRunner: async (request) => ({
        ok: true,
        exitCode: 0,
        stdout: request.args.at(-1) === 'HEAD' ? `${COMMIT}${'d'.repeat(24)}\n` : '',
        stderr: '',
      }),
    })
    const harness = context()
    await assert.rejects(
      () =>
        materializer.materialize(
          harness.context.job,
          harness.context.lease,
          harness.context.signal
        ),
      { code: 'snapshot_mismatch' }
    )
    await assert.rejects(
      fs.lstat(materializer.workspacePath(harness.context.job, harness.context.lease)),
      { code: 'ENOENT' }
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('snapshot materialization removes partial work after a Git failure', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, `${JOB_ID}-${LEASE_ID}`)
  try {
    const materializer = new GitSnapshotMaterializer({
      workRoot: root,
      processRunner: async (request) => {
        if (request.args.includes('fetch')) {
          const error = new Error('network failed')
          error.code = 'offline'
          throw error
        }
        return { ok: true, stdout: '', stderr: '', exitCode: 0 }
      },
    })
    await assert.rejects(() =>
      materializer.materialize(
        context().context.job,
        { id: LEASE_ID },
        new AbortController().signal
      )
    )
    await assert.rejects(() => fs.lstat(workspace), { code: 'ENOENT' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('snapshot materialization retains work after unconfirmed Git termination', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, `${JOB_ID}-${LEASE_ID}`)
  try {
    const materializer = new GitSnapshotMaterializer({
      workRoot: root,
      processRunner: async () => {
        const error = new Error('Git termination is unknown.')
        error.code = 'snapshot_materialization_failed'
        error.result = { terminationConfirmed: false }
        throw error
      },
    })
    await assert.rejects(
      () =>
        materializer.materialize(
          context().context.job,
          { id: LEASE_ID },
          new AbortController().signal
        ),
      (error) => error.result?.terminationConfirmed === false
    )
    assert.equal((await fs.lstat(workspace)).isDirectory(), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('stale worker snapshots are pruned without touching recent work', async () => {
  const root = await temporaryDirectory()
  const oldName = `job_${'d'.repeat(40)}-lease_${'e'.repeat(32)}`
  const recentName = `job_${'f'.repeat(40)}-lease_${'1'.repeat(32)}`
  try {
    const oldPath = path.join(root, oldName)
    const recentPath = path.join(root, recentName)
    await fs.mkdir(oldPath)
    await fs.mkdir(recentPath)
    const now = Date.parse('2026-08-19T08:00:00.000Z')
    const oldTime = new Date(now - 25 * 60 * 60 * 1000)
    await fs.utimes(oldPath, oldTime, oldTime)
    const materializer = new GitSnapshotMaterializer({
      workRoot: root,
      processRunner: async () => {
        throw new Error('must not execute')
      },
    })
    await materializer.pruneStale(now)
    await assert.rejects(() => fs.lstat(oldPath), { code: 'ENOENT' })
    assert.equal((await fs.lstat(recentPath)).isDirectory(), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Xcode adapter uses fixed argv and emits no process output', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, 'workspace')
  const container = path.join(workspace, 'biometrics', 'StatsKey.xcodeproj')
  const calls = []
  try {
    await fs.mkdir(container, { recursive: true })
    const materializer = {
      async materialize() {
        return { workspace, commit: COMMIT }
      },
    }
    const adapter = new XcodeFleetAdapter({
      materializer,
      platform: 'darwin',
      processRunner: async (request) => {
        calls.push(request)
        return {
          ok: true,
          exitCode: 0,
          stdout: 'provider-key-should-stay-local',
          stderr: '',
        }
      },
    })
    let now = 1_000
    const harness = context({
      now: () => {
        now += 250
        return now
      },
    })
    await adapter.prepare(harness.context)
    const result = await adapter.run(harness.context)
    assert.equal(result.action, 'test')
    assert.equal(calls[0].executable, 'xcodebuild')
    assert.deepEqual(calls[0].args.slice(0, 6), [
      '-project',
      await fs.realpath(container),
      '-scheme',
      'StatsKey',
      '-configuration',
      'Debug',
    ])
    assert.equal(
      calls[0].args.includes(
        '-only-testing:StatsKeyTests/ActivityHistoryStabilityTests'
      ),
      true
    )
    const derivedDataIndex = calls[0].args.indexOf('-derivedDataPath')
    assert.ok(derivedDataIndex > 0)
    assert.equal(
      calls[0].args[derivedDataIndex + 1].startsWith(
        path.join(await fs.realpath(workspace), '.statskey-results')
      ),
      true
    )
    assert.equal(
      JSON.stringify(harness.events).includes('provider-key-should-stay-local'),
      false
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Xcode adapter packages and publishes retained result evidence', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, 'workspace')
  const container = path.join(workspace, 'biometrics', 'StatsKey.xcodeproj')
  const calls = []
  const published = []
  try {
    await fs.mkdir(container, { recursive: true })
    const adapter = new XcodeFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace, commit: COMMIT }
        },
      },
      platform: 'darwin',
      xcodeExecutable: '/usr/bin/xcodebuild',
      archiveExecutable: '/usr/bin/ditto',
      processRunner: async (request) => {
        calls.push(request)
        if (request.executable === '/usr/bin/xcodebuild') {
          const index = request.args.indexOf('-resultBundlePath')
          await fs.mkdir(request.args[index + 1], { recursive: true })
        } else {
          await fs.writeFile(request.args.at(-1), 'zipped evidence')
        }
        return { ok: true, exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const harness = context({
      async publishArtifact(input) {
        published.push(input)
        return {
          id: `artifact_${'d'.repeat(32)}`,
          kind: input.kind,
          contentHash: 'e'.repeat(64),
          sizeBytes: 15,
        }
      },
    })
    await adapter.prepare(harness.context)
    const result = await adapter.run(harness.context)

    assert.equal(calls.length, 2)
    assert.equal(calls[1].executable, '/usr/bin/ditto')
    assert.deepEqual(calls[1].args.slice(0, 4), [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
    ])
    assert.equal(published[0].kind, 'xcresult')
    assert.equal(published[0].mediaType, 'application/zip')
    assert.equal(result.resultBundle, `artifact_${'d'.repeat(32)}`)
    assert.equal(result.artifacts.length, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('artifact publication failure does not duplicate Xcode exit evidence', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, 'workspace')
  const container = path.join(workspace, 'biometrics', 'StatsKey.xcodeproj')
  const calls = []
  try {
    await fs.mkdir(container, { recursive: true })
    const adapter = new XcodeFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace, commit: COMMIT }
        },
      },
      platform: 'darwin',
      processRunner: async (request) => {
        calls.push(request)
        if (request.executable === 'xcodebuild') {
          const index = request.args.indexOf('-resultBundlePath')
          await fs.mkdir(request.args[index + 1], { recursive: true })
        } else {
          await fs.writeFile(request.args.at(-1), 'zipped evidence')
        }
        return { ok: true, exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const harness = context({
      async publishArtifact() {
        throw new Error('storage unavailable')
      },
    })
    await adapter.prepare(harness.context)
    await assert.rejects(
      () => adapter.run(harness.context),
      /storage unavailable/
    )
    assert.equal(calls.length, 2)
    assert.equal(
      harness.events.filter(({ type }) => type === 'process-exit').length,
      1
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('failed artifact publication durably spools packaged Xcode evidence', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, 'workspace')
  const spoolRoot = path.join(root, 'artifact-spool')
  const container = path.join(workspace, 'biometrics', 'StatsKey.xcodeproj')
  try {
    await fs.mkdir(container, { recursive: true })
    const adapter = new XcodeFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace, commit: COMMIT }
        },
      },
      artifactSpoolRoot: spoolRoot,
      platform: 'darwin',
      processRunner: async (request) => {
        if (request.executable === 'xcodebuild') {
          const index = request.args.indexOf('-resultBundlePath')
          await fs.mkdir(request.args[index + 1], { recursive: true })
        } else {
          await fs.writeFile(request.args.at(-1), 'spooled evidence')
        }
        return { ok: true, exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const harness = context({
      async publishArtifact() {
        const error = new Error('storage unavailable')
        error.code = 'artifact_upload_offline'
        throw error
      },
    })

    await adapter.prepare(harness.context)
    await assert.rejects(
      () => adapter.run(harness.context),
      (error) => {
        assert.equal(error.code, 'artifact_spooled')
        assert.equal(error.retryable, false)
        return true
      }
    )
    const spoolDirectory = path.join(spoolRoot, `${JOB_ID}-${LEASE_ID}`)
    assert.equal(
      await fs.readFile(path.join(spoolDirectory, 'xcresult.zip'), 'utf8'),
      'spooled evidence'
    )
    const manifest = JSON.parse(
      await fs.readFile(path.join(spoolDirectory, 'xcresult.json'), 'utf8')
    )
    assert.equal(manifest.jobId, JOB_ID)
    assert.equal(manifest.leaseId, LEASE_ID)
    assert.equal(manifest.reasonCode, 'artifact_upload_offline')
    assert.equal(manifest.sizeBytes, Buffer.byteLength('spooled evidence'))
    assert.match(manifest.contentHash, /^[a-f0-9]{64}$/)
    const retained = await listArtifactSpool({
      artifactSpoolRoot: spoolRoot,
    })
    assert.equal(retained.length, 1)
    assert.equal(retained[0].spoolId, `${JOB_ID}-${LEASE_ID}`)
    assert.equal(retained[0].integrity, 'recorded')
    assert.equal(
      await revealArtifactSpoolEntry({
        artifactSpoolRoot: spoolRoot,
        spoolId: retained[0].spoolId,
        kind: retained[0].kind,
      }),
      path.join(spoolDirectory, 'xcresult.zip')
    )
    assert.equal(
      harness.events.some(
        ({ type, payload }) =>
          type === 'checkpoint' && payload.phase === 'artifact-spooled'
      ),
      true
    )
    assert.equal(
      await purgeArtifactSpoolEntry({
        artifactSpoolRoot: spoolRoot,
        spoolId: retained[0].spoolId,
      }),
      true
    )
    assert.deepEqual(
      await listArtifactSpool({ artifactSpoolRoot: spoolRoot }),
      []
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('artifact spool operations reject a replaced symlink root', async () => {
  const root = await temporaryDirectory()
  const outside = await temporaryDirectory()
  const spoolRoot = path.join(root, 'artifact-spool')
  try {
    await fs.symlink(outside, spoolRoot)
    await assert.rejects(
      () => listArtifactSpool({ artifactSpoolRoot: spoolRoot }),
      { code: 'invalid_artifact_spool' }
    )
    await assert.rejects(
      () =>
        purgeArtifactSpoolEntry({
          artifactSpoolRoot: spoolRoot,
          spoolId: `${JOB_ID}-${LEASE_ID}`,
        }),
      { code: 'invalid_artifact_spool' }
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('artifact spooling rejects a pre-positioned entry symlink', async () => {
  const root = await temporaryDirectory()
  const outside = await temporaryDirectory()
  const spoolRoot = path.join(root, 'artifact-spool')
  const archivePath = path.join(root, 'evidence.zip')
  try {
    await fs.mkdir(spoolRoot, { recursive: true })
    await fs.writeFile(archivePath, 'evidence')
    await fs.symlink(outside, path.join(spoolRoot, `${JOB_ID}-${LEASE_ID}`))
    const adapter = new XcodeFleetAdapter({
      materializer: { async materialize() {} },
      artifactSpoolRoot: spoolRoot,
      platform: 'darwin',
    })
    const harness = context()
    await assert.rejects(
      () =>
        adapter.spoolArtifact(
          harness.context,
          { commit: COMMIT },
          archivePath,
          'xcresult',
          new Error('offline')
        ),
      { code: 'invalid_artifact_spool' }
    )
    assert.deepEqual(await fs.readdir(outside), [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('artifact spool pruning enforces the aggregate byte budget', async () => {
  const root = await temporaryDirectory()
  const spoolRoot = path.join(root, 'artifact-spool')
  try {
    await fs.mkdir(spoolRoot, { recursive: true })
    for (let index = 0; index < 17; index += 1) {
      const jobId = `job_${index.toString(16).padStart(32, '0')}`
      const leaseId = `lease_${index.toString(16).padStart(32, '0')}`
      const directory = path.join(spoolRoot, `${jobId}-${leaseId}`)
      await fs.mkdir(directory)
      await fs.writeFile(path.join(directory, 'xcresult.zip'), '')
      await fs.truncate(path.join(directory, 'xcresult.zip'), 1024 ** 3)
      const modifiedAt = new Date(Date.now() - index * 1_000)
      await fs.utimes(directory, modifiedAt, modifiedAt)
    }
    const adapter = new XcodeFleetAdapter({
      materializer: { async materialize() {} },
      artifactSpoolRoot: spoolRoot,
      platform: 'darwin',
    })
    await adapter.pruneArtifactSpool(Date.now())
    assert.equal((await fs.readdir(spoolRoot)).length, 16)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('failed Xcode work retains its result bundle when one exists', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, 'workspace')
  const container = path.join(workspace, 'biometrics', 'StatsKey.xcodeproj')
  const published = []
  try {
    await fs.mkdir(container, { recursive: true })
    const adapter = new XcodeFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace, commit: COMMIT }
        },
      },
      platform: 'darwin',
      processRunner: async (request) => {
        if (request.executable === 'xcodebuild') {
          const index = request.args.indexOf('-resultBundlePath')
          await fs.mkdir(request.args[index + 1], { recursive: true })
          const error = new Error('tests failed')
          error.result = {
            exitCode: 65,
            timedOut: false,
            cancelled: false,
            terminationConfirmed: true,
          }
          throw error
        }
        await fs.writeFile(request.args.at(-1), 'failed test evidence')
        return { ok: true, exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const harness = context({
      async publishArtifact(input) {
        published.push(input)
        return {
          id: `artifact_${'f'.repeat(32)}`,
          kind: input.kind,
          contentHash: 'e'.repeat(64),
          sizeBytes: 20,
        }
      },
    })
    await adapter.prepare(harness.context)
    await assert.rejects(() => adapter.run(harness.context), /tests failed/)
    assert.equal(published.length, 1)
    assert.equal(published[0].kind, 'xcresult')
    assert.equal(
      harness.events.some(({ type }) => type === 'process-exit'),
      true
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('unconfirmed Xcode termination never starts evidence packaging', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, 'workspace')
  const container = path.join(workspace, 'biometrics', 'StatsKey.xcodeproj')
  let processCalls = 0
  try {
    await fs.mkdir(container, { recursive: true })
    const adapter = new XcodeFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace, commit: COMMIT }
        },
      },
      platform: 'darwin',
      processRunner: async () => {
        processCalls += 1
        const error = new Error('termination unknown')
        error.result = { terminationConfirmed: false }
        throw error
      },
    })
    const harness = context({
      async publishArtifact() {
        throw new Error('publication must not run')
      },
    })
    await adapter.prepare(harness.context)
    await assert.rejects(
      () => adapter.run(harness.context),
      (error) => error.result?.terminationConfirmed === false
    )
    assert.equal(processCalls, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('unconfirmed failure packager termination reaches worker quarantine', async () => {
  const root = await temporaryDirectory()
  const workspace = path.join(root, 'workspace')
  const container = path.join(workspace, 'biometrics', 'StatsKey.xcodeproj')
  try {
    await fs.mkdir(container, { recursive: true })
    const adapter = new XcodeFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace, commit: COMMIT }
        },
      },
      platform: 'darwin',
      processRunner: async (request) => {
        if (request.executable === 'xcodebuild') {
          const resultPath = request.args[request.args.indexOf('-resultBundlePath') + 1]
          await fs.mkdir(resultPath, { recursive: true })
          const error = new Error('tests failed')
          error.result = { exitCode: 65, terminationConfirmed: true }
          throw error
        }
        const error = new Error('packager termination unknown')
        error.result = { terminationConfirmed: false }
        throw error
      },
    })
    const harness = context({ async publishArtifact() {} })
    await adapter.prepare(harness.context)
    await assert.rejects(
      () => adapter.run(harness.context),
      (error) => error.result?.terminationConfirmed === false
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('command adapter requires an explicit executable allowlist', async () => {
  const root = await temporaryDirectory()
  try {
    const materializer = {
      async materialize() {
        return { workspace: root, commit: COMMIT }
      },
    }
    const harness = context({
      job: {
        ...context().context.job,
        type: 'command',
        cage: { enabled: true, maxWallTimeMs: 30_000 },
        execution: {
          kind: 'command',
          executable: 'npm',
          arguments: ['test', '--', '--runInBand'],
          workingDirectory: '.',
          timeoutMs: 60_000,
        },
      },
    })
    const denied = new CommandFleetAdapter({
      materializer,
      allowedExecutables: [],
    })
    await assert.rejects(() => denied.prepare(harness.context), {
      code: 'executable_denied',
    })

    const calls = []
    const allowed = new CommandFleetAdapter({
      materializer,
      allowedExecutables: ['npm'],
      processRunner: async (request) => {
        calls.push(request)
        return { ok: true, exitCode: 0, stdout: '', stderr: '' }
      },
    })
    await allowed.prepare(harness.context)
    await allowed.run(harness.context)
    assert.deepEqual(calls[0].args, ['test', '--', '--runInBand'])
    assert.equal(calls[0].timeoutMs, 30_000)
    assert.equal(
      calls[0].environmentOverrides.HOME,
      path.join(root, '.statskey-runtime', 'home')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Windows workers route typed builds through the command adapter', async () => {
  const root = await temporaryDirectory()
  try {
    const adapters = createFleetWorkerAdapters({
      workRoot: root,
      allowedExecutables: ['dotnet'],
      executablePaths: {
        dotnet: 'C:\\Program Files\\dotnet\\dotnet.exe',
        git: 'C:\\Program Files\\Git\\cmd\\git.exe',
      },
      platform: 'win32',
      runProcess: async () => ({
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
      }),
    })
    assert.ok(adapters.command instanceof CommandFleetAdapter)
    assert.equal(adapters['windows-build'], adapters.command)
    assert.equal(
      adapters.command.executablePaths.get('dotnet'),
      'C:\\Program Files\\dotnet\\dotnet.exe'
    )
    assert.equal(
      adapters.command.materializer.gitExecutable,
      'C:\\Program Files\\Git\\cmd\\git.exe'
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Windows executable matching is case-insensitive but path-pinned', async () => {
  const root = await temporaryDirectory()
  const calls = []
  try {
    const adapter = new CommandFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace: root, commit: COMMIT }
        },
      },
      allowedExecutables: ['dotnet'],
      executablePaths: {
        dotnet: 'C:\\Program Files\\dotnet\\dotnet.exe',
      },
      platform: 'win32',
      processRunner: async (request) => {
        calls.push(request)
        return { ok: true, exitCode: 0, stdout: '', stderr: '' }
      },
    })
    const harness = context({
      job: {
        ...context().context.job,
        type: 'windows-build',
        execution: {
          kind: 'command',
          executable: 'DotNet',
          arguments: ['build'],
          workingDirectory: '.',
          timeoutMs: 30_000,
        },
      },
    })

    await adapter.prepare(harness.context)
    await adapter.run(harness.context)
    assert.equal(calls[0].executable, 'C:\\Program Files\\dotnet\\dotnet.exe')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('command adapter completes a real bounded process in its exact snapshot', async () => {
  const root = await temporaryDirectory()
  try {
    await fs.writeFile(
      path.join(root, 'fleet-smoke.cjs'),
      [
        "if (process.env.OPENAI_API_KEY) process.exit(2)",
        "if (process.cwd() !== __dirname) process.exit(3)",
        "const norm = (v) => String(v || '').replace(/\\\\/g, '/')",
        "if (!norm(process.env.HOME).endsWith('/.statskey-runtime/home')) process.exit(4)",
        "if (!norm(process.env.TMPDIR).endsWith('/.statskey-runtime/tmp')) process.exit(5)",
      ].join('\n')
    )
    // Windows only runs processes under the kernel-backed Job Object owner
    // with a live lease authority fence; POSIX development runs unowned.
    const authorityStore = process.platform === 'win32' ?
      new FleetLeaseAuthorityStore({ directory: path.join(root, 'authority') }) :
      null
    if (authorityStore) {
      await authorityStore.assertOwnerAvailable()
      await authorityStore.activate({
        leaseId: LEASE_ID,
        expiresAt: Date.now() + 60_000,
        deadlineAt: Date.now() + 120_000,
      })
    }
    const adapter = new CommandFleetAdapter({
      materializer: {
        async materialize() {
          return { workspace: root, commit: COMMIT }
        },
      },
      allowedExecutables: ['node'],
      // Windows workers only run executables pinned to an absolute local path.
      executablePaths:
        process.platform === 'win32' ? { node: process.execPath } : {},
      processRunner: createProcessRunner({
        environment: {
          ...process.env,
          OPENAI_API_KEY: 'must-not-reach-worker',
        },
        authorityFenceProvider:
          authorityStore ? () => authorityStore.current() : null,
      }),
    })
    const harness = context({
      job: {
        ...context().context.job,
        type: 'command',
        execution: {
          kind: 'command',
          executable: 'node',
          arguments: ['fleet-smoke.cjs'],
          workingDirectory: '.',
          timeoutMs: 30_000,
        },
      },
    })
    await adapter.prepare(harness.context)
    const result = await adapter.run(harness.context)
    assert.equal(result.exitCode, 0)
    assert.equal(result.sourceCommit, COMMIT)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Windows discovery advertises only directly launchable executables', () => {
  assert.deepEqual(
    directExecutableExtensions({
      executable: 'builder',
      platform: 'win32',
      pathExt: '.COM;.EXE;.BAT;.CMD;.PS1',
    }),
    ['.com', '.exe']
  )
  assert.deepEqual(
    directExecutableExtensions({
      executable: 'builder.cmd',
      platform: 'win32',
      pathExt: '.COM;.EXE;.BAT;.CMD',
    }),
    []
  )
  assert.deepEqual(
    directExecutableExtensions({
      executable: 'builder.exe',
      platform: 'win32',
    }),
    ['']
  )
})

test('only Windows advertises kernel-backed Fleet process containment', () => {
  assert.equal(kernelBackedFleetProcessContainment('win32'), true)
  assert.equal(kernelBackedFleetProcessContainment('darwin'), false)
  assert.equal(kernelBackedFleetProcessContainment('linux'), false)
})

test('best-effort POSIX owner is an unpackaged macOS opt-in only', async () => {
  const main = await fs.readFile(path.join(__dirname, 'main.cjs'), 'utf8')
  const flag = 'STATSKEY_FLEET_ALLOW_BEST_EFFORT_POSIX_OWNER'
  const enablement = main.match(
    new RegExp(
      `const allowBestEffortPosixOwner =\\s*([\\s\\S]*?)\\n\\s*const fleetProcessContainmentAvailable`
    )
  )
  assert.ok(enablement, 'main process must define the opt-in explicitly')
  assert.match(enablement[1], /!app\.isPackaged/)
  assert.match(enablement[1], /process\.platform === 'darwin'/)
  assert.match(enablement[1], new RegExp(`process\\.env\\.${flag} === '1'`))
  assert.doesNotMatch(enablement[1], /linux/)
  assert.match(
    main,
    /authorityFenceProvider: \(\) => leaseAuthorityStore\.current\(\),\s*\n\s*allowBestEffortPosixOwner,/
  )
  const linuxGate = main.indexOf("process.platform === 'linux'")
  const capabilityUse = main.indexOf('const allowBestEffortPosixOwner =')
  assert.ok(linuxGate > -1 && linuxGate < capabilityUse)
})

test('lease authority is durable, renewable, and bound to one lease', async () => {
  const directory = await temporaryDirectory()
  const now = Date.parse('2026-08-19T10:00:00.000Z')
  const authorityKey = Buffer.alloc(32, 0x6b).toString('base64url')
  try {
    const store = new FleetLeaseAuthorityStore({
      directory,
      now: () => now,
      randomToken: () => 't'.repeat(43),
      randomAuthorityKey: () => authorityKey,
    })
    const descriptor = await store.activate({
      leaseId: LEASE_ID,
      expiresAt: now + 60_000,
      deadlineAt: now + 5 * 60_000,
    })
    assert.equal(store.current(LEASE_ID), descriptor)
    assert.deepEqual(
      (await fs.readFile(descriptor.filePath, 'utf8')).split('\n'),
      (() => {
        const fields = [
        'statskey-fleet-authority-v1',
        LEASE_ID,
        't'.repeat(43),
        String(now + 60_000),
        String(now + 5 * 60_000),
        ]
        return [
          ...fields,
          createHmac('sha256', Buffer.from(authorityKey, 'base64url'))
            .update(fields.join('\n'))
            .digest('base64url'),
        ]
      })()
    )
    await store.renew({
      leaseId: LEASE_ID,
      expiresAt: now + 120_000,
      deadlineAt: now + 10 * 60_000,
    })
    assert.deepEqual(
      (await fs.readFile(descriptor.filePath, 'utf8')).split('\n').slice(3, 5),
      [String(now + 120_000), String(now + 5 * 60_000)]
    )
    await assert.rejects(
      () =>
        store.renew({
          leaseId: `lease_${'c'.repeat(32)}`,
          expiresAt: now + 120_000,
          deadlineAt: now + 5 * 60_000,
        }),
      { code: 'worker_authority_fence_unavailable' }
    )
    await store.clear(LEASE_ID)
    assert.equal(store.current(LEASE_ID), null)
    await assert.rejects(() => fs.readFile(descriptor.filePath), {
      code: 'ENOENT',
    })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test(
  'POSIX Fleet execution fails before spawn without kernel containment',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await temporaryDirectory()
    const store = new FleetLeaseAuthorityStore({ directory })
    let spawned = false
    try {
      const now = Date.now()
      await store.activate({
        leaseId: LEASE_ID,
        expiresAt: now + 5_000,
        deadlineAt: now + 10_000,
      })
      const runner = createProcessRunner({
        platform: process.platform,
        authorityFenceProvider: () => store.current(),
        runProcess: async () => {
          spawned = true
          return { ok: true, terminationConfirmed: true }
        },
      })
      await assert.rejects(
        () =>
          runner({
            executable: process.execPath,
            args: [],
            cwd: directory,
            timeoutMs: 1_000,
            errorCode: 'command_failed',
            errorMessage: 'Command failed.',
          }),
        { code: 'process_owner_unavailable' }
      )
      assert.equal(spawned, false)
      await store.clear(LEASE_ID)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
)

test(
  'best-effort POSIX owner follows durable lease renewal in development',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await temporaryDirectory()
    const store = new FleetLeaseAuthorityStore({ directory })
    try {
      const startedAt = Date.now()
      await store.activate({
        leaseId: LEASE_ID,
        expiresAt: startedAt + 500,
        deadlineAt: startedAt + 5_000,
      })
      const runner = createProcessRunner({
        platform: process.platform,
        authorityFenceProvider: () => store.current(),
        allowBestEffortPosixOwner: true,
      })
      const running = runner({
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 800)'],
        cwd: directory,
        timeoutMs: 3_000,
        errorCode: 'command_failed',
        errorMessage: 'Command failed.',
      })
      await new Promise((resolve) => setTimeout(resolve, 250))
      await store.renew({
        leaseId: LEASE_ID,
        expiresAt: Date.now() + 2_000,
        deadlineAt: startedAt + 5_000,
      })
      const result = await running
      assert.equal(result.ok, true)
      assert.equal(result.terminationConfirmed, true)
      await store.clear(LEASE_ID)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
)

test(
  'best-effort POSIX owner terminates its process group at lease expiry',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await temporaryDirectory()
    const store = new FleetLeaseAuthorityStore({ directory })
    try {
      const startedAt = Date.now()
      await store.activate({
        leaseId: LEASE_ID,
        expiresAt: startedAt + 350,
        deadlineAt: startedAt + 5_000,
      })
      const runner = createProcessRunner({
        platform: process.platform,
        authorityFenceProvider: () => store.current(),
        allowBestEffortPosixOwner: true,
      })
      await assert.rejects(
        () =>
          runner({
            executable: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 5_000)'],
            cwd: directory,
            timeoutMs: 4_000,
            errorCode: 'command_failed',
            errorMessage: 'Command failed.',
          }),
        (error) =>
          error.code === 'command_failed' &&
          error.result?.terminationConfirmed === true
      )
      assert.ok(Date.now() - startedAt < 3_000)
      await store.clear(LEASE_ID)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
)

test(
  'best-effort POSIX owner rejects a forged lease extension',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await temporaryDirectory()
    const store = new FleetLeaseAuthorityStore({ directory })
    try {
      const startedAt = Date.now()
      const descriptor = await store.activate({
        leaseId: LEASE_ID,
        expiresAt: startedAt + 1_500,
        deadlineAt: startedAt + 5_000,
      })
      const runner = createProcessRunner({
        platform: process.platform,
        authorityFenceProvider: () => store.current(),
        allowBestEffortPosixOwner: true,
      })
      const running = runner({
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 5_000)'],
        cwd: directory,
        timeoutMs: 4_000,
        errorCode: 'command_failed',
        errorMessage: 'Command failed.',
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      const forged = (await fs.readFile(descriptor.filePath, 'utf8')).split('\n')
      forged[3] = String(Date.now() + 4_000)
      await fs.writeFile(descriptor.filePath, forged.join('\n'))
      await assert.rejects(
        () => running,
        (error) =>
          error.code === 'command_failed' &&
          error.result?.terminationConfirmed === true
      )
      assert.ok(Date.now() - startedAt < 1_500)
      await store.clear(LEASE_ID)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
)

test('Windows Fleet commands run through the pinned Job Object owner', async () => {
  const processOwnerScript = path.resolve(
    __dirname,
    'windows-process-owner.ps1'
  )
  const parentProcessId = 1234
  const parentStartedUnixMilliseconds = Date.now() - 1_000
  const deadlineUnixMilliseconds = Date.now() + 60_000
  const authorityFencePath = 'C:\\fleet\\lease.authority'
  const ownerLockPath = 'C:\\fleet\\worker-owner.lock'
  const authorityToken = 't'.repeat(43)
  const authorityKey = Buffer.alloc(32, 0x6b).toString('base64url')
  const maximumAuthorityDeadlineUnixMilliseconds =
    deadlineUnixMilliseconds + 60_000
  const invocation = windowsProcessOwnerInvocation({
    executable: 'C:\\Program Files\\dotnet\\dotnet.exe',
    args: ['build', 'StatsKey.sln', '--configuration', 'Release'],
    environment: { SystemRoot: 'C:\\Windows' },
    processOwnerScript,
    parentProcessId,
    parentStartedUnixMilliseconds,
    deadlineUnixMilliseconds,
    authorityFencePath,
    ownerLockPath,
    authorityLeaseId: LEASE_ID,
    authorityToken,
    authorityKey,
    maximumAuthorityDeadlineUnixMilliseconds,
  })
  assert.equal(
    invocation.executable,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  )
  assert.deepEqual(invocation.args.slice(0, 7), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    processOwnerScript,
  ])
  const payload = JSON.parse(
    Buffer.from(invocation.input, 'base64url').toString('utf8')
  )
  assert.deepEqual(payload, {
    executable: 'C:\\Program Files\\dotnet\\dotnet.exe',
    arguments: ['build', 'StatsKey.sln', '--configuration', 'Release'],
    parentProcessId,
    parentStartedUnixMilliseconds,
    deadlineUnixMilliseconds,
    authorityFencePath,
    ownerLockPath,
    authorityLeaseId: LEASE_ID,
    authorityToken,
    authorityKey,
    maximumAuthorityDeadlineUnixMilliseconds,
  })

  let processRequest
  const runner = createProcessRunner({
    platform: 'win32',
    environment: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
    processOwnerScript,
    authorityFenceProvider: () => ({
      filePath: authorityFencePath,
      ownerLockPath,
      leaseId: LEASE_ID,
      token: authorityToken,
      authorityKey,
      maximumDeadlineUnixMilliseconds:
        maximumAuthorityDeadlineUnixMilliseconds,
    }),
    runProcess: async (request) => {
      processRequest = request
      return {
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        terminationConfirmed: true,
      }
    },
  })
  await runner({
    executable: 'C:\\Program Files\\dotnet\\dotnet.exe',
    args: ['build'],
    cwd: 'C:\\fleet\\workspace',
    timeoutMs: 60_000,
    errorCode: 'command_failed',
    errorMessage: 'Command failed.',
  })
  assert.equal(processRequest.processTreeOwned, true)
  assert.equal(processRequest.killProcessGroup, true)
  assert.equal(processRequest.executable, invocation.executable)
  const runnerPayload = JSON.parse(
    Buffer.from(processRequest.input, 'base64url').toString('utf8')
  )
  assert.equal(runnerPayload.parentProcessId, process.pid)
  assert.ok(runnerPayload.parentStartedUnixMilliseconds <= Date.now())
  assert.ok(runnerPayload.deadlineUnixMilliseconds > Date.now())
  assert.equal(processRequest.args.includes(authorityKey), false)
  assert.throws(
    () =>
      windowsProcessOwnerInvocation({
        executable: 'dotnet.exe',
        environment: { SystemRoot: 'C:\\Windows' },
        processOwnerScript,
      }),
    { code: 'executable_not_pinned' }
  )
})

test('packaged workers resolve root-level ASAR resources from app.asar.unpacked', () => {
  assert.equal(
    unpackedDesktopResource(
      'windows-process-owner.ps1',
      path.join(path.sep, 'Applications', 'StatsKey', 'Resources', 'app.asar')
    ),
    path.join(
      path.sep,
      'Applications',
      'StatsKey',
      'Resources',
      'app.asar.unpacked',
      'windows-process-owner.ps1'
    )
  )
  assert.equal(
    unpackedDesktopResource(
      'windows-process-owner.ps1',
      path.join(
        path.sep,
        'Applications',
        'StatsKey',
        'Resources',
        'app.asar',
        'desktop'
      )
    ),
    path.join(
      path.sep,
      'Applications',
      'StatsKey',
      'Resources',
      'app.asar.unpacked',
      'desktop',
      'windows-process-owner.ps1'
    )
  )
})

test('artifact traversal enforces exact local entry and byte budgets', async () => {
  const root = await temporaryDirectory()
  const evidence = path.join(root, 'evidence.xcresult')
  try {
    await fs.mkdir(path.join(evidence, 'nested'), { recursive: true })
    await fs.writeFile(path.join(evidence, 'result.json'), '1234')
    await fs.writeFile(path.join(evidence, 'nested', 'coverage'), '123456')
    assert.deepEqual(
      await boundedArtifactDirectory(fs, evidence, root),
      { entries: 3, bytes: 10 }
    )
    await assert.rejects(
      () =>
        boundedArtifactDirectory(fs, evidence, root, {
          maximumEntries: 2,
          maximumBytes: 100,
        }),
      { code: 'artifact_limit_exceeded' }
    )
    await assert.rejects(
      () =>
        boundedArtifactDirectory(fs, evidence, root, {
          maximumEntries: 10,
          maximumBytes: 9,
        }),
      { code: 'artifact_limit_exceeded' }
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('worker environment strips provider credentials', () => {
  assert.deepEqual(
    workerEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/Users/test',
        OPENAI_API_KEY: 'secret',
        AWS_SECRET_ACCESS_KEY: 'secret',
      },
      { platform: 'darwin' }
    ),
    {
      PATH: '/usr/bin',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    }
  )
  assert.deepEqual(
    workerEnvironment(
      { PATH: '/usr/bin', HOME: '/Users/test', SSH_AUTH_SOCK: '/tmp/ssh.sock' },
      { includeGitCredentials: true, platform: 'darwin' }
    ),
    {
      PATH: '/usr/bin',
      SSH_AUTH_SOCK: '/tmp/ssh.sock',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    }
  )
  assert.equal(
    workerEnvironment({}, { platform: 'win32' }).GIT_CONFIG_GLOBAL,
    'NUL'
  )
  assert.throws(() => safeWorkspacePath('/safe/root', '..', 'escape'), {
    code: 'unsafe_workspace_path',
  })
})
