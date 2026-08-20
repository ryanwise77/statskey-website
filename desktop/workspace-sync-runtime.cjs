const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const STATE_ID_PATTERN = /^(ws|bk|tr)_[a-f0-9]{20}$/
const STATE_FILE_PATTERN = /^((?:ws|bk|tr)_[a-f0-9]{20})\.json$/
const ROOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const WATCH_DEBOUNCE_MS = 300
const FALLBACK_RESCAN_MS = 45_000
// fs.watch can silently deliver no events (e.g. network volumes), so watch
// mode also runs a slow safety rescan.
const WATCH_SAFETY_RESCAN_MS = 15 * 60 * 1000
const BACKUP_RETENTION_DAYS = 7
// bk_/tr_ states are one-shot authorizations; anything older than this was
// orphaned by a crash/quit mid-flow and must not stay authorized.
const TEMP_STATE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ROOT_MAPPINGS = 64
const MAX_REL_PATH_CHARS = 1024
const MAX_IGNORE_FILE_CHARS = 200_000
// A watch storm beyond this many distinct paths collapses into a full rescan.
const MAX_COALESCED_PATHS = 200
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024
const SYSTEM_ROOT_PREFIXES = [
  '/System',
  '/Library',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/opt',
  // /etc, /tmp, and /var are symlinks into /private on macOS; roots are
  // realpath-normalized before this check, so list both spellings.
  '/tmp',
  '/var',
  '/private/etc',
  '/private/tmp',
  '/private/var',
  '/Applications',
]
// Forbidden exactly, but children stay allowed: a folder on an external drive
// under /Volumes/<drive> is a legitimate sync root.
const SYSTEM_ROOT_EXACT = ['/Volumes']

