import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db, firebaseApp } from './firebase'
import { toDate } from './firestore'
import { getDesktopBridge } from './desktop'

export type RemoteAccessTarget = 'mac-mini' | 'data-center'
export type RemoteCommandKind = 'ai.prompt' | 'status.check'
export type RemoteCommandStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'unknown'

export interface RemoteAccessPreferences {
  schemaVersion: number
  enabled: boolean
  allowMacMini: boolean
  allowDataCenter: boolean
  requireConfirmation: boolean
  onboardingChoice: 'unset' | 'enabled' | 'notNow'
  updatedAt?: Date
}

export interface RemoteCommand {
  id: string
  target: RemoteAccessTarget
  kind: RemoteCommandKind
  status: RemoteCommandStatus
  summary: string
  prompt?: string
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  result?: {
    summary?: string
    sessionId?: string
    errorCode?: string
  }
}

export interface RemoteExecutor {
  id: string
  label: string
  platform: 'desktop'
  appVersion: string
  capabilities: RemoteAccessTarget[]
  status: 'online' | 'unknown'
  lastSeenAt?: Date
  staleAfter?: Date
}

export interface RemoteCommandClaim {
  commandId: string
  status: 'running' | 'busy' | 'expired' | 'succeeded' | 'failed' | 'cancelled'
  claimToken?: string
  leaseExpiresAt?: string
  command?: {
    target: RemoteAccessTarget
    kind: RemoteCommandKind
    summary: string
    prompt?: string
  }
}

export interface PendingRemoteAgentCommand {
  commandId: string
  executorId: string
  claimToken: string
  target: RemoteAccessTarget
  prompt: string
  sessionId: string
}

export const DEFAULT_REMOTE_ACCESS_PREFERENCES: RemoteAccessPreferences = {
  schemaVersion: 1,
  enabled: false,
  allowMacMini: false,
  allowDataCenter: false,
  requireConfirmation: true,
  onboardingChoice: 'unset',
}

const functions = getFunctions(firebaseApp, 'us-central1')
const savePreferencesCall = httpsCallable<
  Omit<RemoteAccessPreferences, 'schemaVersion' | 'updatedAt'>,
  Record<string, unknown>
>(functions, 'saveRemoteAccessPreferences')
const queueCommandCall = httpsCallable<
  {
    target: RemoteAccessTarget
    kind: RemoteCommandKind
    prompt?: string
    clientRequestId: string
    origin: { platform: 'ios' | 'desktop'; appVersion: string }
  },
  {
    commandId: string
    status: string
    requestHash: string
    summary: string
  }
>(functions, 'queueRemoteCommand')
const heartbeatCall = httpsCallable<
  {
    executorId: string
    label: string
    appVersion: string
    capabilities: RemoteAccessTarget[]
  },
  { executorId: string; status: string; staleAfter: string }
>(functions, 'heartbeatRemoteExecutor')
const claimCall = httpsCallable<
  { commandId: string; executorId: string; label: string },
  RemoteCommandClaim
>(functions, 'claimRemoteCommand')
const completeCall = httpsCallable<
  {
    commandId: string
    executorId: string
    claimToken: string
    status: 'succeeded' | 'failed'
    result: {
      summary: string
      sessionId?: string
      errorCode?: string
    }
  },
  { commandId: string; status: string; idempotent?: boolean }
>(functions, 'completeRemoteCommand')

export async function saveRemoteAccessPreferences(
  preferences: Omit<RemoteAccessPreferences, 'schemaVersion' | 'updatedAt'>
): Promise<RemoteAccessPreferences> {
  const { data } = await savePreferencesCall(preferences)
  return decodeRemoteAccessPreferences(data)
}

