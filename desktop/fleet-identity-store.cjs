'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { createPrivateKey } = require('node:crypto')
const {
  generateFleetDeviceIdentity,
  identityForPrivateKey,
  normalizeDeviceProfile,
  publicFleetDeviceIdentity,
} = require('./fleet-pairing-runtime.cjs')
const { normalizeFleetDeviceEndpoint } = require('./fleet-node-client.cjs')
const { normalizePublicKeySpki } = require('./fleet-auth-runtime.cjs')

const STORE_VERSION = 1
const MAX_STORE_BYTES = 64 * 1024

class FleetIdentityStoreError extends Error {
  constructor(message, code = 'fleet_identity_error') {
    super(message)
    this.name = 'FleetIdentityStoreError'
    this.code = code
  }
}

function enrollmentState(input, { allowLoopback = false } = {}) {
  if (input == null) return null
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new FleetIdentityStoreError('Fleet enrollment state is invalid.', 'invalid_store')
  }
  const ownerUid = String(input.ownerUid || '')
  if (
    ownerUid.length === 0 ||
    ownerUid.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(ownerUid)
  ) {
    throw new FleetIdentityStoreError('Fleet enrollment state is invalid.', 'invalid_store')
  }
  let endpoint
  try {
    endpoint = normalizeFleetDeviceEndpoint(input.endpoint, { allowLoopback })
  } catch {
    throw new FleetIdentityStoreError('Fleet enrollment state is invalid.', 'invalid_store')
  }
  const coordinatorKeyId = String(input.coordinatorKeyId || '')
  const coordinatorPublicKeySpki = String(
    input.coordinatorPublicKeySpki || ''
  )
  if (!coordinatorKeyId && !coordinatorPublicKeySpki) {
    return null
  }
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(coordinatorKeyId)) {
    throw new FleetIdentityStoreError('Fleet enrollment state is invalid.', 'invalid_store')
  }
  try {
    normalizePublicKeySpki(coordinatorPublicKeySpki)
  } catch {
    throw new FleetIdentityStoreError('Fleet enrollment state is invalid.', 'invalid_store')
  }
  return {
    ownerUid,
    endpoint,
    coordinatorKeyId,
    coordinatorPublicKeySpki,
    enrolledAt: new Date(input.enrolledAt).toISOString(),
  }
}

function decodeState(value, { allowLoopback = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FleetIdentityStoreError('Fleet identity file is invalid.', 'invalid_store')
  }
  if (value.version !== STORE_VERSION) {
    throw new FleetIdentityStoreError(
      'Fleet identity file uses an unsupported version.',
      'unsupported_store'
    )
  }
  const profile = normalizeDeviceProfile(value.profile)
  const deviceId = String(value.deviceId || '')
  const publicKeyFingerprint = String(value.publicKeyFingerprint || '')
  const publicKeySpki = String(value.publicKeySpki || '')
  const encryptedPrivateKey = String(value.encryptedPrivateKey || '')
  if (
    !/^dev_[a-f0-9]{32}$/.test(deviceId) ||
    !/^sha256:[A-Za-z0-9_-]{43}$/.test(publicKeyFingerprint) ||
    !/^[A-Za-z0-9+/=]{80,4096}$/.test(encryptedPrivateKey) ||
    publicKeySpki.length < 40 ||
    publicKeySpki.length > 4_096
  ) {
    throw new FleetIdentityStoreError('Fleet identity file is invalid.', 'invalid_store')
  }
  const createdAt = new Date(value.createdAt)
  if (!Number.isFinite(createdAt.getTime())) {
    throw new FleetIdentityStoreError('Fleet identity timestamp is invalid.', 'invalid_store')
  }
  return {
    version: STORE_VERSION,
    deviceId,
    publicKeyFingerprint,
    publicKeySpki,
    profile,
    encryptedPrivateKey,
    createdAt: createdAt.toISOString(),
    enrollment: enrollmentState(value.enrollment, { allowLoopback }),
  }
}

