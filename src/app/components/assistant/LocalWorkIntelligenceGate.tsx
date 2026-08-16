import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

const LOCAL_WORK_CONSENT_KEY = 'statskey.local-work-intelligence-consent.v1'

export function LocalWorkIntelligenceGate({
  children,
}: {
  children: ReactNode
}) {
  const [granted, setGranted] = useState(
    () => localStorage.getItem(LOCAL_WORK_CONSENT_KEY) === 'granted'
  )

  if (granted) return <>{children}</>

  return (
    <section className="local-work-consent">
      <span className="intel-mark" aria-hidden="true">✦</span>
      <div>
        <span>Local Intelligence</span>
        <h2>Connect a model on your terms</h2>
        <p>
          Your prompts, attachments, and relevant workspace or terminal
          results are sent directly to the model provider you choose. StatsKey
          health, calendar, inbox, and account data are excluded from this
          workspace.
        </p>
      </div>
      <ul>
        <li>API keys stay in the operating system’s encrypted vault.</li>
        <li>Conversations are stored locally; sign-in is optional.</li>
        <li>File, terminal, Git, browser, and app actions keep their review controls.</li>
      </ul>
      <div className="local-work-consent__actions">
        <Link className="btn btn-secondary" to="/models">
          Review model setup
        </Link>
        <button
          className="btn btn-intel"
          onClick={() => {
            localStorage.setItem(LOCAL_WORK_CONSENT_KEY, 'granted')
            setGranted(true)
          }}
        >
          Enable local Intelligence
        </button>
      </div>
    </section>
  )
}
