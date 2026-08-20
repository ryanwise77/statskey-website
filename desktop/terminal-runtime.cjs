const crypto = require('node:crypto')
const pty = require('node-pty')

const MAX_COMMAND_CHARACTERS = 12_000
const MAX_INPUT_CHARACTERS = 32_000
const MAX_OUTPUT_CHARACTERS = 1_000_000
const MAX_RETAINED_SESSIONS = 24
const DEFAULT_CANCEL_GRACE_MILLISECONDS = 1_500
const DEFAULT_CANCEL_SETTLEMENT_MILLISECONDS = 3_000
const MAX_WINDOWS_READY_BUFFER_CHARACTERS = 4_096
const CANCEL_SETTLEMENT_DIAGNOSTIC =
  '\r\n[StatsKey: terminal did not confirm exit after cancellation.]\r\n'

class TerminalRuntime {
  constructor({
    emit = () => {},
    onExit = () => {},
    spawnPty = pty.spawn,
    platform = process.platform,
    cancelGraceMilliseconds = DEFAULT_CANCEL_GRACE_MILLISECONDS,
    cancelSettlementMilliseconds = DEFAULT_CANCEL_SETTLEMENT_MILLISECONDS,
  } = {}) {
    this.emit = emit
    this.onExit = onExit
    this.spawnPty = spawnPty
    this.platform = platform === 'win32' ? 'win32' : platform
    this.cancelGraceMilliseconds = boundedMilliseconds(
      cancelGraceMilliseconds,
      DEFAULT_CANCEL_GRACE_MILLISECONDS
    )
    this.cancelSettlementMilliseconds = boundedMilliseconds(
      cancelSettlementMilliseconds,
      DEFAULT_CANCEL_SETTLEMENT_MILLISECONDS
    )
    this.sessions = new Map()
  }

  start({
    command,
    cwd,
    cols = 100,
    rows = 28,
    metadata = {},
    failClosed = false,
    environment,
  }) {
    const normalizedCommand =
      typeof command === 'string' ? command.trim().slice(0, MAX_COMMAND_CHARACTERS) : ''
    if (!normalizedCommand) throw new Error('Enter a terminal command.')
    if (typeof cwd !== 'string' || !cwd) {
      throw new Error('Choose a terminal working directory.')
    }

    const id = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const windowsReadyMarker =
      this.platform === 'win32' ? windowsConptyReadyMarker(id) : ''
    const shell = shellInvocation(normalizedCommand, {
      failClosed,
      platform: this.platform,
      windowsReadyMarker,
    })
    const child = this.spawnPty(shell.executable, shell.args, {
      name: 'xterm-256color',
      cols: boundedDimension(cols, 20, 400, 100),
      rows: boundedDimension(rows, 5, 160, 28),
      cwd,
      env: terminalEnvironment(environment),
      ...(this.platform === 'win32'
        ? {
            useConpty: true,
            useConptyDll: false,
          }
        : {}),
    })
    const session = {
      id,
      command: normalizedCommand,
      cwd,
      rootName:
        typeof metadata.rootName === 'string' ? metadata.rootName.slice(0, 200) : '',
      failClosed: failClosed === true,
      status: 'running',
      output: '',
      exitCode: null,
      signal: null,
      startedAt,
      updatedAt: startedAt,
      child,
      metadata,
      forceKillTimer: null,
      cancelSettlementTimer: null,
      childCleanupRequested: false,
      windowsReadyMarker,
      windowsReadyBuffer: '',
      settled: false,
    }
    this.sessions.set(id, session)
    this.trimCompletedSessions()

    child.onData((data) => {
      if (session.settled) return
      if (typeof data !== 'string' || !data) return
      const visibleData = consumeWindowsReadyMarker(session, data)
      if (!visibleData) return
      session.output = `${session.output}${visibleData}`.slice(-MAX_OUTPUT_CHARACTERS)
      session.updatedAt = new Date().toISOString()
      try {
        this.emit({ type: 'data', sessionId: id, data: visibleData })
      } catch {
        // A renderer listener must not break terminal lifecycle tracking.
      }
    })
    child.onExit(({ exitCode, signal } = {}) => {
      const exitedCleanly = exitCode === 0 && (!Number.isInteger(signal) || signal === 0)
      this.settleSession(session, {
        exitCode,
        signal,
        status:
          session.status === 'cancelling'
            ? 'cancelled'
            : exitedCleanly
              ? 'exited'
              : 'failed',
      })
    })

    return publicSession(session)
  }

