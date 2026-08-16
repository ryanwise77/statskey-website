const assert = require('node:assert/strict')
const test = require('node:test')
const {
  defaultDesktopPreferences,
  preferencesWithUpdate,
  sanitizeAgentMode,
} = require('./preferences-runtime.cjs')

test('old and invalid preference files migrate to Automatic', () => {
  assert.equal(sanitizeAgentMode(undefined), 'auto')
  assert.equal(sanitizeAgentMode('read-only'), 'auto')
  assert.equal(defaultDesktopPreferences().agentMode, 'auto')
})

test('valid user choices survive partial preference saves', () => {
  const current = { ...defaultDesktopPreferences(), agentMode: 'agent' }
  assert.equal(preferencesWithUpdate(current, { approvalMode: 'everything' }).agentMode, 'agent')
  assert.equal(preferencesWithUpdate(current, { agentMode: 'plan' }).agentMode, 'plan')
})
