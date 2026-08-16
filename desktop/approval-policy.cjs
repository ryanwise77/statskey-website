const AUTO_APPROVED_KINDS = new Set([
  'write',
  'create',
  'rename',
  'mkdir',
])

function normalizeApprovalMode(value) {
  return value === 'everything' || value === 'auto' ? value : 'review'
}

function shouldAutoApprove(kind, approvalMode) {
  const mode = normalizeApprovalMode(approvalMode)
  if (mode === 'everything') return true
  return mode === 'auto' && AUTO_APPROVED_KINDS.has(kind)
}

module.exports = {
  normalizeApprovalMode,
  shouldAutoApprove,
}
