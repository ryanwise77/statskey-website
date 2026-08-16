export type AutomaticEmailContextMode = 'off' | 'automatic'

export interface AssistantContextPreferences {
  automaticEmailContext: AutomaticEmailContextMode
  emailDigestMessages: 3 | 5 | 10
}

const STORAGE_KEY = 'statskey.assistant.context-preferences.v1'
export const ASSISTANT_CONTEXT_PREFERENCES_EVENT =
  'statskey:assistant-context-preferences'

const DEFAULTS: AssistantContextPreferences = {
  automaticEmailContext: 'off',
  emailDigestMessages: 5,
}

export function getAssistantContextPreferences(): AssistantContextPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      automaticEmailContext?: unknown
      emailDigestMessages?: unknown
    }
    return {
      automaticEmailContext:
        parsed.automaticEmailContext === 'automatic' ? 'automatic' : 'off',
      emailDigestMessages:
        parsed.emailDigestMessages === 3 || parsed.emailDigestMessages === 10
          ? parsed.emailDigestMessages
          : 5,
    }
  } catch {
    return DEFAULTS
  }
}

export function saveAssistantContextPreferences(
  preferences: AssistantContextPreferences
) {
  const sanitized: AssistantContextPreferences = {
    automaticEmailContext:
      preferences.automaticEmailContext === 'automatic' ? 'automatic' : 'off',
    emailDigestMessages:
      preferences.emailDigestMessages === 3 ||
      preferences.emailDigestMessages === 10
        ? preferences.emailDigestMessages
        : 5,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_CONTEXT_PREFERENCES_EVENT, {
      detail: sanitized,
    })
  )
}
