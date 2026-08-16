import { describe, expect, it } from 'vitest'
import { queueBackgroundSessionSync } from './sessionSyncQueue'

describe('background session sync', () => {
  it('keeps started and final snapshots ordered without blocking the caller', async () => {
    const events: string[] = []
    let releaseStarted: (() => void) | undefined
    const started = queueBackgroundSessionSync('session-1', async () => {
      events.push('started:begin')
      await new Promise<void>((resolve) => {
        releaseStarted = resolve
      })
      events.push('started:end')
    })
    const final = queueBackgroundSessionSync('session-1', async () => {
      events.push('final')
    })

    for (let index = 0; index < 4 && !releaseStarted; index += 1) {
      await Promise.resolve()
    }
    expect(events).toEqual(['started:begin'])
    releaseStarted?.()
    await Promise.all([started, final])
    expect(events).toEqual(['started:begin', 'started:end', 'final'])
  })

  it('continues to the final snapshot after an earlier remote failure', async () => {
    const events: string[] = []
    const failed = queueBackgroundSessionSync('session-2', async () => {
      events.push('started')
      throw new Error('offline')
    })
    const final = queueBackgroundSessionSync('session-2', async () => {
      events.push('final')
    })

    await Promise.all([failed, final])
    expect(events).toEqual(['started', 'final'])
  })
})
