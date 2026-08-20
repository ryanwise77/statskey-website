'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const {
  SafeStorageCrypto,
  SafeStorageTimeoutError,
  SafeStorageUnavailableError,
} = require('./safe-storage-runtime.cjs')

test('a stalled asynchronous Keychain request has a hard deadline without blocking the event loop', async () => {
  let eventLoopAdvanced = false
  const crypto = new SafeStorageCrypto({
    safeStorage: fakeStorage({
      decryptStringAsync: () => new Promise(() => {}),
    }),
    deadlineMilliseconds: 20,
  })
  const decrypting = crypto.decryptString(
    Buffer.from('v10 ciphertext'),
    'unlocking test data'
  )
  setImmediate(() => {
    eventLoopAdvanced = true
  })

  await assert.rejects(
    decrypting,
    (error) =>
      error instanceof SafeStorageTimeoutError &&
      error.operation === 'unlocking test data'
  )
  assert.equal(eventLoopAdvanced, true)
})

test('a timeout opens a cooldown circuit instead of starting repeated Keychain waits', async () => {
  let decryptCalls = 0
  let now = 1_000
  const crypto = new SafeStorageCrypto({
    safeStorage: fakeStorage({
      decryptStringAsync: () => {
        decryptCalls += 1
        return new Promise(() => {})
      },
    }),
    deadlineMilliseconds: 20,
    cooldownMilliseconds: 100,
    now: () => now,
  })

  await assert.rejects(
    crypto.decryptString(Buffer.from('first')),
    SafeStorageTimeoutError
  )
  await assert.rejects(
    crypto.decryptString(Buffer.from('second')),
    (error) =>
      error instanceof SafeStorageUnavailableError &&
      error.message.includes('recent timeout')
  )
  assert.equal(decryptCalls, 1)

  now += 101
  const third = crypto.decryptString(Buffer.from('third'))
  await assert.rejects(third, SafeStorageTimeoutError)
  assert.equal(decryptCalls, 2)
})

test('sync-only safeStorage is rejected and its blocking methods are never called', async () => {
  let syncCalls = 0
  const crypto = new SafeStorageCrypto({
    safeStorage: {
      isEncryptionAvailable: () => {
        syncCalls += 1
        return true
      },
      encryptString: () => {
        syncCalls += 1
        return Buffer.from('blocked')
      },
      decryptString: () => {
        syncCalls += 1
        return 'blocked'
      },
    },
  })

  await assert.rejects(
    crypto.encryptString('private'),
    SafeStorageUnavailableError
  )
  await assert.rejects(
    crypto.decryptString(Buffer.from('ciphertext')),
    SafeStorageUnavailableError
  )
  assert.equal(syncCalls, 0)
})

test('async safeStorage preserves Electron ciphertext and decrypt response contracts', async () => {
  const crypto = new SafeStorageCrypto({
    safeStorage: fakeStorage({
      encryptStringAsync: async (plaintext) => Buffer.from(`enc:${plaintext}`),
      decryptStringAsync: async (encrypted) => ({
        result: encrypted.toString('utf8').slice(4),
        shouldReEncrypt: true,
      }),
    }),
  })

  const encrypted = await crypto.encryptString('secret')
  assert.equal(encrypted.toString('utf8'), 'enc:secret')
  assert.deepEqual(await crypto.decryptString(encrypted), {
    result: 'secret',
    shouldReEncrypt: true,
  })
})

test('Ubuntu refuses Electron basic-text storage and accepts Secret Service', async () => {
  const insecure = new SafeStorageCrypto({
    platform: 'linux',
    safeStorage: fakeStorage({
      getSelectedStorageBackend: () => 'basic_text',
    }),
  })
  await assert.rejects(
    insecure.encryptString('secret'),
    (error) =>
      error instanceof SafeStorageUnavailableError &&
      error.message.includes('basic-text')
  )

  const secure = new SafeStorageCrypto({
    platform: 'linux',
    safeStorage: fakeStorage({
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptStringAsync: async () => Buffer.from('protected'),
    }),
  })
  assert.equal(
    (await secure.encryptString('secret')).toString('utf8'),
    'protected'
  )
})

test('Ubuntu fails closed when the secure-storage backend cannot be identified', async () => {
  const crypto = new SafeStorageCrypto({
    platform: 'linux',
    safeStorage: fakeStorage(),
  })
  await assert.rejects(
    crypto.decryptString(Buffer.from('ciphertext')),
    (error) =>
      error instanceof SafeStorageUnavailableError &&
      error.message.includes('could not verify')
  )
})

test('desktop main has no direct synchronous safeStorage operation and awaits calendar crypto', () => {
  const main = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  assert.doesNotMatch(
    main,
    /safeStorage\.(?:isEncryptionAvailable|encryptString|decryptString)\s*\(/
  )
  const calendar = sourceBetween(
    main,
    "ipcMain.handle('statskey-desktop:calendar-feeds-add'",
    "ipcMain.handle('statskey-desktop:providers-save'"
  )
  assert.match(calendar, /calendar-feeds-add', async/)
  assert.match(calendar, /await safeStorageCrypto\.encryptString/)
  assert.match(calendar, /await safeStorageCrypto\.decryptString/)
  assert.match(calendar, /error instanceof SafeStorageTimeoutError/)
  const calendarAdd = sourceBetween(
    calendar,
    "ipcMain.handle('statskey-desktop:calendar-feeds-add'",
    "ipcMain.handle('statskey-desktop:calendar-feeds-remove'"
  )
  assert.ok(
    calendarAdd.indexOf('const vault = readCalendarFeedVault()') >
      calendarAdd.indexOf('await safeStorageCrypto.encryptString'),
    'calendar vault must be read after the asynchronous encryption boundary'
  )
})

function fakeStorage(overrides = {}) {
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => Buffer.from('encrypted'),
    decryptStringAsync: async () => ({
      result: 'decrypted',
      shouldReEncrypt: false,
    }),
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
