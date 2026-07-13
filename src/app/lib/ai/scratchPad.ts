import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Persistent Intelligence memory, shared with the iOS agent. iOS reads and
 * writes the same document (users/{uid}/settings/aiScratchPad — see
 * DatabaseService.swift), so notes learned on either platform carry over.
 */
export interface ScratchPad {
  notes: string
  updatedAt: Date | null
}

export async function getScratchPad(uid: string): Promise<ScratchPad> {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'aiScratchPad'))
  if (!snap.exists()) return { notes: '', updatedAt: null }
  const raw = snap.data() as { notes?: unknown; updatedAt?: { toDate?: () => Date } }
  return {
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    updatedAt: typeof raw.updatedAt?.toDate === 'function' ? raw.updatedAt.toDate() : null,
  }
}

export async function updateScratchPad(uid: string, notes: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'settings', 'aiScratchPad'),
    { notes, updatedAt: new Date() },
    { merge: true }
  )
}
