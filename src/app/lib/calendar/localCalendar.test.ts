import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_CALENDAR_EVENT,
  calendarIcsMimeType,
  deleteLocalEvent,
  listLocalEvents,
  localEventIcs,
  saveLocalEvent,
} from './localCalendar'

const STORAGE_KEY = 'statskey.calendar.local.v1'

let values: Map<string, string>
let dispatched: Event[]

beforeEach(() => {
  values = new Map<string, string>()
  dispatched = []
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('window', {
    dispatchEvent: (event: Event) => {
      dispatched.push(event)
      return true
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('saveLocalEvent', () => {
  it('creates an event with an id, timestamps, and defaults', () => {
    const saved = saveLocalEvent({
      title: 'Dentist',
      start: new Date(2026, 7, 21, 15, 30).toISOString(),
    })
    expect(saved.id).toBeTruthy()
    expect(saved.title).toBe('Dentist')
    expect(saved.end).toBeNull()
    expect(saved.allDay).toBe(false)
    expect(saved.location).toBeNull()
    expect(saved.notes).toBeNull()
    expect(saved.createdAt).toBe(saved.updatedAt)
    expect(JSON.parse(values.get(STORAGE_KEY) ?? '[]')).toHaveLength(1)
  })

  it('announces changes on the shared event name', () => {
    saveLocalEvent({ title: 'Dentist', start: new Date().toISOString() })
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].type).toBe(LOCAL_CALENDAR_EVENT)
    expect(LOCAL_CALENDAR_EVENT).toBe('statskey:local-calendar-changed')
  })

  it('updates by id while preserving createdAt and unspecified fields', () => {
    const created = saveLocalEvent({
      title: 'Dentist',
      start: new Date(2026, 7, 21, 15, 30).toISOString(),
      notes: 'Bring insurance card',
    })
    const updated = saveLocalEvent({
      id: created.id,
      title: 'Dentist cleaning',
      start: new Date(2026, 7, 21, 16, 0).toISOString(),
    })
    expect(updated.id).toBe(created.id)
    expect(updated.title).toBe('Dentist cleaning')
    expect(updated.notes).toBe('Bring insurance card')
    expect(updated.createdAt).toBe(created.createdAt)
    expect(listLocalEvents()).toHaveLength(1)
  })

  it('clears a field when null is passed explicitly', () => {
    const created = saveLocalEvent({
      title: 'Dentist',
      start: new Date(2026, 7, 21, 15, 30).toISOString(),
      location: 'Downtown clinic',
    })
    const updated = saveLocalEvent({
      id: created.id,
      title: created.title,
      start: created.start,
      location: null,
    })
    expect(updated.location).toBeNull()
  })

  it('creates a new event when the id is unknown', () => {
    saveLocalEvent({
      id: 'missing-id',
      title: 'Orphan',
      start: new Date(2026, 7, 21).toISOString(),
    })
    expect(listLocalEvents()).toHaveLength(1)
    expect(listLocalEvents()[0].id).toBe('missing-id')
  })

  it('falls back to a generated id without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {})
    const saved = saveLocalEvent({
      title: 'Fallback',
      start: new Date(2026, 7, 21).toISOString(),
    })
    expect(saved.id).toBeTruthy()
    expect(typeof saved.id).toBe('string')
  })

  it('rejects an empty title', () => {
    expect(() =>
      saveLocalEvent({ title: '   ', start: new Date().toISOString() })
    ).toThrow()
  })

  it('rejects an unparseable start', () => {
    expect(() => saveLocalEvent({ title: 'Broken', start: 'not-a-date' })).toThrow()
  })
})

describe('listLocalEvents', () => {
  it('returns events sorted by start', () => {
    saveLocalEvent({ title: 'Later', start: new Date(2026, 7, 22, 9, 0).toISOString() })
    saveLocalEvent({ title: 'Sooner', start: new Date(2026, 7, 21, 9, 0).toISOString() })
    expect(listLocalEvents().map((event) => event.title)).toEqual(['Sooner', 'Later'])
  })

  it('filters by overlap with the half-open range', () => {
    saveLocalEvent({
      title: 'Before',
      start: new Date(2026, 7, 20, 9, 0).toISOString(),
      end: new Date(2026, 7, 21, 0, 0).toISOString(),
    })
    saveLocalEvent({
      title: 'Spans range start',
      start: new Date(2026, 7, 20, 23, 0).toISOString(),
      end: new Date(2026, 7, 21, 1, 0).toISOString(),
    })
    saveLocalEvent({
      title: 'Inside',
      start: new Date(2026, 7, 21, 9, 0).toISOString(),
    })
    saveLocalEvent({
      title: 'At range end',
      start: new Date(2026, 7, 22, 0, 0).toISOString(),
    })
    const inRange = listLocalEvents(
      new Date(2026, 7, 21, 0, 0).toISOString(),
      new Date(2026, 7, 22, 0, 0).toISOString()
    )
    expect(inRange.map((event) => event.title)).toEqual([
      'Spans range start',
      'Inside',
    ])
  })

  it('keeps an all-day event in range across its whole day', () => {
    saveLocalEvent({
      title: 'Vacation day',
      start: new Date(2026, 7, 21).toISOString(),
      allDay: true,
    })
    const inRange = listLocalEvents(
      new Date(2026, 7, 21, 18, 0).toISOString(),
      new Date(2026, 7, 22, 0, 0).toISOString()
    )
    expect(inRange).toHaveLength(1)
  })

  it('returns an empty list for corrupt storage', () => {
    values.set(STORAGE_KEY, '{not json')
    expect(listLocalEvents()).toEqual([])
  })

  it('returns an empty list for non-array storage', () => {
    values.set(STORAGE_KEY, '{"events":[]}')
    expect(listLocalEvents()).toEqual([])
  })

  it('returns an empty list when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {},
    })
    expect(listLocalEvents()).toEqual([])
  })

  it('skips malformed records instead of failing', () => {
    values.set(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'ok', title: 'Kept', start: new Date(2026, 7, 21).toISOString() },
        { id: '', title: 'No id', start: new Date(2026, 7, 21).toISOString() },
        { id: 'bad-start', title: 'Bad start', start: 'garbage' },
        'not-an-object',
      ])
    )
    expect(listLocalEvents().map((event) => event.title)).toEqual(['Kept'])
  })
})

