/**
 * Turns raw callable failures (`deadline-exceeded`, `resource-exhausted`, …)
 * into sentences a person can act on, plus an optional next step.
 */
export interface IntelligenceError {
  message: string
  action?: { label: string; to: string }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code.replace(/^functions\//, '') : ''
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

export function describeIntelligenceError(error: unknown): IntelligenceError {
  const code = errorCode(error)
  const raw = errorMessage(error).trim()
  const lower = raw.toLowerCase()

  if (code === 'deadline-exceeded' || lower === 'deadline-exceeded' || lower.includes('deadline exceeded')) {
    return {
      message:
        'Claude took longer than StatsKey waited for this answer. Try again, ask a narrower question, or pick a faster model (Sonnet) for this one.',
    }
  }
  if (code === 'resource-exhausted' || lower.includes('limit reached') || lower.includes('credits')) {
    return {
      message: raw || 'You have used this month\'s included Intelligence credits.',
      action: { label: 'Add credits · automatic re-up', to: '/tokens' },
    }
  }
  if (code === 'failed-precondition' && lower.includes('disclosure')) {
    return {
      message: 'Accept the current Intelligence data disclosure in the StatsKey app, then try again.',
    }
  }
  if (code === 'unavailable' || lower.includes('rate limit')) {
    return {
      message: raw || 'Intelligence is busy right now. Wait a moment and try again.',
    }
  }
  if (code === 'unauthenticated') {
    return { message: 'Sign in again to keep using Intelligence.' }
  }
  if (!raw || raw === 'internal' || code === 'internal') {
    return {
      message: raw && raw !== 'internal'
        ? raw
        : 'Intelligence hit an unexpected error. Try again in a moment.',
    }
  }
  return { message: raw }
}
