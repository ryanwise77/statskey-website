import { describe, expect, it } from 'vitest'
import {
  computeReadiness,
  workoutLoad,
} from './healthInsights'
import type { WorkoutSession } from './types'
import type { VitalSample } from './data/useVitalsRange'

describe('desktop readiness parity', () => {
  it('uses wake-day sleep rather than the previous calendar day', () => {
    const reference = localDate(2026, 8, 8)
    const readiness = computeReadiness({
      sleepDays: [
        { date: localDate(2026, 8, 8), hours: 4, stageHours: {} },
        { date: localDate(2026, 8, 7), hours: 9, stageHours: {} },
        ...Array.from({ length: 8 }, (_, index) => ({
          date: localDate(2026, 8, 6 - index),
          hours: 8,
          stageHours: {},
        })),
      ],
      vitals: [
        vital('heartRateVariabilitySDNN', 100, reference),
        ...Array.from({ length: 7 }, (_, index) =>
          vital(
            'heartRateVariabilitySDNN',
            100,
            localDate(2026, 8, 7 - index)
          )
        ),
      ],
      workouts: [],
      meals: [],
      calorieTarget: 2_000,
      carbTarget: 250,
      reference,
    })
    expect(readiness.hasData).toBe(true)
    const sleep = readiness.pillars.find((pillar) => pillar.id === 'sleep')
    expect(sleep?.detail).toMatch(/^4\.0 h/)
    expect(sleep?.score).toBe(0)
  })

  it('does not treat physiology older than yesterday as current', () => {
    const reference = localDate(2026, 8, 8)
    const workouts = Array.from({ length: 35 }, (_, index) =>
      workout({
        startDate: localDate(2026, 8, 7 - index),
        sportType: 'running',
        duration: 45 * 60,
      })
    )
    const readiness = computeReadiness({
      sleepDays: [
        { date: reference, hours: 8, stageHours: {} },
        ...Array.from({ length: 8 }, (_, index) => ({
          date: localDate(2026, 8, 7 - index),
          hours: 8,
          stageHours: {},
        })),
      ],
      vitals: [
        vital('heartRateVariabilitySDNN', 85, localDate(2026, 8, 6)),
        vital('restingHeartRate', 58, localDate(2026, 8, 6)),
        ...Array.from({ length: 8 }, (_, index) =>
          vital(
            'heartRateVariabilitySDNN',
            100,
            localDate(2026, 8, 5 - index)
          )
        ),
        ...Array.from({ length: 8 }, (_, index) =>
          vital('restingHeartRate', 55, localDate(2026, 8, 5 - index))
        ),
      ],
      workouts,
      meals: [],
      calorieTarget: 2_000,
      carbTarget: 250,
      reference,
    })
    expect(readiness.hasData).toBe(true)
    expect(readiness.pillars.some((pillar) => pillar.id === 'hrv')).toBe(false)
    expect(readiness.pillars.some((pillar) => pillar.id === 'rhr')).toBe(false)
  })
})

describe('workout load parity', () => {
  it('uses relative effort when present', () => {
    expect(workoutLoad(workout({ relativeEffort: 42 }))).toBe(42)
  })

  it('falls back to heart-rate-reserve TRIMP', () => {
    const value = workoutLoad(
      workout({
        duration: 60 * 60,
        averageHeartRate: 150,
        maxHeartRate: 190,
      })
    )
    const fraction = (150 - 60) / (190 - 60)
    expect(value).toBeCloseTo(
      60 * fraction * 0.64 * Math.exp(1.92 * fraction),
      8
    )
  })

  it('falls back to duration times sport intensity without heart rate', () => {
    expect(
      workoutLoad(
        workout({
          duration: 60 * 60,
          sportType: 'running',
          averageHeartRate: 0,
        })
      )
    ).toBe(72)
  })
})

function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12)
}

function vital(
  kind: VitalSample['kind'],
  value: number,
  date: Date
): VitalSample {
  return { id: crypto.randomUUID(), kind, value, date }
}

function workout(
  overrides: Partial<WorkoutSession> = {}
): WorkoutSession {
  return {
    id: crypto.randomUUID(),
    userId: 'test',
    title: 'Test workout',
    sportType: 'running',
    startDate: localDate(2026, 8, 7),
    duration: 60 * 60,
    movingTime: 60 * 60,
    distance: 6,
    elevationGain: 0,
    elevationLoss: 0,
    calories: 0,
    averagePace: 600,
    bestPace: 580,
    averageSpeed: 6,
    maxSpeed: 7,
    averageHeartRate: 0,
    maxHeartRate: 0,
    averageCadence: 0,
    isFavorite: false,
    relativeEffort: 0,
    gradeAdjustedPace: 600,
    photoURLs: [],
    source: 'manual',
    isIndoor: false,
    recordingMode: 'standard',
    createdAt: localDate(2026, 8, 7),
    routeCoordinates: [],
    splits: [],
    ...overrides,
  }
}
