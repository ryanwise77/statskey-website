import { describe, expect, it } from 'vitest'
import { calendarActionIcs, calendarIcsMimeType } from './calendarIcs'
import type { AssistantAction } from './actions'

describe('portable calendar action boundary', () => {
  it('exports only a current non-Google proposal', () => {
    const action = calendarAction()
    const ics = calendarActionIcs(action, new Date('2026-08-08T12:00:00Z'))
    expect(ics.split('\r\n')).toMatchInlineSnapshot(`
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//StatsKey//Calendar Action//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        "UID:action-1@statskey.ai",
        "DTSTAMP:20260808T120000Z",
        "DTSTART:20260810T140000Z",
        "DTEND:20260810T150000Z",
        "SUMMARY:Review event",
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ]
    `)
    expect(ics).not.toContain('METHOD:')
    expect(ics).not.toContain('ATTENDEE')
    expect(calendarIcsMimeType(ics)).toBe('text/calendar; charset=UTF-8')
  })

  it('does not add attendees to a neutral calendar snapshot', () => {
    const action = calendarAction({
      payload: {
        ...payload(),
        attendees: ['guest@example.com'],
        sendInvitations: false,
      },
    })
    const ics = calendarActionIcs(action, new Date('2026-08-08T12:00:00Z'))
    expect(ics).not.toContain('METHOD:')
    expect(ics).not.toContain('ATTENDEE')
  })

  it('exports requested invitations with RFC scheduling properties', () => {
    const action = calendarAction({
      expiresAt: undefined,
      payload: {
        ...payload(),
        attendees: [
          'guest@example.com',
          'not-an-email',
          'second@example.com',
        ],
        sendInvitations: true,
      },
    })
    const ics = calendarActionIcs(action, {
      organizerEmail: 'host@example.com',
    })
    const unfolded = ics.replace(/\r\n[ \t]/g, '')

    expect(ics).toContain('\r\nMETHOD:REQUEST\r\n')
    expect(ics).toContain('\r\nORGANIZER:mailto:host@example.com\r\n')
    expect(unfolded).toContain(
      '\r\nATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;' +
        'PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example.com\r\n'
    )
    expect(unfolded).toContain('RSVP=TRUE:mailto:second@example.com\r\n')
    expect(ics).not.toContain('not-an-email')
    expect(ics).toContain('\r\nSEQUENCE:0\r\n')
    expect(calendarIcsMimeType(ics)).toBe(
      'text/calendar; charset=UTF-8; method=REQUEST'
    )
  })

  it('requires a valid organizer when invitations are requested', () => {
    const action = calendarAction({
      payload: {
        ...payload(),
        attendees: ['guest@example.com'],
        sendInvitations: true,
      },
    })
    expect(() =>
      calendarActionIcs(action, new Date('2026-08-08T12:00:00Z'))
    ).toThrow(/valid organizer email/i)
    expect(() =>
      calendarActionIcs(action, new Date('2026-08-08T12:00:00Z'), {
        organizerEmail: 'invalid',
      })
    ).toThrow(/valid organizer email/i)
  })

  it('requires at least one valid attendee when invitations are requested', () => {
    const action = calendarAction({
      payload: {
        ...payload(),
        attendees: ['not-an-email'],
        sendInvitations: true,
      },
    })
    expect(() =>
      calendarActionIcs(action, new Date('2026-08-08T12:00:00Z'), {
        organizerEmail: 'host@example.com',
      })
    ).toThrow(/valid attendee email/i)
  })

  it('uses an exclusive VALUE=DATE end for all-day actions', () => {
    const action = calendarAction({
      payload: {
        ...payload(),
        allDay: true,
        start: '2026-08-10',
        end: '2026-08-12',
      },
    })
    const ics = calendarActionIcs(action, new Date('2026-08-08T12:00:00Z'))
    expect(ics).toContain('DTSTART;VALUE=DATE:20260810')
    expect(ics).toContain('DTEND;VALUE=DATE:20260812')
  })

  it('folds Unicode content without splitting UTF-8 code points', () => {
    const title = `Résumé planning 🚀 東京 ${'coordination '.repeat(9)}end`
    const action = calendarAction({
      payload: { ...payload(), title },
    })
    const ics = calendarActionIcs(action, new Date('2026-08-08T12:00:00Z'))
    const encoder = new TextEncoder()
    for (const line of ics.split('\r\n')) {
      expect(encoder.encode(line).byteLength).toBeLessThanOrEqual(75)
    }
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`)
    expect(ics).not.toContain('\ufffd')
  })

  it('does not let a Google action bypass exact approval through ICS', () => {
    expect(() =>
      calendarActionIcs(
        calendarAction({ payload: { ...payload(), provider: 'google' } }),
        new Date('2026-08-08T12:00:00Z')
      )
    ).toThrow(/exact in-app approval/)
  })

  it('does not export rejected or expired actions', () => {
    expect(() =>
      calendarActionIcs(
        calendarAction({ status: 'rejected' }),
        new Date('2026-08-08T12:00:00Z')
      )
    ).toThrow(/current calendar proposal/)
    expect(() =>
      calendarActionIcs(
        calendarAction({ expiresAt: new Date('2026-08-08T11:00:00Z') }),
        new Date('2026-08-08T12:00:00Z')
      )
    ).toThrow(/expired/)
  })
})

function calendarAction(
  overrides: Partial<AssistantAction> = {}
): AssistantAction {
  return {
    id: 'action-1',
    schemaVersion: 1,
    policyVersion: 1,
    kind: 'calendar.create',
    status: 'awaitingApproval',
    summary: 'Review event',
    payloadHash: 'hash',
    payload: payload(),
    requiresApproval: true,
    createdAt: new Date('2026-08-08T10:00:00Z'),
    updatedAt: new Date('2026-08-08T10:00:00Z'),
    expiresAt: new Date('2026-08-09T10:00:00Z'),
    ...overrides,
  }
}

function payload(): Record<string, unknown> {
  return {
    provider: 'unspecified',
    title: 'Review event',
    start: '2026-08-10T09:00:00-05:00',
    end: '2026-08-10T10:00:00-05:00',
    timeZone: 'America/Chicago',
  }
}
