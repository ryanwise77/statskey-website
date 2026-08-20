import { auth } from '../firebase'
import type {
  BootstrapFleetDeviceInput,
  CreateLocalFleetGrantInput,
  CreateFleetJobInput,
  FleetArtifact,
  FleetCoordinatorTrust,
  FleetDeviceList,
  FleetGrant,
  FleetGrantList,
  FleetJob,
  FleetJobEventList,
  FleetJobList,
  FleetJobState,
  FleetRemoteSession,
  FleetRemoteSessionList,
  PairFleetDeviceInput,
  RecoverFleetControllerInput,
  RequestFleetRemoteSessionInput,
} from './types'

const WORKBENCH_API =
  import.meta.env.VITE_WORKBENCH_API_URL ??
  'https://us-central1-statskey-workbench.cloudfunctions.net/workbenchApi'
const FLEET_DEVICE_API =
  import.meta.env.VITE_FLEET_DEVICE_API_URL ??
  'https://us-central1-statskey-workbench.cloudfunctions.net/workbenchDeviceApi'
const FLEET_REQUEST_TIMEOUT_MS = 20_000
const MAX_FLEET_RESPONSE_BYTES = 8 * 1024 * 1024

export function fleetDeviceEndpoint(): string {
  const endpoint = new URL(FLEET_DEVICE_API)
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint.toString().replace(/\/$/, '')
}

export class FleetWorkbenchError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'FleetWorkbenchError'
    this.status = status
    this.code = code
  }
}

export interface FleetRequestOptions {
  signal?: AbortSignal
}

function requestDeadline(externalSignal?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const onExternalAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) onExternalAbort()
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort(new Error('Fleet request timed out.'))
  }, FLEET_REQUEST_TIMEOUT_MS)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      globalThis.clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    },
  }
}

async function readBoundedJson<T>(response: Response): Promise<T> {
  const contentLength = Number(response.headers?.get?.('content-length'))
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_FLEET_RESPONSE_BYTES
  ) {
    throw new FleetWorkbenchError(
      'Fleet response exceeded the safe size limit.',
      0,
      'response_too_large'
    )
  }
  if (!response.body?.getReader) {
    return (await response.json().catch(() => ({}))) as T
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_FLEET_RESPONSE_BYTES) {
        await reader.cancel()
        throw new FleetWorkbenchError(
          'Fleet response exceeded the safe size limit.',
          0,
          'response_too_large'
        )
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
}

export async function bootstrapFleetDevice(
  input: BootstrapFleetDeviceInput,
  options: FleetRequestOptions = {}
): Promise<FleetDeviceList['devices'][number]> {
  return callFleetApi<FleetDeviceList['devices'][number]>(
    'fleetBootstrapDevice',
    input,
    options
  )
}

export async function pairFleetDevice(
  input: PairFleetDeviceInput,
  options: FleetRequestOptions = {}
): Promise<{ device: FleetDeviceList['devices'][number]; grant: FleetGrant }> {
  return callFleetApi<{
    device: FleetDeviceList['devices'][number]
    grant: FleetGrant
  }>('fleetPairDevice', input, options)
}

export async function recoverFleetController(
  input: RecoverFleetControllerInput,
  options: FleetRequestOptions = {}
): Promise<FleetDeviceList['devices'][number]> {
  return callFleetApi<FleetDeviceList['devices'][number]>(
    'fleetRecoverController',
    input,
    options
  )
}

export async function createFleetLocalGrant(
  input: CreateLocalFleetGrantInput,
  options: FleetRequestOptions = {}
): Promise<FleetGrant> {
  return callFleetApi<FleetGrant>('fleetCreateLocalGrant', input, options)
}

export async function createFleetJob(
  input: CreateFleetJobInput,
  options: FleetRequestOptions = {}
): Promise<FleetJob> {
  return callFleetApi<FleetJob>('fleetCreateJob', input, options)
}

export async function getFleetJob(
  jobId: `job_${string}`,
  options: FleetRequestOptions = {}
): Promise<FleetJob> {
  return callFleetApi<FleetJob>('fleetGetJob', { jobId }, options)
}

export async function getFleetCoordinatorTrust(
  options: FleetRequestOptions = {}
): Promise<FleetCoordinatorTrust> {
  return callFleetApi<FleetCoordinatorTrust>(
    'fleetGetCoordinatorTrust',
    {},
    options
  )
}

export async function createFleetArtifactDownload(
  artifactId: `artifact_${string}`,
  options: FleetRequestOptions = {}
): Promise<{
  artifact: FleetArtifact
  download: { url: string; expiresAt: string }
}> {
  return callFleetApi<{
    artifact: FleetArtifact
    download: { url: string; expiresAt: string }
  }>('fleetCreateArtifactDownload', { artifactId }, options)
}

