import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useTodayMeals } from '../lib/data/useTodayMeals'
import { useTodayWater } from '../lib/data/useTodayWater'
import { useTodayWellness } from '../lib/data/useTodayWellness'
import { useMacroTargets } from '../lib/data/useMacroTargets'
import { useRecentWorkouts } from '../lib/data/useRecentWorkouts'
import { useLatestGlucose } from '../lib/data/useLatestGlucose'
import { dailyTotals } from '../lib/aggregates'
import { buildSystemPrompt } from '../lib/ai/context'
import { anthropicChat, type AnthropicMessage, type ClaudeModel } from '../lib/ai/anthropic'
import {
  saveChatSession,
  titleFromFirstMessage,
  useChatSession,
  type ChatSession,
  type ChatSessionMessage,
} from '../lib/data/useChatSessions'

const MODELS: { value: ClaudeModel; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet' },
  { value: 'claude-opus-4-7', label: 'Opus' },
]

export function Flow() {
  const { user } = useAuth()
  const uid = user?.uid
  const [searchParams] = useSearchParams()
  const resumeId = searchParams.get('session') ?? undefined

  const existing = useChatSession(uid, resumeId)

  const [sessionId, setSessionId] = useState<string>(() => resumeId ?? crypto.randomUUID().toUpperCase())
  const [messages, setMessages] = useState<ChatSessionMessage[]>([])
  const [title, setTitle] = useState<string>('')
  const [createdAt, setCreatedAt] = useState<Date>(new Date())
  const [model, setModel] = useState<ClaudeModel>('claude-sonnet-4-6')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load resumed session when it becomes available.
  const loadedResumeId = useRef<string | null>(null)
  useEffect(() => {
    if (!resumeId) return
    if (existing.session && loadedResumeId.current !== resumeId) {
      loadedResumeId.current = resumeId
      setSessionId(existing.session.id)
      setMessages(existing.session.messages)
      setTitle(existing.session.title)
      setCreatedAt(existing.session.createdAt)
    }
  }, [resumeId, existing.session])

  // Context inputs
  const mealsState = useTodayMeals(uid)
  const waterState = useTodayWater(uid)
  const wellnessState = useTodayWellness(uid)
  const targetsState = useMacroTargets(uid)
  const workoutsState = useRecentWorkouts(uid, 10)
  const glucoseState = useLatestGlucose(uid)

  const totals = useMemo(() => dailyTotals(mealsState.meals), [mealsState.meals])

  const systemPrompt = useMemo(
    () =>
      buildSystemPrompt({
        profile: null, // Avoid passing PII unless relevant; can wire from AuthProvider later.
        macroTargets: targetsState.targets,
        todayMeals: mealsState.meals,
        todayWellness: wellnessState.entries,
        todayTotals: totals,
        todayWater: waterState.water,
        recentWorkouts: workoutsState.workouts,
        latestGlucose: glucoseState.reading,
      }),
    [
      targetsState.targets,
      mealsState.meals,
      wellnessState.entries,
      totals,
      waterState.water,
      workoutsState.workouts,
      glucoseState.reading,
    ]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  async function send() {
    if (!uid) return
    const text = draft.trim()
    if (!text) return

    const userMsg: ChatSessionMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    const history: ChatSessionMessage[] = [...messages, userMsg]
    setMessages(history)
    setDraft('')
    setSending(true)
    setError(null)

    const sessionTitle = title || titleFromFirstMessage(text)
    if (!title) setTitle(sessionTitle)

    try {
      const payloadMessages: AnthropicMessage[] = history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }))

      const resp = await anthropicChat({
        messages: payloadMessages,
        systemPrompt,
        model,
      })

      const assistantMsg: ChatSessionMessage = {
        id: crypto.randomUUID(),
        role: 'model',
        content: resp.content,
        provider: 'Claude',
        timestamp: new Date(),
      }
      const updated = [...history, assistantMsg]
      setMessages(updated)

      // Persist
      const session: ChatSession = {
        id: sessionId,
        title: sessionTitle,
        messages: updated,
        mode: 'general',
        lastProvider: 'Claude',
        createdAt,
        updatedAt: new Date(),
      }
      await saveChatSession(uid, session)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Roll back the user message so retry is obvious — or keep it so user can edit.
      // We keep it and surface the error.
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

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[24px] font-bold tracking-[-0.02em]">Intelligence</h1>
          <p className="text-text-secondary text-[13px] mt-0.5">
            {title ? title : 'Ask about your nutrition, training, or wellness data.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="tab-strip">
            {MODELS.map((m) => (
              <button
                key={m.value}
                className={model === m.value ? 'active' : ''}
                onClick={() => setModel(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Link to="/flow/history" className="btn btn-secondary text-[12px] !py-1.5 !px-3">
            History
          </Link>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto panel space-y-4">
        {messages.length === 0 && !existing.loading && (
          <div className="text-text-muted text-[13px] text-center py-6">
            Start a conversation. Claude can see your today's totals, recent workouts, and wellness entries via the system prompt.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {sending && (
          <div className="text-text-muted text-[13px] animate-pulse">Thinking…</div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex items-end gap-2">
        <textarea
          className="input flex-1 resize-none"
          rows={2}
          placeholder="Ask Intelligence about your data…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={sending}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={sending || !draft.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatSessionMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-4 py-3 rounded-2xl whitespace-pre-wrap text-[14px] leading-relaxed ${
          isUser
            ? 'bg-accent/20 text-text-primary border border-accent/30'
            : 'bg-white/[0.04] text-text-primary border border-white/[0.06]'
        }`}
      >
        {message.content}
      </div>
    </div>
  )
}
