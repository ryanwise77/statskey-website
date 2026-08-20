'use strict'

const {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
} = require('node:crypto')
const {
  canonicalJson,
  createSignedDeviceRequest,
  deviceIdentityForPublicKey,
  exportPublicKeySpki,
} = require('./fleet-auth-runtime.cjs')
const {
  FLEET_CAPABILITIES,
  normalizeRepositoryIdentity,
} = require('./fleet-runtime.cjs')

const DEVICE_ROLES = new Set(['controller', 'worker', 'hybrid'])
const WORKER_MODES = new Set(['dedicated', 'opt-in', 'disabled'])
const PLATFORMS = new Set(['darwin', 'win32', 'linux', 'ios', 'android'])
const FLEET_CAPABILITY_SET = new Set(FLEET_CAPABILITIES)
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PAIRING_APPROVAL_LIFETIME_MS = 5 * 60_000

function requiredString(value, maximum, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} is required.`)
  const cleaned = value.trim()
  if (
    cleaned.length === 0 ||
    cleaned.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(cleaned)
  ) {
    throw new TypeError(`${name} is invalid.`)
  }
  return cleaned
}

function boundedInteger(value, minimum, maximum, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${name} is outside its allowed range.`)
  }
  return number
}

function uniqueStrings(values, maximum, name, predicate) {
  if (!Array.isArray(values) || values.length === 0 || values.length > maximum) {
    throw new TypeError(`${name} is invalid.`)
  }
  const result = []
  const seen = new Set()
  for (const value of values) {
    const cleaned = requiredString(value, 128, name)
    if (!predicate(cleaned) || seen.has(cleaned)) {
      throw new TypeError(`${name} is invalid.`)
    }
    seen.add(cleaned)
    result.push(cleaned)
  }
  return result.sort()
}

function normalizeDeviceProfile(input = {}) {
  const role = requiredString(input.role, 24, 'role')
  const workerMode = requiredString(input.workerMode, 24, 'workerMode')
  const platform = requiredString(input.platform, 24, 'platform')
  if (!DEVICE_ROLES.has(role)) throw new TypeError('role is invalid.')
  if (!WORKER_MODES.has(workerMode)) throw new TypeError('workerMode is invalid.')
  if (!PLATFORMS.has(platform)) throw new TypeError('platform is invalid.')
  if (role === 'controller' && workerMode !== 'disabled') {
    throw new TypeError('A controller-only device cannot enable worker mode.')
  }
  if (role === 'worker' && workerMode === 'disabled') {
    throw new TypeError('A worker device cannot disable worker mode.')
  }
  return {
    label: requiredString(input.label, 80, 'label'),
    role,
    workerMode,
    platform,
    maxConcurrentJobs: boundedInteger(
      input.maxConcurrentJobs ?? 1,
      1,
      128,
      'maxConcurrentJobs'
    ),
  }
}

function generateFleetDeviceIdentity(profileInput, {
  generateKeyPair = generateKeyPairSync,
} = {}) {
  const profile = normalizeDeviceProfile(profileInput)
  const { publicKey, privateKey } = generateKeyPair('ed25519')
  const publicKeySpki = exportPublicKeySpki(publicKey)
  const identity = deviceIdentityForPublicKey(publicKeySpki)
  return Object.freeze({
    ...identity,
    publicKeySpki,
    privateKey,
    profile: Object.freeze(profile),
  })
}

function identityForPrivateKey(privateKey) {
  const publicKeySpki = exportPublicKeySpki(createPublicKey(privateKey))
  return {
    ...deviceIdentityForPublicKey(publicKeySpki),
    publicKeySpki,
  }
}

