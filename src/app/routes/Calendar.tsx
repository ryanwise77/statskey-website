import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { AGENT_PREFILL_EVENT, getDesktopBridge } from '../lib/desktop'
import {
  listAssistantCalendarEvents,
  type AssistantCalendarEvent,
} from '../lib/assistant/calendar'
import { useGoogleAssistantConnection } from '../lib/assistant/connections'
import {
  useActiveTrainingPlan,
  useMealCalendar,
  type ActiveTrainingPlan,
} from '../lib/data/usePlanning'
import { confirmDialog, dismissToast, showToast } from '../lib/ui/dialogs'
import {
  LOCAL_CALENDAR_EVENT,
  deleteLocalEvent,
  listLocalEvents,
  localEventIcs,
  saveLocalEvent,
  type LocalCalendarOccurrence,
  type LocalEventRecurrence,
} from '../lib/calendar/localCalendar'
import { calendarColor } from '../lib/calendar/calendarColors'
import {
  localEventShareDescription,
  shareCalendarFile,
} from '../lib/calendar/shareCalendarEvent'
import { parseQuickAdd, type QuickAddParse } from '../lib/calendar/quickAdd'
import {
  calendarDateKey,
  itemsForDay,
  normalizeAssistantEvents,
  normalizeLocalEvents,
  type CalendarItem,
} from '../lib/calendar/mergeEvents'
import { EventChip } from './CalendarEventChip'
import { CalendarRail, type CalendarRailRow } from './CalendarRail'
import { CalendarTimeGrid, type FlashTarget } from './CalendarTimeGrid'
import {
  addDays,
  clamp,
  dateFromKey,
  isToday,
  itemSourceKey,
  matchesSearch,
  startOfDay,
  startOfWeek,
  timeInputValue,
  timeLabel,
  withTime,
} from './calendarViewUtils'
import './Calendar.css'

type CalendarView = 'month' | 'week' | 'day'
type RepeatChoice = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'

const VIEWS: Array<{ id: CalendarView; label: string; key: string }> = [
  { id: 'month', label: 'Month', key: 'm' },
  { id: 'week', label: 'Week', key: 'w' },
  { id: 'day', label: 'Day', key: 'd' },
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_CHIPS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
  { value: 0, label: 'S' },
]
const MEALS_FILTER_KEY = 'statskey.calendar.showMeals'
const FITNESS_FILTER_KEY = 'statskey.calendar.showFitness'
const RAIL_KEY = 'statskey.calendar.rail'
const HIDDEN_SOURCES_KEY = 'statskey.calendar.hiddenSources.v1'

interface PopoverState {
  item: CalendarItem
  x: number
  y: number
}

interface EditDraft {
  title: string
  date: string
  startTime: string
  endTime: string
  allDay: boolean
  location: string
  notes: string
  repeat: RepeatChoice
  byWeekdays: number[]
  until: string
}

interface CreateCardState {
  start: Date
  end: Date
  x: number
  y: number
  nonce: number
}

