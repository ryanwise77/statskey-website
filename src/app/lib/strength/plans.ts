import {
  cleanStrengthValue, decodePlannedSet, newSession, newSet, newStrengthID, strengthDate,
  type StrengthExercise, type StrengthPlannedSet, type StrengthSession,
} from './model.ts'

export interface StrengthRoutineExercise extends Omit<StrengthExercise, 'sets'> {
  plannedSets: StrengthPlannedSet[]
}
export interface StrengthRoutine {
  id: string
  name: string
  folder?: string
  exercises: StrengthRoutineExercise[]
  notes: string
  createdAt: Date
  updatedAt: Date
}
export interface StrengthPlanDay {
  id: string
  dayOfWeek: number
  routineId?: string
  routineName?: string
  isRest: boolean
  notes: string
}
export interface StrengthWeekPlan {
  id: string
  name: string
  isActive: boolean
  days: StrengthPlanDay[]
  dateOverrides: Record<string, StrengthPlanDay>
  createdAt: Date
  updatedAt: Date
}
export const STRENGTH_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
type Raw = Record<string, unknown>
const raw = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {}
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const rows = (value: unknown) => Array.isArray(value) ? value : []
const optionalNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** A missing expected date means a create; existing templates must match the opened revision. */
export function assertStrengthRevision(data: Record<string, unknown> | undefined, expected: Date | null): void {
  if (expected == null ? data != null : !data || (strengthDate(data.updatedAt)?.getTime() ?? 0) !== expected.getTime())
    throw new Error('This was changed on another device. Reopen it to review the latest version before saving.')
}

