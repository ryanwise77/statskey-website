import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { getDesktopBridge, type DesktopUpdateState } from '../lib/desktop'
import { checkForDesktopUpdates } from '../components/DesktopUpdater'
import { IntegrationCenter } from '../components/assistant/IntegrationCenter'
import { RemoteAccessSettings } from '../components/RemoteAccessSettings'
import { ModelProviders } from './ModelProviders'
import { Customize } from './Customize'
import './Settings.css'

const SETTINGS_SECTIONS = [
  { path: 'general', label: 'General', hint: 'Rules, skills, hooks & tools' },
  { path: 'models', label: 'Models & keys', hint: 'Your own provider accounts' },
  {
    path: 'connections',
    label: 'Connections & billing',
    hint: 'Accounts, Stripe & universal tools',
  },
  ...(getDesktopBridge()?.founderMode === true
    ? [
        {
          path: 'remote',
          label: 'Remote access',
          hint: 'iPhone & private machines',
        },
      ]
    : []),
  { path: 'about', label: 'About & updates', hint: 'Version & update checks' },
]

export function Settings() {
  return (
    <div className="settings-page">
      <aside className="settings-page__nav">
        <h1>Settings</h1>
        <nav aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <NavLink
              key={section.path}
              to={`/settings/${section.path}`}
              className={({ isActive }) =>
                `settings-page__nav-item${isActive ? ' active' : ''}`
              }
            >
              <b>{section.label}</b>
              <small>{section.hint}</small>
            </NavLink>
          ))}
        </nav>
      </aside>
      <Routes>
        <Route index element={<Navigate to="/settings/general" replace />} />
        <Route path="general" element={<GeneralSection />} />
        <Route path="models" element={<ModelsSection />} />
        <Route path="connections" element={<ConnectionsSection />} />
        {getDesktopBridge()?.founderMode === true && (
          <Route path="remote" element={<RemoteSection />} />
        )}
        <Route path="about" element={<AboutSection />} />
        <Route path="*" element={<Navigate to="/settings/general" replace />} />
      </Routes>
    </div>
  )
}

function RemoteSection() {
  return (
    <section className="settings-section" aria-label="Remote Access">
      <SectionHeader
        title="Remote access"
        description="Private, owner-only controls shared between your StatsKey iPhone and this Desktop. Credentials and SSH keys remain local."
      />
      <RemoteAccessSettings />
    </section>
  )
}

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <header className="settings-section__header">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  )
}

function GeneralSection() {
  return (
    <section className="settings-section" aria-label="General settings">
      <SectionHeader
        title="General"
        description="Workspace rules, skills, hooks, and connected tools that shape Intelligence. Edits save through the same review boundary as every other workspace change."
      />
      <Customize embedded />
    </section>
  )
}

function ModelsSection() {
  return (
    <section className="settings-section" aria-label="Models and keys">
      <SectionHeader
        title="Models & keys"
        description="Use your own model accounts for direct requests. Credentials are encrypted by this computer’s operating system and never leave it."
      />
      <ModelProviders embedded />
    </section>
  )
}

function ConnectionsSection() {
  return (
    <section className="settings-section" aria-label="Connections">
      <SectionHeader
        title="Connections & billing"
        description="Set up account access once, manage Stripe billing, and connect external tools."
      />
      <IntegrationCenter />
    </section>
  )
}

