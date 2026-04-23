import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Dashboard() {
  const { profile, profileLoaded } = useAuth()

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">
          {profile?.name ? `Welcome back, ${profile.name.split(' ')[0]}` : 'Welcome'}
        </h1>
        <p className="text-text-secondary text-[15px] mt-1">
          Your StatsKey account is now accessible on the web.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel">
          <h2 className="font-display text-[18px] font-semibold mb-2">Account</h2>
          {!profileLoaded && <p className="text-text-secondary text-sm">Loading profile…</p>}
          {profileLoaded && profile && (
            <dl className="text-[13px] space-y-1.5">
              <Row label="Email" value={profile.email || '—'} />
              <Row label="Height" value={`${profile.heightFeet}' ${profile.heightInches}"`} />
              <Row label="Weight" value={`${profile.weightLbs.toFixed(0)} lb`} />
              <Row label="Onboarding" value={profile.onboardingComplete ? 'Complete' : 'Incomplete'} />
              <Row label="Pro" value={profile.isPro ? 'Yes' : 'No'} />
            </dl>
          )}
          <div className="mt-4">
            <Link to="/profile" className="link text-[13px]">Edit profile →</Link>
          </div>
        </div>

        <div className="panel">
          <h2 className="font-display text-[18px] font-semibold mb-2">Coming soon</h2>
          <p className="text-text-secondary text-[13px] leading-relaxed">
            Today's nutrition, workouts, glucose, wellness and the full Flow chat will appear here
            in upcoming releases. Your iOS data is already in sync — this page will start reading it next.
          </p>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-primary">{value}</dd>
    </div>
  )
}
