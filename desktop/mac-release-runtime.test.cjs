const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')
const {
  DEFAULT_RELEASE_SOURCE_REPOSITORY,
  assertEmergencyReleaseContract,
  assertRetainedReleaseSourceState,
  normalizeGitHubRepository,
  parseShipMacArgs,
  resolveReleaseSourceContract,
  selectMacDownload,
} = require('./mac-release-runtime.cjs')

test('parses the guarded Mac release arguments exactly', () => {
  assert.deepEqual(
    parseShipMacArgs([
      '--confirm-publish',
      '--reuse-build',
      '--source-snapshot=/tmp/release-source',
      '--release-source-remote=private-source',
      '--release-source-ref=refs/heads/release/desktop-0.21.8',
      '--release-source-repository=ryanwise77/statskeyapp2.0',
    ]),
    {
      prepareOnly: false,
      installOnly: false,
      confirmed: true,
      reuseBuild: true,
      allowUnpushed: false,
      sourceSnapshot: '/tmp/release-source',
      releaseSourceRemote: 'private-source',
      releaseSourceRef: 'refs/heads/release/desktop-0.21.8',
      releaseSourceRepository: 'ryanwise77/statskeyapp2.0',
      emergencyReleaseReason: '',
    }
  )
})

test('rejects unknown, duplicate, and missing-value release arguments', () => {
  assert.throws(
    () => parseShipMacArgs(['--unknown']),
    /Unknown release argument/
  )
  assert.throws(
    () => parseShipMacArgs(['--prepare-only', '--prepare-only']),
    /Duplicate release flag/
  )
  assert.throws(
    () => parseShipMacArgs(['--source-snapshot', '--confirm-publish']),
    /requires a value/
  )
})

test('resolves an explicit retained private release-source contract', () => {
  assert.deepEqual(
    resolveReleaseSourceContract(
      {
        releaseSourceRemote: 'private-source',
        releaseSourceRef: 'refs/heads/release/desktop-0.21.8',
        releaseSourceRepository: '',
      },
      {}
    ),
    {
      remote: 'private-source',
      ref: 'refs/heads/release/desktop-0.21.8',
      repository: DEFAULT_RELEASE_SOURCE_REPOSITORY,
    }
  )
})

test('supports environment configuration and exact GitHub repository URLs', () => {
  assert.deepEqual(
    resolveReleaseSourceContract(
      {},
      {
        STATSKEY_RELEASE_SOURCE_REMOTE: 'source',
        STATSKEY_RELEASE_SOURCE_REF: 'refs/heads/releases/mac',
        STATSKEY_RELEASE_SOURCE_REPOSITORY:
          'git@github.com:Owner/Private-Desktop.git',
      }
    ),
    {
      remote: 'source',
      ref: 'refs/heads/releases/mac',
      repository: 'owner/private-desktop',
    }
  )
  assert.equal(
    normalizeGitHubRepository('https://github.com/Owner/Repo.git'),
    'owner/repo'
  )
})

test('fails closed when retained source configuration is missing or ambiguous', () => {
  assert.throws(
    () => resolveReleaseSourceContract({}, {}),
    /requires a retained private release source/
  )
  assert.throws(
    () =>
      resolveReleaseSourceContract(
        {
          releaseSourceRemote: 'https://github.com/owner/repo',
          releaseSourceRef: 'refs/heads/release/mac',
        },
        {}
      ),
    /configured Git remote/
  )
  assert.throws(
    () =>
      resolveReleaseSourceContract(
        {
          releaseSourceRemote: 'private-source',
          releaseSourceRef: 'release/mac',
        },
        {}
      ),
    /full retained branch ref/
  )
})

test('does not accept --allow-unpushed without an explicit emergency reason', () => {
  assert.throws(
    () =>
      assertEmergencyReleaseContract({
        allowUnpushed: true,
        emergencyReleaseReason: '',
      }),
    /also requires --emergency-release-reason/
  )
  assert.equal(
    assertEmergencyReleaseContract({
      allowUnpushed: true,
      emergencyReleaseReason: 'Private Git host is unavailable',
    }),
    'Private Git host is unavailable'
  )
})

test('requires a clean detached source reachable from the exact retained repository', () => {
  const validState = {
    status: '',
    branch: 'HEAD',
    remoteUrl: 'git@github.com:ryanwise77/statskeyapp2.0.git',
    remote: 'private-source',
    ref: 'refs/heads/release/desktop-0.21.8',
    repository: DEFAULT_RELEASE_SOURCE_REPOSITORY,
    sourceCommit: 'a'.repeat(40),
    retainedCommit: 'b'.repeat(40),
    isAncestor: true,
  }
  assert.doesNotThrow(() => assertRetainedReleaseSourceState(validState))
  assert.throws(
    () =>
      assertRetainedReleaseSourceState({
        ...validState,
        remoteUrl: 'https://github.com/ryanwise77/statskey-website.git',
      }),
    /not ryanwise77\/statskeyapp2\.0/
  )
  assert.throws(
    () =>
      assertRetainedReleaseSourceState({
        ...validState,
        isAncestor: false,
      }),
    /not reachable from retained private ref/
  )
  assert.throws(
    () =>
      assertRetainedReleaseSourceState({
        ...validState,
        branch: 'main',
      }),
    /must be a detached snapshot/
  )
})

test('reads the fetch URL with the Git-compatible default get-url form', () => {
  const source = readFileSync(
    require.resolve('./ship-mac-update.cjs'),
    'utf8'
  )
  const retainedSourceBody = source.slice(
    source.indexOf('function assertRetainedReleaseSource'),
    source.indexOf('async function waitForWebsiteRelease')
  )
  assert.match(
    retainedSourceBody,
    /git\(snapshotRoot, \[\s*'remote',\s*'get-url',\s*releaseSource\.remote,?\s*\]\)/
  )
  assert.doesNotMatch(retainedSourceBody, /'get-url',\s*'--fetch'/)
})

test('selects the installer matching the current Mac architecture', () => {
  const manifest = {
    version: '1.2.3',
    downloads: {
      'mac-arm64': {
        file: 'StatsKey-1.2.3-mac-arm64.dmg',
        bytes: 123,
        sha256: 'a'.repeat(64),
        url: 'https://example.test/arm64.dmg',
      },
      'mac-x64': {
        file: 'StatsKey-1.2.3-mac-x64.dmg',
        bytes: 456,
        sha256: 'b'.repeat(64),
        url: 'https://example.test/x64.dmg',
      },
    },
  }
  assert.equal(selectMacDownload(manifest, 'arm64').bytes, 123)
  assert.equal(selectMacDownload(manifest, 'x64').bytes, 456)
})

test('rejects unsupported architectures and unsafe installer paths', () => {
  assert.throws(() => selectMacDownload({}, 'ia32'), /Unsupported/)
  assert.throws(
    () =>
      selectMacDownload(
        {
          version: '1.2.3',
          downloads: {
            'mac-arm64': {
              file: '../StatsKey.dmg',
              bytes: 123,
              sha256: 'a'.repeat(64),
            },
          },
        },
        'arm64'
      ),
    /valid mac-arm64 download/
  )
})
