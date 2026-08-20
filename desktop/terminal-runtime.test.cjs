const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  TerminalRuntime,
  normalizeTerminalEnvironmentOverrides,
  shellInvocation,
} = require('./terminal-runtime.cjs')

test('terminal runtime streams output before process exit', async () => {
  const fixtureDirectory =
    process.platform === 'win32'
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'statskey-terminal-stream-'))
      : ''
  const firstOutput = deferred()
  let streamed = ''
  const exit = deferred()
  const runtime = new TerminalRuntime({
    emit: (event) => {
      if (event.type !== 'data') return
      streamed += event.data
      if (/first/.test(streamed)) firstOutput.resolve()
    },
    onExit: (session) => exit.resolve(session),
  })
  try {
    let command = "printf first; sleep 0.08; printf second"
    let cwd = process.cwd()
    if (process.platform === 'win32') {
      fs.writeFileSync(
        path.join(fixtureDirectory, 'stream-input.cmd'),
        '@echo off\r\necho first\r\nset /p answer=\r\necho second:%answer%\r\n',
        'utf8'
      )
      command = 'stream-input.cmd'
      cwd = fixtureDirectory
    }

    const session = runtime.start({ command, cwd })
    if (process.platform === 'win32') {
      await withTimeout(firstOutput.promise, 3_000)
      assert.equal(
        runtime.list().find((candidate) => candidate.id === session.id)?.status,
        'running'
      )
      assert.equal(runtime.write(session.id, 'alpha\r'), true)
    }

    const finished = await withTimeout(exit.promise, 3_000)
    assert.match(streamed, /first/)
    assert.match(streamed, process.platform === 'win32' ? /second:alpha/ : /second/)
    assert.equal(finished.status, 'exited')
    assert.equal(finished.exitCode, 0)
  } finally {
    runtime.closeAll()
    if (fixtureDirectory) {
      fs.rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  }
})

test('terminal runtime applies bounded explicit environment overrides', async () => {
  const exit = deferred()
  const calls = []
  const child = fakePty()
  const runtime = new TerminalRuntime({
    spawnPty(executable, args, options) {
      calls.push({ executable, args, options })
      queueMicrotask(() => child.exit({ exitCode: 0, signal: 0 }))
      return child
    },
    onExit: (session) => exit.resolve(session),
  })
  runtime.start({
    command: 'gradle test',
    cwd: process.cwd(),
    environment: {
      JAVA_HOME: '/safe/jdk',
      ANDROID_HOME: '/safe/sdk',
      'BAD-NAME': 'ignored',
      NUL: 'bad\0value',
      HOME: '/malicious/home',
      PATH: '/malicious/bin',
      NODE_OPTIONS: '--require=/malicious/file',
      DYLD_INSERT_LIBRARIES: '/malicious/library',
    },
  })
  await withTimeout(exit.promise, 3_000)
  assert.equal(calls[0].options.env.JAVA_HOME, '/safe/jdk')
  assert.equal(calls[0].options.env.ANDROID_HOME, '/safe/sdk')
  assert.equal(calls[0].options.env['BAD-NAME'], undefined)
  assert.equal(calls[0].options.env.NUL, undefined)
  assert.notEqual(calls[0].options.env.HOME, '/malicious/home')
  assert.notEqual(calls[0].options.env.PATH, '/malicious/bin')
  assert.equal(calls[0].options.env.NODE_OPTIONS, undefined)
  assert.equal(calls[0].options.env.DYLD_INSERT_LIBRARIES, undefined)
  runtime.closeAll()
})

test('terminal environment override normalization rejects loader and shell injection keys', () => {
  assert.deepEqual(
    normalizeTerminalEnvironmentOverrides({
      JAVA_HOME: '/safe/jdk',
      ANDROID_HOME: '/safe/sdk',
      ANDROID_SDK_ROOT: '/safe/sdk',
      HOME: '/malicious/home',
      PATH: '/malicious/bin',
      SHELL: '/malicious/shell',
      NODE_OPTIONS: '--require=/malicious/file',
      ELECTRON_RUN_AS_NODE: '1',
      DYLD_INSERT_LIBRARIES: '/malicious/library',
      LD_PRELOAD: '/malicious/library',
    }),
    {
      JAVA_HOME: '/safe/jdk',
      ANDROID_HOME: '/safe/sdk',
      ANDROID_SDK_ROOT: '/safe/sdk',
    }
  )
})

