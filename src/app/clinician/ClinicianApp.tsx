import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import {
  CLINICIAN_TERMS_VERSION,
  acknowledgeClinicalShare,
  clinicalCategories,
  getClinicianContext,
  listClinicianShares,
  readClinicalShare,
  redeemClinicalShare,
  registerClinician,
  type ClinicalCategoryID,
  type ClinicalShareSummary,
  type ClinicalSnapshot,
  type ClinicalSnapshotRecord,
  type ClinicianContext,
  type ClinicianProfile,
} from './clinicalApi'
import { useClinicianAuth } from './ClinicianAuth'

export function ClinicianApp() {
  const { user, loading } = useClinicianAuth()

  if (loading) return <FullPageStatus label="Securing your session…" />
  if (!user) return <AccessPage />
  if (!user.emailVerified) return <VerifyEmailPage />
  return <ClinicianBootstrap />
}

function ClinicianBootstrap() {
  const { signOut } = useClinicianAuth()
  const [context, setContext] = useState<ClinicianContext | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setContext(await getClinicianContext())
    } catch (loadError) {
      setError(message(loadError))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <CenteredCard
        eyebrow="Private preview"
        title="The clinician portal is not enabled here."
      >
        <p>{error}</p>
        <p className="cp-muted">
          No patient information was opened. This environment stays closed
          until the clinical data controls are approved.
        </p>
        <div className="cp-actions">
          <button className="cp-button cp-button--secondary" onClick={load}>
            Try again
          </button>
          <button
            className="cp-button cp-button--quiet"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </CenteredCard>
    )
  }
  if (!context) return <FullPageStatus label="Opening clinician portal…" />
  if (!context.registered || !context.profile) {
    return <ProfileSetup onComplete={setContext} />
  }
  return <PortalShell profile={context.profile} />
}

function AccessPage() {
  const location = useLocation()
  const {
    signIn,
    signUp,
    sendPasswordReset,
    error,
    clearError,
  } = useClinicianAuth()
  const query = new URLSearchParams(location.search)
  const [mode, setMode] = useState<'signin' | 'signup'>(
    query.get('mode') === 'signup' ? 'signup' : 'signin'
  )
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const hasPendingCode =
    location.pathname.endsWith('/redeem') && window.location.hash.length > 1

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    clearError()
    try {
      if (mode === 'signup') {
        await signUp(fullName, email, password)
        setNotice('Verification sent. Check your professional email.')
      } else {
        await signIn(email, password)
      }
    } catch {
      // The auth provider exposes a safe, user-facing message.
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setNotice('Enter your email first, then request a reset.')
      return
    }
    setBusy(true)
    clearError()
    try {
      await sendPasswordReset(email)
      setNotice(
        'If that address has an account, a password-reset email is on its way.'
      )
    } catch {
      // Safe message is rendered from the auth provider.
    } finally {
      setBusy(false)
    }
  }

  function chooseMode(nextMode: 'signin' | 'signup') {
    setMode(nextMode)
    setNotice(null)
    clearError()
  }

  return (
    <div className="cp-access">
      <aside className="cp-access__story">
        <BrandLockup />
        <div className="cp-access__story-copy">
          <span className="cp-eyebrow">Professional access</span>
          <h1>Patient context, shared on their terms.</h1>
          <p>
            Review a time-limited record a patient chose to send before their
            next visit. Every share is scoped, single-use, and revocable.
          </p>
        </div>
        <div className="cp-trust-list">
          <TrustPoint
            icon="01"
            title="Patient authorized"
            text="The patient chooses categories, dates, recipient label, and expiration."
          />
          <TrustPoint
            icon="02"
            title="Purpose-built review"
            text="Routes, photos, notes, substances, and raw sensor streams stay out."
          />
          <TrustPoint
            icon="03"
            title="Clear boundary"
            text="Asynchronous wellness context—not an EHR, emergency feed, or monitoring service."
          />
        </div>
      </aside>

      <main className="cp-access__main">
        <div className="cp-access-card">
          {hasPendingCode && (
            <div className="cp-code-waiting">
              <span className="cp-code-waiting__icon">✓</span>
              Your patient’s care-share code is waiting. Sign in to redeem it.
            </div>
          )}
          <div className="cp-segmented" aria-label="Professional account">
            <button
              className={mode === 'signin' ? 'is-selected' : ''}
              onClick={() => chooseMode('signin')}
              type="button"
            >
              Sign in
            </button>
            <button
              className={mode === 'signup' ? 'is-selected' : ''}
              onClick={() => chooseMode('signup')}
              type="button"
            >
              Create account
            </button>
          </div>

          <div className="cp-access-card__heading">
            <span className="cp-eyebrow">Clinician portal</span>
            <h2>
              {mode === 'signin'
                ? 'Welcome back.'
                : 'Create professional access.'}
            </h2>
            <p>
              {mode === 'signin'
                ? 'Use your professional account—not a patient StatsKey login.'
                : 'Start with a verified email, then add your practice details.'}
            </p>
          </div>

          <form className="cp-form" onSubmit={submit}>
            {mode === 'signup' && (
              <FormField label="Full name">
                <input
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Dr. Ada Rivera"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </FormField>
            )}
            <FormField label="Professional email">
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@practice.com"
                required
              />
            </FormField>
            <FormField label="Password">
              <input
                type="password"
                autoComplete={
                  mode === 'signin' ? 'current-password' : 'new-password'
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </FormField>

            {(error || notice) && (
              <div
                className={`cp-message ${
                  error ? 'cp-message--error' : 'cp-message--success'
                }`}
                role="status"
              >
                {error || notice}
              </div>
            )}

            <button
              className="cp-button cp-button--primary cp-button--wide"
              disabled={busy}
              type="submit"
            >
              {busy
                ? 'Securing account…'
                : mode === 'signin'
                  ? 'Sign in securely'
                  : 'Create professional account'}
            </button>
            {mode === 'signin' && (
              <button
                className="cp-text-button"
                disabled={busy}
                onClick={() => void resetPassword()}
                type="button"
              >
                Forgot password?
              </button>
            )}
          </form>

          <div className="cp-access-card__patient-link">
            Looking for your personal StatsKey account?{' '}
            <a href="/app/login">Sign in to StatsKey</a>
          </div>
        </div>
      </main>
    </div>
  )
}

