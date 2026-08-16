import { useEffect, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDate, toDateOrNow } from '../firestore'
import type { AgentToolPreview } from '../ai/tools'
import type { AgentTaskExpectation } from '../ai/agentPersistence'

/** Persisted trace of one agent tool call (status is always terminal here). */
export interface ChatMessageStep {
  name: string
  summary: string
  agent?: string
  rationale?: string
  ms?: number
  /**
   * Local-session preview. File content (before/after/body) is deliberately
   * excluded from Firestore persistence; for recorded file changes the
   * content-free metadata (title, path, +/− counts, checkpoint) is persisted
   * so restored sessions report edits accurately instead of "+0 −0".
   */
  preview?: AgentToolPreview
  resultMeta?: string
  failed?: boolean
  sub?: boolean
}

export interface ChatMessageArtifact {
  kind: 'plan-canvas'
  id: string
  title: string
  revision: number
}

export interface InterruptedRunReference {
  runId: string
  sessionId?: string
  messageId?: string
  workspaceId?: string
  workspaceLabel?: string
  workspaceRoots?: string[]
}

export interface ChatSessionMessage {
  id: string
  role: 'user' | 'model'
  content: string
  provider?: string
  agentMode?: 'ask' | 'plan' | 'debug' | 'agent'
  taskExpectation?: AgentTaskExpectation
  /** Durable local artifact referenced by this response. */
  artifact?: ChatMessageArtifact
  timestamp: Date
  /** Agent tool activity behind this assistant message. */
  steps?: ChatMessageStep[]
  /** Metered Intelligence credits this turn cost. */
  creditsCharged?: number
  /** Web citations the model consulted (URL list). */
  citations?: string[]
  durationMs?: number
  /** Sensitive connected-service output stays in memory and is redacted in history. */
  localOnly?: boolean
  /** A concise user-facing work update, excluded from future model context. */
  operational?: boolean
  /** Only the current operation animates; persisted legacy updates are done. */
  operationalState?: 'running' | 'done' | 'error'
  /** Stable run-scoped identity used to update repeated operations in place. */
  operationalKey?: string
  /** Durable context needed to continue an interrupted run safely. */
  interruptedRun?: InterruptedRunReference
  attachments?: Array<{
    name: string
    mediaType: string
    size: number
    kind: 'text' | 'image' | 'pdf' | 'opaque'
    readable: boolean
  }>
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatSessionMessage[]
  mode: 'general' | 'training'
  contextScope?: 'personal' | 'work'
  projectId?: string
  projectLabel?: string
  projectRoots?: string[]
  lastProvider?: string
  parentSessionId?: string
  inheritedContext?: string
  /** Archived conversations stay recoverable but are hidden from active folders. */
  archivedAt?: Date
  createdAt: Date
  updatedAt: Date
}

type Raw = Record<string, unknown>

const PERSISTED_PREVIEW_KINDS = new Set([
  'files',
  'code',
  'diff',
  'command',
  'browser',
  'text',
])

/** File mutations keep content-free preview metadata across restarts. */
const PERSISTED_STEP_PREVIEW_TOOLS = new Set([
  'workspace_write',
  'workspace_create',
  'workspace_delete',
  'workspace_rename',
])

function decodeStepPreview(raw: unknown): ChatMessageStep['preview'] {
  if (raw == null || typeof raw !== 'object') return undefined
  const value = raw as Raw
  const kind =
    typeof value.kind === 'string' && PERSISTED_PREVIEW_KINDS.has(value.kind)
      ? (value.kind as NonNullable<ChatMessageStep['preview']>['kind'])
      : undefined
  const title = typeof value.title === 'string' ? value.title.slice(0, 240) : undefined
  if (!kind && !title) return undefined
  return {
    kind: kind ?? 'diff',
    title: title ?? 'File change',
    filePath:
      typeof value.filePath === 'string' ? value.filePath.slice(0, 1_000) : undefined,
    additions:
      typeof value.additions === 'number' && Number.isFinite(value.additions)
        ? Math.max(0, Math.floor(value.additions))
        : undefined,
    deletions:
      typeof value.deletions === 'number' && Number.isFinite(value.deletions)
        ? Math.max(0, Math.floor(value.deletions))
        : undefined,
    checkpointId:
      typeof value.checkpointId === 'string' &&
      /^[a-f0-9-]{16,80}$/i.test(value.checkpointId)
        ? value.checkpointId
        : undefined,
  }
}

