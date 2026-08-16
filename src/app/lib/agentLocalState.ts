import type { ChatAttachment } from './chatAttachments'
import type {
  ChatSession,
  ChatSessionMessage,
  InterruptedRunReference,
} from './data/useChatSessions'
import type { WorkspaceProjectBinding } from './workspaceContext'

export interface PersistedQueuedPrompt {
  id: string
  text: string
  attachments: ChatAttachment[]
  messageId?: string
  workspaceBinding?: WorkspaceProjectBinding | null
}

export interface AgentLocalState {
  draft: string
  chatAttachments: ChatAttachment[]
  queuedPrompts: PersistedQueuedPrompt[]
}

const DATABASE_NAME = 'statskey-local-agent-state'
const DATABASE_VERSION = 2
const STORE_NAME = 'drafts-and-queues'
const SESSION_STORE_NAME = 'chat-sessions'
export const LOCAL_CHAT_SESSIONS_EVENT = 'statskey:local-chat-sessions'
export const CHAT_SESSION_LIFECYCLE_EVENT = 'statskey:chat-session-lifecycle'
const DRAFT_SHADOW_PREFIX = 'statskey.local-agent-draft.v1:'
const WORKSPACE_AGENT_SESSION_PREFIX =
  'statskey.workspace-agent-session.v1:'
const MAX_DRAFT_CHARACTERS = 250_000
const MAX_QUEUED_PROMPTS = 8

let databasePromise: Promise<IDBDatabase> | null = null
const memoryFallback = new Map<string, AgentLocalState>()
const memorySessionFallback = new Map<string, ChatSession>()

export function workspaceAgentSessionId(workspaceId?: string | null): string {
  const key = workspaceAgentSessionKey(workspaceId)
  try {
    const stored = localStorage.getItem(key)
    if (isSessionId(stored)) return stored
  } catch {
    // Create an in-memory session below when local storage is unavailable.
  }
  const sessionId = crypto.randomUUID().toUpperCase()
  saveWorkspaceAgentSessionId(workspaceId, sessionId)
  return sessionId
}

export function saveWorkspaceAgentSessionId(
  workspaceId: string | null | undefined,
  sessionId: string
) {
  if (!isSessionId(sessionId)) return
  try {
    localStorage.setItem(workspaceAgentSessionKey(workspaceId), sessionId)
  } catch {
    // The mounted workspace still retains the session for this process.
  }
}

export async function loadAgentLocalState(
  sessionId: string
): Promise<AgentLocalState> {
  const fallback = memoryFallback.get(sessionId) ?? emptyState()
  const shadow = loadAgentDraftShadow(sessionId)
  try {
    const database = await openDatabase()
    const value = await requestResult<unknown>(
      database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(sessionId)
    )
    const state = decodeState(value) ?? fallback
    return shadow == null ? state : { ...state, draft: shadow }
  } catch {
    return shadow == null ? fallback : { ...fallback, draft: shadow }
  }
}

export async function saveAgentLocalState(
  sessionId: string,
  state: AgentLocalState
): Promise<void> {
  const value = sanitizeState(state)
  saveAgentDraftShadow(sessionId, value.draft)
  memoryFallback.set(sessionId, value)
  try {
    const database = await openDatabase()
    await transactionComplete(
      database.transaction(STORE_NAME, 'readwrite'),
      STORE_NAME,
      (store) => store.put({ sessionId, ...value, updatedAt: Date.now() })
    )
  } catch {
    // The in-memory fallback still protects route changes in this process.
  }
}

export async function clearAgentLocalState(sessionId: string): Promise<void> {
  memoryFallback.delete(sessionId)
  try {
    localStorage.removeItem(`${DRAFT_SHADOW_PREFIX}${sessionId}`)
  } catch {
    // Local storage may be unavailable.
  }
  try {
    const database = await openDatabase()
    await transactionComplete(
      database.transaction(STORE_NAME, 'readwrite'),
      STORE_NAME,
      (store) => store.delete(sessionId)
    )
  } catch {
    // Nothing else to clear when local storage is unavailable.
  }
}

export function saveAgentDraftShadow(sessionId: string, draft: string) {
  try {
    localStorage.setItem(
      `${DRAFT_SHADOW_PREFIX}${sessionId}`,
      JSON.stringify({
        draft: draft.slice(0, MAX_DRAFT_CHARACTERS),
        updatedAt: Date.now(),
      })
    )
  } catch {
    // IndexedDB and the in-memory state remain as fallbacks.
  }
}

function loadAgentDraftShadow(sessionId: string): string | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`${DRAFT_SHADOW_PREFIX}${sessionId}`) ?? 'null'
    ) as { draft?: unknown } | null
    return parsed && typeof parsed.draft === 'string' ? parsed.draft : null
  } catch {
    return null
  }
}

