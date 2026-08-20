'use strict'

const { createHash } = require('node:crypto')
const { constants: fsConstants, createReadStream } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')

const MAX_ARTIFACT_SIZE_BYTES = 1024 * 1024 * 1024
const DEFAULT_UPLOAD_ATTEMPTS = 3
const DEFAULT_UPLOAD_ATTEMPT_TIMEOUT_MS = 20 * 60_000
const ALLOWED_UPLOAD_HEADERS = new Set([
  'content-length',
  'content-md5',
  'content-type',
  'x-goog-if-generation-match',
  'x-goog-meta-statskey-artifact-id',
  'x-goog-meta-statskey-sha256',
])
const PINNED_FILE = Symbol('statskey.fleet.pinned-artifact')

class FleetArtifactUploadError extends Error {
  constructor(message, code = 'artifact_upload_failed') {
    super(message)
    this.name = 'FleetArtifactUploadError'
    this.code = code
  }
}

function validMediaType(value) {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/
    .test(value)
}

function sameFile(left, right) {
  return (
    Number(left.dev) === Number(right.dev) &&
    Number(left.ino) === Number(right.ino) &&
    Number(left.size) === Number(right.size) &&
    Number(left.mtimeMs) === Number(right.mtimeMs)
  )
}

function createPinnedReadStream(pinned) {
  return Readable.from(
    (async function* readPinnedFile() {
      let position = 0
      while (position < Number(pinned.stat.size)) {
        const length = Math.min(
          64 * 1024,
          Number(pinned.stat.size) - position
        )
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await pinned.handle.read(
          buffer,
          0,
          length,
          position
        )
        if (bytesRead < 1) return
        position += bytesRead
        yield bytesRead === buffer.length
          ? buffer
          : buffer.subarray(0, bytesRead)
      }
    })()
  )
}

async function digestFile(
  filePath,
  createReadStreamImpl = createReadStream,
  signal,
  maximumBytes = MAX_ARTIFACT_SIZE_BYTES,
  streamOptions
) {
  const sha256 = createHash('sha256')
  const md5 = createHash('md5')
  let bytesRead = 0
  await new Promise((resolve, reject) => {
    const stream = createReadStreamImpl(filePath, streamOptions)
    const abortError = new FleetArtifactUploadError(
      'Artifact hashing was cancelled.',
      'cancelled'
    )
    const onAbort = () => stream.destroy(abortError)
    stream.on('data', (chunk) => {
      bytesRead += chunk.length
      if (bytesRead > maximumBytes) {
        stream.destroy(
          new FleetArtifactUploadError(
            'Artifact changed while it was being hashed.',
            'artifact_changed'
          )
        )
        return
      }
      sha256.update(chunk)
      md5.update(chunk)
    })
    stream.once('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    stream.once('end', () => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    })
    if (signal?.aborted) {
      onAbort()
    } else {
      signal?.addEventListener('abort', onAbort, { once: true })
    }
  })
  if (signal?.aborted) throw signal.reason || new FleetArtifactUploadError(
    'Artifact hashing was cancelled.',
    'cancelled'
  )
  return {
    contentHash: sha256.digest('hex'),
    contentMd5: md5.digest('base64'),
  }
}

async function digestFileHandle(
  handle,
  stat,
  signal,
  maximumBytes = Number(stat?.size)
) {
  if (
    !handle ||
    typeof handle.read !== 'function' ||
    !stat?.isFile?.() ||
    !Number.isFinite(maximumBytes)
  ) {
    throw new FleetArtifactUploadError(
      'Pinned artifact file is invalid.',
      'invalid_artifact'
    )
  }
  return digestFile(
    '',
    () => createPinnedReadStream({ handle, stat }),
    signal,
    maximumBytes
  )
}

function normalizedGrantHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new FleetArtifactUploadError(
      'Artifact upload headers are invalid.',
      'invalid_upload_grant'
    )
  }
  const normalized = {}
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase()
    if (
      !ALLOWED_UPLOAD_HEADERS.has(name) ||
      typeof value !== 'string' ||
      value.length > 256
    ) {
      throw new FleetArtifactUploadError(
        'Artifact upload headers are not allowed.',
        'invalid_upload_grant'
      )
    }
    normalized[name] = value
  }
  return normalized
}

