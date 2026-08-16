import type { WorkspaceProjectBinding } from './workspaceContext'

export interface WorkspaceContextPreferences {
  includePersonalHealth: boolean
}

const STORAGE_KEY = 'statskey.desktop.workspace-preferences.v1'
export const WORKSPACE_PREFERENCES_EVENT = 'statskey:workspace-preferences'

export function workspacePreferenceKey(
  binding: WorkspaceProjectBinding | null
): string | null {
  if (!binding || binding.roots.length === 0) return null
  return binding.id || [...binding.roots].sort().join('\n')
}

export function getWorkspaceContextPreferences(
  binding: WorkspaceProjectBinding | null
): WorkspaceContextPreferences {
  const key = workspacePreferenceKey(binding)
  if (!key) return { includePersonalHealth: false }
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >
    const value = all[key]
    return {
      includePersonalHealth:
        value != null &&
        typeof value === 'object' &&
        (value as { includePersonalHealth?: unknown }).includePersonalHealth ===
          true,
    }
  } catch {
    return { includePersonalHealth: false }
  }
}

export function saveWorkspaceContextPreferences(
  binding: WorkspaceProjectBinding,
  preferences: WorkspaceContextPreferences
) {
  const key = workspacePreferenceKey(binding)
  if (!key) return
  let all: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      all = parsed as Record<string, unknown>
    }
  } catch {
    // Replace malformed local preferences with a clean map.
  }
  all[key] = {
    includePersonalHealth: preferences.includePersonalHealth === true,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_PREFERENCES_EVENT, {
      detail: { key, preferences },
    })
  )
}
