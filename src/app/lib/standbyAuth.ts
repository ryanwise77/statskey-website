// Google-independent standby authentication.
//
// The standby session is bootstrapped while Firebase Auth is healthy, then
// refreshed directly against the self-hosted IdP during a Google outage. The
// IdP endpoint is explicitly provisioned; there is no built-in destination in
// an unprovisioned build. Tokens are never included in errors or logs.

export const STANDBY_AUTH_ORIGIN_KEY = 'statskey.standbyAuthOrigin'
export const STANDBY_ISSUER = 'https://auth.statskey.ai'
export const STANDBY_AUDIENCE = 'statskey'

const SESSION_KEY = 'statskey.standbyAuthSession.v1'
const REQUEST_TIMEOUT_MS = 8_000
const REFRESH_SKEW_MS = 90_000
const MAX_TOKEN_CHARS = 16_384
const MAX_UID_CHARS = 128
const MAX_EXPIRES_IN_SECONDS = 24 * 60 * 60
const CLOCK_SKEW_SECONDS = 60

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type FetchLike = (
  input: string,
  init: RequestInit
) => Promise<Pick<Response, 'status' | 'json'>>

export interface StandbyAuthEndpoint {
  origin: string
  bootstrapUrl: string
  passwordUrl: string
  refreshUrl: string
}

export interface StandbySession {
  idToken: string
  refreshToken: string
  expiresAt: number
  uid: string
  issuer: typeof STANDBY_ISSUER
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
}

export interface StandbyAppUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
}

interface JwtClaims {
  iss: string
  aud: string | string[]
  sub: string
  user_id?: unknown
  exp: number
  iat?: number
  nbf?: number
  email?: unknown
  email_verified?: unknown
  name?: unknown
  picture?: unknown
}

export type StandbyAuthErrorCode =
  | 'not-configured'
  | 'unavailable'
  | 'rejected'
  | 'invalid-response'

export class StandbyAuthError extends Error {
  readonly code: StandbyAuthErrorCode

  constructor(code: StandbyAuthErrorCode, message: string) {
    super(message)
    this.name = 'StandbyAuthError'
    this.code = code
  }
}

function buildStandbyAuthOrigin(): string {
  const env = import.meta.env as ImportMetaEnv | undefined
  return String(env?.VITE_STATSKEY_STANDBY_AUTH_ORIGIN ?? '').trim()
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function parseStandbyAuthEndpoint(raw: unknown): StandbyAuthEndpoint | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:') return null
    if (url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    const origin = url.origin
    return {
      origin,
      bootstrapUrl: new URL('/v1/token/bootstrap', `${origin}/`).toString(),
      passwordUrl: new URL('/v1/token/password', `${origin}/`).toString(),
      refreshUrl: new URL('/v1/token/refresh', `${origin}/`).toString(),
    }
  } catch {
    return null
  }
}

export function configuredStandbyAuthEndpoint(
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
  configuredBuildOrigin: string = buildStandbyAuthOrigin()
): StandbyAuthEndpoint | null {
  if (storage) {
    try {
      const runtimeValue = storage.getItem(STANDBY_AUTH_ORIGIN_KEY)
      // An explicit but invalid runtime override disables standby auth rather
      // than silently falling through to a different identity provider.
      if (runtimeValue != null) return parseStandbyAuthEndpoint(runtimeValue)
    } catch {
      // If runtime storage cannot be inspected, do not silently select the
      // build-time identity provider with unknown local override state.
      return null
    }
  }
  return parseStandbyAuthEndpoint(configuredBuildOrigin)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

function parseJwtClaims(token: unknown): JwtClaims | null {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_CHARS) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[2] || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    return null
  }
  const header = decodeBase64UrlJson(parts[0])
  const payload = decodeBase64UrlJson(parts[1])
  if (
    !header ||
    header.alg !== 'RS256' ||
    header.typ !== 'JWT' ||
    typeof header.kid !== 'string' ||
    !header.kid ||
    !payload
  ) {
    return null
  }

  const issuer = payload.iss
  const audience = payload.aud
  const subject = payload.sub
  const expires = payload.exp
  if (
    issuer !== STANDBY_ISSUER ||
    (audience !== STANDBY_AUDIENCE &&
      !(Array.isArray(audience) && audience.includes(STANDBY_AUDIENCE))) ||
    typeof subject !== 'string' ||
    !subject ||
    subject.length > MAX_UID_CHARS ||
    typeof expires !== 'number' ||
    !Number.isFinite(expires)
  ) {
    return null
  }
  return payload as unknown as JwtClaims
}

