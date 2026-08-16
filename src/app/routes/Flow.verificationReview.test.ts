import { describe, expect, it } from 'vitest'
import { verificationReviewSummary } from './Flow'
import type { ChatMessageStep } from '../lib/data/useChatSessions'

function step(partial: Partial<ChatMessageStep>): ChatMessageStep {
  return {
    name: 'run_terminal',
    summary: 'Run check',
    ...partial,
  }
}

describe('verificationReviewSummary infrastructure failures', () => {
  it('treats an expired-reference failure as recovered once any later check runs and exits 0', () => {
    const review = verificationReviewSummary([
      step({
        failed: true,
        resultMeta: 'failed · Unknown or expired workspace root reference.',
      }),
      step({ resultMeta: 'exit 0 · Command passed' }),
    ])
    expect(review.unresolvedFailureCount).toBe(0)
    expect(review.recoveredFailureCount).toBe(1)
    expect(review.checks[0].state).toBe('earlier-failure')
  })

  it('keeps an expired-reference failure unresolved when no later check ran', () => {
    const review = verificationReviewSummary([
      step({
        failed: true,
        resultMeta: 'failed · Unknown or expired workspace root reference.',
      }),
    ])
    expect(review.unresolvedFailureCount).toBe(1)
    expect(review.checks[0].state).toBe('failed')
  })

  it('still requires same-category recovery for real verification failures', () => {
    const review = verificationReviewSummary([
      step({
        failed: true,
        resultMeta: 'exit 65',
        preview: {
          kind: 'command',
          title: 'Checking that the Xcode project builds',
          body: '** BUILD FAILED **',
        },
      }),
      step({ resultMeta: 'exit 0 · Command passed' }),
    ])
    expect(review.unresolvedFailureCount).toBe(1)
    expect(review.checks[0].state).toBe('failed')
  })
})
