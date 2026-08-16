const test = require('node:test')
const assert = require('node:assert/strict')
const { Worker } = require('node:worker_threads')
const {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('workspace filename search stays independent, fuzzy, and private', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'statskey-files-'))
  const firstRoot = path.join(directory, 'first')
  const secondRoot = path.join(directory, 'second')
  mkdirSync(path.join(firstRoot, 'src'), { recursive: true })
  mkdirSync(path.join(secondRoot, 'deep'), { recursive: true })
  writeFileSync(
    path.join(firstRoot, 'src', 'WorkspaceQuickOpen.tsx'),
    'export function WorkspaceQuickOpen() { return null }\n'
  )
  writeFileSync(
    path.join(secondRoot, 'README.md'),
    '# Second workspace\n'
  )
  writeFileSync(
    path.join(secondRoot, 'deep', 'README.md'),
    '# Nested workspace notes\n'
  )
  writeFileSync(
    path.join(secondRoot, 'deep', 'private-readme.txt'),
    '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n'
  )
  writeFileSync(path.join(secondRoot, '.cursorignore'), 'ignored-readme.md\n')
  writeFileSync(path.join(secondRoot, 'ignored-readme.md'), '# ignored\n')

  const worker = new Worker(
    path.join(__dirname, 'workspace-file-search-worker.cjs')
  )
  try {
    await build(worker, [
      { path: firstRoot, name: 'first' },
      { path: secondRoot, name: 'second' },
    ])
    const readme = await search(worker, {
      requestId: 'readme',
      query: 'readme',
      roots: [
        { path: firstRoot, name: 'first' },
        { path: secondRoot, name: 'second' },
      ],
    })
    assert.equal(readme.results[0].name, 'README.md')
    assert.equal(readme.results[0].relativePath, 'README.md')
    assert.equal(
      readme.results.some((result) => result.name === 'private-readme.txt'),
      false
    )
    assert.equal(
      readme.results.some((result) => result.name === 'ignored-readme.md'),
      false
    )

    const fuzzy = await search(worker, {
      requestId: 'fuzzy',
      query: 'wqo',
      roots: [{ path: firstRoot, name: 'first' }],
    })
    assert.equal(fuzzy.results[0].name, 'WorkspaceQuickOpen.tsx')
    assert.equal(fuzzy.results[0].match, 'fuzzy')

    const privateResult = await search(worker, {
      requestId: 'private',
      query: 'private readme',
      roots: [{ path: secondRoot, name: 'second' }],
    })
    assert.equal(privateResult.results.length, 0)

    const ignoredResult = await search(worker, {
      requestId: 'ignored',
      query: 'ignored readme',
      roots: [{ path: secondRoot, name: 'second' }],
    })
    assert.equal(ignoredResult.results.length, 0)
  } finally {
    await worker.terminate()
    rmSync(directory, { recursive: true, force: true })
  }
})

function build(worker, roots) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for filename index.'))
    }, 2_000)
    const onMessage = (result) => {
      if (result.type !== 'build-ready') return
      cleanup()
      resolve(result)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timeout)
      worker.off('message', onMessage)
      worker.off('error', onError)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.postMessage({ type: 'build', roots })
  })
}

function search(worker, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for filename search.'))
    }, 2_000)
    const onMessage = (result) => {
      if (result.requestId !== message.requestId) return
      cleanup()
      resolve(result)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timeout)
      worker.off('message', onMessage)
      worker.off('error', onError)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.postMessage({ type: 'search', ...message })
  })
}
