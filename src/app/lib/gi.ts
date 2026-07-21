// Shared Gut Check domain model — a TypeScript mirror of
// biometrics/StatsKey/Models/WellnessEntry.swift (BristolType, BowelSegment,
// BowelControlStatus, computedGIBurdenScore) and the option strings in
// biometrics/StatsKey/Views/Wellness/BowelLogView.swift, so the web recorder
// captures and scores exactly what the iOS Gut Check does.

import type {
  BowelControlStatus,
  BowelMovementEntry,
  BowelSegment,
  BowelSegmentPortion,
  BristolType,
} from './types'

// MARK: - Bristol scale

export interface BristolInfo {
  name: string
  description: string
  /** SKTheme status color the iOS chips use (1–2 warning, 3–4 optimal, 5 info, 6–7 alert). */
  color: string
  isIdeal: boolean
}

export const BRISTOL_INFO: Record<BristolType, BristolInfo> = {
  1: { name: 'Hard lumps', description: 'Slow transit', color: '#FFA94D', isIdeal: false },
  2: { name: 'Lumpy sausage', description: 'Mild constipation', color: '#FFA94D', isIdeal: false },
  3: { name: 'Cracked sausage', description: 'Normal', color: '#51CF66', isIdeal: false },
  4: { name: 'Smooth snake', description: 'Smooth and soft — ideal', color: '#51CF66', isIdeal: true },
  5: { name: 'Soft pieces', description: 'Rapid transit', color: '#339AF0', isIdeal: false },
  6: { name: 'Mushy', description: 'Loose', color: '#FF6B6B', isIdeal: false },
  7: { name: 'Liquid', description: 'Watery', color: '#FF6B6B', isIdeal: false },
}

export const BRISTOL_TYPES: BristolType[] = [1, 2, 3, 4, 5, 6, 7]

// MARK: - Segments / portions

export const PORTIONS: BowelSegmentPortion[] = ['trace', 'some', 'most', 'all']

export const PORTION_LABELS: Record<BowelSegmentPortion, string> = {
  trace: 'Trace',
  some: 'Some',
  most: 'Most',
  all: 'All',
}

export const PORTION_WEIGHTS: Record<BowelSegmentPortion, number> = {
  trace: 0.15,
  some: 0.35,
  most: 0.7,
  all: 1.0,
}

// MARK: - Urgency / control

export const URGENCY_LABELS: Record<number, string> = {
  1: 'Normal',
  2: 'Soon',
  3: 'Rushed',
  4: 'Hard to hold',
  5: 'Could not hold',
}

export const CONTROL_OPTIONS: BowelControlStatus[] = [
  'normal',
  'rushed',
  'hardToHold',
  'nearAccident',
  'accident',
]

export const CONTROL_LABELS: Record<BowelControlStatus, string> = {
  normal: 'Normal control',
  rushed: 'Rushed',
  hardToHold: 'Hard to hold',
  nearAccident: 'Near accident',
  accident: 'Accident',
}

// MARK: - Detail chip options (string-for-string with BowelLogView.swift)

export const FEEL_TAG_OPTIONS = [
  'After Coffee',
  'Post-Meal',
  'Morning',
  'Late Night',
  'Strained',
  'Effortless',
  'Incomplete',
  'Urgent',
  'Bloating',
  'Cramping',
]

export const PASSAGE_SYMPTOM_OPTIONS = [
  'Straining',
  'Pain',
  'Burning',
  'Cramping',
  'Gas',
  'Bloating',
  'Incomplete',
  'Mucus',
]

export const CLEANUP_OPTIONS = [
  'Easy cleanup',
  'Messy',
  'Wiped a lot',
  'Bidet',
  'Rinsed out',
  'Showered',
  'Changed clothes',
  'Irritation',
]

export const RED_FLAG_OPTIONS = [
  'Blood',
  'Black/tarry',
  'Pale/clay',
  'Severe pain',
  'Fever',
  'Woke from sleep',
]

export const DURATION_QUICK_MINUTES = [1, 2, 5, 10, 15, 20]

/** Stool swatch colors approximating BowelLogView.stoolSwatchColor. */
export const STOOL_SWATCH_COLORS: Record<string, string> = {
  brown: '#8B5E3C',
  darkBrown: '#59331A',
  lightBrown: '#C2996B',
  yellow: '#E8D24E',
  green: '#6FBF6F',
  black: '#111111',
  red: '#E06060',
  clay: '#CCB38C',
}

// MARK: - Normalization + summaries (mirror BowelMovementEntry helpers)

export function normalizedSegments(entry: Pick<BowelMovementEntry, 'bristolType' | 'segments'>): BowelSegment[] {
  const segments = entry.segments ?? []
  if (segments.length === 0) {
    return [{ id: 'primary', bristolType: entry.bristolType, portion: 'all' }]
  }
  return segments
}

export function isMixedEpisode(entry: Pick<BowelMovementEntry, 'bristolType' | 'segments'>): boolean {
  const segments = normalizedSegments(entry)
  const types = new Set(segments.map((s) => s.bristolType))
  return segments.length > 1 || types.size > 1
}

