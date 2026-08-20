const assert = require('node:assert/strict')
const test = require('node:test')
const {
  defaultDesktopPreferences,
  preferencesWithUpdate,
  sanitizeAgentMode,
  sanitizeDesktopModelSettings,
} = require('./preferences-runtime.cjs')

test('old and invalid preference files migrate to Automatic', () => {
  assert.equal(sanitizeAgentMode(undefined), 'auto')
  assert.equal(sanitizeAgentMode('read-only'), 'auto')
  assert.equal(defaultDesktopPreferences().agentMode, 'auto')
  assert.equal(defaultDesktopPreferences().executePermissionGranted, false)
})

test('valid user choices survive partial preference saves', () => {
  const current = {
    ...defaultDesktopPreferences(),
    agentMode: 'agent',
    subagentModelSettings: { modelKey: 'gpt-5.6-sol' },
  }
  const partial = preferencesWithUpdate(current, {
    approvalMode: 'everything',
  })
  assert.equal(partial.agentMode, 'agent')
  assert.deepEqual(partial.subagentModelSettings, {
    modelKey: 'gpt-5.6-sol',
  })
  assert.equal(partial.executePermissionGranted, false)
  assert.equal(
    preferencesWithUpdate(current, { executePermissionGranted: true })
      .executePermissionGranted,
    true
  )
  assert.equal(preferencesWithUpdate(current, { agentMode: 'plan' }).agentMode, 'plan')
})

test('investigator model defaults to parent inheritance and can be reset', () => {
  const defaults = defaultDesktopPreferences()
  assert.equal(defaults.subagentModelSettings, null)

  const customized = preferencesWithUpdate(defaults, {
    subagentModelSettings: { modelKey: 'claude-sonnet-5' },
  })
  assert.deepEqual(customized.subagentModelSettings, {
    modelKey: 'claude-sonnet-5',
  })
  assert.equal(
    preferencesWithUpdate(customized, { subagentModelSettings: null })
      .subagentModelSettings,
    null
  )
})

test('invalid investigator model data canonicalizes to inheritance', () => {
  assert.equal(
    sanitizeDesktopModelSettings({}, { requireIdentity: true }),
    null
  )
  assert.equal(
    sanitizeDesktopModelSettings(
      { modelKey: '   ', modelId: 'gpt-5.6-sol' },
      { requireIdentity: true }
    ),
    null
  )
  assert.deepEqual(
    sanitizeDesktopModelSettings(
      {
        modelKey: 'gpt-5.6-sol-fast',
        executionRoute: 'direct',
      },
      { requireIdentity: true }
    ),
    {
      modelKey: 'gpt-5.6-sol-fast',
      modelLabel: undefined,
      modelId: undefined,
      provider: undefined,
      directProvider: undefined,
      providerLabel: undefined,
      dotColor: undefined,
      effort: undefined,
      executionRoute: 'direct',
      reasoningMode: undefined,
      contextWindowTokens: undefined,
    }
  )
})
