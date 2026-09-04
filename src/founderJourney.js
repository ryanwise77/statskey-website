const START_DAY = '2025-09-01'
const TIME_ZONE = 'America/Chicago'
const WEEK_MILLIS = 7 * 24 * 60 * 60 * 1000

export function currentFounderJourneyNote(published, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const startMillis = Date.parse(`${START_DAY}T00:00:00Z`)
  const elapsedWeeks = Math.max(0, Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - startMillis) / WEEK_MILLIS
  ))
  const weekNumber = elapsedWeeks + 1
  const weekId = `week-${String(weekNumber).padStart(4, '0')}`
  if (
    published?.schemaVersion !== 1 || published.weekId !== weekId ||
    !Number.isInteger(published.noteRevision) || published.noteRevision < 1 ||
    typeof published.note !== 'string' || !published.note.trim() ||
    published.note.length > 600
  ) return null

  return {
    weekNumber,
    weekId,
    weekStartDay: new Date(startMillis + elapsedWeeks * WEEK_MILLIS).toISOString().slice(0, 10),
    weekEndDay: new Date(startMillis + (elapsedWeeks + 1) * WEEK_MILLIS - 1).toISOString().slice(0, 10),
    note: published.note.trim(),
  }
}
