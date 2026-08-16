import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db, firebaseApp } from './firebase'
import { toDate } from './firestore'

// Mirrors AIConsentService.currentVersion and the server's latest disclosure
// version. The server keeps the prior provider set valid for older app builds,
// while routes added by this disclosure (currently Kimi) require this version.
export const INTELLIGENCE_CONSENT_VERSION = 3
export const ASSISTANT_ACTION_CONSENT_VERSION = 1

export interface IntelligenceConsentState {
  granted: boolean
  intelligenceGranted: boolean
  assistantGranted: boolean
  status: 'granted' | 'revoked' | 'missing'
  version: number
  acceptedAt?: Date
  loading: boolean
  error: string | null
}

const functions = getFunctions(firebaseApp, 'us-central1')
const updateConsentCall = httpsCallable<
  { granted: boolean; version: number },
  { status: 'granted' | 'revoked'; version?: number }
>(functions, 'updateIntelligenceConsentV3')
const updateAssistantConsentCall = httpsCallable<
  { granted: boolean; version: number },
  { status: 'granted' | 'revoked'; version: number }
>(functions, 'updateAssistantActionConsent')

export function useIntelligenceConsent(
  uid: string | undefined
): IntelligenceConsentState {
  const [state, setState] = useState<IntelligenceConsentState>({
    granted: false,
    intelligenceGranted: false,
    assistantGranted: false,
    status: 'missing',
    version: 0,
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!uid) {
      setState({
        granted: false,
        intelligenceGranted: false,
        assistantGranted: false,
        status: 'missing',
        version: 0,
        loading: false,
        error: null,
      })
      return
    }

    setState((current) => ({ ...current, loading: true, error: null }))
    let intelligence:
      | { status: IntelligenceConsentState['status']; version: number; acceptedAt?: Date }
      | undefined
    let assistant:
      | { status: IntelligenceConsentState['status']; version: number }
      | undefined
    let intelligenceError: string | null = null
    let assistantError: string | null = null

    function publish() {
      if (!intelligence || !assistant) return
      const intelligenceGranted =
        intelligence.status === 'granted' &&
        intelligence.version >= INTELLIGENCE_CONSENT_VERSION
      const assistantGranted =
        assistant.status === 'granted' &&
        assistant.version >= ASSISTANT_ACTION_CONSENT_VERSION
      setState({
        granted: intelligenceGranted && assistantGranted,
        intelligenceGranted,
        assistantGranted,
        status:
          intelligenceGranted && assistantGranted
            ? 'granted'
            : intelligence.status === 'revoked' || assistant.status === 'revoked'
            ? 'revoked'
            : 'missing',
        version: intelligence.version,
        acceptedAt: intelligence.acceptedAt,
        loading: false,
        error: intelligenceError || assistantError,
      })
    }

    const unsubscribeIntelligence = onSnapshot(
      doc(db, 'users', uid, 'preferences', 'intelligenceConsent'),
      (snapshot) => {
        const raw = snapshot.exists()
          ? (snapshot.data() as Record<string, unknown>)
          : undefined
        const status =
          raw?.status === 'granted'
            ? 'granted'
            : raw?.status === 'revoked'
            ? 'revoked'
            : 'missing'
        const version =
          typeof raw?.version === 'number' && Number.isFinite(raw.version)
            ? raw.version
            : 0
        intelligence = {
          status,
          version,
          acceptedAt: toDate(raw?.acceptedAt),
        }
        intelligenceError = null
        publish()
      },
      (error) => {
        intelligence = { status: 'missing', version: 0 }
        intelligenceError = error.message
        publish()
      }
    )
    const unsubscribeAssistant = onSnapshot(
      doc(db, 'users', uid, 'preferences', 'assistantConsent'),
      (snapshot) => {
        const raw = snapshot.exists()
          ? (snapshot.data() as Record<string, unknown>)
          : undefined
        assistant = {
          status:
            raw?.status === 'granted'
              ? 'granted'
              : raw?.status === 'revoked'
              ? 'revoked'
              : 'missing',
          version:
            typeof raw?.version === 'number' && Number.isFinite(raw.version)
              ? raw.version
              : 0,
        }
        assistantError = null
        publish()
      },
      (error) => {
        assistant = { status: 'missing', version: 0 }
        assistantError = error.message
        publish()
      }
    )
    return () => {
      unsubscribeIntelligence()
      unsubscribeAssistant()
    }
  }, [uid])

  return state
}

export async function grantIntelligenceConsent(): Promise<void> {
  await grantBaseIntelligenceConsent()
  await grantAssistantActionConsent()
}

export async function grantAssistantActionConsent(): Promise<void> {
  await updateAssistantConsentCall({
    granted: true,
    version: ASSISTANT_ACTION_CONSENT_VERSION,
  })
}

export async function grantBaseIntelligenceConsent(): Promise<void> {
  await updateConsentCall({
    granted: true,
    version: INTELLIGENCE_CONSENT_VERSION,
  })
}

export async function revokeIntelligenceConsent(): Promise<void> {
  await updateAssistantConsentCall({
    granted: false,
    version: ASSISTANT_ACTION_CONSENT_VERSION,
  })
  await updateConsentCall({
    granted: false,
    version: INTELLIGENCE_CONSENT_VERSION,
  })
}
