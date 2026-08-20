const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  posixProcessGroupStatus,
  runBoundedChildProcess,
  safeKillChild,
} = require('./child-process-runtime.cjs')

test('POSIX liveness probes distinguish absence from permission denial', () => {
  const errorFor = (code) => {
    const error = new Error(code)
    error.code = code
    return error
  }
  assert.equal(
    posixProcessGroupStatus(42, () => {
      throw errorFor('ESRCH')
    }),
    'dead'
  )
  assert.equal(
    posixProcessGroupStatus(42, () => {
      throw errorFor('EPERM')
    }),
    'unknown'
  )
  assert.equal(posixProcessGroupStatus(42, () => {}), 'alive')
})

test('bounded child reports unconfirmed termination when kill is ignored', async () => {
  const child = fakeChild()
  let settlements = 0
  const result = await runBoundedChildProcess({
    executable: 'ignored',
    timeoutMilliseconds: 15,
    forceKillDelayMilliseconds: 5,
    terminationGraceMilliseconds: 15,
    spawnProcess: () => child,
    onSettle: () => {
      settlements += 1
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.equal(result.terminationConfirmed, false)
  assert.equal(result.exitCode, null)
  assert.equal(child.killCalls, 2)
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
  assert.equal(settlements, 1)
})

test('bounded child guards a throwing kill and fences a late close', async () => {
  const child = fakeChild({ killError: new Error('already gone') })
  let settlements = 0
  const result = await runBoundedChildProcess({
    executable: 'ignored',
    timeoutMilliseconds: 15,
    forceKillDelayMilliseconds: 5,
    terminationGraceMilliseconds: 15,
    spawnProcess: () => child,
    onSettle: () => {
      settlements += 1
    },
  })

  assert.equal(result.timedOut, true)
  assert.equal(result.terminationConfirmed, false)
  assert.equal(child.killCalls, 2)
  child.emit('close', 0, null)
  child.emit('error', new Error('late error'))
  assert.equal(settlements, 1)
  assert.equal(result.exitCode, null)
})

test('a post-spawn process error requires confirmed closure', async () => {
  const child = fakeChild()
  child.pid = 4321
  const running = runBoundedChildProcess({
    executable: 'worker',
    timeoutMilliseconds: 1_000,
    forceKillDelayMilliseconds: 5,
    terminationGraceMilliseconds: 15,
    spawnProcess: () => child,
  })
  child.emit('spawn')
  child.emit('error', new Error('process control failed'))

  const result = await running
  assert.equal(result.ok, false)
  assert.equal(result.terminationConfirmed, false)
  assert.equal(child.killCalls, 2)
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
    assert.equal(result.terminationConfirmed, true)
    assert.equal(result.stdout, 'ready')
    assert.equal(result.stderr, 'warning')
  })
})

test('bounded child can isolate a POSIX worker process group', async () => {
  const child = fakeChild()
  let options
  const running = runBoundedChildProcess({
    executable: 'worker',
    killProcessGroup: true,
    timeoutMilliseconds: 1_000,
    spawnProcess: (_executable, _args, spawnOptions) => {
      options = spawnOptions
      return child
    },
  })
  child.emit('close', 0, null)
  await running
  assert.equal(options.detached, process.platform !== 'win32')
})

test('Windows normal exit requires a declared Job Object owner', async () => {
  const unownedChild = fakeChild()
  const unowned = runBoundedChildProcess({
    executable: 'worker.exe',
    killProcessGroup: true,
    platform: 'win32',
    timeoutMilliseconds: 1_000,
    spawnProcess: () => unownedChild,
  })
  unownedChild.emit('close', 0, null)
  const unownedResult = await unowned
  assert.equal(unownedResult.ok, false)
  assert.equal(unownedResult.terminationConfirmed, false)

  const ownedChild = fakeChild()
  const owned = runBoundedChildProcess({
    executable: 'owner-wrapper.exe',
    killProcessGroup: true,
    processTreeOwned: true,
    platform: 'win32',
    timeoutMilliseconds: 1_000,
    spawnProcess: () => ownedChild,
  })
  ownedChild.emit('close', 0, null)
  const ownedResult = await owned
  assert.equal(ownedResult.ok, true)
  assert.equal(ownedResult.terminationConfirmed, true)
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

test('bounded child cancellation confirms close before settling', async () => {
  const child = fakeChild()
  const controller = new AbortController()
  const running = runBoundedChildProcess({
    executable: 'worker',
    signal: controller.signal,
    timeoutMilliseconds: 1_000,
    forceKillDelayMilliseconds: 10,
    terminationGraceMilliseconds: 100,
    spawnProcess: () => child,
  })
  controller.abort()
  child.emit('close', null, 'SIGTERM')
  const result = await running
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.timedOut, false)
  assert.equal(result.terminationConfirmed, true)
  assert.equal(child.killCalls, 1)
})

test(
  'POSIX process groups escalate and confirm a SIGTERM-ignoring child exited',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runBoundedChildProcess({
      executable: process.execPath,
      args: [
        '-e',
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)",
      ],
      killProcessGroup: true,
      timeoutMilliseconds: 500,
      forceKillDelayMilliseconds: 250,
      terminationGraceMilliseconds: 5_000,
    })

    assert.equal(result.ok, false)
    assert.equal(result.timedOut, true)
    assert.equal(result.terminationConfirmed, true)
    assert.equal(result.signal, 'SIGKILL')
  }
)

