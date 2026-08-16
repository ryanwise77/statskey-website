import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionInbox } from '../components/assistant/ActionInbox'
import { useAuth } from '../lib/auth'
import { AGENT_PREFILL_EVENT } from '../lib/desktop'
import { getDesktopBridge } from '../lib/desktop'
import {
  listAssistantCalendarEvents,
  type AssistantCalendarEvent,
} from '../lib/assistant/calendar'
import { useGoogleAssistantConnection } from '../lib/assistant/connections'
import { useAssistantActions } from '../lib/data/useAssistantActions'
import {
  useActiveMealPlan,
  useActiveTrainingPlan,
  useMealCalendar,
} from '../lib/data/usePlanning'

type PlanningTab =
  | 'calendar'
  | 'meals'
  | 'fitness'
  | 'email'
  | 'approvals'

const TABS: Array<{ id: PlanningTab; label: string }> = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'meals', label: 'Meals' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'email', label: 'Email' },
  { id: 'approvals', label: 'Approvals' },
]

export function Planning() {
  const { user } = useAuth()
  const uid = user?.uid
  const navigate = useNavigate()
  const [tab, setTab] = useState<PlanningTab>('calendar')
  const [anchor, setAnchor] = useState(startOfWeek(new Date()))
  const [calendarEvents, setCalendarEvents] = useState<
    AssistantCalendarEvent[]
  >([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [portableCalendarCount, setPortableCalendarCount] = useState(0)
  const connection = useGoogleAssistantConnection(uid)
  const actions = useAssistantActions(uid, 30)
  const mealCalendar = useMealCalendar(
    uid,
    dateKey(anchor),
    dateKey(addDays(anchor, 6))
  )
  const mealPlan = useActiveMealPlan(uid)
  const trainingPlan = useActiveTrainingPlan(uid)
  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => addDays(anchor, index)),
    [anchor]
  )
  const weekEnd = addDays(anchor, 7)
  const calendarReadable =
    (connection.connection?.status === 'connected' &&
      connection.connection.capabilities.includes('calendarRead')) ||
    portableCalendarCount > 0

  useEffect(() => {
    const feeds = getDesktopBridge()?.calendarFeeds
    if (!feeds) return
    void feeds
      .list()
      .then((items) => setPortableCalendarCount(items.length))
      .catch(() => setPortableCalendarCount(0))
  }, [])

  useEffect(() => {
    setCalendarEvents([])
    setCalendarError(null)
  }, [anchor])

  async function refreshCalendar() {
    if (!calendarReadable) return
    setCalendarLoading(true)
    setCalendarError(null)
    try {
      const result = await listAssistantCalendarEvents(
        anchor.toISOString(),
        weekEnd.toISOString(),
        100
      )
      setCalendarEvents(result.events)
    } catch (error) {
      setCalendarError(
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      setCalendarLoading(false)
    }
  }

  function openAgent(prompt: string) {
    navigate('/flow')
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(AGENT_PREFILL_EVENT, {
          detail: { text: prompt },
        })
      )
    }, 0)
  }

  const mealDays = new Map(
    mealCalendar.value.map((day) => [day.dateKey, day])
  )
  const fitnessDays = trainingDaysForWeek(trainingPlan.value, anchor)

  return (
    <div className="planning-page">
      <header className="planning-page__header">
        <div>
          <span>Personal planning</span>
          <h1>Plan</h1>
          <p>
            Calendar, meals, fitness, and communications—kept separate from
            project work unless you explicitly ask to connect them.
          </p>
        </div>
        <div>
          <button
            className="btn btn-secondary"
            onClick={() => setAnchor(addDays(anchor, -7))}
          >
            Previous
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setAnchor(startOfWeek(new Date()))}
          >
            This week
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setAnchor(addDays(anchor, 7))}
          >
            Next
          </button>
        </div>
      </header>

      <section className="planning-boundary">
        <b>Private planning boundary</b>
        <span>
          Project files are excluded here. Calendar and inbox reads happen only
          when requested; nothing is sent or scheduled without an exact action
          approval.
        </span>
        <Link to="/workspace">Open work workspace</Link>
      </section>

      <nav className="planning-tabs" aria-label="Planning sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'approvals' && actions.pendingCount > 0 && (
              <i>{actions.pendingCount}</i>
            )}
          </button>
        ))}
      </nav>

      {tab === 'calendar' && (
        <section className="planning-panel">
          <PanelHeading
            eyebrow={weekLabel(anchor)}
            title="Calendar"
            action={
              calendarReadable ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => void refreshCalendar()}
                  disabled={calendarLoading}
                >
                  {calendarLoading ? 'Refreshing…' : 'Read calendar'}
                </button>
              ) : (
                <Link className="btn btn-secondary" to="/profile">
                  Connect calendar
                </Link>
              )
            }
          />
          {calendarError && <div className="error-banner">{calendarError}</div>}
          <div className="planning-week">
            {week.map((date) => (
              <PlanningDay
                key={dateKey(date)}
                date={date}
                events={eventsForDay(calendarEvents, date)}
                meals={mealDays.get(dateKey(date))?.meals ?? []}
                fitness={fitnessDays.get(dateKey(date)) ?? []}
              />
            ))}
          </div>
          <div className="planning-actions">
            <button
              className="btn btn-primary"
              onClick={() =>
                openAgent(
                  `Review my calendar, active meal plan, and active fitness plan for ${weekLabel(
                    anchor
                  )}. Identify conflicts and propose a balanced week. Do not schedule or send anything without an exact approval.`
                )
              }
            >
              Plan this week with Intelligence
            </button>
          </div>
          <Link className="planning-secondary-link" to="/calendar">
            Open full calendar →
          </Link>
        </section>
      )}

      {tab === 'meals' && (
        <section className="planning-panel">
          <PanelHeading
            eyebrow="Nutrition planning"
            title={mealPlan.value ? 'Active meal plan' : 'No active meal plan'}
            action={
              <button
                className="btn btn-primary"
                onClick={() =>
                  openAgent(
                    'Build or refine my meal plan using my current nutrition targets, dietary profile, recorded food history, and active fitness plan. Prepare a reviewable proposal; do not record meals or change my calendar without approval.'
                  )
                }
              >
                {mealPlan.value ? 'Refine with Intelligence' : 'Build with Intelligence'}
              </button>
            }
          />
          {mealPlan.error && <div className="error-banner">{mealPlan.error}</div>}
          {mealPlan.loading ? (
            <p className="planning-empty">Loading meal plan…</p>
          ) : mealPlan.value ? (
            <>
              <p className="planning-summary">{mealPlan.value.summary}</p>
              <div className="planning-plan-days">
                {mealPlan.value.days.map((day) => (
                  <article key={day.id}>
                    <header>
                      <b>{day.dayLabel}</b>
                      <span>{day.meals.length} meals</span>
                    </header>
                    {day.coachNote && <p>{day.coachNote}</p>}
                    <ul>
                      {day.meals.map((meal) => (
                        <li key={meal.id}>
                          <span>{meal.slot}</span>
                          <b>{meal.title}</b>
                          {meal.calories > 0 && (
                            <small>{Math.round(meal.calories)} cal</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="planning-empty">
              Create the plan in Agent or on iOS. Plans remain drafts until you
              explicitly apply them.
            </p>
          )}
        </section>
      )}

      {tab === 'fitness' && (
        <section className="planning-panel">
          <PanelHeading
            eyebrow="Fitness planning"
            title={
              trainingPlan.value
                ? `${trainingPlan.value.durationWeeks}-week active plan`
                : 'No active fitness plan'
            }
            action={
              <button
                className="btn btn-primary"
                onClick={() =>
                  openAgent(
                    'Build or refine my fitness plan using my current goals, recent workouts, readiness, health constraints, and meal fueling needs. Prepare a reviewable plan and do not alter my calendar without approval.'
                  )
                }
              >
                {trainingPlan.value ? 'Refine with Intelligence' : 'Build with Intelligence'}
              </button>
            }
          />
          {trainingPlan.error && (
            <div className="error-banner">{trainingPlan.error}</div>
          )}
          {trainingPlan.loading ? (
            <p className="planning-empty">Loading fitness plan…</p>
          ) : trainingPlan.value ? (
            <>
              <p className="planning-summary">{trainingPlan.value.summary}</p>
              <div className="planning-training-weeks">
                {trainingPlan.value.weeks.slice(0, 4).map((weekItem) => (
                  <article key={weekItem.id}>
                    <header>
                      <div>
                        <span>Week {weekItem.weekNumber}</span>
                        <b>{weekItem.theme || 'Fitness block'}</b>
                      </div>
                      <strong>
                        {weekItem.totalMileage > 0
                          ? `${weekItem.totalMileage.toFixed(1)} mi`
                          : weekItem.recovery
                            ? 'Recovery'
                            : ''}
                      </strong>
                    </header>
                    <div>
                      {weekItem.days.map((day) => (
                        <div key={day.id} data-complete={day.completed}>
                          <span>{day.dayName.slice(0, 3)}</span>
                          <b>{day.workoutType}</b>
                          <small>
                            {day.distance
                              ? `${day.distance.toFixed(1)} mi`
                              : day.duration || (day.rest ? 'Rest' : '')}
                          </small>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="planning-empty">
              Start with Intelligence or the iOS Fitness Planner. Confirmation remains
              separate from plan generation.
            </p>
          )}
          <Link className="planning-secondary-link" to="/routes">
            Open Route Builder →
          </Link>
        </section>
      )}

      {tab === 'email' && (
        <section className="planning-panel">
          <PanelHeading
            eyebrow="Communications"
            title="Email Agent"
            action={
              connection.connection?.status === 'connected' ? (
                <Link className="btn btn-secondary" to="/profile">
                  Manage access
                </Link>
              ) : (
                <Link className="btn btn-primary" to="/profile">
                  Connect Gmail
                </Link>
              )
            }
          />
          <div className="planning-email-privacy">
            <b>Inbox privacy by default</b>
            <p>
              StatsKey reads only the messages needed for the task you request.
              Requested content is treated as untrusted, may be processed by
              your selected Intelligence provider, is not placed into project
              workspaces or saved chat history, and every send requires a
              payload-bound approval.
            </p>
            <ul>
              <li>
                Inbox read:{' '}
                {connection.connection?.capabilities.includes('emailRead')
                  ? 'enabled'
                  : 'off'}
              </li>
              <li>
                Send:{' '}
                {connection.connection?.capabilities.includes('email')
                  ? 'approval-bound'
                  : 'off'}
              </li>
            </ul>
          </div>
          <div className="planning-actions">
            <button
              className="btn btn-primary"
              disabled={
                !connection.connection?.capabilities.includes('emailRead')
              }
              onClick={() =>
                openAgent(
                  'Triage my unread email. Identify only messages that require action, summarize the exact ask and deadline, and prepare replies as approvals. Do not mark messages read or send anything automatically.'
                )
              }
            >
              Triage unread mail
            </button>
            <button
              className="btn btn-secondary"
              onClick={() =>
                openAgent(
                  'Help me draft a privacy-conscious email. Ask for every missing recipient, subject, and factual detail, then prepare the exact message as an approval only.'
                )
              }
            >
              Draft an email
            </button>
          </div>
        </section>
      )}

      {tab === 'approvals' && (
        <ActionInbox
          actions={actions.actions}
          loading={actions.loading}
          error={actions.error}
        />
      )}
    </div>
  )
}

function PanelHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string
  title: string
  action: ReactNode
}) {
  return (
    <header className="planning-panel__heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </header>
  )
}

function PlanningDay({
  date,
  events,
  meals,
  fitness,
}: {
  date: Date
  events: AssistantCalendarEvent[]
  meals: Array<{ id: string; slot: string; title: string }>
  fitness: Array<{ id: string; workoutType: string; detail: string }>
}) {
  return (
    <article className="planning-day" data-today={isToday(date)}>
      <header>
        <span>{date.toLocaleDateString([], { weekday: 'short' })}</span>
        <b>{date.getDate()}</b>
      </header>
      <div>
        {events.map((event) => (
          <div key={event.id || `${event.title}-${event.start.dateTime}`}>
            <i data-kind="calendar" />
            <span>
              <b>{event.title}</b>
              <small>{eventTime(event)}</small>
            </span>
          </div>
        ))}
        {fitness.map((item) => (
          <div key={item.id}>
            <i data-kind="fitness" />
            <span>
              <b>{item.workoutType}</b>
              <small>{item.detail}</small>
            </span>
          </div>
        ))}
        {meals.map((meal) => (
          <div key={meal.id}>
            <i data-kind="meal" />
            <span>
              <b>{meal.title}</b>
              <small>{meal.slot}</small>
            </span>
          </div>
        ))}
        {events.length + meals.length + fitness.length === 0 && (
          <p>Open</p>
        )}
      </div>
    </article>
  )
}

function trainingDaysForWeek(
  plan: ReturnType<typeof useActiveTrainingPlan>['value'],
  weekStart: Date
) {
  const result = new Map<
    string,
    Array<{ id: string; workoutType: string; detail: string }>
  >()
  if (!plan) return result
  const planStart = startOfWeek(plan.startDate)
  plan.weeks.forEach((week, weekIndex) => {
    week.days.forEach((day) => {
      const date = addDays(planStart, weekIndex * 7 + day.dayOfWeek - 1)
      if (date < weekStart || date >= addDays(weekStart, 7)) return
      const current = result.get(dateKey(date)) ?? []
      current.push({
        id: day.id,
        workoutType: day.workoutType,
        detail:
          day.distance != null
            ? `${day.distance.toFixed(1)} mi`
            : day.duration || (day.rest ? 'Rest' : day.paceGuidance || ''),
      })
      result.set(dateKey(date), current)
    })
  })
  return result
}

function eventsForDay(events: AssistantCalendarEvent[], date: Date) {
  return events.filter((event) => {
    if (event.start.date) {
      return event.start.date.slice(0, 10) === dateKey(date)
    }
    return event.start.dateTime
      ? dateKey(new Date(event.start.dateTime)) === dateKey(date)
      : false
  })
}

function eventTime(event: AssistantCalendarEvent) {
  if (event.start.allDay) return 'All day'
  const value = event.start.dateTime
  if (!value) return ''
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  const day = next.getDay()
  const offset = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + offset)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, count: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + count)
  return next
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function weekLabel(start: Date) {
  const end = addDays(start, 6)
  return `${start.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })} – ${end.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })}`
}

function isToday(date: Date) {
  return dateKey(date) === dateKey(new Date())
}
