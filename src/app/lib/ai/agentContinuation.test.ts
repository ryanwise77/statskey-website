import { describe, expect, it } from 'vitest'
import {
  MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
  automaticImplementationContinuationPrompt,
  independentImplementationContinuationDecision,
  unsupportedImplementationClaimIdentifiers,
  userContentWithAutomaticContinuation,
} from './agentContinuation'
import {
  agentTaskExpectationForPrompt,
  externalActionReadyForHandoff,
  workspaceChangeExpected,
} from './agentPersistence'

const base = {
  approvalMode: 'everything',
  mode: 'agent' as const,
  workspaceChangeExpected: true,
  objective: 'Fix the desktop app, run the xcodebuild tests, and run the full generic build to completion.',
  content: '',
  steps: [],
  stopped: false,
  completedPasses: 1,
}

const persistedChangeProof = {
  items: [{ label: 'Persisted change verified' }],
}

describe('independent implementation continuation', () => {
  it('continues a no-change pass without another user approval', () => {
    expect(independentImplementationContinuationDecision(base)).toEqual({
      shouldContinue: true,
      reason: 'no_file_change',
    })
  })

  it('does not restart an autonomous pass after a provider deadline', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        providerUnavailable: true,
        content:
          'The provider stopped reporting activity. Completed workspace work remains saved.',
      })
    ).toEqual({
      shouldContinue: false,
      reason: 'provider_unavailable',
    })
  })

  it('reserves a fourth direct-action pass after three evidence-only passes', () => {
    expect(MAX_INDEPENDENT_IMPLEMENTATION_PASSES).toBe(4)
    expect(
      independentImplementationContinuationDecision({
        ...base,
        completedPasses: 3,
        content:
          'Implementation is incomplete because the bounded action budget ended before a file change.',
      })
    ).toEqual({ shouldContinue: true, reason: 'action_budget' })
  })

  it('continues after the local 14-action cap or an explicit implementation follow-up', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'IMPLEMENTATION INCOMPLETE. The run hit its 14-action cap and needs a manual follow-up.',
      })
    ).toEqual({ shouldContinue: true, reason: 'action_budget' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        content: 'This requires another follow-up implementation pass.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'explicit_follow_up' })
  })

  it('trusts cumulative edit and verification evidence over stale incomplete prose', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'IMPLEMENTATION INCOMPLETE. No files changed in this pass; another follow-up is required.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: 'npm test' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: 'npm run build' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('completes persisted proof-file work after exact read-back and a standalone content check', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective:
          'Create the exact proof file, read it back, and run a focused terminal check that exits nonzero if its contents differ.',
        content:
          'Completed with a durable mutation receipt, exact read-back, and successful focused content check.',
        steps: [
          {
            name: 'workspace_create',
            status: 'done',
            resultMeta: 'file changed · persisted 6ada3026877b',
            preview: persistedChangeProof,
          },
          {
            name: 'workspace_read',
            status: 'done',
            resultMeta: '1 files read',
            preview: {
              title: '.statskey/device-proof/final-installed-completion.txt',
              body: 'FINAL_INSTALLED_COMPLETION_PROOF_2026-08-13\n',
            },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Change check passed',
            preview: {
              title: 'Change check passed',
              body: 'test "$(cat .statskey/device-proof/final-installed-completion.txt)" = "FINAL_INSTALLED_COMPLETION_PROOF_2026-08-13"',
            },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('keeps correcting after a persisted sub-edit when a later mutation fails', () => {
    const steps = [
      {
        name: 'workspace_write',
        status: 'done' as const,
        resultMeta: 'file changed · persisted abcdef123456',
        preview: {
          title: 'Sources/Layout.swift',
          after: '.font(.headline)',
          items: [{ label: 'Persisted change verified' }],
        },
      },
      {
        name: 'workspace_write',
        status: 'error' as const,
        resultMeta: 'failed · exact edit did not match',
        preview: { title: 'Sources/Layout.swift', after: 'ViewThatFits {}' },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Tests passed',
        preview: { title: 'Tests passed', body: 'npm test' },
      },
    ]

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective: 'Fix the adaptive layout and test it.',
        content:
          'Only the semantic-font edit persisted; the remaining adaptive layout correction still needs to be applied.',
        steps,
      })
    ).toEqual({ shouldContinue: true, reason: 'mutation_incomplete' })
  })

  it('does not treat one valid write as satisfying a stated remaining correction', () => {
    const steps = [
      {
        name: 'workspace_write',
        status: 'done' as const,
        resultMeta: 'file changed · persisted abcdef123456',
        preview: {
          title: 'Sources/Layout.swift',
          after: '.font(.headline)',
          items: [{ label: 'Persisted change verified' }],
        },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Tests passed',
        preview: { title: 'Tests passed', body: 'npm test' },
      },
    ]
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective: 'Make both requested layout changes and test them.',
        content:
          'The first change is saved. The outstanding layout edit was not applied.',
        steps,
      })
    ).toEqual({ shouldContinue: true, reason: 'mutation_incomplete' })
  })

  it('rejects a construct claim absent from post-write read and diff evidence', () => {
    const steps = [
      {
        name: 'workspace_write',
        status: 'done' as const,
        resultMeta: 'file changed · persisted abcdef123456',
        preview: {
          title: 'Sources/Layout.swift',
          after: '.font(.headline)',
          items: [{ label: 'Persisted change verified' }],
        },
      },
      {
        name: 'workspace_read',
        status: 'done' as const,
        resultMeta: '1 files read',
        preview: {
          title: 'Sources/Layout.swift',
          body: 'HStack { Text("Title") }',
        },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Tests passed',
        preview: { title: 'Tests passed', body: 'npm test' },
      },
    ]
    const handoff =
      'Completed. Changed `Sources/Layout.swift` to use adaptive `ViewThatFits` and verified it.'

    expect(unsupportedImplementationClaimIdentifiers(handoff, steps)).toEqual([
      'ViewThatFits',
    ])
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective: 'Fix the adaptive layout and test it.',
        content: handoff,
        steps,
      })
    ).toEqual({ shouldContinue: true, reason: 'unsupported_claim' })
  })

  it('accepts the same construct claim once a persisted correction contains it', () => {
    const steps = [
      {
        name: 'workspace_write',
        status: 'done' as const,
        resultMeta: 'file changed · persisted abcdef123456',
        preview: {
          title: 'Sources/Layout.swift',
          after: 'ViewThatFits { HStack { Text("Title") } }',
          items: [{ label: 'Persisted change verified' }],
        },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Tests passed',
        preview: { title: 'Tests passed', body: 'npm test' },
      },
    ]
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective: 'Fix the adaptive layout and test it.',
        content:
          'Completed. Changed `Sources/Layout.swift` to use adaptive `ViewThatFits` and verified it.',
        steps,
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('does not interpret a control name beginning with Remove as a removal claim', () => {
    const content =
      'Completed. Remove Photo button: added `.frame(minWidth: 44, minHeight: 44)` and `.contentShape(Rectangle())`.'
    const steps = [
      {
        name: 'workspace_write',
        status: 'done' as const,
        resultMeta: 'file changed · persisted abcdef123456',
        preview: {
          title: 'Sources/CameraCaptureView.swift',
          after: [
            'Button("Remove Photo") { removePhoto() }',
            '  .frame(minWidth: 44, minHeight: 44)',
            '  .contentShape(Rectangle())',
          ].join('\n'),
          items: [{ label: 'Persisted change verified' }],
        },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Build passed',
        preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
      },
    ]

    expect(unsupportedImplementationClaimIdentifiers(content, steps)).toEqual(
      []
    )
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective: 'Fix the Remove Photo target and run the build.',
        content,
        steps,
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('rejects a claimed API conversion when the exact reread still contains that API', () => {
    const steps = [
      {
        name: 'workspace_write',
        status: 'done' as const,
        resultMeta: 'file changed · persisted abcdef123456',
        preview: {
          title: 'Sources/Layout.swift',
          before: '.system(size: 17, weight: .bold)',
          after: '.font(.headline)',
          items: [{ label: 'Persisted change verified' }],
        },
      },
      {
        name: 'workspace_read',
        status: 'done' as const,
        resultMeta: '1 files read',
        preview: {
          title: 'Sources/Layout.swift',
          body: [
            '.font(.headline)',
            '.font(.system(size: 13, weight: .semibold))',
            '.font(.system(size: 11))',
          ].join('\n'),
        },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Tests passed',
        preview: { title: 'Tests passed', body: 'npm test' },
      },
    ]
    const content =
      'Completed. Converted the fixed `.system(size:)` fonts to semantic styles in `Sources/Layout.swift`.'

    expect(unsupportedImplementationClaimIdentifiers(content, steps)).toContain(
      '.system(size:)'
    )
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective: 'Convert the fixed explanatory fonts and test it.',
        content,
        steps,
      })
    ).toEqual({ shouldContinue: true, reason: 'unsupported_claim' })
  })

  it.each([
    'Outcome: Completed (with one downgraded verification step).',
    'Remaining limitation: I could not get a passing xcodebuild test.',
    'Remaining limitation: the full generic build was not yet run.',
  ])(
    'continues the same objective when a completed-looking handoff admits required verification is incomplete: %s',
    (content) => {
      const steps = [
        {
          name: 'workspace_write',
          status: 'done' as const,
          resultMeta: 'file changed · persisted abcdef123456',
          preview: persistedChangeProof,
        },
        {
          name: 'run_terminal',
          status: 'done' as const,
          resultMeta: 'exit 0 · Tests passed',
          preview: { title: 'Tests passed', body: 'npm test' },
        },
      ]
      expect(
        independentImplementationContinuationDecision({
          ...base,
          content,
          steps,
        })
      ).toEqual({
        shouldContinue: true,
        reason: 'verification_incomplete',
      })

      const prompt = automaticImplementationContinuationPrompt({
        objective: base.objective,
        previousContent: content,
        steps,
        nextPass: 2,
      })
      expect(prompt).toContain(base.objective)
      expect(prompt).toContain(content)
    }
  )

  it('does not reopen verified work for an unrelated remaining limitation', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'Completed and verified. Remaining limitation: the optional release notes are brief.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: 'npm test' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: 'npm run build' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it.each([
    'The xcodebuild test failed. I reran a database migration. It passed. The generic build passed.',
    'The xcodebuild test failed. The benchmark rerun passed. The generic build passed.',
    'The xcodebuild test failed. I reran the formatter. It passed. The generic build passed.',
    'The xcodebuild test failed. I reran the linter. It passed. The generic build passed.',
    'The xcodebuild test failed. I reran that database migration. It passed. The generic build passed.',
    'The xcodebuild test failed. I reran this formatter. It passed. The generic build passed.',
    'The xcodebuild test failed. I reran a simulator benchmark. It passed. The generic build passed.',
    'The xcodebuild test failed. I reran the device migration. It passed. The generic build passed.',
  ])('does not let an unrelated rerun inherit the pending test target: %s', (content) => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content,
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
  })

  it('does not impose an unrequested verification requirement', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective: 'Fix the desktop header overlap.',
        content:
          'Completed. One optional integration test was not run in this pass.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Type check passed',
            preview: { title: 'Typecheck passed', body: 'npx tsc --noEmit' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('accepts a recovered historical test failure after the required rerun and build pass', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'The first generic-destination test failed. I reran it against the concrete simulator and it passed. The generic build also passed.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it.each([
    'The initial generic test failed. The concrete simulator rerun passed. The generic build passed.',
    'The initial generic test failed. I reran it against the concrete simulator. It passed. The generic build passed.',
  ])('accepts a recovered simulator rerun expressed across ordinary handoff sentences: %s', (content) => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content,
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: {
              items: [
                ...persistedChangeProof.items,
                { label: 'StatsKey/App.swift' },
              ],
            },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('does not mistake a negated failure for an outstanding shortfall', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content: 'Verification did not fail: the tests and build passed.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('keeps unresolved test and build shortfalls active through the cap', () => {
    const content =
      'The xcodebuild test failed and the full generic build was not yet run.'
    expect(
      independentImplementationContinuationDecision({ ...base, content })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content,
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
      })
    ).toEqual({
      shouldContinue: false,
      reason: 'required_verification_cap',
    })
  })

  it.each([
    'I cannot safely continue because the 14-action budget was exhausted before finishing.',
    'I am unable to complete this pass due to the round limit.',
  ])('continues through a provider-local budget statement: %s', (content) => {
    expect(
      independentImplementationContinuationDecision({ ...base, content })
    ).toEqual({ shouldContinue: true, reason: 'action_budget' })
  })

  it('does not let an unrelated successful command resolve a failed required test', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'The xcodebuild test failed, and a later unrelated command exited 0. The full generic build passed.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
  })

  it.each([
    'The xcodebuild test failed. Then an unrelated command passed. The full generic build passed.',
    'The xcodebuild test failed. Subsequently a separate command passed. The full generic build passed.',
  ])('does not resolve a failed test from a cross-sentence unrelated success: %s', (content) => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content,
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
  })

  it('recognizes a direct no-tests-failed negation', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content: 'No tests failed; the full generic build passed.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('keeps a concrete credential blocker authoritative over a local action budget', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'The action budget was exhausted, but I also cannot continue until your signing credentials are available.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'genuine_blocker' })
  })

  it('rejects a false completion label at the cap without overriding a genuine blocker', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'Outcome: Completed (with one downgraded verification step).',
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
      })
    ).toEqual({
      shouldContinue: false,
      reason: 'required_verification_cap',
    })
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'The xcodebuild test could not run. I cannot safely continue until your required signing credentials are available.',
      })
    ).toEqual({ shouldContinue: false, reason: 'genuine_blocker' })
  })

  it('continues a saved edit through focused verification', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
        ],
      })
    ).toEqual({
      shouldContinue: true,
      reason: 'verification_incomplete',
    })
  })

  it('ends on verified completion, a genuine blocker, Stop, or the global cap', () => {
    const completedSteps = [
      {
        name: 'workspace_write',
        status: 'done' as const,
        resultMeta: 'file changed · persisted abcdef123456',
        preview: persistedChangeProof,
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Tests passed',
        preview: { title: 'Tests passed', body: 'npm test' },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Build passed',
        preview: { title: 'Build passed', body: 'npm run build' },
      },
    ]
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content: 'Completed and verified.',
        steps: completedSteps,
      }).reason
    ).toBe('completed')
    expect(
      independentImplementationContinuationDecision({
        ...base,
        content:
          'I cannot safely continue until your required deployment credentials are available.',
      }).reason
    ).toBe('genuine_blocker')
    expect(
      independentImplementationContinuationDecision({ ...base, stopped: true })
        .reason
    ).toBe('stopped')
    expect(
      independentImplementationContinuationDecision({
        ...base,
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
      }).reason
    ).toBe('global_cap')
    expect(
      independentImplementationContinuationDecision({
        ...base,
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
        content:
          'IMPLEMENTATION INCOMPLETE. The run exhausted its action budget and needs another follow-up pass.',
      }).reason
    ).toBe('global_cap')
  })

  it('never auto-continues a reviewed run or a non-implementation request', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        approvalMode: 'review',
      }).reason
    ).toBe('ineligible')
    expect(
      independentImplementationContinuationDecision({
        ...base,
        workspaceChangeExpected: false,
      }).reason
    ).toBe('ineligible')
  })

  it('does not force an edit after a successful verification-only follow-up', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        workspaceChangeExpected: false,
        objective:
          'Run these two commands and report the result. Do not edit any file unless you find a defect.',
        content:
          'Both requested checks passed: the concrete test reported TEST SUCCEEDED and the full generic build exited 0.',
        steps: [
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · ** TEST SUCCEEDED **',
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · generic build passed',
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'ineligible' })
  })

  it('does not start implementation continuation after the installed verification-only proof', () => {
    const objective =
      'Work independently. In the StatsKey workspace, read .statskey/device-proof/final-installed-completion.txt and run exactly this one focused verification command: test "$(cat .statskey/device-proof/final-installed-completion.txt)" = "FINAL_INSTALLED_COMPLETION_PROOF_2026-08-13". Do not modify any file. This is a verification-only execution task.'
    const expectation = agentTaskExpectationForPrompt('agent', objective)
    const steps = [
      {
        name: 'workspace_read',
        status: 'done' as const,
        resultMeta: '1 files read',
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Change check passed',
      },
    ]

    expect(expectation).toBe('external-action')
    expect(externalActionReadyForHandoff(expectation, steps)).toBe(true)
    expect(workspaceChangeExpected('agent', expectation)).toBe(false)
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        workspaceChangeExpected: workspaceChangeExpected(
          'agent',
          expectation
        ),
        content: 'The exact read and focused verification command passed.',
        steps,
      })
    ).toEqual({ shouldContinue: false, reason: 'ineligible' })
  })

  it('requires separately recorded test and build evidence when the objective requires both', () => {
    const objective = [
      'Run all required verification to completion:',
      '1. xcodebuild -project StatsKey.xcodeproj -scheme StatsKey -destination "platform=iOS Simulator,id=ABC" -only-testing:StatsKeyTests/SubstanceNutritionTests test',
      '2. xcodebuild -project StatsKey.xcodeproj -scheme StatsKey -destination "generic/platform=iOS Simulator" build',
    ].join('\n')
    const changed = {
      name: 'workspace_write',
      status: 'done' as const,
      resultMeta: 'file changed · persisted abcdef123456',
      preview: persistedChangeProof,
    }
    const testPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Tests passed',
      preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
    }
    const buildPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Build passed',
      preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
    }

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed. Both commands passed.',
        steps: [changed, testPassed],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
    expect(
      automaticImplementationContinuationPrompt({
        objective,
        previousContent: 'Completed. Both commands passed.',
        steps: [changed, testPassed],
        nextPass: 2,
      })
    ).toContain('Recorded verification still missing after the reviewed change: build')
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'The focused tests and generic build both passed.',
        steps: [changed, testPassed, buildPassed],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('does not let device discovery satisfy an explicit simulator install and launch exercise', () => {
    const objective =
      'Install the built app on an available iOS Simulator, launch it, and exercise the affected UI so it is proven crash-free.'
    const changed = {
      name: 'workspace_write',
      status: 'done' as const,
      resultMeta: 'file changed · persisted abcdef123456',
      preview: {
        title: 'Sources/Layout.swift',
        after: 'ViewThatFits {}',
        items: [{ label: 'Persisted change verified' }],
      },
    }
    const deviceListOnly = {
      name: 'device_list',
      status: 'done' as const,
      resultMeta: '3 devices',
    }

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed after listing the available simulators.',
        steps: [changed, deviceListOnly],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
  })

  it('requires the exact Library Simulator exercise and final scoped diff in addition to tests and build', () => {
    const objective = [
      'Resolve the StatsKey iOS crash that occurs with Library open or while navigating within Library, and carry the fix through verified completion without waiting for another prompt.',
      '4. Verify after the final relevant change. Run the most focused relevant test suite, then run:',
      'xcodebuild -project StatsKey.xcodeproj -scheme StatsKey -destination "generic/platform=iOS Simulator" -sdk iphonesimulator build',
      'Also launch or exercise the affected Library flow on an available iOS Simulator, or run the relevant UI test, so the original open/navigation crash is demonstrably gone. If simulator interaction is unavailable, use the strongest deterministic regression test and crash-stack evidence and state that limitation truthfully.',
      '5. Review the final task-scoped diff and confirm no redundant or bogus files were created.',
      'Do not report Completed unless the crash root cause is identified, the fix is present, the focused verification passes, the generic simulator build passes, and the Library reproduction no longer crashes.',
    ].join('\n')
    const changed = {
      name: 'workspace_write',
      status: 'done' as const,
      resultMeta: 'file changed · persisted abcdef123456',
      preview: persistedChangeProof,
    }
    const testsPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Tests passed',
      preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
    }
    const buildPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Build passed',
      preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
    }
    const uiExercisePassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Command passed',
      preview: {
        title: 'Command passed',
        body: [
          'xcrun simctl launch booted com.statskey.StatsKey',
          'Library opened and navigated without a crash.',
          'LIBRARY_UI_EXERCISE_PASSED',
        ].join('\n'),
      },
    }
    const debugLibraryLaunchPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Command passed',
      preview: {
        title: 'Command passed',
        body: [
          'STATSKEY_DEBUG_RECORD_SURFACE=library',
          'xcrun simctl launch booted com.statskey.StatsKey',
        ].join('\n'),
      },
    }
    const finalScopedDiff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        additions: 8,
        deletions: 4,
        body: [
          'diff --git a/biometrics/StatsKey/Views/Library/LibraryView.swift b/biometrics/StatsKey/Views/Library/LibraryView.swift',
          '@@ -1 +1 @@',
          '-callback()',
          '+dismissThenCallback()',
        ].join('\n'),
        items: [
          { label: 'biometrics/StatsKey/Views/Library/LibraryView.swift' },
        ],
      },
    }
    const testsAndBuild = [changed, testsPassed, buildPassed]

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed. The focused tests and generic build passed.',
        steps: testsAndBuild,
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    const continuation = automaticImplementationContinuationPrompt({
      objective,
      previousContent: 'The focused tests and generic build passed.',
      steps: testsAndBuild,
      nextPass: 2,
    })
    expect(continuation).toContain('Simulator/Library UI exercise')
    expect(continuation).toContain('final task-scoped diff review')

    // Provider prose and generic successful tests cannot manufacture the
    // separately requested Library reproduction evidence.
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Completed. The Library exercise is demonstrably successful.',
        steps: [...testsAndBuild, finalScopedDiff],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    // Merely launching the app says nothing about whether Library was opened
    // or navigated; the launch must be explicitly bound to that surface.
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed and verified.',
        steps: [
          ...testsAndBuild,
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Command passed',
            preview: {
              title: 'Command passed',
              body: 'xcrun simctl launch booted statskey.biometrics',
            },
          },
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    // Free-form Library wording next to a launch is still not evidence that the
    // debug launch was configured to record that surface.
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed and verified.',
        steps: [
          ...testsAndBuild,
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Command passed',
            preview: {
              title: 'Command passed',
              body: [
                'xcrun simctl launch booted statskey.biometrics',
                'Opening the Library surface.',
              ].join('\n'),
            },
          },
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    // An unrelated UI test cannot stand in for the requested Library flow.
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed and verified.',
        steps: [
          ...testsAndBuild,
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: {
              title: 'Tests passed',
              body:
                'XCUITest SettingsProfileUITests.testEditProfile ** TEST SUCCEEDED **',
            },
          },
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    // The exercise must happen after the recorded change, not before it.
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed and verified.',
        steps: [uiExercisePassed, ...testsAndBuild, finalScopedDiff],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    // A scoped diff reviewed before the implementation is not the requested
    // final post-change review.
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed and verified.',
        steps: [finalScopedDiff, ...testsAndBuild, uiExercisePassed],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    // A task-specific crash marker overrides a nominal exit 0 and successful
    // launch metadata from the same terminal step.
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed and verified.',
        steps: [
          ...testsAndBuild,
          {
            ...debugLibraryLaunchPassed,
            preview: {
              title: 'Command passed',
              body: [
                'STATSKEY_DEBUG_RECORD_SURFACE=library',
                'xcrun simctl launch booted com.statskey.StatsKey',
                'Library navigation crashed in the final run.',
              ].join('\n'),
            },
          },
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Library still crashes in the final run. The earlier Library UI exercise passed.',
        steps: [
          ...testsAndBuild,
          uiExercisePassed,
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Library still crashed in the first final run. I fixed the defect, reran the Library UI exercise, and it passed without a crash.',
        steps: [
          ...testsAndBuild,
          uiExercisePassed,
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Completed. The Library Maestro flow and all required checks passed.',
        steps: [
          ...testsAndBuild,
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: {
              title: 'Tests passed',
              body: [
                'maestro test /tmp/statskey-library-crash.yaml',
                '1/1 Flow Passed',
              ].join('\n'),
            },
          },
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Completed. Tests and build passed, and the post-change Library Simulator exercise completed without a crash.',
        steps: [
          ...testsAndBuild,
          uiExercisePassed,
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Outcome: Completed. Remaining limitation: Library navigation still crashes.',
        steps: [
          ...testsAndBuild,
          uiExercisePassed,
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed and verified.',
        steps: [
          ...testsAndBuild,
          uiExercisePassed,
          {
            ...debugLibraryLaunchPassed,
            status: 'error',
            resultMeta: 'verification failed · Command failed',
            preview: {
              title: 'Command failed',
              body: [
                'STATSKEY_DEBUG_RECORD_SURFACE=library',
                'xcrun simctl launch booted com.statskey.StatsKey',
                'Library navigation crashed.',
              ].join('\n'),
            },
          },
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Completed. The debug launch recorded the Library surface without a crash.',
        steps: [
          ...testsAndBuild,
          debugLibraryLaunchPassed,
          finalScopedDiff,
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('does not turn an ordinary Simulator test destination into a UI exercise requirement', () => {
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective:
          'Fix the parser. Run the focused xcodebuild test on an iOS Simulator and run the generic simulator build.',
        content: 'Completed. The focused test and generic build passed.',
        steps: [
          {
            name: 'workspace_write',
            status: 'done',
            resultMeta: 'file changed · persisted abcdef123456',
            preview: persistedChangeProof,
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Tests passed',
            preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
          },
          {
            name: 'run_terminal',
            status: 'done',
            resultMeta: 'exit 0 · Build passed',
            preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
          },
        ],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('accepts only a later structured crash-free check for the same launched device and app', () => {
    const objective =
      'Fix the Library crash, launch and exercise the Library flow in the iOS Simulator, and prove the original crash is gone.'
    const changed = {
      name: 'workspace_write',
      status: 'done' as const,
      resultMeta: 'file changed · persisted abcdef123456',
    }
    const launch = {
      name: 'device_launch',
      status: 'done' as const,
      resultMeta:
        'device proof · launch · ios · d:111111111111 · a:aaaaaaaaaaaa · launched',
    }
    const verified = {
      name: 'device_process',
      status: 'done' as const,
      resultMeta:
        'device proof · process · ios · d:111111111111 · a:aaaaaaaaaaaa · alive · crash-free',
    }

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed. The Library run remained crash-free.',
        steps: [changed, launch, verified],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed.',
        steps: [
          changed,
          launch,
          {
            ...verified,
            resultMeta:
              'device proof · process · ios · d:222222222222 · a:aaaaaaaaaaaa · alive · crash-free',
          },
        ],
      })
    ).toMatchObject({ shouldContinue: true })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed.',
        steps: [
          changed,
          launch,
          verified,
          {
            name: 'device_logs',
            status: 'error',
            resultMeta:
              'device proof · logs · ios · d:111111111111 · a:aaaaaaaaaaaa · crash-detected',
          },
        ],
      })
    ).toMatchObject({ shouldContinue: true })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed.',
        steps: [changed, verified, launch],
      })
    ).toMatchObject({ shouldContinue: true })
  })

  it('applies the same multi-check contract to an inherited task-scoped diff', () => {
    const objective = [
      'Run both required checks:',
      'xcodebuild -project StatsKey.xcodeproj -only-testing:StatsKeyTests/SubstanceNutritionTests test',
      'xcodebuild -project StatsKey.xcodeproj -destination "generic/platform=iOS Simulator" build',
    ].join('\n')
    const reviewedDiff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        additions: 12,
        deletions: 2,
        body: 'diff --git a/SubstanceLogView.swift b/SubstanceLogView.swift',
        items: [{ label: 'SubstanceLogView.swift' }],
      },
    }
    const testPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Tests passed',
      preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
    }
    const buildPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Build passed',
      preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
    }

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Everything is complete.',
        steps: [reviewedDiff, testPassed],
      })
    ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'The focused tests and generic build passed.',
        steps: [reviewedDiff, testPassed, buildPassed],
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('settles an inherited change at the cap when later reruns recover historical failures and the final scoped diff is reviewed', () => {
    const objective = [
      'Finish the existing Library crash fix through verified completion.',
      'Run the focused xcodebuild tests and generic simulator build.',
      'Run the Library-specific 25-cycle UI exercise and confirm LIBRARY_UI_EXERCISE_PASSED.',
      'Review the final task-scoped git diff before reporting Completed.',
    ].join('\n')
    const inheritedDiff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        additions: 12,
        deletions: 2,
        body: 'diff --git a/LibraryView.swift b/LibraryView.swift',
        items: [{ label: 'biometrics/StatsKey/Views/Library/LibraryView.swift' }],
      },
    }
    const failedCheck = (body: string) => ({
      name: 'run_terminal',
      status: 'error' as const,
      resultMeta: 'verification failed · Command failed',
      preview: { title: 'Command failed', body },
    })
    const recoveredSteps = [
      inheritedDiff,
      failedCheck('xcodebuild test\n** TEST FAILED **'),
      failedCheck('xcodebuild build\n** BUILD FAILED **'),
      failedCheck('Library navigation crashed in the Maestro UI exercise.'),
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Tests passed',
        preview: { title: 'Tests passed', body: '** TEST SUCCEEDED **' },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Build passed',
        preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
      },
      {
        name: 'run_terminal',
        status: 'done' as const,
        resultMeta: 'exit 0 · Command passed',
        preview: {
          title: 'Command passed',
          body: [
            'maestro test /tmp/statskey-library-crash.yaml',
            '25/25 Library navigation cycles passed',
            'LIBRARY_UI_EXERCISE_PASSED',
          ].join('\n'),
        },
      },
      {
        ...inheritedDiff,
        preview: {
          ...inheritedDiff.preview,
          body: 'final task-scoped diff reviewed for LibraryView.swift',
        },
      },
    ]

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Completed. The recovered tests, build, Library UI exercise, and final scoped diff all passed.',
        steps: recoveredSteps,
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Completed. The tests, build, Library UI exercise, and final scoped diff all passed.',
        steps: [
          ...recoveredSteps,
          failedCheck('xcodebuild test\n** TEST FAILED **'),
        ],
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
      })
    ).toEqual({
      shouldContinue: false,
      reason: 'required_verification_cap',
    })
  })

  it('does not invent a build requirement from an artifact path or a do-not-rerun instruction', () => {
    const diff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        additions: 4,
        deletions: 1,
        body: 'diff --git a/LibraryView.swift b/LibraryView.swift',
        items: [{ label: 'biometrics/StatsKey/Views/Library/LibraryView.swift' }],
      },
    }
    const uiPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Command passed',
      preview: {
        title: 'Command passed',
        body: 'maestro test statskey-library-crash.yaml\nLIBRARY_UI_EXERCISE_PASSED',
      },
    }
    const objective = [
      'Both simulator builds already passed. Do not rerun builds.',
      'The required fresh Debug simulator app is at /tmp/statskey_dd/Build/Products/Debug-iphonesimulator/StatsKey.app.',
      'Run the Library-specific UI exercise and confirm LIBRARY_UI_EXERCISE_PASSED.',
      'Review the final task-scoped git diff.',
    ].join('\n')

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content:
          'Completed. As instructed, I did not run the build again. The Library UI exercise passed.',
        steps: [diff, uiPassed, diff],
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('keeps later affirmative rerun clauses and absolute xcodebuild commands as requirements', () => {
    const diff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        additions: 3,
        deletions: 1,
        body: 'diff --git a/Fix.swift b/Fix.swift',
        items: [{ label: 'Fix.swift' }],
      },
    }
    const testsPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Tests passed',
      preview: {
        title: 'Tests passed',
        body: 'Command line invocation: /usr/bin/xcodebuild -project StatsKey.xcodeproj test\n** TEST SUCCEEDED **',
      },
    }
    const buildPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Build passed',
      preview: {
        title: 'Build passed',
        body: 'Command line invocation: /usr/bin/xcodebuild -project StatsKey.xcodeproj build\n** BUILD SUCCEEDED **',
      },
    }
    const objectives = [
      'Tests already passed, but rerun the focused tests after the final change. The build passed earlier; rerun the generic build now.',
      'Do not rerun the old tests; run the new focused test. Run the generic build.',
      'Run /usr/bin/xcodebuild -project StatsKey.xcodeproj -destination "platform=iOS Simulator,name=iPhone 17 Pro" test. Run /usr/bin/xcodebuild -project StatsKey.xcodeproj -destination "generic/platform=iOS Simulator" build.',
    ]

    for (const objective of objectives) {
      expect(
        independentImplementationContinuationDecision({
          ...base,
          objective,
          content: 'The tests passed; the build is still pending.',
          steps: [diff, testsPassed],
        })
      ).toEqual({ shouldContinue: true, reason: 'verification_incomplete' })
      expect(
        independentImplementationContinuationDecision({
          ...base,
          objective,
          content: 'The required focused tests and build passed.',
          steps: [diff, testsPassed, buildPassed],
        })
      ).toEqual({ shouldContinue: false, reason: 'completed' })
    }
  })

  it('preserves passing Xcode invocation transcripts, rejects masked failures, and ignores unrelated successful commands', () => {
    const diff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        additions: 2,
        deletions: 1,
        body: 'diff --git a/Fix.swift b/Fix.swift',
        items: [{ label: 'Fix.swift' }],
      },
    }
    const testsPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Tests passed',
      preview: {
        title: 'Tests passed',
        body: 'Command line invocation:\n/usr/bin/xcodebuild -project X test\n** TEST SUCCEEDED **',
      },
    }
    const buildPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Build passed',
      preview: {
        title: 'Build passed',
        body: 'Command line invocation:\n/usr/bin/xcodebuild -project X build\n** BUILD SUCCEEDED **',
      },
    }
    const unrelated = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Command passed',
      preview: { title: 'Command passed', body: 'find . -maxdepth 1' },
    }
    const objective = 'Run the focused tests and generic build after the fix.'

    expect(
      independentImplementationContinuationDecision({
        ...base,
        objective,
        content: 'Completed. The tests and build passed.',
        steps: [diff, testsPassed, buildPassed, unrelated],
        completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })

    for (const successfulBodies of [
      {
        test: 'Tests: 41 passed, 0 failed',
        build: 'Build finished successfully. No build commands failed.',
      },
      {
        test: 'test result: ok. 5 passed; 0 failed; 0 ignored',
        build: '** BUILD SUCCEEDED **',
      },
    ]) {
      expect(
        independentImplementationContinuationDecision({
          ...base,
          objective,
          content: 'Completed. The tests and build passed.',
          steps: [
            diff,
            {
              ...testsPassed,
              preview: { ...testsPassed.preview, body: successfulBodies.test },
            },
            {
              ...buildPassed,
              preview: { ...buildPassed.preview, body: successfulBodies.build },
            },
          ],
          completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
        })
      ).toEqual({ shouldContinue: false, reason: 'completed' })
    }

    for (const masked of [
      {
        ...testsPassed,
        preview: { ...testsPassed.preview, body: '** TEST FAILED **' },
      },
      {
        ...buildPassed,
        preview: { ...buildPassed.preview, body: '** BUILD FAILED **' },
      },
    ]) {
      expect(
        independentImplementationContinuationDecision({
          ...base,
          objective,
          content: 'Completed.',
          steps: [diff, testsPassed, buildPassed, masked],
          completedPasses: MAX_INDEPENDENT_IMPLEMENTATION_PASSES,
        })
      ).toEqual({
        shouldContinue: false,
        reason: 'required_verification_cap',
      })
    }
  })

  it('carries the unchanged objective and recorded progress into the next pass', () => {
    const prompt = automaticImplementationContinuationPrompt({
      objective:
        'Fix workspace expansion and test it.\n<local_evidence>large attachment text</local_evidence>',
      previousContent: 'Implementation incomplete; no files were changed.',
      steps: [
        {
          name: 'workspace_read',
          status: 'done',
          summary: 'workspace_read(file_path: desktop/main.cjs)',
          resultMeta: 'file read',
        },
      ],
      nextPass: 2,
    })

    expect(prompt).toContain('pass="2" max_passes="4"')
    expect(prompt).toContain('original user request and its attachment blocks')
    expect(prompt).toContain('Fix workspace expansion and test it.')
    expect(prompt).not.toContain('large attachment text')
    expect(prompt).toContain('workspace_read(file_path: desktop/main.cjs)')
    expect(prompt).toContain('Evidence collection is closed')
    expect(prompt).toContain('real non-empty workspace mutation')
    expect(prompt).toContain('path outside the intended captured root does not count')
  })

  it('carries an unresolved correction and unsupported claim into an exact read/write pass', () => {
    const prompt = automaticImplementationContinuationPrompt({
      objective: 'Make the requested adaptive layout change.',
      previousContent:
        'Changed Sources/Layout.swift to use ViewThatFits, but one remaining edit was not applied.',
      steps: [
        {
          name: 'workspace_write',
          status: 'done',
          resultMeta: 'file changed · persisted abcdef123456',
          preview: { title: 'Sources/Layout.swift', after: '.font(.headline)' },
        },
      ],
      nextPass: 2,
      correctiveMutationRequired: true,
      requiredClaimIdentifiers: ['ViewThatFits'],
    })

    expect(prompt).toContain('file mutation incomplete')
    expect(prompt).toContain('exact-path read')
    expect(prompt).toContain('persisted corrective mutation')
  })

  it('preserves original attachment blocks exactly in a continuation pass', () => {
    const blocks = [
      { type: 'text', text: 'Fix the attached design.' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'unchanged-image-bytes',
        },
      },
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: 'unchanged-document-bytes',
        },
      },
    ]
    const continued = userContentWithAutomaticContinuation(
      blocks,
      'Resume the same implementation.'
    )
    expect(continued).not.toBe(blocks)
    expect(Array.isArray(continued)).toBe(true)
    expect((continued as typeof blocks).slice(0, blocks.length)).toEqual(blocks)
    expect((continued as typeof blocks).at(-1)).toEqual({
      type: 'text',
      text: 'Resume the same implementation.',
    })
    expect(blocks).toHaveLength(3)
  })
})
