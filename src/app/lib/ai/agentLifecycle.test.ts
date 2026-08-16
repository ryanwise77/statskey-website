import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentRoundCancelledError,
  AgentRoundDeadlineError,
  drainSteeringBatch,
  isAgentRoundDeadline,
  withCancellableAgentRound,
} from './agentLifecycle'

afterEach(() => {
  vi.useRealTimers()
})

describe('agent completion lifecycle', () => {
  it('normalizes Firebase callable deadlines into the managed timeout path', () => {
    expect(isAgentRoundDeadline(new AgentRoundDeadlineError())).toBe(true)
    expect(isAgentRoundDeadline({ code: 'functions/deadline-exceeded' })).toBe(
      true
    )
    expect(isAgentRoundDeadline(new Error('deadline-exceeded'))).toBe(true)
    expect(isAgentRoundDeadline(new Error('permission-denied'))).toBe(false)
  })

  it('drains one bounded steering batch without discarding the remainder', () => {
    const queue = Array.from({ length: 10 }, (_, index) => `message-${index + 1}`)

    expect(drainSteeringBatch(queue)).toEqual(
      Array.from({ length: 8 }, (_, index) => `message-${index + 1}`)
    )
    expect(queue).toEqual(['message-9', 'message-10'])
  })

  it('settles a managed round whose provider never returns', async () => {
    vi.useFakeTimers()
    const round = withCancellableAgentRound(
      () => new Promise<never>(() => {}),
      {
        timeoutMilliseconds: 1_000,
        cancellationKey: 'deadline-test',
      }
    )
    const rejection = expect(round).rejects.toBeInstanceOf(AgentRoundDeadlineError)

    await vi.advanceTimersByTimeAsync(1_001)
    await rejection
  })

  it('cancels a managed round and unregisters its cancellation slot', async () => {
    const control: { cancel?: () => void } = {}
    const registrations: Array<string> = []
    const round = withCancellableAgentRound(
      () => new Promise<never>(() => {}),
      {
        timeoutMilliseconds: 60_000,
        cancellationKey: 'cancel-test',
        registerCancel: (next, key) => {
          control.cancel = next ?? undefined
          registrations.push(`${key}:${next ? 'open' : 'closed'}`)
        },
      }
    )
    const rejection = expect(round).rejects.toBeInstanceOf(AgentRoundCancelledError)

    control.cancel?.()
    await rejection
    expect(registrations).toEqual(['cancel-test:open', 'cancel-test:closed'])
  })

  it('does not dispatch a provider request after Stop was already requested', async () => {
    const start = vi.fn(async () => 'unexpected')

    await expect(
      withCancellableAgentRound(start, {
        timeoutMilliseconds: 60_000,
        cancellationKey: 'pre-stopped-test',
        shouldStop: () => true,
      })
    ).rejects.toBeInstanceOf(AgentRoundCancelledError)
    expect(start).not.toHaveBeenCalled()
  })
})
