import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { endOfDay, startOfDay, toDate } from '../firestore'

export type SleepStage =
  | 'inBed'
  | 'asleepUnspecified'
  | 'asleepCore'
  | 'asleepDeep'
  | 'asleepREM'
  | 'awake'

export interface SleepSession {
  id: string
  stage: SleepStage
  startDate: Date
  endDate: Date
  source: string | null
}

export interface SleepDay {
  date: Date
  hours: number
  stageHours: Partial<Record<SleepStage, number>>
}

interface SleepRangeState {
  sessions: SleepSession[]
  days: SleepDay[]
  loading: boolean
  error: string | null
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1_000

export function useSleepSessionsRange(
  uid: string | undefined,
  start: Date,
  end: Date
): SleepRangeState {
  const [state, setState] = useState<SleepRangeState>({
    sessions: [],
    days: [],
    loading: true,
    error: null,
  })
  const startKey = startOfDay(start).getTime()
  const endKey = endOfDay(end).getTime()

  useEffect(() => {
    if (!uid) {
      setState({ sessions: [], days: [], loading: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    const queryStart = new Date(startKey - 24 * 60 * 60 * 1_000)
    const sleepQuery = query(
      collection(db, 'users', uid, 'sleepSessions'),
      where('startDate', '>=', Timestamp.fromDate(queryStart)),
      where('startDate', '<=', Timestamp.fromMillis(endKey)),
      orderBy('startDate', 'asc')
    )
    return onSnapshot(
      sleepQuery,
      (snapshot) => {
        const sessions = snapshot.docs
          .map((document) =>
            decodeSleepSession(
              document.data() as Record<string, unknown>,
              document.id
            )
          )
          .filter(
            (session): session is SleepSession =>
              session != null &&
              session.endDate.getTime() >= startKey &&
              session.startDate.getTime() <= endKey
          )
        setState({
          sessions,
          days: rollupSleepSessions(
            sessions,
            new Date(startKey),
            new Date(endKey)
          ),
          loading: false,
          error: null,
        })
      },
      (error) =>
        setState({ sessions: [], days: [], loading: false, error: error.message })
    )
  }, [endKey, startKey, uid])

  return state
}

export function rollupSleepSessions(
  sessions: SleepSession[],
  requestedStart: Date,
  requestedEnd: Date
): SleepDay[] {
  const intervals = sessions
    .filter((session) => session.endDate > session.startDate)
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
  const episodes: SleepSession[][] = []
  let current: SleepSession[] = []
  let currentEnd = Number.NEGATIVE_INFINITY
  for (const interval of intervals) {
    if (
      current.length === 0 ||
      interval.startDate.getTime() - currentEnd <= TWO_HOURS_MS
    ) {
      current.push(interval)
      currentEnd = Math.max(currentEnd, interval.endDate.getTime())
    } else {
      episodes.push(current)
      current = [interval]
      currentEnd = interval.endDate.getTime()
    }
  }
  if (current.length > 0) episodes.push(current)

  const byDay = new Map<string, SleepDay>()
  for (const episode of episodes) {
    const episodeEnd = Math.max(
      ...episode.map((session) => session.endDate.getTime())
    )
    const wakeDay = startOfDay(new Date(episodeEnd))
    if (
      wakeDay < startOfDay(requestedStart) ||
      wakeDay > startOfDay(requestedEnd)
    ) {
      continue
    }
    const asleep = episode.filter((session) => isAsleepStage(session.stage))
    const hours = mergedDurationHours(asleep)
    if (hours < 0.5) continue
    const key = localDayKey(wakeDay)
    const day = byDay.get(key) ?? {
      date: wakeDay,
      hours: 0,
      stageHours: {},
    }
    day.hours += hours
    for (const stage of [
      'asleepUnspecified',
      'asleepCore',
      'asleepDeep',
      'asleepREM',
    ] as SleepStage[]) {
      const stageHours = mergedDurationHours(
        asleep.filter((session) => session.stage === stage)
      )
      if (stageHours > 0) {
        day.stageHours[stage] = (day.stageHours[stage] ?? 0) + stageHours
      }
    }
    byDay.set(key, day)
  }
  return [...byDay.values()]
    .map((day) => ({ ...day, hours: Math.min(14, day.hours) }))
    .sort((left, right) => left.date.getTime() - right.date.getTime())
}

function decodeSleepSession(
  raw: Record<string, unknown>,
  id: string
): SleepSession | null {
  const startDate = toDate(raw.startDate)
  const endDate = toDate(raw.endDate)
  if (!startDate || !endDate || endDate <= startDate) return null
  const stage = decodeSleepStage(raw.stage)
  return {
    id: typeof raw.id === 'string' ? raw.id : id,
    stage,
    startDate,
    endDate,
    source: typeof raw.source === 'string' ? raw.source : null,
  }
}

function decodeSleepStage(value: unknown): SleepStage {
  return value === 'inBed' ||
    value === 'asleepUnspecified' ||
    value === 'asleepCore' ||
    value === 'asleepDeep' ||
    value === 'asleepREM' ||
    value === 'awake'
    ? value
    : 'asleepUnspecified'
}

function isAsleepStage(stage: SleepStage): boolean {
  return (
    stage === 'asleepUnspecified' ||
    stage === 'asleepCore' ||
    stage === 'asleepDeep' ||
    stage === 'asleepREM'
  )
}

function mergedDurationHours(sessions: SleepSession[]): number {
  const intervals = sessions
    .map((session) => ({
      start: session.startDate.getTime(),
      end: session.endDate.getTime(),
    }))
    .sort((left, right) => left.start - right.start)
  let total = 0
  let currentStart: number | null = null
  let currentEnd: number | null = null
  for (const interval of intervals) {
    if (currentStart == null || currentEnd == null) {
      currentStart = interval.start
      currentEnd = interval.end
    } else if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end)
    } else {
      total += currentEnd - currentStart
      currentStart = interval.start
      currentEnd = interval.end
    }
  }
  if (currentStart != null && currentEnd != null) {
    total += currentEnd - currentStart
  }
  return total / 3_600_000
}

function localDayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
