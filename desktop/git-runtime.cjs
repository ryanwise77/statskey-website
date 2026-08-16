function parsePorcelainStatus(output) {
  const entries = String(output ?? '').split('\0')
  const files = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry || entry.length < 4) continue
    const indexStatus = entry[0]
    const workingStatus = entry[1]
    const filePath = entry.slice(3)
    let originalPath = null
    if (indexStatus === 'R' || indexStatus === 'C') {
      originalPath = entries[index + 1] || null
      index += 1
    }
    files.push({
      path: filePath,
      originalPath,
      indexStatus,
      workingStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      unstaged: workingStatus !== ' ' || indexStatus === '?',
      untracked: indexStatus === '?' && workingStatus === '?',
    })
  }
  return files
}

function normalizeGitDiffPaths(paths, maximum = 24) {
  if (!Array.isArray(paths)) return []
  if (paths.length === 0 || paths.length > maximum) {
    throw new Error(`Choose between 1 and ${maximum} Git diff paths.`)
  }
  const normalized = []
  for (const candidate of paths) {
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      candidate.length > 32_768 ||
      candidate.includes('\0') ||
      candidate.startsWith(':') ||
      candidate.startsWith('/') ||
      candidate.startsWith('\\') ||
      /^[A-Za-z]:[\\/]/.test(candidate)
    ) {
      throw new Error('A Git diff path is invalid.')
    }
    const value = candidate.replaceAll('\\', '/').replace(/^\.\//, '')
    if (
      !value ||
      value
        .split('/')
        .some(
          (segment) => segment === '' || segment === '..' || segment === '.'
        )
    ) {
      throw new Error('A Git diff path is outside the workspace.')
    }
    normalized.push(`:(literal)${value}`)
  }
  return [...new Set(normalized)]
}

module.exports = { normalizeGitDiffPaths, parsePorcelainStatus }
