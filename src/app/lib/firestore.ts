import { Timestamp } from 'firebase/firestore'

/**
 * Firestore date fields in this app can be any of:
 *   - Firestore Timestamp (the normal case)
 *   - JS Date (firebase JS SDK can hand these back through setDoc round-trips)
 *   - ISO string (older exports / legacy docs)
 *   - Unix seconds as Double
 *
 * Matches the permissive decoder in biometrics/StatsKey/Models/Meal.swift:118-129.
 */
export function toDate(v: unknown): Date | undefined {
  if (v == null) return undefined
  if (v instanceof Timestamp) return v.toDate()
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? undefined : d
  }
  if (typeof v === 'number') return new Date(v * 1000)
  if (typeof v === 'object' && v !== null) {
    const obj = v as { toDate?: () => Date; seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number }
    if (typeof obj.toDate === 'function') return obj.toDate()
    const seconds = obj.seconds ?? obj._seconds
    if (typeof seconds === 'number') {
      const nanos = obj.nanoseconds ?? obj._nanoseconds ?? 0
      return new Date(seconds * 1000 + nanos / 1e6)
    }
  }
  return undefined
}

export function toDateOrNow(v: unknown): Date {
  return toDate(v) ?? new Date()
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

/**
 * Build a YYYY-MM-DD string in the browser's local timezone.
 * Matches biometrics/StatsKey/Services/DatabaseService.swift:1407-1416 which
 * uses Calendar.current / TimeZone.current and formats `yyyy-MM-dd`.
 */
export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}
