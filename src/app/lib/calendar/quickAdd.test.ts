import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './quickAdd'

// Thursday, August 13, 2026, 9:30 AM local time.
const NOW = new Date(2026, 7, 13, 9, 30)

describe('parseQuickAdd relative days', () => {
  it('parses a full compound phrase with date, word time, and location', () => {
    const parsed = parseQuickAdd('Lunch with Sam tomorrow noon at Blue Bottle', NOW)
    expect(parsed.title).toBe('Lunch with Sam')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 12, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 14, 13, 0))
    expect(parsed.allDay).toBe(false)
    expect(parsed.location).toBe('Blue Bottle')
    expect(parsed.confidence).toBe('high')
  })

  it('treats a bare date word as an all-day event', () => {
    const parsed = parseQuickAdd('offsite tomorrow', NOW)
    expect(parsed.title).toBe('offsite')
    expect(parsed.start).toEqual(new Date(2026, 7, 14))
    expect(parsed.end).toBeNull()
    expect(parsed.allDay).toBe(true)
    expect(parsed.confidence).toBe('high')
  })

  it('keeps an explicit today even when the time already passed', () => {
    const parsed = parseQuickAdd('today 8am', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 8, 0))
  })

  it('gives tonight an evening start when no time is provided', () => {
    const parsed = parseQuickAdd('Dinner tonight', NOW)
    expect(parsed.title).toBe('Dinner')
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 20, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 13, 21, 0))
    expect(parsed.allDay).toBe(false)
  })

  it('lets an explicit time override the tonight default', () => {
    const parsed = parseQuickAdd('Dinner tonight 7pm', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 19, 0))
  })

  it('preserves the original casing of the title', () => {
    const parsed = parseQuickAdd('LUNCH TOMORROW', NOW)
    expect(parsed.title).toBe('LUNCH')
  })
})

describe('parseQuickAdd weekdays', () => {
  it('maps a weekday name to its next occurrence', () => {
    const parsed = parseQuickAdd('Standup monday 9am', NOW)
    expect(parsed.title).toBe('Standup')
    expect(parsed.start).toEqual(new Date(2026, 7, 17, 9, 0))
  })

  it('parses next plus an abbreviated weekday with a dash range', () => {
    const parsed = parseQuickAdd('next fri standup 9-9:15am', NOW)
    expect(parsed.title).toBe('standup')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 9, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 14, 9, 15))
    expect(parsed.confidence).toBe('high')
  })

  it('pushes the same weekday out a week when its time already passed', () => {
    const parsed = parseQuickAdd('thursday 8am', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 20, 8, 0))
  })

  it('keeps the same weekday today when its time is still ahead', () => {
    const parsed = parseQuickAdd('Demo thursday 5pm', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 17, 0))
  })

  it('always skips today for next plus the current weekday', () => {
    const parsed = parseQuickAdd('next thursday 5pm', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 20, 17, 0))
  })

  it('treats this weekday like the upcoming one', () => {
    const parsed = parseQuickAdd('this friday demo 4pm', NOW)
    expect(parsed.title).toBe('demo')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 16, 0))
  })

  it('combines a weekday with a 24-hour time', () => {
    const parsed = parseQuickAdd('Sync wed 10:00', NOW)
    expect(parsed.title).toBe('Sync')
    expect(parsed.start).toEqual(new Date(2026, 7, 19, 10, 0))
  })
})

