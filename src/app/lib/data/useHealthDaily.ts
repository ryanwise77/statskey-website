import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  endOfDay,
  localDateString,
  startOfDay,
  toDate,
  toDateOrNow,
} from '../firestore'

export interface HealthDaily {
  date: Date
  activeCalories: number
  basalCalories: number
  steps: number
  exerciseMinutes: number
  standHours: number
  sleepHours: number
  distanceMilesWalkingRunning: number
  distanceMilesCycling: number
  flightsClimbed: number
  uvExposure: number
  dietaryWaterMl: number
  lastSyncedAt: Date | null
}

export interface HealthDailyState {
  health: HealthDaily | null
  loading: boolean
  error: string | null
  exists: boolean
}

export interface HealthDailyRangeState {
  days: HealthDaily[]
  loading: boolean
  error: string | null
}

function n(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

/**
 * users/{uid}/healthDaily/{YYYY-MM-DD} — aggregated HealthKit summary written
 * by the iOS HealthKitSyncService. Web can't produce these itself (no HealthKit
 * on web), so we only read what iOS has synced.
 * Matches biometrics/StatsKey/Models/HealthSamples.swift:10-29.
 */
export function useHealthDailyForDay(uid: string | undefined, day: Date): HealthDailyState {
  const [state, setState] = useState<HealthDailyState>({ health: null, loading: true, error: null, exists: false })
  const docId = localDateString(day)

  useEffect(() => {
    if (!uid) {
      setState({ health: null, loading: false, error: null, exists: false })
      return
    }
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'healthDaily', docId),
      (snap) => {
        if (!snap.exists()) {
          setState({ health: null, loading: false, error: null, exists: false })
          return
        }
        const raw = snap.data() as Record<string, unknown>
        const health = decodeHealthDaily(raw)
        setState({ health, loading: false, error: null, exists: true })
      },
      (err) => setState({ health: null, loading: false, error: err.message, exists: false })
    )
    return () => unsub()
  }, [uid, docId])

  return state
}

export function useHealthDailyRange(
  uid: string | undefined,
  start: Date,
  end: Date
): HealthDailyRangeState {
  const [state, setState] = useState<HealthDailyRangeState>({
    days: [],
    loading: true,
    error: null,
  })
  const key = `${localDateString(start)}|${localDateString(end)}`

  useEffect(() => {
    if (!uid) {
      setState({ days: [], loading: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    const healthQuery = query(
      collection(db, 'users', uid, 'healthDaily'),
      where('date', '>=', Timestamp.fromDate(startOfDay(start))),
      where('date', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('date', 'asc')
    )
    return onSnapshot(
      healthQuery,
      (snapshot) => {
        setState({
          days: snapshot.docs.map((document) =>
            decodeHealthDaily(document.data() as Record<string, unknown>)
          ),
          loading: false,
          error: null,
        })
      },
      (error) => setState({ days: [], loading: false, error: error.message })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}

function decodeHealthDaily(raw: Record<string, unknown>): HealthDaily {
  return {
    date: toDateOrNow(raw.date),
    activeCalories: n(raw.activeCalories),
    basalCalories: n(raw.basalCalories),
    steps: Math.round(n(raw.steps)),
    exerciseMinutes: Math.round(n(raw.exerciseMinutes)),
    standHours: Math.round(n(raw.standHours)),
    sleepHours: n(raw.sleepHours),
    distanceMilesWalkingRunning: n(raw.distanceMilesWalkingRunning),
    distanceMilesCycling: n(raw.distanceMilesCycling),
    flightsClimbed: Math.round(n(raw.flightsClimbed)),
    uvExposure: n(raw.uvExposure),
    dietaryWaterMl: n(raw.dietaryWaterMl),
    lastSyncedAt: toDate(raw.lastSyncedAt) ?? null,
  }
}
