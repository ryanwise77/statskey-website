const path = require('node:path')
const { createHash } = require('node:crypto')
const { readdirSync, realpathSync, statSync } = require('node:fs')
const { fileURLToPath } = require('node:url')

const DEFAULT_MAX_WORKSPACE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_WORKSPACE_DEPTH = 8
const WORKSPACE_BINDING_ERROR =
  'The open workspace changed after this task started. Start a new run in the current workspace.'

function workspaceIdentity(roots, looseFiles) {
  const normalizedRoots = Array.isArray(roots)
    ? roots.filter((value) => typeof value === 'string').sort()
    : []
  const normalizedLooseFiles = Array.isArray(looseFiles)
    ? looseFiles.filter((value) => typeof value === 'string').sort()
    : []
  return createHash('sha256')
    .update(
      JSON.stringify({
        roots: normalizedRoots,
        looseFiles: normalizedLooseFiles,
      })
    )
    .digest('hex')
    .slice(0, 20)
}

function currentWorkspaceIdentity(roots, looseFiles) {
  const hasRoots = Array.isArray(roots) && roots.length > 0
  const hasLooseFiles = Array.isArray(looseFiles) && looseFiles.length > 0
  return hasRoots || hasLooseFiles ? workspaceIdentity(roots, looseFiles) : null
}

function assertWorkspaceOperationBinding(binding, currentWorkspaceId) {
  if (binding === undefined || binding === null) return
  const expectedWorkspaceId =
    binding && typeof binding === 'object' &&
    typeof binding.workspaceId === 'string'
      ? binding.workspaceId
      : ''
  if (
    !/^[a-f0-9]{20}$/.test(expectedWorkspaceId) ||
    expectedWorkspaceId !== currentWorkspaceId
  ) {
    const error = new Error(WORKSPACE_BINDING_ERROR)
    error.code = 'WORKSPACE_BINDING_MISMATCH'
    throw error
  }
}

function readWorkspaceDirectoryEntries(candidate, options = {}) {
  if (
    typeof candidate !== 'string' ||
    !candidate ||
    !path.isAbsolute(candidate) ||
    candidate.length > 32_768 ||
    candidate.includes('\0')
  ) {
    throw workspaceDirectoryError('Choose a valid workspace folder.')
  }
  const resolvePath =
    typeof options.realpath === 'function' ? options.realpath : realpathSync
  const readStats =
    typeof options.stat === 'function' ? options.stat : statSync
  const readDirectory =
    typeof options.readDirectory === 'function'
      ? options.readDirectory
      : (directoryPath) => readdirSync(directoryPath, { withFileTypes: true })
  let resolved
  try {
    resolved = resolvePath(candidate)
  } catch (error) {
    throw sanitizedWorkspaceDirectoryError(error)
  }
  let allowed = false
  try {
    allowed =
      typeof options.isAllowed === 'function' && options.isAllowed(resolved)
  } catch {
    allowed = false
  }
  if (!allowed) {
    throw workspaceDirectoryError('That folder is outside the open workspace.')
  }
  let stats
  try {
    stats = readStats(resolved)
  } catch (error) {
    throw sanitizedWorkspaceDirectoryError(error)
  }
  if (!stats?.isDirectory?.()) {
    throw workspaceDirectoryError('This workspace item is not a folder.')
  }
  try {
    const entries = readDirectory(resolved)
    if (!Array.isArray(entries)) {
      throw workspaceDirectoryError(
        'StatsKey could not read this workspace folder. Check that it is available and try again.'
      )
    }
    return { path: resolved, entries }
  } catch (error) {
    if (error?.code === 'WORKSPACE_DIRECTORY_READ_FAILED') throw error
    throw sanitizedWorkspaceDirectoryError(error)
  }
}

function sanitizedWorkspaceDirectoryError(error) {
  const code =
    error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : ''
  if (code === 'ENOENT' || code === 'ESTALE') {
    return workspaceDirectoryError(
      'This workspace folder is no longer available. Reopen it or remove it from the workspace.'
    )
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return workspaceDirectoryError(
      'StatsKey cannot read this workspace folder. Check its permissions and try again.'
    )
  }
  if (code === 'ENOTDIR') {
    return workspaceDirectoryError('This workspace item is not a folder.')
  }
  return workspaceDirectoryError(
    'StatsKey could not read this workspace folder. Check that it is available and try again.'
  )
}

function workspaceDirectoryError(message) {
  const error = new Error(message)
  error.code = 'WORKSPACE_DIRECTORY_READ_FAILED'
  return error
}

