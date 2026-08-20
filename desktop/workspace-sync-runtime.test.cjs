'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWorkspaceSyncRuntime } = require('./workspace-sync-runtime.cjs')

const WS_ID = 'ws_0123456789abcdef0123'
const WS_ID_2 = 'ws_aaaaaaaaaaaaaaaaaaaa'
const BK_ID = 'bk_0123456789abcdef0123'
const TR_ID = 'tr_0123456789abcdef0123'
const ROOT_ID = 'a1b2c3d4'

// Fixtures cannot live in os.tmpdir(): on macOS it realpaths into
// /private/var, which the runtime forbids as a sync root. mkdtemp appends its
// random suffix to this project-local prefix; every fixture removes the
// resulting directory in t.after().
const TEST_PREFIX = path.join(__dirname, 'sk-sync-')

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function fakeScheduler() {
  let nextId = 1
  const timeouts = new Map()
  const intervals = new Map()
  return {
    setTimeout(fn) {
      const id = nextId
      nextId += 1
      timeouts.set(id, fn)
      return id
    },
    clearTimeout(id) {
      timeouts.delete(id)
    },
    setInterval(fn) {
      const id = nextId
      nextId += 1
      intervals.set(id, fn)
      return id
    },
    clearInterval(id) {
      intervals.delete(id)
    },
    fireTimeouts() {
      const pending = [...timeouts.values()]
      timeouts.clear()
      for (const fn of pending) fn()
    },
    pendingTimeouts() {
      return timeouts.size
    },
  }
}

function createFixture(t, options = {}) {
  const base = realpathSync(mkdtempSync(TEST_PREFIX))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const userDataPath = path.join(base, 'user-data')
  const rootPath = path.join(base, 'root')
  mkdirSync(rootPath, { recursive: true })
  const events = []
  const runtime = createWorkspaceSyncRuntime({
    userDataPath,
    ignoredNames: new Set(['.git', 'node_modules', 'DerivedData']),
    maxFileBytes: options.maxFileBytes ?? 25 * 1024 * 1024,
    onChanges: (event) => events.push(event),
    scheduler: options.scheduler,
  })
  t.after(() => runtime.dispose())
  return { base, userDataPath, rootPath, runtime, events }
}

function linkState(syncId, rootPath, extra = {}) {
  return {
    version: 1,
    syncId,
    name: 'Test workspace',
    rootMappings: [{ rootId: ROOT_ID, path: rootPath }],
    lastSynced: {},
    ...extra,
  }
}

test('saveState/loadState round-trip with atomic private files', (t) => {
  const fixture = createFixture(t)
  const lastSynced = {
    [`${ROOT_ID}:src/a.txt`]: { hash: 'ab', rev: 3, mtimeMs: 12.5, size: 10 },
  }
  assert.equal(
    fixture.runtime.saveState(
      WS_ID,
      linkState(WS_ID, fixture.rootPath, { lastSynced })
    ),
    true
  )

  const stateFile = path.join(
    fixture.userDataPath,
    'workspace-sync',
    `${WS_ID}.json`
  )
  assert.equal(statSync(stateFile).isFile(), true)
  if (process.platform !== 'win32') {
    assert.equal(statSync(stateFile).mode & 0o777, 0o600)
    assert.equal(
      statSync(path.dirname(stateFile)).mode & 0o777,
      0o700
    )
  }

  const loaded = fixture.runtime.loadState(WS_ID)
  assert.deepEqual(loaded, {
    version: 1,
    syncId: WS_ID,
    name: 'Test workspace',
    rootMappings: [{ rootId: ROOT_ID, path: fixture.rootPath }],
    lastSynced,
  })
  assert.deepEqual(
    fixture.runtime.listStates().map((state) => state.syncId),
    [WS_ID]
  )
})

test('link ownership and pause survive a private state round-trip', (t) => {
  const fixture = createFixture(t)
  assert.equal(
    fixture.runtime.saveState(
      WS_ID,
      linkState(WS_ID, fixture.rootPath, {
        ownerUid: 'firebase.uid:owner-1',
        paused: true,
      })
    ),
    true
  )
  assert.deepEqual(
    fixture.runtime.loadState(WS_ID),
    linkState(WS_ID, fixture.rootPath, {
      ownerUid: 'firebase.uid:owner-1',
      paused: true,
    })
  )
})

