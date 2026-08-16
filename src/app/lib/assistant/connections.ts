import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db, firebaseApp } from '../firebase'
import { toDate } from '../firestore'

export type GoogleAssistantCapability =
  | 'calendar'
  | 'calendarRead'
  | 'email'
  | 'emailRead'
export type AssistantConnectionProvider =
  | 'google'
  | 'microsoft'
  | 'apple'
  | 'caldav'

export interface AssistantConnection {
  provider: AssistantConnectionProvider
  status: 'connected' | 'disconnected' | 'reconnectRequired' | 'unknown'
  accountEmail?: string
  displayName?: string
  capabilities: GoogleAssistantCapability[]
  scopes: string[]
  connectedAt?: Date
  updatedAt?: Date
  revocationConfirmed?: boolean
}

export interface AssistantConnectionState {
  connection: AssistantConnection | null
  loading: boolean
  error: string | null
}

const functions = getFunctions(firebaseApp, 'us-central1')
const beginGoogleCall = httpsCallable<
  { capabilities: GoogleAssistantCapability[] },
  {
    provider: 'google'
    authorizationUrl: string
    capabilities: GoogleAssistantCapability[]
    expiresAt: string
  }
>(functions, 'beginGoogleAssistantConnection')
const disconnectGoogleCall = httpsCallable<
  { provider: 'google' },
  { provider: 'google'; status: 'disconnected'; revocationConfirmed: boolean }
>(functions, 'disconnectGoogleAssistantConnection')

export function useGoogleAssistantConnection(
  uid: string | undefined
): AssistantConnectionState {
  return useAssistantConnection(uid, 'google')
}

export function useAssistantConnection(
  uid: string | undefined,
  provider: AssistantConnectionProvider
): AssistantConnectionState {
  const [state, setState] = useState<AssistantConnectionState>({
    connection: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!uid) {
      setState({ connection: null, loading: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    return onSnapshot(
      doc(db, 'users', uid, 'assistantConnections', provider),
      (snapshot) => {
        setState({
          connection: snapshot.exists()
            ? decodeConnection(
                snapshot.data() as Record<string, unknown>,
                provider
              )
            : null,
          loading: false,
          error: null,
        })
      },
      (error) => {
        setState({ connection: null, loading: false, error: error.message })
      }
    )
  }, [provider, uid])

  return state
}

export async function beginGoogleAssistantConnection(
  capabilities: GoogleAssistantCapability[]
): Promise<string> {
  const { data } = await beginGoogleCall({ capabilities })
  const url = new URL(data.authorizationUrl)
  if (url.origin !== 'https://accounts.google.com') {
    throw new Error('StatsKey received an invalid Google authorization URL.')
  }
  return url.toString()
}

export async function disconnectGoogleAssistantConnection(): Promise<void> {
  await disconnectGoogleCall({ provider: 'google' })
}

function decodeConnection(
  raw: Record<string, unknown>,
  provider: AssistantConnectionProvider
): AssistantConnection {
  return {
    provider,
    status:
      raw.status === 'connected' ||
      raw.status === 'disconnected' ||
      raw.status === 'reconnectRequired'
        ? raw.status
        : 'unknown',
    accountEmail:
      typeof raw.accountEmail === 'string' ? raw.accountEmail : undefined,
    displayName:
      typeof raw.displayName === 'string' ? raw.displayName : undefined,
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.filter(
          (item): item is GoogleAssistantCapability =>
            item === 'calendar' ||
            item === 'calendarRead' ||
            item === 'email' ||
            item === 'emailRead'
        )
      : [],
    scopes: Array.isArray(raw.scopes)
      ? raw.scopes.filter((item): item is string => typeof item === 'string')
      : [],
    connectedAt: toDate(raw.connectedAt),
    updatedAt: toDate(raw.updatedAt),
    revocationConfirmed:
      typeof raw.revocationConfirmed === 'boolean'
        ? raw.revocationConfirmed
        : undefined,
  }
}
