const { createHash } = require('node:crypto')
const { readFileSync, statSync } = require('node:fs')
const path = require('node:path')

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const MUTABLE_CACHE_CONTROL = 'no-store, max-age=0'
const SHA256_METADATA_KEY = 'statskey-sha256'

function describeLocalObject(
  filePath,
  contentType,
  { immutable, attachment }
) {
  const contents = readFileSync(filePath)
  return {
    size: String(statSync(filePath).size),
    md5Hash: createHash('md5').update(contents).digest('base64'),
    sha256: createHash('sha256').update(contents).digest('hex'),
    contentType,
    cacheControl: immutable
      ? IMMUTABLE_CACHE_CONTROL
      : MUTABLE_CACHE_CONTROL,
    contentDisposition: attachment
      ? `attachment; filename="${path.basename(filePath)}"`
      : null,
  }
}

function remoteObjectMismatches(remote, expected) {
  if (!remote || typeof remote !== 'object') return ['object']
  const remoteDisposition = remote.contentDisposition ?? null
  const remoteSha256 = remote.metadata?.[SHA256_METADATA_KEY] ?? null
  return [
    ['size', String(remote.size ?? ''), expected.size],
    ['md5Hash', remote.md5Hash ?? null, expected.md5Hash],
    ['sha256', remoteSha256, expected.sha256],
    ['contentType', remote.contentType ?? null, expected.contentType],
    ['cacheControl', remote.cacheControl ?? null, expected.cacheControl],
    [
      'contentDisposition',
      remoteDisposition,
      expected.contentDisposition,
    ],
  ]
    .filter(([, actual, wanted]) => actual !== wanted)
    .map(([field]) => field)
}

function assertExactRemoteObject(remote, expected, objectName) {
  const mismatches = remoteObjectMismatches(remote, expected)
  if (mismatches.length === 0) return
  throw new Error(
    `Published object ${objectName} does not exactly match the local ` +
      `release (${mismatches.join(', ')}). Refusing to overwrite it.`
  )
}

function assertExactFeedContents(published, local, channel) {
  if (published === local) return
  throw new Error(
    `Published ${channel} feed differs from the exact local feed. ` +
      'Refusing to resume this release.'
  )
}

async function ensureImmutableRemote({
  objectName,
  expected,
  inspect,
  upload,
}) {
  const existing = await inspect()
  if (existing) {
    assertExactRemoteObject(existing, expected, objectName)
    return 'reused'
  }

  let uploadError = null
  try {
    await upload()
  } catch (error) {
    uploadError = error
  }

  // GCS is strongly consistent. Inspecting again handles the important race:
  // another publisher may have won ifGenerationMatch=0 after our preflight.
  const published = await inspect()
  if (published) {
    assertExactRemoteObject(published, expected, objectName)
    return uploadError ? 'recovered' : 'uploaded'
  }
  if (uploadError) throw uploadError
  throw new Error(
    `Published object ${objectName} was not visible after upload.`
  )
}

async function fetchWithRetry(
  request,
  label,
  {
    maximumAttempts = 5,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    warn = (message) => console.warn(message),
  } = {}
) {
  let lastError = null
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await request()
      if (!isRetryableResponse(response) || attempt === maximumAttempts) {
        return response
      }
      lastError = new Error(`${label} returned ${response.status}.`)
      try {
        await response.body?.cancel()
      } catch {
        // The bounded retry remains safe if a failed body cannot close.
      }
    } catch (error) {
      lastError = error
      if (attempt === maximumAttempts) throw error
    }
    warn(`Retrying ${label} (attempt ${attempt + 1}/${maximumAttempts}).`)
    await wait(Math.min(8_000, 1_000 * 2 ** (attempt - 1)))
  }
  throw lastError ?? new Error(`${label} failed.`)
}

function isRetryableResponse(response) {
  return (
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  )
}

module.exports = {
  IMMUTABLE_CACHE_CONTROL,
  MUTABLE_CACHE_CONTROL,
  SHA256_METADATA_KEY,
  assertExactFeedContents,
  assertExactRemoteObject,
  describeLocalObject,
  ensureImmutableRemote,
  fetchWithRetry,
  isRetryableResponse,
  remoteObjectMismatches,
}
