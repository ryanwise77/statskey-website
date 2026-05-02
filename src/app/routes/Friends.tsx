import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useFriends, type Friend } from '../lib/data/useFriends'
import { useActivityFeed } from '../lib/data/useActivityFeed'
import { useConversations } from '../lib/data/useMessages'
import { deleteFriendship, sendFriendRequest } from '../lib/writers'
import { ActivityFeedCard } from '../components/ActivityFeedCard'
import { EmptyState } from '../components/EmptyState'

type Tab = 'feed' | 'friends' | 'messages'

export function Friends() {
  const { user } = useAuth()
  const uid = user?.uid
  const [tab, setTab] = useState<Tab>('feed')

  const friendCode = uid ? uid.slice(0, 8).toUpperCase() : null

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Friends</h1>
        {friendCode && (
          <p className="text-text-secondary text-[14px] mt-1">
            Your friend code: <span className="font-mono text-text-primary">{friendCode}</span>
          </p>
        )}
      </header>

      <div className="tab-strip">
        {(['feed', 'friends', 'messages'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'feed' && <FeedTab uid={uid} />}
      {tab === 'friends' && <FriendsTab uid={uid} />}
      {tab === 'messages' && <MessagesTab uid={uid} />}
    </div>
  )
}

function FeedTab({ uid }: { uid?: string }) {
  const { items, loading, error, friendError } = useActivityFeed(uid, 30)

  if (loading) {
    return (
      <div className="panel">
        <p className="text-text-muted text-[13px]">Loading feed…</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && <div className="error-banner">{error}</div>}
      {friendError && (
        <div className="text-text-muted text-[12px] px-1">
          Couldn't load friends' activity ({friendError}). Showing your activity below.
        </div>
      )}
      {items.length === 0 && !error ? (
        <div className="panel">
          <EmptyState
            title="No feed activity yet"
            subtitle="Log a workout or add some friends and their activity will show up here."
          />
        </div>
      ) : (
        items.map(({ workout, friend, isCurrentUser }) => (
          <ActivityFeedCard
            key={`${workout.userId}-${workout.id}`}
            workout={workout}
            friend={friend}
            isCurrentUser={isCurrentUser}
          />
        ))
      )}
    </div>
  )
}

function FriendsTab({ uid }: { uid?: string }) {
  const { friends, loading, error } = useFriends(uid)
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)

  async function send() {
    if (!uid) return
    const trimmed = identifier.trim()
    if (!trimmed) return
    setBusy(true)
    setInlineError(null)
    setMessage(null)
    try {
      await sendFriendRequest(uid, trimmed)
      setMessage(`Friend request sent to ${trimmed}.`)
      setIdentifier('')
    } catch (e) {
      setInlineError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(friend: Friend) {
    const ok = window.confirm(`Remove ${friendLabel(friend)}?`)
    if (!ok) return
    try {
      await deleteFriendship(friend.friendship.id)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-3">
        <span className="card-title block">Add friend</span>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="Friend code, username, or user ID"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={busy}
          />
          <button className="btn btn-primary" onClick={send} disabled={busy || !identifier.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
        {message && <div className="text-data text-[12px]">{message}</div>}
        {inlineError && <div className="error-banner">{inlineError}</div>}
      </div>

      <div className="panel">
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : friends.length === 0 ? (
          <EmptyState title="No friends yet" subtitle="Share your friend code or add someone above." />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {friends.map((f) => (
              <div key={f.uid} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] text-text-primary">{friendLabel(f)}</div>
                  {f.social.email && <div className="text-[12px] text-text-muted">{f.social.email}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/messages/${f.uid}`} className="btn btn-secondary text-[12px] !py-1.5 !px-3">
                    Message
                  </Link>
                  <button className="btn btn-ghost text-[12px]" onClick={() => remove(f)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MessagesTab({ uid }: { uid?: string }) {
  const { conversations, loading, error } = useConversations(uid)

  return (
    <div className="panel">
      {loading ? (
        <p className="text-text-muted text-[13px]">Loading…</p>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : conversations.length === 0 ? (
        <EmptyState title="No conversations" subtitle="Message a friend to start a thread." />
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {conversations.map((c) => {
            const otherUid = c.participants.find((p) => p !== uid) ?? c.participants[0]
            return (
              <Link
                key={c.id}
                to={`/messages/${otherUid}`}
                className="py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] rounded-md px-2 -mx-2"
              >
                <div className="min-w-0">
                  <div className="text-[14px] text-text-primary font-mono">{otherUid.slice(0, 8)}</div>
                  <div className="text-[12px] text-text-muted truncate">{c.lastMessage}</div>
                </div>
                <div className="text-[11px] text-text-muted whitespace-nowrap">
                  {c.lastMessageDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function friendLabel(f: Friend): string {
  return f.social.displayName || f.social.username || f.social.email || f.uid.slice(0, 8)
}
