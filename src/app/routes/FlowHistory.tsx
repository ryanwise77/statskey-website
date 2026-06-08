import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  deleteChatSession,
  useRecentChatSessions,
  type ChatSession,
} from '../lib/data/useChatSessions'
import { EmptyState } from '../components/EmptyState'

export function FlowHistory() {
  const { user } = useAuth()
  const { sessions, loading, error } = useRecentChatSessions(user?.uid, 50)

  async function handleDelete(s: ChatSession) {
    if (!user) return
    const ok = window.confirm(`Delete "${s.title}"?`)
    if (!ok) return
    try {
      await deleteChatSession(user.uid, s.id)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Chat history</h1>
          <p className="text-text-secondary text-[14px] mt-1">
            Resume past conversations with Intelligence.
          </p>
        </div>
        <Link to="/flow" className="btn btn-primary">New chat</Link>
      </header>

      <div className="panel">
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : sessions.length === 0 ? (
          <EmptyState title="No conversations yet" subtitle="Start a chat in Intelligence." />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  onDelete,
}: {
  session: ChatSession
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
      <Link to={`/flow?session=${session.id}`} className="flex-1 min-w-0 hover:bg-white/[0.02] rounded-md px-2 -mx-2 py-2 transition-colors">
        <div className="text-[14px] text-text-primary truncate">{session.title}</div>
        {preview && <div className="text-[12px] text-text-muted truncate">{preview}</div>}
        <div className="text-[11px] text-text-muted mt-0.5">
          {session.messages.length} {session.messages.length === 1 ? 'message' : 'messages'} · {when}
          {session.lastProvider && ` · ${session.lastProvider}`}
        </div>
      </Link>
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
