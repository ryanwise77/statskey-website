import * as vscode from 'vscode'
import { randomBytes } from 'crypto'

const SESSION_KEY = 'statskey.session'
const LEGACY_FALLBACK_KEY = 'statskey.sessionFallback'
const STATE_KEY = 'statskey.authState'

export interface StatsKeySession {
  uid: string
  idToken: string
  refreshToken?: string
  email?: string
  displayName?: string
  expiresAt?: number
}

// SecretStorage backs onto the operating-system credential vault. Session
// tokens must never fall back to plaintext extension state.
export class SessionStore {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly state: vscode.Memento) {}

  async get(): Promise<StatsKeySession | undefined> {
    // Remove credentials written by pre-hardening builds.
    await this.state.update(LEGACY_FALLBACK_KEY, undefined)
    try {
      const raw = await this.secrets.get(SESSION_KEY)
      if (raw) return JSON.parse(raw) as StatsKeySession
    } catch {
      return undefined
    }
  }

  async set(session: StatsKeySession): Promise<void> {
    try {
      await this.secrets.store(SESSION_KEY, JSON.stringify(session))
    } catch (error) {
      throw new Error('Secure credential storage is unavailable.', {
        cause: error,
      })
    }
  }

  async clear(): Promise<void> {
    try {
      await this.secrets.delete(SESSION_KEY)
    } catch {
      // keychain unavailable
    }
    await this.state.update(LEGACY_FALLBACK_KEY, undefined)
    await this.state.update(STATE_KEY, undefined)
  }

  async createAuthState(): Promise<string> {
    const state = randomBytes(16).toString('hex')
    await this.state.update(STATE_KEY, state)
    return state
  }

  async consumeAuthState(state: string | null): Promise<boolean> {
    if (!state) return false
    const expected = this.state.get<string>(STATE_KEY)
    await this.state.update(STATE_KEY, undefined)
    return Boolean(expected && expected === state)
  }
}