export function Calendar() {
  const { user } = useAuth()
  const uid = user?.uid
  const navigate = useNavigate()
  const [view, setView] = useState<CalendarView>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [assistantEvents, setAssistantEvents] = useState<
    AssistantCalendarEvent[]
  >([])
  const [localEvents, setLocalEvents] = useState<LocalCalendarOccurrence[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [feedCount, setFeedCount] = useState(0)
  const [showMeals, setShowMeals] = useState(() => readFilter(MEALS_FILTER_KEY))
  const [showFitness, setShowFitness] = useState(() =>
    readFilter(FITNESS_FILTER_KEY)
  )
  const [hiddenSources, setHiddenSources] = useState<Record<string, boolean>>(
    () => readHiddenSources()
  )
  const [railCollapsed, setRailCollapsed] = useState(
    () => readRaw(RAIL_KEY) === 'collapsed'
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [flash, setFlash] = useState<FlashTarget | null>(null)
  const [quickAddText, setQuickAddText] = useState('')
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [createCard, setCreateCard] = useState<CreateCardState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<HTMLDivElement>(null)
  const quickAddRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)
  const errorToastRef = useRef<number | null>(null)
  const searchCursorRef = useRef(-1)
  const connection = useGoogleAssistantConnection(uid)
  const trainingPlan = useActiveTrainingPlan(uid)

  const range = useMemo(() => visibleRange(view, anchor), [view, anchor])
  const days = useMemo(() => {
    const count = Math.round(
      (range.end.getTime() - range.start.getTime()) / 86_400_000
    )
    return Array.from({ length: count }, (_, index) =>
      addDays(range.start, index)
    )
  }, [range])

  const mealCalendar = useMealCalendar(
    uid,
    calendarDateKey(range.start),
    calendarDateKey(addDays(range.end, -1))
  )

  const googleReadable =
    connection.connection?.status === 'connected' &&
    connection.connection.capabilities.includes('calendarRead')
  const bridgeHasFeeds = Boolean(getDesktopBridge()?.calendarFeeds)
  const sourcesReadable = googleReadable || bridgeHasFeeds
  const sourcesConnected = googleReadable || feedCount > 0

  useEffect(() => {
    const feeds = getDesktopBridge()?.calendarFeeds
    if (!feeds) return
    void feeds
      .list()
      .then((items) => setFeedCount(items.length))
      .catch(() => setFeedCount(0))
  }, [])

  const clearErrorToast = useCallback(() => {
    if (errorToastRef.current == null) return
    dismissToast(errorToastRef.current)
    errorToastRef.current = null
  }, [])

  useEffect(() => clearErrorToast, [clearErrorToast])

  useEffect(() => {
    if (!sourcesReadable) {
      setAssistantEvents([])
      return
    }
    const requestId = ++requestIdRef.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      listAssistantCalendarEvents(
        range.start.toISOString(),
        range.end.toISOString(),
        250
      )
        .then((result) => {
          if (requestIdRef.current !== requestId) return
          setAssistantEvents(result.events)
          clearErrorToast()
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return
          clearErrorToast()
          errorToastRef.current = showToast(
            'Your connected calendars could not be read.',
            {
              kind: 'error',
              actionLabel: 'Retry',
              onAction: () => {
                errorToastRef.current = null
                setReloadNonce((nonce) => nonce + 1)
              },
            }
          )
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false)
        })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [range, sourcesReadable, reloadNonce, clearErrorToast])

  const refreshLocal = useCallback(() => {
    setLocalEvents(
      listLocalEvents(range.start.toISOString(), range.end.toISOString())
    )
  }, [range])

  useEffect(() => {
    refreshLocal()
    window.addEventListener(LOCAL_CALENDAR_EVENT, refreshLocal)
    return () => window.removeEventListener(LOCAL_CALENDAR_EVENT, refreshLocal)
  }, [refreshLocal])

  const fitnessDays = useMemo(
    () => trainingDaysForRange(trainingPlan.value, range.start, range.end),
    [trainingPlan.value, range]
  )

  const items = useMemo(() => {
    const merged: CalendarItem[] = [
      ...normalizeAssistantEvents(assistantEvents),
      ...normalizeLocalEvents(localEvents),
    ]
    if (showMeals) {
      for (const day of mealCalendar.value) {
        const date = dateFromKey(day.dateKey)
        if (!date || date < range.start || date >= range.end) continue
        for (const meal of day.meals) {
          merged.push({
            key: `meal-${day.dateKey}-${meal.id}`,
            kind: 'meal',
            source: 'plan',
            id: meal.id,
            title: meal.title,
            allDay: true,
            start: date,
            end: null,
            location: null,
            calendarName: `Meal plan · ${meal.slot}`,
            editable: false,
            seriesId: null,
            recurring: false,
          })
        }
      }
    }
    if (showFitness) {
      fitnessDays.forEach((dayItems, key) => {
        const date = dateFromKey(key)
        if (!date) return
        for (const item of dayItems) {
          merged.push({
            key: `fitness-${key}-${item.id}`,
            kind: 'fitness',
            source: 'plan',
            id: item.id,
            title: item.detail
              ? `${item.workoutType} · ${item.detail}`
              : item.workoutType,
            allDay: true,
            start: date,
            end: null,
            location: null,
            calendarName: 'Fitness plan',
            editable: false,
            seriesId: null,
            recurring: false,
          })
        }
      })
    }
    return merged
  }, [
    assistantEvents,
    localEvents,
    mealCalendar.value,
    fitnessDays,
    showMeals,
    showFitness,
    range,
  ])

  const visibleItems = useMemo(
    () => items.filter((item) => hiddenSources[itemSourceKey(item)] !== true),
    [items, hiddenSources]
  )

  const eventDays = useMemo(() => {
    const set = new Set<string>()
    for (const item of visibleItems) set.add(calendarDateKey(item.start))
    return set
  }, [visibleItems])

  const query = searchQuery.trim().toLowerCase()
  const searchMatches = useMemo(() => {
    if (!query) return []
    return visibleItems
      .filter((item) => matchesSearch(item, query))
      .sort((left, right) => left.start.getTime() - right.start.getTime())
  }, [visibleItems, query])

  useEffect(() => {
    searchCursorRef.current = -1
  }, [searchQuery])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 1600)
    return () => window.clearTimeout(timer)
  }, [flash])

  const railRows = useMemo<CalendarRailRow[]>(() => {
    const rows: CalendarRailRow[] = [
      {
        key: 'local',
        label: 'My events',
        color: calendarColor('local').dot,
        visible: hiddenSources.local !== true,
      },
    ]
    if (googleReadable || items.some((item) => item.source === 'google')) {
      rows.push({
        key: 'google',
        label: 'Google',
        color: calendarColor('google').dot,
        visible: hiddenSources.google !== true,
      })
    }
    const subscriptions = new Map<string, string>()
    for (const item of items) {
      if (item.source !== 'subscription') continue
      const name = item.calendarName || 'Subscription'
      subscriptions.set(`sub:${name}`, name)
    }
    for (const [key, name] of [...subscriptions.entries()].sort((a, b) =>
      a[1].localeCompare(b[1])
    )) {
      rows.push({
        key,
        label: name,
        color: calendarColor(key).dot,
        visible: hiddenSources[key] !== true,
      })
    }
    rows.push({
      key: 'meals',
      label: 'Meals',
      color: calendarColor('meals').dot,
      visible: showMeals,
    })
    rows.push({
      key: 'fitness',
      label: 'Fitness',
      color: calendarColor('fitness').dot,
      visible: showFitness,
    })
    return rows
  }, [items, hiddenSources, googleReadable, showMeals, showFitness])

  const quickAddParse = useMemo<QuickAddParse | null>(() => {
    const text = quickAddText.trim()
    return text ? parseQuickAdd(text) : null
  }, [quickAddText])

  const shiftPeriod = useCallback(
    (direction: number) => {
      setPopover(null)
      setCreateCard(null)
      setAnchor((current) => {
        if (view === 'month') {
          return new Date(
            current.getFullYear(),
            current.getMonth() + direction,
            1
          )
        }
        return addDays(current, direction * (view === 'week' ? 7 : 1))
      })
    },
    [view]
  )

  const switchView = useCallback((next: CalendarView) => {
    setPopover(null)
    setCreateCard(null)
    setView(next)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        shiftPeriod(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        shiftPeriod(1)
      } else if (event.key === 't') {
        setPopover(null)
        setCreateCard(null)
        setAnchor(startOfDay(new Date()))
      } else if (event.key === 'm') {
        switchView('month')
      } else if (event.key === 'w') {
        switchView('week')
      } else if (event.key === 'd') {
        switchView('day')
      } else if (event.key === 'n') {
        event.preventDefault()
        quickAddRef.current?.focus()
      } else if (event.key === 'Escape') {
        setPopover(null)
        setCreateCard(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shiftPeriod, switchView])

  useEffect(() => {
    if (!popover && !createCard) return
    function onMouseDown(event: globalThis.MouseEvent) {
      const target = event.target as Node | null
      if (target && popoverRef.current?.contains(target)) return
      if (target && createRef.current?.contains(target)) return
      setPopover(null)
      setCreateCard(null)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [popover, createCard])

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

  function askIntelligence() {
    const text = quickAddText.trim()
    if (!text) return
    openAgent(`Create this calendar event as an approval: ${text}`)
  }

  function submitQuickAdd() {
    const text = quickAddText.trim()
    if (!text || !quickAddParse) return
    if (quickAddParse.confidence !== 'high' || !quickAddParse.start) return
    const saved = saveLocalEvent({
      title: quickAddParse.title || text,
      start: quickAddParse.start.toISOString(),
      end: quickAddParse.end ? quickAddParse.end.toISOString() : null,
      allDay: quickAddParse.allDay,
      location: quickAddParse.location,
      recurrence: quickAddParse.recurrence ?? null,
    })
    setQuickAddText('')
    setAnchor(startOfDay(quickAddParse.start))
    const bridge = getDesktopBridge()
    showToast('Added to your calendar', {
      kind: 'success',
      ...(bridge?.openCalendarFile
        ? {
            actionLabel: 'Open in calendar app',
            onAction: () => {
              void bridge
                .openCalendarFile?.(localEventIcs(saved), safeFileName(saved.title))
                .then((result) => {
                  if (!result.ok) {
                    showToast(
                      result.error || 'Could not open the calendar app.',
                      { kind: 'error', timeoutMs: 6000 }
                    )
                  }
                })
            },
          }
        : {}),
    })
  }

  function onQuickAddKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitQuickAdd()
    } else if (event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }

  function openPopover(target: HTMLElement, item: CalendarItem) {
    const container = containerRef.current
    if (!container) return
    const chipRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const width = 300
    const x = clamp(
      chipRect.left - containerRect.left,
      8,
      Math.max(8, containerRect.width - width - 8)
    )
    const y = clamp(
      chipRect.bottom - containerRect.top + 6,
      8,
      Math.max(8, containerRect.height - 240)
    )
    setEditDraft(null)
    setCreateCard(null)
    setPopover({ item, x, y })
  }

  function openDay(date: Date) {
    setPopover(null)
    setCreateCard(null)
    setAnchor(startOfDay(date))
    setView('day')
  }

  function openCreateCard(start: Date, end: Date, clientX: number, clientY: number) {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const width = 288
    const x = clamp(
      clientX - rect.left - width / 2,
      8,
      Math.max(8, rect.width - width - 8)
    )
    const y = clamp(
      clientY - rect.top + 10,
      8,
      Math.max(8, rect.height - 190)
    )
    setPopover(null)
    setEditDraft(null)
    setCreateCard({ start, end, x, y, nonce: Date.now() })
  }

  function jumpToNextMatch() {
    if (searchMatches.length === 0) return
    const next = (searchCursorRef.current + 1) % searchMatches.length
    searchCursorRef.current = next
    const item = searchMatches[next]
    setPopover(null)
    setCreateCard(null)
    setAnchor(startOfDay(item.start))
    setFlash({ key: item.key, nonce: Date.now() })
  }

  function findOccurrence(item: CalendarItem): LocalCalendarOccurrence | undefined {
    return (
      localEvents.find(
        (event) => `local:${event.occurrenceKey ?? event.id}` === item.key
      ) ?? localEvents.find((event) => event.id === item.id)
    )
  }

  function findSeries(item: CalendarItem) {
    const targetId = item.seriesId ?? item.id
    if (!targetId) return undefined
    return listLocalEvents().find((event) => event.id === targetId)
  }

  function startEditing(item: CalendarItem) {
    const local = findSeries(item)
    if (!local) return
    const start = new Date(local.start)
    const end = local.end ? new Date(local.end) : null
    const recurrence = local.recurrence ?? null
    setEditDraft({
      title: local.title,
      date: calendarDateKey(start),
      startTime: timeInputValue(start),
      endTime: end ? timeInputValue(end) : '',
      allDay: local.allDay,
      location: local.location ?? '',
      notes: local.notes ?? '',
      repeat: repeatChoiceFromRule(recurrence),
      byWeekdays: recurrence?.byWeekdays?.length
        ? [...recurrence.byWeekdays]
        : [start.getDay()],
      until: recurrence?.until ?? '',
    })
  }

  function saveEdit(item: CalendarItem) {
    const targetId = item.seriesId ?? item.id
    if (!editDraft || !targetId) return
    const date = dateFromKey(editDraft.date)
    if (!date || !editDraft.title.trim()) return
    const start = editDraft.allDay
      ? date
      : withTime(date, editDraft.startTime || '09:00')
    let end: Date | null = null
    if (!editDraft.allDay && editDraft.endTime) {
      end = withTime(date, editDraft.endTime)
      if (end <= start) end = addDays(end, 1)
    }
    let recurrence: LocalEventRecurrence | null = null
    if (editDraft.repeat === 'daily') {
      recurrence = { freq: 'daily', interval: 1, until: editDraft.until || null }
    } else if (editDraft.repeat === 'monthly') {
      recurrence = { freq: 'monthly', interval: 1, until: editDraft.until || null }
    } else if (editDraft.repeat === 'weekly' || editDraft.repeat === 'biweekly') {
      const byWeekdays = editDraft.byWeekdays.length
        ? [...editDraft.byWeekdays].sort((a, b) => a - b)
        : [start.getDay()]
      recurrence = {
        freq: 'weekly',
        interval: editDraft.repeat === 'biweekly' ? 2 : 1,
        byWeekdays,
        until: editDraft.until || null,
      }
    }
    saveLocalEvent({
      id: targetId,
      title: editDraft.title.trim(),
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
      allDay: editDraft.allDay,
      location: editDraft.location.trim() || null,
      notes: editDraft.notes.trim() || null,
      recurrence,
    })
    setEditDraft(null)
    setPopover(null)
    showToast(item.recurring ? 'Series updated' : 'Event updated', {
      kind: 'success',
    })
  }

  async function deleteItem(item: CalendarItem) {
    const targetId = item.seriesId ?? item.id
    if (!targetId) return
    const confirmed = await confirmDialog({
      title: item.recurring ? 'Delete this series?' : 'Delete this event?',
      body: item.recurring
        ? `“${item.title}” repeats. Deleting removes every occurrence in the series from this device.`
        : `“${item.title}” will be removed from your calendar on this device.`,
      confirmLabel: item.recurring ? 'Delete series' : 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    deleteLocalEvent(targetId)
    setPopover(null)
    showToast(item.recurring ? 'Series deleted' : 'Event deleted', {
      kind: 'info',
    })
  }

  async function commitMove(item: CalendarItem, start: Date, end: Date | null) {
    const targetId = item.seriesId ?? item.id
    if (!targetId) return
    if (item.recurring) {
      const confirmed = await confirmDialog({
        title: 'Change the whole series?',
        body: 'This edits every occurrence in the series.',
        confirmLabel: 'Change series',
      })
      if (!confirmed) return
      const raw = findSeries(item)
      if (!raw) return
      const seriesStart = new Date(raw.start)
      const nextStart = new Date(seriesStart)
      nextStart.setHours(start.getHours(), start.getMinutes(), 0, 0)
      const nextEnd = end
        ? new Date(nextStart.getTime() + (end.getTime() - start.getTime()))
        : null
      saveLocalEvent({
        id: targetId,
        title: raw.title,
        start: nextStart.toISOString(),
        end: nextEnd ? nextEnd.toISOString() : raw.end,
      })
      showToast('Series updated', { kind: 'success' })
      return
    }
    saveLocalEvent({
      id: targetId,
      title: item.title,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
    })
    showToast('Event updated', { kind: 'success' })
  }

  function openLocalInCalendarApp(item: CalendarItem) {
    const bridge = getDesktopBridge()
    const local = findOccurrence(item)
    if (!bridge?.openCalendarFile || !local) return
    void bridge
      .openCalendarFile(localEventIcs(local), safeFileName(local.title))
      .then((result) => {
        if (!result.ok) {
          showToast(result.error || 'Could not open the calendar app.', {
            kind: 'error',
            timeoutMs: 6000,
          })
        }
      })
  }

  async function shareLocalEvent(item: CalendarItem) {
    const local = findOccurrence(item)
    if (!local) return
    try {
      const outcome = await shareCalendarFile({
        contents: localEventIcs(local),
        fileName: safeFileName(local.title),
        title: local.title,
        description: localEventShareDescription(local),
      })
      if (outcome === 'attachment-ready') {
        showToast(
          'Attach the calendar file to the email draft.',
          { kind: 'success', timeoutMs: 6000 }
        )
      }
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'Could not share the calendar event.',
        { kind: 'error', timeoutMs: 6000 }
      )
    }
  }

  function openExternal(url: string) {
    const bridge = getDesktopBridge()
    if (bridge) void bridge.openExternal(url)
    else window.open(url, '_blank', 'noopener')
  }

  function toggleMeals() {
    setShowMeals((current) => {
      writeFilter(MEALS_FILTER_KEY, !current)
      return !current
    })
  }

  function toggleFitness() {
    setShowFitness((current) => {
      writeFilter(FITNESS_FILTER_KEY, !current)
      return !current
    })
  }

  function toggleSource(key: string) {
    if (key === 'meals') {
      toggleMeals()
      return
    }
    if (key === 'fitness') {
      toggleFitness()
      return
    }
    setHiddenSources((current) => {
      const next = { ...current }
      if (next[key]) delete next[key]
      else next[key] = true
      writeRaw(HIDDEN_SOURCES_KEY, JSON.stringify(next))
      return next
    })
  }

  function toggleRail() {
    setRailCollapsed((current) => {
      writeRaw(RAIL_KEY, current ? 'open' : 'collapsed')
      return !current
    })
  }

  function saveCreateCard(title: string) {
    if (!createCard || !title.trim()) return
    saveLocalEvent({
      title: title.trim(),
      start: createCard.start.toISOString(),
      end: createCard.end.toISOString(),
      allDay: false,
    })
    setCreateCard(null)
    showToast('Added to your calendar', { kind: 'success' })
  }

  const popoverRecurrence = useMemo<LocalEventRecurrence | null>(() => {
    if (!popover?.item.recurring) return null
    return findSeries(popover.item)?.recurrence ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover, localEvents])

  const weekStart = startOfWeek(anchor)
  const googleUrl = popover
    ? googleEventUrl(popover.item, connection.connection?.accountEmail)
    : null
  const bridge = getDesktopBridge()
  const showEmptyCard =
    view === 'month' && !sourcesConnected && localEvents.length === 0

  return (
    <div className="calendar-page" ref={containerRef}>
      <header className="calendar-page__header">
        <div className="calendar-page__title">
          <span>Personal planning</span>
          <h1>{periodTitle(view, anchor, weekStart)}</h1>
        </div>
        <div className="calendar-page__controls">
          <div
            className="calendar-view-switch"
            role="group"
            aria-label="Calendar view"
          >
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-active={view === option.id}
                aria-pressed={view === option.id}
                onClick={() => switchView(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="calendar-nav" role="group" aria-label="Move period">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => shiftPeriod(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                setPopover(null)
                setCreateCard(null)
                setAnchor(startOfDay(new Date()))
              }}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => shiftPeriod(1)}
            >
              ›
            </button>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() =>
              openAgent(
                `Review my calendar, active meal plan, and active fitness plan for ${weekRangeLabel(
                  weekStart
                )}. Identify conflicts and propose a balanced week. Do not schedule or send anything without an exact approval.`
              )
            }
          >
            Plan this week with Intelligence
          </button>
        </div>
      </header>

      <div className="calendar-toolbar">
        <div className="calendar-quick-add">
          <input
            ref={quickAddRef}
            type="text"
            value={quickAddText}
            placeholder="Add an event — try “Lunch with Sam tomorrow noon at Blue Bottle”"
            aria-label="Quick add an event"
            onChange={(event) => setQuickAddText(event.target.value)}
            onKeyDown={onQuickAddKeyDown}
          />
          {quickAddParse && (
            <div
              className="calendar-quick-add__preview"
              data-confidence={quickAddParse.confidence}
            >
              {quickAddParse.confidence === 'none' ? (
                <>
                  <span className="calendar-quick-add__hint">
                    Add a date or time — “tomorrow 3pm”, “Friday noon”
                  </span>
                  <button type="button" onClick={askIntelligence}>
                    Ask Intelligence
                  </button>
                </>
              ) : (
                <>
                  <i />
                  <b>{quickAddParse.title || quickAddText.trim()}</b>
                  <span>{previewWhen(quickAddParse)}</span>
                  {quickAddParse.location && (
                    <span>at {quickAddParse.location}</span>
                  )}
                  {quickAddParse.confidence === 'high' ? (
                    <kbd>↵ Enter</kbd>
                  ) : (
                    <>
                      <span className="calendar-quick-add__hint">
                        Add a date or time
                      </span>
                      <button type="button" onClick={askIntelligence}>
                        Ask Intelligence
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="calendar-loading" data-active={loading} aria-hidden />

      <div className="calendar-body">
        <CalendarRail
          collapsed={railCollapsed}
          onToggle={toggleRail}
          anchor={anchor}
          onPickDay={(date) => {
            setPopover(null)
            setCreateCard(null)
            setAnchor(startOfDay(date))
          }}
          eventDays={eventDays}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchJump={jumpToNextMatch}
          matchCount={searchMatches.length}
          rows={railRows}
          onToggleRow={toggleSource}
        />
        <div className="calendar-main">
          {showEmptyCard && (
            <section className="calendar-empty-card">
              <b>Your calendar works out of the box</b>
              <p>
                Type an event above and press Enter — it saves right here on
                this device. Add subscriptions or connect Google to bring
                everything into one place.
              </p>
              <div>
                <Link className="btn btn-secondary" to="/profile">
                  Add a calendar subscription
                </Link>
                <button
                  className="btn btn-secondary"
                  onClick={() => quickAddRef.current?.focus()}
                >
                  Try quick-add
                </button>
              </div>
            </section>
          )}

          {view === 'month' && (
            <div className="calendar-month">
              <div className="calendar-month__weekdays" aria-hidden>
                {WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="calendar-month__grid">
                {days.map((date) => {
                  const dayItems = itemsForDay(visibleItems, date)
                  const visible = dayItems.slice(0, 3)
                  const overflow = dayItems.length - visible.length
                  return (
                    <div
                      key={calendarDateKey(date)}
                      className="calendar-cell"
                      data-outside={date.getMonth() !== anchor.getMonth()}
                      data-today={isToday(date)}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button')) {
                          return
                        }
                        openCreateCard(
                          withTime(date, '09:00'),
                          withTime(date, '09:30'),
                          event.clientX,
                          event.clientY
                        )
                      }}
                    >
                      <button
                        type="button"
                        className="calendar-cell__date"
                        aria-label={date.toDateString()}
                        onClick={() => openDay(date)}
                      >
                        {date.getDate()}
                      </button>
                      <div className="calendar-cell__items">
                        {visible.map((item: CalendarItem) => {
                          const matched = query
                            ? matchesSearch(item, query)
                            : false
                          return (
                            <EventChip
                              key={item.key}
                              item={item}
                              onOpen={openPopover}
                              dim={Boolean(query) && !matched}
                              match={matched}
                              flash={flash?.key === item.key}
                            />
                          )
                        })}
                        {overflow > 0 && (
                          <button
                            type="button"
                            className="calendar-cell__more"
                            onClick={() => openDay(date)}
                          >
                            +{overflow} more
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {(view === 'week' || view === 'day') && (
            <CalendarTimeGrid
              days={days}
              items={visibleItems}
              searchQuery={searchQuery}
              flash={flash}
              onOpenItem={openPopover}
              onOpenDay={openDay}
              onCreateRange={(start, end, clientX, clientY) =>
                openCreateCard(start, end, clientX, clientY)
              }
              onMoveItem={(item, start, end) => {
                void commitMove(item, start, end)
              }}
              onScrolled={() => setPopover((current) => (current ? null : current))}
            />
          )}
        </div>
      </div>

      {createCard && (
        <div
          ref={createRef}
          className="calendar-create"
          role="dialog"
          aria-label="New event"
          style={{ left: createCard.x, top: createCard.y }}
        >
          <CreateCardForm
            key={createCard.nonce}
            card={createCard}
            onCancel={() => setCreateCard(null)}
            onSave={saveCreateCard}
          />
        </div>
      )}

      {popover && (
        <div
          ref={popoverRef}
          className="calendar-popover"
          role="dialog"
          aria-label={popover.item.title}
          style={{ left: popover.x, top: popover.y }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setPopover(null)
            }
          }}
        >
          {editDraft ? (
            <div className="calendar-popover__form">
              <label>
                Title
                <input
                  type="text"
                  value={editDraft.title}
                  autoFocus
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, title: event.target.value })
                  }
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={editDraft.date}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, date: event.target.value })
                  }
                />
              </label>
              <label className="calendar-popover__check">
                <input
                  type="checkbox"
                  checked={editDraft.allDay}
                  onChange={(event) =>
                    setEditDraft({
                      ...editDraft,
                      allDay: event.target.checked,
                    })
                  }
                />
                All day
              </label>
              {!editDraft.allDay && (
                <div className="calendar-popover__times">
                  <label>
                    Starts
                    <input
                      type="time"
                      value={editDraft.startTime}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          startTime: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      type="time"
                      value={editDraft.endTime}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          endTime: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              )}
              <label>
                Repeats
                <select
                  value={editDraft.repeat}
                  onChange={(event) =>
                    setEditDraft({
                      ...editDraft,
                      repeat: event.target.value as RepeatChoice,
                    })
                  }
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              {(editDraft.repeat === 'weekly' ||
                editDraft.repeat === 'biweekly') && (
                <div
                  className="calendar-popover__weekdays"
                  role="group"
                  aria-label="Repeat on"
                >
                  {WEEKDAY_CHIPS.map((chip, index) => {
                    const active = editDraft.byWeekdays.includes(chip.value)
                    return (
                      <button
                        key={`${chip.value}-${index}`}
                        type="button"
                        data-active={active}
                        aria-pressed={active}
                        aria-label={WEEKDAYS[(chip.value + 6) % 7]}
                        onClick={() =>
                          setEditDraft({
                            ...editDraft,
                            byWeekdays: active
                              ? editDraft.byWeekdays.length > 1
                                ? editDraft.byWeekdays.filter(
                                    (value) => value !== chip.value
                                  )
                                : editDraft.byWeekdays
                              : [...editDraft.byWeekdays, chip.value],
                          })
                        }
                      >
                        {chip.label}
                      </button>
                    )
                  })}
                </div>
              )}
              {editDraft.repeat !== 'none' && (
                <label>
                  Ends on
                  <input
                    type="date"
                    value={editDraft.until}
                    min={editDraft.date}
                    onChange={(event) =>
                      setEditDraft({ ...editDraft, until: event.target.value })
                    }
                  />
                </label>
              )}
              {popover.item.recurring && (
                <p className="calendar-popover__series-note">
                  Repeats — changes apply to every occurrence.
                </p>
              )}
              <label>
                Location
                <input
                  type="text"
                  value={editDraft.location}
                  placeholder="Optional"
                  onChange={(event) =>
                    setEditDraft({
                      ...editDraft,
                      location: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={2}
                  value={editDraft.notes}
                  placeholder="Optional"
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, notes: event.target.value })
                  }
                />
              </label>
              <div className="calendar-popover__actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditDraft(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    !editDraft.title.trim() || !dateFromKey(editDraft.date)
                  }
                  onClick={() => saveEdit(popover.item)}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <header className="calendar-popover__header">
                <b>{popover.item.title}</b>
                <span
                  className="calendar-popover__badge"
                  data-source={popover.item.source}
                >
                  {sourceBadge(popover.item)}
                </span>
              </header>
              <p className="calendar-popover__when">
                {itemWhen(popover.item)}
              </p>
              {popoverRecurrence && (
                <p className="calendar-popover__when">
                  {recurrenceLabel(popoverRecurrence)}
                </p>
              )}
              {popover.item.location && (
                <p className="calendar-popover__location">
                  {popover.item.location}
                </p>
              )}
              <div className="calendar-popover__actions">
                {popover.item.editable && popover.item.source === 'local' && (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={() => startEditing(popover.item)}
                    >
                      Edit
                    </button>
                    {bridge?.openCalendarFile && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => openLocalInCalendarApp(popover.item)}
                      >
                        Open in calendar app
                      </button>
                    )}
                    <button
                      className="btn btn-secondary"
                      onClick={() => void shareLocalEvent(popover.item)}
                    >
                      Email or share
                    </button>
                    <button
                      className="btn btn-secondary calendar-popover__delete"
                      onClick={() => void deleteItem(popover.item)}
                    >
                      Delete
                    </button>
                  </>
                )}
                {googleUrl && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => openExternal(googleUrl)}
                  >
                    Open in Google Calendar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CreateCardForm({
  card,
  onCancel,
  onSave,
}: {
  card: CreateCardState
  onCancel: () => void
  onSave: (title: string) => void
}) {
  const [title, setTitle] = useState('')
  const canSave = Boolean(title.trim())
  return (
    <>
      <input
        type="text"
        value={title}
        autoFocus
        placeholder="Add a title"
        aria-label="Event title"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSave(title)
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <p>
        {card.start.toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}
        {' · '}
        {timeLabel(card.start)} – {timeLabel(card.end)}
      </p>
      <div className="calendar-create__actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!canSave}
          onClick={() => onSave(title)}
        >
          Save
        </button>
      </div>
    </>
  )
}

function repeatChoiceFromRule(
  rule: LocalEventRecurrence | null
): RepeatChoice {
  if (!rule) return 'none'
  if (rule.freq === 'daily') return 'daily'
  if (rule.freq === 'monthly') return 'monthly'
  return rule.interval >= 2 ? 'biweekly' : 'weekly'
}

function recurrenceLabel(rule: LocalEventRecurrence): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let text: string
  if (rule.freq === 'daily') {
    text = rule.interval > 1 ? `Repeats every ${rule.interval} days` : 'Repeats daily'
  } else if (rule.freq === 'monthly') {
    text =
      rule.interval > 1
        ? `Repeats every ${rule.interval} months`
        : 'Repeats monthly'
  } else {
    const base =
      rule.interval > 1 ? `Repeats every ${rule.interval} weeks` : 'Repeats weekly'
    const dayNames = rule.byWeekdays?.length
      ? [...rule.byWeekdays]
          .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
          .map((value) => names[value] ?? '')
          .filter(Boolean)
          .join(', ')
      : ''
    text = dayNames ? `${base} on ${dayNames}` : base
  }
  const until = rule.until ? dateFromKey(rule.until) : null
  if (until) {
    text += ` until ${until.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    })}`
  }
  return text
}

function trainingDaysForRange(
  plan: ActiveTrainingPlan | null,
  rangeStart: Date,
  rangeEnd: Date
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
      if (date < rangeStart || date >= rangeEnd) return
      const key = calendarDateKey(date)
      const current = result.get(key) ?? []
      current.push({
        id: day.id,
        workoutType: day.workoutType,
        detail:
          day.distance != null
            ? `${day.distance.toFixed(1)} mi`
            : day.duration || (day.rest ? 'Rest' : day.paceGuidance || ''),
      })
      result.set(key, current)
    })
  })
  return result
}

function visibleRange(view: CalendarView, anchor: Date) {
  if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const start = startOfWeek(first)
    return { start, end: addDays(start, 42) }
  }
  if (view === 'week') {
    const start = startOfWeek(anchor)
    return { start, end: addDays(start, 7) }
  }
  const start = startOfDay(anchor)
  return { start, end: addDays(start, 1) }
}

function periodTitle(view: CalendarView, anchor: Date, weekStart: Date) {
  if (view === 'month') {
    return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
  }
  if (view === 'week') return weekRangeLabel(weekStart)
  return anchor.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function weekRangeLabel(start: Date) {
  const end = addDays(start, 6)
  const startLabel = start.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
  const endLabel =
    start.getMonth() === end.getMonth()
      ? String(end.getDate())
      : end.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${startLabel} – ${endLabel}`
}

function previewWhen(parse: QuickAddParse) {
  if (!parse.start) return 'when?'
  const day = parse.start.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const repeat = parse.recurrence
    ? ` · ${recurrenceLabel(parse.recurrence).replace('Repeats', 'repeats')}`
    : ''
  if (parse.allDay) return `${day} · all day${repeat}`
  const startTime = timeLabel(parse.start)
  const range = parse.end
    ? `${day} · ${startTime} – ${timeLabel(parse.end)}`
    : `${day} · ${startTime}`
  return `${range}${repeat}`
}

function itemWhen(item: CalendarItem) {
  const day = item.start.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
  if (item.allDay) return `${day} · All day`
  const startTime = timeLabel(item.start)
  return item.end
    ? `${day} · ${startTime} – ${timeLabel(item.end)}`
    : `${day} · ${startTime}`
}

function sourceBadge(item: CalendarItem) {
  if (item.source === 'local') return 'On this device'
  if (item.source === 'google') return item.calendarName || 'Google Calendar'
  if (item.source === 'subscription') {
    return item.calendarName || 'Subscription'
  }
  return item.calendarName || 'Plan'
}

function googleEventUrl(
  item: CalendarItem,
  accountEmail: string | undefined
): string | null {
  if (item.source !== 'google' || !item.id || !accountEmail) return null
  try {
    const eid = window.btoa(`${item.id} ${accountEmail}`).replace(/=+$/, '')
    return `https://calendar.google.com/calendar/event?eid=${eid}`
  } catch {
    return null
  }
}

function safeFileName(title: string) {
  const cleaned = title
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
  return cleaned || 'calendar-event'
}

function readFilter(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'off'
  } catch {
    return true
  }
}

function writeFilter(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? 'on' : 'off')
  } catch {
    // Filters simply reset next launch when storage is unavailable.
  }
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Preferences simply reset next launch when storage is unavailable.
  }
}

function readHiddenSources(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_SOURCES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const result: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true) result[key] = true
    }
    return result
  } catch {
    return {}
  }
}
