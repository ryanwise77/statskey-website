export const DESKTOP_SURFACE_STORAGE_KEY =
  'statskey.desktop.surfaceTabs.v1'

export type DesktopSurfaceId =
  | 'workspace'
  | 'browser'
  | 'simulator'
  | 'cad'
  | 'github'
  | 'plan'
  | 'calendar'
  | 'cockpit'
  | 'fleet'
  | 'jobs'

export interface DesktopOpenSurfaceSummary {
  id: DesktopSurfaceId
  label: string
}

export interface DesktopOpenChatSummary {
  sessionId: string
  label: string
  running?: boolean
}

export type DesktopOpenTabMenuEntry =
  | {
      key: `surface:${DesktopSurfaceId}`
      kind: 'surface'
      id: DesktopSurfaceId
      label: string
      active: boolean
      running: false
    }
  | {
      key: `chat:${string}`
      kind: 'chat'
      id: string
      label: string
      active: boolean
      running: boolean
    }

const DEFAULT_DESKTOP_SURFACES: DesktopSurfaceId[] = ['workspace', 'cockpit']
const ALLOWED_DESKTOP_SURFACES = new Set<DesktopSurfaceId>([
  'workspace',
  'browser',
  'simulator',
  'cad',
  'github',
  'plan',
  'calendar',
  'cockpit',
  'fleet',
  'jobs',
])

// One-time rollout marker: existing users' persisted tab lists predate the
// Cockpit, so the new surface is appended once rather than hidden behind the
// closed-tabs menu. Users who close it afterwards stay closed.
const COCKPIT_ROLLOUT_KEY = 'statskey.desktop.surfaceTabs.cockpitRollout.v1'

export function loadDesktopSurfaceTabs(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage
): DesktopSurfaceId[] {
  const tabs = loadPersistedTabs(storage)
  if (
    !tabs.includes('cockpit') &&
    storage.getItem(COCKPIT_ROLLOUT_KEY) == null
  ) {
    try {
      storage.setItem(COCKPIT_ROLLOUT_KEY, '1')
    } catch {
      // Persistence is best-effort; the tab still appears this session.
    }
    return [...tabs, 'cockpit']
  }
  return tabs
}

function loadPersistedTabs(
  storage: Pick<Storage, 'getItem'>
): DesktopSurfaceId[] {
  const raw = storage.getItem(DESKTOP_SURFACE_STORAGE_KEY)
  if (raw == null) return [...DEFAULT_DESKTOP_SURFACES]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...DEFAULT_DESKTOP_SURFACES]
    return [
      ...new Set(
        parsed.filter(
          (value): value is DesktopSurfaceId =>
            typeof value === 'string' &&
            ALLOWED_DESKTOP_SURFACES.has(value as DesktopSurfaceId)
        )
      ),
    ]
  } catch {
    return [...DEFAULT_DESKTOP_SURFACES]
  }
}

/**
 * Builds the complete switcher list from state, not from tabs that happen to
 * fit in the visible strip. Keeping this pure makes it difficult for a narrow
 * window to silently make an open conversation unreachable.
 */
export function desktopOpenTabMenuEntries({
  surfaces,
  chats,
  activeSurfaceId,
  activeChatSessionId,
}: {
  surfaces: readonly DesktopOpenSurfaceSummary[]
  chats: readonly DesktopOpenChatSummary[]
  activeSurfaceId: DesktopSurfaceId | null
  activeChatSessionId: string | null
}): DesktopOpenTabMenuEntry[] {
  return [
    ...surfaces.map(
      (surface): DesktopOpenTabMenuEntry => ({
        key: `surface:${surface.id}`,
        kind: 'surface',
        id: surface.id,
        label: surface.label,
        active: surface.id === activeSurfaceId,
        running: false,
      })
    ),
    ...chats.map(
      (chat): DesktopOpenTabMenuEntry => ({
        key: `chat:${chat.sessionId}`,
        kind: 'chat',
        id: chat.sessionId,
        label: chat.label,
        active: chat.sessionId === activeChatSessionId,
        running: chat.running === true,
      })
    ),
  ]
}
