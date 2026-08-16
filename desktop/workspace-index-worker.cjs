const { parentPort } = require('node:worker_threads')
const {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const path = require('node:path')
const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} = require('node:crypto')
const {
  DEFAULT_WORKSPACE_SEARCH_IGNORES: DEFAULT_IGNORES,
  containsPrivateKey,
  ignoredWorkspaceSearchPath: ignored,
  normalizeWorkspaceSearchPath: normalizeRelative,
} = require('./workspace-search-runtime.cjs')

const VERSION = 2
const MAX_FILES = 15000
const MAX_TOTAL_BYTES = 192 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOKENS_PER_FILE = 320
const LIVE_FILE_SEARCH_BUDGET_MS = 650
const LOOSE_FILE_ROOT_NAME = 'Added files'
let records = []
let buildingRecords = null
let activeRoots = []
let activeLooseFiles = []
let cachePath = null
let buildSequence = 0

parentPort.on('message', (message) => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'build') {
    void buildIndex(message)
    return
  }
  if (message.type === 'search') {
    searchIndex(message)
  }
})

async function buildIndex(message) {
  const sequence = ++buildSequence
  const roots = normalizeRoots(message.roots)
  const looseFiles = normalizeLooseFiles(message.looseFiles).filter(
    (filePath) => !roots.some((root) => insideRoot(filePath, root.path))
  )
  activeRoots = roots
  activeLooseFiles = looseFiles
  cachePath = typeof message.cachePath === 'string' ? message.cachePath : null
  const cacheKey = decodeCacheKey(message.cacheKey)
  const cached = readCache(cachePath, cacheKey)
  const cachedByPath = new Map(
    cached.records.map((record) => [record.path, record])
  )
  const next = []
  buildingRecords = next
  records = []
  let filesSeen = 0
  let bytesRead = 0
  let reused = 0
  let indexed = 0
  const seenPaths = new Set()
  const perRootLimit = Math.max(750, Math.floor(MAX_FILES / roots.length))
  postStatus('indexing', {
    filesSeen,
    indexed,
    reused,
    rootCount: roots.length,
  })

  for (let looseIndex = 0; looseIndex < looseFiles.length; looseIndex += 1) {
    if (looseIndex > 0 && looseIndex % 16 === 0) await yieldToLoop()
    const resolved = looseFiles[looseIndex]
    if (
      sequence !== buildSequence ||
      filesSeen >= MAX_FILES ||
      bytesRead >= MAX_TOTAL_BYTES
    ) {
      break
    }
    if (seenPaths.has(resolved)) continue
    seenPaths.add(resolved)
    if (ignored(normalizeRelative(resolved), DEFAULT_IGNORES)) continue
    let stats
    try {
      stats = statSync(resolved)
    } catch {
      continue
    }
    if (!stats.isFile()) continue
    filesSeen += 1
    if (stats.size > MAX_FILE_BYTES) continue
    const relative = path.basename(resolved)
    const looseRoot = { path: null, name: LOOSE_FILE_ROOT_NAME }
    const cachedRecord = cachedByPath.get(resolved)
    if (reusableRecord(cachedRecord, stats, looseRoot, relative)) {
      next.push(cachedRecord)
      reused += 1
      continue
    }
    if (bytesRead + stats.size > MAX_TOTAL_BYTES) continue
    let bytes
    try {
      bytes = readFileSync(resolved)
    } catch {
      continue
    }
    if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) {
      continue
    }
    bytesRead += bytes.length
    const text = bytes.toString('utf8')
    if (containsPrivateKey(text)) continue
    next.push(indexRecord(looseRoot, resolved, relative, stats, text))
    indexed += 1
  }

  for (const root of roots) {
    if (sequence !== buildSequence) return
    const patterns = [
      ...DEFAULT_IGNORES,
      ...readIgnorePatterns(root.path),
    ]
    const queue = [root.path]
    let queueIndex = 0
    let rootFilesSeen = 0
    let scannedNodes = 0
    while (
      queueIndex < queue.length &&
      filesSeen < MAX_FILES &&
      rootFilesSeen < perRootLimit &&
      bytesRead < MAX_TOTAL_BYTES
    ) {
      if (sequence !== buildSequence) return
      const candidate = queue[queueIndex++]
      scannedNodes += 1
      if (scannedNodes % 16 === 0) await yieldToLoop()
      const resolved = canonical(candidate)
      if (!resolved || !insideRoot(resolved, root.path)) continue
      const relative = normalizeRelative(path.relative(root.path, resolved))
      if (relative && ignored(relative, patterns)) continue
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
        entries.sort(scanEntryOrder)
        for (const entry of entries) {
          queue.push(path.join(resolved, entry.name))
        }
        continue
      }
      if (!stats.isFile()) continue
      if (seenPaths.has(resolved)) continue
      seenPaths.add(resolved)
      filesSeen += 1
      rootFilesSeen += 1
      if (stats.size > MAX_FILE_BYTES) continue
      const cachedRecord = cachedByPath.get(resolved)
      if (reusableRecord(cachedRecord, stats, root, relative)) {
        next.push(cachedRecord)
        reused += 1
        continue
      }
      if (bytesRead + stats.size > MAX_TOTAL_BYTES) continue
      let bytes
      try {
        bytes = readFileSync(resolved)
      } catch {
        continue
      }
      if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) {
        continue
      }
      bytesRead += bytes.length
      const text = bytes.toString('utf8')
      if (containsPrivateKey(text)) continue
      next.push(indexRecord(root, resolved, relative, stats, text))
      indexed += 1
      if (filesSeen % 250 === 0) {
        postStatus('indexing', {
          filesSeen,
          indexed,
          reused,
          rootCount: roots.length,
        })
        await yieldToLoop()
      }
    }
  }

  if (sequence !== buildSequence) return
  records = next
  buildingRecords = null
  await yieldToLoop()
  if (sequence !== buildSequence) return
  writeCache(cachePath, { version: VERSION, records }, cacheKey)
  postStatus('ready', {
    filesSeen,
    indexed,
    reused,
    indexedFiles: records.length,
    rootCount: roots.length,
    updatedAt: new Date().toISOString(),
  })
}