function createWorkspaceSyncRuntime({
  userDataPath,
  ignoredNames,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  onChanges,
  logger,
  scheduler,
} = {}) {
  const clock = {
    setTimeout: scheduler?.setTimeout || ((fn, ms) => setTimeout(fn, ms)),
    clearTimeout: scheduler?.clearTimeout || ((timer) => clearTimeout(timer)),
    setInterval: scheduler?.setInterval || ((fn, ms) => setInterval(fn, ms)),
    clearInterval:
      scheduler?.clearInterval || ((timer) => clearInterval(timer)),
  }
  const ignored = new Set(ignoredNames ? [...ignoredNames] : [])
  const stateDir = path.join(userDataPath, 'workspace-sync')
  const backupsDir = path.join(userDataPath, 'workspace-sync-backups')
  const states = new Map()
  const watchers = []
  const pendingEmits = new Map()
  const ignoreRuleCache = new Map()
  // Test-only interleaving points for TOCTOU regression tests; never set in
  // production.
  const testHooks = {}
  let watchSignature = null
  let disposed = false

  function warn(message) {
    try {
      if (typeof logger === 'function') logger(message)
      else if (logger && typeof logger.warn === 'function') logger.warn(message)
    } catch {
      // Logging must never break sync operations.
    }
  }

  // -------------------------------------------------------------------------
  // Ignore rules: directory NAMES from ignoredNames, editor junk files, plus
  // simplified .gitignore/.cursorignore globs per root (name globs match any
  // path segment, slash globs match the root-relative path or an ancestor).

  function junkFileName(name) {
    return (
      name === '.DS_Store' || name.endsWith('.swp') || name.endsWith('.tmp')
    )
  }

  function globToRegExp(pattern) {
    let source = ''
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index]
      if (char === '*') {
        if (pattern[index + 1] === '*') {
          source += '.*'
          while (pattern[index + 1] === '*') index += 1
        } else {
          source += '[^/]*'
        }
      } else if (char === '?') {
        source += '[^/]'
      } else if ('.+^${}()|[]\\'.includes(char)) {
        source += `\\${char}`
      } else {
        source += char
      }
    }
    try {
      return new RegExp(`^${source}$`)
    } catch {
      return null
    }
  }

  function ignoreRulesForRoot(rootPath) {
    const files = [
      path.join(rootPath, '.gitignore'),
      path.join(rootPath, '.cursorignore'),
    ]
    const signature = files
      .map((file) => {
        try {
          return `${file}:${fs.statSync(file).mtimeMs}`
        } catch {
          return `${file}:missing`
        }
      })
      .join('|')
    const cached = ignoreRuleCache.get(rootPath)
    if (cached?.signature === signature) return cached.rules
    const rules = []
    for (const file of files) {
      let content = ''
      try {
        content = fs.readFileSync(file, 'utf8').slice(0, MAX_IGNORE_FILE_CHARS)
      } catch {
        continue
      }
      for (const line of content.split('\n')) {
        let trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const negate = trimmed.startsWith('!')
        if (negate) trimmed = trimmed.slice(1).trim()
        trimmed = trimmed.replace(/^\//, '').replace(/\/$/, '')
        if (!trimmed) continue
        const regex = globToRegExp(trimmed)
        if (!regex) continue
        rules.push({ negate, segmentBased: !trimmed.includes('/'), regex })
      }
    }
    ignoreRuleCache.set(rootPath, { signature, rules })
    return rules
  }

  function patternIgnored(rootPath, relPath) {
    if (relPath === '.gitignore' || relPath === '.cursorignore') return false
    const rules = ignoreRulesForRoot(rootPath)
    if (rules.length === 0) return false
    const segments = relPath.split('/')
    const prefixes = []
    for (let index = 0; index < segments.length; index += 1) {
      prefixes.push(segments.slice(0, index + 1).join('/'))
    }
    let ignoredMatch = false
    for (const rule of rules) {
      const matched = rule.segmentBased
        ? segments.some((segment) => rule.regex.test(segment))
        : prefixes.some((prefix) => rule.regex.test(prefix))
      if (matched) ignoredMatch = !rule.negate
    }
    return ignoredMatch
  }

  function ignoredRelPath(rootPath, relPath) {
    const segments = relPath.split('/')
    if (segments.some((segment) => ignored.has(segment))) return true
    if (junkFileName(segments[segments.length - 1])) return true
    return patternIgnored(rootPath, relPath)
  }

  // -------------------------------------------------------------------------
  // Link-state persistence.

  function validStateId(syncId) {
    return typeof syncId === 'string' && STATE_ID_PATTERN.test(syncId)
  }

  function statePath(syncId) {
    return path.join(stateDir, `${syncId}.json`)
  }

  function ensureDir(target, mode) {
    fs.mkdirSync(target, { recursive: true, mode })
  }

  function atomicWriteJson(filePath, value) {
    const temporary = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${randomUUID()}.tmp`
    )
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
      // mkdir/write modes are masked by the umask; chmod is not.
      fs.chmodSync(temporary, 0o600)
      fs.renameSync(temporary, filePath)
    } catch (error) {
      try {
        fs.unlinkSync(temporary)
      } catch {}
      throw error
    }
  }

  function decodeRootMapping(value) {
    if (!value || typeof value !== 'object') return null
    const rootId = typeof value.rootId === 'string' ? value.rootId : ''
    const rootPath = typeof value.path === 'string' ? value.path : ''
    if (!ROOT_ID_PATTERN.test(rootId)) return null
    if (!rootPath || !path.isAbsolute(rootPath) || rootPath.includes('\0')) {
      return null
    }
    return { rootId, path: rootPath }
  }

  function decodeLinkState(syncId, value) {
    if (!value || typeof value !== 'object') return null
    if (value.version !== 1 || value.syncId !== syncId) return null
    if (
      !Array.isArray(value.rootMappings) ||
      value.rootMappings.length > MAX_ROOT_MAPPINGS
    ) {
      return null
    }
    const rootMappings = []
    const seenRootIds = new Set()
    for (const candidate of value.rootMappings) {
      const mapping = decodeRootMapping(candidate)
      if (!mapping || seenRootIds.has(mapping.rootId)) return null
      seenRootIds.add(mapping.rootId)
      rootMappings.push(mapping)
    }
    const lastSynced = {}
    if (value.lastSynced && typeof value.lastSynced === 'object') {
      for (const [key, entry] of Object.entries(value.lastSynced)) {
        if (!entry || typeof entry !== 'object') continue
        if (typeof entry.hash !== 'string') continue
        if (
          !Number.isFinite(entry.rev) ||
          !Number.isFinite(entry.mtimeMs) ||
          !Number.isFinite(entry.size)
        ) {
          continue
        }
        lastSynced[key] = {
          hash: entry.hash,
          rev: entry.rev,
          mtimeMs: entry.mtimeMs,
          size: entry.size,
        }
      }
    }
    return {
      version: 1,
      syncId,
      name:
        typeof value.name === 'string'
          ? value.name.replace(/[\u0000-\u001f]/g, '').slice(0, 160)
          : '',
      ...(typeof value.ownerUid === 'string' &&
      value.ownerUid.length >= 1 &&
      value.ownerUid.length <= 128 &&
      !/[\u0000-\u001f\u007f]/.test(value.ownerUid)
        ? { ownerUid: value.ownerUid }
        : {}),
      ...(typeof value.paused === 'boolean' ? { paused: value.paused } : {}),
      rootMappings,
      lastSynced,
    }
  }

  function loadState(syncId) {
    if (!validStateId(syncId)) return null
    try {
      const raw = fs.readFileSync(statePath(syncId), 'utf8')
      return decodeLinkState(syncId, JSON.parse(raw))
    } catch {
      return null
    }
  }

  function realDirectory(candidate) {
    try {
      const resolved = fs.realpathSync(candidate)
      return fs.statSync(resolved).isDirectory() ? resolved : null
    } catch {
      return null
    }
  }

  function insideOf(candidate, container) {
    return (
      candidate === container || candidate.startsWith(container + path.sep)
    )
  }

  function forbiddenRootPath(resolved) {
    if (path.parse(resolved).root === resolved) return true
    let home = os.homedir()
    try {
      home = fs.realpathSync(home)
    } catch {}
    if (resolved === home) return true
    let userData = path.resolve(userDataPath)
    try {
      userData = fs.realpathSync(userData)
    } catch {}
    // Roots inside userData would sync our own state files; roots containing
    // userData would re-ingest the backups this runtime writes.
    if (insideOf(resolved, userData) || insideOf(userData, resolved)) {
      return true
    }
    if (SYSTEM_ROOT_EXACT.includes(resolved)) return true
    return SYSTEM_ROOT_PREFIXES.some((prefix) => insideOf(resolved, prefix))
  }

  function saveState(syncId, state) {
    if (!validStateId(syncId)) return false
    const decoded = decodeLinkState(syncId, state)
    if (!decoded) return false
    const resolvedMappings = []
    const seenPaths = new Set()
    for (const mapping of decoded.rootMappings) {
      const resolved = realDirectory(mapping.path)
      if (!resolved || forbiddenRootPath(resolved) || seenPaths.has(resolved)) {
        return false
      }
      seenPaths.add(resolved)
      resolvedMappings.push({ rootId: mapping.rootId, path: resolved })
    }
    decoded.rootMappings = resolvedMappings
    try {
      ensureDir(stateDir, 0o700)
      fs.chmodSync(stateDir, 0o700)
      atomicWriteJson(statePath(syncId), decoded)
    } catch (error) {
      warn(`workspace-sync: failed to save ${syncId}: ${error?.message}`)
      return false
    }
    states.set(syncId, decoded)
    rebuildWatchers()
    return true
  }

  function removeState(syncId) {
    if (!validStateId(syncId)) return false
    try {
      fs.unlinkSync(statePath(syncId))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        warn(`workspace-sync: failed to remove ${syncId}: ${error?.message}`)
        return false
      }
    }
    states.delete(syncId)
    rebuildWatchers()
    return true
  }

  // One-shot bk_/tr_ authorizations are normally removed by the renderer when
  // the flow finishes; a quit/crash mid-flow orphans them. Age them out so an
  // interrupted backup/transfer never leaves its roots authorized (and listed)
  // forever. ws_ states are durable and never pruned here.
  function pruneStaleTempStates() {
    let names = []
    try {
      names = fs.readdirSync(stateDir)
    } catch {
      return
    }
    const cutoff = Date.now() - TEMP_STATE_TTL_MS
    for (const name of names) {
      const match = STATE_FILE_PATTERN.exec(name)
      if (!match || match[1].startsWith('ws_')) continue
      const filePath = path.join(stateDir, name)
      let stats
      try {
        stats = fs.statSync(filePath)
      } catch {
        continue
      }
      if (stats.mtimeMs >= cutoff) continue
      try {
        fs.unlinkSync(filePath)
        states.delete(match[1])
      } catch {}
    }
  }

  function listStates() {
    pruneStaleTempStates()
    let names = []
    try {
      names = fs.readdirSync(stateDir)
    } catch {
      return []
    }
    const rows = []
    for (const name of names) {
      const match = STATE_FILE_PATTERN.exec(name)
      if (!match) continue
      const state = loadState(match[1])
      if (state) rows.push(state)
    }
    rows.sort((left, right) => left.syncId.localeCompare(right.syncId))
    return rows
  }

  function stateForOperation(syncId) {
    if (!validStateId(syncId)) return null
    const cached = states.get(syncId)
    if (cached) return cached
    const loaded = loadState(syncId)
    if (loaded) states.set(syncId, loaded)
    return loaded
  }

  function mappingFor(state, rootId) {
    return (
      state.rootMappings.find((mapping) => mapping.rootId === rootId) || null
    )
  }

  // -------------------------------------------------------------------------
  // Path containment.

  function relPathSegments(relPath) {
    if (
      typeof relPath !== 'string' ||
      !relPath ||
      relPath.length > MAX_REL_PATH_CHARS
    ) {
      return null
    }
    if (relPath.includes('\0') || relPath.includes('\\')) return null
    if (path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) return null
    const segments = relPath.split('/')
    for (const segment of segments) {
      if (!segment || segment === '.' || segment === '..') return null
    }
    return segments
  }

  // Resolves relPath under a realpath'd root, rejecting escapes and any
  // existing symlink ancestor (a symlinked directory could redirect the
  // operation outside the root, or double-apply it inside).
  function resolveContainedPath(realRoot, relPath) {
    const segments = relPathSegments(relPath)
    if (!segments) return null
    const absolute = path.join(realRoot, ...segments)
    const relative = path.relative(realRoot, absolute)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null
    }
    let current = realRoot
    for (let index = 0; index < segments.length - 1; index += 1) {
      current = path.join(current, segments[index])
      let stats
      try {
        stats = fs.lstatSync(current)
      } catch {
        break
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) return null
    }
    return { absolute, segments }
  }

  // -------------------------------------------------------------------------
  // Hashing and scanning.

  function hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('error', reject)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  function hashBytes(buffer) {
    return createHash('sha256').update(buffer).digest('hex')
  }

  function isExecutable(stats) {
    return (stats.mode & 0o111) !== 0
  }

  async function walkRoot(rootId, realRoot, entries, skipped) {
    const queue = ['']
    while (queue.length > 0) {
      const relDir = queue.shift()
      const absoluteDir = relDir
        ? path.join(realRoot, ...relDir.split('/'))
        : realRoot
      let names = []
      try {
        names = fs.readdirSync(absoluteDir)
      } catch {
        if (relDir) skipped.push({ rootId, path: relDir, reason: 'error' })
        continue
      }
      names.sort()
      for (const name of names) {
        if (ignored.has(name) || junkFileName(name)) continue
        const relPath = relDir ? `${relDir}/${name}` : name
        let stats
        try {
          stats = fs.lstatSync(path.join(absoluteDir, name))
        } catch {
          skipped.push({ rootId, path: relPath, reason: 'error' })
          continue
        }
        if (stats.isSymbolicLink()) {
          skipped.push({ rootId, path: relPath, reason: 'symlink' })
          continue
        }
        if (patternIgnored(realRoot, relPath)) continue
        if (stats.isDirectory()) {
          queue.push(relPath)
          continue
        }
        if (!stats.isFile()) continue
        if (stats.size > maxFileBytes) {
          skipped.push({
            rootId,
            path: relPath,
            reason: 'too-large',
            size: stats.size,
          })
          continue
        }
        try {
          entries.push({
            rootId,
            path: relPath,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            hash: await hashFile(path.join(absoluteDir, name)),
            executable: isExecutable(stats),
          })
        } catch {
          skipped.push({ rootId, path: relPath, reason: 'error' })
        }
      }
    }
  }

  async function scan(syncId) {
    const state = stateForOperation(syncId)
    if (!state) {
      return {
        ok: false,
        entries: [],
        missingRoots: [],
        skipped: [],
        error: 'Unknown sync workspace.',
      }
    }
    const entries = []
    const missingRoots = []
    const skipped = []
    for (const mapping of state.rootMappings) {
      const realRoot = realDirectory(mapping.path)
      if (!realRoot) {
        // A missing root is reported, never treated as a tree of deletions.
        missingRoots.push(mapping.rootId)
        continue
      }
      await walkRoot(mapping.rootId, realRoot, entries, skipped)
    }
    return { ok: true, entries, missingRoots, skipped }
  }

  async function scanPaths(syncId, rootId, relPaths) {
    const state = stateForOperation(syncId)
    const mapping = state ? mappingFor(state, rootId) : null
    if (!mapping) {
      return { ok: false, entries: [], skipped: [], error: 'Unknown sync root.' }
    }
    const realRoot = realDirectory(mapping.path)
    if (!realRoot) {
      return { ok: false, entries: [], skipped: [], error: 'Sync root is missing.' }
    }
    const entries = []
    const skipped = []
    const seen = new Set()
    for (const relPath of Array.isArray(relPaths) ? relPaths : []) {
      if (seen.has(relPath)) continue
      seen.add(relPath)
      const resolved = resolveContainedPath(realRoot, relPath)
      if (!resolved || ignoredRelPath(realRoot, relPath)) continue
      let stats
      try {
        stats = fs.lstatSync(resolved.absolute)
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          entries.push({ rootId, path: relPath, deleted: true })
        } else {
          // The path may still exist (e.g. EACCES); report it as skipped so
          // consumers keep tracking it instead of inferring a deletion.
          skipped.push({ rootId, path: relPath, reason: 'error' })
        }
        continue
      }
      // Symlinks, directories, and oversized files are never synced. They are
      // reported as skipped — never silently dropped and never fabricated
      // into deletions — mirroring the full scan's protection.
      if (stats.isSymbolicLink()) {
        skipped.push({ rootId, path: relPath, reason: 'symlink' })
        continue
      }
      if (!stats.isFile()) {
        skipped.push({ rootId, path: relPath, reason: 'error' })
        continue
      }
      if (stats.size > maxFileBytes) {
        skipped.push({
          rootId,
          path: relPath,
          reason: 'too-large',
          size: stats.size,
        })
        continue
      }
      try {
        entries.push({
          rootId,
          path: relPath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          hash: await hashFile(resolved.absolute),
          executable: isExecutable(stats),
        })
      } catch {
        skipped.push({ rootId, path: relPath, reason: 'error' })
      }
    }
    return { ok: true, entries, skipped }
  }

  async function read(syncId, rootId, relPath) {
    const state = stateForOperation(syncId)
    const mapping = state ? mappingFor(state, rootId) : null
    if (!mapping) return { ok: false, error: 'Unknown sync root.' }
    const realRoot = realDirectory(mapping.path)
    if (!realRoot) return { ok: false, error: 'Sync root is missing.' }
    const resolved = resolveContainedPath(realRoot, relPath)
    if (!resolved) return { ok: false, error: 'Invalid sync path.' }
    let stats
    try {
      stats = fs.lstatSync(resolved.absolute)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        return { ok: true, missing: true }
      }
      return { ok: false, error: 'Could not read the file.' }
    }
    if (!stats.isFile()) {
      return { ok: false, error: 'Only regular files sync.' }
    }
    if (stats.size > maxFileBytes) {
      return { ok: false, error: 'File is larger than the sync limit.' }
    }
    if (testHooks.beforeReadOpen) testHooks.beforeReadOpen()
    // TOCTOU hardening: open with O_NOFOLLOW so a symlink swapped in between
    // the lstat above and this open is never followed (ELOOP), then fstat the
    // fd we actually read from. O_NOFOLLOW is a no-op where unsupported
    // (Windows), matching the platform's weaker symlink semantics.
    let fd = null
    try {
      fd = fs.openSync(
        resolved.absolute,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
      )
    } catch (error) {
      if (error?.code === 'ELOOP') {
        // The path became a symlink after validation; skip it exactly like a
        // symlink found at validation time.
        return { ok: false, error: 'Only regular files sync.' }
      }
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        return { ok: true, missing: true }
      }
      return { ok: false, error: 'Could not read the file.' }
    }
    try {
      const finalStats = fs.fstatSync(fd)
      if (!finalStats.isFile()) {
        return { ok: false, error: 'Only regular files sync.' }
      }
      if (finalStats.size > maxFileBytes) {
        return { ok: false, error: 'File is larger than the sync limit.' }
      }
      const bytes = fs.readFileSync(fd)
      if (bytes.length > maxFileBytes) {
        return { ok: false, error: 'File is larger than the sync limit.' }
      }
      return {
        ok: true,
        base64: bytes.toString('base64'),
        hash: hashBytes(bytes),
        size: bytes.length,
        executable: isExecutable(finalStats),
        mtimeMs: finalStats.mtimeMs,
      }
    } catch {
      return { ok: false, error: 'Could not read the file.' }
    } finally {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Mutations. These intentionally do NOT suppress their own watcher events;
  // the renderer engine does echo suppression by content hash.

  function dateStamp(now) {
    const pad = (value) => String(value).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}`
  }

  function backupExistingFile(syncId, rootId, segments, absolute) {
    try {
      const target = path.join(
        backupsDir,
        syncId,
        dateStamp(new Date()),
        rootId,
        ...segments
      )
      ensureDir(path.dirname(target), 0o700)
      fs.copyFileSync(absolute, target)
    } catch {
      // Backups are best-effort; never block a sync write on them.
    }
  }

  async function apply(syncId, rootId, relPath, content) {
    const state = stateForOperation(syncId)
    const mapping = state ? mappingFor(state, rootId) : null
    if (!mapping) return { ok: false, error: 'Unknown sync root.' }
    const realRoot = realDirectory(mapping.path)
    if (!realRoot) return { ok: false, error: 'Sync root is missing.' }
    const resolved = resolveContainedPath(realRoot, relPath)
    if (!resolved) return { ok: false, error: 'Invalid sync path.' }
    // The scan side never emits ignored paths (.git, node_modules, junk
    // files, .gitignore globs), so a cloud doc for one is at best stale and
    // at worst hostile (e.g. .git/hooks/pre-commit). Keep the ignore policy
    // symmetric: never write what we would never read.
    if (ignoredRelPath(realRoot, relPath)) {
      return { ok: false, error: 'Path is excluded by sync ignore rules.' }
    }
    if (typeof content?.base64 !== 'string') {
      return { ok: false, error: 'Invalid file content.' }
    }
    const bytes = Buffer.from(content.base64, 'base64')
    if (bytes.length > maxFileBytes) {
      return { ok: false, error: 'File is larger than the sync limit.' }
    }
    const mode = content?.executable === true ? 0o755 : 0o644
    try {
      let existing = null
      try {
        existing = fs.lstatSync(resolved.absolute)
      } catch {}
      if (existing) {
        if (!existing.isFile()) {
          return { ok: false, error: 'Only regular files sync.' }
        }
        // Only load the existing file for comparison when sizes match — an
        // untracked multi-GB file at this path must not be read into memory.
        if (
          existing.size !== bytes.length ||
          !fs.readFileSync(resolved.absolute).equals(bytes)
        ) {
          backupExistingFile(syncId, rootId, resolved.segments, resolved.absolute)
        }
      } else if (resolved.segments.length > 1) {
        if (testHooks.beforeApplyEnsureDir) testHooks.beforeApplyEnsureDir()
        ensureDir(path.dirname(resolved.absolute), 0o755)
      }
      // TOCTOU hardening: re-resolve the parent directory now that it exists
      // and require it to still be inside the root, so an ancestor swapped
      // for a symlink after validation (including one racing ensureDir above)
      // cannot redirect the write outside the root. The temp file and rename
      // both target this validated real parent.
      let realParent
      try {
        realParent = fs.realpathSync(path.dirname(resolved.absolute))
      } catch {
        return { ok: false, error: 'Could not write the file.' }
      }
      if (!insideOf(realParent, realRoot)) {
        return { ok: false, error: 'Invalid sync path.' }
      }
      const destination = path.join(
        realParent,
        path.basename(resolved.absolute)
      )
      const temporary = path.join(
        realParent,
        `.${path.basename(resolved.absolute)}.statskey-sync-${randomUUID()}.tmp`
      )
      try {
        fs.writeFileSync(temporary, bytes, { mode })
        fs.chmodSync(temporary, mode)
        if (testHooks.beforeApplyRename) testHooks.beforeApplyRename()
        // Abort when the destination turned into a symlink (or any non-file)
        // after validation. rename() replaces rather than follows a symlink
        // at its destination, but clobbering one would still break the
        // "never touch symlinks" rule the validation-time check enforces.
        // Residual race: a swap landing between this lstat and renameSync
        // (or the realParent directory itself being replaced) cannot be
        // excluded without an O_NOFOLLOW openat()-style fd walk, which
        // Node's fs API does not expose; the window is microseconds and
        // requires a local process already able to write inside the root.
        let finalStats = null
        try {
          finalStats = fs.lstatSync(destination)
        } catch {}
        if (finalStats && !finalStats.isFile()) {
          try {
            fs.unlinkSync(temporary)
          } catch {}
          return { ok: false, error: 'Only regular files sync.' }
        }
        fs.renameSync(temporary, destination)
      } catch (error) {
        try {
          fs.unlinkSync(temporary)
        } catch {}
        throw error
      }
      const stats = fs.statSync(destination)
      return { ok: true, hash: hashBytes(bytes), mtimeMs: stats.mtimeMs }
    } catch (error) {
      warn(`workspace-sync: apply failed for ${relPath}: ${error?.message}`)
      return { ok: false, error: 'Could not write the file.' }
    }
  }

  async function remove(syncId, rootId, relPath) {
    const state = stateForOperation(syncId)
    const mapping = state ? mappingFor(state, rootId) : null
    if (!mapping) return { ok: false, error: 'Unknown sync root.' }
    const realRoot = realDirectory(mapping.path)
    if (!realRoot) return { ok: false, error: 'Sync root is missing.' }
    const resolved = resolveContainedPath(realRoot, relPath)
    if (!resolved) return { ok: false, error: 'Invalid sync path.' }
    // Ignored paths never sync, so a tombstone for one must never delete a
    // real local file (same symmetry rule as apply()).
    if (ignoredRelPath(realRoot, relPath)) {
      return { ok: false, error: 'Path is excluded by sync ignore rules.' }
    }
    let stats
    try {
      stats = fs.lstatSync(resolved.absolute)
    } catch {
      return { ok: true }
    }
    // A symlink or directory at the path was never synced; leave it alone.
    if (!stats.isFile()) return { ok: true }
    backupExistingFile(syncId, rootId, resolved.segments, resolved.absolute)
    try {
      fs.unlinkSync(resolved.absolute)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return { ok: false, error: 'Could not delete the file.' }
      }
    }
    let directory = path.dirname(resolved.absolute)
    while (directory !== realRoot && insideOf(directory, realRoot)) {
      try {
        fs.rmdirSync(directory)
      } catch {
        break
      }
      directory = path.dirname(directory)
    }
    return { ok: true }
  }

  // -------------------------------------------------------------------------
  // Backup retention.

  function pruneOldBackups() {
    let syncDirs = []
    try {
      syncDirs = fs.readdirSync(backupsDir)
    } catch {
      return
    }
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
    for (const syncDir of syncDirs) {
      const container = path.join(backupsDir, syncDir)
      let dateDirs = []
      try {
        dateDirs = fs.readdirSync(container)
      } catch {
        continue
      }
      for (const dateDir of dateDirs) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue
        const at = Date.parse(`${dateDir}T00:00:00Z`)
        if (!Number.isFinite(at) || at >= cutoff) continue
        try {
          fs.rmSync(path.join(container, dateDir), {
            recursive: true,
            force: true,
          })
        } catch {}
      }
    }
  }

  // -------------------------------------------------------------------------
  // Watching. Only ws_ states are watched; bk_/tr_ states are temporary
  // authorization for one-shot flows.

  function watchTargets() {
    const targets = []
    for (const [syncId, state] of states) {
      if (!syncId.startsWith('ws_')) continue
      for (const mapping of state.rootMappings) {
        targets.push({ syncId, rootId: mapping.rootId, path: mapping.path })
      }
    }
    targets.sort((left, right) =>
      `${left.syncId}:${left.rootId}`.localeCompare(
        `${right.syncId}:${right.rootId}`
      )
    )
    return targets
  }

  function pendingKey(syncId, rootId) {
    return `${syncId} ${rootId}`
  }

  function emitChanges(event) {
    if (typeof onChanges !== 'function') return
    try {
      onChanges(event)
    } catch {}
  }

  function flushPending(key) {
    const pending = pendingEmits.get(key)
    if (!pending) return
    pendingEmits.delete(key)
    emitChanges({
      syncId: pending.syncId,
      rootId: pending.rootId,
      paths: pending.rescan ? [] : [...pending.paths].sort(),
    })
  }

  function queueChange(syncId, rootId, relPath) {
    const key = pendingKey(syncId, rootId)
    let pending = pendingEmits.get(key)
    if (!pending) {
      pending = { syncId, rootId, paths: new Set(), rescan: false, timer: null }
      pendingEmits.set(key, pending)
    }
    if (relPath === null) {
      pending.rescan = true
      pending.paths.clear()
    } else if (!pending.rescan) {
      pending.paths.add(relPath)
      if (pending.paths.size > MAX_COALESCED_PATHS) {
        pending.rescan = true
        pending.paths.clear()
      }
    }
    if (pending.timer) clock.clearTimeout(pending.timer)
    pending.timer = clock.setTimeout(() => flushPending(key), WATCH_DEBOUNCE_MS)
    pending.timer?.unref?.()
  }

  function handleWatcherEvent(syncId, rootId, rootPath, filename) {
    if (disposed) return
    if (filename === null || filename === undefined) {
      // The platform lost track of what changed; ask for a full rescan.
      queueChange(syncId, rootId, null)
      return
    }
    const relPath = String(filename).split(path.sep).join('/')
    if (!relPathSegments(relPath)) return
    if (ignoredRelPath(rootPath, relPath)) return
    queueChange(syncId, rootId, relPath)
  }

  function startFallbackWatcher(target) {
    const timer = clock.setInterval(
      () =>
        emitChanges({ syncId: target.syncId, rootId: target.rootId, paths: [] }),
      FALLBACK_RESCAN_MS
    )
    timer?.unref?.()
    return {
      ...target,
      mode: 'fallback',
      close() {
        clock.clearInterval(timer)
      },
    }
  }

  function startWatcher(target) {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      try {
        const watcher = fs.watch(
          target.path,
          { recursive: true },
          (_eventType, filename) =>
            handleWatcherEvent(target.syncId, target.rootId, target.path, filename)
        )
        // fs.watch can succeed yet silently deliver no events (documented on
        // network volumes), so watch mode is advisory: a slow safety rescan
        // keeps the root from diverging forever.
        const safetyTimer = clock.setInterval(
          () =>
            emitChanges({
              syncId: target.syncId,
              rootId: target.rootId,
              paths: [],
            }),
          WATCH_SAFETY_RESCAN_MS
        )
        safetyTimer?.unref?.()
        const descriptor = {
          ...target,
          mode: 'watch',
          close() {
            clock.clearInterval(safetyTimer)
            try {
              watcher.close()
            } catch {}
          },
        }
        watcher.on('error', () => {
          descriptor.close()
          const index = watchers.indexOf(descriptor)
          if (index >= 0 && !disposed) {
            watchers.splice(index, 1, startFallbackWatcher(target))
          }
        })
        return descriptor
      } catch {
        // Recursive watch unavailable; fall through to the rescan timer.
      }
    }
    return startFallbackWatcher(target)
  }

  function rebuildWatchers() {
    if (disposed) return
    const targets = watchTargets()
    const signature = targets
      .map(
        (target) => `${target.syncId} ${target.rootId} ${target.path}`
      )
      .join('\n')
    // lastSynced-only saves arrive every second while syncing; only churn the
    // recursive watchers when the watched roots actually changed.
    if (signature === watchSignature) return
    watchSignature = signature
    for (const watcher of watchers.splice(0)) watcher.close()
    const liveKeys = new Set(
      targets.map((target) => pendingKey(target.syncId, target.rootId))
    )
    for (const [key, pending] of [...pendingEmits]) {
      if (liveKeys.has(key)) continue
      if (pending.timer) clock.clearTimeout(pending.timer)
      pendingEmits.delete(key)
    }
    for (const target of targets) watchers.push(startWatcher(target))
  }

  function deviceInfo() {
    let label = ''
    try {
      label = String(os.hostname() || '')
    } catch {}
    label = label.replace(/\.local$/i, '').trim().slice(0, 80)
    return { label: label || 'This device', platform: process.platform }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const watcher of watchers.splice(0)) watcher.close()
    for (const pending of pendingEmits.values()) {
      if (pending.timer) clock.clearTimeout(pending.timer)
    }
    pendingEmits.clear()
  }

  try {
    ensureDir(stateDir, 0o700)
    fs.chmodSync(stateDir, 0o700)
  } catch {}
  pruneOldBackups()
  for (const state of listStates()) states.set(state.syncId, state)
  rebuildWatchers()

  return {
    loadState,
    saveState,
    removeState,
    listStates,
    scan,
    scanPaths,
    read,
    apply,
    remove,
    deviceInfo,
    dispose,
    // Test-only hooks: drive the watch pipeline without real fs.watch timing,
    // and interleave TOCTOU races deterministically via testHooks.
    _internals: {
      testHooks,
      emitWatcherEvent(syncId, rootId, filename) {
        const state = states.get(syncId)
        const mapping = state ? mappingFor(state, rootId) : null
        if (!mapping) return
        handleWatcherEvent(syncId, rootId, mapping.path, filename)
      },
      watchTargets() {
        return watchers.map((watcher) => ({
          syncId: watcher.syncId,
          rootId: watcher.rootId,
          path: watcher.path,
          mode: watcher.mode,
        }))
      },
    },
  }
}

module.exports = { createWorkspaceSyncRuntime }