function validateUploadGrant(grant, descriptor, now = Date.now()) {
  if (!grant || grant.method !== 'PUT') {
    throw new FleetArtifactUploadError(
      'Artifact upload grant is invalid.',
      'invalid_upload_grant'
    )
  }
  let url
  try {
    url = new URL(grant.url)
  } catch {
    throw new FleetArtifactUploadError(
      'Artifact upload URL is invalid.',
      'invalid_upload_grant'
    )
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname !== 'storage.googleapis.com' ||
    !url.searchParams.has('X-Goog-Signature')
  ) {
    throw new FleetArtifactUploadError(
      'Artifact upload URL is not trusted.',
      'invalid_upload_grant'
    )
  }
  const expiresAt = Date.parse(grant.expiresAt)
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Number(now) ||
    expiresAt > Number(now) + 30 * 60_000
  ) {
    throw new FleetArtifactUploadError(
      'Artifact upload grant has expired.',
      'invalid_upload_grant'
    )
  }
  const headers = normalizedGrantHeaders(grant.headers)
  const expected = {
    'content-length': String(descriptor.sizeBytes),
    'content-md5': descriptor.contentMd5,
    'content-type': descriptor.mediaType,
    'x-goog-if-generation-match': '0',
    'x-goog-meta-statskey-artifact-id': descriptor.id,
    'x-goog-meta-statskey-sha256': descriptor.contentHash,
  }
  if (
    Object.keys(headers).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => headers[key] !== value)
  ) {
    throw new FleetArtifactUploadError(
      'Artifact upload grant does not match the local file.',
      'invalid_upload_grant'
    )
  }
  return { url: url.toString(), headers, expiresAt }
}

function validateDownloadGrant(grant, now = Date.now()) {
  if (
    !grant ||
    typeof grant !== 'object' ||
    typeof grant.artifactId !== 'string' ||
    !/^artifact_[a-f0-9]{32}$/.test(grant.artifactId)
  ) {
    throw new FleetArtifactUploadError(
      'Artifact download grant is invalid.',
      'invalid_download_grant'
    )
  }
  let url
  try {
    url = new URL(grant.url)
  } catch {
    throw new FleetArtifactUploadError(
      'Artifact download URL is invalid.',
      'invalid_download_grant'
    )
  }
  const expiresAt = Date.parse(grant.expiresAt)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname !== 'storage.googleapis.com' ||
    !url.searchParams.has('X-Goog-Signature') ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Number(now) ||
    expiresAt > Number(now) + 5 * 60_000
  ) {
    throw new FleetArtifactUploadError(
      'Artifact download grant is not trusted.',
      'invalid_download_grant'
    )
  }
  return Object.freeze({
    artifactId: grant.artifactId,
    url: url.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
  })
}

class FleetArtifactUploader {
  constructor({
    fsImpl = fs,
    fetchImpl = globalThis.fetch,
    createReadStreamImpl = createReadStream,
    now = Date.now,
    timers = globalThis,
    uploadAttempts = DEFAULT_UPLOAD_ATTEMPTS,
    uploadAttemptTimeoutMs = DEFAULT_UPLOAD_ATTEMPT_TIMEOUT_MS,
    retryBaseDelayMs = 250,
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('Artifact uploader requires fetch.')
    }
    this.fs = fsImpl
    this.fetch = fetchImpl
    this.createReadStream = createReadStreamImpl
    this.now = now
    if (!Number.isInteger(uploadAttempts) || uploadAttempts < 1 || uploadAttempts > 5) {
      throw new TypeError('Artifact upload attempts are invalid.')
    }
    if (
      !Number.isFinite(uploadAttemptTimeoutMs) ||
      uploadAttemptTimeoutMs < 1_000 ||
      uploadAttemptTimeoutMs > 30 * 60_000
    ) {
      throw new TypeError('Artifact upload timeout is invalid.')
    }
    this.uploadAttempts = uploadAttempts
    this.uploadAttemptTimeoutMs = uploadAttemptTimeoutMs
    if (
      !Number.isFinite(retryBaseDelayMs) ||
      retryBaseDelayMs < 1 ||
      retryBaseDelayMs > 10_000
    ) {
      throw new TypeError('Artifact upload retry delay is invalid.')
    }
    this.retryBaseDelayMs = retryBaseDelayMs
    if (
      typeof timers?.setTimeout !== 'function' ||
      typeof timers?.clearTimeout !== 'function'
    ) {
      throw new TypeError('Artifact uploader requires timers.')
    }
    this.setTimeout = timers.setTimeout.bind(timers)
    this.clearTimeout = timers.clearTimeout.bind(timers)
  }

