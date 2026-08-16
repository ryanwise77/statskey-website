// Small date/search helpers shared by the calendar route's view components.
// UI-only concerns live here; source-of-truth calendar math stays in
// src/app/lib/calendar.

import { calendarDateKey, type CalendarItem } from '../lib/calendar/mergeEvents'

export function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export function startOfWeek(date: Date): Date {
  const next = new Date(date)
  const day = next.getDay()
  const offset = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + offset)
  next.setHours(0, 0, 0, 0)
  return next
}

export function addDays(date: Date, count: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + count)
  return next
}

export function isToday(date: Date): boolean {
  return calendarDateKey(date) === calendarDateKey(new Date())
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function rangeLabel(start: Date, end: Date | null): string {
  return end ? `${timeLabel(start)} – ${timeLabel(end)}` : timeLabel(start)
}

export function timeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function withTime(date: Date, time: string): Date {
  const [hours = 0, minutes = 0] = time
    .split(':')
    .map((part) => Number.parseInt(part, 10) || 0)
  const next = new Date(date)
  next.setHours(hours, minutes, 0, 0)
  return next
}

export function dateAtMinutes(day: Date, minutes: number): Date {
  const next = startOfDay(day)
  next.setMinutes(minutes)
  return next
}

export function dateFromKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  )
  return Number.isNaN(date.getTime()) ? null : date
}

// Groups every item under a stable source key used for rail rows, colors,
// and visibility filtering: 'local' | 'google' | 'meals' | 'fitness' |
// 'sub:<calendar name>'.
export function itemSourceKey(item: CalendarItem): string {
  if (item.kind === 'meal') return 'meals'
  if (item.kind === 'fitness') return 'fitness'
  if (item.source === 'subscription') {
    return `sub:${item.calendarName || 'Subscription'}`
  }
  return item.source
}

export function matchesSearch(item: CalendarItem, lowerQuery: string): boolean {
  if (!lowerQuery) return false
  if (item.title.toLowerCase().includes(lowerQuery)) return true
  return (item.location ?? '').toLowerCase().includes(lowerQuery)
}
