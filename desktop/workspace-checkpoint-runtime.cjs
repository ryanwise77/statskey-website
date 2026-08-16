const {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
const path = require('node:path')
const {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require('node:crypto')

const CHECKPOINT_FORMAT = 'statskey.workspace-checkpoint'
const CHECKPOINT_VERSION = 2
const KEY_BYTES = 32
const IV_BYTES = 12
const MAX_CHECKPOINT_PAYLOAD_BYTES = 32 * 1024 * 1024
const MAX_CHECKPOINT_DIRECTORY_ENTRIES = 500
const MAX_CHECKPOINT_FILES = 256
const MAX_CHECKPOINT_FILE_BYTES = 2 * 1024 * 1024
const MAX_CHECKPOINT_PATH_CHARACTERS = 4_096
const MAX_METADATA_BYTES = 16 * 1024
const METADATA_SUFFIX = '.meta.json'

class WorkspaceCheckpointStore {
  constructor({
    directory,
    keyPath,
    legacyCrypto,
    platform = process.platform,
    chmod = chmodSync,
  }) {
    this.directory = directory
    this.keyPath = keyPath
    this.legacyCrypto = legacyCrypto
    this.platform = platform
    this.chmod = chmod
    this.cachedKey = null
  }

  async create(checkpoint) {
    const normalized = validateCheckpoint(checkpoint)
    const key = this.loadOrCreateKey()
    const metadata = checkpointMetadata(normalized)
    const authenticatedMetadata = metadataBytes(metadata)
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(authenticatedMetadata)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(normalized), 'utf8'),
      cipher.final(),
    ])
    const envelope = {
      format: CHECKPOINT_FORMAT,
      version: CHECKPOINT_VERSION,
      metadata,
      metadataMac: metadataMac(key, authenticatedMetadata),
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    }
    this.atomicWrite(this.checkpointPath(normalized.id), JSON.stringify(envelope))
    this.atomicWrite(
      this.metadataPath(normalized.id),
      JSON.stringify({
        format: CHECKPOINT_FORMAT,
        version: CHECKPOINT_VERSION,
        metadata,
        metadataMac: envelope.metadataMac,
      })
    )
    return metadata
  }

  async read(checkpointId) {
    if (!validCheckpointId(checkpointId)) return null
    const bytes = readBoundedFile(
      this.checkpointPath(checkpointId),
      MAX_CHECKPOINT_PAYLOAD_BYTES
    )
    if (!bytes) return null
    try {
      const parsed = parseJsonBytes(bytes)
      if (isCurrentEnvelope(parsed)) {
        return this.decryptEnvelope(parsed, checkpointId)
      }
      if (parsed) return validateCheckpoint(parsed, checkpointId)

      const legacy = await this.legacyCrypto.decryptString(
        bytes,
        'unlocking a legacy workspace checkpoint'
      )
      return validateCheckpoint(JSON.parse(legacy.result), checkpointId)
    } catch {
      return null
    }
  }

  async list(limit = 100) {
    let names
    try {
      names = readdirSync(this.directory)
        .filter((name) => name.endsWith('.bin'))
        .slice(0, MAX_CHECKPOINT_DIRECTORY_ENTRIES)
    } catch {
      return []
    }
    let key = null
    let keyResolved = false
    const results = []
    for (const name of names) {
      const id = name.slice(0, -4)
      if (!validCheckpointId(id)) continue
      const filePath = this.checkpointPath(id)
      try {
        const sidecar = readSmallJson(this.metadataPath(id), MAX_METADATA_BYTES)
        if (isCurrentEnvelope(sidecar)) {
          if (!keyResolved) {
            try {
              key = this.loadExistingKey()
            } catch {
              key = null
            }
            keyResolved = true
          }
          if (key && validEnvelopeMetadata(sidecar, key, id)) {
            results.push(sidecar.metadata)
            continue
          }
        }
        // Listing is intentionally payload-blind. Legacy plaintext, legacy
        // Keychain ciphertext, corrupt payloads, and a versioned payload whose
        // sidecar is missing all get safe stat-only metadata. The payload is
        // opened only after the user explicitly selects a restore.
        const stats = statSync(filePath)
        if (!stats.isFile()) continue
        results.push({
          id,
          createdAt: stats.mtime.toISOString(),
          label: 'Workspace checkpoint',
          fileCount: 0,
          legacyEncrypted: true,
        })
      } catch {
        // Corrupt entries are omitted without risking the workspace or Keychain.
      }
    }
    return results
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)))
  }

  decryptEnvelope(envelope, expectedId) {
    const key = this.loadExistingKey()
    if (!key || !validEnvelopeMetadata(envelope, key, expectedId)) return null
    const authenticatedMetadata = metadataBytes(envelope.metadata)
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      decodeBase64(envelope.iv, IV_BYTES)
    )
    decipher.setAAD(authenticatedMetadata)
    decipher.setAuthTag(decodeBase64(envelope.tag, 16))
    const plaintext = Buffer.concat([
      decipher.update(decodeBase64(envelope.ciphertext)),
      decipher.final(),
    ]).toString('utf8')
    return validateCheckpoint(JSON.parse(plaintext), expectedId)
  }

  loadOrCreateKey() {
    const existing = this.loadExistingKey()
    if (existing) return existing
    mkdirSync(path.dirname(this.keyPath), { recursive: true, mode: 0o700 })
    const generated = randomBytes(KEY_BYTES)
    try {
      const descriptor = openSync(this.keyPath, 'wx', 0o600)
      try {
        writeFileSync(descriptor, generated)
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      this.hardenPermissions(this.keyPath, 0o600)
      this.cachedKey = generated
      return generated
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const raced = this.loadExistingKey()
      if (!raced) throw new Error('Workspace checkpoint key is unavailable.')
      return raced
    }
  }

  loadExistingKey() {
    if (this.cachedKey) return this.cachedKey
    if (!existsSync(this.keyPath)) return null
    const stats = statSync(this.keyPath)
    if (!stats.isFile() || !this.hasSafePrivatePermissions(stats)) {
      throw new Error('Workspace checkpoint key permissions are unsafe.')
    }
    const key = readFileSync(this.keyPath)
    if (key.length !== KEY_BYTES) {
      throw new Error('Workspace checkpoint key is invalid.')
    }
    this.cachedKey = key
    return key
  }

  checkpointPath(checkpointId) {
    return path.join(this.directory, `${checkpointId}.bin`)
  }

  metadataPath(checkpointId) {
    return path.join(this.directory, `${checkpointId}${METADATA_SUFFIX}`)
  }

  atomicWrite(filePath, contents) {
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    this.hardenPermissions(path.dirname(filePath), 0o700)
    const temporary = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${randomBytes(8).toString('hex')}.tmp`
    )
    let descriptor
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, contents, 'utf8')
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporary, filePath)
      this.hardenPermissions(filePath, 0o600)
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor)
      try {
        unlinkSync(temporary)
      } catch {}
      throw error
    }
  }

  hasSafePrivatePermissions(stats) {
    // Windows reports synthesized POSIX mode bits even though access is
    // governed by the user's NTFS ACL. Treating those bits as an ACL makes a
    // valid key unreadable after every restart. POSIX hosts keep the strict
    // group/other-bit rejection that protects checkpoint contents there.
    return this.platform === 'win32' || (stats.mode & 0o077) === 0
  }

  hardenPermissions(filePath, mode) {
    // chmod on Windows cannot express the private ACL guarantee implied by
    // 0600/0700 and its synthesized mode is not stable across processes. The
    // key remains inside Electron's per-user app-data directory; Windows
    // protects that directory with the user's profile ACL.
    if (this.platform !== 'win32') this.chmod(filePath, mode)
  }
}

function checkpointMetadata(checkpoint) {
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    label: checkpoint.label,
    fileCount: checkpoint.files.length,
  }
}

function validateCheckpoint(value, expectedId) {
  if (!value || typeof value !== 'object' || !validCheckpointId(value.id)) {
    throw new Error('Workspace checkpoint is invalid.')
  }
  if (expectedId && value.id !== expectedId) {
    throw new Error('Workspace checkpoint identity does not match its file.')
  }
  if (
    !Array.isArray(value.files) ||
    value.files.length > MAX_CHECKPOINT_FILES
  ) {
    throw new Error('Workspace checkpoint files are invalid.')
  }
  const createdAt = new Date(value.createdAt)
  if (!Number.isFinite(createdAt.getTime())) {
    throw new Error('Workspace checkpoint date is invalid.')
  }
  return {
    id: value.id,
    createdAt: createdAt.toISOString(),
    label: String(value.label || 'Workspace change').slice(0, 240),
    files: value.files.map(validateCheckpointFile),
  }
}

function validateCheckpointFile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workspace checkpoint file record is invalid.')
  }
  if (
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    value.path.length > MAX_CHECKPOINT_PATH_CHARACTERS ||
    value.path.includes('\0') ||
    !path.isAbsolute(value.path)
  ) {
    throw new Error('Workspace checkpoint file path is invalid.')
  }
  if (typeof value.existed !== 'boolean') {
    throw new Error('Workspace checkpoint file state is invalid.')
  }
  if (!value.existed) {
    if (value.content !== null || value.mode !== null) {
      throw new Error('Workspace checkpoint missing-file state is invalid.')
    }
    return {
      path: value.path,
      existed: false,
      content: null,
      mode: null,
    }
  }
  if (
    typeof value.content !== 'string' ||
    value.content.length > Math.ceil(MAX_CHECKPOINT_FILE_BYTES / 3) * 4
  ) {
    throw new Error('Workspace checkpoint file contents are invalid.')
  }
  const decoded = Buffer.from(value.content, 'base64')
  if (
    decoded.length > MAX_CHECKPOINT_FILE_BYTES ||
    decoded.toString('base64') !== value.content
  ) {
    throw new Error('Workspace checkpoint file contents are invalid.')
  }
  if (
    !Number.isSafeInteger(value.mode) ||
    value.mode < 0 ||
    value.mode > 0o177777
  ) {
    throw new Error('Workspace checkpoint file mode is invalid.')
  }
  return {
    path: value.path,
    existed: true,
    content: value.content,
    mode: value.mode,
  }
}

function validCheckpointId(value) {
  return typeof value === 'string' && /^[a-f0-9-]{16,80}$/i.test(value)
}

function parseJsonBytes(bytes) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (!text.startsWith('{')) return null
  return JSON.parse(text)
}

function isCurrentEnvelope(value) {
  return (
    value?.format === CHECKPOINT_FORMAT && value?.version === CHECKPOINT_VERSION
  )
}

function metadataBytes(metadata) {
  return Buffer.from(
    JSON.stringify({
      format: CHECKPOINT_FORMAT,
      version: CHECKPOINT_VERSION,
      metadata,
    }),
    'utf8'
  )
}

function metadataMac(key, authenticatedMetadata) {
  return createHmac('sha256', key)
    .update('metadata\0')
    .update(authenticatedMetadata)
    .digest('base64')
}

function validEnvelopeMetadata(envelope, key, expectedId) {
  try {
    if (!isCurrentEnvelope(envelope) || envelope.metadata?.id !== expectedId) {
      return false
    }
    if (
      !Number.isInteger(envelope.metadata.fileCount) ||
      envelope.metadata.fileCount < 0 ||
      envelope.metadata.fileCount > 10_000
    ) {
      return false
    }
    const normalized = {
      id: envelope.metadata.id,
      createdAt: new Date(envelope.metadata.createdAt).toISOString(),
      label: String(envelope.metadata.label || '').slice(0, 240),
      fileCount: envelope.metadata.fileCount,
    }
    if (JSON.stringify(normalized) !== JSON.stringify(envelope.metadata)) {
      return false
    }
    const actual = decodeBase64(envelope.metadataMac, 32)
    const expected = Buffer.from(
      metadataMac(key, metadataBytes(envelope.metadata)),
      'base64'
    )
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function decodeBase64(value, expectedLength) {
  if (typeof value !== 'string' || !value) throw new Error('Invalid envelope.')
  const decoded = Buffer.from(value, 'base64')
  if (expectedLength && decoded.length !== expectedLength) {
    throw new Error('Invalid envelope.')
  }
  return decoded
}

function readBoundedFile(filePath, maximumBytes) {
  let descriptor
  try {
    descriptor = openSync(filePath, 'r')
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size <= 0 || stats.size > maximumBytes) {
      return null
    }
    const buffer = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < buffer.length) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        offset
      )
      if (bytesRead === 0) return null
      offset += bytesRead
    }
    return buffer
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function readSmallJson(filePath, maximumBytes) {
  try {
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size <= 0 || stats.size > maximumBytes) {
      return null
    }
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

module.exports = {
  CHECKPOINT_FORMAT,
  CHECKPOINT_VERSION,
  MAX_CHECKPOINT_DIRECTORY_ENTRIES,
  MAX_CHECKPOINT_FILES,
  MAX_CHECKPOINT_FILE_BYTES,
  MAX_CHECKPOINT_PATH_CHARACTERS,
  MAX_CHECKPOINT_PAYLOAD_BYTES,
  WorkspaceCheckpointStore,
}
