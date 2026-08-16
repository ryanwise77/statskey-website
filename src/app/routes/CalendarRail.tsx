import { useEffect, useMemo, useState } from 'react'
import { calendarDateKey } from '../lib/calendar/mergeEvents'
import { addDays, isToday, startOfWeek } from './calendarViewUtils'

export interface CalendarRailRow {
  key: string
  label: string
  color: string
  visible: boolean
}

const MINI_WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function CalendarRail({
  collapsed,
  onToggle,
  anchor,
  onPickDay,
  eventDays,
  searchQuery,
  onSearchChange,
  onSearchJump,
  matchCount,
  rows,
  onToggleRow,
}: {
  collapsed: boolean
  onToggle: () => void
  anchor: Date
  onPickDay: (date: Date) => void
  eventDays: Set<string>
  searchQuery: string
  onSearchChange: (value: string) => void
  onSearchJump: () => void
  matchCount: number
  rows: CalendarRailRow[]
  onToggleRow: (key: string) => void
}) {
  if (collapsed) {
    return (
      <aside className="calendar-rail" data-collapsed="true">
        <button
          type="button"
          className="calendar-rail__toggle"
          aria-label="Show calendar sidebar"
          title="Show sidebar"
          onClick={onToggle}
        >
          ›
        </button>
      </aside>
    )
  }
  const query = searchQuery.trim()
  return (
    <aside className="calendar-rail">
      <div className="calendar-rail__search">
        <div className="calendar-rail__search-row">
          <input
            type="search"
            value={searchQuery}
            placeholder="Search events"
            aria-label="Search visible events"
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onSearchJump()
              }
            }}
          />
          <button
            type="button"
            className="calendar-rail__toggle"
            aria-label="Hide calendar sidebar"
            title="Hide sidebar"
            onClick={onToggle}
          >
            ‹
          </button>
        </div>
        {query && (
          <span className="calendar-rail__matches" role="status">
            {matchCount === 0
              ? 'No matches in view'
              : matchCount === 1
                ? '1 match · Enter jumps to it'
                : `${matchCount} matches · Enter cycles`}
          </span>
        )}
      </div>
      <MiniMonth anchor={anchor} onPickDay={onPickDay} eventDays={eventDays} />
      <div className="calendar-rail__cals">
        <span className="calendar-rail__label">Calendars</span>
        {rows.map((row) => (
          <label key={row.key} className="calendar-rail__cal">
            <input
              type="checkbox"
              checked={row.visible}
              onChange={() => onToggleRow(row.key)}
            />
            <i style={{ background: row.color }} aria-hidden />
            <span>{row.label}</span>
          </label>
        ))}
      </div>
    </aside>
  )
}

function MiniMonth({
  anchor,
  onPickDay,
  eventDays,
}: {
  anchor: Date
  onPickDay: (date: Date) => void
  eventDays: Set<string>
}) {
  const anchorKey = calendarDateKey(anchor)
  const [month, setMonth] = useState(
    () => new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  )
  useEffect(() => {
    setMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  }, [anchor])
  const cells = useMemo(() => {
    const start = startOfWeek(month)
    return Array.from({ length: 42 }, (_, index) => addDays(start, index))
  }, [month])
  return (
    <div className="calendar-mini">
      <header>
        <b>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
        <div>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() =>
              setMonth((current) =>
                new Date(current.getFullYear(), current.getMonth() - 1, 1)
              )
            }
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() =>
              setMonth((current) =>
                new Date(current.getFullYear(), current.getMonth() + 1, 1)
              )
            }
          >
            ›
          </button>
        </div>
      </header>
      <div className="calendar-mini__grid">
        {MINI_WEEKDAYS.map((day, index) => (
          <span key={`wd-${index}`} className="calendar-mini__wd" aria-hidden>
            {day}
          </span>
        ))}
        {cells.map((date) => {
          const key = calendarDateKey(date)
          return (
            <button
              key={key}
              type="button"
              className="calendar-mini__day"
              data-outside={date.getMonth() !== month.getMonth()}
              data-today={isToday(date)}
              data-selected={key === anchorKey}
              data-events={eventDays.has(key)}
              aria-label={date.toDateString()}
              onClick={() => onPickDay(date)}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