test('saveState canonicalizes symlinked root paths', (t) => {
  const fixture = createFixture(t)
  const alias = path.join(fixture.base, 'alias')
  symlinkSync(fixture.rootPath, alias)
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, alias)),
    true
  )
  assert.equal(
    fixture.runtime.loadState(WS_ID).rootMappings[0].path,
    fixture.rootPath
  )
})

test('saveState rejects bad ids and forbidden roots', (t) => {
  const fixture = createFixture(t)
  const valid = linkState(WS_ID, fixture.rootPath)

  assert.equal(fixture.runtime.saveState('xx_0123456789abcdef0123', valid), false)
  assert.equal(fixture.runtime.saveState('ws_short', valid), false)
  assert.equal(fixture.runtime.saveState('ws_0123456789ABCDEF0123', valid), false)
  assert.equal(fixture.runtime.saveState(WS_ID, null), false)
  assert.equal(
    fixture.runtime.saveState(WS_ID, { ...valid, version: 2 }),
    false
  )
  assert.equal(
    fixture.runtime.saveState(WS_ID, { ...valid, syncId: WS_ID_2 }),
    false
  )

  const rejectedRoots = [
    'relative/path',
    path.join(fixture.base, 'does-not-exist'),
    path.parse(fixture.rootPath).root,
    os.homedir(),
    path.join(fixture.userDataPath, 'workspace-sync'),
    fixture.userDataPath,
  ]
  if (process.platform === 'darwin') rejectedRoots.push('/etc', '/usr/lib')
  for (const rootPath of rejectedRoots) {
    assert.equal(
      fixture.runtime.saveState(
        WS_ID,
        linkState(WS_ID, rootPath)
      ),
      false,
      `expected rejection for root ${rootPath}`
    )
  }

  const filePath = path.join(fixture.rootPath, 'file.txt')
  writeFileSync(filePath, 'x')
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, filePath)),
    false
  )

  assert.equal(
    fixture.runtime.saveState(WS_ID, {
      ...valid,
      rootMappings: [
        { rootId: ROOT_ID, path: fixture.rootPath },
        { rootId: ROOT_ID, path: fixture.rootPath },
      ],
    }),
    false
  )
  assert.equal(
    fixture.runtime.saveState(WS_ID, {
      ...valid,
      rootMappings: [{ rootId: 'bad/root/id', path: fixture.rootPath }],
    }),
    false
  )

  assert.equal(fixture.runtime.loadState(WS_ID), null)
  assert.deepEqual(fixture.runtime.listStates(), [])
})

test('removeState deletes the file and is ok when already missing', (t) => {
  const fixture = createFixture(t)
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )
  assert.equal(fixture.runtime.removeState(WS_ID), true)
  assert.equal(fixture.runtime.loadState(WS_ID), null)
  assert.equal(fixture.runtime.removeState(WS_ID), true)
  assert.equal(fixture.runtime.removeState('not-an-id'), false)
})

