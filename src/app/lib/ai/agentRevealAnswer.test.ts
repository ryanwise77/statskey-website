import { describe, expect, it, vi } from 'vitest'
import {
  revealAnswer,
  type AnswerRevealEnvironment,
} from './agent'

function controlledRevealEnvironment(initiallyHidden = false) {
  let now = 0
  let hidden = initiallyHidden
  let nextTimer = 1
  const timers = new Map<number, () => void>()
  const visibilityListeners = new Set<() => void>()

  const environment: AnswerRevealEnvironment = {
    now: () => now,
    setTimer: (callback) => {
      const id = nextTimer++
      timers.set(id, callback)
      return id as ReturnType<typeof setTimeout>
    },
    clearTimer: (timer) => {
      timers.delete(timer as number)
    },
    isHidden: () => hidden,
    addVisibilityListener: (listener) => visibilityListeners.add(listener),
    removeVisibilityListener: (listener) =>
      visibilityListeners.delete(listener),
  }

  return {
    environment,
    hide() {
      hidden = true
      for (const listener of [...visibilityListeners]) listener()
    },
    fireNextTimer(elapsedMilliseconds: number) {
      now += elapsedMilliseconds
      const entry = timers.entries().next().value as
        | [number, () => void]
        | undefined
      if (!entry) throw new Error('Expected a pending reveal timer.')
      timers.delete(entry[0])
      entry[1]()
    },
    pendingTimers: () => timers.size,
    visibilityListeners: () => visibilityListeners.size,
  }
}

describe('managed final-answer reveal', () => {
  it('publishes the complete answer synchronously when the window starts hidden', async () => {
    const control = controlledRevealEnvironment(true)
    const onText = vi.fn()

    const reveal = revealAnswer(
      'The complete final handoff.',
      onText,
      undefined,
      control.environment
    )

    expect(onText).toHaveBeenCalledExactlyOnceWith(
      'The complete final handoff.'
    )
    await reveal
    expect(control.pendingTimers()).toBe(0)
    expect(control.visibilityListeners()).toBe(0)
  })

  it('finishes immediately and cleans up when the window becomes hidden mid-reveal', async () => {
    const control = controlledRevealEnvironment()
    const updates: string[] = []
    const text = 'One two three four five six.'
    const reveal = revealAnswer(
      text,
      (value) => updates.push(value),
      undefined,
      control.environment
    )

    expect(updates.at(-1)).not.toBe(text)
    expect(control.pendingTimers()).toBe(1)
    expect(control.visibilityListeners()).toBe(1)

    control.hide()
    await reveal

    expect(updates.at(-1)).toBe(text)
    expect(control.pendingTimers()).toBe(0)
    expect(control.visibilityListeners()).toBe(0)
  })

  it('uses elapsed time to finish within two one-second-clamped timer callbacks', async () => {
    const control = controlledRevealEnvironment()
    const text = Array.from({ length: 240 }, (_, index) => `word-${index}`).join(
      ' '
    )
    const updates: string[] = []
    const reveal = revealAnswer(
      text,
      (value) => updates.push(value),
      undefined,
      control.environment
    )

    control.fireNextTimer(1_000)
    expect(updates.at(-1)?.length).toBeGreaterThan(text.length / 2)
    expect(control.pendingTimers()).toBe(1)

    control.fireNextTimer(1_000)
    await reveal

    expect(updates.at(-1)).toBe(text)
    expect(control.pendingTimers()).toBe(0)
    expect(control.visibilityListeners()).toBe(0)
  })

  it('stops without overwriting partial text with the final answer', async () => {
    const control = controlledRevealEnvironment()
    const text = 'One two three four five six.'
    const updates: string[] = []
    let stopped = false
    const reveal = revealAnswer(
      text,
      (value) => updates.push(value),
      () => stopped,
      control.environment
    )

    stopped = true
    control.fireNextTimer(1_000)
    await reveal

    expect(updates.at(-1)).not.toBe(text)
    expect(control.pendingTimers()).toBe(0)
    expect(control.visibilityListeners()).toBe(0)
  })
})
