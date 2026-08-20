'use strict'

const fs = require('node:fs/promises')
const { constants: fsConstants } = require('node:fs')
const path = require('node:path')
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto')
const { spawn } = require('node:child_process')
const { runBoundedChildProcess } = require('./child-process-runtime.cjs')
const {
  digestFileHandle,
} = require('./fleet-artifact-uploader.cjs')
const {
  normalizeExecution,
  normalizeRepositoryIdentity,
} = require('./fleet-runtime.cjs')

const DEFAULT_ALLOWED_REPOSITORY_HOSTS = Object.freeze([
  'github.com',
  'origin.cursor.com',
])
const DEFAULT_PROCESS_TIMEOUT_MS = 60 * 60 * 1000
const GIT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_PROCESS_OUTPUT_CHARACTERS = 200_000
const MAX_STALE_WORKSPACE_AGE_MS = 24 * 60 * 60 * 1000
const MAX_WORKSPACE_ENTRIES = 1_000
const MAX_ARTIFACT_SPOOL_ENTRIES = 32
const MAX_ARTIFACT_SPOOL_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ARTIFACT_SPOOL_BYTES = 16 * 1024 * 1024 * 1024
const MAX_WINDOWS_PROCESS_OWNER_PAYLOAD_CHARACTERS = 24_000
const MAX_XCODE_ARTIFACT_ENTRIES = 50_000
const MAX_XCODE_ARTIFACT_SOURCE_BYTES = 8 * 1024 * 1024 * 1024
const MAX_PACKAGED_ARTIFACT_BYTES = 1024 * 1024 * 1024
const PROCESS_STARTED_UNIX_MILLISECONDS = Math.floor(
  Date.now() - process.uptime() * 1_000
)
const MAX_LEASE_AUTHORITY_LIFETIME_MS = 12 * 60 * 60_000
const POSIX_PROCESS_OWNER_MODE = '--statskey-fleet-process-owner'
const POSIX_PROCESS_REAPER_MODE = '--statskey-fleet-process-reaper'

class FleetWorkerAdapterError extends Error {
  constructor(message, {
    code = 'worker_adapter_failed',
    retryable = false,
    result = null,
  } = {}) {
    super(message)
    this.name = 'FleetWorkerAdapterError'
    this.code = code
    this.retryable = retryable
    this.result = result
  }
}

class FleetLeaseAuthorityStore {
  constructor({
    directory,
    fsImpl = fs,
    now = Date.now,
    randomToken = () => randomBytes(32).toString('base64url'),
    randomAuthorityKey = () => randomBytes(32).toString('base64url'),
    platform = process.platform,
  } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      throw new TypeError('Fleet lease authority directory must be absolute.')
    }
    this.directory = path.resolve(directory)
    this.fs = fsImpl
    this.now = now
    this.randomToken = randomToken
    this.randomAuthorityKey = randomAuthorityKey
    this.platform = platform
    this.active = null
    this.ownerLockPath = path.join(this.directory, 'worker-owner.lock')
  }

  async assertOwnerAvailable() {
    await this.fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    let handle
    try {
      handle = await this.fs.open(
        this.ownerLockPath,
        Number(fsConstants.O_RDWR) | Number(fsConstants.O_CREAT),
        0o600
      )
      await handle.sync()
    } catch (error) {
      const wrapped = leaseAuthorityError(
        'A previous Fleet process owner is still active.'
      )
      wrapped.cause = error
      throw wrapped
    } finally {
      await handle?.close().catch(() => {})
    }
    return true
  }

  async activate({ leaseId, expiresAt, deadlineAt }) {
    if (this.active) {
      throw leaseAuthorityError(
        'Another Fleet lease authority is still active.'
      )
    }
    await this.assertOwnerAvailable()
    const now = Number(this.now())
    const expiresUnixMilliseconds = validAuthorityTime(expiresAt)
    const requestedDeadlineUnixMilliseconds = validAuthorityTime(deadlineAt)
    const deadlineUnixMilliseconds = Math.min(
      requestedDeadlineUnixMilliseconds,
      now + MAX_LEASE_AUTHORITY_LIFETIME_MS
    )
    if (
      !/^lease_[a-f0-9]{32}$/.test(String(leaseId || '')) ||
      !Number.isSafeInteger(now) ||
      expiresUnixMilliseconds <= now ||
      requestedDeadlineUnixMilliseconds <= now ||
      deadlineUnixMilliseconds < expiresUnixMilliseconds
    ) {
      throw leaseAuthorityError('The Fleet lease authority is invalid.')
    }
    const token = String(this.randomToken() || '')
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
      throw leaseAuthorityError('The Fleet lease authority token is invalid.')
    }
    const authorityKey = String(this.randomAuthorityKey() || '')
    const authorityKeyBytes = Buffer.from(authorityKey, 'base64url')
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(authorityKey) ||
      authorityKeyBytes.length !== 32 ||
      authorityKeyBytes.toString('base64url') !== authorityKey
    ) {
      throw leaseAuthorityError('The Fleet lease signing key is invalid.')
    }
    const descriptor = Object.freeze({
      leaseId,
      token,
      authorityKey,
      filePath: path.join(this.directory, `${leaseId}.authority`),
      ownerLockPath: this.ownerLockPath,
      maximumDeadlineUnixMilliseconds: deadlineUnixMilliseconds,
    })
    await this.write(descriptor, {
      expiresUnixMilliseconds,
      deadlineUnixMilliseconds,
    })
    this.active = descriptor
    return descriptor
  }

  async renew({ leaseId, expiresAt, deadlineAt }) {
    const active = this.requireActive(leaseId)
    const now = Number(this.now())
    const expiresUnixMilliseconds = validAuthorityTime(expiresAt)
    const requestedDeadline = validAuthorityTime(deadlineAt)
    const deadlineUnixMilliseconds = Math.min(
      requestedDeadline,
      active.maximumDeadlineUnixMilliseconds
    )
    if (
      !Number.isSafeInteger(now) ||
      expiresUnixMilliseconds <= now ||
      deadlineUnixMilliseconds < expiresUnixMilliseconds
    ) {
      throw leaseAuthorityError(
        'The renewed Fleet lease authority is invalid.'
      )
    }
    await this.write(active, {
      expiresUnixMilliseconds,
      deadlineUnixMilliseconds,
    })
    return active
  }

  current(leaseId = this.active?.leaseId) {
    if (!this.active || this.active.leaseId !== leaseId) return null
    return this.active
  }

  async clear(leaseId) {
    const active = this.requireActive(leaseId)
    let removed = false
    try {
      await this.fs.unlink(active.filePath)
      removed = true
      await fsyncAuthorityDirectory(this.fs, this.directory, this.platform)
    } finally {
      if (removed) this.active = null
    }
  }

  requireActive(leaseId) {
    if (!this.active || this.active.leaseId !== leaseId) {
      throw leaseAuthorityError('The Fleet lease authority is not active.')
    }
    return this.active
  }

  async write(
    descriptor,
    { expiresUnixMilliseconds, deadlineUnixMilliseconds }
  ) {
    await this.fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${descriptor.filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
    const fields = [
      'statskey-fleet-authority-v1',
      descriptor.leaseId,
      descriptor.token,
      String(expiresUnixMilliseconds),
      String(deadlineUnixMilliseconds),
    ]
    const signature = createHmac(
      'sha256',
      Buffer.from(descriptor.authorityKey, 'base64url')
    )
      .update(fields.join('\n'))
      .digest('base64url')
    const contents = [...fields, signature].join('\n')
    let handle = null
    let renamed = false
    try {
      handle = await this.fs.open(
        temporaryPath,
        Number(fsConstants.O_WRONLY) |
          Number(fsConstants.O_CREAT) |
          Number(fsConstants.O_EXCL),
        0o600
      )
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await this.fs.rename(temporaryPath, descriptor.filePath)
      renamed = true
      await this.fs.chmod(descriptor.filePath, 0o600)
      await fsyncAuthorityPath(this.fs, descriptor.filePath, this.platform)
      await fsyncAuthorityDirectory(this.fs, this.directory, this.platform)
    } catch (error) {
      await handle?.close().catch(() => {})
      if (!renamed) await this.fs.unlink(temporaryPath).catch(() => {})
      const wrapped = leaseAuthorityError(
        'The Fleet lease authority could not be persisted.'
      )
      wrapped.cause = error
      throw wrapped
    }
  }
}

function validAuthorityTime(value) {
  const milliseconds =
    typeof value === 'number' ? Number(value) : Date.parse(String(value || ''))
  return Number.isSafeInteger(milliseconds) ? milliseconds : Number.NaN
}

