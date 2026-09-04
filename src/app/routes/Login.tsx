import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isNudgeAuthorIdentifier } from '../lib/nudgeAuthor'

const REDIRECT_PATH_KEY = 'statskey.login.redirectPath'

export function Login() {
  const {
    user,
    nudgeAuthor,
    signInWithEmail,
    signInAsMillerAuthor,
    signInWithGoogle,
    signInWithApple,
    sendPasswordReset,
    error,
    loading,
    emergencyMode,
  } = useAuth()
  const location = useLocation()
  const [busy, setBusy] = useState<null | 'email' | 'google' | 'apple' | 'reset'>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const from = (location.state as { from?: { pathname: string; search?: string; hash?: string } } | null)?.from

  useEffect(() => { setLocalError(error) }, [error])

  if (user && !loading) {
    if (nudgeAuthor) {
      sessionStorage.removeItem(REDIRECT_PATH_KEY)
      return <Navigate to="/nudge-studio" replace />
    }
    const redirectPath =
      sessionStorage.getItem(REDIRECT_PATH_KEY) ??
      (from ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : null) ??
      '/'
    sessionStorage.removeItem(REDIRECT_PATH_KEY)
    return <Navigate to={redirectPath} replace />
  }

  async function go(which: 'google' | 'apple') {
    setBusy(which)
    setLocalError(null)
    try {
      if (from) {
        sessionStorage.setItem(REDIRECT_PATH_KEY, `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`)
      }
      if (which === 'google') await signInWithGoogle()
      else await signInWithApple()
    } catch {
      // error surfaced via context state
    } finally {
      setBusy(null)
    }
  }

  function rememberRedirect() {
    if (from) {
      sessionStorage.setItem(
        REDIRECT_PATH_KEY,
        `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
      )
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setLocalError('Enter your email.')
      return
    }
    if (!password) {
      setLocalError('Enter your password.')
      return
    }

    setBusy('email')
    setLocalError(null)
    try {
      rememberRedirect()
      if (isNudgeAuthorIdentifier(normalizedEmail)) {
        await signInAsMillerAuthor(normalizedEmail, password)
      } else {
        await signInWithEmail(normalizedEmail, password)
      }
    } catch {
      // error surfaced via context state
    } finally {
      setBusy(null)
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setLocalError('Enter your email.')
      return
    }

    setBusy('reset')
    setLocalError(null)
    setResetSent(false)
    try {
      await sendPasswordReset(normalizedEmail)
      setResetSent(true)
    } catch {
      // error surfaced via context state
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-10">
          <a href="/" className="app-brand justify-center">
            <span className="site-brand__mark" aria-hidden="true" />
            <span>StatsKey</span>
          </a>
          <h1 className="font-display text-[32px] font-bold tracking-[-0.02em] mt-6 mb-2">
            {resetMode ? 'Reset password' : 'Sign in'}
          </h1>
          <p className="text-text-secondary text-[14px]">
            {resetMode
              ? 'We’ll email you a secure password reset link.'
              : emergencyMode
                ? 'Emergency mode is active. Use email and password, or your prepared standby session will open automatically.'
                : 'Use the same account as the iOS app.'}
          </p>
        </div>

        <div className="panel">
          {resetMode ? (
            <form className="space-y-4" onSubmit={submitReset}>
              <div>
                <label
                  className="text-text-secondary text-[12px] font-medium block mb-1.5"
                  htmlFor="reset-email"
                >
                  Email
                </label>
                <input
                  id="reset-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                  disabled={busy !== null}
                />
              </div>

              <button
                className="btn btn-primary w-full"
                type="submit"
                disabled={busy !== null}
              >
                {busy === 'reset' ? 'Sending…' : 'Email reset link'}
              </button>

              {resetSent && (
                <div className="success-banner text-[13px] leading-relaxed">
                  If that email has a StatsKey account, a reset link is on its way.
                </div>
              )}

              <button
                className="btn btn-ghost w-full"
                type="button"
                onClick={() => {
                  setResetMode(false)
                  setResetSent(false)
                  setLocalError(null)
                }}
                disabled={busy !== null}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <>
              <form className="space-y-4" onSubmit={submitEmail}>
                <div>
                  <label
                    className="text-text-secondary text-[12px] font-medium block mb-1.5"
                    htmlFor="login-email"
                  >
                    Email
                  </label>
                  <input
                    id="login-email"
                    className="input"
                    type="text"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    inputMode="email"
                    disabled={busy !== null}
                  />
                </div>

                <div>
                  <span className="flex items-center justify-between mb-1.5">
                    <label
                      className="text-text-secondary text-[12px] font-medium"
                      htmlFor="login-password"
                    >
                      Password
                    </label>
                    {!emergencyMode && (
                      <button
                        className="link text-[12px]"
                        type="button"
                        onClick={() => {
                          setResetMode(true)
                          setResetSent(false)
                          setLocalError(null)
                        }}
                      >
                        Forgot password?
                      </button>
                    )}
                  </span>
                  <input
                    id="login-password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    disabled={busy !== null}
                  />
                </div>

                <button
                  className="btn btn-primary w-full"
                  type="submit"
                  disabled={busy !== null}
                >
                  {busy === 'email' ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              {!emergencyMode && (
                <>
                  <div className="flex items-center gap-3 my-5" aria-hidden>
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-text-muted text-[11px] font-medium">OR</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  <div className="space-y-3">
                    <button
                      className="btn btn-secondary w-full"
                      onClick={() => go('google')}
                      disabled={busy !== null}
                    >
                      <GoogleIcon />
                      <span>{busy === 'google' ? 'Signing in…' : 'Continue with Google'}</span>
                    </button>

                    <button
                      className="btn btn-secondary w-full"
                      onClick={() => go('apple')}
                      disabled={busy !== null}
                    >
                      <AppleIcon />
                      <span>{busy === 'apple' ? 'Signing in…' : 'Continue with Apple'}</span>
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {localError && <div className="error-banner mt-4">{localError}</div>}
        </div>

        <p className="text-text-muted text-[12px] mt-6 text-center leading-relaxed">
          By continuing you agree to the <a className="link" href="/web-terms">Web Interface Terms</a>, <a className="link" href="/terms">iOS App Terms</a>, and <a className="link" href="/privacy">Privacy Policy</a>.
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.9 6.1 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
      <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.9 6.1 29.7 4 24 4 16.3 4 9.7 8.3 6.3 14.1z"/>
      <path fill="#4CAF50" d="M24 44c5.6 0 10.7-2.1 14.5-5.6l-6.7-5.5c-2 1.5-4.6 2.4-7.8 2.4-5.3 0-9.8-3.4-11.4-8l-6.6 5.1C9.5 39.5 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.9l6.7 5.5C41.6 35.7 44 30.3 44 24c0-1.3-.1-2.6-.4-3.9z"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  )
}
