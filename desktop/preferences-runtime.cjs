function defaultDesktopPreferences() {
  return {
    version: 1,
    orchestrationPolicyVersion: 2,
    intelligenceUpdatesPolicyVersion: 2,
    modelSettings: null,
    subagentModelSettings: null,
    inlineCompletions: false,
    agentMode: 'auto',
    executePermissionGranted: false,
    approvalMode: 'review',
    orchestrationMode: 'adaptive',
    intelligenceUpdates: 'narrated',
    dismissedUpdateVersion: null,
    hookDecisions: {},
  }
}

function sanitizeAgentMode(value) {
  return value === 'ask' ||
    value === 'plan' ||
    value === 'debug' ||
    value === 'agent'
    ? value
    : 'auto'
}

function sanitizeDesktopModelSettings(
  input,
  { requireIdentity = false } = {}
) {
  const raw =
    input != null && typeof input === 'object' && !Array.isArray(input)
      ? input
      : null
  if (!raw) return null
  const stringField = (name, maximum = 240) =>
    typeof raw[name] === 'string' && raw[name].length <= maximum
      ? raw[name]
      : undefined
  const contextWindowTokens = Number(raw.contextWindowTokens)
  const settings = {
    modelKey: stringField('modelKey'),
    modelLabel: stringField('modelLabel'),
    modelId: stringField('modelId'),
    provider: stringField('provider', 40),
    directProvider: stringField('directProvider', 40),
    providerLabel: stringField('providerLabel', 80),
    dotColor: stringField('dotColor', 40),
    effort: stringField('effort', 20),
    executionRoute: stringField('executionRoute', 20),
    reasoningMode: stringField('reasoningMode', 20),
    contextWindowTokens:
      Number.isFinite(contextWindowTokens) &&
      contextWindowTokens >= 16_000 &&
      contextWindowTokens <= 2_000_000
        ? contextWindowTokens
        : undefined,
  }
  const hasCatalogIdentity =
    typeof settings.modelKey === 'string' && settings.modelKey.trim().length > 0
  const hasDirectIdentity =
    typeof settings.modelId === 'string' &&
    settings.modelId.trim().length > 0 &&
    typeof settings.modelLabel === 'string' &&
    settings.modelLabel.trim().length > 0 &&
    typeof settings.directProvider === 'string' &&
    settings.directProvider.trim().length > 0
  return requireIdentity && !hasCatalogIdentity && !hasDirectIdentity
    ? null
    : settings
}

function preferencesWithUpdate(current, input) {
  const source = input != null && typeof input === 'object' ? input : {}
  return {
    orchestrationPolicyVersion: 2,
    intelligenceUpdatesPolicyVersion: 2,
    modelSettings: Object.prototype.hasOwnProperty.call(source, 'modelSettings')
      ? source.modelSettings
      : current.modelSettings,
    subagentModelSettings: Object.prototype.hasOwnProperty.call(
      source,
      'subagentModelSettings'
    )
      ? source.subagentModelSettings
      : current.subagentModelSettings,
    inlineCompletions: Object.prototype.hasOwnProperty.call(source, 'inlineCompletions')
      ? source.inlineCompletions
      : current.inlineCompletions,
    agentMode: Object.prototype.hasOwnProperty.call(source, 'agentMode')
      ? source.agentMode
      : current.agentMode,
    executePermissionGranted: Object.prototype.hasOwnProperty.call(
      source,
      'executePermissionGranted'
    )
      ? source.executePermissionGranted === true
      : current.executePermissionGranted === true,
    approvalMode: Object.prototype.hasOwnProperty.call(source, 'approvalMode')
      ? source.approvalMode
      : current.approvalMode,
    orchestrationMode: Object.prototype.hasOwnProperty.call(source, 'orchestrationMode')
      ? source.orchestrationMode
      : current.orchestrationMode,
    intelligenceUpdates: Object.prototype.hasOwnProperty.call(source, 'intelligenceUpdates')
      ? source.intelligenceUpdates
      : current.intelligenceUpdates,
    dismissedUpdateVersion: current.dismissedUpdateVersion,
    hookDecisions: current.hookDecisions,
  }
}

module.exports = {
  defaultDesktopPreferences,
  preferencesWithUpdate,
  sanitizeAgentMode,
  sanitizeDesktopModelSettings,
}