function workspaceAgentSessionKey(workspaceId?: string | null): string {
  const scope = String(workspaceId || 'no-project')
    .trim()
    .slice(0, 256) || 'no-project'
  return `${WORKSPACE_AGENT_SESSION_PREFIX}${scope}`
}

function isSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 100 &&
    /^[a-zA-Z0-9-]+$/.test(value)
  )
}

export async function saveLocalChatSession(
  session: ChatSession
): Promise<void> {
  const value = serializeChatSession(session)
  memorySessionFallback.set(session.id, decodeChatSession(value))
  try {
    const database = await openDatabase()
    await transactionComplete(
      database.transaction(SESSION_STORE_NAME, 'readwrite'),
      SESSION_STORE_NAME,
      (store) => store.put(value)
    )
  } catch {
    // The in-memory copy remains available for this process.
  } finally {
    notifyLocalChatSessions()
  }
}

export async function loadLocalChatSession(
  sessionId: string
): Promise<ChatSession | null> {
  try {
    const database = await openDatabase()
    const value = await requestResult<unknown>(
      database
        .transaction(SESSION_STORE_NAME, 'readonly')
        .objectStore(SESSION_STORE_NAME)
        .get(sessionId)
    )
    return value ? decodeChatSession(value) : memorySessionFallback.get(sessionId) ?? null
  } catch {
    return memorySessionFallback.get(sessionId) ?? null
  }
}

export async function listLocalChatSessions(
  maximum = 100
): Promise<ChatSession[]> {
  let sessions: ChatSession[]
  try {
    const database = await openDatabase()
    const values = await requestResult<unknown[]>(
      database
        .transaction(SESSION_STORE_NAME, 'readonly')
        .objectStore(SESSION_STORE_NAME)
        .getAll()
    )
    sessions = values.map(decodeChatSession)
  } catch {
    sessions = [...memorySessionFallback.values()]
  }
  return sessions
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, Math.max(1, Math.min(500, maximum)))
}

export async function deleteLocalChatSession(
  sessionId: string
): Promise<void> {
  memorySessionFallback.delete(sessionId)
  try {
    const database = await openDatabase()
    await transactionComplete(
      database.transaction(SESSION_STORE_NAME, 'readwrite'),
      SESSION_STORE_NAME,
      (store) => store.delete(sessionId)
    )
  } catch {
    // The in-memory copy has still been removed.
  } finally {
    notifyLocalChatSessions()
    window.dispatchEvent(
      new CustomEvent(CHAT_SESSION_LIFECYCLE_EVENT, {
        detail: { sessionId, action: 'delete' },
      })
    )
  }
}

export async function archiveLocalChatSession(
  session: ChatSession,
  archived: boolean
): Promise<ChatSession> {
  const next: ChatSession = {
    ...session,
    archivedAt: archived ? new Date() : undefined,
    updatedAt: new Date(),
  }
  await saveLocalChatSession(next)
  if (archived) {
    window.dispatchEvent(
      new CustomEvent(CHAT_SESSION_LIFECYCLE_EVENT, {
        detail: { sessionId: session.id, action: 'archive' },
      })
    )
  }
  return next
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'sessionId' })
      }
      if (!database.objectStoreNames.contains(SESSION_STORE_NAME)) {
        database.createObjectStore(SESSION_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        databasePromise = null
      }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error('Local Agent state database is blocked.'))
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(
  transaction: IDBTransaction,
  storeName: string,
  mutate: (store: IDBObjectStore) => IDBRequest
): Promise<void> {
  return new Promise((resolve, reject) => {
    mutate(transaction.objectStore(storeName))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function decodeState(value: unknown): AgentLocalState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<AgentLocalState>
  if (typeof record.draft !== 'string') return null
  return sanitizeState({
    draft: record.draft,
    chatAttachments: Array.isArray(record.chatAttachments)
      ? record.chatAttachments.filter(isAttachment)
      : [],
    queuedPrompts: Array.isArray(record.queuedPrompts)
      ? record.queuedPrompts.filter(isQueuedPrompt)
      : [],
  })
}

function isQueuedPrompt(value: unknown): value is PersistedQueuedPrompt {
  if (!value || typeof value !== 'object') return false
  const prompt = value as Partial<PersistedQueuedPrompt>
  return (
    typeof prompt.id === 'string' &&
    typeof prompt.text === 'string' &&
    Array.isArray(prompt.attachments)
  )
}

function isAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Partial<ChatAttachment>
  return (
    typeof attachment.id === 'string' &&
    typeof attachment.name === 'string' &&
    typeof attachment.mediaType === 'string' &&
    typeof attachment.size === 'number' &&
    (attachment.kind === 'text' ||
      attachment.kind === 'image' ||
      attachment.kind === 'pdf' ||
      attachment.kind === 'opaque')
  )
}

function sanitizeState(state: AgentLocalState): AgentLocalState {
  return {
    draft: state.draft.slice(0, MAX_DRAFT_CHARACTERS),
    chatAttachments: state.chatAttachments,
    queuedPrompts: state.queuedPrompts.slice(0, MAX_QUEUED_PROMPTS).map((prompt) => ({
      id: prompt.id,
      text: prompt.text.slice(0, MAX_DRAFT_CHARACTERS),
      attachments: prompt.attachments,
      messageId:
        typeof prompt.messageId === 'string'
          ? prompt.messageId.slice(0, 160)
          : undefined,
      workspaceBinding: sanitizeQueuedWorkspaceBinding(
        prompt.workspaceBinding
      ),
    })),
  }
}

function sanitizeQueuedWorkspaceBinding(
  value: WorkspaceProjectBinding | null | undefined
): WorkspaceProjectBinding | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const id =
    typeof value.id === 'string' && /^[a-f0-9]{20}$/.test(value.id)
      ? value.id
      : undefined
  const roots = Array.isArray(value.roots)
    ? value.roots
        .filter((root): root is string => typeof root === 'string')
        .map((root) => root.slice(0, 2_000))
        .slice(0, 24)
    : []
  if (!id && roots.length === 0) return undefined
  return {
    id,
    label:
      typeof value.label === 'string' && value.label.trim()
        ? value.label.trim().slice(0, 120)
        : 'Workspace',
    roots,
  }
}

