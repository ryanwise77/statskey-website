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
import { endOfDay, localDateString, startOfDay, toDateOrNow } from '../firestore'

export type VitalKind =
  | 'restingHeartRate'
  | 'heartRateVariabilitySDNN'
  | 'walkingHeartRateAverage'
  | 'respiratoryRate'
  | 'oxygenSaturationPercent'
  | 'vo2Max'
  | 'heartRate'

export interface VitalSample {
  id: string
  kind: VitalKind
  value: number
  date: Date
  source?: string
  hkUUID?: string
}

export interface VitalsRangeState {
  samples: VitalSample[]
  loading: boolean
  error: string | null
}

export function useVitalsRange(
  uid: string | undefined,
  start: Date,
  end: Date
): VitalsRangeState {
  const [state, setState] = useState<VitalsRangeState>({
    samples: [],
    loading: true,
    error: null,
  })
  const key = `${localDateString(start)}|${localDateString(end)}`

  useEffect(() => {
    if (!uid) {
      setState({ samples: [], loading: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    const vitalsQuery = query(
      collection(db, 'users', uid, 'vitals'),
      where('date', '>=', Timestamp.fromDate(startOfDay(start))),
      where('date', '<=', Timestamp.fromDate(endOfDay(end))),
      orderBy('date', 'asc')
    )
    return onSnapshot(
      vitalsQuery,
      (snapshot) => {
        const samples: VitalSample[] = []
        for (const document of snapshot.docs) {
          const raw = document.data() as Record<string, unknown>
          const kind = raw.kind
          const value = raw.value
          if (!isVitalKind(kind) || typeof value !== 'number' || value <= 0) {
            continue
          }
          samples.push({
            id: document.id,
            kind,
            value,
            date: toDateOrNow(raw.date),
            source: typeof raw.source === 'string' ? raw.source : undefined,
            hkUUID: typeof raw.hkUUID === 'string' ? raw.hkUUID : undefined,
          })
        }
        setState({ samples, loading: false, error: null })
      },
      (error) =>
        setState({ samples: [], loading: false, error: error.message })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key])

  return state
}

function isVitalKind(value: unknown): value is VitalKind {
  return [
    'restingHeartRate',
    'heartRateVariabilitySDNN',
    'walkingHeartRateAverage',
    'respiratoryRate',
    'oxygenSaturationPercent',
    'vo2Max',
    'heartRate',
  ].includes(String(value))
}
