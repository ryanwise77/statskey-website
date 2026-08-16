'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SafeStorageCrypto } = require('./safe-storage-runtime.cjs')
const {
  CHECKPOINT_FORMAT,
  CHECKPOINT_VERSION,
  MAX_CHECKPOINT_DIRECTORY_ENTRIES,
  MAX_CHECKPOINT_FILES,
  MAX_CHECKPOINT_FILE_BYTES,
  MAX_CHECKPOINT_PATH_CHARACTERS,
  MAX_CHECKPOINT_PAYLOAD_BYTES,
  WorkspaceCheckpointStore,
} = require('./workspace-checkpoint-runtime.cjs')

test('new checkpoints use authenticated local envelopes and never call Keychain', async (t) => {
  const fixture = createFixture(t)
  let legacyCalls = 0
  const store = fixture.store({
    async decryptString() {
      legacyCalls += 1
      throw new Error('must not run')
    },
  })
  const checkpoint = sampleCheckpoint('01234567-89ab-cdef-0123-456789abcdef')

  assert.deepEqual(await store.create(checkpoint), {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    label: checkpoint.label,
    fileCount: 1,
  })
  const envelopePath = path.join(fixture.directory, `${checkpoint.id}.bin`)
  const metadataPath = path.join(
    fixture.directory,
    `${checkpoint.id}.meta.json`
  )
  const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'))
  assert.equal(envelope.format, CHECKPOINT_FORMAT)
  assert.equal(envelope.version, CHECKPOINT_VERSION)
  assert.equal(Object.hasOwn(envelope, 'files'), false)
  assert.equal(readFileSync(envelopePath, 'utf8').includes('before contents'), false)
  for (const privateFile of [fixture.keyPath, envelopePath, metadataPath]) {
    const stats = statSync(privateFile)
    assert.equal(stats.isFile(), true)
    // Windows exposes synthesized POSIX bits (commonly 0666); the store is
    // protected by the current user's profile ACL there. POSIX platforms can
    // and must continue proving the exact private mode.
    if (process.platform !== 'win32') {
      assert.equal(stats.mode & 0o777, 0o600)
    }
  }

  assert.deepEqual(await store.list(), [
    {
      id: checkpoint.id,
      createdAt: checkpoint.createdAt,
      label: checkpoint.label,
      fileCount: 1,
    },
  ])
  assert.deepEqual(await store.read(checkpoint.id), checkpoint)
  assert.equal(legacyCalls, 0)
})

test('legacy plaintext reads directly but listing remains payload-blind', async (t) => {
  const fixture = createFixture(t)
  let legacyCalls = 0
  const store = fixture.store({
    async decryptString() {
      legacyCalls += 1
      return await new Promise(() => {})
    },
  })
  const checkpoint = sampleCheckpoint('11111111-2222-3333-4444-555555555555')
  writeFileSync(
    path.join(fixture.directory, `${checkpoint.id}.bin`),
    `\n\uFEFF${JSON.stringify(checkpoint)}`,
    { mode: 0o600 }
  )

  assert.deepEqual(await store.read(checkpoint.id), checkpoint)
  assert.deepEqual(await store.list(), [
    {
      id: checkpoint.id,
      createdAt: statSync(
        path.join(fixture.directory, `${checkpoint.id}.bin`)
      ).mtime.toISOString(),
      label: 'Workspace checkpoint',
      fileCount: 0,
      legacyEncrypted: true,
    },
  ])
  assert.equal(legacyCalls, 0)
})

test('listing many legacy ciphertext checkpoints never opens Keychain', async (t) => {
  const fixture = createFixture(t)
  let legacyCalls = 0
  const store = fixture.store({
    async decryptString() {
      legacyCalls += 1
      return await new Promise(() => {})
    },
  })
  for (let index = 0; index < 31; index += 1) {
    const id = `aaaaaaaa-bbbb-cccc-dddd-${String(index).padStart(12, '0')}`
    writeFileSync(
      path.join(fixture.directory, `${id}.bin`),
      Buffer.concat([Buffer.from('v10'), Buffer.from([index])]),
      { mode: 0o600 }
    )
  }

  const listed = await store.list()
  assert.equal(listed.length, 31)
  assert.equal(listed.every((entry) => entry.legacyEncrypted === true), true)
  assert.equal(legacyCalls, 0)
})

test('an explicit legacy restore is bounded when Keychain never responds', async (t) => {
  const fixture = createFixture(t)
  const safeCrypto = new SafeStorageCrypto({
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      decryptStringAsync: () => new Promise(() => {}),
    },
    deadlineMilliseconds: 20,
  })
  const store = fixture.store(safeCrypto)
  const id = '99999999-8888-7777-6666-555555555555'
  writeFileSync(
    path.join(fixture.directory, `${id}.bin`),
    Buffer.from('v10 encrypted'),
    { mode: 0o600 }
  )

  const started = Date.now()
  assert.equal(await store.read(id), null)
  assert.ok(Date.now() - started < 500)
})

