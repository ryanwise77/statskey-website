/// <reference lib="webworker" />

import { buildCadDocumentGeometry } from './geometry'
import type { CadBuildResult, CadDocument } from './types'

export interface CadWorkerBuildRequest {
  type: 'build'
  requestId: number
  document: CadDocument
}

export interface CadWorkerBuildResponse {
  type: 'build-result'
  protocolVersion: 2
  requestId: number
  result: CadBuildResult
}

const worker = self as DedicatedWorkerGlobalScope

worker.addEventListener(
  'message',
  async (event: MessageEvent<CadWorkerBuildRequest>) => {
    if (event.data.type !== 'build') return
    const { requestId, document } = event.data
    try {
      const result = await buildCadDocumentGeometry(document)
      const response: CadWorkerBuildResponse = {
        type: 'build-result',
        protocolVersion: 2,
        requestId,
        result,
      }
      const transfers: Transferable[] = []
      if (result.mesh) {
        transfers.push(result.mesh.positions.buffer, result.mesh.indices.buffer)
      }
      worker.postMessage(response, transfers)
    } catch (error) {
      const response: CadWorkerBuildResponse = {
        type: 'build-result',
        protocolVersion: 2,
        requestId,
        result: {
          ok: false,
          documentRevision: document.revision,
          statuses: [],
          errors: [
            error instanceof Error
              ? error.message
              : 'The solid worker could not rebuild the model.',
          ],
        },
      }
      worker.postMessage(response)
    }
  }
)

export {}
