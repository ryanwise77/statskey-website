import { describe, expect, it } from 'vitest'
import {
  DESKTOP_CHAT_TABS_KEY,
  desktopLaunchRoute,
  desktopNeutralChatRoute,
  loadDesktopChatTabs,
  safeOldDesktopChatTabIds,
  safeOtherDesktopChatTabIds,
  shouldOpenRequestedDesktopChatTab,
  shouldPromoteDesktopDraftSession,
  withClosedDesktopChatTab,
  withoutClosedDesktopChatTab,
} from './desktopChatTabs'

describe('desktop chat tabs', () => {
  it('loads only valid bounded tab records', () => {
    const storage = {
      getItem(key: string) {
        if (key !== DESKTOP_CHAT_TABS_KEY) return null
        return JSON.stringify([
          { sessionId: 'personal-chat', scope: 'personal' },
          { sessionId: 'work-chat', scope: 'work' },
          { sessionId: 42, scope: 'work' },
        ])
      },
    }

    expect(loadDesktopChatTabs(storage)).toEqual([
      { sessionId: 'personal-chat', scope: 'personal' },
      { sessionId: 'work-chat', scope: 'work' },
    ])
  })

  it('does not resurrect explicitly closed tabs during browser history', () => {
    expect(
      shouldOpenRequestedDesktopChatTab('closed-chat', 'POP', ['closed-chat'])
    ).toBe(false)
    expect(
      shouldOpenRequestedDesktopChatTab('closed-chat', 'PUSH', ['closed-chat'])
    ).toBe(true)
    expect(
      shouldOpenRequestedDesktopChatTab('new-chat', 'POP', ['closed-chat'])
    ).toBe(true)
  })

  it('does not resurrect a tab while its close navigation is still pending', () => {
    expect(
      shouldOpenRequestedDesktopChatTab(
        'closing-chat',
        'PUSH',
        ['closing-chat'],
        ['closing-chat']
      )
    ).toBe(false)
    expect(
      shouldOpenRequestedDesktopChatTab(
        'closing-chat',
        'REPLACE',
        ['closing-chat'],
        ['closing-chat']
      )
    ).toBe(false)
  })

  it('bounds and clears explicit closures when the user reopens a chat', () => {
    const closed = Array.from({ length: 105 }, (_, index) => `chat-${index}`)
      .reduce(withClosedDesktopChatTab, [])
    expect(closed).toHaveLength(100)
    expect(closed[0]).toBe('chat-5')
    expect(withoutClosedDesktopChatTab(closed, 'chat-50')).not.toContain(
      'chat-50'
    )
    expect(withoutClosedDesktopChatTab(closed, 'not-closed')).toBe(closed)
  })

  it('keeps an authenticated relaunch with no open chats in a neutral route', () => {
    expect(desktopLaunchRoute([], [])).toBe('/flow')
    expect(
      desktopLaunchRoute(
        [{ sessionId: 'closed-chat', scope: 'personal' }],
        ['closed-chat']
      )
    ).toBe('/flow')
  })

  it('returns a session-free route after the last tab or surface closes', () => {
    const personalRoute = desktopNeutralChatRoute('personal')
    const workRoute = desktopNeutralChatRoute('work')

    expect(personalRoute).toBe('/flow?scope=personal')
    expect(workRoute).toBe('/flow?scope=work')
    expect(new URLSearchParams(personalRoute.split('?')[1]).has('session')).toBe(
      false
    )
    expect(new URLSearchParams(workRoute.split('?')[1]).has('session')).toBe(
      false
    )
  })

  it('promotes only an ephemeral desktop draft with a submitted user message', () => {
    const draft = {
      isDesktop: true,
      embedded: false,
      resumeId: undefined,
    }
    expect(
      shouldPromoteDesktopDraftSession({ ...draft, hasUserMessage: false })
    ).toBe(false)
    expect(
      shouldPromoteDesktopDraftSession({ ...draft, hasUserMessage: true })
    ).toBe(true)
    expect(
      shouldPromoteDesktopDraftSession({
        ...draft,
        resumeId: 'EXPLICIT-CHAT',
        hasUserMessage: true,
      })
    ).toBe(false)
    expect(
      shouldPromoteDesktopDraftSession({
        ...draft,
        embedded: true,
        hasUserMessage: true,
      })
    ).toBe(false)
  })

  it('selects only saved old inactive tabs and preserves drafts, active tabs, and running work', () => {
    const day = 24 * 60 * 60 * 1_000
    const now = Date.UTC(2026, 7, 12)
    const tabs = ['old', 'active', 'running', 'recent', 'draft'].map(
      (sessionId) => ({ sessionId, scope: 'work' as const })
    )

    expect(
      safeOldDesktopChatTabIds({
        tabs,
        sessions: [
          { id: 'old', updatedAt: new Date(now - 8 * day) },
          { id: 'active', updatedAt: new Date(now - 9 * day) },
          { id: 'running', updatedAt: new Date(now - 10 * day) },
          { id: 'recent', updatedAt: new Date(now - day) },
        ],
        activeSessionId: 'active',
        runningSessionIds: ['running'],
        now,
      })
    ).toEqual(['old'])
  })

  it('selects all other saved idle task tabs without closing the active task, running work, or drafts', () => {
    const tabs = ['active', 'idle-one', 'idle-two', 'running', 'draft'].map(
      (sessionId) => ({ sessionId, scope: 'work' as const })
    )
    expect(
      safeOtherDesktopChatTabIds({
        tabs,
        savedSessionIds: ['active', 'idle-one', 'idle-two', 'running'],
        activeSessionId: 'active',
        runningSessionIds: ['running'],
      })
    ).toEqual(['idle-one', 'idle-two'])
    expect(
      safeOtherDesktopChatTabIds({
        tabs,
        savedSessionIds: ['active', 'idle-one', 'idle-two', 'running'],
        activeSessionId: null,
        runningSessionIds: ['running'],
      })
    ).toEqual([])
  })
})
