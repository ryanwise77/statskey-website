const { randomBytes } = require('node:crypto')

/**
 * Workspace search is a derived cache, not user state. Keep its on-disk
 * envelope encrypted with one process-session key so startup never asks the
 * OS credential store for a legacy cache key. A cache from an earlier launch
 * simply fails closed and is rebuilt from the unchanged workspace files.
 */
function createWorkspaceCacheKeyProvider(
  generateBytes = () => randomBytes(32)
) {
  let sessionKey = null
  return () => {
    if (sessionKey) return sessionKey
    const bytes = generateBytes()
    if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
      throw new Error('Workspace cache key generation failed.')
    }
    sessionKey = bytes.toString('base64')
    return sessionKey
  }
}

module.exports = { createWorkspaceCacheKeyProvider }
