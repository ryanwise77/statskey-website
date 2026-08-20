'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const test = require('node:test')
const {
  FleetArtifactUploader,
  validateDownloadGrant,
  validateUploadGrant,
} = require('./fleet-artifact-uploader.cjs')

const NOW = Date.parse('2026-08-19T07:00:00.000Z')
const ARTIFACT_ID = `artifact_${'a'.repeat(32)}`

function stat(overrides = {}) {
  return {
    dev: 1,
    ino: 2,
    size: 8,
    mtimeMs: 100,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  }
}

function uploadGrant(descriptor, overrides = {}) {
  return {
    method: 'PUT',
    url:
      'https://storage.googleapis.com/fleet-test/object' +
      '?X-Goog-Signature=abc123',
    expiresAt: new Date(NOW + 30 * 60_000).toISOString(),
    headers: {
      'Content-Length': String(descriptor.sizeBytes),
      'Content-MD5': descriptor.contentMd5,
      'Content-Type': descriptor.mediaType,
      'x-goog-if-generation-match': '0',
      'x-goog-meta-statskey-artifact-id': descriptor.id,
      'x-goog-meta-statskey-sha256': descriptor.contentHash,
    },
    ...overrides,
  }
}

test('artifact uploader hashes and uploads the exact bounded file', async () => {
  const bytes = Buffer.from('evidence')
  const metadata = stat({ size: bytes.length })
  let request
  const uploader = new FleetArtifactUploader({
    fsImpl: {
      async lstat() {
        return metadata
      },
    },
    createReadStreamImpl() {
      return Readable.from([bytes])
    },
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, status: 200 }
    },
    now: () => NOW,
  })
  const descriptor = await uploader.describeFile({
    filePath: '/private/tmp/evidence.zip',
    artifactId: ARTIFACT_ID,
    kind: 'xcresult',
    mediaType: 'application/zip',
  })
  assert.equal(
    descriptor.contentHash,
    createHash('sha256').update(bytes).digest('hex')
  )
  assert.equal(
    descriptor.contentMd5,
    createHash('md5').update(bytes).digest('base64')
  )
  await uploader.uploadFile({
    descriptor,
    grant: uploadGrant(descriptor),
  })
  assert.equal(request.options.method, 'PUT')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.headers['content-length'], String(bytes.length))
  assert.equal(request.options.headers['x-goog-if-generation-match'], '0')
})

