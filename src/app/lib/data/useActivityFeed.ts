import { useEffect, useState } from 'react'
import {
  collection,
  collectionGroup,
  limit,
  orderBy,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import { db } from '../firebase'
import { decodeWorkout } from '../decoders'
import type { WorkoutSession } from '../types'
import { useFriends, type Friend } from './useFriends'

export interface ActivityFeedItem {
  workout: WorkoutSession
  /** The friend whose workout this is. Undefined when the item belongs to the
   *  current user. */
  friend?: Friend
  isCurrentUser: boolean
}

export interface ActivityFeedState {
  items: ActivityFeedItem[]
  loading: boolean
  /** Set when the *own* workout query failed; the entire feed is empty in
   *  this case so we surface the message. */
  error: string | null
  /** Set when the friend collection-group query failed (typically a
   *  permissions error if the firestore rules haven't been updated to allow
   *  collection-group reads on workoutSessions). The user's own workouts
   *  still render — we just don't have friend activity to merge in. */
  friendError: string | null
}

/**
 * Synthesizes a feed from the current user's workouts plus their friends'.
 * Mirrors `loadFeed` in biometrics/StatsKey/Views/Friends/ActivityFeedView.swift,
 * which combines `fetchWorkoutSessions(userId:)` + `fetchFriendWorkouts`.
 *
 * Uses two queries on purpose:
 *   1. A regular per-user collection query at users/{uid}/workoutSessions.
 *      This always works under the existing rules (isOwner).
 *   2. A collection-group query filtered by friend uids. This requires a
 *      collection-group rule (`/{path=**}/workoutSessions/{sessionId}`).
 *
 * (1) and (2) run in parallel and are merged. If (2) fails (e.g., rules
 * haven't been deployed), the user still sees their own activity from (1).
 */
export function useActivityFeed(uid: string | undefined, max = 20): ActivityFeedState {
  const { friends, loading: friendsLoading } = useFriends(uid)
  const [state, setState] = useState<ActivityFeedState>({
    items: [],
    loading: true,
    error: null,
    friendError: null,
  })

  useEffect(() => {
    if (!uid) {
      setState({ items: [], loading: false, error: null, friendError: null })
      return
    }
    if (friendsLoading) return

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null, friendError: null }))

    ;(async () => {
      // Fetch own workouts directly. This is the "I want to see my latest
      // run" path the user actually cares about; we never want to drop it
      // due to a downstream friend-feed failure.
      const ownPromise = (async () => {
        const q = query(
          collection(db, 'users', uid, 'workoutSessions'),
          orderBy('startDate', 'desc'),
          limit(max)
        )
        const snap = await getDocs(q)
        return snap.docs.map((d) =>
          decodeWorkout(d.data() as Record<string, unknown>, d.id, uid)
        )
      })()

      // Fetch friend workouts via collection group, chunked by 30 (Firestore's
      // `in` cap). Friend uids only — including our own here would not change
      // the result and would still hit the same collection-group rule.
      const friendUids = friends.map((f) => f.uid)
      const friendPromise = (async (): Promise<WorkoutSession[]> => {
        if (friendUids.length === 0) return []
        const chunks: string[][] = []
        for (let i = 0; i < friendUids.length; i += 30) {
          chunks.push(friendUids.slice(i, i + 30))
        }
        const chunkResults = await Promise.all(
          chunks.map(async (chunk) => {
            const q = query(
              collectionGroup(db, 'workoutSessions'),
              where('userId', 'in', chunk),
              orderBy('startDate', 'desc'),
              limit(max)
            )
            const snap = await getDocs(q)
            return snap.docs.map((d) =>
              decodeWorkout(d.data() as Record<string, unknown>, d.id)
            )
          })
        )
        return chunkResults.flat()
      })()

      const [ownResult, friendResult] = await Promise.allSettled([ownPromise, friendPromise])
      if (cancelled) return

      const ownWorkouts = ownResult.status === 'fulfilled' ? ownResult.value : []
      const friendWorkouts = friendResult.status === 'fulfilled' ? friendResult.value : []

      const ownError =
        ownResult.status === 'rejected'
          ? errorMessage(ownResult.reason)
          : null
      const friendError =
        friendResult.status === 'rejected'
          ? errorMessage(friendResult.reason)
          : null

      const all = [...ownWorkouts, ...friendWorkouts]
      all.sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
      const trimmed = all.slice(0, max)

      const items: ActivityFeedItem[] = trimmed.map((w) => ({
        workout: w,
        friend: friends.find((f) => f.uid === w.userId),
        isCurrentUser: w.userId === uid,
      }))

      setState({ items, loading: false, error: ownError, friendError })
    })()

    return () => {
      cancelled = true
    }
  }, [uid, friendsLoading, friends, max])

  return state
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
