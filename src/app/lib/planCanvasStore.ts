export interface PlanCanvasRecord {
  schemaVersion: 1
  id: string
  sessionId: string
  title: string
  /** Current editable source. It may be newer than `committedSource`. */
  source: string
  /** True when an over-limit source was clipped and requires explicit review. */
  sourceTruncated?: boolean
  /** Source captured by the latest immutable revision. */
  revisionSource: string
  scope: 'personal' | 'work'
  workspaceKey?: string
  workspaceLabel?: string
  workspaceRoots?: string[]
  savedPath?: string
  savedFilePath?: string
  savedModifiedAt?: string
  savedSource?: string
  sourceMessageId?: string
  /** Latest immutable source revision. */
  revision: number
  /** Compare-and-swap version for every persisted head mutation. */
  recordVersion: number
  createdAt: string
  updatedAt: string
}

export interface PlanCanvasRevisionRecord {
  key: string
  canvasId: string
  revision: number
  title: string
  source: string
  sourceTruncated?: boolean
  scope: 'personal' | 'work'
  workspaceKey?: string
  workspaceLabel?: string
  workspaceRoots?: string[]
  sourceMessageId?: string
  createdAt: string
}

interface PlanCanvasHeadRecord {
  id: string
  canvas?: PlanCanvasRecord
  recordVersion: number
  deletedAt?: string
}

export type PlanCanvasStoreResult =
  | { ok: true; canvas: PlanCanvasRecord }
  | {
      ok: false
      reason: 'conflict' | 'deleted' | 'missing' | 'limit' | 'storage'
      current?: PlanCanvasRecord
      error?: string
    }

export type PlanCanvasRemoveResult =
  | { ok: true; recordVersion: number }
  | {
      ok: false
      reason: 'conflict' | 'missing' | 'storage'
      current?: PlanCanvasRecord
      error?: string
    }

export interface PlanCanvasStore {
  list(): Promise<PlanCanvasRecord[]>
  listDeletedIds(): Promise<string[]>
  get(id: string): Promise<PlanCanvasRecord | null>
  getRevision(id: string, revision: number): Promise<PlanCanvasRevisionRecord | null>
  save(
    candidate: PlanCanvasRecord,
    expectedRecordVersion: number
  ): Promise<PlanCanvasStoreResult>
  commitDraft(
    id: string,
    expectedRecordVersion: number
  ): Promise<PlanCanvasStoreResult>
  remove(
    id: string,
    expectedRecordVersion: number
  ): Promise<PlanCanvasRemoveResult>
}

const DATABASE_NAME = 'statskey-plan-canvases'
const DATABASE_VERSION = 1
const HEAD_STORE = 'plan-canvases'
const REVISION_STORE = 'plan-canvas-revisions'

export const MAX_ACTIVE_PLAN_CANVASES = 80
export const MAX_PLAN_CANVAS_HEADS = 500
export const MAX_PLAN_CANVAS_REVISIONS = 50

let databasePromise: Promise<IDBDatabase> | null = null

