import { useEffect, useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import {
  anthropicChat,
  listClaudeModels,
  type AnthropicMessage,
  type AnthropicModelRouting,
  type ClaudeCatalog,
  type ClaudeCatalogModel,
  type ClaudeModel,
} from './anthropic'

const functions = getFunctions(firebaseApp, 'us-central1')

// Provider + model catalog mirroring the managed options in the iOS app
// (Views/Flow/ChatView.swift). All three run through the same Cloud Function
// proxies iOS uses, so token metering and tier limits apply identically.

export type ChatProvider = 'claude' | 'chatgpt' | 'grok'

export interface ChatModelOption {
  provider: ChatProvider
  /** Model ID sent to the Cloud Function. */
  modelId: string
  /** Short label for the picker. */
  label: string
  /** Provider display name persisted on messages. */
  providerLabel: string
  /** True when this route runs the full tool-calling agent loop. */
  agentic: boolean
  /** Dot color for the picker, mirroring the iOS provider colors. */
  dotColor: string
  /** Plain-language fit shown in the picker. */
  hint?: string
}

const CLAUDE_DOT = '#D97757'
const AUTO_DOT = '#8B5CF6'

// Shipped snapshot of the Claude catalog. The picker replaces these entries
// with Anthropic's live catalog as soon as it loads (see useChatModels), so a
// retired model disappears and a new one appears without a site deploy. The
// server resolves every Claude ID against the same live catalog, so even a
// stale snapshot still answers on the newest model in the family.
const CLAUDE_SNAPSHOT: ChatModelOption[] = [
  { provider: 'claude', modelId: 'claude-fable-5', label: 'Fable 5', providerLabel: 'Claude', agentic: true, dotColor: '#B45309', hint: 'Deepest Claude for the hardest analysis' },
  { provider: 'claude', modelId: 'claude-opus-5', label: 'Opus 5', providerLabel: 'Claude', agentic: true, dotColor: '#C2416C', hint: 'Complex, multi-step analysis' },
  { provider: 'claude', modelId: 'claude-opus-4-8', label: 'Opus 4.8', providerLabel: 'Claude', agentic: true, dotColor: CLAUDE_DOT, hint: 'Previous-generation deep Claude' },
  { provider: 'claude', modelId: 'claude-sonnet-5', label: 'Sonnet 5', providerLabel: 'Claude', agentic: true, dotColor: CLAUDE_DOT, hint: 'Fast frontier Claude' },
]

const OTHER_MODELS: ChatModelOption[] = [
  { provider: 'chatgpt', modelId: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', providerLabel: 'ChatGPT', agentic: true, dotColor: '#10A37F', hint: 'Balanced OpenAI frontier' },
  { provider: 'chatgpt', modelId: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', providerLabel: 'ChatGPT', agentic: true, dotColor: '#0F766E', hint: 'Highest-capability OpenAI route' },
  { provider: 'grok', modelId: 'grok-4.5', label: 'Grok 4.5', providerLabel: 'Grok', agentic: true, dotColor: '#f5f5f7', hint: 'xAI frontier' },
]

function autoOption(defaultModel: string): ChatModelOption {
  return {
    provider: 'claude',
    modelId: defaultModel,
    label: 'Auto',
    providerLabel: 'Auto',
    agentic: true,
    dotColor: AUTO_DOT,
    hint: 'Picks the right model for the question — recommended',
  }
}

function buildChatModels(claude: ChatModelOption[], defaultModel: string): ChatModelOption[] {
  return [autoOption(defaultModel), ...claude, ...OTHER_MODELS]
}

/** Picker catalog available synchronously (snapshot until the live catalog loads). */
export const CHAT_MODELS: ChatModelOption[] = buildChatModels(CLAUDE_SNAPSHOT, 'claude-sonnet-5')

const CLAUDE_FAMILY_HINTS: Record<string, string> = {
  fable: 'Deepest Claude for the hardest analysis',
  mythos: 'Deepest Claude for the hardest analysis',
  opus: 'Complex, multi-step analysis',
  sonnet: 'Fast frontier Claude',
  haiku: 'Fastest, lightest Claude',
}

const CLAUDE_FAMILY_DOTS: Record<string, string> = {
  fable: '#B45309',
  mythos: '#B45309',
  opus: '#C2416C',
  sonnet: CLAUDE_DOT,
  haiku: '#D9A157',
}

/** "Claude Opus 4.8" → "Opus 4.8". */
export function shortClaudeLabel(model: Pick<ClaudeCatalogModel, 'id' | 'displayName'>): string {
  const stripped = model.displayName.replace(/^claude\s+/i, '').trim()
  return stripped || model.id
}

function catalogToOptions(catalog: ClaudeCatalog): ChatModelOption[] {
  const seen = new Set<string>()
  const currentFamilies = new Set<string>()
  const options: ChatModelOption[] = []
  // The catalog arrives newest-first within each family; the first model of a
  // family is the current generation, older ones stay selectable below it.
  // Haiku stays out of the picker (the agent loop wants a thinking model).
  for (const model of catalog.models) {
    if (model.family === 'haiku' || seen.has(model.id)) continue
    seen.add(model.id)
    const isCurrent = !currentFamilies.has(model.family)
    currentFamilies.add(model.family)
    options.push({
      provider: 'claude',
      modelId: model.id,
      label: shortClaudeLabel(model),
      providerLabel: 'Claude',
      agentic: true,
      dotColor: CLAUDE_FAMILY_DOTS[model.family] ?? CLAUDE_DOT,
      hint: isCurrent
        ? (CLAUDE_FAMILY_HINTS[model.family] ?? 'Claude')
        : `Previous-generation ${model.family === 'opus' ? 'deep' : 'fast'} Claude`,
    })
  }
  return options
}

interface CachedCatalog {
  catalog: ClaudeCatalog
  loadedAt: number
}

const CATALOG_CACHE_KEY = 'statskey.claudeCatalog.v1'
const CATALOG_TTL_MS = 60 * 60 * 1000

let memoryCatalog: CachedCatalog | null = null
let inflight: Promise<ClaudeCatalog | null> | null = null

function readStoredCatalog(): CachedCatalog | null {
  if (memoryCatalog) return memoryCatalog
  try {
    const raw = sessionStorage.getItem(CATALOG_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedCatalog
    if (!parsed || !Array.isArray(parsed.catalog?.models)) return null
    memoryCatalog = parsed
    return parsed
  } catch {
    return null
  }
}

function storeCatalog(catalog: ClaudeCatalog) {
  memoryCatalog = { catalog, loadedAt: Date.now() }
  try {
    sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(memoryCatalog))
  } catch {
    // Private mode or quota: memory cache is enough.
  }
}

/**
 * Loads the live Claude catalog (cached for an hour). Returns null when the
 * catalog is unavailable so callers keep the shipped snapshot.
 */
export async function loadClaudeCatalog(): Promise<ClaudeCatalog | null> {
  const cached = readStoredCatalog()
  if (cached && Date.now() - cached.loadedAt < CATALOG_TTL_MS) return cached.catalog
  if (inflight) return inflight
  inflight = listClaudeModels()
    .then((catalog) => {
      if (catalog && Array.isArray(catalog.models) && catalog.models.length > 0) {
        storeCatalog(catalog)
        return catalog
      }
      return cached?.catalog ?? null
    })
    .catch(() => cached?.catalog ?? null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Picker options for a live catalog (falls back to the shipped snapshot). */
export function chatModelsForCatalog(catalog: ClaudeCatalog | null): ChatModelOption[] {
  if (!catalog || catalog.models.length === 0) return CHAT_MODELS
  const claude = catalogToOptions(catalog)
  if (claude.length === 0) return CHAT_MODELS
  return buildChatModels(claude, catalog.defaultModel || 'claude-sonnet-5')
}

/**
 * Picker catalog that tracks Anthropic's live model list. Starts with the
 * shipped snapshot and swaps in the live catalog once loaded, keeping the
 * selected model stable (by ID) across the swap.
 */
export function useChatModels(): ChatModelOption[] {
  const [models, setModels] = useState<ChatModelOption[]>(() =>
    chatModelsForCatalog(readStoredCatalog()?.catalog ?? null)
  )
  useEffect(() => {
    let cancelled = false
    void loadClaudeCatalog().then((catalog) => {
      if (!cancelled && catalog) setModels(chatModelsForCatalog(catalog))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return models
}

/** Finds the option matching a previously selected one after a catalog swap. */
export function matchChatModel(
  models: ChatModelOption[],
  previous: ChatModelOption | null | undefined
): ChatModelOption {
  if (!previous) return models[0]
  if (previous.label === 'Auto') return models.find((m) => m.label === 'Auto') ?? models[0]
  return (
    models.find((m) => m.provider === previous.provider && m.modelId === previous.modelId) ??
    models.find((m) => m.provider === previous.provider && m.label === previous.label) ??
    models[0]
  )
}

/** Human-readable note when the server answered with a different model. */
export function describeModelRouting(
  routing: AnthropicModelRouting | undefined,
  models: ChatModelOption[] = CHAT_MODELS
): string | null {
  if (!routing || !routing.substituted || !routing.requested) return null
  const label = (id: string) => models.find((m) => m.modelId === id && m.label !== 'Auto')?.label ?? id
  const from = label(routing.requested)
  const to = label(routing.resolved)
  if (from === to) return null
  switch (routing.reason) {
    case 'provider-retired':
    case 'family-upgrade':
      return `${from} is no longer served by Anthropic — answered by ${to}, the newest model in that family.`
    case 'family-fallback':
      return `${from} is unavailable right now — answered by ${to}.`
    case 'legacy-forward':
      return `${from} routes to the current generation — answered by ${to}.`
    default:
      return `Answered by ${to}.`
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  providerLabel: string
}

interface OpenAIStyleMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenAIStyleResponse {
  choices?: Array<{ message?: { content?: string } }>
  content?: string
}

const MANAGED_CALLABLE_TIMEOUT_MS = 4 * 60_000
const openAICall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(
  functions,
  'openAIChat',
  { timeout: MANAGED_CALLABLE_TIMEOUT_MS }
)
const grokCall = httpsCallable<Record<string, unknown>, OpenAIStyleResponse>(
  functions,
  'grokChat',
  { timeout: MANAGED_CALLABLE_TIMEOUT_MS }
)

function toOpenAIMessages(systemPrompt: string, turns: ChatTurn[]): OpenAIStyleMessage[] {
  const messages: OpenAIStyleMessage[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  for (const t of turns) messages.push({ role: t.role, content: t.content })
  return messages
}

function contentFromOpenAIStyle(data: OpenAIStyleResponse): string {
  const fromChoices = data.choices?.[0]?.message?.content
  if (typeof fromChoices === 'string' && fromChoices.length > 0) return fromChoices
  if (typeof data.content === 'string') return data.content
  return ''
}

/** Sends one chat turn through the selected managed provider. */
export async function sendChat(params: {
  model: ChatModelOption
  systemPrompt: string
  turns: ChatTurn[]
}): Promise<ChatResult> {
  const { model, systemPrompt, turns } = params

  if (model.provider === 'claude') {
    const messages: AnthropicMessage[] = turns.map((t) => ({ role: t.role, content: t.content }))
    const resp = await anthropicChat({
      messages,
      systemPrompt,
      model: model.modelId as ClaudeModel,
    })
    return { content: resp.content, providerLabel: model.providerLabel }
  }

  const payload = {
    messages: toOpenAIMessages(systemPrompt, turns),
    model: model.modelId,
  }
  const call = model.provider === 'chatgpt' ? openAICall : grokCall
  const { data } = await call(payload)
  const content = contentFromOpenAIStyle(data)
  if (!content) throw new Error('The model returned an empty response. Please try again.')
  return { content, providerLabel: model.providerLabel }
}
