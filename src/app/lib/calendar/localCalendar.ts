// Local, device-only calendar events. Storage is localStorage-backed and
// deliberately tolerant: corrupt or missing storage reads as an empty
// calendar instead of throwing. All-day events store their `end` as an
// EXCLUSIVE date (the midnight after the last covered day), matching the
// RFC 5545 and Google Calendar conventions used elsewhere in the app.

import {
  calendarInvitationLines,
  escapeIcsText,
  serializeIcs,
  utcIcsDateTime,
  validCalendarEmails,
  type CalendarInvitationOptions,
} from './ics'

export { calendarIcsMimeType } from './ics'
export type LocalEventIcsOptions = CalendarInvitationOptions

export interface LocalEventRecurrence {
  freq: 'daily' | 'weekly' | 'monthly'
  interval: number
  /** JS getDay() numbering (0=Sunday..6=Saturday); only meaningful for 'weekly'. */
  byWeekdays?: number[]
  /** Inclusive local YYYY-MM-DD date; the series stops after this day. */
  until?: string | null
}

export interface LocalCalendarEvent {
  id: string
  title: string
  start: string
  end: string | null
  allDay: boolean
  location: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  recurrence?: LocalEventRecurrence | null
}

/**
 * What `listLocalEvents` returns: plain events pass through unchanged, while
 * recurring events are expanded into occurrence copies that also carry a
 * stable `occurrenceKey` (id + occurrence date) and the series `seriesId`.
 */
export type LocalCalendarOccurrence = LocalCalendarEvent & {
  occurrenceKey?: string
  seriesId?: string
}

export const LOCAL_CALENDAR_EVENT = 'statskey:local-calendar-changed'

const STORAGE_KEY = 'statskey.calendar.local.v1'
const HOUR_MS = 3_600_000
const MAX_OCCURRENCES_PER_SERIES = 400
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const BYDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export function listLocalEvents(
  startIso?: string,
  endIso?: string
): LocalCalendarOccurrence[] {
  const events = readStoredEvents()
  const rangeStart = rangeBoundary(startIso)
  const rangeEnd = rangeBoundary(endIso)
  const results = events.flatMap<LocalCalendarOccurrence>((event) => {
    // Expansion needs an end boundary to stay finite; unbounded queries
    // return the stored series entries untouched.
    if (event.recurrence && rangeEnd !== null) {
      return expandSeries(event, rangeStart, rangeEnd)
    }
    return eventInRange(event, rangeStart, rangeEnd) ? [event] : []
  })
  return results.sort(byStart)
}

export function saveLocalEvent(
  event: Partial<LocalCalendarEvent> & { title: string; start: string }
): LocalCalendarEvent {
  const title = event.title.trim()
  if (!title) throw new Error('The event needs a title.')
  if (Number.isNaN(parseIsoLocal(event.start).getTime())) {
    throw new Error('The event needs a valid start.')
  }
  const nowIso = new Date().toISOString()
  const events = readStoredEvents()
  const existing = event.id
    ? events.find((entry) => entry.id === event.id)
    : undefined
  const saved: LocalCalendarEvent = {
    id: existing?.id ?? event.id ?? createEventId(),
    title,
    start: event.start,
    end: event.end !== undefined ? event.end : existing?.end ?? null,
    allDay: event.allDay !== undefined ? event.allDay : existing?.allDay ?? false,
    location: normalizeOptional(event.location, existing?.location),
    notes: normalizeOptional(event.notes, existing?.notes),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    recurrence:
      event.recurrence !== undefined
        ? sanitizeRecurrence(event.recurrence)
        : existing?.recurrence ?? null,
  }
  const next = existing
    ? events.map((entry) => (entry.id === saved.id ? saved : entry))
    : [...events, saved]
  writeStoredEvents(next.sort(byStart))
  emitLocalCalendarChange()
  return saved
}

