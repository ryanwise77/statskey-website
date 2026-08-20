import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../lib/firebase'
import { useAuth } from '../lib/auth'

const ALLOWED_PROTOCOLS = new Set(['statskey-workbench', 'vscode', 'cursor'])

export function WorkbenchAuth() {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [handedOff, setHandedOff] = useState(false)
  const tokenAttempted = useRef(false)
  const signOutAttempted = useRef(false)

  const embed = searchParams.get('embed') === '1'
  const signOutRequested = searchParams.get('signOut') === '1'
  const fragmentParams = useMemo(
    () => new URLSearchParams(location.hash.replace(/^#/, '')),
    [location.hash],
  )
  const handoffCode = fragmentParams.get('handoffCode') || searchParams.get('handoffCode')
  const signInToken = searchParams.get('signInToken')
  const [credentialPending, setCredentialPending] = useState(
    Boolean(handoffCode || signInToken),
  )
  const requestedNext = searchParams.get('next') || '/enterprise'
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/enterprise'
  const protocol = useMemo(() => {
    const requested = searchParams.get('protocol') || 'statskey-workbench'
    return ALLOWED_PROTOCOLS.has(requested) ? requested : 'statskey-workbench'
  }, [searchParams])
  const state = searchParams.get('state') || ''

  // Establish the web session first. Current desktop clients pass an opaque,
  // two-minute handoff code that the backend consumes exactly once. The
  // custom-token branch remains temporarily for already-installed clients.
  useEffect(() => {
    if (signOutRequested) return
    if (loading) return
    if (handoffCode) {
      if (tokenAttempted.current) return
      tokenAttempted.current = true

      // Remove the credential before any network request so it does not stay
      // visible in history, screenshots, copied URLs, or later navigation.
      const sanitized = new URL(window.location.href)
      sanitized.searchParams.delete('handoffCode')
      const sanitizedFragment = new URLSearchParams(sanitized.hash.replace(/^#/, ''))
      sanitizedFragment.delete('handoffCode')
      sanitized.hash = sanitizedFragment.toString()
      window.history.replaceState(
        window.history.state,
        '',
        `${sanitized.pathname}${sanitized.search}${sanitized.hash}`,
      )

      const consume = httpsCallable<
        { handoffCode: string },
        { token?: string }
      >(functions, 'consumeWebSignInHandoff')
      void consume({ handoffCode })
        .then(({ data }) => {
          if (!data.token) throw new Error('Workbench sign-in returned no token.')
          return signInWithCustomToken(auth, data.token)
        })
        .then(() => setCredentialPending(false))
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Workbench sign-in failed.')
        })
      return
    }
    if (signInToken) {
      if (tokenAttempted.current) return
      tokenAttempted.current = true
      const sanitized = new URL(window.location.href)
      sanitized.searchParams.delete('signInToken')
      window.history.replaceState(
        window.history.state,
        '',
        `${sanitized.pathname}${sanitized.search}${sanitized.hash}`,
      )
      void signInWithCustomToken(auth, signInToken)
        .then(() => setCredentialPending(false))
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Workbench sign-in failed.')
        })
      return
    }
    if (user) return
    navigate('/login', { replace: true, state: { from: location } })
  }, [loading, user, handoffCode, signInToken, signOutRequested, navigate, location])

  // Native and integrated-browser sessions use separate stores. A desktop
  // sign-out navigates the scoped StatsKey browser tab here so both sessions
  // are explicitly cleared without touching storage for unrelated sites.
  useEffect(() => {
    if (!signOutRequested || signOutAttempted.current) return
    signOutAttempted.current = true
    void firebaseSignOut(auth)
      .then(() => navigate('/login', { replace: true }))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Workbench sign-out failed.')
      })
  }, [signOutRequested, navigate])

  // With a session: embedded frames continue straight into the product; the
  // desktop handoff bounces a fresh ID token back over the Workbench protocol.
  useEffect(() => {
    if (signOutRequested) return
    if (loading || credentialPending || !user || handedOff) return
    if (embed) {
      navigate(next, { replace: true })
      return
    }
    if (!state) {
      setError('Sign-in request is missing its security check. Start again from the desktop app.')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const tokenResult = await user.getIdTokenResult(true)
        if (cancelled) return
        const target = new URL(`${protocol}://auth`)
        target.searchParams.set('state', state)
        const handoff = new URLSearchParams()
        handoff.set('idToken', tokenResult.token)
        const expiresAt = new Date(tokenResult.expirationTime).getTime()
        if (Number.isFinite(expiresAt)) handoff.set('expiresAt', String(expiresAt))
        if (user.email) handoff.set('email', user.email)
        if (user.displayName) handoff.set('displayName', user.displayName)
        target.hash = handoff.toString()
        window.location.href = target.toString()
        setHandedOff(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create Workbench session.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, user, embed, next, protocol, state, handedOff, credentialPending, signOutRequested, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full panel space-y-3">
        <h1 className="text-lg font-semibold text-text-primary">StatsKey Workbench</h1>
        <p className="text-sm text-text-secondary">
          {signOutRequested
            ? 'Signing out of the StatsKey browser…'
            : handedOff
            ? 'Session handed off. You can close this tab.'
            : embed
              ? 'Opening your workbench…'
              : 'Finishing secure sign-in…'}
        </p>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {!embed ? (
          <Link className="text-sm text-text-secondary underline" to="/enterprise">
            Open web workbench instead
          </Link>
        ) : null}
      </div>
    </div>
  )
}
