import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { calendarColor } from '../lib/calendar/calendarColors'
import { itemsForDay, type CalendarItem } from '../lib/calendar/mergeEvents'
import { EventChip } from './CalendarEventChip'
import {
  addDays,
  clamp,
  dateAtMinutes,
  isToday,
  itemSourceKey,
  matchesSearch,
  rangeLabel,
  snapTo,
} from './calendarViewUtils'

// 60px per hour → 1px per minute, which keeps every position calculation a
// plain minute count.
const DAY_MINUTES = 1440
const SNAP_MINUTES = 15
const CLICK_SLOT_MINUTES = 30
const MAX_COLUMNS = 3
const DRAG_THRESHOLD_PX = 4
const MIN_BLOCK_HEIGHT = 22
const COLUMN_MIN_WIDTH = 110
const GUTTER_WIDTH = 56

export interface FlashTarget {
  key: string
  nonce: number
}

interface PositionedBlock {
  item: CalendarItem
  top: number
  height: number
  startMin: number
  durationMin: number
  leftPct: number
  widthPct: number
  z: number
  clipped: boolean
}

interface OverflowBadge {
  top: number
  count: number
}

interface DayLayout {
  allDay: CalendarItem[]
  blocks: PositionedBlock[]
  overflows: OverflowBadge[]
}

interface DragState {
  mode: 'move' | 'resize'
  itemKey: string
  item: CalendarItem
  startX: number
  startY: number
  colWidth: number
  originDayIndex: number
  startMin: number
  durationMin: number
  dxDays: number
  dyMin: number
  moved: boolean
}

interface CreateDragState {
  dayIndex: number
  anchorMin: number
  startMin: number
  endMin: number
  moved: boolean
}

