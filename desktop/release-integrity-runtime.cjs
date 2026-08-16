const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} = require('node:fs')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')

const SOURCE_SNAPSHOT_ENV = 'STATSKEY_RELEASE_SOURCE_SNAPSHOT'
const REQUIRED_RELEASE_SOURCE_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'public/downloads/statskey/updates.json',
  'public/downloads/statskey/index.html',
  'desktop/package.json',
  'desktop/package-lock.json',
  'desktop/after-pack.cjs',
  'desktop/main.cjs',
  'desktop/preload.cjs',
  'desktop/update-runtime.cjs',
  'desktop/workspace-index-worker.cjs',
  'desktop/workspace-file-search-worker.cjs',
  'desktop/workspace-search-runtime.cjs',
  'desktop/workspace-cache-key-runtime.cjs',
  'desktop/window-reveal-runtime.cjs',
  'desktop/provider-runtime.cjs',
  'desktop/provider-run-guard.cjs',
  'desktop/provider-vault-runtime.cjs',
  'desktop/provider-vault-crypto.cjs',
  'desktop/integration-vault-runtime.cjs',
  'desktop/safe-storage-runtime.cjs',
  'desktop/workspace-binding-runtime.cjs',
  'desktop/workspace-checkpoint-runtime.cjs',
  'desktop/mcp-runtime.cjs',
  'desktop/mcp-oauth-runtime.cjs',
  'desktop/controlled-browser.cjs',
  'desktop/controlled-applications.cjs',
  'desktop/terminal-runtime.cjs',
  'desktop/child-process-runtime.cjs',
  'desktop/device-control-runtime.cjs',
  'desktop/founder-runtime.cjs',
  'desktop/git-runtime.cjs',
  'desktop/approval-policy.cjs',
  'desktop/preferences-runtime.cjs',
  'desktop/self-edit-runtime.cjs',
  'desktop/calendar-feed-runtime.cjs',
  'desktop/workspace-runtime.cjs',
  'desktop/prepare-node-pty.cjs',
  'desktop/offline.html',
  'desktop/publish-update.cjs',
  'desktop/release-integrity-runtime.cjs',
  'desktop/release-notes-runtime.cjs',
  'desktop/publish-recovery-runtime.cjs',
  'desktop/windows-release-runtime.cjs',
  'desktop/assets/AppIcon-1024.png',
])
const LAUNCHER_PARITY_FILES = Object.freeze([
  'desktop/publish-update.cjs',
  'desktop/release-integrity-runtime.cjs',
])

function sourceSnapshotArgument(argv, env) {
  const commandLineValues = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--source-snapshot') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--source-snapshot requires a directory path.')
      }
      commandLineValues.push(value)
      index += 1
      continue
    }
    if (argument.startsWith('--source-snapshot=')) {
      commandLineValues.push(argument.slice('--source-snapshot='.length))
    }
  }

  const normalizedCommandLineValues = commandLineValues
    .map((value) => value.trim())
    .filter(Boolean)
  const commandLineValue = normalizedCommandLineValues[0] || ''
  if (
    normalizedCommandLineValues.some(
      (value) => !sameLocalPath(value, commandLineValue)
    )
  ) {
    throw new Error('Conflicting --source-snapshot values were supplied.')
  }
  const environmentValue = String(env[SOURCE_SNAPSHOT_ENV] || '').trim()
  if (
    commandLineValue &&
    environmentValue &&
    !sameLocalPath(commandLineValue, environmentValue)
  ) {
    throw new Error(
      `--source-snapshot and ${SOURCE_SNAPSHOT_ENV} must identify the same directory.`
    )
  }
  const requested = commandLineValue || environmentValue
  if (!requested || requested.includes('\0')) {
    throw new Error(
      'Real publishing requires --source-snapshot <path> or ' +
        `${SOURCE_SNAPSHOT_ENV}. Use an explicit clean, detached local/private ` +
        'Git snapshot; the working checkout is never an implicit release source.'
    )
  }
  return requested
}

function resolveReleaseSourceSnapshot({
  argv = process.argv.slice(2),
  env = process.env,
  invocationRoot,
  requiredFiles = REQUIRED_RELEASE_SOURCE_FILES,
  parityFiles = LAUNCHER_PARITY_FILES,
} = {}) {
  if (!invocationRoot) throw new Error('The publisher invocation root is required.')
  const requested = sourceSnapshotArgument(argv, env)
  const root = canonicalDirectory(requested, 'source snapshot')
  const activeRoot = canonicalDirectory(invocationRoot, 'publisher checkout')
  const sourceCommit = inspectSnapshot(root, requiredFiles)
  if (!sameLocalPath(root, activeRoot)) {
    assertLauncherParity(activeRoot, root, parityFiles)
  }
  return Object.freeze({
    root,
    desktopRoot: path.join(root, 'desktop'),
    invocationRoot: activeRoot,
    sourceCommit,
    requiredFiles: Object.freeze([...requiredFiles]),
    parityFiles: Object.freeze([...parityFiles]),
  })
}