describe('parseQuickAdd explicit dates', () => {
  it('parses slash dates with a time', () => {
    const parsed = parseQuickAdd('Dentist 8/21 3:30pm', NOW)
    expect(parsed.title).toBe('Dentist')
    expect(parsed.start).toEqual(new Date(2026, 7, 21, 15, 30))
    expect(parsed.end).toEqual(new Date(2026, 7, 21, 16, 30))
    expect(parsed.confidence).toBe('high')
  })

  it('parses dash dates as dates, not time ranges', () => {
    const parsed = parseQuickAdd('Flight 8-21', NOW)
    expect(parsed.title).toBe('Flight')
    expect(parsed.start).toEqual(new Date(2026, 7, 21))
    expect(parsed.allDay).toBe(true)
  })

  it('parses a dash date followed by a separate time', () => {
    const parsed = parseQuickAdd('Report due 8-21 5pm', NOW)
    expect(parsed.title).toBe('Report due')
    expect(parsed.start).toEqual(new Date(2026, 7, 21, 17, 0))
  })

  it('parses month-name dates', () => {
    const parsed = parseQuickAdd('Vacation aug 21 all day', NOW)
    expect(parsed.title).toBe('Vacation')
    expect(parsed.start).toEqual(new Date(2026, 7, 21))
    expect(parsed.end).toBeNull()
    expect(parsed.allDay).toBe(true)
    expect(parsed.confidence).toBe('high')
  })

  it('rolls a passed month-name date into next year', () => {
    const parsed = parseQuickAdd('Dentist aug 3', NOW)
    expect(parsed.start).toEqual(new Date(2027, 7, 3))
    expect(parsed.allDay).toBe(true)
  })

  it('rolls a passed numeric date into next year', () => {
    const parsed = parseQuickAdd('1/5 planning', NOW)
    expect(parsed.title).toBe('planning')
    expect(parsed.start).toEqual(new Date(2027, 0, 5))
  })

  it('keeps today when the explicit date is today', () => {
    const parsed = parseQuickAdd('Party 8/13 8pm', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 20, 0))
  })

  it('honors a four-digit year on month-name dates', () => {
    const parsed = parseQuickAdd('august 21 2027 conference', NOW)
    expect(parsed.title).toBe('conference')
    expect(parsed.start).toEqual(new Date(2027, 7, 21))
    expect(parsed.allDay).toBe(true)
  })

  it('honors a two-digit year on slash dates', () => {
    const parsed = parseQuickAdd('kickoff 8/21/27 9am', NOW)
    expect(parsed.start).toEqual(new Date(2027, 7, 21, 9, 0))
  })
})

describe('parseQuickAdd times', () => {
  it('defaults a still-upcoming time to today', () => {
    const parsed = parseQuickAdd('3pm', NOW)
    expect(parsed.title).toBe('')
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 15, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 13, 16, 0))
    expect(parsed.confidence).toBe('partial')
  })

  it('moves an already-passed time to tomorrow', () => {
    const parsed = parseQuickAdd('7am', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 7, 0))
  })

  it('parses 24-hour times', () => {
    const parsed = parseQuickAdd('Review 15:00', NOW)
    expect(parsed.title).toBe('Review')
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 15, 0))
  })

  it('parses midnight against a date word', () => {
    const parsed = parseQuickAdd('run tomorrow midnight', NOW)
    expect(parsed.title).toBe('run')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 0, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 14, 1, 0))
  })

  it('reads at noon as a time, not a location', () => {
    const parsed = parseQuickAdd('Call mom at noon', NOW)
    expect(parsed.title).toBe('Call mom')
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 12, 0))
    expect(parsed.location).toBeNull()
  })

  it('reads a small hour at night as early morning', () => {
    const parsed = parseQuickAdd('3 at night', NOW)
    expect(parsed.title).toBe('')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 3, 0))
    expect(parsed.location).toBeNull()
    expect(parsed.confidence).toBe('partial')
  })

  it('reads a large hour at night as evening', () => {
    const parsed = parseQuickAdd('Drinks 9 at night', NOW)
    expect(parsed.title).toBe('Drinks')
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 21, 0))
  })
})

describe('parseQuickAdd ranges and durations', () => {
  it('parses from X to Y with an inherited meridiem', () => {
    const parsed = parseQuickAdd('Meeting from 3 to 4pm', NOW)
    expect(parsed.title).toBe('Meeting')
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 15, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 13, 16, 0))
  })

  it('parses X to Y where only the start has a meridiem', () => {
    const parsed = parseQuickAdd('Meeting 3pm to 5', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 15, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 13, 17, 0))
  })

  it('flips the bare start hour across noon when needed', () => {
    const parsed = parseQuickAdd('Lunch 11-1pm', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 11, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 13, 13, 0))
  })

  it('lets a range cross midnight into the next day', () => {
    const parsed = parseQuickAdd('Overnight shift 10pm-2am', NOW)
    expect(parsed.title).toBe('Overnight shift')
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 22, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 14, 2, 0))
  })

  it('does not mistake bare numbers with to for a time range', () => {
    const parsed = parseQuickAdd('2 to 3 review', NOW)
    expect(parsed.title).toBe('2 to 3 review')
    expect(parsed.start).toBeNull()
    expect(parsed.confidence).toBe('partial')
  })

  it('applies a minute duration to the start time', () => {
    const parsed = parseQuickAdd('Ship review for 45 min tomorrow 2pm', NOW)
    expect(parsed.title).toBe('Ship review')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 14, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 14, 14, 45))
    expect(parsed.confidence).toBe('high')
  })

  it('applies an hour duration written before the rest', () => {
    const parsed = parseQuickAdd('for 2 hours workshop tomorrow 1pm', NOW)
    expect(parsed.title).toBe('workshop')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 13, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 14, 15, 0))
  })

  it('parses the compact 1h duration form', () => {
    const parsed = parseQuickAdd('Focus block tomorrow 9am for 1h', NOW)
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 9, 0))
    expect(parsed.end).toEqual(new Date(2026, 7, 14, 10, 0))
  })
})

