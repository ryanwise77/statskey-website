import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeStrengthSession, encodeStrength, newExercise, newSession, newSet, nextStrengthSet,
  repeatStrengthSession, startStrengthSetTimer,
} from '../src/app/lib/strength/model.ts'
import {
  assertStrengthRevision, decodeStrengthRoutine, decodeStrengthWeekPlan, encodeStrengthRoutine, newStrengthWeekPlan,
  routineFromStrengthSession, sessionFromStrengthRoutine, strengthDateKey, strengthPlanDay, validateStrengthRoutine,
} from '../src/app/lib/strength/plans.ts'
import { readStrengthDraft, writeStrengthDraft } from '../src/app/lib/strength/draft.ts'

function nativeRoutine() {
  return decodeStrengthRoutine({ id: 'routine-1', name: 'Push and hold', folder: 'Training', notes: 'Keep form controlled',
    createdAt: { seconds: 1750000000 }, updatedAt: { seconds: 1750000100 }, exercises: [
      { id: 'press', exerciseId: 'bb-bench-press', name: 'Bench press', equipment: 'barbell', primaryMuscles: ['chest'],
        measure: 'reps', notes: 'Pause at chest', supersetGroup: 'pair', restSeconds: 90,
        plannedSets: [{ id: 'press-1', setType: 'working', reps: 8, weightLbs: 135, restSeconds: 0, targetHeartRateMin: 110, targetHeartRateMax: 150, targetRPE: 7.5 }] },
      { id: 'plank', exerciseId: 'bw-plank', name: 'Plank', equipment: 'bodyweight', measure: 'time', supersetGroup: 'pair',
        plannedSets: [{ id: 'plank-1', setType: 'working', durationSeconds: 45, restSeconds: 60 }] },
    ] }, 'routine-1')!
}
test('native routines round trip targets, canonical pounds, notes, muscles, rest zero and supersets', () => {
  const routine = nativeRoutine(), payload = encodeStrengthRoutine(routine) as any
  assert.equal(validateStrengthRoutine(routine), null)
  assert.equal(payload.folder, 'Training')
  assert.deepEqual(payload.exercises[0].primaryMuscles, ['chest'])
  assert.equal(payload.exercises[0].notes, 'Pause at chest')
  assert.equal(payload.exercises[0].supersetGroup, 'pair')
  assert.equal(payload.exercises[0].plannedSets[0].restSeconds, 0)
  assert.equal(payload.exercises[0].plannedSets[0].weightLbs, 135)
  assert.equal(payload.exercises[0].plannedSets[0].targetRPE, 7.5)
  assert.equal(payload.exercises[1].plannedSets[0].durationSeconds, 45)
  assert.equal('reps' in payload.exercises[1].plannedSets[0], false)
  assert.equal(payload.createdAt.getTime(), 1750000000000)
  assert.equal(decodeStrengthRoutine(payload, 'different'), null)
})
test('starting a planned routine preserves targets but never invents effort, HR or completed sets', () => {
  const routine = nativeRoutine(), start = new Date('2026-09-01T10:00:00Z')
  const session = sessionFromStrengthRoutine(routine, 'owner', start, '2026-09-01')
  assert.equal(session.routineId, routine.id)
  assert.equal(session.planDayKey, '2026-09-01')
  assert.equal(session.startDate, start)
  assert.equal(session.recordingMode, 'live')
  const press = session.entries[0], plank = session.entries[1]
  assert.notEqual(press.id, routine.exercises[0].id)
  assert.notEqual(press.sets[0].id, routine.exercises[0].plannedSets[0].id)
  assert.equal(press.sets[0].reps, 8)
  assert.equal(press.sets[0].rpe, undefined)
  assert.equal(press.sets[0].averageHeartRate, undefined)
  assert.equal(press.sets[0].isCompleted, false)
  assert.equal(press.sets[0].plannedTarget?.targetRPE, 7.5)
  assert.equal(plank.sets[0].durationSeconds, 45)
  assert.equal(plank.sets[0].reps, undefined)
  session.entries.forEach((e) => e.sets.forEach((s) => { s.isCompleted = true }))
  session.endDate = new Date(start.getTime() + 1800000)
  const encoded = encodeStrength(session) as any
  const decoded = decodeStrengthSession(encoded, session.id, 'owner')!
  assert.equal(decoded.routineId, routine.id)
  assert.equal(decoded.planDayKey, '2026-09-01')
  assert.equal(decoded.entries[0].restSeconds, 90)
  assert.equal(decoded.entries[0].sets[0].plannedTarget?.restSeconds, 0)
  assert.equal(decoded.entries[0].notes, 'Pause at chest')
})
test('week schedules use local calendar days, Monday first, and date overrides take precedence', () => {
  const plan = newStrengthWeekPlan(), monday = new Date(2026, 8, 14, 23, 30)
  plan.days[0].routineId = 'repeat'
  assert.equal(strengthPlanDay(plan, monday)?.routineId, 'repeat')
  const key = strengthDateKey(monday)
  assert.equal(key, '2026-09-14')
  plan.dateOverrides[key] = { ...plan.days[0], routineId: undefined, isRest: true }
  assert.equal(strengthPlanDay(plan, monday)?.isRest, true)
  const tuesday = new Date(2026, 8, 15, 0, 30)
  assert.equal(strengthPlanDay(plan, tuesday)?.dayOfWeek, 2)
  const sunday = new Date(2026, 8, 20)
  assert.equal(strengthPlanDay(plan, sunday)?.dayOfWeek, 7)
  const roundTrip = decodeStrengthWeekPlan(JSON.parse(JSON.stringify(plan)), plan.id)!
  assert.equal(roundTrip.dateOverrides[key].isRest, true)
  assert.equal(roundTrip.createdAt.getTime(), plan.createdAt.getTime())
})
test('invalid targets are rejected before persistence, including fractional native Int fields', () => {
  for (const patch of [{ reps: 1.5 }, { durationSeconds: 1.5 }, { restSeconds: -1 }, { restSeconds: 1801 }, { targetHeartRateMin: 151, targetHeartRateMax: 150 }, { targetHeartRateMin: 251 }, { targetRPE: 11 }, { weightLbs: NaN }]) {
    const routine = nativeRoutine()
    Object.assign(routine.exercises[0].plannedSets[0], patch)
    assert.ok(validateStrengthRoutine(routine))
    assert.throws(() => encodeStrengthRoutine(routine))
  }
})
test('repeating workouts and adding sets never copy sensor measurements or rep work timers', () => {
  const session = sessionFromStrengthRoutine(nativeRoutine(), 'owner')
  session.entries.forEach((e) => e.sets.forEach((s) => Object.assign(s, { isCompleted: true, rpe: 9, averageHeartRate: 140, peakHeartRate: 170, heartRateRecovery60: 20, source: 'watch', watchSetNumber: 1, startedAt: new Date(), completedAt: new Date(), durationSeconds: 30 })))
  const repeated = repeatStrengthSession(session, 'owner')
  const set = repeated.entries[0].sets[0]
  assert.equal(set.isCompleted, false)
  assert.equal(set.durationSeconds, undefined)
  for (const key of ['rpe', 'averageHeartRate', 'peakHeartRate', 'heartRateRecovery60', 'source', 'watchSetNumber', 'startedAt', 'completedAt'] as const) assert.equal(set[key], undefined, key)
  assert.equal(repeated.entries[1].sets[0].durationSeconds, 30)
  assert.equal(set.plannedTarget?.targetRPE, 7.5)
  const entry = session.entries[0]
  entry.sets[0].setType = 'warmup'
  const next = nextStrengthSet(entry)
  assert.equal(next.weightLbs, 135)
  assert.equal(next.reps, 8)
  assert.equal(next.durationSeconds, undefined)
  assert.equal(next.rpe, undefined)
  assert.equal(next.setType, 'working')
})
test('one work timer runs at a time and switching preserves elapsed work without marking a set done', () => {
  let session = newSession('owner')
  session.recordingMode = 'live'
  const exercise = newExercise('Press')
  exercise.sets.push(newSet(2)); session.entries = [exercise]
  const [first, second] = exercise.sets
  session = startStrengthSetTimer(session, first.id, new Date('2026-09-01T10:00:00Z'))
  session = startStrengthSetTimer(session, second.id, new Date('2026-09-01T10:00:30Z'))
  assert.equal(session.timedSetId, second.id)
  assert.equal(session.entries[0].sets[0].durationSeconds, 30)
  assert.equal(session.entries[0].sets[0].isCompleted, false)
  assert.equal(session.entries[0].sets[1].durationSeconds, undefined)
  session = startStrengthSetTimer(session, first.id, new Date('2026-09-01T10:00:30.100Z'))
  assert.equal(session.entries[0].sets[1].durationSeconds, undefined)
  assert.equal(session.entries[0].sets[1].startedAt, undefined)
  session.recordingMode = 'afterTheFact'
  assert.equal(startStrengthSetTimer(session, first.id), session)
})
test('new routine snapshots do not promote measured RPE, HR, or assistance into prescribed external load', () => {
  const session = sessionFromStrengthRoutine(nativeRoutine(), 'owner')
  const set = session.entries[0].sets[0]
  Object.assign(set, { rpe: 10, averageHeartRate: 175, loadKind: 'assistance', weightLbs: 50 })
  const routine = routineFromStrengthSession(session), target = routine.exercises[0].plannedSets[0]
  assert.equal(target.weightLbs, undefined)
  assert.equal(target.targetRPE, 7.5)
  assert.equal(target.targetHeartRateMax, 150)
  assert.notEqual(routine.id, session.routineId)
})
test('draft recovery retains routine target metadata, plan linkage, and active timer identity', () => {
  let value = ''
  const storage = { getItem: () => value, setItem: (_key: string, text: string) => { value = text }, removeItem: () => { value = '' } }
  let session = sessionFromStrengthRoutine(nativeRoutine(), 'owner', new Date(), '2026-09-15')
  session = startStrengthSetTimer(session, session.entries[0].sets[0].id)
  writeStrengthDraft('owner', { session, duration: '45', restUntil: null }, storage)
  const restored = readStrengthDraft('owner', storage)!.session
  assert.equal(restored.timedSetId, session.timedSetId)
  assert.equal(restored.planDayKey, '2026-09-15')
  assert.equal(restored.entries[0].sets[0].plannedTarget?.restSeconds, 0)
})
test('stale edits, deleted templates, and create collisions fail while unchanged native revisions save', () => {
  const opened = new Date('2026-09-01T10:00:00Z')
  assert.doesNotThrow(() => assertStrengthRevision({ updatedAt: { seconds: opened.getTime() / 1000 } }, opened))
  assert.doesNotThrow(() => assertStrengthRevision(undefined, null))
  assert.doesNotThrow(() => assertStrengthRevision({ name: 'Legacy routine' }, new Date(0)))
  assert.throws(() => assertStrengthRevision({ updatedAt: new Date(opened.getTime() + 1) }, opened), /another device/)
  assert.throws(() => assertStrengthRevision(undefined, opened), /another device/)
  assert.throws(() => assertStrengthRevision({ updatedAt: opened }, null), /another device/)
})