function safeOptionalClaim(value: unknown, maxChars: number): string | null {
  return typeof value === 'string' && value.length <= maxChars ? value : null
}

function validateNewSessionResponse(
  value: unknown,
  nowMs: number,
  expectedUid?: string
): StandbySession | null {
  const response = asRecord(value)
  if (!response) return null
  const idToken = response.idToken
  const refreshToken = response.refreshToken
  const expiresIn = response.expiresIn
  const uid = response.uid
  const issuer = response.issuer
  if (
    typeof idToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    !refreshToken ||
    refreshToken.length > MAX_TOKEN_CHARS ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_EXPIRES_IN_SECONDS ||
    typeof uid !== 'string' ||
    !uid ||
    uid.length > MAX_UID_CHARS ||
    issuer !== STANDBY_ISSUER ||
    (expectedUid != null && uid !== expectedUid)
  ) {
    return null
  }

  const claims = parseJwtClaims(idToken)
  if (
    !claims ||
    claims.sub !== uid ||
    (claims.user_id != null && claims.user_id !== uid)
  ) {
    return null
  }
  if (
    (claims.iat != null &&
      (!Number.isFinite(claims.iat) || claims.iat * 1000 - nowMs > CLOCK_SKEW_SECONDS * 1000)) ||
    (claims.nbf != null &&
      (!Number.isFinite(claims.nbf) || claims.nbf * 1000 - nowMs > CLOCK_SKEW_SECONDS * 1000))
  ) {
    return null
  }
  const jwtExpiresAt = claims.exp * 1000
  if (jwtExpiresAt - nowMs <= CLOCK_SKEW_SECONDS * 1000) return null
  const responseExpiresAt = nowMs + expiresIn * 1000

  return {
    idToken,
    refreshToken,
    expiresAt: Math.min(jwtExpiresAt, responseExpiresAt),
    uid,
    issuer: STANDBY_ISSUER,
    email: safeOptionalClaim(claims.email, 320),
    displayName: safeOptionalClaim(claims.name, 256),
    photoURL: safeOptionalClaim(claims.picture, 2_048),
    emailVerified: claims.email_verified === true,
  }
}

function validateStoredSession(value: unknown): StandbySession | null {
  const session = asRecord(value)
  if (!session) return null
  const claims = parseJwtClaims(session.idToken)
  if (
    !claims ||
    typeof session.idToken !== 'string' ||
    typeof session.refreshToken !== 'string' ||
    !session.refreshToken ||
    session.refreshToken.length > MAX_TOKEN_CHARS ||
    typeof session.expiresAt !== 'number' ||
    !Number.isFinite(session.expiresAt) ||
    typeof session.uid !== 'string' ||
    !session.uid ||
    session.uid.length > MAX_UID_CHARS ||
    session.issuer !== STANDBY_ISSUER ||
    claims.sub !== session.uid ||
    (claims.user_id != null && claims.user_id !== session.uid) ||
    session.expiresAt > claims.exp * 1000 + 1_000
  ) {
    return null
  }
  return {
    idToken: session.idToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    uid: session.uid,
    issuer: STANDBY_ISSUER,
    email: safeOptionalClaim(session.email, 320),
    displayName: safeOptionalClaim(session.displayName, 256),
    photoURL: safeOptionalClaim(session.photoURL, 2_048),
    emailVerified: session.emailVerified === true,
  }
}

export interface StandbyAuthClientOptions {
  storage?: StorageLike | null
  fetch?: FetchLike
  now?: () => number
  configuredBuildOrigin?: string
}

type SessionListener = (session: StandbySession | null) => void

export class StandbyAuthClient {
  private readonly storage: StorageLike | null
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly configuredBuildOrigin: string
  private readonly listeners = new Set<SessionListener>()
  private bootstrapInFlight: {
    expectedUid: string
    promise: Promise<StandbySession>
  } | null = null
  private refreshInFlight: Promise<StandbySession> | null = null
  private revision = 0

  constructor(options: StandbyAuthClientOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.configuredBuildOrigin =
      options.configuredBuildOrigin === undefined
        ? buildStandbyAuthOrigin()
        : options.configuredBuildOrigin
  }

