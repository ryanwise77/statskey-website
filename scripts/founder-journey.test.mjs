import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentFounderJourneyNote, founderNoteHeading, founderNoteLanguage } from '../src/founderJourney.js'

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
    noteLanguage: 'en',
  })
})

test('uses the selected translation with the same public week and calendar', () => {
  const noteLocalizations = {
    de: 'Diese Woche geht es um Beständigkeit.',
    es: 'Esta semana se trata de mantener la constancia.',
    hi: 'इस सप्ताह नियमित रहने पर ध्यान दें।',
    ja: '今週は継続を大切にします。',
    'pt-BR': 'Esta semana é sobre manter a constância.',
  }
  const date = new Date('2026-09-04T20:00:00Z')
  const english = currentFounderJourneyNote(published, date)
  for (const [language, note] of Object.entries(noteLocalizations)) {
    assert.deepEqual(currentFounderJourneyNote({ ...published, noteLocalizations }, date, language), {
      ...english, note, noteLanguage: language,
    })
    assert.ok(founderNoteHeading(53, language))
    assert.equal(currentFounderJourneyNote({ ...published, noteLocalizations }, new Date('2026-09-07T05:00:00Z'), language), null)
  }
})

test('uses query, saved, then device language; canonicalizes regional languages', () => {
  assert.equal(founderNoteLanguage('de-AT', 'es', 'ja'), 'de')
  assert.equal(founderNoteLanguage('unknown', 'es-MX', 'ja'), 'es')
  assert.equal(founderNoteLanguage(null, null, 'hi-IN'), 'hi')
  assert.equal(founderNoteLanguage(' PT_br '), 'pt-BR')
  assert.equal(founderNoteLanguage('pt-PT'), 'pt-BR')
  assert.equal(founderNoteLanguage('ja_JP'), 'ja')
  assert.equal(founderNoteLanguage('EN-us', 'de'), 'en')
  assert.equal(founderNoteLanguage('fr'), 'en')
})

test('preserves legacy notes and identifies the actual language when a translation is missing or invalid', () => {
  const date = new Date('2026-09-04T20:00:00Z')
  const expected = currentFounderJourneyNote(published, date)
  for (const note of [undefined, null, '', '  ', {}, 12, 'x'.repeat(1201), 'bad\u0000text']) {
    assert.deepEqual(currentFounderJourneyNote({ ...published, noteLocalizations: { de: note } }, date, 'de'), expected)
  }
  assert.deepEqual(currentFounderJourneyNote(published, date, 'de'), expected)
  assert.equal(currentFounderJourneyNote({ ...published, noteLocalizations: { de: 'x'.repeat(1200) } }, date, 'de').note.length, 1200)
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
