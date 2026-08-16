// Deterministic quick-add parsing: turns free text like
// "Lunch with Sam tomorrow noon at Blue Bottle" into a concrete event
// instantly — no network, no model, no date library. All resolution happens
// in the local timezone.

export interface QuickAddRecurrence {
  freq: 'daily' | 'weekly' | 'monthly'
  interval: number
  /** JS getDay() numbering (0=Sunday..6=Saturday); only set for 'weekly'. */
  byWeekdays?: number[]
  /** Inclusive local YYYY-MM-DD date the series runs through. */
  until?: string | null
}

export interface QuickAddParse {
  title: string
  start: Date | null
  end: Date | null
  allDay: boolean
  location: string | null
  confidence: 'high' | 'partial' | 'none'
  recurrence?: QuickAddRecurrence | null
}

interface TimeOfDay {
  hours: number
  minutes: number
}

interface RangeSide {
  hours: number
  minutes: number
  meridiem: 'am' | 'pm' | null
}

type DateSpec =
  | { kind: 'offset'; days: number }
  | { kind: 'tonight' }
  | { kind: 'weekday'; day: number; next: boolean }
  | { kind: 'explicit'; year: number | null; month: number; day: number }

type TimeSpec =
  | { kind: 'single'; time: TimeOfDay }
  | { kind: 'range'; startTime: TimeOfDay; endTime: TimeOfDay; endNextDay: boolean }

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