test('scan honors ignores, symlinks, size cap, and hashes correctly', async (t) => {
  const fixture = createFixture(t, { maxFileBytes: 1_000 })
  const root = fixture.rootPath
  writeFileSync(path.join(root, 'a.txt'), 'alpha')
  mkdirSync(path.join(root, 'src', 'deep'), { recursive: true })
  writeFileSync(path.join(root, 'src', 'deep', 'b.txt'), 'beta')
  mkdirSync(path.join(root, 'node_modules'))
  writeFileSync(path.join(root, 'node_modules', 'skip.js'), 'skip')
  writeFileSync(path.join(root, '.DS_Store'), 'junk')
  writeFileSync(path.join(root, 'draft.swp'), 'junk')
  writeFileSync(path.join(root, 'scratch.tmp'), 'junk')
  writeFileSync(path.join(root, 'big.bin'), 'x'.repeat(2_000))
  symlinkSync(path.join(root, 'a.txt'), path.join(root, 'link.txt'))
  mkdirSync(path.join(root, 'out'))
  writeFileSync(path.join(root, 'out', 'built.js'), 'built')
  writeFileSync(path.join(root, 'debug.log'), 'log')
  writeFileSync(path.join(root, '.gitignore'), 'out\n*.log\n')
  writeFileSync(path.join(root, 'tool.sh'), '#!/bin/sh\n')
  chmodSync(path.join(root, 'tool.sh'), 0o755)

  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, root)),
    true
  )
  const result = await fixture.runtime.scan(WS_ID)
  assert.equal(result.ok, true)
  assert.deepEqual(result.missingRoots, [])

  const byPath = new Map(result.entries.map((entry) => [entry.path, entry]))
  assert.deepEqual(
    [...byPath.keys()].sort(),
    ['.gitignore', 'a.txt', 'src/deep/b.txt', 'tool.sh']
  )
  assert.equal(byPath.get('a.txt').hash, sha256('alpha'))
  assert.equal(byPath.get('a.txt').size, 5)
  assert.equal(byPath.get('a.txt').executable, false)
  assert.equal(byPath.get('src/deep/b.txt').hash, sha256('beta'))
  assert.equal(byPath.get('src/deep/b.txt').rootId, ROOT_ID)
  assert.equal(typeof byPath.get('a.txt').mtimeMs, 'number')
  if (process.platform !== 'win32') {
    assert.equal(byPath.get('tool.sh').executable, true)
  }

  const skipped = new Map(result.skipped.map((entry) => [entry.path, entry]))
  assert.equal(skipped.get('link.txt').reason, 'symlink')
  assert.equal(skipped.get('big.bin').reason, 'too-large')
  assert.equal(skipped.get('big.bin').size, 2_000)
  assert.equal(skipped.has('node_modules/skip.js'), false)
  assert.equal(skipped.has('out/built.js'), false)
})

test('scan reports a missing root instead of deletions', async (t) => {
  const fixture = createFixture(t)
  const goneRoot = path.join(fixture.base, 'gone')
  mkdirSync(goneRoot)
  writeFileSync(path.join(fixture.rootPath, 'keep.txt'), 'keep')
  assert.equal(
    fixture.runtime.saveState(WS_ID, {
      ...linkState(WS_ID, fixture.rootPath),
      rootMappings: [
        { rootId: ROOT_ID, path: fixture.rootPath },
        { rootId: 'ffffffff', path: goneRoot },
      ],
    }),
    true
  )
  rmSync(goneRoot, { recursive: true, force: true })

  const result = await fixture.runtime.scan(WS_ID)
  assert.equal(result.ok, true)
  assert.deepEqual(result.missingRoots, ['ffffffff'])
  assert.deepEqual(
    result.entries.map((entry) => entry.path),
    ['keep.txt']
  )
})

test('scan works for bk_ states and fails for unknown ids', async (t) => {
  const fixture = createFixture(t)
  writeFileSync(path.join(fixture.rootPath, 'a.txt'), 'alpha')
  assert.equal(
    fixture.runtime.saveState(BK_ID, linkState(BK_ID, fixture.rootPath)),
    true
  )
  const result = await fixture.runtime.scan(BK_ID)
  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 1)

  const unknown = await fixture.runtime.scan(WS_ID)
  assert.equal(unknown.ok, false)
  assert.equal(typeof unknown.error, 'string')
})

test('scanPaths returns entries, deleted markers, and drops invalid paths', async (t) => {
  const fixture = createFixture(t)
  writeFileSync(path.join(fixture.rootPath, 'kept.txt'), 'kept')
  symlinkSync(
    path.join(fixture.rootPath, 'kept.txt'),
    path.join(fixture.rootPath, 'sym.txt')
  )
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )

  const result = await fixture.runtime.scanPaths(WS_ID, ROOT_ID, [
    'kept.txt',
    'missing/nested.txt',
    'gone.txt',
    '../escape.txt',
    '/absolute.txt',
    'a//b.txt',
    'sym.txt',
    'node_modules/dep.js',
  ])
  assert.equal(result.ok, true)
  const kept = result.entries.find((entry) => entry.path === 'kept.txt')
  assert.equal(kept.hash, sha256('kept'))
  assert.equal(kept.deleted, undefined)
  assert.deepEqual(
    result.entries
      .filter((entry) => entry.deleted)
      .map((entry) => entry.path)
      .sort(),
    ['gone.txt', 'missing/nested.txt']
  )
  assert.equal(
    result.entries.some((entry) =>
      ['../escape.txt', '/absolute.txt', 'a//b.txt', 'sym.txt', 'node_modules/dep.js'].includes(entry.path)
    ),
    false
  )

  const badRoot = await fixture.runtime.scanPaths(WS_ID, 'nope', ['a.txt'])
  assert.equal(badRoot.ok, false)
})

