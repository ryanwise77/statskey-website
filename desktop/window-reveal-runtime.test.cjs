const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  MAIN_WINDOW_VISIBILITY_OPTIONS,
  installMainWindowRevealLifecycle,
} = require('./window-reveal-runtime.cjs')

class FakeWindow extends EventEmitter {
  destroyed = false

  isDestroyed() {
    return this.destroyed
  }
}

function fakeClock() {
  const scheduled = []
  const cancelled = []
  return {
    scheduled,
    cancelled,
    schedule(callback, delay) {
      const handle = {
        callback,
        delay,
        unrefCalls: 0,
        unref() {
          this.unrefCalls += 1
        },
      }
      scheduled.push(handle)
      return handle
    },
    cancel(handle) {
      cancelled.push(handle)
    },
  }
}

test('main window is constructed visible', () => {
  assert.deepEqual(MAIN_WINDOW_VISIBILITY_OPTIONS, { show: true })
})

test('main window reveals immediately without waiting for Chromium', () => {
  const window = new FakeWindow()
  const clock = fakeClock()
  const reveals = []

  installMainWindowRevealLifecycle(window, (target) => reveals.push(target), {
    schedule: clock.schedule,
    cancel: clock.cancel,
  })

  assert.deepEqual(reveals, [window])
  assert.equal(clock.scheduled.length, 1)
  assert.equal(clock.scheduled[0].delay, 4_000)
  assert.equal(clock.scheduled[0].unrefCalls, 0)
})

test('ready-to-show reinforces visibility and cancels the fallback', () => {
  const window = new FakeWindow()
  const clock = fakeClock()
  let reveals = 0

  installMainWindowRevealLifecycle(window, () => {
    reveals += 1
  }, {
    schedule: clock.schedule,
    cancel: clock.cancel,
  })
  window.emit('ready-to-show')

  assert.equal(reveals, 2)
  assert.deepEqual(clock.cancelled, [clock.scheduled[0]])
})

test('referenced fallback reveals when ready-to-show never arrives', () => {
  const window = new FakeWindow()
  const clock = fakeClock()
  let reveals = 0

  installMainWindowRevealLifecycle(window, () => {
    reveals += 1
  }, {
    schedule: clock.schedule,
    cancel: clock.cancel,
  })
  clock.scheduled[0].callback()

  assert.equal(reveals, 2)
  assert.equal(clock.scheduled[0].unrefCalls, 0)
})

test('fallback does not reveal a destroyed window', () => {
  const window = new FakeWindow()
  const clock = fakeClock()
  let reveals = 0

  installMainWindowRevealLifecycle(window, () => {
    reveals += 1
  }, {
    schedule: clock.schedule,
    cancel: clock.cancel,
  })
  window.destroyed = true
  clock.scheduled[0].callback()

  assert.equal(reveals, 1)
})
