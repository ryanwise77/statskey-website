import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import {
  decodeStrengthSession,
  encodeStrength,
  type StrengthSession,
  cleanStrengthValue,
  newStrengthID,
} from './model'
import {
  assertStrengthRevision, decodeStrengthRoutine, decodeStrengthWeekPlan, encodeStrengthRoutine,
  type StrengthRoutine, type StrengthWeekPlan,
} from './plans'
import { buildStrengthEdits, type StrengthEditDraft } from './edits'
import { assertCustomStrengthRevision, decodeCustomStrengthExercise, encodeCustomStrengthExercise, type StrengthCatalogExercise } from './catalog'

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
      { generation: newStrengthID(), updatedAt: serverTimestamp() },
      { merge: true },
    )
  })
}

export function useStrengthLibrary(uid: string) {
  const [state, setState] = useState<{
    owner: string; routines: StrengthRoutine[]; plan: StrengthWeekPlan | null
    customExercises: StrengthCatalogExercise[]; exercisesLoading: boolean
    routinesLoading: boolean; planLoading: boolean; error: string | null
  }>({ owner: uid, routines: [], plan: null, customExercises: [], exercisesLoading: true, routinesLoading: true, planLoading: true, error: null })
  useEffect(() => {
    let current = true
    setState({ owner: uid, routines: [], plan: null, customExercises: [], exercisesLoading: true, routinesLoading: true, planLoading: true, error: null })
    const fail = (error: Error) => { if (current) setState((s) => ({ ...s, error: error.message })) }
    const routines = onSnapshot(collection(db, 'users', uid, 'liftingRoutines'), (snapshot) => {
      if (!current) return
      const values = snapshot.docs.map((d) => decodeStrengthRoutine(d.data(), d.id)).filter((r): r is StrengthRoutine => r != null)
      setState((s) => ({ ...s, routines: values.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()), routinesLoading: false }))
    }, fail)
    const plans = onSnapshot(query(collection(db, 'users', uid, 'liftingPlans'), where('isActive', '==', true)), (snapshot) => {
      if (!current) return
      const values = snapshot.docs.map((d) => decodeStrengthWeekPlan(d.data(), d.id)).filter((p): p is StrengthWeekPlan => p != null)
      setState((s) => ({ ...s, plan: values.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null, planLoading: false }))
    }, fail)
    const exercises = onSnapshot(collection(db, 'users', uid, 'liftingExercises'), (snapshot) => {
      if (!current) return
      const customExercises = snapshot.docs.map((d) => decodeCustomStrengthExercise(d.data(), d.id)).filter((e): e is StrengthCatalogExercise => e != null)
      setState((s) => ({ ...s, customExercises: customExercises.sort((a, b) => a.name.localeCompare(b.name)), exercisesLoading: false }))
    }, fail)
    return () => { current = false; routines(); plans(); exercises() }
  }, [uid])
  return state.owner === uid ? state : { owner: uid, routines: [], plan: null, customExercises: [], exercisesLoading: true, routinesLoading: true, planLoading: true, error: null }
}
export async function saveCustomStrengthExercise(uid: string, exercise: StrengthCatalogExercise, original: StrengthCatalogExercise | null, canCommit: () => boolean): Promise<void> {
  requireStrengthOwner(uid)
  const payload = encodeCustomStrengthExercise(exercise)
  const reference = doc(db, 'users', uid, 'liftingExercises', exercise.id)
  await runTransaction(db, async (transaction) => {
    if (!canCommit()) throw new Error('The exercise editor was closed.')
    const snapshot = await transaction.get(reference)
    requireStrengthOwner(uid)
    if (!canCommit()) throw new Error('The exercise editor was closed.')
    assertCustomStrengthRevision(snapshot.data(), exercise.id, original)
    transaction.set(reference, payload, { merge: true })
  })
}
function requireStrengthOwner(uid: string) {
  if (!uid || auth.currentUser?.uid !== uid) throw new Error('Your account changed. Reopen Strength before saving.')
}
export async function saveStrengthSessionEdits(uid: string, original: StrengthSession, draft: StrengthEditDraft, canCommit: () => boolean): Promise<StrengthSession> {
  requireStrengthOwner(uid)
  if (!original.id || original.id.includes('/')) throw new Error('Invalid workout identity.')
  const reference = doc(db, 'users', uid, 'liftingSessions', original.id)
  return runTransaction(db, async (transaction) => {
    if (!canCommit()) throw new Error('The workout editor was closed. Reopen it before saving.')
    const snapshot = await transaction.get(reference)
    requireStrengthOwner(uid)
    if (!canCommit()) throw new Error('The workout editor was closed. Reopen it before saving.')
    const latest = snapshot.data()
    const userEdits = buildStrengthEdits(original, draft, latest, uid)
    const saved = decodeStrengthSession({ ...latest, userEdits }, original.id, uid)
    if (!saved) throw new Error('This workout is no longer available.')
    transaction.update(reference, { userEdits })
    return saved
  })
}
export async function saveStrengthRoutine(uid: string, routine: StrengthRoutine, expected: Date | null): Promise<void> {
  requireStrengthOwner(uid)
  if (!routine.id || routine.id.includes('/')) throw new Error('Invalid routine identity.')
  const payload = encodeStrengthRoutine({ ...routine, updatedAt: new Date() })
  const reference = doc(db, 'users', uid, 'liftingRoutines', routine.id)
  await runTransaction(db, async (transaction) => {
    const original = await transaction.get(reference)
    requireStrengthOwner(uid)
    assertStrengthRevision(original.data(), expected)
    transaction.set(reference, payload)
  })
}
export async function deleteStrengthRoutine(uid: string, routine: StrengthRoutine): Promise<void> {
  requireStrengthOwner(uid)
  const reference = doc(db, 'users', uid, 'liftingRoutines', routine.id)
  await runTransaction(db, async (transaction) => {
    const original = await transaction.get(reference)
    requireStrengthOwner(uid)
    assertStrengthRevision(original.data(), routine.updatedAt)
    transaction.delete(reference)
  })
}
export async function saveStrengthWeekPlan(uid: string, plan: StrengthWeekPlan, expected: Date | null): Promise<void> {
  requireStrengthOwner(uid)
  if (!plan.id || plan.id.includes('/') || !plan.name.trim()) throw new Error('Give the week plan a name.')
  if (plan.days.length !== 7 || new Set(plan.days.map((d) => d.dayOfWeek)).size !== 7 || plan.days.some((d) => !Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 1 || d.dayOfWeek > 7))
    throw new Error('A repeating week must contain Monday through Sunday once each.')
  const revision = doc(db, 'users', uid, 'activityPlanWrites', 'current')
  // All native plan mutations also write this revision. Reading it before the
  // active-plan query catches a concurrent plan created outside the query result.
  const before = await getDocFromServer(revision)
  const active = await getDocsFromServer(query(collection(db, 'users', uid, 'liftingPlans'), where('isActive', '==', true)))
  const reference = doc(db, 'users', uid, 'liftingPlans', plan.id)
  const payload = cleanStrengthValue({ ...plan, name: plan.name.trim(), isActive: true, updatedAt: new Date() }) as Record<string, unknown>
  await runTransaction(db, async (transaction) => {
    const latestRevision = await transaction.get(revision)
    const original = await transaction.get(reference)
    requireStrengthOwner(uid)
    if (latestRevision.data()?.generation !== before.data()?.generation)
      throw new Error('Your training schedule changed. Reopen the week plan before saving.')
    assertStrengthRevision(original.data(), expected)
    for (const other of active.docs) if (other.id !== plan.id) transaction.update(other.ref, { isActive: false })
    transaction.set(reference, payload)
    transaction.set(revision, { generation: newStrengthID(), updatedAt: serverTimestamp() }, { merge: true })
  })
}
