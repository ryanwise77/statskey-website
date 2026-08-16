const { readFileSync, readdirSync, realpathSync, statSync } = require('node:fs')
const path = require('node:path')
const { minimatch } = require('minimatch')

const DEFAULT_WORKSPACE_SEARCH_IGNORES = Object.freeze([
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/node_modules/**',
  '**/DerivedData/**',
  '**/*.noindex/**',
  '**/.statskey-*-derived/**',
  '**/dist/**',
  '**/dist-*/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/.build/**',
  '**/.gradle/**',
  '**/.venv/**',
  '**/venv/**',
  '**/Pods/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/installed-backups/**',
  '**/.dart_tool/**',
  '**/.vercel/**',
  '**/release*/**',
  '**/out/**',
  '.env',
  '.env.*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '**/.ssh/**',
  '**/.gnupg/**',
  '**/.aws/credentials',
  '**/*credentials*.json',
  '**/*service-account*.json',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa',
  '**/id_ed25519',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
])

function normalizeWorkspaceSearchPath(value) {
  return String(value || '').split(path.sep).join('/')
}

function ignoredWorkspaceSearchPath(relativePath, patterns) {
  return patterns.some((pattern) =>
    minimatch(relativePath, pattern, { dot: true, matchBase: true })
  )
}

function containsPrivateKey(text) {
  return /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(
    String(text || '').slice(0, 64 * 1024)
  )
}

function defaultSensitiveWorkspacePath(candidate, containingRoot = null) {
  if (typeof candidate !== 'string' || !candidate) return true
  const relative = containingRoot
    ? path.relative(containingRoot, candidate)
    : candidate
  return ignoredWorkspaceSearchPath(
    normalizeWorkspaceSearchPath(relative),
    DEFAULT_WORKSPACE_SEARCH_IGNORES
  )
}

function searchWorkspaceDirect(rawQuery, options = {}) {
  const query =
    typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase() : ''
  if (!query || query.length > 200) return []

  const roots = Array.isArray(options.roots) ? options.roots : []
  const looseFiles = Array.isArray(options.looseFiles)
    ? options.looseFiles
    : []
  const canonicalize =
    typeof options.canonicalize === 'function'
      ? options.canonicalize
      : canonicalExistingPath
  const isAllowed =
    typeof options.isAllowed === 'function' ? options.isAllowed : () => false
  const containingRootFor =
    typeof options.containingRootFor === 'function'
      ? options.containingRootFor
      : () => null
  const isIgnored =
    typeof options.isIgnored === 'function' ? options.isIgnored : () => false
  const nodeForPath =
    typeof options.nodeForPath === 'function' ? options.nodeForPath : () => null
  const ignoredNames =
    options.ignoredNames instanceof Set ? options.ignoredNames : new Set()
  const maxFiles = positiveLimit(options.maxFiles, 12_000)
  const maxBytes = positiveLimit(options.maxBytes, 96 * 1024 * 1024)
  const maxFileBytes = positiveLimit(options.maxFileBytes, 512 * 1024)
  const maxResults = positiveLimit(options.maxResults, 100)

  const results = []
  const queue = [...roots, ...looseFiles]
  const visited = new Set()
  let filesSeen = 0
  let bytesScanned = 0

  while (
    queue.length > 0 &&
    filesSeen < maxFiles &&
    results.length < maxResults
  ) {
    const candidate = queue.pop()
    const resolved = canonicalize(candidate)
    if (!resolved || visited.has(resolved) || !isAllowed(resolved)) continue
    const containingRoot = containingRootFor(resolved)
    if (
      defaultSensitiveWorkspacePath(resolved, containingRoot) ||
      isIgnored(resolved)
    ) {
      continue
    }
    visited.add(resolved)

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
      for (const entry of entries) {
        if (!ignoredNames.has(entry.name)) {
          queue.push(path.join(resolved, entry.name))
        }
      }
      continue
    }
    if (!stats.isFile()) continue
    filesSeen += 1

    // Indexed search excludes oversized, binary, and private-key-bearing files
    // completely. Inspect content before returning even a filename match so the
    // direct fallback cannot disclose a sensitive path that the index hides.
    if (
      stats.size > maxFileBytes ||
      bytesScanned + stats.size > maxBytes
    ) {
      continue
    }
    let text
    try {
      const bytes = readFileSync(resolved)
      if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) continue
      bytesScanned += bytes.length
      text = bytes.toString('utf8')
    } catch {
      continue
    }
    if (containsPrivateKey(text)) continue

    const node = nodeForPath(resolved)
    if (!node) continue
    const nameMatches = node.name.toLowerCase().includes(query)
    if (nameMatches) {
      results.push({
        ...node,
        match: 'name',
        line: null,
        preview: node.relativePath,
      })
      if (results.length >= maxResults) break
    }
    const lower = text.toLowerCase()
    const index = lower.indexOf(query)
    if (index === -1) continue
    const line = text.slice(0, index).split('\n').length
    const lineStart = text.lastIndexOf('\n', index - 1) + 1
    const lineEndCandidate = text.indexOf('\n', index)
    const lineEnd = lineEndCandidate === -1 ? text.length : lineEndCandidate
    results.push({
      ...node,
      match: 'content',
      line,
      preview: text.slice(lineStart, lineEnd).trim().slice(0, 240),
    })
  }

  return results.slice(0, maxResults)
}

function positiveLimit(candidate, fallback) {
  return Number.isFinite(candidate) && candidate > 0
    ? Math.floor(candidate)
    : fallback
}

function canonicalExistingPath(candidate) {
  if (typeof candidate !== 'string' || !candidate) return null
  try {
    return realpathSync(candidate)
  } catch {
    return null
  }
}

module.exports = {
  DEFAULT_WORKSPACE_SEARCH_IGNORES,
  containsPrivateKey,
  defaultSensitiveWorkspacePath,
  ignoredWorkspaceSearchPath,
  normalizeWorkspaceSearchPath,
  searchWorkspaceDirect,
}
