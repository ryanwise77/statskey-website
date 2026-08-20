const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const {
  ProviderVaultCrypto,
  ProviderVaultCryptoTimeoutError,
  ProviderVaultCryptoUnavailableError,
} = require('./provider-vault-crypto.cjs')

test('a never-returning Keychain decrypt cannot block the event loop or caller', async () => {
  let eventLoopAdvanced = false
  const crypto = new ProviderVaultCrypto({
    safeStorage: fakeStorage({
      decryptStringAsync: () => new Promise(() => {}),
    }),
    deadlineMilliseconds: 20,
  })
  const decrypting = crypto.decryptString(Buffer.from('legacy ciphertext'))
  const eventLoopTurn = new Promise((resolve) => {
    setImmediate(() => {
      eventLoopAdvanced = true
      resolve()
    })
  })

  await Promise.all([
    assert.rejects(decrypting, ProviderVaultCryptoTimeoutError),
    eventLoopTurn,
  ])
  assert.equal(eventLoopAdvanced, true)
})

test('a never-returning Keychain availability check has the same hard deadline', async () => {
  const crypto = new ProviderVaultCrypto({
    safeStorage: fakeStorage({
      isAsyncEncryptionAvailable: () => new Promise(() => {}),
    }),
    deadlineMilliseconds: 20,
  })

  await assert.rejects(
    crypto.encryptString('{"apiKey":"secret"}'),
    (error) =>
      error instanceof ProviderVaultCryptoTimeoutError &&
      error.message.includes('saved credentials were not changed')
  )
})

test('a never-returning Keychain encrypt cannot leave provider save pending', async () => {
  const crypto = new ProviderVaultCrypto({
    safeStorage: fakeStorage({
      encryptStringAsync: () => new Promise(() => {}),
    }),
    deadlineMilliseconds: 20,
  })

  await assert.rejects(
    crypto.encryptString('{"apiKey":"secret"}'),
    (error) =>
      error instanceof ProviderVaultCryptoTimeoutError &&
      error.operation === 'saving provider credentials'
  )
})

test('async decrypt reads ciphertext written by the existing vault format', async () => {
  const crypto = new ProviderVaultCrypto({
    safeStorage: fakeStorage({
      decryptStringAsync: async (encrypted) => ({
        result: encrypted.toString('utf8'),
        shouldReEncrypt: false,
      }),
    }),
  })

  await assert.deepEqual(
    await crypto.decryptString(Buffer.from('{"apiKey":"preserved"}')),
    {
      result: '{"apiKey":"preserved"}',
      shouldReEncrypt: false,
    }
  )
})

test('async encrypt returns the unchanged Buffer-based vault payload contract', async () => {
  let received = null
  const crypto = new ProviderVaultCrypto({
    safeStorage: fakeStorage({
      encryptStringAsync: async (plaintext) => {
        received = plaintext
        return Buffer.from('encrypted bytes')
      },
    }),
  })

  const encrypted = await crypto.encryptString('{"apiKey":"new"}')
  assert.equal(received, '{"apiKey":"new"}')
  assert.equal(encrypted.toString('utf8'), 'encrypted bytes')
})

test('sync-only safeStorage is rejected instead of risking the main thread', async () => {
  const crypto = new ProviderVaultCrypto({
    safeStorage: {
      isEncryptionAvailable: () => true,
      decryptString: () => 'must never run',
    },
  })

  await assert.rejects(
    crypto.decryptString(Buffer.from('ciphertext')),
    ProviderVaultCryptoUnavailableError
  )
})

test('Ubuntu provider credentials require a protected keyring backend', async () => {
  const insecure = new ProviderVaultCrypto({
    platform: 'linux',
    safeStorage: fakeStorage({
      getSelectedStorageBackend: () => 'basic_text',
    }),
  })
  await assert.rejects(
    insecure.encryptString('{"apiKey":"secret"}'),
    (error) =>
      error instanceof ProviderVaultCryptoUnavailableError &&
      error.message.includes('basic-text')
  )

  const secure = new ProviderVaultCrypto({
    platform: 'linux',
    safeStorage: fakeStorage({
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptStringAsync: async () => Buffer.from('protected'),
    }),
  })
  assert.equal(
    (await secure.encryptString('{"apiKey":"secret"}')).toString('utf8'),
    'protected'
  )
})

test('provider save, test, model-list, and run paths use only the awaited async vault boundary', () => {
  const main = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  const handlers = sourceBetween(
    main,
    "ipcMain.handle('statskey-desktop:providers-save'",
    "ipcMain.on('statskey-desktop:provider-cancel'"
  )
  const configuration = sourceBetween(
    main,
    'async function providerConfiguration',
    'function sanitizeProviderConfiguration'
  )
  const save = sourceBetween(
    main,
    'async function saveProviderConfiguration',
    'function enqueueProviderVaultMutation'
  )

  assert.match(handlers, /await enqueueProviderVaultMutation/)
  assert.equal(
    handlers.match(/await providerConfiguration\(provider\)/g)?.length,
    3
  )
  assert.match(configuration, /await providerVaultCrypto\.decryptString/)
  assert.doesNotMatch(configuration, /safeStorage\.decryptString/)
  assert.match(save, /await providerVaultCrypto\.encryptString/)
  assert.doesNotMatch(save, /safeStorage\.encryptString/)
})

function fakeStorage(overrides = {}) {
  return {
    isAsyncEncryptionAvailable: async () => true,
    decryptStringAsync: async () => ({
      result: '{"apiKey":"secret"}',
      shouldReEncrypt: false,
    }),
    encryptStringAsync: async () => Buffer.from('encrypted'),
    ...overrides,
  }
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}
