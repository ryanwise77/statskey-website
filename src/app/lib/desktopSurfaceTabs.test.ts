import { describe, expect, it } from 'vitest'
import {
  DESKTOP_SURFACE_STORAGE_KEY,
  desktopOpenTabMenuEntries,
  loadDesktopSurfaceTabs,
} from './desktopSurfaceTabs'

describe('desktop surface tabs', () => {
  it('keeps an explicitly empty tab strip empty once the rollout has run', () => {
    const storage = {
      getItem(key: string) {
        if (key === DESKTOP_SURFACE_STORAGE_KEY) return '[]'
        return '1' // rollout marker already written
      },
      setItem() {},
    }
    expect(loadDesktopSurfaceTabs(storage)).toEqual([])
  })

  it('lands on Workspace and Cockpit when no preference has ever been saved', () => {
    const fresh = {
      getItem: () => null,
      setItem() {},
    }
    expect(loadDesktopSurfaceTabs(fresh)).toEqual(['workspace', 'cockpit'])
    expect(loadDesktopSurfaceTabs({ getItem: () => 'not-json', setItem() {} }))
      .toEqual(['workspace', 'cockpit'])
  })

  it('appends Cockpit once for pre-Cockpit tab lists, then respects closure', () => {
    const written: Record<string, string> = {}
    const storage = {
      getItem(key: string) {
        if (key === DESKTOP_SURFACE_STORAGE_KEY) return '["workspace","plan"]'
        return written[key] ?? null
      },
      setItem(key: string, value: string) {
        written[key] = value
      },
    }
    expect(loadDesktopSurfaceTabs(storage)).toEqual([
      'workspace',
      'plan',
      'cockpit',
    ])
    // A later load (rollout marker written) does not re-add after closure.
    const closed = {
      getItem(key: string) {
        if (key === DESKTOP_SURFACE_STORAGE_KEY) return '["workspace","plan"]'
        return written[key] ?? null
      },
      setItem() {},
    }
    expect(loadDesktopSurfaceTabs(closed)).toEqual(['workspace', 'plan'])
  })

  it('deduplicates and rejects unknown surfaces', () => {
    const storage = {
      getItem: () =>
        JSON.stringify([
          'browser',
          'simulator',
          'github',
          'cockpit',
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
      'cockpit',
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
