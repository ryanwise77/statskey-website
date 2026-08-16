'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseCalendarFeedEvents,
  validateCalendarFeedUrl,
} = require('./calendar-feed-runtime.cjs')

test('validates portable HTTPS feed URLs', () => {
  assert.equal(
    validateCalendarFeedUrl('webcal://calendar.example.com/private.ics'),
    'https://calendar.example.com/private.ics'
  )
  assert.throws(() => validateCalendarFeedUrl('http://localhost/calendar.ics'))
  assert.throws(() => validateCalendarFeedUrl('https://192.168.1.2/calendar.ics'))
})

const buildFeed = (...eventBlocks) =>
  ['BEGIN:VCALENDAR', ...eventBlocks.flat(), 'END:VCALENDAR'].join('\r\n')

test('parses bounded events in the requested range', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:one',
      'SUMMARY:Project review',
      'DTSTART:20260810T150000Z',
      'DTEND:20260810T160000Z',
      'LOCATION:Studio',
      'END:VEVENT',
    ]),
    '2026-08-09T00:00:00Z',
    '2026-08-12T00:00:00Z'
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].title, 'Project review')
  assert.equal(events[0].location, 'Studio')
  assert.equal(events[0].start.dateTime, '2026-08-10T15:00:00.000Z')
  assert.equal(events[0].id, 'one')
})

test('expands weekly BYDAY recurrences with stable occurrence ids', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:standup',
      'SUMMARY:Team standup',
      'DTSTART:20260803T090000Z',
      'DTEND:20260803T091500Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'END:VEVENT',
    ]),
    '2026-08-03T00:00:00Z',
    '2026-08-15T00:00:00Z'
  )
  assert.deepEqual(
    events.map((event) => event.start.dateTime),
    [
      '2026-08-03T09:00:00.000Z',
      '2026-08-05T09:00:00.000Z',
      '2026-08-07T09:00:00.000Z',
      '2026-08-10T09:00:00.000Z',
      '2026-08-12T09:00:00.000Z',
      '2026-08-14T09:00:00.000Z',
    ]
  )
  assert.equal(new Set(events.map((event) => event.id)).size, 6)
  assert.equal(events[0].id, 'standup::2026-08-03T09:00:00.000Z')
  assert.equal(events[0].end.dateTime, '2026-08-03T09:15:00.000Z')
  assert.ok(events.every((event) => event.title === 'Team standup'))
})

test('EXDATE removes matching occurrences across properties and comma lists', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:workout',
      'SUMMARY:Morning workout',
      'DTSTART:20260803T090000Z',
      'DTEND:20260803T100000Z',
      'RRULE:FREQ=DAILY;COUNT=6',
      'EXDATE:20260804T090000Z,20260806T090000Z',
      'EXDATE:20260807T090000Z',
      'END:VEVENT',
    ]),
    '2026-08-01T00:00:00Z',
    '2026-08-20T00:00:00Z'
  )
  assert.deepEqual(
    events.map((event) => event.start.dateTime),
    ['2026-08-03T09:00:00.000Z', '2026-08-05T09:00:00.000Z', '2026-08-08T09:00:00.000Z']
  )
})

test('COUNT bounds the number of occurrences', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:class',
      'SUMMARY:Spin class',
      'DTSTART:20260803T180000Z',
      'DTEND:20260803T190000Z',
      'RRULE:FREQ=WEEKLY;COUNT=2',
      'END:VEVENT',
    ]),
    '2026-08-01T00:00:00Z',
    '2026-09-15T00:00:00Z'
  )
  assert.deepEqual(
    events.map((event) => event.start.dateTime),
    ['2026-08-03T18:00:00.000Z', '2026-08-10T18:00:00.000Z']
  )
})

