import { describe, expect, it } from 'vitest'
import {
  DESKTOP_SURFACE_STORAGE_KEY,
  desktopOpenTabMenuEntries,
  loadDesktopSurfaceTabs,
} from './desktopSurfaceTabs'

describe('desktop surface tabs', () => {
  it('keeps an explicitly empty tab strip empty', () => {
    const storage = {
      getItem(key: string) {
        return key === DESKTOP_SURFACE_STORAGE_KEY ? '[]' : null
      },
    }
    expect(loadDesktopSurfaceTabs(storage)).toEqual([])
  })

  it('uses Workspace only when no valid preference has ever been saved', () => {
    expect(loadDesktopSurfaceTabs({ getItem: () => null })).toEqual([
      'workspace',
    ])
    expect(loadDesktopSurfaceTabs({ getItem: () => 'not-json' })).toEqual([
      'workspace',
    ])
  })

  it('deduplicates and rejects unknown surfaces', () => {
    const storage = {
      getItem: () =>
        JSON.stringify([
          'browser',
          'simulator',
          'github',
          'fleet',
          'jobs',
          'unknown',
          'browser',
          'plan',
        ]),
    }
    expect(loadDesktopSurfaceTabs(storage)).toEqual([
      'browser',
      'simulator',
      'github',
      'fleet',
      'jobs',
      'plan',
    ])
  })

  it('exposes Browser as an ordinary active surface in the tab switcher', () => {
    const entries = desktopOpenTabMenuEntries({
      surfaces: [
        { id: 'workspace', label: 'Workspace' },
        { id: 'browser', label: 'Browser' },
      ],
      chats: [],
      activeSurfaceId: 'browser',
      activeChatSessionId: null,
    })

    expect(entries).toEqual([
      {
        key: 'surface:workspace',
        kind: 'surface',
        id: 'workspace',
        label: 'Workspace',
        active: false,
        running: false,
      },
      {
        key: 'surface:browser',
        kind: 'surface',
        id: 'browser',
        label: 'Browser',
        active: true,
        running: false,
      },
    ])
  })

  it('exposes every open surface and conversation even when the strip is narrow', () => {
    const entries = desktopOpenTabMenuEntries({
      surfaces: [
        { id: 'workspace', label: 'Workspace' },
        { id: 'plan', label: 'Plan' },
      ],
      chats: [
        { sessionId: 'first-chat', label: 'First change' },
        {
          sessionId: 'running-chat',
          label: 'Finish the activity fix',
          running: true,
        },
        { sessionId: 'last-chat', label: 'Release notes' },
      ],
      activeSurfaceId: null,
      activeChatSessionId: 'running-chat',
    })

    expect(entries.map((entry) => entry.key)).toEqual([
      'surface:workspace',
      'surface:plan',
      'chat:first-chat',
      'chat:running-chat',
      'chat:last-chat',
    ])
    expect(entries.find((entry) => entry.key === 'chat:running-chat')).toMatchObject(
      { active: true, running: true }
    )
    expect(entries.filter((entry) => entry.active)).toHaveLength(1)
  })
})