describe('recurring local events', () => {
  it('expands a daily series into keyed occurrences with shifted times', () => {
    const saved = saveLocalEvent({
      title: 'Standup',
      start: new Date(2026, 7, 17, 9, 0).toISOString(),
      end: new Date(2026, 7, 17, 9, 15).toISOString(),
      recurrence: { freq: 'daily', interval: 1 },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 7, 17).toISOString(),
      new Date(2026, 7, 20).toISOString()
    )
    expect(occurrences).toHaveLength(3)
    expect(occurrences.map((occurrence) => occurrence.occurrenceKey)).toEqual([
      `${saved.id}:2026-08-17`,
      `${saved.id}:2026-08-18`,
      `${saved.id}:2026-08-19`,
    ])
    expect(occurrences.every((occurrence) => occurrence.seriesId === saved.id)).toBe(
      true
    )
    expect(occurrences.every((occurrence) => occurrence.id === saved.id)).toBe(true)
    expect(occurrences[1].start).toBe(new Date(2026, 7, 18, 9, 0).toISOString())
    expect(occurrences[1].end).toBe(new Date(2026, 7, 18, 9, 15).toISOString())
  })

  it('starts expansion at the series start, not the range start', () => {
    saveLocalEvent({
      title: 'Run',
      start: new Date(2026, 7, 18, 7, 0).toISOString(),
      recurrence: { freq: 'daily', interval: 1 },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 7, 16).toISOString(),
      new Date(2026, 7, 20).toISOString()
    )
    expect(
      occurrences.map((occurrence) => new Date(occurrence.start).getDate())
    ).toEqual([18, 19])
  })

  it('honors the interval between occurrences', () => {
    saveLocalEvent({
      title: 'Physio',
      start: new Date(2026, 7, 17, 8, 0).toISOString(),
      recurrence: { freq: 'daily', interval: 2 },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 7, 17).toISOString(),
      new Date(2026, 7, 24).toISOString()
    )
    expect(
      occurrences.map((occurrence) => new Date(occurrence.start).getDate())
    ).toEqual([17, 19, 21, 23])
  })

  it('expands weekly byWeekdays within each covered week', () => {
    saveLocalEvent({
      title: 'Gym',
      start: new Date(2026, 7, 17, 6, 0).toISOString(),
      recurrence: { freq: 'weekly', interval: 1, byWeekdays: [1, 3, 5] },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 7, 17).toISOString(),
      new Date(2026, 7, 24).toISOString()
    )
    expect(
      occurrences.map((occurrence) => new Date(occurrence.start).getDay())
    ).toEqual([1, 3, 5])
    expect(
      occurrences.map((occurrence) => new Date(occurrence.start).getDate())
    ).toEqual([17, 19, 21])
  })

  it('skips byWeekdays occurrences before the series start', () => {
    saveLocalEvent({
      title: 'Gym',
      start: new Date(2026, 7, 19, 6, 0).toISOString(),
      recurrence: { freq: 'weekly', interval: 1, byWeekdays: [1, 3, 5] },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 7, 16).toISOString(),
      new Date(2026, 7, 24).toISOString()
    )
    expect(
      occurrences.map((occurrence) => new Date(occurrence.start).getDate())
    ).toEqual([19, 21])
  })

  it('expands monthly series and skips months without the anchor day', () => {
    saveLocalEvent({
      title: 'Rent review',
      start: new Date(2026, 0, 31, 9, 0).toISOString(),
      recurrence: { freq: 'monthly', interval: 1 },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 0, 1).toISOString(),
      new Date(2026, 4, 1).toISOString()
    )
    expect(
      occurrences.map((occurrence) => {
        const start = new Date(occurrence.start)
        return [start.getMonth(), start.getDate()]
      })
    ).toEqual([
      [0, 31],
      [2, 31],
    ])
  })

  it('stops at the inclusive until date', () => {
    saveLocalEvent({
      title: 'Sprint check',
      start: new Date(2026, 7, 17, 9, 0).toISOString(),
      recurrence: { freq: 'daily', interval: 1, until: '2026-08-19' },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 7, 17).toISOString(),
      new Date(2026, 7, 25).toISOString()
    )
    expect(
      occurrences.map((occurrence) => new Date(occurrence.start).getDate())
    ).toEqual([17, 18, 19])
  })

  it('caps expansion at 400 occurrences per series per query', () => {
    saveLocalEvent({
      title: 'Daily forever',
      start: new Date(2026, 0, 1, 9, 0).toISOString(),
      recurrence: { freq: 'daily', interval: 1 },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 0, 1).toISOString(),
      new Date(2027, 5, 1).toISOString()
    )
    expect(occurrences).toHaveLength(400)
  })

  it('keeps the all-day span and flag on each occurrence', () => {
    saveLocalEvent({
      title: 'Focus days',
      start: new Date(2026, 7, 17).toISOString(),
      end: new Date(2026, 7, 19).toISOString(),
      allDay: true,
      recurrence: { freq: 'weekly', interval: 1 },
    })
    const occurrences = listLocalEvents(
      new Date(2026, 7, 24).toISOString(),
      new Date(2026, 7, 31).toISOString()
    )
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].allDay).toBe(true)
    expect(occurrences[0].start).toBe(new Date(2026, 7, 24).toISOString())
    expect(occurrences[0].end).toBe(new Date(2026, 7, 26).toISOString())
  })

  it('leaves plain events untouched in a range query', () => {
    saveLocalEvent({
      title: 'One-off',
      start: new Date(2026, 7, 18, 10, 0).toISOString(),
    })
    const [event] = listLocalEvents(
      new Date(2026, 7, 18).toISOString(),
      new Date(2026, 7, 19).toISOString()
    )
    expect(event.occurrenceKey).toBeUndefined()
    expect(event.seriesId).toBeUndefined()
  })

  it('returns the stored series entry for unbounded queries', () => {
    saveLocalEvent({
      title: 'Standup',
      start: new Date(2026, 7, 17, 9, 0).toISOString(),
      recurrence: { freq: 'daily', interval: 1 },
    })
    const events = listLocalEvents()
    expect(events).toHaveLength(1)
    expect(events[0].occurrenceKey).toBeUndefined()
    expect(events[0].recurrence).toEqual({ freq: 'daily', interval: 1, until: null })
  })

  it('sanitizes stored recurrence and drops malformed shapes', () => {
    values.set(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: 'a',
          title: 'Valid',
          start: new Date(2026, 7, 17, 9, 0).toISOString(),
          recurrence: {
            freq: 'weekly',
            interval: 2,
            byWeekdays: [5, 1, 1, 9, -1],
            until: 'nope',
          },
        },
        {
          id: 'b',
          title: 'Bad freq',
          start: new Date(2026, 7, 17, 10, 0).toISOString(),
          recurrence: { freq: 'yearly', interval: 1 },
        },
      ])
    )
    const [first, second] = listLocalEvents()
    expect(first.recurrence).toEqual({
      freq: 'weekly',
      interval: 2,
      byWeekdays: [1, 5],
      until: null,
    })
    expect(second.recurrence).toBeNull()
  })

  it('deletes the whole series through the series id', () => {
    const saved = saveLocalEvent({
      title: 'Standup',
      start: new Date(2026, 7, 17, 9, 0).toISOString(),
      recurrence: { freq: 'daily', interval: 1 },
    })
    deleteLocalEvent(saved.id)
    expect(
      listLocalEvents(
        new Date(2026, 7, 17).toISOString(),
        new Date(2026, 7, 24).toISOString()
      )
    ).toEqual([])
  })
})

