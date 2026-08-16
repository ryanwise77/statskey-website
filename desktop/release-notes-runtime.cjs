const { readFileSync } = require('node:fs')

function loadPublicRelease(notesPath, releaseVersion) {
  let document
  try {
    document = JSON.parse(readFileSync(notesPath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read public update history: ${error.message}`)
  }
  const entry = Array.isArray(document?.releases)
    ? document.releases.find((candidate) => candidate?.version === releaseVersion)
    : null
  if (!entry || document.latest !== releaseVersion) {
    throw new Error(
      `Public update history must declare ${releaseVersion} as the latest release.`
    )
  }
  const title = safePublicCopy(entry.title, 72)
  const summary = safePublicCopy(entry.summary, 240)
  const highlights = Array.isArray(entry.highlights)
    ? entry.highlights.map((note) => safePublicCopy(note, 180)).filter(Boolean)
    : []
  if (!title || !summary || highlights.length < 1 || highlights.length > 6) {
    throw new Error(`Public update history for ${releaseVersion} is incomplete.`)
  }
  return { title, summary, highlights }
}

function safePublicCopy(value, maxLength) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text || text.length > maxLength || /[<>]/.test(text)) return ''
  return text
}

function yamlScalar(value) {
  return JSON.stringify(value)
}

function normalizeUpdateMetadata(
  metadata,
  { version, releaseEntry, downloadArtifact }
) {
  const lines = String(metadata).split(/\r?\n/)
  const normalized = []
  let inStatsKeyNotes = false
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === '# statskey-release-notes-start') {
      inStatsKeyNotes = true
      continue
    }
    if (lines[index].trim() === '# statskey-release-notes-end') {
      inStatsKeyNotes = false
      continue
    }
    if (inStatsKeyNotes) continue
    if (!downloadArtifact || lines[index].trim() !== `- url: ${downloadArtifact}`) {
      normalized.push(lines[index])
      continue
    }
    if (
      !lines[index + 1]?.trim().startsWith('sha512:') ||
      !lines[index + 2]?.trim().startsWith('size:')
    ) {
      throw new Error('Malformed download entry in update metadata.')
    }
    index += 2
  }
  const noteBlock = [
    '# statskey-release-notes-start',
    `releaseName: ${yamlScalar(`StatsKey ${version} — ${releaseEntry.title}`)}`,
    'releaseNotes: |-',
    ...releaseEntry.highlights.map((note) => `  - ${note}`),
    '# statskey-release-notes-end',
    '',
  ]
  return `${normalized.join('\n').replace(/\n+$/, '')}\n${noteBlock.join('\n')}`
}

module.exports = {
  loadPublicRelease,
  normalizeUpdateMetadata,
  safePublicCopy,
  yamlScalar,
}
