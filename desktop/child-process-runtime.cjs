const { spawn } = require('node:child_process')

const DEFAULT_MAX_OUTPUT_CHARACTERS = 200_000
const DEFAULT_TERMINATION_GRACE_MS = 5_000
const DEFAULT_FORCE_KILL_DELAY_MS = 1_000

/**
 * Runs a child process behind a deadline. Cancellation and timeout first ask
 * the process tree to stop, then escalate to a forced kill. The result records
 * whether the operating system confirmed process closure before cleanup may
 * safely continue.
 */
function runBoundedChildProcess({
  executable,
  args = [],
  cwd,
  env,
  stdio = ['ignore', 'pipe', 'pipe'],
  input,
  signal,
  timeoutMilliseconds,
  maxOutputCharacters = DEFAULT_MAX_OUTPUT_CHARACTERS,
  timeoutMessage,
  killProcessGroup = false,
  processTreeOwned = false,
  terminationGraceMilliseconds = DEFAULT_TERMINATION_GRACE_MS,
  forceKillDelayMilliseconds = DEFAULT_FORCE_KILL_DELAY_MS,
  spawnProcess = spawn,
  spawnProcessTree = spawn,
  platform = process.platform,
  onSettle = () => {},
}) {
  return new Promise((resolve) => {
    let child
    let stdout = ''
    let stderr = ''
    let timeout = null
    let forceKillTimer = null
    let terminationTimer = null
    let terminationResult = null
    let windowsTreeTerminationConfirmed = false
    let windowsRootCloseResult = null
    let spawnConfirmed = false
    let settled = false
    let abortListener = null

    const finish = (result) => {
      if (settled) return false
      settled = true
      if (timeout) clearTimeout(timeout)
      timeout = null
      if (forceKillTimer) clearTimeout(forceKillTimer)
      forceKillTimer = null
      if (terminationTimer) clearTimeout(terminationTimer)
      terminationTimer = null
      if (abortListener) signal?.removeEventListener?.('abort', abortListener)
      abortListener = null
      const snapshot = { ...result, stdout, stderr }
      try {
        onSettle(snapshot)
      } catch {
        // Observation must never prevent the caller from settling.
      }
      resolve(snapshot)
      return true
    }

    if (signal?.aborted) {
      finish({
        ok: false,
        cancelled: true,
        exitCode: null,
        signal: null,
        timedOut: false,
        terminationConfirmed: true,
        error: 'Process was cancelled.',
      })
      return
    }

    try {
      child = spawnProcess(executable, args, {
        cwd,
        env,
        stdio,
        detached: killProcessGroup && platform !== 'win32',
      })
    } catch (error) {
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        terminationConfirmed: true,
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
    child.once?.('spawn', () => {
      spawnConfirmed = true
    })
    child.on('error', (error) => {
      const mayHaveSpawned =
        spawnConfirmed || (Number.isInteger(child.pid) && child.pid > 0)
      if (mayHaveSpawned) {
        if (!terminationResult) {
          terminate({
            ok: false,
            exitCode: null,
            signal: null,
            timedOut: false,
            error: errorMessage(error),
          })
        }
        return
      }
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        terminationConfirmed: true,
        error: errorMessage(error),
      })
    })
    child.on('close', (exitCode, signal) => {
      const result = terminationResult
        ? {
          ...terminationResult,
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          signal: signal ?? null,
          terminationConfirmed: true,
        }
        : {
          ok: exitCode === 0,
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          signal: signal ?? null,
          timedOut: false,
          terminationConfirmed: true,
        }
      if (
        killProcessGroup &&
        platform !== 'win32' &&
        Number.isInteger(child.pid) &&
        child.pid > 0 &&
        posixProcessGroupStatus(child.pid) !== 'dead'
      ) {
        const grace = positiveInteger(
          terminationGraceMilliseconds,
          DEFAULT_TERMINATION_GRACE_MS
        )
        void terminatePosixProcessGroup(child.pid, grace).then((confirmed) => {
          if (!confirmed) {
            finish({
              ...result,
              ok: false,
              terminationConfirmed: false,
              error:
                'A descendant process remained after the root process exited.',
            })
            return
          }
          finish(result)
        })
        return
      }
      if (terminationResult && killProcessGroup && platform === 'win32') {
        windowsRootCloseResult = result
        if (windowsTreeTerminationConfirmed) finish(result)
        return
      }
      if (
        !terminationResult &&
        killProcessGroup &&
        platform === 'win32' &&
        !processTreeOwned
      ) {
        finish({
          ...result,
          ok: false,
          terminationConfirmed: false,
          error:
            'The Windows process exited without a verifiable Job Object owner.',
        })
        return
      }
      finish(result)
    })
    const terminate = (result) => {
      if (settled || terminationResult) return
      terminationResult = result
      const grace = positiveInteger(
        terminationGraceMilliseconds,
        DEFAULT_TERMINATION_GRACE_MS
      )
      const forceDelay = Math.min(
        positiveInteger(
          forceKillDelayMilliseconds,
          DEFAULT_FORCE_KILL_DELAY_MS
        ),
        grace
      )
      const requestTermination = (signal) => {
        void requestChildTermination(child, signal, {
          killProcessGroup,
          platform,
          spawnProcessTree,
        }).then((confirmed) => {
          if (!confirmed || platform !== 'win32' || !killProcessGroup) return
          windowsTreeTerminationConfirmed = true
          if (windowsRootCloseResult) finish(windowsRootCloseResult)
        })
      }
      requestTermination('SIGTERM')
      forceKillTimer = setTimeout(() => {
        requestTermination('SIGKILL')
      }, forceDelay)
      terminationTimer = setTimeout(() => {
        finish({
          ...terminationResult,
          terminationConfirmed: false,
          error: `${terminationResult.error} Process termination was not confirmed.`,
        })
      }, grace)
    }
    if (signal?.addEventListener) {
      abortListener = () => {
        terminate({
          ok: false,
          cancelled: true,
          exitCode: null,
          signal: null,
          timedOut: false,
          error: 'Process was cancelled.',
        })
      }
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) abortListener()
    }

    if (input !== undefined) {
      try {
        if (!child.stdin?.end) throw new Error('Child process input is unavailable.')
        child.stdin.end(input)
      } catch (error) {
        terminate({
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
      terminate({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: true,
        error:
          timeoutMessage ||
          `Process did not complete within ${Math.round(deadline / 1_000)} seconds.`,
      })
    }, deadline)
    // Keep the deadline referenced. Termination has its own bounded grace
    // period, so a missing native close event cannot abandon the promise.
  })
}

