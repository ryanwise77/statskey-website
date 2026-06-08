import type { DailyTotals } from '../aggregates'
import type {
  GlucoseReading,
  MacroTargets,
  Meal,
  WaterDoc,
  WellnessEntry,
  WorkoutSession,
} from '../types'
import type { UserProfile as Profile } from '../profile'

/**
 * Builds a plain-text system prompt matching the section format iOS uses in
 * biometrics/StatsKey/Services/AIContextBuilder.swift. Simpler than iOS —
 * no tool instructions (Phase 3 web chat is tool-free for now), no vitamin D
 * estimator, no complete nutrient dump. Enough for Claude to be useful for
 * questions about today and the recent past.
 */
export interface ContextInputs {
  profile: Profile | null
  macroTargets: MacroTargets
  todayMeals: Meal[]
  todayWellness: WellnessEntry[]
  todayTotals: DailyTotals
  todayWater: WaterDoc | null
  recentWorkouts: WorkoutSession[]
  latestGlucose: GlucoseReading | null
}

function fmtTimeOfDay(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function buildSystemPrompt(inputs: ContextInputs): string {
  const sections: string[] = []

  sections.push(
    [
      '--- IDENTITY ---',
      'You are StatsKey Intelligence — an AI assistant that helps the user understand their nutrition, training, and biometric data.',
      'Be concise, specific, and honest. Prefer short answers unless the user asks for depth.',
    ].join('\n')
  )

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
      t.isAIAdaptive ? 'Targets are AI-adaptive' : 'Targets are user-set',
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
        case 'bowelMovement':
          wellLines.push(`  ${fmtTimeOfDay(w.date)} Gut check: Bristol ${w.data.entry.bristolType}${w.data.entry.color ? `, ${w.data.entry.color}` : ''}`)
          break
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

  if (inputs.recentWorkouts.length > 0) {
    const wLines = ['--- RECENT WORKOUTS ---']
    for (const w of inputs.recentWorkouts.slice(0, 10)) {
      const dur = w.duration > 0 ? `${Math.round(w.duration / 60)}m` : ''
      const dist = w.distance > 0 ? `${w.distance.toFixed(2)} mi` : ''
      wLines.push(
        `  ${w.startDate.toLocaleDateString()} ${w.sportType} ${dist}${dist && dur ? ' in ' : ''}${dur}${w.calories > 0 ? ` · ${Math.round(w.calories)} cal` : ''}`
      )
    }
    sections.push(wLines.join('\n'))
  }

  return sections.join('\n\n')
}

// Re-export for callers that don't already import the profile type separately.
export type { Profile }