test('Ubuntu uses bash when SHELL is absent or cannot provide pipefail', () => {
  assert.deepEqual(
    shellInvocation('printf ok', {
      platform: 'linux',
      environment: {},
    }),
    {
      executable: '/bin/bash',
      args: ['-lc', 'printf ok'],
    }
  )
  const guarded = shellInvocation('first\nsecond', {
    failClosed: true,
    platform: 'linux',
    environment: { SHELL: '/bin/sh' },
  })
  assert.equal(guarded.executable, '/bin/bash')
  assert.match(guarded.args[1], /^set -e\nset -o pipefail\n/)
})

test('manual Ubuntu terminals still honor an explicitly configured shell', () => {
  assert.equal(
    shellInvocation('printf ok', {
      platform: 'linux',
      environment: { SHELL: '/usr/bin/fish' },
    }).executable,
    '/usr/bin/fish'
  )
})

test('terminal runtime cancels only renderer-owned agent sessions', () => {
  const children = []
  const runtime = new TerminalRuntime({
    spawnPty() {
      const child = fakePty()
      children.push(child)
      return child
    },
  })
  const agent = runtime.start({
    command: 'agent command',
    cwd: process.cwd(),
    metadata: {
      origin: { sessionId: 'agent-session', messageId: 'agent-message' },
    },
  })
  const manual = runtime.start({
    command: 'manual command',
    cwd: process.cwd(),
    metadata: {},
  })

  assert.equal(
    runtime.cancelWhere((metadata) => Boolean(metadata.origin?.sessionId)),
    1
  )
  assert.equal(
    runtime.list().find((session) => session.id === agent.id)?.status,
    'cancelling'
  )
  assert.equal(
    runtime.list().find((session) => session.id === manual.id)?.status,
    'running'
  )
  assert.deepEqual(children[0].killSignals, [
    process.platform === 'win32' ? undefined : 'SIGTERM',
  ])
  assert.deepEqual(children[1].killSignals, [])
  runtime.closeAll()
})

test(
  'agent fail-closed batches preserve the first failure and do not run trailing verification',
  { skip: process.platform === 'win32' },
  async () => {
    const exit = deferred()
    const runtime = new TerminalRuntime({
      onExit: (session) => exit.resolve(session),
    })
    const session = runtime.start({
      command: [
        "printf '** TEST FAILED **\\n'",
        'false',
        "printf 'FULL_BUILD_RAN\\n'",
      ].join('\n'),
      cwd: process.cwd(),
      failClosed: true,
    })

    const finished = await withTimeout(exit.promise, 3_000)
    assert.equal(session.failClosed, true)
    assert.equal(finished.status, 'failed')
    assert.notEqual(finished.exitCode, 0)
    assert.match(finished.output, /\*\* TEST FAILED \*\*/)
    assert.doesNotMatch(finished.output, /FULL_BUILD_RAN/)
    runtime.closeAll()
  }
)

test(
  'agent fail-closed batches do not let an &&-guarded failure reach a later command',
  { skip: process.platform === 'win32' },
  async () => {
    const exit = deferred()
    const runtime = new TerminalRuntime({
      onExit: (session) => exit.resolve(session),
    })
    runtime.start({
      command: [
        "false && printf 'SHOULD_NOT_RUN\\n'",
        "printf 'TRAILING_BUILD_RAN\\n'",
      ].join('\n'),
      cwd: process.cwd(),
      failClosed: true,
    })

    const finished = await withTimeout(exit.promise, 3_000)
    assert.equal(finished.status, 'failed')
    assert.notEqual(finished.exitCode, 0)
    assert.doesNotMatch(finished.output, /SHOULD_NOT_RUN|TRAILING_BUILD_RAN/)
    runtime.closeAll()
  }
)

