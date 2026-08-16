import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/auth'
import { useGlucoseStatus } from '../lib/data/useGlucoseStatus'
import { useSubscription } from '../lib/data/useSubscription'
import { formatTokens, useTokenBalance } from '../lib/data/useTokenBalance'
import { useMacroTargets } from '../lib/data/useMacroTargets'
import { IntelligenceConsentSettings } from '../components/assistant/IntelligenceConsentGate'
import { AssistantConnections } from '../components/assistant/AssistantConnections'
import { AssistantIntegrationTest } from '../components/assistant/AssistantIntegrationTest'
import {
  cancelAccountDeletion,
  requestAccountDeletion,
  saveMacroTargets,
  saveSocialProfile,
  syncUserLookup,
} from '../lib/writers'
import type { ActivityLevel, AppFocus, BiologicalProfile, UserProfile } from '../lib/profile'
import { confirmDialog } from '../lib/ui/dialogs'
import type {
  ExerciseCalorieStrategy,
  MacroTargets,
  NutritionCarbPreference,
  NutritionGoalType,
} from '../lib/types'

const BIO_OPTIONS: { value: BiologicalProfile; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'transManNoHRT', label: 'Transgender man (no HRT)' },
  { value: 'transManHRT', label: 'Transgender man (on testosterone)' },
  { value: 'transWomanNoHRT', label: 'Transgender woman (no HRT)' },
  { value: 'transWomanHRT', label: 'Transgender woman (on estrogen)' },
  { value: 'nonBinaryNoHRT', label: 'Non-binary (no HRT)' },
  { value: 'nonBinaryEstrogen', label: 'Non-binary (estrogen HRT)' },
  { value: 'nonBinaryTestosterone', label: 'Non-binary (testosterone HRT)' },
]

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'lightlyActive', label: 'Lightly Active' },
  { value: 'moderatelyActive', label: 'Moderately Active' },
  { value: 'veryActive', label: 'Very Active' },
  { value: 'extremelyActive', label: 'Extremely Active' },
]

const FOCUS_OPTIONS: { value: AppFocus; label: string }[] = [
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'both', label: 'Both' },
]

const GOAL_OPTIONS: { value: NutritionGoalType; label: string }[] = [
  { value: 'maintain', label: 'Maintain' },
  { value: 'fatLoss', label: 'Lose Fat' },
  { value: 'muscleGain', label: 'Build Muscle' },
  { value: 'performance', label: 'Fuel Performance' },
]

const CARB_OPTIONS: { value: NutritionCarbPreference; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'performance', label: 'Higher Carb' },
  { value: 'lowerCarb', label: 'Lower Carb' },
  { value: 'ketogenic', label: 'Keto' },
]

const EXERCISE_OPTIONS: { value: ExerciseCalorieStrategy; label: string }[] = [
  { value: 'activityInclusive', label: 'Included — target already covers typical training' },
  { value: 'addAboveBaseline', label: 'Bonus only — unusual activity adds calories' },
  { value: 'fixedBudget', label: 'Fixed — intake never changes for exercise' },
]

