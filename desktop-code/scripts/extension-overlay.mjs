import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'

const IGNORED_NAMES = new Set(['node_modules', 'out', 'tsconfig.tsbuildinfo'])

export function overlayStatsKeyExtension(root, checkoutDir) {
  const extensionSource = path.join(root, 'extensions', 'statskey-workbench')
  const extensionTarget = path.join(checkoutDir, 'extensions', 'statskey-workbench')
  if (!existsSync(extensionSource)) {
    throw new Error(`Missing canonical StatsKey extension: ${extensionSource}`)
  }
  if (existsSync(extensionTarget)) {
    rmSync(extensionTarget, { recursive: true, force: true })
  }
  cpSync(extensionSource, extensionTarget, {
    recursive: true,
    filter: (source) => !IGNORED_NAMES.has(path.basename(source)),
  })
}

export function assertStatsKeyExtensionCurrent(root, checkoutDir) {
  const extensionSource = path.join(root, 'extensions', 'statskey-workbench')
  const extensionTarget = path.join(checkoutDir, 'extensions', 'statskey-workbench')
  const differences = compareTrees(extensionSource, extensionTarget)
  if (differences.length > 0) {
    throw new Error(
      `The checkout's StatsKey extension is stale (${differences.slice(0, 5).join(', ')}). ` +
      'Run npm run build so the canonical extension is overlaid and compiled.'
    )
  }
}

function compareTrees(sourceDir, targetDir, relativeDir = '') {
  if (!existsSync(sourceDir) || !existsSync(targetDir)) {
    return [relativeDir || 'extension root']
  }

  const sourceNames = includedNames(sourceDir)
  const targetNames = includedNames(targetDir)
  const allNames = new Set([...sourceNames, ...targetNames])
  const differences = []

  for (const name of allNames) {
    const relativePath = path.join(relativeDir, name)
    const sourcePath = path.join(sourceDir, name)
    const targetPath = path.join(targetDir, name)
    if (!sourceNames.has(name) || !targetNames.has(name)) {
      differences.push(relativePath)
      continue
    }

    const sourceEntry = entry(sourcePath)
    const targetEntry = entry(targetPath)
    if (sourceEntry.directory !== targetEntry.directory) {
      differences.push(relativePath)
    } else if (sourceEntry.directory) {
      differences.push(...compareTrees(sourcePath, targetPath, relativePath))
    } else if (!readFileSync(sourcePath).equals(readFileSync(targetPath))) {
      differences.push(relativePath)
    }
  }

  return differences
}

function includedNames(directory) {
  return new Set(
    readdirSync(directory)
      .filter((name) => !IGNORED_NAMES.has(name))
  )
}

function entry(filePath) {
  const directory = readdirSync(path.dirname(filePath), { withFileTypes: true })
    .find((candidate) => candidate.name === path.basename(filePath))
    ?.isDirectory()
  return { directory: Boolean(directory) }
}
