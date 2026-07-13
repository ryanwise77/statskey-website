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
import { buildSystemPrompt, type ChatMode } from '../lib/ai/context'
import { CHAT_MODELS, sendChat, type ChatModelOption, type ChatTurn } from '../lib/ai/providers'
import { runAgentTurn, type AgentStep } from '../lib/ai/agent'
import type { AnthropicMonthlyUsage, ClaudeModel } from '../lib/ai/anthropic'
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

const SUGGESTIONS = [
  'What actually drove my energy this week?',
  'Analyze my last run — pacing, drift, and what to fix.',
  'Which foods show up before my GI symptoms?',
  'Am I consistently short on any nutrient this month?',
]

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
  const [mode, setMode] = useState<ChatMode>('general')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<AnthropicMonthlyUsage | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const stopRequested = useRef(false)

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
      if (existing.session.mode === 'training') setMode('training')
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
  // have updated it through update_scratch_pad).
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
        toolsEnabled: model.agentic,
        mode,
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
      model.agentic,
      mode,
    ]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, liveSteps])

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
    setError(null)
    stopRequested.current = false

    const sessionTitle = title || titleFromFirstMessage(text)
    if (!title) setTitle(sessionTitle)

    try {
      const priorTurns: ChatTurn[] = messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }))

      let content: string
      let steps: ChatMessageStep[] | undefined
      let creditsCharged: number | undefined
      let providerLabel = model.providerLabel

      if (model.agentic) {
        const result = await runAgentTurn({
          uid,
          model: model.modelId as ClaudeModel,
          systemPrompt,
          priorTurns,
          userText: text,
          onStep: setLiveSteps,
          shouldStop: () => stopRequested.current,
        })
        content = result.content
        creditsCharged = result.creditsCharged
        if (result.monthlyUsage) setUsage(result.monthlyUsage)
        steps = result.steps.map((s) => ({
          name: s.name,
          summary: s.summary,
          resultMeta: s.resultMeta,
          failed: s.status === 'error' ? true : undefined,
          sub: s.sub,
        }))
        if (model.label === 'Auto') providerLabel = 'Auto · Claude'
        // The agent may have rewritten its memory — refresh for the next turn.
        getScratchPad(uid)
          .then((pad) => setMemoryNotes(pad.notes))
          .catch(() => {})
      } else {
        const resp = await sendChat({ model, systemPrompt, turns: [...priorTurns, { role: 'user', content: text }] })
        content = resp.content
      }

      const assistantMsg: ChatSessionMessage = {
        id: crypto.randomUUID(),
        role: 'model',
        content,
        provider: providerLabel,
        timestamp: new Date(),
        steps,
        creditsCharged,
      }
      const updated = [...history, assistantMsg]
      setMessages(updated)
      setLiveSteps([])

      const session: ChatSession = {
        id: sessionId,
        title: sessionTitle,
        messages: updated,
        mode,
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

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <IntelligenceMark />
          <div>
            <h1 className="font-display text-[24px] font-bold tracking-[-0.02em]">Intelligence</h1>
            <p className="text-text-secondary text-[13px] mt-0.5">
              {title || 'An agent over your full record — meals, workouts, glucose, wellness, memory.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="tab-strip">
            <button className={mode === 'general' ? 'active' : ''} onClick={() => setMode('general')}>
              General
            </button>
            <button className={mode === 'training' ? 'active' : ''} onClick={() => setMode('training')}>
              Training coach
            </button>
          </div>
          <div className="tab-strip">
            {CHAT_MODELS.map((m) => (
              <button
                key={m.modelId + m.label}
                className={model.label === m.label ? 'active' : ''}
                onClick={() => setModel(m)}
                title={m.agentic ? `${m.providerLabel} · full toolbox` : m.providerLabel}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dotColor }} />
                  {m.label}
                </span>
              </button>
            ))}
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
        <div className="panel !py-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="card-title">Persistent memory</span>
              <p className="text-text-muted text-[12px] mt-0.5">
                The agent reads this every session and can rewrite it as it learns. Shared with the iOS app.
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
                <button className="btn btn-primary text-[12px] !py-1.5 !px-3" onClick={saveMemory}>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto panel space-y-4">
        {messages.length === 0 && !existing.loading && (
          <div className="py-10 text-center space-y-5">
            <div className="flex justify-center">
              <IntelligenceMark large />
            </div>
            <div>
              <p className="text-text-primary text-[15px] font-medium">Ask your own data.</p>
              <p className="text-text-muted text-[13px] mt-1 max-w-md mx-auto">
                Intelligence searches your record, reads glucose timelines, analyzes runs, correlates meals with
                symptoms, and remembers what matters — every step shown as it works.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl mx-auto">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="btn btn-secondary text-[12px] !py-1.5 !px-3"
                  onClick={() => send(s)}
                  disabled={sending || !uid}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {sending && (
          <div className="max-w-[92%] space-y-2">
            {liveSteps.length > 0 && <StepList steps={liveSteps} live />}
            <div className="text-text-muted text-[13px] animate-pulse">
              {liveSteps.length > 0
                ? liveSteps.some((s) => s.status === 'running')
                  ? 'Working through your record…'
                  : 'Synthesizing…'
                : 'Thinking…'}
            </div>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="space-y-1.5">
        <div className="flex items-end gap-2">
          <textarea
            className="input flex-1 resize-none"
            rows={2}
            placeholder={model.agentic ? 'Ask anything about your record…' : `Ask ${model.providerLabel} (no tools on this route)…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={sending}
          />
          {sending && model.agentic ? (
            <button className="btn btn-secondary" onClick={() => (stopRequested.current = true)}>
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => send()} disabled={sending || !draft.trim()}>
              Send
            </button>
          )}
        </div>
        <div className="flex justify-between text-[11px] text-text-muted px-1">
          <span>
            {model.agentic
              ? `${model.label === 'Auto' ? 'Auto routing · ' : ''}full toolbox over ~1 year of your record`
              : 'Direct chat — switch to Auto, Sonnet, or Opus for tool use'}
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

function IntelligenceMark({ large }: { large?: boolean }) {
  const size = large ? 'w-14 h-14 text-[22px]' : 'w-9 h-9 text-[14px]'
  return (
    <span
      className={`${size} rounded-full inline-flex items-center justify-center text-white shrink-0`}
      style={{ background: 'linear-gradient(135deg, #7C3AED, #6366F1)', boxShadow: '0 6px 24px rgba(124, 58, 237, 0.35)' }}
      aria-hidden="true"
    >
      ✦
    </span>
  )
}

function StepList({ steps, live }: { steps: Array<AgentStep | ChatMessageStep>; live?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/30 divide-y divide-white/[0.04] overflow-hidden">
      {steps.map((s, i) => {
        const running = live && 'status' in s && s.status === 'running'
        const failed = ('status' in s && s.status === 'error') || ('failed' in s && s.failed)
        return (
          <div key={'id' in s ? s.id : `${s.name}-${i}`} className={`flex items-center gap-2.5 px-3 py-2 ${s.sub ? 'pl-8' : ''}`}>
            <span
              className={`w-3 h-3 rounded-full shrink-0 border ${
                running
                  ? 'border-[#8B5CF6] border-t-transparent animate-spin'
                  : failed
                  ? 'border-red-400/60 bg-red-400/20'
                  : 'border-transparent bg-[#8B5CF6]/25'
              }`}
            >
              {!running && !failed && <span className="block w-full h-full rounded-full scale-50 bg-[#a78bfa]" />}
            </span>
            <code className="font-mono text-[11.5px] text-[#a78bfa] truncate">{s.summary || s.name}</code>
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-text-muted">
              {running ? 'running' : failed ? 'failed' : s.resultMeta ?? 'done'}
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
      <div className="flex justify-end">
        <div className="max-w-[85%] px-4 py-3 rounded-2xl whitespace-pre-wrap text-[14px] leading-relaxed bg-accent/20 text-text-primary border border-accent/30">
          {message.content}
        </div>
      </div>
    )
  }
  const stepCount = message.steps?.length ?? 0
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full space-y-2">
        {(message.provider || stepCount > 0) && (
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            {message.provider && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-2 py-0.5 text-[#a78bfa] font-mono">
                ✦ {message.provider}
              </span>
            )}
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
        <div className="px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
          <Markdown text={message.content} />
        </div>
      </div>
    </div>
  )
}
