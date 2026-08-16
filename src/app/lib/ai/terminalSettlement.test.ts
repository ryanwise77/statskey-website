import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopTerminalSession } from '../desktop'
import { waitForTerminalSettlement } from './terminalSettlement'

describe('terminal settlement watchdog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a normal terminal exit without cancelling', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const session = finishedSession('exited')

    await expect(
      waitForTerminalSettlement({
        completion: Promise.resolve(session),
        cancel,
        deadlineMs: 100,
        postCancelMs: 20,
      })
    ).resolves.toMatchObject({ session, trigger: null, postCancelExpired: false })
    expect(cancel).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels at the independent deadline and accepts a confirmed exit', async () => {
    vi.useFakeTimers()
    let finish: ((session: DesktopTerminalSession) => void) | undefined
    const completion = new Promise<DesktopTerminalSession>((resolve) => {
      finish = resolve
    })
    const cancelled = finishedSession('cancelled')
    const cancel = vi.fn(() => finish?.(cancelled))
    const waiting = waitForTerminalSettlement({
      completion,
      cancel,
      deadlineMs: 50,
      postCancelMs: 20,
    })

    await vi.advanceTimersByTimeAsync(50)
    await expect(waiting).resolves.toMatchObject({
      session: cancelled,
      trigger: 'deadline',
      postCancelExpired: false,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles after the bounded post-cancel wait when cancellation is ignored', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => {
      throw new Error('PTY is unavailable')
    })
    const waiting = waitForTerminalSettlement({
      completion: new Promise<DesktopTerminalSession>(() => {}),
      cancel,
      deadlineMs: 50,
      postCancelMs: 20,
    })

    await vi.advanceTimersByTimeAsync(70)
    await expect(waiting).resolves.toMatchObject({
      session: null,
      trigger: 'deadline',
      postCancelExpired: true,
      cancelError: 'PTY is unavailable',
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds an explicit stop without waiting for the command deadline', async () => {
    vi.useFakeTimers()
    let requestCancel: (() => void) | undefined
    const cancelRequested = new Promise<void>((resolve) => {
      requestCancel = resolve
    })
    const cancel = vi.fn()
    const waiting = waitForTerminalSettlement({
      completion: new Promise<DesktopTerminalSession>(() => {}),
      cancel,
      cancelRequested,
      deadlineMs: 10_000,
      postCancelMs: 20,
    })

    requestCancel?.()
    await vi.advanceTimersByTimeAsync(20)
    await expect(waiting).resolves.toMatchObject({
      session: null,
      trigger: 'cancelled',
      postCancelExpired: true,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

function finishedSession(
  status: DesktopTerminalSession['status']
): DesktopTerminalSession {
  return {
    id: 'terminal-1',
    command: 'true',
    cwd: '/tmp/workspace',
    rootName: 'workspace',
    status,
    output: '',
    exitCode: status === 'exited' ? 0 : null,
    signal: null,
    startedAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:01.000Z',
  }
}
