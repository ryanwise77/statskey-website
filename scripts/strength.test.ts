import test from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { readFileSync } from 'node:fs'
import {
  EXERCISES,
  newSession,
  newExercise,
  newSet,
  decodeStrengthSession,
  effectiveStrengthEntries,
  encodeStrength,
  strengthDate,
  strengthTotals,
  loadDisplay,
  setDescription,
  validateStrength,
  type StrengthSession,
} from '../src/app/lib/strength/model.ts'
import {
  readStrengthDraft,
  writeStrengthDraft,
} from '../src/app/lib/strength/draft.ts'
import {
  strengthSharePages,
  wrapShareText,
} from '../src/app/lib/strength/share.ts'
import {
  alignStrengthVideo,
  exportStrengthClip,
  recordedSetRange,
  recordedSetStart,
  recordingMimeType,
  videoTrimRange,
} from '../src/app/lib/strength/video.ts'

function workout(): StrengthSession {
  const session = newSession('owner', new Date('2026-09-01T12:00:00Z'))
  session.status = 'completed'
  session.endDate = new Date('2026-09-01T12:00:00Z')
  const entry = newExercise('Bench Press', 'barbell')
  entry.sets[0] = {
    ...entry.sets[0],
    isCompleted: true,
    loadKind: 'externalWeight',
    weightLbs: 100,
    reps: 8,
  }
  session.entries = [entry]
  return session
}

