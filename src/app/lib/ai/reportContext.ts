import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  decodeGlucose,
  decodeMeal,
  decodeWeightEntry,
  decodeWellness,
  decodeWorkout,
} from '../decoders'
import { dailyTotals } from '../aggregates'
import { bristolSummary, computeGIBurdenScore } from '../gi'
import { endOfDay, localDateString, startOfDay } from '../firestore'
import { glucoseStats } from '../data/useGlucoseRange'
import type { ReportTopic } from '../types'
import type { Meal, WellnessEntry, WorkoutSession } from '../types'
import type { UserProfile } from '../profile'

/**
 * Builds the system + user prompts for a server-run Deep Dive report by
 * serializing the user's recorded data for the range — a web equivalent of the
 * iOS ReportService context assembly. The heavy model run happens in the
 * processReportJob Cloud Function.
 */
export async function buildReportPrompts(params: {
  uid: string
  topic: ReportTopic
  rangeStart: Date
  rangeEnd: Date
  profile: UserProfile | null
  customQuestion?: string
}): Promise<{ systemPrompt: string; userPrompt: string }> {
  const { uid, topic, rangeStart, rangeEnd, profile, customQuestion } = params
  const startTs = Timestamp.fromDate(startOfDay(rangeStart))
  const endTs = Timestamp.fromDate(endOfDay(rangeEnd))

  const [mealsSnap, wellnessSnap, workoutsSnap, weightsSnap, glucoseSnap, waterSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'users', uid, 'meals'),
        where('date', '>=', startTs),
        where('date', '<=', endTs),
        orderBy('date', 'asc')
      )
    ),
    getDocs(
      query(
        collection(db, 'users', uid, 'wellness'),
        where('date', '>=', startTs),
        where('date', '<=', endTs),
        orderBy('date', 'asc')
      )
    ),
    getDocs(
      query(
        collection(db, 'users', uid, 'workoutSessions'),
        where('startDate', '>=', startTs),
        where('startDate', '<=', endTs),
        orderBy('startDate', 'asc')
      )
    ),
    getDocs(
      query(
        collection(db, 'users', uid, 'weights'),
        where('date', '>=', startTs),
        where('date', '<=', endTs),
        orderBy('date', 'asc')
      )
    ),
    getDocs(
      query(
        collection(db, 'users', uid, 'glucoseReadings'),
        where('timestamp', '>=', startTs),
        where('timestamp', '<=', endTs),
        orderBy('timestamp', 'asc')
      )
    ),
    getDocs(
      query(
        collection(db, 'users', uid, 'water'),
        where('date', '>=', startTs),
        where('date', '<=', endTs)
      )
    ),
  ])

  const meals = mealsSnap.docs.map((d) => decodeMeal(d.data() as Record<string, unknown>, d.id))
  const wellness = wellnessSnap.docs
    .map((d) => decodeWellness(d.data() as Record<string, unknown>, d.id))
    .filter((w): w is WellnessEntry => w != null)
  const workouts = workoutsSnap.docs.map((d) =>
    decodeWorkout(d.data() as Record<string, unknown>, d.id, uid)
  )
  const weights = weightsSnap.docs.map((d) => decodeWeightEntry(d.data() as Record<string, unknown>, d.id))
  const glucose = glucoseSnap.docs.map((d) => decodeGlucose(d.data() as Record<string, unknown>, d.id))
  const waterByDay = new Map<string, number>()
  for (const d of waterSnap.docs) {
    const raw = d.data() as Record<string, unknown>
    waterByDay.set(d.id, typeof raw.amount === 'number' ? raw.amount : 0)
  }

  const sections: string[] = []

  sections.push(
    [
      "You are StatsKey's expert health data analyst. You produce evidence-aware, practical deep-dive reports from the user's own recorded data.",
      'Write in Markdown with clear section headers. Quantify claims from the data, call out patterns and gaps honestly, and end with specific, prioritized recommendations.',
      'Never fabricate data that is not present below.',
    ].join('\n')
  )

  if (profile) {
    const lines = ['--- PROFILE ---']
    lines.push(`Biological profile: ${profile.biologicalProfile}`)
    lines.push(`Weight: ${profile.weightLbs.toFixed(0)} lb · Height: ${profile.heightFeet}'${profile.heightInches}"`)
    if (profile.birthYear) lines.push(`Age: ~${new Date().getFullYear() - profile.birthYear}`)
    lines.push(`Activity level: ${profile.activityLevel}`)
    if (profile.dietaryPreferences.length) lines.push(`Dietary preferences: ${profile.dietaryPreferences.join(', ')}`)
    if (profile.foodAllergies.length) lines.push(`Food allergies: ${profile.foodAllergies.join(', ')}`)
    if (profile.foodIntolerances.length) lines.push(`Food intolerances: ${profile.foodIntolerances.join(', ')}`)
    if (profile.medicalConditions.length) lines.push(`Medical conditions: ${profile.medicalConditions.join(', ')}`)
    if (profile.healthNotes) lines.push(`Health notes: ${profile.healthNotes}`)
    sections.push(lines.join('\n'))
  }

  sections.push(buildDailyLog(rangeStart, rangeEnd, meals, wellness, workouts, waterByDay))

  if (weights.length > 0) {
    const lines = ['--- WEIGHT ENTRIES ---']
    for (const w of weights) {
      lines.push(
        `${localDateString(w.date)}: ${w.weightLbs.toFixed(1)} lb${
          w.bodyFatPercent != null ? ` (${w.bodyFatPercent.toFixed(1)}% BF)` : ''
        }`
      )
    }
    sections.push(lines.join('\n'))
  }

  if (glucose.length > 0) {
    const byDay = new Map<string, typeof glucose>()
    for (const g of glucose) {
      const key = localDateString(g.timestamp)
      const arr = byDay.get(key)
      if (arr) arr.push(g)
      else byDay.set(key, [g])
    }
    const lines = ['--- GLUCOSE (daily summaries) ---']
    for (const [day, readings] of byDay) {
      const s = glucoseStats(readings)
      if (!s) continue
      lines.push(
        `${day}: ${s.count} readings · avg ${Math.round(s.average)} · range ${Math.round(s.min)}-${Math.round(
          s.max
        )} · ${Math.round(s.timeInRangePercent)}% in 70-180`
      )
    }
    sections.push(lines.join('\n'))
  }

  const systemPrompt = sections.join('\n\n')

  const rangeLabel = `${rangeStart.toLocaleDateString()} to ${rangeEnd.toLocaleDateString()}`
  const userPrompt =
    topic === 'Custom Analysis' && customQuestion?.trim()
      ? `${customQuestion.trim()}\n\nAnalyze the recorded data from ${rangeLabel}.`
      : `${topicInstruction(topic)} Analyze the recorded data from ${rangeLabel}.`

  return { systemPrompt, userPrompt }
}

