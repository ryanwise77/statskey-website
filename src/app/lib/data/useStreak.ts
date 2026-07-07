import { useEffect, useState } from 'react'
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDate } from '../firestore'

export interface StreakState {
  /** Consecutive days with at least one recorded meal, ending today or yesterday. */
  currentStreakDays: number
  /** True if today already has a recorded meal. */
  recordedToday: boolean
  loading: boolean
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * Recording streak computed from meal dates using the same math as
 * biometrics/StatsKey/Services/StreakService.swift: walk backwards from today
 * (or yesterday if today has no meal yet — the streak isn't broken until the
 * day ends).
 */
export function useStreak(uid: string | undefined): StreakState {
  const [state, setState] = useState<StreakState>({
    currentStreakDays: 0,
    recordedToday: false,
    loading: true,
  })

  useEffect(() => {
    if (!uid) {
      setState({ currentStreakDays: 0, recordedToday: false, loading: false })
      return
    }
    let cancelled = false

    ;(async () => {
      try {
        const since = new Date()
        since.setDate(since.getDate() - 400)
        const snap = await getDocs(
          query(
            collection(db, 'users', uid, 'meals'),
            where('date', '>=', Timestamp.fromDate(since)),
            orderBy('date', 'desc')
          )
        )
        const activeDays = new Set<string>()
        for (const d of snap.docs) {
          const date = toDate((d.data() as Record<string, unknown>).date)
          if (date) activeDays.add(dayKey(date))
        }

        const today = new Date()
        const recordedToday = activeDays.has(dayKey(today))
        const cursor = new Date(today)
        if (!recordedToday) cursor.setDate(cursor.getDate() - 1)

        let streak = 0
        while (activeDays.has(dayKey(cursor))) {
          streak += 1
          cursor.setDate(cursor.getDate() - 1)
        }

        if (!cancelled) {
          setState({ currentStreakDays: streak, recordedToday, loading: false })
        }
      } catch {
        if (!cancelled) setState({ currentStreakDays: 0, recordedToday: false, loading: false })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [uid])

  return state
}
