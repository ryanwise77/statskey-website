import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import { toDate } from '../firestore'

export type ProposableAssistantActionKind =
  | 'calendar.create'
  | 'email.send'
  | 'phone.call'

export type AssistantActionKind = ProposableAssistantActionKind | 'unknown'

export type AssistantActionStatus =
  | 'proposed'
  | 'awaitingApproval'
  | 'approved'
  | 'executing'
  | 'awaitingResponse'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'unknown'

export interface AssistantAction {
  id: string
  schemaVersion: number
  policyVersion: number
  kind: AssistantActionKind
  status: AssistantActionStatus
  summary: string
  payloadHash: string
  payload: Record<string, unknown>
  requiresApproval: boolean
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  approval?: {
    approvedAt?: Date
    expiresAt?: Date
    payloadHash?: string
  }
  rejection?: {
    rejectedAt?: Date
    reason?: string
  }
  execution?: {
    attemptId?: string
    attemptCount: number
    claimedAt?: Date
    sendAttemptedAt?: Date
    completedAt?: Date
    failedAt?: Date
    errorCode?: string
    userMessage?: string
    retryable: boolean
    deliveryUncertain: boolean
    providerResult?: Record<string, unknown>
  }
}

export interface AssistantActionOrigin {
  sessionId?: string
  messageId?: string
  model?: string
}

export interface ProposeAssistantActionInput {
  kind: ProposableAssistantActionKind
  payload: Record<string, unknown>
  origin?: AssistantActionOrigin
}

interface ActionMutationResult {
  actionId: string
  status: AssistantActionStatus
  idempotent?: boolean
}

interface ProposalResult extends ActionMutationResult {
  kind: ProposableAssistantActionKind
  payloadHash: string
  summary: string
  expiresAt: string
}

const functions = getFunctions(firebaseApp, 'us-central1')

const proposeCall = httpsCallable<ProposeAssistantActionInput, ProposalResult>(
  functions,
  'proposeAssistantAction'
)
const approveCall = httpsCallable<
  { actionId: string; payloadHash: string },
  ActionMutationResult
>(functions, 'approveAssistantAction')
const rejectCall = httpsCallable<
  { actionId: string; reason?: string },
  ActionMutationResult
>(functions, 'rejectAssistantAction')
const retryCall = httpsCallable<
  { actionId: string; payloadHash: string },
  ActionMutationResult
>(functions, 'retryAssistantAction')

export async function proposeAssistantAction(
  input: ProposeAssistantActionInput
): Promise<ProposalResult> {
  const { data } = await proposeCall(input)
  return data
}

export async function approveAssistantAction(
  actionId: string,
  payloadHash: string
): Promise<ActionMutationResult> {
  const { data } = await approveCall({ actionId, payloadHash })
  return data
}

export async function rejectAssistantAction(
  actionId: string,
  reason?: string
): Promise<ActionMutationResult> {
  const { data } = await rejectCall({ actionId, ...(reason ? { reason } : {}) })
  return data
}

export async function retryAssistantAction(
  actionId: string,
  payloadHash: string
): Promise<ActionMutationResult> {
  const { data } = await retryCall({ actionId, payloadHash })
  return data
}

export function decodeAssistantAction(
  raw: Record<string, unknown>,
  id: string
): AssistantAction {
  const approval = asRecord(raw.approval)
  const rejection = asRecord(raw.rejection)
  const execution = asRecord(raw.execution)
  return {
    id,
    schemaVersion: numberOr(raw.schemaVersion, 1),
    policyVersion: numberOr(raw.policyVersion, 1),
    kind: decodeKind(raw.kind),
    status: decodeStatus(raw.status),
    summary: stringOr(raw.summary, 'Review this assistant action.'),
    payloadHash: stringOr(raw.payloadHash, ''),
    payload: asRecord(raw.payload) ?? {},
    requiresApproval: raw.requiresApproval !== false,
    createdAt: toDate(raw.createdAt) ?? new Date(0),
    updatedAt: toDate(raw.updatedAt) ?? toDate(raw.createdAt) ?? new Date(0),
    expiresAt: toDate(raw.expiresAt),
    approval: approval
      ? {
          approvedAt: toDate(approval.approvedAt),
          expiresAt: toDate(approval.expiresAt),
          payloadHash: stringOrUndefined(approval.payloadHash),
        }
      : undefined,
    rejection: rejection
      ? {
          rejectedAt: toDate(rejection.rejectedAt),
          reason: stringOrUndefined(rejection.reason),
        }
      : undefined,
    execution: execution
      ? {
          attemptId: stringOrUndefined(execution.attemptId),
          attemptCount: numberOr(execution.attemptCount, 0),
          claimedAt: toDate(execution.claimedAt),
          sendAttemptedAt: toDate(execution.sendAttemptedAt),
          completedAt: toDate(execution.completedAt),
          failedAt: toDate(execution.failedAt),
          errorCode: stringOrUndefined(execution.errorCode),
          userMessage: stringOrUndefined(execution.userMessage),
          retryable: execution.retryable === true,
          deliveryUncertain: execution.deliveryUncertain === true,
          providerResult: asRecord(execution.providerResult),
        }
      : undefined,
  }
}

function decodeKind(value: unknown): AssistantActionKind {
  if (value === 'calendar.create' || value === 'email.send' || value === 'phone.call') {
    return value
  }
  return 'unknown'
}

function decodeStatus(value: unknown): AssistantActionStatus {
  const statuses: AssistantActionStatus[] = [
    'proposed',
    'awaitingApproval',
    'approved',
    'executing',
    'awaitingResponse',
    'succeeded',
    'failed',
    'rejected',
    'cancelled',
    'expired',
  ]
  return statuses.includes(value as AssistantActionStatus)
    ? (value as AssistantActionStatus)
    : 'unknown'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
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

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
