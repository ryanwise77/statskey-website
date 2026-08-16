import { describe, expect, it } from 'vitest'
import {
  durableWorkspaceEditorSession,
  resolveWorkspaceEditorSession,
  type StoredWorkspaceEditorSession,
} from './workspaceEditorSession'

const clean = {
  path: '/project/clean.ts',
  name: 'clean.ts',
  draft: null,
}
const dirty = {
  path: '/project/dirty.ts',
  name: 'dirty.ts',
  draft: 'unsaved change',
}

describe('workspace editor session restoration', () => {
  it('keeps an explicitly empty renderer session empty', () => {
    const resolved = resolveWorkspaceEditorSession(
      JSON.stringify({
        selectedPath: null,
        secondaryPath: null,
        focusedPath: null,
        documents: [],
      }),
      JSON.stringify({ documents: [clean, dirty] })
    )

    expect(resolved).toEqual({
      source: 'transient',
      session: {
        selectedPath: null,
        secondaryPath: null,
        focusedPath: null,
        documents: [],
      },
    })
  })

  it('uses the exact renderer-session tab list instead of stale durable tabs', () => {
    const resolved = resolveWorkspaceEditorSession(
      JSON.stringify({
        selectedPath: dirty.path,
        documents: [dirty],
      }),
      JSON.stringify({
        selectedPath: clean.path,
        documents: [clean, dirty],
      })
    )

    expect(resolved?.source).toBe('transient')
    expect(resolved?.session.documents).toEqual([dirty])
  })

  it('recovers only unsaved drafts after a full relaunch', () => {
    const resolved = resolveWorkspaceEditorSession(
      null,
      JSON.stringify({
        selectedPath: clean.path,
        secondaryPath: clean.path,
        focusedPath: dirty.path,
        documents: [clean, dirty],
      })
    )

    expect(resolved).toEqual({
      source: 'draft-recovery',
      session: {
        selectedPath: null,
        secondaryPath: null,
        focusedPath: dirty.path,
        documents: [dirty],
      },
    })
  })

  it('treats stale clean tabs as an intentionally empty relaunch', () => {
    expect(
      resolveWorkspaceEditorSession(
        null,
        JSON.stringify({ selectedPath: clean.path, documents: [clean] })
      )
    ).toEqual({
      source: 'durable-empty',
      session: {
        selectedPath: null,
        secondaryPath: null,
        focusedPath: null,
        documents: [],
      },
    })
  })

  it('writes only recoverable dirty drafts to durable storage', () => {
    const session: StoredWorkspaceEditorSession = {
      selectedPath: clean.path,
      secondaryPath: dirty.path,
      focusedPath: clean.path,
      documents: [clean, dirty],
    }

    expect(durableWorkspaceEditorSession(session)).toEqual({
      selectedPath: null,
      secondaryPath: dirty.path,
      focusedPath: null,
      documents: [dirty],
    })
  })
})
