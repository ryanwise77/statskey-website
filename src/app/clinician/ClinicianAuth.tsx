import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { auth } from '../lib/firebase'

const clinicianEmailActionSettings = {
  url: 'https://statskey.ai/clinician/redeem',
  handleCodeInApp: false,
}

interface ClinicianAuthState {
  user: User | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    fullName: string,
    email: string,
    password: string
  ) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  resendVerification: () => Promise<void>
  refreshVerification: () => Promise<boolean>
  signOut: () => Promise<void>
  clearError: () => void
}

const ClinicianAuthContext = createContext<ClinicianAuthState | null>(null)

export function ClinicianAuthProvider({
  children,
}: {
  children: ReactNode
}) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verificationRevision, setVerificationRevision] = useState(0)

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })
  }, [])

  const value = useMemo<ClinicianAuthState>(
    () => ({
      user,
      loading,
      error,
      async signIn(email, password) {
        setError(null)
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password)
        } catch (authError) {
          const message = authMessage(authError)
          setError(message)
          throw new Error(message)
        }
      },
      async signUp(fullName, email, password) {
        setError(null)
        try {
          const result = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password
          )
          await updateProfile(result.user, {
            displayName: fullName.trim(),
          })
          await sendEmailVerification(
            result.user,
            clinicianEmailActionSettings
          )
          setVerificationRevision((revision) => revision + 1)
        } catch (authError) {
          const message = authMessage(authError)
          setError(message)
          throw new Error(message)
        }
      },
      async sendPasswordReset(email) {
        setError(null)
        try {
          await sendPasswordResetEmail(auth, email.trim())
        } catch (authError) {
          if (authCode(authError) !== 'auth/user-not-found') {
            const message = authMessage(authError)
            setError(message)
            throw new Error(message)
          }
        }
      },
      async resendVerification() {
        setError(null)
        const current = auth.currentUser
        if (!current) throw new Error('Sign in to verify your email.')
        try {
          await sendEmailVerification(current, clinicianEmailActionSettings)
        } catch (authError) {
          const message = authMessage(authError)
          setError(message)
          throw new Error(message)
        }
      },
      async refreshVerification() {
        setError(null)
        const current = auth.currentUser
        if (!current) return false
        try {
          await reload(current)
          await current.getIdToken(true)
          setUser(auth.currentUser)
          setVerificationRevision((revision) => revision + 1)
          return auth.currentUser?.emailVerified === true
        } catch (authError) {
          const message = authMessage(authError)
          setError(message)
          throw new Error(message)
        }
      },
      async signOut() {
        await firebaseSignOut(auth)
      },
      clearError() {
        setError(null)
      },
    }),
    [user, loading, error, verificationRevision]
  )

  return (
    <ClinicianAuthContext.Provider value={value}>
      {children}
    </ClinicianAuthContext.Provider>
  )
}

export function useClinicianAuth(): ClinicianAuthState {
  const context = useContext(ClinicianAuthContext)
  if (!context) {
    throw new Error(
      'useClinicianAuth must be used inside ClinicianAuthProvider'
    )
  }
  return context
}

function authMessage(error: unknown): string {
  switch (authCode(error)) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Incorrect professional email or password.'
    case 'auth/email-already-in-use':
      return 'An account already uses this email. Sign in instead.'
    case 'auth/invalid-email':
      return 'Enter a valid professional email.'
    case 'auth/weak-password':
      return 'Use a password with at least six characters.'
    case 'auth/user-disabled':
      return 'This professional account has been disabled.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/operation-not-allowed':
      return 'Professional email sign-in is not enabled yet.'
    default:
      return error instanceof Error
        ? error.message
        : 'The secure sign-in request failed.'
  }
}

function authCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return String((error as { code?: unknown }).code)
}