export async function queueRemoteCommand(input: {
  target: RemoteAccessTarget
  kind: RemoteCommandKind
  prompt?: string
  clientRequestId?: string
  origin?: 'ios' | 'desktop'
}): Promise<{ commandId: string; summary: string }> {
  const { data } = await queueCommandCall({
    target: input.target,
    kind: input.kind,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    clientRequestId: input.clientRequestId ?? crypto.randomUUID(),
    origin: {
      platform: input.origin ?? 'desktop',
      appVersion: desktopVersion(),
    },
  })
  return { commandId: data.commandId, summary: data.summary }
}

export async function heartbeatRemoteExecutor(input: {
  executorId: string
  label: string
  capabilities: RemoteAccessTarget[]
}): Promise<void> {
  await heartbeatCall({
    ...input,
    appVersion: desktopVersion(),
  })
}

export async function claimRemoteCommand(
  commandId: string,
  executorId: string,
  label: string
): Promise<RemoteCommandClaim> {
  const { data } = await claimCall({ commandId, executorId, label })
  return data
}

export async function completeRemoteCommand(input: {
  commandId: string
  executorId: string
  claimToken: string
  status: 'succeeded' | 'failed'
  summary: string
  sessionId?: string
  errorCode?: string
}): Promise<void> {
  await completeCall({
    commandId: input.commandId,
    executorId: input.executorId,
    claimToken: input.claimToken,
    status: input.status,
    result: {
      summary: input.summary,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    },
  })
}

export function subscribeRemoteAccessPreferences(
  uid: string,
  onValue: (preferences: RemoteAccessPreferences) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'preferences', 'remoteAccess'),
    (snapshot) => {
      onValue(
        snapshot.exists()
          ? decodeRemoteAccessPreferences(
              snapshot.data() as Record<string, unknown>
            )
          : DEFAULT_REMOTE_ACCESS_PREFERENCES
      )
    },
    (error) => onError?.(error)
  )
}

export function subscribeRemoteCommands(
  uid: string,
  onValue: (commands: RemoteCommand[]) => void,
  onError?: (error: Error) => void,
  max = 20
): Unsubscribe {
  const commandsQuery = query(
    collection(db, 'users', uid, 'remoteCommands'),
    orderBy('createdAt', 'desc'),
    limit(max)
  )
  return onSnapshot(
    commandsQuery,
    (snapshot) => {
      onValue(
        snapshot.docs.map((item) =>
          decodeRemoteCommand(item.data() as Record<string, unknown>, item.id)
        )
      )
    },
    (error) => onError?.(error)
  )
}

export function subscribeRemoteExecutors(
  uid: string,
  onValue: (executors: RemoteExecutor[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'users', uid, 'remoteExecutors'),
    (snapshot) => {
      onValue(
        snapshot.docs.map((item) =>
          decodeRemoteExecutor(item.data() as Record<string, unknown>, item.id)
        )
      )
    },
    (error) => onError?.(error)
  )
}

export function getOrCreateRemoteExecutorId(): string {
  const key = 'statskey.remote-access.executor-id'
  const current = localStorage.getItem(key)
  if (current && /^[A-Za-z0-9_-]{1,128}$/.test(current)) return current
  const created = `desktop_${crypto.randomUUID().replaceAll('-', '')}`
  localStorage.setItem(key, created)
  return created
}

export function stageRemoteAgentCommand(
  command: PendingRemoteAgentCommand
): void {
  sessionStorage.setItem(pendingCommandKey(command.sessionId), JSON.stringify(command))
}

export function takeRemoteAgentCommand(
  sessionId: string
): PendingRemoteAgentCommand | null {
  const key = pendingCommandKey(sessionId)
  const encoded = sessionStorage.getItem(key)
  if (!encoded) return null
  sessionStorage.removeItem(key)
  try {
    const value = JSON.parse(encoded) as Partial<PendingRemoteAgentCommand>
    if (
      typeof value.commandId !== 'string' ||
      typeof value.executorId !== 'string' ||
      typeof value.claimToken !== 'string' ||
      !isRemoteTarget(value.target) ||
      typeof value.prompt !== 'string' ||
      value.sessionId !== sessionId
    ) {
      return null
    }
    return value as PendingRemoteAgentCommand
  } catch {
    return null
  }
}

