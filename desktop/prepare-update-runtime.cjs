const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

function compareVersions(left, right) {
  const a = String(left).split('-')[0].split('.').map(Number)
  const b = String(right).split('-')[0].split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return String(left).localeCompare(String(right))
}

function nextPackageDocument(document, version) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Package metadata must be a JSON object.')
  }
  if (!SEMVER.test(version)) throw new Error(`Invalid release version: ${version}`)
  if (!SEMVER.test(String(document.version || ''))) {
    throw new Error('Current package version is invalid.')
  }
  if (compareVersions(version, document.version) <= 0) {
    throw new Error(
      `Release version ${version} must be newer than ${document.version}.`
    )
  }
  return { ...document, version }
}

function nextPackageLockDocument(document, version) {
  const next = nextPackageDocument(document, version)
  const rootPackage = next.packages?.['']
  if (!rootPackage || typeof rootPackage !== 'object') {
    throw new Error('Package lock is missing its root package metadata.')
  }
  return {
    ...next,
    packages: {
      ...next.packages,
      '': { ...rootPackage, version },
    },
  }
}

function platformLabel(platform) {
  if (platform === 'mac') return 'macOS'
  if (platform === 'windows') return 'Windows'
  if (platform === 'linux') return 'Linux'
  throw new Error(`Unsupported release platform: ${platform}`)
}

function latestPlatformVersion(document, platform = 'mac') {
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.releases)) {
    throw new Error('Update history must use schemaVersion 1.')
  }
  const label = platformLabel(platform)
  const versions = document.releases
    .filter((entry) => Array.isArray(entry?.platforms) && entry.platforms.includes(label))
    .map((entry) => String(entry?.version || ''))
  if (versions.length < 1 || versions.some((version) => !SEMVER.test(version))) {
    throw new Error(`Update history is missing a valid ${label} release.`)
  }
  return versions.sort(compareVersions).at(-1)
}

function nextUpdateHistory(
  document,
  release,
  { platform = 'mac', preview = false } = {}
) {
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.releases)) {
    throw new Error('Update history must use schemaVersion 1.')
  }
  const label = platformLabel(platform)
  if (preview && !['windows', 'linux'].includes(platform)) {
    throw new Error('Preview releases are supported only for Windows or Linux.')
  }
  if (platform === 'linux' && !preview) {
    throw new Error(
      'Linux releases require preview mode until package signing is implemented.'
    )
  }
  if (!SEMVER.test(release.version)) {
    throw new Error(`Invalid release version: ${release.version}`)
  }
  if (document.releases.some((entry) => entry?.version === release.version)) {
    throw new Error(`Update history already contains ${release.version}.`)
  }
  const current = String(document.latest || '')
  if (!SEMVER.test(current) || compareVersions(release.version, current) <= 0) {
    throw new Error(
      `Release version ${release.version} must be newer than ${current}.`
    )
  }
  if (
    typeof release.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(release.date) ||
    typeof release.title !== 'string' ||
    !release.title.trim() ||
    typeof release.summary !== 'string' ||
    !release.summary.trim() ||
    !Array.isArray(release.highlights) ||
    release.highlights.length < 1 ||
    release.highlights.length > 6
  ) {
    throw new Error('Release metadata is incomplete.')
  }
  const releaseEntry = {
    version: release.version,
    date: release.date,
    platforms: [label],
    title: release.title.trim(),
    summary: release.summary.trim(),
    highlights: release.highlights.map((item) => String(item).trim()),
  }
  if (platform === 'windows' && preview) {
    releaseEntry.windowsSigning = 'unsigned-preview'
  }
  if (platform === 'linux') {
    releaseEntry.linuxSigning = 'unsigned-preview'
  }
  return {
    ...document,
    latest: release.version,
    releases: [releaseEntry, ...document.releases],
  }
}

function replaceExactly(contents, before, after, label, expectedCount) {
  let count = 0
  let index = contents.indexOf(before)
  while (index >= 0) {
    count += 1
    index = contents.indexOf(before, index + before.length)
  }
  if (count !== expectedCount) {
    const expected = expectedCount === 1 ? 'one' : String(expectedCount)
    throw new Error(
      `Expected exactly ${expected} ${label} marker${expectedCount === 1 ? '' : 's'} in the download page.`
    )
  }
  return contents.split(before).join(after)
}

function replaceExactlyOnce(contents, before, after, label) {
  return replaceExactly(contents, before, after, label, 1)
}

