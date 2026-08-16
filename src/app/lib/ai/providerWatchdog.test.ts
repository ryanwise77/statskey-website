import { describe, expect, it, vi } from 'vitest'
import {
  ProviderRoundTimeoutError,
  withProviderRoundWatchdog,
} from './providerWatchdog'

describe('direct provider watchdog', () => {
  it('does not count queue time against the active-round inactivity limit', async () => {
    vi.useFakeTimers()
    const minute = 60_000
    let finish: ((value: string) => void) | undefined
    const run = withProviderRoundWatchdog(
      async (markAlive) => {
        markAlive('queued')
        return await new Promise<string>((resolve) => {
          finish = resolve
        })
      },
      {
        connectionTimeoutMs: 10_000,
        queueTimeoutMs: 10 * minute,
        activeInactivityTimeoutMs: 5 * minute,
      }
    )

    await vi.advanceTimersByTimeAsync(6 * minute)
    finish?.('done')
    await expect(run).resolves.toBe('done')
    vi.useRealTimers()
  })

  it('resets active inactivity on each main-process heartbeat', async () => {
    vi.useFakeTimers()
    const minute = 60_000
    let pulse: (() => void) | undefined
    let finish: ((value: string) => void) | undefined
    const run = withProviderRoundWatchdog(
      async (markAlive) => {
        pulse = () => markAlive('active')
        pulse()
        return await new Promise<string>((resolve) => {
          finish = resolve
        })
      },
      { activeInactivityTimeoutMs: 5 * minute }
    )

    await vi.advanceTimersByTimeAsync(4 * minute)
    pulse?.()
    await vi.advanceTimersByTimeAsync(4 * minute)
    finish?.('done')
    await expect(run).resolves.toBe('done')
    vi.useRealTimers()
  })

  it('does not let heartbeats keep an active provider round alive forever', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    let pulse: (() => void) | undefined
    const run = withProviderRoundWatchdog(
      async (markAlive) => {
        pulse = () => markAlive('active')
        pulse()
        return await new Promise<string>(() => {})
      },
      {
        activeInactivityTimeoutMs: 100,
        activeMaximumTimeoutMs: 250,
        onTimeout: cancel,
      }
    )
    const rejection = expect(run).rejects.toMatchObject({
      name: 'ProviderRoundTimeoutError',
      phase: 'active-limit',
    })

    await vi.advanceTimersByTimeAsync(90)
    pulse?.()
    await vi.advanceTimersByTimeAsync(90)
    pulse?.()
    await vi.advanceTimersByTimeAsync(71)
    await rejection
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('cancels once on real inactivity and clears its timer', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const run = withProviderRoundWatchdog(
      async (markAlive) => {
        markAlive('active')
        return await new Promise<string>(() => {})
      },
      { activeInactivityTimeoutMs: 50, onTimeout: cancel }
    )
    const rejection = expect(run).rejects.toBeInstanceOf(
      ProviderRoundTimeoutError
    )

    await vi.advanceTimersByTimeAsync(51)
    await rejection
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('clears its watchdog when the provider completes', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    await expect(
      withProviderRoundWatchdog(
        async (markAlive) => {
          markAlive('active')
          return 'complete'
        },
        { activeInactivityTimeoutMs: 50, onTimeout: cancel }
      )
    ).resolves.toBe('complete')

    await vi.advanceTimersByTimeAsync(100)
    expect(cancel).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
