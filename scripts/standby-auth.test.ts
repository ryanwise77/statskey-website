import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deleteApp, initializeApp } from 'firebase/app'
import { initializeFirestore, terminate } from 'firebase/firestore'
import {
  createStandbyFirestoreCredentialsProvider,
  parseStandbyAuthEndpoint,
  standbyAppUser,
  StandbyAuthClient,
  StandbyAuthError,
  STANDBY_AUDIENCE,
  STANDBY_ISSUER,
} from '../src/app/lib/standbyAuth.ts'

const AUTH_ORIGIN = 'https://auth.157-245-117-209.sslip.io'
const NOW = Date.parse('2026-08-25T21:00:00.000Z')
const UID = 'founder-uid'

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  }
}

function encodePart(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function idToken(options: {
  uid?: string
  userId?: string
  nowMs?: number
  expiresIn?: number
  issuer?: string
  audience?: string
  algorithm?: string
  email?: string
} = {}): string {
  const nowMs = options.nowMs ?? NOW
  return [
    encodePart({ alg: options.algorithm ?? 'RS256', typ: 'JWT', kid: 'continuity-1' }),
    encodePart({
      iss: options.issuer ?? STANDBY_ISSUER,
      aud: options.audience ?? STANDBY_AUDIENCE,
      sub: options.uid ?? UID,
      user_id: options.userId ?? options.uid ?? UID,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + (options.expiresIn ?? 3_600),
      email: options.email ?? 'founder@example.com',
      email_verified: true,
      name: 'Founder',
    }),
    'signature',
  ].join('.')
}

function sessionResponse(options: {
  token?: string
  refreshToken?: string
  uid?: string
  expiresIn?: number
  issuer?: string
} = {}) {
  return {
    idToken: options.token ?? idToken({ uid: options.uid }),
    refreshToken: options.refreshToken ?? 'refresh-1',
    expiresIn: options.expiresIn ?? 3_600,
    uid: options.uid ?? UID,
    issuer: options.issuer ?? STANDBY_ISSUER,
  }
}

function response(value: unknown, status = 200) {
  return {
    status,
    async json() {
      return value
    },
  }
}

describe('standby auth provisioning and validation', () => {
  it('accepts only an HTTPS origin without credentials, path, query, or fragment', () => {
    assert.deepEqual(parseStandbyAuthEndpoint(AUTH_ORIGIN), {
      origin: AUTH_ORIGIN,
      bootstrapUrl: `${AUTH_ORIGIN}/v1/token/bootstrap`,
      passwordUrl: `${AUTH_ORIGIN}/v1/token/password`,
      refreshUrl: `${AUTH_ORIGIN}/v1/token/refresh`,
    })
    for (const invalid of [
      '',
      'http://auth.example.com',
      'https://user:pass@auth.example.com',
      'https://auth.example.com/v1',
      'https://auth.example.com/?next=elsewhere',
    ]) {
      assert.equal(parseStandbyAuthEndpoint(invalid), null)
    }
  })

  it('bootstraps and atomically persists a validated standby refresh session', async () => {
    const storage = fakeStorage()
    const calls: Array<{ url: string; body: Record<string, string> }> = []
    const client = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init.body)) })
        return response(sessionResponse())
      },
    })

    const session = await client.bootstrap('firebase-id-token', UID)
    assert.equal(session.uid, UID)
    assert.equal(session.refreshToken, 'refresh-1')
    assert.equal(session.email, 'founder@example.com')
    assert.deepEqual(calls, [
      {
        url: `${AUTH_ORIGIN}/v1/token/bootstrap`,
        body: { idToken: 'firebase-id-token' },
      },
    ])
    assert.equal(client.readSession()?.idToken, session.idToken)
    assert.equal(storage.map.size, 1)
  })

  it('rejects malformed claims and preserves the prior valid session', async () => {
    const storage = fakeStorage()
    let next = sessionResponse({ refreshToken: 'known-good' })
    const client = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async () => response(next),
    })
    await client.bootstrap('firebase-id-token', UID)

    next = sessionResponse({
      token: idToken({ issuer: 'https://attacker.example.com' }),
      refreshToken: 'must-not-persist',
    })
    await assert.rejects(
      () => client.bootstrap('firebase-id-token-2', UID),
      (error) => error instanceof StandbyAuthError && error.code === 'invalid-response'
    )
    assert.equal(client.readSession()?.refreshToken, 'known-good')

    for (const token of [
      idToken({ audience: 'another-project' }),
      idToken({ algorithm: 'none' }),
      idToken({ userId: 'different-user' }),
      'not-a-jwt',
    ]) {
      next = sessionResponse({ token })
      await assert.rejects(() => client.bootstrap('firebase-id-token-3', UID))
      assert.equal(client.readSession()?.refreshToken, 'known-good')
    }

    next = sessionResponse({ uid: 'different-user' })
    await assert.rejects(
      () => client.bootstrap('firebase-id-token-4', UID),
      (error) => error instanceof StandbyAuthError && error.code === 'invalid-response'
    )
    assert.equal(client.readSession()?.refreshToken, 'known-good')
  })

  it('uses emergency password login and creates only the minimal app-user shape', async () => {
    const storage = fakeStorage()
    let requestBody: Record<string, string> | null = null
    const client = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async (_url, init) => {
        requestBody = JSON.parse(String(init.body))
        return response(sessionResponse())
      },
    })

    const session = await client.password(' founder@example.com ', 'password')
    assert.deepEqual(requestBody, {
      email: 'founder@example.com',
      password: 'password',
    })
    assert.deepEqual(standbyAppUser(session), {
      uid: UID,
      email: 'founder@example.com',
      displayName: 'Founder',
      photoURL: null,
      emailVerified: true,
    })
  })

  it('fails closed when auth is unprovisioned even if storage contains an old token', async () => {
    const storage = fakeStorage()
    const provisioned = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async () => response(sessionResponse()),
    })
    await provisioned.bootstrap('firebase-id-token', UID)

    const unprovisioned = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: '',
      fetch: async () => {
        throw new Error('must not fetch')
      },
    })
    assert.equal(await unprovisioned.getValidSession(), null)
    await assert.rejects(
      () => unprovisioned.password('founder@example.com', 'password'),
      (error) => error instanceof StandbyAuthError && error.code === 'not-configured'
    )
  })
})

