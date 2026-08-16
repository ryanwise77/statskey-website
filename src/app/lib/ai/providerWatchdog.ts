export type ProviderWatchdogSignal = 'queued' | 'active'

export class ProviderRoundTimeoutError extends Error {
  readonly phase: 'connecting' | ProviderWatchdogSignal | 'active-limit'

  constructor(phase: 'connecting' | ProviderWatchdogSignal | 'active-limit') {
    super(
      phase === 'queued'
        ? 'The provider queue did not advance before its safety deadline.'
        : phase === 'active-limit'
          ? 'The provider request exceeded its maximum round time.'
        : 'The provider connection stopped reporting activity.'
    )
    this.name = 'ProviderRoundTimeoutError'
    this.phase = phase
  }
}

export interface ProviderWatchdogOptions {
  /** Time allowed for main-process acknowledgement of a dispatched request. */
  connectionTimeoutMs?: number
  /** Maximum queue wait. Queue time never consumes the active-round timer. */
  queueTimeoutMs?: number
  /** Silence allowed after the provider request opens. */
  activeInactivityTimeoutMs?: number
  /** Absolute active-round limit; heartbeats cannot extend this deadline. */
  activeMaximumTimeoutMs?: number
  onTimeout?: () => void
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000
const DEFAULT_QUEUE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_ACTIVE_INACTIVITY_TIMEOUT_MS = 5 * 60_000
const DEFAULT_ACTIVE_MAXIMUM_TIMEOUT_MS = 12 * 60_000

/**
 * Watches transport liveness rather than total reasoning time. The desktop
 * main process emits active heartbeats while a provider SDK request is alive,
 * so a healthy long-running round is not cancelled just because five minutes
 * elapsed. Queue time has its own deadline and never consumes active time.
 */
export async function withProviderRoundWatchdog<T>(
  start: (markAlive: (signal: ProviderWatchdogSignal) => void) => Promise<T>,
  options: ProviderWatchdogOptions = {}
): Promise<T> {
  const connectionTimeoutMs = positiveDuration(
    options.connectionTimeoutMs,
    DEFAULT_CONNECTION_TIMEOUT_MS
  )
  const queueTimeoutMs = positiveDuration(
    options.queueTimeoutMs,
    DEFAULT_QUEUE_TIMEOUT_MS
  )
  const activeInactivityTimeoutMs = positiveDuration(
    options.activeInactivityTimeoutMs,
    DEFAULT_ACTIVE_INACTIVITY_TIMEOUT_MS
  )
  const activeMaximumTimeoutMs = positiveDuration(
    options.activeMaximumTimeoutMs,
    DEFAULT_ACTIVE_MAXIMUM_TIMEOUT_MS
  )
  let phase: 'connecting' | ProviderWatchdogSignal = 'connecting'
  let timer: ReturnType<typeof setTimeout> | undefined
  let maximumTimer: ReturnType<typeof setTimeout> | undefined
  let activeMaximumArmed = false
  let settled = false
  let timedOut = false
  let rejectTimeout: ((reason: ProviderRoundTimeoutError) => void) | undefined

  const triggerTimeout = (
    timeoutPhase: 'connecting' | ProviderWatchdogSignal | 'active-limit'
  ) => {
    if (settled || timedOut) return
    timedOut = true
    rejectTimeout?.(new ProviderRoundTimeoutError(timeoutPhase))
    try {
      options.onTimeout?.()
    } catch {
      // The watchdog already won the race; cancellation is cleanup only.
    }
  }
  const arm = (milliseconds: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => triggerTimeout(phase), milliseconds)
  }

  const timeout = new Promise<T>((_, reject) => {
    rejectTimeout = reject
    arm(connectionTimeoutMs)
  })
  const markAlive = (signal: ProviderWatchdogSignal) => {
    if (settled) return
    if (signal === 'queued') {
      // Position refreshes are informative but do not extend an unbounded
      // queue forever. Arm this deadline only on the first queued event.
      if (phase !== 'queued') {
        phase = 'queued'
        arm(queueTimeoutMs)
      }
      return
    }
    phase = 'active'
    if (!activeMaximumArmed) {
      activeMaximumArmed = true
      maximumTimer = setTimeout(
        () => triggerTimeout('active-limit'),
        activeMaximumTimeoutMs
      )
    }
    arm(activeInactivityTimeoutMs)
  }

  try {
    return await Promise.race([start(markAlive), timeout])
  } finally {
    settled = true
    if (timer) clearTimeout(timer)
    if (maximumTimer) clearTimeout(maximumTimer)
  }
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}