export function deleteLocalEvent(id: string): void {
  const events = readStoredEvents()
  const next = events.filter((event) => event.id !== id)
  if (next.length === events.length) return
  writeStoredEvents(next)
  emitLocalCalendarChange()
}

export function localEventIcs(
  event: LocalCalendarEvent,
  options: LocalEventIcsOptions = {}
): string {
  const start = parseIsoLocal(event.start)
  if (Number.isNaN(start.getTime())) {
    throw new Error('The event start is invalid.')
  }
  const parsedEnd = event.end ? parseIsoLocal(event.end) : null
  const end =
    parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : null
  const sendInvitations = options.sendInvitations === true
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StatsKey//Local Calendar//EN',
    'CALSCALE:GREGORIAN',
    ...(sendInvitations ? ['METHOD:REQUEST'] : []),
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.id)}@statskey.ai`,
    `DTSTAMP:${utcIcsDateTime(new Date())}`,
    ...(event.allDay
      ? [
          `DTSTART;VALUE=DATE:${localDay(start)}`,
          `DTEND;VALUE=DATE:${localDay(exclusiveAllDayEnd(start, end))}`,
        ]
      : [
          `DTSTART:${utcIcsDateTime(start)}`,
          `DTEND:${utcIcsDateTime(
            end && end.getTime() > start.getTime()
              ? end
              : new Date(start.getTime() + HOUR_MS)
          )}`,
        ]),
    ...(event.recurrence
      ? [recurrenceRuleLine(event.recurrence, event.allDay)]
      : []),
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    ...(event.notes ? [`DESCRIPTION:${escapeIcsText(event.notes)}`] : []),
    ...(sendInvitations
      ? calendarInvitationLines(
          options.organizerEmail,
          validCalendarEmails(options.attendees)
        )
      : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return serializeIcs(lines)
}

function eventInRange(
  event: LocalCalendarEvent,
  rangeStart: number | null,
  rangeEnd: number | null
): boolean {
  if (rangeStart === null && rangeEnd === null) return true
  const startMs = parseIsoLocal(event.start).getTime()
  if (Number.isNaN(startMs)) return false
  if (rangeStart !== null && effectiveEndMs(event, startMs) <= rangeStart) {
    return false
  }
  if (rangeEnd !== null && startMs >= rangeEnd) return false
  return true
}

function expandSeries(
  event: LocalCalendarEvent,
  rangeStart: number | null,
  rangeEnd: number
): LocalCalendarOccurrence[] {
  const recurrence = event.recurrence
  if (!recurrence) return []
  const seriesStart = parseIsoLocal(event.start)
  if (Number.isNaN(seriesStart.getTime())) return []
  const parsedEnd = event.end ? parseIsoLocal(event.end) : null
  const seriesEnd =
    parsedEnd &&
    !Number.isNaN(parsedEnd.getTime()) &&
    parsedEnd.getTime() > seriesStart.getTime()
      ? parsedEnd
      : null
  const durationMs = seriesEnd ? seriesEnd.getTime() - seriesStart.getTime() : null
  const allDaySpanDays = seriesEnd && event.allDay ? localDayDiff(seriesStart, seriesEnd) : null
  const untilExclusiveMs = untilBoundaryMs(recurrence.until)
  const dateOnly = DATE_ONLY_PATTERN.test(event.start)
  const occurrences: LocalCalendarOccurrence[] = []
  for (const day of seriesDays(seriesStart, recurrence)) {
    const start = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      seriesStart.getHours(),
      seriesStart.getMinutes(),
      seriesStart.getSeconds(),
      seriesStart.getMilliseconds()
    )
    const startMs = start.getTime()
    if (untilExclusiveMs !== null && startMs >= untilExclusiveMs) break
    if (startMs >= rangeEnd) break
    const end = event.allDay
      ? allDaySpanDays !== null && allDaySpanDays > 0
        ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + allDaySpanDays)
        : null
      : durationMs !== null
        ? new Date(startMs + durationMs)
        : null
    if (rangeStart !== null && occurrenceEndMs(event.allDay, start, end) <= rangeStart) {
      continue
    }
    occurrences.push({
      ...event,
      start: formatEventInstant(start, dateOnly),
      end: end ? formatEventInstant(end, dateOnly) : null,
      occurrenceKey: `${event.id}:${localDayKey(start)}`,
      seriesId: event.id,
    })
  }
  return occurrences
}

/**
 * Yields the local occurrence days of a series in ascending order, starting
 * at the series start day, capped at MAX_OCCURRENCES_PER_SERIES candidates.
 */
function* seriesDays(
  seriesStart: Date,
  recurrence: LocalEventRecurrence
): Generator<Date> {
  const interval = normalizeInterval(recurrence.interval)
  const year = seriesStart.getFullYear()
  const month = seriesStart.getMonth()
  const date = seriesStart.getDate()
  let produced = 0
  if (recurrence.freq === 'daily') {
    for (let step = 0; produced < MAX_OCCURRENCES_PER_SERIES; step += interval) {
      yield new Date(year, month, date + step)
      produced += 1
    }
    return
  }
  if (recurrence.freq === 'monthly') {
    // Months too short for the anchor day (like the 31st) are skipped, so a
    // separate iteration guard keeps the walk finite regardless.
    let steps = 0
    for (
      let offset = 0;
      produced < MAX_OCCURRENCES_PER_SERIES && steps < MAX_OCCURRENCES_PER_SERIES * 12;
      offset += interval, steps += 1
    ) {
      const candidate = new Date(year, month + offset, date)
      if (candidate.getDate() !== date) continue
      yield candidate
      produced += 1
    }
    return
  }
  const byWeekdays =
    recurrence.byWeekdays && recurrence.byWeekdays.length > 0
      ? [...recurrence.byWeekdays].sort((left, right) => left - right)
      : [seriesStart.getDay()]
  const weekAnchor = date - seriesStart.getDay()
  const seriesDayMs = new Date(year, month, date).getTime()
  for (let week = 0; ; week += interval) {
    for (const weekday of byWeekdays) {
      const candidate = new Date(year, month, weekAnchor + week * 7 + weekday)
      if (candidate.getTime() < seriesDayMs) continue
      yield candidate
      produced += 1
      if (produced >= MAX_OCCURRENCES_PER_SERIES) return
    }
  }
}

function occurrenceEndMs(allDay: boolean, start: Date, end: Date | null): number {
  if (end && end.getTime() > start.getTime()) return end.getTime()
  if (allDay) {
    return new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 1
    ).getTime()
  }
  return start.getTime() + 1
}

function untilBoundaryMs(until: string | null | undefined): number | null {
  if (typeof until !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until)
  if (!match) return null
  // The until day is inclusive, so the boundary is the following midnight.
  const boundary = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + 1
  ).getTime()
  return Number.isNaN(boundary) ? null : boundary
}

function localDayDiff(start: Date, end: Date): number {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000)
}

function formatEventInstant(date: Date, dateOnly: boolean): string {
  return dateOnly ? localDayKey(date) : date.toISOString()
}

function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function normalizeInterval(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

function sanitizeRecurrence(value: unknown): LocalEventRecurrence | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const freq = record.freq
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly') return null
  const interval =
    typeof record.interval === 'number' ? normalizeInterval(record.interval) : 1
  const byWeekdays =
    freq === 'weekly' && Array.isArray(record.byWeekdays)
      ? [
          ...new Set(
            record.byWeekdays.filter(
              (day): day is number =>
                typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6
            )
          ),
        ].sort((left, right) => left - right)
      : []
  const until =
    typeof record.until === 'string' && untilBoundaryMs(record.until) !== null
      ? record.until
      : null
  const recurrence: LocalEventRecurrence = { freq, interval, until }
  if (byWeekdays.length > 0) recurrence.byWeekdays = byWeekdays
  return recurrence
}

function recurrenceRuleLine(
  recurrence: LocalEventRecurrence,
  allDay: boolean
): string {
  const parts = [`FREQ=${recurrence.freq.toUpperCase()}`]
  const interval = normalizeInterval(recurrence.interval)
  if (interval > 1) parts.push(`INTERVAL=${interval}`)
  if (recurrence.freq === 'weekly' && recurrence.byWeekdays?.length) {
    const codes = recurrence.byWeekdays
      .map((day) => BYDAY_CODES[day])
      .filter((code): code is string => Boolean(code))
    if (codes.length > 0) parts.push(`BYDAY=${codes.join(',')}`)
  }
  if (recurrence.until) {
    const until = parseIsoLocal(recurrence.until)
    if (!Number.isNaN(until.getTime())) {
      parts.push(
        allDay
          ? `UNTIL=${localDay(until)}`
          : `UNTIL=${utcIcsDateTime(
              new Date(
                until.getFullYear(),
                until.getMonth(),
                until.getDate(),
                23,
                59,
                59
              )
            )}`
      )
    }
  }
  return `RRULE:${parts.join(';')}`
}

function readStoredEvents(): LocalCalendarEvent[] {
  const storage = storageArea()
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      const event = sanitizeStoredEvent(entry)
      return event ? [event] : []
    })
  } catch {
    return []
  }
}

function writeStoredEvents(events: LocalCalendarEvent[]): void {
  const storage = storageArea()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch {
    // Storage can be full or unavailable; the in-memory result is still valid.
  }
}

function sanitizeStoredEvent(entry: unknown): LocalCalendarEvent | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const start = typeof record.start === 'string' ? record.start : ''
  if (!id || !title || Number.isNaN(parseIsoLocal(start).getTime())) return null
  const end =
    typeof record.end === 'string' &&
    !Number.isNaN(parseIsoLocal(record.end).getTime())
      ? record.end
      : null
  return {
    id,
    title,
    start,
    end,
    allDay: record.allDay === true,
    location: typeof record.location === 'string' ? record.location : null,
    notes: typeof record.notes === 'string' ? record.notes : null,
    createdAt:
      typeof record.createdAt === 'string' ? record.createdAt : start,
    updatedAt:
      typeof record.updatedAt === 'string' ? record.updatedAt : start,
    recurrence: sanitizeRecurrence(record.recurrence),
  }
}

function storageArea(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function emitLocalCalendarChange(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return
  }
  try {
    window.dispatchEvent(new CustomEvent(LOCAL_CALENDAR_EVENT))
  } catch {
    // The change event is a courtesy to open views; skip it where unsupported.
  }
}

function createEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeOptional(
  value: string | null | undefined,
  fallback: string | null | undefined
): string | null {
  if (value === undefined) return fallback ?? null
  if (value === null) return null
  return value.trim() || null
}

function byStart(left: LocalCalendarEvent, right: LocalCalendarEvent): number {
  const leftMs = parseIsoLocal(left.start).getTime()
  const rightMs = parseIsoLocal(right.start).getTime()
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return 0
  return leftMs - rightMs
}

function rangeBoundary(value: string | undefined): number | null {
  if (!value) return null
  const parsed = parseIsoLocal(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function effectiveEndMs(event: LocalCalendarEvent, startMs: number): number {
  if (event.end) {
    const endMs = parseIsoLocal(event.end).getTime()
    if (!Number.isNaN(endMs) && endMs > startMs) return endMs
  }
  if (event.allDay) {
    const start = parseIsoLocal(event.start)
    return new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 1
    ).getTime()
  }
  return startMs + 1
}

function exclusiveAllDayEnd(start: Date, end: Date | null): Date {
  const dayAfterStart = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 1
  )
  if (!end || end.getTime() <= start.getTime()) return dayAfterStart
  return end
}

function parseIsoLocal(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    )
  }
  return new Date(value)
}

function localDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}${month}${day}`
}