export function createIndexedDbPlanCanvasStore(): PlanCanvasStore | null {
  if (typeof indexedDB === 'undefined') return null
  return {
    async list() {
      const database = await openDatabase()
      const values = await requestResult<PlanCanvasHeadRecord[]>(
        database.transaction(HEAD_STORE, 'readonly').objectStore(HEAD_STORE).getAll()
      )
      return values
        .filter((value) => !value.deletedAt && value.canvas)
        .map((value) => clone(value.canvas as PlanCanvasRecord))
    },
    async listDeletedIds() {
      const database = await openDatabase()
      const values = await requestResult<PlanCanvasHeadRecord[]>(
        database.transaction(HEAD_STORE, 'readonly').objectStore(HEAD_STORE).getAll()
      )
      return values.filter((value) => value.deletedAt).map((value) => value.id)
    },
    async get(id) {
      const database = await openDatabase()
      const head = await requestResult<PlanCanvasHeadRecord | undefined>(
        database.transaction(HEAD_STORE, 'readonly').objectStore(HEAD_STORE).get(id)
      )
      return head?.canvas && !head.deletedAt ? clone(head.canvas) : null
    },
    async getRevision(id, revision) {
      const database = await openDatabase()
      const value = await requestResult<PlanCanvasRevisionRecord | undefined>(
        database
          .transaction(REVISION_STORE, 'readonly')
          .objectStore(REVISION_STORE)
          .get(revisionKey(id, revision))
      )
      return value ? clone(value) : null
    },
    async save(candidate, expectedRecordVersion) {
      try {
        const database = await openDatabase()
        const transaction = database.transaction(
          [HEAD_STORE, REVISION_STORE],
          'readwrite'
        )
        const heads = transaction.objectStore(HEAD_STORE)
        const revisions = transaction.objectStore(REVISION_STORE)
        const existing = await requestResult<PlanCanvasHeadRecord | undefined>(
          heads.get(candidate.id)
        )
        if (!existing) {
          const allHeads = await requestResult<PlanCanvasHeadRecord[]>(heads.getAll())
          if (allHeads.length >= MAX_PLAN_CANVAS_HEADS) {
            transaction.abort()
            return canvasLimitFailure(
              'Planning canvas storage has reached its record limit. Export anything you need before clearing saved canvas data.'
            )
          }
          const activeCount = allHeads.filter(
            (head) => !head.deletedAt && head.canvas
          ).length
          if (activeCount >= MAX_ACTIVE_PLAN_CANVASES) {
            transaction.abort()
            return canvasLimitFailure(
              `You can keep up to ${MAX_ACTIVE_PLAN_CANVASES} active planning canvases. Remove one before creating another.`
            )
          }
        }
        const decision = decideSave(existing, candidate, expectedRecordVersion)
        if (!decision.ok) {
          transaction.abort()
          return decision
        }
        heads.put(decision.head)
        if (decision.revision) {
          const prior = await requestResult<PlanCanvasRevisionRecord | undefined>(
            revisions.get(decision.revision.key)
          )
          if (prior && !sameRevision(prior, decision.revision)) {
            transaction.abort()
            return {
              ok: false,
              reason: 'conflict',
              current: existing?.canvas ? clone(existing.canvas) : undefined,
            }
          }
          if (!prior) revisions.put(decision.revision)
        }
        await transactionComplete(transaction)
        return { ok: true, canvas: clone(decision.head.canvas as PlanCanvasRecord) }
      } catch (error) {
        return storageFailure(error)
      }
    },
    async commitDraft(id, expectedRecordVersion) {
      try {
        const database = await openDatabase()
        const transaction = database.transaction(
          [HEAD_STORE, REVISION_STORE],
          'readwrite'
        )
        const heads = transaction.objectStore(HEAD_STORE)
        const revisions = transaction.objectStore(REVISION_STORE)
        const existing = await requestResult<PlanCanvasHeadRecord | undefined>(
          heads.get(id)
        )
        const decision = decideCommit(existing, expectedRecordVersion)
        if (!decision.ok) {
          transaction.abort()
          return decision
        }
        heads.put(decision.head)
        if (decision.revision) {
          const prior = await requestResult<PlanCanvasRevisionRecord | undefined>(
            revisions.get(decision.revision.key)
          )
          if (prior && !sameRevision(prior, decision.revision)) {
            transaction.abort()
            return {
              ok: false,
              reason: 'conflict',
              current: existing?.canvas ? clone(existing.canvas) : undefined,
            }
          }
          if (!prior) revisions.put(decision.revision)
        }
        await transactionComplete(transaction)
        return { ok: true, canvas: clone(decision.head.canvas as PlanCanvasRecord) }
      } catch (error) {
        return storageFailure(error)
      }
    },
    async remove(id, expectedRecordVersion) {
      try {
        const database = await openDatabase()
        const transaction = database.transaction(
          [HEAD_STORE, REVISION_STORE],
          'readwrite'
        )
        const store = transaction.objectStore(HEAD_STORE)
        const revisions = transaction.objectStore(REVISION_STORE)
        const existing = await requestResult<PlanCanvasHeadRecord | undefined>(
          store.get(id)
        )
        const decision = decideRemove(existing, expectedRecordVersion)
        if (!decision.ok) {
          transaction.abort()
          return decision
        }
        store.put(decision.head)
        const revisionKeys = await requestResult<IDBValidKey[]>(
          revisions.index('canvasId').getAllKeys(IDBKeyRange.only(id))
        )
        for (const key of revisionKeys) revisions.delete(key)
        await transactionComplete(transaction)
        return { ok: true, recordVersion: decision.head.recordVersion }
      } catch (error) {
        return {
          ok: false,
          reason: 'storage',
          error: safeError(error),
        }
      }
    },
  }
}

