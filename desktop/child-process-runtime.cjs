const { spawn } = require('node:child_process')

const DEFAULT_MAX_OUTPUT_CHARACTERS = 200_000

/**
 * Runs a child process behind a deadline that settles independently of the
 * operating system's eventual close notification. Late close/error events are
 * deliberately fenced after the first result.
 */
function runBoundedChildProcess({
  executable,
  args = [],
  cwd,
  env,
  stdio = ['ignore', 'pipe', 'pipe'],
  input,
  timeoutMilliseconds,
  maxOutputCharacters = DEFAULT_MAX_OUTPUT_CHARACTERS,
  timeoutMessage,
  spawnProcess = spawn,
  onSettle = () => {},
}) {
  return new Promise((resolve) => {
    let child
    let stdout = ''
    let stderr = ''
    let timeout = null
    let settled = false

    const finish = (result) => {
      if (settled) return false
      settled = true
      if (timeout) clearTimeout(timeout)
      timeout = null
      const snapshot = { ...result, stdout, stderr }
      try {
        onSettle(snapshot)
      } catch {
        // Observation must never prevent the caller from settling.
      }
      resolve(snapshot)
      return true
    }

    try {
      child = spawnProcess(executable, args, { cwd, env, stdio })
    } catch (error) {
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        error: errorMessage(error),
      })
      return
    }

    const append = (current, chunk) =>
      `${current}${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)}`.slice(
        -positiveInteger(maxOutputCharacters, DEFAULT_MAX_OUTPUT_CHARACTERS)
      )

    child.stdout?.on?.('data', (chunk) => {
      if (settled) return
      stdout = append(stdout, chunk)
    })
    child.stderr?.on?.('data', (chunk) => {
      if (settled) return
      stderr = append(stderr, chunk)
    })
    child.on('error', (error) => {
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        error: errorMessage(error),
      })
    })
    child.on('close', (exitCode, signal) => {
      finish({
        ok: exitCode === 0,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: signal ?? null,
        timedOut: false,
      })
    })

    if (input !== undefined) {
      try {
        if (!child.stdin?.end) throw new Error('Child process input is unavailable.')
        child.stdin.end(input)
      } catch (error) {
        safeKillChild(child)
        finish({
          ok: false,
          exitCode: null,
          signal: null,
          timedOut: false,
          error: errorMessage(error),
        })
        return
      }
    }

    const deadline = positiveInteger(timeoutMilliseconds, 120_000)
    timeout = setTimeout(() => {
      safeKillChild(child)
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: true,
        error:
          timeoutMessage ||
          `Process did not complete within ${Math.round(deadline / 1_000)} seconds.`,
      })
    }, deadline)
    // The deadline is the settlement contract. Keep it referenced so a child
    // with no live native handle cannot leave the returned promise abandoned.
  })
}

function safeKillChild(child, signal) {
  if (!child || typeof child.kill !== 'function') return false
  try {
    child.kill(signal)
    return true
  } catch {
    return false
  }
}

function positiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

module.exports = {
  runBoundedChildProcess,
  safeKillChild,
}
