import type { DesktopTerminalSession } from '../desktop'

export const AGENT_TERMINAL_DEADLINE_MS = 10 * 60_000
export const AGENT_TERMINAL_POST_CANCEL_MS = 5_000

type TerminalSettlementTrigger = 'deadline' | 'cancelled' | null

export interface TerminalSettlementResult {
  session: DesktopTerminalSession | null
  trigger: TerminalSettlementTrigger
  postCancelExpired: boolean
  cancelError: string | null
}

interface TerminalSettlementOptions {
  completion: Promise<DesktopTerminalSession>
  cancel: () => void | Promise<unknown>
  cancelRequested?: Promise<unknown>
  deadlineMs?: number
  postCancelMs?: number
}

type InitialOutcome =
  | { kind: 'settled'; session: DesktopTerminalSession }
  | { kind: 'deadline' }
  | { kind: 'cancelled' }

/**
 * Gives a terminal command its own deadline, independent of provider liveness.
 * Once cancellation begins, the renderer waits only a short bounded interval
 * for the main process to confirm the terminal's final state.
 */
export async function waitForTerminalSettlement({
  completion,
  cancel,
  cancelRequested,
  deadlineMs = AGENT_TERMINAL_DEADLINE_MS,
  postCancelMs = AGENT_TERMINAL_POST_CANCEL_MS,
}: TerminalSettlementOptions): Promise<TerminalSettlementResult> {
  const deadline = deferredTimeout<InitialOutcome>(
    positiveDuration(deadlineMs, AGENT_TERMINAL_DEADLINE_MS),
    { kind: 'deadline' }
  )
  const candidates: Array<Promise<InitialOutcome>> = [
    completion.then((session) => ({ kind: 'settled', session })),
    deadline.promise,
  ]
  if (cancelRequested) {
    candidates.push(
      cancelRequested.then(() => ({ kind: 'cancelled' as const }))
    )
  }

  const initial = await Promise.race(candidates)
  deadline.clear()
  if (initial.kind === 'settled') {
    return {
      session: initial.session,
      trigger: null,
      postCancelExpired: false,
      cancelError: null,
    }
  }

  let cancelError: string | null = null
  try {
    const cancellation = cancel()
    void Promise.resolve(cancellation).catch((error) => {
      cancelError = errorMessage(error)
    })
  } catch (error) {
    cancelError = errorMessage(error)
  }

  const postCancel = deferredTimeout<DesktopTerminalSession | null>(
    positiveDuration(postCancelMs, AGENT_TERMINAL_POST_CANCEL_MS),
    null
  )
  const session = await Promise.race([completion, postCancel.promise])
  postCancel.clear()
  return {
    session,
    trigger: initial.kind,
    postCancelExpired: session == null,
    cancelError,
  }
}

function deferredTimeout<T>(milliseconds: number, value: T): {
  promise: Promise<T>
  clear: () => void
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(value), milliseconds)
  })
  return {
    promise,
    clear: () => {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}

function positiveDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