async function fsyncAuthorityPath(fsImpl, filePath, platform) {
  // Windows requires a writable handle for fsync (FlushFileBuffers); an
  // O_RDONLY handle fails with EPERM there. POSIX fsyncs read-only handles.
  const handle = platform === 'win32'
    ? await fsImpl.open(filePath, 'r+')
    : await fsImpl.open(filePath, Number(fsConstants.O_RDONLY))
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function fsyncAuthorityDirectory(fsImpl, directory, platform) {
  try {
    await fsyncAuthorityPath(fsImpl, directory, platform)
  } catch (error) {
    if (
      platform === 'win32' &&
      ['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'EPERM'].includes(error?.code)
    ) {
      return
    }
    throw error
  }
}

function leaseAuthorityError(message) {
  const error = new Error(message)
  error.code = 'worker_authority_fence_unavailable'
  return error
}

function repositoryUrl(value, allowedHosts = DEFAULT_ALLOWED_REPOSITORY_HOSTS) {
  const source = String(value || '').trim()
  let repositoryIdentity
  try {
    repositoryIdentity = normalizeRepositoryIdentity(source)
  } catch {
    throw new FleetWorkerAdapterError('Repository URL is invalid.', {
      code: 'invalid_snapshot',
    })
  }
  const transportSpecified =
    /^git@/.test(source) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)
  const candidate = transportSpecified
    ? source
    : `https://${repositoryIdentity}.git`
  const host = repositoryIdentity.slice(0, repositoryIdentity.indexOf('/'))
  if (/^git@[^:\s]+:[^\s]+$/.test(candidate)) {
    // The shared normalizer already validated the exact SCP-like path.
  } else {
    let parsed
    try {
      parsed = new URL(candidate)
    } catch {
      throw new FleetWorkerAdapterError('Repository URL is invalid.', {
        code: 'invalid_snapshot',
      })
    }
    if (
      !['https:', 'ssh:'].includes(parsed.protocol) ||
      parsed.username && parsed.protocol === 'https:' ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new FleetWorkerAdapterError('Repository URL is not allowed.', {
        code: 'invalid_snapshot',
      })
    }
    if (parsed.hostname.toLowerCase() !== host) {
      throw new FleetWorkerAdapterError('Repository URL is invalid.', {
        code: 'invalid_snapshot',
      })
    }
  }
  const allowed = new Set(
    allowedHosts.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
  )
  if (!allowed.has(host)) {
    throw new FleetWorkerAdapterError('Repository host is not allowed.', {
      code: 'repository_host_denied',
    })
  }
  return candidate
}

function workerEnvironment(environment = process.env, {
  includeGitCredentials = false,
  platform = process.platform,
} = {}) {
  const result = {}
  for (const key of [
    'PATH',
    'DEVELOPER_DIR',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
  ]) {
    if (typeof environment[key] === 'string') result[key] = environment[key]
  }
  if (includeGitCredentials) {
    if (typeof environment.SSH_AUTH_SOCK === 'string') {
      result.SSH_AUTH_SOCK = environment.SSH_AUTH_SOCK
    }
  }
  result.GIT_CONFIG_NOSYSTEM = '1'
  result.GIT_CONFIG_GLOBAL = platform === 'win32' ? 'NUL' : '/dev/null'
  result.GIT_TERMINAL_PROMPT = '0'
  result.GIT_OPTIONAL_LOCKS = '0'
  return result
}

function safeWorkspacePath(root, ...parts) {
  const resolvedRoot = path.resolve(root)
  const candidate = path.resolve(resolvedRoot, ...parts)
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new FleetWorkerAdapterError('Worker path escaped its workspace.', {
      code: 'unsafe_workspace_path',
    })
  }
  return candidate
}

async function verifiedWorkspacePath(fsImpl, root, candidate) {
  const [realRoot, realCandidate] = await Promise.all([
    fsImpl.realpath(root),
    fsImpl.realpath(candidate),
  ])
  if (
    realCandidate !== realRoot &&
    !realCandidate.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new FleetWorkerAdapterError('Worker path resolves outside its workspace.', {
      code: 'unsafe_workspace_path',
    })
  }
  return realCandidate
}

async function boundedArtifactDirectory(
  fsImpl,
  root,
  workspace,
  {
    maximumEntries = MAX_XCODE_ARTIFACT_ENTRIES,
    maximumBytes = MAX_XCODE_ARTIFACT_SOURCE_BYTES,
  } = {}
) {
  const pending = [root]
  let entries = 0
  let bytes = 0
  while (pending.length > 0) {
    const directory = pending.pop()
    const handle = await fsImpl.opendir(directory)
    for await (const entry of handle) {
      entries += 1
      if (entries > maximumEntries) {
        throw new FleetWorkerAdapterError(
          'Xcode evidence contains too many filesystem entries.',
          { code: 'artifact_limit_exceeded' }
        )
      }
      const candidate = safeWorkspacePath(directory, entry.name)
      const stat = await fsImpl.lstat(candidate)
      if (stat.isSymbolicLink()) {
        await verifiedWorkspacePath(fsImpl, workspace, candidate)
        bytes += Number(stat.size)
      } else if (stat.isDirectory()) {
        pending.push(candidate)
      } else if (stat.isFile()) {
        bytes += Number(stat.size)
      } else {
        throw new FleetWorkerAdapterError(
          'Xcode evidence contains an unsupported filesystem entry.',
          { code: 'artifact_unsafe' }
        )
      }
      if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) {
        throw new FleetWorkerAdapterError(
          'Xcode evidence exceeds the local artifact budget.',
          { code: 'artifact_limit_exceeded' }
        )
      }
    }
  }
  return Object.freeze({ entries, bytes })
}

async function assertSafeArtifactSpoolRoot(
  fsImpl,
  artifactSpoolRoot,
  { allowMissing = false } = {}
) {
  const stat = await fsImpl.lstat(artifactSpoolRoot).catch((error) => {
    if (allowMissing && error?.code === 'ENOENT') return null
    throw error
  })
  if (stat == null && allowMissing) return false
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new FleetWorkerAdapterError('Artifact spool root is unsafe.', {
      code: 'invalid_artifact_spool',
    })
  }
  return stat
}

async function listArtifactSpool({
  artifactSpoolRoot,
  fsImpl = fs,
  maximumEntries = MAX_ARTIFACT_SPOOL_ENTRIES,
} = {}) {
  if (
    typeof artifactSpoolRoot !== 'string' ||
    !path.isAbsolute(artifactSpoolRoot)
  ) {
    return []
  }
  const rootBefore = await assertSafeArtifactSpoolRoot(
    fsImpl,
    artifactSpoolRoot,
    { allowMissing: true }
  )
  if (!rootBefore) {
    return []
  }
  const directories = await fsImpl
    .readdir(artifactSpoolRoot, { withFileTypes: true })
    .catch((error) => {
      if (error?.code === 'ENOENT') return []
      throw error
    })
  if (directories.length > MAX_WORKSPACE_ENTRIES) {
    throw new FleetWorkerAdapterError(
      'Artifact spool contains too many filesystem entries.',
      { code: 'artifact_limit_exceeded' }
    )
  }
  const retained = []
  for (const directory of directories) {
    if (
      !directory.isDirectory() ||
      !/^job_[a-f0-9]{32,64}-lease_[a-f0-9]{32}$/.test(directory.name)
    ) {
      continue
    }
    const spoolDirectory = safeWorkspacePath(
      artifactSpoolRoot,
      directory.name
    )
    const directoryStat = await fsImpl.lstat(spoolDirectory).catch(() => null)
    if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
      continue
    }
    const files = await fsImpl.readdir(spoolDirectory, {
      withFileTypes: true,
    })
    const manifests = files
      .filter(
        (entry) =>
          entry.isFile() && /^[a-z][a-z-]{0,31}\.json$/.test(entry.name)
      )
      .slice(0, 16)
    for (const manifestEntry of manifests) {
      const kind = manifestEntry.name.slice(0, -5)
      const manifestPath = safeWorkspacePath(
        spoolDirectory,
        manifestEntry.name
      )
      const archivePath = safeWorkspacePath(spoolDirectory, `${kind}.zip`)
      const archive = await fsImpl.lstat(archivePath).catch(() => null)
      let manifest = null
      let pinnedManifest = null
      try {
        pinnedManifest = await openPinnedRegularFile(fsImpl, manifestPath, {
          maximumBytes: 32 * 1024,
        })
        manifest = await pinnedManifest.handle
          .readFile({ encoding: 'utf8' })
          .then((source) => JSON.parse(source))
          .catch(() => null)
        const manifestAfter = await fsImpl
          .lstat(manifestPath)
          .catch(() => null)
        if (!sameFileIdentity(pinnedManifest.stat, manifestAfter)) {
          manifest = null
        }
      } catch {
        manifest = null
      } finally {
        if (pinnedManifest) {
          await pinnedManifest.handle.close().catch(() => {})
        }
      }
      const valid =
        manifest &&
        manifest.spoolId === directory.name &&
        manifest.kind === kind &&
        /^job_[a-f0-9]{32,64}$/.test(manifest.jobId) &&
        /^lease_[a-f0-9]{32}$/.test(manifest.leaseId) &&
        archive?.isFile() &&
        !archive.isSymbolicLink() &&
        Number(manifest.sizeBytes) === Number(archive.size) &&
        /^[a-f0-9]{64}$/.test(String(manifest.contentHash || ''))
      retained.push(
        Object.freeze({
          spoolId: directory.name,
          jobId: valid
            ? manifest.jobId
            : directory.name.slice(0, directory.name.indexOf('-lease_')),
          leaseId: valid
            ? manifest.leaseId
            : directory.name.slice(directory.name.indexOf('-lease_') + 1),
          attempt: valid ? Number(manifest.attempt || 0) : 0,
          kind,
          reasonCode: valid
            ? String(manifest.reasonCode || 'artifact_upload_failed')
            : 'spool_integrity_unverified',
          createdAt:
            valid && Number.isFinite(Date.parse(manifest.createdAt))
              ? new Date(Date.parse(manifest.createdAt)).toISOString()
              : new Date(Number(directoryStat.mtimeMs)).toISOString(),
          sizeBytes: archive?.isFile() ? Number(archive.size) : 0,
          contentHash: valid ? manifest.contentHash : null,
          integrity: valid ? 'recorded' : 'unverified',
        })
      )
    }
  }
  const rootAfter = await fsImpl.lstat(artifactSpoolRoot).catch(() => null)
  if (!sameEntryIdentity(rootBefore, rootAfter)) {
    throw new FleetWorkerAdapterError('Artifact spool root changed.', {
      code: 'invalid_artifact_spool',
    })
  }
  return retained
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    )
    .slice(0, maximumEntries)
}