export function newStrengthRoutine(): StrengthRoutine {
  const now = new Date()
  return { id: newStrengthID(), name: '', exercises: [], notes: '', createdAt: now, updatedAt: now }
}
export function newStrengthPlanDay(dayOfWeek: number): StrengthPlanDay {
  return { id: newStrengthID(), dayOfWeek, isRest: false, notes: '' }
}
export function newStrengthWeekPlan(): StrengthWeekPlan {
  const now = new Date()
  return { id: newStrengthID(), name: 'My Week', isActive: true,
    days: STRENGTH_DAYS.map((_, i) => newStrengthPlanDay(i + 1)), dateOverrides: {}, createdAt: now, updatedAt: now }
}
export function decodeStrengthRoutine(value: unknown, id: string): StrengthRoutine | null {
  const data = raw(value)
  if (data.id && data.id !== id) return null
  return { id, name: text(data.name), folder: text(data.folder) || undefined,
    notes: text(data.notes), createdAt: strengthDate(data.createdAt) ?? new Date(0), updatedAt: strengthDate(data.updatedAt) ?? new Date(0),
    exercises: rows(data.exercises).map((value) => {
      const e = raw(value)
      return { id: text(e.id) || newStrengthID(), exerciseId: text(e.exerciseId), name: text(e.name),
        equipment: text(e.equipment, 'other'), measure: e.measure === 'time' ? 'time' : 'reps',
        primaryMuscles: rows(e.primaryMuscles).filter((v): v is string => typeof v === 'string'),
        supersetGroup: text(e.supersetGroup) || undefined, notes: text(e.notes), restSeconds: optionalNumber(e.restSeconds),
        plannedSets: rows(e.plannedSets).map(decodePlannedSet),
      }
    }),
  }
}
function decodePlanDay(value: unknown, fallbackDay: number): StrengthPlanDay {
  const day = raw(value)
  return { id: text(day.id) || newStrengthID(), dayOfWeek: optionalNumber(day.dayOfWeek) ?? fallbackDay,
    routineId: text(day.routineId) || undefined, routineName: text(day.routineName) || undefined,
    isRest: day.isRest === true, notes: text(day.notes) }
}
export function decodeStrengthWeekPlan(value: unknown, id: string): StrengthWeekPlan | null {
  const plan = raw(value)
  if (plan.id && plan.id !== id) return null
  return { id, name: text(plan.name, 'My Week'), isActive: plan.isActive !== false,
    days: rows(plan.days).length ? rows(plan.days).map((v, i) => decodePlanDay(v, i + 1)) : STRENGTH_DAYS.map((_, i) => newStrengthPlanDay(i + 1)),
    dateOverrides: Object.fromEntries(Object.entries(raw(plan.dateOverrides)).map(([key, v]) => [key, decodePlanDay(v, 1)])),
    createdAt: strengthDate(plan.createdAt) ?? new Date(0), updatedAt: strengthDate(plan.updatedAt) ?? new Date(0) }
}
export function strengthDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function strengthPlanDay(plan: StrengthWeekPlan, date: Date): StrengthPlanDay | undefined {
  return plan.dateOverrides[strengthDateKey(date)] ?? plan.days.find((day) => day.dayOfWeek === (date.getDay() || 7))
}
export function validateStrengthRoutine(routine: StrengthRoutine): string | null {
  if (!routine.name.trim()) return 'Give your routine a name.'
  if (!routine.exercises.length) return 'Add at least one exercise.'
  if (routine.exercises.length > 100) return 'Keep a routine to 100 exercises or fewer.'
  const ids = routine.exercises.flatMap((e) => [e.id, ...e.plannedSets.map((s) => s.id)])
  if (new Set(ids).size !== ids.length || ids.some((id) => !id || id.includes('/'))) return 'Exercises and sets must have unique identities.'
  for (const exercise of routine.exercises) {
    if (!exercise.name.trim()) return 'Give every exercise a name.'
    if (!exercise.plannedSets.length) return 'Add at least one set to each exercise.'
    if (exercise.plannedSets.length > 100) return 'Keep each exercise to 100 sets or fewer.'
    if (exercise.restSeconds != null && (!Number.isInteger(exercise.restSeconds) || exercise.restSeconds < 0 || exercise.restSeconds > 1800)) return 'Rest must be a whole number from 0 to 1800 seconds.'
    for (const set of exercise.plannedSets) {
      if (!['working', 'warmup', 'drop', 'failure'].includes(set.setType)) return 'Choose a valid set type.'
      for (const [key, label] of [['reps', 'Reps'], ['durationSeconds', 'Work time']] as const)
        if (set[key] != null && (!Number.isInteger(set[key]) || set[key]! <= 0)) return `${label} must be a whole number greater than zero.`
      if (set.weightLbs != null && (!Number.isFinite(set.weightLbs) || set.weightLbs < 0)) return 'Weight must be zero or greater.'
      if (set.restSeconds != null && (!Number.isInteger(set.restSeconds) || set.restSeconds < 0 || set.restSeconds > 1800)) return 'Rest must be a whole number from 0 to 1800 seconds.'
      for (const value of [set.targetHeartRateMin, set.targetHeartRateMax])
        if (value != null && (!Number.isInteger(value) || value < 30 || value > 250)) return 'Heart rate targets must be between 30 and 250 bpm.'
      if (set.targetHeartRateMin != null && set.targetHeartRateMax != null && set.targetHeartRateMin > set.targetHeartRateMax) return 'Maximum heart rate must be at least the minimum.'
      if (set.targetRPE != null && (!Number.isFinite(set.targetRPE) || set.targetRPE < 1 || set.targetRPE > 10)) return 'Target effort must be between RPE 1 and 10.'
    }
  }
  return null
}
export function encodeStrengthRoutine(routine: StrengthRoutine): Record<string, unknown> {
  const error = validateStrengthRoutine(routine)
  if (error) throw new Error(error)
  return cleanStrengthValue({ ...routine, name: routine.name.trim(), exercises: routine.exercises.map((e) => ({ ...e,
    name: e.name.trim(), primaryMuscles: e.primaryMuscles ?? [], notes: e.notes ?? '',
    plannedSets: e.plannedSets.map((s) => ({ ...s, reps: e.measure === 'time' ? undefined : s.reps })),
  })) }) as Record<string, unknown>
}
export function sessionFromStrengthRoutine(routine: StrengthRoutine, uid: string, date = new Date(), dayKey?: string): StrengthSession {
  return { ...newSession(uid, date), startDate: date, recordingMode: 'live', title: routine.name,
    routineId: routine.id, routineName: routine.name, planDayKey: dayKey, notes: routine.notes,
    entries: routine.exercises.map((e) => ({ id: newStrengthID(), exerciseId: e.exerciseId, name: e.name,
      equipment: e.equipment, primaryMuscles: e.primaryMuscles, supersetGroup: e.supersetGroup, notes: e.notes,
      measure: e.measure, restSeconds: e.restSeconds, targetSets: e.plannedSets.length,
      sets: (e.plannedSets.length ? e.plannedSets : [{ id: newStrengthID(), setType: 'working' }]).map((s, i) => ({
        ...newSet(i + 1), setType: s.setType, weightLbs: s.weightLbs,
        reps: e.measure === 'time' ? undefined : s.reps, durationSeconds: e.measure === 'time' ? s.durationSeconds : undefined,
        plannedTarget: { ...s },
      })),
    })),
  }
}
export function routineFromStrengthSession(session: StrengthSession): StrengthRoutine {
  return { ...newStrengthRoutine(), name: session.title, notes: session.notes,
    exercises: session.entries.map((e) => ({ id: newStrengthID(), exerciseId: e.exerciseId, name: e.name,
      equipment: e.equipment, primaryMuscles: e.primaryMuscles, supersetGroup: e.supersetGroup,
      measure: e.measure, notes: e.notes, restSeconds: e.restSeconds,
      plannedSets: e.sets.map((s) => ({ id: newStrengthID(), setType: s.setType,
        // Bodyweight or assistance amounts must never become ordinary external-load prescriptions.
        weightLbs: !s.loadKind || s.loadKind === 'externalWeight' ? s.weightLbs : undefined,
        reps: e.measure === 'time' ? undefined : s.reps,
        durationSeconds: e.measure === 'time' && s.durationSeconds != null ? Math.round(s.durationSeconds) : undefined,
        restSeconds: s.plannedTarget?.restSeconds,
        targetHeartRateMin: s.plannedTarget?.targetHeartRateMin, targetHeartRateMax: s.plannedTarget?.targetHeartRateMax,
        targetRPE: s.plannedTarget?.targetRPE,
      })),
    })),
  }
}