export function Profile() {
  const { user, profile, saveProfile, profileLoaded, signOut } = useAuth()
  const subState = useSubscription(user?.uid)
  const tokenState = useTokenBalance(user?.uid)
  const glucoseStatus = useGlucoseStatus(user?.uid)
  const [draft, setDraft] = useState<UserProfile | null>(profile)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(profile)
  }, [profile])

  if (!profileLoaded) {
    return <p className="text-text-secondary text-sm">Loading…</p>
  }

  if (!draft) {
    return <p className="text-text-secondary text-sm">No profile yet.</p>
  }

  function update<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await saveProfile({ ...draft, onboardingComplete: true })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-[640px] space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Profile</h1>
        <p className="text-text-secondary text-[14px]">
          Changes sync instantly to your iOS app.
        </p>
      </header>

      <div className="panel space-y-4">
        <Field label="Name">
          <input className="input" value={draft.name} onChange={(e) => update('name', e.target.value)} />
        </Field>

        <Field label="Email">
          <input className="input" value={draft.email} disabled />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Height (ft)">
            <input
              className="input"
              type="number"
              min={0}
              value={draft.heightFeet}
              onChange={(e) => update('heightFeet', Number(e.target.value))}
            />
          </Field>
          <Field label="Height (in)">
            <input
              className="input"
              type="number"
              min={0}
              max={11}
              value={draft.heightInches}
              onChange={(e) => update('heightInches', Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="Weight (lb)">
          <input
            className="input"
            type="number"
            min={0}
            value={draft.weightLbs}
            onChange={(e) => update('weightLbs', Number(e.target.value))}
          />
        </Field>

        <Field label="Birth year">
          <input
            className="input"
            type="number"
            min={1900}
            max={new Date().getFullYear()}
            value={draft.birthYear ?? ''}
            onChange={(e) => update('birthYear', e.target.value ? Number(e.target.value) : undefined)}
          />
        </Field>

        <Field label="Biological profile">
          <Select
            value={draft.biologicalProfile}
            options={BIO_OPTIONS}
            onChange={(v) => update('biologicalProfile', v)}
          />
        </Field>

        <Field label="Activity level">
          <Select
            value={draft.activityLevel}
            options={ACTIVITY_OPTIONS}
            onChange={(v) => update('activityLevel', v)}
          />
        </Field>

        <Field label="App focus">
          <Select
            value={draft.appFocus}
            options={FOCUS_OPTIONS}
            onChange={(v) => update('appFocus', v)}
          />
        </Field>
      </div>

      <div className="panel space-y-4">
        <div>
          <span className="card-title">Health & fine-tuning</span>
          <p className="text-text-muted text-[12px] mt-1">
            These personalize Intelligence analysis, meal plans, and micronutrient targets — same as the iOS Health
            &amp; Fine-tuning settings.
          </p>
        </div>
        <TagListField
          label="Dietary preferences"
          placeholder="e.g. vegetarian, high-protein"
          values={draft.dietaryPreferences}
          onChange={(v) => update('dietaryPreferences', v)}
        />
        <TagListField
          label="Food allergies"
          placeholder="e.g. peanuts, shellfish"
          values={draft.foodAllergies}
          onChange={(v) => update('foodAllergies', v)}
        />
        <TagListField
          label="Food intolerances"
          placeholder="e.g. lactose"
          values={draft.foodIntolerances}
          onChange={(v) => update('foodIntolerances', v)}
        />
        <TagListField
          label="Medical conditions"
          placeholder="e.g. IBS, type 2 diabetes"
          values={draft.medicalConditions}
          onChange={(v) => update('medicalConditions', v)}
        />
        <Field label="Health notes">
          <textarea
            className="input"
            rows={3}
            placeholder="Anything else the intelligence should know"
            value={draft.healthNotes}
            onChange={(e) => update('healthNotes', e.target.value)}
          />
        </Field>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span className="text-data text-[13px]">Saved</span>}
      </div>

      <TargetsPanel uid={user?.uid} />

      <SocialPanel uid={user?.uid} displayNameFallback={draft.name} email={draft.email} />

      <div className="panel space-y-3">
        <span className="card-title">Subscription</span>
        {subState.loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-text-secondary">Tier</span>
              <span className="text-text-primary font-medium">
                {subState.subscription?.tier === 'pro' ? 'Pro' : 'Free'}
              </span>
            </div>
            {subState.subscription?.researchTokenLimit != null && subState.subscription.researchTokenLimit > 0 && (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-text-secondary">Deep analysis</span>
                <span className="text-text-primary">Enabled</span>
              </div>
            )}
            <p className="text-text-muted text-[12px] mt-2">
              iOS subscriptions are managed through the App Store. Web token packs are available
              separately for power users who need more managed Intelligence usage without bringing an API key.
            </p>
            <Link to="/tokens" className="link text-[13px] font-medium">
              Buy web token packs
            </Link>
          </>
        )}
      </div>

      <div className="panel space-y-3">
        <span className="card-title">Intelligence Credits</span>
        {tokenState.loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : tokenState.error ? (
          <div className="error-banner">{tokenState.error}</div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-text-secondary">Remaining</span>
              <span className="text-text-primary font-medium">
                {formatTokens(tokenState.tokens?.balance ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-text-secondary">Lifetime used</span>
              <span className="text-text-primary">
                {formatTokens(tokenState.tokens?.lifetimeUsed ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-text-secondary">Current month</span>
              <span className="text-text-primary">
                {tokenState.tokens?.currentMonth ?? 'None'}
              </span>
            </div>
            <Link to="/tokens" className="link text-[13px] font-medium">
              Manage web token packs
            </Link>
          </>
        )}
      </div>

      <div className="panel space-y-3">
        <span className="card-title">Glucose data</span>
        {glucoseStatus.loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : glucoseStatus.error ? (
          <div className="error-banner">{glucoseStatus.error}</div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-text-secondary">Latest source</span>
              <span className="text-text-primary font-medium">
                {glucoseStatus.latest?.source ?? 'Not connected'}
              </span>
            </div>
            {glucoseStatus.latest && (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-text-secondary">Latest reading</span>
                <span className="text-text-primary">
                  {Math.round(glucoseStatus.latest.value)} mg/dL · {formatRelativeTime(glucoseStatus.latest.timestamp)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-text-secondary">Dexcom API sync</span>
              <span className="text-text-primary">
                {glucoseStatus.dexcomCount && glucoseStatus.dexcomCount > 0
                  ? `${glucoseStatus.dexcomCount.toLocaleString()} readings synced`
                  : 'Connect once in the iOS app'}
              </span>
            </div>
            <p className="text-text-muted text-[12px] mt-2">
              Dexcom Share login stays in the iOS app keychain. Once connected there, StatsKey backs the readings up to Firebase so Intelligence and the website can use the same history.
            </p>
          </>
        )}
      </div>

      <IntelligenceConsentSettings />
      <AssistantConnections />
      <AssistantIntegrationTest />

      <AccountPanel
        uid={user?.uid}
        pendingDeletionAt={draft.pendingDeletionAt}
        onSignOut={signOut}
      />
    </div>
  )
}

// MARK: - Targets

function TargetsPanel({ uid }: { uid?: string }) {
  const targetsState = useMacroTargets(uid)
  const [draft, setDraft] = useState<MacroTargets | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!targetsState.loading) setDraft(targetsState.targets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsState.loading, JSON.stringify(targetsState.targets)])

  if (!draft) {
    return (
      <div className="panel">
        <span className="card-title">Nutrition targets</span>
        <p className="text-text-muted text-[13px] mt-2">Loading…</p>
      </div>
    )
  }

  function update<K extends keyof MacroTargets>(key: K, value: MacroTargets[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  async function save() {
    if (!uid || !draft) return
    setSaving(true)
    setError(null)
    try {
      await saveMacroTargets(uid, draft)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel space-y-4">
      <div>
        <span className="card-title">Nutrition targets</span>
        <p className="text-text-muted text-[12px] mt-1">
          Daily targets used by the dashboard, Insights, and Intelligence. Manual edits here turn off
          Adaptive Intelligence until you re-enable it.
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          className="mt-1"
          checked={draft.isAIAdaptive}
          onChange={(e) => update('isAIAdaptive', e.target.checked)}
        />
        <span>
          <span className="block font-medium text-text-primary">Adaptive Intelligence</span>
          <span className="block mt-1">
            StatsKey reconciles your recorded intake and weight trend to keep targets honest.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Calories">
          <input className="input" type="number" min={0} value={Math.round(draft.calories)}
            onChange={(e) => update('calories', Number(e.target.value))} />
        </Field>
        <Field label="Protein (g)">
          <input className="input" type="number" min={0} value={Math.round(draft.protein)}
            onChange={(e) => update('protein', Number(e.target.value))} />
        </Field>
        <Field label="Carbs (g)">
          <input className="input" type="number" min={0} value={Math.round(draft.carbs)}
            onChange={(e) => update('carbs', Number(e.target.value))} />
        </Field>
        <Field label="Fat (g)">
          <input className="input" type="number" min={0} value={Math.round(draft.fat)}
            onChange={(e) => update('fat', Number(e.target.value))} />
        </Field>
        <Field label="Fiber (g)">
          <input className="input" type="number" min={0} value={Math.round(draft.fiber)}
            onChange={(e) => update('fiber', Number(e.target.value))} />
        </Field>
        <Field label="Water (fl oz)">
          <input className="input" type="number" min={0} value={Math.round(draft.water)}
            onChange={(e) => {
              update('water', Number(e.target.value))
              update('isWaterCustom', true)
            }} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Goal">
          <Select value={draft.goalType} options={GOAL_OPTIONS} onChange={(v) => update('goalType', v)} />
        </Field>
        <Field label="Carb preference">
          <Select value={draft.carbPreference} options={CARB_OPTIONS} onChange={(v) => update('carbPreference', v)} />
        </Field>
      </div>

      <Field label="Exercise calories">
        <Select
          value={draft.exerciseCalorieStrategy}
          options={EXERCISE_OPTIONS}
          onChange={(v) => update('exerciseCalorieStrategy', v)}
        />
      </Field>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save targets'}
        </button>
        {saved && <span className="text-data text-[13px]">Saved — synced to iOS</span>}
      </div>
    </div>
  )
}

// MARK: - Social profile

function SocialPanel({
  uid,
  displayNameFallback,
  email,
}: {
  uid?: string
  displayNameFallback: string
  email: string
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isDiscoverable, setIsDiscoverable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) return
    let cancelled = false
    getDoc(doc(db, 'users', uid, 'social', 'profile'))
      .then((snap) => {
        if (cancelled) return
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {}
        setUsername(typeof data.username === 'string' ? data.username : '')
        setDisplayName(typeof data.displayName === 'string' ? data.displayName : displayNameFallback)
        setIsDiscoverable(data.isDiscoverable !== false)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  async function save() {
    if (!uid) return
    setSaving(true)
    setError(null)
    try {
      const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')
      await saveSocialProfile(uid, {
        username: cleanUsername || undefined,
        displayName: displayName.trim() || displayNameFallback,
        isDiscoverable,
      })
      await syncUserLookup(uid, {
        displayName: displayName.trim() || displayNameFallback,
        email,
        username: cleanUsername || undefined,
      })
      setUsername(cleanUsername)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel space-y-4">
      <div>
        <span className="card-title">Social profile</span>
        <p className="text-text-muted text-[12px] mt-1">
          What friends see, and how people can find you. Your friend code always works.
        </p>
      </div>
      {!loaded ? (
        <p className="text-text-muted text-[13px]">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Display name">
              <input className="input" value={displayName} onChange={(e) => { setDisplayName(e.target.value); setSaved(false) }} />
            </Field>
            <Field label="Username">
              <input
                className="input"
                placeholder="lowercase, no spaces"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setSaved(false) }}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              checked={isDiscoverable}
              onChange={(e) => { setIsDiscoverable(e.target.checked); setSaved(false) }}
            />
            Discoverable — friends can find me by username
          </label>
          {error && <div className="error-banner">{error}</div>}
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save social profile'}
            </button>
            {saved && <span className="text-data text-[13px]">Saved</span>}
          </div>
        </>
      )}
    </div>
  )
}

// MARK: - Account

function AccountPanel({
  uid,
  pendingDeletionAt,
  onSignOut,
}: {
  uid?: string
  pendingDeletionAt?: Date
  onSignOut: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestDeletion() {
    if (!uid) return
    const ok = await confirmDialog({
      title: 'Delete your account?',
      body: 'Your data is scheduled for permanent deletion in 30 days. Signing back in during that window lets you restore it.',
      confirmLabel: 'Delete account',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await requestAccountDeletion(uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function cancelDeletion() {
    if (!uid) return
    setBusy(true)
    setError(null)
    try {
      await cancelAccountDeletion(uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel space-y-3">
      <span className="card-title">Account</span>
      {pendingDeletionAt ? (
        <>
          <div className="error-banner">
            Your account is scheduled for deletion (requested{' '}
            {pendingDeletionAt.toLocaleDateString([], { month: 'long', day: 'numeric' })}). All data is
            permanently erased about 30 days after the request.
          </div>
          <button className="btn btn-primary" onClick={cancelDeletion} disabled={busy}>
            {busy ? 'Working…' : 'Restore my account'}
          </button>
        </>
      ) : (
        <>
          <p className="text-text-muted text-[12px]">
            Deleting your account schedules all data for permanent removal after a 30-day grace period —
            the same flow as the iOS app.
          </p>
          <div className="flex items-center gap-3">
            <button className="btn btn-secondary" onClick={onSignOut}>Sign out</button>
            <button className="btn btn-ghost text-red-300" onClick={requestDeletion} disabled={busy}>
              {busy ? 'Working…' : 'Delete account'}
            </button>
          </div>
        </>
      )}
      {error && <div className="error-banner">{error}</div>}
    </div>
  )
}

// MARK: - Shared field components

function formatRelativeTime(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-muted text-[12px] uppercase tracking-wider block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function TagListField({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string
  placeholder?: string
  values: string[]
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function commit() {
    const items = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()))
    if (items.length) onChange([...values, ...items])
    setDraft('')
  }

  return (
    <div>
      <span className="text-text-muted text-[12px] uppercase tracking-wider block mb-1.5">{label}</span>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] px-2.5 py-1 text-[12px] text-text-primary"
            >
              {v}
              <button
                type="button"
                className="text-text-muted hover:text-text-primary"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="input"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={commit} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