describe('parseQuickAdd all day and locations', () => {
  it('treats all day with no date as today', () => {
    const parsed = parseQuickAdd('all day hackathon', NOW)
    expect(parsed.title).toBe('hackathon')
    expect(parsed.start).toEqual(new Date(2026, 7, 13))
    expect(parsed.allDay).toBe(true)
    expect(parsed.end).toBeNull()
  })

  it('captures a trailing at location', () => {
    const parsed = parseQuickAdd('Standup 9am at HQ', NOW)
    expect(parsed.title).toBe('Standup')
    expect(parsed.location).toBe('HQ')
  })

  it('captures an @ location', () => {
    const parsed = parseQuickAdd('Coffee @ Verve tomorrow 8am', NOW)
    expect(parsed.title).toBe('Coffee')
    expect(parsed.location).toBe('Verve')
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 8, 0))
  })

  it('keeps number-led places as locations', () => {
    const parsed = parseQuickAdd('Party at 5th Avenue tomorrow', NOW)
    expect(parsed.title).toBe('Party')
    expect(parsed.location).toBe('5th Avenue')
    expect(parsed.allDay).toBe(true)
  })

  it('keeps possessive locations intact', () => {
    const parsed = parseQuickAdd("Dinner at Joe's tomorrow 7pm", NOW)
    expect(parsed.title).toBe('Dinner')
    expect(parsed.location).toBe("Joe's")
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 19, 0))
  })
})

