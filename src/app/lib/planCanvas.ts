import type { WorkspaceProjectBinding } from './workspaceContext'
import {
  createIndexedDbPlanCanvasStore,
  createMemoryPlanCanvasStore,
  type PlanCanvasRecord,
  type PlanCanvasRevisionRecord,
  type PlanCanvasRemoveResult,
  type PlanCanvasStore,
  type PlanCanvasStoreResult,
} from './planCanvasStore'

export {
  createMemoryPlanCanvasStore,
  type PlanCanvasRecord,
  type PlanCanvasRevisionRecord,
  type PlanCanvasRemoveResult,
  type PlanCanvasStore,
  type PlanCanvasStoreResult,
} from './planCanvasStore'

export const PLAN_CANVAS_STORAGE_KEY = 'statskey.plan-canvases.v1'
export const PLAN_CANVAS_EVENT = 'statskey:plan-canvases'

const MAX_CANVASES = 80
const MAX_SOURCE_CHARACTERS = 300_000
const MAX_RENDER_BLOCKS = 240
const MAX_RENDER_LIST_ITEMS = 240
const MAX_RENDER_TASKS = 240
const MAX_RENDER_TABLE_COLUMNS = 16
const MAX_RENDER_TABLE_ROWS = 160
const MAX_RENDER_CELL_CHARACTERS = 1_000
const MAX_RENDER_CODE_CHARACTERS = 80_000
const MAX_RENDER_DIAGRAM_NODES = 40
const MAX_RENDER_DIAGRAM_EDGES = 80
const MAX_RENDER_TOTAL_ITEMS = 600
const MAX_RENDER_TOTAL_TABLE_CELLS = 2_000
const MAX_RENDER_TOTAL_DIAGRAM_NODES = 160
const MAX_RENDER_TOTAL_DIAGRAM_EDGES = 320

export const PLAN_CANVAS_PERSISTENCE_ERROR_EVENT =
  'statskey:plan-canvas-persistence-error'
export const PLAN_CANVAS_CONFLICT_EVENT = 'statskey:plan-canvas-conflict'

export interface PlanCanvasPersistenceState {
  status: 'idle' | 'pending' | 'saved' | 'error'
  error?: string
}

export type PlanCanvasBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | {
      kind: 'tasks'
      items: Array<{ line: number; checked: boolean; text: string }>
    }
  | { kind: 'diagram'; source: string; diagram: PlanCanvasDiagram }
  | { kind: 'code'; language: string; source: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'rule' }

export interface PlanCanvasDiagramNode {
  id: string
  label: string
  shape: 'box' | 'round' | 'decision'
}

export interface PlanCanvasDiagramEdge {
  from: string
  to: string
  label?: string
  dashed?: boolean
}

export interface PlanCanvasDiagram {
  direction: 'TB' | 'LR' | 'BT' | 'RL'
  nodes: PlanCanvasDiagramNode[]
  edges: PlanCanvasDiagramEdge[]
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const memoryCanvases = new Map<string, PlanCanvasRecord>()
const memoryTombstones = new Set<string>()
const persistenceStates = new Map<string, PlanCanvasPersistenceState>()
const durableStore =
  createIndexedDbPlanCanvasStore() ?? createMemoryPlanCanvasStore()
const durableOperationChains = new Map<string, Promise<void>>()
const durableWriteEpochs = new Map<string, number>()
const draftSaveTimers = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout>
    /** CAS base of the first edit in this coalesced burst. */
    expectedRecordVersion: number
  }
>()
const draftDurableVersions = new Map<string, number>()
let durableHydrationStarted = false
let legacyMigrationStarted = false

const planCanvasChannel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('statskey-plan-canvases-v1')
    : null

if (planCanvasChannel) {
  planCanvasChannel.onmessage = (event) => {
    const message = event.data as { id?: unknown; deleted?: unknown } | null
    if (
      message?.deleted === true &&
      typeof message.id === 'string' &&
      message.id
    ) {
      memoryCanvases.delete(message.id)
      memoryTombstones.add(message.id)
      notifyPlanCanvases(false)
      return
    }
    void hydratePlanCanvasCache(false)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (!durableHydrationStarted) return
    void hydratePlanCanvasCache(false).catch((error) =>
      announcePlanCanvasPersistenceError(undefined, safeError(error))
    )
  })
}

export function planCanvasWorkspaceKey(
  binding: WorkspaceProjectBinding | null
): string | undefined {
  if (!binding) return undefined
  if (binding.id?.trim()) return `id:${binding.id.trim()}`
  const roots = [...binding.roots]
    .map((root) => root.trim())
    .filter(Boolean)
    .sort()
  return roots.length > 0 ? `roots:${roots.join('\u001f')}` : undefined
}