function replaceExactlyOneOf(contents, candidates, after, label) {
  const matches = candidates.flatMap((candidate) => {
    const indexes = []
    let index = contents.indexOf(candidate)
    while (index >= 0) {
      indexes.push({ candidate, index })
      index = contents.indexOf(candidate, index + candidate.length)
    }
    return indexes
  })
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} marker in the download page.`)
  }
  const [{ candidate, index }] = matches
  return `${contents.slice(0, index)}${after}${contents.slice(
    index + candidate.length
  )}`
}

function nextDownloadPage(
  contents,
  currentVersion,
  nextVersion,
  { platform = 'mac', preview = false } = {}
) {
  platformLabel(platform)
  if (preview && !['windows', 'linux'].includes(platform)) {
    throw new Error('Preview releases are supported only for Windows or Linux.')
  }
  if (platform === 'linux' && !preview) {
    throw new Error(
      'Linux releases require preview mode until package signing is implemented.'
    )
  }
  let next = String(contents)
  const replacements =
    platform === 'mac'
      ? [
          [
            `Mac ${currentVersion} · signed and Apple notarized`,
            `Mac ${nextVersion} · signed and Apple notarized`,
            'hero version',
          ],
          [
            `Mac ${currentVersion} · Windows`,
            `Mac ${nextVersion} · Windows`,
            'release status',
          ],
          [
            `/releases/${currentVersion}/StatsKey-${currentVersion}-mac-arm64.dmg`,
            `/releases/${nextVersion}/StatsKey-${nextVersion}-mac-arm64.dmg`,
            'Apple Silicon download',
            2,
          ],
          [
            `/releases/${currentVersion}/StatsKey-${currentVersion}-mac-x64.dmg`,
            `/releases/${nextVersion}/StatsKey-${nextVersion}-mac-x64.dmg`,
            'Intel download',
            1,
          ],
          [
            `const macVersion = "${currentVersion}";`,
            `const macVersion = "${nextVersion}";`,
            'runtime Mac version',
          ],
        ]
      : platform === 'windows'
        ? [
          [
            `Windows ${currentVersion}`,
            `Windows ${nextVersion}`,
            'release status',
          ],
          [
            `/releases/${currentVersion}/StatsKey-${currentVersion}-win-x64.exe`,
            `/releases/${nextVersion}/StatsKey-${nextVersion}-win-x64.exe`,
            'Windows download',
            2,
          ],
          [
            `const windowsVersion = "${currentVersion}";`,
            `const windowsVersion = "${nextVersion}";`,
            'runtime Windows version',
          ],
          ]
        : [
            [
              `Ubuntu ${currentVersion}`,
              `Ubuntu ${nextVersion}`,
              'release status',
            ],
            [
              `/releases/${currentVersion}/StatsKey-${currentVersion}-linux-x64.deb`,
              `/releases/${nextVersion}/StatsKey-${nextVersion}-linux-x64.deb`,
              'Ubuntu download',
            ],
            [
              `./StatsKey-${currentVersion}-linux-x64.deb`,
              `./StatsKey-${nextVersion}-linux-x64.deb`,
              'Ubuntu install command',
            ],
            [
              `const linuxVersion = "${currentVersion}";`,
              `const linuxVersion = "${nextVersion}";`,
              'runtime Ubuntu version',
            ],
          ]

  if (platform === 'windows') {
    const qualifier = preview ? 'preview' : 'signed'
    next = replaceExactlyOneOf(
      next,
      [
        `Windows ${currentVersion} preview</p>`,
        `Windows ${currentVersion} signed</p>`,
        `Windows ${currentVersion}</p>`,
      ],
      `Windows ${nextVersion} ${qualifier}</p>`,
      'hero version'
    )
    next = replaceExactlyOneOf(
      next,
      [
        'On Windows, SmartScreen may require\n            <strong>More info → Run anyway</strong> while the Windows preview is unsigned.',
        'On Windows, the installer and app are digitally signed.',
      ],
      preview
        ? 'On Windows, SmartScreen may require\n            <strong>More info → Run anyway</strong> while the Windows preview is unsigned.'
        : 'On Windows, the installer and app are digitally signed.',
      'Windows signing disclosure'
    )
  }
  if (platform === 'linux') {
    next = replaceExactlyOnce(
      next,
      `Ubuntu ${currentVersion} preview</p>`,
      `Ubuntu ${nextVersion} preview</p>`,
      'hero Ubuntu version'
    )
  }
  for (const [before, after, label, expectedCount = 1] of replacements) {
    next = replaceExactly(next, before, after, label, expectedCount)
  }
  return next
}

module.exports = {
  compareVersions,
  latestPlatformVersion,
  nextDownloadPage,
  nextPackageDocument,
  nextPackageLockDocument,
  nextUpdateHistory,
}
