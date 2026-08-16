import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAgentLocalState,
  loadAgentLocalState,
  saveAgentLocalState,
  saveAgentDraftShadow,
  saveWorkspaceAgentSessionId,
  workspaceAgentSessionId,
} from './agentLocalState'

describe('per-tab Intelligence draft shadow', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('restores text immediately even when IndexedDB is unavailable', async () => {
    saveAgentDraftShadow('session-a', 'keep this text')
    const state = await loadAgentLocalState('session-a')
    expect(state.draft).toBe('keep this text')
  })

  it('clears only the selected tab draft', async () => {
    saveAgentDraftShadow('session-a', 'first')
    saveAgentDraftShadow('session-b', 'second')
    await clearAgentLocalState('session-a')
    expect((await loadAgentLocalState('session-a')).draft).toBe('')
    expect((await loadAgentLocalState('session-b')).draft).toBe('second')
  })

  it('preserves an editable message queue per conversation', async () => {
    await saveAgentLocalState('session-queue', {
      draft: 'still composing',
      chatAttachments: [],
      queuedPrompts: [
        {
          id: 'queued-1',
          text: 'Use the compact layout instead.',
          attachments: [],
          workspaceBinding: {
            id: '0123456789abcdefabcd',
            label: 'StatsKey',
            roots: ['/Projects/StatsKey'],
          },
        },
      ],
    })

    expect(await loadAgentLocalState('session-queue')).toEqual({
      draft: 'still composing',
      chatAttachments: [],
      queuedPrompts: [
        {
          id: 'queued-1',
          text: 'Use the compact layout instead.',
          attachments: [],
          workspaceBinding: {
            id: '0123456789abcdefabcd',
            label: 'StatsKey',
            roots: ['/Projects/StatsKey'],
          },
        },
      ],
    })
  })

  it('keeps one active Intelligence conversation per workspace', () => {
    const statsKey = workspaceAgentSessionId('statskey-workspace')
    expect(workspaceAgentSessionId('statskey-workspace')).toBe(statsKey)
    expect(workspaceAgentSessionId('another-workspace')).not.toBe(statsKey)

    const replacement = '00000000-0000-4000-8000-000000000000'
    saveWorkspaceAgentSessionId('statskey-workspace', replacement)
    expect(workspaceAgentSessionId('statskey-workspace')).toBe(replacement)
  })
})