function VerifyEmailPage() {
  const {
    user,
    resendVerification,
    refreshVerification,
    signOut,
    error,
  } = useClinicianAuth()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function check() {
    setBusy(true)
    setNotice(null)
    try {
      const verified = await refreshVerification()
      if (!verified) {
        setNotice('Not verified yet. Open the email, then check again.')
      }
    } catch {
      // Provider message is shown below.
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    setNotice(null)
    try {
      await resendVerification()
      setNotice('A fresh verification email was sent.')
    } catch {
      // Provider message is shown below.
    } finally {
      setBusy(false)
    }
  }

  return (
    <CenteredCard eyebrow="One secure step" title="Verify your email.">
      <div className="cp-verify-icon" aria-hidden="true">
        ✉
      </div>
      <p>
        We sent a verification link to <strong>{user?.email}</strong>. This
        keeps professional access separate from ordinary patient accounts.
      </p>
      {(error || notice) && (
        <div
          className={`cp-message ${
            error ? 'cp-message--error' : 'cp-message--success'
          }`}
        >
          {error || notice}
        </div>
      )}
      <div className="cp-actions cp-actions--stack-mobile">
        <button
          className="cp-button cp-button--primary"
          disabled={busy}
          onClick={() => void check()}
        >
          I verified my email
        </button>
        <button
          className="cp-button cp-button--secondary"
          disabled={busy}
          onClick={() => void resend()}
        >
          Send again
        </button>
      </div>
      <button className="cp-text-button" onClick={() => void signOut()}>
        Use a different account
      </button>
    </CenteredCard>
  )
}

function ProfileSetup({
  onComplete,
}: {
  onComplete: (context: ClinicianContext) => void
}) {
  const { user, signOut } = useClinicianAuth()
  const [fullName, setFullName] = useState(user?.displayName || '')
  const [practiceName, setPracticeName] = useState('')
  const [professionalType, setProfessionalType] = useState('physician')
  const [npi, setNpi] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const context = await registerClinician({
        fullName,
        practiceName,
        professionalType,
        npi: npi.trim() || undefined,
        licenseJurisdiction: jurisdiction.trim() || undefined,
        termsVersion: CLINICIAN_TERMS_VERSION,
        termsAccepted: accepted,
      })
      onComplete(context)
    } catch (registrationError) {
      setError(message(registrationError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cp-onboarding">
      <header className="cp-onboarding__header">
        <BrandLockup />
        <button className="cp-text-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main className="cp-onboarding__card">
        <div className="cp-step-mark">2 of 2</div>
        <span className="cp-eyebrow">Professional profile</span>
        <h1>Tell patients who will receive their record.</h1>
        <p className="cp-lede">
          These details appear in the portal and access history. Email
          verification is complete; professional credentials are self-attested
          in this preview.
        </p>

        <form className="cp-form cp-form--two-column" onSubmit={submit}>
          <FormField label="Full name">
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              required
            />
          </FormField>
          <FormField label="Practice or organization">
            <input
              value={practiceName}
              onChange={(event) => setPracticeName(event.target.value)}
              placeholder="Northstar Family Medicine"
              maxLength={160}
              required
            />
          </FormField>
          <FormField label="Professional role">
            <select
              value={professionalType}
              onChange={(event) => setProfessionalType(event.target.value)}
            >
              <option value="physician">Physician</option>
              <option value="nursePractitioner">Nurse practitioner</option>
              <option value="physicianAssistant">Physician assistant</option>
              <option value="registeredNurse">Registered nurse</option>
              <option value="registeredDietitian">
                Registered dietitian
              </option>
              <option value="careCoordinator">Care coordinator</option>
              <option value="other">Other professional</option>
            </select>
          </FormField>
          <FormField label="NPI (optional)">
            <input
              inputMode="numeric"
              value={npi}
              onChange={(event) =>
                setNpi(event.target.value.replace(/\D/g, '').slice(0, 10))
              }
              placeholder="10 digits"
              pattern="[0-9]{10}"
            />
          </FormField>
          <FormField label="License jurisdiction (optional)">
            <input
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value)}
              placeholder="State or country"
              maxLength={40}
            />
          </FormField>

          <label className="cp-consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              required
            />
            <span>
              I will use patient-authorized records only for asynchronous
              review. I understand this preview is not an EHR, emergency
              service, or continuous monitoring system.
            </span>
          </label>

          {error && (
            <div className="cp-message cp-message--error">{error}</div>
          )}
          <button
            className="cp-button cp-button--primary"
            disabled={busy || !accepted}
            type="submit"
          >
            {busy ? 'Creating portal…' : 'Open clinician portal'}
          </button>
        </form>
      </main>
    </div>
  )
}

