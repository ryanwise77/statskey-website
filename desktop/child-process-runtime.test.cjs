const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { runBoundedChildProcess } = require('./child-process-runtime.cjs')

test('bounded child settles at its deadline when kill is ignored', async () => {
  const child = fakeChild()
  let settlements = 0
  const result = await runBoundedChildProcess({
    executable: 'ignored',
    timeoutMilliseconds: 15,
    spawnProcess: () => child,
    onSettle: () => {
      settlements += 1
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.equal(result.exitCode, null)
  assert.equal(child.killCalls, 1)
  assert.equal(settlements, 1)
})

test('bounded child guards a throwing kill and fences a late close', async () => {
  const child = fakeChild({ killError: new Error('already gone') })
  let settlements = 0
  const result = await runBoundedChildProcess({
    executable: 'ignored',
    timeoutMilliseconds: 15,
    spawnProcess: () => child,
    onSettle: () => {
      settlements += 1
    },
  })

  assert.equal(result.timedOut, true)
  assert.equal(child.killCalls, 1)
  child.emit('close', 0, null)
  child.emit('error', new Error('late error'))
  assert.equal(settlements, 1)
  assert.equal(result.exitCode, null)
})

test('bounded child captures normal output and clears its deadline', async () => {
  const child = fakeChild()
  const running = runBoundedChildProcess({
    executable: 'example',
    timeoutMilliseconds: 1_000,
    spawnProcess: () => child,
  })
  child.stdout.emit('data', Buffer.from('ready'))
  child.stderr.emit('data', Buffer.from('warning'))
  child.emit('close', 0, null)

  await assert.doesNotReject(async () => {
    const result = await running
    assert.equal(result.ok, true)
    assert.equal(result.timedOut, false)
    assert.equal(result.stdout, 'ready')
    assert.equal(result.stderr, 'warning')
  })
})

test('bounded child writes hook input before waiting for completion', async () => {
  const child = fakeChild()
  const running = runBoundedChildProcess({
    executable: 'hook',
    input: '{"event":"beforeShellExecution"}',
    timeoutMilliseconds: 1_000,
    spawnProcess: () => child,
  })
  child.emit('close', 0, null)
  const result = await running

  assert.equal(result.ok, true)
  assert.deepEqual(child.stdinWrites, ['{"event":"beforeShellExecution"}'])
})

function fakeChild({ killError } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdinWrites = []
  child.stdin = {
    end(value) {
      child.stdinWrites.push(value)
    },
  }
  child.killCalls = 0
  child.kill = () => {
    child.killCalls += 1
    if (killError) throw killError
    return true
  }
  return child
}
