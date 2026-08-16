const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  SOURCE_SNAPSHOT_ENV,
  assertReleaseSourceUnchanged,
  assertReusableReleaseManifest,
  resolveReleaseSourceSnapshot,
  sameLocalPath,
  sourceSnapshotArgument,
  writeOrReuseReleaseManifest,
} = require('./release-integrity-runtime.cjs')

const TEST_SOURCE_FILES = [
  'desktop/publish-update.cjs',
  'desktop/release-integrity-runtime.cjs',
]

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function repository({ detached = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'statskey-release-source-'))
  mkdirSync(path.join(root, 'desktop'), { recursive: true })
  writeFileSync(path.join(root, 'desktop', 'publish-update.cjs'), 'publisher\n')
  writeFileSync(
    path.join(root, 'desktop', 'release-integrity-runtime.cjs'),
    'integrity\n'
  )
  writeFileSync(path.join(root, 'application.txt'), 'source\n')
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.email', 'release-test@statskey.invalid')
  git(root, 'config', 'user.name', 'StatsKey release test')
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'immutable source')
  const commit = git(root, 'rev-parse', 'HEAD')
  if (detached) git(root, 'checkout', '--quiet', '--detach', commit)
  return { root, commit }
}

function resolveFixture(root) {
  return resolveReleaseSourceSnapshot({
    argv: ['--source-snapshot', root],
    env: {},
    invocationRoot: root,
    requiredFiles: TEST_SOURCE_FILES,
    parityFiles: TEST_SOURCE_FILES,
  })
}

test('requires one explicit source snapshot without exposing ambient values', () => {
  assert.throws(
    () => sourceSnapshotArgument([], { PRIVATE_TOKEN: 'do-not-print' }),
    /requires --source-snapshot/
  )
  assert.equal(
    sourceSnapshotArgument([], { [SOURCE_SNAPSHOT_ENV]: '/private/release' }),
    '/private/release'
  )
  assert.equal(
    sourceSnapshotArgument(
      [
        '--source-snapshot',
        '/private/release',
        '--source-snapshot=/private/release',
      ],
      {}
    ),
    '/private/release'
  )
  assert.throws(
    () =>
      sourceSnapshotArgument(
        ['--source-snapshot', '/one'],
        { [SOURCE_SNAPSHOT_ENV]: '/two', PRIVATE_TOKEN: 'do-not-print' }
      ),
    (error) => {
      assert.doesNotMatch(error.message, /do-not-print/)
      return true
    }
  )
})

test('compares Windows path spelling safely without making POSIX case-insensitive', () => {
  const identity = new Map([
    ['C:\\Build\\StatsKey', { dev: 7n, ino: 11n }],
    ['c:\\build\\statskey', { dev: 7n, ino: 11n }],
  ])
  const statPath = (candidate) => identity.get(candidate)
  assert.equal(
    sameLocalPath(
      'C:\\Build\\StatsKey',
      'c:/build/statskey',
      'win32',
      statPath
    ),
    true
  )
  assert.equal(
    sameLocalPath(
      'C:\\Build\\StatsKey',
      'c:/build/statskey',
      'win32',
      (candidate) =>
        candidate.startsWith('C:')
          ? { dev: 7n, ino: 11n }
          : { dev: 7n, ino: 12n }
    ),
    false
  )
  assert.equal(
    sameLocalPath('/Build/StatsKey', '/build/statskey', 'linux'),
    false
  )
})

test('matches Windows extended drive and UNC paths only with filesystem identity', () => {
  const sharedIdentity = () => ({ dev: 7n, ino: 11n })
  assert.equal(
    sameLocalPath(
      '\\\\?\\D:\\Build\\StatsKey',
      'd:/build/statskey',
      'win32',
      sharedIdentity
    ),
    true
  )
  assert.equal(
    sameLocalPath(
      '\\\\?\\UNC\\Server\\Share\\StatsKey',
      '\\\\server\\share\\statskey',
      'win32',
      sharedIdentity
    ),
    true
  )
  assert.equal(
    sameLocalPath(
      '\\\\?\\D:\\Build\\StatsKey',
      'd:/build/statskey',
      'win32',
      (candidate) =>
        candidate.startsWith('\\\\?\\')
          ? { dev: 7n, ino: 11n }
          : { dev: 7n, ino: 12n }
    ),
    false
  )
  assert.equal(
    sameLocalPath(
      '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\StatsKey',
      'D:\\StatsKey',
      'win32',
      sharedIdentity
    ),
    false
  )
})

