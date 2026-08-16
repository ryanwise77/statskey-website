import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'

const functions = getFunctions(firebaseApp, 'us-central1')

export type RecordIndexSearchMode = 'auto' | 'lexical' | 'semantic'

export interface RecordIndexSearchOptions {
  limit?: number
  mode?: RecordIndexSearchMode
  filters?: Record<string, unknown>
}

const manifestCall = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
  functions,
  'getStatsKeyIndexManifest'
)
const searchCall = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
  functions,
  'searchStatsKeyIndexHybridV3'
)
const chunksCall = httpsCallable<
  { chunkIds: string[] },
  { chunks?: Array<Record<string, unknown>> }
>(functions, 'readStatsKeyChunks')
const refreshCall = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
  functions,
  'refreshStatsKeyIndexV3'
)

export async function getRecordIndexManifest(): Promise<Record<string, unknown>> {
  const { data } = await manifestCall({})
  return data
}

export async function searchRecordIndex(
  query: string,
  options: RecordIndexSearchOptions = {}
): Promise<Record<string, unknown>> {
  const { data } = await searchCall({
    query,
    limit: options.limit,
    mode: options.mode ?? 'auto',
    evidencePack: true,
    ...(options.filters ? { filters: options.filters } : {}),
  })
  return data
}

export async function readRecordIndexChunks(
  chunkIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const { data } = await chunksCall({ chunkIds: chunkIds.slice(0, 20) })
  return Array.isArray(data.chunks) ? data.chunks : []
}

export async function refreshRecordIndex(): Promise<Record<string, unknown>> {
  const { data } = await refreshCall({})
  return data
}