test('read returns content and flags missing/oversized files', async (t) => {
  const fixture = createFixture(t, { maxFileBytes: 100 })
  writeFileSync(path.join(fixture.rootPath, 'data.bin'), Buffer.from([0, 1, 2, 255]))
  writeFileSync(path.join(fixture.rootPath, 'big.bin'), 'x'.repeat(200))
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )

  const result = await fixture.runtime.read(WS_ID, ROOT_ID, 'data.bin')
  assert.equal(result.ok, true)
  assert.deepEqual(Buffer.from(result.base64, 'base64'), Buffer.from([0, 1, 2, 255]))
  assert.equal(result.hash, sha256(Buffer.from([0, 1, 2, 255])))
  assert.equal(result.size, 4)
  assert.equal(result.executable, false)
  assert.equal(typeof result.mtimeMs, 'number')

  const missing = await fixture.runtime.read(WS_ID, ROOT_ID, 'nope.txt')
  assert.deepEqual(missing, { ok: true, missing: true })

  const big = await fixture.runtime.read(WS_ID, ROOT_ID, 'big.bin')
  assert.equal(big.ok, false)

  const escape = await fixture.runtime.read(WS_ID, ROOT_ID, '../outside.txt')
  assert.equal(escape.ok, false)
})

test('apply writes atomically, creates parents, backs up, and sets modes', async (t) => {
  const fixture = createFixture(t)
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )

  const first = await fixture.runtime.apply(WS_ID, ROOT_ID, 'src/app/main.js', {
    base64: Buffer.from('version one').toString('base64'),
  })
  assert.equal(first.ok, true)
  assert.equal(first.hash, sha256('version one'))
  assert.equal(typeof first.mtimeMs, 'number')
  const target = path.join(fixture.rootPath, 'src', 'app', 'main.js')
  assert.equal(readFileSync(target, 'utf8'), 'version one')
  if (process.platform !== 'win32') {
    assert.equal(statSync(target).mode & 0o777, 0o644)
  }

  const backupsRoot = path.join(fixture.userDataPath, 'workspace-sync-backups')
  assert.equal(existsSync(backupsRoot), false)

  const second = await fixture.runtime.apply(WS_ID, ROOT_ID, 'src/app/main.js', {
    base64: Buffer.from('version two').toString('base64'),
    executable: true,
  })
  assert.equal(second.ok, true)
  assert.equal(readFileSync(target, 'utf8'), 'version two')
  if (process.platform !== 'win32') {
    assert.equal(statSync(target).mode & 0o777, 0o755)
  }

  const dateDirs = readdirSync(path.join(backupsRoot, WS_ID))
  assert.equal(dateDirs.length, 1)
  assert.match(dateDirs[0], /^\d{4}-\d{2}-\d{2}$/)
  const backupFile = path.join(
    backupsRoot,
    WS_ID,
    dateDirs[0],
    ROOT_ID,
    'src',
    'app',
    'main.js'
  )
  assert.equal(readFileSync(backupFile, 'utf8'), 'version one')

  // Identical content: no additional backup is taken.
  const third = await fixture.runtime.apply(WS_ID, ROOT_ID, 'src/app/main.js', {
    base64: Buffer.from('version two').toString('base64'),
  })
  assert.equal(third.ok, true)
  assert.equal(readFileSync(backupFile, 'utf8'), 'version one')

  // No stray tmp files remain next to the target.
  assert.deepEqual(
    readdirSync(path.dirname(target)).filter((name) => name.endsWith('.tmp')),
    []
  )
})