function topicInstruction(topic: ReportTopic): string {
  switch (topic) {
    case 'GI & Digestion':
      return 'Generate a GI & digestion deep dive: gut check patterns (Bristol distribution, urgency, timing), symptom-food correlations, fiber and hydration adequacy, and gut-brain (mood/stress) links.'
    case 'Nutrition Deep Dive':
      return 'Generate a nutrition deep dive: calorie and macro adherence vs targets, meal timing patterns, food quality and variety, fiber, and the most impactful improvement opportunities.'
    case 'Training & Performance':
      return 'Generate a training & performance report: training load and frequency by sport, pace/heart-rate trends, recovery balance, and fueling relative to training days.'
    case 'Recovery & Wellness':
      return 'Generate a recovery & wellness report: mood, stress, energy and symptom patterns, sleep where recorded, and how they interact with nutrition and training.'
    case 'Body Composition':
      return 'Generate a body composition report: weight trend with a weekly moving view, energy balance vs intake, protein adequacy, and realistic projections.'
    case 'Custom Analysis':
      return 'Generate a comprehensive analysis of the recorded data.'
  }
}

function buildDailyLog(
  start: Date,
  end: Date,
  meals: Meal[],
  wellness: WellnessEntry[],
  workouts: WorkoutSession[],
  waterByDay: Map<string, number>
): string {
  const mealsByDay = groupBy(meals, (m) => localDateString(m.date))
  const wellnessByDay = groupBy(wellness, (w) => localDateString(w.date))
  const workoutsByDay = groupBy(workouts, (w) => localDateString(w.startDate))

  const lines = ['--- DAILY RECORDS ---']
  const cursor = new Date(start)
  cursor.setHours(12, 0, 0, 0)
  const endKey = localDateString(end)

  while (localDateString(cursor) <= endKey) {
    const key = localDateString(cursor)
    const dayMeals = mealsByDay.get(key) ?? []
    const dayWellness = wellnessByDay.get(key) ?? []
    const dayWorkouts = workoutsByDay.get(key) ?? []
    const water = waterByDay.get(key)

    if (dayMeals.length || dayWellness.length || dayWorkouts.length || (water ?? 0) > 0) {
      lines.push(`\n${key}:`)
      if (dayMeals.length) {
        const t = dailyTotals(dayMeals)
        lines.push(
          `  Nutrition: ${Math.round(t.calories)} cal, ${Math.round(t.protein)}g P, ${Math.round(
            t.carbs
          )}g C, ${Math.round(t.fat)}g F, ${Math.round(t.fiber)}g fiber (${dayMeals.length} meals)`
        )
        for (const m of dayMeals) {
          const names = m.items.map((i) => i.name).filter(Boolean).slice(0, 8).join(', ')
          lines.push(`    ${fmtTime(m.date)} — ${m.name ?? (names || 'Meal')}${names && m.name ? ` (${names})` : ''}`)
        }
      }
      if (water != null && water > 0) lines.push(`  Water: ${Math.round(water)} fl oz`)
      for (const w of dayWorkouts) {
        lines.push(
          `  Workout: ${w.sportType} ${w.distance > 0 ? `${w.distance.toFixed(1)} mi ` : ''}${
            w.duration > 0 ? `${Math.round(w.duration / 60)}min ` : ''
          }${w.calories > 0 ? `${Math.round(w.calories)} cal` : ''}`.trimEnd()
        )
      }
      for (const w of dayWellness) {
        lines.push(`  Wellness: ${wellnessLine(w)}`)
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return lines.join('\n')
}

function wellnessLine(w: WellnessEntry): string {
  switch (w.data.kind) {
    case 'mood':
      return `${fmtTime(w.date)} mood ${w.data.entry.rating}/5${
        w.data.entry.stress != null ? `, stress ${w.data.entry.stress}/10` : ''
      }`
    case 'energy':
      return `${fmtTime(w.date)} energy ${w.data.entry.level}/5`
    case 'symptom':
      return `${fmtTime(w.date)} symptom: ${w.data.entry.symptom} (severity ${w.data.entry.severity})`
    case 'bowelMovement': {
      const bm = w.data.entry
      const burden = bm.giBurdenScore ?? computeGIBurdenScore(bm).score
      return `${fmtTime(w.date)} gut check: ${bristolSummary(bm)}, GI burden ${burden}/10${
        bm.urgency != null ? `, urgency ${bm.urgency}/5` : ''
      }${bm.redFlags.length ? `, red flags: ${bm.redFlags.join(', ')}` : ''}`
    }
    case 'sleep':
      return `${fmtTime(w.date)} sleep ${w.data.hours.toFixed(1)}h`
    case 'hydration':
      return `${fmtTime(w.date)} hydration ${Math.round(w.data.ozConsumed)} oz`
    case 'custom':
      return `${fmtTime(w.date)} ${w.data.label}: ${w.data.value}${w.data.unit ?? ''}`
  }
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const arr = map.get(key)
    if (arr) arr.push(item)
    else map.set(key, [item])
  }
  return map
}