test('new completed-log defaults end now without a future interval or invented values', () => {
  const s = workout()
  assert.equal(s.endDate!.getTime() - s.startDate.getTime(), 45 * 60_000)
  assert.equal(validateStrength(s), null)
  const blank = newExercise('Custom hold', 'other', 'time').sets[0]
  assert.equal(blank.reps, undefined)
  assert.equal(blank.weightLbs, undefined)
  assert.equal(blank.isCompleted, false)
})
test('native dates decode consistently and reject malformed values', () => {
  const date = new Date('2026-09-01T12:00:00Z'),
    seconds = date.getTime() / 1000
  for (const input of [
    date,
    date.toISOString(),
    seconds,
    { seconds, nanoseconds: 0 },
    { _seconds: seconds },
    { toDate: () => date },
  ])
    assert.equal(strengthDate(input)?.getTime(), date.getTime())
  for (const input of [
    NaN,
    Infinity,
    'invalid',
    { seconds: '1' },
    new Date(NaN),
  ])
    assert.equal(strengthDate(input), undefined)
})
test('native edits apply only masked fields, deletions, and added identities without mutating originals', () => {
  const original = [
    {
      id: 'e1',
      name: 'Original',
      equipment: 'barbell',
      sets: [
        { id: 's1', weightLbs: 100, reps: 8 },
        { id: 's2', reps: 5 },
      ],
    },
    { id: 'e2', sets: [{ id: 's3' }] },
    { id: 'removed', sets: [] },
  ]
  const snapshot = structuredClone(original)
  const edits = {
    entries: [
      {
        id: 'e1',
        name: 'Corrected',
        equipment: 'dumbbell',
        sets: [
          { id: 's1', weightLbs: 120, reps: 99 },
          { id: 's4', reps: 12 },
        ],
      },
      { id: 'e3', sets: [{ id: 's5' }] },
      { id: 'e3', sets: [{ id: 's5' }] },
    ],
    entryFields: { e1: ['name'] },
    setFields: { s1: ['weight'] },
    removedEntryIDs: ['removed'],
    removedSetIDs: ['s2', 's3'],
  }
  const effective = effectiveStrengthEntries(original, edits) as any[]
  assert.deepEqual(original, snapshot)
  assert.deepEqual(
    effective.map((e) => e.id),
    ['e1', 'e2', 'e3'],
  )
  assert.equal(effective[0].name, 'Corrected')
  assert.equal(effective[0].equipment, 'barbell')
  assert.deepEqual(effective[0].sets, [
    { id: 's1', weightLbs: 120, reps: 8 },
    { id: 's4', reps: 12 },
  ])
  assert.deepEqual(effective[1].sets, [])
})
test('decoder enforces owner identity and uses native defaults and corrected fields', () => {
  const s = workout(),
    payload = encodeStrength(s)
  const native = {
    ...payload,
    status: undefined,
    title: 'Recorded',
    userEdits: { revision: 2, title: 'Corrected' },
  }
  assert.equal(decodeStrengthSession(native, s.id, 'other'), null)
  assert.equal(decodeStrengthSession(native, 'different', s.userId), null)
  const decoded = decodeStrengthSession(native, s.id, s.userId)!
  assert.equal(decoded.status, 'completed')
  assert.equal(decoded.title, 'Corrected')
  assert.equal(decoded.edited, true)
  assert.deepEqual(strengthTotals(decoded), {
    exercises: 1,
    sets: 1,
    volumeLbs: 800,
  })
})
test('volume respects load meaning, warmups, timed exercises and ambiguous legacy bodyweight', () => {
  const s = workout(),
    base = s.entries[0]
  s.entries = [
    base,
    ...(['assistance', 'bodyweightOnly', 'addedWeight'] as const).map(
      (kind) => ({
        ...newExercise(kind),
        sets: [
          {
            ...newSet(),
            isCompleted: true,
            weightLbs: 20,
            reps: 10,
            loadKind: kind,
          },
        ],
      }),
    ),
    {
      ...newExercise('Plank', 'bodyweight', 'time'),
      sets: [{ ...newSet(), isCompleted: true, reps: 10, weightLbs: 20 }],
    },
    {
      ...newExercise('Pull-up', 'bodyweight'),
      sets: [{ ...newSet(), isCompleted: true, reps: 10, weightLbs: 180 }],
    },
  ]
  base.sets.push(
    {
      ...newSet(2),
      isCompleted: true,
      weightLbs: 80,
      reps: 10,
      setType: 'warmup',
    },
    { ...newSet(3), weightLbs: 500, reps: 99 },
  )
  assert.deepEqual(strengthTotals(s), {
    exercises: 6,
    sets: 7,
    volumeLbs: 1000,
  })
  assert.match(loadDisplay(22.0462, false), /^10 kg$/)
  assert.match(
    setDescription(s.entries[1].sets[0], s.entries[1], true),
    /20 lb assistance/,
  )
  assert.doesNotMatch(
    setDescription(s.entries[4].sets[0], s.entries[4], true),
    /reps/,
  )
})
test('encoding preserves canonical pounds/dates and omits unfinished sets, bodyweight load and invented calories', () => {
  const s = workout()
  s.entries[0].sets.push(newSet(2))
  const bw = newExercise('Plank', 'bodyweight', 'time')
  bw.sets[0] = {
    ...bw.sets[0],
    isCompleted: true,
    loadKind: 'bodyweightOnly',
    weightLbs: 180,
    reps: 99,
    durationSeconds: 45,
  }
  s.entries.push(bw)
  const encoded = encodeStrength(s) as any
  assert.equal(encoded.entries[0].sets.length, 1)
  assert.equal(encoded.entries[0].sets[0].weightLbs, 100)
  assert.equal(encoded.startDate, s.startDate)
  assert.equal(encoded.entries[0].sets[0].source, 'phone')
  assert.equal('weightLbs' in encoded.entries[1].sets[0], false)
  assert.equal('reps' in encoded.entries[1].sets[0], false)
  assert.equal('calories' in encoded, false)
  assert.equal('workoutSessionId' in encoded, false)
})
test('invalid performed measurements and duplicate identities cannot be saved', () => {
  for (const patch of [
    { reps: 1.5 },
    { reps: 0 },
    { weightLbs: NaN },
    { weightLbs: -1 },
    { durationSeconds: 0 },
    { rpe: 11 },
  ]) {
    const s = workout()
    Object.assign(s.entries[0].sets[0], patch)
    assert.ok(validateStrength(s))
    assert.throws(() => encodeStrength(s))
  }
  const duplicate = workout()
  duplicate.entries[0].sets.push({ ...duplicate.entries[0].sets[0] })
  assert.match(validateStrength(duplicate)!, /unique/)
  const future = workout()
  future.endDate = new Date(Date.now() + 120_000)
  assert.match(validateStrength(future)!, /future/)
  const blank = workout()
  blank.entries[0].sets[0].isCompleted = false
  assert.match(validateStrength(blank)!, /completed set/)
})
test('compact images retain every performed set across pages and wrap Unicode names without clipping', () => {
  const s = workout()
  s.entries[0].name = 'A very long exercise name'
  s.entries[0].sets = Array.from({ length: 65 }, (_, i) => ({
    ...newSet(i + 1),
    isCompleted: true,
    reps: i + 1,
  }))
  const pages = strengthSharePages(s, true)
  assert.deepEqual(
    pages.map((p) => p.length),
    [28, 28, 9],
  )
  assert.equal(pages.flat().length, 65)
  for (const page of pages) assert.equal(page[0].heading, s.entries[0].name)
  assert.match(pages[2][8].text, /Set 65/)
  const word = '🦾🏋️超長運動名稱'.repeat(8),
    lines = wrapShareText(word, 8, (s) => Array.from(s).length)
  assert.equal(lines.join(''), word)
  assert.ok(lines.every((s) => Array.from(s).length <= 8))
})
test('recorded alignment uses actual endpoints, supports start-only clocks, and refuses to move a marked frame', () => {
  const s = workout(),
    set = {
      ...s.entries[0].sets[0],
      startedAt: new Date(s.startDate.getTime() + 120_000),
      completedAt: new Date(s.startDate.getTime() + 150_000),
      durationSeconds: 45,
    }
  assert.deepEqual(recordedSetRange(s, set), [120, 150])
  assert.deepEqual(alignStrengthVideo(s, set, 10, 90, 60), {
    offset: 110,
    range: [10, 40],
  })
  const startOnly = {
    ...set,
    completedAt: undefined,
    durationSeconds: undefined,
  }
  assert.equal(recordedSetStart(s, startOnly), 120)
  assert.equal(recordedSetRange(s, startOnly), null)
  assert.deepEqual(alignStrengthVideo(s, startOnly, 10, 90, 20), {
    offset: 110,
    range: [10, 30],
  })
  assert.equal(alignStrengthVideo(s, set, 89.5, 90, 30), null)
  assert.deepEqual(videoTrimRange(120, 150, 110, 25), [10, 25])
  assert.equal(videoTrimRange(120, 150, 200, 60), null)
  assert.equal(videoTrimRange(NaN, 50, 0, 100), null)
})
test('browser encoding keeps supported MP4 or WebM MIME types and production CSP permits local videos', () => {
  assert.equal(
    recordingMimeType((s) => s === 'video/mp4'),
    'video/mp4',
  )
  assert.equal(
    recordingMimeType((s) => s === 'video/webm'),
    'video/webm',
  )
  assert.equal(
    recordingMimeType(() => false),
    null,
  )
  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  )
  const csp = config.headers
    .find((h: any) => h.source === '/app/:path*')
    .headers.find((h: any) => h.key === 'Content-Security-Policy').value
  assert.match(csp, /media-src 'self' blob:;/)
})

