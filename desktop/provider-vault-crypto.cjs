const DEFAULT_PROVIDER_VAULT_DEADLINE_MILLISECONDS = 10_000
const {
  secureStorageBackendError,
} = require('./safe-storage-runtime.cjs')

class ProviderVaultCryptoTimeoutError extends Error {
  constructor(operation, milliseconds) {
    super(
      `Secure credential storage did not respond within ${Math.round(
        milliseconds / 1_000
      )} seconds while ${operation}. Your saved credentials were not changed.`
    )
    this.name = 'ProviderVaultCryptoTimeoutError'
    this.operation = operation
  }
}

class ProviderVaultCryptoUnavailableError extends Error {
  constructor(message = 'Secure OS credential storage is unavailable.') {
    super(message)
    this.name = 'ProviderVaultCryptoUnavailableError'
  }
}

/**
 * Async-only boundary around Electron safeStorage. Keychain access must never
 * use the synchronous safeStorage methods on the Electron main thread.
 */
class ProviderVaultCrypto {
  constructor({
    safeStorage,
    platform = process.platform,
    deadlineMilliseconds = DEFAULT_PROVIDER_VAULT_DEADLINE_MILLISECONDS,
  }) {
    this.safeStorage = safeStorage
    this.platform = platform
    this.deadlineMilliseconds = positiveMilliseconds(
      deadlineMilliseconds,
      DEFAULT_PROVIDER_VAULT_DEADLINE_MILLISECONDS
    )
  }

  async decryptString(encrypted) {
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
      throw new ProviderVaultCryptoUnavailableError(
        'Saved provider credentials are invalid.'
      )
    }
    return await this.withDeadline('unlocking provider credentials', async () => {
      await this.assertAvailable()
      const decrypt = this.safeStorage?.decryptStringAsync
      if (typeof decrypt !== 'function') {
        throw new ProviderVaultCryptoUnavailableError(
          'This desktop build does not support non-blocking credential access.'
        )
      }
      const decrypted = await decrypt.call(this.safeStorage, encrypted)
      const result =
        typeof decrypted === 'string' ? decrypted : decrypted?.result
      if (typeof result !== 'string') {
        throw new ProviderVaultCryptoUnavailableError(
          'Secure credential storage returned an invalid response.'
        )
      }
      return {
        result,
        shouldReEncrypt: decrypted?.shouldReEncrypt === true,
      }
    })
  }

  async encryptString(plaintext) {
    if (typeof plaintext !== 'string') {
      throw new ProviderVaultCryptoUnavailableError(
        'Provider credentials could not be prepared for secure storage.'
      )
    }
    return await this.withDeadline('saving provider credentials', async () => {
      await this.assertAvailable()
      const encrypt = this.safeStorage?.encryptStringAsync
      if (typeof encrypt !== 'function') {
        throw new ProviderVaultCryptoUnavailableError(
          'This desktop build does not support non-blocking credential access.'
        )
      }
      const encrypted = await encrypt.call(this.safeStorage, plaintext)
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
        throw new ProviderVaultCryptoUnavailableError(
          'Secure credential storage returned an invalid response.'
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
      throw new ProviderVaultCryptoUnavailableError(backendError)
    }
    const check = this.safeStorage?.isAsyncEncryptionAvailable
    if (typeof check !== 'function') {
      throw new ProviderVaultCryptoUnavailableError(
        'This desktop build does not support non-blocking credential access.'
      )
    }
    if ((await check.call(this.safeStorage)) !== true) {
      throw new ProviderVaultCryptoUnavailableError()
    }
  }

  async withDeadline(operation, work) {
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new ProviderVaultCryptoTimeoutError(
            operation,
            this.deadlineMilliseconds
          )
        )
      }, this.deadlineMilliseconds)
    })
    try {
      // Calling the supplied work in a microtask also turns synchronous setup
      // failures into a rejection handled by the same boundary.
      return await Promise.race([Promise.resolve().then(work), deadline])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

function positiveMilliseconds(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

module.exports = {
  DEFAULT_PROVIDER_VAULT_DEADLINE_MILLISECONDS,
  ProviderVaultCrypto,
  ProviderVaultCryptoTimeoutError,
  ProviderVaultCryptoUnavailableError,
}