function createPairingReceipt({
  controller,
  candidate,
  ownerUid,
  workspaceIds,
  repositoryIdentities,
  capabilities,
  unattended = false,
  policyVersion = 1,
  grantExpiresAt,
  now = Date.now(),
  pairingNonce = randomBytes(32).toString('base64url'),
}) {
  const controllerIdentity = controller?.privateKey
    ? identityForPrivateKey(controller.privateKey)
    : controller
  const candidateIdentity = candidate?.privateKey
    ? identityForPrivateKey(candidate.privateKey)
    : candidate
  if (
    controller.deviceId !== controllerIdentity.deviceId ||
    candidate.deviceId !== candidateIdentity.deviceId ||
    candidate.publicKeySpki !== candidateIdentity.publicKeySpki
  ) {
    throw new TypeError('A device identity does not match its private key.')
  }
  const candidateProfile = normalizeDeviceProfile(candidate.profile)
  if (!['controller', 'hybrid'].includes(controller.profile?.role)) {
    throw new TypeError('The approving device is not a controller.')
  }
  if (!['worker', 'hybrid'].includes(candidateProfile.role)) {
    throw new TypeError('The candidate is not a worker.')
  }
  const issuedAt = Number(now)
  const expiresAt = Number(grantExpiresAt)
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt > issuedAt + 365 * 24 * 60 * 60 * 1000
  ) {
    throw new RangeError('grantExpiresAt is invalid.')
  }
  if (typeof pairingNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairingNonce)) {
    throw new TypeError('pairingNonce is invalid.')
  }
  const normalizedCapabilities = uniqueStrings(
    capabilities,
    FLEET_CAPABILITIES.length,
    'capabilities',
    (value) => FLEET_CAPABILITY_SET.has(value)
  )
  if (
    !Array.isArray(repositoryIdentities) ||
    repositoryIdentities.length > 128
  ) {
    throw new TypeError('repositoryIdentities is invalid.')
  }
  const normalizedRepositoryIdentities = [
    ...new Set(
      repositoryIdentities.map((value) => normalizeRepositoryIdentity(value))
    ),
  ].sort()
  if (normalizedRepositoryIdentities.length === 0) {
    throw new TypeError('repositoryIdentities requires at least one value.')
  }
  return {
    pairingNonce,
    ownerUid: requiredString(ownerUid, 128, 'ownerUid'),
    controllerDeviceId: controllerIdentity.deviceId,
    candidate: {
      ...candidateProfile,
      publicKeySpki: candidateIdentity.publicKeySpki,
    },
    workspaceIds: uniqueStrings(
      workspaceIds,
      128,
      'workspaceIds',
      (value) => value === '*' || WORKSPACE_ID_PATTERN.test(value)
    ),
    repositoryIdentities: normalizedRepositoryIdentities,
    capabilities: normalizedCapabilities,
    unattended: unattended === true,
    grantExpiresAt: expiresAt,
    policyVersion: boundedInteger(policyVersion, 1, 1, 'policyVersion'),
  }
}

function createControllerPairingReceipt({
  controller,
  candidate,
  ownerUid,
  grantExpiresAt,
  now = Date.now(),
  pairingNonce = randomBytes(32).toString('base64url'),
}) {
  const controllerIdentity = controller?.privateKey
    ? identityForPrivateKey(controller.privateKey)
    : controller
  const candidateIdentity = candidate?.privateKey
    ? identityForPrivateKey(candidate.privateKey)
    : candidate
  if (
    controller.deviceId !== controllerIdentity.deviceId ||
    candidate.deviceId !== candidateIdentity.deviceId ||
    candidate.publicKeySpki !== candidateIdentity.publicKeySpki
  ) {
    throw new TypeError('A device identity does not match its private key.')
  }
  const candidateProfile = normalizeDeviceProfile(candidate.profile)
  if (!['controller', 'hybrid'].includes(controller.profile?.role)) {
    throw new TypeError('The approving device is not a controller.')
  }
  if (
    candidateProfile.role !== 'hybrid' ||
    candidateProfile.workerMode !== 'disabled'
  ) {
    throw new TypeError(
      'A controller candidate must be a hybrid device with worker mode disabled.'
    )
  }
  const issuedAt = Number(now)
  const expiresAt = grantExpiresAt == null
    ? issuedAt + PAIRING_APPROVAL_LIFETIME_MS
    : Number(grantExpiresAt)
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt > issuedAt + 365 * 24 * 60 * 60 * 1000
  ) {
    throw new RangeError('grantExpiresAt is invalid.')
  }
  if (typeof pairingNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairingNonce)) {
    throw new TypeError('pairingNonce is invalid.')
  }
  // A controller-only device (for example a phone) authorizes jobs but never
  // executes them, so the receipt carries deliberately empty execution scope.
  return {
    pairingNonce,
    ownerUid: requiredString(ownerUid, 128, 'ownerUid'),
    controllerDeviceId: controllerIdentity.deviceId,
    candidate: {
      ...candidateProfile,
      publicKeySpki: candidateIdentity.publicKeySpki,
    },
    workspaceIds: [],
    repositoryIdentities: [],
    capabilities: [],
    unattended: false,
    grantExpiresAt: expiresAt,
    policyVersion: 1,
  }
}

