const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ProviderCancelledError,
  ProviderHardTimeoutError,
  createProviderRunGuard,
  withProviderDeadline,
} = require('./provider-run-guard.cjs')

test('provider deadline rejects and aborts even when the SDK promise never settles', async () => {
  let aborts = 0
  await assert.rejects(
    () =>
      withProviderDeadline(new Promise(() => {}), {
        timeoutMilliseconds: 10,
        onTimeout: () => {
          aborts += 1
        },
      }),
    ProviderHardTimeoutError
  )
  assert.equal(aborts, 1)
})

test('provider deadline clears its timer after normal completion', async () => {
  let timedOut = false
  const result = await withProviderDeadline(Promise.resolve('complete'), {
    timeoutMilliseconds: 10,
    onTimeout: () => {
      timedOut = true
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(result, 'complete')
  assert.equal(timedOut, false)
})

test('provider guard cancels and releases an SDK promise that ignores abort', async () => {
  let aborts = 0
  const guard = createProviderRunGuard(new Promise(() => {}), {
    timeoutMilliseconds: 1_000,
    onAbort: () => {
      aborts += 1
    },
  })
  assert.equal(guard.cancel(), true)
  await assert.rejects(() => guard.result, ProviderCancelledError)
  assert.equal(guard.cancel(), false)
  assert.equal(aborts, 1)
})
