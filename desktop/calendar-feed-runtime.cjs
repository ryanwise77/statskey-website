'use strict'

const MAX_FEED_BYTES = 4 * 1024 * 1024
const DAY_MS = 86_400_000
const MAX_CANDIDATE_STEPS = 1000
const MAX_EXPANSION_WINDOW_MS = 3 * 365 * DAY_MS
const WEEKDAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function validateCalendarFeedUrl(rawUrl) {
  let url
  try {
    url = new URL(String(rawUrl || '').trim().replace(/^webcal:/i, 'https:'))
  } catch {
    throw new Error('Enter a valid private calendar URL.')
  }
  if (url.protocol !== 'https:') {
    throw new Error('Calendar subscriptions must use HTTPS.')
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Private-network calendar URLs are not allowed.')
  }
  url.username = ''
  url.password = ''
  return url.toString()
}

async function fetchCalendarFeed(rawUrl, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Calendar feeds are unavailable in this build.')
  }
  let url = validateCalendarFeedUrl(rawUrl)
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    let response
    try {
      response = await fetchImpl(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1',
          'User-Agent': 'StatsKey-Desktop-Calendar/1.0',
        },
      })
    } finally {
      clearTimeout(timeout)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('The calendar feed redirected without a destination.')
      url = validateCalendarFeedUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) {
      throw new Error(`The calendar feed returned HTTP ${response.status}.`)
    }
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > MAX_FEED_BYTES) throw new Error('The calendar feed is too large.')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_FEED_BYTES) throw new Error('The calendar feed is too large.')
    return bytes.toString('utf8')
  }
  throw new Error('The calendar feed redirected too many times.')
}

function parseCalendarFeedEvents(contents, rangeStart, rangeEnd, maximum = 250) {
  const startBoundary = new Date(rangeStart)
  const endBoundary = new Date(rangeEnd)
  if (
    !Number.isFinite(startBoundary.getTime()) ||
    !Number.isFinite(endBoundary.getTime()) ||
    endBoundary <= startBoundary
  ) {
    throw new Error('Choose a valid calendar date range.')
  }
  const cap = Math.min(500, Math.max(1, maximum))
  const lines = unfoldCalendarLines(String(contents || ''))
  const rawEvents = []
  let current = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (current) rawEvents.push(current)
      current = null
      continue
    }
    if (!current) continue
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const rawKey = line.slice(0, separator)
    const value = line.slice(separator + 1)
    const [key, ...parameters] = rawKey.split(';')
    if (key === 'EXDATE') {
      if (!current.EXDATE) current.EXDATE = []
      current.EXDATE.push({ value, parameters })
      continue
    }
    if (
      !['UID', 'SUMMARY', 'DTSTART', 'DTEND', 'LOCATION', 'ORGANIZER', 'RRULE', 'RECURRENCE-ID'].includes(key)
    ) {
      continue
    }
    current[key] = { value, parameters }
  }

  const overrides = new Map()
  const masters = []
  for (const raw of rawEvents) {
    const uid = cleanText(raw.UID?.value)
    if (raw['RECURRENCE-ID'] && uid) {
      const slot = parseCalendarDate(raw['RECURRENCE-ID'])
      const decoded = decodeEvent(raw)
      if (slot && decoded) {
        overrides.set(`${uid}|${slot.date.getTime()}`, {
          decoded,
          slotMs: slot.date.getTime(),
          consumed: false,
        })
      }
      continue
    }
    masters.push(raw)
  }

  const events = []
  for (const raw of masters) {
    if (events.length >= cap) break
    const decoded = decodeEvent(raw)
    if (!decoded) continue
    const rule = raw.RRULE ? parseRecurrenceRule(raw.RRULE.value) : null
    if (!rule) {
      if (decoded.startDate < endBoundary && decoded.endDate > startBoundary) {
        events.push(decoded.event)
      }
      continue
    }
    expandRecurringEvent({
      decoded,
      rule,
      exdates: collectExceptionDates(raw.EXDATE),
      overrides,
      uid: cleanText(raw.UID?.value) || null,
      startBoundary,
      endBoundary,
      events,
      cap,
    })
  }

  for (const override of overrides.values()) {
    if (events.length >= cap) break
    if (override.consumed) continue
    const { decoded, slotMs } = override
    if (decoded.startDate < endBoundary && decoded.endDate > startBoundary) {
      events.push({
        ...decoded.event,
        id: `${decoded.event.id || 'recurring'}::${new Date(slotMs).toISOString()}`,
      })
    }
  }

  return events.sort((left, right) =>
    eventTime(left.start).localeCompare(eventTime(right.start))
  )
}

