import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from '../firebase'
import { decodeSavedReport } from '../decoders'
import type { ReportJobState, ReportJobStatus, SavedReport } from '../types'

export interface ReportsState {
  reports: SavedReport[]
  loading: boolean
  error: string | null
}

/** Live list of finished Deep Dive reports (users/{uid}/reports). */
export function useReports(uid: string | undefined): ReportsState {
  const [state, setState] = useState<ReportsState>({ reports: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ reports: [], loading: false, error: null })
      return
    }
    const q = query(collection(db, 'users', uid, 'reports'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const reports = snap.docs.map((d) => decodeSavedReport(d.data() as Record<string, unknown>, d.id))
        setState({ reports, loading: false, error: null })
      },
      (err) => setState({ reports: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}

/** Live status of a queued report job (users/{uid}/reportJobs/{jobId}). */
export function useReportJob(uid: string | undefined, jobId: string | undefined): ReportJobState | null {
  const [state, setState] = useState<ReportJobState | null>(null)

  useEffect(() => {
    if (!uid || !jobId) {
      setState(null)
      return
    }
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'reportJobs', jobId),
      (snap) => {
        if (!snap.exists()) {
          setState(null)
          return
        }
        const data = snap.data() as Record<string, unknown>
        const status = (typeof data.status === 'string' ? data.status : 'queued') as ReportJobStatus
        setState({
          status,
          error: typeof data.error === 'string' ? data.error : undefined,
        })
      },
      () => setState(null)
    )
    return () => unsub()
  }, [uid, jobId])

  return state
}
