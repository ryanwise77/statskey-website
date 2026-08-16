const test = require('node:test')
const assert = require('node:assert/strict')
const { shouldAutoApprove } = require('./approval-policy.cjs')

test('Run without review suppresses every desktop approval prompt', () => {
  for (const kind of [
    'write',
    'delete',
    'terminal',
    'git',
    'mcp',
    'hook',
    'browser',
    'application',
    'device',
  ]) {
    assert.equal(shouldAutoApprove(kind, 'everything'), true)
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