test(
  'agent fail-closed batches preserve explicit same-statement recovery',
  { skip: process.platform === 'win32' },
  async () => {
    const exit = deferred()
    const runtime = new TerminalRuntime({
      onExit: (session) => exit.resolve(session),
    })
    runtime.start({
      command: [
        "false || printf 'RECOVERED\\n'",
        "printf 'TRAILING_BUILD_RAN\\n'",
      ].join('\n'),
      cwd: process.cwd(),
      failClosed: true,
    })

    const finished = await withTimeout(exit.promise, 3_000)
    assert.equal(finished.status, 'exited')
    assert.equal(finished.exitCode, 0)
    assert.match(finished.output, /RECOVERED/)
    assert.match(finished.output, /TRAILING_BUILD_RAN/)
    runtime.closeAll()
  }
)

test(
  'agent fail-closed batches reject a trailing comment rather than executing its text',
  { skip: process.platform === 'win32' },
  () => {
    const runtime = new TerminalRuntime()
    assert.throws(
      () =>
        runtime.start({
          command: [
            "printf 'SAFE\\n' # comment; printf 'COMMENT_BYPASS\\n'",
            "printf 'END\\n'",
          ].join('\n'),
          cwd: process.cwd(),
          failClosed: true,
        }),
      /could not safely batch this shell control structure/
    )
    runtime.closeAll()
  }
)

test(
  'agent fail-closed batches reject a full-line comment without executing its tail',
  { skip: process.platform === 'win32' },
  () => {
    const runtime = new TerminalRuntime()
    assert.throws(
      () =>
        runtime.start({
          command: [
            "# harmless; printf 'COMMENT_BYPASS\\n'",
            "printf 'SAFE\\n'",
          ].join('\n'),
          cwd: process.cwd(),
          failClosed: true,
        }),
      /could not safely batch this shell control structure/
    )
    runtime.closeAll()
  }
)

