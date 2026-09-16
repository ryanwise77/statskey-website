import { EQUIPMENT, cleanStrengthValue, newExercise, newStrengthID, strengthDate, type StrengthExercise } from './model.ts'
import { NATIVE_STRENGTH_CATALOG } from './catalog-data.ts'
export interface StrengthCatalogExercise {
  id: string
  name: string
  equipment: string
  primaryMuscles: string[]
  secondaryMuscles: string[]
  aliases: string[]
  isCustom: boolean
  notes: string
  createdAt: Date
  measure: 'reps' | 'time'
}
export const STRENGTH_MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'fullBody'] as const
export const BUILT_IN_STRENGTH_EXERCISES: StrengthCatalogExercise[] = NATIVE_STRENGTH_CATALOG.map((e) => ({
  ...e, primaryMuscles: [...e.primaryMuscles], secondaryMuscles: [...e.secondaryMuscles], aliases: [...e.aliases],
  isCustom: false, notes: '', createdAt: new Date(0),
}))
export function newCustomStrengthExercise(name = ''): StrengthCatalogExercise {
  return { id: newStrengthID(), name, equipment: 'other', primaryMuscles: [], secondaryMuscles: [], aliases: [],
    isCustom: true, notes: '', createdAt: new Date(), measure: 'reps' }
}
export function decodeCustomStrengthExercise(value: unknown, id: string): StrengthCatalogExercise | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const e = value as Record<string, unknown>
  if ((e.id && e.id !== id) || !id || id.includes('/') || BUILT_IN_STRENGTH_EXERCISES.some((item) => item.id === id)) return null
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  return { id, name: typeof e.name === 'string' ? e.name : '', equipment: typeof e.equipment === 'string' ? e.equipment : 'other',
    primaryMuscles: strings(e.primaryMuscles), secondaryMuscles: strings(e.secondaryMuscles), aliases: strings(e.aliases),
    isCustom: true, notes: typeof e.notes === 'string' ? e.notes : '', createdAt: strengthDate(e.createdAt) ?? new Date(0),
    measure: e.measure === 'time' ? 'time' : 'reps' }
}
export function encodeCustomStrengthExercise(exercise: StrengthCatalogExercise): Record<string, unknown> {
  if (!exercise.id || exercise.id.includes('/') || BUILT_IN_STRENGTH_EXERCISES.some((e) => e.id === exercise.id)) throw new Error('Invalid custom exercise identity.')
  if (!exercise.name.trim() || exercise.name.length > 180) throw new Error('Give the exercise a name of 180 characters or fewer.')
  if (!(EQUIPMENT as readonly string[]).includes(exercise.equipment)) throw new Error('Choose valid equipment.')
  if (!['reps', 'time'].includes(exercise.measure)) throw new Error('Choose repetitions or time.')
  if (!Number.isFinite(exercise.createdAt.getTime())) throw new Error('Invalid exercise date.')
  return cleanStrengthValue({ ...exercise, name: exercise.name.trim(), isCustom: true }) as Record<string, unknown>
}
export function assertCustomStrengthRevision(latestValue: unknown, id: string, original: StrengthCatalogExercise | null): void {
  const latest = latestValue ? decodeCustomStrengthExercise(latestValue, id) : null
  const signature = (e: StrengthCatalogExercise) => JSON.stringify([e.id, e.name, e.equipment, e.primaryMuscles, e.secondaryMuscles, e.aliases, e.notes, e.measure, e.createdAt.getTime()])
  if (original ? !latest || original.id !== id || signature(latest) !== signature(original) : latestValue != null)
    throw new Error('This exercise was changed on another device. Reopen it before saving.')
}
export function searchStrengthCatalog(custom: StrengthCatalogExercise[], search = '', equipment = '', muscle = ''): StrengthCatalogExercise[] {
  const query = search.trim().toLocaleLowerCase().replace(/[-']/g, ' ')
  const tokens = query.split(/\s+/).filter(Boolean)
  return [...custom, ...BUILT_IN_STRENGTH_EXERCISES].filter((e) => {
    if (equipment && e.equipment !== equipment) return false
    if (muscle && !e.primaryMuscles.includes(muscle) && !e.secondaryMuscles.includes(muscle)) return false
    const haystack = [e.name, e.equipment, ...e.aliases, ...e.primaryMuscles].join(' ').toLocaleLowerCase().replace(/[-']/g, ' ')
    return tokens.every((token) => haystack.includes(token))
  })
}
export function exerciseFromStrengthCatalog(exercise: StrengthCatalogExercise, completed = false): StrengthExercise {
  const entry = newExercise(exercise.name, exercise.equipment, exercise.measure, exercise.id)
  return { ...entry, primaryMuscles: [...exercise.primaryMuscles], notes: exercise.notes,
    sets: entry.sets.map((set) => ({ ...set, isCompleted: completed })) }
}