function decodeStep(raw: Raw): ChatMessageStep {
  return {
    name: typeof raw.name === 'string' ? raw.name : 'tool',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    agent: typeof raw.agent === 'string' ? raw.agent : undefined,
    rationale: typeof raw.rationale === 'string' ? raw.rationale : undefined,
    preview: decodeStepPreview(raw.preview),
    ms:
      typeof raw.ms === 'number' && Number.isFinite(raw.ms)
        ? Math.min(24 * 60 * 60 * 1_000, Math.max(0, raw.ms))
        : undefined,
    resultMeta: typeof raw.resultMeta === 'string' ? raw.resultMeta : undefined,
    failed: raw.failed === true ? true : undefined,
    sub: raw.sub === true ? true : undefined,
  }
}

function decodeMessage(raw: Raw): ChatSessionMessage {
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    role: raw.role === 'user' ? 'user' : 'model',
    content: typeof raw.content === 'string' ? raw.content : '',
    provider: typeof raw.provider === 'string' ? raw.provider : undefined,
    agentMode:
      raw.agentMode === 'ask' ||
      raw.agentMode === 'plan' ||
      raw.agentMode === 'debug' ||
      raw.agentMode === 'agent'
        ? raw.agentMode
        : undefined,
    taskExpectation:
      raw.taskExpectation === 'workspace-change' ||
      raw.taskExpectation === 'external-action' ||
      raw.taskExpectation === 'answer'
        ? raw.taskExpectation
        : undefined,
    artifact:
      raw.artifact != null &&
      typeof raw.artifact === 'object' &&
      (raw.artifact as Raw).kind === 'plan-canvas' &&
      typeof (raw.artifact as Raw).id === 'string'
        ? {
            kind: 'plan-canvas',
            id: String((raw.artifact as Raw).id).slice(0, 160),
            title:
              typeof (raw.artifact as Raw).title === 'string'
                ? String((raw.artifact as Raw).title).slice(0, 140)
                : 'Planning canvas',
            revision:
              typeof (raw.artifact as Raw).revision === 'number' &&
              Number.isFinite((raw.artifact as Raw).revision)
                ? Math.max(
                    1,
                    Math.min(
                      10_000,
                      Math.floor(Number((raw.artifact as Raw).revision))
                    )
                  )
                : 1,
          }
        : undefined,
    timestamp: toDate(raw.timestamp) ?? new Date(),
    steps: Array.isArray(raw.steps) ? raw.steps.map((s) => decodeStep(s as Raw)) : undefined,
    creditsCharged: typeof raw.creditsCharged === 'number' ? raw.creditsCharged : undefined,
    citations: Array.isArray(raw.citations) ? raw.citations.filter((c): c is string => typeof c === 'string') : undefined,
    durationMs:
      typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
        ? Math.min(24 * 60 * 60 * 1_000, Math.max(0, raw.durationMs))
        : undefined,
    localOnly: raw.localOnly === true ? true : undefined,
    operational: raw.operational === true ? true : undefined,
    operationalState:
      raw.operational === true &&
      (raw.operationalState === 'running' ||
        raw.operationalState === 'error')
        ? raw.operationalState
        : raw.operational === true
          ? 'done'
          : undefined,
    operationalKey:
      raw.operational === true && typeof raw.operationalKey === 'string'
        ? raw.operationalKey.slice(0, 500)
        : undefined,
    interruptedRun: decodeInterruptedRunReference(raw.interruptedRun),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments
          .slice(0, 20)
          .map((item) => item as Raw)
          .filter(
            (item) =>
              typeof item.name === 'string' &&
              typeof item.mediaType === 'string' &&
              typeof item.size === 'number'
          )
          .map((item) => ({
            name: String(item.name).slice(0, 255),
            mediaType: String(item.mediaType).slice(0, 120),
            size: Math.max(0, Number(item.size)),
            kind:
              item.kind === 'text' ||
              item.kind === 'image' ||
              item.kind === 'pdf'
                ? item.kind
                : 'opaque',
            readable: item.readable === true,
          }))
      : undefined,
  }
}

