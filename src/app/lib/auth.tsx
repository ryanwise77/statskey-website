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
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { onSnapshot, doc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { ensureProfile, loadProfile, saveProfile, type UserProfile } from './profile'

interface AuthState {
  user: User | null
  profile: UserProfile | null
  profileLoaded: boolean
  loading: boolean
  error: string | null
  signInWithGoogle: () => Promise<void>
  signInWithApple: () => Promise<void>
  signOut: () => Promise<void>
  saveProfile: (profile: UserProfile) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!user) {
      setProfile(null)
      setProfileLoaded(true)
      return
    }

    let cancelled = false
    setProfileLoaded(false)

    ;(async () => {
      try {
        const loaded = await loadProfile(user.uid)
        if (cancelled) return
        if (loaded) {
          setProfile(loaded)
        } else {
          const ensured = await ensureProfile(user)
          if (!cancelled) setProfile(ensured)
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
        loadProfile(user.uid).then((p) => {
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
  }, [user])

  const api = useMemo<AuthState>(
    () => ({
      user,
      profile,
      profileLoaded,
      loading,
      error,
      async signInWithGoogle() {
        setError(null)
        setLoading(true)
        try {
          const provider = new GoogleAuthProvider()
          provider.setCustomParameters({ prompt: 'select_account' })
          const result = await signInWithPopup(auth, provider)
          await ensureProfile(result.user)
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
          const provider = new OAuthProvider('apple.com')
          provider.addScope('email')
          provider.addScope('name')
          const result = await signInWithPopup(auth, provider)
          await ensureProfile(result.user)
        } catch (e) {
          setError(toMessage(e))
          throw e
        } finally {
          setLoading(false)
        }
      },
      async signOut() {
        await fbSignOut(auth)
      },
      async saveProfile(next) {
        if (!user) throw new Error('Not signed in')
        await saveProfile(user.uid, next)
        setProfile(next)
      },
    }),
    [user, profile, profileLoaded, loading, error]
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