async function revealArtifactSpoolEntry({
  artifactSpoolRoot,
  spoolId,
  kind,
  fsImpl = fs,
} = {}) {
  if (
    typeof artifactSpoolRoot !== 'string' ||
    !path.isAbsolute(artifactSpoolRoot) ||
    !/^job_[a-f0-9]{32,64}-lease_[a-f0-9]{32}$/.test(
      String(spoolId || '')
    ) ||
    !/^[a-z][a-z-]{0,31}$/.test(String(kind || ''))
  ) {
    throw new FleetWorkerAdapterError('Artifact spool selection is invalid.', {
      code: 'invalid_artifact_spool',
    })
  }
  const archivePath = safeWorkspacePath(
    artifactSpoolRoot,
    spoolId,
    `${kind}.zip`
  )
  const manifestPath = safeWorkspacePath(
    artifactSpoolRoot,
    spoolId,
    `${kind}.json`
  )
  const rootBefore = await assertSafeArtifactSpoolRoot(
    fsImpl,
    artifactSpoolRoot
  )
  const archive = await openPinnedRegularFile(fsImpl, archivePath)
  let manifest = null
  try {
    manifest = await openPinnedRegularFile(fsImpl, manifestPath, {
      maximumBytes: 32 * 1024,
    })
    const metadata = await manifest.handle
      .readFile({ encoding: 'utf8' })
      .then((source) => JSON.parse(source))
      .catch(() => null)
    if (
      !metadata ||
      metadata.spoolId !== spoolId ||
      metadata.kind !== kind ||
      Number(metadata.sizeBytes) !== Number(archive.stat.size) ||
      !/^[a-f0-9]{64}$/.test(String(metadata.contentHash || ''))
    ) {
      throw new FleetWorkerAdapterError(
        'Retained evidence checksum metadata is invalid.',
        { code: 'artifact_spool_integrity_failed' }
      )
    }
    const digest = await digestFileHandle(
      archive.handle,
      archive.stat,
      undefined,
      Number(archive.stat.size)
    )
    const [archiveAfter, manifestAfter, rootAfter] = await Promise.all([
      fsImpl.lstat(archivePath).catch(() => null),
      fsImpl.lstat(manifestPath).catch(() => null),
      fsImpl.lstat(artifactSpoolRoot).catch(() => null),
    ])
    if (
      !sameFileIdentity(archive.stat, archiveAfter) ||
      !sameFileIdentity(manifest.stat, manifestAfter) ||
      !sameEntryIdentity(rootBefore, rootAfter) ||
      digest.contentHash !== metadata.contentHash
    ) {
      throw new FleetWorkerAdapterError(
        'Retained evidence failed its checksum verification.',
        { code: 'artifact_spool_integrity_failed' }
      )
    }
    return archivePath
  } finally {
    await Promise.allSettled([
      archive.handle.close(),
      manifest?.handle?.close?.(),
    ])
  }
}

function sameFileIdentity(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    !left.isSymbolicLink() &&
    !right.isSymbolicLink() &&
    Number(left.dev) === Number(right.dev) &&
    Number(left.ino) === Number(right.ino) &&
    Number(left.size) === Number(right.size) &&
    Number(left.mtimeMs) === Number(right.mtimeMs)
  )
}

function sameEntryIdentity(left, right) {
  return (
    left &&
    right &&
    !left.isSymbolicLink() &&
    !right.isSymbolicLink() &&
    Number(left.dev) === Number(right.dev) &&
    Number(left.ino) === Number(right.ino)
  )
}

async function openPinnedRegularFile(
  fsImpl,
  filePath,
  { minimumBytes = 1, maximumBytes = MAX_PACKAGED_ARTIFACT_BYTES } = {}
) {
  const before = await fsImpl.lstat(filePath)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < minimumBytes ||
    before.size > maximumBytes ||
    typeof fsImpl.open !== 'function'
  ) {
    throw new FleetWorkerAdapterError('Artifact file is unsafe.', {
      code: 'artifact_spool_integrity_failed',
    })
  }
  const handle = await fsImpl.open(
    filePath,
    Number(fsConstants.O_RDONLY) | Number(fsConstants.O_NOFOLLOW || 0)
  )
  try {
    const opened = await handle.stat()
    const after = await fsImpl.lstat(filePath)
    if (
      !sameFileIdentity(before, opened) ||
      !sameFileIdentity(opened, after)
    ) {
      throw new FleetWorkerAdapterError(
        'Artifact file changed while it was opened.',
        { code: 'artifact_spool_integrity_failed' }
      )
    }
    return { handle, stat: opened }
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  }
}

async function removeBoundedSpoolDirectory(
  fsImpl,
  artifactSpoolRoot,
  spoolId,
  platform = process.platform
) {
  if (!/^job_[a-f0-9]{32,64}-lease_[a-f0-9]{32}$/.test(spoolId)) {
    throw new FleetWorkerAdapterError('Artifact spool selection is invalid.', {
      code: 'invalid_artifact_spool',
    })
  }
  const rootBefore = await assertSafeArtifactSpoolRoot(
    fsImpl,
    artifactSpoolRoot
  )
  let rootHandle = null
  let anchoredRoot = artifactSpoolRoot
  try {
    if (platform === 'linux' && typeof fsImpl.open === 'function') {
      rootHandle = await fsImpl.open(
        artifactSpoolRoot,
        Number(fsConstants.O_RDONLY)
      )
      const openedRoot = await rootHandle.stat()
      if (
        !openedRoot.isDirectory() ||
        !sameEntryIdentity(rootBefore, openedRoot)
      ) {
        throw new FleetWorkerAdapterError('Artifact spool root changed.', {
          code: 'invalid_artifact_spool',
        })
      }
      anchoredRoot = `/proc/self/fd/${rootHandle.fd}`
    }
    const directoryPath = path.join(anchoredRoot, spoolId)
    const directory = await fsImpl.lstat(directoryPath).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (!directory) return false
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new FleetWorkerAdapterError('Retained evidence path is unsafe.', {
        code: 'invalid_artifact_spool',
      })
    }
    const entries = await fsImpl.readdir(directoryPath, {
      withFileTypes: true,
    })
    if (entries.length > 64) {
      throw new FleetWorkerAdapterError(
        'Retained evidence contains too many files.',
        { code: 'artifact_limit_exceeded' }
      )
    }
    for (const entry of entries) {
      const childPath = path.join(directoryPath, entry.name)
      const child = await fsImpl.lstat(childPath)
      if (
        (!child.isFile() && !child.isSymbolicLink()) ||
        entry.name === '.' ||
        entry.name === '..'
      ) {
        throw new FleetWorkerAdapterError(
          'Retained evidence contains an unsafe entry.',
          { code: 'invalid_artifact_spool' }
        )
      }
      await fsImpl.unlink(childPath)
    }
    await fsImpl.rmdir(directoryPath)
    return true
  } finally {
    if (rootHandle) await rootHandle.close().catch(() => {})
  }
}

async function purgeArtifactSpoolEntry({
  artifactSpoolRoot,
  spoolId,
  fsImpl = fs,
} = {}) {
  if (
    typeof artifactSpoolRoot !== 'string' ||
    !path.isAbsolute(artifactSpoolRoot) ||
    !/^job_[a-f0-9]{32,64}-lease_[a-f0-9]{32}$/.test(
      String(spoolId || '')
    )
  ) {
    throw new FleetWorkerAdapterError('Artifact spool selection is invalid.', {
      code: 'invalid_artifact_spool',
    })
  }
  return removeBoundedSpoolDirectory(
    fsImpl,
    artifactSpoolRoot,
    spoolId
  )
}

function processError(result, code, message, retryable = false) {
  return new FleetWorkerAdapterError(message, {
    code,
    retryable,
    result: {
      exitCode: result?.exitCode ?? null,
      signal: result?.signal ?? null,
      timedOut: result?.timedOut === true,
      cancelled: result?.cancelled === true,
      terminationConfirmed: result?.terminationConfirmed === true,
    },
  })
}

function directExecutableExtensions({
  executable,
  platform = process.platform,
  pathExt = process.env.PATHEXT,
} = {}) {
  if (platform !== 'win32') return ['']
  const explicit = path.win32.extname(String(executable || '')).toLowerCase()
  if (explicit) return ['.com', '.exe'].includes(explicit) ? [''] : []
  return [
    ...new Set(
      String(pathExt || '.COM;.EXE')
        .split(';')
        .map((extension) => extension.trim().toLowerCase())
        .filter((extension) => ['.com', '.exe'].includes(extension))
    ),
  ]
}

function kernelBackedFleetProcessContainment(platform = process.platform) {
  return platform === 'win32'
}

function unpackedDesktopResource(filename, directory = __dirname) {
  const marker = `${path.sep}app.asar`
  const markerIndex = directory.indexOf(marker)
  const markerEnd = markerIndex + marker.length
  const insideAsar =
    markerIndex >= 0 &&
    (markerEnd === directory.length || directory[markerEnd] === path.sep)
  const unpackedDirectory = insideAsar
    ? `${directory.slice(0, markerEnd)}.unpacked${directory.slice(markerEnd)}`
    : directory
  return path.join(unpackedDirectory, filename)
}

