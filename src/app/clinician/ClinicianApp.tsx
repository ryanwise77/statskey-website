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
  listClinicianPairingRequests,
  listClinicianShares,
  readClinicalShare,
  redeemClinicalShare,
  registerClinician,
  respondClinicalPairingRequest,
  updateClinicianDashboard,
  type ClinicalCategoryID,
  type ClinicalShareSummary,
  type ClinicalSnapshot,
  type ClinicalSnapshotRecord,
  type ClinicianContext,
  type ClinicianPairingRequest,
  type ClinicianProfile,
  type DietitianMetricEstimate,
  type DietitianNutrientEstimate,
  type DietitianSummary,
} from './clinicalApi'
import { useClinicianAuth } from './ClinicianAuth'
import {
  clearPendingCareShareCode,
  isCareShareCode,
  readPendingCareShareCode,
  savePendingCareShareCode,
} from './pendingCareShare'

const professionalRoles = [
  { id: 'physician', label: 'Physician' },
  { id: 'nursePractitioner', label: 'Nurse practitioner' },
  { id: 'physicianAssistant', label: 'Physician assistant' },
  { id: 'registeredNurse', label: 'Registered nurse' },
  { id: 'registeredDietitian', label: 'Registered dietitian' },
  { id: 'careCoordinator', label: 'Care coordinator' },
  { id: 'other', label: 'Nutritionist, coach, or other professional' },
]

const specialtyOptions: Array<{
  id: string
  label: string
  roles?: string[]
}> = [
  { id: 'primaryCare', label: 'Primary care' },
  { id: 'familyMedicine', label: 'Family medicine' },
  { id: 'internalMedicine', label: 'Internal medicine' },
  { id: 'endocrinology', label: 'Endocrinology' },
  { id: 'cardiology', label: 'Cardiology' },
  { id: 'gastroenterology', label: 'Gastroenterology' },
  { id: 'sportsMedicine', label: 'Sports medicine' },
  { id: 'obesityMedicine', label: 'Obesity medicine' },
  { id: 'nephrology', label: 'Nephrology' },
  { id: 'pediatrics', label: 'Pediatrics' },
  { id: 'psychiatry', label: 'Psychiatry' },
  { id: 'womensHealth', label: "Women's health" },
  { id: 'oncology', label: 'Oncology' },
  {
    id: 'generalDietetics',
    label: 'General dietetics',
    roles: ['registeredDietitian'],
  },
  {
    id: 'sportsNutrition',
    label: 'Sports nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'diabetesNutrition',
    label: 'Diabetes nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'renalNutrition',
    label: 'Renal nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'gastrointestinalNutrition',
    label: 'GI nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'eatingDisorders',
    label: 'Eating disorders',
    roles: ['registeredDietitian'],
  },
  {
    id: 'weightManagement',
    label: 'Weight management',
    roles: ['registeredDietitian'],
  },
  {
    id: 'pediatricNutrition',
    label: 'Pediatric nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'maternalNutrition',
    label: 'Maternal nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'oncologyNutrition',
    label: 'Oncology nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'cardiovascularNutrition',
    label: 'Cardiovascular nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'foodAllergyIntolerance',
    label: 'Food allergy & intolerance',
    roles: ['registeredDietitian'],
  },
  {
    id: 'gerontologicalNutrition',
    label: 'Gerontological nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'communityNutrition',
    label: 'Community nutrition',
    roles: ['registeredDietitian'],
  },
  {
    id: 'chronicCareCoordination',
    label: 'Chronic care coordination',
    roles: ['careCoordinator', 'registeredNurse'],
  },
  {
    id: 'careTransitions',
    label: 'Care transitions',
    roles: ['careCoordinator', 'registeredNurse'],
  },
  {
    id: 'populationHealth',
    label: 'Population health',
    roles: ['careCoordinator', 'registeredNurse'],
  },
  { id: 'other', label: 'Other specialty' },
]

export function ClinicianApp() {
  const { user, loading } = useClinicianAuth()

  if (loading) return <FullPageStatus label="Securing your session…" />
  if (!user) return <AccessPage />
  if (!user.emailVerified) return <VerifyEmailPage />
  return <ClinicianBootstrap />
}

