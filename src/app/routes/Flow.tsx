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
import { CHAT_MODELS, type ChatModelOption } from '../lib/ai/providers'
import { runAgentTurn, type AgentStep } from '../lib/ai/agent'
import type { AnthropicMonthlyUsage } from '../lib/ai/anthropic'
import { getScratchPad, updateScratchPad } from '../lib/ai/scratchPad'
import { Markdown } from '../components/Markdown'
import {
  saveChatSession,
  titleFromFirstMessage,
  useChatSession,
  type ChatMessageStep,
  type ChatSession,
  type ChatSessionMessage,
} from '../lib/data/useChatSessions'

const SUGGESTIONS: Array<{ title: string; prompt: string }> = [
  { title: 'Energy audit', prompt: 'What actually drove my energy this week? Check meals, training, sleep, and glucose.' },
  { title: 'Run analysis', prompt: 'Analyze my last run — pacing execution, drift, elevation, and one thing to fix.' },
  { title: 'GI triggers', prompt: 'Which foods show up most often in the hours before my GI symptoms?' },
  { title: 'Nutrient gaps', prompt: 'Am I consistently short on any nutrient this month? Check the usual suspects.' },
]

const MODEL_HINTS: Record<string, string> = {
  Auto: 'Picks the right model for the question — recommended',
  'Sonnet 5': 'Fast frontier Claude',
  'Opus 4.8': 'Deepest Claude for hard analysis',
  'GPT-5.6 Terra': 'Balanced OpenAI frontier',
  'GPT-5.6 Sol': 'Highest-capability OpenAI route',
  'Grok 4.5': 'xAI frontier',
}

