import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeStrengthSession, EXERCISES, newExercise } from '../src/app/lib/strength/model.ts'
import { buildStrengthEdits, createStrengthEditDraft, validateStrengthEdits } from '../src/app/lib/strength/edits.ts'
import { assertCustomStrengthRevision, BUILT_IN_STRENGTH_EXERCISES, decodeCustomStrengthExercise, encodeCustomStrengthExercise, exerciseFromStrengthCatalog, newCustomStrengthExercise, searchStrengthCatalog } from '../src/app/lib/strength/catalog.ts'

function recorded() {
  return { id: 'session-1', userId: 'owner', title: 'Recorded workout', notes: 'Original notes', status: 'completed', recordingMode: 'live',
    startDate: new Date('2026-09-01T10:00:00Z'), endDate: new Date('2026-09-01T10:45:00Z'), createdAt: new Date('2026-09-01T10:00:00Z'),
    entries: [{ id: 'entry-1', exerciseId: 'bb-bench-press', name: 'Bench', equipment: 'barbell', measure: 'reps', primaryMuscles: ['chest'], sets: [
      { id: 'set-1', number: 1, isCompleted: true, weightLbs: 100, loadKind: 'externalWeight', reps: 8, rpe: 7, setType: 'working', source: 'watch', averageHeartRate: 110, durationSeconds: 30, startedAt: new Date('2026-09-01T10:01:00Z'), completedAt: new Date('2026-09-01T10:01:30Z') },
      { id: 'set-2', number: 2, isCompleted: true, weightLbs: 100, reps: 8, setType: 'working', source: 'phone' },
    ] }],
  }
}
const decode = (data: unknown) => decodeStrengthSession(data, 'session-1', 'owner')!
test('corrections change only selected fields and preserve late sensor values, added sets and exercises', () => {
  const raw = recorded(), original = decode(raw), draft = createStrengthEditDraft(original)
  draft.entries[0].sets[0].reps = 10
  draft.entries[0].sets[0].loadKind = 'addedWeight'
  draft.entries[0].notes = 'Controlled tempo'
  const latest: any = structuredClone(raw)
  latest.entries[0].sets[0].averageHeartRate = 145
  latest.entries[0].sets[0].peakHeartRate = 175
  latest.entries[0].sets[0].durationSeconds = 35
  latest.entries[0].sets.push({ id: 'late-set', number: 3, isCompleted: true, reps: 5, setType: 'working' })
  latest.entries.push({ id: 'late-entry', name: 'Watch exercise', sets: [{ id: 'late-entry-set', number: 1, isCompleted: true }] })
  const overlay: any = buildStrengthEdits(original, draft, latest, 'owner')
  assert.deepEqual(overlay.setFields['set-1'], ['loadKind', 'reps', 'weight'])
  assert.deepEqual(overlay.entryFields['entry-1'], ['notes'])
  const saved = decode({ ...latest, userEdits: overlay })
  assert.equal(saved.entries[0].sets[0].reps, 10)
  assert.equal(saved.entries[0].sets[0].averageHeartRate, 145)
  assert.equal(saved.entries[0].sets[0].peakHeartRate, 175)
  assert.equal(saved.entries[0].sets[0].durationSeconds, 35)
  assert.equal(saved.entries[0].sets[0].source, 'watch')
  assert.equal(saved.entries[0].sets[2].id, 'late-set')
  assert.equal(saved.entries[1].id, 'late-entry')
  assert.equal(original.entries[0].sets[0].reps, 8)
  assert.equal(raw.entries[0].sets[0].averageHeartRate, 110)
})
test('clearing a value uses the native field mask, and load amount and meaning are an atomic correction', () => {
  const raw = recorded(), original = decode(raw), draft = createStrengthEditDraft(original)
  draft.entries[0].sets[0].weightLbs = undefined
  draft.entries[0].sets[0].loadKind = undefined
  draft.entries[0].sets[0].rpe = undefined
  const overlay: any = buildStrengthEdits(original, draft, raw, 'owner')
  assert.deepEqual(overlay.setFields['set-1'], ['loadKind', 'rpe', 'weight'])
  assert.equal('weightLbs' in overlay.entries[0].sets[0], false)
  const saved = decode({ ...raw, userEdits: overlay })
  assert.equal(saved.entries[0].sets[0].weightLbs, undefined)
  assert.equal(saved.entries[0].sets[0].loadKind, undefined)
  assert.equal(saved.entries[0].sets[0].rpe, undefined)
  assert.equal(saved.entries[0].sets[0].reps, 8)
})
test('subsequent edits retain previous masks and user edits while allowing sensor-only arrivals', () => {
  const raw: any = recorded(), first = decode(raw), initial = createStrengthEditDraft(first)
  initial.entries[0].sets[0].weightLbs = 125; initial.title = 'Corrected title'
  raw.userEdits = buildStrengthEdits(first, initial, raw, 'owner')
  const reopened = decode(raw), next = createStrengthEditDraft(reopened)
  next.notes = 'New notes'
  raw.entries[0].sets[0].averageHeartRate = 150
  const overlay: any = buildStrengthEdits(reopened, next, raw, 'owner')
  assert.equal(overlay.revision, 2)
  assert.equal(overlay.title, 'Corrected title')
  assert.deepEqual(overlay.setFields['set-1'], ['loadKind', 'weight'])
  const saved = decode({ ...raw, userEdits: overlay })
  assert.equal(saved.entries[0].sets[0].weightLbs, 125)
  assert.equal(saved.entries[0].sets[0].averageHeartRate, 150)
  assert.equal(saved.notes, 'New notes')
})
test('manual additions strip sensor evidence, while removals affect only rows the editor opened', () => {
  const raw: any = recorded(), original = decode(raw), draft = createStrengthEditDraft(original)
  draft.entries[0].sets = [draft.entries[0].sets[0]]
  const added = newExercise('Added hold', 'bodyweight', 'time')
  Object.assign(added.sets[0], { isCompleted: true, durationSeconds: 45, averageHeartRate: 180, source: 'watch', watchSetNumber: 9, startedAt: new Date(), completedAt: new Date() })
  draft.entries.push(added)
  raw.entries[0].sets.push({ id: 'late-set', number: 3, isCompleted: true, reps: 6, setType: 'working' })
  const overlay: any = buildStrengthEdits(original, draft, raw, 'owner')
  assert.deepEqual(overlay.removedSetIDs, ['set-2'])
  const manual = overlay.entries[1].sets[0]
  assert.equal(manual.source, 'phone'); assert.equal(manual.isCompleted, true)
  for (const key of ['averageHeartRate', 'watchSetNumber', 'startedAt', 'completedAt']) assert.equal(key in manual, false)
  const saved = decode({ ...raw, userEdits: overlay })
  assert.deepEqual(saved.entries[0].sets.map((s) => s.id), ['set-1', 'late-set'])
  assert.equal(saved.entries[1].sets[0].durationSeconds, 45)
})
test('unchanged removed overlay entries retain native Timestamp scalar types', () => {
  const timestamp = { seconds: 1756720800, nanoseconds: 123000000, toDate: () => new Date('2026-09-01T10:00:00.123Z') }
  const raw: any = recorded()
  raw.userEdits = { revision: 1, editedBy: 'owner', editedAt: timestamp, removedEntryIDs: ['old-manual'],
    entries: [{ id: 'old-manual', name: 'Removed entry', sets: [{ id: 'old-set', number: 1, isCompleted: true, startedAt: timestamp }] }] }
  const original = decode(raw), draft = createStrengthEditDraft(original)
  draft.notes = 'Correction'
  const overlay: any = buildStrengthEdits(original, draft, raw, 'owner')
  assert.equal(overlay.entries.find((e: any) => e.id === 'old-manual').sets[0].startedAt, timestamp)
  assert.ok(overlay.editedAt instanceof Date)
})
test('owner changes, concurrent edits, deleted/replaced documents, and synthetic watch views cannot be saved', () => {
  const raw: any = recorded(), original = decode(raw), draft = createStrengthEditDraft(original)
  assert.throws(() => buildStrengthEdits(original, draft, undefined, 'owner'), /deleted/)
  assert.throws(() => buildStrengthEdits(original, draft, raw, 'other'), /Only your/)
  assert.throws(() => buildStrengthEdits(original, draft, { ...raw, userId: 'other' }, 'owner'), /Only your/)
  assert.throws(() => buildStrengthEdits(original, draft, { ...raw, id: 'replacement' }, 'owner'), /Only your/)
  assert.throws(() => buildStrengthEdits(original, draft, { ...raw, status: 'active' }, 'owner'), /Only your/)
  assert.throws(() => buildStrengthEdits(original, draft, { ...raw, userEdits: { revision: 1 } }, 'owner'), /edited elsewhere/)
  assert.throws(() => buildStrengthEdits(original, draft, { ...raw, userEdits: { revision: 'bad' } }, 'owner'), /invalid correction/)
  assert.throws(() => buildStrengthEdits(original, draft, { ...raw, createdAt: new Date() }, 'owner'), /replaced/)
  assert.throws(() => buildStrengthEdits({ ...original, id: 'watch-detail-temp' }, draft, { ...raw, id: 'watch-detail-temp' }, 'owner'), /Only your/)
})
test('new manual IDs cannot overwrite sensor arrivals or resurrect removed identities', () => {
  const raw: any = recorded(), original = decode(raw), draft = createStrengthEditDraft(original)
  const added = newExercise('Manual entry')
  added.id = 'entry-late'; added.sets[0].isCompleted = true; draft.entries.push(added)
  raw.entries.push({ ...added, name: 'New sensor entry' })
  assert.throws(() => buildStrengthEdits(original, draft, raw, 'owner'), /identity changed/)
})
test('history corrections validate actual values and retain at least one set', () => {
  const draft = createStrengthEditDraft(decode(recorded()))
  for (const patch of [{ reps: 1.5 }, { weightLbs: -1 }, { durationSeconds: 0 }, { rpe: 11 }]) {
    const copy = structuredClone(draft); Object.assign(copy.entries[0].sets[0], patch)
    assert.ok(validateStrengthEdits(copy))
  }
  assert.match(validateStrengthEdits({ ...draft, entries: [] })!, /at least one/)
})
test('the complete native catalogue preserves all 138 IDs, timed work, aliases and muscle metadata', () => {
  assert.equal(BUILT_IN_STRENGTH_EXERCISES.length, 138)
  assert.equal(new Set(BUILT_IN_STRENGTH_EXERCISES.map((e) => e.id)).size, 138)
  assert.equal(EXERCISES.length, 138)
  assert.equal(searchStrengthCatalog([], 'OHP')[0].id, 'bb-overhead-press')
  assert.equal(searchStrengthCatalog([], 'hollow body hold')[0].measure, 'time')
  assert.ok(searchStrengthCatalog([], '', 'band', 'core').some((e) => e.id === 'band-pallof-press'))
  const entry = exerciseFromStrengthCatalog(BUILT_IN_STRENGTH_EXERCISES.find((e) => e.id === 'bw-dead-hang')!)
  assert.equal(entry.measure, 'time'); assert.deepEqual(entry.primaryMuscles, ['forearms'])
  assert.equal(entry.exerciseId, 'bw-dead-hang'); assert.equal(entry.sets[0].isCompleted, false)
})
test('custom exercise round trips preserve native shape and edits fail on stale or deleted records', () => {
  const exercise = newCustomStrengthExercise('  My cable hold  ')
  exercise.equipment = 'cable'; exercise.measure = 'time'; exercise.primaryMuscles = ['core']; exercise.aliases = ['anti rotation']; exercise.notes = 'Kneeling'
  const encoded = encodeCustomStrengthExercise(exercise), decoded = decodeCustomStrengthExercise(encoded, exercise.id)!
  assert.equal(decoded.name, 'My cable hold'); assert.equal(decoded.isCustom, true)
  assert.deepEqual(decoded.primaryMuscles, ['core']); assert.equal(decoded.measure, 'time')
  assert.equal(decoded.createdAt.getTime(), exercise.createdAt.getTime())
  assert.equal(searchStrengthCatalog([decoded], 'anti rotation')[0].id, exercise.id)
  assert.doesNotThrow(() => assertCustomStrengthRevision(encoded, exercise.id, decoded))
  assert.throws(() => assertCustomStrengthRevision({ ...encoded, notes: 'Changed elsewhere' }, exercise.id, decoded), /another device/)
  assert.throws(() => assertCustomStrengthRevision(undefined, exercise.id, decoded), /another device/)
  assert.throws(() => assertCustomStrengthRevision(encoded, exercise.id, null), /another device/)
  assert.equal(decodeCustomStrengthExercise(encoded, 'wrong-id'), null)
  assert.throws(() => encodeCustomStrengthExercise({ ...decoded, id: 'bb-bench-press' }), /identity/)
})