export function planCanvasTitle(source: string, fallback = 'Planning canvas'): string {
  const heading = source
    .split('\n')
    .map((line) => line.match(/^\s*#\s+(.+?)\s*$/)?.[1]?.trim())
    .find(Boolean)
  return (heading || fallback).replace(/[*_`]/g, '').slice(0, 140)
}

export function createPlanCanvas(input: {
  id?: string
  sessionId: string
  title?: string
  source: string
  scope: 'personal' | 'work'
  binding?: WorkspaceProjectBinding | null
  sourceMessageId?: string
  now?: Date
}): PlanCanvasRecord {
  const now = (input.now ?? new Date()).toISOString()
  return sanitizePlanCanvas({
    schemaVersion: 1,
    id: input.id || randomId(),
    sessionId: input.sessionId,
    title: input.title || planCanvasTitle(input.source),
    source: input.source,
    sourceTruncated: input.source.length > MAX_SOURCE_CHARACTERS,
    revisionSource: input.source,
    scope: input.scope,
    workspaceKey: planCanvasWorkspaceKey(input.binding ?? null),
    workspaceLabel: input.binding?.label,
    workspaceRoots: input.binding?.roots,
    sourceMessageId: input.sourceMessageId,
    revision: 1,
    recordVersion: 1,
    createdAt: now,
    updatedAt: now,
  })
}

export function revisePlanCanvas(
  current: PlanCanvasRecord,
  source: string,
  options: {
    title?: string
    sourceMessageId?: string
    now?: Date
  } = {}
): PlanCanvasRecord {
  const changed = source !== (current.revisionSource ?? current.source)
  return sanitizePlanCanvas({
    ...current,
    source,
    sourceTruncated: source.length > MAX_SOURCE_CHARACTERS,
    revisionSource: source,
    title: options.title || planCanvasTitle(source, current.title),
    sourceMessageId: options.sourceMessageId || current.sourceMessageId,
    revision: changed ? current.revision + 1 : current.revision,
    recordVersion: current.recordVersion + 1,
    updatedAt: (options.now ?? new Date()).toISOString(),
  })
}

export function commitPlanCanvasDraft(
  current: PlanCanvasRecord,
  now = new Date()
): PlanCanvasRecord {
  if (current.source === (current.revisionSource ?? current.source)) {
    return current
  }
  return sanitizePlanCanvas({
    ...current,
    revisionSource: current.source,
    revision: current.revision + 1,
    recordVersion: current.recordVersion + 1,
    updatedAt: now.toISOString(),
  })
}

/** Persist ordinary source edits without turning every keystroke into a revision. */
export function updatePlanCanvasDraft(
  current: PlanCanvasRecord,
  source: string,
  now = new Date()
): PlanCanvasRecord {
  return sanitizePlanCanvas({
    ...current,
    source,
    sourceTruncated: source.length > MAX_SOURCE_CHARACTERS,
    title: planCanvasTitle(source, current.title),
    recordVersion: current.recordVersion + 1,
    updatedAt: now.toISOString(),
  })
}

export function savePlanCanvas(
  canvas: PlanCanvasRecord,
  storage?: StorageLike | null
): PlanCanvasRecord {
  if (storage !== undefined) return saveLegacyPlanCanvas(canvas, storage)
  ensurePlanCanvasInitialization()
  let safe = sanitizePlanCanvas(canvas)
  const cached = memoryCanvases.get(safe.id)
  if (cached && safe.recordVersion < cached.recordVersion) {
    announcePlanCanvasConflict(safe.id, cached)
    return copyPlanCanvas(cached)
  }
  if (cached && safe.recordVersion === cached.recordVersion) {
    if (samePlanCanvas(cached, safe)) return copyPlanCanvas(cached)
    if (!samePlanCanvasContent(cached, safe)) {
      announcePlanCanvasConflict(safe.id, cached)
      return copyPlanCanvas(cached)
    }
    safe = { ...safe, recordVersion: cached.recordVersion + 1 }
  }
  memoryCanvases.set(safe.id, copyPlanCanvas(safe))
  memoryTombstones.delete(safe.id)
  setPlanCanvasPersistenceState(safe.id, { status: 'pending' })
  notifyPlanCanvases(false)
  void savePlanCanvasDurably(safe, {
    expectedRecordVersion: safe.recordVersion - 1,
  }).catch(() => undefined)
  return copyPlanCanvas(safe)
}

export function listPlanCanvases(
  storage?: StorageLike | null
): PlanCanvasRecord[] {
  if (storage !== undefined) return readStoredCanvases(storage)
  ensurePlanCanvasInitialization()
  return [...memoryCanvases.values()]
    .filter((canvas) => !memoryTombstones.has(canvas.id))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_CANVASES)
    .map(copyPlanCanvas)
}

export function getPlanCanvas(
  id: string,
  storage?: StorageLike | null
): PlanCanvasRecord | null {
  if (storage !== undefined) {
    return listPlanCanvases(storage).find((canvas) => canvas.id === id) ?? null
  }
  ensurePlanCanvasInitialization()
  if (memoryTombstones.has(id)) return null
  const canvas = memoryCanvases.get(id)
  return canvas ? copyPlanCanvas(canvas) : null
}

export function removePlanCanvas(
  id: string,
  storage?: StorageLike | null
) {
  cancelScheduledPlanCanvasDraft(id)
  if (storage !== undefined) {
    memoryCanvases.delete(id)
    if (storage) {
      storage.setItem(
        PLAN_CANVAS_STORAGE_KEY,
        JSON.stringify(
          readStoredCanvases(storage).filter((canvas) => canvas.id !== id)
        )
      )
    }
    notifyPlanCanvases()
    return
  }
  ensurePlanCanvasInitialization()
  const current = memoryCanvases.get(id)
  memoryCanvases.delete(id)
  memoryTombstones.add(id)
  setPlanCanvasPersistenceState(id, { status: 'pending' })
  notifyPlanCanvases(false)
  if (!current) return
  void removePlanCanvasDurably(id, current.recordVersion).catch(() => undefined)
}

export async function getPlanCanvasDurably(
  id: string,
  store: PlanCanvasStore = durableStore
): Promise<PlanCanvasRecord | null> {
  if (store === durableStore) await flushPlanCanvasPersistence(id)
  const canvas = await store.get(id)
  if (canvas && store === durableStore) {
    memoryCanvases.set(id, copyPlanCanvas(sanitizePlanCanvas(canvas)))
    memoryTombstones.delete(id)
    setPlanCanvasPersistenceState(id, { status: 'saved' })
    notifyPlanCanvases(false)
  } else if (!canvas && store === durableStore) {
    memoryCanvases.delete(id)
    memoryTombstones.add(id)
    persistenceStates.delete(id)
    notifyPlanCanvases(false)
  }
  return canvas ? copyPlanCanvas(sanitizePlanCanvas(canvas)) : null
}

export async function getPlanCanvasRevision(
  id: string,
  revision: number,
  store: PlanCanvasStore = durableStore
): Promise<PlanCanvasRevisionRecord | null> {
  if (store === durableStore) await flushPlanCanvasPersistence(id)
  return store.getRevision(id, Math.max(1, Math.floor(revision)))
}

export async function savePlanCanvasDurably(
  canvas: PlanCanvasRecord,
  options: {
    expectedRecordVersion: number
    store?: PlanCanvasStore
  }
): Promise<PlanCanvasStoreResult> {
  const safe = sanitizePlanCanvas(canvas)
  const store = options.store ?? durableStore
  if (store !== durableStore) {
    return store.save(safe, options.expectedRecordVersion)
  }
  setPlanCanvasPersistenceState(safe.id, { status: 'pending' })
  notifyPlanCanvases(false)
  const writeEpoch = durableWriteEpochs.get(safe.id) ?? 0
  return enqueueDurableResult(safe.id, async () => {
    if ((durableWriteEpochs.get(safe.id) ?? 0) !== writeEpoch) {
      const result = queuedPlanCanvasConflict(safe.id)
      applyDurableSaveResult(safe.id, result)
      return result
    }
    const current = await durableStore.get(safe.id)
    if (
      current &&
      current.recordVersion === safe.recordVersion &&
      samePlanCanvas(sanitizePlanCanvas(current), safe)
    ) {
      const result = { ok: true as const, canvas: safe }
      applyDurableSaveResult(safe.id, result)
      return result
    }
    const result = await durableStore.save(safe, options.expectedRecordVersion)
    fenceLaterWritesAfterConflict(safe.id, writeEpoch, result)
    applyDurableSaveResult(safe.id, result)
    return result
  })
}

export async function commitPlanCanvasDraftDurably(
  id: string,
  expectedRecordVersion: number,
  store: PlanCanvasStore = durableStore
): Promise<PlanCanvasStoreResult> {
  if (store !== durableStore) {
    return store.commitDraft(id, expectedRecordVersion)
  }
  setPlanCanvasPersistenceState(id, { status: 'pending' })
  notifyPlanCanvases(false)
  const writeEpoch = durableWriteEpochs.get(id) ?? 0
  return enqueueDurableResult(id, async () => {
    if ((durableWriteEpochs.get(id) ?? 0) !== writeEpoch) {
      const result = queuedPlanCanvasConflict(id)
      applyDurableSaveResult(id, result)
      return result
    }
    const result = await durableStore.commitDraft(id, expectedRecordVersion)
    fenceLaterWritesAfterConflict(id, writeEpoch, result)
    applyDurableSaveResult(id, result)
    return result
  })
}

/** Debounced draft persistence with a terminal, caught result callback. */
export function schedulePlanCanvasDraftSave(
  canvas: PlanCanvasRecord,
  options: {
    expectedRecordVersion: number
    delayMs?: number
    store?: PlanCanvasStore
    onResult?: (result: PlanCanvasStoreResult) => void
  }
) {
  const previous = draftSaveTimers.get(canvas.id)
  if (previous) clearTimeout(previous.timer)
  const expectedRecordVersion =
    previous?.expectedRecordVersion ??
    draftDurableVersions.get(canvas.id) ??
    options.expectedRecordVersion
  const timer = setTimeout(() => {
    const pending = draftSaveTimers.get(canvas.id)
    if (pending?.timer !== timer) return
    draftSaveTimers.delete(canvas.id)
    void savePlanCanvasDurably(canvas, {
      expectedRecordVersion,
      store: options.store,
    })
      .then((result) => {
        if (result.ok) {
          draftDurableVersions.set(canvas.id, result.canvas.recordVersion)
        }
        options.onResult?.(result)
      })
      .catch((error) =>
        options.onResult?.({
          ok: false,
          reason: 'storage',
          error: error instanceof Error ? error.message : String(error),
        })
      )
  }, Math.max(50, Math.min(2_000, options.delayMs ?? 250)))
  draftSaveTimers.set(canvas.id, { timer, expectedRecordVersion })
  return () => {
    if (draftSaveTimers.get(canvas.id)?.timer !== timer) return
    clearTimeout(timer)
    draftSaveTimers.delete(canvas.id)
  }
}

export async function removePlanCanvasDurably(
  id: string,
  expectedRecordVersion: number,
  store: PlanCanvasStore = durableStore
): Promise<PlanCanvasRemoveResult> {
  cancelScheduledPlanCanvasDraft(id)
  if (store !== durableStore) return store.remove(id, expectedRecordVersion)
  setPlanCanvasPersistenceState(id, { status: 'pending' })
  notifyPlanCanvases(false)
  const writeEpoch = durableWriteEpochs.get(id) ?? 0
  return enqueueDurableResult(id, async () => {
    if ((durableWriteEpochs.get(id) ?? 0) !== writeEpoch) {
      const current = memoryCanvases.get(id)
      setPlanCanvasPersistenceState(id, {
        status: 'error',
        error: 'This canvas changed in another tab. Review it before removing.',
      })
      notifyPlanCanvases(false)
      return {
        ok: false as const,
        reason: 'conflict' as const,
        current,
      }
    }
    const result = await durableStore.remove(id, expectedRecordVersion)
    if (!result.ok && result.reason === 'conflict') {
      durableWriteEpochs.set(id, writeEpoch + 1)
    }
    if (result.ok) {
      memoryCanvases.delete(id)
      memoryTombstones.add(id)
      persistenceStates.delete(id)
      notifyPlanCanvases(false)
      planCanvasChannel?.postMessage({ id, deleted: true })
    } else if (result.current) {
      memoryCanvases.set(id, sanitizePlanCanvas(result.current))
      announcePlanCanvasConflict(id, result.current)
    } else if (result.reason === 'storage') {
      announcePlanCanvasPersistenceError(id, result.error)
    } else {
      announcePlanCanvasPersistenceError(
        id,
        'This planning canvas is no longer available to remove.'
      )
    }
    return result
  })
}

function cancelScheduledPlanCanvasDraft(id: string) {
  const pending = draftSaveTimers.get(id)
  if (pending) clearTimeout(pending.timer)
  draftSaveTimers.delete(id)
  draftDurableVersions.delete(id)
}

/** Wait for this canvas's queued writes without causing another write. */
export async function flushPlanCanvasPersistence(id: string): Promise<void> {
  await durableOperationChains.get(id)
}

export async function hydratePlanCanvasCache(
  broadcast = false,
  store: PlanCanvasStore = durableStore
): Promise<PlanCanvasRecord[]> {
  const [storedCanvases, deletedIds] = await Promise.all([
    store.list(),
    store.listDeletedIds(),
  ])
  const canvases = storedCanvases.map(sanitizePlanCanvas)
  if (store === durableStore) {
    for (const id of deletedIds) {
      memoryCanvases.delete(id)
      memoryTombstones.add(id)
      persistenceStates.delete(id)
    }
    for (const canvas of canvases) {
      const cached = memoryCanvases.get(canvas.id)
      if (!cached || canvas.recordVersion >= cached.recordVersion) {
        memoryCanvases.set(canvas.id, copyPlanCanvas(canvas))
        memoryTombstones.delete(canvas.id)
      }
      setPlanCanvasPersistenceState(canvas.id, { status: 'saved' })
    }
    notifyPlanCanvases(broadcast)
  }
  return canvases.map(copyPlanCanvas)
}

export function getPlanCanvasPersistenceState(
  id: string
): PlanCanvasPersistenceState {
  return persistenceStates.get(id) ?? { status: 'idle' }
}

export function planCanvasesForContext(
  canvases: PlanCanvasRecord[],
  input: {
    sessionId?: string
    binding?: WorkspaceProjectBinding | null
    scope?: 'personal' | 'work'
  }
): PlanCanvasRecord[] {
  const workspaceKey = planCanvasWorkspaceKey(input.binding ?? null)
  return canvases.filter((canvas) => {
    if (input.sessionId && canvas.sessionId === input.sessionId) return true
    if (workspaceKey && canvas.workspaceKey === workspaceKey) return true
    return !workspaceKey && input.scope != null && canvas.scope === input.scope
  })
}

export interface PlanCanvasBuildSource {
  /** Canonical source containing only content represented by the bounded canvas. */
  source: string
  /** True when unsupported or over-limit source was omitted from the canvas. */
  requiresNormalization: boolean
  warnings: string[]
}

interface ParsedPlanCanvas {
  blocks: PlanCanvasBlock[]
  warnings: string[]
}

export function parsePlanCanvas(source: string): PlanCanvasBlock[] {
  return parsePlanCanvasDetailed(source).blocks
}

/**
 * Serialize precisely the bounded content represented in Canvas view. Hidden
 * table cells, unsupported Mermaid directives/comments, and over-limit content
 * are never forwarded to a build run.
 */
export function canonicalPlanCanvasBuildSource(
  source: string
): PlanCanvasBuildSource {
  const parsed = parsePlanCanvasDetailed(source)
  return {
    source: parsed.blocks.map(serializePlanCanvasBlock).join('\n\n').trim(),
    requiresNormalization: parsed.warnings.length > 0,
    warnings: [...new Set(parsed.warnings)],
  }
}

function parsePlanCanvasDetailed(source: string): ParsedPlanCanvas {
  const warnings: string[] = []
  const boundedSource = source.slice(0, MAX_SOURCE_CHARACTERS)
  if (boundedSource.length !== source.length) {
    warnings.push('Content after the canvas size limit was omitted.')
  }
  const lines = boundedSource.replace(/\r\n?/g, '\n').split('\n')
  const blocks: PlanCanvasBlock[] = []
  let index = 0
  let remainingItems = MAX_RENDER_TOTAL_ITEMS
  let remainingTableCells = MAX_RENDER_TOTAL_TABLE_CELLS
  let remainingDiagramNodes = MAX_RENDER_TOTAL_DIAGRAM_NODES
  let remainingDiagramEdges = MAX_RENDER_TOTAL_DIAGRAM_EDGES

  while (index < lines.length && blocks.length < MAX_RENDER_BLOCKS) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim().toLowerCase()
      const content: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        content.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      const rawCode = content.join('\n').trim()
      const code = rawCode.slice(0, MAX_RENDER_CODE_CHARACTERS)
      if (code.length !== rawCode.length) {
        warnings.push('A code or diagram block exceeded the display limit.')
      }
      if (language === 'mermaid') {
        if (mermaidHasUnsupportedContent(code)) {
          warnings.push(
            'Unsupported Mermaid comments or directives were omitted.'
          )
        }
        const parsedDiagram = parsePlanCanvasDiagram(code)
        const nodes = parsedDiagram.nodes.slice(0, remainingDiagramNodes)
        const nodeIds = new Set(nodes.map((node) => node.id))
        const edges = parsedDiagram.edges
          .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
          .slice(0, remainingDiagramEdges)
        if (
          nodes.length !== parsedDiagram.nodes.length ||
          edges.length !== parsedDiagram.edges.length
        ) {
          warnings.push('Diagram content after the document display limit was omitted.')
        }
        const diagram = { ...parsedDiagram, nodes, edges }
        remainingDiagramNodes -= nodes.length
        remainingDiagramEdges -= edges.length
        blocks.push({
          kind: 'diagram',
          source: serializePlanCanvasDiagram(diagram),
          diagram,
        })
      } else {
        blocks.push({ kind: 'code', language, source: code })
      }
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      })
      index += 1
      continue
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    const tasks: Array<{ line: number; checked: boolean; text: string }> = []
    let taskCount = 0
    while (index < lines.length) {
      const match = lines[index].match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/)
      if (!match) break
      if (
        taskCount < MAX_RENDER_TASKS &&
        tasks.length < remainingItems
      ) {
        tasks.push({
          line: index,
          checked: match[1].toLowerCase() === 'x',
          text: boundedCell(match[2], warnings),
        })
      }
      taskCount += 1
      index += 1
    }
    if (taskCount > MAX_RENDER_TASKS) {
      warnings.push('Tasks after the display limit were omitted.')
    }
    if (taskCount > tasks.length) {
      warnings.push('Items after the document display limit were omitted.')
    }
    if (tasks.length > 0) {
      remainingItems -= tasks.length
      blocks.push({ kind: 'tasks', items: tasks })
      continue
    }

    if (
      index + 1 < lines.length &&
      trimmed.includes('|') &&
      /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index + 1])
    ) {
      const rawHeaders = tableCells(line)
      const headers = rawHeaders
        .slice(
          0,
          Math.min(MAX_RENDER_TABLE_COLUMNS, remainingTableCells)
        )
        .map((cell) => boundedCell(cell, warnings))
      if (rawHeaders.length > MAX_RENDER_TABLE_COLUMNS) {
        warnings.push('Hidden table columns were omitted.')
      }
      index += 2
      const rows: string[][] = []
      remainingTableCells -= headers.length
      let rowCount = 0
      while (index < lines.length && lines[index].includes('|')) {
        const rawCells = tableCells(lines[index])
        if (rawCells.length > headers.length) {
          warnings.push('Hidden table cells were omitted.')
        }
        if (
          rowCount < MAX_RENDER_TABLE_ROWS &&
          headers.length > 0 &&
          remainingTableCells >= headers.length
        ) {
          rows.push(
            rawCells
              .slice(0, headers.length)
              .map((cell) => boundedCell(cell, warnings))
          )
          remainingTableCells -= headers.length
        }
        rowCount += 1
        index += 1
      }
      if (rowCount > MAX_RENDER_TABLE_ROWS) {
        warnings.push('Table rows after the display limit were omitted.')
      }
      if (rowCount > rows.length || rawHeaders.length > headers.length) {
        warnings.push('Table content after the document display limit was omitted.')
      }
      if (headers.length > 0) blocks.push({ kind: 'table', headers, rows })
      continue
    }

    const unordered = /^\s*[-*]\s+/.test(line)
    const ordered = /^\s*\d+[.)]\s+/.test(line)
    if (unordered || ordered) {
      const items: string[] = []
      let itemCount = 0
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*]\s+(.+)$/
      while (index < lines.length) {
        const match = lines[index].match(pattern)
        if (!match) break
        if (
          itemCount < MAX_RENDER_LIST_ITEMS &&
          items.length < remainingItems
        ) {
          items.push(boundedCell(match[1].trim(), warnings))
        }
        itemCount += 1
        index += 1
      }
      if (itemCount > MAX_RENDER_LIST_ITEMS) {
        warnings.push('List items after the display limit were omitted.')
      }
      if (itemCount > items.length) {
        warnings.push('Items after the document display limit were omitted.')
      }
      if (items.length > 0) {
        remainingItems -= items.length
        blocks.push({ kind: 'list', ordered, items })
      }
      continue
    }

    const paragraph = [trimmed]
    index += 1
    while (index < lines.length && isParagraphContinuation(lines, index)) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  if (index < lines.length) {
    warnings.push('Blocks after the display limit were omitted.')
  }
  return { blocks, warnings }
}

function serializePlanCanvasBlock(block: PlanCanvasBlock): string {
  if (block.kind === 'heading') {
    return `${'#'.repeat(Math.max(1, Math.min(4, block.level)))} ${block.text}`
  }
  if (block.kind === 'paragraph') return block.text
  if (block.kind === 'rule') return '---'
  if (block.kind === 'tasks') {
    return block.items
      .map((item) => `- [${item.checked ? 'x' : ' '}] ${item.text}`)
      .join('\n')
  }
  if (block.kind === 'list') {
    return block.items
      .map((item, index) =>
        block.ordered ? `${index + 1}. ${item}` : `- ${item}`
      )
      .join('\n')
  }
  if (block.kind === 'table') {
    const header = `| ${block.headers.map(canonicalTableCell).join(' | ')} |`
    const divider = `| ${block.headers.map(() => '---').join(' | ')} |`
    const rows = block.rows.map(
      (row) =>
        `| ${block.headers
          .map((_unused, index) => canonicalTableCell(row[index] || ''))
          .join(' | ')} |`
    )
    return [header, divider, ...rows].join('\n')
  }
  if (block.kind === 'diagram') {
    return `\`\`\`mermaid\n${serializePlanCanvasDiagram(block.diagram)}\n\`\`\``
  }
  return `\`\`\`${block.language}\n${block.source}\n\`\`\``
}

function serializePlanCanvasDiagram(diagram: PlanCanvasDiagram): string {
  const nodes = diagram.nodes.map((node) => {
    const label = canonicalDiagramLabel(node.label)
    if (node.shape === 'decision') return `${node.id}{${label}}`
    if (node.shape === 'round') return `${node.id}(${label})`
    return `${node.id}[${label}]`
  })
  const edges = diagram.edges.map((edge) => {
    const arrow = edge.dashed ? '-.->' : '-->'
    const label = edge.label
      ? `|${canonicalDiagramLabel(edge.label)}| `
      : ''
    return `${edge.from} ${arrow} ${label}${edge.to}`
  })
  return [`flowchart ${diagram.direction}`, ...nodes, ...edges].join('\n')
}

function canonicalDiagramLabel(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/%%/g, '% %')
    .replace(/[|]/g, '¦')
    .slice(0, 180)
}

function canonicalTableCell(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[|]/g, '¦')
}

function boundedCell(value: string, warnings: string[]): string {
  const result = value.slice(0, MAX_RENDER_CELL_CHARACTERS)
  if (result.length !== value.length) {
    warnings.push('Oversized table or list content was shortened.')
  }
  return result
}

function mermaidHasUnsupportedContent(source: string): boolean {
  if (/%%/.test(source)) return true
  const statements = source
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter(Boolean)
  let headerSeen = false
  const nodes = new Set<string>()
  let edgeCount = 0
  for (const statement of statements) {
    if (!headerSeen && /^(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)$/i.test(statement)) {
      headerSeen = true
      continue
    }
    const first = parseDiagramNode(statement)
    if (!first || first.truncated) return true
    nodes.add(first.node.id)
    if (nodes.size > MAX_RENDER_DIAGRAM_NODES) return true
    const remainder = statement.slice(first.length)
    if (!remainder.trim()) continue
    const edge = remainder.match(
      /^\s*(-->|==>|---|-\.->)\s*(?:\|([^|]+)\|\s*)?/
    )
    if (!edge) return true
    const secondInput = remainder.slice(edge[0].length)
    const second = parseDiagramNode(secondInput)
    if (
      !second ||
      second.truncated ||
      (edge[2]?.trim().length ?? 0) > 36 ||
      secondInput.slice(second.length).trim()
    ) return true
    nodes.add(second.node.id)
    edgeCount += 1
    if (
      nodes.size > MAX_RENDER_DIAGRAM_NODES ||
      edgeCount > MAX_RENDER_DIAGRAM_EDGES
    ) {
      return true
    }
  }
  return false
}

export function togglePlanCanvasTask(source: string, line: number): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (line < 0 || line >= lines.length) return source
  lines[line] = lines[line].replace(
    /^(\s*[-*]\s+\[)([ xX])(\]\s+)/,
    (_match, before: string, value: string, after: string) =>
      `${before}${value.toLowerCase() === 'x' ? ' ' : 'x'}${after}`
  )
  return lines.join('\n')
}

