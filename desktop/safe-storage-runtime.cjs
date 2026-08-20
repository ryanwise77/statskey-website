const DEFAULT_SAFE_STORAGE_DEADLINE_MILLISECONDS = 10_000
const DEFAULT_SAFE_STORAGE_COOLDOWN_MILLISECONDS = 30_000
const SECURE_LINUX_STORAGE_BACKENDS = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
])

class SafeStorageTimeoutError extends Error {
  constructor(operation, milliseconds) {
    super(
      `Secure OS storage did not respond within ${Math.round(
        milliseconds / 1_000
      )} seconds while ${operation}. No saved data was changed.`
    )
    this.name = 'SafeStorageTimeoutError'
    this.operation = operation
  }
}

class SafeStorageUnavailableError extends Error {
  constructor(message = 'Secure OS storage is unavailable.') {
    super(message)
    this.name = 'SafeStorageUnavailableError'
  }
}

/**
 * A bounded, asynchronous-only boundary around Electron safeStorage.
 * macOS Keychain may wait on SecurityServer; its synchronous APIs must never
 * run on Electron's main thread.
 */
class SafeStorageCrypto {
  constructor({
    safeStorage,
    platform = process.platform,
    deadlineMilliseconds = DEFAULT_SAFE_STORAGE_DEADLINE_MILLISECONDS,
    cooldownMilliseconds = DEFAULT_SAFE_STORAGE_COOLDOWN_MILLISECONDS,
    now = () => Date.now(),
  }) {
    this.safeStorage = safeStorage
    this.platform = platform
    this.deadlineMilliseconds = positiveMilliseconds(
      deadlineMilliseconds,
      DEFAULT_SAFE_STORAGE_DEADLINE_MILLISECONDS
    )
    this.cooldownMilliseconds = positiveMilliseconds(
      cooldownMilliseconds,
      DEFAULT_SAFE_STORAGE_COOLDOWN_MILLISECONDS
    )
    this.now = now
    this.unavailableUntil = 0
  }

  async decryptString(encrypted, operation = 'unlocking saved data') {
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
      throw new SafeStorageUnavailableError('Saved secure data is invalid.')
    }
    return await this.withDeadline(operation, async () => {
      await this.assertAvailable()
      const decrypt = this.safeStorage?.decryptStringAsync
      if (typeof decrypt !== 'function') {
        throw new SafeStorageUnavailableError(
          'This desktop build does not support non-blocking secure storage.'
        )
      }
      const decrypted = await decrypt.call(this.safeStorage, encrypted)
      const result =
        typeof decrypted === 'string' ? decrypted : decrypted?.result
      if (typeof result !== 'string') {
        throw new SafeStorageUnavailableError(
          'Secure OS storage returned an invalid response.'
        )
      }
      return {
        result,
        shouldReEncrypt: decrypted?.shouldReEncrypt === true,
      }
    })
  }

  async encryptString(plaintext, operation = 'saving secure data') {
    if (typeof plaintext !== 'string') {
      throw new SafeStorageUnavailableError(
        'Secure data could not be prepared for storage.'
      )
    }
    return await this.withDeadline(operation, async () => {
      await this.assertAvailable()
      const encrypt = this.safeStorage?.encryptStringAsync
      if (typeof encrypt !== 'function') {
        throw new SafeStorageUnavailableError(
          'This desktop build does not support non-blocking secure storage.'
        )
      }
      const encrypted = await encrypt.call(this.safeStorage, plaintext)
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
        throw new SafeStorageUnavailableError(
          'Secure OS storage returned an invalid response.'
        )
      }
      return encrypted
    })
  }

  async assertAvailable() {
    const backendError = secureStorageBackendError(
      this.safeStorage,
      this.platform
    )
    if (backendError) {
      throw new SafeStorageUnavailableError(backendError)
    }
    const check = this.safeStorage?.isAsyncEncryptionAvailable
    if (typeof check !== 'function') {
      throw new SafeStorageUnavailableError(
        'This desktop build does not support non-blocking secure storage.'
      )
    }
    if ((await check.call(this.safeStorage)) !== true) {
      throw new SafeStorageUnavailableError()
    }
  }

  async withDeadline(operation, work) {
    if (this.now() < this.unavailableUntil) {
      throw new SafeStorageUnavailableError(
        'Secure OS storage is temporarily unavailable after a recent timeout.'
      )
    }
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new SafeStorageTimeoutError(operation, this.deadlineMilliseconds)
        )
      }, this.deadlineMilliseconds)
    })
    try {
      return await Promise.race([Promise.resolve().then(work), deadline])
    } catch (error) {
      if (error instanceof SafeStorageTimeoutError) {
        this.unavailableUntil = this.now() + this.cooldownMilliseconds
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

function positiveMilliseconds(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function secureStorageBackendError(safeStorage, platform = process.platform) {
  if (platform !== 'linux') return null
  const selectedBackend = safeStorage?.getSelectedStorageBackend
  if (typeof selectedBackend !== 'function') {
    return (
      'Ubuntu secure storage could not verify its password manager. ' +
      'Install and unlock GNOME Keyring or KWallet, then reopen StatsKey.'
    )
  }
  let backend
  try {
    backend = selectedBackend.call(safeStorage)
  } catch {
    return (
      'Ubuntu secure storage could not read its password manager. ' +
      'Install and unlock GNOME Keyring or KWallet, then reopen StatsKey.'
    )
  }
  if (!SECURE_LINUX_STORAGE_BACKENDS.has(backend)) {
    return (
      'Ubuntu secure storage is using an unprotected basic-text backend. ' +
      'Install and unlock GNOME Keyring or KWallet, then reopen StatsKey.'
    )
  }
  return null
}

module.exports = {
  DEFAULT_SAFE_STORAGE_COOLDOWN_MILLISECONDS,
  DEFAULT_SAFE_STORAGE_DEADLINE_MILLISECONDS,
  SECURE_LINUX_STORAGE_BACKENDS,
  SafeStorageCrypto,
  SafeStorageTimeoutError,
  SafeStorageUnavailableError,
  secureStorageBackendError,
}
