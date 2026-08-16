const { existsSync, readFileSync, statSync } = require('node:fs')
const path = require('node:path')

const REQUIRED_SOURCE_PATHS = [
  'desktop/main.cjs',
  'desktop/preload.cjs',
  'desktop/package.json',
  'desktop-app.html',
  'src/app/routes/Flow.tsx',
  'src/app/routes/Workspace.tsx',
]

function inspectStatsKeySource(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null
  const root = path.resolve(candidate.trim())
  try {
    if (!statSync(root).isDirectory()) return null
    if (
      !REQUIRED_SOURCE_PATHS.every((relativePath) =>
        existsSync(path.join(root, relativePath))
      )
    ) {
      return null
    }
    const desktopPackage = JSON.parse(
      readFileSync(path.join(root, 'desktop/package.json'), 'utf8')
    )
    if (
      desktopPackage?.name !== 'statskey-desktop' ||
      typeof desktopPackage?.version !== 'string'
    ) {
      return null
    }
    return {
      rootPath: root,
      version: desktopPackage.version.slice(0, 64),
    }
  } catch {
    return null
  }
}

function findStatsKeySource(candidates) {
  const seen = new Set()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    const resolved = path.resolve(candidate.trim())
    if (seen.has(resolved)) continue
    seen.add(resolved)
    const source = inspectStatsKeySource(resolved)
    if (source) return source
  }
  return null
}

module.exports = {
  REQUIRED_SOURCE_PATHS,
  findStatsKeySource,
  inspectStatsKeySource,
}