  endpoint(): StandbyAuthEndpoint | null {
    return configuredStandbyAuthEndpoint(this.storage, this.configuredBuildOrigin)
  }

  readSession(): StandbySession | null {
    if (!this.storage) return null
    let encoded: string | null
    try {
      encoded = this.storage.getItem(SESSION_KEY)
    } catch {
      return null
    }
    if (!encoded) return null
    try {
      const session = validateStoredSession(JSON.parse(encoded))
      if (session) return session
    } catch {
      // Invalid local state is cleared below.
    }
    this.clearSession()
    return null
  }

  clearSession(): void {
    this.revision += 1
    try {
      this.storage?.removeItem(SESSION_KEY)
    } catch {
      // The in-memory revision still prevents an in-flight request from
      // restoring a session after an explicit sign-out.
    } finally {
      this.notify(null)
    }
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async bootstrap(firebaseIdToken: string, expectedUid: string): Promise<StandbySession> {
    if (
      typeof firebaseIdToken !== 'string' ||
      !firebaseIdToken ||
      typeof expectedUid !== 'string' ||
      !expectedUid ||
      expectedUid.length > MAX_UID_CHARS
    ) {
      throw new StandbyAuthError('invalid-response', 'Standby bootstrap token is invalid.')
    }
    if (this.bootstrapInFlight) {
      if (this.bootstrapInFlight.expectedUid === expectedUid) {
        return this.bootstrapInFlight.promise
      }
      // Never let a token request for one Firebase user adopt another user's
      // in-flight standby session. Invalidate the first write before waiting,
      // then provision the newly active user independently.
      this.clearSession()
      try {
        await this.bootstrapInFlight.promise
      } catch {
        // The next attempt is authoritative for the newly active user.
      }
      return this.bootstrap(firebaseIdToken, expectedUid)
    }
    const promise = this.performBootstrap(firebaseIdToken, expectedUid).finally(() => {
      if (this.bootstrapInFlight?.promise === promise) this.bootstrapInFlight = null
    })
    this.bootstrapInFlight = { expectedUid, promise }
    return promise
  }

  async password(email: string, password: string): Promise<StandbySession> {
    const normalizedEmail = email.trim()
    if (!normalizedEmail || normalizedEmail.length > 320 || !password) {
      throw new StandbyAuthError('rejected', 'Incorrect email or password.')
    }
    const endpoint = this.requireEndpoint()
    const revision = this.revision
    const response = await this.post(endpoint.passwordUrl, {
      email: normalizedEmail,
      password,
    })
    return this.acceptSession(response, undefined, revision)
  }

  async getValidSession(forceRefresh = false): Promise<StandbySession | null> {
    if (!this.endpoint()) return null
    const session = this.readSession()
    if (!session) return null
    if (!forceRefresh && session.expiresAt - this.now() > REFRESH_SKEW_MS) {
      return session
    }
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.refresh(session).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private requireEndpoint(): StandbyAuthEndpoint {
    const endpoint = this.endpoint()
    if (!endpoint) {
      throw new StandbyAuthError(
        'not-configured',
        'The emergency identity provider is not configured.'
      )
    }
    return endpoint
  }

  private async performBootstrap(
    firebaseIdToken: string,
    expectedUid: string
  ): Promise<StandbySession> {
    const endpoint = this.requireEndpoint()
    const revision = this.revision
    const response = await this.post(endpoint.bootstrapUrl, { idToken: firebaseIdToken })
    return this.acceptSession(response, expectedUid, revision)
  }

  private async refresh(session: StandbySession): Promise<StandbySession> {
    const endpoint = this.requireEndpoint()
    const revision = this.revision
    const response = await this.post(endpoint.refreshUrl, {
      refreshToken: session.refreshToken,
    })
    return this.acceptSession(response, session.uid, revision)
  }

  private acceptSession(
    value: unknown,
    expectedUid?: string,
    expectedRevision: number = this.revision
  ): StandbySession {
    const session = validateNewSessionResponse(value, this.now(), expectedUid)
    if (!session || !this.storage || this.revision !== expectedRevision) {
      throw new StandbyAuthError(
        'invalid-response',
        'The emergency identity provider returned an invalid session.'
      )
    }
    // One validated JSON value atomically replaces both tokens, so a rotated
    // refresh token is never paired with the prior access token.
    try {
      this.storage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      throw new StandbyAuthError(
        'unavailable',
        'The emergency session could not be stored safely.'
      )
    }
    this.revision += 1
    this.notify(session)
    return session
  }

  private async post(url: string, body: Record<string, string>): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (response.status !== 200) {
        throw new StandbyAuthError(
          response.status >= 400 && response.status < 500 ? 'rejected' : 'unavailable',
          response.status >= 400 && response.status < 500
            ? 'Emergency sign-in was rejected.'
            : 'The emergency identity provider is unavailable.'
        )
      }
      try {
        return await response.json()
      } catch {
        throw new StandbyAuthError(
          'invalid-response',
          'The emergency identity provider returned an invalid response.'
        )
      }
    } catch (error) {
      if (error instanceof StandbyAuthError) throw error
      throw new StandbyAuthError(
        'unavailable',
        'The emergency identity provider is unavailable.'
      )
    } finally {
      clearTimeout(timer)
    }
  }

