import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLAN_CANVAS_STORAGE_KEY,
  canonicalPlanCanvasBuildSource,
  commitPlanCanvasDraft,
  createMemoryPlanCanvasStore,
  createPlanCanvas,
  flushPlanCanvasPersistence,
  getPlanCanvas,
  getPlanCanvasDurably,
  getPlanCanvasPersistenceState,
  listPlanCanvases,
  parsePlanCanvas,
  parsePlanCanvasDiagram,
  planCanvasWorkspaceKey,
  removePlanCanvas,
  revisePlanCanvas,
  savePlanCanvas,
  savePlanCanvasDurably,
  schedulePlanCanvasDraftSave,
  togglePlanCanvasTask,
  updatePlanCanvasDraft,
  type PlanCanvasStore,
} from './planCanvas'
import { MAX_ACTIVE_PLAN_CANVASES } from './planCanvasStore'

describe('planning canvases', () => {
  let values: Map<string, string>
  let storage: Storage

  beforeEach(() => {
    values = new Map()
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size
      },
    }
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates, versions, saves, reloads, and removes a canvas', () => {
    const initial = createPlanCanvas({
      id: 'canvas-one',
      sessionId: 'session-one',
      scope: 'work',
      source: '# Better import flow\n\n- [ ] Add a picker',
      binding: {
        id: 'workspace-one',
        label: 'StatsKey',
        roots: ['/Projects/StatsKey'],
      },
      now: new Date('2026-08-11T12:00:00Z'),
    })
    expect(initial.schemaVersion).toBe(1)
    savePlanCanvas(initial, storage)
    expect(getPlanCanvas(initial.id, storage)?.title).toBe('Better import flow')
    expect(values.has(PLAN_CANVAS_STORAGE_KEY)).toBe(true)

    const revised = revisePlanCanvas(
      initial,
      '# Better import flow\n\n- [x] Add a picker',
      { now: new Date('2026-08-11T12:05:00Z') }
    )
    savePlanCanvas(revised, storage)
    expect(listPlanCanvases(storage)).toHaveLength(1)
    expect(getPlanCanvas(initial.id, storage)?.revision).toBe(2)

    const draft = revisePlanCanvas(revised, revised.source)
    const editedDraft = { ...draft, source: `${draft.source}\n\nA local note.` }
    expect(commitPlanCanvasDraft(editedDraft).revision).toBe(3)

    removePlanCanvas(initial.id, storage)
    expect(getPlanCanvas(initial.id, storage)).toBeNull()
  })

  it('uses a stable workspace identity independent of root order', () => {
    expect(
      planCanvasWorkspaceKey({ label: 'Multi', roots: ['/B', '/A'] })
    ).toBe(
      planCanvasWorkspaceKey({ label: 'Renamed', roots: ['/A', '/B'] })
    )
  })

  it('parses visual plan blocks and preserves task line identity', () => {
    const source = [
      '# Release plan',
      '',
      'Keep the rollout reversible.',
      '',
      '- [ ] Build',
      '- [x] Test',
      '',
      '| Stage | Owner |',
      '| --- | --- |',
      '| Build | Agent |',
      '',
      '```mermaid',
      'flowchart LR',
      'A[Plan] --> B{Approved?}',
      'B -->|yes| C(Build)',
      '```',
    ].join('\n')
    const blocks = parsePlanCanvas(source)
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'tasks',
      'table',
      'diagram',
    ])
    const tasks = blocks.find((block) => block.kind === 'tasks')
    expect(tasks?.kind === 'tasks' ? tasks.items.map((item) => item.line) : []).toEqual([
      4,
      5,
    ])
    expect(togglePlanCanvasTask(source, 4)).toContain('- [x] Build')
  })

  it('turns a bounded Mermaid flowchart into safe nodes and edges', () => {
    const diagram = parsePlanCanvasDiagram(
      'flowchart TB\nA[Request] --> B{Complex?}\nB -->|yes| C[Plan]\nB -.-> D[Answer]'
    )
    expect(diagram.direction).toBe('TB')
    expect(diagram.nodes.map((node) => node.label)).toEqual([
      'Request',
      'Complex?',
      'Plan',
      'Answer',
    ])
    expect(diagram.edges).toEqual([
      { from: 'A', to: 'B', label: undefined, dashed: false },
      { from: 'B', to: 'C', label: 'yes', dashed: false },
      { from: 'B', to: 'D', label: undefined, dashed: true },
    ])
  })

  it('uses compare-and-swap so concurrent writers cannot silently overwrite', async () => {
    const store = createMemoryPlanCanvasStore()
    const initial = createPlanCanvas({
      id: 'shared-canvas',
      sessionId: 'session-one',
      scope: 'work',
      source: '# Shared plan',
      now: new Date('2026-08-11T12:00:00Z'),
    })
    expect(await store.save(initial, 0)).toMatchObject({ ok: true })

    const first = updatePlanCanvasDraft(initial, '# First writer')
    const second = updatePlanCanvasDraft(initial, '# Second writer')
    const [firstResult, secondResult] = await Promise.all([
      store.save(first, 1),
      store.save(second, 1),
    ])

    expect(firstResult).toMatchObject({ ok: true })
    expect(secondResult).toMatchObject({
      ok: false,
      reason: 'conflict',
    })
    expect((await store.get(initial.id))?.source).toBe('# First writer')
  })

  it('fences already-queued descendant writes after a conflict', async () => {
    const initial = createPlanCanvas({
      id: 'queued-conflict-canvas',
      sessionId: 'session-one',
      scope: 'work',
      source: '# Initial',
      now: new Date('2026-08-11T12:00:00Z'),
    })
    expect(
      await savePlanCanvasDurably(initial, { expectedRecordVersion: 0 })
    ).toMatchObject({ ok: true })
    const winner = updatePlanCanvasDraft(initial, '# Winner')
    const loser = updatePlanCanvasDraft(initial, '# Loser')
    const descendant = updatePlanCanvasDraft(loser, '# Descendant of loser')

    const [winnerResult, loserResult, descendantResult] = await Promise.all([
      savePlanCanvasDurably(winner, { expectedRecordVersion: 1 }),
      savePlanCanvasDurably(loser, { expectedRecordVersion: 1 }),
      savePlanCanvasDurably(descendant, { expectedRecordVersion: 2 }),
    ])

    expect(winnerResult).toMatchObject({ ok: true })
    expect(loserResult).toMatchObject({ ok: false, reason: 'conflict' })
    expect(descendantResult).toMatchObject({ ok: false, reason: 'conflict' })
    expect((await getPlanCanvasDurably(initial.id))?.source).toBe('# Winner')
  })

  it('keeps exact immutable revisions, distinguishes drafts, and frees them on removal', async () => {
    const store = createMemoryPlanCanvasStore()
    const initial = createPlanCanvas({
      id: 'revision-canvas',
      sessionId: 'session-one',
      scope: 'personal',
      source: '# Revision one',
      now: new Date('2026-08-11T12:00:00Z'),
    })
    await store.save(initial, 0)

    const draft = updatePlanCanvasDraft(
      initial,
      '# Revision two draft',
      new Date('2026-08-11T12:01:00Z')
    )
    await store.save(draft, 1)
    expect((await store.getRevision(initial.id, 1))?.source).toBe(
      '# Revision one'
    )
    expect(await store.getRevision(initial.id, 2)).toBeNull()

    const committed = await store.commitDraft(initial.id, 2)
    expect(committed).toMatchObject({
      ok: true,
      canvas: { revision: 2, source: '# Revision two draft' },
    })
    expect((await store.getRevision(initial.id, 2))?.source).toBe(
      '# Revision two draft'
    )
    expect((await store.getRevision(initial.id, 1))?.source).toBe(
      '# Revision one'
    )

    expect(await store.remove(initial.id, 3)).toMatchObject({ ok: true })
    expect(await store.get(initial.id)).toBeNull()
    expect(await store.getRevision(initial.id, 1)).toBeNull()
    expect(await store.getRevision(initial.id, 2)).toBeNull()
    expect(await store.listDeletedIds()).toContain(initial.id)
    expect(await store.save(draft, 3)).toMatchObject({
      ok: false,
      reason: 'deleted',
    })
  })

  it('does not allow a canvas id to move between workspace identities', async () => {
    const store = createMemoryPlanCanvasStore()
    const initial = createPlanCanvas({
      id: 'workspace-canvas',
      sessionId: 'session-one',
      scope: 'work',
      source: '# Scoped plan',
      binding: { id: 'workspace-a', label: 'A', roots: ['/A'] },
      now: new Date('2026-08-11T12:00:00Z'),
    })
    await store.save(initial, 0)
    expect(
      await store.save(
        {
          ...initial,
          workspaceKey: 'id:workspace-b',
          workspaceRoots: ['/B'],
          recordVersion: 2,
        },
        1
      )
    ).toMatchObject({ ok: false, reason: 'conflict' })
  })

  it('serializes only visible table and Mermaid content for a build', () => {
    const source = [
      '# Safe plan',
      '',
      '| Visible | Owner |',
      '| --- | --- |',
      '| Build | Ryan | HIDDEN TABLE INSTRUCTION |',
      '',
      '```mermaid',
      'flowchart LR',
      '%% HIDDEN MERMAID INSTRUCTION',
      'A[Plan] --> B[Build]',
      'classDef hidden fill:red',
      'click A "javascript:alert(1)"',
      '```',
    ].join('\n')

    const review = canonicalPlanCanvasBuildSource(source)
    expect(review.requiresNormalization).toBe(true)
    expect(review.source).toContain('| Build | Ryan |')
    expect(review.source).toContain('A[Plan]')
    expect(review.source).toContain('A --> B')
    expect(review.source).not.toContain('HIDDEN')
    expect(review.source).not.toContain('classDef')
    expect(review.source).not.toContain('javascript:')
  })

  it('never builds Mermaid label tails omitted by the SVG preview', () => {
    const hiddenNodeTail = `Node ${'visible '.repeat(20)}HIDDEN_NODE_TAIL`
    const hiddenEdgeTail = `edge-${'x'.repeat(50)}-HIDDEN_EDGE_TAIL`
    const review = canonicalPlanCanvasBuildSource(
      `\`\`\`mermaid\nflowchart LR\nA[${hiddenNodeTail}] -->|${hiddenEdgeTail}| B[Done]\n\`\`\``
    )
    expect(review.requiresNormalization).toBe(true)
    expect(review.source).not.toContain('HIDDEN_NODE_TAIL')
    expect(review.source).not.toContain('HIDDEN_EDGE_TAIL')
  })

  it('bounds rendered lists and active durable canvases with a clear result', async () => {
    const source = Array.from({ length: 300 }, (_unused, index) => `- Item ${index}`)
      .join('\n')
    const blocks = parsePlanCanvas(source)
    const list = blocks.find((block) => block.kind === 'list')
    expect(list?.kind === 'list' ? list.items.length : 0).toBe(240)
    expect(canonicalPlanCanvasBuildSource(source).requiresNormalization).toBe(true)

    const oversized = createPlanCanvas({
      id: 'oversized-source',
      sessionId: 'session-one',
      scope: 'personal',
      source: `# Large\n${'x'.repeat(300_001)}`,
    })
    expect(oversized.source.length).toBe(300_000)
    expect(oversized.sourceTruncated).toBe(true)

    const store = createMemoryPlanCanvasStore()
    for (let index = 0; index < MAX_ACTIVE_PLAN_CANVASES; index += 1) {
      const canvas = createPlanCanvas({
        id: `bounded-${index}`,
        sessionId: 'session-one',
        scope: 'personal',
        source: `# Canvas ${index}`,
      })
      expect(await store.save(canvas, 0)).toMatchObject({ ok: true })
    }
    const overflow = createPlanCanvas({
      id: 'bounded-overflow',
      sessionId: 'session-one',
      scope: 'personal',
      source: '# One too many',
    })
    expect(await store.save(overflow, 0)).toMatchObject({
      ok: false,
      reason: 'limit',
    })
  })

  it('enforces one aggregate table-cell budget across the document', () => {
    const header = `| ${Array.from({ length: 16 }, (_unused, index) => `H${index}`).join(' | ')} |`
    const divider = `| ${Array.from({ length: 16 }, () => '---').join(' | ')} |`
    const row = `| ${Array.from({ length: 16 }, () => 'cell').join(' | ')} |`
    const source = Array.from(
      { length: 30 },
      () => [header, divider, ...Array.from({ length: 10 }, () => row)].join('\n')
    ).join('\n\n')
    const tables = parsePlanCanvas(source).filter(
      (block) => block.kind === 'table'
    )
    const cells = tables.reduce(
      (total, table) =>
        total +
        (table.kind === 'table'
          ? table.headers.length + table.rows.length * table.headers.length
          : 0),
      0
    )
    expect(cells).toBeLessThanOrEqual(2_000)
    expect(canonicalPlanCanvasBuildSource(source).requiresNormalization).toBe(true)
  })

  it('catches a rejected debounced draft save and reports a terminal result', async () => {
    vi.useFakeTimers()
    const canvas = createPlanCanvas({
      id: 'debounced-canvas',
      sessionId: 'session-one',
      scope: 'personal',
      source: '# Draft',
    })
    const failingStore: PlanCanvasStore = {
      list: async () => [],
      listDeletedIds: async () => [],
      get: async () => null,
      getRevision: async () => null,
      save: async () => {
        throw new Error('Disk unavailable')
      },
      commitDraft: async () => ({ ok: false, reason: 'missing' }),
      remove: async () => ({ ok: false, reason: 'missing' }),
    }
    const onResult = vi.fn()
    schedulePlanCanvasDraftSave(canvas, {
      expectedRecordVersion: 0,
      delayMs: 50,
      store: failingStore,
      onResult,
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(onResult).toHaveBeenCalledWith({
      ok: false,
      reason: 'storage',
      error: 'Disk unavailable',
    })
  })

  it('coalesces draft edits against the first durable CAS base', async () => {
    vi.useFakeTimers()
    const initial = createPlanCanvas({
      id: 'coalesced-canvas',
      sessionId: 'session-one',
      scope: 'personal',
      source: '# Initial',
    })
    const first = updatePlanCanvasDraft(initial, '# First draft')
    const latest = updatePlanCanvasDraft(first, '# Latest draft')
    const save = vi.fn(async (candidate, expectedRecordVersion: number) => ({
      ok: true as const,
      canvas: { ...candidate, recordVersion: expectedRecordVersion + 1 },
    }))
    const store: PlanCanvasStore = {
      list: async () => [],
      listDeletedIds: async () => [],
      get: async () => null,
      getRevision: async () => null,
      save,
      commitDraft: async () => ({ ok: false, reason: 'missing' }),
      remove: async () => ({ ok: false, reason: 'missing' }),
    }
    schedulePlanCanvasDraftSave(first, {
      expectedRecordVersion: 1,
      delayMs: 50,
      store,
    })
    schedulePlanCanvasDraftSave(latest, {
      expectedRecordVersion: 2,
      delayMs: 50,
      store,
    })

    await vi.advanceTimersByTimeAsync(50)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toMatchObject({ source: '# Latest draft' })
    expect(save.mock.calls[0]?.[1]).toBe(1)

    const next = updatePlanCanvasDraft(latest, '# Next burst')
    schedulePlanCanvasDraftSave(next, {
      expectedRecordVersion: 3,
      delayMs: 50,
      store,
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(save.mock.calls[1]?.[1]).toBe(2)
  })

  it('keeps production compatibility sync memory-only instead of rewriting localStorage', async () => {
    const canvas = createPlanCanvas({
      id: 'memory-only-canvas',
      sessionId: 'session-one',
      scope: 'personal',
      source: '# Memory first',
    })
    savePlanCanvas(canvas)
    expect(values.has(PLAN_CANVAS_STORAGE_KEY)).toBe(false)
    expect(getPlanCanvasPersistenceState(canvas.id).status).toBe('pending')
    await flushPlanCanvasPersistence(canvas.id)
    expect(getPlanCanvasPersistenceState(canvas.id).status).toBe('saved')
    removePlanCanvas(canvas.id)
    await flushPlanCanvasPersistence(canvas.id)
    expect(values.has(PLAN_CANVAS_STORAGE_KEY)).toBe(false)
  })
})
