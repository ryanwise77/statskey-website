import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  CHAT_MODELS,
  formatContextTokens,
  type ChatModelOption,
  type ReasoningEffort,
} from '../../lib/ai/providers'
import {
  MANAGED_TOKEN_PACKS,
  formatUsdPerMillion,
  managedCoverageTokens,
} from '../../lib/ai/modelEconomics'
import { modelMatchesQuery } from '../../lib/ai/modelCatalog'
import {
  getDesktopBridge,
  type DesktopProviderId,
  type DesktopProviderModel,
} from '../../lib/desktop'

interface DiscoveredModel {
  provider: DesktopProviderId
  model: DesktopProviderModel
}

const RECOMMENDED_MODEL_IDS = new Set([
  'auto',
  'claude-sonnet-5',
  'gpt-5.6-sol-fast',
  'kimi-k3',
  'grok-4.6',
])

export interface ModelControlsValue {
  model: ChatModelOption
  effort: ReasoningEffort
  contextWindowTokens: number
  executionRoute: 'managed' | 'direct'
  reasoningMode: 'standard' | 'pro'
}

export function ModelControls({
  value,
  onChange,
  models = CHAT_MODELS,
  configuredProviders = new Set<DesktopProviderId>(),
}: {
  value: ModelControlsValue
  onChange: (next: ModelControlsValue) => void
  models?: ChatModelOption[]
  configuredProviders?: Set<DesktopProviderId>
}) {
  const [open, setOpen] = useState(false)
  const [customProvider, setCustomProvider] = useState<DesktopProviderId>(
    value.model.directProvider
  )
  const [customModelId, setCustomModelId] = useState('')
  const [query, setQuery] = useState('')
  const [catalogFilter, setCatalogFilter] = useState('recommended')
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([])
  const [discoveryState, setDiscoveryState] = useState<
    'idle' | 'loading' | 'ready'
  >('idle')
  const panelId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const catalogModels = useMemo(() => {
    const result = [...models]
    const existing = new Set(
      result.map((model) => `${model.directProvider}:${model.modelId}`)
    )
    for (const discovered of discoveredModels) {
      const key = `${discovered.provider}:${discovered.model.id}`
      if (existing.has(key)) continue
      existing.add(key)
      result.push(customDirectModel(discovered.provider, discovered.model.id))
    }
    return result
  }, [discoveredModels, models])

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return catalogModels.filter((model) => {
      if (normalizedQuery && !modelMatchesQuery(model, normalizedQuery)) {
        return false
      }
      if (normalizedQuery || catalogFilter === 'all') return true
      if (catalogFilter === 'recommended') {
        return RECOMMENDED_MODEL_IDS.has(model.id)
      }
      if (catalogFilter === 'connected') {
        return model.id.startsWith('custom:')
      }
      return model.provider === catalogFilter
    })
  }, [catalogFilter, catalogModels, query])

  useEffect(() => {
    if (!open || configuredProviders.size === 0) return
    const bridge = getDesktopBridge()
    if (!bridge || typeof bridge.providers.models !== 'function') {
      setDiscoveryState('ready')
      return
    }
    let cancelled = false
    setDiscoveryState('loading')
    void Promise.all(
      [...configuredProviders].map(async (provider) => {
        const result = await bridge.providers.models(provider)
        if (!result.ok || !Array.isArray(result.models)) return []
        return result.models.map((model) => ({ provider, model }))
      })
    )
      .then((groups) => {
        if (cancelled) return
        setDiscoveredModels(groups.flat())
        setDiscoveryState('ready')
      })
      .catch(() => {
        if (!cancelled) setDiscoveryState('ready')
      })
    return () => {
      cancelled = true
    }
  }, [configuredProviders, open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => {
      const search = panelRef.current?.querySelector<HTMLElement>(
        '[data-model-search]'
      )
      const closeButton = panelRef.current?.querySelector<HTMLElement>(
        '[data-model-controls-close]'
      )
      const initialFocus = search ?? closeButton
      initialFocus?.focus()
    })
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closePanel()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((element) => !element.hidden)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (!panel.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleDialogKeys, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleDialogKeys, true)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (
      configuredProviders.size > 0 &&
      !configuredProviders.has(customProvider)
    ) {
      setCustomProvider([...configuredProviders][0])
    }
  }, [configuredProviders, customProvider])

  function selectModel(model: ChatModelOption) {
    const effort = model.effortOptions.includes(value.effort)
      ? value.effort
      : model.defaultEffort
    const allowedContext =
      model.contextOptions.includes(value.contextWindowTokens) &&
      value.contextWindowTokens <= model.maxContextTokens
        ? value.contextWindowTokens
        : model.contextOptions.includes(272_000)
          ? 272_000
          : model.contextOptions[model.contextOptions.length - 1]
    const executionRoute =
      value.executionRoute === 'managed' && !model.managedAvailable
        ? 'direct'
        : value.executionRoute
    onChange({
      ...value,
      model,
      effort,
      contextWindowTokens: allowedContext,
      executionRoute,
      reasoningMode: effectiveReasoningMode(model, effort, executionRoute),
    })
  }

  function closePanel() {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const directReady = configuredProviders.has(value.model.directProvider)

  return (
    <div className="model-controls">
      <button
        ref={triggerRef}
        className="model-controls__trigger"
        onClick={() => (open ? closePanel() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        title="Choose a model"
      >
        <span
          className="model-controls__dot"
          style={{ background: value.model.dotColor }}
          aria-hidden="true"
        />
        <b>{value.model.label}</b>
        <span>{effortLabel(value.effort)}</span>
        <span>{formatContextTokens(value.contextWindowTokens)}</span>
        <span>{value.executionRoute === 'direct' ? 'My key' : 'Managed'}</span>
        <span className="model-controls__chevron" aria-hidden="true">⌄</span>
      </button>

      {open &&
        createPortal(
          <div
            className="model-controls__backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) closePanel()
            }}
          >
            <section
              id={panelId}
              ref={panelRef}
              className="model-controls__panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${panelId}-title`}
            >
          <header>
            <div>
              <b id={`${panelId}-title`}>Choose your model</b>
              <p>
                Search curated models with verified pricing, or use any model
                returned by a connected provider.
              </p>
            </div>
            <button
              data-model-controls-close
              onClick={closePanel}
              aria-label="Close model settings"
            >
              ×
            </button>
          </header>

          <div className="model-controls__route" role="radiogroup" aria-label="Model connection">
            <button
              className={value.executionRoute === 'managed' ? 'active' : ''}
              disabled={!value.model.managedAvailable}
              onClick={() =>
                onChange({
                  ...value,
                  executionRoute: 'managed',
                  reasoningMode: effectiveReasoningMode(
                    value.model,
                    value.effort,
                    'managed'
                  ),
                })
              }
              role="radio"
              aria-checked={value.executionRoute === 'managed'}
            >
              <b>Use StatsKey</b>
              <small>
                {value.model.managedAvailable
                  ? 'Easiest. Uses your StatsKey plan and needs no API key.'
                  : 'Not offered for this model. Connect your provider key instead.'}
              </small>
            </button>
            <button
              className={value.executionRoute === 'direct' ? 'active' : ''}
              onClick={() =>
                onChange({
                  ...value,
                  executionRoute: 'direct',
                  reasoningMode: effectiveReasoningMode(
                    value.model,
                    value.effort,
                    'direct'
                  ),
                })
              }
              role="radio"
              aria-checked={value.executionRoute === 'direct'}
            >
              <b>Use my own key</b>
              <small>For people who already have a provider API key.</small>
            </button>
          </div>

          <div className="model-controls__commerce">
            <span>
              <b>Managed credits</b>
              <small>
                Cost-weighted by the provider rate, so lower-cost models run
                farther. Stripe packs:
              </small>
              <small>
                {MANAGED_TOKEN_PACKS.map(
                  (pack) =>
                    `${formatContextTokens(pack.credits)} ${formatPackPrice(pack.priceUsd)}`
                ).join(' · ')}
              </small>
            </span>
            <Link to="/tokens" onClick={closePanel}>
              Buy with Stripe
            </Link>
          </div>

          <div className="model-controls__catalog-tools">
            <label>
              <span aria-hidden="true">⌕</span>
              <input
                data-model-search
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search model, provider, or exact model ID"
                aria-label="Search models"
              />
            </label>
            <div className="model-controls__filters" aria-label="Filter models">
              {[
                ['recommended', 'Recommended'],
                ['all', 'All curated'],
                ['claude', 'Claude'],
                ['chatgpt', 'ChatGPT'],
                ['kimi', 'Kimi'],
                ['gemini', 'Gemini'],
                ['grok', 'Grok'],
                ...(configuredProviders.size > 0
                  ? [
                      [
                        'connected',
                        discoveryState === 'loading'
                          ? 'Discovering…'
                          : `Connected (${discoveredModels.length})`,
                      ],
                    ]
                  : []),
              ].map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className={catalogFilter === filter ? 'active' : ''}
                  onClick={() => {
                    setCatalogFilter(filter)
                    setQuery('')
                  }}
                  aria-pressed={catalogFilter === filter}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="model-controls__models" role="listbox" aria-label="Models">
            {visibleModels.map((model) => (
              <button
                key={model.id}
                className={model.id === value.model.id ? 'active' : ''}
                onClick={() => selectModel(model)}
                role="option"
                aria-selected={model.id === value.model.id}
              >
                <span
                  className="model-controls__model-dot"
                  style={{ background: model.dotColor }}
                  aria-hidden="true"
                />
                <span>
                  <span className="model-controls__model-title">
                    <b>{model.label}</b>
                    {model.badges?.map((badge) => (
                      <em key={badge}>{badge}</em>
                    ))}
                  </span>
                  <small>{model.description}</small>
                  <small className="model-controls__model-price">
                    {model.pricing
                      ? `${formatUsdPerMillion(
                          model.pricing.inputUsdPer1M
                        )} in · ${formatUsdPerMillion(
                          model.pricing.outputUsdPer1M
                        )} out / 1M provider tokens`
                      : 'Provider pricing applies'}
                  </small>
                </span>
                {model.id === value.model.id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
            {visibleModels.length === 0 && (
              <p className="model-controls__empty">
                {value.executionRoute === 'direct' && configuredProviders.size > 0
                  ? 'No matching model was returned. Enter an exact model ID below.'
                  : configuredProviders.size > 0
                    ? 'No matching managed model was found. Choose “Use my own key” to enter an exact model ID.'
                    : 'No matching curated model was found. Connect a provider to use any model it offers.'}
              </p>
            )}
          </div>

          <ModelPriceExplanation value={value} closePanel={closePanel} />

          {value.executionRoute === 'direct' && configuredProviders.size > 0 && (
            <form
              className="model-controls__custom"
              onSubmit={(event) => {
                event.preventDefault()
                const modelId = customModelId.trim()
                if (!modelId || !configuredProviders.has(customProvider)) return
                selectModel(customDirectModel(customProvider, modelId))
                setCustomModelId('')
              }}
            >
              <select
                value={customProvider}
                onChange={(event) =>
                  setCustomProvider(event.target.value as DesktopProviderId)
                }
                aria-label="Custom model provider"
              >
                {[...configuredProviders].map((provider) => (
                  <option key={provider} value={provider}>
                    {providerName(provider)}
                  </option>
                ))}
              </select>
              <input
                value={customModelId}
                onChange={(event) => setCustomModelId(event.target.value)}
                placeholder="Exact model ID"
                aria-label="Exact model ID"
                spellCheck={false}
              />
              <button type="submit">Use model</button>
            </form>
          )}

          {value.executionRoute === 'direct' && !directReady && (
            <p className="model-controls__notice">
              Add {value.model.providerLabel} credentials before using this route.
              {' '}<Link to="/models" onClick={closePanel}>Open Models & keys</Link>
            </p>
          )}

          <div className="model-controls__setting">
            <span>
              <b>Thinking depth</b>
              <small>
                Higher can help with harder tasks but may take longer.
              </small>
            </span>
            <div role="radiogroup" aria-label="Reasoning effort">
              {value.model.effortOptions.map((effort) => (
                <button
                  key={effort}
                  className={effort === value.effort ? 'active' : ''}
                  onClick={() =>
                    onChange({
                      ...value,
                      effort,
                      reasoningMode: effectiveReasoningMode(
                        value.model,
                        effort,
                        value.executionRoute
                      ),
                    })
                  }
                  role="radio"
                  aria-checked={effort === value.effort}
                >
                  {effortLabel(effort)}
                </button>
              ))}
            </div>
          </div>

          <div className="model-controls__setting">
            <span>
              <b>Working memory</b>
              <small>How much of this chat and workspace the model can consider at once.</small>
            </span>
            <div role="radiogroup" aria-label="Context window">
              {value.model.contextOptions.map((tokens) => (
                <button
                  key={tokens}
                  className={tokens === value.contextWindowTokens ? 'active' : ''}
                  onClick={() => onChange({ ...value, contextWindowTokens: tokens })}
                  role="radio"
                  aria-checked={tokens === value.contextWindowTokens}
                >
                  {formatContextTokens(tokens)}
                </button>
              ))}
            </div>
          </div>

          {value.model.modelId === 'claude-fable-5' && (
            <p className="model-controls__notice">
              Fable 5 supports a 1M-token provider window. The selected budget limits
              what StatsKey assembles for each turn.
            </p>
          )}
              <footer className="model-controls__footer">
                <span>
                  <b>{value.model.label}</b>
                  <small>
                    {effortLabel(value.effort)} thinking ·{' '}
                    {formatContextTokens(value.contextWindowTokens)} memory ·{' '}
                    {value.executionRoute === 'direct' ? 'My key' : 'StatsKey'}
                  </small>
                </span>
                <button type="button" onClick={closePanel}>
                  Done
                </button>
              </footer>
            </section>
          </div>,
          document.body
        )}
    </div>
  )
}

function effortLabel(effort: ReasoningEffort): string {
  if (effort === 'xhigh') return 'Extra high'
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

function effectiveReasoningMode(
  model: ChatModelOption,
  effort: ReasoningEffort,
  route: 'managed' | 'direct'
): 'standard' | 'pro' {
  return route === 'direct' &&
    model.provider === 'chatgpt' &&
    effort === 'max'
    ? 'pro'
    : 'standard'
}

function ModelPriceExplanation({
  value,
  closePanel,
}: {
  value: ModelControlsValue
  closePanel: () => void
}) {
  const pricing = value.model.pricing
  if (!pricing) {
    return (
      <div className="model-controls__price-explanation">
        <span>
          <b>Provider-priced model</b>
          <small>
            This discovered model uses your own key. Check its provider for the
            current rate before running a large task.
          </small>
        </span>
      </div>
    )
  }

  const cached = pricing.cachedInputUsdPer1M
  const inputCoverage = managedCoverageTokens(pricing.inputUsdPer1M)
  const outputCoverage = managedCoverageTokens(pricing.outputUsdPer1M)
  return (
    <div className="model-controls__price-explanation">
      <span>
        <b>What {value.model.label} costs</b>
        <small>
          Provider list price: {formatUsdPerMillion(pricing.inputUsdPer1M)} input
          {cached != null
            ? ` · ${formatUsdPerMillion(cached)} cached input`
            : ''}
          {' · '}
          {formatUsdPerMillion(pricing.outputUsdPer1M)} output per 1M tokens.
        </small>
        {value.executionRoute === 'managed' ? (
          <small>
            1M StatsKey credits covers about{' '}
            {formatContextTokens(inputCoverage)} input-only or{' '}
            {formatContextTokens(outputCoverage)} output-only tokens. Actual
            tasks use a mix.
          </small>
        ) : (
          <small>Your provider bills these charges directly to your key.</small>
        )}
        {pricing.note && <small>{pricing.note}</small>}
      </span>
      <span className="model-controls__price-links">
        <a href={pricing.sourceUrl} target="_blank" rel="noreferrer">
          Official pricing
        </a>
        {value.executionRoute === 'managed' && (
          <Link to="/tokens" onClick={closePanel}>
            Buy credits
          </Link>
        )}
      </span>
    </div>
  )
}

function customDirectModel(
  providerId: DesktopProviderId,
  modelId: string
): ChatModelOption {
  const metadata: Record<
    DesktopProviderId,
    {
      provider: ChatModelOption['provider']
      label: string
      color: string
    }
  > = {
    anthropic: { provider: 'claude', label: 'Claude', color: '#D97757' },
    openai: { provider: 'chatgpt', label: 'ChatGPT', color: '#10A37F' },
    google: { provider: 'gemini', label: 'Gemini', color: '#4285F4' },
    xai: { provider: 'grok', label: 'Grok', color: '#334155' },
    moonshot: { provider: 'kimi', label: 'Kimi', color: '#5B5BD6' },
    'azure-openai': { provider: 'azure', label: 'Azure', color: '#0078D4' },
    'aws-bedrock': { provider: 'bedrock', label: 'Bedrock', color: '#FF9900' },
    'openai-compatible': {
      provider: 'compatible',
      label: 'Custom',
      color: '#64748B',
    },
  }
  const provider = metadata[providerId]
  return {
    id: `custom:${providerId}:${modelId}`,
    provider: provider.provider,
    modelId,
    label: modelId,
    providerLabel: provider.label,
    agentic: true,
    dotColor: provider.color,
    description: `Exact ${provider.label} model ID.`,
    maxContextTokens: 1_000_000,
    contextOptions: [64_000, 128_000, 272_000, 1_000_000],
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    directProvider: providerId,
    managedAvailable: false,
  }
}

function providerName(provider: DesktopProviderId): string {
  return {
    anthropic: 'Anthropic',
    openai: 'ChatGPT',
    google: 'Google Gemini',
    xai: 'Grok',
    moonshot: 'Kimi by Moonshot',
    'azure-openai': 'Azure',
    'aws-bedrock': 'AWS Bedrock',
    'openai-compatible': 'Compatible endpoint',
  }[provider]
}

function formatPackPrice(priceUsd: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(priceUsd)
}
