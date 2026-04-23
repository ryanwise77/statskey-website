import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { markMessagesRead, sendMessage, useMessages } from '../lib/data/useMessages'
import { fetchFriendSocial, type FriendSocial } from '../lib/data/useFriends'
import { EmptyState } from '../components/EmptyState'

export function MessageThread() {
  const { user, profile } = useAuth()
  const uid = user?.uid
  const { uid: otherUid } = useParams<{ uid: string }>()
  const { messages, loading, error } = useMessages(uid, otherUid)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [other, setOther] = useState<FriendSocial | null>(null)

  useEffect(() => {
    if (!otherUid) return
    let cancelled = false
    fetchFriendSocial(otherUid).then((s) => {
      if (!cancelled) setOther(s)
    })
    return () => {
      cancelled = true
    }
  }, [otherUid])

  // Mark read on open + whenever new messages come in
  useEffect(() => {
    if (!uid || !otherUid) return
    markMessagesRead(uid, otherUid).catch(() => {})
  }, [uid, otherUid, messages.length])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!uid || !otherUid) return
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setSendError(null)
    try {
      await sendMessage({
        senderId: uid,
        senderName: profile?.name ?? user?.email ?? uid.slice(0, 8),
        receiverId: otherUid,
        text,
      })
      setDraft('')
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!sending) send()
    }
  }

  const otherLabel = other?.displayName || other?.username || other?.email || otherUid?.slice(0, 8) || 'Friend'

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <header>
        <Link to="/friends" className="text-text-muted hover:text-text-primary text-[12px]">← Friends</Link>
        <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] mt-1">{otherLabel}</h1>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto panel space-y-3">
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : messages.length === 0 ? (
          <EmptyState title="No messages yet" subtitle="Send the first one." />
        ) : (
          messages.map((m) => {
            const mine = m.senderId === uid
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap ${
                    mine
                      ? 'bg-accent/20 text-text-primary border border-accent/30'
                      : 'bg-white/[0.04] text-text-primary border border-white/[0.06]'
                  }`}
                >
                  {m.text}
                  <div className="text-[10px] text-text-muted mt-1">
                    {m.createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {sendError && <div className="error-banner">{sendError}</div>}

      <div className="flex items-end gap-2">
        <textarea
          className="input flex-1 resize-none"
          rows={2}
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={sending}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
