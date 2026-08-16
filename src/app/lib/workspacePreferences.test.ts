import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceProjectBinding } from './workspaceContext'
import {
  getWorkspaceContextPreferences,
  workspacePreferenceKey,
} from './workspacePreferences'

const STORAGE_KEY = 'statskey.desktop.workspace-preferences.v1'

function binding(
  id: string,
  label: string,
  roots: string[]
): WorkspaceProjectBinding {
  return { id, label, roots }
}

describe('workspace personal-context preferences', () => {
  let values: Map<string, string>

  beforeEach(() => {
    values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('keeps personal health off for every workspace by default', () => {
    expect(
      getWorkspaceContextPreferences(
        binding('work-a', 'Unrelated work', ['/Projects/Work'])
      )
    ).toEqual({ includePersonalHealth: false })
    expect(getWorkspaceContextPreferences(null)).toEqual({
      includePersonalHealth: false,
    })
  })

  it('does not leak an opt-in from one workspace to another', () => {
    const healthProject = binding('health', 'Personal Training', [
      '/Projects/Training',
    ])
    const workProject = binding('work', 'Client work', ['/Projects/Client'])
    values.set(
      STORAGE_KEY,
      JSON.stringify({
        [workspacePreferenceKey(healthProject)!]: {
          includePersonalHealth: true,
        },
      })
    )

    expect(getWorkspaceContextPreferences(healthProject)).toEqual({
      includePersonalHealth: true,
    })
    expect(getWorkspaceContextPreferences(workProject)).toEqual({
      includePersonalHealth: false,
    })
  })

  it('fails closed when stored preferences are malformed', () => {
    values.set(STORAGE_KEY, '{not valid json')
    expect(
      getWorkspaceContextPreferences(
        binding('work-a', 'Unrelated work', ['/Projects/Work'])
      )
    ).toEqual({ includePersonalHealth: false })
  })
})
