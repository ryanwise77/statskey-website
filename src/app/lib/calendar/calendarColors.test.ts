import { describe, expect, it } from 'vitest'
import { CALENDAR_COLOR_PALETTE, calendarColor } from './calendarColors'

const HEX = /^#[0-9a-f]{6}$/

describe('calendarColor', () => {
  it('exposes an 8-color palette led by the accent blue', () => {
    expect(CALENDAR_COLOR_PALETTE).toHaveLength(8)
    expect(CALENDAR_COLOR_PALETTE[0].dot).toBe('#0066cc')
    for (const entry of CALENDAR_COLOR_PALETTE) {
      expect(entry.bg).toMatch(HEX)
      expect(entry.fg).toMatch(HEX)
      expect(entry.dot).toMatch(HEX)
    }
  })

  it('keeps every palette entry distinct', () => {
    expect(new Set(CALENDAR_COLOR_PALETTE.map((entry) => entry.dot)).size).toBe(8)
    expect(new Set(CALENDAR_COLOR_PALETTE.map((entry) => entry.bg)).size).toBe(8)
  })

  it('is deterministic for the same key', () => {
    expect(calendarColor('sub:race schedule')).toEqual(
      calendarColor('sub:race schedule')
    )
    expect(calendarColor('')).toEqual(calendarColor(''))
  })

  it('pins built-in sources to stable brand entries', () => {
    expect(calendarColor('local').dot).toBe('#0066cc')
    expect(calendarColor('google').dot).toBe('#7c3aed')
    expect(calendarColor('meals').dot).toBe('#16a34a')
    expect(calendarColor('fitness').dot).toBe('#0891b2')
  })

  it('always returns a palette entry', () => {
    for (const key of ['', 'local', 'google:primary', 'subscription:races', 'x']) {
      expect(CALENDAR_COLOR_PALETTE).toContainEqual(calendarColor(key))
    }
  })

  it('spreads distinct keys across multiple palette entries', () => {
    const dots = new Set(
      Array.from({ length: 24 }, (_, index) => calendarColor(`calendar-${index}`).dot)
    )
    expect(dots.size).toBeGreaterThan(2)
  })

  it('returns a copy so callers cannot mutate the palette', () => {
    const first = calendarColor('local')
    first.dot = '#000000'
    expect(calendarColor('local').dot).not.toBe('#000000')
  })
})
