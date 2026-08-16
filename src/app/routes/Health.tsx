import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useGlucoseStatus } from '../lib/data/useGlucoseStatus'
import { useHealthDailyRange } from '../lib/data/useHealthDaily'
import { useVitalsRange } from '../lib/data/useVitalsRange'

export function Health() {
  const { user, profile } = useAuth()
  const uid = user?.uid
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 30)
  const health = useHealthDailyRange(uid, start, end)
  const vitals = useVitalsRange(uid, start, end)
  const glucose = useGlucoseStatus(uid)
  const latestHealth = [...health.days].sort(
    (a, b) =>
      (b.lastSyncedAt?.getTime() ?? b.date.getTime()) -
      (a.lastSyncedAt?.getTime() ?? a.date.getTime())
  )[0]
  const latestVital = [...vitals.samples].sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  )[0]
  const currentYear = new Date().getFullYear()
  const age = profile?.birthYear ? currentYear - profile.birthYear : null
  const height = profile
    ? profile.usesImperial
      ? `${profile.heightFeet}′${profile.heightInches}″`
      : `${Math.round((profile.heightFeet * 12 + profile.heightInches) * 2.54)} cm`
    : '—'
  const weight = profile
    ? profile.usesImperial
      ? `${Math.round(profile.weightLbs)} lb`
      : `${Math.round(profile.weightLbs / 2.20462)} kg`
    : '—'
  const context = [
    ...(profile?.foodAllergies ?? []),
    ...(profile?.foodIntolerances ?? []),
    ...(profile?.medicalConditions ?? []),
  ]

  return (
    <div className="health-hub">
      <header>
        <div>
          <span>Health & body</span>
          <h1>Your health record</h1>
          <p>Body profile, connected sources, recovery signals, and context.</p>
        </div>
        <div className="health-hub__header-actions">
          <Link className="btn btn-secondary" to="/plan">
            Open Plan
          </Link>
          <Link className="btn btn-primary" to="/insights">
            Open Insights
          </Link>
        </div>
      </header>

      <section className="health-hub__body-card">
        <div className="health-hub__section-heading">
          <div>
            <span>Body & physiology</span>
            <b>{profile?.name || 'Your profile'}</b>
          </div>
          <Link to="/profile">Edit</Link>
        </div>
        <div className="health-hub__stats">
          <HubStat label="Height" value={height} />
          <HubStat label="Weight" value={weight} />
          <HubStat label="Age" value={age == null ? '—' : `${age}`} />
          <HubStat
            label="Activity"
            value={activityLabel(profile?.activityLevel)}
          />
        </div>
      </section>

      <div className="health-hub__grid">
        <section className="health-hub__group">
          <header>
            <span>Connected sources</span>
            <b>Data status</b>
          </header>
          <HubDestination
            to="/insights"
            icon="♥"
            title="Apple Health"
            subtitle={
              latestHealth
                ? `${
                    latestHealth.lastSyncedAt
                      ? `Synced ${relativeTime(latestHealth.lastSyncedAt)}`
                      : 'Sync time unavailable'
                  } · ${health.days.length} days available`
                : 'Open iOS to sync Apple Health'
            }
            tone={latestHealth ? 'good' : 'muted'}
          />
          <HubDestination
            to="/insights"
            icon="∿"
            title="Vitals"
            subtitle={
              latestVital
                ? `${vitals.samples.length} synced samples · latest ${relativeTime(latestVital.date)}`
                : 'No synced vitals in the last 30 days'
            }
            tone={latestVital ? 'good' : 'muted'}
          />
          <HubDestination
            to="/insights"
            icon="◉"
            title="Glucose monitoring"
            subtitle={
              glucose.latest
                ? `${glucose.latest.source} · ${Math.round(glucose.latest.value)} mg/dL`
                : 'Connect Dexcom, Libre, Nightscout, or record manually'
            }
            tone={glucose.latest ? 'good' : 'muted'}
          />
        </section>

        <section className="health-hub__group">
          <header>
            <span>Explore</span>
            <b>Health modules</b>
          </header>
          <HubDestination
            to="/insights"
            icon="✦"
            title="Recovery & readiness"
            subtitle="Sleep, HRV, resting HR, load, and fueling"
            tone="blue"
          />
          <HubDestination
            to="/insights"
            icon="↗"
            title="Activity & capacity"
            subtitle="VO₂ max, cardio recovery, movement, and training load"
            tone="teal"
          />
          <HubDestination
            to="/insights"
            icon="◇"
            title="Wellness & GI"
            subtitle="Mood, stress, energy, symptoms, and digestion"
            tone="violet"
          />
          <HubDestination
            to="/record"
            icon="+"
            title="Record health data"
            subtitle="Meals, wellness, weight, hydration, and glucose"
            tone="blue"
          />
        </section>
      </div>

      <section className="health-hub__context">
        <div className="health-hub__section-heading">
          <div>
            <span>Personalization</span>
            <b>What StatsKey keeps in mind</b>
          </div>
          <Link to="/profile">Manage</Link>
        </div>
        {context.length === 0 && !profile?.healthNotes ? (
          <p>No allergies, intolerances, conditions, or health notes added.</p>
        ) : (
          <>
            <div>
              {context.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            {profile?.healthNotes && <p>{profile.healthNotes}</p>}
          </>
        )}
      </section>
    </div>
  )
}

function HubStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function HubDestination({
  to,
  icon,
  title,
  subtitle,
  tone,
}: {
  to: string
  icon: string
  title: string
  subtitle: string
  tone: string
}) {
  return (
    <Link className="health-hub__destination" to={to} data-tone={tone}>
      <i>{icon}</i>
      <span>
        <b>{title}</b>
        <small>{subtitle}</small>
      </span>
      <strong>›</strong>
    </Link>
  )
}

function activityLabel(value?: string): string {
  return {
    sedentary: 'Sedentary',
    lightlyActive: 'Lightly active',
    moderatelyActive: 'Moderately active',
    veryActive: 'Very active',
    extremelyActive: 'Extremely active',
  }[value ?? ''] ?? '—'
}

function relativeTime(date: Date): string {
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000)
  if (seconds < 120) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}
