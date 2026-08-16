import {
  CAD_SESSION_SCHEMA_VERSION,
  type CadDocument,
  type CadId,
  type CadSessionState,
  type CadTransaction,
} from './types'
import {
  applyCadTransaction,
  createCadDocument,
  decodeCadDocument,
  validateCadDocument,
} from './document'
import { durableRendererStorage } from '../durableRendererStorage'

const CAD_SESSION_KEY = 'statskey.cad.session.v1'
const CAD_RECOVERY_DOCUMENT_KEY = 'statskey.cad.recoveryDocument.v1'
const MAX_UNDO_SNAPSHOTS = 48

export interface CadPersistenceResult {
  fullHistorySaved: boolean
  warning?: string
}

export function createCadSession(
  document: CadDocument = createCadDocument()
): CadSessionState {
  return {
    schemaVersion: CAD_SESSION_SCHEMA_VERSION,
    present: document,
    past: [],
    future: [],
    selectedFeatureId: document.features.at(-1)?.id ?? null,
  }
}

function cloneDocument(document: CadDocument): CadDocument {
  return typeof structuredClone === 'function'
    ? structuredClone(document)
    : (JSON.parse(JSON.stringify(document)) as CadDocument)
}

function decodeSession(value: unknown): CadSessionState {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid CAD session')
  }
  const candidate = parsed as Partial<CadSessionState>
  if (
    candidate.schemaVersion !== CAD_SESSION_SCHEMA_VERSION ||
    !candidate.present ||
    !Array.isArray(candidate.past) ||
    !Array.isArray(candidate.future)
  ) {
    throw new Error('Unsupported CAD session')
  }
  const present = decodeCadDocument(candidate.present)
  const past = candidate.past
    .slice(-MAX_UNDO_SNAPSHOTS)
    .map((document) => decodeCadDocument(document))
  const future = candidate.future
    .slice(0, MAX_UNDO_SNAPSHOTS)
    .map((document) => decodeCadDocument(document))
  return {
    schemaVersion: CAD_SESSION_SCHEMA_VERSION,
    present,
    past,
    future,
    selectedFeatureId:
      typeof candidate.selectedFeatureId === 'string'
        ? candidate.selectedFeatureId
        : null,
  }
}

export function loadCadSession(
  storage: Storage = durableRendererStorage
): CadSessionState {
  let session: CadSessionState | null = null
  try {
    const saved = storage.getItem(CAD_SESSION_KEY)
    if (saved) session = decodeSession(saved)
  } catch {
    session = null
  }

  try {
    const recovery = storage.getItem(CAD_RECOVERY_DOCUMENT_KEY)
    if (recovery) {
      const recoveredDocument = decodeCadDocument(recovery)
      if (
        !session ||
        recoveredDocument.updatedAt > session.present.updatedAt ||
        (recoveredDocument.updatedAt === session.present.updatedAt &&
          recoveredDocument.revision > session.present.revision)
      ) {
        return createCadSession(recoveredDocument)
      }
    }
  } catch {
    // A damaged recovery shadow must not hide a valid full session.
  }

  return session ?? createCadSession()
}

export function saveCadSession(
  session: CadSessionState,
  storage: Storage = durableRendererStorage
): CadPersistenceResult {
  validateCadDocument(session.present)
  storage.setItem(
    CAD_RECOVERY_DOCUMENT_KEY,
    JSON.stringify(session.present)
  )
  try {
    storage.setItem(CAD_SESSION_KEY, JSON.stringify(session))
    return { fullHistorySaved: true }
  } catch {
    const compact: CadSessionState = {
      ...session,
      past: [],
      future: [],
    }
    try {
      storage.setItem(CAD_SESSION_KEY, JSON.stringify(compact))
    } catch {
      // The current document is already durable in the recovery shadow.
    }
    return {
      fullHistorySaved: false,
      warning:
        'The model is saved, but browser storage is full, so older undo snapshots could not be retained.',
    }
  }
}

export function executeCadTransaction(
  session: CadSessionState,
  transaction: CadTransaction
): CadSessionState {
  const nextDocument = applyCadTransaction(session.present, transaction)
  const selectedFeatureId =
    [...transaction.commands]
      .reverse()
      .find((command) => command.type === 'feature.create')?.feature.id ??
    session.selectedFeatureId
  return {
    ...session,
    present: nextDocument,
    past: [...session.past, cloneDocument(session.present)].slice(
      -MAX_UNDO_SNAPSHOTS
    ),
    future: [],
    selectedFeatureId,
  }
}

export function undoCadSession(session: CadSessionState): CadSessionState {
  const prior = session.past.at(-1)
  if (!prior) return session
  return {
    ...session,
    present: cloneDocument(prior),
    past: session.past.slice(0, -1),
    future: [cloneDocument(session.present), ...session.future].slice(
      0,
      MAX_UNDO_SNAPSHOTS
    ),
    selectedFeatureId:
      prior.features.find(
        (feature) => feature.id === session.selectedFeatureId
      )?.id ??
      prior.features.at(-1)?.id ??
      null,
  }
}

export function redoCadSession(session: CadSessionState): CadSessionState {
  const next = session.future[0]
  if (!next) return session
  return {
    ...session,
    present: cloneDocument(next),
    past: [...session.past, cloneDocument(session.present)].slice(
      -MAX_UNDO_SNAPSHOTS
    ),
    future: session.future.slice(1),
    selectedFeatureId:
      next.features.find(
        (feature) => feature.id === session.selectedFeatureId
      )?.id ??
      next.features.at(-1)?.id ??
      null,
  }
}

export function replaceCadDocument(
  session: CadSessionState,
  document: CadDocument
): CadSessionState {
  validateCadDocument(document)
  return {
    schemaVersion: CAD_SESSION_SCHEMA_VERSION,
    present: cloneDocument(document),
    past: [...session.past, cloneDocument(session.present)].slice(
      -MAX_UNDO_SNAPSHOTS
    ),
    future: [],
    selectedFeatureId: document.features.at(-1)?.id ?? null,
  }
}

export function selectCadFeature(
  session: CadSessionState,
  featureId: CadId | null
): CadSessionState {
  return {
    ...session,
    selectedFeatureId:
      featureId == null ||
      session.present.features.some((feature) => feature.id === featureId)
        ? featureId
        : session.selectedFeatureId,
  }
}
