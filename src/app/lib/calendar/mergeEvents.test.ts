import { describe, expect, it } from 'vitest'
import type { AssistantCalendarEvent } from '../assistant/calendar'
import type { LocalCalendarEvent } from './localCalendar'
import {
  calendarDateKey,
  itemsForDay,
  normalizeAssistantEvents,
  normalizeLocalEvents,
} from './mergeEvents'

function assistantEvent(
  overrides: Partial<AssistantCalendarEvent>
): AssistantCalendarEvent {
  return {
    id: 'evt-1',
    title: 'Team sync',
    start: { allDay: false, dateTime: new Date(2026, 7, 17, 9, 0).toISOString() },
    end: { allDay: false, dateTime: new Date(2026, 7, 17, 10, 0).toISOString() },
    location: null,
    organizer: null,
    attendees: [],
    ...overrides,
  }
}

function localEvent(overrides: Partial<LocalCalendarEvent>): LocalCalendarEvent {
  const nowIso = new Date(2026, 7, 1).toISOString()
  return {
    id: 'local-1',
    title: 'Dentist',
    start: new Date(2026, 7, 17, 15, 0).toISOString(),
    end: null,
    allDay: false,
    location: null,
    notes: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides,
  }
}

describe('normalizeAssistantEvents', () => {
  it('normalizes a timed Google event', () => {
    const [item] = normalizeAssistantEvents([
      assistantEvent({ location: 'Room 4', calendarName: 'Work' }),
    ])
    expect(item.key).toBe('google:evt-1')
    expect(item.kind).toBe('event')
    expect(item.source).toBe('google')
    expect(item.id).toBe('evt-1')
    expect(item.allDay).toBe(false)
    expect(item.start).toEqual(new Date(2026, 7, 17, 9, 0))
    expect(item.end).toEqual(new Date(2026, 7, 17, 10, 0))
    expect(item.location).toBe('Room 4')
    expect(item.calendarName).toBe('Work')
    expect(item.editable).toBe(false)
  })

  it('parses all-day dates at local midnight with the exclusive end intact', () => {
    const [item] = normalizeAssistantEvents([
      assistantEvent({
        start: { allDay: true, date: '2026-08-17' },
        end: { allDay: true, date: '2026-08-19' },
      }),
    ])
    expect(item.allDay).toBe(true)
    expect(item.start).toEqual(new Date(2026, 7, 17))
    expect(item.end).toEqual(new Date(2026, 7, 19))
  })

  it('skips events whose start cannot be parsed', () => {
    const items = normalizeAssistantEvents([
      assistantEvent({ start: { allDay: false, dateTime: 'garbage' } }),
      assistantEvent({ start: { allDay: false } }),
      assistantEvent({ id: 'kept' }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('kept')
  })

  it('builds a stable key from title and start when the id is null', () => {
    const [item] = normalizeAssistantEvents([assistantEvent({ id: null })])
    expect(item.id).toBeNull()
    expect(item.key).toBe(`google:Team sync|${new Date(2026, 7, 17, 9, 0).toISOString()}`)
  })

  it('keeps the subscription source and calendar name', () => {
    const [item] = normalizeAssistantEvents([
      assistantEvent({ source: 'subscription', calendarName: 'Race schedule' }),
    ])
    expect(item.source).toBe('subscription')
    expect(item.calendarName).toBe('Race schedule')
    expect(item.editable).toBe(false)
  })
})

describe('normalizeLocalEvents', () => {
  it('marks local events editable with a local key', () => {
    const [item] = normalizeLocalEvents([localEvent({ location: 'Clinic' })])
    expect(item.key).toBe('local:local-1')
    expect(item.source).toBe('local')
    expect(item.id).toBe('local-1')
    expect(item.editable).toBe(true)
    expect(item.start).toEqual(new Date(2026, 7, 17, 15, 0))
    expect(item.end).toBeNull()
    expect(item.location).toBe('Clinic')
    expect(item.calendarName).toBeNull()
  })

  it('skips local events with unparseable starts', () => {
    expect(normalizeLocalEvents([localEvent({ start: 'garbage' })])).toEqual([])
  })

  it('marks plain local events as non-recurring with no series', () => {
    const [item] = normalizeLocalEvents([localEvent({})])
    expect(item.key).toBe('local:local-1')
    expect(item.seriesId).toBeNull()
    expect(item.recurring).toBe(false)
  })

  it('keys occurrences from occurrenceKey and links the series', () => {
    const [item] = normalizeLocalEvents([
      {
        ...localEvent({
          recurrence: { freq: 'daily', interval: 1, until: null },
        }),
        occurrenceKey: 'local-1:2026-08-17',
        seriesId: 'local-1',
      },
    ])
    expect(item.key).toBe('local:local-1:2026-08-17')
    expect(item.id).toBe('local-1')
    expect(item.seriesId).toBe('local-1')
    expect(item.recurring).toBe(true)
    expect(item.editable).toBe(true)
  })

  it('marks an unexpanded recurring series with its own id', () => {
    const [item] = normalizeLocalEvents([
      localEvent({ recurrence: { freq: 'weekly', interval: 1, until: null } }),
    ])
    expect(item.key).toBe('local:local-1')
    expect(item.seriesId).toBe('local-1')
    expect(item.recurring).toBe(true)
  })

  it('keeps assistant events non-recurring', () => {
    const [item] = normalizeAssistantEvents([assistantEvent({})])
    expect(item.seriesId).toBeNull()
    expect(item.recurring).toBe(false)
  })
})

describe('itemsForDay', () => {
  it('shows a timed event spanning midnight on both days', () => {
    const items = normalizeLocalEvents([
      localEvent({
        start: new Date(2026, 7, 17, 23, 0).toISOString(),
        end: new Date(2026, 7, 18, 1, 0).toISOString(),
      }),
    ])
    expect(itemsForDay(items, new Date(2026, 7, 17))).toHaveLength(1)
    expect(itemsForDay(items, new Date(2026, 7, 18))).toHaveLength(1)
    expect(itemsForDay(items, new Date(2026, 7, 19))).toHaveLength(0)
    expect(itemsForDay(items, new Date(2026, 7, 16))).toHaveLength(0)
  })

  it('shows an all-day event with an exclusive end on each covered day only', () => {
    const items = normalizeAssistantEvents([
      assistantEvent({
        start: { allDay: true, date: '2026-08-17' },
        end: { allDay: true, date: '2026-08-19' },
      }),
    ])
    expect(itemsForDay(items, new Date(2026, 7, 16))).toHaveLength(0)
    expect(itemsForDay(items, new Date(2026, 7, 17))).toHaveLength(1)
    expect(itemsForDay(items, new Date(2026, 7, 18))).toHaveLength(1)
    expect(itemsForDay(items, new Date(2026, 7, 19))).toHaveLength(0)
  })

  it('covers a single day for an all-day event without an end', () => {
    const items = normalizeLocalEvents([
      localEvent({ start: new Date(2026, 7, 17).toISOString(), allDay: true }),
    ])
    expect(itemsForDay(items, new Date(2026, 7, 17))).toHaveLength(1)
    expect(itemsForDay(items, new Date(2026, 7, 18))).toHaveLength(0)
  })

  it('sorts all-day items first, then by start time', () => {
    const items = [
      ...normalizeLocalEvents([
        localEvent({
          id: 'timed-late',
          title: 'Evening run',
          start: new Date(2026, 7, 17, 18, 0).toISOString(),
        }),
        localEvent({
          id: 'timed-early',
          title: 'Morning sync',
          start: new Date(2026, 7, 17, 9, 0).toISOString(),
        }),
      ]),
      ...normalizeAssistantEvents([
        assistantEvent({
          id: 'holiday',
          title: 'Holiday',
          start: { allDay: true, date: '2026-08-17' },
          end: { allDay: true, date: '2026-08-18' },
        }),
      ]),
    ]
    expect(itemsForDay(items, new Date(2026, 7, 17)).map((item) => item.title)).toEqual([
      'Holiday',
      'Morning sync',
      'Evening run',
    ])
  })

  it('excludes events from other days entirely', () => {
    const items = normalizeLocalEvents([
      localEvent({ start: new Date(2026, 7, 20, 9, 0).toISOString() }),
    ])
    expect(itemsForDay(items, new Date(2026, 7, 17))).toEqual([])
  })
})

describe('calendarDateKey', () => {
  it('formats a local YYYY-MM-DD key with padding', () => {
    expect(calendarDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(calendarDateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
    expect(calendarDateKey(new Date(2026, 7, 17, 23, 59))).toBe('2026-08-17')
  })
})