test(
  'agent fail-closed batches preserve quoted and escaped hash data',
  { skip: process.platform === 'win32' },
  async () => {
    const exit = deferred()
    const runtime = new TerminalRuntime({
      onExit: (session) => exit.resolve(session),
    })
    runtime.start({
      command: [
        "printf '%s\\n' 'quoted#hash'",
        "printf '%s\\n' escaped\\#hash",
      ].join('\n'),
      cwd: process.cwd(),
      failClosed: true,
    })

    const finished = await withTimeout(exit.promise, 3_000)
    assert.equal(finished.status, 'exited')
    assert.match(finished.output, /quoted#hash/)
    assert.match(finished.output, /escaped#hash/)
    runtime.closeAll()
  }
)

test(
  'agent fail-closed batches reject a double-semicolon parse error instead of executing its tail',
  { skip: process.platform === 'win32' },
  () => {
    const runtime = new TerminalRuntime()
    assert.throws(
      () =>
        runtime.start({
          command: "printf 'SAFE\\n';; printf 'DOUBLE_SEMI_BYPASS\\n'",
          cwd: process.cwd(),
          failClosed: true,
        }),
      /could not safely batch this shell control structure/
    )
    runtime.closeAll()
  }
)

test(
  'manual terminal batches retain normal sequential shell behavior',
  { skip: process.platform === 'win32' },
  async () => {
    const exit = deferred()
    const runtime = new TerminalRuntime({
      onExit: (session) => exit.resolve(session),
    })
    const session = runtime.start({
      command: "false\nprintf 'MANUAL_TRAILING_COMMAND\\n'",
      cwd: process.cwd(),
    })

    const finished = await withTimeout(exit.promise, 3_000)
    assert.equal(session.failClosed, false)
    assert.equal(finished.status, 'exited')
    assert.equal(finished.exitCode, 0)
    assert.match(finished.output, /MANUAL_TRAILING_COMMAND/)
    runtime.closeAll()
  }
)

test('terminal runtime fails closed when a process reports a nonzero signal with exit zero', async () => {
  const child = fakePty()
  const finished = deferred()
  const runtime = new TerminalRuntime({
    spawnPty: () => child,
    onExit: (session) => finished.resolve(session),
  })
  runtime.start({ command: 'xcodebuild test', cwd: process.cwd(), failClosed: true })

  child.exit({ exitCode: 0, signal: 9 })
  const session = await withTimeout(finished.promise, 500)

  assert.equal(session.status, 'failed')
  assert.equal(session.exitCode, 0)
  assert.equal(session.signal, 9)
  runtime.closeAll()
})

test('terminal runtime accepts interactive input', async () => {
  const exit = deferred()
  const fixtureDirectory =
    process.platform === 'win32'
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'statskey-terminal-input-'))
      : ''
  const runtime = new TerminalRuntime({
    onExit: (session) => exit.resolve(session),
  })
  try {
    let command = "IFS= read -r answer; printf 'got:%s\\n' \"$answer\""
    let cwd = process.cwd()
    if (process.platform === 'win32') {
      const fixturePath = path.join(fixtureDirectory, 'silent-input.cmd')
      fs.writeFileSync(
        fixturePath,
        '@echo off\r\nset /p answer=\r\necho got:%answer%\r\n',
        'utf8'
      )
      // Keep this as a plain cwd-relative cmd invocation. Passing an
      // absolute quoted batch path through cmd.exe /s /c changes its quote
      // semantics and can turn the quotes into part of the executable name.
      command = 'silent-input.cmd'
      cwd = fixtureDirectory
    }
    const session = runtime.start({ command, cwd })
    assert.equal(runtime.write(session.id, 'alpha\r'), true)
    const finished = await withTimeout(exit.promise, 3_000)
    assert.match(finished.output, /got:alpha/)
  } finally {
    runtime.closeAll()
    if (fixtureDirectory) {
      fs.rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  }
})

test('terminal runtime cancels a long-running process promptly', async () => {
  const exit = deferred()
  const runtime = new TerminalRuntime({
    onExit: (session) => exit.resolve(session),
  })
  const command =
    process.platform === 'win32'
      ? 'ping -n 30 127.0.0.1 >nul'
      : 'sleep 30'
  const startedAt = Date.now()
  try {
    const session = runtime.start({ command, cwd: process.cwd() })
    assert.equal(runtime.cancel(session.id), true)
    const finished = await withTimeout(exit.promise, 3_000)
    assert.equal(finished.status, 'cancelled')
    assert.ok(Date.now() - startedAt < 2_500)
  } finally {
    runtime.closeAll()
  }
})

test('Windows uses system ConPTY cleanup without POSIX signals', async () => {
  const child = fakePty()
  const spawnCalls = []
  const finished = deferred()
  const runtime = new TerminalRuntime({
    platform: 'win32',
    spawnPty: (executable, args, options) => {
      spawnCalls.push({ executable, args, options })
      return child
    },
    onExit: (session) => finished.resolve(session),
  })
  const session = runtime.start({ command: 'ping -n 30 127.0.0.1', cwd: process.cwd() })

  assert.equal(runtime.cancel(session.id), true)
  assert.equal(spawnCalls[0].options.useConpty, true)
  assert.equal(spawnCalls[0].options.useConptyDll, false)
  assert.deepEqual(child.killSignals, [undefined])
  child.exit({ exitCode: 1, signal: 0 })
  const cancelled = await withTimeout(finished.promise, 500)

  assert.equal(cancelled.status, 'cancelled')
  runtime.closeAll()
})

test('Windows primes silent stdin consumers and hides its split readiness marker', async () => {
  const child = fakePty({ deferWritesUntilData: true })
  const spawnCalls = []
  const events = []
  const finished = deferred()
  const runtime = new TerminalRuntime({
    platform: 'win32',
    spawnPty: (executable, args, options) => {
      spawnCalls.push({ executable, args, options })
      return child
    },
    emit: (event) => events.push(event),
    onExit: (session) => finished.resolve(session),
  })

  const session = runtime.start({ command: 'silent-stdin-reader', cwd: process.cwd() })
  assert.equal(runtime.write(session.id, 'alpha\r'), true)
  assert.deepEqual(child.writes, [])

  const windowsPayload = spawnCalls[0].args.at(-1)
  const marker = /^echo (__STATSKEY_CONPTY_READY_[A-Za-z0-9]+__)&silent-stdin-reader$/.exec(
    windowsPayload
  )?.[1]
  assert.ok(marker)

  child.data(`\u001b[?25l${marker.slice(0, 12)}`)
  assert.deepEqual(child.writes, ['alpha\r'])
  assert.equal(events.filter((event) => event.type === 'data').length, 0)
  child.data(`${marker.slice(12)}\r\ngot:alpha\r\n`)
  child.exit({ exitCode: 0, signal: 0 })
  const exited = await withTimeout(finished.promise, 500)

  const visibleOutput = events
    .filter((event) => event.type === 'data')
    .map((event) => event.data)
    .join('')
  assert.equal(visibleOutput, '\u001b[?25lgot:alpha\r\n')
  assert.equal(exited.output, visibleOutput)
  assert.doesNotMatch(exited.output, /STATSKEY_CONPTY_READY/)
  runtime.closeAll()
})

test('Windows natural exit disposes ConPTY exactly once without changing status', async () => {
  const child = fakePty()
  const events = []
  const exits = []
  const finished = deferred()
  const runtime = new TerminalRuntime({
    platform: 'win32',
    spawnPty: () => child,
    emit: (event) => events.push(event),
    onExit: (session) => {
      exits.push(session)
      finished.resolve(session)
    },
  })

  runtime.start({ command: 'echo complete', cwd: process.cwd() })
  child.exit({ exitCode: 0, signal: 0 })
  const exited = await withTimeout(finished.promise, 500)

  assert.equal(exited.status, 'exited')
  assert.equal(exited.exitCode, 0)
  assert.equal(exited.signal, 0)
  assert.deepEqual(child.killSignals, [undefined])
  assert.equal(events.filter((event) => event.type === 'exit').length, 1)
  assert.equal(exits.length, 1)

  child.exit({ exitCode: 1, signal: 9 })
  await nextTurn()
  runtime.closeAll()
  assert.deepEqual(child.killSignals, [undefined])
  assert.equal(events.filter((event) => event.type === 'exit').length, 1)
  assert.equal(exits.length, 1)
  assert.equal(runtime.list().length, 0)
})

test('terminal runtime synthesizes one cancelled exit when a PTY ignores kill', async () => {
  const child = fakePty()
  const events = []
  const exits = []
  const finished = deferred()
  const runtime = new TerminalRuntime({
    platform: 'darwin',
    spawnPty: () => child,
    cancelGraceMilliseconds: 5,
    cancelSettlementMilliseconds: 20,
    emit: (event) => events.push(event),
    onExit: (session) => {
      exits.push(session)
      finished.resolve(session)
    },
  })

  const session = runtime.start({ command: 'ignored', cwd: process.cwd() })
  assert.equal(runtime.cancel(session.id), true)
  const cancelled = await withTimeout(finished.promise, 500)

  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.exitCode, null)
  assert.equal(cancelled.signal, null)
  assert.match(cancelled.output, /did not confirm exit after cancellation/)
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
  assert.equal(events.filter((event) => event.type === 'exit').length, 1)
  assert.equal(exits.length, 1)

  child.exit({ exitCode: 0, signal: 0 })
  child.data('late output')
  await nextTurn()
  assert.equal(events.filter((event) => event.type === 'exit').length, 1)
  assert.equal(events.filter((event) => event.type === 'data').length, 0)
  assert.equal(exits.length, 1)
  assert.equal(runtime.list()[0].status, 'cancelled')
  runtime.closeAll()
})