function assertReleaseSourceUnchanged(context) {
  if (!context || typeof context !== 'object') {
    throw new Error('Release source context is required.')
  }
  const currentCommit = inspectSnapshot(context.root, context.requiredFiles)
  if (currentCommit !== context.sourceCommit) {
    throw new Error(
      'The release source commit changed after preflight. Refusing to publish.'
    )
  }
  if (!sameLocalPath(context.root, context.invocationRoot)) {
    assertLauncherParity(
      context.invocationRoot,
      context.root,
      context.parityFiles
    )
  }
  return currentCommit
}

function assertReusableReleaseManifest({
  manifestPath,
  version,
  sourceCommit,
}) {
  if (!existsSync(manifestPath)) {
    throw new Error(
      '--reuse-build requires the existing release manifest created before ' +
        'a failed upload. Refusing to reuse unpinned build output.'
    )
  }
  const existing = readReleaseManifest(manifestPath)
  if (
    existing.version !== version ||
    existing.sourceCommit !== sourceCommit ||
    typeof existing.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(existing.publishedAt))
  ) {
    throw new Error(
      'The reused release manifest does not pin this exact version and source ' +
        'commit. Refusing to reuse build output.'
    )
  }
  return existing
}

function inspectSnapshot(root, requiredFiles) {
  canonicalDirectory(
    gitText(root, ['rev-parse', '--show-toplevel']),
    'Git worktree root'
  )
  // Git is authoritative about whether -C is the worktree root. Comparing its
  // printed path to Node's realpath is not portable on Windows, where the same
  // directory can be reported with a short-name, regular, or namespaced path.
  // A nonempty prefix proves the requested snapshot is inside, not at, the
  // worktree root and therefore remains fail-closed.
  if (gitText(root, ['rev-parse', '--show-prefix']) !== '') {
    throw new Error('The release source must point to the Git worktree root.')
  }

  const symbolicHead = git(root, ['symbolic-ref', '--quiet', 'HEAD'])
  if (symbolicHead.status === 0) {
    throw new Error(
      'The release source must be detached at an immutable commit, not attached to a branch.'
    )
  }
  if (symbolicHead.status !== 1) {
    throw new Error('Could not verify that the release source is detached.')
  }

  const sourceCommit = gitText(root, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ]).toLowerCase()
  if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) {
    throw new Error('The release source does not resolve to an exact commit.')
  }

  const status = git(root, [
    '-c',
    'core.quotepath=false',
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none',
    '--',
    '.',
  ])
  if (status.status !== 0) {
    throw new Error('Could not verify release source cleanliness.')
  }
  if (status.stdout.length > 0) {
    throw new Error(
      'The release source contains tracked or untracked changes. Refusing to publish from a mutable tree.'
    )
  }

  for (const relativePath of requiredFiles) {
    assertCommittedRegularFile(root, relativePath)
  }
  return sourceCommit
}

function assertCommittedRegularFile(root, relativePath) {
  const normalized = path.posix.normalize(String(relativePath).replaceAll('\\', '/'))
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error('Release source file paths must remain inside the snapshot.')
  }
  const absolutePath = path.join(root, ...normalized.split('/'))
  if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
    throw new Error(`Required release source is missing: ${normalized}`)
  }

  const tracked = git(root, [
    'ls-files',
    '--error-unmatch',
    '--',
    normalized,
  ])
  if (tracked.status !== 0) {
    throw new Error(`Required release source is not committed: ${normalized}`)
  }
  const indexState = gitText(root, ['ls-files', '-v', '--', normalized])
  if (!indexState.startsWith('H ')) {
    throw new Error(
      `Required release source has mutable index flags: ${normalized}`
    )
  }

  const committedBlob = gitText(root, ['rev-parse', `HEAD:${normalized}`])
  const workingBlob = gitText(root, ['hash-object', '--', absolutePath])
  if (committedBlob !== workingBlob) {
    throw new Error(
      `Required release source differs from its commit: ${normalized}`
    )
  }
}

function assertLauncherParity(activeRoot, sourceRoot, parityFiles) {
  for (const relativePath of parityFiles) {
    const activePath = path.join(activeRoot, ...relativePath.split('/'))
    const sourcePath = path.join(sourceRoot, ...relativePath.split('/'))
    if (
      !existsSync(activePath) ||
      !existsSync(sourcePath) ||
      !lstatSync(activePath).isFile() ||
      !lstatSync(sourcePath).isFile() ||
      sha256(activePath) !== sha256(sourcePath)
    ) {
      throw new Error(
        'The publisher launcher differs from the committed source snapshot. ' +
          'Run the publisher from that snapshot or make the release tooling byte-identical.'
      )
    }
  }
}

