const test = require('node:test')
const assert = require('node:assert/strict')
const { shouldAutoApprove } = require('./approval-policy.cjs')

test('independent execution only auto-approves reversible workspace edits', () => {
  for (const kind of ['write', 'create', 'rename', 'mkdir']) {
    assert.equal(shouldAutoApprove(kind, 'everything'), true)
  }
  for (const kind of [
    'delete',
    'restore',
    'terminal',
    'git',
    'mcp',
    'hook',
    'browser',
    'application',
    'device',
  ]) {
    assert.equal(shouldAutoApprove(kind, 'everything'), false)
  }
})

test('safe file-edit mode remains narrowly scoped', () => {
  for (const kind of ['write', 'create', 'rename', 'mkdir']) {
    assert.equal(shouldAutoApprove(kind, 'auto'), true)
  }
  for (const kind of ['delete', 'terminal', 'browser', 'application', 'device']) {
    assert.equal(shouldAutoApprove(kind, 'auto'), false)
  }
  assert.equal(shouldAutoApprove('write', 'review'), false)
})