function AboutSection() {
  const bridge = getDesktopBridge()
  const updates = bridge?.updates
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [busy, setBusy] = useState<'check' | 'download' | 'install' | null>(
    null
  )

  useEffect(() => {
    if (!updates) return
    let active = true
    void updates
      .getState()
      .then((value) => {
        if (active && value) setState(value)
      })
      .catch(() => {})
    const unsubscribe = updates.onState((value) => {
      if (active) setState(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [updates])

  async function perform(
    kind: 'check' | 'download' | 'install',
    action: () => Promise<unknown>
  ) {
    if (busy) return
    setBusy(kind)
    try {
      const result = await action()
      if (isUpdateStateResult(result)) setState(result)
    } catch {
      // The updater reports failures through its own state stream.
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-section" aria-label="About and updates">
      <SectionHeader
        title="About & updates"
        description="Your StatsKey version, and how updates arrive."
      />
      <div className="settings-card">
        <div className="settings-about__identity">
          <span className="site-brand__mark" aria-hidden="true" />
          <div>
            <b>{bridge ? 'StatsKey Desktop' : 'StatsKey'}</b>
            <small>
              {state?.currentVersion
                ? `Version ${state.currentVersion}`
                : bridge
                  ? 'Local desktop app'
                  : 'Web app — always the latest version'}
            </small>
          </div>
        </div>
        <p className="settings-about__status" role="status">
          {aboutStatusLine(state, bridge != null, updates != null)}
        </p>
        <div className="settings-card__actions">
          {updates && state?.status === 'downloaded' ? (
            <button
              className="settings-card__button settings-card__button--primary"
              disabled={busy != null}
              onClick={() => void perform('install', () => updates.install())}
            >
              {busy === 'install' ? 'Restarting…' : 'Restart to install'}
            </button>
          ) : updates && state?.status === 'available' ? (
            <button
              className="settings-card__button settings-card__button--primary"
              disabled={busy != null}
              onClick={() => void perform('download', () => updates.download())}
            >
              {busy === 'download' ? 'Starting…' : 'Download update'}
            </button>
          ) : updates ? (
            <button
              className="settings-card__button settings-card__button--primary"
              disabled={busy != null || state?.status === 'downloading'}
              onClick={() => void perform('check', checkForDesktopUpdates)}
            >
              {busy === 'check' || state?.status === 'checking'
                ? 'Checking…'
                : 'Check for updates'}
            </button>
          ) : null}
          {bridge ? (
            <button
              className="settings-card__button"
              onClick={() =>
                void bridge.openExternal(
                  'https://statskey.ai/downloads/statskey/#updates'
                )
              }
            >
              What’s new
            </button>
          ) : (
            <a
              className="settings-card__button"
              href="https://statskey.ai/downloads/statskey/#updates"
              target="_blank"
              rel="noopener noreferrer"
            >
              What’s new
            </a>
          )}
        </div>
        {bridge && (
          <span className="settings-about__meta">
            Electron {bridge.electronVersion}
          </span>
        )}
      </div>
    </section>
  )
}

function aboutStatusLine(
  state: DesktopUpdateState | null,
  desktop: boolean,
  updater: boolean
): string {
  if (!desktop) {
    return 'The web app updates itself — reload the page and you have the latest StatsKey.'
  }
  if (!updater) {
    return 'This build manages updates itself. New versions install with the packaged app.'
  }
  switch (state?.status) {
    case 'checking':
      return 'Checking for updates. This should only take a moment.'
    case 'current':
      return `You’re up to date${
        state.currentVersion ? ` on version ${state.currentVersion}` : ''
      }.`
    case 'available':
      return `Version ${
        state.latestVersion || 'A newer version'
      } is available. It downloads in the background — restart only when convenient.`
    case 'downloading':
      return `Downloading the update (${Math.round(
        state.percent || 0
      )}%). Keep working — nothing interrupts.`
    case 'downloaded':
      return `Version ${
        state.latestVersion || 'The update'
      } is downloaded and ready to install.`
    case 'error':
      return (
        state.message ||
        'The last update check did not finish. Your current version is unchanged.'
      )
    case 'disabled':
      return 'Automatic updates are turned off in this build.'
    default:
      return 'Updates download in the background and appear here and as a banner when ready.'
  }
}

function isUpdateStateResult(value: unknown): value is DesktopUpdateState {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as DesktopUpdateState).status === 'string' &&
    typeof (value as DesktopUpdateState).currentVersion === 'string'
  )
}
