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
  section('async function loadFallback(', 'function connectLiveRecord()'),
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

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function publishLive(state) {
  const root = { snapshotDay: '2026-09-11', nutrition: windowRecord({ recordedDays: 25 }) }
  const workouts = [{ workoutId: 'new-live-workout' }]
  Object.assign(state, { source: 'live', root, workouts })
  return { root, workouts }
}

function assertLivePreserved(run, live) {
  assert.equal(run.state.source, 'live')
  assert.equal(run.state.root, live.root)
  assert.equal(run.state.workouts, live.workouts)
  assert.equal(run.transitions.length, 0)
  assert.equal(run.errors.length, 0)
  assert.equal(run.renderCount(), 0)
}

const visibleText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const macroValues = (html) => [...html.matchAll(/class="ios-macro-insight__value"><strong>(.*?)<\/strong>/g)].map((match) => match[1])

test('a delayed fallback response cannot replace a newly received live root or workouts', async () => {
  const response = deferred()
  const run = harness({ source: 'connecting', fetch: () => response.promise })
  const loading = run.context.loadFallback()
  const live = publishLive(run.state)
  response.resolve({ ok: true, json: async () => ({ root: { old: true }, workouts: [{ workoutId: 'old' }] }) })
  await loading
  assertLivePreserved(run, live)
})

test('live data arriving during JSON decoding also wins over the saved snapshot', async () => {
  const payload = deferred()
  const decoding = deferred()
  const run = harness({
    source: 'connecting',
    fetch: async () => ({ ok: true, json() { decoding.resolve(); return payload.promise } }),
  })
  const loading = run.context.loadFallback()
  await decoding.promise
  const live = publishLive(run.state)
  payload.resolve({ root: { old: true }, workouts: [] })
  await loading
  assertLivePreserved(run, live)
})

test('late fallback network, HTTP, and JSON failures cannot clear newer live data', async (t) => {
  for (const failure of ['network', 'http', 'json']) {
    await t.test(failure, async () => {
      const response = deferred()
      const run = harness({ source: 'connecting', fetch: () => response.promise })
      const loading = run.context.loadFallback()
      const live = publishLive(run.state)
      if (failure === 'network') response.reject(new Error('Offline'))
      if (failure === 'http') response.resolve({ ok: false, status: 503 })
      if (failure === 'json') response.resolve({ ok: true, json: async () => { throw new Error('Invalid JSON') } })
      await loading
      assertLivePreserved(run, live)
    })
  }
})

test('a fallback still loads normally while live data is unavailable', async () => {
  const root = { snapshotDay: '2026-08-16', nutrition: windowRecord() }
  const workouts = [{ workoutId: 'public-workout' }]
  const requests = []
  const run = harness({
    source: 'connecting',
    fetch: async (url, options) => {
      requests.push({ url, cache: options.cache })
      return { ok: true, json: async () => ({ root, workouts }) }
    },
  })
  await run.context.loadFallback()
  assert.equal(run.state.source, 'snapshot')
  assert.equal(run.state.root, root)
  assert.equal(run.state.workouts, workouts)
  assert.deepEqual(requests, [{ url: '/published-snapshot.json', cache: 'no-store' }])
  assert.equal(run.renderCount(), 1)
})

test('fallback failure without a live record exposes an unavailable state', async () => {
  const run = harness({ source: 'connecting', fetch: async () => { throw new Error('Offline') } })
  await run.context.loadFallback()
  assert.equal(run.state.source, 'error')
  assert.equal(run.state.root.nutritionPublished, false)
  assert.equal(run.state.root.trainingPublished, false)
  assert.equal(run.state.workouts.length, 0)
  assert.equal(run.renderCount(), 1)
})

test('an older failed fallback cannot erase a snapshot another fallback already loaded', async () => {
  const olderResponse = deferred()
  const root = { snapshotDay: '2026-08-16', nutrition: windowRecord() }
  const workouts = [{ workoutId: 'public-workout' }]
  let requests = 0
  const run = harness({
    source: 'connecting',
    fetch: () => ++requests === 1
      ? olderResponse.promise
      : Promise.resolve({ ok: true, json: async () => ({ root, workouts }) }),
  })
  const olderLoading = run.context.loadFallback()
  await run.context.loadFallback()
  olderResponse.reject(new Error('Older request failed'))
  await olderLoading
  assert.equal(run.state.source, 'snapshot')
  assert.equal(run.state.root, root)
  assert.equal(run.state.workouts, workouts)
  assert.equal(run.transitions.length, 1)
  assert.equal(run.renderCount(), 1)
  assert.equal(run.errors.length, 0)
})

test('already live state does not initiate a fallback fetch', async () => {
  let requests = 0
  const run = harness({ source: 'live', fetch: async () => { requests++; throw new Error('Must not fetch') } })
  await run.context.loadFallback()
  assert.equal(requests, 0)
  assert.equal(run.renderCount(), 0)
})

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