test('UNTIL is inclusive in both date-time and date forms', () => {
  const withDateTime = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:sprint',
      'SUMMARY:Sprint check-in',
      'DTSTART:20260803T090000Z',
      'DTEND:20260803T093000Z',
      'RRULE:FREQ=DAILY;UNTIL=20260805T090000Z',
      'END:VEVENT',
    ]),
    '2026-08-01T00:00:00Z',
    '2026-08-20T00:00:00Z'
  )
  assert.deepEqual(
    withDateTime.map((event) => event.start.dateTime),
    ['2026-08-03T09:00:00.000Z', '2026-08-04T09:00:00.000Z', '2026-08-05T09:00:00.000Z']
  )
  const withDate = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:sprint',
      'SUMMARY:Sprint check-in',
      'DTSTART:20260803T090000Z',
      'DTEND:20260803T093000Z',
      'RRULE:FREQ=DAILY;UNTIL=20260805',
      'END:VEVENT',
    ]),
    '2026-08-01T00:00:00Z',
    '2026-08-20T00:00:00Z'
  )
  assert.equal(withDate.length, 3)
  assert.equal(withDate[2].start.dateTime, '2026-08-05T09:00:00.000Z')
})

test('monthly recurrence on day 31 skips shorter months', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:rent',
      'SUMMARY:Month close',
      'DTSTART:20260131T120000Z',
      'DTEND:20260131T130000Z',
      'RRULE:FREQ=MONTHLY',
      'END:VEVENT',
    ]),
    '2026-01-01T00:00:00Z',
    '2026-06-15T00:00:00Z'
  )
  assert.deepEqual(
    events.map((event) => event.start.dateTime),
    ['2026-01-31T12:00:00.000Z', '2026-03-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z']
  )
})

test('RECURRENCE-ID override replaces the matching occurrence', () => {
  const events = parseCalendarFeedEvents(
    buildFeed(
      [
        'BEGIN:VEVENT',
        'UID:standup',
        'SUMMARY:Team standup',
        'DTSTART:20260803T090000Z',
        'DTEND:20260803T093000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'END:VEVENT',
      ],
      [
        'BEGIN:VEVENT',
        'UID:standup',
        'RECURRENCE-ID:20260804T090000Z',
        'SUMMARY:Moved standup',
        'DTSTART:20260804T140000Z',
        'DTEND:20260804T143000Z',
        'END:VEVENT',
      ]
    ),
    '2026-08-01T00:00:00Z',
    '2026-08-10T00:00:00Z'
  )
  assert.equal(events.length, 3)
  assert.deepEqual(
    events.map((event) => event.start.dateTime),
    ['2026-08-03T09:00:00.000Z', '2026-08-04T14:00:00.000Z', '2026-08-05T09:00:00.000Z']
  )
  assert.equal(events[1].title, 'Moved standup')
  assert.equal(events[1].id, 'standup::2026-08-04T09:00:00.000Z')
  assert.equal(events[0].title, 'Team standup')
  assert.equal(events[2].title, 'Team standup')
})

test('expands all-day daily recurrences with date semantics', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:hydrate',
      'SUMMARY:Hydration challenge',
      'DTSTART;VALUE=DATE:20260810',
      'RRULE:FREQ=DAILY;COUNT=3',
      'END:VEVENT',
    ]),
    '2026-08-09T00:00:00Z',
    '2026-08-16T00:00:00Z'
  )
  assert.equal(events.length, 3)
  assert.ok(events.every((event) => event.start.allDay === true))
  assert.deepEqual(
    events.map((event) => event.start.date),
    ['2026-08-10', '2026-08-11', '2026-08-12']
  )
  assert.equal(events[0].end.date, '2026-08-11')
})

test('malformed RRULE falls back to a single event', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:weird',
      'SUMMARY:Odd event',
      'DTSTART:20260810T150000Z',
      'DTEND:20260810T160000Z',
      'RRULE:FREQ=SOMETIMES;INTERVAL=often',
      'END:VEVENT',
    ]),
    '2026-08-09T00:00:00Z',
    '2026-08-12T00:00:00Z'
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'weird')
  assert.equal(events[0].start.dateTime, '2026-08-10T15:00:00.000Z')
})

test('clips long-running weekly series to the requested window', () => {
  const events = parseCalendarFeedEvents(
    buildFeed([
      'BEGIN:VEVENT',
      'UID:ride',
      'SUMMARY:Club ride',
      'DTSTART:20250106T100000Z',
      'DTEND:20250106T110000Z',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
    ]),
    '2026-08-10T00:00:00Z',
    '2026-08-17T00:00:00Z'
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].start.dateTime, '2026-08-10T10:00:00.000Z')
  assert.equal(events[0].id, 'ride::2026-08-10T10:00:00.000Z')
})
