import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  loadCockpitOnboardingChoice,
  saveCockpitOnboardingChoice,
  shouldShowCockpitOnboarding,
  type CockpitOnboardingChoice,
} from '../lib/cockpit'
import './CockpitOnboardingPrompt.css'

/**
 * One-time, non-blocking introduction to the Cockpit surface. The choice is
 * persisted through the desktop durable-state bridge (with browser storage as
 * the compatibility fallback), so the prompt never re-asks after a choice.
 */
export function CockpitOnboardingPrompt() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isDesktop = 'statsKeyDesktop' in window
  const [choice, setChoice] = useState<CockpitOnboardingChoice | null>(() =>
    isDesktop ? loadCockpitOnboardingChoice() : 'notNow'
  )

  if (
    !shouldShowCockpitOnboarding({
      isDesktop,
      signedIn: user != null,
      choice,
    })
  ) {
    return null
  }

  function choose(next: CockpitOnboardingChoice) {
    saveCockpitOnboardingChoice(next)
    setChoice(next)
    if (next === 'enabled') navigate('/cockpit')
  }

  return (
    <aside className="cockpit-onboarding" aria-label="Cockpit introduction">
      <button
        className="cockpit-onboarding__close"
        aria-label="Not now"
        onClick={() => choose('notNow')}
      >
        ×
      </button>
      <span className="cockpit-onboarding__eyebrow">Optional</span>
      <b>Meet your Cockpit</b>
      <p>
        See and steer your other machines from this app — run tasks, browse
        files, or open a remote session. Optional; you can find it later as
        the Cockpit tab.
      </p>
      <div>
        <button onClick={() => choose('enabled')}>Open Cockpit</button>
        <button onClick={() => choose('notNow')}>Not now</button>
      </div>
    </aside>
  )
}