function PortalShell({ profile }: { profile: ClinicianProfile }) {
  const { signOut } = useClinicianAuth()
  return (
    <div className="cp-shell">
      <aside className="cp-sidebar">
        <BrandLockup />
        <div className="cp-sidebar__identity">
          <span>{initials(profile.fullName)}</span>
          <div>
            <strong>{profile.fullName}</strong>
            <small>{profile.practiceName}</small>
          </div>
        </div>
        <nav className="cp-sidebar__nav" aria-label="Clinician portal">
          <NavLink to="/" end>
            <PortalIcon symbol="⌂" />
            Patient records
          </NavLink>
          <NavLink to="/redeem">
            <PortalIcon symbol="＋" />
            Redeem care share
          </NavLink>
        </nav>
        <div className="cp-sidebar__boundary">
          <span className="cp-status-dot" />
          <div>
            <strong>Asynchronous review</strong>
            <small>No alerts or live monitoring</small>
          </div>
        </div>
        <button
          className="cp-sidebar__signout"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </aside>

      <div className="cp-workspace">
        <header className="cp-mobile-header">
          <BrandLockup />
          <button onClick={() => void signOut()}>Sign out</button>
        </header>
        <nav className="cp-mobile-nav">
          <NavLink to="/" end>
            Records
          </NavLink>
          <NavLink to="/redeem">Redeem</NavLink>
        </nav>
        <Routes>
          <Route path="/" element={<Dashboard profile={profile} />} />
          <Route path="/redeem" element={<RedeemShare />} />
          <Route path="/shares/:shareId" element={<ShareDetail />} />
          <Route path="/access" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  )
}

