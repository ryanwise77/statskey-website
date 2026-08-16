import { describe, expect, it } from 'vitest'
import type { ChatSessionMessage } from './data/useChatSessions'
import {
  createPlanCanvas,
  createMemoryPlanCanvasStore,
  revisePlanCanvas,
  updatePlanCanvasDraft,
  type PlanCanvasStore,
} from './planCanvas'
import {
  forkChatPlanCanvases,
  persistPlanResponseCanvas,
} from './planCanvasChat'

const WORKSPACE = {
  id: '0123456789abcdefabcd',
  label: 'Product',
  roots: ['/Product'],
}

describe('planning canvases in chat flows', () => {
  it('revises an explicitly selected canvas from another chat', async () => {
    const store = createMemoryPlanCanvasStore()
    const initial = createPlanCanvas({
      id: 'shared-plan',
      sessionId: 'session-a',
      source: '# First plan',
      scope: 'work',
      binding: WORKSPACE,
    })
    const saved = await store.save(initial, 0)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const result = await persistPlanResponseCanvas({
      sessionId: 'session-b',
      source: '# Revised plan\n\n- [ ] Ship it',
      scope: 'work',
      binding: WORKSPACE,
      title: 'Revised plan',
      sourceMessageId: 'reply-b',
      revisionTarget: saved.canvas,
      store,
    })

    expect(result.notice).toBeUndefined()
    expect(result.canvas).toMatchObject({
      id: 'shared-plan',
      sessionId: 'session-a',
      revision: 2,
      sourceMessageId: 'reply-b',
    })
    expect(await store.get('shared-plan')).toMatchObject({
      source: '# Revised plan\n\n- [ ] Ship it',
      revision: 2,
    })
  })

  it('never attaches a losing response to another tab’s winning revision', async () => {
    const store = createMemoryPlanCanvasStore()
    const initial = createPlanCanvas({
      id: 'concurrent-plan',
      sessionId: 'session-a',
      source: '# Original',
      scope: 'work',
      binding: WORKSPACE,
    })
    const saved = await store.save(initial, 0)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const staleTarget = saved.canvas
    const winningCandidate = revisePlanCanvas(staleTarget, '# Winner')
    const winner = await store.save(
      winningCandidate,
      staleTarget.recordVersion
    )
    expect(winner.ok).toBe(true)

    const loser = await persistPlanResponseCanvas({
      sessionId: 'session-b',
      source: '# Losing response',
      scope: 'work',
      binding: WORKSPACE,
      title: 'Losing response',
      sourceMessageId: 'loser-reply',
      revisionTarget: staleTarget,
      store,
    })

    expect(loser.notice).toContain('saved as a new canvas')
    expect(loser.canvas?.id).not.toBe('concurrent-plan')
    expect(loser.canvas?.source).toBe('# Losing response')
    expect(await store.get('concurrent-plan')).toMatchObject({
      source: '# Winner',
      revision: 2,
    })
  })

  it('returns a visible recoverable failure instead of an artifact on storage failure', async () => {
    const store = failingStore('disk is full')
    const result = await persistPlanResponseCanvas({
      sessionId: 'session-a',
      source: '# Complete plan',
      scope: 'personal',
      title: 'Complete plan',
      sourceMessageId: 'reply-a',
      store,
    })

    expect(result.canvas).toBeNull()
    expect(result.notice).toContain('disk is full')
    expect(result.notice).toContain('complete plan remains in this response')
  })

  it('durably clones and remaps canvas history when a chat is forked', async () => {
    const store = createMemoryPlanCanvasStore()
    const first = createPlanCanvas({
      id: 'parent-plan',
      sessionId: 'parent-chat',
      source: '# Version one',
      scope: 'work',
      binding: WORKSPACE,
      sourceMessageId: 'message-one',
    })
    const firstSaved = await store.save(first, 0)
    expect(firstSaved.ok).toBe(true)
    if (!firstSaved.ok) return
    const second = revisePlanCanvas(firstSaved.canvas, '# Version two', {
      sourceMessageId: 'message-two',
    })
    const secondSaved = await store.save(
      second,
      firstSaved.canvas.recordVersion
    )
    expect(secondSaved.ok).toBe(true)
    if (!secondSaved.ok) return
    const draft = updatePlanCanvasDraft(
      secondSaved.canvas,
      '# Version two\n\nDraft note'
    )
    const draftSaved = await store.save(
      draft,
      secondSaved.canvas.recordVersion
    )
    expect(draftSaved.ok).toBe(true)

    const messages: ChatSessionMessage[] = [
      canvasMessage('message-one', 'parent-plan', 1, '# Version one'),
      canvasMessage('message-two', 'parent-plan', 2, '# Version two'),
    ]
    const forked = await forkChatPlanCanvases({
      messages,
      forkSessionId: 'fork-chat',
      scope: 'work',
      binding: WORKSPACE,
      store,
    })

    const copiedId = forked.messages[0].artifact?.id
    expect(copiedId).toBeTruthy()
    expect(copiedId).not.toBe('parent-plan')
    expect(forked.messages.map((message) => message.artifact?.revision)).toEqual([
      1,
      2,
    ])
    expect(await store.get(copiedId as string)).toMatchObject({
      sessionId: 'fork-chat',
      source: '# Version two\n\nDraft note',
      revision: 2,
    })

    const forkHead = await store.get(copiedId as string)
    expect(forkHead).not.toBeNull()
    if (!forkHead) return
    const forkRevision = revisePlanCanvas(forkHead, '# Fork-only change')
    expect(
      await store.save(forkRevision, forkHead.recordVersion)
    ).toMatchObject({ ok: true })
    expect(await store.get('parent-plan')).toMatchObject({
      source: '# Version two\n\nDraft note',
      revision: 2,
    })
  })
})

function canvasMessage(
  id: string,
  canvasId: string,
  revision: number,
  content: string
): ChatSessionMessage {
  return {
    id,
    role: 'model',
    content,
    timestamp: new Date('2026-08-11T12:00:00Z'),
    artifact: {
      kind: 'plan-canvas',
      id: canvasId,
      title: 'Plan',
      revision,
    },
  }
}

function failingStore(error: string): PlanCanvasStore {
  return {
    list: async () => [],
    listDeletedIds: async () => [],
    get: async () => null,
    getRevision: async () => null,
    save: async () => ({ ok: false, reason: 'storage', error }),
    commitDraft: async () => ({ ok: false, reason: 'storage', error }),
    remove: async () => ({ ok: false, reason: 'storage', error }),
  }
}