const TIME_ATOM = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`
const WEEKDAY_PATTERN =
  'sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?'
const MONTH_PATTERN =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const TIME_LIKE_LOCATION =
  /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midday|midnight|morning|afternoon|evening|night|today|tomorrow|tonight)$/i

export function parseQuickAdd(input: string, now = new Date()): QuickAddParse {
  let working = typeof input === 'string' ? input : ''

  const consume = (
    pattern: RegExp,
    accept?: (match: RegExpExecArray) => boolean
  ): RegExpExecArray | null => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const scanner = new RegExp(pattern.source, flags)
    let match = scanner.exec(working)
    while (match) {
      if (!accept || accept(match)) {
        working = `${working.slice(0, match.index)} ${working.slice(
          match.index + match[0].length
        )}`
        return match
      }
      match = scanner.exec(working)
    }
    return null
  }

  const allDayRequested = consume(/\ball[\s-]?day\b/i) !== null

  // Recurrence phrases must be consumed before date parsing so "every monday"
  // is not read as a one-off weekday and "until 9/30" is not read as a date.
  let recurrence: QuickAddRecurrence | null = null
  const everyCount = consume(
    /\bevery\s+(\d+)\s+(days?|weeks?|months?)\b/i,
    (match) => Number(match[1]) >= 1
  )
  if (everyCount) {
    recurrence = {
      freq: recurrenceUnitFreq(everyCount[2]),
      interval: Number(everyCount[1]),
    }
  }
  if (!recurrence) {
    const everyOther = consume(/\bevery\s+other\s+(day|week|month)\b/i)
    if (everyOther) {
      recurrence = { freq: recurrenceUnitFreq(everyOther[1]), interval: 2 }
    }
  }
  if (!recurrence && consume(/\bevery\s+weekday\b/i)) {
    recurrence = { freq: 'weekly', interval: 1, byWeekdays: [1, 2, 3, 4, 5] }
  }
  if (!recurrence) {
    const weekdayList = consume(
      new RegExp(
        String.raw`\bevery\s+((?:${WEEKDAY_PATTERN})s?` +
          String.raw`(?:\s*(?:[/,+&]|and)\s*(?:${WEEKDAY_PATTERN})s?)*)\b`,
        'i'
      )
    )
    if (weekdayList) {
      recurrence = {
        freq: 'weekly',
        interval: 1,
        byWeekdays: weekdayNumbers(weekdayList[1]),
      }
    }
  }
  if (!recurrence && consume(/\b(?:every\s+day|daily)\b/i)) {
    recurrence = { freq: 'daily', interval: 1 }
  }
  if (!recurrence && consume(/\b(?:every\s+week|weekly)\b/i)) {
    recurrence = { freq: 'weekly', interval: 1 }
  }
  if (!recurrence && consume(/\b(?:every\s+month|monthly)\b/i)) {
    recurrence = { freq: 'monthly', interval: 1 }
  }

  if (recurrence) {
    let until: string | null = null
    const untilIso = consume(/\buntil\s+(\d{4})-(\d{2})-(\d{2})\b/)
    if (untilIso) {
      until = resolveUntil(
        Number(untilIso[2]),
        Number(untilIso[3]),
        Number(untilIso[1]),
        now
      )
    }
    if (!until) {
      const untilMonth = consume(
        new RegExp(
          String.raw`\buntil\s+(?:the\s+)?(${MONTH_PATTERN})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`,
          'i'
        ),
        (match) => Number(match[2]) >= 1 && Number(match[2]) <= 31
      )
      if (untilMonth) {
        until = resolveUntil(
          MONTHS[untilMonth[1].slice(0, 3).toLowerCase()],
          Number(untilMonth[2]),
          untilMonth[3] ? Number(untilMonth[3]) : null,
          now
        )
      }
    }
    if (!until) {
      const untilNumeric = consume(
        /\buntil\s+(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/i,
        (match) =>
          Number(match[1]) >= 1 &&
          Number(match[1]) <= 12 &&
          Number(match[2]) >= 1 &&
          Number(match[2]) <= 31
      )
      if (untilNumeric) {
        const rawYear = untilNumeric[3] ? Number(untilNumeric[3]) : null
        until = resolveUntil(
          Number(untilNumeric[1]),
          Number(untilNumeric[2]),
          rawYear === null ? null : rawYear < 100 ? 2000 + rawYear : rawYear,
          now
        )
      }
    }
    if (until) recurrence.until = until
  }

  let durationMinutes: number | null = null
  const duration = consume(
    /\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h|m)\b/i
  )
  if (duration) {
    const amount = Number.parseFloat(duration[1])
    durationMinutes = Math.round(
      duration[2].toLowerCase().startsWith('m') ? amount : amount * 60
    )
  }

  let timeSpec: TimeSpec | null = null

  const sidesValid = (match: RegExpExecArray): boolean =>
    validSide(rangeSide(match, 1)) && validSide(rangeSide(match, 4))
  const qualifiedRange = (match: RegExpExecArray): boolean =>
    sidesValid(match) && Boolean(match[2] || match[3] || match[5] || match[6])

  const fromRange = consume(
    new RegExp(
      String.raw`\bfrom\s+${TIME_ATOM}\s*(?:to|until|till|through|[-–—])\s*${TIME_ATOM}\b`,
      'i'
    ),
    sidesValid
  )
  if (fromRange) timeSpec = resolveRange(rangeSide(fromRange, 1), rangeSide(fromRange, 4))
  if (!timeSpec) {
    const dashRange = consume(
      new RegExp(String.raw`\b(?:at\s+)?${TIME_ATOM}\s*[-–—]\s*${TIME_ATOM}\b`, 'i'),
      qualifiedRange
    )
    if (dashRange) timeSpec = resolveRange(rangeSide(dashRange, 1), rangeSide(dashRange, 4))
  }
  if (!timeSpec) {
    const toRange = consume(
      new RegExp(
        String.raw`\b(?:at\s+)?${TIME_ATOM}\s+(?:to|until|till)\s+${TIME_ATOM}\b`,
        'i'
      ),
      qualifiedRange
    )
    if (toRange) timeSpec = resolveRange(rangeSide(toRange, 1), rangeSide(toRange, 4))
  }

  let dateSpec: DateSpec | null = null

  const monthDate = consume(
    new RegExp(
      String.raw`\b(?:on\s+)?(${MONTH_PATTERN})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`,
      'i'
    ),
    (match) => Number(match[2]) >= 1 && Number(match[2]) <= 31
  )
  if (monthDate) {
    dateSpec = {
      kind: 'explicit',
      month: MONTHS[monthDate[1].slice(0, 3).toLowerCase()],
      day: Number(monthDate[2]),
      year: monthDate[3] ? Number(monthDate[3]) : null,
    }
  }

  if (!dateSpec) {
    const numericDate = consume(
      /\b(?:on\s+)?(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b(?!\s*(?:am|pm)\b|:)/i,
      (match) =>
        Number(match[1]) >= 1 &&
        Number(match[1]) <= 12 &&
        Number(match[2]) >= 1 &&
        Number(match[2]) <= 31
    )
    if (numericDate) {
      const rawYear = numericDate[3] ? Number(numericDate[3]) : null
      dateSpec = {
        kind: 'explicit',
        month: Number(numericDate[1]),
        day: Number(numericDate[2]),
        year: rawYear === null ? null : rawYear < 100 ? 2000 + rawYear : rawYear,
      }
    }
  }

  if (!dateSpec && consume(/\btoday\b/i)) dateSpec = { kind: 'offset', days: 0 }
  if (!dateSpec && consume(/\btomorrow\b/i)) dateSpec = { kind: 'offset', days: 1 }
  if (!dateSpec && consume(/\btonight\b/i)) dateSpec = { kind: 'tonight' }

  if (!dateSpec) {
    const weekday = consume(
      new RegExp(String.raw`\b(?:on\s+)?(?:(next|this)\s+)?(${WEEKDAY_PATTERN})\b`, 'i')
    )
    if (weekday) {
      dateSpec = {
        kind: 'weekday',
        day: WEEKDAYS[weekday[2].slice(0, 3).toLowerCase()],
        next: (weekday[1] ?? '').toLowerCase() === 'next',
      }
    }
  }

  if (!timeSpec) {
    const dayPeriod = consume(
      /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s+(?:at|in\s+the)\s+(morning|afternoon|evening|night)\b/i,
      (match) =>
        Number(match[1]) >= 1 &&
        Number(match[1]) <= 12 &&
        (!match[2] || Number(match[2]) <= 59)
    )
    if (dayPeriod) {
      const hours = Number(dayPeriod[1])
      const minutes = dayPeriod[2] ? Number(dayPeriod[2]) : 0
      const period = dayPeriod[3].toLowerCase()
      const meridiem =
        period === 'morning' || (period === 'night' && hours <= 4) ? 'am' : 'pm'
      timeSpec = {
        kind: 'single',
        time: applyMeridiem({ hours, minutes, meridiem: null }, meridiem),
      }
    }
  }
  if (!timeSpec) {
    const colonTime = consume(/\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b/i, (match) => {
      const hours = Number(match[1])
      if (Number(match[2]) > 59) return false
      return match[3] ? hours >= 1 && hours <= 12 : hours <= 23
    })
    if (colonTime) {
      timeSpec = {
        kind: 'single',
        time: applyMeridiem(
          { hours: Number(colonTime[1]), minutes: Number(colonTime[2]), meridiem: null },
          colonTime[3] ? (colonTime[3].toLowerCase() as 'am' | 'pm') : null
        ),
      }
    }
  }
  if (!timeSpec) {
    const plainTime = consume(
      /\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i,
      (match) => Number(match[1]) >= 1 && Number(match[1]) <= 12
    )
    if (plainTime) {
      timeSpec = {
        kind: 'single',
        time: applyMeridiem(
          { hours: Number(plainTime[1]), minutes: 0, meridiem: null },
          plainTime[2].toLowerCase() as 'am' | 'pm'
        ),
      }
    }
  }
  if (!timeSpec) {
    const wordTime = consume(/\b(?:at\s+)?(noon|midday|midnight)\b/i)
    if (wordTime) {
      timeSpec = {
        kind: 'single',
        time:
          wordTime[1].toLowerCase() === 'midnight'
            ? { hours: 0, minutes: 0 }
            : { hours: 12, minutes: 0 },
      }
    }
  }

  let location: string | null = null
  const locationScanner = /(?:^|[\s,])(?:at\s+|@\s*)/gi
  const anchors: Array<{ index: number; length: number }> = []
  let anchor = locationScanner.exec(working)
  while (anchor) {
    anchors.push({ index: anchor.index, length: anchor[0].length })
    anchor = locationScanner.exec(working)
  }
  for (let index = anchors.length - 1; index >= 0; index -= 1) {
    const candidate = cleanFragment(
      working.slice(anchors[index].index + anchors[index].length)
    )
    if (candidate && !TIME_LIKE_LOCATION.test(candidate)) {
      location = candidate
      working = working.slice(0, anchors[index].index)
      break
    }
  }

  const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
  const primaryTime =
    timeSpec === null ? null : timeSpec.kind === 'single' ? timeSpec.time : timeSpec.startTime

  // A recurrence with no explicit date still deserves a concrete first
  // occurrence: the soonest listed weekday, or today for daily/monthly
  // phrases with no time (a timed phrase already resolves to the next slot).
  if (!dateSpec && recurrence) {
    const byWeekdays = recurrence.byWeekdays ?? []
    if (byWeekdays.length > 0) {
      dateSpec = {
        kind: 'weekday',
        day: soonestWeekday(byWeekdays, primaryTime, now),
        next: false,
      }
    } else if (timeSpec === null) {
      dateSpec = { kind: 'offset', days: 0 }
    }
  }

  let start: Date | null = null
  let end: Date | null = null
  let allDay = false

  if (
    allDayRequested ||
    (dateSpec !== null && dateSpec.kind !== 'tonight' && timeSpec === null)
  ) {
    const day = dateSpec ? resolveDay(dateSpec, null, now) : today
    if (day) {
      start = new Date(day.year, day.month, day.day)
      allDay = true
    }
  } else if (timeSpec !== null || dateSpec !== null) {
    const time = primaryTime ?? { hours: 20, minutes: 0 }
    let day: { year: number; month: number; day: number } | null
    if (dateSpec) {
      day = resolveDay(dateSpec, time, now)
    } else {
      day = today
      const candidate = new Date(day.year, day.month, day.day, time.hours, time.minutes)
      if (candidate.getTime() <= now.getTime()) {
        day = { ...day, day: day.day + 1 }
      }
    }
    if (day) {
      start = new Date(day.year, day.month, day.day, time.hours, time.minutes)
      if (timeSpec !== null && timeSpec.kind === 'range') {
        end = new Date(
          day.year,
          day.month,
          day.day + (timeSpec.endNextDay ? 1 : 0),
          timeSpec.endTime.hours,
          timeSpec.endTime.minutes
        )
      } else if (durationMinutes !== null) {
        end = new Date(start.getTime() + durationMinutes * MINUTE_MS)
      } else {
        end = new Date(start.getTime() + HOUR_MS)
      }
    }
  }

  const title = cleanFragment(working)
  const confidence: QuickAddParse['confidence'] =
    title && start !== null ? 'high' : title || start !== null ? 'partial' : 'none'
  return { title, start, end, allDay, location, confidence, recurrence }
}

function resolveDay(
  spec: DateSpec,
  time: TimeOfDay | null,
  now: Date
): { year: number; month: number; day: number } | null {
  const base = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
  if (spec.kind === 'offset') return { ...base, day: base.day + spec.days }
  if (spec.kind === 'tonight') return base
  if (spec.kind === 'weekday') {
    let delta = (spec.day - now.getDay() + 7) % 7
    if (delta === 0) {
      const laterToday =
        !spec.next &&
        time !== null &&
        new Date(base.year, base.month, base.day, time.hours, time.minutes).getTime() >
          now.getTime()
      delta = laterToday ? 0 : 7
    }
    return { ...base, day: base.day + delta }
  }
  const month = spec.month - 1
  if (spec.year !== null) {
    const candidate = new Date(spec.year, month, spec.day)
    return candidate.getMonth() === month
      ? { year: spec.year, month, day: spec.day }
      : null
  }
  let year = now.getFullYear()
  const candidate = new Date(year, month, spec.day)
  if (candidate.getMonth() !== month) return null
  if (new Date(year, month, spec.day + 1).getTime() <= now.getTime()) year += 1
  return { year, month, day: spec.day }
}

function recurrenceUnitFreq(unit: string): QuickAddRecurrence['freq'] {
  const normalized = unit.toLowerCase()
  if (normalized.startsWith('day')) return 'daily'
  if (normalized.startsWith('week')) return 'weekly'
  return 'monthly'
}

function weekdayNumbers(value: string): number[] {
  const days = new Set<number>()
  const scanner = new RegExp(WEEKDAY_PATTERN, 'gi')
  let match = scanner.exec(value)
  while (match) {
    days.add(WEEKDAYS[match[0].slice(0, 3).toLowerCase()])
    match = scanner.exec(value)
  }
  return [...days].sort((left, right) => left - right)
}

function soonestWeekday(
  days: number[],
  time: TimeOfDay | null,
  now: Date
): number {
  let best = days[0]
  let bestDelta = Number.POSITIVE_INFINITY
  for (const day of days) {
    let delta = (day - now.getDay() + 7) % 7
    if (delta === 0) {
      const laterToday =
        time !== null &&
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          time.hours,
          time.minutes
        ).getTime() > now.getTime()
      if (!laterToday) delta = 7
    }
    if (delta < bestDelta) {
      bestDelta = delta
      best = day
    }
  }
  return best
}

function resolveUntil(
  month: number,
  day: number,
  year: number | null,
  now: Date
): string | null {
  const monthIndex = month - 1
  if (year !== null) {
    const candidate = new Date(year, monthIndex, day)
    return candidate.getMonth() === monthIndex
      ? untilDateKey(year, monthIndex, day)
      : null
  }
  let resolved = now.getFullYear()
  if (new Date(resolved, monthIndex, day).getMonth() !== monthIndex) return null
  if (new Date(resolved, monthIndex, day + 1).getTime() <= now.getTime()) {
    resolved += 1
  }
  return untilDateKey(resolved, monthIndex, day)
}

function untilDateKey(year: number, monthIndex: number, day: number): string {
  const month = `${monthIndex + 1}`.padStart(2, '0')
  return `${year}-${month}-${`${day}`.padStart(2, '0')}`
}

function rangeSide(match: RegExpExecArray, offset: number): RangeSide {
  return {
    hours: Number(match[offset]),
    minutes: match[offset + 1] ? Number(match[offset + 1]) : 0,
    meridiem: match[offset + 2]
      ? (match[offset + 2].toLowerCase() as 'am' | 'pm')
      : null,
  }
}

function validSide(side: RangeSide): boolean {
  if (side.minutes > 59) return false
  if (side.meridiem) return side.hours >= 1 && side.hours <= 12
  return side.hours <= 23
}

function guessMeridiem(hours: number): 'am' | 'pm' | null {
  if (hours >= 1 && hours <= 7) return 'pm'
  if (hours >= 8 && hours <= 11) return 'am'
  return null
}

function applyMeridiem(side: RangeSide, meridiem: 'am' | 'pm' | null): TimeOfDay {
  if (!meridiem || side.hours > 12) {
    return { hours: side.hours === 24 ? 0 : side.hours, minutes: side.minutes }
  }
  if (meridiem === 'am') {
    return { hours: side.hours === 12 ? 0 : side.hours, minutes: side.minutes }
  }
  return { hours: side.hours === 12 ? 12 : side.hours + 12, minutes: side.minutes }
}

function minutesOfDay(time: TimeOfDay): number {
  return time.hours * 60 + time.minutes
}

function resolveRange(first: RangeSide, second: RangeSide): TimeSpec {
  const firstMeridiem = first.meridiem ?? second.meridiem ?? guessMeridiem(first.hours)
  const secondMeridiem = second.meridiem ?? first.meridiem ?? guessMeridiem(second.hours)
  let startTime = applyMeridiem(first, firstMeridiem)
  let endTime = applyMeridiem(second, secondMeridiem)
  if (
    !first.meridiem &&
    first.hours <= 12 &&
    minutesOfDay(startTime) >= minutesOfDay(endTime)
  ) {
    const flipped = applyMeridiem(first, firstMeridiem === 'pm' ? 'am' : 'pm')
    if (minutesOfDay(flipped) < minutesOfDay(endTime)) startTime = flipped
  } else if (
    !second.meridiem &&
    second.hours <= 12 &&
    minutesOfDay(endTime) <= minutesOfDay(startTime)
  ) {
    const flipped = applyMeridiem(second, secondMeridiem === 'pm' ? 'am' : 'pm')
    if (minutesOfDay(flipped) > minutesOfDay(startTime)) endTime = flipped
  }
  return {
    kind: 'range',
    startTime,
    endTime,
    endNextDay: minutesOfDay(endTime) < minutesOfDay(startTime),
  }
}

function cleanFragment(value: string): string {
  let result = value.replace(/\s+/g, ' ').trim()
  let previous = ''
  while (result !== previous) {
    previous = result
    result = result
      .replace(/^[\s,.;:–—-]+/, '')
      .replace(/[\s,.;:–—-]+$/, '')
      .replace(/\s+(?:on|at|from)$/i, '')
      .replace(/^(?:on|at|from)$/i, '')
  }
  return result
}
