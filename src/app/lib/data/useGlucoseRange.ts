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
import { decodeGlucose } from '../decoders'
import { endOfDay, startOfDay } from '../firestore'
import type { GlucoseReading } from '../types'

export interface GlucoseRangeState {
  readings: GlucoseReading[]
  loading: boolean
  error: string | null
}

/** Live glucose readings in [start, end], oldest first (for charting). */
export function useGlucoseRange(uid: string | undefined, start: Date, end: Date): GlucoseRangeState {
  const [state, setState] = useState<GlucoseRangeState>({ readings: [], loading: true, error: null })
  const key = `${start.toDateString()}|${end.toDateString()}`

  useEffect(() => {
    if (!uid) {
      setState({ readings: [], loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    const q = query(
      collection(db, 'users', uid, 'glucoseReadings'),
      where('timestamp', '>=', Timestamp.fromDate(startOfDay(start))),
      where('timestamp', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('timestamp', 'asc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const readings = snap.docs.map((d) => decodeGlucose(d.data() as Record<string, unknown>, d.id))
        setState({ readings, loading: false, error: null })
      },
      (err) => setState({ readings: [], loading: false, error: err.message })
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}

export interface GlucoseDayStats {
  count: number
  average: number
  min: number
  max: number
  timeInRangePercent: number // 70–180 mg/dL
}

export function glucoseStats(readings: GlucoseReading[]): GlucoseDayStats | null {
  if (readings.length === 0) return null
  let sum = 0
  let min = Infinity
  let max = -Infinity
  let inRange = 0
  for (const r of readings) {
    sum += r.value
    if (r.value < min) min = r.value
    if (r.value > max) max = r.value
    if (r.value >= 70 && r.value <= 180) inRange += 1
  }
  return {
    count: readings.length,
    average: sum / readings.length,
    min,
    max,
    timeInRangePercent: (inRange / readings.length) * 100,
  }
}
