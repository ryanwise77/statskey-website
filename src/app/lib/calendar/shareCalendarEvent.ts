import { getDesktopBridge } from '../desktop'
import { calendarIcsMimeType } from './ics'
import type { LocalCalendarEvent } from './localCalendar'

export type CalendarShareOutcome =
  | 'shared'
  | 'attachment-ready'
  | 'cancelled'

interface ShareCalendarFileInput {
  contents: string
  fileName: string
  title: string
  description: string
}

/**
 * Shares a real `text/calendar` file through the native share sheet when the
 * platform supports it. Browsers without file sharing get a normal `.ics`
 * download, which remains the most portable handoff to an email composer.
 */
export async function shareCalendarFile({
  contents,
  fileName,
  title,
  description,
}: ShareCalendarFileInput): Promise<CalendarShareOutcome> {
  const normalizedName = fileName.toLowerCase().endsWith('.ics')
    ? fileName
    : `${fileName}.ics`
  const bridge = getDesktopBridge()
  if (bridge?.shareCalendarFile) {
    const result = await bridge.shareCalendarFile(
      contents,
      normalizedName.replace(/\.ics$/i, ''),
      description
    )
    if (result.ok) {
      return result.needsAttachment ? 'attachment-ready' : 'shared'
    }
    if (!result.unsupported) {
      throw new Error(result.error || 'Could not share the calendar event.')
    }
  }

  const file = calendarFile(contents, normalizedName)
  if (
    file &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title, text: description, files: [file] })
        return 'shared'
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled'
      }
      // A browser may advertise file sharing but reject this MIME type at
      // runtime. The `.ics` download below remains a safe fallback.
    }
  }

  downloadCalendarFile(contents, normalizedName)
  openEmailComposer(title, description)
  return 'attachment-ready'
}

export function localEventShareDescription(event: LocalCalendarEvent): string {
  const start = new Date(event.start)
  const parsedEnd = event.end ? new Date(event.end) : null
  const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : null
  const lines = [event.title, eventWhen(event, start, end)]
  if (event.location) lines.push(`Where: ${event.location}`)
  if (event.notes) lines.push('', event.notes)
  lines.push('', 'Open the attached calendar file to add this event.')
  return lines.join('\n')
}

function eventWhen(
  event: LocalCalendarEvent,
  start: Date,
  end: Date | null
): string {
  if (event.allDay) {
    return `When: ${start.toLocaleDateString([], {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })} (all day)`
  }
  const day = start.toLocaleDateString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const startTime = start.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  const endTime = end
    ? end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null
  return `When: ${day}, ${startTime}${endTime ? ` – ${endTime}` : ''}`
}

function calendarFile(contents: string, fileName: string): File | null {
  if (typeof File === 'undefined') return null
  return new File([contents], fileName, {
    type: `${calendarIcsMimeType(contents)}; component=VEVENT`,
  })
}

function downloadCalendarFile(contents: string, fileName: string): void {
  const blob = new Blob([contents], {
    type: `${calendarIcsMimeType(contents)}; component=VEVENT`,
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function openEmailComposer(title: string, description: string): void {
  if (typeof window === 'undefined') return
  const query = new URLSearchParams({
    subject: `Calendar event: ${title.slice(0, 160)}`,
    body: `${description.slice(0, 4_000)}\n\nAttach the downloaded .ics file to this message.`,
  })
  window.location.href = `mailto:?${query.toString()}`
}
