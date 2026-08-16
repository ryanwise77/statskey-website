const { parentPort } = require('node:worker_threads')
const {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} = require('node:fs')
const path = require('node:path')
const {
  DEFAULT_WORKSPACE_SEARCH_IGNORES: DEFAULT_IGNORES,
  containsPrivateKey,
  ignoredWorkspaceSearchPath: ignored,
  normalizeWorkspaceSearchPath: normalizeRelative,
} = require('./workspace-search-runtime.cjs')

const MAX_FILES = 20_000
const MAX_FILE_BYTES = 512 * 1024
const MAX_RESULTS = 150
const SEARCH_BUDGET_MS = 900
const LOOSE_FILE_ROOT_NAME = 'Added files'
let fileRecords = []
let buildingFileRecords = null
let buildSequence = 0

parentPort.on('message', (message) => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'build') {
    void buildFileNames(message)
    return
  }
  if (message.type === 'search') searchFileNames(message)
})

function searchFileNames(message) {
  const requestId = String(message.requestId || '')
  const query = String(message.query || '').trim()
  if (!requestId || !query || query.length > 200) {
    postResults(requestId, [])
    return
  }

  const roots = normalizeRoots(message.roots)
  const looseFiles = normalizeLooseFiles(message.looseFiles)
  const deadline = Date.now() + SEARCH_BUDGET_MS
  const results = []
  const seenPaths = new Set()
  const looseSet = new Set(looseFiles)

  const rankedRecords = []
  for (const record of buildingFileRecords ?? fileRecords) {
    if (
      !looseSet.has(record.path) &&
      !roots.some((root) => insideRoot(record.path, root.path))
    ) {
      continue
    }
    const candidate = fileNameMatch(record.name, record.relativePath, query)
    if (candidate) rankedRecords.push({ record, score: candidate.score })
  }
  rankedRecords.sort(
    (left, right) =>
      right.score - left.score ||
      left.record.relativePath.localeCompare(right.record.relativePath)
  )
  for (const { record } of rankedRecords.slice(0, MAX_RESULTS)) {
    const result = fileNameResult(
      record.root,
      record.path,
      record.relativePath,
      query
    )
    if (!result || seenPaths.has(result.path)) continue
    seenPaths.add(result.path)
    results.push(result)
  }
  if (results.length > 0) {
    postResults(requestId, results)
    return
  }

  for (const resolved of looseFiles) {
    if (ignored(normalizeRelative(resolved), DEFAULT_IGNORES)) continue
    const result = fileNameResult(
      { path: null, name: LOOSE_FILE_ROOT_NAME },
      resolved,
      path.basename(resolved),
      query
    )
    if (!result || seenPaths.has(result.path)) continue
    seenPaths.add(result.path)
    results.push(result)
    if (result.score >= 160) {
      postResults(requestId, results)
      return
    }
  }

  const queue = roots.map((root) => ({
    candidate: root.path,
    root,
    patterns: [...DEFAULT_IGNORES, ...readIgnorePatterns(root.path)],
  }))
  let queueIndex = 0
  let filesSeen = 0
  while (
    queueIndex < queue.length &&
    filesSeen < MAX_FILES &&
    results.length < MAX_RESULTS
  ) {
    if (queueIndex % 16 === 0 && Date.now() >= deadline) break
    const item = queue[queueIndex++]
    const resolved = canonical(item.candidate)
    if (!resolved || !insideRoot(resolved, item.root.path)) continue
    const relative = normalizeRelative(path.relative(item.root.path, resolved))
    if (relative && ignored(relative, item.patterns)) continue

    let stats
    try {
      stats = statSync(resolved)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      let entries
      try {
        entries = readdirSync(resolved, { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((left, right) => scanEntryOrder(left, right, query))
      for (const entry of entries) {
        queue.push({
          candidate: path.join(resolved, entry.name),
          root: item.root,
          patterns: item.patterns,
        })
      }
      continue
    }
    if (!stats.isFile()) continue
    filesSeen += 1
    const result = fileNameResult(
      item.root,
      resolved,
      relative,
      query,
      stats
    )
    if (!result || seenPaths.has(result.path)) continue
    seenPaths.add(result.path)
    results.push(result)
    if (result.score >= 160) break
  }

  results.sort(
    (left, right) =>
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath)
  )
  postResults(requestId, results)
}

async function buildFileNames(message) {
  const sequence = ++buildSequence
  const roots = normalizeRoots(message.roots)
  const looseFiles = normalizeLooseFiles(message.looseFiles)
  const next = []
  buildingFileRecords = next

  for (const resolved of looseFiles) {
    if (sequence !== buildSequence) return
    if (ignored(normalizeRelative(resolved), DEFAULT_IGNORES)) continue
    let stats
    try {
      stats = statSync(resolved)
    } catch {
      continue
    }
    next.push(fileRecord(
      { path: null, name: LOOSE_FILE_ROOT_NAME },
      resolved,
      path.basename(resolved),
      stats
    ))
  }

  const queue = roots.map((root) => ({
    candidate: root.path,
    root,
    patterns: [...DEFAULT_IGNORES, ...readIgnorePatterns(root.path)],
  }))
  let queueIndex = 0
  let filesSeen = 0
  while (queueIndex < queue.length && filesSeen < MAX_FILES) {
    if (sequence !== buildSequence) return
    if (queueIndex > 0 && queueIndex % 32 === 0) await yieldToLoop()
    const item = queue[queueIndex++]
    const resolved = canonical(item.candidate)
    if (!resolved || !insideRoot(resolved, item.root.path)) continue
    const relative = normalizeRelative(path.relative(item.root.path, resolved))
    if (relative && ignored(relative, item.patterns)) continue
    let stats
    try {
      stats = statSync(resolved)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      let entries
      try {
        entries = readdirSync(resolved, { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((left, right) => scanEntryOrder(left, right, ''))
      for (const entry of entries) {
        queue.push({
          candidate: path.join(resolved, entry.name),
          root: item.root,
          patterns: item.patterns,
        })
      }
      continue
    }
    if (!stats.isFile()) continue
    filesSeen += 1
    next.push(fileRecord(item.root, resolved, relative, stats))
  }
  if (sequence !== buildSequence) return
  fileRecords = next
  buildingFileRecords = null
  parentPort.postMessage({
    type: 'build-ready',
    sequence,
    fileCount: fileRecords.length,
  })
}

function fileRecord(root, resolved, relativePath, stats) {
  return {
    root,
    name: path.basename(resolved),
    path: resolved,
    relativePath,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  }
}

function fileNameResult(root, resolved, relativePath, query, knownStats = null) {
  const name = path.basename(resolved)
  const candidate = fileNameMatch(name, relativePath, query)
  if (!candidate) return null
  let stats = knownStats
  try {
    stats ??= statSync(resolved)
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null
    const bytes = readFileSync(resolved)
    if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) return null
    if (containsPrivateKey(bytes.toString('utf8'))) return null
  } catch {
    return null
  }
  return {
    name,
    path: resolved,
    relativePath,
    kind: 'file',
    extension: path.extname(resolved).slice(1).toLowerCase(),
    size: stats.size,
    modifiedAt: new Date(stats.mtimeMs).toISOString(),
    match: candidate.match,
    line: null,
    preview: relativePath,
    score: Math.round(candidate.score * 10) / 10,
    rootName: root.name,
  }
}

function fileNameMatch(name, relativePath, rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase()
  if (!query) return null
  const nameLower = String(name || '').toLowerCase()
  const relativeLower = String(relativePath || '').toLowerCase()
  const depth = Math.max(
    0,
    relativeLower.split('/').filter(Boolean).length - 1
  )
  const proximityBonus = Math.max(0, 24 - depth * 3)
  let score = 0
  if (nameLower === query) score += 180
  else if (nameLower.startsWith(query)) score += 120
  else if (nameLower.includes(query)) score += 85
  if (relativeLower.includes(query)) score += 55
  if (score > 0) return { score: score + proximityBonus, match: 'name' }

  const fuzzyScore = fuzzyFileScore(name, query)
  return fuzzyScore > 0
    ? { score: fuzzyScore + proximityBonus * 0.5, match: 'fuzzy' }
    : null
}

function fuzzyFileScore(rawText, rawQuery) {
  const text = String(rawText || '')
  const query = String(rawQuery || '')
    .toLowerCase()
    .replace(/[\s/_.-]+/g, '')
  if (query.length < 2) return 0

  let queryIndex = 0
  let firstMatch = -1
  let streak = 0
  let score = 0
  for (let index = 0; index < text.length && queryIndex < query.length; index += 1) {
    const character = text[index]
    if (character.toLowerCase() !== query[queryIndex]) {
      streak = 0
      continue
    }
    if (firstMatch < 0) firstMatch = index
    const previous = text[index - 1] || ''
    const boundary =
      index === 0 ||
      /[\s/_.-]/.test(previous) ||
      (/[a-z]/.test(previous) && /[A-Z]/.test(character))
    streak += 1
    score += 8 + streak * 4 + (boundary ? 12 : 0)
    queryIndex += 1
  }
  if (queryIndex !== query.length) return 0
  return Math.max(
    1,
    score - firstMatch * 0.3 - Math.max(0, text.length - query.length) * 0.12
  )
}

function scanEntryOrder(left, right, query) {
  const leftMatch = fileNameMatch(left.name, left.name, query)?.score ?? 0
  const rightMatch = fileNameMatch(right.name, right.name, query)?.score ?? 0
  if (leftMatch !== rightMatch) return rightMatch - leftMatch
  const leftKind = left.isFile() ? 0 : left.isDirectory() ? 1 : 2
  const rightKind = right.isFile() ? 0 : right.isDirectory() ? 1 : 2
  if (leftKind !== rightKind) return leftKind - rightKind
  return left.name.localeCompare(right.name)
}

function readIgnorePatterns(root) {
  const patterns = []
  for (const name of ['.gitignore', '.cursorignore']) {
    try {
      const text = readFileSync(path.join(root, name), 'utf8').slice(0, 200_000)
      for (const line of text.split(/\r?\n/)) {
        const value = line.trim()
        if (!value || value.startsWith('#') || value.startsWith('!')) continue
        patterns.push(value.replace(/^\//, ''))
      }
    } catch {
      // Missing ignore files are normal.
    }
  }
  return patterns
}

function normalizeRoots(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate.path !== 'string') return []
    const resolved = canonical(candidate.path)
    if (!resolved) return []
    try {
      if (!statSync(resolved).isDirectory()) return []
    } catch {
      return []
    }
    return [{
      path: resolved,
      name:
        typeof candidate.name === 'string' && candidate.name
          ? candidate.name.slice(0, 160)
          : path.basename(resolved),
    }]
  })
}

function normalizeLooseFiles(value) {
  if (!Array.isArray(value)) return []
  const files = []
  const seen = new Set()
  for (const candidate of value.slice(0, MAX_FILES)) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue
    const resolved = canonical(candidate)
    if (!resolved || seen.has(resolved)) continue
    try {
      if (!statSync(resolved).isFile()) continue
    } catch {
      continue
    }
    seen.add(resolved)
    files.push(resolved)
  }
  return files
}

function canonical(candidate) {
  try {
    return realpathSync(candidate)
  } catch {
    return null
  }
}

function insideRoot(candidate, root) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function postResults(requestId, results) {
  parentPort.postMessage({
    type: 'search-result',
    requestId,
    results: results.slice(0, MAX_RESULTS),
  })
}

function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}
