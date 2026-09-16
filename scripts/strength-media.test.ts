import test from 'node:test'
import assert from 'node:assert/strict'
import { canShareStrengthFiles, strengthShareFile } from '../src/app/lib/strength/share.ts'
import { exportStrengthClip, strengthVideoExportProblem } from '../src/app/lib/strength/video.ts'

async function withGlobals(values: Record<string, unknown>, action: () => void | Promise<void>) {
  const originals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  try {
    await action()
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('file sharing detects single-file support without assuming a browser can share all pages', async () => {
  const file = strengthShareFile(new Blob(['image'], { type: 'image/png' }), 'Strength-1.png')!
  assert.equal(file.name, 'Strength-1.png')
  assert.equal(file.type, 'image/png')
  await withGlobals({ navigator: { share() {}, canShare: ({ files }: { files: File[] }) => files.length === 1 } }, () => {
    assert.equal(canShareStrengthFiles([file]), true)
    assert.equal(canShareStrengthFiles([file, file]), false)
    assert.equal(canShareStrengthFiles([]), false)
  })
})

test('blocked or missing sharing APIs leave download fallback usable', async () => {
  const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
  for (const navigator of [undefined, {}, { share() {} }, { share() {}, canShare() { throw new Error('blocked') } }])
    await withGlobals({ navigator }, () => assert.equal(canShareStrengthFiles([file]), false))
  await withGlobals({ File: undefined }, () => {
    assert.equal(strengthShareFile(new Blob(['image']), 'Strength.png'), null)
  })
})

test('export capability detection distinguishes missing recorder, codec and optional audio support', async () => {
  class Canvas { captureStream() {} }
  await withGlobals({ HTMLCanvasElement: Canvas, MediaRecorder: undefined }, () => {
    assert.match(strengthVideoExportProblem(false)!, /cannot export/)
  })
  await withGlobals({ HTMLCanvasElement: Canvas, MediaRecorder: { isTypeSupported: () => false }, AudioContext: undefined }, () => {
    assert.match(strengthVideoExportProblem(false)!, /no supported video encoder/)
  })
  await withGlobals({ HTMLCanvasElement: Canvas, MediaRecorder: { isTypeSupported: (type: string) => type === 'video/mp4' }, AudioContext: undefined }, () => {
    assert.equal(strengthVideoExportProblem(false), null)
    assert.match(strengthVideoExportProblem(true)!, /Turn off Keep source audio/)
  })
})

test('export starts video playback and unlocks audio synchronously in the user gesture', async () => {
  const calls: string[] = []
  const controller = new AbortController()
  const video = Object.assign(new EventTarget(), {
    pause() {}, removeAttribute() {}, load() {},
    play() { calls.push('play'); return Promise.resolve() },
  })
  const document = Object.assign(new EventTarget(), { hidden: false, createElement: () => video })
  class Audio {
    resume() { calls.push('resume'); return new Promise<void>(() => {}) }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [] } } }
    createMediaElementSource() { return { connect() {} } }
    close() { return Promise.resolve() }
  }
  await withGlobals({ document, AudioContext: Audio, MediaRecorder: { isTypeSupported: () => true }, cancelAnimationFrame() {} }, async () => {
    const result = exportStrengthClip({ source: 'blob:video', start: 0, end: 10, audio: true, signal: controller.signal, progress() {} })
    assert.deepEqual(calls, ['resume', 'play'])
    controller.abort()
    await assert.rejects(result, { name: 'AbortError' })
  })
})