export function remoteAgentPrompt(
  target: RemoteAccessTarget,
  prompt: string
): string {
  const boundary =
    target === 'mac-mini'
      ? 'Use the configured MacRemote project and pinned SSH path. Never request, print, or copy private key material.'
      : 'Work inside the active Oil Data workspace and use the local data-center integrations. Do not expose internal addresses or credentials.'
  return [
    `Remote request from Ryan's StatsKey iOS app for ${target}.`,
    boundary,
    'This private preview is read-only: inspect and explain, but do not modify files, run terminal commands, or take external actions.',
    '',
    prompt.trim(),
  ].join('\n')
}

export function decodeRemoteAccessPreferences(
  raw: Record<string, unknown>
): RemoteAccessPreferences {
  const choice =
    raw.onboardingChoice === 'enabled' || raw.onboardingChoice === 'notNow'
      ? raw.onboardingChoice
      : 'unset'
  return {
    schemaVersion: numberOr(raw.schemaVersion, 1),
    enabled: raw.enabled === true,
    allowMacMini: raw.allowMacMini === true,
    allowDataCenter: raw.allowDataCenter === true,
    requireConfirmation: true,
    onboardingChoice: choice,
    updatedAt: toDate(raw.updatedAt),
  }
}

export function decodeRemoteCommand(
  raw: Record<string, unknown>,
  id: string
): RemoteCommand {
  const result = asRecord(raw.result)
  return {
    id,
    target: raw.target === 'mac-mini' ? 'mac-mini' : 'data-center',
    kind: raw.kind === 'status.check' ? 'status.check' : 'ai.prompt',
    status: decodeStatus(raw.status),
    summary: stringOr(raw.summary, 'Remote command'),
    prompt: optionalString(raw.prompt),
    createdAt: toDate(raw.createdAt) ?? new Date(0),
    updatedAt: toDate(raw.updatedAt) ?? toDate(raw.createdAt) ?? new Date(0),
    expiresAt: toDate(raw.expiresAt),
    result: result
      ? {
          summary: optionalString(result.summary),
          sessionId: optionalString(result.sessionId),
          errorCode: optionalString(result.errorCode),
        }
      : undefined,
  }
}

export function decodeRemoteExecutor(
  raw: Record<string, unknown>,
  id: string
): RemoteExecutor {
  return {
    id,
    label: stringOr(raw.label, 'StatsKey Desktop'),
    platform: 'desktop',
    appVersion: stringOr(raw.appVersion, 'unknown'),
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.filter(isRemoteTarget)
      : [],
    status: raw.status === 'online' ? 'online' : 'unknown',
    lastSeenAt: toDate(raw.lastSeenAt),
    staleAfter: toDate(raw.staleAfter),
  }
}

export function isRemoteExecutorOnline(
  executor: RemoteExecutor,
  now = new Date()
): boolean {
  return (
    executor.status === 'online' &&
    executor.staleAfter != null &&
    executor.staleAfter.getTime() > now.getTime()
  )
}

function desktopVersion(): string {
  return getDesktopBridge()?.electronVersion ?? 'web'
}

function pendingCommandKey(sessionId: string): string {
  return `statskey.remote-command.pending.${sessionId}`
}

function decodeStatus(value: unknown): RemoteCommandStatus {
  const statuses: RemoteCommandStatus[] = [
    'queued',
    'running',
    'succeeded',
    'failed',
    'expired',
    'cancelled',
  ]
  return statuses.includes(value as RemoteCommandStatus)
    ? (value as RemoteCommandStatus)
    : 'unknown'
}

function isRemoteTarget(value: unknown): value is RemoteAccessTarget {
  return value === 'mac-mini' || value === 'data-center'
}

function asRecord(
  value: unknown
): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