function posixProcessOwnerInvocation({
  executable,
  args = [],
  processOwnerExecutable = process.execPath,
  processOwnerModule = __filename,
  parentProcessId = process.pid,
  deadlineUnixMilliseconds,
  authorityFencePath,
  authorityLeaseId,
  authorityToken,
  authorityKey,
  maximumAuthorityDeadlineUnixMilliseconds,
} = {}) {
  if (
    typeof executable !== 'string' ||
    !path.posix.isAbsolute(executable) ||
    typeof processOwnerExecutable !== 'string' ||
    !path.isAbsolute(processOwnerExecutable) ||
    typeof processOwnerModule !== 'string' ||
    !path.isAbsolute(processOwnerModule)
  ) {
    throw new FleetWorkerAdapterError(
      'Fleet executables and their process owner must use pinned local paths.',
      { code: 'executable_not_pinned' }
    )
  }
  if (
    !Number.isSafeInteger(parentProcessId) ||
    parentProcessId < 1 ||
    !Number.isSafeInteger(deadlineUnixMilliseconds) ||
    deadlineUnixMilliseconds <= 0 ||
    typeof authorityFencePath !== 'string' ||
    !path.posix.isAbsolute(authorityFencePath) ||
    !/^lease_[a-f0-9]{32}$/.test(String(authorityLeaseId || '')) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(String(authorityToken || '')) ||
    !/^[A-Za-z0-9_-]{43}$/.test(String(authorityKey || '')) ||
    !Number.isSafeInteger(maximumAuthorityDeadlineUnixMilliseconds) ||
    maximumAuthorityDeadlineUnixMilliseconds < deadlineUnixMilliseconds
  ) {
    throw new FleetWorkerAdapterError(
      'The POSIX process lifetime could not be pinned.',
      { code: 'process_owner_unavailable' }
    )
  }
  const payload = Buffer.from(
    JSON.stringify({
      executable,
      arguments: args,
      parentProcessId,
      deadlineUnixMilliseconds,
      authorityFencePath,
      authorityLeaseId,
      authorityToken,
      authorityKey,
      maximumAuthorityDeadlineUnixMilliseconds,
    }),
    'utf8'
  ).toString('base64url')
  if (payload.length > MAX_WINDOWS_PROCESS_OWNER_PAYLOAD_CHARACTERS) {
    throw new FleetWorkerAdapterError(
      'The POSIX process request is too large.',
      { code: 'process_request_too_large' }
    )
  }
  return {
    executable: processOwnerExecutable,
    args: [processOwnerModule, POSIX_PROCESS_OWNER_MODE],
    input: payload,
    environment: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

async function authorityFenceIsCurrent(request) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle = null
    try {
      const before = await fs.lstat(request.authorityFencePath)
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size < 1 ||
        before.size > 1_024
      ) {
        return false
      }
      handle = await fs.open(
        request.authorityFencePath,
        Number(fsConstants.O_RDONLY) | Number(fsConstants.O_NOFOLLOW || 0)
      )
      const opened = await handle.stat()
      if (!sameFileIdentity(before, opened)) return false
      const contents = await handle.readFile('utf8')
      const after = await fs.lstat(request.authorityFencePath)
      if (!sameFileIdentity(opened, after)) {
        // A valid atomic renewal can replace the path while it is open. Never
        // treat the replacement itself as authority: reopen and authenticate
        // the current file within this check, with a bounded churn limit.
        continue
      }
      const lines = contents.split('\n')
      if (
        lines.length !== 6 ||
        lines[0] !== 'statskey-fleet-authority-v1' ||
        lines[1] !== request.authorityLeaseId ||
        lines[2] !== request.authorityToken ||
        !validAuthoritySignature(lines, request.authorityKey)
      ) {
        return false
      }
      const expiresUnixMilliseconds = Number(lines[3])
      const deadlineUnixMilliseconds = Number(lines[4])
      const now = Date.now()
      return (
        Number.isSafeInteger(expiresUnixMilliseconds) &&
        Number.isSafeInteger(deadlineUnixMilliseconds) &&
        expiresUnixMilliseconds > now &&
        deadlineUnixMilliseconds > now &&
        expiresUnixMilliseconds <= deadlineUnixMilliseconds &&
        deadlineUnixMilliseconds <=
          request.maximumAuthorityDeadlineUnixMilliseconds
      )
    } catch {
      return false
    } finally {
      await handle?.close().catch(() => {})
    }
  }
  return false
}

function validAuthoritySignature(lines, authorityKey) {
  try {
    const supplied = Buffer.from(String(lines[5] || ''), 'base64url')
    const expected = createHmac(
      'sha256',
      Buffer.from(authorityKey, 'base64url')
    )
      .update(lines.slice(0, 5).join('\n'))
      .digest()
    return (
      supplied.length === expected.length &&
      timingSafeEqual(supplied, expected)
    )
  } catch {
    return false
  }
}

function parsePosixProcessOwnerPayload(payload) {
  if (
    typeof payload !== 'string' ||
    payload.length > MAX_WINDOWS_PROCESS_OWNER_PAYLOAD_CHARACTERS ||
    !/^[A-Za-z0-9_-]+$/.test(payload)
  ) {
    throw new Error('The POSIX process-owner payload is invalid.')
  }
  const request = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (
    !request ||
    typeof request.executable !== 'string' ||
    !path.posix.isAbsolute(request.executable) ||
    !Array.isArray(request.arguments) ||
    request.arguments.length > 128 ||
    request.arguments.some((argument) => typeof argument !== 'string') ||
    !Number.isSafeInteger(request.parentProcessId) ||
    request.parentProcessId < 1 ||
    !Number.isSafeInteger(request.deadlineUnixMilliseconds) ||
    request.deadlineUnixMilliseconds <= Date.now() ||
    request.deadlineUnixMilliseconds - Date.now() >
      MAX_LEASE_AUTHORITY_LIFETIME_MS ||
    typeof request.authorityFencePath !== 'string' ||
    !path.posix.isAbsolute(request.authorityFencePath) ||
    !/^lease_[a-f0-9]{32}$/.test(String(request.authorityLeaseId || '')) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(String(request.authorityToken || '')) ||
    !/^[A-Za-z0-9_-]{43}$/.test(String(request.authorityKey || '')) ||
    !Number.isSafeInteger(request.maximumAuthorityDeadlineUnixMilliseconds) ||
    request.maximumAuthorityDeadlineUnixMilliseconds <
      request.deadlineUnixMilliseconds
  ) {
    throw new Error('The POSIX process-owner request is invalid.')
  }
  return request
}

function launchPosixGroupReaper(processGroupId) {
  if (
    !Number.isSafeInteger(processGroupId) ||
    processGroupId < 2
  ) {
    return false
  }
  const reaper = spawn(
    process.execPath,
    [__filename, POSIX_PROCESS_REAPER_MODE, String(processGroupId)],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }
  )
  reaper.unref()
  return Number.isInteger(reaper.pid) && reaper.pid > 0
}

