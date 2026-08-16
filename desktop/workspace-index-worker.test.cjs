const test = require('node:test')
const assert = require('node:assert/strict')
const { Worker } = require('node:worker_threads')
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('workspace index builds privately and ranks files, symbols, and fuzzy matches', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'statskey-index-'))
  const root = path.join(directory, 'workspace')
  const cachePath = path.join(directory, 'cache', 'index.json')
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'packages', 'app', 'node_modules', 'ignored'), {
    recursive: true,
  })
  writeFileSync(
    path.join(root, 'src', 'auth.ts'),
    [
      'export function validateSessionToken(token: string) {',
      '  return token.length > 20',
      '}',
    ].join('\n')
  )
  writeFileSync(
    path.join(root, 'src', 'calendar.ts'),
    'export class CalendarPlanner { schedule() {} }\n'
  )
  writeFileSync(
    path.join(root, 'src', 'WorkspaceQuickOpen.tsx'),
    'export function WorkspaceQuickOpen() { return null }\n'
  )
  writeFileSync(path.join(root, '.env'), 'SECRET=never-index-this\n')
  writeFileSync(path.join(root, '.npmrc'), '//registry/:_authToken=never\n')
  writeFileSync(
    path.join(root, 'accidental-secret.txt'),
    '-----BEGIN PRIVATE KEY-----\nnever-index-this\n-----END PRIVATE KEY-----\n'
  )
  writeFileSync(path.join(root, '.cursorignore'), 'private.txt\n')
  writeFileSync(path.join(root, 'private.txt'), 'hidden-token-value\n')
  writeFileSync(
    path.join(root, 'packages', 'app', 'node_modules', 'ignored', 'index.js'),
    'export const shouldNeverBeIndexed = true\n'
  )

  const worker = new Worker(path.join(__dirname, 'workspace-index-worker.cjs'))
  try {
    const ready = waitFor(worker, (message) =>
      message.type === 'status' && message.status === 'ready'
    )
    worker.postMessage({
      type: 'build',
      roots: [{ path: root, name: 'workspace' }],
      cachePath,
      cacheKey: Buffer.alloc(32, 7).toString('base64'),
    })
    const status = await ready
    assert.equal(status.indexedFiles, 4)
    assert.equal(
      readFileSync(cachePath, 'utf8').includes('validateSessionToken'),
      false
    )

    const symbols = waitFor(
      worker,
      (message) =>
        message.type === 'search-result' && message.requestId === 'symbols'
    )
    worker.postMessage({
      type: 'search',
      requestId: 'symbols',
      query: 'validateSessionToken',
      mode: 'symbols',
    })
    const symbolResult = await symbols
    assert.equal(symbolResult.results[0].name, 'auth.ts')
    assert.equal(symbolResult.results[0].match, 'symbol')

    const fuzzyResults = waitFor(
      worker,
      (message) =>
        message.type === 'search-result' && message.requestId === 'fuzzy'
    )
    worker.postMessage({
      type: 'search',
      requestId: 'fuzzy',
      query: 'session token validation',
      mode: 'fuzzy',
    })
    const fuzzyResult = await fuzzyResults
    assert.equal(fuzzyResult.results[0].name, 'auth.ts')
    assert.equal(
      fuzzyResult.results.some((result) => result.name === '.env'),
      false
    )
    assert.equal(
      fuzzyResult.results.some((result) => result.name === 'private.txt'),
      false
    )

    const quickOpenResults = waitFor(
      worker,
      (message) =>
        message.type === 'search-result' && message.requestId === 'quick-open'
    )
    worker.postMessage({
      type: 'search',
      requestId: 'quick-open',
      query: 'wqo',
      mode: 'files',
    })
    const quickOpenResult = await quickOpenResults
    assert.equal(quickOpenResult.results[0].name, 'WorkspaceQuickOpen.tsx')
    assert.equal(quickOpenResult.results[0].match, 'fuzzy')

    const fileNameOnlyResults = waitFor(
      worker,
      (message) =>
        message.type === 'search-result' && message.requestId === 'file-name-only'
    )
    worker.postMessage({
      type: 'search',
      requestId: 'file-name-only',
      query: 'session token',
      mode: 'files',
    })
    const fileNameOnlyResult = await fileNameOnlyResults
    assert.equal(
      fileNameOnlyResult.results.some((result) => result.name === 'auth.ts'),
      false
    )
  } finally {
    await worker.terminate()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('workspace file search responds while deeper indexing is still running', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'statskey-live-files-'))
  const root = path.join(directory, 'workspace')
  const target = path.join(root, 'deep', 'nested', 'NeedlePanel.tsx')
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, 'export function NeedlePanel() { return null }\n')
  for (let index = 0; index < 180; index += 1) {
    writeFileSync(
      path.join(root, `surface-${String(index).padStart(3, '0')}.txt`),
      `surface file ${index}\n`
    )
  }

  const worker = new Worker(path.join(__dirname, 'workspace-index-worker.cjs'))
  let readySeen = false
  const onMessage = (message) => {
    if (message.type === 'status' && message.status === 'ready') readySeen = true
  }
  worker.on('message', onMessage)
  try {
    const indexing = waitFor(
      worker,
      (message) => message.type === 'status' && message.status === 'indexing'
    )
    worker.postMessage({
      type: 'build',
      roots: [{ path: root, name: 'workspace' }],
      cachePath: path.join(directory, 'cache', 'index.json'),
      cacheKey: Buffer.alloc(32, 9).toString('base64'),
    })
    await indexing

    const liveSearch = waitFor(
      worker,
      (message) =>
        message.type === 'search-result' && message.requestId === 'live-file'
    )
    worker.postMessage({
      type: 'search',
      requestId: 'live-file',
      query: 'needle panel',
      mode: 'files',
    })
    const result = await liveSearch
    assert.equal(result.results[0].path, realpathSync(target))
    assert.equal(result.results[0].match, 'fuzzy')
    assert.equal(readySeen, false)
  } finally {
    worker.off('message', onMessage)
    await worker.terminate()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('workspace index securely includes, labels, deduplicates, and caches added files', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'statskey-loose-index-'))
  const root = path.join(directory, 'workspace')
  const addedDirectory = path.join(directory, 'outside')
  const cachePath = path.join(directory, 'cache', 'index.json')
  const cacheKey = Buffer.alloc(32, 11).toString('base64')
  const addedFile = path.join(addedDirectory, 'calibration-notes.md')
  const addedAlias = path.join(directory, 'calibration-alias.md')
  const privateKey = path.join(addedDirectory, 'private.txt')
  const relativeOnlyFile = path.join(addedDirectory, 'relative-only.txt')
  mkdirSync(root, { recursive: true })
  mkdirSync(addedDirectory, { recursive: true })
  writeFileSync(path.join(root, 'workspace.txt'), 'ordinary workspace evidence\n')
  writeFileSync(
    addedFile,
    '# Calibration\nexternalCalibrationValue should be searchable\n'
  )
  symlinkSync(addedFile, addedAlias)
  writeFileSync(
    privateKey,
    '-----BEGIN PRIVATE KEY-----\nnever-index-this\n-----END PRIVATE KEY-----\n'
  )
  writeFileSync(relativeOnlyFile, 'relative paths are not explicit files\n')

  let worker = new Worker(path.join(__dirname, 'workspace-index-worker.cjs'))
  try {
    const firstReady = waitFor(worker, (message) =>
      message.type === 'status' && message.status === 'ready'
    )
    worker.postMessage({
      type: 'build',
      roots: [{ path: root, name: 'workspace' }],
      looseFiles: [
        addedFile,
        addedAlias,
        addedFile,
        path.join(root, 'workspace.txt'),
        privateKey,
        path.relative(directory, relativeOnlyFile),
        addedDirectory,
        path.join(directory, 'missing.txt'),
      ],
      cachePath,
      cacheKey,
    })
    const firstStatus = await firstReady
    assert.deepEqual(
      {
        indexedFiles: firstStatus.indexedFiles,
        indexed: firstStatus.indexed,
        reused: firstStatus.reused,
      },
      { indexedFiles: 2, indexed: 2, reused: 0 }
    )
    assert.equal(
      readFileSync(cachePath, 'utf8').includes('externalCalibrationValue'),
      false
    )

    const firstSearch = waitFor(
      worker,
      (message) =>
        message.type === 'search-result' && message.requestId === 'loose-first'
    )
    worker.postMessage({
      type: 'search',
      requestId: 'loose-first',
      query: 'externalCalibrationValue',
      mode: 'content',
    })
    const firstResult = await firstSearch
    assert.deepEqual(
      firstResult.results.map((result) => ({
        path: result.path,
        relativePath: result.relativePath,
        rootName: result.rootName,
      })),
      [
        {
          path: realpathSync(addedFile),
          relativePath: 'calibration-notes.md',
          rootName: 'Added files',
        },
      ]
    )

    await worker.terminate()
    worker = new Worker(path.join(__dirname, 'workspace-index-worker.cjs'))
    const cachedReady = waitFor(worker, (message) =>
      message.type === 'status' && message.status === 'ready'
    )
    worker.postMessage({
      type: 'build',
      roots: [{ path: root, name: 'workspace' }],
      looseFiles: [addedAlias],
      cachePath,
      cacheKey,
    })
    const cachedStatus = await cachedReady
    assert.deepEqual(
      {
        indexedFiles: cachedStatus.indexedFiles,
        indexed: cachedStatus.indexed,
        reused: cachedStatus.reused,
      },
      { indexedFiles: 2, indexed: 0, reused: 2 }
    )

    const cachedSearch = waitFor(
      worker,
      (message) =>
        message.type === 'search-result' && message.requestId === 'loose-cache'
    )
    worker.postMessage({
      type: 'search',
      requestId: 'loose-cache',
      query: 'externalCalibrationValue',
      mode: 'content',
    })
    const cachedResult = await cachedSearch
    assert.equal(cachedResult.results[0].rootName, 'Added files')
    assert.equal(cachedResult.results[0].path, realpathSync(addedFile))
  } finally {
    await worker.terminate()
    rmSync(directory, { recursive: true, force: true })
  }
})

function waitFor(worker, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for index worker.'))
    }, 10000)
    const onMessage = (message) => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
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
  })
}