function isControllerCandidateProfile(profile) {
  return profile?.role === 'hybrid' && profile?.workerMode === 'disabled'
}

class FleetPairingApprovalRegistry {
  constructor({
    now = Date.now,
    lifetimeMs = PAIRING_APPROVAL_LIFETIME_MS,
    maximumPending = 32,
  } = {}) {
    if (typeof now !== 'function') throw new TypeError('now must be a function.')
    this.now = now
    this.lifetimeMs = boundedInteger(
      lifetimeMs,
      5_000,
      PAIRING_APPROVAL_LIFETIME_MS,
      'lifetimeMs'
    )
    this.maximumPending = boundedInteger(
      maximumPending,
      1,
      128,
      'maximumPending'
    )
    this.pending = new Map()
  }

  retainWorkerApproval(receipt, controllerDeviceId) {
    const normalized = validatePairingReceipt(receipt, { now: this.now() })
    if (
      normalized.controllerDeviceId !== controllerDeviceId ||
      normalized.candidate.role !== 'worker' ||
      normalized.candidate.workerMode !== 'dedicated'
    ) {
      throw new TypeError(
        'Worker approval requires this controller and a dedicated worker.'
      )
    }
    return this.retain(normalized, controllerDeviceId)
  }

  retainControllerApproval(receipt, controllerDeviceId) {
    const normalized = validatePairingReceipt(receipt, { now: this.now() })
    if (
      normalized.controllerDeviceId !== controllerDeviceId ||
      !isControllerCandidateProfile(normalized.candidate)
    ) {
      throw new TypeError(
        'Controller approval requires this controller and a disabled-mode hybrid candidate.'
      )
    }
    return this.retain(normalized, controllerDeviceId)
  }

  retain(normalized, controllerDeviceId) {
    this.prune()
    if (this.pending.size >= this.maximumPending) {
      throw new Error('Too many Fleet pairing approvals are pending.')
    }
    const digest = pairingReceiptDigest(normalized)
    this.pending.set(digest, {
      controllerDeviceId,
      expiresAt: Number(this.now()) + this.lifetimeMs,
      claimed: false,
    })
    return normalized
  }

  beginWorkerApproval(receipt, controllerDeviceId) {
    const normalized = validatePairingReceipt(receipt, { now: this.now() })
    this.prune()
    const digest = pairingReceiptDigest(normalized)
    const pending = this.pending.get(digest)
    if (
      !pending ||
      pending.claimed ||
      pending.controllerDeviceId !== controllerDeviceId ||
      normalized.controllerDeviceId !== controllerDeviceId
    ) {
      throw new Error(
        'This pairing receipt was not created by the local controller.'
      )
    }
    pending.claimed = true
    return Object.freeze({ digest, normalizedReceipt: normalized })
  }

  finishWorkerApproval(claim) {
    if (typeof claim?.digest === 'string') this.pending.delete(claim.digest)
  }

