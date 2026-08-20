import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn(async () => 'statskey-id-token'),
    } as { getIdToken: () => Promise<string> } | null,
  },
}))

vi.mock('../firebase', () => ({ auth: mocks.auth }))

import {
  bootstrapFleetDevice,
  cancelFleetJob,
  createFleetArtifactDownload,
  createFleetJob,
  createFleetLocalGrant,
  fleetDeviceEndpoint,
  FleetWorkbenchError,
  getFleetJob,
  getFleetCoordinatorTrust,
  listFleetDevices,
  listFleetGrants,
  listFleetJobEvents,
  listFleetJobs,
  pairFleetDevice,
  recoverFleetController,
  recoverFleetJob,
  revokeFleetDevice,
  revokeFleetGrant,
} from './workbenchFleetApi'
import type { CreateFleetJobInput, FleetJob } from './types'

const JOB_ID = `job_${'a'.repeat(32)}` as const

const input: CreateFleetJobInput = {
  workspaceId: 'statskey-website',
  type: 'xcode-test',
  objective: 'Run focused Xcode tests.',
  workspaceSnapshot: {
    kind: 'git',
    repository: 'statskey/website',
    commit: 'b'.repeat(40),
  },
  requiredCapabilities: ['workspace.read', 'workspace.snapshot', 'xcode.test'],
  deadlineAt: '2026-08-19T07:00:00.000Z',
  idempotencyKey: 'fleet-test:client:001',
  controllerAuthorization: {
    controllerDeviceId: `dev_${'c'.repeat(32)}`,
    proof: {
      protocolVersion: 1,
      deviceId: `dev_${'c'.repeat(32)}`,
      requestId: `req_${'d'.repeat(32)}`,
      action: 'job.authorize',
      issuedAt: 1,
      expiresAt: 2,
      payloadDigest: 'digest',
      signature: 'signature',
    },
  },
}

const job = {
  id: JOB_ID,
  state: 'queued',
  revision: 1,
} as FleetJob

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response
}

