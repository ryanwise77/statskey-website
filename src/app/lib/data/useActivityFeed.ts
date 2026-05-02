import { useEffect, useState } from 'react'
import {
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
   *  current user (so the card can render a "You" badge). */
  friend?: Friend
  isCurrentUser: boolean
}

export interface ActivityFeedState {
  items: ActivityFeedItem[]
  loading: boolean
  error: string | null
}

/**
 * Synthesizes a feed from the current user's workouts plus their friends'.
 * Mirrors `loadFeed` in biometrics/StatsKey/Views/Friends/ActivityFeedView.swift,
 * which combines `fetchWorkoutSessions(userId:)` + `fetchFriendWorkouts`.
 *
 * Firestore's `in` operator is capped at 30 — so we chunk the friend uids.
 * The current user's workouts are queried in the same chunked query when
 * possible (added to the first chunk) to keep this to a single round trip
 * per chunk.
 */
export function useActivityFeed(uid: string | undefined, max = 20): ActivityFeedState {
  const { friends, loading: friendsLoading } = useFriends(uid)
  const [state, setState] = useState<ActivityFeedState>({ items: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ items: [], loading: false, error: null })
      return
    }
    if (friendsLoading) return

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const friendUids = friends.map((f) => f.uid)
        const allUids = [uid, ...friendUids]

        const chunks: string[][] = []
        for (let i = 0; i < allUids.length; i += 30) chunks.push(allUids.slice(i, i + 30))

        const results: WorkoutSession[] = []
        for (const chunk of chunks) {
          const q = query(
            collectionGroup(db, 'workoutSessions'),
            where('userId', 'in', chunk),
            orderBy('startDate', 'desc'),
            limit(max)
          )
          const snap = await getDocs(q)
          for (const d of snap.docs) {
            results.push(decodeWorkout(d.data() as Record<string, unknown>, d.id))
          }
        }

        results.sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
        const trimmed = results.slice(0, max)

        if (cancelled) return
        const items: ActivityFeedItem[] = trimmed.map((w) => ({
          workout: w,
          friend: friends.find((f) => f.uid === w.userId),
          isCurrentUser: w.userId === uid,
        }))
        setState({ items, loading: false, error: null })
      } catch (e) {
        if (!cancelled) setState({ items: [], loading: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [uid, friendsLoading, friends, max])

  return state
}
