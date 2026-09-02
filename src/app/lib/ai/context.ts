import type { DailyTotals } from '../aggregates'
import { bristolSummary, computeGIBurdenScore } from '../gi'
import type {
  GlucoseReading,
  MacroTargets,
  Meal,
  WaterDoc,
  WellnessEntry,
  WorkoutSession,
} from '../types'
import type { UserProfile as Profile } from '../profile'
import { formatWorkoutContextLine, localTimeZoneName } from './workoutContext'

/**
 * Builds the plain-text system prompt for the web Intelligence agent,
 * mirroring the section format and grounding rules iOS uses in
 * biometrics/StatsKey/Services/AIContextBuilder.swift. Today's snapshot is
 * inlined; everything else is reachable through the agent toolbox
 * (lib/ai/tools.ts), and persistent memory is injected when present.
 */
export type ChatMode = 'general' | 'training'

export interface ContextInputs {
  profile: Profile | null
  macroTargets: MacroTargets
  todayMeals: Meal[]
  todayWellness: WellnessEntry[]
  todayTotals: DailyTotals
  todayWater: WaterDoc | null
  recentWorkouts: WorkoutSession[]
  /** Error from the recent-workouts listener, so the model is told instead of silently seeing nothing. */
  recentWorkoutsError?: string | null
  latestGlucose: GlucoseReading | null
  /** Persistent scratch-pad memory (users/{uid}/settings/aiScratchPad). */
  memoryNotes?: string
  /** Whether the agent toolbox is attached to this conversation. */
  toolsEnabled?: boolean
  mode?: ChatMode
}

