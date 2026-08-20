import { describe, expect, it } from 'vitest'
import type { ModelControlsValue } from '../../components/assistant/ModelControls'
import type { DesktopProviderId } from '../desktop'
import { CHAT_MODELS, type ChatModelOption } from './providers'
import {
  availableSubagentModelChoices,
  hasPersistedModelIdentity,
  hasRestorableModelIdentity,
  restoredDirectModel,
  subagentModelValue,
  subagentRoute,
  supportsHelperControls,
  toAgentSubagentModel,
} from './subagentModel'

const managedModel = CHAT_MODELS.find(
  (candidate) => candidate.id === 'gpt-5.6-sol'
) as ChatModelOption
const directOnlyModel = CHAT_MODELS.find(
  (candidate) => candidate.id === 'gemini-3.1-pro-preview'
) as ChatModelOption

describe('helper model preferences', () => {
  it('keeps helper controls available in read-only and action modes', () => {
    const modes = ['auto', 'ask', 'plan', 'debug', 'agent'] as const
    expect(
      modes.map((mode) => supportsHelperControls(mode))
    ).toEqual([true, true, true, true, true])
  })

  it('preserves the selected route instead of silently changing billing paths', () => {
    expect(
      subagentRoute(
        subagentModelValue(managedModel, 'direct'),
        new Set<DesktopProviderId>()
      )
    ).toBeNull()
    expect(
      subagentRoute(
        subagentModelValue(directOnlyModel, 'managed'),
        new Set<DesktopProviderId>(['google'])
      )
    ).toBeNull()
  })

  it('offers every runnable route independently of the parent route', () => {
    const nonAgentic = {
      ...managedModel,
      id: 'non-agentic',
      agentic: false,
    }
    const configured = new Set<DesktopProviderId>(['openai', 'google'])
    const choices = availableSubagentModelChoices(
      [managedModel, directOnlyModel, nonAgentic],
      configured,
      null
    )
    expect(choices).toEqual([
      {
        key: 'managed:gpt-5.6-sol',
        model: managedModel,
        executionRoute: 'managed',
        label: 'GPT-5.6 Sol · StatsKey',
      },
      {
        key: 'direct:gpt-5.6-sol',
        model: managedModel,
        executionRoute: 'direct',
        label: 'GPT-5.6 Sol · My key',
      },
      {
        key: 'direct:gemini-3.1-pro-preview',
        model: directOnlyModel,
        executionRoute: 'direct',
        label: 'Gemini 3.1 Pro · My key',
      },
    ])
  })

  it('keeps managed routes available when no direct provider is configured', () => {
    const selectedDirect = subagentModelValue(managedModel, 'direct')
    const choices = availableSubagentModelChoices(
      [managedModel],
      new Set<DesktopProviderId>(),
      selectedDirect
    )
    expect(choices.map((choice) => choice.key)).toEqual([
      'managed:gpt-5.6-sol',
    ])
  })

  it('retains direct model picker identity across preference restoration', () => {
    const restored = restoredDirectModel({
      modelKey: 'direct:azure-openai:deployment-a',
      provider: 'azure',
      providerId: 'azure-openai',
      modelId: 'deployment-a',
      label: 'Deployment A',
      providerLabel: 'Azure',
      dotColor: '#0078D4',
    })
    expect(restored.id).toBe('direct:azure-openai:deployment-a')
  })

  it('treats identity-less persisted data as inheritance', () => {
    expect(hasPersistedModelIdentity({})).toBe(false)
    expect(hasPersistedModelIdentity({ modelKey: '   ' })).toBe(false)
    expect(
      hasRestorableModelIdentity(
        { modelKey: 'retired-model' },
        CHAT_MODELS
      )
    ).toBe(false)
    expect(
      hasPersistedModelIdentity({
        modelId: 'deployment-a',
        modelLabel: 'Deployment A',
        directProvider: 'azure-openai',
      })
    ).toBe(true)
  })

  it('falls back to inheritance when an exact custom route is unavailable', () => {
    const unavailable: ModelControlsValue = subagentModelValue(
      managedModel,
      'direct'
    )
    expect(
      toAgentSubagentModel(
        unavailable,
        new Set<DesktopProviderId>()
      )
    ).toBeUndefined()
    expect(
      toAgentSubagentModel(
        unavailable,
        new Set<DesktopProviderId>(['openai'])
      )
    ).toEqual({
      provider: 'chatgpt',
      modelId: 'gpt-5.6-sol',
      executionRoute: 'direct',
      directProvider: 'openai',
    })
  })
})
