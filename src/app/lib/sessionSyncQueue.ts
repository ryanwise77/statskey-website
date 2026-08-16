const sessionSyncChains = new Map<string, Promise<void>>()

/**
 * Keeps remote chat snapshots in invocation order without putting network I/O
 * on the live agent path. A disconnected Firestore client can no longer leave
 * the UI stuck in starting/finishing, and an older "started" snapshot cannot
 * arrive after and overwrite the final response from the same client.
 */
export function queueBackgroundSessionSync(
  sessionKey: string,
  write: () => Promise<unknown>
): Promise<void> {
  const previous = sessionSyncChains.get(sessionKey) ?? Promise.resolve()
  const work = previous
    .catch(() => {})
    .then(write)
    .then(() => {})
    .catch(() => {})
  let tracked: Promise<void>
  tracked = work.finally(() => {
    if (sessionSyncChains.get(sessionKey) === tracked) {
      sessionSyncChains.delete(sessionKey)
    }
  })
  sessionSyncChains.set(sessionKey, tracked)
  return tracked
}
