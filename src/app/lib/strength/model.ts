export type LoadKind =
  | 'externalWeight'
  | 'addedWeight'
  | 'assistance'
  | 'bodyweightOnly'
export interface StrengthSet {
  id: string
  number: number
  setType: string
  isCompleted: boolean
  weightLbs?: number
  loadKind?: LoadKind
  reps?: number
  durationSeconds?: number
  rpe?: number
  startedAt?: Date
  completedAt?: Date
}
export interface StrengthExercise {
  id: string
  exerciseId: string
  name: string
  equipment: string
  measure: 'reps' | 'time'
  sets: StrengthSet[]
}
export interface StrengthSession {
  id: string
  userId: string
  title: string
  startDate: Date
  endDate?: Date
  createdAt: Date
  status: 'active' | 'completed' | 'discarded'
  recordingMode: 'live' | 'afterTheFact'
  entries: StrengthExercise[]
  notes: string
  defaultRestSeconds: number
  workoutSessionId?: string
  edited: boolean
}
export const LOAD_LABELS: Record<LoadKind, string> = {
  externalWeight: 'External weight',
  addedWeight: 'Added weight',
  assistance: 'Assistance',
  bodyweightOnly: 'Bodyweight only',
}
export const EXERCISES = [
  ['Barbell Back Squat', 'barbell', 'reps', 'bb-back-squat'],
  ['Bench Press', 'barbell', 'reps', 'bb-bench-press'],
  ['Deadlift', 'barbell', 'reps', 'bb-deadlift'],
  ['Overhead Press', 'barbell', 'reps', 'bb-overhead-press'],
  ['Romanian Deadlift', 'barbell', 'reps', 'bb-romanian-deadlift'],
  ['Barbell Row', 'barbell', 'reps', 'bb-bent-over-row'],
  ['Dumbbell Bench Press', 'dumbbell', 'reps', 'db-bench-press'],
  ['Dumbbell Row', 'dumbbell', 'reps', 'db-row'],
  ['Biceps Curl', 'dumbbell', 'reps', 'db-curl'],
  ['Lateral Raise', 'dumbbell', 'reps', 'db-lateral-raise'],
  ['Goblet Squat', 'dumbbell', 'reps', 'db-goblet-squat'],
  ['Lunge', 'dumbbell', 'reps', 'db-lunge'],
  ['Leg Press', 'machine', 'reps', 'machine-leg-press'],
  ['Leg Extension', 'machine', 'reps', 'machine-leg-extension'],
  ['Seated Leg Curl', 'machine', 'reps', 'machine-seated-leg-curl'],
  ['Lat Pulldown', 'cable', 'reps', 'cable-lat-pulldown'],
  ['Seated Cable Row', 'cable', 'reps', 'cable-seated-row'],
  ['Triceps Pushdown', 'cable', 'reps', 'cable-triceps-pushdown'],
  ['Pull-up', 'bodyweight', 'reps', 'bw-pull-up'],
  ['Assisted Pull-up', 'machine', 'reps', 'machine-assisted-pull-up'],
  ['Push-up', 'bodyweight', 'reps', 'bw-push-up'],
  ['Dip', 'bodyweight', 'reps', 'bw-dip'],
  ['Plank', 'bodyweight', 'time', 'bw-plank'],
  ['Side Plank', 'bodyweight', 'time', 'bw-side-plank'],
  ['Farmer Carry', 'dumbbell', 'time', 'db-farmers-carry'],
] as const
export function newStrengthID(): string {
  return crypto.randomUUID()
}
export function newSet(number = 1): StrengthSet {
  return { id: newStrengthID(), number, setType: 'working', isCompleted: false }
}
export function newExercise(
  name: string,
  equipment = 'other',
  measure: 'reps' | 'time' = 'reps',
  exerciseId = '',
): StrengthExercise {
  return {
    id: newStrengthID(),
    exerciseId,
    name,
    equipment,
    measure,
    sets: [newSet()],
  }
}
export function newSession(userId: string, now = new Date()): StrengthSession {
  return {
    id: newStrengthID(),
    userId,
    title: 'Strength workout',
    startDate: new Date(now.getTime() - 45 * 60_000),
    createdAt: now,
    status: 'active',
    recordingMode: 'afterTheFact',
    entries: [],
    notes: '',
    defaultRestSeconds: 120,
    edited: false,
  }
}
type Raw = Record<string, unknown>
function raw(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Raw)
    : {}
}
function rows(value: unknown): Raw[] {
  return Array.isArray(value) ? value.map(raw) : []
}
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : []
}
export function strengthDate(value: unknown): Date | undefined {
  let result: Date | undefined
  if (value instanceof Date) result = value
  else if (
    value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  )
    result = (value as { toDate(): Date }).toDate()
  else if (typeof value === 'string') result = new Date(value)
  else if (typeof value === 'number') result = new Date(value * 1000)
  else if (value && typeof value === 'object') {
    const data = value as {
      seconds?: number
      _seconds?: number
      nanoseconds?: number
      _nanoseconds?: number
    }
    const seconds = data.seconds ?? data._seconds,
      nanos = data.nanoseconds ?? data._nanoseconds ?? 0
    if (typeof seconds === 'number' && typeof nanos === 'number')
      result = new Date(seconds * 1000 + nanos / 1e6)
  }
  return result && Number.isFinite(result.getTime()) ? result : undefined
}
function number(value: unknown, min = 0): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min
    ? value
    : undefined
}
export function effectiveStrengthEntries(
  recorded: unknown,
  editsValue: unknown,
): Raw[] {
  const edits = raw(editsValue),
    changed = rows(edits.entries)
  const original = rows(recorded)
  const entries = [...original]
  for (const entry of changed)
    if (!entries.some((e) => e.id === entry.id)) entries.push(entry)
  const entryFields = raw(edits.entryFields),
    setFields = raw(edits.setFields)
  const removedEntries = strings(edits.removedEntryIDs),
    removedSets = strings(edits.removedSetIDs)
  const setKeys: Record<string, string> = {
    weight: 'weightLbs',
    loadKind: 'loadKind',
    reps: 'reps',
    duration: 'durationSeconds',
    rpe: 'rpe',
    type: 'setType',
    notes: 'notes',
  }
  return entries
    .filter((e) => !removedEntries.includes(str(e.id)))
    .map((originalEntry) => {
      const changedEntry = changed.find((e) => e.id === originalEntry.id)
      if (!changedEntry)
        return {
          ...originalEntry,
          sets: rows(originalEntry.sets).filter(
            (s) => !removedSets.includes(str(s.id)),
          ),
        }
      const entry = { ...originalEntry }
      for (const key of strings(entryFields[str(entry.id)])) {
        if (
          ['name', 'exerciseId', 'equipment', 'measure', 'notes'].includes(key)
        )
          entry[key] = changedEntry[key]
      }
      const originalSets = rows(entry.sets),
        changedSets = rows(changedEntry.sets)
      const combined = [...originalSets]
      for (const set of changedSets)
        if (!combined.some((s) => s.id === set.id)) combined.push(set)
      entry.sets = combined
        .filter((s) => !removedSets.includes(str(s.id)))
        .map((originalSet) => {
          const changedSet = changedSets.find((s) => s.id === originalSet.id)
          const set = { ...originalSet }
          if (changedSet)
            for (const field of strings(setFields[str(set.id)])) {
              if (setKeys[field])
                set[setKeys[field]] = changedSet[setKeys[field]]
            }
          return set
        })
      return entry
    })
}
export function decodeStrengthSession(
  value: unknown,
  id: string,
  owner: string,
): StrengthSession | null {
  const data = raw(value),
    edits = raw(data.userEdits),
    startDate = strengthDate(data.startDate)
  if (
    !startDate ||
    (data.userId && data.userId !== owner) ||
    (data.id && data.id !== id)
  )
    return null
  const entries = effectiveStrengthEntries(data.entries, data.userEdits).map(
    (e, index): StrengthExercise => ({
      id: str(e.id, `entry-${index}`),
      exerciseId: str(e.exerciseId),
      name: str(e.name, 'Unnamed exercise'),
      equipment: str(e.equipment, 'other'),
      measure: e.measure === 'time' ? 'time' : 'reps',
      sets: rows(e.sets).map(
        (s, n): StrengthSet => ({
          id: str(s.id, `set-${index}-${n}`),
          number: number(s.number, 1) ?? n + 1,
          setType: str(s.setType, 'working'),
          isCompleted: s.isCompleted === true,
          weightLbs: number(s.weightLbs),
          loadKind: Object.hasOwn(LOAD_LABELS, str(s.loadKind))
            ? (s.loadKind as LoadKind)
            : undefined,
          reps: Number.isInteger(s.reps) ? number(s.reps, 1) : undefined,
          durationSeconds: number(s.durationSeconds, Number.EPSILON),
          rpe:
            typeof s.rpe === 'number' && s.rpe <= 10
              ? number(s.rpe, 1)
              : undefined,
          startedAt: strengthDate(s.startedAt),
          completedAt: strengthDate(s.completedAt),
        }),
      ),
    }),
  )
  return {
    id,
    userId: owner,
    title:
      str(edits.title).trim() ||
      str(data.title).trim() ||
      str(data.routineName).trim() ||
      'Strength workout',
    startDate,
    endDate: strengthDate(data.endDate),
    createdAt: strengthDate(data.createdAt) ?? startDate,
    status:
      data.status === 'active'
        ? 'active'
        : data.status === 'discarded'
          ? 'discarded'
          : 'completed',
    recordingMode:
      data.recordingMode === 'afterTheFact' ? 'afterTheFact' : 'live',
    entries,
    notes: str(edits.notes, str(data.notes)),
    defaultRestSeconds: number(data.defaultRestSeconds) ?? 120,
    workoutSessionId: str(data.workoutSessionId) || undefined,
    edited: typeof edits.revision === 'number' && edits.revision > 0,
  }
}
export function completedExercises(
  session: StrengthSession,
): StrengthExercise[] {
  return session.entries
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.isCompleted) }))
    .filter((e) => e.sets.length > 0)
}
export function strengthTotals(session: StrengthSession) {
  const entries = completedExercises(session)
  let volumeLbs = 0
  for (const e of entries)
    for (const s of e.sets) {
      const ambiguous =
        !s.loadKind &&
        (e.equipment === 'bodyweight' ||
          /assisted/i.test(e.name) ||
          /machine-assisted-(pull-up|dip)/.test(e.exerciseId))
      const volume = (s.weightLbs ?? 0) * (s.reps ?? 0)
      if (
        !ambiguous &&
        e.measure !== 'time' &&
        s.setType !== 'warmup' &&
        s.loadKind !== 'assistance' &&
        s.loadKind !== 'bodyweightOnly' &&
        Number.isFinite(volume) &&
        Number.isFinite(volumeLbs + volume)
      )
        volumeLbs += volume
    }
  return {
    exercises: entries.length,
    sets: entries.reduce((n, e) => n + e.sets.length, 0),
    volumeLbs,
  }
}
export function loadDisplay(lbs: number, imperial: boolean): string {
  return `${(imperial ? lbs : lbs / 2.20462).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${imperial ? 'lb' : 'kg'}`
}
export function setDescription(
  set: StrengthSet,
  exercise: StrengthExercise,
  imperial: boolean,
): string {
  const parts: string[] = []
  if (set.loadKind === 'bodyweightOnly') parts.push('Bodyweight only')
  else if (set.weightLbs != null)
    parts.push(
      `${loadDisplay(set.weightLbs, imperial)}${set.loadKind === 'assistance' ? ' assistance' : set.loadKind === 'addedWeight' ? ' added' : !set.loadKind ? ' · load unspecified' : ''}`,
    )
  else if (set.loadKind)
    parts.push(`${LOAD_LABELS[set.loadKind]} · amount not recorded`)
  if (exercise.measure !== 'time' && set.reps != null)
    parts.push(`${set.reps} reps`)
  if (set.durationSeconds != null) parts.push(`${set.durationSeconds}s`)
  if (set.rpe != null) parts.push(`RPE ${set.rpe}`)
  if (set.setType !== 'working') parts.push(set.setType)
  return parts.join(' · ') || 'Completed · values not recorded'
}
export function validateStrength(session: StrengthSession): string | null {
  if (!session.title.trim()) return 'Give the workout a title.'
  if (!session.userId || !session.id || session.id.includes('/'))
    return 'The workout identity is invalid. Start a new workout.'
  if (
    !Number.isInteger(session.defaultRestSeconds) ||
    session.defaultRestSeconds < 0 ||
    session.defaultRestSeconds > 1800
  )
    return 'Rest must be a whole number between 0 and 1800 seconds.'
  const sets = session.entries.flatMap((e) => e.sets)
  if (
    new Set(session.entries.map((e) => e.id)).size !== session.entries.length ||
    new Set(sets.map((s) => s.id)).size !== sets.length
  )
    return 'Exercises and sets must have unique identities. Reopen the workout.'
  if (
    !Number.isFinite(session.startDate.getTime()) ||
    !session.endDate ||
    !Number.isFinite(session.endDate.getTime()) ||
    session.endDate <= session.startDate
  )
    return 'Choose an end time after the workout start.'
  if (session.endDate.getTime() > Date.now() + 60_000)
    return 'A completed workout cannot end in the future.'
  if (!strengthTotals(session).sets)
    return 'Mark at least one completed set before saving.'
  for (const entry of completedExercises(session)) {
    if (!entry.name.trim()) return 'Give each exercise a name.'
    for (const set of entry.sets) {
      if (
        set.weightLbs != null &&
        (!Number.isFinite(set.weightLbs) || set.weightLbs < 0)
      )
        return 'Weight must be zero or greater.'
      if (
        entry.measure !== 'time' &&
        set.reps != null &&
        (!Number.isInteger(set.reps) || set.reps < 1)
      )
        return 'Reps must be a whole number greater than zero.'
      if (
        set.durationSeconds != null &&
        (!Number.isFinite(set.durationSeconds) || set.durationSeconds <= 0)
      )
        return 'Set time must be greater than zero.'
      if (
        set.rpe != null &&
        (!Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10)
      )
        return 'Set effort must be between 1 and 10.'
    }
  }
  return null
}
export function encodeStrength(
  session: StrengthSession,
): Record<string, unknown> {
  const error = validateStrength(session)
  if (error) throw new Error(error)
  return {
    id: session.id,
    userId: session.userId,
    title: session.title.trim(),
    startDate: session.startDate,
    endDate: session.endDate,
    createdAt: session.createdAt,
    status: 'completed',
    recordingMode: session.recordingMode,
    notes: session.notes.trim(),
    defaultRestSeconds: session.defaultRestSeconds,
    unmatchedWatchSets: 0,
    entries: completedExercises(session).map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      name: e.name.trim(),
      equipment: e.equipment,
      primaryMuscles: [],
      notes: '',
      measure: e.measure,
      sets: e.sets.map((s) =>
        Object.fromEntries(
          Object.entries({
            ...s,
            reps: e.measure === 'time' ? undefined : s.reps,
            weightLbs:
              s.loadKind === 'bodyweightOnly' ? undefined : s.weightLbs,
            source: 'phone',
            notes: '',
          }).filter(([, v]) => v !== undefined),
        ),
      ),
    })),
  }
}