function decodeSession(raw: Raw, id: string): ChatSession {
  const msgs = Array.isArray(raw.messages) ? raw.messages : []
  return {
    id: typeof raw.id === 'string' ? raw.id : id,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    messages: msgs.map((m) => decodeMessage(m as Raw)),
    mode: raw.mode === 'training' ? 'training' : 'general',
    contextScope: raw.contextScope === 'work' ? 'work' : 'personal',
    projectId:
      typeof raw.projectId === 'string' ? raw.projectId.slice(0, 120) : undefined,
    projectLabel:
      typeof raw.projectLabel === 'string'
        ? raw.projectLabel.slice(0, 120)
        : undefined,
    projectRoots: Array.isArray(raw.projectRoots)
      ? raw.projectRoots
          .filter((root): root is string => typeof root === 'string')
          .slice(0, 24)
      : undefined,
    lastProvider: typeof raw.lastProvider === 'string' ? raw.lastProvider : undefined,
    parentSessionId:
      typeof raw.parentSessionId === 'string' ? raw.parentSessionId : undefined,
    inheritedContext:
      typeof raw.inheritedContext === 'string'
        ? raw.inheritedContext.slice(0, 40_000)
        : undefined,
    archivedAt: toDate(raw.archivedAt) ?? undefined,
    createdAt: toDateOrNow(raw.createdAt),
    updatedAt: toDateOrNow(raw.updatedAt),
  }
}

export interface ChatSessionsState {
  sessions: ChatSession[]
  loading: boolean
  error: string | null
}

export function useRecentChatSessions(uid: string | undefined, max = 20): ChatSessionsState {
  const [state, setState] = useState<ChatSessionsState>({ sessions: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ sessions: [], loading: false, error: null })
      return
    }
    const q = query(
      collection(db, 'users', uid, 'chatSessions'),
      orderBy('updatedAt', 'desc'),
      limit(max)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const sessions = snap.docs.map((d) => decodeSession(d.data() as Raw, d.id))
        setState({ sessions, loading: false, error: null })
      },
      (err) => setState({ sessions: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid, max])

  return state
}

export interface ChatSessionState {
  session: ChatSession | null
  loading: boolean
  error: string | null
  notFound: boolean
}

export function useChatSession(uid: string | undefined, sessionId: string | undefined): ChatSessionState {
  const [state, setState] = useState<ChatSessionState>({
    session: null,
    loading: true,
    error: null,
    notFound: false,
  })

  useEffect(() => {
    if (!uid || !sessionId) {
      setState({ session: null, loading: false, error: null, notFound: false })
      return
    }
    setState({ session: null, loading: true, error: null, notFound: false })
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'chatSessions', sessionId),
      (snap) => {
        if (!snap.exists()) {
          setState({ session: null, loading: false, error: null, notFound: true })
          return
        }
        const session = decodeSession(snap.data() as Raw, snap.id)
        setState({ session, loading: false, error: null, notFound: false })
      },
      (err) => setState({ session: null, loading: false, error: err.message, notFound: false })
    )
    return () => unsub()
  }, [uid, sessionId])

  return state
}

