const assert = require('node:assert/strict')
const test = require('node:test')
const {
  WORKSPACE_BINDING_UNAVAILABLE_ERROR,
  WorkspaceBindingRuntime,
} = require('./workspace-binding-runtime.cjs')

const ORIGINAL_ID = '0123456789abcdefabcd'
const NEXT_ID = 'fedcba9876543210fedc'

test('a running task keeps its captured workspace after the visible workspace changes', async () => {
  let current = snapshot(ORIGINAL_ID, '/Projects/Original')
  const runtime = new WorkspaceBindingRuntime({
    currentSnapshot: () => current,
  })
  runtime.remember(current)
  current = snapshot(NEXT_ID, '/Projects/Next')

  await runtime.run({ workspaceId: ORIGINAL_ID }, async () => {
    assert.deepEqual(runtime.activeSnapshot().roots, ['/Projects/Original'])
    await Promise.resolve()
    runtime.assert({ workspaceId: ORIGINAL_ID })
    assert.deepEqual(runtime.activeSnapshot().roots, ['/Projects/Original'])
  })

  assert.deepEqual(runtime.activeSnapshot().roots, ['/Projects/Next'])
})

test('parallel tasks retain independent workspace scopes', async () => {
  let current = snapshot(ORIGINAL_ID, '/Projects/Original')
  const runtime = new WorkspaceBindingRuntime({
    currentSnapshot: () => current,
  })
  runtime.remember(current)
  current = snapshot(NEXT_ID, '/Projects/Next')
  runtime.remember(current)

  const roots = await Promise.all([
    runtime.run({ workspaceId: ORIGINAL_ID }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return runtime.activeSnapshot().roots[0]
    }),
    runtime.run({ workspaceId: NEXT_ID }, async () => {
      await Promise.resolve()
      return runtime.activeSnapshot().roots[0]
    }),
  ])

  assert.deepEqual(roots, ['/Projects/Original', '/Projects/Next'])
})

test('restores a task workspace from trusted recent-workspace state', () => {
  const runtime = new WorkspaceBindingRuntime({
    currentSnapshot: () => snapshot(NEXT_ID, '/Projects/Next'),
    lookupSnapshot: (workspaceId) =>
      workspaceId === ORIGINAL_ID
        ? snapshot(ORIGINAL_ID, '/Projects/Original')
        : null,
  })

  runtime.run({ workspaceId: ORIGINAL_ID }, () => {
    assert.deepEqual(runtime.activeSnapshot().roots, ['/Projects/Original'])
  })
})

test('rejects unknown or malformed workspace bindings', () => {
  const runtime = new WorkspaceBindingRuntime({
    currentSnapshot: () => snapshot(NEXT_ID, '/Projects/Next'),
  })
  for (const binding of [
    { workspaceId: ORIGINAL_ID },
    { workspaceId: '../../Projects/Other' },
  ]) {
    assert.throws(
      () => runtime.run(binding, () => {}),
      (error) =>
        error?.code === 'WORKSPACE_BINDING_UNAVAILABLE' &&
        error.message === WORKSPACE_BINDING_UNAVAILABLE_ERROR
    )
  }
})

function snapshot(workspaceId, root) {
  return {
    workspaceId,
    roots: [root],
    looseFiles: [],
    importedWorkspace: null,
  }
}