async function runPosixProcessGroupReaper(processGroupId) {
  if (
    !Number.isSafeInteger(processGroupId) ||
    processGroupId < 2 ||
    processGroupId === process.pid
  ) {
    process.exitCode = 1
    return
  }
  try {
    process.kill(-processGroupId, 'SIGTERM')
  } catch (error) {
    if (error?.code === 'ESRCH') return
  }
  await new Promise((resolve) => setTimeout(resolve, 750))
  try {
    process.kill(-processGroupId, 'SIGKILL')
  } catch (error) {
    if (error?.code === 'ESRCH') return
    process.exitCode = 1
    return
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(-processGroupId, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  process.exitCode = 1
}

async function runPosixProcessOwner(payload) {
  const request = parsePosixProcessOwnerPayload(payload)
  if (
    process.ppid !== request.parentProcessId ||
    !(await authorityFenceIsCurrent(request))
  ) {
    throw new Error('The POSIX process authority is unavailable.')
  }
  const targetEnvironment = { ...process.env }
  delete targetEnvironment.ELECTRON_RUN_AS_NODE
  const child = spawn(request.executable, request.arguments, {
    cwd: process.cwd(),
    env: targetEnvironment,
    stdio: 'inherit',
    detached: false,
  })
  let settled = false
  let checking = false
  let interval = null
  const settle = (exitCode) => {
    if (settled) return
    settled = true
    if (interval) clearInterval(interval)
    launchPosixGroupReaper(process.pid)
    process.exit(Number.isInteger(exitCode) ? exitCode : 1)
  }
  const terminate = () => settle(1)
  process.once('SIGTERM', terminate)
  process.once('SIGINT', terminate)
  child.once('error', () => settle(1))
  child.once('close', (exitCode) => settle(exitCode))
  interval = setInterval(async () => {
    if (settled || checking) return
    checking = true
    try {
      if (
        process.ppid !== request.parentProcessId ||
        Date.now() >= request.deadlineUnixMilliseconds ||
        !(await authorityFenceIsCurrent(request))
      ) {
        terminate()
      }
    } finally {
      checking = false
    }
  }, 250)
}

function windowsProcessOwnerInvocation({
  executable,
  args = [],
  environment = {},
  processOwnerScript = unpackedDesktopResource('windows-process-owner.ps1'),
  parentProcessId = process.pid,
  parentStartedUnixMilliseconds = PROCESS_STARTED_UNIX_MILLISECONDS,
  deadlineUnixMilliseconds,
  authorityFencePath,
  ownerLockPath,
  authorityLeaseId,
  authorityToken,
  authorityKey,
  maximumAuthorityDeadlineUnixMilliseconds,
} = {}) {
  if (
    typeof executable !== 'string' ||
    !path.win32.isAbsolute(executable) ||
    executable.startsWith('\\\\')
  ) {
    throw new FleetWorkerAdapterError(
      'Windows Fleet executables must use a pinned local path.',
      { code: 'executable_not_pinned' }
    )
  }
  const systemRoot = environment.SystemRoot || environment.SYSTEMROOT
  if (
    typeof systemRoot !== 'string' ||
    !path.win32.isAbsolute(systemRoot) ||
    systemRoot.startsWith('\\\\')
  ) {
    throw new FleetWorkerAdapterError(
      'The Windows system runtime could not be pinned.',
      { code: 'process_owner_unavailable' }
    )
  }
  if (
    typeof processOwnerScript !== 'string' ||
    !path.isAbsolute(processOwnerScript)
  ) {
    throw new FleetWorkerAdapterError(
      'The Windows process owner could not be pinned.',
      { code: 'process_owner_unavailable' }
    )
  }
  if (
    !Number.isSafeInteger(parentProcessId) ||
    parentProcessId < 1 ||
    !Number.isSafeInteger(parentStartedUnixMilliseconds) ||
    parentStartedUnixMilliseconds <= 0 ||
    !Number.isSafeInteger(deadlineUnixMilliseconds) ||
    deadlineUnixMilliseconds <= 0 ||
    typeof authorityFencePath !== 'string' ||
    !path.win32.isAbsolute(authorityFencePath) ||
    authorityFencePath.startsWith('\\\\') ||
    typeof ownerLockPath !== 'string' ||
    !path.win32.isAbsolute(ownerLockPath) ||
    ownerLockPath.startsWith('\\\\') ||
    !/^lease_[a-f0-9]{32}$/.test(String(authorityLeaseId || '')) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(String(authorityToken || '')) ||
    !/^[A-Za-z0-9_-]{43}$/.test(String(authorityKey || '')) ||
    !Number.isSafeInteger(maximumAuthorityDeadlineUnixMilliseconds) ||
    maximumAuthorityDeadlineUnixMilliseconds < deadlineUnixMilliseconds
  ) {
    throw new FleetWorkerAdapterError(
      'The Windows process lifetime could not be pinned.',
      { code: 'process_owner_unavailable' }
    )
  }
  const payload = Buffer.from(
    JSON.stringify({
      executable,
      arguments: args,
      parentProcessId,
      parentStartedUnixMilliseconds,
      deadlineUnixMilliseconds,
      authorityFencePath,
      ownerLockPath,
      authorityLeaseId,
      authorityToken,
      authorityKey,
      maximumAuthorityDeadlineUnixMilliseconds,
    }),
    'utf8'
  ).toString('base64url')
  if (payload.length > MAX_WINDOWS_PROCESS_OWNER_PAYLOAD_CHARACTERS) {
    throw new FleetWorkerAdapterError(
      'The Windows process request is too large.',
      { code: 'process_request_too_large' }
    )
  }
  return {
    executable: path.win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      processOwnerScript,
    ],
    input: payload,
  }
}

function createProcessRunner({
  runProcess = runBoundedChildProcess,
  environment = process.env,
  includeGitCredentials = false,
  platform = process.platform,
  processOwnerScript = unpackedDesktopResource('windows-process-owner.ps1'),
  authorityFenceProvider = null,
  allowBestEffortPosixOwner = false,
  now = Date.now,
} = {}) {
  const env = workerEnvironment(environment, {
    includeGitCredentials,
    platform,
  })
  return async ({
    executable,
    args,
    cwd,
    timeoutMs,
    signal,
    errorCode,
    errorMessage,
    retryable = false,
    environmentOverrides = {},
  }) => {
    const startedAt = Number(now())
    const requestedTimeout = Number(timeoutMs)
    if (
      !Number.isSafeInteger(startedAt) ||
      !Number.isFinite(requestedTimeout) ||
      requestedTimeout <= 0
    ) {
      throw new FleetWorkerAdapterError(
        'The process lifetime could not be bounded.',
        { code: 'invalid_process_timeout' }
      )
    }
    const authority =
      typeof authorityFenceProvider === 'function'
        ? authorityFenceProvider()
        : null
    if (
      authorityFenceProvider &&
      (!authority ||
        typeof authority.filePath !== 'string' ||
        typeof authority.ownerLockPath !== 'string' ||
        typeof authority.leaseId !== 'string' ||
        typeof authority.token !== 'string' ||
        typeof authority.authorityKey !== 'string' ||
        !Number.isSafeInteger(
          authority.maximumDeadlineUnixMilliseconds
        ))
    ) {
      throw new FleetWorkerAdapterError(
        'The process lease authority is unavailable.',
        { code: 'worker_authority_fence_unavailable' }
      )
    }
    if (
      authority &&
      platform !== 'win32' &&
      allowBestEffortPosixOwner !== true
    ) {
      throw new FleetWorkerAdapterError(
        'This platform has no kernel-backed Fleet process owner.',
        { code: 'process_owner_unavailable' }
      )
    }
    const deadlineUnixMilliseconds = Math.min(
      startedAt + requestedTimeout,
      authority?.maximumDeadlineUnixMilliseconds ??
        Number.MAX_SAFE_INTEGER
    )
    const effectiveTimeoutMs = deadlineUnixMilliseconds - startedAt
    if (!Number.isSafeInteger(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
      throw new FleetWorkerAdapterError(
        'The process lease authority has expired.',
        { code: 'worker_authority_fence_unavailable' }
      )
    }
    let processEnvironment = { ...env, ...environmentOverrides }
    const invocation =
      platform === 'win32'
        ? windowsProcessOwnerInvocation({
            executable,
            args,
            environment: processEnvironment,
            processOwnerScript,
            deadlineUnixMilliseconds,
            authorityFencePath: authority?.filePath,
            ownerLockPath: authority?.ownerLockPath,
            authorityLeaseId: authority?.leaseId,
            authorityToken: authority?.token,
            authorityKey: authority?.authorityKey,
            maximumAuthorityDeadlineUnixMilliseconds:
              authority?.maximumDeadlineUnixMilliseconds,
          })
        : authority
          ? posixProcessOwnerInvocation({
              executable,
              args,
              deadlineUnixMilliseconds,
              authorityFencePath: authority.filePath,
              authorityLeaseId: authority.leaseId,
              authorityToken: authority.token,
              authorityKey: authority.authorityKey,
              maximumAuthorityDeadlineUnixMilliseconds:
                authority.maximumDeadlineUnixMilliseconds,
            })
        : { executable, args }
    processEnvironment = {
      ...processEnvironment,
      ...(invocation.environment || {}),
    }
    const result = await runProcess({
      executable: invocation.executable,
      args: invocation.args,
      cwd,
      env: processEnvironment,
      stdio: invocation.input === undefined
        ? ['ignore', 'pipe', 'pipe']
        : ['pipe', 'pipe', 'pipe'],
      input: invocation.input,
      signal,
      killProcessGroup: true,
      processTreeOwned: platform === 'win32',
      timeoutMilliseconds:
        authority ? effectiveTimeoutMs + 5_000 : effectiveTimeoutMs,
      maxOutputCharacters: MAX_PROCESS_OUTPUT_CHARACTERS,
    })
    if (!result?.ok) {
      throw processError(result, errorCode, errorMessage, retryable)
    }
    return result
  }
}

async function createRuntimeEnvironment(fsImpl, workspace, platform) {
  const runtimeRoot = safeWorkspacePath(workspace, '.statskey-runtime')
  const home = safeWorkspacePath(runtimeRoot, 'home')
  const temporary = safeWorkspacePath(runtimeRoot, 'tmp')
  const config = safeWorkspacePath(runtimeRoot, 'config')
  const cache = safeWorkspacePath(runtimeRoot, 'cache')
  await Promise.all(
    [runtimeRoot, home, temporary, config, cache].map((directory) =>
      fsImpl.mkdir(directory, { recursive: true, mode: 0o700 })
    )
  )
  return Object.freeze({
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    LOCALAPPDATA: config,
    APPDATA: config,
  })
}

class GitSnapshotMaterializer {
  constructor({
    workRoot,
    allowedRepositoryHosts = DEFAULT_ALLOWED_REPOSITORY_HOSTS,
    fsImpl = fs,
    processRunner = createProcessRunner(),
    gitExecutable = 'git',
    platform = process.platform,
  }) {
    if (typeof workRoot !== 'string' || !path.isAbsolute(workRoot)) {
      throw new TypeError('Fleet workRoot must be absolute.')
    }
    this.workRoot = path.resolve(workRoot)
    this.allowedRepositoryHosts = [...allowedRepositoryHosts]
    this.fs = fsImpl
    this.run = processRunner
    this.gitExecutable = gitExecutable
    this.platform = platform
  }

  workspacePath(job, lease) {
    if (
      !/^job_[a-f0-9]{32,64}$/.test(job.id) ||
      !/^lease_[a-f0-9]{32}$/.test(lease?.id)
    ) {
      throw new FleetWorkerAdapterError('Fleet assignment ids are invalid.', {
        code: 'invalid_assignment',
      })
    }
    return safeWorkspacePath(
      this.workRoot,
      `${job.id}-${lease.id}`
    )
  }

  async cleanup(job, lease) {
    const workspace = this.workspacePath(job, lease)
    const entry = await this.fs.lstat(workspace).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (!entry) return false
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      await this.fs.unlink(workspace)
      return true
    }
    await verifiedWorkspacePath(this.fs, this.workRoot, workspace)
    await this.fs.rm(workspace, {
      recursive: true,
      force: true,
      maxRetries: 3,
    })
    return true
  }

  async pruneStale(now = Date.now()) {
    await this.fs.mkdir(this.workRoot, { recursive: true, mode: 0o700 })
    const entries = await this.fs.readdir(this.workRoot, { withFileTypes: true })
    const candidates = entries
      .filter((entry) =>
        /^job_[a-f0-9]{32,64}-lease_[a-f0-9]{32}$/.test(entry.name)
      )
      .slice(0, MAX_WORKSPACE_ENTRIES)
    for (const entry of candidates) {
      const candidate = safeWorkspacePath(this.workRoot, entry.name)
      const stat = await this.fs.lstat(candidate).catch(() => null)
      if (
        !stat ||
        Number(now) - Number(stat.mtimeMs) < MAX_STALE_WORKSPACE_AGE_MS
      ) {
        continue
      }
      const leaseOffset = entry.name.indexOf('-lease_')
      await this.cleanup(
        { id: entry.name.slice(0, leaseOffset) },
        { id: entry.name.slice(leaseOffset + 1) }
      )
    }
  }

  async materialize(job, lease, signal) {
    if (job?.workspaceSnapshot?.kind !== 'git') {
      throw new FleetWorkerAdapterError(
        'This worker currently requires a Git snapshot.',
        { code: 'unsupported_snapshot' }
      )
    }
    const workspace = this.workspacePath(job, lease)
    const remote = repositoryUrl(
      job.workspaceSnapshot.repository,
      this.allowedRepositoryHosts
    )
    await this.fs.mkdir(this.workRoot, { recursive: true, mode: 0o700 })
    await this.pruneStale()
    const existing = await this.fs.lstat(workspace).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (existing) {
      await this.cleanup(job, lease)
      throw new FleetWorkerAdapterError(
        'A stale or unsafe worker workspace was removed.',
        { code: 'unsafe_workspace_path' }
      )
    }
    try {
      await this.fs.mkdir(workspace, { recursive: false, mode: 0o700 })
      const workspaceStat = await this.fs.lstat(workspace)
      if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
        throw new FleetWorkerAdapterError('Worker workspace is unsafe.', {
          code: 'unsafe_workspace_path',
        })
      }
      await verifiedWorkspacePath(this.fs, this.workRoot, workspace)
      const runtimeEnvironment = await createRuntimeEnvironment(
        this.fs,
        workspace,
        this.platform
      )
      const git = (args, timeoutMs = GIT_TIMEOUT_MS) =>
        this.run({
          executable: this.gitExecutable,
          args: [
            '-c',
            `core.hooksPath=${this.platform === 'win32' ? 'NUL' : '/dev/null'}`,
            '-c',
            'http.followRedirects=false',
            '-c',
            'credential.helper=',
            '-c',
            'protocol.file.allow=never',
            ...args,
          ],
          cwd: workspace,
          timeoutMs,
          signal,
          errorCode: 'snapshot_materialization_failed',
          errorMessage: 'The exact Git snapshot could not be prepared.',
          retryable: true,
          environmentOverrides: runtimeEnvironment,
        })
      await git(['init', '--quiet'])
      const remotes = await git(['remote'])
      if (!String(remotes.stdout || '').split(/\s+/).includes('origin')) {
        await git(['remote', 'add', 'origin', remote])
      } else {
        await git(['remote', 'set-url', 'origin', remote])
      }
      await git([
        'fetch',
        '--quiet',
        '--no-tags',
        '--depth=1',
        'origin',
        job.workspaceSnapshot.commit,
      ])
      await git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'])
      const head = await git(['rev-parse', 'HEAD'])
      const resolvedCommit = String(head.stdout || '').trim().toLowerCase()
      const requestedCommit = String(job.workspaceSnapshot.commit).toLowerCase()
      if (
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(resolvedCommit) ||
        resolvedCommit !== requestedCommit
      ) {
        throw new FleetWorkerAdapterError('Git returned a different commit.', {
          code: 'snapshot_mismatch',
        })
      }
      if (job.workspaceSnapshot.submodules === true) {
        throw new FleetWorkerAdapterError(
          'Submodule snapshots require an explicit host manifest.',
          { code: 'unsupported_submodules' }
        )
      }
      return { workspace, commit: resolvedCommit }
    } catch (error) {
      if (error?.result?.terminationConfirmed !== false) {
        await this.cleanup(job, lease).catch(() => {})
      }
      throw error
    }
  }
}