describe('standby refresh and Firestore credentials provider', () => {
  it('is accepted by the installed Firestore runtime provider setting', async () => {
    const storage = fakeStorage()
    const client = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async () => response(sessionResponse()),
    })
    const provider = createStandbyFirestoreCredentialsProvider(client)
    const app = initializeApp(
      { projectId: 'standby-provider-contract', apiKey: 'unused', appId: 'contract' },
      `standby-provider-${Date.now()}`
    )
    const settings = {
      host: 'localhost:8999',
      ssl: false,
      credentials: { type: 'provider', client: provider },
    } as unknown as Parameters<typeof initializeFirestore>[1]
    const database = initializeFirestore(app, settings)
    try {
      assert.equal(
        (database as unknown as { _authCredentials: unknown })._authCredentials,
        provider
      )
    } finally {
      await terminate(database)
      await deleteApp(app)
    }
  })

  it('single-flights refresh and atomically persists the rotated refresh token', async () => {
    const storage = fakeStorage()
    let now = NOW
    let refreshCalls = 0
    let releaseRefresh: (() => void) | null = null
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const client = new StandbyAuthClient({
      storage,
      now: () => now,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async (url, init) => {
        if (url.endsWith('/password')) {
          return response(
            sessionResponse({
              token: idToken({ expiresIn: 3_600 }),
              expiresIn: 120,
              refreshToken: 'refresh-old',
            })
          )
        }
        refreshCalls += 1
        assert.deepEqual(JSON.parse(String(init.body)), {
          refreshToken: 'refresh-old',
        })
        await refreshGate
        return response(
          sessionResponse({
            token: idToken({ nowMs: now, expiresIn: 3_600 }),
            refreshToken: 'refresh-rotated',
          })
        )
      },
    })
    await client.password('founder@example.com', 'password')
    now += 40_000

    const first = client.getValidSession()
    const second = client.getValidSession()
    await Promise.resolve()
    assert.equal(refreshCalls, 1)
    releaseRefresh?.()
    const [one, two] = await Promise.all([first, second])
    assert.equal(one?.refreshToken, 'refresh-rotated')
    assert.equal(two?.refreshToken, 'refresh-rotated')
    assert.equal(client.readSession()?.refreshToken, 'refresh-rotated')
  })

  it('matches Firestore provider start/getToken/invalidate/shutdown semantics', async () => {
    const storage = fakeStorage()
    let fetchCount = 0
    const client = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async (url) => {
        fetchCount += 1
        return response(
          sessionResponse({
            refreshToken: url.endsWith('/refresh') ? 'refresh-2' : 'refresh-1',
          })
        )
      },
    })
    await client.password('founder@example.com', 'password')

    const provider = createStandbyFirestoreCredentialsProvider(client)
    const changes: Array<{ uid: string | null; key: string; authenticated: boolean }> = []
    const queued: Array<Promise<void>> = []
    provider.start(
      {
        enqueueRetryable(operation) {
          queued.push(operation())
        },
      },
      async (user) => {
        changes.push({
          uid: user.uid,
          key: user.toKey(),
          authenticated: user.isAuthenticated(),
        })
      }
    )
    await Promise.all(queued)
    assert.deepEqual(changes[0], {
      uid: UID,
      key: `uid:${UID}`,
      authenticated: true,
    })

    const first = await provider.getToken()
    assert.equal(first?.type, 'OAuth')
    assert.equal(first?.headers.get('Authorization'), `Bearer ${idToken()}`)
    assert.equal(first?.user.isEqual(first.user), true)

    provider.invalidateToken()
    const rotated = await provider.getToken()
    assert.equal(rotated?.headers.get('Authorization'), `Bearer ${idToken()}`)
    assert.equal(client.readSession()?.refreshToken, 'refresh-2')
    assert.equal(fetchCount, 2)

    client.clearSession()
    await queued.at(-1)
    assert.deepEqual(changes.at(-1), {
      uid: null,
      key: 'anonymous-user',
      authenticated: false,
    })
    provider.shutdown()
  })

  it('cannot restore an in-flight bootstrap after explicit sign-out', async () => {
    const storage = fakeStorage()
    let release: ((value: ReturnType<typeof response>) => void) | null = null
    const pendingResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      release = resolve
    })
    const client = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async () => pendingResponse,
    })

    const bootstrapping = client.bootstrap('firebase-id-token', UID)
    client.clearSession()
    release?.(response(sessionResponse()))
    await assert.rejects(bootstrapping)
    assert.equal(client.readSession(), null)
    assert.equal(storage.map.size, 0)
  })

  it('cannot persist the prior user during an in-flight account switch', async () => {
    const storage = fakeStorage()
    let releaseFirst: ((value: ReturnType<typeof response>) => void) | null = null
    const firstResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      releaseFirst = resolve
    })
    const nextUid = 'next-user'
    const client = new StandbyAuthClient({
      storage,
      now: () => NOW,
      configuredBuildOrigin: AUTH_ORIGIN,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body)) as { idToken: string }
        return body.idToken === 'first-firebase-token'
          ? firstResponse
          : response(sessionResponse({ uid: nextUid }))
      },
    })

    const first = client.bootstrap('first-firebase-token', UID)
    const next = client.bootstrap('next-firebase-token', nextUid)
    releaseFirst?.(response(sessionResponse({ uid: UID })))
    await assert.rejects(first)
    assert.equal((await next).uid, nextUid)
    assert.equal(client.readSession()?.uid, nextUid)
  })
})
