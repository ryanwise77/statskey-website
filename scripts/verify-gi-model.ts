// One-shot verification that the web GI model matches the iOS implementation
// (biometrics/StatsKey/Models/WellnessEntry.swift computedGIBurdenScore).
// Run: npx tsx scripts/verify-gi-model.ts
import {
  bristolSummary,
  combineNotesAndFeelTags,
  computeGIBurdenScore,
  parseFeelTagsFromNotes,
} from '../src/app/lib/gi'
import type { BowelSegment } from '../src/app/lib/types'

let failures = 0

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${JSON.stringify(actual)}${ok ? '' : `  (expected ${JSON.stringify(expected)})`}`)
}

const seg = (bristolType: number, portion: string, id = 'x'): BowelSegment =>
  ({ id, bristolType, portion }) as BowelSegment

// Swift: T4 × all = 1, no adds → 1
check('textbook T4', computeGIBurdenScore({ bristolType: 4, segments: [], passageSymptoms: [], cleanup: [], redFlags: [] }).score, 1)

// Swift: T6×most = 3.5, urgency 3 → +1, Cramping → +2 = 6.5 → .rounded() = 7
check(
  'rough afternoon',
  computeGIBurdenScore({
    bristolType: 6,
    segments: [seg(6, 'most')],
    urgency: 3,
    passageSymptoms: ['Cramping', 'Gas'],
    control: 'normal',
    cleanup: ['Messy'],
    redFlags: [],
  }).score,
  7
)

// Swift: any red flag floors at 8
check(
  'red flag floor',
  computeGIBurdenScore({ bristolType: 4, segments: [], passageSymptoms: [], cleanup: ['Easy cleanup'], redFlags: ['Blood'] }).score,
  8
)

// Swift: T7×trace 1.05 + urgency5 +2 + Pain +2 + Bidet +1.5 + accident +3 = 9.55 → 10
check(
  'stacked severe',
  computeGIBurdenScore({
    bristolType: 7,
    segments: [seg(7, 'trace')],
    urgency: 5,
    passageSymptoms: ['Pain'],
    control: 'accident',
    cleanup: ['Bidet'],
    redFlags: [],
  }).score,
  10
)

// Mixed episode: worst phase wins — T4×most (0.7) vs T6×some (1.75) → base 1.75 → 2
check(
  'mixed worst-phase base',
  computeGIBurdenScore({
    bristolType: 4,
    segments: [seg(4, 'most', 'a'), seg(6, 'some', 'b')],
    passageSymptoms: [],
    cleanup: [],
    redFlags: [],
  }).score,
  2
)

check('summary single', bristolSummary({ bristolType: 4, segments: [] }), 'Type 4 - Smooth snake')
check('summary mixed', bristolSummary({ bristolType: 4, segments: [seg(6, 'some', 'a'), seg(4, 'most', 'b')] }), 'Mixed types 4/6')

// Notes ⇄ feel-tag folding round trip (mirrors BowelLogView " | " format)
const combined = combineNotesAndFeelTags('ate too fast', ['After Coffee', 'Morning'])
check('combine notes+tags', combined, 'ate too fast | After Coffee, Morning')
check('parse back', parseFeelTagsFromNotes(combined), { tags: ['After Coffee', 'Morning'], notes: 'ate too fast' })
check('parse tags-only', parseFeelTagsFromNotes('Effortless, Morning'), { tags: ['Effortless', 'Morning'], notes: '' })
check('parse notes-only', parseFeelTagsFromNotes('weird color today'), { tags: [], notes: 'weird color today' })

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed — web GI model matches the iOS implementation.')
