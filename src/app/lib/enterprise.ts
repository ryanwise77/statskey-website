import { useCallback, useEffect, useState } from 'react'
import {
  collection,
  getDoc,
  getDocs,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db, firebaseApp } from './firebase'
import { toDate } from './firestore'

export type EnterpriseRole =
  | 'owner'
  | 'admin'
  | 'clinician'
  | 'analyst'
  | 'viewer'

export type EnterpriseProvider = 'google' | 'anthropic' | 'openai' | 'xai'

export interface EnterpriseWorkspacePolicy {
  externalActionsRequireApproval: true
  phiAllowed: false
  permittedProviders: EnterpriseProvider[]
  webSearchEnabled: boolean
  exportEnabled: boolean
  retentionDays: number
}

export interface EnterpriseWorkspace {
  id: string
  organizationId: string
  name: string
  status: string
  complianceIntent: 'standard' | 'hipaa'
  complianceStatus: 'standard' | 'pendingReadiness' | string
  phiStatus: 'notAllowed'
  policy: EnterpriseWorkspacePolicy
  updatedAt?: Date
}

export interface EnterpriseMember {
  uid: string
  email?: string
  displayName?: string
  role: EnterpriseRole
  status: string
  joinedAt?: Date
}

export interface EnterpriseAuditEvent {
  id: string
  type: string
  summary: string
  actorUid: string
  workspaceId?: string
  createdAt?: Date
}

export interface EnterpriseOrganization {
  id: string
  name: string
  organizationType: string
  status: string
  complianceIntent: 'standard' | 'hipaa'
  complianceStatus: string
  phiStatus: 'notAllowed'
  role: EnterpriseRole
  members: EnterpriseMember[]
  workspaces: EnterpriseWorkspace[]
  auditEvents: EnterpriseAuditEvent[]
}

interface EnterpriseState {
  organizations: EnterpriseOrganization[]
  loading: boolean
  error: string | null
  refresh: () => void
}

const functions = getFunctions(firebaseApp, 'us-central1')
const createOrganizationCall = httpsCallable<
  {
    name: string
    organizationType: string
    complianceIntent: 'standard' | 'hipaa'
  },
  {
    organizationId: string
    workspaceId: string
    role: EnterpriseRole
    phiStatus: 'notAllowed'
    complianceStatus: string
  }
>(functions, 'createEnterpriseOrganization')
const createWorkspaceCall = httpsCallable<
  {
    organizationId: string
    name: string
    complianceIntent: 'standard' | 'hipaa'
  },
  {
    organizationId: string
    workspaceId: string
    phiStatus: 'notAllowed'
    complianceStatus: string
  }
>(functions, 'createEnterpriseWorkspace')
const updatePolicyCall = httpsCallable<
  {
    organizationId: string
    workspaceId: string
    retentionDays: number
    permittedProviders: EnterpriseProvider[]
    webSearchEnabled: boolean
    exportEnabled: boolean
  },
  {
    organizationId: string
    workspaceId: string
    policy: EnterpriseWorkspacePolicy
  }
>(functions, 'updateEnterpriseWorkspacePolicy')
const addMemberCall = httpsCallable<
  { organizationId: string; email: string; role: Exclude<EnterpriseRole, 'owner'> },
  { organizationId: string; targetUid: string; role: EnterpriseRole; status: string }
>(functions, 'addEnterpriseMember')
const updateMemberRoleCall = httpsCallable<
  {
    organizationId: string
    targetUid: string
    role: Exclude<EnterpriseRole, 'owner'>
  },
  { organizationId: string; targetUid: string; role: EnterpriseRole }
>(functions, 'updateEnterpriseMemberRole')
const removeMemberCall = httpsCallable<
  { organizationId: string; targetUid: string },
  { organizationId: string; targetUid: string; status: string; existing: boolean }
>(functions, 'removeEnterpriseMember')