test('selected checkpoint read rejects oversized payloads before reading or decrypting', async (t) => {
  const fixture = createFixture(t)
  let legacyCalls = 0
  const store = fixture.store({
    async decryptString() {
      legacyCalls += 1
      throw new Error('must not run')
    },
  })
  const id = '77777777-8888-9999-aaaa-bbbbbbbbbbbb'
  const filePath = path.join(fixture.directory, `${id}.bin`)
  writeFileSync(filePath, Buffer.from('v10'), { mode: 0o600 })
  truncateSync(filePath, MAX_CHECKPOINT_PAYLOAD_BYTES + 1)

  assert.equal(await store.read(id), null)
  assert.equal(legacyCalls, 0)
})

test('listing bounds directory entries before per-file processing', async (t) => {
  const fixture = createFixture(t)
  const store = fixture.store({
    async decryptString() {
      throw new Error('must not run')
    },
  })
  for (let index = 0; index < MAX_CHECKPOINT_DIRECTORY_ENTRIES + 3; index += 1) {
    const id = `bbbbbbbb-bbbb-bbbb-bbbb-${String(index).padStart(12, '0')}`
    writeFileSync(path.join(fixture.directory, `${id}.bin`), Buffer.from('v10'), {
      mode: 0o600,
    })
  }

  assert.equal(
    (await store.list(MAX_CHECKPOINT_DIRECTORY_ENTRIES + 3)).length,
    MAX_CHECKPOINT_DIRECTORY_ENTRIES
  )
})

test('listing implementation cannot open or parse checkpoint payloads', () => {
  const runtime = readFileSync(
    path.join(__dirname, 'workspace-checkpoint-runtime.cjs'),
    'utf8'
  )
  const listing = sourceBetween(
    runtime,
    '  async list(limit = 100) {',
    '  decryptEnvelope(envelope, expectedId) {'
  )
  assert.doesNotMatch(
    listing,
    /readFileSync\(filePath\)|readBoundedFile|parseJsonBytes|legacyCrypto/
  )
  assert.ok(
    listing.indexOf('.slice(0, MAX_CHECKPOINT_DIRECTORY_ENTRIES)') <
      listing.indexOf('for (const name of names)'),
    'the directory bound must be applied before per-file work starts'
  )
})

test('tampered envelope metadata is replaced by stat-only listing data', async (t) => {
  const fixture = createFixture(t)
  const store = fixture.store({
    async decryptString() {
      throw new Error('must not run')
    },
  })
  const checkpoint = sampleCheckpoint('abcdefab-cdef-abcd-efab-cdefabcdefab')
  await store.create(checkpoint)
  const envelopePath = path.join(fixture.directory, `${checkpoint.id}.bin`)
  const metadataPath = path.join(
    fixture.directory,
    `${checkpoint.id}.meta.json`
  )
  const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'))
  envelope.metadata.label = 'Tampered'
  writeFileSync(envelopePath, JSON.stringify(envelope), { mode: 0o600 })
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  metadata.metadata.label = 'Tampered'
  writeFileSync(metadataPath, JSON.stringify(metadata), { mode: 0o600 })

  const listed = await store.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].label, 'Workspace checkpoint')
  assert.equal(listed[0].legacyEncrypted, true)
  assert.equal(await store.read(checkpoint.id), null)
})

test('legacy checkpoint file records are strictly bounded and canonical', async (t) => {
  const fixture = createFixture(t)
  const store = fixture.store({
    async decryptString() {
      throw new Error('plaintext records must not use Keychain')
    },
  })
  const base = sampleCheckpoint('12345678-1234-1234-1234-123456789abc')
  const invalidFiles = [
    new Array(MAX_CHECKPOINT_FILES + 1).fill(base.files[0]),
    [null],
    [{ ...base.files[0], path: 'relative/file.swift' }],
    [{ ...base.files[0], path: '/workspace/bad\0name.swift' }],
    [
      {
        ...base.files[0],
        path: `/${'x'.repeat(MAX_CHECKPOINT_PATH_CHARACTERS)}`,
      },
    ],
    [{ ...base.files[0], existed: 'yes' }],
    [{ ...base.files[0], content: 'YQ' }],
    [
      {
        ...base.files[0],
        content: 'A'.repeat(Math.ceil(MAX_CHECKPOINT_FILE_BYTES / 3) * 4 + 1),
      },
    ],
    [{ ...base.files[0], mode: 0.5 }],
    [{ ...base.files[0], mode: 0o200000 }],
    [{ path: '/workspace/missing.swift', existed: false, content: '', mode: null }],
    [{ path: '/workspace/missing.swift', existed: false, content: null, mode: 0 }],
  ]

  for (let index = 0; index < invalidFiles.length; index += 1) {
    const id = `cccccccc-dddd-eeee-ffff-${String(index).padStart(12, '0')}`
    writeFileSync(
      path.join(fixture.directory, `${id}.bin`),
      JSON.stringify({ ...base, id, files: invalidFiles[index] }),
      { mode: 0o600 }
    )
    assert.equal(await store.read(id), null, `invalid file case ${index}`)
  }
})