function posixProcessGroupAlive(pid, processKill = process.kill) {
  return posixProcessGroupStatus(pid, processKill) === 'alive'
}

function posixProcessGroupStatus(pid, processKill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return 'dead'
  try {
    processKill(-pid, 0)
    return 'alive'
  } catch (error) {
    return error?.code === 'ESRCH' ? 'dead' : 'unknown'
  }
}

function terminatePosixProcessGroup(
  pid,
  graceMilliseconds = DEFAULT_TERMINATION_GRACE_MS,
  processKill = process.kill
) {
  if (posixProcessGroupStatus(pid, processKill) === 'dead') {
    return Promise.resolve(true)
  }
  try {
    processKill(-pid, 'SIGKILL')
  } catch {
    // The process group may have exited between the probe and kill.
  }
  const grace = positiveInteger(
    graceMilliseconds,
    DEFAULT_TERMINATION_GRACE_MS
  )
  const deadline = Date.now() + grace
  return new Promise((resolve) => {
    const confirm = () => {
      if (posixProcessGroupStatus(pid, processKill) === 'dead') {
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        resolve(false)
        return
      }
      setTimeout(confirm, 25)
    }
    confirm()
  })
}

function requestChildTermination(
  child,
  signal,
  {
    killProcessGroup = false,
    platform = process.platform,
    spawnProcessTree = spawn,
  } = {}
) {
  if (!child || typeof child.kill !== 'function') return Promise.resolve(false)
  if (
    killProcessGroup &&
    platform === 'win32' &&
    Number.isInteger(child.pid) &&
    child.pid > 0
  ) {
    return new Promise((resolve) => {
      let killer
      let resolved = false
      const finish = (value) => {
        if (resolved) return
        resolved = true
        resolve(value)
      }
      const fallback = () => {
        try {
          child.kill(signal)
        } catch {
          // The direct root kill cannot confirm Windows descendant teardown.
        }
        finish(false)
      }
      try {
        killer = spawnProcessTree(
          'taskkill.exe',
          [
            '/PID',
            String(child.pid),
            '/T',
            ...(signal === 'SIGKILL' ? ['/F'] : []),
          ],
          {
            windowsHide: true,
            stdio: 'ignore',
          }
        )
      } catch {
        fallback()
        return
      }
      killer?.once?.('error', fallback)
      killer?.once?.('close', (exitCode) => {
        if (exitCode === 0) finish(true)
        else fallback()
      })
      if (!killer?.once) fallback()
    })
  }
  try {
    if (
      killProcessGroup &&
      platform !== 'win32' &&
      Number.isInteger(child.pid) &&
      child.pid > 0
    ) {
      process.kill(-child.pid, signal)
      return Promise.resolve(true)
    }
    return Promise.resolve(child.kill(signal) !== false)
  } catch {
    return Promise.resolve(false)
  }
}

function safeKillChild(
  child,
  signal,
  {
    killProcessGroup = false,
    platform = process.platform,
    spawnProcessTree = spawn,
  } = {}
) {
  if (!child || typeof child.kill !== 'function') return false
  try {
    if (
      killProcessGroup &&
      platform === 'win32' &&
      Number.isInteger(child.pid) &&
      child.pid > 0
    ) {
      try {
        const killer = spawnProcessTree(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          {
            windowsHide: true,
            stdio: 'ignore',
          }
        )
        killer?.once?.('error', () => {
          try {
            child.kill(signal)
          } catch {
            // The child may already have exited.
          }
        })
        killer?.unref?.()
        return true
      } catch {
        child.kill(signal)
        return true
      }
    }
    if (
      killProcessGroup &&
      platform !== 'win32' &&
      Number.isInteger(child.pid) &&
      child.pid > 0
    ) {
      process.kill(-child.pid, signal)
      return true
    }
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
  posixProcessGroupAlive,
  posixProcessGroupStatus,
  requestChildTermination,
  safeKillChild,
  terminatePosixProcessGroup,
}