export function CalendarTimeGrid({
  days,
  items,
  searchQuery,
  flash,
  onOpenItem,
  onOpenDay,
  onCreateRange,
  onMoveItem,
  onScrolled,
}: {
  days: Date[]
  items: CalendarItem[]
  searchQuery: string
  flash: FlashTarget | null
  onOpenItem: (target: HTMLElement, item: CalendarItem) => void
  onOpenDay: (date: Date) => void
  onCreateRange: (start: Date, end: Date, clientX: number, clientY: number) => void
  onMoveItem: (item: CalendarItem, start: Date, end: Date | null) => void
  onScrolled: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [createDrag, setCreateDrag] = useState<CreateDragState | null>(null)
  const [, setNowTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((tick) => tick + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Land the initial scroll around 7am, or just above "now" when today is
  // in view.
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const now = new Date()
    const target = days.some((day) => isToday(day))
      ? now.getHours() * 60 + now.getMinutes() - 90
      : 7 * 60 - 20
    element.scrollTop = clamp(target, 0, DAY_MINUTES)
  }, [days])

  useEffect(() => {
    if (!flash) return
    const root = scrollRef.current
    if (!root) return
    const element = root.querySelector<HTMLElement>(
      `[data-itemkey="${CSS.escape(flash.key)}"]`
    )
    if (!element) return
    root.scrollTo({
      top: Math.max(0, element.offsetTop - 140),
      behavior: 'smooth',
    })
  }, [flash])

  const layouts = useMemo(
    () => days.map((day) => layoutDay(items, day)),
    [days, items]
  )
  const query = searchQuery.trim().toLowerCase()
  const minWidth = GUTTER_WIDTH + days.length * COLUMN_MIN_WIDTH

  function onColPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    dayIndex: number
  ) {
    if (event.button !== 0 || drag) return
    if ((event.target as HTMLElement).closest('.calendar-block, button')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const y = clamp(event.clientY - rect.top, 0, DAY_MINUTES - SNAP_MINUTES)
    const slot = Math.floor(y / CLICK_SLOT_MINUTES) * CLICK_SLOT_MINUTES
    event.currentTarget.setPointerCapture(event.pointerId)
    setCreateDrag({
      dayIndex,
      anchorMin: snapTo(y, SNAP_MINUTES),
      startMin: slot,
      endMin: Math.min(slot + CLICK_SLOT_MINUTES, DAY_MINUTES),
      moved: false,
    })
  }

  function onColPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
    dayIndex: number
  ) {
    if (!createDrag || createDrag.dayIndex !== dayIndex) return
    const rect = event.currentTarget.getBoundingClientRect()
    const y = clamp(event.clientY - rect.top, 0, DAY_MINUTES)
    const current = snapTo(y, SNAP_MINUTES)
    const moved =
      createDrag.moved ||
      Math.abs(current - createDrag.anchorMin) >= SNAP_MINUTES
    if (!moved) return
    const startMin = Math.min(createDrag.anchorMin, current)
    const endMin = Math.max(createDrag.anchorMin, current)
    setCreateDrag({
      ...createDrag,
      moved: true,
      startMin,
      endMin: Math.max(endMin, startMin + SNAP_MINUTES),
    })
  }

  function onColPointerUp(
    event: ReactPointerEvent<HTMLDivElement>,
    dayIndex: number,
    day: Date
  ) {
    if (!createDrag || createDrag.dayIndex !== dayIndex) return
    releaseCapture(event)
    const { startMin, endMin } = createDrag
    setCreateDrag(null)
    onCreateRange(
      dateAtMinutes(day, startMin),
      dateAtMinutes(day, Math.max(endMin, startMin + SNAP_MINUTES)),
      event.clientX,
      event.clientY
    )
  }

  function startBlockDrag(
    event: ReactPointerEvent<HTMLElement>,
    block: PositionedBlock,
    dayIndex: number,
    mode: 'move' | 'resize'
  ) {
    if (event.button !== 0) return
    event.stopPropagation()
    const cols = colsRef.current
    if (!cols) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      mode,
      itemKey: block.item.key,
      item: block.item,
      startX: event.clientX,
      startY: event.clientY,
      colWidth: cols.getBoundingClientRect().width / days.length,
      originDayIndex: dayIndex,
      startMin: block.startMin,
      durationMin: block.durationMin,
      dxDays: 0,
      dyMin: 0,
      moved: false,
    })
  }

  function onBlockPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.mode === 'move') {
      const dxDays = clamp(
        Math.round(dx / drag.colWidth),
        -drag.originDayIndex,
        days.length - 1 - drag.originDayIndex
      )
      const dyMin = clamp(
        snapTo(dy, SNAP_MINUTES),
        -drag.startMin,
        DAY_MINUTES - drag.durationMin - drag.startMin
      )
      const moved =
        drag.moved ||
        Math.abs(dx) > DRAG_THRESHOLD_PX ||
        Math.abs(dy) > DRAG_THRESHOLD_PX
      if (dxDays !== drag.dxDays || dyMin !== drag.dyMin || moved !== drag.moved) {
        setDrag({ ...drag, dxDays, dyMin, moved })
      }
    } else {
      const nextDuration = clamp(
        drag.durationMin + snapTo(dy, SNAP_MINUTES),
        SNAP_MINUTES,
        DAY_MINUTES - drag.startMin
      )
      const dyMin = nextDuration - drag.durationMin
      const moved = drag.moved || Math.abs(dy) > DRAG_THRESHOLD_PX
      if (dyMin !== drag.dyMin || moved !== drag.moved) {
        setDrag({ ...drag, dyMin, moved })
      }
    }
  }

  function onBlockPointerUp(
    event: ReactPointerEvent<HTMLElement>,
    item: CalendarItem
  ) {
    if (!drag || drag.itemKey !== item.key) return
    releaseCapture(event)
    const finished = drag
    setDrag(null)
    if (!finished.moved) {
      if (finished.mode === 'move') {
        onOpenItem(event.currentTarget as HTMLElement, item)
      }
      return
    }
    if (finished.mode === 'move') {
      if (finished.dxDays === 0 && finished.dyMin === 0) return
      const start = addDays(item.start, finished.dxDays)
      start.setMinutes(start.getMinutes() + finished.dyMin)
      let end: Date | null = null
      if (item.end && item.end.getTime() > item.start.getTime()) {
        end = addDays(item.end, finished.dxDays)
        end.setMinutes(end.getMinutes() + finished.dyMin)
      }
      onMoveItem(item, start, end)
      return
    }
    if (finished.dyMin === 0) return
    const end = new Date(item.start)
    end.setMinutes(end.getMinutes() + finished.durationMin + finished.dyMin)
    onMoveItem(item, new Date(item.start), end)
  }

  function renderBlock(block: PositionedBlock, dayIndex: number) {
    const item = block.item
    const draggable =
      item.editable && item.source === 'local' && !block.clipped
    const active =
      drag && drag.itemKey === item.key && drag.moved ? drag : null
    const color = calendarColor(itemSourceKey(item))
    const matched = query ? matchesSearch(item, query) : false
    const style: CSSProperties = {
      top: block.top,
      height:
        active?.mode === 'resize'
          ? Math.max(block.durationMin + active.dyMin, MIN_BLOCK_HEIGHT)
          : block.height,
      left: `${block.leftPct}%`,
      width: `calc(${block.widthPct}% - 3px)`,
      zIndex: active ? 30 : block.z,
    }
    if (active?.mode === 'move') {
      style.transform = `translate(${active.dxDays * active.colWidth}px, ${active.dyMin}px)`
    }
    const styleVars = style as Record<string, string | number>
    styleVars['--cal-dot'] = color.dot
    styleVars['--cal-bg'] = color.bg
    styleVars['--cal-fg'] = color.fg
    const times = active ? previewTimes(active, item) : blockTimes(item)
    return (
      <div
        key={item.key}
        role="button"
        tabIndex={0}
        className="calendar-block"
        data-itemkey={item.key}
        data-editable={draggable}
        data-dragging={Boolean(active)}
        data-dim={Boolean(query) && !matched}
        data-match={matched}
        data-flash={flash?.key === item.key}
        title={item.title}
        style={style}
        onPointerDown={(event) =>
          draggable
            ? startBlockDrag(event, block, dayIndex, 'move')
            : event.stopPropagation()
        }
        onPointerMove={draggable ? onBlockPointerMove : undefined}
        onPointerUp={
          draggable ? (event) => onBlockPointerUp(event, item) : undefined
        }
        onPointerCancel={draggable ? () => setDrag(null) : undefined}
        onClick={
          draggable
            ? undefined
            : (event) => onOpenItem(event.currentTarget, item)
        }
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenItem(event.currentTarget, item)
          }
        }}
      >
        <b>{item.title}</b>
        {(active !== null || block.height >= 40) && <span>{times}</span>}
        {draggable && (
          <span
            className="calendar-block__resize"
            aria-hidden
            onPointerDown={(event) =>
              startBlockDrag(event, block, dayIndex, 'resize')
            }
          />
        )}
      </div>
    )
  }

  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="calendar-tgrid" ref={scrollRef} onScroll={onScrolled}>
      <div className="calendar-tgrid__inner" style={{ minWidth }}>
        <div className="calendar-tgrid__sticky">
          <div className="calendar-tgrid__row">
            <div className="calendar-tgrid__corner" aria-hidden />
            <div className="calendar-tgrid__cells">
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className="calendar-tgrid__head-day"
                  data-today={isToday(day)}
                >
                  <span>{day.toLocaleDateString([], { weekday: 'short' })}</span>
                  <button
                    type="button"
                    aria-label={day.toDateString()}
                    onClick={() => onOpenDay(day)}
                  >
                    {day.getDate()}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="calendar-tgrid__row">
            <div
              className="calendar-tgrid__corner calendar-tgrid__corner--label"
              aria-hidden
            >
              All-day
            </div>
            <div className="calendar-tgrid__cells">
              {days.map((day, index) => (
                <div
                  key={day.toISOString()}
                  className="calendar-tgrid__allday-cell"
                >
                  {layouts[index].allDay.map((item) => (
                    <EventChip
                      key={item.key}
                      item={item}
                      onOpen={onOpenItem}
                      dim={Boolean(query) && !matchesSearch(item, query)}
                      match={Boolean(query) && matchesSearch(item, query)}
                      flash={flash?.key === item.key}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="calendar-tgrid__row calendar-tgrid__canvas">
          <div className="calendar-tgrid__gutter" aria-hidden>
            {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => (
              <span key={hour} style={{ top: hour * 60 }}>
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          <div className="calendar-tgrid__cells" ref={colsRef}>
            {days.map((day, index) => (
              <div
                key={day.toISOString()}
                className="calendar-tgrid__col"
                data-today={isToday(day)}
                onPointerDown={(event) => onColPointerDown(event, index)}
                onPointerMove={(event) => onColPointerMove(event, index)}
                onPointerUp={(event) => onColPointerUp(event, index, day)}
                onPointerCancel={() => setCreateDrag(null)}
              >
                {layouts[index].blocks.map((block) => renderBlock(block, index))}
                {layouts[index].overflows.map((overflow) => (
                  <button
                    key={`overflow-${overflow.top}`}
                    type="button"
                    className="calendar-tgrid__overflow"
                    style={{ top: overflow.top }}
                    onClick={() => onOpenDay(day)}
                  >
                    +{overflow.count}
                  </button>
                ))}
                {createDrag && createDrag.dayIndex === index && (
                  <div
                    className="calendar-tgrid__select"
                    style={{
                      top: createDrag.startMin,
                      height: createDrag.endMin - createDrag.startMin,
                    }}
                    aria-hidden
                  >
                    <span>
                      {rangeLabel(
                        dateAtMinutes(day, createDrag.startMin),
                        dateAtMinutes(day, createDrag.endMin)
                      )}
                    </span>
                  </div>
                )}
                {isToday(day) && (
                  <div
                    className="calendar-tgrid__now"
                    style={{ top: nowMin }}
                    aria-hidden
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function layoutDay(items: CalendarItem[], day: Date): DayLayout {
  const dayItems = itemsForDay(items, day)
  const allDay = dayItems.filter((item) => item.allDay)
  const dayStartMs = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate()
  ).getTime()
  const dayEndMs = dayStartMs + DAY_MINUTES * 60_000
  const timed = dayItems
    .filter((item) => !item.allDay)
    .map((item) => {
      const startMs = item.start.getTime()
      const rawEndMs =
        item.end && item.end.getTime() > startMs
          ? item.end.getTime()
          : startMs + 30 * 60_000
      const startMin = clamp(
        Math.round((startMs - dayStartMs) / 60_000),
        0,
        DAY_MINUTES - SNAP_MINUTES
      )
      const endMin = clamp(
        Math.round((rawEndMs - dayStartMs) / 60_000),
        startMin + SNAP_MINUTES,
        DAY_MINUTES
      )
      return {
        item,
        startMin,
        endMin,
        clipped: startMs < dayStartMs || rawEndMs > dayEndMs,
      }
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const blocks: PositionedBlock[] = []
  const overflows: OverflowBadge[] = []
  let columns: number[] = []
  let clusterEnd = -1
  let cluster: Array<{ column: number; base: PositionedBlock }> = []

  const flushCluster = () => {
    if (cluster.length === 0) return
    const columnCount = Math.min(Math.max(columns.length, 1), MAX_COLUMNS)
    const hidden = cluster.filter((entry) => entry.column >= MAX_COLUMNS)
    for (const entry of cluster) {
      if (entry.column >= MAX_COLUMNS) continue
      blocks.push({
        ...entry.base,
        leftPct: (100 / columnCount) * entry.column,
        widthPct: 100 / columnCount,
      })
    }
    if (hidden.length > 0) {
      overflows.push({ top: hidden[0].base.top, count: hidden.length })
    }
    columns = []
    cluster = []
  }

  timed.forEach((entry, index) => {
    if (cluster.length > 0 && entry.startMin >= clusterEnd) flushCluster()
    let column = columns.findIndex((endMin) => endMin <= entry.startMin)
    if (column === -1) {
      column = columns.length
      columns.push(entry.endMin)
    } else {
      columns[column] = entry.endMin
    }
    clusterEnd = cluster.length === 0 ? entry.endMin : Math.max(clusterEnd, entry.endMin)
    cluster.push({
      column,
      base: {
        item: entry.item,
        top: entry.startMin,
        height: Math.max(entry.endMin - entry.startMin, MIN_BLOCK_HEIGHT),
        startMin: entry.startMin,
        durationMin: entry.endMin - entry.startMin,
        leftPct: 0,
        widthPct: 100,
        z: index + 1,
        clipped: entry.clipped,
      },
    })
  })
  flushCluster()
  return { allDay, blocks, overflows }
}

function blockTimes(item: CalendarItem): string {
  return rangeLabel(item.start, item.end)
}

function previewTimes(drag: DragState, item: CalendarItem): string {
  if (drag.mode === 'move') {
    const start = addDays(item.start, drag.dxDays)
    start.setMinutes(start.getMinutes() + drag.dyMin)
    let end: Date | null = null
    if (item.end && item.end.getTime() > item.start.getTime()) {
      end = addDays(item.end, drag.dxDays)
      end.setMinutes(end.getMinutes() + drag.dyMin)
    }
    return rangeLabel(start, end)
  }
  const end = new Date(item.start)
  end.setMinutes(end.getMinutes() + drag.durationMin + drag.dyMin)
  return rangeLabel(item.start, end)
}

function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

function releaseCapture(event: ReactPointerEvent<HTMLElement>) {
  try {
    event.currentTarget.releasePointerCapture(event.pointerId)
  } catch {
    // Capture may already be gone; nothing to release.
  }
}
