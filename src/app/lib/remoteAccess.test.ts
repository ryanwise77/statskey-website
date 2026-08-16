import { describe, expect, it } from 'vitest'
import {
  decodeRemoteAccessPreferences,
  decodeRemoteCommand,
  decodeRemoteExecutor,
  isRemoteExecutorOnline,
  remoteAgentPrompt,
  stageRemoteAgentCommand,
  takeRemoteAgentCommand,
} from './remoteAccess'

describe('remote access decoders', () => {
  it('defaults to explicit opt-out and confirmation', () => {
    expect(decodeRemoteAccessPreferences({})).toMatchObject({
      enabled: false,
      allowMacMini: false,
      allowDataCenter: false,
      requireConfirmation: true,
      onboardingChoice: 'unset',
    })
    expect(
      decodeRemoteAccessPreferences({ requireConfirmation: false })
        .requireConfirmation
    ).toBe(true)
  })

  it('fails unknown command values into safe display states', () => {
    const command = decodeRemoteCommand(
      {
        target: 'other-host',
        kind: 'shell.arbitrary',
        status: 'forged',
        prompt: 42,
      },
      'command-1'
    )
    expect(command.target).toBe('data-center')
    expect(command.kind).toBe('ai.prompt')
    expect(command.status).toBe('unknown')
    expect(command.prompt).toBeUndefined()
  })

  it('requires a live stale-after deadline to show a desktop online', () => {
    const executor = decodeRemoteExecutor(
      {
        label: 'Ryan MacBook',
        platform: 'desktop',
        status: 'online',
        staleAfter: new Date('2026-08-15T15:02:00.000Z'),
        capabilities: ['mac-mini', 'invalid', 'data-center'],
      },
      'desktop-main'
    )
    expect(executor.capabilities).toEqual(['mac-mini', 'data-center'])
    expect(
      isRemoteExecutorOnline(
        executor,
        new Date('2026-08-15T15:01:00.000Z')
      )
    ).toBe(true)
    expect(
      isRemoteExecutorOnline(
        executor,
        new Date('2026-08-15T15:03:00.000Z')
      )
    ).toBe(false)
  })

  it('hands a claimed command to Flow exactly once', () => {
    stageRemoteAgentCommand({
      commandId: 'command-1',
      executorId: 'desktop-main',
      claimToken: 'one-time-token',
      target: 'data-center',
      prompt: 'Check seismic readiness.',
      sessionId: 'REMOTE-SESSION-1',
    })
    expect(takeRemoteAgentCommand('REMOTE-SESSION-1')).toMatchObject({
      commandId: 'command-1',
      target: 'data-center',
    })
    expect(takeRemoteAgentCommand('REMOTE-SESSION-1')).toBeNull()
  })

  it('adds a target-specific safety boundary to remote prompts', () => {
    expect(remoteAgentPrompt('mac-mini', 'Check disk use.')).toContain(
      'Never request, print, or copy private key material.'
    )
    expect(remoteAgentPrompt('data-center', 'Check ingestion.')).toContain(
      'active Oil Data workspace'
    )
    expect(remoteAgentPrompt('data-center', 'Check ingestion.')).toContain(
      'private preview is read-only'
    )
  })
})