function writeOrReuseReleaseManifest({
  manifestPath,
  manifestBase,
  reuseBuild,
  now = () => new Date(),
}) {
  if (
    !manifestBase ||
    !/^[0-9a-f]{40,64}$/.test(String(manifestBase.sourceCommit || ''))
  ) {
    throw new Error('Release manifest requires an exact sourceCommit.')
  }

  if (reuseBuild) {
    const existing = assertReusableReleaseManifest({
      manifestPath,
      version: manifestBase.version,
      sourceCommit: manifestBase.sourceCommit,
    })
    const { publishedAt, ...existingBase } = existing
    if (
      typeof publishedAt !== 'string' ||
      !Number.isFinite(Date.parse(publishedAt)) ||
      !isDeepStrictEqual(existingBase, manifestBase)
    ) {
      throw new Error(
        'The reused release manifest no longer matches the source commit, ' +
          'local build, and release notes. Refusing to change an immutable release in place.'
      )
    }
    return { status: 'reused', manifest: existing }
  }

  const { version, ...rest } = manifestBase
  const publishedAt = now().toISOString()
  const manifest = { version, publishedAt, ...rest }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  })
  return { status: 'written', manifest }
}

function readReleaseManifest(manifestPath) {
  let existing
  try {
    existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error(`Invalid reused release manifest: ${manifestPath}`)
  }
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new Error(`Invalid reused release manifest: ${manifestPath}`)
  }
  return existing
}

function canonicalDirectory(value, label) {
  let candidate
  try {
    candidate = realpathSync(path.resolve(String(value).trim()))
  } catch {
    throw new Error(`The ${label} must be an existing local directory.`)
  }
  if (!lstatSync(candidate).isDirectory()) {
    throw new Error(`The ${label} must be an existing local directory.`)
  }
  return candidate
}

function sameLocalPath(
  left,
  right,
  platform = process.platform,
  statPath = lstatSync
) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const leftPath = pathApi.normalize(pathApi.resolve(String(left)))
  const rightPath = pathApi.normalize(pathApi.resolve(String(right)))
  if (leftPath === rightPath) return true
  const leftComparisonPath =
    platform === 'win32' ? windowsComparisonPath(leftPath) : leftPath
  const rightComparisonPath =
    platform === 'win32' ? windowsComparisonPath(rightPath) : rightPath
  if (
    platform !== 'win32' ||
    leftComparisonPath.toLowerCase() !== rightComparisonPath.toLowerCase()
  ) {
    return false
  }

  // Node can return an extended-length path while Git reports the same
  // worktree with a regular drive or UNC path. Windows paths are also
  // case-insensitive by default. Confirm filesystem identity before accepting
  // either spelling difference so a case-sensitive directory or lookalike
  // namespace cannot bypass source or parity checks.
  try {
    const leftStat = statPath(leftPath, { bigint: true })
    const rightStat = statPath(rightPath, { bigint: true })
    const hasStableIdentity =
      leftStat.dev !== 0n ||
      leftStat.ino !== 0n ||
      rightStat.dev !== 0n ||
      rightStat.ino !== 0n
    return (
      hasStableIdentity &&
      leftStat.dev === rightStat.dev &&
      leftStat.ino === rightStat.ino
    )
  } catch {
    return false
  }
}

function windowsComparisonPath(value) {
  const extendedPrefix = '\\\\?\\'
  const extendedUncPrefix = `${extendedPrefix}UNC\\`
  const lowerValue = value.toLowerCase()
  if (lowerValue.startsWith(extendedUncPrefix.toLowerCase())) {
    return `\\\\${value.slice(extendedUncPrefix.length)}`
  }
  if (!lowerValue.startsWith(extendedPrefix)) return value

  const withoutPrefix = value.slice(extendedPrefix.length)
  return /^[A-Za-z]:\\/.test(withoutPrefix) ? withoutPrefix : value
}

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], {
    encoding: 'buffer',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function gitText(root, args) {
  const result = git(root, args)
  if (result.status !== 0) {
    throw new Error('Could not verify the committed release source.')
  }
  return result.stdout.toString('utf8').trim()
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

module.exports = {
  LAUNCHER_PARITY_FILES,
  REQUIRED_RELEASE_SOURCE_FILES,
  SOURCE_SNAPSHOT_ENV,
  assertReleaseSourceUnchanged,
  assertReusableReleaseManifest,
  resolveReleaseSourceSnapshot,
  sameLocalPath,
  sourceSnapshotArgument,
  writeOrReuseReleaseManifest,
}
