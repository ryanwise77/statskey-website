import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useGlucoseStatus } from '../lib/data/useGlucoseStatus'
import { useSubscription } from '../lib/data/useSubscription'
import { formatTokens, useTokenBalance } from '../lib/data/useTokenBalance'
import type { ActivityLevel, AppFocus, BiologicalProfile, UserProfile } from '../lib/profile'

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

export function Profile() {
  const { user, profile, saveProfile, profileLoaded } = useAuth()
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

      {error && <div className="error-banner">{error}</div>}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span className="text-data text-[13px]">Saved</span>}
      </div>

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
              separately for power users who need more managed AI usage without bringing an API key.
            </p>
            <Link to="/tokens" className="link text-[13px] font-medium">
              Buy web token packs
            </Link>
          </>
        )}
      </div>

      <div className="panel space-y-3">
        <span className="card-title">AI Tokens</span>
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
              Dexcom Share login stays in the iOS app keychain. Once connected there, StatsKey backs the readings up to Firebase so Flow and the website can use the same history.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

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