class XcodeFleetAdapter {
  constructor({
    materializer,
    fsImpl = fs,
    processRunner = createProcessRunner(),
    platform = process.platform,
    xcodeExecutable = 'xcodebuild',
    archiveExecutable = 'ditto',
    artifactSpoolRoot = null,
  }) {
    if (!materializer || typeof materializer.materialize !== 'function') {
      throw new TypeError('Xcode adapter requires a snapshot materializer.')
    }
    this.materializer = materializer
    this.fs = fsImpl
    this.runProcess = processRunner
    this.platform = platform
    this.xcodeExecutable = xcodeExecutable
    this.archiveExecutable = archiveExecutable
    if (artifactSpoolRoot != null && !path.isAbsolute(artifactSpoolRoot)) {
      throw new TypeError('Artifact spool root must be absolute.')
    }
    this.artifactSpoolRoot = artifactSpoolRoot
    this.prepared = new Map()
  }

  async pruneArtifactSpool(now = Date.now()) {
    if (!this.artifactSpoolRoot) return
    await this.fs.mkdir(this.artifactSpoolRoot, {
      recursive: true,
      mode: 0o700,
    })
    await assertSafeArtifactSpoolRoot(this.fs, this.artifactSpoolRoot)
    const entries = await this.fs.readdir(this.artifactSpoolRoot, {
      withFileTypes: true,
    })
    if (entries.length > MAX_WORKSPACE_ENTRIES) {
      throw new FleetWorkerAdapterError(
        'Artifact spool contains too many filesystem entries.',
        { code: 'artifact_limit_exceeded' }
      )
    }
    const candidates = []
    for (const entry of entries) {
      if (!/^job_[a-f0-9]{32,64}-lease_[a-f0-9]{32}$/.test(entry.name)) {
        continue
      }
      const candidate = safeWorkspacePath(this.artifactSpoolRoot, entry.name)
      const stat = await this.fs.lstat(candidate).catch(() => null)
      if (stat?.isDirectory() && !stat.isSymbolicLink()) {
        const children = await this.fs
          .readdir(candidate, { withFileTypes: true })
          .catch(() => null)
        let bytes = 0
        let unsafe = !children || children.length > 64
        for (const child of children?.slice(0, 64) || []) {
          const childPath = safeWorkspacePath(candidate, child.name)
          const childStat = await this.fs.lstat(childPath).catch(() => null)
          if (
            !childStat ||
            !childStat.isFile() ||
            childStat.isSymbolicLink()
          ) {
            unsafe = true
            continue
          }
          bytes += Number(childStat.size)
          if (!Number.isSafeInteger(bytes)) unsafe = true
        }
        candidates.push({
          spoolId: entry.name,
          path: candidate,
          mtimeMs: Number(stat.mtimeMs || 0),
          bytes,
          unsafe,
        })
      }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
    let retainedBytes = 0
    const removals = candidates.filter((entry, index) => {
      const remove =
        entry.unsafe ||
        index >= MAX_ARTIFACT_SPOOL_ENTRIES ||
        Number(now) - entry.mtimeMs > MAX_ARTIFACT_SPOOL_AGE_MS ||
        retainedBytes + entry.bytes > MAX_ARTIFACT_SPOOL_BYTES
      if (!remove) retainedBytes += entry.bytes
      return remove
    })
    await Promise.all(
      removals
        .map((entry) =>
          removeBoundedSpoolDirectory(
            this.fs,
            this.artifactSpoolRoot,
            entry.spoolId,
            this.platform
          )
        )
    )
  }

  async spoolArtifact(context, prepared, archivePath, kind, error) {
    if (!this.artifactSpoolRoot) return null
    const archive = await this.fs.lstat(archivePath).catch(() => null)
    if (!archive?.isFile() || archive.isSymbolicLink()) return null
    await this.pruneArtifactSpool(Number(context.now()))
    const spoolId = `${context.job.id}-${context.lease.id}`
    const spoolDirectory = safeWorkspacePath(this.artifactSpoolRoot, spoolId)
    await this.fs.mkdir(spoolDirectory, { recursive: true, mode: 0o700 })
    const spoolStat = await this.fs.lstat(spoolDirectory)
    if (!spoolStat.isDirectory() || spoolStat.isSymbolicLink()) {
      throw new FleetWorkerAdapterError('Artifact spool path is unsafe.', {
        code: 'invalid_artifact_spool',
      })
    }
    await verifiedWorkspacePath(
      this.fs,
      this.artifactSpoolRoot,
      spoolDirectory
    )
    const destination = safeWorkspacePath(spoolDirectory, `${kind}.zip`)
    const temporary = safeWorkspacePath(spoolDirectory, `${kind}.zip.partial`)
    await this.fs.rm(temporary, { force: true })
    await this.fs.copyFile(archivePath, temporary)
    await this.fs.chmod(temporary, 0o600)
    await this.fs.rm(destination, { force: true })
    await this.fs.rename(temporary, destination)
    const retained = await openPinnedRegularFile(this.fs, destination)
    let digest
    try {
      digest = await digestFileHandle(
        retained.handle,
        retained.stat,
        undefined,
        Number(retained.stat.size)
      )
      const retainedAfter = await this.fs.lstat(destination)
      if (!sameFileIdentity(retained.stat, retainedAfter)) {
        throw new FleetWorkerAdapterError(
          'Retained evidence changed during checksum calculation.',
          { code: 'artifact_spool_integrity_failed' }
        )
      }
    } finally {
      await retained.handle.close().catch(() => {})
    }
    const manifest = {
      version: 2,
      spoolId,
      jobId: context.job.id,
      leaseId: context.lease.id,
      attempt: Number(context.lease.attempt || 0),
      kind,
      sourceCommit: prepared.commit,
      reasonCode:
        typeof error?.code === 'string' ? error.code : 'artifact_upload_failed',
      createdAt: new Date(Number(context.now())).toISOString(),
      sizeBytes: Number(retained.stat.size),
      contentHash: digest.contentHash,
    }
    const manifestPath = safeWorkspacePath(spoolDirectory, `${kind}.json`)
    const temporaryManifestPath = safeWorkspacePath(
      spoolDirectory,
      `${kind}.json.partial`
    )
    await this.fs.rm(temporaryManifestPath, { force: true })
    await this.fs.writeFile(
      temporaryManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 }
    )
    await this.fs.rm(manifestPath, { force: true })
    await this.fs.rename(temporaryManifestPath, manifestPath)
    await this.pruneArtifactSpool(Number(context.now()))
    return Object.freeze({ spoolId, filePath: destination })
  }

