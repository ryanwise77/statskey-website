export const MAX_STEERING_MESSAGES_PER_BOUNDARY = 8

export class AgentRoundCancelledError extends Error {
  constructor() {
    super('Stopped.')
    this.name = 'AgentRoundCancelledError'
  }
}

export class AgentRoundDeadlineError extends Error {
  constructor() {
    super('The provider did not complete before the managed-round safety deadline.')
    this.name = 'AgentRoundDeadlineError'
  }
}

/**
 * Firebase labels its own client-side callable deadline separately from the
 * agent watchdog. Treat that transport deadline as the same recoverable
 * provider timeout instead of leaking a raw `deadline-exceeded` code to chat.
 */
export function isAgentRoundDeadline(error: unknown): boolean {
  if (
    error instanceof AgentRoundDeadlineError ||
    (error instanceof Error && error.name === 'AgentRoundDeadlineError')
  ) {
    return true
  }
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message =
    typeof candidate.message === 'string' ? candidate.message : ''
  return (
    code === 'deadline-exceeded' ||
    code === 'functions/deadline-exceeded' ||
    /\bdeadline-exceeded\b/i.test(message)
  )
}

/**
 * Removes only the messages that can be incorporated at this model boundary.
 * Anything beyond the bounded batch remains queued for the next boundary.
 */
export function drainSteeringBatch<T>(
  queue: T[],
  limit = MAX_STEERING_MESSAGES_PER_BOUNDARY
): T[] {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(MAX_STEERING_MESSAGES_PER_BOUNDARY, Math.floor(limit)))
    : MAX_STEERING_MESSAGES_PER_BOUNDARY
  return queue.splice(0, boundedLimit)
}

export interface CancellableAgentRoundOptions {
  timeoutMilliseconds: number
  shouldStop?: () => boolean
  registerCancel?: (cancel: (() => void) | null, key?: string) => void
  cancellationKey: string
}

/**
 * Gives managed callables the same terminal guarantees as direct providers.
 * Firebase callables cannot abort their underlying fetch, but this independent
 * race releases the visible run, its workspace lease, and its cancellation
 * slot even if the transport never settles.
 */
export async function withCancellableAgentRound<T>(
  start: () => Promise<T>,
  options: CancellableAgentRoundOptions
): Promise<T> {
  if (options.shouldStop?.()) throw new AgentRoundCancelledError()

  const timeoutMilliseconds =
    Number.isFinite(options.timeoutMilliseconds) &&
    options.timeoutMilliseconds > 0
      ? options.timeoutMilliseconds
      : 5 * 60_000
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let cancelled = false
  let rejectCancellation: ((error: AgentRoundCancelledError) => void) | undefined

  const cancellation = new Promise<T>((_, reject) => {
    rejectCancellation = reject
  })
  const cancel = () => {
    if (settled || cancelled) return
    cancelled = true
    rejectCancellation?.(new AgentRoundCancelledError())
  }
  options.registerCancel?.(cancel, options.cancellationKey)

  const provider = Promise.resolve().then(() => {
    if (cancelled || options.shouldStop?.()) {
      throw new AgentRoundCancelledError()
    }
    return start()
  })
  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new AgentRoundDeadlineError()), timeoutMilliseconds)
  })

  try {
    return await Promise.race([provider, cancellation, deadline])
  } finally {
    settled = true
    if (timer) clearTimeout(timer)
    options.registerCancel?.(null, options.cancellationKey)
  }
}
