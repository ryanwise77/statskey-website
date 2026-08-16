import { useEffect, useState } from 'react'
import {
  LOCAL_CHAT_SESSIONS_EVENT,
  listLocalChatSessions,
  loadLocalChatSession,
} from '../agentLocalState'
import type {
  ChatSession,
  ChatSessionsState,
  ChatSessionState,
} from './useChatSessions'

export function useLocalChatSession(
  sessionId: string | undefined
): ChatSessionState {
  const [state, setState] = useState<ChatSessionState>({
    session: null,
    loading: true,
    error: null,
    notFound: false,
  })

  useEffect(() => {
    let active = true
    if (sessionId) {
      setState({
        session: null,
        loading: true,
        error: null,
        notFound: false,
      })
    }
    async function refresh() {
      if (!sessionId) {
        if (active) {
          setState({
            session: null,
            loading: false,
            error: null,
            notFound: false,
          })
        }
        return
      }
      try {
        const session = await loadLocalChatSession(sessionId)
        if (active) {
          setState({
            session,
            loading: false,
            error: null,
            notFound: session == null,
          })
        }
      } catch (error) {
        if (active) {
          setState({
            session: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            notFound: false,
          })
        }
      }
    }
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener(LOCAL_CHAT_SESSIONS_EVENT, onChange)
    return () => {
      active = false
      window.removeEventListener(LOCAL_CHAT_SESSIONS_EVENT, onChange)
    }
  }, [sessionId])

  return state
}

export function useRecentLocalChatSessions(maximum = 100): ChatSessionsState {
  const [state, setState] = useState<ChatSessionsState>({
    sessions: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const sessions = await listLocalChatSessions(maximum)
        if (active) setState({ sessions, loading: false, error: null })
      } catch (error) {
        if (active) {
          setState({
            sessions: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener(LOCAL_CHAT_SESSIONS_EVENT, onChange)
    return () => {
      active = false
      window.removeEventListener(LOCAL_CHAT_SESSIONS_EVENT, onChange)
    }
  }, [maximum])

  return state
}

export function mergeChatSessions(
  local: ChatSession[],
  cloud: ChatSession[],
  maximum = 100
): ChatSession[] {
  const byId = new Map<string, ChatSession>()
  for (const session of [...local, ...cloud]) {
    const current = byId.get(session.id)
    if (!current || session.updatedAt > current.updatedAt) {
      byId.set(session.id, session)
    }
  }
  return [...byId.values()]
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, maximum)
}