function searchIndex(message) {
  const requestId = String(message.requestId || '')
  const query = String(message.query || '').trim()
  const requestedMode = message.mode === 'concept' ? 'fuzzy' : message.mode
  const mode = ['files', 'content', 'symbols', 'fuzzy'].includes(requestedMode)
    ? requestedMode
    : 'hybrid'
  if (!query) {
    parentPort.postMessage({ type: 'search-result', requestId, results: [] })
    return
  }
  const queryLower = query.toLowerCase()
  const queryTokens = tokenize(queryLower)
  const queryFeatures = features(queryLower)
  const ranked = []
  const searchableRecords = buildingRecords ?? records

  for (const record of searchableRecords) {
    let score = 0
    let match = 'content'
    let line = null
    let preview = record.relativePath
    const relativeLower = record.relativePath.toLowerCase()
    const nameLower = record.name.toLowerCase()

    if (nameLower === queryLower) score += 180
    else if (nameLower.startsWith(queryLower)) score += 120
    else if (nameLower.includes(queryLower)) score += 85
    if (relativeLower.includes(queryLower)) score += 55

    if (mode === 'files') {
      const fileMatch = fileNameMatch(record.name, record.relativePath, query)
      if (!fileMatch) continue
      score = fileMatch.score
      match = fileMatch.match
      ranked.push({
        name: record.name,
        path: record.path,
        relativePath: record.relativePath,
        kind: 'file',
        extension: record.extension,
        size: record.size,
        modifiedAt: new Date(record.mtimeMs).toISOString(),
        match,
        line: null,
        preview: record.relativePath,
        score: Math.round(score * 10) / 10,
        rootName: record.rootName,
      })
      continue
    }

    if (mode === 'symbols' || mode === 'hybrid') {
      const symbol = record.symbols.find((candidate) =>
        candidate.name.toLowerCase().includes(queryLower)
      )
      if (symbol) {
        score +=
          symbol.name.toLowerCase() === queryLower
            ? 170
            : symbol.name.toLowerCase().startsWith(queryLower)
              ? 120
              : 75
        match = 'symbol'
        line = symbol.line
        preview = `${symbol.kind} ${symbol.name}`
      }
    }

    if (mode !== 'files' && mode !== 'symbols') {
      let matchedTokens = 0
      for (const token of queryTokens) {
        if (record.tokens.includes(token)) matchedTokens += 1
      }
      if (matchedTokens > 0) {
        score += (matchedTokens / Math.max(1, queryTokens.length)) * 90
      }
    }

    if (mode === 'fuzzy' || mode === 'hybrid') {
      const similarity = jaccard(queryFeatures, record.features)
      score += similarity * (mode === 'fuzzy' ? 150 : 55)
      if (similarity > 0.18 && match === 'content') match = 'fuzzy'
    }

    if (mode === 'symbols' && match !== 'symbol') continue
    if (score <= 0) continue

    ranked.push({
      name: record.name,
      path: record.path,
      relativePath: record.relativePath,
      kind: 'file',
      extension: record.extension,
      size: record.size,
      modifiedAt: new Date(record.mtimeMs).toISOString(),
      match,
      line,
      preview,
      score: Math.round(score * 10) / 10,
      rootName: record.rootName,
    })
  }

  if (mode === 'files' && buildingRecords && ranked.length < 40) {
    const seenPaths = new Set(ranked.map((result) => result.path))
    for (const result of searchFileNamesOnDisk(query)) {
      if (seenPaths.has(result.path)) continue
      seenPaths.add(result.path)
      ranked.push(result)
    }
  }

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath)
  )
  const selected = ranked.slice(0, 240)
  for (const result of selected.slice(0, 60)) {
    if (result.match !== 'content' && result.match !== 'fuzzy') continue
    const evidence = livePreview(result.path, queryLower, queryTokens)
    if (!evidence) continue
    result.line = evidence.line
    result.preview = evidence.preview
    if (evidence.literal) result.score += 100
  }
  selected.sort(
    (left, right) =>
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath)
  )
  parentPort.postMessage({
    type: 'search-result',
    requestId,
    results: selected.slice(0, 150),
  })
}

