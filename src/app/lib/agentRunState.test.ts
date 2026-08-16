import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_STEERING_CONSUMED_EVENT,
  clearActiveAgentRun,
  getActiveAgentRun,
  getActiveAgentRuns,
  interleaveActiveAgentRun,
  notifyAgentRunSteeringConsumed,
  pauseLatestActiveAgentRunForInput,
  registerActiveAgentRunControl,
  registerActiveAgentRunSteering,
  requestActiveAgentRunStop,
  requestActiveAgentRunSteering,
  resumeActiveAgentRunAfterInput,
  setActiveAgentRun,
  sweepOrphanedAgentRuns,
  updateActiveAgentRun,
} from './agentRunState'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class TestCustomEvent<T> extends Event {
  readonly detail: T

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type)
    this.detail = init?.detail as T
  }
}

describe('agent run state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('CustomEvent', TestCustomEvent)
  })

  it('persists bounded action-level progress for other tabs', () => {
    setActiveAgentRun({
      sessionId: 'session-1',
      messageId: 'message-1',
      title: 'Inspect the app',
      startedAt: Date.now(),
      contextScope: 'work',
      objective: 'Make the coding agent persist through recoverable tool failures.',
      workspaceLabel: 'StatsKey Website',
      workspaceRoots: ['/Users/example/StatsKey Website'],
      phase: 'starting',
    })
    updateActiveAgentRun('session-1', {
      phase: 'finishing',
      currentAction: 'Reading selected local files',
      currentLocation: 'StatsKey Website · Flow.tsx',
      lastCompleted: 'Searching local files · 2 file matches',
      nextAction: 'Choose the smallest exact edit.',
      liveUpdate: 'I found the route. I am checking how its state survives a tab switch.',
      completedSteps: 2,
      totalSteps: 3,
      recentSteps: [
        {
          id: 'read-1',
          name: 'workspace_read',
          label: 'Reading selected local files',
          summary: 'workspace_read(file_refs: [2])',
          resultMeta: '2 files read',
          status: 'running',
          agent: 'Lead agent',
          preview: {
            kind: 'files',
            title: 'Reading 2 files',
            checkpointId: '8efc395c-d3c9-4cca-9f92-9dc0e40595c3',
            items: [
              { label: 'Flow.tsx' },
              { label: 'agentRunState.ts' },
            ],
          },
        },
      ],
      taskExpectation: 'workspace-change',
    })

    expect(getActiveAgentRuns()).toMatchObject([
      {
        sessionId: 'session-1',
        messageId: 'message-1',
        phase: 'finishing',
        objective: 'Make the coding agent persist through recoverable tool failures.',
        workspaceLabel: 'StatsKey Website',
        workspaceRoots: ['/Users/example/StatsKey Website'],
        currentAction: 'Reading selected local files',
        currentLocation: 'StatsKey Website · Flow.tsx',
        lastCompleted: 'Searching local files · 2 file matches',
        nextAction: 'Choose the smallest exact edit.',
        liveUpdate: 'I found the route. I am checking how its state survives a tab switch.',
        completedSteps: 2,
        totalSteps: 3,
        recentSteps: [
          {
            name: 'workspace_read',
            summary: 'workspace_read(file_refs: [2])',
            resultMeta: '2 files read',
            preview: {
              kind: 'files',
              title: 'Reading 2 files',
              checkpointId: '8efc395c-d3c9-4cca-9f92-9dc0e40595c3',
              items: [
                { label: 'Flow.tsx' },
                { label: 'agentRunState.ts' },
              ],
            },
          },
        ],
        taskExpectation: 'workspace-change',
      },
    ])
    clearActiveAgentRun('session-1')
    expect(getActiveAgentRuns()).toEqual([])
  })

  it('persists inspectable source-backed investigation summaries safely', () => {
    setActiveAgentRun({
      sessionId: 'research-session',
      title: 'Research the implementation',
      startedAt: Date.now(),
      contextScope: 'work',
      phase: 'working',
      recentSteps: [
        {
          id: 'investigation-1',
          name: 'investigation',
          label: 'Researching · Verify the current architecture',
          status: 'done',
          preview: {
            kind: 'investigation',
            title: 'Verify the current architecture',
            objective: 'Compare the source implementation with primary evidence.',
            summary: 'The current implementation uses bounded, typed workstreams.',
            sourceUrls: [
              'https://example.com/architecture',
              'javascript:alert(1)',
            ],
          },
        },
      ],
    })

    expect(
      getActiveAgentRuns().find((run) => run.sessionId === 'research-session')
        ?.recentSteps?.[0]
    ).toMatchObject({
      name: 'investigation',
      preview: {
        kind: 'investigation',
        title: 'Verify the current architecture',
        objective: 'Compare the source implementation with primary evidence.',
        summary: 'The current implementation uses bounded, typed workstreams.',
        sourceUrls: ['https://example.com/architecture'],
      },
    })
  })

  it('keeps a stop control available after the chat view changes', () => {
    let stopped = false
    const unregister = registerActiveAgentRunControl('session-2', () => {
      stopped = true
    })

    expect(requestActiveAgentRunStop('session-2')).toBe(true)
    expect(stopped).toBe(true)
    unregister()
    expect(requestActiveAgentRunStop('session-2')).toBe(false)
  })

  it('keeps progress when transient renderer storage is replaced', () => {
    setActiveAgentRun({
      sessionId: 'restart-session',
      title: 'Build the requested feature',
      startedAt: Date.now(),
      contextScope: 'work',
      objective: 'Build the requested feature and verify it.',
      phase: 'working',
      lastCompleted: 'Updated the document model',
      nextAction: 'Run focused tests',
      taskExpectation: 'workspace-change',
    })

    vi.stubGlobal('sessionStorage', new MemoryStorage())

    expect(getActiveAgentRuns()).toMatchObject([
      {
        sessionId: 'restart-session',
        objective: 'Build the requested feature and verify it.',
        lastCompleted: 'Updated the document model',
        nextAction: 'Run focused tests',
        taskExpectation: 'workspace-change',
      },
    ])
  })

  it('sweeps reloaded runs that no longer have live controls', () => {
    const now = Date.now()
    setActiveAgentRun({
      sessionId: 'zombie-session',
      title: 'Interrupted work',
      startedAt: now - 60_000,
      contextScope: 'work',
      phase: 'working',
      lastActivityAt: now - 30_000,
    })
    setActiveAgentRun({
      sessionId: 'live-session',
      title: 'Live work',
      startedAt: now - 59_000,
      contextScope: 'work',
      phase: 'working',
      lastActivityAt: now - 30_000,
    })
    const unregister = registerActiveAgentRunControl('live-session', () => {})
    setActiveAgentRun({
      sessionId: 'fresh-session',
      title: 'Just started',
      startedAt: now,
      contextScope: 'work',
      phase: 'starting',
      lastActivityAt: now,
    })

    const swept = sweepOrphanedAgentRuns(15_000, now)

    expect(swept.map((run) => run.sessionId)).toEqual(['zombie-session'])
    expect(getActiveAgentRuns().map((run) => run.sessionId)).toEqual([
      'zombie-session',
      'live-session',
      'fresh-session',
    ])
    clearActiveAgentRun('zombie-session')
    expect(getActiveAgentRuns().map((run) => run.sessionId)).toEqual([
      'live-session',
      'fresh-session',
    ])
    unregister()
  })

  it('pauses the most recent run for approval and restores its prior phase', () => {
    const startedAt = Date.now()
    setActiveAgentRun({
      sessionId: 'older-session',
      title: 'Older work',
      startedAt,
      contextScope: 'work',
      phase: 'working',
    })
    setActiveAgentRun({
      sessionId: 'newer-session',
      title: 'Newer work',
      startedAt: startedAt + 1,
      contextScope: 'work',
      phase: 'thinking',
      currentAction: 'Choosing the smallest change',
      nextAction: 'Update the selected file.',
    })

    expect(pauseLatestActiveAgentRunForInput('approval-1')).toBe(
      'newer-session'
    )
    expect(
      getActiveAgentRuns().find((run) => run.sessionId === 'newer-session')
    ).toMatchObject({
      phase: 'needs-input',
      currentAction: 'Waiting for your approval to continue',
    })
    expect(
      getActiveAgentRuns().find((run) => run.sessionId === 'older-session')
    ).toMatchObject({ phase: 'working' })

    expect(resumeActiveAgentRunAfterInput('approval-1')).toBe(true)
    expect(
      getActiveAgentRuns().find((run) => run.sessionId === 'newer-session')
    ).toMatchObject({
      phase: 'thinking',
      currentAction: 'Choosing the smallest change',
      nextAction: 'Update the selected file.',
    })
  })

  it('stays paused until every queued approval for the run is resolved', () => {
    setActiveAgentRun({
      sessionId: 'queued-approval-session',
      title: 'Change two files',
      startedAt: Date.now(),
      contextScope: 'work',
      phase: 'working',
      currentAction: 'Updating the project',
    })

    pauseLatestActiveAgentRunForInput('approval-a')
    pauseLatestActiveAgentRunForInput('approval-b')
    updateActiveAgentRun('queued-approval-session', {
      phase: 'working',
      currentAction: 'The first approved operation finished',
    })
    expect(resumeActiveAgentRunAfterInput('approval-a')).toBe(true)
    expect(getActiveAgentRun()).toMatchObject({
      phase: 'needs-input',
      currentAction: 'Waiting for your approval to continue',
    })

    expect(resumeActiveAgentRunAfterInput('approval-b')).toBe(true)
    expect(getActiveAgentRun()).toMatchObject({
      phase: 'working',
      currentAction: 'The first approved operation finished',
    })
  })

  it('pauses the originating tab when several runs are active', () => {
    const startedAt = Date.now()
    setActiveAgentRun({
      sessionId: 'older-origin',
      title: 'Older work',
      startedAt,
      contextScope: 'work',
      phase: 'working',
    })
    setActiveAgentRun({
      sessionId: 'newer-other-tab',
      title: 'Newer work',
      startedAt: startedAt + 1,
      contextScope: 'work',
      phase: 'thinking',
    })

    expect(
      pauseLatestActiveAgentRunForInput('origin-approval', 'older-origin')
    ).toBe('older-origin')
    expect(
      getActiveAgentRuns().find((run) => run.sessionId === 'older-origin')
    ).toMatchObject({ phase: 'needs-input' })
    expect(
      getActiveAgentRuns().find((run) => run.sessionId === 'newer-other-tab')
    ).toMatchObject({ phase: 'thinking' })
  })

  it('does not let a late approval restore a newer run in the same chat', () => {
    const startedAt = Date.now()
    setActiveAgentRun({
      sessionId: 'reused-session',
      title: 'First turn',
      startedAt,
      contextScope: 'work',
      phase: 'working',
    })
    pauseLatestActiveAgentRunForInput('old-approval')
    clearActiveAgentRun('reused-session')
    setActiveAgentRun({
      sessionId: 'reused-session',
      title: 'Second turn',
      startedAt: startedAt + 1,
      contextScope: 'work',
      phase: 'finishing',
    })

    expect(resumeActiveAgentRunAfterInput('old-approval')).toBe(false)
    expect(getActiveAgentRun()).toMatchObject({
      title: 'Second turn',
      phase: 'finishing',
    })
  })

  it('clears a terminal timed-out run without disturbing another tab', () => {
    const startedAt = Date.now()
    setActiveAgentRun({
      sessionId: 'timed-out-session',
      title: 'Recover provider',
      startedAt,
      contextScope: 'work',
      phase: 'finishing',
    })
    setActiveAgentRun({
      sessionId: 'other-session',
      title: 'Independent task',
      startedAt: startedAt + 1,
      contextScope: 'work',
      phase: 'working',
    })

    clearActiveAgentRun('timed-out-session')

    expect(getActiveAgentRuns().map((run) => run.sessionId)).toEqual([
      'other-session',
    ])
  })

  it('delivers and acknowledges steering across mounted chat views', () => {
    const received: string[] = []
    const consumed: string[] = []
    window.addEventListener(AGENT_STEERING_CONSUMED_EVENT, (event) => {
      const detail = (
        event as CustomEvent<{ sessionId: string; messageIds: string[] }>
      ).detail
      if (detail.sessionId === 'session-3') consumed.push(...detail.messageIds)
    })
    const unregister = registerActiveAgentRunSteering(
      'session-3',
      (message) => received.push(message.text)
    )

    expect(
      requestActiveAgentRunSteering('session-3', {
        id: 'queue-1',
        messageId: 'message-1',
        text: 'Keep the layout compact.',
        content: 'Keep the layout compact.',
        timestamp: Date.now(),
      })
    ).toBe(true)
    notifyAgentRunSteeringConsumed('session-3', ['queue-1'])

    expect(received).toEqual(['Keep the layout compact.'])
    expect(consumed).toEqual(['queue-1'])
    unregister()
    expect(
      requestActiveAgentRunSteering('session-3', {
        id: 'queue-2',
        messageId: 'message-2',
        text: 'No longer connected.',
        content: 'No longer connected.',
        timestamp: Date.now(),
      })
    ).toBe(false)
  })

  it('keeps follow-up messages below the live work they are responding to', () => {
    const run = {
      sessionId: 'session-4',
      messageId: 'initial',
      title: 'Fix the layout',
      startedAt: Date.now(),
      contextScope: 'work' as const,
    }
    const entries = interleaveActiveAgentRun(
      [
        { id: 'initial', text: 'Fix the layout.' },
        { id: 'follow-up', text: 'Keep it compact.' },
      ],
      run
    )

    expect(
      entries.map((entry) =>
        entry.kind === 'run' ? 'live-run' : entry.message.id
      )
    ).toEqual(['initial', 'live-run', 'follow-up'])
  })
})