test('still rejects a snapshot subdirectory instead of the Git worktree root', () => {
  const { root } = repository()
  assert.throws(
    () =>
      resolveReleaseSourceSnapshot({
        argv: ['--source-snapshot', path.join(root, 'desktop')],
        env: {},
        invocationRoot: root,
        requiredFiles: TEST_SOURCE_FILES,
        parityFiles: TEST_SOURCE_FILES,
      }),
    /must point to the Git worktree root/
  )
})

test('accepts a clean detached snapshot and returns its exact commit', () => {
  const { root, commit } = repository()
  const context = resolveFixture(root)
  assert.equal(context.root, realpathSync(root))
  assert.equal(context.sourceCommit, commit)
  assert.equal(context.desktopRoot, path.join(realpathSync(root), 'desktop'))
})

test('rejects a dirty snapshot before release work can begin', () => {
  const { root } = repository()
  appendFileSync(path.join(root, 'application.txt'), 'mutable\n')
  assert.throws(
    () => resolveFixture(root),
    /tracked or untracked changes/
  )
})

test('rechecks source cleanliness after preflight', () => {
  const { root } = repository()
  const context = resolveFixture(root)
  appendFileSync(path.join(root, 'application.txt'), 'changed later\n')
  assert.throws(
    () => assertReleaseSourceUnchanged(context),
    /tracked or untracked changes/
  )
})

test('rejects a clean branch checkout because HEAD can move', () => {
  const { root } = repository({ detached: false })
  assert.throws(() => resolveFixture(root), /must be detached/)
})

test('records sourceCommit and refuses reuse from a different commit', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-manifest-'))
  const manifestPath = path.join(directory, 'release-manifest.json')
  const sourceCommit = 'a'.repeat(40)
  const manifestBase = {
    version: '1.2.3',
    sourceCommit,
    preview: false,
    notes: ['Verified release.'],
    artifacts: {},
    downloads: {},
  }
  const written = writeOrReuseReleaseManifest({
    manifestPath,
    manifestBase,
    reuseBuild: false,
    now: () => new Date('2026-08-13T12:00:00.000Z'),
  })
  assert.equal(written.status, 'written')
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), {
    version: '1.2.3',
    publishedAt: '2026-08-13T12:00:00.000Z',
    sourceCommit,
    preview: false,
    notes: ['Verified release.'],
    artifacts: {},
    downloads: {},
  })

  assert.equal(
    assertReusableReleaseManifest({
      manifestPath,
      version: '1.2.3',
      sourceCommit,
    }).sourceCommit,
    sourceCommit
  )
  assert.equal(
    writeOrReuseReleaseManifest({
      manifestPath,
      manifestBase,
      reuseBuild: true,
    }).status,
    'reused'
  )
  assert.throws(
    () =>
      writeOrReuseReleaseManifest({
        manifestPath,
        manifestBase: { ...manifestBase, sourceCommit: 'b'.repeat(40) },
        reuseBuild: true,
      }),
    /source commit/
  )
  assert.throws(
    () =>
      assertReusableReleaseManifest({
        manifestPath: path.join(directory, 'missing-manifest.json'),
        version: '1.2.3',
        sourceCommit,
      }),
    /unpinned build output/
  )
})

test('requires an exact commit without recording a snapshot path or secrets', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-manifest-'))
  const manifestPath = path.join(directory, 'release-manifest.json')
  assert.throws(
    () =>
      writeOrReuseReleaseManifest({
        manifestPath,
        manifestBase: { version: '1.2.3', sourceCommit: 'main' },
        reuseBuild: false,
      }),
    /exact sourceCommit/
  )
  const ambientSecret = `secret-${Date.now()}`
  process.env.STATSKEY_TEST_PRIVATE_TOKEN = ambientSecret
  try {
    writeOrReuseReleaseManifest({
      manifestPath,
      manifestBase: {
        version: '1.2.3',
        sourceCommit: 'c'.repeat(40),
        artifacts: {},
        downloads: {},
      },
      reuseBuild: false,
      now: () => new Date('2026-08-13T12:00:00.000Z'),
    })
    const serialized = readFileSync(manifestPath, 'utf8')
    assert.doesNotMatch(serialized, new RegExp(ambientSecret))
    assert.doesNotMatch(serialized, new RegExp(directory.replaceAll('/', '\\/')))
  } finally {
    delete process.env.STATSKEY_TEST_PRIVATE_TOKEN
  }
})
