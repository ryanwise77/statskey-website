import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '../lib/firebase'
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

  const embed = searchParams.get('embed') === '1'
  const signInToken = searchParams.get('signInToken')
  const next = searchParams.get('next') || '/enterprise'
  const protocol = useMemo(() => {
    const requested = searchParams.get('protocol') || 'statskey-workbench'
    return ALLOWED_PROTOCOLS.has(requested) ? requested : 'statskey-workbench'
  }, [searchParams])
  const state = searchParams.get('state') || ''

  // Establish the web session first: the desktop bridge passes a one-time
  // custom token for silent sign-in; otherwise fall back to the login screen.
  useEffect(() => {
    if (loading || user) return
    if (signInToken) {
      if (tokenAttempted.current) return
      tokenAttempted.current = true
      void signInWithCustomToken(auth, signInToken).catch((err) => {
        setError(err instanceof Error ? err.message : 'Workbench sign-in failed.')
      })
      return
    }
    navigate('/login', { replace: true, state: { from: location } })
  }, [loading, user, signInToken, navigate, location])

  // With a session: embedded frames continue straight into the product; the
  // desktop handoff bounces a fresh ID token back over the Workbench protocol.
  useEffect(() => {
    if (loading || !user || handedOff) return
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
  }, [loading, user, embed, next, protocol, state, handedOff, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full panel space-y-3">
        <h1 className="text-lg font-semibold text-text-primary">StatsKey Workbench</h1>
        <p className="text-sm text-text-secondary">
          {handedOff
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