describe('deleteLocalEvent', () => {
  it('removes the event and announces the change', () => {
    const saved = saveLocalEvent({
      title: 'Removable',
      start: new Date(2026, 7, 21).toISOString(),
    })
    dispatched = []
    deleteLocalEvent(saved.id)
    expect(listLocalEvents()).toEqual([])
    expect(dispatched).toHaveLength(1)
  })

  it('stays quiet for an unknown id', () => {
    saveLocalEvent({ title: 'Keep', start: new Date(2026, 7, 21).toISOString() })
    dispatched = []
    deleteLocalEvent('unknown')
    expect(listLocalEvents()).toHaveLength(1)
    expect(dispatched).toHaveLength(0)
  })
})

describe('localEventIcs', () => {
  it('produces a timed VEVENT with UTC stamps and CRLF endings', () => {
    const start = new Date(2026, 7, 21, 15, 30)
    const end = new Date(2026, 7, 21, 16, 30)
    const event = saveLocalEvent({
      title: 'Dentist',
      start: start.toISOString(),
      end: end.toISOString(),
      location: 'Downtown clinic',
      notes: 'Bring insurance card',
    })
    const ics = localEventIcs(event)
    const expectedStart = start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const expectedEnd = end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain(`UID:${event.id}@statskey.ai`)
    expect(ics).toContain(`DTSTART:${expectedStart}`)
    expect(ics).toContain(`DTEND:${expectedEnd}`)
    expect(ics).toContain('SUMMARY:Dentist')
    expect(ics).toContain('LOCATION:Downtown clinic')
    expect(ics).toContain('DESCRIPTION:Bring insurance card')
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/)
    expect(ics).not.toContain('\r\nMETHOD:')
    expect(ics).not.toContain('\r\nATTENDEE')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.split('\r\n').length).toBeGreaterThan(10)
    expect(ics).not.toMatch(/[^\r]\n/)
  })

  it('defaults a missing end to one hour after start', () => {
    const start = new Date(2026, 7, 21, 15, 0)
    const event = saveLocalEvent({ title: 'Quick sync', start: start.toISOString() })
    const expectedEnd = new Date(start.getTime() + 3_600_000)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
    expect(localEventIcs(event)).toContain(`DTEND:${expectedEnd}`)
  })

  it('writes all-day events as VALUE=DATE with an exclusive end', () => {
    const event = saveLocalEvent({
      title: 'Vacation',
      start: new Date(2026, 7, 21).toISOString(),
      allDay: true,
    })
    const ics = localEventIcs(event)
    expect(ics).toContain('DTSTART;VALUE=DATE:20260821')
    expect(ics).toContain('DTEND;VALUE=DATE:20260822')
  })

  it('passes a stored exclusive all-day end through unchanged', () => {
    const event = saveLocalEvent({
      title: 'Retreat',
      start: new Date(2026, 7, 21).toISOString(),
      end: new Date(2026, 7, 23).toISOString(),
      allDay: true,
    })
    const ics = localEventIcs(event)
    expect(ics).toContain('DTSTART;VALUE=DATE:20260821')
    expect(ics).toContain('DTEND;VALUE=DATE:20260823')
  })

  it('escapes backslashes, newlines, commas, and semicolons', () => {
    const event = saveLocalEvent({
      title: 'Plan; review, notes\\draft',
      start: new Date(2026, 7, 21, 9, 0).toISOString(),
      notes: 'Line one\nLine two',
    })
    const ics = localEventIcs(event)
    expect(ics).toContain('SUMMARY:Plan\\; review\\, notes\\\\draft')
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two')
  })

  it('exports an invitation as a complete METHOD:REQUEST', () => {
    const event = saveLocalEvent({
      title: 'Planning review',
      start: '2026-08-21T14:00:00Z',
      end: '2026-08-21T15:00:00Z',
    })
    const ics = localEventIcs(event, {
      sendInvitations: true,
      organizerEmail: 'host@example.com',
      attendees: ['guest@example.com', 'second@example.com'],
    })
    const unfolded = ics.replace(/\r\n[ \t]/g, '')

    expect(ics).toContain('\r\nMETHOD:REQUEST\r\n')
    expect(ics).toContain('\r\nORGANIZER:mailto:host@example.com\r\n')
    expect(unfolded).toContain(
      '\r\nATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;' +
        'PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example.com\r\n'
    )
    expect(ics).toContain('\r\nSEQUENCE:0\r\n')
    expect(calendarIcsMimeType(ics)).toBe(
      'text/calendar; charset=UTF-8; method=REQUEST'
    )
  })

  it('rejects an invitation without a valid organizer email', () => {
    const event = saveLocalEvent({
      title: 'Planning review',
      start: '2026-08-21T14:00:00Z',
    })
    expect(() =>
      localEventIcs(event, {
        sendInvitations: true,
        organizerEmail: 'not-an-email',
        attendees: ['guest@example.com'],
      })
    ).toThrow(/valid organizer email/i)
  })

  it('keeps the UID stable while refreshing DTSTAMP for each export', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T14:00:00Z'))
    const event = saveLocalEvent({
      title: 'Planning review',
      start: '2026-08-22T14:00:00Z',
    })
    const first = localEventIcs(event)
    vi.setSystemTime(new Date('2026-08-21T14:00:01Z'))
    const second = localEventIcs(event)

    expect(first).toContain(`UID:${event.id}@statskey.ai`)
    expect(second).toContain(`UID:${event.id}@statskey.ai`)
    expect(first).toContain('DTSTAMP:20260821T140000Z')
    expect(second).toContain('DTSTAMP:20260821T140001Z')
  })

  it('emits an RRULE with frequency, interval, byday, and until', () => {
    const event = saveLocalEvent({
      title: 'Gym',
      start: new Date(2026, 7, 17, 6, 0).toISOString(),
      recurrence: {
        freq: 'weekly',
        interval: 2,
        byWeekdays: [1, 3, 5],
        until: '2026-09-30',
      },
    })
    const ics = localEventIcs(event)
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL=')
    expect(ics).toMatch(/UNTIL=\d{8}T\d{6}Z/)
  })

  it('keeps the RRULE minimal for a simple daily series', () => {
    const event = saveLocalEvent({
      title: 'Standup',
      start: new Date(2026, 7, 17, 9, 0).toISOString(),
      recurrence: { freq: 'daily', interval: 1 },
    })
    const ics = localEventIcs(event)
    expect(ics).toContain('RRULE:FREQ=DAILY\r\n')
    expect(ics).not.toContain('INTERVAL=')
    expect(ics).not.toContain('BYDAY')
    expect(ics).not.toContain('UNTIL')
  })

  it('writes an all-day until as a date value', () => {
    const event = saveLocalEvent({
      title: 'Focus days',
      start: new Date(2026, 7, 17).toISOString(),
      allDay: true,
      recurrence: { freq: 'weekly', interval: 1, until: '2026-09-14' },
    })
    expect(localEventIcs(event)).toContain('RRULE:FREQ=WEEKLY;UNTIL=20260914\r\n')
  })

  it('leaves non-recurring events without an RRULE', () => {
    const event = saveLocalEvent({
      title: 'One-off',
      start: new Date(2026, 7, 17, 9, 0).toISOString(),
    })
    expect(localEventIcs(event)).not.toContain('RRULE')
  })

  it('folds long lines to at most 75 octets', () => {
    const event = saveLocalEvent({
      title: `Quarterly planning 🚀 東京 ${'résumé and agenda '.repeat(8)}end`,
      start: new Date(2026, 7, 21, 9, 0).toISOString(),
    })
    const ics = localEventIcs(event)
    const encoder = new TextEncoder()
    const lines = ics.split('\r\n')
    for (const line of lines) {
      expect(encoder.encode(line).byteLength).toBeLessThanOrEqual(75)
    }
    expect(lines.some((line) => line.startsWith(' '))).toBe(true)
    expect(ics.replace(/\r\n /g, '')).toContain(
      `SUMMARY:${escapeExpectedText(event.title)}`
    )
    expect(ics).not.toContain('\ufffd')
  })
})

function escapeExpectedText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
}