  async prepare(context) {
    if (this.platform !== 'darwin') {
      throw new FleetWorkerAdapterError('Xcode work requires macOS.', {
        code: 'platform_mismatch',
      })
    }
    const execution = normalizeExecution(context.job.execution, context.job.type)
    if (!execution || execution.kind !== 'xcode') {
      throw new FleetWorkerAdapterError(
        'This Xcode job has no typed execution contract.',
        { code: 'execution_missing' }
      )
    }
    const snapshot = await this.materializer.materialize(
      context.job,
      context.lease,
      context.signal
    )
    const workspace = await this.fs.realpath(snapshot.workspace)
    const requestedContainerPath = safeWorkspacePath(
      workspace,
      execution.containerPath
    )
    const container = await this.fs.lstat(requestedContainerPath).catch(() => null)
    if (
      !container ||
      container.isSymbolicLink() ||
      (!container.isDirectory() && !container.isFile())
    ) {
      throw new FleetWorkerAdapterError('The Xcode container was not found.', {
        code: 'xcode_container_missing',
      })
    }
    const containerPath = await verifiedWorkspacePath(
      this.fs,
      workspace,
      requestedContainerPath
    )
    const resultDirectory = safeWorkspacePath(
      workspace,
      '.statskey-results'
    )
    await this.fs.mkdir(resultDirectory, { recursive: true, mode: 0o700 })
    const resultStat = await this.fs.lstat(resultDirectory)
    if (!resultStat.isDirectory() || resultStat.isSymbolicLink()) {
      throw new FleetWorkerAdapterError('Result directory is unsafe.', {
        code: 'unsafe_workspace_path',
      })
    }
    await verifiedWorkspacePath(this.fs, workspace, resultDirectory)
    this.prepared.set(context.lease.id, {
      ...snapshot,
      workspace,
      execution,
      containerPath,
      resultBundlePath: safeWorkspacePath(
        resultDirectory,
        `${execution.action}.xcresult`
      ),
      derivedDataPath: safeWorkspacePath(resultDirectory, 'DerivedData'),
      archivePath: safeWorkspacePath(resultDirectory, `${execution.scheme}.xcarchive`),
      resultBundleArchivePath: safeWorkspacePath(
        resultDirectory,
        `${execution.action}.xcresult.zip`
      ),
      xcodeArchiveArchivePath: safeWorkspacePath(
        resultDirectory,
        `${execution.scheme}.xcarchive.zip`
      ),
      runtimeEnvironment: await createRuntimeEnvironment(
        this.fs,
        workspace,
        this.platform
      ),
    })
    await context.emit('checkpoint', {
      phase: 'snapshot-ready',
      commit: snapshot.commit,
    })
  }

  async packageAndPublish(context, prepared, {
    sourcePath,
    archivePath,
    kind,
  }) {
    if (typeof context.publishArtifact !== 'function') return null
    const source = await this.fs.lstat(sourcePath).catch(() => null)
    if (!source || source.isSymbolicLink() || !source.isDirectory()) {
      throw new FleetWorkerAdapterError('Expected Xcode output was not created.', {
        code: 'artifact_missing',
      })
    }
    await verifiedWorkspacePath(this.fs, prepared.workspace, sourcePath)
    const sourceSummary = await boundedArtifactDirectory(
      this.fs,
      sourcePath,
      prepared.workspace
    )
    await this.fs.rm(archivePath, { force: true })
    await this.runProcess({
      executable: this.archiveExecutable,
      args: ['-c', '-k', '--sequesterRsrc', '--keepParent', sourcePath, archivePath],
      cwd: prepared.workspace,
      timeoutMs: 30 * 60_000,
      signal: context.signal,
      errorCode: 'artifact_packaging_failed',
      errorMessage: 'Xcode evidence could not be packaged.',
      environmentOverrides: prepared.runtimeEnvironment,
    })
    await verifiedWorkspacePath(this.fs, prepared.workspace, archivePath)
    const archive = await this.fs.lstat(archivePath)
    if (
      !archive.isFile() ||
      archive.isSymbolicLink() ||
      archive.size < 1 ||
      archive.size > MAX_PACKAGED_ARTIFACT_BYTES
    ) {
      throw new FleetWorkerAdapterError(
        'Packaged Xcode evidence exceeds the artifact budget.',
        { code: 'artifact_limit_exceeded' }
      )
    }
    const currentSourceSummary = await boundedArtifactDirectory(
      this.fs,
      sourcePath,
      prepared.workspace
    )
    if (
      currentSourceSummary.entries !== sourceSummary.entries ||
      currentSourceSummary.bytes !== sourceSummary.bytes
    ) {
      throw new FleetWorkerAdapterError(
        'Xcode evidence changed while it was being packaged.',
        { code: 'artifact_changed' }
      )
    }
    try {
      return await context.publishArtifact({
        filePath: archivePath,
        kind,
        mediaType: 'application/zip',
      })
    } catch (error) {
      const spooled = await this.spoolArtifact(
        context,
        prepared,
        archivePath,
        kind,
        error
      ).catch(() => null)
      if (!spooled) throw error
      await context.emit('checkpoint', {
        phase: 'artifact-spooled',
        kind,
        spoolId: spooled.spoolId,
      }).catch(() => {})
      throw new FleetWorkerAdapterError(
        'Artifact publication failed; evidence was retained locally.',
        {
          code: 'artifact_spooled',
          retryable: false,
          result: { spoolId: spooled.spoolId },
        }
      )
    }
  }

  async run(context) {
    const prepared = this.prepared.get(context.lease.id)
    if (!prepared) {
      throw new FleetWorkerAdapterError('Xcode snapshot was not prepared.', {
        code: 'snapshot_missing',
      })
    }
    const { execution } = prepared
    const args = [
      execution.containerKind === 'project' ? '-project' : '-workspace',
      prepared.containerPath,
      '-scheme',
      execution.scheme,
      '-configuration',
      execution.configuration,
      '-destination',
      execution.destination,
      '-derivedDataPath',
      prepared.derivedDataPath,
      '-resultBundlePath',
      prepared.resultBundlePath,
    ]
    if (execution.action === 'archive') {
      args.push('-archivePath', prepared.archivePath)
    }
    args.push(execution.action)
    if (execution.action === 'test') {
      for (const testIdentifier of execution.onlyTesting) {
        args.push(`-only-testing:${testIdentifier}`)
      }
    }
    const cageTimeout = context.job.cage?.enabled
      ? Number(context.job.cage.maxWallTimeMs)
      : Number.POSITIVE_INFINITY
    const timeoutMs = Math.max(
      30_000,
      Math.min(
        Number(execution.timeoutMs) || DEFAULT_PROCESS_TIMEOUT_MS,
        Number.isFinite(cageTimeout) ? cageTimeout : DEFAULT_PROCESS_TIMEOUT_MS
      )
    )
    const startedAt = Number(context.now())
    try {
      let result
      try {
        result = await this.runProcess({
          executable: this.xcodeExecutable,
          args,
          cwd: prepared.workspace,
          timeoutMs,
          signal: context.signal,
          errorCode: 'xcode_failed',
          errorMessage: 'Xcode did not complete successfully.',
          environmentOverrides: prepared.runtimeEnvironment,
        })
      } catch (error) {
        const durationMs = Math.max(0, Number(context.now()) - startedAt)
        await context.emit('process-exit', {
          exitCode: error?.result?.exitCode ?? null,
          timedOut: error?.result?.timedOut === true,
          cancelled: error?.result?.cancelled === true,
          durationMs,
        }).catch(() => {})
        if (
          error?.result?.terminationConfirmed === true &&
          !context.signal.aborted &&
          typeof context.publishArtifact === 'function'
        ) {
          try {
            await this.packageAndPublish(context, prepared, {
              sourcePath: prepared.resultBundlePath,
              archivePath: prepared.resultBundleArchivePath,
              kind: 'xcresult',
            })
          } catch (artifactError) {
            if (artifactError?.result?.terminationConfirmed === false) {
              artifactError.cause = error
              throw artifactError
            }
            await context.emit('checkpoint', {
              phase:
                artifactError?.code === 'artifact_spooled'
                  ? 'failure-evidence-spooled'
                  : 'failure-evidence-unavailable',
            }).catch(() => {})
          }
        }
        throw error
      }
      const durationMs = Math.max(0, Number(context.now()) - startedAt)
      await context.emit('process-exit', {
        exitCode: result.exitCode,
        timedOut: false,
        durationMs,
      })
      const artifacts = []
      const resultBundleArtifact = await this.packageAndPublish(
        context,
        prepared,
        {
          sourcePath: prepared.resultBundlePath,
          archivePath: prepared.resultBundleArchivePath,
          kind: 'xcresult',
        }
      )
      if (resultBundleArtifact) artifacts.push(resultBundleArtifact)
      if (execution.action === 'archive') {
        const archiveArtifact = await this.packageAndPublish(
          context,
          prepared,
          {
            sourcePath: prepared.archivePath,
            archivePath: prepared.xcodeArchiveArchivePath,
            kind: 'build',
          }
        )
        if (archiveArtifact) artifacts.push(archiveArtifact)
      }
      return {
        summary: `Xcode ${execution.action} completed successfully.`,
        action: execution.action,
        exitCode: result.exitCode,
        durationMs,
        sourceCommit: prepared.commit,
        resultBundle: resultBundleArtifact?.id || true,
        artifacts: artifacts.map(({ id, kind, contentHash, sizeBytes }) => ({
          id,
          kind,
          contentHash,
          sizeBytes,
        })),
      }
    } finally {
      this.prepared.delete(context.lease.id)
    }
  }