function parseWorkspaceDefinitionText(value) {
  const source = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : typeof value === 'string'
      ? value
      : null
  if (source === null) {
    throw new TypeError('Workspace definition text must be a string or Buffer.')
  }
  const withoutBom = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  return JSON.parse(stripTrailingJsonCommas(stripJsonComments(withoutBom)))
}

function stripJsonComments(source) {
  const output = source.split('')
  let inString = false
  let escaped = false
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '/' && output[index + 1] === '/') {
      output[index] = ' '
      output[index + 1] = ' '
      index += 2
      while (index < output.length && !['\n', '\r'].includes(output[index])) {
        output[index] = ' '
        index += 1
      }
      index -= 1
      continue
    }
    if (character === '/' && output[index + 1] === '*') {
      output[index] = ' '
      output[index + 1] = ' '
      index += 2
      while (index < output.length) {
        if (output[index] === '*' && output[index + 1] === '/') {
          output[index] = ' '
          output[index + 1] = ' '
          index += 1
          break
        }
        if (!['\n', '\r'].includes(output[index])) output[index] = ' '
        index += 1
      }
    }
  }
  return output.join('')
}

function stripTrailingJsonCommas(source) {
  const output = source.split('')
  let inString = false
  let escaped = false
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character !== ',') continue
    let next = index + 1
    while (next < output.length && /\s/.test(output[next])) next += 1
    if (output[next] === '}' || output[next] === ']') output[index] = ' '
  }
  return output.join('')
}

function isWindowsDrivePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function isUncPath(value) {
  return /^\\\\/.test(value)
}

function hasUriScheme(value) {
  return (
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value) &&
    !isWindowsDrivePath(value)
  )
}

function safePercentDecodedPath(value) {
  if (!/%[\dA-Fa-f]{2}/.test(value)) return null
  // Never turn encoded path structure or NUL bytes into live path structure.
  if (/%(?:00|2f|5c)/i.test(value)) return null
  try {
    const decoded = decodeURIComponent(value)
    if (!decoded || decoded === value || decoded.includes('\0')) return null
    return decoded
  } catch {
    return null
  }
}

function localPathCandidates(value, baseDirectory) {
  if (typeof value !== 'string' || value.length === 0) return []
  if (hasUriScheme(value)) {
    if (!/^file:/i.test(value)) return []
    try {
      return [fileURLToPath(value.replace(/^file:/i, 'file:'))]
    } catch {
      return []
    }
  }

  const variants = [value]
  if (
    process.platform !== 'win32' &&
    !path.isAbsolute(value) &&
    !isWindowsDrivePath(value) &&
    !isUncPath(value) &&
    value.includes('\\')
  ) {
    variants.push(value.replace(/\\/g, '/'))
  }
  for (const variant of [...variants]) {
    const decoded = safePercentDecodedPath(variant)
    if (decoded) variants.push(decoded)
  }

  const candidates = []
  for (const variant of variants) {
    const candidate = path.isAbsolute(variant)
      ? path.normalize(variant)
      : path.resolve(baseDirectory, variant)
    if (!candidates.includes(candidate)) candidates.push(candidate)
  }
  return candidates
}

function cursorWorkspaceLocations(storage) {
  if (!storage || typeof storage !== 'object') return []
  const locations = []
  const seen = new Set()
  const add = (value) => {
    if (typeof value !== 'string' || value.length === 0) return
    if (
      !/^file:/i.test(value) &&
      !path.isAbsolute(value) &&
      !isWindowsDrivePath(value) &&
      !isUncPath(value)
    ) {
      return
    }
    for (const candidate of localPathCandidates(value, process.cwd())) {
      const normalized = path.normalize(candidate)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      locations.push(normalized)
      if (locations.length >= 500) return
    }
  }

  const associations = storage.profileAssociations?.workspaces
  if (associations && typeof associations === 'object') {
    for (const value of Object.keys(associations)) {
      add(value)
      if (locations.length >= 500) break
    }
  }

  const backups = storage.backupWorkspaces
  for (const workspace of Array.isArray(backups?.workspaces)
    ? backups.workspaces
    : []) {
    add(
      workspace?.configURIPath ??
        workspace?.configPath ??
        workspace?.workspaceUri
    )
  }
  for (const folder of Array.isArray(backups?.folders) ? backups.folders : []) {
    add(folder?.folderUri ?? folder?.folderUriPath ?? folder?.path ?? folder)
  }
  return locations
}

function folderDefinitionValue(folder) {
  if (typeof folder === 'string') return folder
  if (!folder || typeof folder !== 'object') return null
  if (typeof folder.path === 'string') return folder.path
  if (typeof folder.uri === 'string') return folder.uri
  return null
}

