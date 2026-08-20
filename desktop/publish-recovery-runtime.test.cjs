const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  SHA256_METADATA_KEY,
  assertExactFeedContents,
  assertExactRemoteObject,
  describeLocalObject,
  ensureImmutableRemote,
  fetchWithRetry,
  remoteObjectMismatches,
} = require('./publish-recovery-runtime.cjs')

function fixture({ attachment = true, immutable = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-publish-'))
  const filePath = path.join(directory, 'StatsKey-1.2.3.zip')
  writeFileSync(filePath, 'immutable release bytes')
  const expected = describeLocalObject(filePath, 'application/zip', {
    immutable,
    attachment,
  })
  const remote = {
    size: expected.size,
    md5Hash: expected.md5Hash,
    contentType: expected.contentType,
    cacheControl: expected.cacheControl,
    ...(expected.contentDisposition
      ? { contentDisposition: expected.contentDisposition }
      : {}),
    metadata: { [SHA256_METADATA_KEY]: expected.sha256 },
  }
  return { expected, remote }
}

test('matches bytes, size, type, cache, disposition, and strong hash metadata', () => {
  const { expected, remote } = fixture()
  assert.deepEqual(remoteObjectMismatches(remote, expected), [])
  assert.doesNotThrow(() =>
    assertExactRemoteObject(remote, expected, 'releases/1.2.3/app.zip')
  )
})

test('fails closed and identifies every differing immutable property', () => {
  const { expected, remote } = fixture()
  remote.size = '1'
  remote.md5Hash = 'different'
  remote.contentType = 'text/plain'
  remote.cacheControl = 'no-store'
  remote.contentDisposition = 'inline'
  remote.metadata[SHA256_METADATA_KEY] = 'different'
  assert.deepEqual(remoteObjectMismatches(remote, expected), [
    'size',
    'md5Hash',
    'sha256',
    'contentType',
    'cacheControl',
    'contentDisposition',
  ])
  assert.throws(
    () => assertExactRemoteObject(remote, expected, 'release.zip'),
    /Refusing to overwrite it/
  )
})

test('requires disposition to be absent when the local object is not an attachment', () => {
  const { expected, remote } = fixture({ attachment: false })
  assert.deepEqual(remoteObjectMismatches(remote, expected), [])
  remote.contentDisposition = 'attachment'
  assert.deepEqual(remoteObjectMismatches(remote, expected), [
    'contentDisposition',
  ])
})

test('accepts an equal-version feed only when its bytes are exact', () => {
  const feed = 'version: 1.2.3\npath: app.zip\n'
  assert.doesNotThrow(() => assertExactFeedContents(feed, feed, 'mac-arm64'))
  assert.throws(
    () =>
      assertExactFeedContents(
        feed,
        'version: 1.2.3\npath: other.zip\n',
        'mac-arm64'
      ),
    /exact local feed/
  )
})

test('reuses an existing immutable object only when it is exact', async () => {
  const { expected, remote } = fixture()
  let uploaded = false
  const result = await ensureImmutableRemote({
    objectName: 'release.zip',
    expected,
    inspect: async () => remote,
    upload: async () => {
      uploaded = true
    },
  })
  assert.equal(result, 'reused')
  assert.equal(uploaded, false)

  await assert.rejects(
    ensureImmutableRemote({
      objectName: 'release.zip',
      expected,
      inspect: async () => ({ ...remote, size: '1' }),
      upload: async () => {},
    }),
    /size/
  )
})

test('rechecks after a precondition collision and accepts only an exact winner', async () => {
  const { expected, remote } = fixture()
  let inspections = 0
  const result = await ensureImmutableRemote({
    objectName: 'release.zip',
    expected,
    inspect: async () => (++inspections === 1 ? null : remote),
    upload: async () => {
      throw new Error('if-generation-match precondition failed')
    },
  })
  assert.equal(result, 'recovered')
  assert.equal(inspections, 2)

  inspections = 0
  await assert.rejects(
    ensureImmutableRemote({
      objectName: 'release.zip',
      expected,
      inspect: async () =>
        ++inspections === 1 ? null : { ...remote, md5Hash: 'different' },
      upload: async () => {
        throw new Error('if-generation-match precondition failed')
      },
    }),
    /md5Hash/
  )
})

test('preserves the upload error when no object exists after failure', async () => {
  const { expected } = fixture()
  const failure = new Error('network failed')
  await assert.rejects(
    ensureImmutableRemote({
      objectName: 'release.zip',
      expected,
      inspect: async () => null,
      upload: async () => {
        throw failure
      },
    }),
    (error) => error === failure
  )
})

test('retries transient responses and request timeouts with bounded backoff', async () => {
  const waits = []
  const warnings = []
  let attempts = 0
  const response = await fetchWithRetry(
    async () => {
      attempts += 1
      if (attempts === 1) throw new Error('request timed out')
      if (attempts === 2) {
        return {
          status: 503,
          body: { cancel: async () => {} },
        }
      }
      return { status: 200 }
    },
    'release object inspection',
    {
      wait: async (milliseconds) => waits.push(milliseconds),
      warn: (message) => warnings.push(message),
    }
  )
  assert.equal(response.status, 200)
  assert.equal(attempts, 3)
  assert.deepEqual(waits, [1_000, 2_000])
  assert.equal(warnings.length, 2)
})

test('does not retry definitive authorization failures', async () => {
  let attempts = 0
  const response = await fetchWithRetry(
    async () => {
      attempts += 1
      return { status: 403 }
    },
    'release object inspection',
    {
      wait: async () => {
        throw new Error('should not wait')
      },
    }
  )
  assert.equal(response.status, 403)
  assert.equal(attempts, 1)
})