/** Deterministic transactional store used by focused concurrency tests. */
export function createMemoryPlanCanvasStore(): PlanCanvasStore {
  const heads = new Map<string, PlanCanvasHeadRecord>()
  const revisions = new Map<string, PlanCanvasRevisionRecord>()
  let chain = Promise.resolve()

  function serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = chain.then(operation, operation)
    chain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  return {
    list: () =>
      serialize(() =>
        [...heads.values()]
          .filter((value) => !value.deletedAt && value.canvas)
          .map((value) => clone(value.canvas as PlanCanvasRecord))
      ),
    listDeletedIds: () =>
      serialize(() =>
        [...heads.values()]
          .filter((value) => value.deletedAt)
          .map((value) => value.id)
      ),
    get: (id) =>
      serialize(() => {
        const head = heads.get(id)
        return head?.canvas && !head.deletedAt ? clone(head.canvas) : null
      }),
    getRevision: (id, revision) =>
      serialize(() => {
        const value = revisions.get(revisionKey(id, revision))
        return value ? clone(value) : null
      }),
    save: (candidate, expectedRecordVersion) =>
      serialize(() => {
        if (
          !heads.has(candidate.id) &&
          heads.size >= MAX_PLAN_CANVAS_HEADS
        ) {
          return canvasLimitFailure(
            'Planning canvas storage has reached its record limit. Export anything you need before clearing saved canvas data.'
          )
        }
        if (
          !heads.has(candidate.id) &&
          [...heads.values()].filter((head) => !head.deletedAt && head.canvas)
            .length >= MAX_ACTIVE_PLAN_CANVASES
        ) {
          return canvasLimitFailure(
            `You can keep up to ${MAX_ACTIVE_PLAN_CANVASES} active planning canvases. Remove one before creating another.`
          )
        }
        const decision = decideSave(
          heads.get(candidate.id),
          candidate,
          expectedRecordVersion
        )
        if (!decision.ok) return decision
        const existingRevision = decision.revision
          ? revisions.get(decision.revision.key)
          : undefined
        if (
          existingRevision &&
          decision.revision &&
          !sameRevision(existingRevision, decision.revision)
        ) {
          return {
            ok: false as const,
            reason: 'conflict' as const,
            current: heads.get(candidate.id)?.canvas
              ? clone(heads.get(candidate.id)?.canvas as PlanCanvasRecord)
              : undefined,
          }
        }
        heads.set(candidate.id, clone(decision.head))
        if (decision.revision && !existingRevision) {
          revisions.set(decision.revision.key, clone(decision.revision))
        }
        return {
          ok: true as const,
          canvas: clone(decision.head.canvas as PlanCanvasRecord),
        }
      }),
    commitDraft: (id, expectedRecordVersion) =>
      serialize(() => {
        const decision = decideCommit(heads.get(id), expectedRecordVersion)
        if (!decision.ok) return decision
        const existingRevision = decision.revision
          ? revisions.get(decision.revision.key)
          : undefined
        if (
          existingRevision &&
          decision.revision &&
          !sameRevision(existingRevision, decision.revision)
        ) {
          return {
            ok: false as const,
            reason: 'conflict' as const,
            current: heads.get(id)?.canvas
              ? clone(heads.get(id)?.canvas as PlanCanvasRecord)
              : undefined,
          }
        }
        heads.set(id, clone(decision.head))
        if (decision.revision && !existingRevision) {
          revisions.set(decision.revision.key, clone(decision.revision))
        }
        return {
          ok: true as const,
          canvas: clone(decision.head.canvas as PlanCanvasRecord),
        }
      }),
    remove: (id, expectedRecordVersion) =>
      serialize(() => {
        const decision = decideRemove(heads.get(id), expectedRecordVersion)
        if (!decision.ok) return decision
        heads.set(id, clone(decision.head))
        for (const [key, revision] of revisions) {
          if (revision.canvasId === id) revisions.delete(key)
        }
        return {
          ok: true as const,
          recordVersion: decision.head.recordVersion,
        }
      }),
  }
}