function resolveWorkspaceFolderDefinitions(
  folders,
  baseDirectory,
  resolveDirectory
) {
  const roots = []
  let missingFolders = 0
  for (const folder of Array.isArray(folders) ? folders.slice(0, 100) : []) {
    const value = folderDefinitionValue(folder)
    const candidates = localPathCandidates(value, baseDirectory)
    let resolved = null
    for (const candidate of candidates) {
      try {
        resolved = resolveDirectory(candidate)
      } catch {
        resolved = null
      }
      if (resolved) break
    }
    if (!resolved) {
      missingFolders += 1
    } else if (!roots.includes(resolved)) {
      roots.push(resolved)
    }
  }
  return { roots, missingFolders }
}

function workspaceReferenceValue(reference) {
  if (typeof reference === 'string') return reference
  if (!reference || typeof reference !== 'object') return null
  for (const property of ['configPath', 'path', 'uri']) {
    if (typeof reference[property] === 'string') return reference[property]
  }
  return null
}

function topLevelFolderDefinitions(definition) {
  if (typeof definition === 'string') return [definition]
  if (Array.isArray(definition)) return definition
  if (!definition || typeof definition !== 'object') return []
  const folders = Array.isArray(definition.folders)
    ? definition.folders
    : []
  if (definition.folder !== undefined) folders.push(definition.folder)
  if (definition.folderPath !== undefined) folders.push(definition.folderPath)
  if (definition.folderUri !== undefined) folders.push(definition.folderUri)
  if (
    definition.folders === undefined &&
    definition.folder === undefined &&
    definition.folderPath === undefined &&
    definition.folderUri === undefined &&
    definition.workspace === undefined &&
    definition.workspaceFile === undefined &&
    definition.workspaceUri === undefined &&
    (typeof definition.path === 'string' || typeof definition.uri === 'string')
  ) {
    folders.push(definition)
  }
  return folders
}

function topLevelWorkspaceReference(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return null
  }
  if (definition.workspace !== undefined) return definition.workspace
  if (definition.workspaceFile !== undefined) return definition.workspaceFile
  if (definition.workspaceUri !== undefined) return definition.workspaceUri
  return null
}

function resolveWith(candidates, resolver) {
  for (const candidate of candidates) {
    try {
      const resolved = resolver(candidate)
      if (resolved) return resolved
    } catch {
      // A candidate can be unavailable while a normalized fallback still works.
    }
  }
  return null
}

function resolveWorkspaceDefinitionFile(entryFile, options = {}) {
  const { readFile, resolveFile, resolveDirectory } = options
  if (typeof readFile !== 'function') {
    throw new TypeError('readFile must be a function.')
  }
  if (typeof resolveFile !== 'function') {
    throw new TypeError('resolveFile must be a function.')
  }
  if (typeof resolveDirectory !== 'function') {
    throw new TypeError('resolveDirectory must be a function.')
  }
  const maxBytes = Number.isFinite(options.maxBytes)
    ? Math.max(1, Math.floor(options.maxBytes))
    : DEFAULT_MAX_WORKSPACE_BYTES
  const maxDepth = Number.isFinite(options.maxDepth)
    ? Math.max(0, Math.min(32, Math.floor(options.maxDepth)))
    : DEFAULT_MAX_WORKSPACE_DEPTH
  const entryCandidates = localPathCandidates(entryFile, process.cwd())
  const sourcePath = resolveWith(entryCandidates, resolveFile)
  if (!sourcePath) throw new Error('Workspace file is unavailable.')

  const activeFiles = new Set()
  const cachedFiles = new Map()

  function visit(workspaceFile, depth) {
    if (depth > maxDepth) {
      throw new Error(
        'This workspace contains too many nested workspace references.'
      )
    }
    if (activeFiles.has(workspaceFile)) {
      throw new Error('This workspace contains a circular workspace reference.')
    }
    if (cachedFiles.has(workspaceFile)) return cachedFiles.get(workspaceFile)

    activeFiles.add(workspaceFile)
    try {
      let source
      try {
        source = readFile(workspaceFile)
      } catch {
        throw new Error('A referenced workspace file could not be read.')
      }
      const text = Buffer.isBuffer(source)
        ? source.toString('utf8')
        : typeof source === 'string'
          ? source
          : null
      if (text === null) {
        throw new Error('A referenced workspace file could not be read.')
      }
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new Error('Workspace file is too large.')
      }

      let definition
      try {
        definition = parseWorkspaceDefinitionText(text)
      } catch {
        throw new Error('This is not a compatible workspace file.')
      }

      const baseDirectory = path.dirname(workspaceFile)
      const folderDefinitions = topLevelFolderDefinitions(definition)
      const hasFolderShape =
        typeof definition === 'string' ||
        Array.isArray(definition) ||
        (definition &&
          typeof definition === 'object' &&
          ['folders', 'folder', 'folderPath', 'folderUri', 'path', 'uri'].some(
            (property) => definition[property] !== undefined
          ))
      const direct = resolveWorkspaceFolderDefinitions(
        folderDefinitions,
        baseDirectory,
        resolveDirectory
      )
      const roots = [...direct.roots]
      let missingFolders = direct.missingFolders

      const reference = topLevelWorkspaceReference(definition)
      if (reference !== null) {
        const referenceValue = workspaceReferenceValue(reference)
        if (!referenceValue) {
          throw new Error('This workspace has an invalid workspace reference.')
        }
        if (hasUriScheme(referenceValue) && !/^file:/i.test(referenceValue)) {
          throw new Error('Only local workspace files can be imported.')
        }
        const referencedFile = resolveWith(
          localPathCandidates(referenceValue, baseDirectory),
          resolveFile
        )
        if (!referencedFile) {
          throw new Error('A referenced workspace file is unavailable.')
        }
        const nested = visit(referencedFile, depth + 1)
        for (const root of nested.roots) {
          if (!roots.includes(root)) roots.push(root)
        }
        missingFolders += nested.missingFolders
      } else if (!hasFolderShape) {
        throw new Error('This is not a compatible workspace file.')
      }

      const result = { roots, missingFolders }
      cachedFiles.set(workspaceFile, result)
      return result
    } finally {
      activeFiles.delete(workspaceFile)
    }
  }

  const resolved = visit(sourcePath, 0)
  if (resolved.roots.length === 0) {
    throw new Error(
      resolved.missingFolders > 0
        ? 'None of the folders in this workspace are available.'
        : 'This workspace does not contain any folders.'
    )
  }
  return {
    ...resolved,
    sourcePath,
    name: path.basename(sourcePath),
  }
}

