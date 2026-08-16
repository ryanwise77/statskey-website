import type { ChatSessionMessage } from './data/useChatSessions'
import {
  createPlanCanvas,
  getPlanCanvasDurably,
  getPlanCanvasRevision,
  revisePlanCanvas,
  savePlanCanvasDurably,
  updatePlanCanvasDraft,
  type PlanCanvasRecord,
  type PlanCanvasRevisionRecord,
  type PlanCanvasStore,
  type PlanCanvasStoreResult,
} from './planCanvas'
import type { WorkspaceProjectBinding } from './workspaceContext'

export interface PersistPlanResponseResult {
  canvas: PlanCanvasRecord | null
  notice?: string
}

/**
 * Persist a Plan response before the chat advertises it as an artifact.
 * A revision is compare-and-swapped against the exact record the provider saw.
 */
export async function persistPlanResponseCanvas(input: {
  sessionId: string
  source: string
  scope: 'personal' | 'work'
  binding?: WorkspaceProjectBinding | null
  title: string
  sourceMessageId: string
  revisionTarget?: PlanCanvasRecord | null
  now?: Date
  store?: PlanCanvasStore
}): Promise<PersistPlanResponseResult> {
  const candidate = input.revisionTarget
    ? revisePlanCanvas(input.revisionTarget, input.source, {
        title: input.title,
        sourceMessageId: input.sourceMessageId,
        now: input.now,
      })
    : createPlanCanvas({
        sessionId: input.sessionId,
        source: input.source,
        scope: input.scope,
        binding: input.binding,
        sourceMessageId: input.sourceMessageId,
        title: input.title,
        now: input.now,
      })

  const result = await saveCandidate(
    candidate,
    input.revisionTarget?.recordVersion ?? 0,
    input.store
  )
  if (result.ok) return { canvas: result.canvas }

  if (input.revisionTarget && result.reason === 'conflict') {
    const independent = createPlanCanvas({
      sessionId: input.sessionId,
      source: input.source,
      scope: input.scope,
      binding: input.binding,
      sourceMessageId: input.sourceMessageId,
      title: input.title,
      now: input.now,
    })
    const recovered = await saveCandidate(independent, 0, input.store)
    if (recovered.ok) {
      return {
        canvas: recovered.canvas,
        notice:
          'The selected canvas changed in another tab while Intelligence was working, so this response was saved as a new canvas instead of overwriting newer work.',
      }
    }
    return {
      canvas: null,
      notice: persistenceFailureNotice(recovered),
    }
  }

  return { canvas: null, notice: persistenceFailureNotice(result) }
}

/** Clone every canvas referenced by a fork before the forked chat is opened. */
export async function forkChatPlanCanvases(input: {
  messages: ChatSessionMessage[]
  forkSessionId: string
  scope: 'personal' | 'work'
  binding?: WorkspaceProjectBinding | null
  now?: Date
  store?: PlanCanvasStore
}): Promise<{ messages: ChatSessionMessage[]; canvases: PlanCanvasRecord[] }> {
  const groups = new Map<string, ChatSessionMessage[]>()
  for (const message of input.messages) {
    if (message.artifact?.kind !== 'plan-canvas') continue
    groups.set(message.artifact.id, [
      ...(groups.get(message.artifact.id) ?? []),
      message,
    ])
  }
  if (groups.size === 0) {
    return { messages: input.messages.map(copyMessage), canvases: [] }
  }

  const replacements = new Map<
    string,
    { canvas: PlanCanvasRecord; revisions: Map<number, number> }
  >()
  for (const [sourceId, artifactMessages] of groups) {
    const replacement = await cloneCanvasForFork({
      sourceId,
      artifactMessages,
      forkSessionId: input.forkSessionId,
      scope: input.scope,
      binding: input.binding,
      now: input.now,
      store: input.store,
    })
    replacements.set(sourceId, replacement)
  }

  return {
    messages: input.messages.map((message) => {
      if (message.artifact?.kind !== 'plan-canvas') return copyMessage(message)
      const replacement = replacements.get(message.artifact.id)
      if (!replacement) return copyMessage(message)
      return {
        ...copyMessage(message),
        artifact: {
          kind: 'plan-canvas',
          id: replacement.canvas.id,
          title: replacement.canvas.title,
          revision:
            replacement.revisions.get(message.artifact.revision) ??
            replacement.canvas.revision,
        },
      }
    }),
    canvases: [...replacements.values()].map(({ canvas }) => canvas),
  }
}

