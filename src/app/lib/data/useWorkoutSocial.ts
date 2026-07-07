import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeWorkoutComment, decodeWorkoutKudo } from '../decoders'
import type { WorkoutComment, WorkoutKudo } from '../types'

export interface WorkoutSocialState {
  kudos: WorkoutKudo[]
  comments: WorkoutComment[]
  loading: boolean
  error: string | null
}

/**
 * Live kudos + comments on a workout. Paths match DatabaseService.swift:
 * users/{owner}/workoutSessions/{id}/kudos/{userId} and .../comments/{id}.
 * Friends can read these subcollections per firestore.rules.
 */
export function useWorkoutSocial(
  ownerUid: string | undefined,
  workoutId: string | undefined
): WorkoutSocialState {
  const [kudos, setKudos] = useState<WorkoutKudo[]>([])
  const [comments, setComments] = useState<WorkoutComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ownerUid || !workoutId) {
      setKudos([])
      setComments([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    const kudosRef = collection(db, 'users', ownerUid, 'workoutSessions', workoutId, 'kudos')
    const commentsRef = query(
      collection(db, 'users', ownerUid, 'workoutSessions', workoutId, 'comments'),
      orderBy('createdAt', 'asc')
    )

    const unsubKudos = onSnapshot(
      kudosRef,
      (snap) => {
        setKudos(snap.docs.map((d) => decodeWorkoutKudo(d.data() as Record<string, unknown>, d.id)))
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      }
    )
    const unsubComments = onSnapshot(
      commentsRef,
      (snap) => {
        setComments(snap.docs.map((d) => decodeWorkoutComment(d.data() as Record<string, unknown>, d.id)))
      },
      () => {}
    )
    return () => {
      unsubKudos()
      unsubComments()
    }
  }, [ownerUid, workoutId])

  return { kudos, comments, loading, error }
}
