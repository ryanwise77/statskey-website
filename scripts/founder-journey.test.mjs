import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentFounderJourneyNote } from '../src/founderJourney.js'

const published = {
  schemaVersion: 1,
  weekId: 'week-0053',
  noteRevision: 1,
  note: ' The current training week. ',
}
test('shows the current published weekly note with the backend calendar dates', () => {
  assert.deepEqual(currentFounderJourneyNote(published, new Date('2026-09-04T20:00:00Z')), {
    weekId: 'week-0053', weekNumber: 53,
    weekStartDay: '2026-08-31', weekEndDay: '2026-09-06',
    note: 'The current training week.',
  })
})
test('expires the old note at Monday midnight in Chicago, not UTC', () => {
  assert.ok(currentFounderJourneyNote(published, new Date('2026-09-07T04:59:59Z')))
  assert.equal(currentFounderJourneyNote(published, new Date('2026-09-07T05:00:00Z')), null)
})
test('hides missing, future, empty, malformed, and unsupported public notes', () => {
  for (const value of [
    null, {}, { ...published, schemaVersion: 2 }, { ...published, note: '' },
    { ...published, noteRevision: 0 }, { ...published, note: 'x'.repeat(601) },
    { ...published, weekId: 'week-0054' },
  ]) assert.equal(currentFounderJourneyNote(value, new Date('2026-09-04T20:00:00Z')), null)
})