function defaultWorkspaceLabel(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return 'Workspace'
  return roots.length === 1
    ? path.basename(roots[0])
    : `${path.basename(roots[0])} +${roots.length - 1}`
}

function workspaceDisplayPath(candidate, roots) {
  if (typeof candidate !== 'string' || !candidate) return ''
  const availableRoots = Array.isArray(roots)
    ? roots.filter((root) => typeof root === 'string' && root)
    : []
  const containingRoot = availableRoots.find((root) => {
    const relative = path.relative(root, candidate)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
  if (!containingRoot) return path.basename(candidate)
  const withinRoot = path.relative(containingRoot, candidate)
  const displayed = availableRoots.length === 1
    ? withinRoot || path.basename(containingRoot)
    : path.join(path.basename(containingRoot), withinRoot)
  return displayed.split(path.sep).join('/')
}

/**
 * Reject the common agent mistake of repeating the captured workspace root's
 * name at the front of an already-relative create path. Only reject when the
 * intent is unambiguous: the repeated-name directory does not exist, while
 * the first directory after it already exists directly under the root.
 * Legitimate nested directories that share the root name remain available.
 */
function assertUnprefixedWorkspaceCreatePath(rootPath, relativePath, options = {}) {
  if (typeof rootPath !== 'string' || typeof relativePath !== 'string') return
  const requested = relativePath.trim()
  if (!requested) return
  if (path.isAbsolute(requested)) {
    throw new Error('Choose a path relative to the selected workspace root.')
  }
  const normalized = path
    .normalize(requested)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 2) return
  const rootName = path.basename(path.resolve(rootPath))
  if (segments[0].localeCompare(rootName, undefined, { sensitivity: 'accent' }) !== 0) {
    return
  }
  const exists = typeof options.exists === 'function' ? options.exists : () => false
  const repeatedRootDirectory = path.join(rootPath, segments[0])
  const intendedFirstDirectory = path.join(rootPath, segments[1])
  if (exists(repeatedRootDirectory) || !exists(intendedFirstDirectory)) return
  const suggestion = segments.slice(1).join('/')
  throw new Error(
    `The create path is already prefixed with the workspace root name. Use "${suggestion}" relative to the selected root.`
  )
}

module.exports = {
  WORKSPACE_BINDING_ERROR,
  assertUnprefixedWorkspaceCreatePath,
  assertWorkspaceOperationBinding,
  currentWorkspaceIdentity,
  cursorWorkspaceLocations,
  defaultWorkspaceLabel,
  parseWorkspaceDefinitionText,
  readWorkspaceDirectoryEntries,
  resolveWorkspaceDefinitionFile,
  resolveWorkspaceFolderDefinitions,
  workspaceDisplayPath,
  workspaceIdentity,
}
