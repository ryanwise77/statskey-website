import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { dailyTotals } from '../lib/aggregates'
import { useFollowOutput } from '../lib/useFollowOutput'
import { buildSystemPrompt } from '../lib/ai/context'
import { runAgentTurn, type AgentStep } from '../lib/ai/agent'
import {
  CHAT_MODELS,
  type ChatModelOption,
  type ReasoningEffort,
} from '../lib/ai/providers'
import { Markdown } from '../components/Markdown'
import { ActionInbox } from '../components/assistant/ActionInbox'
import { ModelControls } from '../components/assistant/ModelControls'
import {
  WorkbenchCommandPalette,
  type WorkbenchCommand,
} from '../components/assistant/WorkbenchCommandPalette'
import { useAssistantActions } from '../lib/data/useAssistantActions'
import {
  saveChatSession,
  titleFromFirstMessage,
  useChatSession,
  useRecentChatSessions,
  type ChatSession,
  type ChatSessionMessage,
} from '../lib/data/useChatSessions'
import { useTodayMeals } from '../lib/data/useTodayMeals'
import { useTodayWater } from '../lib/data/useTodayWater'
import { useTodayWellness } from '../lib/data/useTodayWellness'
import { useMacroTargets } from '../lib/data/useMacroTargets'
import { useRecentWorkouts } from '../lib/data/useRecentWorkouts'
import { useLatestGlucose } from '../lib/data/useLatestGlucose'
import type { WorkoutSession } from '../lib/types'
import {
  addEnterpriseMember,
  createEnterpriseOrganization,
  createEnterpriseWorkspace,
  removeEnterpriseMember,
  updateEnterpriseMemberRole,
  updateEnterpriseWorkspacePolicy,
  useEnterpriseOrganizations,
  type EnterpriseOrganization,
  type EnterpriseProvider,
  type EnterpriseRole,
  type EnterpriseWorkspace,
} from '../lib/enterprise'
import { confirmDialog, promptDialog } from '../lib/ui/dialogs'

type AgentMode = 'ask' | 'plan' | 'apply'
type RailTab = 'actions' | 'policy' | 'members' | 'audit' | 'readiness'

const ORGANIZATION_TYPES = [
  { value: 'provider', label: 'Healthcare provider' },
  { value: 'payer', label: 'Health plan or payer' },
  { value: 'employer', label: 'Employer health program' },
  { value: 'research', label: 'Research organization' },
  { value: 'other', label: 'Other organization' },
]

const PROVIDERS: Array<{ id: EnterpriseProvider; label: string }> = [
  { id: 'google', label: 'Google regulated route' },
  { id: 'anthropic', label: 'Anthropic regulated route' },
  { id: 'openai', label: 'OpenAI regulated route' },
  { id: 'xai', label: 'xAI regulated route' },
]

const SUGGESTIONS: Array<{ title: string; prompt: string }> = [
  {
    title: 'Brief the record',
    prompt: 'Give me a concise operator brief on my current record: recovery, fueling, glucose, training, and the one constraint to respect today.',
  },
  {
    title: 'Find the pattern',
    prompt: 'Investigate the last 14 days for the strongest pattern between food timing, sleep, GI burden, and training quality. Show evidence.',
  },
  {
    title: 'Prepare a schedule change',
    prompt: 'Help me prepare a calendar change around training this week. Ask for every missing detail, then create an approval only.',
  },
  {
    title: 'Triage the inbox',
    prompt: 'Check my unread email, identify what actually needs a response, summarize each thread, and draft replies as approvals only. Ask before sending anything.',
  },
  {
    title: 'Draft the check-in',
    prompt: 'Draft a concise progress email I can review. Ask for recipient, subject, and missing context before creating an approval.',
  },
]

