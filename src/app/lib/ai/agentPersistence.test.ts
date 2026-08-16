import { describe, expect, it } from 'vitest'
import {
  WorkspaceWriteFailureGuard,
  agentModeForPrompt,
  agentTaskExpectationForPrompt,
  completionHandoffPrompt,
  externalActionReadyForHandoff,
  fallbackCompletionHandoff,
  fallbackStoppedHandoff,
  hasReviewableWorkspaceChange,
  hasOutstandingFileMutationFailure,
  hasSuccessfulFileChange,
  implementationChangeEvidence,
  implementationCheckpoint,
  implementationReadyForHandoff,
  implementationRecoveryPrompt,
  implementationToolPhase,
  isMeaningfulImplementationVerification,
  pendingImplementationMode,
  pendingImplementationRouting,
  providerTimeoutRecoveryPrompt,
  workspaceChangeExpected,
  workspaceWritePayloadFingerprint,
  workspaceWriteRecoveryReadNeeded,
} from './agentPersistence'

describe('agent implementation persistence', () => {
  const persistedChangeProof = {
    items: [{ label: 'Persisted change verified' }],
  }

  it('suppresses only an exact third failed edit and resets after a reread', () => {
    const guard = new WorkspaceWriteFailureGuard()
    const first = {
      file_path: 'Sources/App.swift',
      edits: [{ old_text: 'old', new_text: 'new' }],
    }
    const corrected = {
      file_path: 'Sources/App.swift',
      edits: [{ old_text: 'old with context', new_text: 'new' }],
    }
    expect(workspaceWritePayloadFingerprint(first)).not.toBe(
      workspaceWritePayloadFingerprint(corrected)
    )
    guard.recordFailure(first)
    guard.recordFailure(first)
    expect(guard.shouldSuppress(first)).toBe(true)
    expect(guard.shouldSuppress(corrected)).toBe(false)
    guard.resetAfterSuccessfulReadOrWrite()
    expect(guard.shouldSuppress(first)).toBe(false)
  })

  it('keeps a recovery reread available after a failed edit', () => {
    const failedWrite = {
      name: 'workspace_write',
      status: 'error' as const,
    }
    expect(workspaceWriteRecoveryReadNeeded([failedWrite])).toBe(true)
    expect(
      workspaceWriteRecoveryReadNeeded([
        failedWrite,
        { name: 'workspace_read', status: 'done' as const },
      ])
    ).toBe(false)
  })

  it('keeps recovery open after a truncated prefix and closes after an exact range', () => {
    const failedWrite = {
      name: 'workspace_write',
      status: 'error' as const,
    }
    const truncatedPrefix = {
      name: 'workspace_read',
      summary: 'workspace_read(file_path: "Sources/Large.swift")',
      resultMeta: '1 files read · truncated · continue at line 256',
      status: 'done' as const,
    }
    expect(
      workspaceWriteRecoveryReadNeeded([failedWrite, truncatedPrefix])
    ).toBe(true)
    expect(
      workspaceWriteRecoveryReadNeeded([
        failedWrite,
        truncatedPrefix,
        {
          name: 'workspace_read',
          summary:
            'workspace_read(file_path: "Sources/Large.swift", start_line: 520, end_line: 775)',
          resultMeta: '1 files read · lines 520-775 of 775',
          status: 'done' as const,
        },
      ])
    ).toBe(false)
  })

  it('does not accept a recoverable no-edit Build response as completion', () => {
    const steps = [
      {
        name: 'workspace_search',
        summary: 'workspace_search(query: "CameraCaptureView.swift")',
        resultMeta: '0 file matches',
        status: 'error' as const,
      },
    ]
    expect(implementationRecoveryPrompt('agent', steps, 0)).toContain(
      'index is not an editing permission boundary'
    )
    expect(implementationRecoveryPrompt('agent', steps, 2)).toContain(
      'Do not end the Execute/Fix run yet'
    )
    expect(implementationRecoveryPrompt('agent', steps, 3)).toBeNull()
  })

  it('stops recovery once a reviewed file change succeeds', () => {
    const steps = [
      {
        name: 'workspace_write',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
        status: 'done' as const,
      },
    ]
    expect(hasSuccessfulFileChange(steps)).toBe(true)
    expect(implementationRecoveryPrompt('agent', steps, 0)).toContain(
      'no focused verification'
    )
  })

  it('does not accept file-changed copy without exact persisted-change proof', () => {
    const unverified = {
      name: 'workspace_write',
      resultMeta: 'file changed',
      status: 'done' as const,
    }

    expect(hasSuccessfulFileChange([unverified])).toBe(false)
    expect(implementationChangeEvidence([unverified])).toEqual({
      kind: 'none',
      steps: [],
    })
  })

  it('does not count a restored checkpoint as a newly authored file change', () => {
    const restored = {
      name: 'restore_checkpoint',
      resultMeta: 'checkpoint restored',
      status: 'done' as const,
    }

    expect(hasSuccessfulFileChange([restored])).toBe(false)
    expect(implementationChangeEvidence([restored])).toEqual({
      kind: 'none',
      steps: [],
    })
  })

  it('warns a circling implementation at a bounded checkpoint', () => {
    const repeated = Array.from({ length: 3 }, () => ({
      name: 'workspace_read',
      summary: 'workspace_read(file_paths: [1])',
      resultMeta: '1 files read',
      status: 'done' as const,
    }))
    expect(implementationCheckpoint('agent', 8, repeated)).toContain(
      'Stop repeating'
    )
    expect(implementationCheckpoint('agent', 8, repeated)).toContain(
      'task-scoped git_diff file_paths'
    )
    expect(implementationCheckpoint('agent', 8, repeated)).toContain(
      'Do not reopen broad search or manifest discovery'
    )
    expect(implementationCheckpoint('ask', 8, repeated)).toBeNull()
  })

  it('asks the action checkpoint to adopt a relevant dirty diff before editing', () => {
    const checkpoint = implementationCheckpoint('agent', 4, [])

    expect(checkpoint).toContain('read the exact relevant file')
    expect(checkpoint).toContain('task-scoped dirty diff')
    expect(checkpoint).toContain('verify it instead of making a redundant edit')
    expect(checkpoint).toContain('Do not return to broad search or manifest discovery')
  })

  it('closes evidence collection immediately on a continuation that inherited ten actions', () => {
    const evidence = Array.from({ length: 10 }, (_, index) => ({
      name: index % 2 === 0 ? 'workspace_read' : 'git_diff',
      summary: `Library evidence ${index}`,
      status: 'done' as const,
    }))

    const checkpoint = implementationCheckpoint('debug', 0, evidence)
    expect(checkpoint).toContain('evidence budget is closed')
    expect(checkpoint).toContain('Do not repeat terminal commands, searches, workspace reads, or task-scoped git_diff')
    expect(checkpoint).toContain('smallest real workspace_write')
    expect(checkpoint).toContain('empty file is not an implementation')
    expect(checkpoint).toContain('verification lane will restore run_terminal')
  })

  it('counts durable nonempty creates after previews are stripped but rejects empty creates', () => {
    const emptyCreate = {
      name: 'workspace_create',
      status: 'done' as const,
      resultMeta: 'empty file created',
    }
    expect(hasSuccessfulFileChange([emptyCreate])).toBe(false)
    expect(
      hasSuccessfulFileChange([
        {
          name: 'workspace_create',
          status: 'done' as const,
          resultMeta: 'file changed · persisted abcdef123456',
        },
      ])
    ).toBe(true)
    expect(
      fallbackCompletionHandoff('debug', [emptyCreate])
    ).toContain('No files were changed')
  })

  it('hands off immediately after the latest edit is verified', () => {
    const steps = [
      {
        name: 'workspace_write',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
        status: 'done' as const,
      },
      {
        name: 'run_terminal',
        resultMeta: 'exit 0 · Tests passed',
        status: 'done' as const,
        preview: { title: 'Tests passed', body: 'npm test' },
      },
    ]
    expect(implementationReadyForHandoff('agent', steps)).toBe(true)
    expect(implementationReadyForHandoff('ask', steps)).toBe(false)
  })

  it('recognizes a successful device operation as a completed external action', () => {
    expect(
      externalActionReadyForHandoff('external-action', [
        {
          name: 'device_launch',
          status: 'done',
          resultMeta:
            'device proof · launch · ios · d:111111111111 · a:aaaaaaaaaaaa · launched',
        },
      ])
    ).toBe(true)
  })

  it('uses durable device proof after previews are stripped and invalidates later same-app failure', () => {
    const change = {
      name: 'workspace_write',
      resultMeta: 'file changed · persisted abcdef123456',
      status: 'done' as const,
    }
    const launch = {
      name: 'device_launch',
      resultMeta:
        'device proof · launch · ios · d:111111111111 · a:aaaaaaaaaaaa · launched',
      status: 'done' as const,
    }
    const process = {
      name: 'device_process',
      resultMeta:
        'device proof · process · ios · d:111111111111 · a:aaaaaaaaaaaa · alive · crash-free',
      status: 'done' as const,
    }
    expect(
      implementationReadyForHandoff('agent', [change, launch, process])
    ).toBe(true)
    expect(
      implementationReadyForHandoff('agent', [
        change,
        launch,
        process,
        {
          name: 'device_logs',
          resultMeta:
            'device proof · logs · ios · d:111111111111 · a:aaaaaaaaaaaa · crash-detected',
          status: 'error',
        },
      ])
    ).toBe(false)
    expect(
      implementationReadyForHandoff('agent', [
        change,
        launch,
        {
          ...process,
          resultMeta:
            'device proof · process · ios · d:222222222222 · a:aaaaaaaaaaaa · alive · crash-free',
        },
      ])
    ).toBe(false)
  })

  it('requires verification after the most recent edit', () => {
    const steps = [
      { name: 'run_terminal', status: 'done' as const },
      {
        name: 'workspace_write',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
        status: 'done' as const,
      },
    ]
    expect(implementationReadyForHandoff('debug', steps)).toBe(false)
  })

  it('does not treat a diff review as successful validation after a failed test', () => {
    const steps = [
      {
        name: 'workspace_write',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
        status: 'done' as const,
      },
      {
        name: 'run_terminal',
        resultMeta: 'command exited 1',
        status: 'error' as const,
      },
      {
        name: 'git_diff',
        resultMeta: '1 file changed',
        status: 'done' as const,
      },
    ]
    expect(implementationReadyForHandoff('agent', steps)).toBe(false)
  })

  it('keeps a passing post-edit verification valid when the diff is reviewed afterward', () => {
    expect(
      implementationReadyForHandoff('agent', [
        {
          name: 'workspace_write',
          resultMeta: 'file changed · persisted abcdef123456',
          preview: persistedChangeProof,
          status: 'done' as const,
        },
        {
          name: 'run_terminal',
          resultMeta: 'exit 0 · Tests passed',
          status: 'done' as const,
          preview: { title: 'Tests passed', body: 'npm test' },
        },
        {
          name: 'git_diff',
          resultMeta: 'diff read',
          status: 'done' as const,
          preview: { kind: 'diff', additions: 3, deletions: 1 },
        },
      ])
    ).toBe(true)
  })

  it('requires the final handoff to name files and checks', () => {
    expect(completionHandoffPrompt('agent')).toContain('every changed file')
    expect(completionHandoffPrompt('agent')).toContain('pass/fail')
  })

  it('honors explicit modes while keeping a standalone Automatic status check read-only', () => {
    expect(agentModeForPrompt('agent', 'done?')).toBe('agent')
    expect(agentModeForPrompt('plan', 'What is it doing right now?')).toBe('plan')
    expect(agentModeForPrompt('debug', 'Summarize what you did.')).toBe('debug')
    expect(agentModeForPrompt('auto', 'done?')).toBe('ask')
    expect(agentModeForPrompt('agent', 'Fix the search field.')).toBe('agent')
  })

  it('resumes an unfinished Automatic implementation for a natural status follow-up', () => {
    expect(
      agentModeForPrompt(
        'auto',
        'Is the activity tab crashing resolved?',
        { pendingImplementationMode: 'debug' }
      )
    ).toBe('debug')
    expect(
      agentModeForPrompt('auto', 'Is the activity tab crashing resolved?')
    ).toBe('ask')
  })

  it('recovers the unfinished mode when a timed-out run persisted no final model message', () => {
    expect(
      pendingImplementationMode([
        {
          role: 'user',
          content:
            'The activity tab keeps crashing when I scroll back to far. Create a systematic, sexy, permanent patch.',
        },
      ])
    ).toBe('debug')
  })

  it('recovers an actionable request adjacent to the persisted timeout handoff', () => {
    expect(
      pendingImplementationMode([
        {
          role: 'user',
          content:
            'The activity tab keeps crashing. Create a permanent patch.',
        },
        {
          role: 'model',
          content:
            'I couldn’t finish this run. The provider stopped making progress for five minutes.',
        },
      ])
    ).toBe('debug')
  })

  it('keeps the original Fix pending after a read-only status audit', () => {
    const history = [
      {
        role: 'user' as const,
        content:
          'The activity tab keeps crashing. Create a permanent patch.',
      },
      {
        role: 'model' as const,
        content:
          'I couldn’t finish this run. The provider stopped making progress for five minutes.',
      },
      {
        role: 'user' as const,
        content: 'Is the activity tab crashing resolved?',
      },
      {
        role: 'model' as const,
        agentMode: 'ask' as const,
        content: 'No—not conclusively resolved yet. The patch remains unverified.',
      },
    ]
    expect(pendingImplementationMode(history)).toBe('debug')
    expect(
      agentModeForPrompt('auto', 'Is it fixed yet?', {
        pendingImplementationMode: pendingImplementationMode(history),
      })
    ).toBe('debug')
  })

  it('continues the exact read-only failure instead of repeating Ask mode', () => {
    const history = [
      {
        role: 'user' as const,
        content:
          'Finish building the product so I can remote into mac mini from my phone',
      },
      {
        role: 'model' as const,
        content:
          'Blocked — the product is not completed or ready for deployment. This session was read-only, so I could not edit files or execute verification.',
      },
    ]
    const pending = pendingImplementationRouting(history)
    const pendingMode = pending?.mode
    const mode = agentModeForPrompt('auto', 'Continue', {
      pendingImplementationMode: pendingMode,
      pendingTaskExpectation: pending?.taskExpectation,
    })

    expect(pendingMode).toBe('agent')
    expect(mode).toBe('agent')
    expect(
      agentTaskExpectationForPrompt(mode, 'Continue', {
        pendingImplementationMode: pendingMode,
        pendingTaskExpectation: pending?.taskExpectation,
      })
    ).toBe('workspace-change')
  })

  it('preserves an unfinished external action when continuing', () => {
    const pending = pendingImplementationRouting([
      { role: 'user', content: 'Publish the new desktop release.' },
      {
        role: 'model',
        content: 'I couldn’t finish this run. The provider stopped making progress.',
      },
    ])
    const context = {
      pendingImplementationMode: pending?.mode,
      pendingTaskExpectation: pending?.taskExpectation,
    }
    const mode = agentModeForPrompt('auto', 'Continue', context)

    expect(pending).toEqual({
      mode: 'agent',
      taskExpectation: 'external-action',
    })
    expect(mode).toBe('agent')
    expect(agentTaskExpectationForPrompt(mode, 'Continue', context)).toBe(
      'external-action'
    )
  })

  it('does not turn an explicit answer-only Agent turn into pending file work', () => {
    expect(
      pendingImplementationRouting([
        {
          role: 'model',
          agentMode: 'agent',
          taskExpectation: 'answer',
          content: 'Here is the explanation you requested.',
        },
      ])
    ).toBeUndefined()
  })

  it('keeps standalone short continuations read-only without pending work', () => {
    expect(agentModeForPrompt('auto', 'Continue')).toBe('ask')
    expect(agentModeForPrompt('auto', 'Finish it')).toBe('ask')
    expect(agentModeForPrompt('auto', 'Continue this explanation.')).toBe('ask')
    for (const prompt of [
      'Continue reviewing this code',
      'Finish reading this document',
      'Continue analyzing the app',
      'Complete your explanation of this implementation',
      'Resume the discussion about this product',
      'Finish explaining this feature',
      'Continue researching this software',
    ]) {
      expect(agentModeForPrompt('auto', prompt), prompt).toBe('ask')
    }
  })

  it('understands natural short continuations only when work is pending', () => {
    const context = {
      pendingImplementationMode: 'agent' as const,
      pendingTaskExpectation: 'workspace-change' as const,
    }
    for (const prompt of [
      'Finish the task',
      'Continue the task',
      'Resume work',
      'Finish what you started',
      'Pick up where you left off',
      'Finish it please',
      'Continue please',
      'Resume the work please',
      'Can you continue?',
    ]) {
      const mode = agentModeForPrompt('auto', prompt, context)
      expect(mode, prompt).toBe('agent')
      expect(agentTaskExpectationForPrompt(mode, prompt, context), prompt).toBe(
        'workspace-change'
      )
      expect(agentModeForPrompt('auto', prompt), prompt).toBe('ask')
    }
  })

  it('does not resurrect stale actionable work behind a terminal legacy answer', () => {
    expect(
      pendingImplementationMode([
        { role: 'user', content: 'Implement the import button.' },
        {
          role: 'model',
          content: 'Completed. The import button was implemented and verified.',
        },
      ])
    ).toBeUndefined()
  })

  it('recognizes a persisted failed Fix turn as unfinished', () => {
    expect(
      pendingImplementationMode([
        {
          role: 'model',
          agentMode: 'debug',
          content: 'I couldn’t finish this run.',
          steps: [
            { name: 'workspace_search', resultMeta: '3 file matches' },
            { name: 'workspace_read', resultMeta: '2 files read' },
          ],
        },
      ])
    ).toBe('debug')
  })

  it('does not resume an implementation that already has a verified completion boundary', () => {
    expect(
      pendingImplementationMode([
        {
          role: 'model',
          agentMode: 'debug',
          steps: [
            {
              name: 'workspace_write',
              resultMeta: 'file changed · persisted abcdef123456',
              preview: persistedChangeProof,
            },
            {
              name: 'run_terminal',
              resultMeta: 'exit 0 · Tests passed',
              preview: { title: 'Tests passed', body: 'npm test' },
            },
          ],
        },
      ])
    ).toBeUndefined()
  })

  it('chooses the simplest capable mode automatically', () => {
    expect(agentModeForPrompt('auto', 'What is the capital of France?')).toBe('ask')
    expect(agentModeForPrompt('auto', 'Research the latest battery technology.')).toBe('ask')
    expect(agentModeForPrompt('auto', 'Give me a plan for simplifying this app.')).toBe('plan')
    expect(
      agentModeForPrompt('auto', 'Create a canvas for how this rollout works')
    ).toBe('plan')
    expect(agentModeForPrompt('auto', 'The search button is broken. Fix it.')).toBe('debug')
    expect(
      agentModeForPrompt(
        'auto',
        'The activity tab keeps crashing when I scroll back to far. Create a systematic, sexy, permanent patch.'
      )
    ).toBe('debug')
    expect(agentModeForPrompt('auto', 'The activity tab keeps crashing.')).toBe('debug')
    expect(agentModeForPrompt('auto', 'Can you fix the activity tab crash?')).toBe('debug')
    expect(agentModeForPrompt('auto', 'Why does the activity tab crash?')).toBe('ask')
    expect(agentModeForPrompt('auto', 'Make the desktop interface simpler.')).toBe('agent')
    expect(
      agentModeForPrompt(
        'auto',
        'Write software to use instead of Tailscale to remote into my Mac mini.'
      )
    ).toBe('agent')
    expect(agentModeForPrompt('auto', 'Write a short poem about August.')).toBe(
      'ask'
    )
    expect(agentModeForPrompt('auto', 'Publish the new desktop release.')).toBe('agent')
  })

  it('understands ordinary nontechnical change requests', () => {
    expect(agentModeForPrompt('auto', "I'd like the sidebar wider")).toBe('agent')
    expect(
      agentModeForPrompt('auto', 'The search bar should be at the top')
    ).toBe('agent')
    expect(
      agentModeForPrompt('auto', 'I need a way to import workspaces')
    ).toBe('agent')
    expect(
      agentModeForPrompt('auto', 'I want the app to save planning canvases')
    ).toBe('agent')
  })

  it('keeps ordinary finish and continuation requests writable', () => {
    const prompts = [
      'Finish building the product so I can remote into mac mini from my phone',
      'Verify and finish the existing MacRemote implementation',
      'Finish implementing this feature',
      'Complete building the app',
      'Continue building this product',
      'Resume the implementation',
      'Finish the existing implementation',
      'Finish the MacRemote implementation',
    ]

    for (const prompt of prompts) {
      const mode = agentModeForPrompt('auto', prompt)
      expect(mode, prompt).toBe('agent')
      expect(agentTaskExpectationForPrompt(mode, prompt), prompt).toBe(
        'workspace-change'
      )
    }

    expect(agentModeForPrompt('auto', 'How do I finish this app?')).toBe('ask')
    expect(agentModeForPrompt('auto', 'Is the implementation complete?')).toBe(
      'ask'
    )
    expect(agentModeForPrompt('auto', 'Continue this explanation.')).toBe('ask')
  })

  it('never downgrades explicit implementation and verification requests to Ask', () => {
    expect(
      agentModeForPrompt(
        'auto',
        'UI bug. Inspect the current source, implement the fix, restart the app, and test it to completion.'
      )
    ).toBe('debug')
    expect(
      agentModeForPrompt(
        'auto',
        "UI bug. I can't expand workspaces, search, or add files. Fix the source, restart the app, and test it yourself to ensure functionality when complete."
      )
    ).toBe('debug')
    expect(
      agentModeForPrompt(
        'auto',
        'Can you edit the workspace UI and verify the build before you finish?'
      )
    ).toBe('agent')
    expect(
      agentModeForPrompt(
        'auto',
        'Use workspace.patch to implement this now and run the focused tests.'
      )
    ).toBe('agent')
    expect(
      agentModeForPrompt(
        'auto',
        'Create a plan for the redesign, then implement it and run tests.'
      )
    ).toBe('agent')
    expect(
      agentModeForPrompt('auto', 'Create a plan and implement the approved change.')
    ).toBe('agent')
    expect(agentModeForPrompt('auto', 'Run the test suite to completion.')).toBe(
      'agent'
    )
    expect(agentModeForPrompt('auto', 'Restart the desktop app.')).toBe('agent')
    expect(agentModeForPrompt('auto', 'Test this implementation to completion.')).toBe(
      'agent'
    )
  })

  it('keeps self-directed implementation questions in Ask', () => {
    expect(agentModeForPrompt('auto', 'How do I edit this component?')).toBe('ask')
    expect(agentModeForPrompt('auto', 'How do I create an app?')).toBe('ask')
    expect(agentModeForPrompt('auto', 'What should I change in this file?')).toBe(
      'ask'
    )
    expect(agentModeForPrompt('auto', 'Can you update me on the status?')).toBe(
      'ask'
    )
    expect(agentModeForPrompt('auto', 'What is workspace.patch?')).toBe('ask')
    expect(agentModeForPrompt('auto', 'Please tell me how to fix this.')).toBe(
      'ask'
    )
  })

  it('keeps questions, explanations, and explicit planning read-only', () => {
    expect(agentModeForPrompt('auto', 'How do I deploy this website?')).toBe('ask')
    expect(
      agentModeForPrompt('auto', 'Don’t delete anything; explain this file.')
    ).toBe('ask')
    expect(
      agentModeForPrompt('auto', 'Create a plan for redesigning the app')
    ).toBe('plan')
  })

  it('separates tool capability from the outcome the task must prove', () => {
    expect(agentTaskExpectationForPrompt('agent', 'Implement.')).toBe(
      'workspace-change'
    )
    expect(
      agentTaskExpectationForPrompt('agent', 'Make the desktop interface simpler.')
    ).toBe('workspace-change')
    expect(
      agentTaskExpectationForPrompt(
        'agent',
        'Write software to use instead of Tailscale to remote into my Mac mini.'
      )
    ).toBe('workspace-change')
    expect(
      agentTaskExpectationForPrompt('agent', 'Publish and install the release.')
    ).toBe('external-action')
    expect(agentTaskExpectationForPrompt('agent', 'Open the app.')).toBe(
      'external-action'
    )
    expect(
      agentTaskExpectationForPrompt('agent', 'Use workspace.patch to apply this change.')
    ).toBe('workspace-change')
    expect(agentTaskExpectationForPrompt('agent', 'Run the focused tests.')).toBe(
      'external-action'
    )
    expect(
      agentTaskExpectationForPrompt(
        'agent',
        'Run these two commands: xcodebuild test for the concrete scheme, then xcodebuild the full generic build. Do not edit any file unless you find a defect.'
      )
    ).toBe('external-action')
    expect(agentTaskExpectationForPrompt('ask', 'Fix the app.')).toBe('answer')
    expect(workspaceChangeExpected('agent', 'workspace-change')).toBe(true)
    expect(workspaceChangeExpected('debug', undefined)).toBe(true)
    expect(workspaceChangeExpected('agent', 'external-action')).toBe(false)
    expect(workspaceChangeExpected('agent', 'answer')).toBe(false)
  })

  it('routes an unconditional verification-only file prohibition as an external action', () => {
    const prompt =
      'Work independently. In the StatsKey workspace, read .statskey/device-proof/final-installed-completion.txt and run exactly this one focused verification command: test "$(cat .statskey/device-proof/final-installed-completion.txt)" = "FINAL_INSTALLED_COMPLETION_PROOF_2026-08-13". Do not modify any file. This is a verification-only execution task.'
    const expectation = agentTaskExpectationForPrompt('agent', prompt)

    expect(agentModeForPrompt('auto', prompt)).toBe('agent')
    expect(expectation).toBe('external-action')
    expect(workspaceChangeExpected('agent', expectation)).toBe(false)
    expect(
      externalActionReadyForHandoff(expectation, [
        {
          name: 'workspace_read',
          status: 'done',
          resultMeta: '1 files read',
        },
        {
          name: 'run_terminal',
          status: 'done',
          resultMeta: 'exit 0 · Change check passed',
        },
      ])
    ).toBe(true)
  })

  it('keeps conditional prohibitions external without overriding positive edit requests', () => {
    expect(
      agentTaskExpectationForPrompt(
        'agent',
        'Run the focused tests. Do not edit any file unless you find a defect.'
      )
    ).toBe('external-action')
    expect(
      agentTaskExpectationForPrompt(
        'agent',
        'Edit the requested file, then run the focused test. Do not modify any other files.'
      )
    ).toBe('workspace-change')
    expect(
      agentTaskExpectationForPrompt(
        'agent',
        'Do not stop until you edit the file and run the focused test.'
      )
    ).toBe('workspace-change')
  })

  it('honors an explicit mode override', () => {
    expect(agentModeForPrompt('ask', 'Delete the file.')).toBe('ask')
    expect(agentModeForPrompt('plan', 'Implement the feature.')).toBe('plan')
    expect(agentModeForPrompt('agent', 'Explain this architecture.')).toBe('agent')
  })

  it('removes investigation tools after a bounded no-edit pass', () => {
    const evidence = Array.from({ length: 10 }, (_, index) => ({
      name: index % 2 === 0 ? 'workspace_search' : 'run_terminal',
      status: 'done' as const,
    }))
    expect(implementationToolPhase('agent', 5, evidence)).toBe('edit')
    expect(implementationToolPhase('ask', 9, evidence)).toBe('full')
  })

  it('moves directly to verification after a successful edit', () => {
    expect(
      implementationToolPhase('agent', 2, [
        {
          name: 'workspace_write',
          status: 'done' as const,
          resultMeta: 'file changed · persisted abcdef123456',
          preview: persistedChangeProof,
        },
      ])
    ).toBe('verify')
  })

  it('keeps a corrective edit lane open after a later mutation fails', () => {
    const persisted = {
      name: 'workspace_write',
      status: 'done' as const,
      resultMeta: 'file changed · persisted abcdef123456',
      preview: persistedChangeProof,
    }
    const failedRemainder = {
      name: 'workspace_write',
      status: 'error' as const,
      resultMeta: 'failed · exact edit did not match',
    }
    const passedTooEarly = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Tests passed',
      preview: { title: 'Tests passed', body: 'npm test' },
    }
    const corrected = {
      ...persisted,
      resultMeta: 'file changed · persisted fedcba654321',
    }

    expect(
      hasOutstandingFileMutationFailure([
        persisted,
        failedRemainder,
        passedTooEarly,
      ])
    ).toBe(true)
    expect(
      implementationToolPhase('agent', 3, [
        persisted,
        failedRemainder,
        passedTooEarly,
      ])
    ).toBe('edit')
    expect(
      implementationReadyForHandoff('agent', [
        persisted,
        failedRemainder,
        passedTooEarly,
      ])
    ).toBe(false)
    expect(
      implementationToolPhase('agent', 4, [
        persisted,
        failedRemainder,
        corrected,
      ])
    ).toBe('verify')
    expect(
      implementationReadyForHandoff('agent', [
        persisted,
        failedRemainder,
        corrected,
        passedTooEarly,
      ])
    ).toBe(true)
  })

  it('verifies an existing reviewed diff instead of demanding a redundant edit', () => {
    const diff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        kind: 'diff',
        additions: 12,
        deletions: 3,
        body: 'diff --git a/Sources/Activity.swift b/Sources/Activity.swift',
        items: [{ label: 'Sources/Activity.swift' }],
      },
    }
    expect(hasReviewableWorkspaceChange([diff])).toBe(true)
    expect(implementationToolPhase('debug', 2, [diff])).toBe('verify')
    expect(implementationReadyForHandoff('debug', [diff])).toBe(false)
    expect(
      implementationReadyForHandoff('debug', [
        diff,
        {
          name: 'run_terminal',
          status: 'done' as const,
          resultMeta: 'exit 0 · Tests passed',
          preview: { title: 'Tests passed', body: 'npm test' },
        },
      ])
    ).toBe(true)
  })

  it('does not let a final review of an inherited diff erase its passing verification', () => {
    const diff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        additions: 12,
        deletions: 3,
        body: 'diff --git a/Sources/Activity.swift b/Sources/Activity.swift',
        items: [{ label: 'Sources/Activity.swift' }],
      },
    }
    const passed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Tests passed',
      preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
    }
    const failed = {
      name: 'run_terminal',
      status: 'error' as const,
      resultMeta: 'verification failed · Command failed',
      preview: { title: 'Command failed', body: '** TEST FAILED **' },
    }

    expect(
      implementationReadyForHandoff('debug', [diff, passed, diff])
    ).toBe(true)
    expect(
      implementationReadyForHandoff('debug', [
        diff,
        passed,
        diff,
        {
          name: 'run_terminal',
          status: 'done' as const,
          resultMeta: 'exit 0 · Command passed',
          preview: { title: 'Command passed', body: 'find . -maxdepth 1' },
        },
      ])
    ).toBe(true)
    expect(
      implementationReadyForHandoff('debug', [diff, passed, diff, failed])
    ).toBe(false)
    expect(
      implementationReadyForHandoff('debug', [
        diff,
        passed,
        diff,
        failed,
        passed,
      ])
    ).toBe(true)
  })

  it('does not adopt an arbitrary broad dirty-worktree diff', () => {
    const broadDiff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'diff read',
      preview: {
        kind: 'diff',
        additions: 100,
        deletions: 12,
        body: 'diff --git a/Sources/Unrelated.swift b/Sources/Unrelated.swift',
        items: [{ label: 'Sources/Unrelated.swift' }],
      },
    }
    expect(hasReviewableWorkspaceChange([broadDiff])).toBe(false)
    expect(implementationChangeEvidence([broadDiff])).toEqual({
      kind: 'none',
      steps: [],
    })
  })

  it('prefers changes authored in this run over an inherited scoped patch', () => {
    const authored = {
      name: 'workspace_write',
      status: 'done' as const,
      resultMeta: 'file changed · persisted abcdef123456',
      preview: persistedChangeProof,
    }
    const inherited = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        kind: 'diff',
        additions: 2,
        deletions: 1,
        body: 'diff --git a/Sources/Activity.swift b/Sources/Activity.swift',
        items: [{ label: 'Sources/Activity.swift' }],
      },
    }
    expect(implementationChangeEvidence([inherited, authored])).toEqual({
      kind: 'authored',
      steps: [authored],
    })
  })

  it('requires a meaningful implementation check, not an arbitrary exit zero', () => {
    const emptySuccess = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Command passed',
      preview: { title: 'Command passed', body: 'echo test' },
    }
    expect(isMeaningfulImplementationVerification(emptySuccess)).toBe(false)
    expect(
      implementationReadyForHandoff('agent', [
        {
          name: 'workspace_write',
          status: 'done' as const,
          resultMeta: 'file changed · persisted abcdef123456',
          preview: persistedChangeProof,
        },
        emptySuccess,
      ])
    ).toBe(false)
    expect(
      isMeaningfulImplementationVerification({
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Type check passed',
        preview: { title: 'Type check passed', body: 'npx tsc --noEmit' },
      })
    ).toBe(true)
  })

  it('hands off after a persisted create, exact read-back, and POSIX content assertion', () => {
    const steps = [
      {
        name: 'workspace_create',
        status: 'done' as const,
        resultMeta: 'file changed · persisted 6ada3026877b',
        preview: persistedChangeProof,
      },
      {
        name: 'workspace_read',
        status: 'done' as const,
        resultMeta: '1 files read',
        preview: {
          title: '.statskey/device-proof/final-installed-completion.txt',
          body: 'FINAL_INSTALLED_COMPLETION_PROOF_2026-08-13\n',
        },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Change check passed',
        preview: {
          title: 'Change check passed',
          body: 'test "$(cat .statskey/device-proof/final-installed-completion.txt)" = "FINAL_INSTALLED_COMPLETION_PROOF_2026-08-13"',
        },
      },
    ]

    expect(isMeaningfulImplementationVerification(steps[2])).toBe(true)
    expect(implementationReadyForHandoff('agent', steps)).toBe(true)
  })

  it('does not hand off when failed Xcode output contradicts a legacy exit-zero label', () => {
    const maskedXcodeFailure = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Build passed',
      preview: {
        title: 'Build passed',
        body: '** TEST FAILED **\nA later unrelated command exited 0.',
      },
    }

    expect(isMeaningfulImplementationVerification(maskedXcodeFailure)).toBe(false)
    expect(
      implementationReadyForHandoff('agent', [
        {
          name: 'workspace_write',
          status: 'done' as const,
          resultMeta: 'file changed · persisted abcdef123456',
          preview: persistedChangeProof,
        },
        maskedXcodeFailure,
      ])
    ).toBe(false)
  })

  it('does not mistake an empty diff for implementation work', () => {
    expect(
      hasReviewableWorkspaceChange([
        {
          name: 'git_diff',
          status: 'done' as const,
          resultMeta: 'scoped diff read',
          preview: {
            kind: 'diff',
            additions: 0,
            deletions: 0,
            body: 'No changes.',
            items: [],
          },
        },
      ])
    ).toBe(false)
  })

  it('reconnects one unresponsive provider round from recorded progress', () => {
    const steps = [
      {
        name: 'workspace_read',
        summary: 'workspace_read(file_path: "src/app.ts")',
        resultMeta: '1 file read',
        status: 'done' as const,
      },
    ]
    expect(providerTimeoutRecoveryPrompt('agent', steps, 0)).toContain(
      'do not restart the task'
    )
    expect(providerTimeoutRecoveryPrompt('agent', steps, 1)).toBeNull()
  })

  it('does not reconnect after a verified implementation is ready to hand off', () => {
    expect(
      providerTimeoutRecoveryPrompt(
        'agent',
        [
          {
            name: 'workspace_write',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
            status: 'done' as const,
          },
          {
            name: 'run_terminal',
            resultMeta: 'exit 0 · Tests passed',
            status: 'done' as const,
            preview: { title: 'Tests passed', body: 'npm test' },
          },
        ],
        0
      )
    ).toBeNull()
  })

  it('reconnects an unverified edit specifically to finish verification', () => {
    expect(
      providerTimeoutRecoveryPrompt(
        'agent',
        [
          {
            name: 'workspace_write',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
            status: 'done' as const,
          },
        ],
        0
      )
    ).toContain('smallest focused verification')
  })

  it('generates a terminal no-edit handoff without pretending completion', () => {
    expect(
      fallbackCompletionHandoff('agent', [
        { name: 'workspace_read', status: 'done' as const },
      ])
    ).toContain('No files were changed')
  })

  it('reports provider unavailability truthfully instead of claiming exhaustion', () => {
    const handoff = fallbackCompletionHandoff(
      'agent',
      [
        {
          name: 'workspace_read',
          summary: 'workspace_read(file_path: "src/app.ts")',
          resultMeta: '1 file read',
          status: 'done' as const,
        },
      ],
      'provider_timeout'
    )
    expect(handoff).toContain('provider did not finish before its server deadline')
    expect(handoff).toContain('Last recorded action')
    expect(handoff).toContain('run is closed')
    expect(handoff).not.toContain('exhausted its bounded implementation path')
  })

  it('does not claim an Ask run finished reviewing when the provider timed out', () => {
    const handoff = fallbackCompletionHandoff(
      'ask',
      [],
      'provider_timeout'
    )
    expect(handoff).toContain('provider did not finish before its server deadline')
    expect(handoff).toContain('run is closed')
    expect(handoff).not.toContain('finished reviewing')
  })

  it('turns an empty provider answer into a non-empty needs-attention handoff', () => {
    const handoff = fallbackCompletionHandoff('ask', [], 'empty_response')

    expect(handoff).toMatch(/^I could not complete/i)
    expect(handoff).toContain('returned no written answer')
    expect(handoff).toContain('run is closed')
  })

  it('does not label a failed final synthesis as a completed answer', () => {
    const handoff = fallbackCompletionHandoff('ask', [], 'final_synthesis')

    expect(handoff).toMatch(/^I could not complete/i)
    expect(handoff).toContain('final written summary')
  })

  it('requires successful action evidence before an external action is complete', () => {
    expect(externalActionReadyForHandoff('external-action', [])).toBe(false)
    expect(
      externalActionReadyForHandoff('external-action', [
        { name: 'application_list', status: 'done' },
        { name: 'application_open', status: 'error' },
      ])
    ).toBe(false)
    expect(
      externalActionReadyForHandoff('external-action', [
        { name: 'application_open', status: 'done' },
      ])
    ).toBe(true)
  })

  it('marks a timed-out post-edit handoff as needing attention until verified', () => {
    const handoff = fallbackCompletionHandoff('agent', [
      {
        name: 'workspace_write',
        summary: 'src/app.ts',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
        status: 'done' as const,
      },
    ])
    expect(handoff).toContain('Needs attention')
    expect(handoff).toContain('Verification did not complete')
  })

  it('reports an existing diff as Needs attention until verification passes', () => {
    const diffStep = {
      name: 'git_diff',
      resultMeta: 'scoped diff read',
      status: 'done' as const,
      preview: {
        kind: 'diff',
        additions: 8,
        deletions: 2,
        body: 'diff --git a/Sources/Activity.swift b/Sources/Activity.swift',
        items: [{ label: 'Sources/Activity.swift' }],
      },
    }
    const pending = fallbackCompletionHandoff('debug', [diffStep])
    expect(pending).toContain('Needs attention')
    expect(pending).toContain('Sources/Activity.swift')

    const done = fallbackCompletionHandoff('debug', [
      diffStep,
      {
        name: 'run_terminal',
        resultMeta: 'exit 0 · Tests passed',
        status: 'done' as const,
        preview: { title: 'Tests passed', body: 'npm test' },
      },
    ])
    expect(done).toContain('Completed')
    expect(done).not.toContain('Needs attention')
  })

  it('keeps a failed validation failed even when the diff was reviewed', () => {
    const handoff = fallbackCompletionHandoff('agent', [
      {
        name: 'workspace_write',
        summary: 'workspace_write(file_path: "src/app.ts")',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
        status: 'done' as const,
      },
      {
        name: 'run_terminal',
        summary: 'npm test',
        resultMeta: 'command exited 1',
        status: 'error' as const,
      },
      {
        name: 'git_diff',
        resultMeta: '1 file changed',
        status: 'done' as const,
      },
    ])
    expect(handoff).toContain('Needs attention')
    expect(handoff).toContain('Failed: command exited 1')
    expect(handoff).not.toContain('made and verified')
  })

  it('summarizes preserved files when a run is stopped after an edit', () => {
    const handoff = fallbackStoppedHandoff('agent', [
      {
        name: 'workspace_write',
        summary: 'workspace_write(file_path: "src/app.ts")',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
        status: 'done' as const,
      },
      {
        name: 'run_terminal',
        summary: 'npm test',
        resultMeta: 'command exited 0',
        status: 'done' as const,
      },
    ])
    expect(handoff).toContain('Stopped at a safe boundary')
    expect(handoff).toContain('workspace_write(file_path: "src/app.ts")')
    expect(handoff).toContain('Passed: command exited 0')
  })
})
