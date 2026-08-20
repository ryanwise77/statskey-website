'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  verifySignedDeviceRequest,
} = require('./fleet-auth-runtime.cjs')
const {
  FleetPairingApprovalRegistry,
  createControllerPairingReceipt,
  createPairDeviceInput,
  createPairingReceipt,
  generateFleetDeviceIdentity,
  publicFleetDeviceIdentity,
  signPairingReceipt,
  validatePairingReceipt,
} = require('./fleet-pairing-runtime.cjs')

const NOW = Date.parse('2026-08-19T07:00:00.000Z')
const OWNER = 'owner-pairing-test'

function identities() {
  return {
    controller: generateFleetDeviceIdentity({
      label: 'Owner laptop',
      role: 'controller',
      workerMode: 'disabled',
      platform: 'darwin',
      maxConcurrentJobs: 1,
    }),
    candidate: generateFleetDeviceIdentity({
      label: 'Build Mac mini',
      role: 'worker',
      workerMode: 'dedicated',
      platform: 'darwin',
      maxConcurrentJobs: 2,
    }),
  }
}

test('pairing binds one receipt to both device keys', () => {
  const { controller, candidate } = identities()
  const input = createPairDeviceInput({
    controller,
    candidate,
    ownerUid: OWNER,
    workspaceIds: ['statskey-website', 'statskey-ios'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['xcode.test', 'workspace.snapshot', 'workspace.read'],
    unattended: true,
    policyVersion: 1,
    grantExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    now: NOW,
    pairingNonce: 'n'.repeat(43),
  })
  assert.equal(input.receipt.controllerDeviceId, controller.deviceId)
  assert.equal(input.receipt.candidate.publicKeySpki, candidate.publicKeySpki)
  assert.deepEqual(input.receipt.capabilities, [
    'workspace.read',
    'workspace.snapshot',
    'xcode.test',
  ])
  verifySignedDeviceRequest({
    publicKeySpki: candidate.publicKeySpki,
    envelope: input.candidateProof,
    payload: input.receipt,
    expectedAction: 'pairing.candidate',
    now: NOW,
  })
  verifySignedDeviceRequest({
    publicKeySpki: controller.publicKeySpki,
    envelope: input.controllerProof,
    payload: input.receipt,
    expectedAction: 'pairing.approve',
    now: NOW,
  })
  assert.equal(JSON.stringify(input).includes('PRIVATE KEY'), false)
})

test('controller pairing receipts carry no execution scope and round-trip', () => {
  const { controller } = identities()
  const phone = generateFleetDeviceIdentity({
    label: 'Ryan iPhone',
    role: 'hybrid',
    workerMode: 'disabled',
    platform: 'ios',
    maxConcurrentJobs: 1,
  })
  const receipt = createControllerPairingReceipt({
    controller: publicFleetDeviceIdentity(controller),
    candidate: publicFleetDeviceIdentity(phone),
    ownerUid: OWNER,
    now: NOW,
    pairingNonce: 'c'.repeat(43),
  })
  assert.deepEqual(receipt.workspaceIds, [])
  assert.deepEqual(receipt.repositoryIdentities, [])
  assert.deepEqual(receipt.capabilities, [])
  assert.equal(receipt.unattended, false)
  assert.equal(receipt.candidate.platform, 'ios')
  assert.equal(receipt.grantExpiresAt, NOW + 5 * 60_000)

  // The receipt validates canonically and both device keys can sign it.
  assert.equal(validatePairingReceipt(receipt, { now: NOW }) !== null, true)
  const candidateProof = signPairingReceipt({
    identity: phone,
    receipt,
    action: 'pairing.candidate',
    now: NOW,
  })
  verifySignedDeviceRequest({
    publicKeySpki: phone.publicKeySpki,
    envelope: candidateProof,
    payload: receipt,
    expectedAction: 'pairing.candidate',
    now: NOW,
  })
  const controllerProof = signPairingReceipt({
    identity: controller,
    receipt,
    action: 'pairing.approve',
    now: NOW,
  })
  verifySignedDeviceRequest({
    publicKeySpki: controller.publicKeySpki,
    envelope: controllerProof,
    payload: receipt,
    expectedAction: 'pairing.approve',
    now: NOW,
  })

  // The registry retains and claims controller approvals distinctly.
  const registry = new FleetPairingApprovalRegistry({ now: () => NOW })
  registry.retainControllerApproval(receipt, controller.deviceId)
  const claim = registry.beginWorkerApproval(receipt, controller.deviceId)
  assert.ok(claim.digest)
  registry.finishWorkerApproval(claim)

  // A controller candidate can never be retained as a worker, and a worker
  // candidate can never be retained as a controller.
  assert.throws(
    () => registry.retainWorkerApproval(receipt, controller.deviceId),
    /dedicated worker/
  )
  const { candidate } = identities()
  const workerReceipt = createPairingReceipt({
    controller: publicFleetDeviceIdentity(controller),
    candidate: publicFleetDeviceIdentity(candidate),
    ownerUid: OWNER,
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['workspace.read'],
    grantExpiresAt: NOW + 60_000,
    now: NOW,
    pairingNonce: 'w'.repeat(43),
  })
  assert.throws(
    () => registry.retainControllerApproval(workerReceipt, controller.deviceId),
    /disabled-mode hybrid/
  )

  // Controller receipts reject non-hybrid or enabled candidates.
  assert.throws(
    () =>
      createControllerPairingReceipt({
        controller: publicFleetDeviceIdentity(controller),
        candidate: publicFleetDeviceIdentity(candidate),
        ownerUid: OWNER,
        now: NOW,
        pairingNonce: 'x'.repeat(43),
      }),
    /worker mode disabled/
  )
})

test('pairing proofs fail if any grant field changes', () => {
  const { controller, candidate } = identities()
  const input = createPairDeviceInput({
    controller,
    candidate,
    ownerUid: OWNER,
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['workspace.read'],
    grantExpiresAt: NOW + 60_000,
    now: NOW,
    pairingNonce: 'p'.repeat(43),
  })
  assert.throws(
    () =>
      verifySignedDeviceRequest({
        publicKeySpki: controller.publicKeySpki,
        envelope: input.controllerProof,
        payload: {
          ...input.receipt,
          capabilities: ['workspace.read', 'workspace.write'],
        },
        expectedAction: 'pairing.approve',
        now: NOW,
      }),
    { code: 'payload_mismatch' }
  )
})

test('controller and candidate can sign on separate devices', () => {
  const { controller, candidate } = identities()
  const receipt = createPairingReceipt({
    controller: publicFleetDeviceIdentity(controller),
    candidate: publicFleetDeviceIdentity(candidate),
    ownerUid: OWNER,
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['workspace.read', 'xcode.test'],
    grantExpiresAt: NOW + 60_000,
    now: NOW,
    pairingNonce: 's'.repeat(43),
  })
  const candidateProof = signPairingReceipt({
    identity: candidate,
    receipt,
    action: 'pairing.candidate',
    now: NOW,
  })
  const controllerProof = signPairingReceipt({
    identity: controller,
    receipt,
    action: 'pairing.approve',
    now: NOW,
  })
  assert.equal(candidateProof.deviceId, candidate.deviceId)
  assert.equal(controllerProof.deviceId, controller.deviceId)
  assert.equal(candidateProof.payloadDigest, controllerProof.payloadDigest)
})

test('candidate proof cannot escalate the protected local device profile', () => {
  const { controller, candidate } = identities()
  const receipt = createPairingReceipt({
    controller: publicFleetDeviceIdentity(controller),
    candidate: publicFleetDeviceIdentity(candidate),
    ownerUid: OWNER,
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['workspace.read', 'xcode.test'],
    grantExpiresAt: NOW + 60_000,
    now: NOW,
    pairingNonce: 'e'.repeat(43),
  })
  const escalated = {
    ...receipt,
    candidate: {
      ...receipt.candidate,
      role: 'hybrid',
      workerMode: 'opt-in',
      maxConcurrentJobs: 128,
    },
  }
  assert.throws(
    () =>
      signPairingReceipt({
        identity: candidate,
        receipt: escalated,
        action: 'pairing.candidate',
        now: NOW,
      }),
    /profile does not match/
  )
})

test('controller signs only its exact retained dedicated-worker receipt', () => {
  const { controller, candidate } = identities()
  const receipt = createPairingReceipt({
    controller: publicFleetDeviceIdentity(controller),
    candidate: publicFleetDeviceIdentity(candidate),
    ownerUid: OWNER,
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['workspace.read'],
    grantExpiresAt: NOW + 60_000,
    now: NOW,
    pairingNonce: 'r'.repeat(43),
  })
  const registry = new FleetPairingApprovalRegistry({ now: () => NOW })
  registry.retainWorkerApproval(receipt, controller.deviceId)
  assert.throws(
    () =>
      registry.beginWorkerApproval(
        { ...receipt, repositoryIdentities: ['github.com/other/repository'] },
        controller.deviceId
      ),
    /not created by the local controller/
  )
  const claim = registry.beginWorkerApproval(receipt, controller.deviceId)
  assert.throws(
    () => registry.beginWorkerApproval(receipt, controller.deviceId),
    /not created by the local controller/
  )
  registry.finishWorkerApproval(claim)
  assert.throws(
    () => registry.beginWorkerApproval(receipt, controller.deviceId),
    /not created by the local controller/
  )
})

test('ordinary controller pairing cannot approve a hybrid candidate', () => {
  const { controller } = identities()
  const hybrid = generateFleetDeviceIdentity({
    label: 'Hybrid laptop',
    role: 'hybrid',
    workerMode: 'opt-in',
    platform: 'darwin',
    maxConcurrentJobs: 1,
  })
  const receipt = createPairingReceipt({
    controller: publicFleetDeviceIdentity(controller),
    candidate: publicFleetDeviceIdentity(hybrid),
    ownerUid: OWNER,
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['workspace.read'],
    grantExpiresAt: NOW + 60_000,
    now: NOW,
    pairingNonce: 'h'.repeat(43),
  })
  const registry = new FleetPairingApprovalRegistry({ now: () => NOW })
  assert.throws(
    () => registry.retainWorkerApproval(receipt, controller.deviceId),
    /dedicated worker/
  )
})

test('public pairing identity never contains private key material', () => {
  const { candidate } = identities()
  const publicIdentity = publicFleetDeviceIdentity(candidate)
  assert.equal(publicIdentity.deviceId, candidate.deviceId)
  assert.equal(Object.hasOwn(publicIdentity, 'privateKey'), false)
  assert.equal(JSON.stringify(publicIdentity).includes('PRIVATE KEY'), false)
})

test('pairing rejects mismatched identity and private key', () => {
  const { controller, candidate } = identities()
  const replacement = identities().candidate
  assert.throws(
    () =>
      createPairDeviceInput({
        controller,
        candidate: { ...candidate, privateKey: replacement.privateKey },
        ownerUid: OWNER,
        workspaceIds: ['statskey-website'],
        repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
        capabilities: ['workspace.read'],
        grantExpiresAt: NOW + 60_000,
        now: NOW,
        pairingNonce: 'q'.repeat(43),
      }),
    /does not match/
  )
})