function decideSave(
  existing: PlanCanvasHeadRecord | undefined,
  candidate: PlanCanvasRecord,
  expectedRecordVersion: number
):
  | {
      ok: true
      head: PlanCanvasHeadRecord
      revision?: PlanCanvasRevisionRecord
    }
  | Exclude<PlanCanvasStoreResult, { ok: true }> {
  if (existing?.deletedAt) {
    return { ok: false, reason: 'deleted' }
  }
  if (candidate.revision > MAX_PLAN_CANVAS_REVISIONS) {
    return canvasLimitFailure(
      `A planning canvas can keep up to ${MAX_PLAN_CANVAS_REVISIONS} committed revisions. Start a new canvas to continue.`
    )
  }
  const currentVersion = existing?.recordVersion ?? 0
  if (currentVersion !== expectedRecordVersion) {
    return {
      ok: false,
      reason: 'conflict',
      current: existing?.canvas ? clone(existing.canvas) : undefined,
    }
  }
  const currentRevision = existing?.canvas?.revision ?? 0
  if (
    candidate.revision !== currentRevision &&
    candidate.revision !== currentRevision + 1
  ) {
    return {
      ok: false,
      reason: 'conflict',
      current: existing?.canvas ? clone(existing.canvas) : undefined,
    }
  }
  if (!existing && candidate.revision !== 1) {
    return { ok: false, reason: 'conflict' }
  }
  if (
    existing?.canvas &&
    !sameCanvasIdentity(existing.canvas, candidate)
  ) {
    return {
      ok: false,
      reason: 'conflict',
      current: clone(existing.canvas),
    }
  }
  const committed = candidate.revision === currentRevision + 1
  const canvas: PlanCanvasRecord = {
    ...clone(candidate),
    revisionSource: committed
      ? candidate.source
      : existing?.canvas?.revisionSource ?? candidate.revisionSource,
    recordVersion: currentVersion + 1,
  }
  const revision = committed ? revisionFor(canvas) : undefined
  return {
    ok: true,
    head: { id: canvas.id, canvas, recordVersion: canvas.recordVersion },
    revision,
  }
}