/** "Type 4 - Smooth snake" or "Mixed types 4/6" — mirrors bristolSummary. */
export function bristolSummary(entry: Pick<BowelMovementEntry, 'bristolType' | 'segments'>): string {
  const segments = normalizedSegments(entry)
  if (!isMixedEpisode(entry) && segments.length > 0) {
    const type = segments[0].bristolType
    return `Type ${type} - ${BRISTOL_INFO[type].name}`
  }
  const types = Array.from(new Set(segments.map((s) => s.bristolType))).sort((a, b) => a - b)
  return `Mixed types ${types.join('/')}`
}

// MARK: - GI Burden Score (exact mirror of computedGIBurdenScore)

function formSeverity(type: BristolType): number {
  switch (type) {
    case 7:
      return 7
    case 6:
    case 1:
      return 5
    case 2:
      return 4
    case 5:
      return 2
    default:
      return 1 // types 3 and 4
  }
}

const SCORED_PASSAGE = new Set(['Pain', 'Cramping', 'Incomplete', 'Straining'])
const SCORED_CLEANUP = new Set(['Bidet', 'Rinsed out', 'Showered', 'Changed clothes'])

export interface GIBurdenBreakdownRow {
  label: string
  amount: string
}

export interface GIBurdenResult {
  score: number
  hasRedFlags: boolean
  breakdown: GIBurdenBreakdownRow[]
}

/**
 * Computes the 0–10 GI Burden Score with the app's exact model: the worst
 * segment (form severity × portion weight) sets the base; urgency, passage,
 * cleanup, and control add on top; any red flag floors the score at 8.
 * Swift rounds with .rounded() (half away from zero) — Math.round matches for
 * the non-negative values this model produces.
 */
export function computeGIBurdenScore(
  entry: Pick<
    BowelMovementEntry,
    'bristolType' | 'segments' | 'urgency' | 'passageSymptoms' | 'control' | 'cleanup' | 'redFlags'
  >
): GIBurdenResult {
  const breakdown: GIBurdenBreakdownRow[] = []
  const segments = normalizedSegments(entry)

  let worst = 0
  let worstLabel = ''
  for (const segment of segments) {
    const contribution = formSeverity(segment.bristolType) * PORTION_WEIGHTS[segment.portion]
    if (contribution > worst) {
      worst = contribution
      worstLabel = `T${segment.bristolType} × ${PORTION_LABELS[segment.portion].toLowerCase()}`
    }
  }
  let score = segments.length > 0 ? worst : 1
  breakdown.push({ label: `Worst phase — ${worstLabel}`, amount: trimNumber(worst) })

  const urgency = entry.urgency
  if (urgency != null) {
    if (urgency >= 4 && urgency <= 5) {
      score += 2
      breakdown.push({ label: `Urgency — ${URGENCY_LABELS[urgency]}`, amount: '+2' })
    } else if (urgency === 3) {
      score += 1
      breakdown.push({ label: 'Urgency — Rushed', amount: '+1' })
    }
  }

  const passageHits = (entry.passageSymptoms ?? []).filter((s) => SCORED_PASSAGE.has(s))
  if (passageHits.length > 0) {
    score += 2
    breakdown.push({ label: `Passage — ${passageHits.join(', ')}`, amount: '+2' })
  }

  const cleanupHits = (entry.cleanup ?? []).filter((s) => SCORED_CLEANUP.has(s))
  if (cleanupHits.length > 0) {
    score += 1.5
    breakdown.push({ label: `Cleanup — ${cleanupHits.join(', ')}`, amount: '+1.5' })
  }

  switch (entry.control) {
    case 'hardToHold':
      score += 1
      breakdown.push({ label: 'Control — Hard to hold', amount: '+1' })
      break
    case 'nearAccident':
      score += 2
      breakdown.push({ label: 'Control — Near accident', amount: '+2' })
      break
    case 'accident':
      score += 3
      breakdown.push({ label: 'Control — Accident', amount: '+3' })
      break
    default:
      break
  }

  const hasRedFlags = (entry.redFlags ?? []).length > 0
  if (hasRedFlags) {
    score = Math.max(score, 8)
    breakdown.push({ label: `Flagged — ${(entry.redFlags ?? []).join(', ')}`, amount: 'floors at 8' })
  }

  return {
    score: Math.min(Math.max(Math.round(score), 0), 10),
    hasRedFlags,
    breakdown,
  }
}

function trimNumber(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

// MARK: - Feel tags ⇄ notes folding (mirror of BowelLogView notes handling)

/**
 * iOS folds "How did it feel?" tags into the notes string on save:
 * `[notes, tags.joined(", ")].joined(" | ")`. On edit it parses any " | "
 * part whose comma-separated pieces are all known tags back into chips.
 */
export function parseFeelTagsFromNotes(combined: string | undefined): {
  tags: string[]
  notes: string
} {
  if (!combined) return { tags: [], notes: '' }
  const known = new Set(FEEL_TAG_OPTIONS)
  const tags: string[] = []
  const remaining: string[] = []
  for (const part of combined.split(' | ')) {
    const candidates = part.split(', ').map((c) => c.trim())
    if (candidates.length > 0 && candidates.every((c) => known.has(c))) {
      for (const tag of candidates) {
        if (!tags.includes(tag)) tags.push(tag)
      }
    } else {
      remaining.push(part)
    }
  }
  return { tags, notes: remaining.join(' | ') }
}

export function combineNotesAndFeelTags(notes: string, tags: string[]): string {
  const trimmed = notes.trim()
  const tagStr = tags.join(', ')
  return [trimmed, tagStr].filter((s) => s.length > 0).join(' | ')
}
