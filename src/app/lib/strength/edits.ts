import { cleanStrengthValue, decodeStrengthSession, type StrengthExercise, type StrengthSession, type StrengthSet } from './model.ts'

type Raw = Record<string, unknown>
const raw = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {}
const rows = (value: unknown): Raw[] => Array.isArray(value) ? value.map(raw) : []
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
export interface StrengthEditDraft {
  title: string
  notes: string
  entries: StrengthExercise[]
}
export function createStrengthEditDraft(session: StrengthSession): StrengthEditDraft {
  return { title: session.title, notes: session.notes,
    entries: session.entries.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) })) }
}
export function validateStrengthEdits(draft: StrengthEditDraft): string | null {
  if (!draft.title.trim()) return 'Give the workout a title.'
  if (!draft.entries.some((e) => e.sets.length)) return 'Keep at least one recorded set.'
  const ids = draft.entries.flatMap((e) => [e.id, ...e.sets.map((s) => s.id)])
  if (ids.some((id) => !id || id.includes('/')) || new Set(ids).size !== ids.length) return 'Exercises and sets must have unique identities. Reopen the editor.'
  for (const e of draft.entries) {
    if (!e.name.trim()) return 'Give every exercise a name.'
    for (const s of e.sets) {
      if (s.weightLbs != null && (!Number.isFinite(s.weightLbs) || s.weightLbs < 0)) return 'Weight must be zero or greater.'
      if (s.reps != null && (!Number.isInteger(s.reps) || s.reps <= 0)) return 'Reps must be a whole number greater than zero, or left blank.'
      if (s.durationSeconds != null && (!Number.isFinite(s.durationSeconds) || s.durationSeconds <= 0)) return 'Work time must be greater than zero, or left blank.'
      if (s.rpe != null && (!Number.isFinite(s.rpe) || s.rpe < 1 || s.rpe > 10)) return 'Effort must be between RPE 1 and 10.'
      if (!['working', 'warmup', 'drop', 'failure'].includes(s.setType)) return 'Choose a valid set type.'
    }
  }
  return null
}
function manualSet(set: StrengthSet): StrengthSet {
  return { id: set.id, number: set.number, setType: set.setType,
    weightLbs: set.weightLbs, loadKind: set.loadKind, reps: set.reps, durationSeconds: set.durationSeconds,
    rpe: set.rpe, isCompleted: true, source: 'phone', notes: set.notes ?? '' }
}

/** Build the iOS userEdits delta against the editor's snapshot, applying it to
 * the latest document. Only explicit field masks override a later sensor value. */
export function buildStrengthEdits(original: StrengthSession, draft: StrengthEditDraft, latestValue: unknown, uid: string, now = new Date()): Raw {
  if (!latestValue) throw new Error('This workout was deleted. Close the editor and refresh your history.')
  const latest = decodeStrengthSession(latestValue, original.id, uid)
  if (!uid || original.userId !== uid || !latest || original.status !== 'completed' || raw(latestValue).status !== 'completed'
    || original.id.startsWith('watch-detail-') || original.id.includes('/'))
    throw new Error('Only your saved, completed strength workouts can be edited.')
  if ((original.editRevision ?? 0) !== (latest.editRevision ?? 0))
    throw new Error('This workout was edited elsewhere. Reopen it to review the latest changes before saving.')
  if (original.createdAt.getTime() !== latest.createdAt.getTime() || original.startDate.getTime() !== latest.startDate.getTime())
    throw new Error('This workout was replaced or its recording changed. Reopen it before saving corrections.')
  const error = validateStrengthEdits(draft)
  if (error) throw new Error(error)
  const prior = raw(raw(latestValue).userEdits)
  if (raw(latestValue).userEdits != null && (!Number.isInteger(prior.revision) || Number(prior.revision) < 0))
    throw new Error('This workout has an invalid correction revision. Reopen it after refreshing your history.')
  const edit: Raw = { ...prior, revision: (latest.editRevision ?? 0) + 1, editedAt: now, editedBy: uid }
  const entries = [...rows(prior.entries)], entryFields = { ...raw(prior.entryFields) }, setFields = { ...raw(prior.setFields) }
  const removedEntries = new Set(strings(prior.removedEntryIDs)), removedSets = new Set(strings(prior.removedSetIDs))
  if (draft.title !== original.title) edit.title = draft.title.trim()
  if (draft.notes !== original.notes) edit.notes = draft.notes
  for (const old of original.entries) if (!draft.entries.some((e) => e.id === old.id)) removedEntries.add(old.id)
  for (const desired of draft.entries) {
    const old = original.entries.find((e) => e.id === desired.id)
    if (!old && (latest.entries.some((e) => e.id === desired.id) || removedEntries.has(desired.id)))
      throw new Error('An exercise identity changed while editing. Reopen the workout before saving.')
    const value = { ...desired, sets: desired.sets.map((s) => ({ ...s })) }
    const fields = new Set(strings(entryFields[value.id]))
    for (const field of ['name', 'exerciseId', 'equipment', 'measure', 'notes'] as const)
      if ((old?.[field] ?? '') !== (value[field] ?? '')) fields.add(field)
    entryFields[value.id] = [...fields].sort()
    for (const oldSet of old?.sets ?? []) if (!value.sets.some((s) => s.id === oldSet.id)) removedSets.add(oldSet.id)
    value.sets = value.sets.map((s) => {
      const before = old?.sets.find((v) => v.id === s.id)
      if (!before && (latest.entries.some((e) => e.sets.some((v) => v.id === s.id)) || removedSets.has(s.id)))
        throw new Error('A set identity changed while editing. Reopen the workout before saving.')
      const set = before ? s : manualSet(s), changed = new Set(strings(setFields[s.id]))
      if (before?.weightLbs !== set.weightLbs || before?.loadKind !== set.loadKind) { changed.add('weight'); changed.add('loadKind') }
      const keys = { reps: 'reps', duration: 'durationSeconds', rpe: 'rpe', type: 'setType', notes: 'notes' } as const
      for (const [field, key] of Object.entries(keys))
        if (key === 'notes' ? (before?.notes ?? '') !== (set.notes ?? '') : before?.[key] !== set[key]) changed.add(field)
      setFields[set.id] = [...changed].sort()
      return set
    })
    const index = entries.findIndex((e) => e.id === value.id)
    if (index < 0) entries.push(value as unknown as Raw)
    else entries[index] = value as unknown as Raw
  }
  return cleanStrengthValue({ ...edit, entries, entryFields, setFields,
    removedEntryIDs: [...removedEntries], removedSetIDs: [...removedSets] }) as Raw
}