test('apply rejects containment violations and oversized payloads', async (t) => {
  const fixture = createFixture(t, { maxFileBytes: 100 })
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )
  const content = { base64: Buffer.from('x').toString('base64') }

  for (const relPath of [
    '../escape.txt',
    '..',
    '/absolute.txt',
    'a//b.txt',
    'a/./b.txt',
    'a/../b.txt',
    '',
    'a\\b.txt',
  ]) {
    const result = await fixture.runtime.apply(WS_ID, ROOT_ID, relPath, content)
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(relPath)}`)
  }

  // Symlinked ancestor directory.
  const outside = path.join(fixture.base, 'outside-target')
  mkdirSync(outside)
  symlinkSync(outside, path.join(fixture.rootPath, 'sym'))
  const viaSymlink = await fixture.runtime.apply(WS_ID, ROOT_ID, 'sym/file.txt', content)
  assert.equal(viaSymlink.ok, false)
  assert.equal(existsSync(path.join(outside, 'file.txt')), false)

  // Symlink leaf is never overwritten.
  writeFileSync(path.join(fixture.base, 'real.txt'), 'real')
  symlinkSync(
    path.join(fixture.base, 'real.txt'),
    path.join(fixture.rootPath, 'leaf.txt')
  )
  const viaLeaf = await fixture.runtime.apply(WS_ID, ROOT_ID, 'leaf.txt', content)
  assert.equal(viaLeaf.ok, false)
  assert.equal(readFileSync(path.join(fixture.base, 'real.txt'), 'utf8'), 'real')

  const tooLarge = await fixture.runtime.apply(WS_ID, ROOT_ID, 'big.bin', {
    base64: Buffer.from('x'.repeat(200)).toString('base64'),
  })
  assert.equal(tooLarge.ok, false)
  assert.equal(existsSync(path.join(fixture.rootPath, 'big.bin')), false)

  const badContent = await fixture.runtime.apply(WS_ID, ROOT_ID, 'ok.txt', {})
  assert.equal(badContent.ok, false)

  const unknownRoot = await fixture.runtime.apply(WS_ID, 'nope', 'ok.txt', content)
  assert.equal(unknownRoot.ok, false)
})

test('remove backs up, prunes empty parents, and tolerates missing files', async (t) => {
  const fixture = createFixture(t)
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )
  mkdirSync(path.join(fixture.rootPath, 'a', 'b'), { recursive: true })
  writeFileSync(path.join(fixture.rootPath, 'a', 'b', 'gone.txt'), 'bye')
  writeFileSync(path.join(fixture.rootPath, 'a', 'stays.txt'), 'stay')

  const removed = await fixture.runtime.remove(WS_ID, ROOT_ID, 'a/b/gone.txt')
  assert.deepEqual(removed, { ok: true })
  assert.equal(existsSync(path.join(fixture.rootPath, 'a', 'b')), false)
  assert.equal(existsSync(path.join(fixture.rootPath, 'a', 'stays.txt')), true)
  assert.equal(existsSync(fixture.rootPath), true)

  const backupsRoot = path.join(fixture.userDataPath, 'workspace-sync-backups')
  const dateDirs = readdirSync(path.join(backupsRoot, WS_ID))
  assert.equal(
    readFileSync(
      path.join(backupsRoot, WS_ID, dateDirs[0], ROOT_ID, 'a', 'b', 'gone.txt'),
      'utf8'
    ),
    'bye'
  )

  const again = await fixture.runtime.remove(WS_ID, ROOT_ID, 'a/b/gone.txt')
  assert.deepEqual(again, { ok: true })

  const escape = await fixture.runtime.remove(WS_ID, ROOT_ID, '../outside.txt')
  assert.equal(escape.ok, false)

  // A symlink leaf is left untouched.
  writeFileSync(path.join(fixture.base, 'linked.txt'), 'linked')
  symlinkSync(
    path.join(fixture.base, 'linked.txt'),
    path.join(fixture.rootPath, 'link.txt')
  )
  const viaLeaf = await fixture.runtime.remove(WS_ID, ROOT_ID, 'link.txt')
  assert.deepEqual(viaLeaf, { ok: true })
  assert.equal(lstatSync(path.join(fixture.rootPath, 'link.txt')).isSymbolicLink(), true)
})

test('watchers exist only for ws_ states and follow save/remove', (t) => {
  const fixture = createFixture(t)
  const otherRoot = path.join(fixture.base, 'other-root')
  mkdirSync(otherRoot)

  assert.deepEqual(fixture.runtime._internals.watchTargets(), [])
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )
  assert.equal(
    fixture.runtime.saveState(BK_ID, linkState(BK_ID, otherRoot)),
    true
  )
  const targets = fixture.runtime._internals.watchTargets()
  assert.deepEqual(
    targets.map(({ syncId, rootId }) => ({ syncId, rootId })),
    [{ syncId: WS_ID, rootId: ROOT_ID }]
  )

  assert.equal(fixture.runtime.removeState(WS_ID), true)
  assert.deepEqual(fixture.runtime._internals.watchTargets(), [])
})

test('a fresh runtime restores watchers from persisted states', (t) => {
  const fixture = createFixture(t)
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )
  fixture.runtime.dispose()

  const rebooted = createWorkspaceSyncRuntime({
    userDataPath: fixture.userDataPath,
    ignoredNames: new Set(['node_modules']),
    maxFileBytes: 1_000,
    onChanges: () => {},
  })
  t.after(() => rebooted.dispose())
  assert.deepEqual(
    rebooted._internals.watchTargets().map(({ syncId, rootId }) => ({ syncId, rootId })),
    [{ syncId: WS_ID, rootId: ROOT_ID }]
  )
  assert.equal(rebooted.loadState(WS_ID).syncId, WS_ID)
})

test('watch events debounce, coalesce, filter ignores, and collapse on null', (t) => {
  const scheduler = fakeScheduler()
  const fixture = createFixture(t, { scheduler })
  writeFileSync(path.join(fixture.rootPath, '.gitignore'), 'out\n')
  assert.equal(
    fixture.runtime.saveState(WS_ID, linkState(WS_ID, fixture.rootPath)),
    true
  )
  fixture.events.length = 0
  const emit = fixture.runtime._internals.emitWatcherEvent

  emit(WS_ID, ROOT_ID, 'a.txt')
  emit(WS_ID, ROOT_ID, path.join('src', 'b.txt'))
  emit(WS_ID, ROOT_ID, 'a.txt')
  emit(WS_ID, ROOT_ID, path.join('node_modules', 'dep.js'))
  emit(WS_ID, ROOT_ID, path.join('out', 'built.js'))
  emit(WS_ID, ROOT_ID, '.DS_Store')
  emit(WS_ID, ROOT_ID, 'draft.swp')
  emit(WS_ID, ROOT_ID, '../escape.txt')
  assert.deepEqual(fixture.events, [])

  scheduler.fireTimeouts()
  assert.deepEqual(fixture.events, [
    { syncId: WS_ID, rootId: ROOT_ID, paths: ['a.txt', 'src/b.txt'] },
  ])

  // Firing with nothing pending emits nothing more.
  scheduler.fireTimeouts()
  assert.equal(fixture.events.length, 1)

  // A null filename means "rescan this root".
  emit(WS_ID, ROOT_ID, 'c.txt')
  emit(WS_ID, ROOT_ID, null)
  scheduler.fireTimeouts()
  assert.deepEqual(fixture.events[1], {
    syncId: WS_ID,
    rootId: ROOT_ID,
    paths: [],
  })

  // Events for unknown syncs are dropped.
  emit(WS_ID_2, ROOT_ID, 'a.txt')
  scheduler.fireTimeouts()
  assert.equal(fixture.events.length, 2)
})

test('old backup date folders are pruned on runtime creation', (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'sk-sync-prune-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const userDataPath = path.join(base, 'user-data')
  const backups = path.join(userDataPath, 'workspace-sync-backups', WS_ID)
  const pad = (value) => String(value).padStart(2, '0')
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  mkdirSync(path.join(backups, '2020-01-01', ROOT_ID), { recursive: true })
  writeFileSync(path.join(backups, '2020-01-01', ROOT_ID, 'old.txt'), 'old')
  mkdirSync(path.join(backups, today, ROOT_ID), { recursive: true })
  writeFileSync(path.join(backups, today, ROOT_ID, 'new.txt'), 'new')
  mkdirSync(path.join(backups, 'not-a-date'), { recursive: true })

  const runtime = createWorkspaceSyncRuntime({
    userDataPath,
    ignoredNames: new Set(),
    onChanges: () => {},
  })
  t.after(() => runtime.dispose())

  assert.equal(existsSync(path.join(backups, '2020-01-01')), false)
  assert.equal(existsSync(path.join(backups, today, ROOT_ID, 'new.txt')), true)
  assert.equal(existsSync(path.join(backups, 'not-a-date')), true)
})

test('deviceInfo reports a cleaned hostname and the platform', (t) => {
  const fixture = createFixture(t)
  const info = fixture.runtime.deviceInfo()
  assert.equal(typeof info.label, 'string')
  assert.equal(info.label.length > 0, true)
  assert.equal(info.label.length <= 80, true)
  assert.equal(/\.local$/i.test(info.label), false)
  assert.equal(info.platform, process.platform)
})