test('terminal runtime contains every kill error and still settles cancellation', async () => {
  const child = fakePty({ throwOnKill: true })
  const events = []
  const finished = deferred()
  const runtime = new TerminalRuntime({
    platform: 'darwin',
    spawnPty: () => child,
    cancelGraceMilliseconds: 5,
    cancelSettlementMilliseconds: 20,
    emit: (event) => events.push(event),
    onExit: (session) => finished.resolve(session),
  })

  const session = runtime.start({ command: 'throws', cwd: process.cwd() })
  assert.doesNotThrow(() => runtime.cancel(session.id))
  const cancelled = await withTimeout(finished.promise, 500)

  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(child.killSignals, ['SIGTERM', undefined, 'SIGKILL', undefined])
  assert.equal(events.filter((event) => event.type === 'exit').length, 1)
  assert.doesNotThrow(() => runtime.closeAll())
})

test('Windows cancellation settles safely when ConPTY does not confirm an exit', async () => {
  const child = fakePty()
  const finished = deferred()
  const runtime = new TerminalRuntime({
    platform: 'win32',
    spawnPty: () => child,
    cancelGraceMilliseconds: 5,
    cancelSettlementMilliseconds: 20,
    onExit: (session) => finished.resolve(session),
  })

  const session = runtime.start({ command: 'ignored', cwd: process.cwd() })
  assert.equal(runtime.cancel(session.id), true)
  const cancelled = await withTimeout(finished.promise, 500)

  assert.equal(cancelled.status, 'cancelled')
  assert.match(cancelled.output, /did not confirm exit after cancellation/)
  assert.deepEqual(child.killSignals, [undefined, undefined])
  runtime.closeAll()
})

