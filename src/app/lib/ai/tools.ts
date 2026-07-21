import {
  collection,
  getDocs,
  limit as fsLimit,
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
import { dailyTotals, mealTotal, mealDisplayName } from '../aggregates'
import { bristolSummary, computeGIBurdenScore } from '../gi'
import { localDateString } from '../firestore'
import { NUTRIENT_KEYS } from '../types'
import type { GlucoseReading, Meal, WellnessEntry, WorkoutSession, WeightEntry, Split } from '../types'
import type { AnthropicToolDef } from './anthropic'
import { getScratchPad, updateScratchPad } from './scratchPad'

/**
 * The web agent's toolbox. Tool names, parameters, and result shapes mirror
 * the iOS ChatToolRouter (see biometrics/StatsKey/Services/ChatToolRouter.swift
 * and docs/ai-prompt-engineering/flow-chat-evals/flow-tools.mjs) so prompts
 * and behaviors stay consistent across platforms. Executors run client-side
 * against the same Firestore record iOS writes.
 */

const TOOL_RESULT_MAX_CHARS = 20000
const HISTORY_DAYS = 366

export const AGENT_TOOLS: AnthropicToolDef[] = [
  {
    name: 'index_manifest',
    description:
      'Inspect the StatsKey record: counts and date coverage for meals, workouts, wellness, weights, and glucose. Use before broad data exploration.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'keyword_search',
    description:
      'Fast lexical search over the normalized StatsKey record (meals, workouts, wellness). Use for exact foods, symptoms, sports, supplements, or named things. Follow up with chunk_read for full detail.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: { type: 'integer', description: 'Max results, default 20.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'chunk_read',
    description: 'Read full indexed chunks returned by keyword_search.',
    input_schema: {
      type: 'object',
      properties: { chunk_ids: { type: 'array', items: { type: 'string' } } },
      required: ['chunk_ids'],
    },
  },
  {
    name: 'get_meals',
    description: 'Get recorded meals with nutrition breakdown. Defaults to today. Use days_back for broader periods.',
    input_schema: {
      type: 'object',
      properties: { days_back: { type: 'integer', description: '0=today, 7=week, 30=month, 365=year.' } },
      required: [],
    },
  },
  {
    name: 'get_meals_for_date',
    description: 'All meals for a specific date with full item detail.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'get_daily_overview',
    description:
      'Lightweight daily overview for a date range: meal count, calories/protein/fiber, water, workout minutes, Bristol stool types, symptom count. Use for broad ranges before drilling in.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'search_food_history',
    description:
      'Search all recorded meals for a food/ingredient by name. Returns occurrences with nutrients and wellness events within 24h after each.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        days_back: { type: 'integer', description: 'Default 365.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_workouts',
    description: 'Get workout sessions with distance, pace, heart rate, and split counts. Supports limit or date range.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: [],
    },
  },
  {
    name: 'get_workout_detail',
    description:
      "One workout's evidence packet: summary, per-mile splits, pause estimate, elevation, HR zones, and data availability. Defaults to the latest run when workout_id is omitted.",
    input_schema: {
      type: 'object',
      properties: {
        workout_id: { type: 'string' },
        latest: { type: 'boolean', description: 'If true or workout_id omitted, use the latest running workout.' },
      },
      required: [],
    },
  },
  {
    name: 'analyze_run_segments',
    description:
      'Analyze a run for pacing execution: split drift, pace variability, fast/slow stretches, elevation by mile, and data-quality notes.',
    input_schema: {
      type: 'object',
      properties: {
        workout_id: { type: 'string' },
        latest: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'get_glucose_readings',
    description:
      'Authoritative raw glucose timeline for a date range with summary stats (avg, range, time-in-range, lows). Use for trend analysis and meal/training glucose questions.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, defaults to start_date.' },
        limit: { type: 'integer', description: 'Max readings returned (evenly downsampled above this), default 400.' },
      },
      required: ['start_date'],
    },
  },
  {
    name: 'get_wellness',
    description: 'Wellness entries (mood, energy, symptoms, gut checks) across a lookback period, with entry IDs usable in get_meals_before_event.',
    input_schema: {
      type: 'object',
      properties: { days_back: { type: 'integer', description: 'Default 30.' } },
      required: [],
    },
  },
  {
    name: 'get_meals_before_event',
    description: 'Given a wellness entry ID, returns the meals eaten in the hours before that event. Core tool for trigger analysis.',
    input_schema: {
      type: 'object',
      properties: {
        wellness_id: { type: 'string' },
        hours_before: { type: 'integer', description: 'Default 18.' },
      },
      required: ['wellness_id'],
    },
  },
  {
    name: 'get_weight_history',
    description: 'Weight entries (lbs, body fat % when recorded) most recent first.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Default 60.' } },
      required: [],
    },
  },
  {
    name: 'get_nutrient_totals',
    description:
      'Per-day totals for any tracked nutrient key over a range (e.g. potassium, magnesium, vitamin_d, added_sugars, saturated_fat). Use for micronutrient adequacy questions.',
    input_schema: {
      type: 'object',
      properties: {
        nutrient: { type: 'string', description: 'Snake_case USDA key, e.g. potassium, dietary_fiber, vitamin_d.' },
        days_back: { type: 'integer', description: 'Default 30.' },
      },
      required: ['nutrient'],
    },
  },
  {
    name: 'get_scratch_pad',
    description: 'Read the persistent Intelligence memory notes for this user (shared with the iOS app).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_scratch_pad',
    description:
      'Overwrite the persistent Intelligence memory notes. Keep them concise and durable: preferences, goals, recurring patterns, things to remember across sessions. Always write the FULL notes content.',
    input_schema: {
      type: 'object',
      properties: { notes: { type: 'string' } },
      required: ['notes'],
    },
  },
  {
    name: 'run_subagent',
    description:
      'Dispatch a focused subagent with its own tool budget to investigate one narrow question over the record (e.g. "find every high-sodium dinner in March and the morning weights after"). Returns its findings. Use for deep side-quests so the main thread stays focused.',
    input_schema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'One specific, self-contained investigation objective.' },
      },
      required: ['objective'],
    },
  },
]