function ClinicianBootstrap() {
  const { signOut } = useClinicianAuth()
  const location = useLocation()
  const pendingRedirectHandled = useRef(false)
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
        title="The professional portal is not enabled here."
      >
        <p>{error}</p>
        <p className="cp-muted">
          No shared information was opened. This environment stays closed
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
  if (!context) return <FullPageStatus label="Opening professional portal…" />
  if (!context.registered || !context.profile || !context.profile.specialty) {
    return (
      <ProfileSetup
        existingProfile={context.profile}
        onComplete={setContext}
      />
    )
  }
  const pendingCode = readPendingCareShareCode()
  const isRedeemPath = location.pathname.endsWith('/redeem')
  if (isRedeemPath) pendingRedirectHandled.current = true
  if (
    pendingCode &&
    !isRedeemPath &&
    !pendingRedirectHandled.current
  ) {
    pendingRedirectHandled.current = true
    return <Navigate to="/redeem" replace />
  }
  if (pendingCode) {
    return <PortalShell profile={context.profile} />
  }
  if (!context.profile.dashboardSetupComplete) {
    return (
      <DashboardSetup
        profile={context.profile}
        onComplete={setContext}
      />
    )
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
  const [patientCode, setPatientCode] = useState(readPendingCareShareCode)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(() =>
    location.hash.length > 1 && !patientCode
      ? 'This care-share link is incomplete or invalid. Ask the person sharing for a fresh code.'
      : null
  )
  const hasPendingCode = isCareShareCode(patientCode)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    setLocalError(null)
    clearError()
    if (patientCode.trim() && !savePendingCareShareCode(patientCode)) {
      setLocalError('Enter the complete care-share code you received.')
      setBusy(false)
      return
    }
    if (!patientCode.trim()) clearPendingCareShareCode()
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
    setLocalError(null)
    clearError()
  }

  return (
    <div className="cp-access">
      <aside className="cp-access__story">
        <BrandLockup />
        <div className="cp-access__story-copy">
          <span className="cp-eyebrow">Professional access</span>
          <h1>Shared context, on their terms.</h1>
          <p>
            Review a time-limited record a client or patient chose to send
            before a conversation or visit. Every share is scoped, single-use,
            and revocable.
          </p>
        </div>
        <div className="cp-trust-list">
          <TrustPoint
            icon="01"
            title="Person authorized"
            text="The person sharing chooses categories, dates, recipient label, and expiration."
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
              A care-share code is waiting. Sign in or create your professional
              account to redeem it.
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
            <span className="cp-eyebrow">Professional portal</span>
            <h2>
              {mode === 'signin'
                ? 'Welcome back.'
                : 'Create professional access.'}
            </h2>
            <p>
              {mode === 'signin'
                ? 'Use your professional account—not a personal StatsKey login.'
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
            <FormField label="Care-share code (optional)">
              <input
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
                maxLength={96}
                onChange={(event) => setPatientCode(event.target.value)}
                placeholder="Paste the code you received"
                spellCheck={false}
                value={patientCode}
              />
              <small>
                You can enter this now. StatsKey keeps it in this tab through
                email verification and dashboard setup.
              </small>
            </FormField>

            {(error || localError || notice) && (
              <div
                className={`cp-message ${
                  error || localError
                    ? 'cp-message--error'
                    : 'cp-message--success'
                }`}
                role="status"
              >
                {error || localError || notice}
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

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === 'hidden') return
      void refreshVerification().catch(() => {
        // The provider message remains available on the verification page.
      })
    }
    window.addEventListener('pageshow', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
    refreshOnReturn()
    return () => {
      window.removeEventListener('pageshow', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [refreshVerification])

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
        keeps professional access separate from personal accounts. The
        link returns to the professional portal on iPhone, iPad, and Android.
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
  existingProfile,
  onComplete,
}: {
  existingProfile?: ClinicianProfile
  onComplete: (context: ClinicianContext) => void
}) {
  const { user, signOut } = useClinicianAuth()
  const [fullName, setFullName] = useState(
    existingProfile?.fullName || user?.displayName || ''
  )
  const [practiceName, setPracticeName] = useState(
    existingProfile?.practiceName || ''
  )
  const [professionalType, setProfessionalType] = useState(
    existingProfile?.professionalType || 'physician'
  )
  const [professionalTypeOther, setProfessionalTypeOther] = useState(
    existingProfile?.professionalTypeOther || ''
  )
  const [specialty, setSpecialty] = useState(
    existingProfile?.specialty || ''
  )
  const [specialtyOther, setSpecialtyOther] = useState(
    existingProfile?.specialtyOther || ''
  )
  const [npi, setNpi] = useState(existingProfile?.npi || '')
  const [jurisdiction, setJurisdiction] = useState(
    existingProfile?.licenseJurisdiction || ''
  )
  const [licenseNumber, setLicenseNumber] = useState(
    existingProfile?.licenseNumber || ''
  )
  const [cdrNumber, setCdrNumber] = useState(
    existingProfile?.cdrNumber || ''
  )
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
        professionalTypeOther:
          professionalType === 'other'
            ? professionalTypeOther.trim()
            : undefined,
        specialty,
        specialtyOther:
          specialty === 'other' ? specialtyOther.trim() : undefined,
        npi: npi.trim() || undefined,
        licenseJurisdiction: jurisdiction.trim() || undefined,
        licenseNumber: licenseNumber.trim() || undefined,
        cdrNumber: cdrNumber.trim() || undefined,
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
        <div className="cp-step-mark">2 of 3</div>
        <span className="cp-eyebrow">Professional profile</span>
        <h1>Shape the portal around your practice.</h1>
        <p className="cp-lede">
          Your role and specialty determine the first dashboard StatsKey
          prepares. You will review that layout before any shared record can
          appear.
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
              onChange={(event) => {
                const nextRole = event.target.value
                setProfessionalType(nextRole)
                if (
                  !availableSpecialties(nextRole).some(
                    (option) => option.id === specialty
                  )
                ) {
                  setSpecialty('')
                }
              }}
            >
              {professionalRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </FormField>
          {professionalType === 'other' && (
            <FormField label="Professional role (other)">
              <input
                value={professionalTypeOther}
                onChange={(event) =>
                  setProfessionalTypeOther(event.target.value)
                }
                maxLength={80}
                required
              />
            </FormField>
          )}
          <FormField label="Primary specialty">
            <select
              value={specialty}
              onChange={(event) => setSpecialty(event.target.value)}
              required
            >
              <option value="" disabled>
                Choose a specialty
              </option>
              {availableSpecialties(professionalType).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          {specialty === 'other' && (
            <FormField label="Specialty (other)">
              <input
                value={specialtyOther}
                onChange={(event) => setSpecialtyOther(event.target.value)}
                placeholder="Your area of practice"
                maxLength={80}
                required
              />
            </FormField>
          )}
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
          <FormField label="License number (optional)">
            <input
              value={licenseNumber}
              onChange={(event) => setLicenseNumber(event.target.value)}
              maxLength={40}
            />
          </FormField>
          {professionalType === 'registeredDietitian' && (
            <FormField label="CDR registration number (optional)">
              <input
                inputMode="numeric"
                value={cdrNumber}
                onChange={(event) =>
                  setCdrNumber(
                    event.target.value.replace(/\D/g, '').slice(0, 8)
                  )
                }
                placeholder="4–8 digits"
                pattern="[0-9]{4,8}"
              />
            </FormField>
          )}

          <div className="cp-credential-note">
            <strong>Credential verification is optional for signup</strong>
            <p>
              You can finish signup, receive care-share codes, and use the
              professional portal without a verification check. If you submit
              a credential, it remains pending until matched to the issuing
              registry. Dietitian registrations use the{' '}
              <a
                href="https://secure.eatright.org/v14pgmlib/prd/cdrvfy001.html"
                rel="noreferrer"
                target="_blank"
              >
                CDR verification system
              </a>
              . Submitting a number does not mark it verified; the check appears
              only after a primary-source match is recorded.
            </p>
          </div>

          <label className="cp-consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              required
            />
            <span>
              I will use person-authorized records only for asynchronous
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
            {busy ? 'Preparing dashboard…' : 'Build my dashboard'}
          </button>
        </form>
      </main>
    </div>
  )
}

function DashboardSetup({
  profile,
  onComplete,
  embedded = false,
}: {
  profile: ClinicianProfile
  onComplete: (context: ClinicianContext) => void
  embedded?: boolean
}) {
  const { signOut } = useClinicianAuth()
  const [selected, setSelected] = useState<Set<ClinicalCategoryID>>(
    () => new Set(profile.dashboardModules || [])
  )
  const [patientCode, setPatientCode] = useState(readPendingCareShareCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(moduleID: ClinicalCategoryID) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(moduleID)) next.delete(moduleID)
      else next.add(moduleID)
      return next
    })
  }

  async function save() {
    if (selected.size === 0) {
      setError('Choose at least one dashboard module.')
      return
    }
    if (
      !embedded &&
      patientCode.trim() &&
      !savePendingCareShareCode(patientCode)
    ) {
      setError('Enter the complete care-share code you received.')
      return
    }
    if (!embedded && !patientCode.trim()) clearPendingCareShareCode()
    setBusy(true)
    setError(null)
    try {
      const ordered = clinicalCategories
        .map((category) => category.id)
        .filter((id) => selected.has(id))
      onComplete(await updateClinicianDashboard(ordered))
    } catch (saveError) {
      setError(message(saveError))
    } finally {
      setBusy(false)
    }
  }

  const content = (
    <>
      {!embedded && <div className="cp-step-mark">3 of 3</div>}
      <span className="cp-eyebrow">
        {embedded ? 'Dashboard preferences' : 'Your starting workspace'}
      </span>
      <h1>
        {embedded
          ? 'Choose what your dashboard emphasizes.'
          : `Built for ${specialtyName(profile)}.`}
      </h1>
      <p className="cp-lede">
        StatsKey selected these modules from your role and specialty. Adjust
        them now or return here later. This setup contains no shared data.
      </p>

      <div className="cp-dashboard-module-grid">
        {clinicalCategories.map((module) => {
          const isSelected = selected.has(module.id)
          return (
            <button
              aria-pressed={isSelected}
              className={`cp-dashboard-module ${
                isSelected ? 'is-selected' : ''
              }`}
              key={module.id}
              onClick={() => toggle(module.id)}
              type="button"
            >
              <span className="cp-dashboard-module__check">
                {isSelected ? '✓' : '+'}
              </span>
              <strong>{module.label}</strong>
              <small>{module.description}</small>
            </button>
          )
        })}
      </div>

      {!embedded && (
        <div className="cp-onboarding-share-code">
          <div>
            <span className="cp-eyebrow">Optional care share</span>
            <h2>Already have a share code?</h2>
            <p>
              Enter it now. After setup, StatsKey will take you directly to
              secure redemption.
            </p>
          </div>
          <FormField label="Care-share code">
            <input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              maxLength={96}
              onChange={(event) => setPatientCode(event.target.value)}
              placeholder="Paste the code you received"
              spellCheck={false}
              value={patientCode}
            />
          </FormField>
        </div>
      )}

      <div className="cp-credential-status">
        <span
          aria-label={
            profile.credentialVerified
              ? 'Primary-source credential verified'
              : 'Credential not verified'
          }
          className={`cp-credential-mark ${
            profile.credentialVerified ? 'is-verified' : ''
          }`}
        >
          {profile.credentialVerified ? '✓' : ''}
        </span>
        <div>
          <strong>
            Credential status:{' '}
            {profile.credentialVerified
              ? 'Verified'
              : humanize(profile.credentialStatus)}
          </strong>
          <small>
            {profile.credentialVerified
              ? 'Primary-source verification is complete.'
              : profile.credentialStatus === 'unverified'
                ? 'No credential number was submitted. Professional portal access remains available.'
                : 'You can use the professional portal while verification remains pending.'}
          </small>
        </div>
      </div>

      {error && <div className="cp-message cp-message--error">{error}</div>}
      <button
        className="cp-button cp-button--primary cp-button--wide"
        disabled={busy || selected.size === 0}
        onClick={() => void save()}
        type="button"
      >
        {busy
          ? 'Saving workspace…'
          : embedded
            ? 'Save dashboard'
            : 'Open professional portal'}
      </button>
    </>
  )

  if (embedded) {
    return <main className="cp-page cp-page--narrow">{content}</main>
  }

  return (
    <div className="cp-onboarding">
      <header className="cp-onboarding__header">
        <BrandLockup />
        <button className="cp-text-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main className="cp-onboarding__card cp-onboarding__card--wide">
        {content}
      </main>
    </div>
  )
}

function PortalShell({
  profile: initialProfile,
}: {
  profile: ClinicianProfile
}) {
  const { signOut } = useClinicianAuth()
  const [profile, setProfile] = useState(initialProfile)

  function updateProfile(context: ClinicianContext) {
    if (context.profile) setProfile(context.profile)
  }

  return (
    <div className="cp-shell">
      <aside className="cp-sidebar">
        <BrandLockup />
        <div className="cp-sidebar__identity">
          <span>{initials(profile.fullName)}</span>
          <div>
            <strong className="cp-professional-name">
              <span>{profile.fullName}</span>
              {profile.credentialVerified && (
                <span
                  aria-label="Primary-source credential verified"
                  className="cp-verification-check"
                  title="Primary-source credential verified"
                >
                  ✓
                </span>
              )}
            </strong>
            <small>{profile.practiceName}</small>
            <small>{specialtyName(profile)}</small>
            {profile.cdrNumber ? (
              <small>CDR# {profile.cdrNumber}</small>
            ) : null}
          </div>
        </div>
        <nav className="cp-sidebar__nav" aria-label="Professional portal">
          <NavLink to="/" end>
            <PortalIcon symbol="⌂" />
            Shared records
          </NavLink>
          {profile.canReceiveShares && (
            <NavLink to="/redeem">
              <PortalIcon symbol="＋" />
              Redeem care share
            </NavLink>
          )}
          <NavLink to="/setup">
            <PortalIcon symbol="◇" />
            Customize dashboard
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
          {profile.canReceiveShares && (
            <NavLink to="/redeem">Redeem</NavLink>
          )}
          <NavLink to="/setup">Customize</NavLink>
        </nav>
        <Routes>
          <Route path="/" element={<Dashboard profile={profile} />} />
          <Route path="/redeem" element={<RedeemShare />} />
          <Route
            path="/setup"
            element={
              <DashboardSetup
                embedded
                profile={profile}
                onComplete={updateProfile}
              />
            }
          />
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
  const [pairingRequests, setPairingRequests] = useState<
    ClinicianPairingRequest[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [respondingID, setRespondingID] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPairingError(null)
    if (!profile.canReceiveShares) {
      setShares([])
      setPairingRequests([])
      setLoading(false)
      return
    }
    try {
      const [shareResult, pairingResult] = await Promise.allSettled([
        listClinicianShares(),
        listClinicianPairingRequests(),
      ])
      if (shareResult.status === 'rejected') throw shareResult.reason
      setShares(shareResult.value.shares)
      if (pairingResult.status === 'fulfilled') {
        setPairingRequests(pairingResult.value.requests)
      } else {
        const pairingMessage = message(pairingResult.reason)
        if (!/not enabled/i.test(pairingMessage)) {
          setPairingError(pairingMessage)
        }
      }
    } catch (loadError) {
      setError(message(loadError))
    } finally {
      setLoading(false)
    }
  }, [profile.canReceiveShares])

  useEffect(() => {
    void load()
  }, [load])

  const active = shares.filter((share) => share.status === 'active')
  const recentlyOpened = shares.filter((share) => share.lastAccessedAt).length
  const pendingPairings = pairingRequests.filter(
    (request) => request.status === 'pending'
  )

  async function respond(
    pairingID: string,
    action: 'confirm' | 'decline'
  ) {
    setRespondingID(pairingID)
    setPairingError(null)
    try {
      const result = await respondClinicalPairingRequest(pairingID, action)
      setPairingRequests((current) =>
        current.map((request) =>
          request.id === pairingID ? result.request : request
        )
      )
    } catch (responseError) {
      setPairingError(message(responseError))
    } finally {
      setRespondingID(null)
    }
  }

  async function copyPairingCode() {
    if (!profile.pairingCode) return
    try {
      await navigator.clipboard.writeText(profile.pairingCode)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 1800)
    } catch {
      setPairingError('Copy failed. Select the code and copy it manually.')
    }
  }

  return (
    <main className="cp-page">
      <PageHeader
        eyebrow={profile.practiceName}
        title={`Good ${daypart()}, ${firstName(profile.fullName)}.`}
        description={
          !profile.canReceiveShares
            ? 'Finish primary-source credential verification before inviting clients or receiving records.'
            : profile.cdrNumber
            ? `CDR# ${profile.cdrNumber}. Review only the records people deliberately shared with your professional account.`
            : 'Review only the records people deliberately shared with your professional account.'
        }
        action={
          profile.canReceiveShares ? (
            <Link className="cp-button cp-button--primary" to="/redeem">
              Redeem care share
            </Link>
          ) : undefined
        }
      />

      <section className="cp-stat-grid" aria-label="Portal summary">
        <StatCard value={String(active.length)} label="Active records" />
        <StatCard
          value={String(recentlyOpened)}
          label="Records reviewed"
        />
        <StatCard
          value={String(pendingPairings.length)}
          label="Identity checks waiting"
          accent
        />
      </section>

      <section className="cp-panel cp-workspace-config">
        <div className="cp-panel__header">
          <div>
            <span className="cp-eyebrow">{specialtyName(profile)} workspace</span>
            <h2>Your dashboard emphasis</h2>
            <p>
              Prepared before shared data arrives. These modules change
              presentation, never someone’s sharing permissions.
            </p>
          </div>
          <Link className="cp-button cp-button--secondary" to="/setup">
            Customize
          </Link>
        </div>
        <div className="cp-dashboard-chip-list">
          {(profile.dashboardModules || []).map((moduleID) => (
            <span key={moduleID}>
              <b>{categorySymbol(moduleID)}</b>
              {categoryName(moduleID)}
            </span>
          ))}
        </div>
      </section>

      <section className="cp-panel cp-pairing-center">
        <div className="cp-pairing-code-card">
          <div>
            <span className="cp-eyebrow">Your office pairing code</span>
            <h2>
              {profile.canPair
                ? 'Invite clients to connect.'
                : 'Available after credential verification.'}
            </h2>
            <p>
              {profile.canPair
                ? 'Clients enter this code in StatsKey. You confirm their first name, last name, and account email before the pairing is active.'
                : 'Your dashboard can be customized now, but client identities and records stay closed until primary-source verification is complete.'}
            </p>
          </div>
          <div className="cp-provider-code">
            <code>
              {profile.pairingCode || 'Verification required'}
            </code>
            <button
              className="cp-button cp-button--secondary"
              disabled={!profile.pairingCode}
              onClick={() => void copyPairingCode()}
              type="button"
            >
              {codeCopied ? 'Copied' : 'Copy code'}
            </button>
          </div>
          <small>
            Pairing confirms identity only. It does not expose a meal,
            workout, measurement, or other record.
          </small>
        </div>

        <div className="cp-pairing-inbox">
          <div className="cp-panel__header">
            <div>
              <span className="cp-eyebrow">Identity confirmation</span>
              <h2>Client pairing requests</h2>
            </div>
            <button
              aria-label="Refresh pairing requests"
              className="cp-icon-button"
              disabled={loading || !profile.canPair}
              onClick={() => void load()}
            >
              ↻
            </button>
          </div>
          {pairingError && (
            <div className="cp-message cp-message--error">{pairingError}</div>
          )}
          {!profile.canPair ? (
            <div className="cp-pairing-empty">
              <strong>Client pairing is locked.</strong>
              <p>
                Primary-source credential verification must be recorded before
                StatsKey accepts an office code or reveals client identity.
              </p>
            </div>
          ) : pairingRequests.length === 0 ? (
            <div className="cp-pairing-empty">
              <strong>No identity checks waiting.</strong>
              <p>
                Share your office code before the visit. Requests appear here
                without opening any StatsKey health data.
              </p>
            </div>
          ) : (
            <div className="cp-pairing-list">
              {pairingRequests.map((request) => (
                <article className="cp-pairing-request" key={request.id}>
                  <div className="cp-pairing-request__identity">
                    <span>{initials(`${request.firstName} ${request.lastName}`)}</span>
                    <div>
                      <strong>
                        {request.firstName} {request.lastName}
                      </strong>
                      <a href={`mailto:${request.email}`}>{request.email}</a>
                      <small>
                        Requested {formatDate(request.createdAt)}
                        {request.emailVerified
                          ? ' · Account email verified'
                          : ' · Email not independently verified'}
                      </small>
                    </div>
                  </div>
                  {request.status === 'pending' ? (
                    <div className="cp-pairing-request__actions">
                      <button
                        className="cp-button cp-button--primary"
                        disabled={respondingID === request.id}
                        onClick={() => void respond(request.id, 'confirm')}
                        type="button"
                      >
                        Confirm match
                      </button>
                      <button
                        className="cp-button cp-button--quiet"
                        disabled={respondingID === request.id}
                        onClick={() => void respond(request.id, 'decline')}
                        type="button"
                      >
                        Not this client
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`cp-pairing-state cp-pairing-state--${request.status}`}
                    >
                      {request.status === 'confirmed'
                        ? 'Confirmed · waiting for authorization'
                        : request.status === 'revoked'
                          ? 'Disconnected by the person sharing'
                          : 'Not confirmed'}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="cp-panel cp-records-panel">
        <div className="cp-panel__header">
          <div>
            <span className="cp-eyebrow">Shared records</span>
            <h2>Shared records</h2>
          </div>
          <button
            className="cp-icon-button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh shared records"
          >
            ↻
          </button>
        </div>

        {error && (
          <div className="cp-message cp-message--error">{error}</div>
        )}
        {loading ? (
          <InlineLoading label="Refreshing shared records…" />
        ) : shares.length === 0 ? (
          <div className="cp-empty">
            <div className="cp-empty__icon">＋</div>
            <h3>No shared records yet.</h3>
            <p>
              {profile.canReceiveShares
                ? 'A confirmed pairing still contains no health data. Ask the person to create a scoped Care Share when they are ready.'
                : 'Shared records remain unavailable until primary-source credential verification is complete.'}
            </p>
            {profile.canReceiveShares && (
              <Link className="cp-button cp-button--secondary" to="/redeem">
                Enter a code
              </Link>
            )}
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
                  {initials(share.patientDisplayName || 'Shared')}
                </div>
                <div className="cp-record-row__main">
                  <strong>{share.patientDisplayName || 'Shared record'}</strong>
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
  const location = useLocation()
  const [token, setToken] = useState(readPendingCareShareCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!location.hash) return
    const nextCode = readPendingCareShareCode(location.hash)
    setToken(nextCode)
    setError(
      nextCode
        ? null
        : 'This care-share link is incomplete or invalid. Ask the person sharing for a fresh code.'
    )
  }, [location.hash])

  function updateToken(value: string) {
    setToken(value)
    clearPendingCareShareCode()
    if (isCareShareCode(value)) savePendingCareShareCode(value)
  }

  function dismissCode() {
    clearPendingCareShareCode()
    setToken('')
    setError(null)
    navigate('/', { replace: true })
  }

  async function redeem(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const pendingCode = savePendingCareShareCode(token)
      if (!pendingCode) {
        setError('Enter the complete care-share code you received.')
        return
      }
      const result = await redeemClinicalShare(pendingCode)
      clearPendingCareShareCode()
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
        title="Redeem a care share."
        description="Paste the code you received. It can be used once and binds the record to this professional account."
      />
      <section className="cp-panel cp-redeem-card">
        <div className="cp-redeem-card__icon">⌁</div>
        <h2>Care-share code</h2>
        <p>
          Codes are case-sensitive. Spaces added for readability are fine.
        </p>
        <form className="cp-form" onSubmit={redeem}>
          <FormField label="Care-share code">
            <input
              className="cp-code-input"
              value={token}
              onChange={(event) => updateToken(event.target.value)}
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
          <button
            className="cp-button cp-button--quiet cp-button--wide"
            disabled={busy}
            onClick={dismissCode}
            type="button"
          >
            Clear code and return to records
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
          ← Shared records
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
        ← Shared records
      </Link>
      <PageHeader
        eyebrow="Person-authorized record"
        title={
          snapshot?.patient.displayName ||
          summary.patientDisplayName ||
          'Shared record'
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
            The sharing authorization no longer permits access. Previously
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
        This is a person-authorized StatsKey wellness record for asynchronous
        review. It may include manually entered and device-synced information.
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
        <li>Use only for the authorized review purpose.</li>
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
          <span className="cp-record-hero__label">Shared by the account holder</span>
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

      {snapshot.dietitianSummary ? (
        <DietitianReview summary={snapshot.dietitianSummary} />
      ) : null}

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

function DietitianReview({ summary }: { summary: DietitianSummary }) {
  const initialInterval =
    summary.intervals.find((interval) => interval.id === '30d') ||
    summary.intervals[0]
  const [selectedID, setSelectedID] = useState(initialInterval?.id || 'all')
  const interval =
    summary.intervals.find((value) => value.id === selectedID) ||
    initialInterval

  if (!interval) return null

  const nutrientsByKey = new Map(
    interval.nutrition.nutrients.map((nutrient) => [
      nutrient.key,
      nutrient,
    ])
  )
  const pairedRows = summary.pairedDaily
    .filter(
      (row) =>
        row.day >= interval.startDay && row.day <= interval.endDay
    )
    .slice(0, 14)
  const groupedNutrients = groupNutrients(interval.nutrition.nutrients)

  return (
    <section className="cp-dietitian-review">
      <div className="cp-dietitian-review__header">
        <div>
          <span className="cp-eyebrow">Dietitian review</span>
          <h2>Dietary intake, micronutrients, and activity</h2>
          <p>
            Recorded intake estimates are paired with device-synced activity.
            Every estimate includes its observed coverage and approximate 95%
            interval.
          </p>
        </div>
        <div
          className="cp-interval-tabs"
          aria-label="Dietitian review interval"
        >
          {summary.intervals.map((value) => (
            <button
              className={value.id === interval.id ? 'is-selected' : ''}
              key={value.id}
              onClick={() => setSelectedID(value.id)}
              type="button"
            >
              {value.id === 'all' ? 'All' : value.id.replace('d', ' days')}
            </button>
          ))}
        </div>
      </div>

      <div className="cp-coverage-strip">
        <span>
          <strong>{interval.nutrition.recordedDays}</strong> intake days
          recorded
        </span>
        <span>
          <strong>{interval.activity.recordedDays}</strong> activity days
          synced
        </span>
        <span>
          <strong>{interval.paired.matchedDays}</strong> paired days
        </span>
        <span>
          {formatDate(interval.startDay)} – {formatDate(interval.endDay)}
        </span>
      </div>

      <div className="cp-dietitian-metric-grid">
        <NutrientEstimateCard
          label="Energy intake"
          nutrient={nutrientsByKey.get('calories')}
        />
        <NutrientEstimateCard
          label="Protein"
          nutrient={nutrientsByKey.get('protein')}
        />
        <NutrientEstimateCard
          label="Dietary fiber"
          nutrient={nutrientsByKey.get('dietary_fiber')}
        />
        <MetricEstimateCard
          estimate={interval.activity.totalExpenditureKcal}
          label="Device-estimated expenditure"
          unit="kcal/day"
        />
        <MetricEstimateCard
          estimate={interval.activity.steps}
          label="Steps"
          unit="/day"
        />
        <MetricEstimateCard
          estimate={interval.activity.exerciseMinutes}
          label="Exercise"
          unit="min/day"
        />
      </div>

      <section className="cp-panel cp-paired-panel">
        <div className="cp-panel__header">
          <div>
            <span className="cp-eyebrow">Nutrition + activity pairing</span>
            <h2>Recorded intake alongside movement</h2>
            <p>
              Energy difference is intake minus device-estimated basal and
              active expenditure. It is not a measure of energy availability.
            </p>
          </div>
        </div>
        <div className="cp-paired-summary">
          <MetricEstimateCard
            estimate={interval.paired.intakeKcal}
            label="Paired-day intake"
            unit="kcal/day"
          />
          <MetricEstimateCard
            estimate={interval.paired.deviceExpenditureKcal}
            label="Paired-day expenditure"
            unit="kcal/day"
          />
          <MetricEstimateCard
            estimate={interval.paired.intakeMinusExpenditureKcal}
            label="Intake − expenditure"
            signed
            unit="kcal/day"
          />
        </div>
        {pairedRows.length > 0 ? (
          <div className="cp-paired-table-wrap">
            <table className="cp-paired-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Intake</th>
                  <th>Expenditure</th>
                  <th>Difference</th>
                  <th>Protein</th>
                  <th>Fiber</th>
                  <th>Steps</th>
                  <th>Exercise</th>
                </tr>
              </thead>
              <tbody>
                {pairedRows.map((row) => (
                  <tr key={row.day}>
                    <td>{formatDate(row.day)}</td>
                    <td>{formatCompact(row.intakeKcal)} kcal</td>
                    <td>{formatCompact(row.deviceExpenditureKcal)} kcal</td>
                    <td className={row.intakeMinusExpenditureKcal < 0 ? 'is-negative' : ''}>
                      {formatSigned(row.intakeMinusExpenditureKcal)} kcal
                    </td>
                    <td>{formatCompact(row.proteinGrams)} g</td>
                    <td>{formatCompact(row.fiberGrams)} g</td>
                    <td>{formatCompact(row.steps)}</td>
                    <td>{formatCompact(row.exerciseMinutes)} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cp-muted">
            No days in this interval contain both intake and activity data.
          </p>
        )}
      </section>

      <section className="cp-panel cp-nutrient-estimates">
        <div className="cp-panel__header">
          <div>
            <span className="cp-eyebrow">Nutrient exposure estimates</span>
            <h2>Macronutrients and micronutrients</h2>
            <p>
              Means use days where that nutrient was reported. Intervals
              combine day-to-day variation with source and portion uncertainty.
            </p>
          </div>
        </div>
        <div className="cp-nutrient-groups">
          {groupedNutrients.map(([category, nutrients]) => (
            <details
              key={category}
              open={[
                'Macronutrients & intake',
                'Vitamins',
                'Minerals & electrolytes',
              ].includes(category)}
            >
              <summary>
                <strong>{category}</strong>
                <span>{nutrients.length} nutrients</span>
              </summary>
              <div className="cp-nutrient-table">
                <div className="cp-nutrient-row cp-nutrient-row--header">
                  <span>Nutrient</span>
                  <span>Mean / recorded day</span>
                  <span>Approx. 95% interval</span>
                  <span>Coverage</span>
                  <span>Confidence</span>
                </div>
                {nutrients.map((nutrient) => (
                  <div className="cp-nutrient-row" key={nutrient.key}>
                    <strong>{nutrient.label}</strong>
                    <span>
                      {formatCompact(nutrient.meanPerRecordedDay)}{' '}
                      {nutrient.unit}
                    </span>
                    <span>
                      {formatCompact(nutrient.lower95)}–
                      {formatCompact(nutrient.upper95)} {nutrient.unit}
                    </span>
                    <span>{nutrient.coverageDays} days</span>
                    <span
                      className={`cp-confidence cp-confidence--${nutrient.confidence}`}
                    >
                      {humanize(nutrient.confidence)}
                      {nutrient.estimatedPercent > 0
                        ? ` · ${nutrient.estimatedPercent}% estimated`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <div className="cp-methodology">
        <strong>Interpretation notes</strong>
        <p>{summary.methodology.confidenceInterval}</p>
        <p>{summary.methodology.nutrition}</p>
        <p>{summary.methodology.activity}</p>
        <p>{summary.disclaimer}</p>
      </div>
    </section>
  )
}

function NutrientEstimateCard({
  label,
  nutrient,
}: {
  label: string
  nutrient?: DietitianNutrientEstimate
}) {
  if (!nutrient) {
    return (
      <article className="cp-estimate-card">
        <span>{label}</span>
        <strong>Not recorded</strong>
      </article>
    )
  }
  return (
    <article className="cp-estimate-card">
      <span>{label}</span>
      <strong>
        {formatCompact(nutrient.meanPerRecordedDay)} {nutrient.unit}
        <small>/ recorded day</small>
      </strong>
      <p>
        95% interval {formatCompact(nutrient.lower95)}–
        {formatCompact(nutrient.upper95)} {nutrient.unit}
      </p>
      <small>
        {nutrient.coverageDays} days · {humanize(nutrient.confidence)} confidence
      </small>
    </article>
  )
}

function MetricEstimateCard({
  label,
  estimate,
  unit,
  signed = false,
}: {
  label: string
  estimate: DietitianMetricEstimate
  unit: string
  signed?: boolean
}) {
  const value = signed
    ? formatSigned(estimate.mean)
    : formatCompact(estimate.mean)
  return (
    <article className="cp-estimate-card">
      <span>{label}</span>
      <strong>
        {value} {unit}
      </strong>
      <p>
        95% interval {signed ? formatSigned(estimate.lower95) : formatCompact(estimate.lower95)}
        –
        {signed ? formatSigned(estimate.upper95) : formatCompact(estimate.upper95)}{' '}
        {unit}
      </p>
    </article>
  )
}

function groupNutrients(
  nutrients: DietitianNutrientEstimate[]
): Array<[string, DietitianNutrientEstimate[]]> {
  const groups = new Map<string, DietitianNutrientEstimate[]>()
  for (const nutrient of nutrients) {
    const values = groups.get(nutrient.category) || []
    values.push(nutrient)
    groups.set(nutrient.category, values)
  }
  return [...groups.entries()]
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
                {result.needsReview === true && <em>Review flag</em>}
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
        <small>Professional portal</small>
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
  if (categoryID === 'wellness') {
    return humanize(String(record.type || 'Wellness entry'))
  }
  return categoryName(categoryID)
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    return value.every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
    )
      ? value.map((item) => humanize(String(item))).join(', ')
      : `${value.length} items`
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, nested]) => `${humanize(key)} ${formatValue(nested)}`)
      .join(' · ')
  }
  return String(value ?? '—')
}

function formatCompact(value: number): string {
  const magnitude = Math.abs(value)
  return value.toLocaleString(undefined, {
    maximumFractionDigits: magnitude < 10 ? 2 : magnitude < 100 ? 1 : 0,
  })
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${formatCompact(value)}`
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

function availableSpecialties(role: string) {
  if (role === 'registeredDietitian' || role === 'careCoordinator') {
    return specialtyOptions.filter(
      (option) => option.id === 'other' || option.roles?.includes(role)
    )
  }
  return specialtyOptions.filter(
    (option) => !option.roles || option.roles.includes(role)
  )
}

function specialtyName(profile: ClinicianProfile): string {
  if (profile.specialty === 'other' && profile.specialtyOther) {
    return profile.specialtyOther
  }
  return (
    specialtyOptions.find((option) => option.id === profile.specialty)?.label ||
    professionalRoles.find((role) => role.id === profile.professionalType)
      ?.label ||
    'Clinical'
  )
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
    wellness: '◌',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The professional portal could not complete that request.'
}
