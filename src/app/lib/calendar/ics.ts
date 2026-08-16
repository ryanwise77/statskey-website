export interface CalendarInvitationOptions {
  sendInvitations?: boolean
  organizerEmail?: string
  attendees?: readonly string[]
}

const EMAIL_PATTERN =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i

export function calendarIcsMimeType(contents: string): string {
  const method =
    /(?:^|\r?\n)METHOD\s*:\s*([A-Z][A-Z0-9-]*)(?:\r?\n|$)/i
      .exec(contents)?.[1]
      ?.toUpperCase()
  return method
    ? `text/calendar; charset=UTF-8; method=${method}`
    : 'text/calendar; charset=UTF-8'
}

export function serializeIcs(lines: readonly string[]): string {
  return `${lines.flatMap(foldIcsLine).join('\r\n')}\r\n`
}

export function utcIcsDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error('Calendar time is invalid.')
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
}

export function calendarInvitationLines(
  organizerEmail: string | undefined,
  attendees: readonly string[]
): string[] {
  const organizer = validCalendarEmail(organizerEmail)
  if (!organizer) {
    throw new Error(
      'A valid organizer email is required to export calendar invitations.'
    )
  }
  const validAttendees = validCalendarEmails(attendees)
  if (validAttendees.length === 0) {
    throw new Error(
      'At least one valid attendee email is required to export calendar invitations.'
    )
  }
  return [
    `ORGANIZER:mailto:${organizer}`,
    ...validAttendees.map(
      (email) =>
        'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;' +
        `PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`
    ),
    'SEQUENCE:0',
  ]
}

export function validCalendarEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const emails: string[] = []
  for (const candidate of value) {
    const email = validCalendarEmail(candidate)
    if (!email || seen.has(email.toLowerCase())) continue
    seen.add(email.toLowerCase())
    emails.push(email)
  }
  return emails
}

function validCalendarEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim()
  return EMAIL_PATTERN.test(email) ? email : null
}

function foldIcsLine(line: string): string[] {
  const chunks: string[] = []
  const encoder = new TextEncoder()
  let current = ''
  let currentOctets = 0
  for (const character of line) {
    const characterOctets = encoder.encode(character).byteLength
    if (current && currentOctets + characterOctets > 75) {
      chunks.push(current)
      current = ` ${character}`
      currentOctets = 1 + characterOctets
    } else {
      current += character
      currentOctets += characterOctets
    }
  }
  chunks.push(current)
  return chunks
}
