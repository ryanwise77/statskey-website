import { useEffect, useRef, useState } from 'react'
import type {
  CadWorkerBuildRequest,
  CadWorkerBuildResponse,
} from './cad.worker'
import { buildCadDocumentGeometry } from './geometry'
import type { CadBuildResult, CadDocument } from './types'

export interface CadBuildState {
  loading: boolean
  result: CadBuildResult | null
}

const CAD_WORKER_TIMEOUT_MS = 30_000

async function buildCadDocumentSafely(
  document: CadDocument
): Promise<CadBuildResult> {
  try {
    return await buildCadDocumentGeometry(document)
  } catch (error) {
    return {
      ok: false,
      documentRevision: document.revision,
      statuses: [],
      errors: [
        error instanceof Error
          ? error.message
          : 'The solid kernel could not rebuild the model.',
      ],
    }
  }
}

export function useCadBuild(document: CadDocument): CadBuildState {
  const [state, setState] = useState<CadBuildState>({
    loading: true,
    result: null,
  })
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const documentRef = useRef(document)
  const timeoutRef = useRef<number | null>(null)
  documentRef.current = document

  useEffect(() => {
    if (typeof Worker === 'undefined') return
    let worker: Worker
    try {
      worker = new Worker(new URL('./cad.worker.ts', import.meta.url), {
        type: 'module',
        name: 'statskey-cad-kernel',
      })
    } catch {
      workerRef.current = null
      return
    }
    workerRef.current = worker
    const clearBuildTimeout = () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
    const fallbackFromWorkerFailure = () => {
      if (workerRef.current !== worker) return
      clearBuildTimeout()
      worker.terminate()
      workerRef.current = null
      const requestId = requestIdRef.current
      const latestDocument = documentRef.current
      void buildCadDocumentSafely(latestDocument).then((result) => {
        if (requestId === requestIdRef.current) {
          setState({ loading: false, result })
        }
      })
    }
    worker.addEventListener(
      'message',
      (event: MessageEvent<CadWorkerBuildResponse>) => {
        if (
          event.data.type !== 'build-result' ||
          event.data.requestId !== requestIdRef.current
        ) {
          return
        }
        clearBuildTimeout()
        setState({ loading: false, result: event.data.result })
      }
    )
    worker.addEventListener('error', fallbackFromWorkerFailure)
    worker.addEventListener('messageerror', fallbackFromWorkerFailure)
    return () => {
      clearBuildTimeout()
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setState((current) => ({ ...current, loading: true }))
    const worker = workerRef.current
    if (worker) {
      const request: CadWorkerBuildRequest = {
        type: 'build',
        requestId,
        document,
      }
      worker.postMessage(request)
      timeoutRef.current = window.setTimeout(() => {
        if (requestId !== requestIdRef.current) return
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        void buildCadDocumentSafely(document).then((result) => {
          if (requestId === requestIdRef.current) {
            setState({ loading: false, result })
          }
        })
      }, CAD_WORKER_TIMEOUT_MS)
      return () => {
        if (timeoutRef.current != null) {
          window.clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
      }
    }
    let cancelled = false
    void buildCadDocumentSafely(document).then((result) => {
      if (!cancelled && requestId === requestIdRef.current) {
        setState({ loading: false, result })
      }
    })
    return () => {
      cancelled = true
    }
  }, [document])

  return state
}