export async function listFleetJobs(
  input: { state?: FleetJobState; limit?: number } = {},
  options: FleetRequestOptions = {}
): Promise<FleetJobList> {
  return callFleetApi<FleetJobList>('fleetListJobs', input, options)
}

export async function listFleetDevices(
  input: { limit?: number } = {},
  options: FleetRequestOptions = {}
): Promise<FleetDeviceList> {
  return callFleetApi<FleetDeviceList>('fleetListDevices', input, options)
}

export async function listFleetGrants(
  input: { limit?: number } = {},
  options: FleetRequestOptions = {}
): Promise<FleetGrantList> {
  return callFleetApi<FleetGrantList>('fleetListGrants', input, options)
}

export async function revokeFleetDevice(
  deviceId: `dev_${string}`,
  options: FleetRequestOptions = {}
): Promise<FleetDeviceList['devices'][number]> {
  return callFleetApi<FleetDeviceList['devices'][number]>(
    'fleetRevokeDevice',
    { deviceId },
    options
  )
}

export async function revokeFleetGrant(
  grantId: `grant_${string}`,
  options: FleetRequestOptions = {}
): Promise<FleetGrant> {
  return callFleetApi<FleetGrant>(
    'fleetRevokeGrant',
    { grantId },
    options
  )
}

export async function listFleetJobEvents(
  jobId: `job_${string}`,
  input: { afterSequence?: number; limit?: number } = {},
  options: FleetRequestOptions = {}
): Promise<FleetJobEventList> {
  return callFleetApi<FleetJobEventList>(
    'fleetListJobEvents',
    { jobId, ...input },
    options
  )
}

export async function cancelFleetJob(
  jobId: `job_${string}`,
  expectedRevision?: number,
  options: FleetRequestOptions = {}
): Promise<FleetJob> {
  return callFleetApi<FleetJob>(
    'fleetCancelJob',
    {
      jobId,
      ...(expectedRevision == null ? {} : { expectedRevision }),
    },
    options
  )
}

export async function recoverFleetJob(
  jobId: `job_${string}`,
  options: FleetRequestOptions = {}
): Promise<FleetJob> {
  return callFleetApi<FleetJob>('fleetRecoverJob', { jobId }, options)
}

export async function requestFleetRemoteSession(
  input: RequestFleetRemoteSessionInput,
  options: FleetRequestOptions = {}
): Promise<FleetRemoteSession> {
  return callFleetApi<FleetRemoteSession>(
    'fleetRemoteSessionRequest',
    input,
    options
  )
}

export async function approveFleetRemoteSession(
  sessionId: `rs_${string}`,
  options: FleetRequestOptions = {}
): Promise<FleetRemoteSession> {
  return callFleetApi<FleetRemoteSession>(
    'fleetRemoteSessionApprove',
    { sessionId },
    options
  )
}

export async function endFleetRemoteSession(
  sessionId: `rs_${string}`,
  options: FleetRequestOptions = {}
): Promise<FleetRemoteSession> {
  return callFleetApi<FleetRemoteSession>(
    'fleetRemoteSessionEnd',
    { sessionId },
    options
  )
}

export async function listFleetRemoteSessions(
  input: { limit?: number } = {},
  options: FleetRequestOptions = {}
): Promise<FleetRemoteSessionList> {
  return callFleetApi<FleetRemoteSessionList>(
    'fleetRemoteSessionList',
    input,
    options
  )
}

async function callFleetApi<T>(
  action: string,
  payload: object,
  options: FleetRequestOptions
): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new FleetWorkbenchError('Sign in to StatsKey.', 401, 'unauthenticated')
  const idToken = await user.getIdToken()
  const deadline = requestDeadline(options.signal)
  let response: Response
  let body: {
    data?: T
    error?: { code?: string; message?: string }
  }
  try {
    response = await fetch(WORKBENCH_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, payload }),
      signal: deadline.signal,
    })
    body = await readBoundedJson(response)
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (deadline.timedOut()) {
      throw new FleetWorkbenchError(
        'Fleet request timed out. Try again.',
        408,
        'timeout'
      )
    }
    if (error instanceof FleetWorkbenchError) throw error
    if (error instanceof TypeError) {
      throw new FleetWorkbenchError(
        'You appear to be offline. Check your connection and try again.',
        0,
        'offline'
      )
    }
    throw error
  } finally {
    deadline.dispose()
  }
  if (!response.ok || body.data === undefined) {
    throw new FleetWorkbenchError(
      body.error?.message || `Fleet request failed (${response.status}).`,
      response.status,
      body.error?.code ?? null
    )
  }
  return body.data
}
