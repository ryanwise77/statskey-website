'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { generateKeyPairSync } = require('node:crypto')
const {
  FleetIdentityStore,
} = require('./fleet-identity-store.cjs')
const {
  generateFleetDeviceIdentity,
} = require('./fleet-pairing-runtime.cjs')
const { exportPublicKeySpki } = require('./fleet-auth-runtime.cjs')

const COORDINATOR_PUBLIC_KEY = exportPublicKeySpki(
  generateKeyPairSync('ed25519').publicKey
)

function coordinatorTrust() {
  return {
    coordinatorKeyId: 'workbench-2026-01',
    coordinatorPublicKeySpki: COORDINATOR_PUBLIC_KEY,
  }
}

function cryptoBoundary() {
  return {
    async encryptString(value) {
      return Buffer.from(`protected:${value}`, 'utf8')
    },
    async decryptString(value) {
      const encoded = value.toString('utf8')
      assert.equal(encoded.startsWith('protected:'), true)
      return { result: encoded.slice('protected:'.length), shouldReEncrypt: false }
    },
  }
}

function profile() {
  return {
    label: 'Mac mini',
    role: 'worker',
    workerMode: 'dedicated',
    platform: 'darwin',
    maxConcurrentJobs: 2,
  }
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'statskey-fleet-identity-'))
  return {
    directory,
    filePath: path.join(directory, 'fleet-device.json'),
    async cleanup() {
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

test('device identity is encrypted, atomic, and reloadable', async () => {
  const f = await fixture()
  try {
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
      now: () => Date.parse('2026-08-19T07:00:00.000Z'),
    })
    const created = await store.ensure(profile())
    const encoded = await fs.readFile(f.filePath, 'utf8')
    assert.equal(encoded.includes('PRIVATE KEY'), false)
    assert.equal(encoded.includes('protected:'), false)
    assert.equal((await fs.stat(f.filePath)).mode & 0o777, 0o600)

    const reloaded = await new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
    }).load()
    assert.equal(reloaded.deviceId, created.deviceId)
    assert.equal(reloaded.publicKeyFingerprint, created.publicKeyFingerprint)
    assert.equal(reloaded.privateKey.type, 'private')
  } finally {
    await f.cleanup()
  }
})

test('concurrent identity creation produces only one key', async () => {
  const f = await fixture()
  try {
    let generated = 0
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
      generateIdentity(input) {
        generated += 1
        return generateFleetDeviceIdentity(input)
      },
    })
    const identities = await Promise.all([
      store.ensure(profile()),
      store.ensure(profile()),
      store.ensure(profile()),
    ])
    assert.equal(generated, 1)
    assert.equal(new Set(identities.map(({ deviceId }) => deviceId)).size, 1)
  } finally {
    await f.cleanup()
  }
})

test('explicit replacement persists a new unenrolled key', async () => {
  const f = await fixture()
  try {
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
    })
    const original = await store.ensure(profile())
    await store.markEnrolled({
      ownerUid: 'owner-123',
      endpoint: 'https://fleet.statskey.ai/device',
      ...coordinatorTrust(),
    })
    const replacement = await store.replace({
      ...profile(),
      role: 'hybrid',
      workerMode: 'opt-in',
    })
    assert.notEqual(replacement.deviceId, original.deviceId)
    assert.equal(replacement.enrollment, null)
    const reloaded = await new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
    }).load()
    assert.equal(reloaded.deviceId, replacement.deviceId)
    assert.equal(reloaded.profile.role, 'hybrid')
    assert.equal(reloaded.enrollment, null)
  } finally {
    await f.cleanup()
  }
})