test(
  'POSIX cancellation confirms descendants after the root exits first',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runBoundedChildProcess({
      executable: process.execPath,
      args: [
        '-e',
        [
          "const { spawn } = require('node:child_process')",
          `const child = spawn(process.execPath, ['-e', ${JSON.stringify(
            "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
          )}], { stdio: 'ignore' })`,
          'process.stdout.write(String(child.pid))',
          'setInterval(() => {}, 1000)',
        ].join(';'),
      ],
      killProcessGroup: true,
      timeoutMilliseconds: 500,
      forceKillDelayMilliseconds: 500,
      terminationGraceMilliseconds: 5_000,
    })

    assert.equal(result.ok, false)
    assert.equal(result.timedOut, true)
    assert.equal(result.terminationConfirmed, true)
    const descendantPid = Number(result.stdout)
    assert.equal(Number.isInteger(descendantPid), true)
    let descendantExists = true
    for (let attempt = 0; attempt < 40 && descendantExists; attempt += 1) {
      try {
        process.kill(descendantPid, 0)
        await new Promise((resolve) => setTimeout(resolve, 25))
      } catch {
        descendantExists = false
      }
    }
    assert.equal(descendantExists, false)
  }
)

test(
  'POSIX process groups remove descendants left by a successful root',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runBoundedChildProcess({
      executable: process.execPath,
      args: [
        '-e',
        [
          "const { spawn } = require('node:child_process')",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
          'process.stdout.write(String(child.pid))',
          'child.unref()',
        ].join(';'),
      ],
      killProcessGroup: true,
      timeoutMilliseconds: 2_000,
      terminationGraceMilliseconds: 1_000,
    })

    assert.equal(result.ok, true)
    assert.equal(result.terminationConfirmed, true)
    const descendantPid = Number(result.stdout)
    assert.equal(Number.isInteger(descendantPid), true)
    let descendantExists = true
    for (let attempt = 0; attempt < 40 && descendantExists; attempt += 1) {
      try {
        process.kill(descendantPid, 0)
        await new Promise((resolve) => setTimeout(resolve, 25))
      } catch {
        descendantExists = false
      }
    }
    assert.equal(descendantExists, false)
  }
)

test('Windows bounded termination awaits successful tree teardown', async () => {
  const child = fakeChild()
  child.pid = 4321
  const killer = new EventEmitter()
  const controller = new AbortController()
  let settled = false
  const running = runBoundedChildProcess({
    executable: 'worker.exe',
    signal: controller.signal,
    killProcessGroup: true,
    platform: 'win32',
    timeoutMilliseconds: 1_000,
    forceKillDelayMilliseconds: 100,
    terminationGraceMilliseconds: 500,
    spawnProcess: () => child,
    spawnProcessTree: () => killer,
  }).then((result) => {
    settled = true
    return result
  })
  controller.abort()
  child.emit('close', 1, null)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  killer.emit('close', 0)
  const result = await running
  assert.equal(result.cancelled, true)
  assert.equal(result.terminationConfirmed, true)
})

test('Windows fallback cannot claim descendant teardown was confirmed', async () => {
  const child = fakeChild()
  child.pid = 4321
  const controller = new AbortController()
  const running = runBoundedChildProcess({
    executable: 'worker.exe',
    signal: controller.signal,
    killProcessGroup: true,
    platform: 'win32',
    timeoutMilliseconds: 1_000,
    forceKillDelayMilliseconds: 5,
    terminationGraceMilliseconds: 20,
    spawnProcess: () => child,
    spawnProcessTree: () => {
      throw new Error('taskkill unavailable')
    },
  })
  controller.abort()
  child.emit('close', 1, null)
  const result = await running
  assert.equal(result.cancelled, true)
  assert.equal(result.terminationConfirmed, false)
  assert.match(result.error, /not confirmed/)
})

test('Windows Fleet cancellation requests the entire process tree', () => {
  const child = fakeChild()
  child.pid = 4321
  const calls = []
  let unref = false
  assert.equal(
    safeKillChild(child, 'SIGKILL', {
      killProcessGroup: true,
      platform: 'win32',
      spawnProcessTree(executable, args, options) {
        calls.push({ executable, args, options })
        return {
          unref() {
            unref = true
          },
        }
      },
    }),
    true
  )
  assert.deepEqual(calls, [
    {
      executable: 'taskkill.exe',
      args: ['/PID', '4321', '/T', '/F'],
      options: { windowsHide: true, stdio: 'ignore' },
    },
  ])
  assert.equal(unref, true)
  assert.equal(child.killCalls, 0)
})

test('Windows Fleet cancellation falls back when taskkill cannot start', () => {
  const child = fakeChild()
  child.pid = 4321
  assert.equal(
    safeKillChild(child, 'SIGKILL', {
      killProcessGroup: true,
      platform: 'win32',
      spawnProcessTree() {
        throw new Error('taskkill unavailable')
      },
    }),
    true
  )
  assert.deepEqual(child.killSignals, ['SIGKILL'])
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
  child.killSignals = []
  child.kill = (signal) => {
    child.killCalls += 1
    child.killSignals.push(signal)
    if (killError) throw killError
    return true
  }
  return child
}
