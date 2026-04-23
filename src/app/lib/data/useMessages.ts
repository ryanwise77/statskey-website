import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  getDocs,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDateOrNow } from '../firestore'
import { newId } from '../writers'

type Raw = Record<string, unknown>

export interface ConversationMeta {
  id: string
  participants: string[]
  lastMessage: string
  lastMessageDate: Date
  lastSenderId: string
}

export interface DirectMessage {
  id: string
  senderId: string
  senderName: string
  receiverId: string
  text: string
  createdAt: Date
  isRead: boolean
}

function decodeConversation(raw: Raw, id: string): ConversationMeta {
  const participants = Array.isArray(raw.participants)
    ? (raw.participants as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return {
    id,
    participants,
    lastMessage: typeof raw.lastMessage === 'string' ? raw.lastMessage : '',
    lastMessageDate: toDateOrNow(raw.lastMessageDate),
    lastSenderId: typeof raw.lastSenderId === 'string' ? raw.lastSenderId : '',
  }
}

function decodeMessage(raw: Raw, id: string): DirectMessage {
  return {
    id: typeof raw.id === 'string' ? raw.id : id,
    senderId: typeof raw.senderId === 'string' ? raw.senderId : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName : '',
    receiverId: typeof raw.receiverId === 'string' ? raw.receiverId : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    createdAt: toDateOrNow(raw.createdAt),
    isRead: raw.isRead === true,
  }
}

export interface ConversationsState {
  conversations: ConversationMeta[]
  loading: boolean
  error: string | null
}

export function useConversations(uid: string | undefined): ConversationsState {
  const [state, setState] = useState<ConversationsState>({ conversations: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ conversations: [], loading: false, error: null })
      return
    }
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid),
      orderBy('lastMessageDate', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const conversations = snap.docs.map((d) => decodeConversation(d.data() as Raw, d.id))
        setState({ conversations, loading: false, error: null })
      },
      (err) => setState({ conversations: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}

/**
 * Deterministic conversation ID matching biometrics/StatsKey/Models/SocialInteraction.swift:69-72.
 */
export function conversationId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_')
}

export interface MessagesState {
  messages: DirectMessage[]
  loading: boolean
  error: string | null
}

export function useMessages(uid: string | undefined, otherUid: string | undefined): MessagesState {
  const [state, setState] = useState<MessagesState>({ messages: [], loading: true, error: null })

  useEffect(() => {
    if (!uid || !otherUid) {
      setState({ messages: [], loading: false, error: null })
      return
    }
    const convoId = conversationId(uid, otherUid)
    const q = query(
      collection(db, 'conversations', convoId, 'messages'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const messages = snap.docs.map((d) => decodeMessage(d.data() as Raw, d.id))
        setState({ messages, loading: false, error: null })
      },
      (err) => setState({ messages: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid, otherUid])

  return state
}

/**
 * Sends a direct message and updates the parent conversation meta.
 * Matches biometrics/StatsKey/Services/DatabaseService.swift:1247-1261.
 */
export async function sendMessage(params: {
  senderId: string
  senderName: string
  receiverId: string
  text: string
}): Promise<void> {
  const { senderId, senderName, receiverId, text } = params
  const convoId = conversationId(senderId, receiverId)
  const messageId = newId()

  const now = new Date()
  await setDoc(doc(db, 'conversations', convoId, 'messages', messageId), {
    id: messageId,
    senderId,
    senderName,
    receiverId,
    text,
    createdAt: Timestamp.fromDate(now),
    isRead: false,
  })

  await setDoc(
    doc(db, 'conversations', convoId),
    {
      participants: [senderId, receiverId].sort(),
      lastMessage: text,
      lastMessageDate: Timestamp.fromDate(now),
      lastSenderId: senderId,
    },
    { merge: true }
  )
}

/**
 * Marks all unread inbound messages in the thread as read.
 * Matches markMessagesRead at DatabaseService.swift:1326-1340.
 */
export async function markMessagesRead(currentUid: string, otherUid: string): Promise<void> {
  const convoId = conversationId(currentUid, otherUid)
  const q = query(
    collection(db, 'conversations', convoId, 'messages'),
    where('receiverId', '==', currentUid),
    where('isRead', '==', false)
  )
  const snap = await getDocs(q)
  if (snap.empty) return
  const batch = writeBatch(db)
  for (const d of snap.docs) {
    batch.update(d.ref, { isRead: true })
  }
  await batch.commit()
}

