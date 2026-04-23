import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
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
  const { profile, saveProfile, profileLoaded } = useAuth()
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
    </div>
  )
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
