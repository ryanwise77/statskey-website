const START_DAY = '2025-09-01'
const TIME_ZONE = 'America/Chicago'
const WEEK_MILLIS = 7 * 24 * 60 * 60 * 1000
const NOTE_LANGUAGES = ['en', 'de', 'es', 'hi', 'ja', 'pt-BR']

export function founderNoteLanguage(...preferences) {
  for (const preference of preferences) {
    if (typeof preference !== 'string') continue
    const primary = preference.trim().replaceAll('_', '-').toLowerCase().split('-')[0]
    const language = primary === 'pt' ? 'pt-BR' : primary
    if (NOTE_LANGUAGES.includes(language)) return language
  }
  return 'en'
}

export function founderNoteHeading(week, language) {
  const number = new Intl.NumberFormat(language).format(week)
  return {
    en: `Week ${number} · Miller week note`,
    de: `Woche ${number} · Millers Wochennotiz`,
    es: `Semana ${number} · Nota semanal de Miller`,
    hi: `सप्ताह ${number} · मिलर का साप्ताहिक संदेश`,
    ja: `第${number}週 · ミラーの週間メモ`,
    'pt-BR': `Semana ${number} · Nota semanal de Miller`,
  }[language]
}

export function currentFounderJourneyNote(published, now = new Date(), language = 'en') {
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

  const selectedLanguage = founderNoteLanguage(language)
  const translated = selectedLanguage === 'en' ? null : published.noteLocalizations?.[selectedLanguage]
  const validTranslation = typeof translated === 'string' && translated.trim() &&
    translated.length <= 1200 && !/[\u0000-\u001f\u007f]/.test(translated)

  return {
    weekNumber,
    weekId,
    weekStartDay: new Date(startMillis + elapsedWeeks * WEEK_MILLIS).toISOString().slice(0, 10),
    weekEndDay: new Date(startMillis + (elapsedWeeks + 1) * WEEK_MILLIS - 1).toISOString().slice(0, 10),
    note: validTranslation ? translated.trim() : published.note.trim(),
    noteLanguage: validTranslation ? selectedLanguage : 'en',
  }
}
