import { useEffect, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDate, toDateOrNow } from '../firestore'

export interface ChatSessionMessage {
  id: string
  role: 'user' | 'model'
  content: string
  provider?: string
  timestamp: Date
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatSessionMessage[]
  mode: 'general' | 'training'
  lastProvider?: string
  createdAt: Date
  updatedAt: Date
}

type Raw = Record<string, unknown>

function decodeMessage(raw: Raw): ChatSessionMessage {
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    role: raw.role === 'user' ? 'user' : 'model',
    content: typeof raw.content === 'string' ? raw.content : '',
    provider: typeof raw.provider === 'string' ? raw.provider : undefined,
    timestamp: toDate(raw.timestamp) ?? new Date(),
  }
}

function decodeSession(raw: Raw, id: string): ChatSession {
  const msgs = Array.isArray(raw.messages) ? raw.messages : []
  return {
    id: typeof raw.id === 'string' ? raw.id : id,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    messages: msgs.map((m) => decodeMessage(m as Raw)),
    mode: raw.mode === 'training' ? 'training' : 'general',
    lastProvider: typeof raw.lastProvider === 'string' ? raw.lastProvider : undefined,
    createdAt: toDateOrNow(raw.createdAt),
    updatedAt: toDateOrNow(raw.updatedAt),
  }
}

export interface ChatSessionsState {
  sessions: ChatSession[]
  loading: boolean
  error: string | null
}

export function useRecentChatSessions(uid: string | undefined, max = 20): ChatSessionsState {
  const [state, setState] = useState<ChatSessionsState>({ sessions: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ sessions: [], loading: false, error: null })
      return
    }
    const q = query(
      collection(db, 'users', uid, 'chatSessions'),
      orderBy('updatedAt', 'desc'),
      limit(max)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const sessions = snap.docs.map((d) => decodeSession(d.data() as Raw, d.id))
        setState({ sessions, loading: false, error: null })
      },
      (err) => setState({ sessions: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid, max])

  return state
}

export interface ChatSessionState {
  session: ChatSession | null
  loading: boolean
  error: string | null
  notFound: boolean
}

export function useChatSession(uid: string | undefined, sessionId: string | undefined): ChatSessionState {
  const [state, setState] = useState<ChatSessionState>({
    session: null,
    loading: true,
    error: null,
    notFound: false,
  })

  useEffect(() => {
    if (!uid || !sessionId) {
      setState({ session: null, loading: false, error: null, notFound: false })
      return
    }
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'chatSessions', sessionId),
      (snap) => {
        if (!snap.exists()) {
          setState({ session: null, loading: false, error: null, notFound: true })
          return
        }
        const session = decodeSession(snap.data() as Raw, snap.id)
        setState({ session, loading: false, error: null, notFound: false })
      },
      (err) => setState({ session: null, loading: false, error: err.message, notFound: false })
    )
    return () => unsub()
  }, [uid, sessionId])

  return state
}

export async function saveChatSession(uid: string, session: ChatSession): Promise<void> {
  const payload: Record<string, unknown> = {
    id: session.id,
    title: session.title,
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      ...(m.provider ? { provider: m.provider } : {}),
    })),
    mode: session.mode,
    createdAt: session.createdAt,
    updatedAt: new Date(),
    ...(session.lastProvider ? { lastProvider: session.lastProvider } : {}),
  }
  await setDoc(doc(db, 'users', uid, 'chatSessions', session.id), payload, { merge: true })
}

export async function deleteChatSession(uid: string, sessionId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'chatSessions', sessionId))
}

export function titleFromFirstMessage(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 50) return trimmed || 'Conversation'
  return trimmed.slice(0, 47) + '…'
}
