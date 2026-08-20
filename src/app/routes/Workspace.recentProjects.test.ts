import { describe, expect, it, vi } from 'vitest'

// Stub browser-only editor and terminal modules (monaco, xterm) that the
// Workspace route imports but this pure-helper test never renders.
vi.mock('../components/workspace/MonacoWorkspaceEditor', () => ({
  MonacoWorkspaceEditor: () => null,
}))
vi.mock('../components/workspace/GitHubCloudWorkspace', () => ({
  GitHubCloudWorkspace: () => null,
}))
vi.mock('../components/workspace/WorkspaceTerminal', () => ({
  WorkspaceTerminal: () => null,
}))

import { formatRelativeTime, sortRecentProjects } from './Workspace'
import type { DesktopRecentProject } from '../lib/desktop'

function project(
  overrides: Partial<DesktopRecentProject> & { id: string }
): DesktopRecentProject {
  return {
    name: overrides.id,
    roots: [],
    rootCount: 1,
    availableRootCount: 1,
    lastOpenedAt: '2026-08-18T12:00:00.000Z',
    saved: false,
    ...overrides,
  }
}

describe('sortRecentProjects', () => {
  it('sorts saved projects first, then most recently opened', () => {
    const sorted = sortRecentProjects([
      project({ id: 'old-unsaved', lastOpenedAt: '2026-08-01T00:00:00Z' }),
      project({ id: 'new-unsaved', lastOpenedAt: '2026-08-18T00:00:00Z' }),
      project({
        id: 'old-saved',
        saved: true,
        lastOpenedAt: '2026-07-01T00:00:00Z',
      }),
      project({
        id: 'new-saved',
        saved: true,
        lastOpenedAt: '2026-08-10T00:00:00Z',
      }),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual([
      'new-saved',
      'old-saved',
      'new-unsaved',
      'old-unsaved',
    ])
  })

  it('treats unparseable timestamps as oldest and does not mutate input', () => {
    const input = [
      project({ id: 'broken', lastOpenedAt: 'not-a-date' }),
      project({ id: 'recent', lastOpenedAt: '2026-08-18T00:00:00Z' }),
    ]
    const sorted = sortRecentProjects(input)
    expect(sorted.map((entry) => entry.id)).toEqual(['recent', 'broken'])
    expect(input.map((entry) => entry.id)).toEqual(['broken', 'recent'])
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-08-18T12:00:00.000Z')

  it('formats each magnitude compactly', () => {
    expect(formatRelativeTime('2026-08-18T11:59:30Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-08-18T11:45:00Z', now)).toBe('15m ago')
    expect(formatRelativeTime('2026-08-18T07:00:00Z', now)).toBe('5h ago')
    expect(formatRelativeTime('2026-08-16T12:00:00Z', now)).toBe('2d ago')
    expect(formatRelativeTime('2026-08-04T12:00:00Z', now)).toBe('2w ago')
    expect(formatRelativeTime('2026-05-18T12:00:00Z', now)).toBe('3mo ago')
    expect(formatRelativeTime('2024-08-01T12:00:00Z', now)).toBe('2y ago')
  })

  it('returns an empty string for unparseable input', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('')
  })

  it('never reports the future as ago', () => {
    expect(formatRelativeTime('2026-08-19T12:00:00Z', now)).toBe('just now')
  })
})