test('Windows terminal cleanup does not reach into node-pty internals or external process killers', () => {
  const runtimeSource = fs.readFileSync(
    require.resolve('./terminal-runtime.cjs'),
    'utf8'
  )
  assert.doesNotMatch(runtimeSource, /taskkill(?:\.exe)?/i)
  assert.doesNotMatch(runtimeSource, /\.\s*_agent\b|conpty_console_list_agent/)

  const nodePtyRoot = path.dirname(require.resolve('node-pty/package.json'))
  const nodePtyPackage = require('node-pty/package.json')
  assert.equal(nodePtyPackage.version, '1.2.0-beta.15')
  for (const architecture of ['x64', 'arm64']) {
    for (const nativeFile of ['conpty.node', 'conpty_console_list.node']) {
      assert.equal(
        fs.existsSync(
          path.join(
            nodePtyRoot,
            'prebuilds',
            `win32-${architecture}`,
            nativeFile
          )
        ),
        true,
        `node-pty must ship ${nativeFile} for Windows ${architecture}`
      )
    }
  }

  const consoleListAgent = fs.readFileSync(
    path.join(nodePtyRoot, 'lib', 'conpty_console_list_agent.js'),
    'utf8'
  )
  assert.match(consoleListAgent, /try\s*\{/)
  assert.match(consoleListAgent, /catch\s*\(/)
  assert.match(consoleListAgent, /process\.exit\(0\)/)

  const desktopPackage = require('./package.json')
  assert.equal(desktopPackage.dependencies['node-pty'], '1.2.0-beta.15')
  assert.equal(desktopPackage.allowScripts['node-pty@1.2.0-beta.15'], true)
  assert.ok(
    desktopPackage.build.asarUnpack.includes('node_modules/node-pty/**/*'),
    'electron-builder must unpack node-pty Windows helpers beside the native addon'
  )
})

function deferred() {
  let resolve
  const promise = new Promise((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function fakePty({ throwOnKill = false, deferWritesUntilData = false } = {}) {
  let onData = () => {}
  let onExit = () => {}
  let ready = !deferWritesUntilData
  const deferredWrites = []
  return {
    killSignals: [],
    writes: [],
    onData(handler) {
      onData = handler
    },
    onExit(handler) {
      onExit = handler
    },
    write(value) {
      if (!ready) deferredWrites.push(value)
      else this.writes.push(value)
    },
    resize() {},
    kill(signal) {
      this.killSignals.push(signal)
      if (throwOnKill) throw new Error('kill failed')
    },
    data(value) {
      ready = true
      this.writes.push(...deferredWrites.splice(0))
      onData(value)
    },
    exit(value) {
      onExit(value)
    },
  }
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

function withTimeout(promise, milliseconds) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out after ${milliseconds} ms.`)),
        milliseconds
      )
    }),
  ]).finally(() => clearTimeout(timer))
}