describe('parseQuickAdd recurrence', () => {
  it('parses every day with a time and strips the phrase from the title', () => {
    const parsed = parseQuickAdd('Standup every day 9am', NOW)
    expect(parsed.title).toBe('Standup')
    expect(parsed.recurrence).toEqual({ freq: 'daily', interval: 1 })
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 9, 0))
    expect(parsed.confidence).toBe('high')
  })

  it('treats bare daily with no time as a recurring all-day event today', () => {
    const parsed = parseQuickAdd('Journal daily', NOW)
    expect(parsed.title).toBe('Journal')
    expect(parsed.recurrence).toEqual({ freq: 'daily', interval: 1 })
    expect(parsed.start).toEqual(new Date(2026, 7, 13))
    expect(parsed.allDay).toBe(true)
    expect(parsed.confidence).toBe('high')
  })

  it('parses every week as a weekly series starting today', () => {
    const parsed = parseQuickAdd('Review notes every week', NOW)
    expect(parsed.title).toBe('Review notes')
    expect(parsed.recurrence).toEqual({ freq: 'weekly', interval: 1 })
    expect(parsed.start).toEqual(new Date(2026, 7, 13))
    expect(parsed.allDay).toBe(true)
  })

  it('parses the word weekly with a timed slot', () => {
    const parsed = parseQuickAdd('Team retro weekly 4pm', NOW)
    expect(parsed.title).toBe('Team retro')
    expect(parsed.recurrence).toEqual({ freq: 'weekly', interval: 1 })
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 16, 0))
  })

  it('anchors every monday on the coming monday', () => {
    const parsed = parseQuickAdd('Standup every monday 9am', NOW)
    expect(parsed.title).toBe('Standup')
    expect(parsed.recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekdays: [1],
    })
    expect(parsed.start).toEqual(new Date(2026, 7, 17, 9, 0))
  })

  it('parses a slashed weekday list starting at the soonest listed day', () => {
    const parsed = parseQuickAdd('Gym every mon/wed/fri 6am', NOW)
    expect(parsed.title).toBe('Gym')
    expect(parsed.recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekdays: [1, 3, 5],
    })
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 6, 0))
  })

  it('parses weekday pairs joined with and', () => {
    const parsed = parseQuickAdd('Yoga every tuesday and thursday 7am', NOW)
    expect(parsed.title).toBe('Yoga')
    expect(parsed.recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekdays: [2, 4],
    })
    expect(parsed.start).toEqual(new Date(2026, 7, 18, 7, 0))
  })

  it('parses every weekday as monday through friday', () => {
    const parsed = parseQuickAdd('Standup every weekday 9:15am', NOW)
    expect(parsed.recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekdays: [1, 2, 3, 4, 5],
    })
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 9, 15))
  })

  it('parses every 2 weeks alongside a separate weekday date', () => {
    const parsed = parseQuickAdd('Sprint planning every 2 weeks monday 10am', NOW)
    expect(parsed.title).toBe('Sprint planning')
    expect(parsed.recurrence).toEqual({ freq: 'weekly', interval: 2 })
    expect(parsed.start).toEqual(new Date(2026, 7, 17, 10, 0))
  })

  it('parses every other week as an interval of two', () => {
    const parsed = parseQuickAdd('Coffee with Sam every other week 2pm', NOW)
    expect(parsed.title).toBe('Coffee with Sam')
    expect(parsed.recurrence).toEqual({ freq: 'weekly', interval: 2 })
    expect(parsed.start).toEqual(new Date(2026, 7, 13, 14, 0))
  })

  it('parses every month as a monthly all-day series', () => {
    const parsed = parseQuickAdd('Pay rent every month', NOW)
    expect(parsed.title).toBe('Pay rent')
    expect(parsed.recurrence).toEqual({ freq: 'monthly', interval: 1 })
    expect(parsed.start).toEqual(new Date(2026, 7, 13))
    expect(parsed.allDay).toBe(true)
  })

  it('parses every N days with the counted interval', () => {
    const parsed = parseQuickAdd('Water plants every 3 days', NOW)
    expect(parsed.title).toBe('Water plants')
    expect(parsed.recurrence).toEqual({ freq: 'daily', interval: 3 })
    expect(parsed.allDay).toBe(true)
  })

  it('captures an until month-name date', () => {
    const parsed = parseQuickAdd('Standup every day 9am until sep 30', NOW)
    expect(parsed.title).toBe('Standup')
    expect(parsed.recurrence).toEqual({
      freq: 'daily',
      interval: 1,
      until: '2026-09-30',
    })
    expect(parsed.start).toEqual(new Date(2026, 7, 14, 9, 0))
  })

  it('rolls a passed numeric until date into next year', () => {
    const parsed = parseQuickAdd('Team sync every monday 9am until 1/5', NOW)
    expect(parsed.recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekdays: [1],
      until: '2027-01-05',
    })
  })

  it('accepts an ISO until date', () => {
    const parsed = parseQuickAdd('Log weight daily until 2026-12-31', NOW)
    expect(parsed.title).toBe('Log weight')
    expect(parsed.recurrence).toEqual({
      freq: 'daily',
      interval: 1,
      until: '2026-12-31',
    })
  })

  it('leaves recurrence null when no phrase is present', () => {
    const parsed = parseQuickAdd('Lunch with Sam tomorrow noon', NOW)
    expect(parsed.recurrence).toBeNull()
  })
})

describe('parseQuickAdd defaults and confidence', () => {
  it('returns partial for a title with no date or time', () => {
    const parsed = parseQuickAdd('Buy milk', NOW)
    expect(parsed.title).toBe('Buy milk')
    expect(parsed.start).toBeNull()
    expect(parsed.end).toBeNull()
    expect(parsed.allDay).toBe(false)
    expect(parsed.location).toBeNull()
    expect(parsed.confidence).toBe('partial')
  })

  it('returns none for an empty string', () => {
    const parsed = parseQuickAdd('', NOW)
    expect(parsed.title).toBe('')
    expect(parsed.start).toBeNull()
    expect(parsed.confidence).toBe('none')
  })

  it('returns none for whitespace-only input', () => {
    const parsed = parseQuickAdd('   ', NOW)
    expect(parsed.confidence).toBe('none')
  })

  it('returns partial for a date-only input with no title', () => {
    const parsed = parseQuickAdd('aug 21', NOW)
    expect(parsed.title).toBe('')
    expect(parsed.start).toEqual(new Date(2026, 7, 21))
    expect(parsed.allDay).toBe(true)
    expect(parsed.confidence).toBe('partial')
  })
})