/** Tool defs the nested subagent gets (no recursive dispatch, no memory writes). */
export const SUBAGENT_TOOLS: AnthropicToolDef[] = AGENT_TOOLS.filter(
  (t) => t.name !== 'run_subagent' && t.name !== 'update_scratch_pad' && t.name !== 'get_scratch_pad'
)

// ---------------------------------------------------------------------------
// Data cache — one-shot ranged fetches, shared across all tool calls in a turn.
// ---------------------------------------------------------------------------

interface IndexChunk {
  id: string
  sourceType: 'meal' | 'workout' | 'wellness'
  sourceId: string
  date: string
  title: string
  summary: string
  text: string
}

export class AgentDataCache {
  private mealsP: Promise<Meal[]> | null = null
  private workoutsP: Promise<WorkoutSession[]> | null = null
  private wellnessP: Promise<WellnessEntry[]> | null = null
  private weightsP: Promise<WeightEntry[]> | null = null
  private waterP: Promise<Map<string, number>> | null = null
  private indexP: Promise<IndexChunk[]> | null = null

  constructor(private uid: string) {}

  private historyStart(): Timestamp {
    const d = new Date()
    d.setDate(d.getDate() - HISTORY_DAYS)
    return Timestamp.fromDate(d)
  }

  meals(): Promise<Meal[]> {
    this.mealsP ??= getDocs(
      query(
        collection(db, 'users', this.uid, 'meals'),
        where('date', '>=', this.historyStart()),
        orderBy('date', 'desc'),
        fsLimit(2000)
      )
    ).then((snap) => snap.docs.map((d) => decodeMeal(d.data() as Record<string, unknown>, d.id)))
    return this.mealsP
  }

  workouts(): Promise<WorkoutSession[]> {
    this.workoutsP ??= getDocs(
      query(
        collection(db, 'users', this.uid, 'workoutSessions'),
        where('startDate', '>=', this.historyStart()),
        orderBy('startDate', 'desc'),
        fsLimit(600)
      )
    ).then((snap) => snap.docs.map((d) => decodeWorkout(d.data() as Record<string, unknown>, d.id, this.uid)))
    return this.workoutsP
  }

  wellness(): Promise<WellnessEntry[]> {
    this.wellnessP ??= getDocs(
      query(
        collection(db, 'users', this.uid, 'wellness'),
        where('date', '>=', this.historyStart()),
        orderBy('date', 'desc'),
        fsLimit(1500)
      )
    ).then((snap) =>
      snap.docs
        .map((d) => decodeWellness(d.data() as Record<string, unknown>, d.id))
        .filter((w): w is WellnessEntry => w != null)
    )
    return this.wellnessP
  }

  weights(): Promise<WeightEntry[]> {
    this.weightsP ??= getDocs(
      query(collection(db, 'users', this.uid, 'weights'), orderBy('date', 'desc'), fsLimit(400))
    ).then((snap) => snap.docs.map((d) => decodeWeightEntry(d.data() as Record<string, unknown>, d.id)))
    return this.weightsP
  }

