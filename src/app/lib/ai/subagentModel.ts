import type { ModelControlsValue } from '../../components/assistant/ModelControls'
import type { DesktopProviderId } from '../desktop'
import type { AgentSubagentModel } from './agent'
import type { AgentModeSelection } from './agentPersistence'
import type { ChatModelOption } from './providers'

export type SubagentExecutionRoute = 'managed' | 'direct'

export interface SubagentModelChoice {
  key: string
  model: ChatModelOption
  executionRoute: SubagentExecutionRoute
  label: string
}

export function supportsHelperControls(mode: AgentModeSelection): boolean {
  return (
    mode === 'auto' ||
    mode === 'ask' ||
    mode === 'plan' ||
    mode === 'debug' ||
    mode === 'agent'
  )
}

export function hasPersistedModelIdentity(input: unknown): boolean {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return false
  }
  const raw = input as Record<string, unknown>
  if (typeof raw.modelKey === 'string' && raw.modelKey.trim()) return true
  return (
    typeof raw.modelId === 'string' &&
    Boolean(raw.modelId.trim()) &&
    typeof raw.modelLabel === 'string' &&
    Boolean(raw.modelLabel.trim()) &&
    typeof raw.directProvider === 'string' &&
    Boolean(raw.directProvider.trim())
  )
}

export function hasRestorableModelIdentity(
  input: unknown,
  catalog: ChatModelOption[]
): boolean {
  if (!hasPersistedModelIdentity(input)) return false
  const raw = input as Record<string, unknown>
  const catalogMatch = catalog.some(
    (candidate) =>
      (typeof raw.modelKey === 'string' &&
        candidate.id === raw.modelKey) ||
      (typeof raw.modelLabel === 'string' &&
        candidate.label === raw.modelLabel)
  )
  if (catalogMatch) return true
  return (
    typeof raw.modelId === 'string' &&
    Boolean(raw.modelId.trim()) &&
    typeof raw.modelLabel === 'string' &&
    Boolean(raw.modelLabel.trim()) &&
    typeof raw.directProvider === 'string' &&
    Boolean(raw.directProvider.trim())
  )
}

export function restoredDirectModel({
  modelKey,
  provider,
  providerId,
  modelId,
  label,
  providerLabel,
  dotColor,
}: {
  modelKey?: string
  provider: ChatModelOption['provider']
  providerId: DesktopProviderId
  modelId: string
  label: string
  providerLabel: string
  dotColor: string
}): ChatModelOption {
  return {
    id:
      typeof modelKey === 'string' && modelKey.trim()
        ? modelKey
        : `custom:${providerId}:${modelId}`,
    provider,
    modelId,
    label,
    providerLabel,
    agentic: true,
    dotColor,
    description: 'Exact model ID saved on this computer.',
    maxContextTokens: 1_000_000,
    contextOptions: [64_000, 128_000, 272_000, 1_000_000],
    effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    directProvider: providerId,
    managedAvailable: false,
  }
}

export function subagentRoute(
  value: ModelControlsValue,
  configuredProviders: Set<DesktopProviderId>
): SubagentExecutionRoute | null {
  if (value.executionRoute === 'managed') {
    return value.model.managedAvailable ? 'managed' : null
  }
  return configuredProviders.has(value.model.directProvider) ? 'direct' : null
}

export function subagentModelValue(
  model: ChatModelOption,
  executionRoute: SubagentExecutionRoute
): ModelControlsValue {
  return {
    model,
    effort: model.effortOptions.includes('low')
      ? 'low'
      : model.defaultEffort,
    contextWindowTokens: model.contextOptions.includes(64_000)
      ? 64_000
      : model.contextOptions[0],
    executionRoute,
    reasoningMode: 'standard',
  }
}

export function subagentModelChoiceKey(
  model: ChatModelOption,
  executionRoute: SubagentExecutionRoute
): string {
  return `${executionRoute}:${model.id}`
}

export function subagentModelChoiceLabel(
  model: ChatModelOption,
  executionRoute: SubagentExecutionRoute
): string {
  return `${model.label} · ${
    executionRoute === 'managed' ? 'StatsKey' : 'My key'
  }`
}

export function availableSubagentModelChoices(
  models: ChatModelOption[],
  configuredProviders: Set<DesktopProviderId>,
  selected: ModelControlsValue | null
): SubagentModelChoice[] {
  const choices = new Map<string, SubagentModelChoice>()
  const add = (
    model: ChatModelOption,
    executionRoute: SubagentExecutionRoute
  ) => {
    const key = subagentModelChoiceKey(model, executionRoute)
    choices.set(key, {
      key,
      model,
      executionRoute,
      label: subagentModelChoiceLabel(model, executionRoute),
    })
  }

  for (const model of models) {
    if (!model.agentic) continue
    // Helper billing is independent of the parent: expose every route that can
    // actually run instead of silently preferring the parent connection.
    if (model.managedAvailable) {
      add(model, 'managed')
    }
    if (configuredProviders.has(model.directProvider)) {
      add(model, 'direct')
    }
  }

  if (selected) {
    const selectedRoute = subagentRoute(selected, configuredProviders)
    if (selectedRoute) add(selected.model, selectedRoute)
  }
  return [...choices.values()]
}

export function toAgentSubagentModel(
  value: ModelControlsValue,
  configuredProviders: Set<DesktopProviderId>
): AgentSubagentModel | undefined {
  const executionRoute = subagentRoute(value, configuredProviders)
  if (!executionRoute) return undefined
  return {
    provider: value.model.provider,
    modelId: value.model.modelId,
    executionRoute,
    directProvider: value.model.directProvider,
    ...(value.model.serviceTier
      ? { serviceTier: value.model.serviceTier }
      : {}),
  }
}
