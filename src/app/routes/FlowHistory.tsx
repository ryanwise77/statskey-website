import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  deleteChatSession,
  saveChatSession,
  useRecentChatSessions,
  type ChatSession,
} from '../lib/data/useChatSessions'
import {
  mergeChatSessions,
  useRecentLocalChatSessions,
} from '../lib/data/useLocalChatSessions'
import {
  archiveLocalChatSession,
  clearAgentLocalState,
  deleteLocalChatSession,
} from '../lib/agentLocalState'
import { EmptyState } from '../components/EmptyState'
import { confirmDialog, showToast } from '../lib/ui/dialogs'

export function FlowHistory() {
  const { user } = useAuth()
  const cloud = useRecentChatSessions(user?.uid, 100)
  const local = useRecentLocalChatSessions(200)
  const sessions = useMemo(
    () => mergeChatSessions(local.sessions, cloud.sessions, 200),
    [cloud.sessions, local.sessions]
  )
  const loading = local.loading || (user != null && cloud.loading)
  const error = sessions.length === 0 ? local.error || cloud.error : null
  const isDesktop = 'statsKeyDesktop' in window
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'active' | 'archived'>('active')
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const inView = sessions.filter((session) =>
      view === 'archived'
        ? session.archivedAt != null
        : session.archivedAt == null
    )
    if (!needle) return inView
    return inView.filter(
      (session) =>
        session.title.toLocaleLowerCase().includes(needle) ||
        session.messages.some((message) =>
          message.content.toLocaleLowerCase().includes(needle)
        )
    )
  }, [query, sessions, view])

  async function handleArchive(s: ChatSession, archived: boolean) {
    try {
      const next = await archiveLocalChatSession(s, archived)
      if (user) await saveChatSession(user.uid, next)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  async function handleDelete(s: ChatSession) {
    const ok = await confirmDialog({
      title: `Delete "${s.title}"?`,
      body: 'This conversation is removed from every device.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteLocalChatSession(s.id)
      await clearAgentLocalState(s.id)
      if (user) await deleteChatSession(user.uid, s.id)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Chat history</h1>
          <p className="text-text-secondary text-[14px] mt-1">
            Resume past conversations. Desktop history is kept locally and
            also syncs to your account when you sign in.
          </p>
        </div>
        <Link
          to={isDesktop && !user ? '/flow?scope=work' : '/flow'}
          className="btn btn-primary"
        >
          New chat
        </Link>
      </header>

      <div className="flow-history-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      <div className="flow-history-views" role="tablist" aria-label="Conversation state">
        <button
          role="tab"
          aria-selected={view === 'active'}
          className={view === 'active' ? 'active' : ''}
          onClick={() => setView('active')}
        >
          Active
        </button>
        <button
          role="tab"
          aria-selected={view === 'archived'}
          className={view === 'archived' ? 'active' : ''}
          onClick={() => setView('archived')}
        >
          Archived
        </button>
      </div>

      <div className="panel">
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : sessions.length === 0 ? (
          <EmptyState title="No conversations yet" subtitle="Start a chat in Intelligence." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={
              view === 'archived'
                ? 'No archived conversations'
                : 'No matching conversations'
            }
            subtitle={
              view === 'archived'
                ? 'Archive a conversation from any workspace folder to keep it without the clutter.'
                : 'Try a different word or phrase.'
            }
          />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  onArchive,
  onDelete,
}: {
  session: ChatSession
  onArchive: (s: ChatSession, archived: boolean) => void
  onDelete: (s: ChatSession) => void
}) {
  const last = session.messages
    .slice()
    .reverse()
    .find((m) => m.role === 'model')
  const preview = last?.content.replace(/\s+/g, ' ').slice(0, 120) ?? ''
  const when = session.updatedAt.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="flex items-center gap-3 py-3">
      <Link
        to={`/flow?session=${session.id}${
          session.contextScope === 'work' ? '&scope=work' : ''
        }`}
        className="flex-1 min-w-0 hover:bg-white/[0.02] rounded-md px-2 -mx-2 py-2 transition-colors"
      >
        <div className="text-[14px] text-text-primary truncate">{session.title}</div>
        {preview && <div className="text-[12px] text-text-muted truncate">{preview}</div>}
        <div className="text-[11px] text-text-muted mt-0.5">
          {session.messages.length} {session.messages.length === 1 ? 'message' : 'messages'} · {when}
          {session.lastProvider && ` · ${session.lastProvider}`}
          {session.contextScope === 'work' && ' · Work'}
        </div>
      </Link>
      <button
        className="btn btn-ghost text-[12px]"
        onClick={() => onArchive(session, session.archivedAt == null)}
      >
        {session.archivedAt ? 'Restore' : 'Archive'}
      </button>
      <button
        className="btn btn-ghost text-[12px]"
        onClick={() => onDelete(session)}
        aria-label="Delete conversation"
      >
        Delete
      </button>
    </div>
  )
}
