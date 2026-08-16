import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  fetchFriendSocial,
  useFriends,
  useFriendships,
  type Friend,
  type FriendSocial,
  type Friendship,
} from '../lib/data/useFriends'
import { useActivityFeed } from '../lib/data/useActivityFeed'
import { useConversations } from '../lib/data/useMessages'
import { acceptFriendship, deleteFriendship, sendFriendRequest } from '../lib/writers'
import { ActivityFeedCard } from '../components/ActivityFeedCard'
import { EmptyState } from '../components/EmptyState'
import { confirmDialog, showToast } from '../lib/ui/dialogs'

type Tab = 'feed' | 'friends' | 'requests' | 'messages'

export function Friends() {
  const { user } = useAuth()
  const uid = user?.uid
  const [tab, setTab] = useState<Tab>('feed')
  const { friendships } = useFriendships(uid)

  const pendingIncoming = friendships.filter(
    (f) => f.status === 'pending' && f.senderId && f.senderId !== uid
  )

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
        {(['feed', 'friends', 'requests', 'messages'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'requests' && pendingIncoming.length > 0 && ` (${pendingIncoming.length})`}
          </button>
        ))}
      </div>

      {tab === 'feed' && <FeedTab uid={uid} />}
      {tab === 'friends' && <FriendsTab uid={uid} />}
      {tab === 'requests' && <RequestsTab uid={uid} friendships={friendships} />}
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
            subtitle="Record a workout or add some friends and their activity will show up here."
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
    const ok = await confirmDialog({
      title: `Remove ${friendLabel(friend)}?`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteFriendship(friend.friendship.id)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { kind: 'error' })
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
                <Link to={`/friends/${f.uid}`} className="min-w-0 hover:opacity-80">
                  <div className="text-[14px] text-text-primary">{friendLabel(f)}</div>
                  {f.social.email && <div className="text-[12px] text-text-muted">{f.social.email}</div>}
                </Link>
                <div className="flex items-center gap-2">
                  <Link to={`/friends/${f.uid}`} className="btn btn-secondary text-[12px] !py-1.5 !px-3">
                    View
                  </Link>
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

function RequestsTab({ uid, friendships }: { uid?: string; friendships: Friendship[] }) {
  const [socials, setSocials] = useState<Record<string, FriendSocial>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  const pending = friendships.filter((f) => f.status === 'pending')
  const incoming = pending.filter((f) => f.senderId && f.senderId !== uid)
  const outgoing = pending.filter((f) => !f.senderId || f.senderId === uid)

  useEffect(() => {
    let cancelled = false
    const uids = new Set<string>()
    for (const f of pending) {
      const other = f.users.find((u) => u !== uid)
      if (other && !socials[other]) uids.add(other)
    }
    if (uids.size === 0) return
    ;(async () => {
      const resolved = await Promise.all([...uids].map((u) => fetchFriendSocial(u)))
      if (cancelled) return
      setSocials((prev) => {
        const next = { ...prev }
        for (const s of resolved) next[s.uid] = s
        return next
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, pending.map((f) => f.id).join(',')])

  async function accept(f: Friendship) {
    setActionError(null)
    try {
      await acceptFriendship(f.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function decline(f: Friendship) {
    setActionError(null)
    try {
      await deleteFriendship(f.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  function nameFor(f: Friendship): string {
    const other = f.users.find((u) => u !== uid)
    if (!other) return 'Unknown'
    const s = socials[other]
    return s?.displayName || s?.username || s?.email || other.slice(0, 8).toUpperCase()
  }

  return (
    <div className="space-y-4">
      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="panel">
        <span className="card-title block mb-2">Incoming requests</span>
        {incoming.length === 0 ? (
          <p className="text-text-muted text-[13px]">No pending requests.</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {incoming.map((f) => (
              <div key={f.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] text-text-primary">{nameFor(f)}</div>
                  <div className="card-subtext mt-0.5">
                    Sent {f.createdAt.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn btn-primary text-[12px] !py-1.5 !px-3" onClick={() => accept(f)}>
                    Accept
                  </button>
                  <button className="btn btn-ghost text-[12px]" onClick={() => decline(f)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <span className="card-title block mb-2">Sent requests</span>
        {outgoing.length === 0 ? (
          <p className="text-text-muted text-[13px]">No outgoing requests waiting.</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {outgoing.map((f) => (
              <div key={f.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] text-text-primary">{nameFor(f)}</div>
                  <div className="card-subtext mt-0.5">Waiting for them to accept</div>
                </div>
                <button className="btn btn-ghost text-[12px]" onClick={() => decline(f)}>
                  Cancel
                </button>
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
  const [socials, setSocials] = useState<Record<string, FriendSocial>>({})

  useEffect(() => {
    let cancelled = false
    const others = conversations
      .map((c) => c.participants.find((p) => p !== uid) ?? c.participants[0])
      .filter((u): u is string => !!u && !socials[u])
    if (others.length === 0) return
    ;(async () => {
      const resolved = await Promise.all([...new Set(others)].map((u) => fetchFriendSocial(u)))
      if (cancelled) return
      setSocials((prev) => {
        const next = { ...prev }
        for (const s of resolved) next[s.uid] = s
        return next
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, conversations.map((c) => c.id).join(',')])

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
            const social = socials[otherUid]
            const name =
              social?.displayName || social?.username || social?.email || otherUid.slice(0, 8).toUpperCase()
            return (
              <Link
                key={c.id}
                to={`/messages/${otherUid}`}
                className="py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] rounded-md px-2 -mx-2"
              >
                <div className="min-w-0">
                  <div className="text-[14px] text-text-primary">{name}</div>
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