export async function saveChatSession(uid: string, session: ChatSession): Promise<void> {
  const payload: Record<string, unknown> = {
    id: session.id,
    title: session.title,
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.localOnly
        ? 'Sensitive connected-service output was not saved to chat history.'
        : m.content,
      timestamp: m.timestamp,
      ...(m.provider ? { provider: m.provider } : {}),
      ...(m.agentMode ? { agentMode: m.agentMode } : {}),
      ...(m.taskExpectation
        ? { taskExpectation: m.taskExpectation }
        : {}),
      ...(m.artifact ? { artifact: m.artifact } : {}),
      ...(m.steps && m.steps.length > 0
        ? {
            steps: m.steps.map((s) => ({
              name: s.name,
              summary: s.summary,
              ...(s.agent ? { agent: s.agent } : {}),
              ...(s.rationale ? { rationale: s.rationale } : {}),
              ...(typeof s.ms === 'number' && Number.isFinite(s.ms)
                ? { ms: Math.min(24 * 60 * 60 * 1_000, Math.max(0, s.ms)) }
                : {}),
              ...(s.resultMeta ? { resultMeta: s.resultMeta } : {}),
              ...(s.failed ? { failed: true } : {}),
              ...(s.sub ? { sub: true } : {}),
              // Persist content-free change metadata for file mutations so a
              // restored session reports real +/− counts and file names.
              // before/after/body content stays local-session only.
              ...(s.preview && PERSISTED_STEP_PREVIEW_TOOLS.has(s.name)
                ? {
                    preview: {
                      kind: s.preview.kind,
                      title: s.preview.title.slice(0, 240),
                      ...(s.preview.filePath
                        ? { filePath: s.preview.filePath.slice(0, 1_000) }
                        : {}),
                      ...(typeof s.preview.additions === 'number'
                        ? { additions: s.preview.additions }
                        : {}),
                      ...(typeof s.preview.deletions === 'number'
                        ? { deletions: s.preview.deletions }
                        : {}),
                      ...(s.preview.checkpointId
                        ? { checkpointId: s.preview.checkpointId }
                        : {}),
                    },
                  }
                : {}),
            })),
          }
        : {}),
      ...(typeof m.creditsCharged === 'number' && m.creditsCharged > 0
        ? { creditsCharged: m.creditsCharged }
        : {}),
      ...(m.citations && m.citations.length > 0 ? { citations: m.citations } : {}),
      ...(typeof m.durationMs === 'number' && Number.isFinite(m.durationMs)
        ? {
            durationMs: Math.min(
              24 * 60 * 60 * 1_000,
              Math.max(0, m.durationMs)
            ),
          }
        : {}),
      ...(m.localOnly ? { localOnly: true } : {}),
      ...(m.operational ? { operational: true } : {}),
      ...(m.operational && m.operationalState
        ? { operationalState: m.operationalState }
        : {}),
      ...(m.operational && m.operationalKey
        ? { operationalKey: m.operationalKey.slice(0, 500) }
        : {}),
      ...(m.interruptedRun
        ? {
            interruptedRun: {
              runId: m.interruptedRun.runId.slice(0, 320),
              ...(m.interruptedRun.sessionId
                ? { sessionId: m.interruptedRun.sessionId.slice(0, 160) }
                : {}),
              ...(m.interruptedRun.messageId
                ? { messageId: m.interruptedRun.messageId.slice(0, 160) }
                : {}),
              ...(m.interruptedRun.workspaceId
                ? { workspaceId: m.interruptedRun.workspaceId.slice(0, 160) }
                : {}),
              ...(m.interruptedRun.workspaceLabel
                ? {
                    workspaceLabel:
                      m.interruptedRun.workspaceLabel.slice(0, 120),
                  }
                : {}),
              ...(m.interruptedRun.workspaceRoots?.length
                ? {
                    workspaceRoots: m.interruptedRun.workspaceRoots
                      .slice(0, 24)
                      .map((root) => root.slice(0, 2_000)),
                  }
                : {}),
            },
          }
        : {}),
      ...(m.attachments && m.attachments.length > 0
        ? { attachments: m.attachments.slice(0, 20) }
        : {}),
    })),
    mode: session.mode,
    ...(session.contextScope ? { contextScope: session.contextScope } : {}),
    ...(session.projectId ? { projectId: session.projectId } : {}),
    ...(session.projectLabel ? { projectLabel: session.projectLabel } : {}),
    ...(session.projectRoots && session.projectRoots.length > 0
      ? { projectRoots: session.projectRoots.slice(0, 24) }
      : {}),
    createdAt: session.createdAt,
    updatedAt: new Date(),
    ...(session.lastProvider ? { lastProvider: session.lastProvider } : {}),
    ...(session.parentSessionId
      ? { parentSessionId: session.parentSessionId }
      : {}),
    ...(session.inheritedContext
      ? { inheritedContext: session.inheritedContext.slice(0, 40_000) }
      : {}),
    archivedAt: session.archivedAt ?? null,
  }
  await setDoc(doc(db, 'users', uid, 'chatSessions', session.id), payload, { merge: true })
}

function decodeInterruptedRunReference(
  value: unknown
): InterruptedRunReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Raw
  if (typeof raw.runId !== 'string' || !raw.runId.trim()) return undefined
  const roots = Array.isArray(raw.workspaceRoots)
    ? raw.workspaceRoots
        .filter((root): root is string => typeof root === 'string' && root.length > 0)
        .slice(0, 24)
        .map((root) => root.slice(0, 2_000))
    : undefined
  return {
    runId: raw.runId.slice(0, 320),
    sessionId:
      typeof raw.sessionId === 'string' ? raw.sessionId.slice(0, 160) : undefined,
    messageId:
      typeof raw.messageId === 'string' ? raw.messageId.slice(0, 160) : undefined,
    workspaceId:
      typeof raw.workspaceId === 'string'
        ? raw.workspaceId.slice(0, 160)
        : undefined,
    workspaceLabel:
      typeof raw.workspaceLabel === 'string'
        ? raw.workspaceLabel.slice(0, 120)
        : undefined,
    workspaceRoots: roots?.length ? roots : undefined,
  }
}

export async function deleteChatSession(uid: string, sessionId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'chatSessions', sessionId))
}

export function titleFromFirstMessage(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 50) return trimmed || 'Conversation'
  return trimmed.slice(0, 47) + '…'
}