function decideCommit(
  existing: PlanCanvasHeadRecord | undefined,
  expectedRecordVersion: number
):
  | {
      ok: true
      head: PlanCanvasHeadRecord
      revision?: PlanCanvasRevisionRecord
    }
  | Exclude<PlanCanvasStoreResult, { ok: true }> {
  if (!existing) return { ok: false, reason: 'missing' }
  if (existing.deletedAt || !existing.canvas) {
    return { ok: false, reason: 'deleted' }
  }
  if (existing.recordVersion !== expectedRecordVersion) {
    return {
      ok: false,
      reason: 'conflict',
      current: clone(existing.canvas),
    }
  }
  if (existing.canvas.source === existing.canvas.revisionSource) {
    return { ok: true, head: clone(existing) }
  }
  if (existing.canvas.revision >= MAX_PLAN_CANVAS_REVISIONS) {
    return canvasLimitFailure(
      `A planning canvas can keep up to ${MAX_PLAN_CANVAS_REVISIONS} committed revisions. Start a new canvas to continue.`
    )
  }
  const canvas: PlanCanvasRecord = {
    ...clone(existing.canvas),
    revision: existing.canvas.revision + 1,
    recordVersion: existing.recordVersion + 1,
    revisionSource: existing.canvas.source,
    updatedAt: new Date().toISOString(),
  }
  return {
    ok: true,
    head: { id: canvas.id, canvas, recordVersion: canvas.recordVersion },
    revision: revisionFor(canvas),
  }
}

function decideRemove(
  existing: PlanCanvasHeadRecord | undefined,
  expectedRecordVersion: number
):
  | { ok: true; head: PlanCanvasHeadRecord }
  | Exclude<PlanCanvasRemoveResult, { ok: true }> {
  if (!existing || existing.deletedAt || !existing.canvas) {
    return { ok: false, reason: 'missing' }
  }
  if (existing.recordVersion !== expectedRecordVersion) {
    return {
      ok: false,
      reason: 'conflict',
      current: clone(existing.canvas),
    }
  }
  return {
    ok: true,
    head: {
      id: existing.id,
      recordVersion: existing.recordVersion + 1,
      deletedAt: new Date().toISOString(),
    },
  }
}

function revisionFor(canvas: PlanCanvasRecord): PlanCanvasRevisionRecord {
  return {
    key: revisionKey(canvas.id, canvas.revision),
    canvasId: canvas.id,
    revision: canvas.revision,
    title: canvas.title,
    source: canvas.revisionSource,
    sourceTruncated: canvas.sourceTruncated,
    scope: canvas.scope,
    workspaceKey: canvas.workspaceKey,
    workspaceLabel: canvas.workspaceLabel,
    workspaceRoots: canvas.workspaceRoots ? [...canvas.workspaceRoots] : undefined,
    sourceMessageId: canvas.sourceMessageId,
    createdAt: canvas.updatedAt,
  }
}

function revisionKey(id: string, revision: number): string {
  return `${id}\u001f${revision}`
}

function sameRevision(
  left: PlanCanvasRevisionRecord,
  right: PlanCanvasRevisionRecord
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameCanvasIdentity(
  left: PlanCanvasRecord,
  right: PlanCanvasRecord
): boolean {
  return (
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.scope === right.scope &&
    left.workspaceKey === right.workspaceKey &&
    left.createdAt === right.createdAt &&
    JSON.stringify(left.workspaceRoots ?? []) ===
      JSON.stringify(right.workspaceRoots ?? [])
  )
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(HEAD_STORE)) {
        const heads = database.createObjectStore(HEAD_STORE, { keyPath: 'id' })
        heads.createIndex('updatedAt', 'canvas.updatedAt')
        heads.createIndex('workspaceKey', 'canvas.workspaceKey')
        heads.createIndex('sessionId', 'canvas.sessionId')
      }
      if (!database.objectStoreNames.contains(REVISION_STORE)) {
        const revisions = database.createObjectStore(REVISION_STORE, {
          keyPath: 'key',
        })
        revisions.createIndex('canvasId', 'canvasId')
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        databasePromise = null
      }
      resolve(request.result)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error)
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('Planning canvas database is blocked.'))
    }
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function storageFailure(error: unknown): PlanCanvasStoreResult {
  return { ok: false, reason: 'storage', error: safeError(error) }
}

function canvasLimitFailure(
  error: string
): Exclude<PlanCanvasStoreResult, { ok: true }> {
  return { ok: false, reason: 'limit', error }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}