test('artifact upload remains pinned when its pathname is replaced', async () => {
  const directory = await fs.mkdtemp(
    path.join(tmpdir(), 'statskey-artifact-pin-')
  )
  const filePath = path.join(directory, 'evidence.zip')
  const movedPath = path.join(directory, 'original.zip')
  const original = Buffer.from('original evidence')
  let uploaded = Buffer.alloc(0)
  const uploader = new FleetArtifactUploader({
    now: () => NOW,
    fetchImpl: async (_url, options) => {
      const chunks = []
      for await (const chunk of options.body) chunks.push(Buffer.from(chunk))
      uploaded = Buffer.concat(chunks)
      return { ok: true, status: 200 }
    },
  })
  let descriptor
  try {
    await fs.writeFile(filePath, original)
    descriptor = await uploader.describeFile({
      filePath,
      artifactId: ARTIFACT_ID,
      kind: 'xcresult',
      mediaType: 'application/zip',
    })
    await fs.rename(filePath, movedPath)
    await fs.writeFile(filePath, 'replacement evidence')
    await uploader.uploadFile({
      descriptor,
      grant: uploadGrant(descriptor),
    })
    assert.deepEqual(uploaded, original)
    assert.equal(await uploader.releaseFile({ descriptor }), true)
    assert.equal(await uploader.releaseFile({ descriptor }), false)
  } finally {
    await uploader.releaseFile({ descriptor }).catch(() => {})
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('artifact upload stops before its signed grant can outlive cleanup', async () => {
  const descriptor = {
    id: ARTIFACT_ID,
    filePath: '/private/tmp/evidence.zip',
    contentHash: 'b'.repeat(64),
    contentMd5: 'YWFhYWFhYWFhYWFhYWFhYQ==',
    mediaType: 'application/zip',
    sizeBytes: 8,
  }
  let expire
  let body
  const uploader = new FleetArtifactUploader({
    now: () => NOW,
    uploadAttemptTimeoutMs: 10 * 60_000,
    timers: {
      setTimeout(callback) {
        expire = callback
        return 1
      },
      clearTimeout() {},
    },
    createReadStreamImpl() {
      body = new Readable({ read() {} })
      return body
    },
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(options.signal.reason)
        )
      }),
  })
  const pending = uploader.uploadFile({
    descriptor,
    grant: uploadGrant(descriptor, {
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  expire()

  await assert.rejects(pending, { code: 'artifact_upload_expired' })
  assert.equal(body.destroyed, true)
})

test('artifact uploader retries a transient transfer with a fresh stream', async () => {
  const bytes = Buffer.from('evidence')
  const descriptor = {
    id: ARTIFACT_ID,
    filePath: '/private/tmp/evidence.zip',
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    contentMd5: createHash('md5').update(bytes).digest('base64'),
    mediaType: 'application/zip',
    sizeBytes: bytes.length,
  }
  let streams = 0
  let attempts = 0
  const uploader = new FleetArtifactUploader({
    now: () => NOW,
    retryBaseDelayMs: 1,
    createReadStreamImpl() {
      streams += 1
      return Readable.from([bytes])
    },
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary outage')
      return { ok: true, status: 200 }
    },
  })

  await uploader.uploadFile({
    descriptor,
    grant: uploadGrant(descriptor),
  })
  assert.equal(attempts, 2)
  assert.equal(streams, 2)
})

test('artifact uploader rejects grants that redirect evidence elsewhere', () => {
  const descriptor = {
    id: ARTIFACT_ID,
    contentHash: 'b'.repeat(64),
    contentMd5: 'YWFhYWFhYWFhYWFhYWFhYQ==',
    mediaType: 'application/zip',
    sizeBytes: 8,
  }
  assert.throws(
    () =>
      validateUploadGrant(
        uploadGrant(descriptor, {
          url: 'https://uploads.attacker.test/object?X-Goog-Signature=abc',
        }),
        descriptor,
        NOW
      ),
    { code: 'invalid_upload_grant' }
  )
})

test('artifact downloads require a short-lived signed GCS URL', () => {
  const grant = {
    artifactId: ARTIFACT_ID,
    url:
      'https://storage.googleapis.com/fleet-test/object' +
      '?X-Goog-Signature=abc123',
    expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
  }
  assert.equal(validateDownloadGrant(grant, NOW).artifactId, ARTIFACT_ID)
  assert.throws(
    () =>
      validateDownloadGrant(
        {
          ...grant,
          expiresAt: new Date(NOW + 5 * 60_000 + 1).toISOString(),
        },
        NOW
      ),
    { code: 'invalid_download_grant' }
  )
  assert.throws(
    () =>
      validateDownloadGrant(
        { ...grant, url: 'https://attacker.test/evidence' },
        NOW
      ),
    { code: 'invalid_download_grant' }
  )
})

test('artifact uploader refuses a file that changes during hashing', async () => {
  const bytes = Buffer.from('evidence')
  let reads = 0
  const uploader = new FleetArtifactUploader({
    fsImpl: {
      async lstat() {
        reads += 1
        return stat({ size: bytes.length, mtimeMs: reads })
      },
    },
    createReadStreamImpl() {
      return Readable.from([bytes])
    },
    fetchImpl: async () => ({ ok: true, status: 200 }),
  })
  await assert.rejects(
    () =>
      uploader.describeFile({
        filePath: '/private/tmp/evidence.zip',
        artifactId: ARTIFACT_ID,
        kind: 'xcresult',
        mediaType: 'application/zip',
      }),
    { code: 'artifact_changed' }
  )
})

test('artifact hashing is bounded by the file size observed before reading', async () => {
  const uploader = new FleetArtifactUploader({
    fsImpl: {
      async lstat() {
        return stat({ size: 8 })
      },
    },
    createReadStreamImpl() {
      return Readable.from([Buffer.alloc(8), Buffer.alloc(1)])
    },
    fetchImpl: async () => ({ ok: true, status: 200 }),
  })
  await assert.rejects(
    () =>
      uploader.describeFile({
        filePath: '/private/tmp/evidence.zip',
        artifactId: ARTIFACT_ID,
        kind: 'xcresult',
        mediaType: 'application/zip',
      }),
    { code: 'artifact_changed' }
  )
})

test('artifact hashing stops when the assignment lease is cancelled', async () => {
  let stream
  const uploader = new FleetArtifactUploader({
    fsImpl: {
      async lstat() {
        return stat()
      },
    },
    createReadStreamImpl() {
      stream = new Readable({ read() {} })
      return stream
    },
    fetchImpl: async () => ({ ok: true, status: 200 }),
  })
  const controller = new AbortController()
  const pending = uploader.describeFile({
    filePath: '/private/tmp/evidence.zip',
    artifactId: ARTIFACT_ID,
    kind: 'xcresult',
    mediaType: 'application/zip',
    signal: controller.signal,
  })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort({ code: 'lease-authority-lost' })

  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(stream.destroyed, true)
})
