import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import { getDesktopBridge } from '../desktop'

export interface AssistantCalendarEventTime {
  allDay: boolean
  date?: string
  dateTime?: string
  timeZone?: string | null
}

export interface AssistantCalendarEvent {
  id: string | null
  title: string
  start: AssistantCalendarEventTime
  end: AssistantCalendarEventTime
  location: string | null
  organizer: string | null
  attendees: Array<{
    email: string
    responseStatus: string | null
    self: boolean
  }>
  source?: 'google' | 'subscription'
  calendarId?: string
  calendarName?: string
}

interface CalendarEventsResult {
  provider: 'google' | 'combined' | 'subscription'
  calendar: 'primary' | 'multiple'
  start: string
  end: string
  events: AssistantCalendarEvent[]
}

const functions = getFunctions(firebaseApp, 'us-central1')
const listCalendarEventsCall = httpsCallable<
  { start: string; end: string; limit?: number },
  CalendarEventsResult
>(functions, 'listAssistantCalendarEvents')

export async function listAssistantCalendarEvents(
  start: string,
  end: string,
  limit = 100
): Promise<CalendarEventsResult> {
  const bridge = getDesktopBridge()
  const requests: Array<Promise<AssistantCalendarEvent[]>> = [
    listCalendarEventsCall({ start, end, limit }).then(({ data }) =>
      data.events.map((event) => ({ ...event, source: 'google' as const }))
    ),
  ]
  if (bridge?.calendarFeeds) {
    requests.push(
      bridge.calendarFeeds
        .events(start, end, limit)
        .then((result) => result.events)
    )
  }
  const settled = await Promise.allSettled(requests)
  const events = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )
  if (
    events.length === 0 &&
    settled.every((result) => result.status === 'rejected')
  ) {
    const first = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    throw first?.reason ?? new Error('No connected calendar could be read.')
  }
  events.sort((left, right) =>
    eventStart(left).localeCompare(eventStart(right))
  )
  return {
    provider:
      requests.length > 1
        ? 'combined'
        : bridge?.calendarFeeds
          ? 'subscription'
          : 'google',
    calendar: requests.length > 1 ? 'multiple' : 'primary',
    start,
    end,
    events: events.slice(0, limit),
  }
}

function eventStart(event: AssistantCalendarEvent): string {
  return event.start.dateTime || `${event.start.date || ''}T00:00:00Z`
}
