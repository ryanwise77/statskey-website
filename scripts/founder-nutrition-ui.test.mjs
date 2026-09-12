import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../src/founderLive.js', import.meta.url), 'utf8')

// Exercise the production functions without booting Firebase, a browser, or a
// network connection. Named boundaries fail loudly when the module is moved.
function section(start, next) {
  const from = source.indexOf(start)
  const to = source.indexOf(next, from + start.length)
  assert.ok(from >= 0 && to > from, `Missing source boundary: ${start} -> ${next}`)
  return source.slice(from, to)
}

const production = [
  section('const number =', 'const sportLabel ='),
  section('const NUTRIENT_COLORS =', 'const SPORT_LABELS ='),
  section('function nutritionSnapshot(', 'function initializeFirebase()'),
  section('function nutritionRows(', 'function friendsHome()'),
].join('\n')

function windowRecord(overrides = {}) {
  return {
    startDay: '2026-07-17', endDay: '2026-08-15',
    possibleDays: 30, recordedDays: 12,
    dailyAverage: { calories: 500, proteinGrams: 20, carbohydrateGrams: 70, fatGrams: 15 },
    micronutrients: [],
    ...overrides,
  }
}

function harness({ nutrition = windowRecord(), fetch, source: connection = 'snapshot' } = {}) {
  const state = {
    source: connection, root: { snapshotDay: '2026-08-16', nutrition },
    workouts: [], nutritionRangeDays: 30, includeToday: false,
    selectedNutrient: null,
  }
  const transitions = []
  const errors = []
  let renders = 0
  const context = {
    state, NUTRITION_RANGE_DAYS: [7, 14, 30, 90],
    elements: { stage: { dataset: { source: '/published-snapshot.json' } } },
    fetch: fetch ?? (() => { throw new Error('Unexpected network access') }),
    console: { error: (...args) => errors.push(args) },
    setConnectionState(next, message) {
      state.source = next
      transitions.push({ source: next, message })
    },
    render() { renders++ },
  }
  runInNewContext(production, context, { filename: 'founderLive.js (production functions)' })
  return { state, context, transitions, errors, renderCount: () => renders }
}

const visibleText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const macroValues = (html) => [...html.matchAll(/class="ios-macro-insight__value"><strong>(.*?)<\/strong>/g)].map((match) => match[1])

// The retired static-fallback lifecycle tests are superseded by the actual-module
// Auth, permission, and late-callback regressions in founder-live.test.mjs. Keep
// nutrient rendering independently covered here; do not restore fallback reads
// merely to satisfy a test for the previous anonymous-snapshot architecture.

test('saved snapshot controls use their actual dates in both toggle states and never call them today', () => {
  const complete = windowRecord()
  const includingToday = windowRecord({ startDay: '2026-07-18', endDay: '2026-08-16' })
  const run = harness({ nutrition: {
    ...complete,
    ranges: { complete: { 30: complete }, includingToday: { 30: includingToday } },
  } })
  for (const [include, expected] of [
    [false, 'Jul 17, 2026 – Aug 15, 2026'],
    [true, 'Jul 18, 2026 – Aug 16, 2026'],
  ]) {
    run.state.includeToday = include
    const html = run.context.nutritionRangeControls()
    const text = visibleText(html)
    assert.match(text, /Include snapshot day/)
    assert.match(text, /Published snapshot/)
    assert.ok(text.includes(expected), text)
    assert.doesNotMatch(text, /\btoday\b/i)
    assert.match(html, new RegExp(`aria-checked="${include}"`))
  }
})

test('zero recorded days render unknown macro averages instead of zero intake', () => {
  const run = harness({ nutrition: windowRecord({
    recordedDays: 0,
    dailyAverage: { calories: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
  }) })
  const html = run.context.nutritionHome()
  assert.deepEqual(macroValues(html), ['—', '—', '—', '—'])
  assert.match(visibleText(html), /0 of 30 days have food records/)
  assert.match(visibleText(html), /0 recorded days/)
  assert.doesNotMatch(visibleText(html), /0 complete days/)
})

test('missing macro fields stay unknown while a known zero remains zero', () => {
  const run = harness({ nutrition: windowRecord({
    dailyAverage: { calories: null, proteinGrams: 0, fatGrams: 15 },
  }) })
  assert.deepEqual(macroValues(run.context.nutritionHome()), ['—', '0', '—', '15'])
})

test('unknown micronutrients remain unknown in cards, detail, and fiber summary', () => {
  for (const values of [
    { average: null, percent: null, coverageDays: 5 },
    { average: 0, percent: 0, coverageDays: 0 },
  ]) {
    const fiber = {
      key: 'dietary_fiber', label: 'Fiber', unit: 'g', reference: 30,
      status: 'limited', direction: 'minimum', ...values,
    }
    const run = harness({ nutrition: windowRecord({ micronutrients: [fiber] }) })
    run.state.selectedNutrient = fiber.key
    const rows = run.context.nutritionRows([fiber])
    assert.match(rows, /class="ios-micronutrient-card__value">— g</)
    assert.match(visibleText(rows), /Not recorded/)
    assert.doesNotMatch(visibleText(rows), /0% of target/)
    const detail = run.context.nutrientDetailHome()
    assert.match(detail, /<strong>— <em>g<\/em><\/strong>/)
    assert.match(visibleText(detail), /Not recorded in this window/)
    const home = run.context.nutritionHome()
    assert.match(home, /<strong>— \/ 30g<\/strong>/)
    assert.match(home, /<small>0 nutrients<\/small>/)
  }
})

test('known zero micronutrient values retain numeric zero and their reference percentage', () => {
  const fiber = {
    key: 'dietary_fiber', label: 'Fiber', unit: 'g', reference: 30,
    status: 'watch', direction: 'minimum', average: 0, percent: 0, coverageDays: 5,
  }
  const run = harness({ nutrition: windowRecord({ micronutrients: [fiber] }) })
  run.state.selectedNutrient = fiber.key
  assert.match(run.context.nutritionRows([fiber]), /class="ios-micronutrient-card__value">0 g</)
  assert.match(visibleText(run.context.nutritionRows([fiber])), /0% of target/)
  assert.match(run.context.nutrientDetailHome(), /<strong>0 <em>g<\/em><\/strong>/)
  assert.match(run.context.nutritionHome(), /<strong>0\.0g \/ 30g<\/strong>/)
  assert.match(run.context.nutritionHome(), /<small>1 nutrients<\/small>/)
})