  prune() {
    const now = Number(this.now())
    for (const [digest, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(digest)
    }
  }
}

function pairingReceiptDigest(receipt) {
  return createHash('sha256').update(canonicalJson(receipt)).digest('base64url')
}

function signPairingReceipt({
  identity,
  receipt,
  action,
  now = Date.now(),
  proofLifetimeMs = 5 * 60_000,
}) {
  const { normalizedReceipt, signer } = validatePairingSigner({
    identity,
    receipt,
    action,
    now,
  })
  const issuedAt = Number(now)
  const lifetime = boundedInteger(proofLifetimeMs, 5_000, 5 * 60_000, 'proofLifetimeMs')
  if (!Number.isFinite(issuedAt)) throw new TypeError('now is invalid.')
  return createSignedDeviceRequest({
    privateKey: identity.privateKey,
    deviceId: signer.deviceId,
    action,
    payload: normalizedReceipt,
    issuedAt,
    expiresAt: issuedAt + lifetime,
  })
}

function validatePairingSigner({
  identity,
  receipt,
  action,
  now = Date.now(),
}) {
  if (!identity?.privateKey) throw new TypeError('The device private key is required.')
  const normalizedReceipt = validatePairingReceipt(receipt, { now })
  const signer = identityForPrivateKey(identity.privateKey)
  const expectedDeviceId =
    action === 'pairing.candidate'
      ? deviceIdentityForPublicKey(receipt?.candidate?.publicKeySpki || '').deviceId
      : receipt?.controllerDeviceId
  if (
    !['pairing.candidate', 'pairing.approve'].includes(action) ||
    identity.deviceId !== signer.deviceId ||
    signer.deviceId !== expectedDeviceId
  ) {
    throw new TypeError('The pairing signer does not match the receipt.')
  }
  const localProfile = normalizeDeviceProfile(identity.profile)
  if (action === 'pairing.candidate') {
    const receiptProfile = {
      label: normalizedReceipt.candidate.label,
      role: normalizedReceipt.candidate.role,
      workerMode: normalizedReceipt.candidate.workerMode,
      platform: normalizedReceipt.candidate.platform,
      maxConcurrentJobs: normalizedReceipt.candidate.maxConcurrentJobs,
    }
    if (canonicalJson(localProfile) !== canonicalJson(receiptProfile)) {
      throw new TypeError(
        'The pairing candidate profile does not match this device.'
      )
    }
  } else if (!['controller', 'hybrid'].includes(localProfile.role)) {
    throw new TypeError('The pairing approver is not a controller.')
  }
  return { normalizedReceipt, signer }
}

function validatePairingReceipt(receipt, { now = Date.now() } = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('The pairing receipt is invalid.')
  }
  const controllerStub = {
    deviceId: receipt.controllerDeviceId,
    profile: {
      label: 'Receipt controller',
      role: 'controller',
      workerMode: 'disabled',
      platform: 'darwin',
      maxConcurrentJobs: 1,
    },
  }
  const candidateStub = {
    ...deviceIdentityForPublicKey(receipt.candidate?.publicKeySpki || ''),
    publicKeySpki: receipt.candidate?.publicKeySpki,
    profile: receipt.candidate,
  }
  const normalized = isControllerCandidateProfile(receipt.candidate) ?
    createControllerPairingReceipt({
      controller: controllerStub,
      candidate: candidateStub,
      ownerUid: receipt.ownerUid,
      grantExpiresAt: receipt.grantExpiresAt,
      now,
      pairingNonce: receipt.pairingNonce,
    }) :
    createPairingReceipt({
      controller: controllerStub,
      ownerUid: receipt.ownerUid,
      candidate: candidateStub,
      workspaceIds: receipt.workspaceIds,
      repositoryIdentities: receipt.repositoryIdentities,
      capabilities: receipt.capabilities,
      unattended: receipt.unattended,
      policyVersion: receipt.policyVersion,
      grantExpiresAt: receipt.grantExpiresAt,
      now,
      pairingNonce: receipt.pairingNonce,
    })
  if (canonicalJson(normalized) !== canonicalJson(receipt)) {
    throw new TypeError('The pairing receipt is not canonical.')
  }
  return normalized
}

function createPairDeviceInput({
  controller,
  candidate,
  proofLifetimeMs = 5 * 60_000,
  ...receiptInput
}) {
  if (!controller?.privateKey || !candidate?.privateKey) {
    throw new TypeError('Both device private keys are required.')
  }
  const receipt = createPairingReceipt({
    controller,
    candidate,
    ...receiptInput,
  })
  const now = receiptInput.now ?? Date.now()
  return {
    receipt,
    candidateProof: signPairingReceipt({
      identity: candidate,
      receipt,
      action: 'pairing.candidate',
      now,
      proofLifetimeMs,
    }),
    controllerProof: signPairingReceipt({
      identity: controller,
      receipt,
      action: 'pairing.approve',
      now,
      proofLifetimeMs,
    }),
  }
}

function publicFleetDeviceIdentity(identity) {
  if (!identity?.deviceId || !identity?.publicKeySpki || !identity?.profile) {
    throw new TypeError('Fleet device identity is invalid.')
  }
  return {
    deviceId: identity.deviceId,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    publicKeySpki: identity.publicKeySpki,
    profile: { ...identity.profile },
  }
}

module.exports = {
  FleetPairingApprovalRegistry,
  createControllerPairingReceipt,
  createPairDeviceInput,
  createPairingReceipt,
  generateFleetDeviceIdentity,
  identityForPrivateKey,
  isControllerCandidateProfile,
  normalizeDeviceProfile,
  publicFleetDeviceIdentity,
  signPairingReceipt,
  validatePairingSigner,
  validatePairingReceipt,
}
