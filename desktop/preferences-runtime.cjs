function defaultDesktopPreferences() {
  return {
    version: 1,
    orchestrationPolicyVersion: 2,
    intelligenceUpdatesPolicyVersion: 2,
    modelSettings: null,
    inlineCompletions: false,
    agentMode: 'auto',
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

function preferencesWithUpdate(current, input) {
  const source = input != null && typeof input === 'object' ? input : {}
  return {
    orchestrationPolicyVersion: 2,
    intelligenceUpdatesPolicyVersion: 2,
    modelSettings: Object.prototype.hasOwnProperty.call(source, 'modelSettings')
      ? source.modelSettings
      : current.modelSettings,
    inlineCompletions: Object.prototype.hasOwnProperty.call(source, 'inlineCompletions')
      ? source.inlineCompletions
      : current.inlineCompletions,
    agentMode: Object.prototype.hasOwnProperty.call(source, 'agentMode')
      ? source.agentMode
      : current.agentMode,
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
}