export function parsePlanCanvasDiagram(source: string): PlanCanvasDiagram {
  const statements = source
    .replace(/%%.*$/gm, '')
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter(Boolean)
  const header = statements[0]?.match(
    /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)$/i
  )
  if (header) statements.shift()
  const direction = (header?.[1]?.toUpperCase() === 'TD'
    ? 'TB'
    : header?.[1]?.toUpperCase()) as PlanCanvasDiagram['direction'] | undefined
  const nodes = new Map<string, PlanCanvasDiagramNode>()
  const edges: PlanCanvasDiagramEdge[] = []

  for (const statement of statements) {
    if (/^(?:subgraph|end|classDef|class|style|linkStyle)\b/i.test(statement)) {
      continue
    }
    const first = parseDiagramNode(statement)
    if (!first) continue
    const firstPrevious = nodes.get(first.node.id)
    nodes.set(
      first.node.id,
      firstPrevious && first.node.label === first.node.id
        ? firstPrevious
        : first.node
    )
    const remainder = statement.slice(first.length)
    const edge = remainder.match(
      /^\s*(-->|==>|---|-\.->)\s*(?:\|([^|]+)\|\s*)?/
    )
    if (!edge) continue
    const second = parseDiagramNode(remainder.slice(edge[0].length))
    if (!second) continue
    const previous = nodes.get(second.node.id)
    nodes.set(
      second.node.id,
      previous && second.node.label === second.node.id ? previous : second.node
    )
    edges.push({
      from: first.node.id,
      to: second.node.id,
      label: edge[2]?.trim().slice(0, 36) || undefined,
      dashed: edge[1] === '-.->',
    })
  }

  return {
    direction: direction || 'TB',
    nodes: [...nodes.values()].slice(0, MAX_RENDER_DIAGRAM_NODES),
    edges: edges
      .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
      .slice(0, MAX_RENDER_DIAGRAM_EDGES),
  }
}