  async cleanup(context) {
    this.prepared.delete(context.lease.id)
    if (typeof this.materializer.cleanup === 'function') {
      await this.materializer.cleanup(context.job, context.lease)
    }
  }
}

class CommandFleetAdapter {
  constructor({
    materializer,
    allowedExecutables = [],
    executablePaths = {},
    fsImpl = fs,
    processRunner = createProcessRunner(),
    platform = process.platform,
  }) {
    this.materializer = materializer
    const canonicalExecutable = (value) =>
      platform === 'win32' ? String(value).toLowerCase() : String(value)
    this.allowedExecutables = new Set(
      allowedExecutables.map(canonicalExecutable)
    )
    this.executablePaths = new Map(
      allowedExecutables.map((executable) => [
        canonicalExecutable(executable),
        executablePaths[executable] || executable,
      ])
    )
    this.fs = fsImpl
    this.runProcess = processRunner
    this.platform = platform
    this.prepared = new Map()
  }

  async prepare(context) {
    const execution = normalizeExecution(context.job.execution, context.job.type)
    if (!execution || execution.kind !== 'command') {
      throw new FleetWorkerAdapterError(
        'This command job has no typed execution contract.',
        { code: 'execution_missing' }
      )
    }
    const executableName =
      this.platform === 'win32'
        ? execution.executable.toLowerCase()
        : execution.executable
    if (!this.allowedExecutables.has(executableName)) {
      throw new FleetWorkerAdapterError('This executable is not enabled.', {
        code: 'executable_denied',
      })
    }
    const snapshot = await this.materializer.materialize(
      context.job,
      context.lease,
      context.signal
    )
    const cwd =
      execution.workingDirectory === '.'
        ? snapshot.workspace
        : safeWorkspacePath(snapshot.workspace, execution.workingDirectory)
    const stat = await this.fs.lstat(cwd).catch(() => null)
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new FleetWorkerAdapterError('Command directory was not found.', {
        code: 'working_directory_missing',
      })
    }
    const verifiedCwd = await verifiedWorkspacePath(
      this.fs,
      snapshot.workspace,
      cwd
    )
    this.prepared.set(context.lease.id, {
      execution,
      executablePath:
        this.executablePaths.get(executableName) || executableName,
      snapshot,
      cwd: verifiedCwd,
      runtimeEnvironment: await createRuntimeEnvironment(
        this.fs,
        snapshot.workspace,
        this.platform
      ),
    })
    await context.emit('checkpoint', {
      phase: 'snapshot-ready',
      commit: snapshot.commit,
    })
  }

  async run(context) {
    const prepared = this.prepared.get(context.lease.id)
    if (!prepared) {
      throw new FleetWorkerAdapterError('Command snapshot was not prepared.', {
        code: 'snapshot_missing',
      })
    }
    const startedAt = Number(context.now())
    const cageTimeout = context.job.cage?.enabled
      ? Number(context.job.cage.maxWallTimeMs)
      : Number.POSITIVE_INFINITY
    const timeoutMs = Math.max(
      30_000,
      Math.min(
        Number(prepared.execution.timeoutMs) || DEFAULT_PROCESS_TIMEOUT_MS,
        Number.isFinite(cageTimeout) ? cageTimeout : DEFAULT_PROCESS_TIMEOUT_MS
      )
    )
    try {
      const result = await this.runProcess({
        executable: prepared.executablePath,
        args: prepared.execution.arguments,
        cwd: prepared.cwd,
        timeoutMs,
        signal: context.signal,
        errorCode: 'command_failed',
        errorMessage: 'The approved command did not complete successfully.',
        environmentOverrides: prepared.runtimeEnvironment,
      })
      const durationMs = Math.max(0, Number(context.now()) - startedAt)
      await context.emit('process-exit', {
        exitCode: result.exitCode,
        timedOut: false,
        durationMs,
      })
      return {
        summary: 'The approved command completed successfully.',
        exitCode: result.exitCode,
        durationMs,
        sourceCommit: prepared.snapshot.commit,
      }
    } finally {
      this.prepared.delete(context.lease.id)
    }
  }

  async cleanup(context) {
    this.prepared.delete(context.lease.id)
    if (typeof this.materializer.cleanup === 'function') {
      await this.materializer.cleanup(context.job, context.lease)
    }
  }
}

function createFleetWorkerAdapters({
  workRoot,
  allowedRepositoryHosts = DEFAULT_ALLOWED_REPOSITORY_HOSTS,
  allowedExecutables = [],
  executablePaths = {},
  artifactSpoolRoot = null,
  fsImpl = fs,
  runProcess = runBoundedChildProcess,
  environment = process.env,
  platform = process.platform,
  authorityFenceProvider = null,
  allowBestEffortPosixOwner = false,
} = {}) {
  const gitProcessRunner = createProcessRunner({
    runProcess,
    environment,
    includeGitCredentials: true,
    platform,
    authorityFenceProvider,
    allowBestEffortPosixOwner,
  })
  const processRunner = createProcessRunner({
    runProcess,
    environment,
    platform,
    authorityFenceProvider,
    allowBestEffortPosixOwner,
  })
  const materializer = new GitSnapshotMaterializer({
    workRoot,
    allowedRepositoryHosts,
    fsImpl,
    processRunner: gitProcessRunner,
    gitExecutable: executablePaths.git || 'git',
    platform,
  })
  const xcode = new XcodeFleetAdapter({
    materializer,
    fsImpl,
    processRunner,
    platform,
    xcodeExecutable: executablePaths.xcodebuild || 'xcodebuild',
    archiveExecutable: executablePaths.ditto || 'ditto',
    artifactSpoolRoot,
  })
  const adapters = {
    'xcode-build': xcode,
    'xcode-test': xcode,
    'xcode-archive': xcode,
  }
  if (allowedExecutables.length > 0) {
    const command = new CommandFleetAdapter({
      materializer,
      allowedExecutables,
      executablePaths,
      fsImpl,
      processRunner,
      platform,
    })
    adapters.command = command
    if (platform === 'win32') adapters['windows-build'] = command
  }
  return Object.freeze(adapters)
}

async function readBoundedProcessOwnerInput() {
  let payload = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    payload += chunk
    if (payload.length > MAX_WINDOWS_PROCESS_OWNER_PAYLOAD_CHARACTERS) {
      throw new Error('The Fleet process-owner input is too large.')
    }
  }
  return payload
}

if (require.main === module) {
  const mode = process.argv[2]
  const operation =
    mode === POSIX_PROCESS_OWNER_MODE
      ? readBoundedProcessOwnerInput().then(runPosixProcessOwner)
      : mode === POSIX_PROCESS_REAPER_MODE
        ? runPosixProcessGroupReaper(Number(process.argv[3]))
        : Promise.reject(new Error('The Fleet process-owner mode is invalid.'))
  void operation.catch(() => {
    process.stderr.write('The Fleet process owner failed.\n')
    process.exitCode = 1
  })
}

module.exports = {
  boundedArtifactDirectory,
  CommandFleetAdapter,
  DEFAULT_ALLOWED_REPOSITORY_HOSTS,
  FleetLeaseAuthorityStore,
  FleetWorkerAdapterError,
  GitSnapshotMaterializer,
  XcodeFleetAdapter,
  createFleetWorkerAdapters,
  createRuntimeEnvironment,
  createProcessRunner,
  directExecutableExtensions,
  kernelBackedFleetProcessContainment,
  listArtifactSpool,
  posixProcessOwnerInvocation,
  purgeArtifactSpoolEntry,
  repositoryUrl,
  revealArtifactSpoolEntry,
  safeWorkspacePath,
  unpackedDesktopResource,
  verifiedWorkspacePath,
  windowsProcessOwnerInvocation,
  workerEnvironment,
}