  list() {
    return [...this.sessions.values()]
      .map(publicSession)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  }

  write(sessionId, data) {
    const session = this.sessions.get(sessionId)
    if (!session?.child || session.status !== 'running') return false
    if (typeof data !== 'string' || !data) return false
    session.child.write(data.slice(0, MAX_INPUT_CHARACTERS))
    return true
  }

  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId)
    if (!session?.child || session.status !== 'running') return false
    session.child.resize(
      boundedDimension(cols, 20, 400, 100),
      boundedDimension(rows, 5, 160, 28)
    )
    return true
  }

  cancel(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session?.child || session.status !== 'running') return false
    session.status = 'cancelling'
    session.updatedAt = new Date().toISOString()
    requestSessionChildCleanup(session, 'SIGTERM', this.platform)
    if (session.settled) return true
    session.forceKillTimer = setTimeout(() => {
      if (!session.child || session.settled) return
      requestSessionChildCleanup(session, 'SIGKILL', this.platform, {
        retry: true,
      })
    }, this.cancelGraceMilliseconds)
    session.forceKillTimer.unref?.()
    session.cancelSettlementTimer = setTimeout(() => {
      this.settleSession(session, {
        exitCode: null,
        signal: null,
        status: 'cancelled',
        diagnostic: CANCEL_SETTLEMENT_DIAGNOSTIC,
      })
    }, this.cancelSettlementMilliseconds)
    session.cancelSettlementTimer.unref?.()
    return true
  }

  cancelWhere(predicate) {
    if (typeof predicate !== 'function') return 0
    let cancelled = 0
    for (const session of this.sessions.values()) {
      if (session.status !== 'running') continue
      let matches = false
      try {
        matches = predicate(session.metadata, publicSession(session)) === true
      } catch {
        matches = false
      }
      if (matches && this.cancel(session.id)) cancelled += 1
    }
    return cancelled
  }

  closeAll() {
    for (const session of this.sessions.values()) {
      if (session.child) {
        requestSessionChildCleanup(session, undefined, this.platform)
      }
      clearSessionTimers(session)
      session.settled = true
      session.child = null
    }
    this.sessions.clear()
  }

  settleSession(session, { exitCode, signal, status, diagnostic = '' }) {
    if (session.settled) return false
    session.settled = true
    clearSessionTimers(session)
    // Retain the public PTY handle long enough to request native/worker cleanup
    // once after a natural Windows exit; the settled fence contains a
    // synchronous or late duplicate exit callback from `kill()`.
    if (this.platform === 'win32') {
      requestSessionChildCleanup(session, undefined, this.platform)
    }
    if (diagnostic) {
      session.output = `${session.output}${diagnostic}`.slice(-MAX_OUTPUT_CHARACTERS)
    }
    session.exitCode = Number.isInteger(exitCode) ? exitCode : null
    session.signal = Number.isInteger(signal) ? signal : null
    session.status = status
    session.updatedAt = new Date().toISOString()
    session.child = null
    const snapshot = publicSession(session)
    try {
      this.emit({ type: 'exit', sessionId: session.id, session: snapshot })
    } catch {
      // A renderer listener must not prevent persistence or cleanup.
    }
    Promise.resolve()
      .then(() => this.onExit(snapshot, session.metadata))
      .catch(() => {})
    this.trimCompletedSessions()
    return true
  }

  trimCompletedSessions() {
    if (this.sessions.size <= MAX_RETAINED_SESSIONS) return
    const completed = [...this.sessions.values()]
      .filter((session) => session.status !== 'running' && session.status !== 'cancelling')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    while (
      this.sessions.size > MAX_RETAINED_SESSIONS &&
      completed.length > 0
    ) {
      this.sessions.delete(completed.shift().id)
    }
  }
}

function shellInvocation(
  command,
  {
    failClosed = false,
    platform = process.platform,
    environment = process.env,
    windowsReadyMarker = '',
  } = {}
) {
  if (platform === 'win32') {
    const payload = failClosed ? failClosedWindowsCommand(command) : command
    return {
      executable: process.env.ComSpec || 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        windowsReadyMarker
          ? `echo ${windowsReadyMarker}&${payload}`
          : payload,
      ],
    }
  }
  const configuredShell = String(environment?.SHELL || '').trim()
  const fallbackShell = platform === 'linux' ? '/bin/bash' : '/bin/zsh'
  const executable =
    platform === 'linux' &&
    failClosed &&
    /(?:^|\/)(?:sh|dash)$/.test(configuredShell)
      ? '/bin/bash'
      : configuredShell || fallbackShell
  return {
    executable,
    args: ['-lc', failClosed ? failClosedPosixCommand(command) : command],
  }
}