function parseDiagramNode(
  value: string
): { node: PlanCanvasDiagramNode; length: number; truncated: boolean } | null {
  const id = value.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)/)
  if (!id) return null
  const start = id[0].length
  const rest = value.slice(start)
  const bracket = rest.match(/^\s*(\[|\{|\()(.*?)(\]|\}|\))/)
  const shape: PlanCanvasDiagramNode['shape'] =
    bracket?.[1] === '{'
      ? 'decision'
      : bracket?.[1] === '('
        ? 'round'
        : 'box'
  const rawLabel = bracket?.[2] ?? id[1]
  const normalizedLabel = rawLabel
    .replace(/^["']|["']$/g, '')
    .replace(/<br\s*\/?\s*>/gi, ' · ')
    .trim()
  const unboundedLabel = normalizedLabel || id[1]
  const label = visibleDiagramNodeLabel(unboundedLabel)
  return {
    node: { id: id[1], label, shape },
    length: start + (bracket?.[0].length ?? 0),
    truncated: label !== unboundedLabel,
  }
}

function visibleDiagramNodeLabel(value: string): string {
  const words = value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 23))
  const lines: string[] = []
  for (const word of words) {
    const current = lines.at(-1)
    if (!current || `${current} ${word}`.length > 23) lines.push(word)
    else lines[lines.length - 1] = `${current} ${word}`
  }
  return lines.slice(0, 3).join(' ') || 'Step'
}

