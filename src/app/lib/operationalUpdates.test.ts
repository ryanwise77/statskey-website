import { describe, expect, it } from 'vitest'
import type { ChatSessionMessage } from './data/useChatSessions'
import {
  INTERRUPTED_RUN_MESSAGE,
  operationalUpdateState,
  recoverInterruptedOperationalTranscript,
  settleOperationalUpdates,
  upsertOperationalUpdate,
} from './operationalUpdates'

function update(
  messages: ChatSessionMessage[],
  key: string,
  content: string,
  state: 'running' | 'done' | 'error' = 'running'
) {
  return upsertOperationalUpdate(messages, {
    id: `id-${key}`,
    key,
    content,
    state,
    timestamp: new Date('2026-08-09T16:00:00Z'),
  })
}

describe('operational updates', () => {
  it('settles the previous row when a new operation starts', () => {
    const first = update([], 'run:search', 'Searching files')
    const second = update(first, 'run:read', 'Reading the target')

    expect(second).toHaveLength(2)
    expect(second[0].operationalState).toBe('done')
    expect(second[1].operationalState).toBe('running')
  })

  it('updates a repeated operation in place instead of appending duplicates', () => {
    const first = update([], 'run:workout', 'Reading workout 1')
    const second = update(
      first,
      'run:workout',
      'Read workout details · 3 completed',
      'done'
    )

    expect(second).toHaveLength(1)
    expect(second[0].content).toContain('3 completed')
    expect(second[0].operationalState).toBe('done')
  })

  it('keeps new run activity below a follow-up sent while working', () => {
    const first = update([], 'run:read', 'Reading the target')
    const followUp: ChatSessionMessage = {
      id: 'follow-up',
      role: 'user',
      content: 'Keep the existing layout compact.',
      timestamp: new Date('2026-08-09T16:00:01Z'),
    }
    const next = update(
      [...first, followUp],
      'run:read',
      'Finished reading the target',
      'done'
    )

    expect(next).toHaveLength(3)
    expect(next[1]).toBe(followUp)
    expect(next[2]).toMatchObject({
      operational: true,
      operationalKey: 'run:read',
      content: 'Finished reading the target',
    })
  })

  it('removes every active indicator at terminal completion', () => {
    const messages = update([], 'run:answer', 'Writing the response')
    expect(settleOperationalUpdates(messages)[0].operationalState).toBe('done')
  })

  it('turns an interrupted persisted spinner into a retryable failure', () => {
    const messages = update([], 'run:answer', 'Writing the response')
    const recovered = recoverInterruptedOperationalTranscript(messages, {
      id: 'interrupted-run',
      timestamp: new Date('2026-08-14T20:49:00Z'),
    })

    expect(recovered).toHaveLength(2)
    expect(recovered[0].operationalState).toBe('error')
    expect(recovered[1]).toMatchObject({
      id: 'interrupted-run',
      role: 'model',
      content: INTERRUPTED_RUN_MESSAGE,
    })
    expect(recovered[1].operational).toBeUndefined()
  })

  it('preserves completed action evidence for an interrupted continuation', () => {
    const recovered = recoverInterruptedOperationalTranscript(
      update([], 'run:build', 'Building the feature'),
      {
        id: 'interrupted-with-progress',
        timestamp: new Date('2026-08-14T20:49:00Z'),
        run: {
          sessionId: 'session-with-progress',
          messageId: 'prompt-with-progress',
          startedAt: new Date('2026-08-14T20:45:00Z').getTime(),
          workspaceId: 'workspace-0123456789',
          workspaceLabel: 'StatsKey Website',
          workspaceRoots: ['/Users/example/StatsKey Website'],
          agentMode: 'agent',
          taskExpectation: 'workspace-change',
          recentSteps: [
            {
              name: 'workspace_write',
              summary: 'Updated the document model',
              resultMeta: 'file changed · persisted 0123456789ab',
              status: 'done',
            },
            {
              name: 'run_terminal',
              summary: 'Run focused tests',
              status: 'running',
            },
          ],
        },
      },
      true
    )

    expect(recovered[1]).toMatchObject({
      agentMode: 'agent',
      taskExpectation: 'workspace-change',
      durationMs: 240_000,
      interruptedRun: {
        runId: `session-with-progress:${new Date(
          '2026-08-14T20:45:00Z'
        ).getTime()}`,
        sessionId: 'session-with-progress',
        messageId: 'prompt-with-progress',
        workspaceId: 'workspace-0123456789',
        workspaceLabel: 'StatsKey Website',
        workspaceRoots: ['/Users/example/StatsKey Website'],
      },
      steps: [
        {
          name: 'workspace_write',
          failed: undefined,
          resultMeta: 'file changed · persisted 0123456789ab',
        },
        {
          name: 'run_terminal',
          failed: true,
          resultMeta: 'run interrupted before this action completed',
        },
      ],
    })
  })

  it('does not add an interruption when no spinner is stale', () => {
    const messages = update([], 'run:answer', 'Response finished', 'done')
    expect(
      recoverInterruptedOperationalTranscript(messages, {
        id: 'unneeded-interruption',
        timestamp: new Date(),
      })
    ).toBe(messages)
  })

  it('deduplicates forced recovery for the same persisted run identity', () => {
    const run = {
      sessionId: 'same-run',
      startedAt: new Date('2026-08-14T20:45:00Z').getTime(),
    }
    const messages = recoverInterruptedOperationalTranscript(
      update([], 'run:answer', 'Writing the response'),
      { id: 'first-recovery', timestamp: new Date(), run }
    )
    const recoveredAgain = recoverInterruptedOperationalTranscript(
      messages,
      { id: 'second-recovery', timestamp: new Date(), run },
      true
    )

    expect(
      recoveredAgain.filter(
        (message) => message.content === INTERRUPTED_RUN_MESSAGE
      )
    ).toHaveLength(1)
  })

  it('keeps separate recovery actions for genuinely separate runs', () => {
    const first = recoverInterruptedOperationalTranscript(
      update([], 'run:first', 'Writing the first response'),
      {
        id: 'first-recovery',
        timestamp: new Date(),
        run: { sessionId: 'first-run', startedAt: 1 },
      }
    )
    const second = recoverInterruptedOperationalTranscript(
      first,
      {
        id: 'second-recovery',
        timestamp: new Date(),
        run: { sessionId: 'second-run', startedAt: 2 },
      },
      true
    )

    expect(second.filter((message) => message.interruptedRun)).toHaveLength(2)
  })

  it('can preserve two genuinely parallel running operations', () => {
    const first = upsertOperationalUpdate([], {
      id: 'one',
      key: 'run:one',
      content: 'Reading one source',
      state: 'running',
      timestamp: new Date(),
      settlePrevious: false,
    })
    const second = upsertOperationalUpdate(first, {
      id: 'two',
      key: 'run:two',
      content: 'Reading another source',
      state: 'running',
      timestamp: new Date(),
      settlePrevious: false,
    })

    expect(second.map((message) => message.operationalState)).toEqual([
      'running',
      'running',
    ])
  })

  it('treats legacy persisted updates as completed', () => {
    expect(operationalUpdateState({})).toBe('done')
  })
})