test('built-in selections preserve native exercise identity while custom entries remain distinct', () => {
  const bench = EXERCISES.find((e) => e[0] === 'Bench Press')!
  const exercise = newExercise(...bench)
  assert.equal(exercise.exerciseId, 'bb-bench-press')
  assert.equal(newExercise('My custom press').exerciseId, '')
  assert.equal(new Set(EXERCISES.map((e) => e[3])).size, EXERCISES.length)
  assert.ok(EXERCISES.every((e) => e[3].length > 0))
  const s = workout()
  exercise.sets[0].isCompleted = true
  s.entries = [exercise]
  assert.equal(
    (encodeStrength(s) as any).entries[0].exerciseId,
    'bb-bench-press',
  )
})
test('tab drafts restore live set timing and duration, isolate owners, and clear after saving', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  const session = workout()
  session.status = 'active'
  session.recordingMode = 'live'
  session.endDate = undefined
  session.entries[0].sets[0].isCompleted = false
  session.entries[0].sets[0].startedAt = new Date('2026-09-01T11:16:00Z')
  assert.equal(
    writeStrengthDraft(
      'owner',
      { session, duration: '90', restUntil: 1000 },
      storage,
    ),
    true,
  )
  const restored = readStrengthDraft('owner', storage)!
  assert.equal(restored.duration, '90')
  assert.equal(restored.restUntil, 1000)
  assert.equal(
    restored.session.entries[0].sets[0].startedAt?.toISOString(),
    '2026-09-01T11:16:00.000Z',
  )
  assert.equal(restored.session.entries[0].sets[0].isCompleted, false)
  assert.equal(readStrengthDraft('other', storage), null)
  assert.equal(
    writeStrengthDraft(
      'other',
      { session, duration: '90', restUntil: null },
      storage,
    ),
    false,
  )
  assert.equal(
    writeStrengthDraft(
      'owner',
      { session: newSession('owner'), duration: '45', restUntil: null },
      storage,
    ),
    true,
  )
  assert.equal(readStrengthDraft('owner', storage), null)
})
test('blocked or malformed tab storage never prevents recording or leaks another account draft', () => {
  assert.equal(
    readStrengthDraft('owner', {
      getItem() {
        throw new Error('blocked')
      },
    }),
    null,
  )
  assert.equal(readStrengthDraft('owner', { getItem: () => '{broken' }), null)
  assert.equal(
    readStrengthDraft('owner', {
      getItem: () =>
        JSON.stringify({
          version: 1,
          session: { ...workout(), userId: 'other', status: 'active' },
        }),
    }),
    null,
  )
  assert.equal(
    writeStrengthDraft(
      'owner',
      { session: workout(), duration: '45', restUntil: null },
      {
        setItem() {
          throw new Error('full')
        },
        removeItem() {},
      },
    ),
    false,
  )
})