function publicState(state) {
  return {
    deviceId: state.deviceId,
    publicKeyFingerprint: state.publicKeyFingerprint,
    publicKeySpki: state.publicKeySpki,
    profile: { ...state.profile },
    createdAt: state.createdAt,
    enrollment: state.enrollment ? { ...state.enrollment } : null,
  }
}

class FleetIdentityStore {
  constructor({
    filePath,
    crypto,
    fsImpl = fs,
    now = Date.now,
    generateIdentity = generateFleetDeviceIdentity,
    allowLoopback = false,
    platform = process.platform,
  }) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new TypeError('Fleet identity file path must be absolute.')
    }
    if (
      !crypto ||
      typeof crypto.encryptString !== 'function' ||
      typeof crypto.decryptString !== 'function'
    ) {
      throw new TypeError('Fleet identity crypto is required.')
    }
    this.filePath = filePath
    this.crypto = crypto
    this.fs = fsImpl
    this.now = now
    this.generateIdentity = generateIdentity
    this.allowLoopback = allowLoopback === true
    this.platform = platform
    this.cachedIdentity = null
    this.pending = Promise.resolve()
  }

  serialized(operation) {
    const result = this.pending.then(operation, operation)
    this.pending = result.catch(() => {})
    return result
  }

  async readState() {
    let stat
    try {
      stat = await this.fs.lstat(this.filePath)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORE_BYTES) {
      throw new FleetIdentityStoreError('Fleet identity file is unsafe.', 'invalid_store')
    }
    const encoded = await this.fs.readFile(this.filePath, 'utf8')
    try {
      return decodeState(JSON.parse(encoded), {
        allowLoopback: this.allowLoopback,
      })
    } catch (error) {
      if (error instanceof FleetIdentityStoreError) throw error
      throw new FleetIdentityStoreError('Fleet identity file is invalid.', 'invalid_store')
    }
  }

  async writeState(state) {
    const parent = path.dirname(this.filePath)
    await this.fs.mkdir(parent, { recursive: true, mode: 0o700 })
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    const encoded = `${JSON.stringify(state, null, 2)}\n`
    let handle = null
    let renamed = false
    try {
      handle = await this.fs.open(temporary, 'wx', 0o600)
      await handle.writeFile(encoded, 'utf8')
      await this.fs.chmod(temporary, 0o600)
      await handle.sync()
      await handle.close()
      handle = null
      await this.fs.rename(temporary, this.filePath)
      renamed = true
      if (this.platform !== 'win32') {
        const parentHandle = await this.fs.open(parent, 'r')
        try {
          await parentHandle.sync()
        } finally {
          await parentHandle.close()
        }
      }
    } catch (error) {
      if (renamed && error && typeof error === 'object') {
        error.fleetIdentityCommitAmbiguous = true
      }
      throw error
    } finally {
      if (handle) await handle.close().catch(() => {})
      await this.fs.unlink(temporary).catch(() => {})
    }
  }

  async ensure(profileInput) {
    return this.serialized(async () => {
      const existing = await this.readState()
      if (existing) return this.loadDecoded(existing)
      return this.persistNewIdentity(profileInput)
    })
  }

  async replace(profileInput) {
    return this.serialized(async () => {
      const existing = await this.readState()
      if (!existing) {
        throw new FleetIdentityStoreError(
          'Create a Fleet identity before replacing it.',
          'identity_missing'
        )
      }
      return this.persistNewIdentity(profileInput)
    })
  }

  async persistNewIdentity(profileInput) {
    const identity = this.generateIdentity(profileInput)
    const privateKeyPem = identity.privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    }).toString()
    const encrypted = await this.crypto.encryptString(
      privateKeyPem,
      'protecting the Fleet device identity'
    )
    const state = decodeState(
      {
        version: STORE_VERSION,
        ...publicFleetDeviceIdentity(identity),
        encryptedPrivateKey: encrypted.toString('base64'),
        createdAt: new Date(this.now()).toISOString(),
        enrollment: null,
      },
      { allowLoopback: this.allowLoopback }
    )
    try {
      await this.writeState(state)
    } catch (error) {
      this.cachedIdentity = null
      if (error?.fleetIdentityCommitAmbiguous === true) throw error
      const persisted = await this.readState().catch(() => null)
      if (
        !persisted ||
        persisted.deviceId !== state.deviceId ||
        persisted.publicKeyFingerprint !== state.publicKeyFingerprint
      ) {
        throw error
      }
      return this.loadDecoded(persisted)
    }
    this.cachedIdentity = { ...identity, enrollment: null }
    return this.cachedIdentity
  }

  async load() {
    return this.serialized(async () => {
      if (this.cachedIdentity) return this.cachedIdentity
      const state = await this.readState()
      if (!state) return null
      return this.loadDecoded(state)
    })
  }

  async reload() {
    return this.serialized(async () => {
      this.cachedIdentity = null
      const state = await this.readState()
      if (!state) return null
      return this.loadDecoded(state)
    })
  }

  async loadDecoded(state) {
    const decrypted = await this.crypto.decryptString(
      Buffer.from(state.encryptedPrivateKey, 'base64'),
      'unlocking the Fleet device identity'
    )
    let privateKey
    try {
      privateKey = createPrivateKey(decrypted.result)
    } catch {
      throw new FleetIdentityStoreError(
        'Fleet private key could not be opened.',
        'invalid_private_key'
      )
    }
    const derived = identityForPrivateKey(privateKey)
    if (
      derived.deviceId !== state.deviceId ||
      derived.publicKeyFingerprint !== state.publicKeyFingerprint ||
      derived.publicKeySpki !== state.publicKeySpki
    ) {
      throw new FleetIdentityStoreError(
        'Fleet private key does not match this device.',
        'identity_mismatch'
      )
    }
    if (decrypted.shouldReEncrypt) {
      const encrypted = await this.crypto.encryptString(
        decrypted.result,
        'updating Fleet device protection'
      )
      await this.writeState({
        ...state,
        encryptedPrivateKey: encrypted.toString('base64'),
      })
    }
    this.cachedIdentity = {
      ...derived,
      publicKeySpki: state.publicKeySpki,
      privateKey,
      profile: Object.freeze({ ...state.profile }),
      enrollment: state.enrollment ? { ...state.enrollment } : null,
    }
    return this.cachedIdentity
  }

  async getPublicState() {
    const identity = await this.load()
    if (!identity) return null
    return {
      ...publicFleetDeviceIdentity(identity),
      enrollment: identity.enrollment ? { ...identity.enrollment } : null,
    }
  }

  async markEnrolled({
    ownerUid,
    endpoint,
    coordinatorKeyId,
    coordinatorPublicKeySpki,
  }) {
    return this.serialized(async () => {
      const state = await this.readState()
      if (!state) {
        throw new FleetIdentityStoreError(
          'Create a Fleet device identity before enrollment.',
          'identity_missing'
        )
      }
      await this.loadDecoded(state)
      const enrollment = enrollmentState(
        {
          ownerUid,
          endpoint,
          coordinatorKeyId,
          coordinatorPublicKeySpki,
          enrolledAt: new Date(this.now()).toISOString(),
        },
        { allowLoopback: this.allowLoopback }
      )
      const next = { ...state, enrollment }
      await this.writeState(next)
      if (this.cachedIdentity) {
        this.cachedIdentity = { ...this.cachedIdentity, enrollment }
      }
      return publicState(next)
    })
  }

  dispose() {
    this.cachedIdentity = null
  }
}

module.exports = {
  FleetIdentityStore,
  FleetIdentityStoreError,
  STORE_VERSION,
  decodeState,
  publicState,
}
