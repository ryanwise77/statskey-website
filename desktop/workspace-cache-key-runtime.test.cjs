const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createWorkspaceCacheKeyProvider,
} = require('./workspace-cache-key-runtime.cjs')

test('workspace cache key is generated lazily once per process session', () => {
  let generations = 0
  const key = createWorkspaceCacheKeyProvider(() => {
    generations += 1
    return Buffer.alloc(32, 7)
  })

  const first = key()
  const second = key()
  assert.equal(first, second)
  assert.equal(Buffer.from(first, 'base64').length, 32)
  assert.equal(generations, 1)
})

test('separate process sessions do not reuse a persisted cache key', () => {
  const first = createWorkspaceCacheKeyProvider(() => Buffer.alloc(32, 1))
  const second = createWorkspaceCacheKeyProvider(() => Buffer.alloc(32, 2))
  assert.notEqual(first(), second())
})

test('workspace cache key rejects malformed randomness', () => {
  const key = createWorkspaceCacheKeyProvider(() => Buffer.alloc(16))
  assert.throws(() => key(), /generation failed/)
})
