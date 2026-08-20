const {
  readFileSync,
  renameSync,
  writeFileSync,
} = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  latestPlatformVersion,
  nextDownloadPage,
  nextPackageDocument,
  nextPackageLockDocument,
  nextUpdateHistory,
} = require('./prepare-update-runtime.cjs')
const { safePublicCopy } = require('./release-notes-runtime.cjs')

const args = process.argv.slice(2)
const sourceRoot = path.resolve(__dirname, '..')
const packagePath = path.join(__dirname, 'package.json')
const packageLockPath = path.join(__dirname, 'package-lock.json')
const historyPath = path.join(
  sourceRoot,
  'public',
  'downloads',
  'statskey',
  'updates.json'
)
const pagePath = path.join(
  sourceRoot,
  'public',
  'downloads',
  'statskey',
  'index.html'
)

try {
  const version = requiredValue('--version')
  const platform = value('--platform') || 'mac'
  if (!['mac', 'windows', 'linux'].includes(platform)) {
    throw new Error('--platform must be mac, windows, or linux.')
  }
  const preview = flag('--preview')
  if (preview && !['windows', 'linux'].includes(platform)) {
    throw new Error(
      '--preview is supported only with --platform windows or linux.'
    )
  }
  if (platform === 'linux' && !preview) {
    throw new Error(
      '--platform linux requires --preview until package signing is implemented.'
    )
  }
  const title = publicValue('--title', 72)
  const summary = publicValue('--summary', 240)
  const highlights = values('--highlight').map((value) => {
    const safe = safePublicCopy(value, 180)
    if (!safe) throw new Error('Each highlight must be 1–180 plain-text characters.')
    return safe
  })
  if (highlights.length < 1 || highlights.length > 6) {
    throw new Error('Provide between one and six --highlight values.')
  }
  const date = value('--date') || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('--date must use YYYY-MM-DD.')
  }

  const packageDocument = readJson(packagePath)
  const packageLockDocument = readJson(packageLockPath)
  const historyDocument = readJson(historyPath)
  if (
    packageDocument.version !== packageLockDocument.version ||
    packageDocument.version !== packageLockDocument.packages?.['']?.version ||
    packageDocument.version !== historyDocument.latest
  ) {
    throw new Error(
      'Desktop package, lockfile, and public update history must start on the same version.'
    )
  }

  const nextPackage = nextPackageDocument(packageDocument, version)
  const nextPackageLock = nextPackageLockDocument(packageLockDocument, version)
  const nextHistory = nextUpdateHistory(historyDocument, {
    version,
    date,
    title,
    summary,
    highlights,
  }, {
    platform,
    preview,
  })
  const currentPlatformVersion = latestPlatformVersion(historyDocument, platform)
  const nextPage = nextDownloadPage(
    readFileSync(pagePath, 'utf8'),
    currentPlatformVersion,
    version,
    { platform, preview }
  )

  writeAtomic(packagePath, json(nextPackage))
  writeAtomic(packageLockPath, json(nextPackageLock))
  writeAtomic(historyPath, json(nextHistory))
  writeAtomic(pagePath, nextPage)
  console.log(
    `Prepared StatsKey ${version} ${
      platform === 'mac'
        ? 'Mac'
        : platform === 'linux'
          ? 'Ubuntu preview'
          : preview
            ? 'Windows preview'
            : 'Windows'
    } metadata across the package, lockfile, update history, and download page.`
  )
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

function value(name) {
  const direct = args.find((argument) => argument.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1).trim()
  const index = args.indexOf(name)
  return index >= 0 ? String(args[index + 1] || '').trim() : ''
}

function requiredValue(name) {
  const result = value(name)
  if (!result) throw new Error(`${name} is required.`)
  return result
}

function flag(name) {
  return args.includes(name)
}

function values(name) {
  const result = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === name) {
      result.push(String(args[index + 1] || '').trim())
      index += 1
    } else if (argument.startsWith(`${name}=`)) {
      result.push(argument.slice(name.length + 1).trim())
    }
  }
  return result.filter(Boolean)
}

function publicValue(name, maximum) {
  const result = safePublicCopy(requiredValue(name), maximum)
  if (!result) {
    throw new Error(`${name} must be 1–${maximum} plain-text characters.`)
  }
  return result
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function json(document) {
  return `${JSON.stringify(document, null, 2)}\n`
}

function writeAtomic(filePath, contents) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`
  writeFileSync(temporary, contents)
  renameSync(temporary, filePath)
}
