import { describe, expect, it } from 'vitest'
import { terminalStatusForMessage, verificationReviewSummary } from './Flow'
import type {
  ChatMessageStep,
  ChatSessionMessage,
} from '../lib/data/useChatSessions'

function message(
  overrides: Partial<ChatSessionMessage>
): ChatSessionMessage {
  return {
    id: 'message',
    role: 'model',
    content: 'Completed.',
    timestamp: new Date(),
    ...overrides,
  }
}

describe('terminal status truth', () => {
  it('does not mark external-action prose Done without successful action evidence', () => {
    expect(
      terminalStatusForMessage(
        message({ taskExpectation: 'external-action', steps: [] })
      )
    ).toEqual({ state: 'attention', label: 'Needs attention' })
  })

  it('marks an external action Done only after its action step succeeds', () => {
    expect(
      terminalStatusForMessage(
        message({
          taskExpectation: 'external-action',
          steps: [
            {
              name: 'application_open',
              summary: 'Opened the requested application',
            },
          ],
        })
      )
    ).toEqual({ state: 'done', label: 'Done' })
  })

  it('keeps deterministic empty-provider handoffs out of Done', () => {
    expect(
      terminalStatusForMessage(
        message({
          content:
            'I could not complete this response because the provider returned no written answer.',
        })
      )
    ).toEqual({ state: 'attention', label: 'Needs attention' })
  })

  it('never reports a workspace change Done from unverified file-changed copy', () => {
    const steps: ChatMessageStep[] = [
      {
        name: 'workspace_write',
        summary: 'Updated App.swift',
        resultMeta: 'file changed',
        preview: {
          kind: 'diff',
          title: 'App.swift',
          additions: 2,
          deletions: 1,
        },
      },
      {
        name: 'run_terminal',
        summary: 'Ran focused tests',
        resultMeta: 'exit 0 · Tests passed',
        preview: {
          kind: 'command',
          title: 'Tests passed',
          body: '** TEST SUCCEEDED **',
        },
      },
    ]

    expect(
      terminalStatusForMessage(
        message({
          agentMode: 'agent',
          taskExpectation: 'workspace-change',
          steps,
        })
      )
    ).toEqual({ state: 'attention', label: 'Needs attention' })

    expect(
      terminalStatusForMessage(
        message({
          agentMode: 'agent',
          taskExpectation: 'workspace-change',
          steps: [
            {
              ...steps[0],
              resultMeta: 'file changed · persisted abcdef123456',
              preview: {
                kind: 'diff',
                title: 'App.swift',
                additions: 2,
                deletions: 1,
                items: [{ label: 'Persisted change verified' }],
              },
            },
            steps[1],
          ],
        })
      )
    ).toEqual({ state: 'done', label: 'Done' })
  })

  it('presents recovered historical failures as earlier attempts, not outstanding failures', () => {
    const inheritedDiff: ChatMessageStep = {
      name: 'git_diff',
      summary: 'Reviewed the task-scoped diff',
      resultMeta: 'scoped diff read',
      preview: {
        kind: 'diff',
        title: 'Task-scoped existing changes',
        additions: 12,
        deletions: 2,
        body: 'diff --git a/LibraryView.swift b/LibraryView.swift',
        items: [{ label: 'LibraryView.swift' }],
      },
    }
    const failedTest: ChatMessageStep = {
      name: 'run_terminal',
      summary: 'Ran the focused tests',
      resultMeta: 'verification failed · Command failed',
      failed: true,
      preview: {
        kind: 'command',
        title: 'Command failed',
        body: '** TEST FAILED **',
      },
    }
    const passedTest: ChatMessageStep = {
      name: 'run_terminal',
      summary: 'Reran the focused tests',
      resultMeta: 'exit 0 · Tests passed',
      preview: {
        kind: 'command',
        title: 'Tests passed',
        body: '** TEST SUCCEEDED **',
      },
    }

    expect(
      verificationReviewSummary(
        [inheritedDiff, failedTest, passedTest],
        'debug'
      )
    ).toMatchObject({
      checks: [
        { state: 'earlier-failure' },
        { state: 'passed' },
      ],
      unresolvedFailureCount: 0,
      recoveredFailureCount: 1,
    })
  })

  it('shows durable structured device verification after local previews are stripped', () => {
    expect(
      verificationReviewSummary(
        [
          {
            name: 'device_process',
            summary: 'Verified the app process',
            resultMeta:
              'device proof · process · ios · d:111111111111 · a:aaaaaaaaaaaa · alive · crash-free',
          },
        ],
        'agent'
      )
    ).toMatchObject({
      checks: [{ state: 'passed' }],
      unresolvedFailureCount: 0,
    })
  })

  it('keeps a latest unresolved verification failure outstanding', () => {
    const steps: ChatMessageStep[] = [
      {
        name: 'git_diff',
        summary: 'Reviewed the task-scoped diff',
        resultMeta: 'scoped diff read',
        preview: {
          kind: 'diff',
          title: 'Task-scoped existing changes',
          additions: 4,
          deletions: 1,
          body: 'diff --git a/LibraryView.swift b/LibraryView.swift',
          items: [{ label: 'LibraryView.swift' }],
        },
      },
      {
        name: 'run_terminal',
        summary: 'Ran the focused tests',
        resultMeta: 'exit 0 · Tests passed',
        preview: {
          kind: 'command',
          title: 'Tests passed',
          body: '** TEST SUCCEEDED **',
        },
      },
      {
        name: 'run_terminal',
        summary: 'Reran the focused tests',
        resultMeta: 'verification failed · Command failed',
        failed: true,
        preview: {
          kind: 'command',
          title: 'Command failed',
          body: '** TEST FAILED **',
        },
      },
    ]

    expect(verificationReviewSummary(steps, 'debug')).toMatchObject({
      checks: [{ state: 'passed' }, { state: 'failed' }],
      unresolvedFailureCount: 1,
      recoveredFailureCount: 0,
    })
  })

  it('does not let a different verification category recover a failure', () => {
    const steps: ChatMessageStep[] = [
      {
        name: 'git_diff',
        summary: 'Reviewed the task-scoped diff',
        resultMeta: 'scoped diff read',
        preview: {
          kind: 'diff',
          title: 'Task-scoped existing changes',
          additions: 4,
          deletions: 1,
          body: 'diff --git a/LibraryView.swift b/LibraryView.swift',
          items: [{ label: 'LibraryView.swift' }],
        },
      },
      {
        name: 'run_terminal',
        summary: 'Ran the focused tests',
        resultMeta: 'verification failed · Command failed',
        failed: true,
        preview: {
          kind: 'command',
          title: 'Tests failed',
          body: '** TEST FAILED **',
        },
      },
      {
        name: 'run_terminal',
        summary: 'Ran the generic build',
        resultMeta: 'exit 0 · Build passed',
        preview: {
          kind: 'command',
          title: 'Build passed',
          body: '** BUILD SUCCEEDED **',
        },
      },
    ]

    expect(verificationReviewSummary(steps, 'debug')).toMatchObject({
      checks: [{ state: 'failed' }, { state: 'passed' }],
      unresolvedFailureCount: 1,
      recoveredFailureCount: 0,
    })
  })

  it('classifies canonical failed metadata before settling later category-correct successes', () => {
    const steps: ChatMessageStep[] = [
      {
        name: 'git_diff',
        summary: 'Reviewed the task-scoped diff',
        resultMeta: 'scoped diff read',
        preview: {
          kind: 'diff',
          title: 'Task-scoped existing changes',
          additions: 5,
          deletions: 1,
          body: 'diff --git a/CameraCaptureView.swift b/CameraCaptureView.swift',
          items: [{ label: 'CameraCaptureView.swift' }],
        },
      },
      {
        name: 'run_terminal',
        summary: 'Ran an initial reviewed command',
        resultMeta: 'verification failed · Command failed · reported by tool output',
        failed: true,
        preview: {
          kind: 'command',
          title: 'Command failed · reported by tool output',
          body: 'xcodebuild: error: destination was ambiguous',
        },
      },
      {
        name: 'run_terminal',
        summary: 'Corrected generated dependency state',
        resultMeta: 'exit 0 · Command passed',
        preview: { kind: 'command', title: 'Command passed', body: 'REMOVED' },
      },
      {
        name: 'run_terminal',
        summary: 'Ran the simulator build',
        resultMeta: 'verification failed · Build failed · reported by tool output',
        failed: true,
        preview: {
          kind: 'command',
          title: 'Build failed · reported by tool output',
          body: 'xcodebuild: error: destination was ambiguous',
        },
      },
      {
        name: 'run_terminal',
        summary: 'Reran the simulator build',
        resultMeta: 'exit 0 · Build passed',
        preview: {
          kind: 'command',
          title: 'Build passed',
          body: '** BUILD SUCCEEDED **',
        },
      },
      {
        name: 'git_diff',
        summary: 'Reviewed the final task-scoped diff',
        resultMeta: 'scoped diff read',
        preview: {
          kind: 'diff',
          title: 'Task-scoped existing changes',
          additions: 5,
          deletions: 1,
          body: 'diff --git a/CameraCaptureView.swift b/CameraCaptureView.swift',
          items: [{ label: 'CameraCaptureView.swift' }],
        },
      },
    ]

    expect(verificationReviewSummary(steps, 'agent')).toMatchObject({
      checks: [
        { state: 'earlier-failure' },
        { state: 'passed' },
        { state: 'earlier-failure' },
        { state: 'passed' },
      ],
      unresolvedFailureCount: 0,
      recoveredFailureCount: 2,
    })
    expect(
      terminalStatusForMessage(
        message({
          content: 'Completed. The correction is persisted and the build passed.',
          agentMode: 'agent',
          taskExpectation: 'workspace-change',
          steps,
        })
      )
    ).toEqual({ state: 'done', label: 'Done' })
  })
})