describe('Workbench Fleet API', () => {
  beforeEach(() => {
    mocks.auth.currentUser = {
      getIdToken: vi.fn(async () => 'statskey-id-token'),
    }
    vi.unstubAllGlobals()
  })

  it('derives the credential-free signed device endpoint', () => {
    expect(fleetDeviceEndpoint()).toBe(
      'https://us-central1-statskey-workbench.cloudfunctions.net/workbenchDeviceApi'
    )
  })

  it('frames account-authenticated controller recovery', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        response(200, { data: { id: `dev_${'e'.repeat(32)}` } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const input = {
      device: {
        label: 'Replacement controller',
        role: 'hybrid' as const,
        workerMode: 'opt-in' as const,
        platform: 'darwin' as const,
        publicKeySpki: 'replacement-public-key',
        maxConcurrentJobs: 1,
      },
      authorization: {
        ownerUid: 'owner-123',
        audience: 'statskey-workbench:fleet-recovery:v1' as const,
        expectedControllerDeviceId: `dev_${'d'.repeat(32)}` as const,
      },
      proof: {
        protocolVersion: 1 as const,
        deviceId: `dev_${'e'.repeat(32)}` as const,
        requestId: `req_${'f'.repeat(32)}` as const,
        action: 'controller.recover',
        issuedAt: 1,
        expiresAt: 2,
        payloadDigest: 'digest',
        signature: 'signature',
      },
    }
    await recoverFleetController(input)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      action: 'fleetRecoverController',
      payload: input,
    })
  })

  it('creates a job with authenticated action framing', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        response(200, { data: job })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(createFleetJob(input)).resolves.toEqual(job)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/workbenchApi')
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer statskey-id-token',
        'Content-Type': 'application/json',
      },
    })
    expect(JSON.parse(String(request?.body))).toEqual({
      action: 'fleetCreateJob',
      payload: input,
    })
  })

  it('gets and revision-checks cancellation by job id', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        response(200, { data: job })
    )
    vi.stubGlobal('fetch', fetchMock)

    await getFleetJob(JOB_ID)
    await cancelFleetJob(JOB_ID, 7)

    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    ).toEqual({
      action: 'fleetGetJob',
      payload: { jobId: JOB_ID },
    })
    expect(
      JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    ).toEqual({
      action: 'fleetCancelJob',
      payload: { jobId: JOB_ID, expectedRevision: 7 },
    })
  })

  it('requests a short-lived owner-scoped artifact download', async () => {
    const artifactId = `artifact_${'f'.repeat(32)}` as const
    const data = {
      artifact: { id: artifactId, state: 'ready' },
      download: {
        url: 'https://storage.googleapis.com/bucket/object?signed=1',
        expiresAt: '2026-08-19T07:10:00.000Z',
      },
    }
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        response(200, { data })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(createFleetArtifactDownload(artifactId)).resolves.toEqual(data)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      action: 'fleetCreateArtifactDownload',
      payload: { artifactId },
    })
  })

  it('loads account-authenticated coordinator trust for enrollment', async () => {
    const trust = {
      keyId: 'workbench-2026-01',
      publicKeySpki: 'coordinator-public-key',
      algorithm: 'Ed25519',
    }
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        response(200, { data: trust })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getFleetCoordinatorTrust()).resolves.toEqual(trust)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      action: 'fleetGetCoordinatorTrust',
      payload: {},
    })
  })

  it('frames owner-scoped list requests without exposing Firestore', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        response(200, { data: { jobs: [], limit: 20, mayHaveMore: false } })
    )
    vi.stubGlobal('fetch', fetchMock)

    await listFleetJobs({ state: 'running', limit: 20 })
    await listFleetDevices({ limit: 10 })
    await listFleetGrants({ limit: 15 })
    await revokeFleetDevice(`dev_${'f'.repeat(32)}`)
    await revokeFleetGrant(`grant_${'d'.repeat(32)}`)
    await listFleetJobEvents(JOB_ID, { afterSequence: 7, limit: 50 })
    await recoverFleetJob(JOB_ID)
    await bootstrapFleetDevice({
      device: {
        label: 'Owner laptop',
        role: 'hybrid',
        workerMode: 'opt-in',
        platform: 'darwin',
        publicKeySpki: 'public-key',
        maxConcurrentJobs: 1,
      },
      authorization: {
        ownerUid: 'owner-123',
        audience: 'statskey-workbench:fleet:v1',
      },
      proof: {
        protocolVersion: 1,
        deviceId: `dev_${'d'.repeat(32)}`,
        requestId: `req_${'e'.repeat(32)}`,
        action: 'pairing.bootstrap',
        issuedAt: 1,
        expiresAt: 2,
        payloadDigest: 'digest',
        signature: 'signature',
      },
    })
    const receipt = {
      pairingNonce: 'n'.repeat(43),
      ownerUid: 'owner-123',
      controllerDeviceId: `dev_${'d'.repeat(32)}` as const,
      candidate: {
        label: 'Mac mini',
        role: 'worker' as const,
        workerMode: 'dedicated' as const,
        platform: 'darwin' as const,
        publicKeySpki: 'candidate-public-key',
        maxConcurrentJobs: 2,
      },
      workspaceIds: ['statskey-website'],
      repositoryIdentities: ['github.com/statskey/website'],
      capabilities: ['workspace.read' as const],
      unattended: true,
      grantExpiresAt: 3,
      policyVersion: 1,
    }
    const proof = {
      protocolVersion: 1 as const,
      deviceId: `dev_${'f'.repeat(32)}` as const,
      requestId: `req_${'a'.repeat(32)}` as const,
      action: 'pairing.candidate',
      issuedAt: 1,
      expiresAt: 2,
      payloadDigest: 'digest',
      signature: 'signature',
    }
    await pairFleetDevice({
      receipt,
      candidateProof: proof,
      controllerProof: {
        ...proof,
        deviceId: receipt.controllerDeviceId,
        requestId: `req_${'b'.repeat(32)}`,
        action: 'pairing.approve',
      },
    })
    const localGrantInput = {
      receipt: {
        deviceId: receipt.controllerDeviceId,
        workspaceIds: ['statskey-website'],
        repositoryIdentities: ['github.com/statskey/website'],
        capabilities: ['workspace.read' as const],
        unattended: true,
        expiresAt: 3,
        policyVersion: 1,
      },
      proof: {
        ...proof,
        deviceId: receipt.controllerDeviceId,
        requestId: `req_${'c'.repeat(32)}` as const,
        action: 'grant.local',
      },
    }
    await createFleetLocalGrant(localGrantInput)

    expect(
      fetchMock.mock.calls.map(([, request]) =>
        JSON.parse(String(request?.body))
      )
    ).toEqual([
      {
        action: 'fleetListJobs',
        payload: { state: 'running', limit: 20 },
      },
      {
        action: 'fleetListDevices',
        payload: { limit: 10 },
      },
      {
        action: 'fleetListGrants',
        payload: { limit: 15 },
      },
      {
        action: 'fleetRevokeDevice',
        payload: { deviceId: `dev_${'f'.repeat(32)}` },
      },
      {
        action: 'fleetRevokeGrant',
        payload: { grantId: `grant_${'d'.repeat(32)}` },
      },
      {
        action: 'fleetListJobEvents',
        payload: { jobId: JOB_ID, afterSequence: 7, limit: 50 },
      },
      {
        action: 'fleetRecoverJob',
        payload: { jobId: JOB_ID },
      },
      {
        action: 'fleetBootstrapDevice',
        payload: {
          device: {
            label: 'Owner laptop',
            role: 'hybrid',
            workerMode: 'opt-in',
            platform: 'darwin',
            publicKeySpki: 'public-key',
            maxConcurrentJobs: 1,
          },
          authorization: {
            ownerUid: 'owner-123',
            audience: 'statskey-workbench:fleet:v1',
          },
          proof: {
            protocolVersion: 1,
            deviceId: `dev_${'d'.repeat(32)}`,
            requestId: `req_${'e'.repeat(32)}`,
            action: 'pairing.bootstrap',
            issuedAt: 1,
            expiresAt: 2,
            payloadDigest: 'digest',
            signature: 'signature',
          },
        },
      },
      {
        action: 'fleetPairDevice',
        payload: {
          receipt,
          candidateProof: proof,
          controllerProof: {
            ...proof,
            deviceId: receipt.controllerDeviceId,
            requestId: `req_${'b'.repeat(32)}`,
            action: 'pairing.approve',
          },
        },
      },
      {
        action: 'fleetCreateLocalGrant',
        payload: localGrantInput,
      },
    ])
  })

  it('requires a StatsKey session before making a request', async () => {
    mocks.auth.currentUser = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getFleetJob(JOB_ID)).rejects.toMatchObject({
      name: 'FleetWorkbenchError',
      status: 401,
      code: 'unauthenticated',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves service error status and code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(409, {
          error: {
            code: 'conflict',
            message: 'The job changed before cancellation.',
          },
        })
      )
    )

    await expect(cancelFleetJob(JOB_ID, 1)).rejects.toEqual(
      new FleetWorkbenchError(
        'The job changed before cancellation.',
        409,
        'conflict'
      )
    )
  })

  it('turns connection failures into an offline error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    await expect(getFleetJob(JOB_ID)).rejects.toMatchObject({
      status: 0,
      code: 'offline',
      message: 'You appear to be offline. Check your connection and try again.',
    })
  })

  it('rejects an oversized response before reading its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-length'
              ? String(9 * 1024 * 1024)
              : null,
        },
        json: vi.fn(async () => ({ data: job })),
      }))
    )

    await expect(getFleetJob(JOB_ID)).rejects.toMatchObject({
      status: 0,
      code: 'response_too_large',
    })
  })
})