function parseRecurrenceRule(value) {
  const fields = {}
  for (const part of String(value || '').trim().split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    fields[part.slice(0, separator).toUpperCase()] = part.slice(separator + 1).trim()
  }
  const freq = String(fields.FREQ || '').toUpperCase()
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const interval = Number.parseInt(fields.INTERVAL, 10)
  const count = Number.parseInt(fields.COUNT, 10)
  const rule = {
    freq,
    interval: Number.isFinite(interval) && interval >= 1 ? interval : 1,
    count: Number.isFinite(count) && count >= 1 ? count : null,
    until: null,
    byWeekdays: null,
    byMonthday: null,
  }
  if (fields.UNTIL) {
    if (/^\d{8}$/.test(fields.UNTIL)) {
      const parsed = parseCalendarDate({ value: fields.UNTIL, parameters: ['VALUE=DATE'] })
      if (parsed) rule.until = new Date(parsed.date.getTime() + DAY_MS - 1)
    } else {
      const parsed = parseCalendarDate({ value: fields.UNTIL, parameters: [] })
      if (parsed) rule.until = parsed.date
    }
  }
  if (fields.BYDAY) {
    const weekdays = []
    for (const token of fields.BYDAY.split(',')) {
      const code = token.trim().toUpperCase().replace(/^[+-]?\d+/, '')
      if (code in WEEKDAY_CODES) weekdays.push(WEEKDAY_CODES[code])
    }
    if (weekdays.length > 0) rule.byWeekdays = [...new Set(weekdays)]
  }
  if (fields.BYMONTHDAY) {
    const day = Number.parseInt(fields.BYMONTHDAY.split(',')[0], 10)
    if (Number.isFinite(day) && day >= 1 && day <= 31) rule.byMonthday = day
  }
  return rule
}

function collectExceptionDates(fields) {
  const removed = new Set()
  for (const field of fields || []) {
    for (const part of String(field.value || '').split(',')) {
      const value = part.trim()
      if (!value) continue
      const parsed = parseCalendarDate({ value, parameters: field.parameters })
      if (parsed) removed.add(parsed.date.getTime())
    }
  }
  return removed
}

function expandRecurringEvent(context) {
  const { decoded, rule, exdates, overrides, uid, startBoundary, endBoundary, events, cap } = context
  const dtstartMs = decoded.startDate.getTime()
  const durationMs = Math.max(0, decoded.endDate.getTime() - dtstartMs)
  const idBase = decoded.event.id || 'recurring'
  const stopAt = Math.min(
    endBoundary.getTime(),
    Math.max(startBoundary.getTime(), dtstartMs) + MAX_EXPANSION_WINDOW_MS
  )
  const untilMs = rule.until ? rule.until.getTime() : Infinity
  const CONTINUE = 0
  const STOP = 1
  let produced = 0
  let steps = 0

  const visit = (slotMs) => {
    if (slotMs >= stopAt || slotMs > untilMs) return STOP
    if (rule.count !== null && produced >= rule.count) return STOP
    produced += 1
    if (exdates.has(slotMs)) return CONTINUE
    const slotIso = new Date(slotMs).toISOString()
    const override = uid ? overrides.get(`${uid}|${slotMs}`) : null
    if (override) {
      override.consumed = true
      const replacement = override.decoded
      if (replacement.startDate < endBoundary && replacement.endDate > startBoundary) {
        events.push({ ...replacement.event, id: `${idBase}::${slotIso}` })
      }
      return events.length >= cap ? STOP : CONTINUE
    }
    if (slotMs + durationMs > startBoundary.getTime()) {
      events.push({
        ...decoded.event,
        id: `${idBase}::${slotIso}`,
        start: calendarTime({
          date: new Date(slotMs),
          allDay: decoded.event.start.allDay,
          timeZone: decoded.event.start.timeZone,
        }),
        end: calendarTime({
          date: new Date(slotMs + durationMs),
          allDay: decoded.event.end.allDay,
          timeZone: decoded.event.end.timeZone,
        }),
      })
    }
    return events.length >= cap ? STOP : CONTINUE
  }

  if (rule.freq === 'DAILY' || (rule.freq === 'WEEKLY' && !rule.byWeekdays)) {
    const stepMs = (rule.freq === 'DAILY' ? 1 : 7) * rule.interval * DAY_MS
    let slotMs = dtstartMs
    if (rule.count === null) {
      const lead = startBoundary.getTime() - durationMs - slotMs
      if (lead > 0) slotMs += Math.floor(lead / stepMs) * stepMs
    }
    for (; steps < MAX_CANDIDATE_STEPS; steps += 1, slotMs += stepMs) {
      if (visit(slotMs) === STOP) break
    }
    return
  }

  if (rule.freq === 'WEEKLY') {
    const weekMs = 7 * DAY_MS
    const weekAnchorMs = dtstartMs - decoded.startDate.getUTCDay() * DAY_MS
    let cursorMs = dtstartMs
    if (rule.count === null) {
      const intervalMs = rule.interval * weekMs
      const lead = startBoundary.getTime() - durationMs - cursorMs
      if (lead > 0) cursorMs += Math.floor(lead / intervalMs) * intervalMs
    }
    for (; steps < MAX_CANDIDATE_STEPS; steps += 1, cursorMs += DAY_MS) {
      if (cursorMs >= stopAt) break
      const weekday = new Date(cursorMs).getUTCDay()
      if (!rule.byWeekdays.includes(weekday)) continue
      const weekIndex = Math.round((cursorMs - weekday * DAY_MS - weekAnchorMs) / weekMs)
      if (weekIndex % rule.interval !== 0) continue
      if (visit(cursorMs) === STOP) break
    }
    return
  }

  if (rule.freq === 'MONTHLY') {
    const monthday = rule.byMonthday || decoded.startDate.getUTCDate()
    const baseYear = decoded.startDate.getUTCFullYear()
    const baseMonth = decoded.startDate.getUTCMonth()
    const timeOfDayMs = dtstartMs - Date.UTC(baseYear, baseMonth, decoded.startDate.getUTCDate())
    for (let k = 0; steps < MAX_CANDIDATE_STEPS; steps += 1, k += 1) {
      const monthIndex = baseMonth + k * rule.interval
      if (Date.UTC(baseYear, monthIndex, 1) + timeOfDayMs >= stopAt) break
      const daysInMonth = new Date(Date.UTC(baseYear, monthIndex + 1, 0)).getUTCDate()
      if (monthday > daysInMonth) continue
      const slotMs = Date.UTC(baseYear, monthIndex, monthday) + timeOfDayMs
      if (slotMs < dtstartMs) continue
      if (visit(slotMs) === STOP) break
    }
    return
  }

  const month = decoded.startDate.getUTCMonth()
  const day = decoded.startDate.getUTCDate()
  const baseYear = decoded.startDate.getUTCFullYear()
  const timeOfDayMs = dtstartMs - Date.UTC(baseYear, month, day)
  for (let k = 0; steps < MAX_CANDIDATE_STEPS; steps += 1, k += 1) {
    const year = baseYear + k * rule.interval
    if (Date.UTC(year, month, 1) + timeOfDayMs >= stopAt) break
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    if (day > daysInMonth) continue
    if (visit(Date.UTC(year, month, day) + timeOfDayMs) === STOP) break
  }
}