function isParagraphContinuation(lines: string[], index: number): boolean {
  const value = lines[index].trim()
  if (!value) return false
  if (/^(?:#{1,4}\s|```|---+$|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(value)) {
    return false
  }
  if (index + 1 < lines.length && lines[index + 1].match(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/)) {
    return false
  }
  return true
}

function tableCells(value: string): string[] {
  return value
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
}

function sanitizePlanCanvas(value: PlanCanvasRecord): PlanCanvasRecord {
  const createdAt = safeIso(value.createdAt) || new Date().toISOString()
  return {
    schemaVersion: 1,
    id: value.id.trim().slice(0, 160) || randomId(),
    sessionId: value.sessionId.trim().slice(0, 160),
    title: value.title.trim().slice(0, 140) || 'Planning canvas',
    source: value.source.slice(0, MAX_SOURCE_CHARACTERS),
    sourceTruncated:
      value.sourceTruncated === true ||
      value.source.length > MAX_SOURCE_CHARACTERS ||
      undefined,
    revisionSource:
      typeof value.revisionSource === 'string'
        ? value.revisionSource.slice(0, MAX_SOURCE_CHARACTERS)
        : value.source.slice(0, MAX_SOURCE_CHARACTERS),
    scope: value.scope === 'work' ? 'work' : 'personal',
    workspaceKey: optionalText(value.workspaceKey, 2_000),
    workspaceLabel: optionalText(value.workspaceLabel, 140),
    workspaceRoots: Array.isArray(value.workspaceRoots)
      ? value.workspaceRoots
          .filter((root): root is string => typeof root === 'string')
          .map((root) => root.slice(0, 2_000))
          .slice(0, 24)
      : undefined,
    savedPath: optionalText(value.savedPath, 2_000),
    savedFilePath: optionalText(value.savedFilePath, 2_000),
    savedModifiedAt: safeIso(value.savedModifiedAt) || undefined,
    savedSource:
      typeof value.savedSource === 'string'
        ? value.savedSource.slice(0, MAX_SOURCE_CHARACTERS)
        : undefined,
    sourceMessageId: optionalText(value.sourceMessageId, 160),
    revision: Math.max(1, Math.min(10_000, Math.floor(value.revision || 1))),
    recordVersion: Math.max(
      1,
      Math.min(
        1_000_000,
        Math.floor(
          typeof value.recordVersion === 'number' &&
            Number.isFinite(value.recordVersion)
            ? value.recordVersion
            : 1
        )
      )
    ),
    createdAt,
    updatedAt: safeIso(value.updatedAt) || createdAt,
  }
}

function readStoredCanvases(storage: StorageLike | null): PlanCanvasRecord[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(PLAN_CANVAS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is PlanCanvasRecord =>
          item != null &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.sessionId === 'string' &&
          typeof item.title === 'string' &&
          typeof item.source === 'string'
      )
      .map((item) =>
        sanitizePlanCanvas({
          ...item,
          schemaVersion: 1,
          scope: item.scope === 'work' ? 'work' : 'personal',
          revision:
            typeof item.revision === 'number' && Number.isFinite(item.revision)
              ? item.revision
              : 1,
          recordVersion:
            typeof item.recordVersion === 'number' &&
            Number.isFinite(item.recordVersion)
              ? item.recordVersion
              : 1,
          createdAt: String(item.createdAt ?? ''),
          updatedAt: String(item.updatedAt ?? ''),
        })
      )
      .slice(0, MAX_CANVASES)
  } catch {
    return []
  }
}

