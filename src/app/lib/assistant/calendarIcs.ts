import type { AssistantAction } from './actions'
import { getDesktopBridge } from '../desktop'
import {
  calendarIcsMimeType,
  calendarInvitationLines,
  escapeIcsText,
  serializeIcs,
  utcIcsDateTime,
  validCalendarEmails,
} from '../calendar/ics'

export { calendarIcsMimeType } from '../calendar/ics'

export interface CalendarActionIcsOptions {
  organizerEmail?: string
}

export async function downloadCalendarAction(
  action: AssistantAction,
  options: CalendarActionIcsOptions = {}
): Promise<void> {
  const ics = calendarActionIcs(action, options)
  const fileName = safeFileName(text(action.payload.title) || 'calendar-event')
  const bridge = getDesktopBridge()
  if (bridge?.openCalendarFile) {
    const result = await bridge.openCalendarFile(ics, fileName)
    if (!result.ok) {
      throw new Error(result.error || 'Could not open the calendar event.')
    }
    return
  }
  const blob = new Blob([ics], { type: calendarIcsMimeType(ics) })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${fileName}.ics`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function calendarActionIcs(
  action: AssistantAction,
  now?: Date,
  options?: CalendarActionIcsOptions
): string
export function calendarActionIcs(
  action: AssistantAction,
  options?: CalendarActionIcsOptions
): string
export function calendarActionIcs(
  action: AssistantAction,
  nowOrOptions: Date | CalendarActionIcsOptions = new Date(),
  maybeOptions: CalendarActionIcsOptions = {}
): string {
  const now = nowOrOptions instanceof Date ? nowOrOptions : new Date()
  const options = nowOrOptions instanceof Date ? maybeOptions : nowOrOptions
  if (action.kind !== 'calendar.create') {
    throw new Error('Only calendar actions can be exported.')
  }
  if (action.status !== 'awaitingApproval') {
    throw new Error('Only a current calendar proposal can be opened.')
  }
  if (action.expiresAt && action.expiresAt <= now) {
    throw new Error('This calendar proposal expired. Prepare a current one.')
  }
  if (text(action.payload.provider).toLowerCase() === 'google') {
    throw new Error('Google calendar actions require exact in-app approval.')
  }
  const payload = action.payload
  const title = requiredText(payload.title, 'title')
  const start = requiredText(payload.start, 'start')
  const end = requiredText(payload.end, 'end')
  const allDay = payload.allDay === true
  const sendInvitations = payload.sendInvitations === true
  const attendees = sendInvitations ? validCalendarEmails(payload.attendees) : []

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StatsKey//Calendar Action//EN',
    'CALSCALE:GREGORIAN',
    ...(sendInvitations ? ['METHOD:REQUEST'] : []),
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(action.id)}@statskey.ai`,
    `DTSTAMP:${utcIcsDateTime(now)}`,
    allDay
      ? `DTSTART;VALUE=DATE:${calendarDay(start)}`
      : `DTSTART:${utcIcsDateTime(new Date(start))}`,
    allDay
      ? `DTEND;VALUE=DATE:${calendarDay(end)}`
      : `DTEND:${utcIcsDateTime(new Date(end))}`,
    `SUMMARY:${escapeIcsText(title)}`,
    ...(text(payload.location)
      ? [`LOCATION:${escapeIcsText(text(payload.location))}`]
      : []),
    ...(text(payload.notes)
      ? [`DESCRIPTION:${escapeIcsText(text(payload.notes))}`]
      : []),
    ...(sendInvitations
      ? calendarInvitationLines(options.organizerEmail, attendees)
      : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return serializeIcs(lines)
}

function requiredText(value: unknown, field: string): string {
  const result = text(value)
  if (!result) throw new Error(`Calendar ${field} is missing.`)
  return result
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function calendarDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Calendar date is invalid.')
  }
  return value.replaceAll('-', '')
}

function safeFileName(value: string): string {
  const safe = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 _.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return safe || 'calendar-event'
}