export function EnterpriseWorkbench() {
  const { user, profile } = useAuth()
  const uid = user?.uid
  const backendEnabled = import.meta.env.VITE_ENTERPRISE_BACKEND_ENABLED === 'true'
  const enterprise = useEnterpriseOrganizations(uid)
  const actionsState = useAssistantActions(uid)
  const recentSessions = useRecentChatSessions(uid, 24)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const resumeId = searchParams.get('thread') ?? undefined
  const existing = useChatSession(uid, resumeId)

  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [railTab, setRailTab] = useState<RailTab>('policy')
  const [error, setError] = useState<string | null>(null)

  const [sessionId, setSessionId] = useState(() => resumeId ?? crypto.randomUUID().toUpperCase())
  const [messages, setMessages] = useState<ChatSessionMessage[]>([])
  const [title, setTitle] = useState('')
  const [createdAt, setCreatedAt] = useState<Date>(new Date())
  const [model, setModel] = useState<ChatModelOption>(CHAT_MODELS[0])
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    CHAT_MODELS[0].defaultEffort
  )
  const [contextWindowTokens, setContextWindowTokens] = useState(128_000)
  const [executionRoute, setExecutionRoute] = useState<'managed' | 'direct'>('managed')
  const [reasoningMode, setReasoningMode] = useState<'standard' | 'pro'>('standard')
  const [mode, setMode] = useState<AgentMode>('plan')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([])
  const [liveText, setLiveText] = useState('')
  const [agentError, setAgentError] = useState<string | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const stopRequested = useRef(false)
  const loadedResumeId = useRef<string | null>(null)
  const {
    scrollRef,
    isFollowingOutput,
    handleScroll: handleTranscriptScroll,
    jumpToLatest,
    followLatestIfEnabled,
  } = useFollowOutput<HTMLDivElement>()

  const mealsState = useTodayMeals(uid)
  const waterState = useTodayWater(uid)
  const wellnessState = useTodayWellness(uid)
  const targetsState = useMacroTargets(uid)
  const workoutsState = useRecentWorkouts(uid, 5)
  const glucoseState = useLatestGlucose(uid)
  const totals = useMemo(() => dailyTotals(mealsState.meals), [mealsState.meals])

  useEffect(() => {
    if (
      enterprise.organizations.length > 0 &&
      !enterprise.organizations.some((organization) => organization.id === selectedOrganizationId)
    ) {
      setSelectedOrganizationId(enterprise.organizations[0].id)
    }
  }, [enterprise.organizations, selectedOrganizationId])

  const organization = useMemo(
    () =>
      enterprise.organizations.find((candidate) => candidate.id === selectedOrganizationId),
    [enterprise.organizations, selectedOrganizationId]
  )

  useEffect(() => {
    if (
      organization?.workspaces.length &&
      !organization.workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(organization.workspaces[0].id)
    }
  }, [organization, selectedWorkspaceId])

  const workspace = organization?.workspaces.find(
    (candidate) => candidate.id === selectedWorkspaceId
  )

  useEffect(() => {
    if (actionsState.pendingCount > 0) setRailTab('actions')
  }, [actionsState.pendingCount])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  useEffect(() => {
    followLatestIfEnabled()
  }, [messages, sending, liveSteps, liveText, followLatestIfEnabled])

  useEffect(() => {
    jumpToLatest()
  }, [sessionId, jumpToLatest])

  const systemPrompt = useMemo(() => {
    const base = buildSystemPrompt({
      profile: profile ?? null,
      macroTargets: targetsState.targets,
      todayMeals: mealsState.meals,
      todayWellness: wellnessState.entries,
      todayTotals: totals,
      todayWater: waterState.water,
      recentWorkouts: workoutsState.workouts,
      latestGlucose: glucoseState.reading,
      toolsEnabled: true,
    })
    const modeInstruction =
      mode === 'ask'
        ? 'MODE: ASK. Read and explain only. Do not create proposals, do not write memory, and do not imply any external action happened.'
        : mode === 'plan'
        ? 'MODE: PLAN. Investigate and produce an explicit plan. If an external calendar or email action is needed, prepare the exact approval proposal only after every material detail is known; never claim it executed.'
        : 'MODE: APPLY. You may prepare exact Assistant approval proposals for calendar or email when the user has asked for them and every material detail is known. Execution still requires explicit user approval; never claim an action happened before approval and execution succeed.'
    return [
      base,
      [
        '--- ENTERPRISE WORKBENCH ---',
        `Organization: ${organization?.name ?? 'not selected'}`,
        `Workspace: ${workspace?.name ?? 'not selected'}`,
        `Compliance intent: ${organization?.complianceIntent ?? 'standard'}`,
        'PHI status: not allowed. Do not request, infer, store, or transmit protected health information for an organization. Use only the signed-in user\'s consumer record and standard workspace metadata.',
        'External actions always require exact payload approval. Read-only analysis must not mutate records.',
        modeInstruction,
      ].join('\n'),
    ].join('\n\n')
  }, [
    profile,
    targetsState.targets,
    mealsState.meals,
    wellnessState.entries,
    totals,
    waterState.water,
    workoutsState.workouts,
    glucoseState.reading,
    organization?.name,
    organization?.complianceIntent,
    workspace?.name,
    mode,
  ])

  function startNewConversation() {
    loadedResumeId.current = null
    setSessionId(crypto.randomUUID().toUpperCase())
    setMessages([])
    setTitle('')
    setCreatedAt(new Date())
    setDraft('')
    setLiveSteps([])
    setLiveText('')
    setAgentError(null)
    navigate('/enterprise', { replace: true })
  }

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
    const history = [...messages, userMsg]
    jumpToLatest()
    setMessages(history)
    setDraft('')
    setSending(true)
    setLiveSteps([])
    setLiveText('')
    setAgentError(null)
    stopRequested.current = false

    const sessionTitle = title || titleFromFirstMessage(text)
    if (!title) setTitle(sessionTitle)

    try {
      const result = await runAgentTurn({
        uid,
        provider: model.provider,
        modelId: model.modelId,
        reasoningEffort,
        contextWindowTokens,
        executionRoute,
        directProvider: model.directProvider,
        serviceTier: model.serviceTier,
        reasoningMode,
        agentMode: mode === 'apply' ? 'agent' : mode,
        contextScope: 'work',
        approvalMode: 'review',
        orchestrationMode: 'focused',
        systemPrompt,
        priorTurns: messages.map((message) => ({
          role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: message.content,
        })),
        userText: text,
        sessionId,
        messageId: userMsg.id,
        onStep: setLiveSteps,
        onText: setLiveText,
        shouldStop: () => stopRequested.current,
        unlimitedAuto: model.label === 'Auto',
      })

      const providerLabel =
        model.label === 'Auto' ? 'Auto' : `${model.label} · ${reasoningEffort}`
      const assistantMsg: ChatSessionMessage = {
        id: crypto.randomUUID(),
        role: 'model',
        content: result.content,
        provider: providerLabel,
        timestamp: new Date(),
        steps:
          result.steps.length > 0
            ? result.steps.map((step) => ({
                name: step.name,
                summary: step.summary,
                resultMeta: step.resultMeta,
                failed: step.status === 'error' ? true : undefined,
                sub: step.sub,
              }))
            : undefined,
        creditsCharged: result.creditsCharged || undefined,
        citations: result.citations.length > 0 ? result.citations : undefined,
      }
      const updated = [...history, assistantMsg]
      setMessages(updated)
      setLiveSteps([])
      setLiveText('')
      if (
        result.steps.some(
          (step) => step.name === 'propose_calendar_event' || step.name === 'propose_email'
        )
      ) {
        setRailTab('actions')
      }

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
    } catch (sendError) {
      setAgentError(messageFor(sendError))
    } finally {
      setSending(false)
    }
  }

  function onComposerKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!sending) send()
    }
  }

  const commands: WorkbenchCommand[] = [
    {
      id: 'new-thread',
      label: 'New workbench thread',
      description: 'Start a clean Intelligence thread in this workspace.',
      shortcut: '⌘K',
      run: startNewConversation,
    },
    {
      id: 'review-actions',
      label: 'Review pending approvals',
      description: 'Open exact calendar and email proposals before anything executes.',
      run: () => setRailTab('actions'),
    },
    {
      id: 'triage-email',
      label: 'Triage email inbox',
      description: 'Read unread mail, summarize threads, and prepare approval-bound replies.',
      run: () =>
        send('Check my unread email, identify what actually needs a response, summarize each thread, and draft replies as approvals only. Ask before sending anything.'),
    },
    {
      id: 'policy',
      label: 'Edit workspace policy',
      description: 'Providers, retention, web search, and export boundaries.',
      run: () => setRailTab('policy'),
    },
    {
      id: 'members',
      label: 'Manage members',
      description: 'Roles and access for this organization.',
      run: () => setRailTab('members'),
    },
    {
      id: 'audit',
      label: 'Open server audit',
      description: 'Recent server-written administrative events.',
      run: () => setRailTab('audit'),
    },
    {
      id: 'personal-workbench',
      label: 'Open personal workbench',
      description: 'Switch to the consumer Intelligence workbench.',
      run: () => navigate('/flow'),
    },
  ]

  if (enterprise.loading) {
    return <div className="panel text-text-secondary text-sm">Opening enterprise workbench…</div>
  }

  return (
    <div className="enterprise-workbench">
      <aside className="ew-rail ew-rail--left" aria-label="Workbench navigation">
        <div className="ew-brand">
          <span className="site-brand__mark" aria-hidden="true" />
          <div>
            <b>StatsKey</b>
            <small>Enterprise Intelligence</small>
          </div>
        </div>

        <div className="ew-rail__section">
          <span className="ew-label">Organization</span>
          {enterprise.organizations.length === 0 ? (
            <p className="ew-muted">No organization yet. Initialize one from the center panel.</p>
          ) : (
            <div className="ew-stack">
              {enterprise.organizations.map((candidate) => (
                <button
                  key={candidate.id}
                  className={`ew-list-item ${
                    candidate.id === organization?.id ? 'active' : ''
                  }`}
                  onClick={() => setSelectedOrganizationId(candidate.id)}
                >
                  <b>{candidate.name}</b>
                  <small>{candidate.role} · {candidate.complianceIntent}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        {organization && (
          <div className="ew-rail__section">
            <div className="ew-section-head">
              <span className="ew-label">Workspaces</span>
              {(organization.role === 'owner' || organization.role === 'admin') && (
                <NewWorkspaceButton
                  organization={organization}
                  disabled={!backendEnabled}
                  onCreated={() => enterprise.refresh()}
                  onError={setError}
                />
              )}
            </div>
            <div className="ew-stack">
              {organization.workspaces.map((candidate) => (
                <button
                  key={candidate.id}
                  className={`ew-list-item ${
                    candidate.id === workspace?.id ? 'active' : ''
                  }`}
                  onClick={() => setSelectedWorkspaceId(candidate.id)}
                >
                  <b>{candidate.name}</b>
                  <small>{candidate.phiStatus === 'notAllowed' ? 'PHI locked' : candidate.status}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ew-rail__section ew-threads">
          <div className="ew-section-head">
            <span className="ew-label">Threads</span>
            <button className="ew-icon-button" onClick={startNewConversation} aria-label="New thread">
              +
            </button>
          </div>
          <button className="ew-new-thread" onClick={startNewConversation}>
            New thread
          </button>
          <nav>
            {recentSessions.loading ? (
              <span className="ew-muted">Loading…</span>
            ) : recentSessions.sessions.length === 0 ? (
              <span className="ew-muted">No workbench threads yet.</span>
            ) : (
              recentSessions.sessions.map((session) => (
                <Link
                  key={session.id}
                  to={`/enterprise?thread=${encodeURIComponent(session.id)}`}
                  className={`ew-thread ${session.id === sessionId ? 'active' : ''}`}
                >
                  <b>{session.title}</b>
                  <small>{session.updatedAt.toLocaleDateString()}</small>
                </Link>
              ))
            )}
          </nav>
        </div>

        <div className="ew-rail__footer">
          <span className="ew-label">Live record</span>
          <RecordSnapshot
            calories={totals.calories}
            protein={totals.protein}
            water={waterState.water?.amount ?? 0}
            glucose={glucoseState.reading?.value}
            mealCount={mealsState.meals.length}
            wellnessCount={wellnessState.entries.length}
            workout={workoutsState.workouts[0]}
          />
        </div>
      </aside>

      <main className="ew-main" aria-label="Enterprise Intelligence workbench">
        <header className="ew-topbar">
          <div className="ew-workspace-id">
            <span className="ew-label">Workspace</span>
            <b>{workspace?.name ?? organization?.name ?? 'Enterprise workbench'}</b>
            <span className="ew-lock">PHI locked</span>
          </div>
          <div className="ew-topbar__controls">
            <div className="ew-mode" role="tablist" aria-label="Agent mode">
              {(['ask', 'plan', 'apply'] as const).map((candidate) => (
                <button
                  key={candidate}
                  role="tab"
                  aria-selected={mode === candidate}
                  className={mode === candidate ? 'active' : ''}
                  onClick={() => setMode(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
            <ModelControls
              value={{
                model,
                effort: reasoningEffort,
                contextWindowTokens,
                executionRoute,
                reasoningMode,
              }}
              onChange={(next) => {
                setModel(next.model)
                setReasoningEffort(next.effort)
                setContextWindowTokens(next.contextWindowTokens)
                setExecutionRoute(next.executionRoute)
                setReasoningMode(next.reasoningMode)
              }}
            />
            <button className="ew-command" onClick={() => setCommandPaletteOpen(true)}>
              Commands <kbd>⌘K</kbd>
            </button>
          </div>
        </header>

        {!backendEnabled && (
          <div className="ew-private-notice">
            Private software preview: organization mutations and PHI remain disabled until tenancy
            testing, counsel review, and the regulated-readiness gate are complete.
          </div>
        )}
        {(error || enterprise.error) && <div className="error-banner">{error || enterprise.error}</div>}

        {enterprise.organizations.length === 0 ? (
          <InitializeEnterprise
            enabled={backendEnabled}
            onCreated={() => enterprise.refresh()}
            onError={setError}
          />
        ) : (
          <>
            <div
              ref={scrollRef}
              className="ew-transcript"
              onScroll={handleTranscriptScroll}
            >
              {messages.length === 0 && !existing.loading ? (
                <div className="ew-hero">
                  <span className="intel-mark">✦</span>
                  <h1>Ask, plan, or prepare — with the record attached.</h1>
                  <p>
                    An operator-grade workbench for health operations: read the connected record,
                    produce an evidence-backed plan, and prepare external actions that still require
                    exact approval.
                  </p>
                  <div className="ew-suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion.title}
                        onClick={() => send(suggestion.prompt)}
                        disabled={sending || !uid}
                      >
                        <b>{suggestion.title}</b>
                        <span>{suggestion.prompt}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => <EnterpriseMessage key={message.id} message={message} />)
              )}

              {sending && (
                <div className="ew-running">
                  {liveSteps.length > 0 && <LiveSteps steps={liveSteps} />}
                  {liveText ? (
                    <div className="ew-message ew-message--model">
                      <Markdown text={liveText} />
                      <span className="intel-caret" />
                    </div>
                  ) : (
                    <div className="intel-status">
                      <span className="intel-dot intel-dot--running" />
                      Working…
                    </div>
                  )}
                </div>
              )}
            </div>

            {!isFollowingOutput && (
              <button
                type="button"
                className="follow-output-button"
                onClick={jumpToLatest}
              >
                <span aria-hidden="true">↓</span>
                Jump to latest
              </button>
            )}

            {agentError && <div className="error-banner">{agentError}</div>}
            <footer className="ew-composer">
              <textarea
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKey}
                disabled={sending}
                placeholder={
                  mode === 'ask'
                    ? 'Ask a question about the connected record…'
                    : mode === 'plan'
                    ? 'Describe the outcome; Intelligence will investigate and plan…'
                    : 'Describe the action to prepare; exact approval is still required…'
                }
              />
              <div className="ew-composer__bar">
                <span>
                  {mode === 'apply'
                    ? 'Apply prepares approvals only — nothing executes silently.'
                    : 'Ask and Plan are read-only for records and external systems.'}
                </span>
                {sending ? (
                  <button className="btn btn-secondary" onClick={() => (stopRequested.current = true)}>
                    Stop
                  </button>
                ) : (
                  <button className="btn btn-intel" onClick={() => send()} disabled={!draft.trim()}>
                    Send
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </main>

      <aside className="ew-rail ew-rail--right" aria-label="Governance and approvals">
        <div className="ew-tabs" role="tablist" aria-label="Workspace controls">
          {(
            [
              ['actions', `Actions${actionsState.pendingCount > 0 ? ` · ${actionsState.pendingCount}` : ''}`],
              ['policy', 'Policy'],
              ['members', 'Members'],
              ['audit', 'Audit'],
              ['readiness', 'Readiness'],
            ] as Array<[RailTab, string]>
          ).map(([tab, label]) => (
            <button
              key={tab}
              role="tab"
              aria-selected={railTab === tab}
              className={railTab === tab ? 'active' : ''}
              onClick={() => setRailTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ew-rail__body">
          {railTab === 'actions' && (
            <ActionInbox
              actions={actionsState.actions}
              loading={actionsState.loading}
              error={actionsState.error}
            />
          )}
          {railTab === 'policy' && workspace && (
            <PolicyPanel
              workspace={workspace}
              disabled={!backendEnabled}
              onSaved={() => enterprise.refresh()}
              onError={setError}
            />
          )}
          {railTab === 'members' && organization && (
            <MembersPanel
              organization={organization}
              disabled={!backendEnabled}
              onSaved={() => enterprise.refresh()}
              onError={setError}
            />
          )}
          {railTab === 'audit' && organization && <AuditPanel organization={organization} />}
          {railTab === 'readiness' && <ReadinessPanel />}
        </div>
      </aside>

      <WorkbenchCommandPalette
        open={commandPaletteOpen}
        commands={commands}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  )
}

function InitializeEnterprise({
  enabled,
  onCreated,
  onError,
}: {
  enabled: boolean
  onCreated: () => void
  onError: (message: string | null) => void
}) {
  const [name, setName] = useState('')
  const [organizationType, setOrganizationType] = useState('provider')
  const [complianceIntent, setComplianceIntent] = useState<'standard' | 'hipaa'>('hipaa')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!name.trim() || saving || !enabled) return
    setSaving(true)
    onError(null)
    try {
      await createEnterpriseOrganization({
        name: name.trim(),
        organizationType,
        complianceIntent,
      })
      onCreated()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ew-init">
      <span className="intel-mark">✦</span>
      <h1>Initialize the enterprise workbench.</h1>
      <p>
        This creates an administrative workspace only. The product surface is the agent workbench;
        PHI stays locked until the BAA chain and readiness gates are real.
      </p>
      <div className="ew-init__form">
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Organization name"
        />
        <select
          className="input"
          value={organizationType}
          onChange={(event) => setOrganizationType(event.target.value)}
          aria-label="Organization type"
        >
          {ORGANIZATION_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="ew-init__intent" role="radiogroup" aria-label="Intended use">
          <label>
            <input
              type="radio"
              name="enterprise-intent"
              checked={complianceIntent === 'standard'}
              onChange={() => setComplianceIntent('standard')}
            />
            Standard
          </label>
          <label>
            <input
              type="radio"
              name="enterprise-intent"
              checked={complianceIntent === 'hipaa'}
              onChange={() => setComplianceIntent('hipaa')}
            />
            HIPAA readiness
          </label>
        </div>
        <button
          className="btn btn-intel"
          onClick={create}
          disabled={!enabled || saving || !name.trim()}
        >
          {saving ? 'Initializing…' : enabled ? 'Initialize workspace' : 'Private setup not enabled'}
        </button>
      </div>
    </div>
  )
}

function NewWorkspaceButton({
  organization,
  disabled,
  onCreated,
  onError,
}: {
  organization: EnterpriseOrganization
  disabled: boolean
  onCreated: () => void
  onError: (message: string | null) => void
}) {
  const [creating, setCreating] = useState(false)

  async function create() {
    if (creating || disabled) return
    const name = await promptDialog({
      title: 'New workspace',
      label: 'Workspace name',
      confirmLabel: 'Create',
    })
    if (!name?.trim()) return
    setCreating(true)
    onError(null)
    try {
      await createEnterpriseWorkspace({
        organizationId: organization.id,
        name: name.trim(),
        complianceIntent: organization.complianceIntent,
      })
      onCreated()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <button className="ew-icon-button" onClick={create} disabled={creating || disabled} aria-label="New workspace">
      {creating ? '…' : '+'}
    </button>
  )
}

function PolicyPanel({
  workspace,
  disabled,
  onSaved,
  onError,
}: {
  workspace: EnterpriseWorkspace
  disabled: boolean
  onSaved: () => void
  onError: (message: string | null) => void
}) {
  const [retentionDays, setRetentionDays] = useState(workspace.policy.retentionDays)
  const [providers, setProviders] = useState<EnterpriseProvider[]>(workspace.policy.permittedProviders)
  const [webSearchEnabled, setWebSearchEnabled] = useState(workspace.policy.webSearchEnabled)
  const [exportEnabled, setExportEnabled] = useState(workspace.policy.exportEnabled)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRetentionDays(workspace.policy.retentionDays)
    setProviders(workspace.policy.permittedProviders)
    setWebSearchEnabled(workspace.policy.webSearchEnabled)
    setExportEnabled(workspace.policy.exportEnabled)
  }, [workspace])

  function toggleProvider(provider: EnterpriseProvider) {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((candidate) => candidate !== provider)
        : [...current, provider].sort()
    )
  }

  async function save() {
    if (saving || disabled) return
    setSaving(true)
    onError(null)
    try {
      await updateEnterpriseWorkspacePolicy({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        retentionDays,
        permittedProviders: providers,
        webSearchEnabled,
        exportEnabled,
      })
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ew-panel">
      <div className="ew-panel__head">
        <div>
          <span className="ew-label">Policy</span>
          <h2>{workspace.name}</h2>
        </div>
        <span className="ew-lock">PHI disabled</span>
      </div>
      <div className="ew-fixed-rule">
        <span>External actions</span>
        <b>Exact approval always required</b>
      </div>
      <label className="ew-field">
        Retention
        <select
          className="input"
          value={retentionDays}
          onChange={(event) => setRetentionDays(Number(event.target.value))}
        >
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>1 year</option>
          <option value={2190}>6 years</option>
          <option value={3650}>10 years</option>
        </select>
      </label>
      <fieldset className="ew-fieldset">
        <legend>Permitted Intelligence providers for standard data</legend>
        {PROVIDERS.map((provider) => (
          <label key={provider.id}>
            <input
              type="checkbox"
              checked={providers.includes(provider.id)}
              onChange={() => toggleProvider(provider.id)}
            />
            {provider.label}
          </label>
        ))}
      </fieldset>
      <label className="ew-check">
        <input
          type="checkbox"
          checked={webSearchEnabled}
          onChange={(event) => setWebSearchEnabled(event.target.checked)}
        />
        External web search for standard data
      </label>
      <label className="ew-check">
        <input
          type="checkbox"
          checked={exportEnabled}
          onChange={(event) => setExportEnabled(event.target.checked)}
        />
        Member-requested export
      </label>
      <button className="btn btn-intel" onClick={save} disabled={saving || disabled}>
        {saving ? 'Saving…' : 'Save policy'}
      </button>
    </section>
  )
}

function MembersPanel({
  organization,
  disabled,
  onSaved,
  onError,
}: {
  organization: EnterpriseOrganization
  disabled: boolean
  onSaved: () => void
  onError: (message: string | null) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<EnterpriseRole, 'owner'>>('viewer')
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const canManage = organization.role === 'owner' || organization.role === 'admin'
  const assignableRoles: Array<Exclude<EnterpriseRole, 'owner'>> =
    organization.role === 'owner'
      ? ['admin', 'clinician', 'analyst', 'viewer']
      : ['clinician', 'analyst', 'viewer']

  useEffect(() => {
    if (organization.role !== 'owner' && role === 'admin') setRole('viewer')
  }, [organization.role, role])

  async function add() {
    if (!email.trim() || busyUid || !canManage || disabled) return
    setBusyUid('new')
    onError(null)
    try {
      await addEnterpriseMember({
        organizationId: organization.id,
        email: email.trim(),
        role,
      })
      setEmail('')
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setBusyUid(null)
    }
  }

  async function changeRole(targetUid: string, nextRole: Exclude<EnterpriseRole, 'owner'>) {
    setBusyUid(targetUid)
    onError(null)
    try {
      await updateEnterpriseMemberRole({
        organizationId: organization.id,
        targetUid,
        role: nextRole,
      })
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setBusyUid(null)
    }
  }

  async function remove(targetUid: string, label: string) {
    if (disabled) return
    const confirmed = await confirmDialog({
      title: 'Remove member',
      body: `Remove ${label} from ${organization.name}?`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    setBusyUid(targetUid)
    onError(null)
    try {
      await removeEnterpriseMember({ organizationId: organization.id, targetUid })
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <section className="ew-panel">
      <div className="ew-panel__head">
        <div>
          <span className="ew-label">Members</span>
          <h2>Access</h2>
        </div>
        <span className="ew-muted">{organization.members.length}</span>
      </div>
      <div className="ew-members">
        {organization.members.map((member) => {
          const label = member.displayName || member.email || member.uid
          const editable = organization.role === 'owner' && member.role !== 'owner'
          const removable =
            member.role !== 'owner' &&
            (organization.role === 'owner' ||
              (organization.role === 'admin' && member.role !== 'admin'))
          return (
            <div key={member.uid} className="ew-member">
              <span>
                <b>{label}</b>
                {member.displayName && member.email && <small>{member.email}</small>}
              </span>
              {editable ? (
                <select
                  value={member.role}
                  disabled={busyUid === member.uid || disabled}
                  onChange={(event) =>
                    changeRole(member.uid, event.target.value as Exclude<EnterpriseRole, 'owner'>)
                  }
                >
                  {assignableRoles.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{member.role}</strong>
              )}
              {removable && (
                <button onClick={() => remove(member.uid, label)} disabled={busyUid === member.uid || disabled}>
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>
      {canManage && (
        <div className="ew-member-add">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Existing StatsKey account email"
          />
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value as Exclude<EnterpriseRole, 'owner'>)}
          >
            {assignableRoles.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={add} disabled={!email.trim() || busyUid != null || disabled}>
            {busyUid === 'new' ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
      <p className="ew-muted">
        SSO and SCIM lifecycle management are required before regulated release.
      </p>
    </section>
  )
}

function AuditPanel({ organization }: { organization: EnterpriseOrganization }) {
  if (organization.role !== 'owner' && organization.role !== 'admin') {
    return (
      <section className="ew-panel">
        <span className="ew-label">Audit</span>
        <p className="ew-muted">Server audit events are visible to owners and admins.</p>
      </section>
    )
  }
  return (
    <section className="ew-panel">
      <div className="ew-panel__head">
        <div>
          <span className="ew-label">Server audit</span>
          <h2>Recent events</h2>
        </div>
        <span className="ew-muted">{organization.auditEvents.length}</span>
      </div>
      {organization.auditEvents.length === 0 ? (
        <p className="ew-muted">No administrative events recorded yet.</p>
      ) : (
        <ol className="ew-audit">
          {organization.auditEvents.map((event) => (
            <li key={event.id}>
              <span>
                <b>{event.summary}</b>
                <small>{event.type}</small>
              </span>
              <time dateTime={event.createdAt?.toISOString()}>
                {event.createdAt?.toLocaleString() ?? 'Pending'}
              </time>
            </li>
          ))}
        </ol>
      )}
      <p className="ew-muted">
        Immutable external export and SIEM streaming remain required for regulated release.
      </p>
    </section>
  )
}

function ReadinessPanel() {
  return (
    <section className="ew-panel">
      <div className="ew-panel__head">
        <div>
          <span className="ew-label">Regulated readiness</span>
          <h2>Release gates</h2>
        </div>
        <span className="ew-lock">Locked</span>
      </div>
      <div className="ew-readiness">
        <ReadinessItem label="Customer BAA" ready={false} />
        <ReadinessItem label="Google Cloud BAA" ready={false} />
        <ReadinessItem label="Model-provider BAA" ready={false} />
        <ReadinessItem label="Risk analysis" ready={false} />
        <ReadinessItem label="Incident exercise" ready={false} />
        <ReadinessItem label="Audit export" ready={false} />
      </div>
      <p className="ew-muted">
        The server keeps PHI disabled until these controls are represented by verified,
        server-owned readiness records.
      </p>
    </section>
  )
}

function ReadinessItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div>
      <span>{label}</span>
      <b className={ready ? 'ready' : undefined}>{ready ? 'Verified' : 'Pending'}</b>
    </div>
  )
}

function RecordSnapshot({
  calories,
  protein,
  water,
  glucose,
  mealCount,
  wellnessCount,
  workout,
}: {
  calories: number
  protein: number
  water: number
  glucose?: number
  mealCount: number
  wellnessCount: number
  workout?: WorkoutSession
}) {
  return (
    <div className="ew-record">
      <div>
        <span>Today</span>
        <b>{Math.round(calories)} cal · {Math.round(protein)}g P</b>
      </div>
      <div>
        <span>Water</span>
        <b>{Math.round(water)} fl oz</b>
      </div>
      <div>
        <span>Glucose</span>
        <b>{glucose != null ? `${Math.round(glucose)} mg/dL` : '—'}</b>
      </div>
      <div>
        <span>Records</span>
        <b>{mealCount} meals · {wellnessCount} wellness</b>
      </div>
      {workout && (
        <div className="ew-record__wide">
          <span>Latest workout</span>
          <b>
            {workout.sportType}
            {workout.distance > 0 ? ` · ${workout.distance.toFixed(2)} mi` : ''}
            {workout.duration > 0 ? ` · ${Math.round(workout.duration / 60)}m` : ''}
          </b>
        </div>
      )}
    </div>
  )
}

function EnterpriseMessage({ message }: { message: ChatSessionMessage }) {
  const isUser = message.role === 'user'
  return (
    <article className={`ew-message ${isUser ? 'ew-message--user' : 'ew-message--model'}`}>
      {isUser ? (
        <p>{message.content}</p>
      ) : (
        <>
          <Markdown text={message.content} />
          {(message.steps?.length || message.citations?.length || message.creditsCharged) && (
            <details className="workbench-evidence">
              <summary>
                Evidence
                {message.creditsCharged ? ` · ${message.creditsCharged} credits` : ''}
              </summary>
              {message.steps && message.steps.length > 0 && (
                <ol>
                  {message.steps.map((step, index) => (
                    <li key={`${message.id}-step-${index}`} className={step.failed ? 'failed' : ''}>
                      <span>{step.summary}</span>
                      {step.resultMeta && <small>{step.resultMeta}</small>}
                    </li>
                  ))}
                </ol>
              )}
              {message.citations && message.citations.length > 0 && (
                <ol>
                  {message.citations.map((citation) => (
                    <li key={citation}>
                      <small>{citation}</small>
                    </li>
                  ))}
                </ol>
              )}
            </details>
          )}
        </>
      )}
    </article>
  )
}

function LiveSteps({ steps }: { steps: AgentStep[] }) {
  return (
    <div className="workbench-evidence">
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={step.status === 'error' ? 'failed' : ''}>
            <span>
              {step.status === 'running' ? '● ' : step.status === 'done' ? '✓ ' : '✕ '}
              {step.summary}
            </span>
            {step.resultMeta && <small>{step.resultMeta}</small>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