test('valid bounded existing and missing file records round-trip in v2', async (t) => {
  const fixture = createFixture(t)
  const store = fixture.store({
    async decryptString() {
      throw new Error('must not run')
    },
  })
  const checkpoint = sampleCheckpoint('fedcba98-7654-3210-fedc-ba9876543210')
  checkpoint.files.push({
    path: '/workspace/new.swift',
    existed: false,
    content: null,
    mode: null,
  })

  await store.create(checkpoint)
  assert.deepEqual(await store.read(checkpoint.id), checkpoint)
})

test('Windows checkpoint keys survive restart despite synthesized POSIX mode bits', async (t) => {
  const fixture = createFixture(t)
  const first = sampleCheckpoint('10101010-2020-3030-4040-505050505050')
  const second = sampleCheckpoint('60606060-7070-8080-9090-a0a0a0a0a0a0')
  const legacyCrypto = {
    async decryptString() {
      throw new Error('current envelopes must not use legacy secure storage')
    },
  }

  const initialStore = fixture.store(legacyCrypto, { platform: 'win32' })
  await initialStore.create(first)

  // Windows commonly synthesizes these group/other bits even for a key under
  // the current user's profile ACL. Simulate that report before a fresh store
  // instance performs its first read.
  chmodSync(fixture.keyPath, 0o666)
  const restartedStore = fixture.store(legacyCrypto, { platform: 'win32' })
  assert.deepEqual(await restartedStore.read(first.id), first)
  await restartedStore.create(second)
  assert.deepEqual(await restartedStore.read(second.id), second)
})

test('POSIX checkpoint keys remain fail-closed when group or other bits are set', async (t) => {
  const fixture = createFixture(t)
  const checkpoint = sampleCheckpoint('b0b0b0b0-c0c0-d0d0-e0e0-f0f0f0f0f0f0')
  const legacyCrypto = {
    async decryptString() {
      throw new Error('current envelopes must not use legacy secure storage')
    },
  }
  const initialStore = fixture.store(legacyCrypto, { platform: 'linux' })
  await initialStore.create(checkpoint)
  chmodSync(fixture.keyPath, 0o666)

  const restartedStore = fixture.store(legacyCrypto, { platform: 'linux' })
  assert.equal(await restartedStore.read(checkpoint.id), null)
  await assert.rejects(
    restartedStore.create(
      sampleCheckpoint('abababab-cdcd-efef-0101-121212121212')
    ),
    /permissions are unsafe/
  )
})

test('desktop mutation and checkpoint handlers await the non-blocking store', () => {
  const main = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  assert.match(
    main,
    /workspace-checkpoints', async[\s\S]*return await listWorkspaceCheckpoints\(\)/
  )
  assert.equal(
    main.match(/await createWorkspaceCheckpoint\(/g)?.length,
    6
  )
  assert.equal(main.match(/await readWorkspaceCheckpoint\(/g)?.length, 1)
  assert.doesNotMatch(
    main,
    /safeStorage\.(?:isEncryptionAvailable|encryptString|decryptString)\s*\(/
  )
  const restore = sourceBetween(
    main,
    'async function restoreWorkspaceCheckpoint(',
    'function allowedOrCreatableWorkspacePath('
  )
  const postApproval = restore.indexOf(
    'if (!approved) return { ok: false, cancelled: true }'
  )
  const capture = restore.indexOf(
    'const safetyCheckpointCapture = await createWorkspaceCheckpoint('
  )
  const firstRevalidation = restore.indexOf(
    'paths.every((filePath) => allowedOrCreatableWorkspacePath(filePath))',
    postApproval
  )
  const secondRevalidation = restore.indexOf(
    'paths.every((filePath) => allowedOrCreatableWorkspacePath(filePath))',
    capture
  )
  assert.ok(postApproval < firstRevalidation && firstRevalidation < capture)
  assert.ok(capture < secondRevalidation)
})

function createFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'statskey-checkpoints-'))
  const directory = path.join(root, 'workspace-checkpoints')
  const keyPath = path.join(root, 'workspace-checkpoints.key')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return {
    directory,
    keyPath,
    store: (legacyCrypto, options = {}) =>
      new WorkspaceCheckpointStore({
        directory,
        keyPath,
        legacyCrypto,
        ...options,
      }),
  }
}

function sampleCheckpoint(id) {
  return {
    id,
    createdAt: '2026-08-12T20:00:00.000Z',
    label: 'Before editing CameraCaptureView.swift',
    files: [
      {
        path: '/workspace/CameraCaptureView.swift',
        existed: true,
        content: Buffer.from('before contents').toString('base64'),
        mode: 0o644,
      },
    ],
  }
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}