function windowsConptyReadyMarker(sessionId) {
  return `__STATSKEY_CONPTY_READY_${String(sessionId).replace(/[^a-z0-9]/gi, '')}__`
}

/**
 * node-pty defers Windows writes until ConPTY produces its first output. A
 * command that begins with a silent stdin read would otherwise deadlock: its
 * input is waiting for output and its output is waiting for input. cmd.exe
 * emits a unique marker before the reviewed command, which releases deferred
 * writes; this filter removes that implementation detail across chunk splits.
 */
function consumeWindowsReadyMarker(session, data) {
  const marker = session?.windowsReadyMarker
  if (!marker) return data

  const combined = `${session.windowsReadyBuffer || ''}${data}`
  const markerIndex = combined.indexOf(marker)
  if (
    markerIndex < 0 &&
    combined.length <= MAX_WINDOWS_READY_BUFFER_CHARACTERS
  ) {
    session.windowsReadyBuffer = combined
    return ''
  }

  session.windowsReadyMarker = ''
  session.windowsReadyBuffer = ''
  if (markerIndex < 0) return combined

  const before = combined.slice(0, markerIndex)
  let after = combined.slice(markerIndex + marker.length)
  if (after.startsWith('\r\n')) after = after.slice(2)
  else if (after.startsWith('\n')) after = after.slice(1)
  return `${before}${after}`
}

/**
 * Agent-authored command batches must not inherit the exit status of only the
 * final command. `errexit` stops required trailing checks after the first
 * unhandled failure, while `pipefail` prevents a successful pipeline tail from
 * hiding an earlier failed process. Explicit shell recovery (`||`, `if`, etc.)
 * retains its normal semantics.
 */
function failClosedPosixCommand(command) {
  const statements = failClosedPosixStatements(command)
  if (!statements) {
    throw new Error(
      'Work independently could not safely batch this shell control structure. Run each required command in a separate terminal action.'
    )
  }
  const guarded = statements.map((statement) => `{ ${statement}\n}`).join(' &&\n')
  return `set -e\nset -o pipefail\n${guarded}`
}

/**
 * `errexit` deliberately ignores failures used as the left side of `&&`/`||`.
 * That means `failed_check && echo ok` followed by a successful build can
 * otherwise exit zero. Split simple top-level batches into guarded groups and
 * chain those groups so every submitted statement must succeed. Explicit
 * recovery within one statement (`check || recovery`) keeps normal semantics.
 * Complex shell programs are rejected in the agent lane and can be submitted
 * as separate, reviewable terminal actions; the interactive/manual lane is
 * untouched.
 */
function failClosedPosixStatements(command) {
  const source = String(command || '').trim()
  if (!source) return null
  if (hasUnquotedPosixHash(source)) return null
  const unquoted = unquotedPosixSource(source)
  if (unquoted == null) return null
  if (
    /(^|[;\n]\s*|\s(?:&&|\|\|)\s*)(?:if|then|elif|else|fi|for|while|until|case|esac|select|function|do|done)\b|<<-?|\\\r?\n/i.test(
      unquoted
    ) ||
    /;;/.test(unquoted)
  ) {
    return null
  }

  const statements = []
  let start = 0
  let quote = ''
  let escaped = false
  let substitutionDepth = 0
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1] || ''
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === "'") {
      if (character === "'") quote = ''
      continue
    }
    if (quote === '"' || quote === '`') {
      if (character === '\\' && quote === '"') {
        escaped = true
        continue
      }
      if (character === quote) quote = ''
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '$' && next === '(') {
      substitutionDepth += 1
      index += 1
      continue
    }
    if (character === ')' && substitutionDepth > 0) {
      substitutionDepth -= 1
      continue
    }
    if (substitutionDepth > 0) continue
    if (
      character === '&' &&
      next !== '&' &&
      source[index - 1] !== '&' &&
      source[index - 1] !== '>' &&
      source[index - 1] !== '<' &&
      next !== '>'
    ) {
      return null
    }
    if (character !== '\n' && (character !== ';' || next === ';')) continue
    const statement = source.slice(start, index).trim()
    if (statement) statements.push(statement)
    start = index + 1
  }
  if (quote || escaped || substitutionDepth !== 0) return null
  const finalStatement = source.slice(start).trim()
  if (finalStatement) statements.push(finalStatement)
  if (statements.length === 0) return null
  if (statements.some((statement) => /(?:&&|\|\||\|)\s*$/.test(statement))) {
    return null
  }
  return statements
}

