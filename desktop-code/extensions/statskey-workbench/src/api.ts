import type { SessionStore, StatsKeySession } from './session'

const PROJECT_ID = 'statskey'
// Public Firebase web API key (same one the web app ships); used only to
// exchange the refresh token for fresh ID tokens.
const API_KEY = 'AIzaSyBsNYhgdcfwl4sSk7Eg5NAzGhNt8pQCOcs'
const FUNCTIONS_BASE = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

export interface PendingAction {
  id: string
  kind: string
  status: string
  summary: string
  payloadHash: string
}

export class AuthManager {
  private session: StatsKeySession | undefined
  private listeners = new Set<(session: StatsKeySession | undefined) => void>()

  constructor(private readonly store: SessionStore) {}

  onChange(listener: (session: StatsKeySession | undefined) => void) {
    this.listeners.add(listener)
  }

  async load() {
    this.session = await this.store.get()
    this.emit()
  }

  current() {
    return this.session
  }

  async set(session: StatsKeySession) {
    this.session = session
    await this.store.set(session)
    this.emit()
  }

  async clear() {
    this.session = undefined
    await this.store.clear()
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener(this.session)
  }

  private async freshToken(force = false): Promise<string> {
    const session = this.session
    if (!session) throw new Error('Not signed in')
    const expiring = !session.expiresAt || session.expiresAt < Date.now() + 60_000
    if (expiring && !session.refreshToken) {
      await this.clear()
      throw new Error('Session expired. Sign in again.')
    }
    if (session.refreshToken && (force || expiring)) {
      const next = await refreshIdToken(session.refreshToken)
      this.session = {
        ...session,
        idToken: next.idToken,
        refreshToken: next.refreshToken,
        expiresAt: Date.now() + next.expiresIn * 1000,
      }
      await this.store.set(this.session)
    }
    return (this.session ?? session).idToken
  }

  async call<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
    try {
      return await postFunction<T>(name, await this.freshToken(), data)
    } catch (error) {
      if (isAuthError(error) && this.session?.refreshToken) {
        return await postFunction<T>(name, await this.freshToken(true), data)
      }
      throw error
    }
  }

  async pendingActions(): Promise<PendingAction[]> {
    const run = async (token: string) => {
      const session = this.session
      if (!session) throw new Error('Not signed in')
      const url = new URL(`${FIRESTORE_BASE}/users/${session.uid}/assistantActions`)
      url.searchParams.set('pageSize', '40')
      url.searchParams.set('orderBy', 'createdAt desc')
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new HttpError(response.status, `Failed to load waiting items (${response.status})`)
      return response.json() as Promise<{
        documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>
      }>
    }
    let json
    try {
      json = await run(await this.freshToken())
    } catch (error) {
      if (isAuthError(error) && this.session?.refreshToken) {
        json = await run(await this.freshToken(true))
      } else {
        throw error
      }
    }
    return (json.documents || [])
      .map((doc) => {
        const id = (doc.name || '').split('/').pop() || ''
        const fields = doc.fields || {}
        return {
          id,
          kind: fields.kind?.stringValue || 'unknown',
          status: fields.status?.stringValue || 'unknown',
          summary: fields.summary?.stringValue || id,
          payloadHash: fields.payloadHash?.stringValue || '',
        }
      })
      .filter((action) => action.status === 'awaitingApproval' || action.status === 'proposed')
  }

  async mintWebHandoffCode(): Promise<string> {
    const result = await this.call<{ handoffCode?: string }>('createWebSignInToken')
    if (!result?.handoffCode) throw new Error('No sign-in handoff returned')
    return result.handoffCode
  }

  async searchRecord(query: string) {
    return this.call<Record<string, unknown>>('searchStatsKeyIndexHybridV3', {
      query,
      limit: 12,
      mode: 'auto',
      evidencePack: true,
    })
  }

  async getIndexManifest() {
    return this.call<Record<string, unknown>>('getStatsKeyIndexManifest')
  }

  async approve(actionId: string, payloadHash: string) {
    return this.call('approveAssistantAction', { actionId, payloadHash })
  }

  async decline(actionId: string, reason?: string) {
    return this.call('rejectAssistantAction', {
      actionId,
      ...(reason ? { reason } : {}),
    })
  }
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function isAuthError(error: unknown): boolean {
  return (
    (error instanceof HttpError && (error.status === 401 || error.status === 403)) ||
    (error instanceof Error && /unauthenticated|401|invalid.*token|token.*expired/i.test(error.message))
  )
}

async function postFunction<T>(
  name: string,
  idToken: string,
  data: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  })
  const json = (await response.json()) as { result?: T; error?: { message?: string } }
  if (!response.ok || json.error) {
    throw new HttpError(response.status, json.error?.message || `${name} failed (${response.status})`)
  }
  return json.result as T
}

async function refreshIdToken(
  refreshToken: string
): Promise<{ idToken: string; refreshToken: string; expiresIn: number }> {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })
  const json = (await response.json()) as {
    id_token?: string
    refresh_token?: string
    expires_in?: string
  }
  if (!response.ok || !json.id_token) {
    throw new HttpError(response.status, 'Session refresh failed')
  }
  return {
    idToken: json.id_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresIn: Number(json.expires_in) || 3600,
  }
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email?: string; displayName?: string }> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  )
  const json = (await response.json()) as {
    users?: Array<{
      localId?: string
      email?: string
      displayName?: string
    }>
  }
  const user = json.users?.[0]
  if (!response.ok || !user?.localId) {
    throw new HttpError(response.status, 'Session verification failed')
  }
  return {
    uid: user.localId,
    email: user.email,
    displayName: user.displayName,
  }
}

type FirestoreValue = {
  stringValue?: string
  integerValue?: string
  booleanValue?: boolean
  timestampValue?: string
  mapValue?: { fields?: Record<string, FirestoreValue> }
}