async function cloneCanvasForFork(input: {
  sourceId: string
  artifactMessages: ChatSessionMessage[]
  forkSessionId: string
  scope: 'personal' | 'work'
  binding?: WorkspaceProjectBinding | null
  now?: Date
  store?: PlanCanvasStore
}): Promise<{ canvas: PlanCanvasRecord; revisions: Map<number, number> }> {
  const head = await getPlanCanvasDurably(input.sourceId, input.store)
  const byRevision = new Map<number, ChatSessionMessage>()
  for (const message of input.artifactMessages) {
    if (!message.artifact) continue
    byRevision.set(message.artifact.revision, message)
  }
  const sourceRevisions = [...byRevision.keys()].sort((left, right) => left - right)
  if (head && !sourceRevisions.includes(head.revision)) {
    sourceRevisions.push(head.revision)
    sourceRevisions.sort((left, right) => left - right)
  }

  const revisionRecords = new Map<number, PlanCanvasRevisionRecord | null>()
  await Promise.all(
    sourceRevisions.map(async (revision) => {
      revisionRecords.set(
        revision,
        await getPlanCanvasRevision(input.sourceId, revision, input.store)
      )
    })
  )
  const firstRevision = sourceRevisions[0]
  const firstMessage = byRevision.get(firstRevision) ?? input.artifactMessages[0]
  const firstRecord = revisionRecords.get(firstRevision)
  const firstSource =
    firstRecord?.source ||
    (head?.revision === firstRevision ? head.revisionSource : undefined) ||
    firstMessage?.content ||
    head?.source ||
    '# Planning canvas'
  const binding =
    planCanvasBinding(head) ||
    revisionBinding(firstRecord) ||
    input.binding ||
    null
  let copy = createPlanCanvas({
    sessionId: input.forkSessionId,
    source: firstSource,
    scope: head?.scope ?? firstRecord?.scope ?? input.scope,
    binding,
    sourceMessageId: firstMessage?.id,
    title:
      firstRecord?.title ||
      head?.title ||
      firstMessage?.artifact?.title ||
      'Planning canvas',
    now: input.now,
  })
  const firstSave = await saveCandidate(copy, 0, input.store)
  if (!firstSave.ok) throw new Error(forkFailureNotice(firstSave))
  copy = firstSave.canvas
  const revisions = new Map<number, number>([[firstRevision, copy.revision]])

  for (const sourceRevision of sourceRevisions.slice(1)) {
    const message = byRevision.get(sourceRevision)
    const record = revisionRecords.get(sourceRevision)
    const source =
      record?.source ||
      (head?.revision === sourceRevision ? head.revisionSource : undefined) ||
      message?.content ||
      copy.source
    const candidate = revisePlanCanvas(copy, source, {
      title: record?.title || message?.artifact?.title || copy.title,
      sourceMessageId: message?.id,
      now: input.now,
    })
    const saved = await saveCandidate(candidate, copy.recordVersion, input.store)
    if (!saved.ok) throw new Error(forkFailureNotice(saved))
    copy = saved.canvas
    revisions.set(sourceRevision, copy.revision)
  }

  if (head && head.source !== copy.source) {
    const draft = updatePlanCanvasDraft(
      { ...copy, title: head.title },
      head.source,
      input.now
    )
    const saved = await saveCandidate(draft, copy.recordVersion, input.store)
    if (!saved.ok) throw new Error(forkFailureNotice(saved))
    copy = saved.canvas
  }
  return { canvas: copy, revisions }
}

function planCanvasBinding(
  canvas: PlanCanvasRecord | null
): WorkspaceProjectBinding | null {
  if (!canvas) return null
  return bindingFromStoredIdentity(
    canvas.workspaceKey,
    canvas.workspaceLabel,
    canvas.workspaceRoots
  )
}

function revisionBinding(
  revision: PlanCanvasRevisionRecord | null | undefined
): WorkspaceProjectBinding | null {
  if (!revision) return null
  return bindingFromStoredIdentity(
    revision.workspaceKey,
    revision.workspaceLabel,
    revision.workspaceRoots
  )
}

function bindingFromStoredIdentity(
  workspaceKey: string | undefined,
  workspaceLabel: string | undefined,
  workspaceRoots: string[] | undefined
): WorkspaceProjectBinding | null {
  const id = workspaceKey?.startsWith('id:')
    ? workspaceKey.slice(3)
    : undefined
  const roots = Array.isArray(workspaceRoots) ? [...workspaceRoots] : []
  if (!id && roots.length === 0) return null
  return {
    id,
    label: workspaceLabel?.trim() || 'Workspace',
    roots,
  }
}

async function saveCandidate(
  canvas: PlanCanvasRecord,
  expectedRecordVersion: number,
  store?: PlanCanvasStore
): Promise<PlanCanvasStoreResult> {
  try {
    return await savePlanCanvasDurably(canvas, {
      expectedRecordVersion,
      ...(store ? { store } : {}),
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'storage',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function persistenceFailureNotice(result: {
  reason: string
  error?: string
}): string {
  const detail = result.error?.trim()
  return `The planning canvas could not be saved${detail ? `: ${detail}` : '.'} The complete plan remains in this response, so no work was lost.`
}

function forkFailureNotice(result: { reason: string; error?: string }): string {
  return result.error?.trim() ||
    'The planning canvas could not be copied safely. The fork was not opened.'
}

function copyMessage(message: ChatSessionMessage): ChatSessionMessage {
  return {
    ...message,
    artifact: message.artifact ? { ...message.artifact } : undefined,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    steps: message.steps?.map((step) => ({ ...step })),
    citations: message.citations ? [...message.citations] : undefined,
  }
}
