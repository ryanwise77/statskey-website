import { describe, expect, it } from 'vitest'
import { workoutTiming } from './types'

describe('workoutTiming', () => {
  it('classifies a pool-swim moving gap as rest, not a pause', () => {
    const startDate = new Date('2026-08-15T19:21:00Z')
    const timing = workoutTiming({
      sportType: 'swimming',
      isIndoor: true,
      startDate,
      endDate: new Date(startDate.getTime() + 769_000),
      duration: 769,
      movingTime: 657,
      pausedTime: 0,
    })

    expect(timing.elapsed).toBe(769)
    expect(timing.swimRest).toBe(112)
    expect(timing.hasSwimRest).toBe(true)
    expect(timing.paused).toBe(0)
    expect(timing.hasPause).toBe(false)
    expect(timing.pauseBasis).toBe('unavailable')
  })

  it('keeps an explicit swim pause separate from pool rest', () => {
    const startDate = new Date('2026-08-15T19:21:00Z')
    const timing = workoutTiming({
      sportType: 'swimming',
      isIndoor: true,
      startDate,
      endDate: new Date(startDate.getTime() + 829_000),
      duration: 769,
      movingTime: 657,
      pausedTime: 60,
    })

    expect(timing.elapsed).toBe(829)
    expect(timing.swimRest).toBe(112)
    expect(timing.paused).toBe(60)
    expect(timing.hasPause).toBe(true)
    expect(timing.pauseBasis).toBe('explicit')
  })

  it('retains the legacy moving-gap pause fallback for non-swims', () => {
    const startDate = new Date('2026-08-15T19:21:00Z')
    const timing = workoutTiming({
      sportType: 'running',
      isIndoor: false,
      startDate,
      endDate: new Date(startDate.getTime() + 600_000),
      duration: 600,
      movingTime: 540,
      pausedTime: 0,
    })

    expect(timing.swimRest).toBe(0)
    expect(timing.paused).toBe(60)
    expect(timing.hasPause).toBe(true)
    expect(timing.pauseBasis).toBe('movingGap')
  })

  it('does not classify an open-water moving gap as pool rest', () => {
    const startDate = new Date('2026-08-15T19:21:00Z')
    const timing = workoutTiming({
      sportType: 'swimming',
      isIndoor: false,
      startDate,
      endDate: new Date(startDate.getTime() + 600_000),
      duration: 600,
      movingTime: 540,
      pausedTime: 0,
    })

    expect(timing.swimRest).toBe(0)
    expect(timing.paused).toBe(60)
    expect(timing.hasPause).toBe(true)
    expect(timing.pauseBasis).toBe('movingGap')
  })
})