export function Flow() {
  const { user, profile } = useAuth()
  const uid = user?.uid
  const [searchParams] = useSearchParams()
  const resumeId = searchParams.get('session') ?? undefined

  const existing = useChatSession(uid, resumeId)

  const [sessionId, setSessionId] = useState<string>(() => resumeId ?? crypto.randomUUID().toUpperCase())
  const [messages, setMessages] = useState<ChatSessionMessage[]>([])
  const [title, setTitle] = useState<string>('')
  const [createdAt, setCreatedAt] = useState<Date>(new Date())
  const [model, setModel] = useState<ChatModelOption>(CHAT_MODELS[0])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([])
  const [liveText, setLiveText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<AnthropicMonthlyUsage | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const stopRequested = useRef(false)

  // Close the model menu on outside click or Escape.
  useEffect(() => {
    if (!modelMenuOpen) return
    const onPointer = (e: PointerEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setModelMenuOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModelMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [modelMenuOpen])

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

  // Today snapshot for the system prompt.
  const mealsState = useTodayMeals(uid)
  const waterState = useTodayWater(uid)
  const wellnessState = useTodayWellness(uid)
  const targetsState = useMacroTargets(uid)
  const workoutsState = useRecentWorkouts(uid, 10)
  const glucoseState = useLatestGlucose(uid)

  const totals = useMemo(() => dailyTotals(mealsState.meals), [mealsState.meals])

  // Persistent memory — loaded once, refreshed after each turn (the agent may
  // have rewritten it through update_scratch_pad).
  const [memoryNotes, setMemoryNotes] = useState('')
  const [memoryDraft, setMemoryDraft] = useState<string | null>(null)
  useEffect(() => {
    if (!uid) return
    getScratchPad(uid)
      .then((pad) => setMemoryNotes(pad.notes))
      .catch(() => {})
  }, [uid])

  const systemPrompt = useMemo(
    () =>
      buildSystemPrompt({
        profile: profile ?? null,
        macroTargets: targetsState.targets,
        todayMeals: mealsState.meals,
        todayWellness: wellnessState.entries,
        todayTotals: totals,
        todayWater: waterState.water,
        recentWorkouts: workoutsState.workouts,
        latestGlucose: glucoseState.reading,
        memoryNotes,
        toolsEnabled: true,
      }),
    [
      profile,
      targetsState.targets,
      mealsState.meals,
      wellnessState.entries,
      totals,
      waterState.water,
      workoutsState.workouts,
      glucoseState.reading,
      memoryNotes,
    ]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, liveSteps, liveText])

  async function send(textOverride?: string) {
    if (!uid || sending) return
    const text = (textOverride ?? draft).trim()
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
    setLiveSteps([])
    setLiveText('')
    setError(null)
    stopRequested.current = false

    const sessionTitle = title || titleFromFirstMessage(text)
    if (!title) setTitle(sessionTitle)

    try {
      const priorTurns = messages.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }))

      const result = await runAgentTurn({
        uid,
        provider: model.provider,
        modelId: model.modelId,
        systemPrompt,
        priorTurns,
        userText: text,
        onStep: setLiveSteps,
        onText: setLiveText,
        shouldStop: () => stopRequested.current,
        unlimitedAuto: model.label === 'Auto',
      })

      if (result.monthlyUsage) setUsage(result.monthlyUsage)

      const steps: ChatMessageStep[] | undefined =
        result.steps.length > 0
          ? result.steps.map((s) => ({
              name: s.name,
              summary: s.summary,
              resultMeta: s.resultMeta,
              failed: s.status === 'error' ? true : undefined,
              sub: s.sub,
            }))
          : undefined

      const providerLabel = model.label === 'Auto' ? 'Auto · Claude' : model.providerLabel

      const assistantMsg: ChatSessionMessage = {
        id: crypto.randomUUID(),
        role: 'model',
        content: result.content,
        provider: providerLabel,
        timestamp: new Date(),
        steps,
        creditsCharged: result.creditsCharged || undefined,
        citations: result.citations.length > 0 ? result.citations : undefined,
      }
      const updated = [...history, assistantMsg]
      setMessages(updated)
      setLiveSteps([])
      setLiveText('')

      // The agent may have rewritten its memory — refresh for the next turn.
      getScratchPad(uid)
        .then((pad) => setMemoryNotes(pad.notes))
        .catch(() => {})

      const session: ChatSession = {
        id: sessionId,
        title: sessionTitle,
        messages: updated,
        mode: 'general',
        lastProvider: providerLabel,
        createdAt,
        updatedAt: new Date(),
      }
      await saveChatSession(uid, session)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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

  async function saveMemory() {
    if (!uid || memoryDraft == null) return
    await updateScratchPad(uid, memoryDraft)
    setMemoryNotes(memoryDraft)
    setMemoryDraft(null)
  }

  const working = sending && (liveSteps.length > 0 || liveText.length > 0)

  return (
    <div className="intel-page space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="intel-mark w-10 h-10 text-[16px]">✦</span>
          <div>
            <h1 className="font-display text-[24px] font-bold tracking-[-0.02em]">Intelligence</h1>
            <p className="text-text-secondary text-[13px] mt-0.5">
              {title || 'An agent over your full record — meals, workouts, glucose, wellness, memory.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" ref={modelMenuRef}>
            <button
              className="intel-model-trigger"
              onClick={() => setModelMenuOpen((v) => !v)}
              aria-expanded={modelMenuOpen}
              aria-haspopup="menu"
              title="Choose model"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: model.dotColor }} />
              {model.label}
              <span className={`intel-model-trigger__chev ${modelMenuOpen ? 'open' : ''}`}>▾</span>
            </button>
            {modelMenuOpen && (
              <div className="intel-menu" role="menu">
                {CHAT_MODELS.map((m) => (
                  <button
                    key={m.label}
                    role="menuitemradio"
                    aria-checked={model.label === m.label}
                    className={model.label === m.label ? 'active' : ''}
                    onClick={() => {
                      setModel(m)
                      setModelMenuOpen(false)
                    }}
                  >
                    <span className="intel-menu__dot" style={{ background: m.dotColor }} />
                    <span className="intel-menu__name">{m.label}</span>
                    <span className="intel-menu__hint">{MODEL_HINTS[m.label] ?? m.providerLabel}</span>
                    {model.label === m.label && <span className="intel-menu__check">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn btn-secondary text-[12px] !py-1.5 !px-3"
            onClick={() => {
              setMemoryOpen((v) => !v)
              setMemoryDraft(null)
            }}
          >
            Memory
          </button>
          <Link to="/reports" className="btn btn-secondary text-[12px] !py-1.5 !px-3">
            Deep Dive
          </Link>
          <Link to="/flow/history" className="btn btn-secondary text-[12px] !py-1.5 !px-3">
            History
          </Link>
        </div>
      </header>

      {memoryOpen && (
        <div className="intel-panel !py-4 space-y-2 intel-in">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="card-title">Persistent memory</span>
              <p className="text-text-muted text-[12px] mt-0.5">
                The agent reads this every session and rewrites it as it learns. Shared with the iOS app.
              </p>
            </div>
            {memoryDraft == null ? (
              <button className="btn btn-secondary text-[12px] !py-1.5 !px-3" onClick={() => setMemoryDraft(memoryNotes)}>
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button className="btn btn-secondary text-[12px] !py-1.5 !px-3" onClick={() => setMemoryDraft(null)}>
                  Cancel
                </button>
                <button className="btn btn-intel text-[12px] !py-1.5 !px-3" onClick={saveMemory}>
                  Save
                </button>
              </div>
            )}
          </div>
          {memoryDraft == null ? (
            <p className="text-text-secondary text-[13px] whitespace-pre-wrap">
              {memoryNotes || 'Nothing remembered yet. The agent will start taking notes as you talk.'}
            </p>
          ) : (
            <textarea
              className="input w-full resize-y text-[13px]"
              rows={6}
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
            />
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto intel-panel space-y-4">
        {messages.length === 0 && !existing.loading && (
          <div className="py-10 text-center space-y-6 intel-in">
            <div className="flex justify-center">
              <span className="intel-mark w-16 h-16 text-[26px]">✦</span>
            </div>
            <div>
              <p className="font-display text-text-primary text-[20px] font-bold tracking-[-0.02em]">Ask your own data.</p>
              <p className="text-text-muted text-[13px] mt-1.5 max-w-md mx-auto leading-relaxed">
                Intelligence searches your record, reads glucose timelines, analyzes runs, correlates meals with
                symptoms, dispatches subagents, and remembers what matters — every step shown as it works.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5 max-w-xl mx-auto text-left">
              {SUGGESTIONS.map((s) => (
                <button key={s.title} className="intel-suggestion" onClick={() => send(s.prompt)} disabled={sending || !uid}>
                  <b>{s.title}</b>
                  {s.prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {sending && (
          <div className="max-w-[92%] space-y-2.5 intel-in">
            {liveSteps.length > 0 && <StepList steps={liveSteps} live />}
            {liveText ? (
              <div className="px-4 py-3 rounded-2xl intel-bubble-ai">
                <Markdown text={liveText} />
                <span className="intel-caret" />
              </div>
            ) : (
              <div className="intel-status">
                <span className="intel-dot intel-dot--running" />
                {working
                  ? liveSteps.some((s) => s.status === 'running')
                    ? 'Working through your record…'
                    : 'Synthesizing…'
                  : 'Thinking…'}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="space-y-1.5">
        <div className="intel-composer">
          <textarea
            rows={2}
            placeholder="Ask anything about your record…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={sending}
          />
          {sending ? (
            <button className="btn btn-secondary" onClick={() => (stopRequested.current = true)}>
              Stop
            </button>
          ) : (
            <button className="btn btn-intel" onClick={() => send()} disabled={sending || !draft.trim()}>
              Send
            </button>
          )}
        </div>
        <div className="flex justify-between text-[11px] text-text-muted px-1">
          <span>
            {model.label === 'Auto' ? 'Auto routing · ' : `${model.label} · `}
            full toolbox over ~1 year of your record
          </span>
          {usage && (
            <span>
              {usage.tokensUsed.toLocaleString()} / {usage.tokenLimit.toLocaleString()} credits this month
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function StepList({ steps, live }: { steps: Array<AgentStep | ChatMessageStep>; live?: boolean }) {
  return (
    <div className="intel-steps">
      {steps.map((s, i) => {
        const running = live && 'status' in s && s.status === 'running'
        const failed = ('status' in s && s.status === 'error') || ('failed' in s && s.failed)
        const ms = 'ms' in s && typeof s.ms === 'number' ? s.ms : null
        return (
          <div
            key={'id' in s ? s.id : `${s.name}-${i}`}
            className={`intel-step ${s.sub ? 'intel-step--sub' : ''} ${running ? 'intel-step--running' : ''}`}
          >
            <span className={`intel-dot ${running ? 'intel-dot--running' : failed ? 'intel-dot--error' : ''}`} />
            <code className="intel-step__code">{s.summary || s.name}</code>
            <span className="intel-step__meta">
              {running ? 'running' : failed ? 'failed' : s.resultMeta ?? 'done'}
              {!running && ms != null ? ` · ${ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatSessionMessage }) {
  const isUser = message.role === 'user'
  const [stepsOpen, setStepsOpen] = useState(false)
  if (isUser) {
    return (
      <div className="flex justify-end intel-in">
        <div className="max-w-[85%] px-4 py-3 rounded-2xl whitespace-pre-wrap text-[14px] leading-relaxed text-text-primary intel-bubble-user">
          {message.content}
        </div>
      </div>
    )
  }
  const stepCount = message.steps?.length ?? 0
  return (
    <div className="flex justify-start intel-in">
      <div className="max-w-[92%] w-full space-y-2">
        {(message.provider || stepCount > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            {message.provider && <span className="intel-provider-pill">✦ {message.provider}</span>}
            {stepCount > 0 && (
              <button className="hover:text-text-primary transition-colors font-mono" onClick={() => setStepsOpen((v) => !v)}>
                {stepCount} tool call{stepCount === 1 ? '' : 's'} {stepsOpen ? '▾' : '▸'}
              </button>
            )}
            {typeof message.creditsCharged === 'number' && message.creditsCharged > 0 && (
              <span className="font-mono">{message.creditsCharged.toLocaleString()} credits</span>
            )}
          </div>
        )}
        {stepsOpen && message.steps && <StepList steps={message.steps} />}
        <div className="px-4 py-3 rounded-2xl intel-bubble-ai">
          <Markdown text={message.content} />
        </div>
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {message.citations.slice(0, 4).map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-text-primary transition-colors font-mono truncate max-w-[220px] border border-white/[0.07] rounded-full px-2 py-0.5"
              >
                {hostOf(url)}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