function Dashboard({ profile }: { profile: ClinicianProfile }) {
  const [shares, setShares] = useState<ClinicalShareSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listClinicianShares()
      setShares(result.shares)
    } catch (loadError) {
      setError(message(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const active = shares.filter((share) => share.status === 'active')
  const recentlyOpened = shares.filter((share) => share.lastAccessedAt).length

  return (
    <main className="cp-page">
      <PageHeader
        eyebrow={profile.practiceName}
        title={`Good ${daypart()}, ${firstName(profile.fullName)}.`}
        description="Review only the records patients deliberately shared with your professional account."
        action={
          <Link className="cp-button cp-button--primary" to="/redeem">
            Redeem care share
          </Link>
        }
      />

      <section className="cp-stat-grid" aria-label="Portal summary">
        <StatCard value={String(active.length)} label="Active records" />
        <StatCard
          value={String(recentlyOpened)}
          label="Records reviewed"
        />
        <StatCard
          value="Scoped"
          label="Patient-authorized access"
          accent
        />
      </section>

      <section className="cp-panel cp-records-panel">
        <div className="cp-panel__header">
          <div>
            <span className="cp-eyebrow">Patient inbox</span>
            <h2>Shared records</h2>
          </div>
          <button
            className="cp-icon-button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh patient records"
          >
            ↻
          </button>
        </div>

        {error && (
          <div className="cp-message cp-message--error">{error}</div>
        )}
        {loading ? (
          <InlineLoading label="Refreshing patient records…" />
        ) : shares.length === 0 ? (
          <div className="cp-empty">
            <div className="cp-empty__icon">＋</div>
            <h3>No patient records yet.</h3>
            <p>
              Ask a patient to open Care Sharing in StatsKey and send you their
              one-time code.
            </p>
            <Link className="cp-button cp-button--secondary" to="/redeem">
              Enter a code
            </Link>
          </div>
        ) : (
          <div className="cp-record-list">
            {shares.map((share) => (
              <Link
                className="cp-record-row"
                key={share.id}
                to={`/shares/${share.id}`}
              >
                <div className="cp-record-row__avatar">
                  {initials(share.patientDisplayName || 'Patient')}
                </div>
                <div className="cp-record-row__main">
                  <strong>{share.patientDisplayName || 'Patient record'}</strong>
                  <span>
                    For {share.recipientLabel} ·{' '}
                    {categoryLabel(share.categoryIDs.length)} ·{' '}
                    {dateRange(share.rangeStart, share.rangeEnd)}
                  </span>
                </div>
                <div className="cp-record-row__meta">
                  <StatusBadge status={share.status} />
                  <small>
                    {share.lastAccessedAt
                      ? `Opened ${relativeDate(share.lastAccessedAt)}`
                      : 'Not opened'}
                  </small>
                </div>
                <span className="cp-record-row__chevron">›</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function RedeemShare() {
  const navigate = useNavigate()
  const [token, setToken] = useState(readFragmentToken)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function redeem(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await redeemClinicalShare(token)
      navigate(`/shares/${result.shareId}`, { replace: true })
    } catch (redeemError) {
      setError(message(redeemError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="cp-page cp-page--narrow">
      <PageHeader
        eyebrow="One-time access"
        title="Redeem a patient care share."
        description="Paste the code from your patient. It can be used once and binds the record to this professional account."
      />
      <section className="cp-panel cp-redeem-card">
        <div className="cp-redeem-card__icon">⌁</div>
        <h2>Care-share code</h2>
        <p>
          Codes are case-sensitive. Spaces added for readability are fine.
        </p>
        <form className="cp-form" onSubmit={redeem}>
          <FormField label="Patient-provided code">
            <input
              className="cp-code-input"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="XXXX XXXX XXXX XXXX"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </FormField>
          {error && (
            <div className="cp-message cp-message--error">{error}</div>
          )}
          <button
            className="cp-button cp-button--primary cp-button--wide"
            disabled={busy || token.replace(/\s/g, '').length < 24}
            type="submit"
          >
            {busy ? 'Verifying share…' : 'Redeem securely'}
          </button>
        </form>
        <div className="cp-security-note">
          <span>⌾</span>
          <p>
            Redemption does not open health data. You will review the exact
            scope and acknowledge the use boundary first.
          </p>
        </div>
      </section>
    </main>
  )
}

function ShareDetail() {
  const { shareId = '' } = useParams()
  const [summary, setSummary] = useState<ClinicalShareSummary | null>(null)
  const [snapshot, setSnapshot] = useState<ClinicalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestedRead = useRef(false)

  const openRecord = useCallback(async () => {
    if (!shareId || requestedRead.current) return
    requestedRead.current = true
    setOpening(true)
    setError(null)
    try {
      const result = await readClinicalShare(shareId)
      setSummary(result.share)
      setSnapshot(result.snapshot)
    } catch (readError) {
      requestedRead.current = false
      setError(message(readError))
    } finally {
      setOpening(false)
    }
  }, [shareId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const result = await listClinicianShares()
        if (cancelled) return
        const found = result.shares.find((share) => share.id === shareId)
        setSummary(found || null)
        if (found?.acknowledged && found.status === 'active') {
          void openRecord()
        }
      } catch (loadError) {
        if (!cancelled) setError(message(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openRecord, shareId])

  async function acknowledge() {
    if (!summary) return
    setOpening(true)
    setError(null)
    try {
      await acknowledgeClinicalShare(summary.id)
      requestedRead.current = false
      setSummary({ ...summary, acknowledged: true })
      await openRecord()
    } catch (acknowledgementError) {
      setError(message(acknowledgementError))
    } finally {
      setOpening(false)
    }
  }

  if (loading) return <FullPageStatus label="Checking record access…" />
  if (!summary) {
    return (
      <main className="cp-page cp-page--narrow">
        <Link className="cp-back-link" to="/">
          ← Patient records
        </Link>
        <section className="cp-panel cp-empty">
          <h2>Record unavailable.</h2>
          <p>{error || 'This share is not assigned to your account.'}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="cp-page">
      <Link className="cp-back-link" to="/">
        ← Patient records
      </Link>
      <PageHeader
        eyebrow="Patient-authorized record"
        title={
          snapshot?.patient.displayName ||
          summary.patientDisplayName ||
          'Patient record'
        }
        description={`${dateRange(
          summary.rangeStart,
          summary.rangeEnd
        )} · Access ${summary.status}`}
        action={<StatusBadge status={summary.status} />}
      />

      {summary.status !== 'active' ? (
        <section className="cp-panel cp-boundary-card">
          <div className="cp-boundary-card__icon">⊘</div>
          <h2>This record is {summary.status}.</h2>
          <p>
            The patient’s authorization no longer permits access. Previously
            opened data is not available from this portal.
          </p>
        </section>
      ) : !summary.acknowledged ? (
        <AcknowledgementCard
          busy={opening}
          error={error}
          onAcknowledge={() => void acknowledge()}
          summary={summary}
        />
      ) : opening && !snapshot ? (
        <InlineLoading label="Opening the authorized record…" />
      ) : snapshot ? (
        <ClinicalRecord snapshot={snapshot} summary={summary} />
      ) : (
        <section className="cp-panel cp-boundary-card">
          <h2>The record could not be opened.</h2>
          <p>{error || 'Try again without leaving this secure page.'}</p>
          <button
            className="cp-button cp-button--secondary"
            onClick={() => {
              requestedRead.current = false
              void openRecord()
            }}
          >
            Try again
          </button>
        </section>
      )}
    </main>
  )
}

function AcknowledgementCard({
  summary,
  busy,
  error,
  onAcknowledge,
}: {
  summary: ClinicalShareSummary
  busy: boolean
  error: string | null
  onAcknowledge: () => void
}) {
  return (
    <section className="cp-panel cp-acknowledgement">
      <div className="cp-acknowledgement__mark">✓</div>
      <span className="cp-eyebrow">Before opening</span>
      <h2>Acknowledge the record boundary.</h2>
      <p>
        This is a patient-authorized StatsKey wellness record for asynchronous
        review. It may include patient-entered and device-synced information.
      </p>
      <div className="cp-scope-grid">
        <ScopeItem
          label="Recipient"
          value={summary.recipientLabel}
        />
        <ScopeItem
          label="Record window"
          value={dateRange(summary.rangeStart, summary.rangeEnd)}
        />
        <ScopeItem
          label="Categories"
          value={categoryLabel(summary.categoryIDs.length)}
        />
        <ScopeItem
          label="Access ends"
          value={formatDate(summary.expiresAt, true)}
        />
      </div>
      <ul className="cp-boundary-list">
        <li>Not an EHR or source of verified clinical orders.</li>
        <li>Not for emergencies, alerts, or continuous monitoring.</li>
        <li>Use only for the patient-authorized review purpose.</li>
      </ul>
      {error && <div className="cp-message cp-message--error">{error}</div>}
      <button
        className="cp-button cp-button--primary"
        disabled={busy}
        onClick={onAcknowledge}
      >
        {busy ? 'Recording acknowledgement…' : 'I understand — open record'}
      </button>
    </section>
  )
}

function ClinicalRecord({
  snapshot,
  summary,
}: {
  snapshot: ClinicalSnapshot
  summary: ClinicalShareSummary
}) {
  return (
    <>
      <section className="cp-record-hero">
        <div>
          <span className="cp-record-hero__label">Shared by patient</span>
          <h2>{snapshot.patient.displayName}</h2>
          <p>{snapshot.disclosure.source}</p>
        </div>
        <div className="cp-record-hero__facts">
          <ScopeItem
            label="Generated"
            value={formatDate(snapshot.generatedAt, true)}
          />
          <ScopeItem
            label="Access ends"
            value={formatDate(summary.expiresAt, true)}
          />
          <ScopeItem
            label="Portal opens"
            value={String(summary.accessCount)}
          />
        </div>
      </section>

      <div className="cp-clinical-warning">
        <span>i</span>
        <p>
          {snapshot.disclosure.warning ||
            'For asynchronous review only. Not for emergency response or continuous monitoring.'}
        </p>
      </div>

      <section className="cp-manifest" aria-label="Record completeness">
        {snapshot.manifest.map((entry) => (
          <div key={entry.categoryID}>
            <span
              className={`cp-manifest__dot cp-manifest__dot--${entry.status}`}
            />
            <strong>{categoryName(entry.categoryID)}</strong>
            <small>
              {entry.status === 'included'
                ? `${entry.recordCount} record${
                    entry.recordCount === 1 ? '' : 's'
                  }${entry.truncated ? ' · capped' : ''}`
                : entry.status}
            </small>
          </div>
        ))}
      </section>

      <div className="cp-section-stack">
        {clinicalCategories.map((category) => {
          const records = snapshot.sections[category.id]
          if (!records || records.length === 0) return null
          return (
            <SnapshotSection
              categoryID={category.id}
              description={category.description}
              key={category.id}
              records={records}
              title={category.label}
            />
          )
        })}
      </div>
    </>
  )
}

function SnapshotSection({
  categoryID,
  title,
  description,
  records,
}: {
  categoryID: ClinicalCategoryID
  title: string
  description: string
  records: ClinicalSnapshotRecord[]
}) {
  return (
    <section className="cp-panel cp-snapshot-section">
      <div className="cp-panel__header">
        <div>
          <span className="cp-eyebrow">{records.length} records</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="cp-category-icon">
          {categorySymbol(categoryID)}
        </div>
      </div>
      <div className="cp-snapshot-grid">
        {records.map((record, index) => (
          <SnapshotRecordCard
            categoryID={categoryID}
            key={`${String(record.date || '')}-${index}`}
            record={record}
          />
        ))}
      </div>
    </section>
  )
}

function SnapshotRecordCard({
  categoryID,
  record,
}: {
  categoryID: ClinicalCategoryID
  record: ClinicalSnapshotRecord
}) {
  if (categoryID === 'bloodPanels') {
    const results = Array.isArray(record.results) ? record.results : []
    return (
      <article className="cp-snapshot-card cp-snapshot-card--wide">
        <div className="cp-snapshot-card__top">
          <strong>
            {typeof record.labSource === 'string' && record.labSource
              ? record.labSource
              : 'Blood panel'}
          </strong>
          <time>{formatRecordDate(record.date)}</time>
        </div>
        <div className="cp-lab-grid">
          {results.map((rawResult, index) => {
            const result = isRecord(rawResult) ? rawResult : {}
            return (
              <div className="cp-lab-result" key={index}>
                <span>{humanize(String(result.biomarkerID || 'Result'))}</span>
                <strong>
                  {formatValue(result.valueReported)}{' '}
                  <small>{String(result.unitReported || '')}</small>
                </strong>
                {result.needsReview === true && <em>Patient review flag</em>}
              </div>
            )
          })}
        </div>
      </article>
    )
  }

  const entries = Object.entries(record).filter(
    ([key, value]) =>
      !['date', 'source'].includes(key) &&
      value !== null &&
      value !== undefined
  )
  return (
    <article className="cp-snapshot-card">
      <div className="cp-snapshot-card__top">
        <strong>{recordTitle(categoryID, record)}</strong>
        <time>{formatRecordDate(record.date)}</time>
      </div>
      <dl className="cp-metric-list">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{humanize(key)}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
      {typeof record.source === 'string' && record.source && (
        <div className="cp-source">Source: {record.source}</div>
      )}
    </article>
  )
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="cp-page-header">
      <div>
        <span className="cp-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="cp-page-header__action">{action}</div>}
    </header>
  )
}

function FormField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="cp-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function BrandLockup() {
  return (
    <Link className="cp-brand" to="/">
      <span className="cp-brand__mark" />
      <span>
        <strong>StatsKey</strong>
        <small>Clinician portal</small>
      </span>
    </Link>
  )
}

function TrustPoint({
  icon,
  title,
  text,
}: {
  icon: string
  title: string
  text: string
}) {
  return (
    <div className="cp-trust-point">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  )
}

function CenteredCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: ReactNode
}) {
  return (
    <div className="cp-centered">
      <div className="cp-centered__brand">
        <BrandLockup />
      </div>
      <main className="cp-centered__card">
        <span className="cp-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  )
}

function FullPageStatus({ label }: { label: string }) {
  return (
    <div className="cp-loading-screen">
      <BrandLockup />
      <span className="cp-spinner" />
      <p>{label}</p>
    </div>
  )
}

function InlineLoading({ label }: { label: string }) {
  return (
    <div className="cp-inline-loading">
      <span className="cp-spinner" />
      {label}
    </div>
  )
}

function PortalIcon({ symbol }: { symbol: string }) {
  return <span className="cp-portal-icon">{symbol}</span>
}

function StatCard({
  value,
  label,
  accent = false,
}: {
  value: string
  label: string
  accent?: boolean
}) {
  return (
    <div className={`cp-stat-card ${accent ? 'cp-stat-card--accent' : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: ClinicalShareSummary['status']
}) {
  return (
    <span className={`cp-status cp-status--${status}`}>
      <span />
      {status}
    </span>
  )
}

function ScopeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="cp-scope-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function recordTitle(
  categoryID: ClinicalCategoryID,
  record: ClinicalSnapshotRecord
): string {
  if (categoryID === 'workouts') {
    return humanize(String(record.sportType || 'Workout'))
  }
  if (categoryID === 'vitals' || categoryID === 'body') {
    return humanize(String(record.kind || categoryName(categoryID)))
  }
  return categoryName(categoryID)
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return `${value.length} items`
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, nested]) => `${humanize(key)} ${formatValue(nested)}`)
      .join(' · ')
  }
  return String(value ?? '—')
}

function formatRecordDate(value: unknown): string {
  return typeof value === 'string' ? formatDate(value) : 'Recorded'
}

function formatDate(value: string, includeTime = false): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime
      ? { hour: 'numeric', minute: '2-digit' }
      : {}),
  }).format(date)
}

function dateRange(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`
}

function relativeDate(value: string): string {
  const milliseconds = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return formatDate(value)
  }
  const days = Math.floor(milliseconds / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return formatDate(value)
}

function categoryName(id: ClinicalCategoryID): string {
  return clinicalCategories.find((category) => category.id === id)?.label || id
}

function categoryLabel(count: number): string {
  return `${count} categor${count === 1 ? 'y' : 'ies'}`
}

function categorySymbol(id: ClinicalCategoryID): string {
  const symbols: Record<ClinicalCategoryID, string> = {
    activity: '↗',
    nutrition: '◒',
    workouts: '◇',
    vitals: '♥',
    sleep: '☾',
    glucose: '∿',
    body: '◎',
    bloodPanels: '✣',
  }
  return symbols[id]
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'SK'
}

function firstName(value: string): string {
  return value.trim().split(/\s+/).find((part) => !part.endsWith('.')) || value
}

function daypart(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function readFragmentToken(): string {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The clinician portal could not complete that request.'
}