test('an ambiguous replacement commit never restores the cached old identity', async () => {
  const f = await fixture()
  let failDirectorySync = false
  const fsImpl = new Proxy(fs, {
    get(target, property) {
      if (property !== 'open') return target[property]
      return async (candidate, ...args) => {
        const handle = await target.open(candidate, ...args)
        if (failDirectorySync && candidate === f.directory) {
          return {
            ...handle,
            async sync() {
              throw new Error('directory sync failed')
            },
            close: handle.close.bind(handle),
          }
        }
        return handle
      }
    },
  })
  try {
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
      fsImpl,
    })
    const original = await store.ensure(profile())
    failDirectorySync = true
    await assert.rejects(
      () => store.replace(profile()),
      (error) => error.fleetIdentityCommitAmbiguous === true
    )
    failDirectorySync = false
    const persisted = await store.reload()
    assert.notEqual(persisted.deviceId, original.deviceId)
    assert.equal(persisted.enrollment, null)
  } finally {
    await f.cleanup()
  }
})

test('enrollment metadata contains no credential-bearing endpoint', async () => {
  const f = await fixture()
  try {
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
      now: () => Date.parse('2026-08-19T07:00:00.000Z'),
    })
    await store.ensure(profile())
    const enrolled = await store.markEnrolled({
      ownerUid: 'owner-123',
      endpoint: 'https://fleet.statskey.ai/device/',
      ...coordinatorTrust(),
    })
    assert.deepEqual(enrolled.enrollment, {
      ownerUid: 'owner-123',
      endpoint: 'https://fleet.statskey.ai/device',
      ...coordinatorTrust(),
      enrolledAt: '2026-08-19T07:00:00.000Z',
    })
    await assert.rejects(
      () =>
        store.markEnrolled({
          ownerUid: 'owner-123',
          endpoint: 'https://user:secret@fleet.statskey.ai/device',
          ...coordinatorTrust(),
        }),
      { code: 'invalid_store' }
    )
  } finally {
    await f.cleanup()
  }
})

test('loopback enrollment is an explicit development-only store option', async () => {
  const f = await fixture()
  try {
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
      allowLoopback: true,
    })
    await store.ensure(profile())
    const enrolled = await store.markEnrolled({
      ownerUid: 'owner-123',
      endpoint: 'http://127.0.0.1:8080/device/',
      ...coordinatorTrust(),
    })
    assert.equal(enrolled.enrollment.endpoint, 'http://127.0.0.1:8080/device')
    const reloaded = await new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
      allowLoopback: true,
    }).load()
    assert.equal(reloaded.enrollment.endpoint, 'http://127.0.0.1:8080/device')
    await assert.rejects(
      () =>
        new FleetIdentityStore({
          filePath: f.filePath,
          crypto: cryptoBoundary(),
        }).load(),
      { code: 'invalid_store' }
    )
  } finally {
    await f.cleanup()
  }
})

test('legacy unsigned coordinator enrollment requires explicit reactivation', async () => {
  const f = await fixture()
  try {
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
    })
    await store.ensure(profile())
    const state = JSON.parse(await fs.readFile(f.filePath, 'utf8'))
    state.enrollment = {
      ownerUid: 'owner-123',
      endpoint: 'https://fleet.statskey.ai/device',
      enrolledAt: '2026-08-19T07:00:00.000Z',
    }
    await fs.writeFile(f.filePath, JSON.stringify(state), { mode: 0o600 })

    const reloaded = await new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
    }).load()
    assert.equal(reloaded.enrollment, null)
  } finally {
    await f.cleanup()
  }
})

test('a metadata/key mismatch fails closed', async () => {
  const f = await fixture()
  try {
    const store = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
    })
    await store.ensure(profile())
    const state = JSON.parse(await fs.readFile(f.filePath, 'utf8'))
    state.deviceId = `dev_${'0'.repeat(32)}`
    await fs.writeFile(f.filePath, JSON.stringify(state), { mode: 0o600 })
    const reopened = new FleetIdentityStore({
      filePath: f.filePath,
      crypto: cryptoBoundary(),
    })
    await assert.rejects(() => reopened.load(), { code: 'identity_mismatch' })
  } finally {
    await f.cleanup()
  }
})