  water(): Promise<Map<string, number>> {
    this.waterP ??= getDocs(
      query(collection(db, 'users', this.uid, 'water'), where('date', '>=', this.historyStart()))
    ).then((snap) => {
      const map = new Map<string, number>()
      for (const d of snap.docs) {
        const raw = d.data() as { amount?: unknown }
        map.set(d.id, typeof raw.amount === 'number' ? raw.amount : 0)
      }
      return map
    })
    return this.waterP
  }

  async glucose(start: Date, end: Date): Promise<GlucoseReading[]> {
    const snap = await getDocs(
      query(
        collection(db, 'users', this.uid, 'glucoseReadings'),
        where('timestamp', '>=', Timestamp.fromDate(start)),
        where('timestamp', '<=', Timestamp.fromDate(end)),
        orderBy('timestamp', 'asc')
      )
    )
    return snap.docs.map((d) => decodeGlucose(d.data() as Record<string, unknown>, d.id))
  }

  /** Latest glucose timestamp — cheap coverage probe for the manifest. */
  async glucoseCoverage(): Promise<{ latest: string | null }> {
    const snap = await getDocs(
      query(collection(db, 'users', this.uid, 'glucoseReadings'), orderBy('timestamp', 'desc'), fsLimit(1))
    )
    const d = snap.docs[0]
    if (!d) return { latest: null }
    const reading = decodeGlucose(d.data() as Record<string, unknown>, d.id)
    return { latest: reading.timestamp.toISOString() }
  }

