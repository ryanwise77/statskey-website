import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import {
  decodeStrengthSession,
  encodeStrength,
  type StrengthSession,
} from './model'

export function useStrengthHistory(uid: string | undefined) {
  const [state, setState] = useState<{
    owner?: string
    sessions: StrengthSession[]
    loading: boolean
    error: string | null
  }>({ sessions: [], loading: true, error: null })
  useEffect(() => {
    let current = true
    setState({ owner: uid, sessions: [], loading: !!uid, error: null })
    if (!uid) return
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'users', uid, 'liftingSessions'),
        orderBy('startDate', 'desc'),
        limit(200),
      ),
      (snapshot) => {
        if (!current) return
        const sessions = snapshot.docs
          .map((d) => decodeStrengthSession(d.data(), d.id, uid))
          .filter(
            (s): s is StrengthSession => s != null && s.status === 'completed',
          )
        setState({ owner: uid, sessions, loading: false, error: null })
      },
      (error) => {
        if (current)
          setState({
            owner: uid,
            sessions: [],
            loading: false,
            error: error.message,
          })
      },
    )
    return () => {
      current = false
      unsubscribe()
    }
  }, [uid])
  return state.owner === uid
    ? state
    : { sessions: [], loading: !!uid, error: null }
}

export async function saveStrengthSession(
  uid: string,
  session: StrengthSession,
): Promise<void> {
  if (!uid || auth.currentUser?.uid !== uid || session.userId !== uid)
    throw new Error('Sign in to save this workout to your account.')
  const payload = encodeStrength(session)
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  const fingerprint = Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  const reference = doc(db, 'users', uid, 'liftingSessions', session.id)
  await runTransaction(db, async (transaction) => {
    if (auth.currentUser?.uid !== uid)
      throw new Error('Your account changed. Reopen Strength before saving.')
    const existing = await transaction.get(reference)
    if (auth.currentUser?.uid !== uid)
      throw new Error('Your account changed. Reopen Strength before saving.')
    if (existing.exists()) {
      if (existing.data().webSaveFingerprint === fingerprint) return
      throw new Error(
        'This workout has already been saved or changed. Open it in strength history before recording another workout.',
      )
    }
    transaction.set(reference, { ...payload, webSaveFingerprint: fingerprint })
    transaction.set(
      doc(db, 'users', uid, 'activityPlanWrites', 'current'),
      { generation: crypto.randomUUID(), updatedAt: serverTimestamp() },
      { merge: true },
    )
  })
}
