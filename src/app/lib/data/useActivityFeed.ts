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
  friend?: Friend
}

export interface ActivityFeedState {
  items: ActivityFeedItem[]
  loading: boolean
  error: string | null
}

/**
 * Synthesizes a feed from friends' workoutSessions via a collection-group
 * query. Matches biometrics/StatsKey/Services/DatabaseService.swift:965-989.
 * Firestore's `in` operator is capped at 30 — we chunk here too.
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
    if (friends.length === 0) {
      setState({ items: [], loading: false, error: null })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const uids = friends.map((f) => f.uid)
        const chunks: string[][] = []
        for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30))

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
