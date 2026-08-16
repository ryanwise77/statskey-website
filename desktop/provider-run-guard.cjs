class ProviderHardTimeoutError extends Error {
  constructor() {
    super('The provider did not complete within the ten-minute safety limit.')
    this.name = 'ProviderHardTimeoutError'
  }
}

class ProviderCancelledError extends Error {
  constructor() {
    super('Stopped.')
    this.name = 'ProviderCancelledError'
  }
}

/**
 * A provider SDK is allowed to ignore AbortSignal internally, but it is never
 * allowed to keep a desktop queue slot forever. Racing the SDK promise against
 * this independent deadline lets the caller release its slot and fence late
 * events even when a socket never settles after abort.
 */
async function withProviderDeadline(
  promise,
  { timeoutMilliseconds = 10 * 60 * 1000, onTimeout } = {}
) {
  const boundedTimeout =
    Number.isFinite(timeoutMilliseconds) && timeoutMilliseconds > 0
      ? timeoutMilliseconds
      : 10 * 60 * 1000
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new ProviderHardTimeoutError())
          try {
            onTimeout?.()
          } catch {
            // The deadline already won the race; abort is best-effort cleanup.
          }
        }, boundedTimeout)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Returns an independently cancellable run. Cancellation rejects the guarded
 * result even if the provider SDK ignores AbortSignal, allowing the caller to
 * release its queue slot immediately and suppress any late SDK completion.
 */
function createProviderRunGuard(
  providerPromise,
  { timeoutMilliseconds = 10 * 60 * 1000, onAbort } = {}
) {
  let open = true
  let rejectCancellation
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject
  })
  const result = withProviderDeadline(
    Promise.race([providerPromise, cancellation]),
    {
      timeoutMilliseconds,
      onTimeout: onAbort,
    }
  ).finally(() => {
    open = false
  })

  return {
    result,
    cancel() {
      if (!open) return false
      open = false
      rejectCancellation(new ProviderCancelledError())
      try {
        onAbort?.()
      } catch {
        // Cancellation already won the race; abort is best-effort cleanup.
      }
      return true
    },
  }
}

module.exports = {
  ProviderCancelledError,
  ProviderHardTimeoutError,
  createProviderRunGuard,
  withProviderDeadline,
}