  index(): Promise<IndexChunk[]> {
    this.indexP ??= Promise.all([this.meals(), this.workouts(), this.wellness()]).then(
      ([meals, workouts, wellness]) => {
        const chunks: IndexChunk[] = []
        for (const m of meals) {
          const items = m.items
            .map((i) => `${i.brand ? `${i.brand} ` : ''}${i.name}`)
            .filter(Boolean)
          chunks.push({
            id: `meal:${m.id}`,
            sourceType: 'meal',
            sourceId: m.id,
            date: localDateString(m.date),
            title: mealDisplayName(m),
            summary: `${items.slice(0, 6).join(', ')} — ${Math.round(mealTotal(m, NUTRIENT_KEYS.calories))} cal, ${Math.round(
              mealTotal(m, NUTRIENT_KEYS.protein)
            )}g protein`,
            text: items.join(', '),
          })
        }
        for (const w of workouts) {
          const dur = w.duration > 0 ? `${Math.round(w.duration / 60)}min` : ''
          chunks.push({
            id: `workout:${w.id}`,
            sourceType: 'workout',
            sourceId: w.id,
            date: localDateString(w.startDate),
            title: w.title || w.sportType,
            summary: `${w.sportType} ${w.distance > 0 ? `${w.distance.toFixed(2)} mi ` : ''}${dur}${
              w.averageHeartRate > 0 ? ` · ${Math.round(w.averageHeartRate)} bpm avg` : ''
            }`,
            text: `${w.sportType} ${w.notes ?? ''}`,
          })
        }
        for (const e of wellness) {
          chunks.push({
            id: `wellness:${e.id}`,
            sourceType: 'wellness',
            sourceId: e.id,
            date: localDateString(e.date),
            title: wellnessTitle(e),
            summary: wellnessSummary(e),
            text: `${wellnessSummary(e)} ${e.notes ?? ''}`,
          })
        }
        return chunks
      }
    )
    return this.indexP
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ToolExecution {
  /** JSON string handed back to the model (truncated). */
  content: string
  /** Short human line for the UI, e.g. "12 meals · 4 matches". */
  resultMeta: string
  isError: boolean
}

export async function executeTool(
  uid: string,
  cache: AgentDataCache,
  name: string,
  input: Record<string, unknown>
): Promise<ToolExecution> {
  try {
    const result = await dispatch(uid, cache, name, input)
    const full = JSON.stringify(result, jsonDates, 1)
    const content =
      full.length <= TOOL_RESULT_MAX_CHARS
        ? full
        : `${full.slice(0, TOOL_RESULT_MAX_CHARS)}\n… TRUNCATED (${full.length} chars). Narrow the query for full detail.`
    return { content, resultMeta: metaFor(name, result), isError: false }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { content: JSON.stringify({ error: message }), resultMeta: 'failed', isError: true }
  }
}

function jsonDates(_key: string, value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value
}

type ToolResult = Record<string, unknown>

async function dispatch(
  uid: string,
  cache: AgentDataCache,
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'index_manifest':
      return indexManifest(cache)
    case 'keyword_search':
      return keywordSearch(cache, str(input.query), int(input.limit, 20))
    case 'chunk_read':
      return chunkRead(cache, Array.isArray(input.chunk_ids) ? input.chunk_ids.map(String) : [])
    case 'get_meals':
      return getMeals(cache, int(input.days_back, 0))
    case 'get_meals_for_date':
      return getMealsForDate(cache, str(input.date))
    case 'get_daily_overview':
      return getDailyOverview(cache, str(input.start_date), str(input.end_date))
    case 'search_food_history':
      return searchFoodHistory(cache, str(input.query), int(input.days_back, 365))
    case 'get_workouts':
      return getWorkouts(cache, input)
    case 'get_workout_detail':
      return getWorkoutDetail(cache, input)
    case 'analyze_run_segments':
      return analyzeRunSegments(cache, input)
    case 'get_glucose_readings':
      return getGlucoseReadings(cache, input)
    case 'get_wellness':
      return getWellness(cache, int(input.days_back, 30))
    case 'get_meals_before_event':
      return getMealsBeforeEvent(cache, str(input.wellness_id), int(input.hours_before, 18))
    case 'get_weight_history':
      return getWeightHistory(cache, int(input.limit, 60))
    case 'get_nutrient_totals':
      return getNutrientTotals(cache, str(input.nutrient), int(input.days_back, 30))
    case 'get_scratch_pad': {
      const pad = await getScratchPad(uid)
      return { notes: pad.notes, updatedAt: pad.updatedAt?.toISOString() ?? null }
    }
    case 'update_scratch_pad': {
      const notes = str(input.notes)
      await updateScratchPad(uid, notes)
      return { saved: true, chars: notes.length }
    }
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

function metaFor(name: string, result: ToolResult): string {
  const r = result as Record<string, unknown>
  const count = (v: unknown) => (Array.isArray(v) ? v.length : null)
  switch (name) {
    case 'index_manifest': {
      const s = r.sources as Record<string, number> | undefined
      return s ? `${s.meal ?? 0} meals · ${s.workout ?? 0} workouts · ${s.wellness ?? 0} wellness` : 'ready'
    }
    case 'keyword_search':
      return `${count(r.results) ?? 0} matches`
    case 'chunk_read':
      return `${count(r.chunks) ?? 0} chunks`
    case 'get_meals':
    case 'get_meals_for_date':
      return `${count(r.items) ?? 0} meals`
    case 'get_daily_overview':
      return `${count(r.days) ?? 0} days`
    case 'search_food_history':
      return `${count(r.results) ?? 0} occurrences`
    case 'get_workouts':
      return `${count(r.items) ?? 0} workouts`
    case 'get_workout_detail':
    case 'analyze_run_segments': {
      const w = r.workout as { sportType?: string; startDate?: string } | undefined
      return w ? `${w.sportType ?? 'workout'} · ${(w.startDate ?? '').slice(0, 10)}` : 'not found'
    }
    case 'get_glucose_readings': {
      const s = r.summary as { count?: number; avg?: number } | undefined
      return s?.count ? `${s.count} readings · avg ${s.avg}` : 'no readings'
    }
    case 'get_wellness':
      return `${count(r.items) ?? 0} entries`
    case 'get_meals_before_event':
      return `${count(r.meals) ?? 0} meals before`
    case 'get_weight_history':
      return `${count(r.items) ?? 0} entries`
    case 'get_nutrient_totals': {
      const d = count(r.days) ?? 0
      const avg = r.daily_avg
      return `${d} days · avg ${typeof avg === 'number' ? Math.round(avg * 10) / 10 : '—'}`
    }
    case 'get_scratch_pad': {
      const n = typeof r.notes === 'string' ? r.notes.length : 0
      return n > 0 ? `${n} chars of memory` : 'empty'
    }
    case 'update_scratch_pad':
      return 'memory updated'
    default:
      return 'done'
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function indexManifest(cache: AgentDataCache): Promise<ToolResult> {
  const [meals, workouts, wellness, weights, glucose] = await Promise.all([
    cache.meals(),
    cache.workouts(),
    cache.wellness(),
    cache.weights(),
    cache.glucoseCoverage(),
  ])
  return {
    horizon_days: HISTORY_DAYS,
    sources: { meal: meals.length, workout: workouts.length, wellness: wellness.length, weight: weights.length },
    ranges: {
      meals: rangeOf(meals.map((m) => m.date)),
      workouts: rangeOf(workouts.map((w) => w.startDate)),
      wellness: rangeOf(wellness.map((w) => w.date)),
      weights: rangeOf(weights.map((w) => w.date)),
      glucose_latest: glucose.latest,
    },
  }
}

function rangeOf(dates: Date[]): { from: string; to: string; count: number } | null {
  if (dates.length === 0) return null
  let min = dates[0]
  let max = dates[0]
  for (const d of dates) {
    if (d < min) min = d
    if (d > max) max = d
  }
  return { from: localDateString(min), to: localDateString(max), count: dates.length }
}

async function keywordSearch(cache: AgentDataCache, q: string, limit: number): Promise<ToolResult> {
  const terms = tokenize(q)
  const index = await cache.index()
  const scored = index
    .map((doc) => {
      const text = `${doc.title} ${doc.summary} ${doc.text} ${doc.date}`.toLowerCase()
      const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
      return { doc, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.doc.date < b.doc.date ? 1 : -1))
    .slice(0, Math.max(1, Math.min(limit, 60)))
  return {
    query: q,
    results: scored.map(({ doc, score }) => ({
      chunk_id: doc.id,
      sourceType: doc.sourceType,
      date: doc.date,
      title: doc.title,
      snippet: doc.summary,
      score,
    })),
  }
}

async function chunkRead(cache: AgentDataCache, ids: string[]): Promise<ToolResult> {
  const wanted = new Set(ids)
  const [index, meals, workouts, wellness] = await Promise.all([
    cache.index(),
    cache.meals(),
    cache.workouts(),
    cache.wellness(),
  ])
  const chunks: ToolResult[] = []
  for (const doc of index) {
    if (!wanted.has(doc.id)) continue
    if (doc.sourceType === 'meal') {
      const meal = meals.find((m) => m.id === doc.sourceId)
      if (meal) chunks.push({ id: doc.id, date: doc.date, ...compactMeal(meal, true) })
    } else if (doc.sourceType === 'workout') {
      const w = workouts.find((x) => x.id === doc.sourceId)
      if (w) chunks.push({ id: doc.id, date: doc.date, ...compactWorkout(w) })
    } else {
      const e = wellness.find((x) => x.id === doc.sourceId)
      if (e) chunks.push({ id: doc.id, date: doc.date, ...compactWellness(e) })
    }
  }
  return { chunks }
}

async function getMeals(cache: AgentDataCache, daysBack: number): Promise<ToolResult> {
  const meals = await cache.meals()
  const cutoff = cutoffDate(daysBack)
  const items = meals.filter((m) => m.date >= cutoff).slice(0, 150).map((m) => compactMeal(m, daysBack <= 7))
  return { days_back: daysBack, items, truncated: items.length === 150 }
}

async function getMealsForDate(cache: AgentDataCache, date: string): Promise<ToolResult> {
  const meals = await cache.meals()
  return { date, items: meals.filter((m) => localDateString(m.date) === date).map((m) => compactMeal(m, true)) }
}

async function getDailyOverview(cache: AgentDataCache, startDate: string, endDate: string): Promise<ToolResult> {
  const [meals, wellness, workouts, water] = await Promise.all([
    cache.meals(),
    cache.wellness(),
    cache.workouts(),
    cache.water(),
  ])
  const mealsByDay = groupBy(meals, (m) => localDateString(m.date))
  const wellnessByDay = groupBy(wellness, (w) => localDateString(w.date))
  const workoutsByDay = groupBy(workouts, (w) => localDateString(w.startDate))

  const days: ToolResult[] = []
  const cursor = new Date(`${startDate}T12:00:00`)
  const endKey = endDate
  let guard = 0
  while (localDateString(cursor) <= endKey && guard < 400) {
    const key = localDateString(cursor)
    const dayMeals = mealsByDay.get(key) ?? []
    const dayWellness = wellnessByDay.get(key) ?? []
    const dayWorkouts = workoutsByDay.get(key) ?? []
    const totals = dailyTotals(dayMeals)
    days.push({
      date: key,
      mealCount: dayMeals.length,
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      fiber: Math.round(totals.fiber),
      water_oz: Math.round(water.get(key) ?? 0),
      workoutMinutes: Math.round(dayWorkouts.reduce((s, w) => s + w.duration / 60, 0)),
      bristolTypes: dayWellness
        .map((w) => (w.data.kind === 'bowelMovement' ? Number(w.data.entry.bristolType) : null))
        .filter((x): x is number => x != null),
      symptomCount: dayWellness.filter((w) => w.data.kind === 'symptom').length,
    })
    cursor.setDate(cursor.getDate() + 1)
    guard += 1
  }
  return { start_date: startDate, end_date: endDate, days }
}

async function searchFoodHistory(cache: AgentDataCache, q: string, daysBack: number): Promise<ToolResult> {
  const terms = tokenize(q)
  const cutoff = cutoffDate(daysBack)
  const [meals, wellness] = await Promise.all([cache.meals(), cache.wellness()])
  const results: ToolResult[] = []
  for (const meal of meals) {
    if (meal.date < cutoff) continue
    const hits = meal.items.filter((item) => {
      const text = `${item.brand ?? ''} ${item.name}`.toLowerCase()
      return terms.some((t) => text.includes(t))
    })
    if (hits.length === 0) continue
    const after = new Date(meal.date.getTime() + 24 * 3600 * 1000)
    results.push({
      meal: compactMeal(meal, false),
      matchedItems: hits.map((i) => ({
        name: i.name,
        brand: i.brand,
        calories: Math.round(i.nutrients[NUTRIENT_KEYS.calories] ?? 0),
        sodium_mg: Math.round(i.nutrients[NUTRIENT_KEYS.sodium] ?? 0),
      })),
      wellnessWithin24h: wellness
        .filter((w) => w.date >= meal.date && w.date <= after)
        .slice(0, 6)
        .map(compactWellness),
    })
    if (results.length >= 60) break
  }
  return { query: q, days_back: daysBack, results, truncated: results.length >= 60 }
}

async function getWorkouts(cache: AgentDataCache, input: Record<string, unknown>): Promise<ToolResult> {
  let workouts = await cache.workouts()
  const start = typeof input.start_date === 'string' ? new Date(`${input.start_date}T00:00:00`) : null
  const end = typeof input.end_date === 'string' ? new Date(`${input.end_date}T23:59:59`) : null
  if (start) workouts = workouts.filter((w) => w.startDate >= start && (!end || w.startDate <= end))
  const limit = start ? 200 : int(input.limit, 20)
  return { items: workouts.slice(0, limit).map(compactWorkout) }
}

async function resolveWorkout(
  cache: AgentDataCache,
  input: Record<string, unknown>
): Promise<WorkoutSession | undefined> {
  const workouts = await cache.workouts()
  const id = typeof input.workout_id === 'string' ? input.workout_id : null
  if (id) return workouts.find((w) => w.id === id || w.healthKitUUID === id)
  return workouts.find((w) => w.sportType.toLowerCase().includes('run')) ?? workouts[0]
}

async function getWorkoutDetail(cache: AgentDataCache, input: Record<string, unknown>): Promise<ToolResult> {
  const w = await resolveWorkout(cache, input)
  if (!w) return { error: 'Workout not found' }
  return {
    workout: compactWorkout(w),
    source: w.source,
    is_indoor: w.isIndoor,
    availability: {
      splits_total: w.splits.length,
      route_points_inline: w.routeCoordinates.length,
      has_average_hr: w.averageHeartRate > 0,
      has_hr_zones: w.heartRateZones != null,
      has_elevation: w.elevationGain > 0 || w.elevationLoss > 0,
    },
    pause_summary: pauseSummary(w),
    splits: w.splits.map(formatSplit),
    heart_rate_zones: w.heartRateZones ?? null,
    notes: w.notes ?? null,
    perceived_effort: w.perceivedEffort ?? null,
  }
}

async function analyzeRunSegments(cache: AgentDataCache, input: Record<string, unknown>): Promise<ToolResult> {
  const w = await resolveWorkout(cache, input)
  if (!w) return { error: 'Run not found' }
  const clean = w.splits.filter((s) => s.pace > 0)
  const paces = clean.map((s) => s.pace)
  const firstHalf = paces.slice(0, Math.ceil(paces.length / 2))
  const secondHalf = paces.slice(Math.floor(paces.length / 2))
  const drift = avg(secondHalf) - avg(firstHalf)
  const avgPace = avg(paces)
  return {
    workout: compactWorkout(w),
    pause_summary: pauseSummary(w),
    pacing:
      clean.length === 0
        ? { count: 0, note: 'No split data available.' }
        : {
            count: clean.length,
            avg_pace: formatPace(avgPace),
            fastest_mile: formatPace(Math.min(...paces)),
            slowest_mile: formatPace(Math.max(...paces)),
            pace_sd_sec: Math.round(stddev(paces)),
            drift_sec_per_mile: Math.round(drift),
            execution_label: Math.abs(drift) < 10 ? 'even' : drift < 0 ? 'negative_split' : 'positive_split_or_fade',
          },
    split_stretches: clean.map((s, i) => ({
      mile: s.number,
      pace: formatPace(s.pace),
      vs_avg_sec: Math.round(s.pace - avgPace),
      label: s.pace < avgPace - 15 ? 'fast_stretch' : s.pace > avgPace + 15 ? 'slow_stretch' : 'steady',
      elevation_net_ft: Math.round(s.elevationGain - s.elevationLoss),
      avg_hr: s.averageHeartRate ?? null,
      previous_delta_sec: i === 0 ? null : Math.round(s.pace - clean[i - 1].pace),
    })),
    data_quality: w.splits.length === 0 ? 'summary_only' : w.averageHeartRate > 0 ? 'rich' : 'moderate',
  }
}

async function getGlucoseReadings(cache: AgentDataCache, input: Record<string, unknown>): Promise<ToolResult> {
  const startDate = str(input.start_date)
  const endDate = typeof input.end_date === 'string' ? input.end_date : startDate
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T23:59:59`)
  const readings = await cache.glucose(start, end)
  const values = readings.map((r) => r.value)
  const summary =
    values.length === 0
      ? { count: 0 }
      : {
          count: values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
          below_70: values.filter((v) => v < 70).length,
          in_70_180: values.filter((v) => v >= 70 && v <= 180).length,
          above_180: values.filter((v) => v > 180).length,
          time_in_range_pct: Math.round((values.filter((v) => v >= 70 && v <= 180).length / values.length) * 100),
        }
  const limit = Math.max(20, Math.min(int(input.limit, 400), 1000))
  const items = downsample(readings, limit).map((r) => ({
    t: r.timestamp.toISOString(),
    mgdl: Math.round(r.value),
    trend: r.trend ?? null,
  }))
  return { start_date: startDate, end_date: endDate, summary, downsampled_to: items.length, items }
}

async function getWellness(cache: AgentDataCache, daysBack: number): Promise<ToolResult> {
  const wellness = await cache.wellness()
  const cutoff = cutoffDate(daysBack)
  const items = wellness.filter((w) => w.date >= cutoff).slice(0, 250).map(compactWellness)
  return { days_back: daysBack, items, truncated: items.length === 250 }
}

async function getMealsBeforeEvent(cache: AgentDataCache, wellnessId: string, hoursBefore: number): Promise<ToolResult> {
  const [wellness, meals] = await Promise.all([cache.wellness(), cache.meals()])
  const event = wellness.find((w) => w.id === wellnessId)
  if (!event) return { error: `No wellness entry found for ${wellnessId}` }
  const start = new Date(event.date.getTime() - hoursBefore * 3600 * 1000)
  return {
    event: compactWellness(event),
    hours_before: hoursBefore,
    meals: meals
      .filter((m) => m.date >= start && m.date <= event.date)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((m) => compactMeal(m, true)),
  }
}

async function getWeightHistory(cache: AgentDataCache, limit: number): Promise<ToolResult> {
  const weights = await cache.weights()
  return {
    items: weights.slice(0, Math.min(limit, 200)).map((w) => ({
      date: localDateString(w.date),
      lbs: Math.round(w.weightLbs * 10) / 10,
      body_fat_pct: w.bodyFatPercent ?? null,
    })),
  }
}

async function getNutrientTotals(cache: AgentDataCache, nutrient: string, daysBack: number): Promise<ToolResult> {
  const meals = await cache.meals()
  const cutoff = cutoffDate(daysBack)
  const byDay = new Map<string, number>()
  for (const m of meals) {
    if (m.date < cutoff) continue
    const key = localDateString(m.date)
    byDay.set(key, (byDay.get(key) ?? 0) + mealTotal(m, nutrient))
  }
  const days = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, total]) => ({ date, total: Math.round(total * 10) / 10 }))
  const daysWithData = days.filter((d) => d.total > 0)
  return {
    nutrient,
    days_back: daysBack,
    days,
    daily_avg: daysWithData.length
      ? Math.round((daysWithData.reduce((s, d) => s + d.total, 0) / daysWithData.length) * 10) / 10
      : 0,
    note: 'Averages use days with any recorded intake. Nutrient coverage depends on source data; missing values read as 0.',
  }
}

// ---------------------------------------------------------------------------
// Compactors + small utils
// ---------------------------------------------------------------------------

function compactMeal(meal: Meal, withItems: boolean): ToolResult {
  const base: ToolResult = {
    meal_id: meal.id,
    date: meal.date.toISOString(),
    name: mealDisplayName(meal),
    totals: {
      calories: Math.round(mealTotal(meal, NUTRIENT_KEYS.calories)),
      protein: Math.round(mealTotal(meal, NUTRIENT_KEYS.protein)),
      carbs: Math.round(mealTotal(meal, NUTRIENT_KEYS.carbs)),
      fat: Math.round(mealTotal(meal, NUTRIENT_KEYS.fat)),
      fiber: Math.round(mealTotal(meal, NUTRIENT_KEYS.fiber)),
      sodium: Math.round(mealTotal(meal, NUTRIENT_KEYS.sodium)),
    },
  }
  if (withItems) {
    base.items = meal.items.map((i) => ({
      name: i.name,
      brand: i.brand ?? null,
      serving: `${i.servingSize} ${i.servingUnit}`,
      calories: Math.round(i.nutrients[NUTRIENT_KEYS.calories] ?? 0),
      protein: Math.round(i.nutrients[NUTRIENT_KEYS.protein] ?? 0),
    }))
  }
  if (meal.glucoseResponse?.peakReading != null) {
    base.glucose_response = {
      peak: meal.glucoseResponse.peakReading,
      pre: meal.glucoseResponse.preReading ?? null,
      score: meal.glucoseResponse.score ?? null,
    }
  }
  return base
}

function compactWorkout(w: WorkoutSession): ToolResult {
  return {
    workout_id: w.id,
    title: w.title || w.sportType,
    sportType: w.sportType,
    startDate: w.startDate.toISOString(),
    distance_mi: Math.round(w.distance * 100) / 100,
    duration_min: Math.round(w.duration / 60),
    moving_min: Math.round((w.movingTime || w.duration) / 60),
    avg_pace: w.averagePace > 0 ? formatPace(w.averagePace) : null,
    avg_hr: w.averageHeartRate > 0 ? Math.round(w.averageHeartRate) : null,
    max_hr: w.maxHeartRate > 0 ? Math.round(w.maxHeartRate) : null,
    calories: Math.round(w.calories),
    elevation_gain_ft: Math.round(w.elevationGain),
    split_count: w.splits.length,
    perceived_effort: w.perceivedEffort ?? null,
  }
}

function compactWellness(e: WellnessEntry): ToolResult {
  return {
    wellness_id: e.id,
    date: e.date.toISOString(),
    type: e.type,
    summary: wellnessSummary(e),
    notes: e.notes ?? null,
  }
}

function wellnessTitle(e: WellnessEntry): string {
  switch (e.data.kind) {
    case 'symptom':
      return `Symptom: ${e.data.entry.symptom}`
    case 'mood':
      return 'Mood check'
    case 'energy':
      return 'Energy check'
    case 'bowelMovement':
      return 'Gut check'
    case 'sleep':
      return 'Sleep'
    case 'hydration':
      return 'Hydration'
    case 'custom':
      return e.data.label
  }
}

function wellnessSummary(e: WellnessEntry): string {
  switch (e.data.kind) {
    case 'symptom':
      return `${e.data.entry.symptom} severity ${e.data.entry.severity}${
        e.data.entry.triggers.length ? ` · triggers: ${e.data.entry.triggers.join(', ')}` : ''
      }`
    case 'mood':
      return `mood ${e.data.entry.rating}/5${e.data.entry.stress != null ? `, stress ${e.data.entry.stress}/10` : ''}`
    case 'energy':
      return `energy ${e.data.entry.level}/5`
    case 'bowelMovement': {
      const bm = e.data.entry
      const parts = [bristolSummary(bm)]
      const burden = bm.giBurdenScore ?? computeGIBurdenScore(bm).score
      parts.push(`GI burden ${burden}/10`)
      if (bm.urgency != null) parts.push(`urgency ${bm.urgency}/5`)
      if (bm.control && bm.control !== 'normal') parts.push(`control: ${bm.control}`)
      if (bm.passageSymptoms.length) parts.push(`passage: ${bm.passageSymptoms.join(', ')}`)
      if (bm.redFlags.length) parts.push(`red flags: ${bm.redFlags.join(', ')}`)
      return parts.join(' · ')
    }
    case 'sleep':
      return `sleep ${e.data.hours.toFixed(1)}h, quality ${e.data.quality}/5`
    case 'hydration':
      return `hydration ${Math.round(e.data.ozConsumed)} oz`
    case 'custom':
      return `${e.data.label}: ${e.data.value}${e.data.unit ?? ''}`
  }
}

function pauseSummary(w: WorkoutSession): ToolResult {
  const duration = w.duration
  const moving = w.movingTime || w.duration
  const paused = Math.max(0, duration - moving)
  return {
    had_pauses: paused > 5,
    elapsed_sec: Math.round(duration),
    moving_sec: Math.round(moving),
    paused_sec: Math.round(paused),
    basis: moving > 0 && moving < duration ? 'duration_minus_movingTime' : 'unavailable',
  }
}

function formatSplit(s: Split): ToolResult {
  return {
    mile: s.number,
    distance_mi: Math.round(s.distance * 100) / 100,
    pace: formatPace(s.pace),
    pace_sec: Math.round(s.pace),
    elevation_net_ft: Math.round(s.elevationGain - s.elevationLoss),
    avg_hr: s.averageHeartRate ?? null,
    avg_cadence: s.averageCadence ?? null,
  }
}

function formatPace(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return 'n/a'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}/mi`
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const m = avg(values)
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length)
}

function downsample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items
  const step = (items.length - 1) / Math.max(1, limit - 1)
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * step)])
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9.+-]+/).filter((t) => t.length >= 2)
}

function cutoffDate(daysBack: number): Date {
  const d = new Date()
  if (daysBack <= 0) {
    d.setHours(0, 0, 0, 0)
    return d
  }
  d.setDate(d.getDate() - daysBack)
  return d
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

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function int(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : fallback
}