function indexRecord(root, filePath, relativePath, stats, text) {
  const tokenList = [...new Set(tokenize(`${relativePath}\n${text}`))]
    .slice(0, MAX_TOKENS_PER_FILE)
  return {
    path: filePath,
    relativePath,
    rootPath: root.path,
    rootName: root.name,
    name: path.basename(filePath),
    extension: path.extname(filePath).slice(1).toLowerCase(),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    tokens: tokenList,
    features: features(
      `${relativePath} ${tokenList.slice(0, 300).join(' ')}`
    ),
    symbols: extractSymbols(text),
  }
}

function extractSymbols(text) {
  const symbols = []
  const patterns = [
    ['class', /\bclass\s+([A-Za-z_$][\w$]*)/g],
    ['function', /\bfunction\s+([A-Za-z_$][\w$]*)/g],
    ['function', /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g],
    ['type', /\b(?:interface|type|enum|struct|protocol)\s+([A-Za-z_$][\w$]*)/g],
    ['function', /\b(?:func|def|fn)\s+([A-Za-z_$][\w$]*)/g],
    ['heading', /^(#{1,6})\s+(.+)$/gm],
  ]
  for (const [kind, pattern] of patterns) {
    let match
    while ((match = pattern.exec(text)) && symbols.length < 240) {
      const name = kind === 'heading' ? match[2].trim() : match[1]
      if (!name || name.length > 160) continue
      symbols.push({
        name,
        kind,
        line: text.slice(0, match.index).split('\n').length,
      })
    }
  }
  return symbols
}

function livePreview(filePath, query, queryTokens) {
  try {
    const text = readFileSync(filePath, 'utf8')
    const lower = text.toLowerCase()
    let index = lower.indexOf(query)
    let literal = index >= 0
    if (index < 0) {
      for (const token of queryTokens) {
        index = lower.indexOf(token)
        if (index >= 0) break
      }
    }
    if (index < 0) return null
    const line = text.slice(0, index).split('\n').length
    const start = text.lastIndexOf('\n', index - 1) + 1
    const nextLine = text.indexOf('\n', index)
    const end = nextLine === -1 ? text.length : nextLine
    return {
      line,
      literal,
      preview: text.slice(start, end).trim().slice(0, 260),
    }
  } catch {
    return null
  }
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .match(/[a-z_$][a-z0-9_$-]{1,63}|\d{2,}/g) ?? []
}

function features(value) {
  const normalized = String(value).toLowerCase().replace(/\s+/g, ' ')
  const result = new Set()
  for (const token of tokenize(normalized)) result.add(`t:${token}`)
  for (let index = 0; index < normalized.length - 2; index += 1) {
    const trigram = normalized.slice(index, index + 3)
    if (!trigram.includes('\n')) result.add(`g:${trigram}`)
    if (result.size >= 400) break
  }
  return [...result]
}

function jaccard(left, right) {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  let overlap = 0
  for (const item of left) if (rightSet.has(item)) overlap += 1
  return overlap / (left.length + right.length - overlap)
}

function readIgnorePatterns(root) {
  const patterns = []
  for (const name of ['.gitignore', '.cursorignore']) {
    try {
      const text = readFileSync(path.join(root, name), 'utf8').slice(0, 200000)
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
    return [
      {
        path: resolved,
        name:
          typeof candidate.name === 'string' && candidate.name
            ? candidate.name.slice(0, 160)
            : path.basename(resolved),
      },
    ]
  })
}

function normalizeLooseFiles(value) {
  if (!Array.isArray(value)) return []
  const files = []
  const seen = new Set()
  for (const candidate of value.slice(0, MAX_FILES)) {
    if (
      typeof candidate !== 'string' ||
      !candidate ||
      !path.isAbsolute(candidate) ||
      candidate.length > 32_768
    ) {
      continue
    }
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

function reusableRecord(record, stats, root, relativePath) {
  return Boolean(
    record &&
      record.size === stats.size &&
      record.mtimeMs === stats.mtimeMs &&
      record.rootPath === root.path &&
      record.rootName === root.name &&
      record.relativePath === relativePath
  )
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

function entryPriority(name) {
  if (['src', 'app', 'Sources', 'lib', 'packages'].includes(name)) return 20
  if (['test', 'tests', 'Tests', 'docs'].includes(name)) return 10
  if (name.startsWith('.')) return -10
  return 0
}

function scanEntryOrder(left, right) {
  const leftKind = left.isFile() ? 0 : left.isDirectory() ? 1 : 2
  const rightKind = right.isFile() ? 0 : right.isDirectory() ? 1 : 2
  if (leftKind !== rightKind) return leftKind - rightKind
  if (leftKind === 1) {
    const priority = entryPriority(right.name) - entryPriority(left.name)
    if (priority !== 0) return priority
  }
  return left.name.localeCompare(right.name)
}

function liveFileSearchEntryOrder(left, right) {
  const leftKind = left.isDirectory() ? 0 : left.isFile() ? 1 : 2
  const rightKind = right.isDirectory() ? 0 : right.isFile() ? 1 : 2
  if (leftKind !== rightKind) return leftKind - rightKind
  if (leftKind === 0) {
    const priority = entryPriority(right.name) - entryPriority(left.name)
    if (priority !== 0) return priority
  }
  return left.name.localeCompare(right.name)
}

function searchFileNamesOnDisk(query) {
  const results = []
  const seenPaths = new Set()
  const deadline = Date.now() + LIVE_FILE_SEARCH_BUDGET_MS
  const perRootLimit = Math.max(
    750,
    Math.floor(MAX_FILES / Math.max(1, activeRoots.length))
  )

  for (const resolved of activeLooseFiles) {
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
    if (result.score >= 160) return results
  }

  for (const root of activeRoots) {
    const patterns = [
      ...DEFAULT_IGNORES,
      ...readIgnorePatterns(root.path),
    ]
    const queue = [root.path]
    let queueIndex = 0
    let rootFilesSeen = 0
    while (
      queueIndex < queue.length &&
      rootFilesSeen < perRootLimit &&
      results.length < 240
    ) {
      if (queueIndex % 32 === 0 && Date.now() >= deadline) return results
      const resolved = canonical(queue[queueIndex++])
      if (!resolved || !insideRoot(resolved, root.path)) continue
      const relative = normalizeRelative(path.relative(root.path, resolved))
      if (relative && ignored(relative, patterns)) continue
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
        // A live filename query should reach nested source directories before
        // spending its bounded budget walking every file at the current level.
        entries.sort(liveFileSearchEntryOrder)
        for (const entry of entries) {
          queue.push(path.join(resolved, entry.name))
        }
        continue
      }
      if (!stats.isFile()) continue
      rootFilesSeen += 1
      const result = fileNameResult(root, resolved, relative, query, stats)
      if (!result || seenPaths.has(result.path)) continue
      seenPaths.add(result.path)
      results.push(result)
      if (result.score >= 160) return results
    }
  }

  return results
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

function readCache(candidate, key) {
  if (!candidate || !key || !existsSync(candidate)) return { records: [] }
  try {
    const envelope = JSON.parse(readFileSync(candidate, 'utf8'))
    if (
      envelope.version !== VERSION ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' ||
      typeof envelope.ciphertext !== 'string'
    ) {
      return { records: [] }
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    const parsed = JSON.parse(plaintext)
    if (parsed.version !== VERSION || !Array.isArray(parsed.records)) {
      return { records: [] }
    }
    return { records: parsed.records }
  } catch {
    return { records: [] }
  }
}

function writeCache(candidate, payload, key) {
  if (!candidate || !key) return
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ])
    const envelope = {
      version: VERSION,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
    mkdirSync(path.dirname(candidate), { recursive: true, mode: 0o700 })
    const temporary = `${candidate}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(envelope), { mode: 0o600 })
    renameSync(temporary, candidate)
    chmodSync(candidate, 0o600)
  } catch {
    // Search remains available in memory if persistence fails.
  }
}

function decodeCacheKey(value) {
  if (typeof value !== 'string') return null
  try {
    const key = Buffer.from(value, 'base64')
    return key.length === 32 ? key : null
  } catch {
    return null
  }
}

function postStatus(status, details) {
  parentPort.postMessage({ type: 'status', status, ...details })
}

function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}
