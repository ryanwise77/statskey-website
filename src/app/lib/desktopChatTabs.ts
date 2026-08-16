export const DESKTOP_CHAT_TABS_KEY = 'statskey.desktop.chatTabs.v2'
export const DESKTOP_CLOSED_CHAT_TABS_KEY =
  'statskey.desktop.closedChatTabs.v1'

export const MAX_DESKTOP_CHAT_TABS = 12
export const DESKTOP_OLD_CHAT_TAB_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_CLOSED_CHAT_TABS = 100

export interface DesktopChatTab {
  sessionId: string
  scope: 'work' | 'personal'
}

interface DesktopDraftPromotionInput {
  isDesktop: boolean
  embedded: boolean
  resumeId?: string
  hasUserMessage: boolean
}

type NavigationAction = 'POP' | 'PUSH' | 'REPLACE'

export function loadDesktopChatTabs(
  storage: Pick<Storage, 'getItem'> = localStorage
): DesktopChatTab[] {
  try {
    const parsed = JSON.parse(
      storage.getItem(DESKTOP_CHAT_TABS_KEY) || '[]'
    ) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (value): value is DesktopChatTab =>
          value != null &&
          typeof value === 'object' &&
          typeof (value as DesktopChatTab).sessionId === 'string' &&
          (value as DesktopChatTab).sessionId.length <= 160
      )
      .slice(0, MAX_DESKTOP_CHAT_TABS)
      .map((tab) => ({
        sessionId: tab.sessionId,
        scope: tab.scope === 'work' ? 'work' : 'personal',
      }))
  } catch {
    return []
  }
}

export function loadClosedDesktopChatTabIds(
  storage: Pick<Storage, 'getItem'> = localStorage
): string[] {
  try {
    const parsed = JSON.parse(
      storage.getItem(DESKTOP_CLOSED_CHAT_TABS_KEY) || '[]'
    ) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0 && value.length <= 160
      )
      .slice(-MAX_CLOSED_CHAT_TABS)
  } catch {
    return []
  }
}

export function withClosedDesktopChatTab(
  current: string[],
  sessionId: string
): string[] {
  return [...current.filter((value) => value !== sessionId), sessionId].slice(
    -MAX_CLOSED_CHAT_TABS
  )
}

export function withoutClosedDesktopChatTab(
  current: string[],
  sessionId: string
): string[] {
  if (!current.includes(sessionId)) return current
  return current.filter((value) => value !== sessionId)
}

export function shouldOpenRequestedDesktopChatTab(
  sessionId: string,
  navigationAction: NavigationAction,
  closedSessionIds: readonly string[],
  pendingCloseSessionIds: readonly string[] = []
): boolean {
  if (pendingCloseSessionIds.includes(sessionId)) return false
  return !(
    navigationAction === 'POP' && closedSessionIds.includes(sessionId)
  )
}

export function desktopChatRoute(tab: DesktopChatTab): string {
  return `/flow?session=${encodeURIComponent(tab.sessionId)}&scope=${tab.scope}`
}

export function desktopNeutralChatRoute(
  scope?: DesktopChatTab['scope']
): string {
  return scope ? `/flow?scope=${scope}` : '/flow'
}

export function desktopLaunchRoute(
  tabs: readonly DesktopChatTab[],
  closedSessionIds: readonly string[]
): string {
  const closed = new Set(closedSessionIds)
  const lastOpenChat = tabs.filter((tab) => !closed.has(tab.sessionId)).at(-1)
  return lastOpenChat ? desktopChatRoute(lastOpenChat) : desktopNeutralChatRoute()
}

export function shouldPromoteDesktopDraftSession({
  isDesktop,
  embedded,
  resumeId,
  hasUserMessage,
}: DesktopDraftPromotionInput): boolean {
  return isDesktop && !embedded && !resumeId && hasUserMessage
}

/**
 * Returns only recoverable, inactive conversation tabs that are safe to close
 * from the strip. Drafts without a saved session and active/running work are
 * deliberately retained; closing a tab never deletes its conversation.
 */
export function safeOldDesktopChatTabIds({
  tabs,
  sessions,
  activeSessionId,
  runningSessionIds,
  now = Date.now(),
  minimumAgeMs = DESKTOP_OLD_CHAT_TAB_AGE_MS,
}: {
  tabs: readonly DesktopChatTab[]
  sessions: readonly { id: string; updatedAt: Date | number }[]
  activeSessionId: string | null
  runningSessionIds: readonly string[]
  now?: number
  minimumAgeMs?: number
}): string[] {
  const running = new Set(runningSessionIds)
  const updatedAtById = new Map(
    sessions.map((session) => [
      session.id,
      session.updatedAt instanceof Date
        ? session.updatedAt.getTime()
        : session.updatedAt,
    ])
  )
  return tabs.flatMap((tab) => {
    const updatedAt = updatedAtById.get(tab.sessionId)
    if (
      tab.sessionId === activeSessionId ||
      running.has(tab.sessionId) ||
      typeof updatedAt !== 'number' ||
      !Number.isFinite(updatedAt) ||
      now - updatedAt < Math.max(0, minimumAgeMs)
    ) {
      return []
    }
    return [tab.sessionId]
  })
}

export function safeOtherDesktopChatTabIds({
  tabs,
  savedSessionIds,
  activeSessionId,
  runningSessionIds,
}: {
  tabs: readonly DesktopChatTab[]
  savedSessionIds: readonly string[]
  activeSessionId: string | null
  runningSessionIds: readonly string[]
}): string[] {
  if (!activeSessionId) return []
  const saved = new Set(savedSessionIds)
  const running = new Set(runningSessionIds)
  return tabs.flatMap((tab) =>
    tab.sessionId !== activeSessionId &&
    saved.has(tab.sessionId) &&
    !running.has(tab.sessionId)
      ? [tab.sessionId]
      : []
  )
}