  private notify(session: StandbySession | null): void {
    for (const listener of this.listeners) {
      try {
        listener(session)
      } catch {
        // A consumer cannot prevent the validated session from being stored or
        // other consumers from receiving the change.
      }
    }
  }
}

export function standbyAppUser(session: StandbySession): StandbyAppUser {
  return Object.freeze({
    uid: session.uid,
    email: session.email,
    displayName: session.displayName,
    photoURL: session.photoURL,
    emailVerified: session.emailVerified,
  })
}

interface FirestoreInternalUser {
  uid: string | null
  isAuthenticated(): boolean
  toKey(): string
  isEqual(other: FirestoreInternalUser): boolean
}

interface FirestoreInternalToken {
  type: 'OAuth'
  user: FirestoreInternalUser
  headers: Map<string, string>
}

interface FirestoreAsyncQueue {
  enqueueRetryable(operation: () => Promise<void>): void
}

type FirestoreCredentialChangeListener = (user: FirestoreInternalUser) => Promise<void>

export interface StandbyFirestoreCredentialsProvider {
  start(
    asyncQueue: FirestoreAsyncQueue,
    changeListener: FirestoreCredentialChangeListener
  ): void
  getToken(): Promise<FirestoreInternalToken | null>
  invalidateToken(): void
  shutdown(): void
}

function firestoreUser(uid: string | null): FirestoreInternalUser {
  return {
    uid,
    isAuthenticated: () => uid != null,
    toKey: () => (uid == null ? 'anonymous-user' : `uid:${uid}`),
    isEqual(other: FirestoreInternalUser) {
      return other?.uid === uid
    },
  }
}

/**
 * Implements the small provider contract consumed by Firestore's runtime-only
 * `credentials: {type:'provider'}` setting. firebase.ts owns the sole narrow
 * cast to that private setting; the provider itself remains fully typed here.
 */
export function createStandbyFirestoreCredentialsProvider(
  client: StandbyAuthClient
): StandbyFirestoreCredentialsProvider {
  let forceRefresh = false
  let queue: FirestoreAsyncQueue | null = null
  let listener: FirestoreCredentialChangeListener | null = null
  let unsubscribe: (() => void) | null = null

  const announce = (session: StandbySession | null) => {
    if (!queue || !listener) return
    const currentListener = listener
    const user = firestoreUser(session?.uid ?? null)
    queue.enqueueRetryable(() => currentListener(user))
  }

  return {
    start(asyncQueue, changeListener) {
      unsubscribe?.()
      queue = asyncQueue
      listener = changeListener
      unsubscribe = client.subscribe(announce)
      announce(client.endpoint() ? client.readSession() : null)
    },
    async getToken() {
      const shouldForceRefresh = forceRefresh
      const session = await client.getValidSession(shouldForceRefresh)
      if (!session) return null
      forceRefresh = false
      const user = firestoreUser(session.uid)
      return {
        type: 'OAuth',
        user,
        headers: new Map([['Authorization', `Bearer ${session.idToken}`]]),
      }
    },
    invalidateToken() {
      forceRefresh = true
    },
    shutdown() {
      unsubscribe?.()
      unsubscribe = null
      queue = null
      listener = null
    },
  }
}

export const standbyAuth = new StandbyAuthClient()