function serializeChatSession(session: ChatSession) {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messages: session.messages.map((message) => ({
      ...message,
      content: message.localOnly
        ? 'Sensitive connected-service output was not saved to chat history.'
        : message.content,
      steps: message.localOnly
        ? message.steps?.map(({ preview: _preview, ...step }) => step)
        : message.steps,
      timestamp: message.timestamp.toISOString(),
    })),
  }
}

function decodeChatSession(value: unknown): ChatSession {
  const record =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {}
  const now = new Date()
  return {
    id:
      typeof record.id === 'string'
        ? record.id
        : crypto.randomUUID().toUpperCase(),
    title: typeof record.title === 'string' ? record.title : 'Conversation',
    mode: record.mode === 'training' ? 'training' : 'general',
    contextScope: record.contextScope === 'work' ? 'work' : 'personal',
    projectId:
      typeof record.projectId === 'string'
        ? record.projectId.slice(0, 120)
        : undefined,
    projectLabel:
      typeof record.projectLabel === 'string'
        ? record.projectLabel.slice(0, 120)
        : undefined,
    projectRoots: Array.isArray(record.projectRoots)
      ? record.projectRoots
          .filter((root): root is string => typeof root === 'string')
          .slice(0, 24)
      : undefined,
    messages: Array.isArray(record.messages)
      ? record.messages
          .filter(
            (message): message is Record<string, unknown> =>
              message != null && typeof message === 'object'
          )
          .map(decodeLocalMessage)
      : [],
    lastProvider:
      typeof record.lastProvider === 'string'
        ? record.lastProvider
        : undefined,
    parentSessionId:
      typeof record.parentSessionId === 'string'
        ? record.parentSessionId
        : undefined,
    inheritedContext:
      typeof record.inheritedContext === 'string'
        ? record.inheritedContext
        : undefined,
    archivedAt: safeDate(record.archivedAt) ?? undefined,
    createdAt: safeDate(record.createdAt) ?? now,
    updatedAt: safeDate(record.updatedAt) ?? now,
  }
}

function decodeLocalMessage(
  message: Record<string, unknown>
): ChatSessionMessage {
  const operational = message.operational === true
  return {
    ...(message as unknown as ChatSessionMessage),
    id:
      typeof message.id === 'string'
        ? message.id
        : crypto.randomUUID(),
    role: message.role === 'user' ? 'user' : 'model',
    content: typeof message.content === 'string' ? message.content : '',
    timestamp: safeDate(message.timestamp) ?? new Date(),
    operational: operational || undefined,
    operationalState: operational
      ? message.operationalState === 'running' ||
        message.operationalState === 'error'
        ? message.operationalState
        : 'done'
      : undefined,
    operationalKey:
      operational && typeof message.operationalKey === 'string'
        ? message.operationalKey.slice(0, 500)
        : undefined,
    interruptedRun: decodeInterruptedRunReference(message.interruptedRun),
  }
}

function decodeInterruptedRunReference(
  value: unknown
): InterruptedRunReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.runId !== 'string' || !raw.runId.trim()) return undefined
  const workspaceRoots = Array.isArray(raw.workspaceRoots)
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
    workspaceRoots: workspaceRoots?.length ? workspaceRoots : undefined,
  }
}

function safeDate(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null
  return date && Number.isFinite(date.getTime()) ? date : null
}

function notifyLocalChatSessions() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LOCAL_CHAT_SESSIONS_EVENT))
  }
}

function emptyState(): AgentLocalState {
  return { draft: '', chatAttachments: [], queuedPrompts: [] }
}