  async describeFile({ filePath, artifactId, kind, mediaType, signal }) {
    if (
      typeof filePath !== 'string' ||
      !path.isAbsolute(filePath) ||
      typeof artifactId !== 'string' ||
      !/^artifact_[a-f0-9]{32}$/.test(String(artifactId || '')) ||
      typeof kind !== 'string' ||
      !/^[a-z][a-z-]{0,31}$/.test(String(kind || '')) ||
      typeof mediaType !== 'string' ||
      !validMediaType(String(mediaType || '').toLowerCase())
    ) {
      throw new FleetArtifactUploadError(
        'Artifact descriptor is invalid.',
        'invalid_artifact'
      )
    }
    const before = await this.fs.lstat(filePath)
    let pinned = null
    try {
      if (typeof this.fs.open === 'function') {
        const noFollow = Number(fsConstants.O_NOFOLLOW || 0)
        const handle = await this.fs.open(
          filePath,
          Number(fsConstants.O_RDONLY) | noFollow
        )
        pinned = { handle, stat: null, released: false }
        pinned.stat = await handle.stat()
      }
      const observed = pinned?.stat || before
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        !observed.isFile() ||
        observed.isSymbolicLink?.() ||
        observed.size < 1 ||
        observed.size > MAX_ARTIFACT_SIZE_BYTES ||
        !sameFile(before, observed)
      ) {
        throw new FleetArtifactUploadError(
          'Artifact must be a bounded regular file.',
          'invalid_artifact'
        )
      }
      const digest = await digestFile(
        filePath,
        pinned ? () => createPinnedReadStream(pinned) : this.createReadStream,
        signal,
        observed.size
      )
      const after = await this.fs.lstat(filePath)
      const pinnedAfter = pinned ? await pinned.handle.stat() : after
      if (!sameFile(before, after) || !sameFile(observed, pinnedAfter)) {
        throw new FleetArtifactUploadError(
          'Artifact changed while it was being hashed.',
          'artifact_changed'
        )
      }
      const descriptor = {
        id: artifactId,
        filePath,
        kind,
        mediaType: mediaType.toLowerCase(),
        sizeBytes: Number(pinnedAfter.size),
        ...digest,
      }
      if (pinned) {
        Object.defineProperty(descriptor, PINNED_FILE, {
          value: pinned,
          enumerable: false,
          configurable: false,
          writable: false,
        })
      }
      return Object.freeze(descriptor)
    } catch (error) {
      if (pinned && !pinned.released) {
        pinned.released = true
        await pinned.handle.close().catch(() => {})
      }
      throw error
    }
  }

  async releaseFile({ descriptor } = {}) {
    const pinned = descriptor?.[PINNED_FILE]
    if (!pinned || pinned.released) return false
    pinned.released = true
    await pinned.handle.close()
    return true
  }

  async uploadFile({ descriptor, grant, signal }) {
    const upload = validateUploadGrant(grant, descriptor, this.now())
    let lastError = null
    for (let attempt = 1; attempt <= this.uploadAttempts; attempt += 1) {
      if (signal?.aborted) throw signal.reason
      try {
        return await this.uploadOnce({ descriptor, upload, signal })
      } catch (error) {
        lastError = error
        if (
          attempt >= this.uploadAttempts ||
          error?.code !== 'artifact_upload_offline'
        ) {
          throw error
        }
        const delay = Math.min(
          this.retryBaseDelayMs * 2 ** (attempt - 1),
          10_000
        )
        if (upload.expiresAt - Number(this.now()) <= delay + 1_000) {
          throw new FleetArtifactUploadError(
            'Artifact upload grant expired before retry.',
            'artifact_upload_expired'
          )
        }
        await this.wait(delay, signal)
      }
    }
    throw lastError
  }

  wait(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      let timer
      const onAbort = () => {
        if (timer) this.clearTimeout(timer)
        reject(signal.reason)
      }
      timer = this.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, milliseconds)
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  async uploadOnce({ descriptor, upload, signal }) {
    const pinned = descriptor?.[PINNED_FILE]
    if (pinned?.released) {
      throw new FleetArtifactUploadError(
        'Artifact file authority was released.',
        'artifact_changed'
      )
    }
    if (pinned && !sameFile(pinned.stat, await pinned.handle.stat())) {
      throw new FleetArtifactUploadError(
        'Artifact changed before upload.',
        'artifact_changed'
      )
    }
    const body = pinned
      ? createPinnedReadStream(pinned)
      : this.createReadStream(descriptor.filePath)
    const uploadController = new AbortController()
    const grantExpired = new FleetArtifactUploadError(
      'Artifact upload grant expired during transfer.',
      'artifact_upload_expired'
    )
    const onAssignmentAbort = () =>
      uploadController.abort(signal?.reason)
    const onUploadAbort = () => body.destroy()
    if (signal?.aborted) onAssignmentAbort()
    else signal?.addEventListener('abort', onAssignmentAbort, { once: true })
    uploadController.signal.addEventListener('abort', onUploadAbort, {
      once: true,
    })
    const remaining = Math.max(1, upload.expiresAt - Number(this.now()))
    const attemptTimedOut = new FleetArtifactUploadError(
      'Artifact upload attempt timed out.',
      'artifact_upload_offline'
    )
    const attemptTimeout = Math.min(remaining, this.uploadAttemptTimeoutMs)
    const expiryWins = remaining <= this.uploadAttemptTimeoutMs
    const expiryTimer = this.setTimeout(() => {
      uploadController.abort(expiryWins ? grantExpired : attemptTimedOut)
    }, attemptTimeout)
    expiryTimer.unref?.()
    let response
    try {
      response = await this.fetch(upload.url, {
        method: 'PUT',
        headers: upload.headers,
        body,
        duplex: 'half',
        redirect: 'error',
        signal: uploadController.signal,
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error
      if (uploadController.signal.reason === grantExpired) throw grantExpired
      if (uploadController.signal.reason === attemptTimedOut) {
        throw attemptTimedOut
      }
      throw new FleetArtifactUploadError(
        'Artifact storage is unreachable.',
        'artifact_upload_offline'
      )
    } finally {
      this.clearTimeout(expiryTimer)
      signal?.removeEventListener('abort', onAssignmentAbort)
      uploadController.signal.removeEventListener('abort', onUploadAbort)
      if (!body.destroyed) body.destroy()
    }
    if (!response.ok) {
      const error = new FleetArtifactUploadError(
        `Artifact storage rejected the upload (${response.status}).`,
        response.status === 412
          ? 'artifact_already_exists'
          : [408, 429].includes(response.status) || response.status >= 500
            ? 'artifact_upload_offline'
            : 'artifact_upload_failed'
      )
      throw error
    }
    if (pinned && !sameFile(pinned.stat, await pinned.handle.stat())) {
      throw new FleetArtifactUploadError(
        'Artifact changed during upload.',
        'artifact_changed'
      )
    }
    return { uploaded: true }
  }
}

module.exports = {
  FleetArtifactUploader,
  FleetArtifactUploadError,
  MAX_ARTIFACT_SIZE_BYTES,
  digestFile,
  digestFileHandle,
  validateDownloadGrant,
  validateUploadGrant,
}
