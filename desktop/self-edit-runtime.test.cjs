const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const {
  REQUIRED_SOURCE_PATHS,
  findStatsKeySource,
  inspectStatsKeySource,
} = require('./self-edit-runtime.cjs')

function makeCheckout(packageValue = { name: 'statskey-desktop', version: '9.8.7' }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'statskey-self-edit-'))
  for (const relativePath of REQUIRED_SOURCE_PATHS) {
    const target = path.join(root, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      relativePath === 'desktop/package.json'
        ? JSON.stringify(packageValue)
        : '// fixture\n'
    )
  }
  return root
}

test('recognizes the StatsKey desktop source checkout', () => {
  const root = makeCheckout()
  assert.deepEqual(inspectStatsKeySource(root), {
    rootPath: root,
    version: '9.8.7',
  })
})

test('rejects a lookalike directory without the StatsKey desktop package', () => {
  const root = makeCheckout({ name: 'different-desktop', version: '1.0.0' })
  assert.equal(inspectStatsKeySource(root), null)
})

test('uses the first valid checkout and ignores duplicate candidates', () => {
  const root = makeCheckout()
  assert.equal(
    findStatsKeySource(['/definitely/missing', root, root])?.rootPath,
    root
  )
})
