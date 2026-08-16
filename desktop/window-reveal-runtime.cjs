const MAIN_WINDOW_VISIBILITY_OPTIONS = Object.freeze({ show: true })

/**
 * Make the main window visible synchronously, then keep one referenced retry
 * until Chromium confirms the window is ready. Packaged macOS builds must not
 * depend on ready-to-show (or an unref'ed Node timer) for their first window.
 */
function installMainWindowRevealLifecycle(
  window,
  reveal,
  {
    delay = 4_000,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = {}
) {
  if (!window || typeof window.once !== 'function') {
    throw new TypeError('A BrowserWindow-compatible target is required.')
  }
  if (typeof reveal !== 'function') {
    throw new TypeError('A reveal function is required.')
  }

  let fallback = null
  const revealIfAlive = () => {
    if (!window.isDestroyed()) reveal(window)
  }
  const onReady = () => {
    if (fallback !== null) {
      cancel(fallback)
      fallback = null
    }
    revealIfAlive()
  }

  window.once('ready-to-show', onReady)
  fallback = schedule(() => {
    fallback = null
    revealIfAlive()
  }, delay)

  // The OS receives a real visible application window immediately. The
  // ready event and referenced fallback are reinforcement, not prerequisites.
  revealIfAlive()

  return () => {
    if (fallback !== null) {
      cancel(fallback)
      fallback = null
    }
    window.removeListener?.('ready-to-show', onReady)
  }
}

module.exports = {
  MAIN_WINDOW_VISIBILITY_OPTIONS,
  installMainWindowRevealLifecycle,
}
