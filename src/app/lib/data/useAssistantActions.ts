import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  decodeAssistantAction,
  type AssistantAction,
} from '../assistant/actions'

export interface AssistantActionsState {
  actions: AssistantAction[]
  pendingCount: number
  loading: boolean
  error: string | null
}

export function useAssistantActions(
  uid: string | undefined,
  max = 50
): AssistantActionsState {
  const [actions, setActions] = useState<AssistantAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setActions([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    const actionsQuery = query(
      collection(db, 'users', uid, 'assistantActions'),
      orderBy('createdAt', 'desc'),
      limit(max)
    )
    const unsubscribe = onSnapshot(
      actionsQuery,
      (snapshot) => {
        setActions(
          snapshot.docs.map((item) =>
            decodeAssistantAction(item.data() as Record<string, unknown>, item.id)
          )
        )
        setLoading(false)
        setError(null)
      },
      (snapshotError) => {
        setActions([])
        setLoading(false)
        setError(snapshotError.message)
      }
    )
    return () => unsubscribe()
  }, [uid, max])

  const pendingCount = useMemo(
    () => actions.filter((action) => action.status === 'awaitingApproval').length,
    [actions]
  )

  return { actions, pendingCount, loading, error }
}