// These mocks exercise cancellation/finalization contracts, not browser codec fidelity.
async function withBrowser(config: any, action: (h: any) => Promise<void>) {
  const controller = new AbortController(),
    doc = new EventTarget() as any
  doc.hidden = false
  const state: any = {
    starts: 0,
    trackStops: 0,
    closed: 0,
    unloaded: 0,
    draws: 0,
    frame: null,
    playResolve: null,
    jobs: [],
  }
  const track = {
    stop() {
      state.trackStops++
    },
  }
  const stream = { getTracks: () => [track], addTrack() {} }
  class Video extends EventTarget {
    src = ''
    readyState = config.metadataPending ? 0 : 4
    duration = 120
    videoWidth = 1920
    videoHeight = 1080
    paused = true
    time = 0
    get currentTime() {
      return this.time
    }
    set currentTime(value) {
      this.time = value
      if (!config.seekPending)
        queueMicrotask(() => this.dispatchEvent(new Event('seeked')))
    }
    play() {
      this.paused = false
      return config.playPending
        ? new Promise<void>((resolve) => {
            state.playResolve = resolve
          })
        : Promise.resolve()
    }
    pause() {
      this.paused = true
    }
    removeAttribute() {
      this.src = ''
    }
    load() {
      state.unloaded++
    }
  }
  const video = new Video()
  doc.createElement = (tag: string) =>
    tag === 'video'
      ? video
      : {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {
              state.draws++
              if (config.drawFails && state.draws > 1)
                throw new Error('drawing failed')
            },
          }),
          captureStream: () => stream,
        }
  class Recorder {
    static isTypeSupported(type: string) {
      return type === (config.mime ?? 'video/webm')
    }
    state = 'inactive'
    mimeType: string
    ondataavailable: any = null
    onstop: any = null
    onerror: any = null
    constructor(_stream: unknown, options: any) {
      this.mimeType = options.mimeType
      state.recorder = this
    }
    start() {
      if (config.startFails) throw new Error('encoder startup failed')
      this.state = 'recording'
      state.starts++
    }
    stop() {
      this.state = 'inactive'
      if (config.stopNeverCompletes) return
      queueMicrotask(() => {
        this.ondataavailable?.({
          data: config.finalOversized
            ? { size: 251 * 1024 * 1024 }
            : new Blob(['encoded-video'], { type: this.mimeType }),
        })
        this.onstop?.()
      })
    }
  }
  class Audio {
    resume() {
      return config.resumePending
        ? new Promise<void>(() => {})
        : Promise.resolve()
    }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [] } }
    }
    createMediaElementSource() {
      return { connect() {} }
    }
    close() {
      state.closed++
      return Promise.resolve()
    }
  }
  const replacements: Record<string, unknown> = {
    document: doc,
    MediaRecorder: Recorder,
    AudioContext: Audio,
    requestAnimationFrame: (callback: any) => {
      state.frame = callback
      return 1
    },
    cancelAnimationFrame: () => {
      state.frame = null
    },
  }
  const originals = new Map(
    Object.keys(replacements).map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  )
  for (const [key, value] of Object.entries(replacements))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    })
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  }
  const run = (overrides = {}) => {
    const job = exportStrengthClip({
      source: 'blob:local-video',
      start: 10,
      end: 20,
      audio: false,
      signal: controller.signal,
      progress() {},
      ...overrides,
    })
    job.catch(() => {})
    state.jobs.push(job)
    return job
  }
  try {
    await action({ state, video, doc, controller, run, flush })
  } finally {
    controller.abort()
    await Promise.allSettled(state.jobs)
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
}
function cleaned(h: any) {
  assert.equal(getEventListeners(h.controller.signal, 'abort').length, 0)
  assert.equal(getEventListeners(h.doc, 'visibilitychange').length, 0)
  for (const name of [
    'loadedmetadata',
    'seeked',
    'loadeddata',
    'error',
    'ended',
    'waiting',
  ])
    assert.equal(getEventListeners(h.video, name).length, 0, name)
  assert.equal(h.video.src, '')
  assert.ok(h.state.unloaded)
  assert.equal(h.state.frame, null)
}
test('export waits for playback, then finishes the selected interval with the actual format', async () => {
  await withBrowser({ playPending: true }, async (h) => {
    const result = h.run()
    await h.flush()
    assert.equal(h.state.starts, 0)
    h.state.playResolve()
    await h.flush()
    assert.equal(h.state.starts, 1)
    h.video.time = 20
    h.state.frame()
    const blob = await result
    assert.equal(blob.type, 'video/webm')
    assert.ok(blob.size)
    assert.equal(h.state.trackStops, 1)
    cleaned(h)
  })
})
test('encoder startup exceptions remove listeners and release the video stream', async () => {
  await withBrowser({ startFails: true }, async (h) => {
    await assert.rejects(h.run(), /startup failed/)
    assert.equal(h.state.trackStops, 1)
    cleaned(h)
  })
})
test('pending audio resume and playback can both be cancelled immediately', async () => {
  for (const config of [{ resumePending: true }, { playPending: true }])
    await withBrowser(config, async (h) => {
      const result = h.run({ audio: true })
      await h.flush()
      h.controller.abort()
      await assert.rejects(result, { name: 'AbortError' })
      assert.equal(h.state.starts, 0)
      assert.equal(h.state.closed, 1)
      cleaned(h)
    })
})
test('hiding the tab during metadata loading or seeking prevents recording', async () => {
  for (const config of [{ metadataPending: true }, { seekPending: true }])
    await withBrowser(config, async (h) => {
      const result = h.run()
      await h.flush()
      h.doc.hidden = true
      h.doc.dispatchEvent(new Event('visibilitychange'))
      await assert.rejects(result, /hidden/)
      assert.equal(h.state.starts, 0)
      cleaned(h)
    })
})
test('cancel releases resources even if encoder never finalizes', async () => {
  await withBrowser({ stopNeverCompletes: true }, async (h) => {
    const result = h.run()
    await h.flush()
    assert.equal(h.state.starts, 1)
    h.controller.abort()
    await assert.rejects(result, { name: 'AbortError' })
    assert.equal(h.state.trackStops, 1)
    cleaned(h)
  })
})
test('an oversized final encoder chunk rejects instead of yielding a successful file', async () => {
  await withBrowser({ finalOversized: true }, async (h) => {
    const result = h.run()
    await h.flush()
    h.video.time = 20
    h.state.frame()
    await assert.rejects(result, /too large/)
    cleaned(h)
  })
})
test('playback stalls and early endings fail instead of silently stretching or truncating a clip', async () => {
  for (const [event, message] of [
    ['waiting', /stalled/],
    ['ended', /before/],
  ] as const)
    await withBrowser({}, async (h) => {
      const result = h.run()
      await h.flush()
      h.video.dispatchEvent(new Event(event))
      await assert.rejects(result, message)
      assert.equal(h.state.trackStops, 1)
      cleaned(h)
    })
})
test('drawing failure immediately stops and cleans up export', async () => {
  await withBrowser({ drawFails: true }, async (h) => {
    await assert.rejects(h.run(), /drawing failed/)
    assert.equal(h.state.trackStops, 1)
    cleaned(h)
  })
})