function optionalText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximum)
    : undefined
}

function safeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().toUpperCase()
    : `CANVAS-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function saveLegacyPlanCanvas(
  canvas: PlanCanvasRecord,
  storage: StorageLike | null
): PlanCanvasRecord {
  const safe = sanitizePlanCanvas(canvas)
  if (!storage) return safe
  const canvases = readStoredCanvases(storage).filter(
    (candidate) => candidate.id !== safe.id
  )
  storage.setItem(
    PLAN_CANVAS_STORAGE_KEY,
    JSON.stringify(
      [safe, ...canvases]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_CANVASES)
    )
  )
  notifyPlanCanvases(false)
  return safe
}

function ensurePlanCanvasInitialization() {
  if (!durableHydrationStarted) {
    durableHydrationStarted = true
    void hydratePlanCanvasCache(false).catch((error) =>
      announcePlanCanvasPersistenceError(undefined, safeError(error))
    )
  }
  if (legacyMigrationStarted) return
  legacyMigrationStarted = true
  const storage = browserStorage()
  const legacy = readStoredCanvases(storage).map((canvas) =>
    sanitizePlanCanvas({
      ...canvas,
      // The legacy array did not contain immutable historical snapshots. Treat
      // the currently visible source as the first durable revision rather than
      // manufacturing history that cannot be retrieved exactly.
      revision: 1,
      revisionSource: canvas.source,
      recordVersion: 1,
    })
  )
  if (legacy.length === 0) return
  for (const canvas of legacy) {
    const cached = memoryCanvases.get(canvas.id)
    if (!cached || canvas.recordVersion > cached.recordVersion) {
      memoryCanvases.set(canvas.id, canvas)
    }
  }
  notifyPlanCanvases(false)
  void Promise.all(
    legacy.map((canvas) =>
      enqueueDurableOperation(canvas.id, async () => {
        const result = await durableStore.save(canvas, 0)
        applyDurableSaveResult(canvas.id, result)
        if (!result.ok && (result.reason === 'storage' || result.reason === 'limit')) {
          throw new Error(result.error || 'The planning canvas could not be migrated.')
        }
      })
    )
  )
    .then(() => storage?.removeItem?.(PLAN_CANVAS_STORAGE_KEY))
    .catch((error) =>
      announcePlanCanvasPersistenceError(undefined, safeError(error))
    )
}

function enqueueDurableOperation(
  id: string,
  operation: () => void | Promise<void>
): Promise<void> {
  return enqueueDurableResult(id, operation)
}

function enqueueDurableResult<T>(
  id: string,
  operation: () => T | Promise<T>
): Promise<T> {
  const previous = durableOperationChains.get(id) ?? Promise.resolve()
  const run = previous.then(operation, operation).catch((error) => {
    announcePlanCanvasPersistenceError(id, safeError(error))
    throw error
  })
  const tracked = run.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (durableOperationChains.get(id) === tracked) {
      durableOperationChains.delete(id)
    }
  })
  durableOperationChains.set(id, tracked)
  // Every internal caller is fire-and-forget; attach a terminal rejection handler
  // while still returning the original promise to migration callers that await it.
  void run.catch(() => undefined)
  return run
}

function applyDurableSaveResult(id: string, result: PlanCanvasStoreResult) {
  if (result.ok) {
    const safe = sanitizePlanCanvas(result.canvas)
    const cached = memoryCanvases.get(id)
    if (
      !cached ||
      safe.recordVersion >= cached.recordVersion ||
      samePlanCanvasExceptRecordVersion(cached, safe)
    ) {
      memoryCanvases.set(id, safe)
      memoryTombstones.delete(id)
    }
    setPlanCanvasPersistenceState(id, { status: 'saved' })
    notifyPlanCanvases(true)
    return
  }
  if (result.current) {
    memoryCanvases.set(id, sanitizePlanCanvas(result.current))
    memoryTombstones.delete(id)
    setPlanCanvasPersistenceState(id, {
      status: 'error',
      error: 'This canvas changed in another tab. Review the latest version.',
    })
    announcePlanCanvasConflict(id, result.current)
    return
  }
  if (result.reason === 'deleted') {
    memoryCanvases.delete(id)
    memoryTombstones.add(id)
    persistenceStates.delete(id)
    announcePlanCanvasConflict(id)
    return
  }
  if (result.reason === 'storage' || result.reason === 'limit') {
    setPlanCanvasPersistenceState(id, {
      status: 'error',
      error: result.error || 'The planning canvas could not be saved.',
    })
    announcePlanCanvasPersistenceError(id, result.error)
    return
  }
  if (result.reason === 'missing') {
    announcePlanCanvasPersistenceError(
      id,
      'This planning canvas is no longer available to save.'
    )
  }
}

function fenceLaterWritesAfterConflict(
  id: string,
  writeEpoch: number,
  result: PlanCanvasStoreResult
) {
  if (
    !result.ok &&
    (result.reason === 'conflict' || result.reason === 'deleted') &&
    (durableWriteEpochs.get(id) ?? 0) === writeEpoch
  ) {
    durableWriteEpochs.set(id, writeEpoch + 1)
  }
}

function queuedPlanCanvasConflict(id: string): PlanCanvasStoreResult {
  const current = memoryCanvases.get(id)
  return {
    ok: false,
    reason: memoryTombstones.has(id) ? 'deleted' : 'conflict',
    current: current ? copyPlanCanvas(current) : undefined,
  }
}

function samePlanCanvas(left: PlanCanvasRecord, right: PlanCanvasRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function samePlanCanvasExceptRecordVersion(
  left: PlanCanvasRecord,
  right: PlanCanvasRecord
): boolean {
  return samePlanCanvas(
    { ...left, recordVersion: 0 },
    { ...right, recordVersion: 0 }
  )
}

function copyPlanCanvas(canvas: PlanCanvasRecord): PlanCanvasRecord {
  return {
    ...canvas,
    workspaceRoots: canvas.workspaceRoots ? [...canvas.workspaceRoots] : undefined,
  }
}

function samePlanCanvasContent(
  left: PlanCanvasRecord,
  right: PlanCanvasRecord
): boolean {
  return (
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.source === right.source &&
    left.revisionSource === right.revisionSource &&
    left.revision === right.revision &&
    left.scope === right.scope &&
    left.workspaceKey === right.workspaceKey &&
    JSON.stringify(left.workspaceRoots ?? []) ===
      JSON.stringify(right.workspaceRoots ?? [])
  )
}

function announcePlanCanvasConflict(
  id: string,
  current?: PlanCanvasRecord
) {
  persistenceStates.set(id, {
    status: 'error',
    error: 'This canvas changed in another tab. Review the latest version.',
  })
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(PLAN_CANVAS_CONFLICT_EVENT, {
      detail: { id, current },
    })
  )
  notifyPlanCanvases(false)
}

function announcePlanCanvasPersistenceError(
  id?: string,
  error?: string
) {
  const message = error || 'The planning canvas could not be saved.'
  if (id) {
    persistenceStates.set(id, { status: 'error', error: message })
  }
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(PLAN_CANVAS_PERSISTENCE_ERROR_EVENT, {
      detail: {
        id,
        error: message,
      },
    })
  )
}

function setPlanCanvasPersistenceState(
  id: string,
  state: PlanCanvasPersistenceState
) {
  persistenceStates.set(id, state)
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function notifyPlanCanvases(broadcast = false) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PLAN_CANVAS_EVENT))
  }
  if (broadcast) planCanvasChannel?.postMessage({ changed: true })
}
