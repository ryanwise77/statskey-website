// Normalizes every calendar source (Google, ICS subscriptions, local
// device events) into one CalendarItem shape the calendar UI can render,
// plus day-bucketing helpers. All day math happens in the local timezone;
// all-day ends are EXCLUSIVE, matching RFC 5545 and Google Calendar.

import type {
  AssistantCalendarEvent,
  AssistantCalendarEventTime,
} from '../assistant/calendar'
import type { LocalCalendarOccurrence } from './localCalendar'

export interface CalendarItem {
  key: string
  kind: 'event' | 'meal' | 'fitness'
  source: 'google' | 'subscription' | 'local' | 'plan'
  id: string | null
  title: string
  allDay: boolean
  start: Date
  end: Date | null
  location: string | null
  calendarName: string | null
  editable: boolean
  seriesId: string | null
  recurring: boolean
}

export function normalizeAssistantEvents(
  events: AssistantCalendarEvent[]
): CalendarItem[] {
  return events.flatMap((event) => {
    const start = parseEventTime(event.start)
    if (!start) return []
    const end = parseEventTime(event.end)
    const source = event.source === 'subscription' ? 'subscription' : 'google'
    const id = event.id ?? null
    const title = event.title || 'Untitled event'
    return [
      {
        key: `${source}:${id ?? `${title}|${start.toISOString()}`}`,
        kind: 'event' as const,
        source: source as CalendarItem['source'],
        id,
        title,
        allDay:
          event.start.allDay === true ||
          (!event.start.dateTime && Boolean(event.start.date)),
        start,
        end,
        location: event.location ?? null,
        calendarName: event.calendarName ?? null,
        editable: false,
        seriesId: null,
        recurring: false,
      },
    ]
  })
}

export function normalizeLocalEvents(
  events: LocalCalendarOccurrence[]
): CalendarItem[] {
  return events.flatMap((event) => {
    const start = parseIsoLocal(event.start)
    if (!start) return []
    const end = event.end ? parseIsoLocal(event.end) : null
    const recurring = Boolean(event.recurrence)
    return [
      {
        key: `local:${event.occurrenceKey ?? event.id}`,
        kind: 'event' as const,
        source: 'local' as const,
        id: event.id,
        title: event.title,
        allDay: event.allDay,
        start,
        end,
        location: event.location,
        calendarName: null,
        editable: true,
        seriesId: event.seriesId ?? (recurring ? event.id : null),
        recurring,
      },
    ]
  })
}

export function itemsForDay(items: CalendarItem[], date: Date): CalendarItem[] {
  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime()
  const dayEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1
  ).getTime()
  return items
    .filter((item) => {
      const startMs = item.start.getTime()
      return startMs < dayEnd && effectiveEndMs(item) > dayStart
    })
    .sort(compareItems)
}

export function calendarDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function effectiveEndMs(item: CalendarItem): number {
  const startMs = item.start.getTime()
  if (item.end) {
    const endMs = item.end.getTime()
    if (endMs > startMs) return endMs
  }
  if (item.allDay) {
    return new Date(
      item.start.getFullYear(),
      item.start.getMonth(),
      item.start.getDate() + 1
    ).getTime()
  }
  return startMs + 1
}

function compareItems(left: CalendarItem, right: CalendarItem): number {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1
  const byStart = left.start.getTime() - right.start.getTime()
  if (byStart !== 0) return byStart
  return left.title.localeCompare(right.title)
}

function parseEventTime(
  time: AssistantCalendarEventTime | null | undefined
): Date | null {
  if (!time) return null
  if (time.dateTime) {
    const parsed = new Date(time.dateTime)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (time.date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(time.date)
    if (!match) return null
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  return null
}

function parseIsoLocal(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
