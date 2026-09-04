import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  GoogleAuthProvider,
  OAuthProvider,
  getRedirectResult,
  onIdTokenChanged,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { onSnapshot, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from './firebase'
import { hasNudgeAuthorClaims, NUDGE_AUTHOR_UID } from './nudgeAuthor'
import {
  ensureProfile,
  loadProfile,
  loadProfileReadOnly,
  saveProfile,
  type UserProfile,
} from './profile'
import { syncUserLookup } from './writers'
import { currentMirrorHealth, currentMode } from './firestoreFailover'
import {
  StandbyAuthError,
  standbyAppUser,
  standbyAuth,
} from './standbyAuth'

export type AppUser = Pick<
  User,
  'uid' | 'email' | 'displayName' | 'photoURL' | 'emailVerified'
>

interface AuthState {
  user: AppUser | null
  nudgeAuthor: boolean
  profile: UserProfile | null
  profileLoaded: boolean
  loading: boolean
  error: string | null
  emergencyMode: boolean
  signInWithEmail: (email: string, password: string) => Promise<void>
  signInAsMillerAuthor: (identifier: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithApple: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  signOut: () => Promise<void>
  saveProfile: (profile: UserProfile) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const emergencyMode = currentMode() === 'mirror'
  const [user, setUser] = useState<AppUser | null>(null)
  const [nudgeAuthor, setNudgeAuthor] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let authStateSettled = false
    let redirectSettled = false
    let authGeneration = 0

    function finishInitialLoad() {
      if (!cancelled && authStateSettled && redirectSettled) {
        setLoading(false)
      }
    }

    if (emergencyMode) {
      // Redirect sign-in requires Google and must not delay standby startup.
      redirectSettled = true
    } else {
      getRedirectResult(auth)
        .then(async (result) => {
          if (!result?.user) return
          setUser(result.user)
          await ensureProfile(result.user)
        })
        .catch((e) => {
          if (!cancelled) setError(toMessage(e))
        })
        .finally(() => {
          redirectSettled = true
          finishInitialLoad()
        })
    }

    const applyAuthState = async (next: User | null) => {
      const generation = ++authGeneration
      let isNudgeAuthor = false
      if (next && (!emergencyMode || next.uid === NUDGE_AUTHOR_UID)) {
        try {
          const token = await next.getIdTokenResult()
          isNudgeAuthor = hasNudgeAuthorClaims(token.claims)
        } catch (e) {
          if (!cancelled && generation === authGeneration) setError(toMessage(e))
        }
      }
      if (!emergencyMode || isNudgeAuthor) {
        if (!cancelled && generation === authGeneration) {
          setNudgeAuthor(isNudgeAuthor)
          setUser(next)
        }
      } else {
        let session = null
        try {
          session = await standbyAuth.getValidSession()
        } catch {
          // An expired session that cannot be refreshed is not authentication.
        }
        if (!cancelled && generation === authGeneration) {
          setNudgeAuthor(false)
          setUser(
            session
              ? next?.uid === session.uid
                ? next
                : standbyAppUser(session)
              : null
          )
        }
      }
      if (!cancelled && generation === authGeneration) {
        authStateSettled = true
        finishInitialLoad()
      }
    }

    // Resolve the persisted standby immediately; Firebase's local observer is
    // still useful for richer display fields but is not a mirror-mode gate.
    if (emergencyMode) void applyAuthState(auth.currentUser)
    const unsub = onAuthStateChanged(auth, (next) => void applyAuthState(next))
    return () => {
      cancelled = true
      unsub()
    }
  }, [emergencyMode])

  useEffect(() => {
    if (emergencyMode || !standbyAuth.endpoint()) return
    // Every healthy Firebase ID-token cycle renews the durable standby refresh
    // token. Errors are deliberately background-only: primary auth remains
    // authoritative and no token or response is ever surfaced or logged.
    return onIdTokenChanged(auth, (next) => {
      if (!next) return
      void provisionStandbySession(next)
    })
  }, [emergencyMode])

  useEffect(() => {
    if (!user || nudgeAuthor) {
      setProfile(null)
      setProfileLoaded(true)
      return
    }

    let cancelled = false
    const readOnlyMirror = isReadOnlyMirror()
    const profileLoader = readOnlyMirror ? loadProfileReadOnly : loadProfile
    setProfileLoaded(false)

    ;(async () => {
      try {
        const loaded = await profileLoader(user.uid)
        if (cancelled) return
        let current = loaded
        if (!current && !readOnlyMirror) {
          current = await ensureProfile(user)
        }
        if (!cancelled) setProfile(current ?? null)

        if (current && !readOnlyMirror) {
          // Keep userLookup in sync so web users can be found by friend code.
          syncUserLookup(user.uid, {
            displayName: current.name || user.displayName || '',
            email: current.email || user.email || '',
          }).catch(() => {})
        }
      } catch (e) {
        if (!cancelled) setError(toMessage(e))
      } finally {
        if (!cancelled) setProfileLoaded(true)
      }
    })()

    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (cancelled || !snap.exists()) return
        // Re-decode using the same logic as load so Timestamp/Date etc. are normalized.
        profileLoader(user.uid).then((p) => {
          if (!cancelled && p) setProfile(p)
        })
      },
      (err) => {
        if (!cancelled) setError(err.message)
      }
    )

    return () => {
      cancelled = true
      unsub()
    }
  }, [user, nudgeAuthor])

  const api = useMemo<AuthState>(
    () => ({
      user,
      nudgeAuthor,
      profile,
      profileLoaded,
      loading,
      error,
      emergencyMode,
      async signInAsMillerAuthor(identifier, password) {
        setError(null)
        setLoading(true)
        try {
          const signIn = httpsCallable<
            { identifier: string; password: string },
            { token: string; destination: string }
          >(functions, 'millerNudgeAuthorSignIn', {
            limitedUseAppCheckTokens: true,
          })
          const response = await signIn({ identifier: identifier.trim(), password })
          const result = await signInWithCustomToken(auth, response.data.token)
          const token = await result.user.getIdTokenResult()
          if (!hasNudgeAuthorClaims(token.claims)) {
            await fbSignOut(auth)
            throw new Error('Nudge Studio access was not granted.')
          }
          standbyAuth.clearSession()
          setNudgeAuthor(true)
          setUser(result.user)
        } catch (e) {
          setError(toMessage(e))
          throw e
        } finally {
          setLoading(false)
        }
      },
      async signInWithEmail(email, password) {
        setError(null)
        setLoading(true)
        try {
          if (emergencyMode) {
            const session = await standbyAuth.password(email, password)
            setUser(standbyAppUser(session))
            return
          }
          const result = await signInWithEmailAndPassword(
            auth,
            email.trim(),
            password
          )
          await ensureProfile(result.user)
          void provisionStandbySession(result.user)
        } catch (e) {
          setError(toMessage(e))
          throw e
        } finally {
          setLoading(false)
        }
      },
      async signInWithGoogle() {
        setError(null)
        setLoading(true)
        try {
          if (emergencyMode) throw socialSignInUnavailable()
          const provider = new GoogleAuthProvider()
          provider.setCustomParameters({ prompt: 'select_account' })
          const result = await signInWithPopup(auth, provider)
          await ensureProfile(result.user)
          void provisionStandbySession(result.user)
        } catch (e) {
          setError(toMessage(e))
          throw e
        } finally {
          setLoading(false)
        }
      },
      async signInWithApple() {
        setError(null)
        setLoading(true)
        try {
          if (emergencyMode) throw socialSignInUnavailable()
          const provider = new OAuthProvider('apple.com')
          provider.addScope('email')
          provider.addScope('name')
          const result = await signInWithPopup(auth, provider)
          await ensureProfile(result.user)
          void provisionStandbySession(result.user)
        } catch (e) {
          setError(toMessage(e))
          throw e
        } finally {
          setLoading(false)
        }
      },
      async sendPasswordReset(email) {
        setError(null)
        setLoading(true)
        try {
          if (emergencyMode) {
            throw new StandbyAuthError(
              'unavailable',
              'Password reset is unavailable during emergency operation.'
            )
          }
          await sendPasswordResetEmail(auth, email.trim())
        } catch (e) {
          // Do not reveal whether an address has a StatsKey account.
          if (authErrorCode(e) !== 'auth/user-not-found') {
            setError(toMessage(e))
            throw e
          }
        } finally {
          setLoading(false)
        }
      },
      async signOut() {
        // Clear first so an in-flight bootstrap/refresh cannot restore the
        // standby session after the user explicitly signs out.
        standbyAuth.clearSession()
        setNudgeAuthor(false)
        setUser(null)
        await fbSignOut(auth)
      },
      async saveProfile(next) {
        if (!user) throw new Error('Not signed in')
        if (isReadOnlyMirror()) {
          throw new Error('Profile changes are unavailable while the emergency mirror is read-only.')
        }
        await saveProfile(user.uid, next)
        setProfile(next)
      },
    }),
    [user, nudgeAuthor, profile, profileLoaded, loading, error, emergencyMode]
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

function toMessage(err: unknown): string {
  if (err instanceof StandbyAuthError) {
    return err.code === 'rejected'
      ? 'Incorrect email or password.'
      : err.message
  }
  switch (authErrorCode(err)) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Incorrect email or password.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support for help.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/operation-not-allowed':
      return 'Email and password sign-in is currently unavailable.'
    case 'auth/popup-closed-by-user':
      return 'The sign-in window was closed before completion.'
    case 'functions/unauthenticated':
    case 'functions/permission-denied':
      return 'Incorrect email or password.'
    case 'functions/resource-exhausted':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'appCheck/recaptcha-error':
    case 'appCheck/initial-throttle':
      return 'Could not verify this browser. Refresh the page and try again.'
  }
  if (err instanceof Error) return err.message
  return String(err)
}

function isReadOnlyMirror(): boolean {
  return currentMode() === 'mirror' && currentMirrorHealth()?.writable !== true
}

async function provisionStandbySession(user: User): Promise<void> {
  if (currentMode() !== 'primary' || !standbyAuth.endpoint()) return
  try {
    const token = await user.getIdTokenResult()
    // Author accounts only edit public copy through their scoped callables.
    // They must not acquire a health-data standby session.
    if (hasNudgeAuthorClaims(token.claims)) return
    const priorSession = standbyAuth.readSession()
    if (priorSession && priorSession.uid !== user.uid) standbyAuth.clearSession()
    const idToken = await user.getIdToken()
    await standbyAuth.bootstrap(idToken, user.uid)
  } catch {
    // Standby preparation must never disturb a healthy primary session.
  }
}

function socialSignInUnavailable(): StandbyAuthError {
  return new StandbyAuthError(
    'unavailable',
    'Google and Apple sign-in are unavailable during emergency operation. Use email and password or a previously prepared standby session.'
  )
}

function authErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined
}
