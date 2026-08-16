const {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} = require('node:fs')
const path = require('node:path')

const FORBIDDEN_PUBLIC_MARKERS = Object.freeze([
  'Founder Console',
  'FounderConsole',
  'StatsKey Founder',
  'founder-runtime.cjs',
  'founder-capabilities.enabled',
  'statskey-desktop:founder',
  '--statskey-founder',
  'StatsKey-Oil',
  'Oil Data lake',
  'open-truenas',
  'open-mac-screen',
  'ryans-mac-mini.local',
  'RTX workstation',
])
const FORBIDDEN_PUBLIC_PATH = /(?:FounderConsole|founder-runtime|founder-main)/i
const SCAN_CHUNK_BYTES = 256 * 1024

function assertPublicDesktopBundle({ appArchivePath, webRoot }) {
  assertRegularFile(appArchivePath, 'packaged application archive')
  assertFileHasNoForbiddenMarker(appArchivePath)
  assertPublicWebBundle(webRoot)
}

function assertPublicWebBundle(webRoot) {
  assertDirectory(webRoot, 'packaged web root')
  const pending = [webRoot]
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      const relativePath = path.relative(webRoot, candidate)
      if (FORBIDDEN_PUBLIC_PATH.test(relativePath)) {
        throw new Error(
          `Public desktop bundle contains an internal-only path: ${relativePath}`
        )
      }
      if (entry.isDirectory()) {
        pending.push(candidate)
      } else if (entry.isFile()) {
        assertFileHasNoForbiddenMarker(candidate, relativePath)
      }
    }
  }
}

function assertFileHasNoForbiddenMarker(filePath, label = path.basename(filePath)) {
  const descriptor = openSync(filePath, 'r')
  const longestMarker = Math.max(
    ...FORBIDDEN_PUBLIC_MARKERS.map((marker) => Buffer.byteLength(marker))
  )
  const buffer = Buffer.alloc(SCAN_CHUNK_BYTES)
  let overlap = Buffer.alloc(0)
  let position = 0
  try {
    while (true) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        position
      )
      if (bytesRead === 0) break
      position += bytesRead
      const sample = Buffer.concat([overlap, buffer.subarray(0, bytesRead)])
      for (const marker of FORBIDDEN_PUBLIC_MARKERS) {
        if (sample.includes(Buffer.from(marker))) {
          throw new Error(
            `Public desktop bundle contains internal-only content in ${label}: ${marker}`
          )
        }
      }
      overlap = sample.subarray(
        Math.max(0, sample.length - Math.max(0, longestMarker - 1))
      )
    }
  } finally {
    closeSync(descriptor)
  }
}

function assertRegularFile(candidate, label) {
  if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
    throw new Error(`Missing ${label}: ${candidate}`)
  }
}

function assertDirectory(candidate, label) {
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) {
    throw new Error(`Missing ${label}: ${candidate}`)
  }
}

module.exports = {
  FORBIDDEN_PUBLIC_MARKERS,
  assertPublicDesktopBundle,
  assertFileHasNoForbiddenMarker,
  assertPublicWebBundle,
}
