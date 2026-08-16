import { describe, expect, it } from 'vitest'
import {
  rollupSleepSessions,
  type SleepSession,
} from './useSleepSessions'

describe('sleep session rollups', () => {
  it('uses asleep stages only, merges overlaps, and assigns the wake day', () => {
    const sessions: SleepSession[] = [
      sleep('inBed', at(2026, 8, 7, 21, 30), at(2026, 8, 8, 4, 30)),
      sleep('asleepCore', at(2026, 8, 7, 22), at(2026, 8, 8, 2)),
      // Duplicate source overlap must not double-count sleep.
      sleep('asleepCore', at(2026, 8, 7, 22), at(2026, 8, 8, 2)),
      sleep('asleepDeep', at(2026, 8, 8, 2), at(2026, 8, 8, 4)),
      sleep('awake', at(2026, 8, 8, 3), at(2026, 8, 8, 3, 20)),
    ]
    const days = rollupSleepSessions(
      sessions,
      at(2026, 8, 8),
      at(2026, 8, 8, 23, 59)
    )
    expect(days).toHaveLength(1)
    expect(days[0].date.getDate()).toBe(8)
    expect(days[0].hours).toBe(6)
    expect(days[0].stageHours.asleepCore).toBe(4)
    expect(days[0].stageHours.asleepDeep).toBe(2)
  })

  it('drops stray sleep fragments shorter than thirty minutes', () => {
    const days = rollupSleepSessions(
      [sleep('asleepCore', at(2026, 8, 8, 12), at(2026, 8, 8, 12, 20))],
      at(2026, 8, 8),
      at(2026, 8, 8, 23, 59)
    )
    expect(days).toEqual([])
  })
})

function sleep(
  stage: SleepSession['stage'],
  startDate: Date,
  endDate: Date
): SleepSession {
  return {
    id: crypto.randomUUID(),
    stage,
    startDate,
    endDate,
    source: 'test',
  }
}

function at(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0
): Date {
  return new Date(year, month - 1, day, hour, minute)
}
