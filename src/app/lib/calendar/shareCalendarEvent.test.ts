import { describe, expect, it } from 'vitest'
import { localEventShareDescription } from './shareCalendarEvent'
import type { LocalCalendarEvent } from './localCalendar'

function event(overrides: Partial<LocalCalendarEvent> = {}): LocalCalendarEvent {
  return {
    id: 'event-1',
    title: 'Project review',
    start: '2026-08-21T20:30:00.000Z',
    end: '2026-08-21T21:30:00.000Z',
    allDay: false,
    location: 'Studio 4',
    notes: 'Bring the latest draft.',
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    ...overrides,
  }
}

describe('localEventShareDescription', () => {
  it('provides a useful plain-text fallback for email clients', () => {
    const description = localEventShareDescription(event())
    expect(description).toContain('Project review')
    expect(description).toContain('When:')
    expect(description).toContain('Where: Studio 4')
    expect(description).toContain('Bring the latest draft.')
    expect(description).toContain('attached calendar file')
  })

  it('labels all-day events without inventing a time', () => {
    const description = localEventShareDescription(
      event({ start: '2026-08-21T00:00:00.000Z', end: null, allDay: true })
    )
    expect(description).toContain('(all day)')
  })
})