function unfoldCalendarLines(contents) {
  const source = contents.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines = []
  for (const line of source) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line.trimEnd())
    }
  }
  return lines
}

function decodeEvent(fields) {
  const start = parseCalendarDate(fields.DTSTART)
  if (!start) return null
  const end = parseCalendarDate(fields.DTEND) || {
    date: new Date(start.date.getTime() + (start.allDay ? 86_400_000 : 3_600_000)),
    allDay: start.allDay,
    timeZone: start.timeZone,
  }
  return {
    startDate: start.date,
    endDate: end.date,
    event: {
      id: cleanText(fields.UID?.value) || null,
      title: cleanText(fields.SUMMARY?.value) || '(Untitled event)',
      start: calendarTime(start),
      end: calendarTime(end),
      location: cleanText(fields.LOCATION?.value) || null,
      organizer: cleanOrganizer(fields.ORGANIZER?.value) || null,
      attendees: [],
      source: 'subscription',
    },
  }
}

function parseCalendarDate(field) {
  if (!field?.value) return null
  const raw = field.value.trim()
  const allDay = field.parameters.some((item) => item.toUpperCase() === 'VALUE=DATE') || /^\d{8}$/.test(raw)
  const timeZoneParameter = field.parameters.find((item) => item.toUpperCase().startsWith('TZID='))
  const timeZone = timeZoneParameter ? timeZoneParameter.slice(5).replace(/^"|"$/g, '') : null
  let iso
  if (/^\d{8}$/.test(raw)) {
    iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`
  } else if (/^\d{8}T\d{6}Z$/.test(raw)) {
    iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
  } else if (/^\d{8}T\d{6}$/.test(raw)) {
    iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}`
  } else {
    iso = raw
  }
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? { date, allDay, timeZone } : null
}

function calendarTime(value) {
  if (value.allDay) {
    return {
      allDay: true,
      date: value.date.toISOString().slice(0, 10),
      timeZone: value.timeZone,
    }
  }
  return {
    allDay: false,
    dateTime: value.date.toISOString(),
    timeZone: value.timeZone,
  }
}

function eventTime(value) {
  return value.dateTime || `${value.date || ''}T00:00:00.000Z`
}

function cleanText(value) {
  return String(value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

function cleanOrganizer(value) {
  return cleanText(value).replace(/^mailto:/i, '')
}

module.exports = {
  fetchCalendarFeed,
  parseCalendarFeedEvents,
  validateCalendarFeedUrl,
}
