import type { CSSProperties } from 'react'
import { calendarColor } from '../lib/calendar/calendarColors'
import type { CalendarItem } from '../lib/calendar/mergeEvents'
import { itemSourceKey, timeLabel } from './calendarViewUtils'

export function EventChip({
  item,
  onOpen,
  dim = false,
  match = false,
  flash = false,
}: {
  item: CalendarItem
  onOpen: (target: HTMLElement, item: CalendarItem) => void
  dim?: boolean
  match?: boolean
  flash?: boolean
}) {
  const color = calendarColor(itemSourceKey(item))
  const style = {
    '--cal-dot': color.dot,
    '--cal-bg': color.bg,
    '--cal-fg': color.fg,
  } as CSSProperties
  return (
    <button
      type="button"
      className="calendar-chip"
      data-allday={item.allDay}
      data-dim={dim}
      data-match={match}
      data-flash={flash}
      data-itemkey={item.key}
      title={item.title}
      style={style}
      onClick={(event) => onOpen(event.currentTarget, item)}
    >
      <i />
      {!item.allDay && <small>{timeLabel(item.start)}</small>}
      <span>{item.title}</span>
    </button>
  )
}