function fmtTimeOfDay(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function buildSystemPrompt(inputs: ContextInputs): string {
  const sections: string[] = []

  const identity = [
    '--- IDENTITY ---',
    'You are StatsKey Intelligence — the intelligence layer over the user\'s own recorded nutrition, training, glucose, and wellness data.',
    'Be concise, specific, and honest. Prefer short answers unless the user asks for depth.',
  ]
  if (inputs.mode === 'training') {
    identity.push(
      'You are in TRAINING COACH mode: lead with training load, pacing execution, recovery balance, and fueling relative to sessions. Read recent workouts closely before advising.'
    )
  }
  sections.push(identity.join('\n'))

  sections.push(
    [
      '--- GROUNDING RULES ---',
      'Ground every quantitative claim in the context below or in tool results. If the data is not there, say you do not know — never invent numbers, meals, workouts, or percentiles.',
      'When you state a finding, cite where it came from in plain language ("your recorded dinners this week", "the March 14 run splits").',
      'StatsKey is a wellness tool, not a medical device: no diagnoses. For concerning symptoms, suggest a clinician while still reading the recorded data honestly.',
      'Recorded nutrition has known error bars (portions, estimates). Treat small differences as noise; flag patterns only when the signal is clear.',
    ].join('\n')
  )

  if (inputs.toolsEnabled) {
    sections.push(
      [
        '--- TOOLS ---',
        "You have tools over the user's full StatsKey record (about a year of meals, workouts, wellness, weights, glucose) plus persistent memory.",
        'Below you only see TODAY\'s snapshot — anything historical must come from tools. Prefer: index_manifest to scope, keyword_search + chunk_read for named things, get_daily_overview for broad ranges before drilling in, and the specific getters for detail.',
        'Use run_subagent for deep side-investigations so the main thread stays focused. Keep tool calls purposeful; do not re-fetch what you already have.',
        'Memory: read get_scratch_pad when useful; call update_scratch_pad (full overwrite) when you learn durable preferences, goals, or confirmed patterns worth keeping across sessions.',
      ].join('\n')
    )
  }

  if (inputs.memoryNotes && inputs.memoryNotes.trim().length > 0) {
    sections.push(
      [
        '--- MEMORY (persistent scratch pad, shared with the iOS app) ---',
        inputs.memoryNotes.trim(),
      ].join('\n')
    )
  }

  const now = new Date()
  sections.push(
    `--- CURRENT TIME ---\n${now.toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })} at ${fmtTimeOfDay(now)}`
  )

  if (inputs.profile) {
    const p = inputs.profile
    const age = p.exactBirthday
      ? Math.floor((now.getTime() - p.exactBirthday.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : p.birthYear
      ? now.getFullYear() - p.birthYear
      : null
    const profileLines = [
      '--- PROFILE ---',
      `Name: ${p.name || '(unset)'}`,
      `Biological profile: ${p.biologicalProfile}`,
      `Weight: ${p.weightLbs.toFixed(0)} lb · Height: ${p.heightFeet}'${p.heightInches}"`,
      age != null ? `Age: ${age}` : 'Age: (unset)',
      `Activity level: ${p.activityLevel}`,
      `Focus: ${p.appFocus}`,
    ]
    sections.push(profileLines.join('\n'))
  }

  const t = inputs.macroTargets
  sections.push(
    [
      '--- TARGETS ---',
      `Calories: ${Math.round(t.calories)} cal`,
      `Protein: ${Math.round(t.protein)}g · Carbs: ${Math.round(t.carbs)}g · Fat: ${Math.round(t.fat)}g · Fiber: ${Math.round(t.fiber)}g`,
      `Water: ${Math.round(t.water)} fl oz`,
      t.isAIAdaptive ? 'Targets are maintained by Adaptive Intelligence' : 'Targets are user-set',
    ].join('\n')
  )

  const totals = inputs.todayTotals
  const lines = [
    '--- TODAY\'S NUTRITION ---',
    `Meals: ${inputs.todayMeals.length}`,
    `Totals: ${Math.round(totals.calories)} cal · ${Math.round(totals.protein)}g P · ${Math.round(totals.carbs)}g C · ${Math.round(totals.fat)}g F · ${Math.round(totals.fiber)}g fiber`,
    `Water: ${Math.round(inputs.todayWater?.amount ?? 0)} fl oz`,
  ]
  for (const m of inputs.todayMeals) {
    const items = m.items.map((i) => i.name).filter(Boolean).slice(0, 6).join(', ')
    lines.push(`  ${fmtTimeOfDay(m.date)} — ${m.name ?? items ?? 'Meal'}`)
  }
  sections.push(lines.join('\n'))

  if (inputs.todayWellness.length > 0) {
    const wellLines = ['--- TODAY\'S WELLNESS ---']
    for (const w of inputs.todayWellness) {
      switch (w.data.kind) {
        case 'mood':
          wellLines.push(`  ${fmtTimeOfDay(w.date)} Mood ${w.data.entry.rating}/5`)
          break
        case 'energy':
          wellLines.push(`  ${fmtTimeOfDay(w.date)} Energy ${w.data.entry.level}/5`)
          break
        case 'symptom':
          wellLines.push(`  ${fmtTimeOfDay(w.date)} Symptom: ${w.data.entry.symptom} (sev ${w.data.entry.severity})`)
          break
        case 'bowelMovement': {
          const bm = w.data.entry
          const burden = bm.giBurdenScore ?? computeGIBurdenScore(bm).score
          wellLines.push(
            `  ${fmtTimeOfDay(w.date)} Gut check: ${bristolSummary(bm)}, GI burden ${burden}/10${bm.color ? `, ${bm.color}` : ''}${bm.redFlags.length ? `, red flags: ${bm.redFlags.join(', ')}` : ''}`
          )
          break
        }
        case 'sleep':
          wellLines.push(`  ${fmtTimeOfDay(w.date)} Sleep ${w.data.hours.toFixed(1)}h, quality ${w.data.quality}/5`)
          break
        case 'hydration':
          wellLines.push(`  ${fmtTimeOfDay(w.date)} Hydration ${w.data.ozConsumed}oz`)
          break
        case 'custom':
          wellLines.push(`  ${fmtTimeOfDay(w.date)} ${w.data.label}: ${w.data.value}${w.data.unit ?? ''}`)
          break
      }
    }
    sections.push(wellLines.join('\n'))
  }

  if (inputs.latestGlucose) {
    const g = inputs.latestGlucose
    sections.push(
      `--- GLUCOSE ---\nLatest: ${Math.round(g.value)} mg/dL (${g.trend ?? 'stable'}) at ${fmtTimeOfDay(g.timestamp)} from ${g.source}`
    )
  }

  const wLines = [`--- RECENT WORKOUTS (newest first · local times in ${localTimeZoneName()}) ---`]
  if (inputs.recentWorkoutsError) {
    wLines.push(
      `Recent workouts could not be loaded (${inputs.recentWorkoutsError}). If asked about training, say the workout record is unavailable right now — do not guess.`
    )
  } else if (inputs.recentWorkouts.length === 0) {
    wLines.push(
      'No workouts are recorded in the last year. If the user says they trained, the session has not synced from their device yet — say so rather than guessing.'
    )
  } else {
    wLines.push(
      'Each line: local date, start–end time (time of day), sport and title, distance in duration, avg pace or speed, heart rate, elevation gain, calories, start coordinates (lat,lon), recording source, workout id. Use get_workout_detail with the id for splits, pauses, HR zones, route points and nearby saved route; use get_workouts (date range or sport_type) for anything older than these.'
    )
    for (const w of inputs.recentWorkouts.slice(0, 10)) wLines.push(formatWorkoutContextLine(w))
  }
  sections.push(wLines.join('\n'))

  return sections.join('\n\n')
}

// Re-export for callers that don't already import the profile type separately.
export type { Profile }