function unquotedPosixSource(source) {
  let result = ''
  let quote = ''
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      result += ' '
      escaped = false
      continue
    }
    if (quote) {
      if (character === '\\' && quote === '"') {
        result += ' '
        escaped = true
        continue
      }
      if (character === quote) quote = ''
      result += character === '\n' ? '\n' : ' '
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      result += ' '
      continue
    }
    if (character === '\\') {
      result += character
      escaped = true
      continue
    }
    result += character
  }
  return quote || escaped ? null : result
}

/**
 * Comments are the one shell construct where rewrapping line boundaries can
 * turn reviewed text into executable code. Reject unquoted `#` in the agent
 * lane instead of attempting to reinterpret shell tokenization. Data hashes
 * remain available when quoted or escaped; manual terminals are unchanged.
 */
function hasUnquotedPosixHash(source) {
  let quote = ''
  let escaped = false
  for (const character of source) {
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === "'") {
      if (character === "'") quote = ''
      continue
    }
    if (quote === '"') {
      if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        quote = ''
      }
      continue
    }
    if (quote === '`') {
      if (character === '\\') {
        escaped = true
      } else if (character === '`') {
        quote = ''
      } else if (character === '#') {
        return true
      }
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '#') return true
  }
  return false
}

/**
 * cmd.exe has no global errexit mode. Guard each submitted batch line so the
 * common multiline agent batch is fail-closed. Explicitly handled failures on
 * a line still work because the guard observes that line's final errorlevel.
 */
function failClosedWindowsCommand(command) {
  return command
    .split(/\r?\n/)
    .flatMap((line) =>
      line.trim()
        ? [line, 'if errorlevel 1 exit /b %errorlevel%']
        : [line]
    )
    .join('\r\n')
}

const TERMINAL_ENVIRONMENT_KEYS = new Set([
  'JAVA_HOME',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
])

function normalizeTerminalEnvironmentOverrides(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(
        ([key, value]) =>
          TERMINAL_ENVIRONMENT_KEYS.has(key) &&
          typeof value === 'string' &&
          !value.includes('\0')
      )
      .slice(0, TERMINAL_ENVIRONMENT_KEYS.size)
      .map(([key, value]) => [key, value.slice(0, 4_000)])
  )
}

function terminalEnvironment(overrides) {
  const environment = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || typeof value !== 'string') continue
    environment[key] = value
  }
  environment.TERM = 'xterm-256color'
  environment.COLORTERM = 'truecolor'
  environment.LANG = environment.LANG || defaultLocale()
  for (const [key, value] of Object.entries(
    normalizeTerminalEnvironmentOverrides(overrides)
  )) {
    environment[key] = value
  }
  return environment
}

function defaultLocale() {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'
  return `${locale.replace('-', '_')}.UTF-8`
}

function boundedDimension(value, minimum, maximum, fallback) {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.round(value)))
    : fallback
}

function boundedMilliseconds(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback
}

function safeKill(child, signal, platform = process.platform) {
  if (!child || typeof child.kill !== 'function') return false
  const supportedSignal = platform === 'win32' ? undefined : signal
  try {
    if (supportedSignal) child.kill(supportedSignal)
    else child.kill()
    return true
  } catch {
    if (!supportedSignal) return false
  }
  try {
    child.kill()
    return true
  } catch {
    return false
  }
}

function requestSessionChildCleanup(
  session,
  signal,
  platform = process.platform,
  { retry = false } = {}
) {
  if (!session?.child) return false
  if (session.childCleanupRequested && !retry) return false
  session.childCleanupRequested = true
  return safeKill(session.child, signal, platform)
}

function clearSessionTimers(session) {
  if (session.forceKillTimer) clearTimeout(session.forceKillTimer)
  if (session.cancelSettlementTimer) clearTimeout(session.cancelSettlementTimer)
  session.forceKillTimer = null
  session.cancelSettlementTimer = null
}

function publicSession(session) {
  return {
    id: session.id,
    command: session.command,
    cwd: session.cwd,
    rootName: session.rootName,
    failClosed: session.failClosed,
    status: session.status,
    output: session.output,
    exitCode: session.exitCode,
    signal: session.signal,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
  }
}

module.exports = {
  TerminalRuntime,
  normalizeTerminalEnvironmentOverrides,
  failClosedPosixCommand,
  failClosedPosixStatements,
  failClosedWindowsCommand,
  shellInvocation,
}