export function useEnterpriseOrganizations(
  uid: string | undefined
): EnterpriseState {
  const [organizations, setOrganizations] = useState<EnterpriseOrganization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), [])

  useEffect(() => {
    if (!uid) {
      setOrganizations([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    let generation = 0
    return onSnapshot(
      collection(db, 'users', uid, 'organizationMemberships'),
      async (snapshot) => {
        const currentGeneration = ++generation
        try {
          const loaded = await Promise.all(
            snapshot.docs
              .filter((membership) => membership.data().status === 'active')
              .map(async (membership) => {
                const membershipData = membership.data() as Record<string, unknown>
                const organizationId = membership.id
                const role = decodeRole(membershipData.role)
                const [organizationSnapshot, workspacesSnapshot, membersSnapshot, auditSnapshot] = await Promise.all([
                  getDoc(doc(db, 'organizations', organizationId)),
                  getDocs(
                    query(
                      collection(db, 'organizations', organizationId, 'workspaces'),
                      orderBy('createdAt', 'asc')
                    )
                  ),
                  getDocs(
                    query(
                      collection(db, 'organizations', organizationId, 'members'),
                      orderBy('joinedAt', 'asc')
                    )
                  ),
                  role === 'owner' || role === 'admin'
                    ? getDocs(
                        query(
                          collection(
                            db,
                            'organizations',
                            organizationId,
                            'auditEvents'
                          ),
                          orderBy('createdAt', 'desc'),
                          limit(20)
                        )
                      )
                    : Promise.resolve(null),
                ])
                if (!organizationSnapshot.exists()) return null
                const raw = organizationSnapshot.data() as Record<string, unknown>
                return {
                  id: organizationId,
                  name: text(raw.name, 'Organization'),
                  organizationType: text(raw.organizationType, 'other'),
                  status: text(raw.status, 'unknown'),
                  complianceIntent:
                    raw.complianceIntent === 'hipaa' ? 'hipaa' : 'standard',
                  complianceStatus: text(raw.complianceStatus, 'standard'),
                  phiStatus: 'notAllowed' as const,
                  role,
                  members: membersSnapshot.docs.map((member) =>
                    decodeMember(member.data() as Record<string, unknown>, member.id)
                  ),
                  workspaces: workspacesSnapshot.docs.map((workspace) =>
                    decodeWorkspace(
                      workspace.data() as Record<string, unknown>,
                      workspace.id,
                      organizationId
                    )
                  ),
                  auditEvents:
                    auditSnapshot?.docs.map((event) =>
                      decodeAuditEvent(
                        event.data() as Record<string, unknown>,
                        event.id
                      )
                    ) ?? [],
                } satisfies EnterpriseOrganization
              })
          )
          if (currentGeneration !== generation) return
          setOrganizations(
            loaded
              .filter(
                (organization): organization is EnterpriseOrganization =>
                  organization != null
              )
              .sort((left, right) => left.name.localeCompare(right.name))
          )
          setLoading(false)
          setError(null)
        } catch (loadError) {
          if (currentGeneration !== generation) return
          setOrganizations([])
          setLoading(false)
          setError(messageFor(loadError))
        }
      },
      (snapshotError) => {
        setOrganizations([])
        setLoading(false)
        setError(snapshotError.message)
      }
    )
  }, [uid, refreshVersion])

  return { organizations, loading, error, refresh }
}

export async function createEnterpriseOrganization(input: {
  name: string
  organizationType: string
  complianceIntent: 'standard' | 'hipaa'
}): Promise<void> {
  await createOrganizationCall(input)
}

export async function createEnterpriseWorkspace(input: {
  organizationId: string
  name: string
  complianceIntent: 'standard' | 'hipaa'
}): Promise<void> {
  await createWorkspaceCall(input)
}

export async function updateEnterpriseWorkspacePolicy(input: {
  organizationId: string
  workspaceId: string
  retentionDays: number
  permittedProviders: EnterpriseProvider[]
  webSearchEnabled: boolean
  exportEnabled: boolean
}): Promise<void> {
  await updatePolicyCall(input)
}

export async function addEnterpriseMember(input: {
  organizationId: string
  email: string
  role: Exclude<EnterpriseRole, 'owner'>
}): Promise<void> {
  await addMemberCall(input)
}

export async function updateEnterpriseMemberRole(input: {
  organizationId: string
  targetUid: string
  role: Exclude<EnterpriseRole, 'owner'>
}): Promise<void> {
  await updateMemberRoleCall(input)
}

export async function removeEnterpriseMember(input: {
  organizationId: string
  targetUid: string
}): Promise<void> {
  await removeMemberCall(input)
}

function decodeWorkspace(
  raw: Record<string, unknown>,
  id: string,
  organizationId: string
): EnterpriseWorkspace {
  const policy = record(raw.policy)
  return {
    id,
    organizationId,
    name: text(raw.name, 'Workbench'),
    status: text(raw.status, 'unknown'),
    complianceIntent: raw.complianceIntent === 'hipaa' ? 'hipaa' : 'standard',
    complianceStatus: text(raw.complianceStatus, 'standard'),
    phiStatus: 'notAllowed',
    policy: {
      externalActionsRequireApproval: true,
      phiAllowed: false,
      permittedProviders: Array.isArray(policy.permittedProviders)
        ? policy.permittedProviders.filter(isEnterpriseProvider)
        : [],
      webSearchEnabled: policy.webSearchEnabled === true,
      exportEnabled: policy.exportEnabled === true,
      retentionDays:
        typeof policy.retentionDays === 'number' ? policy.retentionDays : 365,
    },
    updatedAt: toDate(raw.updatedAt),
  }
}

function decodeRole(value: unknown): EnterpriseRole {
  return value === 'owner' ||
    value === 'admin' ||
    value === 'clinician' ||
    value === 'analyst' ||
    value === 'viewer'
    ? value
    : 'viewer'
}

function decodeMember(
  raw: Record<string, unknown>,
  uid: string
): EnterpriseMember {
  return {
    uid,
    email: typeof raw.email === 'string' ? raw.email : undefined,
    displayName:
      typeof raw.displayName === 'string' ? raw.displayName : undefined,
    role: decodeRole(raw.role),
    status: text(raw.status, 'unknown'),
    joinedAt: toDate(raw.joinedAt),
  }
}

function decodeAuditEvent(
  raw: Record<string, unknown>,
  id: string
): EnterpriseAuditEvent {
  return {
    id,
    type: text(raw.type, 'unknown'),
    summary: text(raw.summary, 'Administrative event'),
    actorUid: text(raw.actorUid, 'unknown'),
    workspaceId:
      typeof raw.workspaceId === 'string' ? raw.workspaceId : undefined,
    createdAt: toDate(raw.createdAt),
  }
}

function isEnterpriseProvider(value: unknown): value is EnterpriseProvider {
  return (
    value === 'google' ||
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'xai'
  )
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
