const assert = require('node:assert/strict')
const test = require('node:test')
const {
  latestPlatformVersion,
  nextDownloadPage,
  nextPackageDocument,
  nextPackageLockDocument,
  nextUpdateHistory,
} = require('./prepare-update-runtime.cjs')

test('prepares package and lockfile versions without mutating the inputs', () => {
  const packageDocument = { name: 'statskey-desktop', version: '1.2.3' }
  const lockDocument = {
    name: 'statskey-desktop',
    version: '1.2.3',
    packages: { '': { name: 'statskey-desktop', version: '1.2.3' } },
  }
  assert.equal(nextPackageDocument(packageDocument, '1.2.4').version, '1.2.4')
  assert.equal(
    nextPackageLockDocument(lockDocument, '1.2.4').packages[''].version,
    '1.2.4'
  )
  assert.equal(packageDocument.version, '1.2.3')
  assert.equal(lockDocument.packages[''].version, '1.2.3')
})

test('prepends one complete Mac release to public history', () => {
  const current = {
    schemaVersion: 1,
    latest: '1.2.3',
    releases: [{ version: '1.2.3' }],
  }
  const next = nextUpdateHistory(current, {
    version: '1.2.4',
    date: '2026-08-17',
    title: 'Helpers that follow your lead',
    summary: 'A complete summary.',
    highlights: ['One improvement.'],
  })
  assert.equal(next.latest, '1.2.4')
  assert.deepEqual(next.releases[0].platforms, ['macOS'])
  assert.equal(next.releases[1].version, '1.2.3')
})

test('prepares signed and preview Windows history without affecting Mac history', () => {
  const current = {
    schemaVersion: 1,
    latest: '1.2.3',
    releases: [
      { version: '1.2.3', platforms: ['macOS'] },
      {
        version: '1.2.2',
        platforms: ['Windows'],
        windowsSigning: 'unsigned-preview',
      },
    ],
  }
  const release = {
    version: '1.2.4',
    date: '2026-08-17',
    title: 'Windows update',
    summary: 'A complete summary.',
    highlights: ['One improvement.'],
  }
  const preview = nextUpdateHistory(current, release, {
    platform: 'windows',
    preview: true,
  })
  assert.equal(preview.latest, '1.2.4')
  assert.deepEqual(preview.releases[0].platforms, ['Windows'])
  assert.equal(preview.releases[0].windowsSigning, 'unsigned-preview')
  assert.deepEqual(preview.releases.slice(1), current.releases)

  const signed = nextUpdateHistory(current, release, { platform: 'windows' })
  assert.deepEqual(signed.releases[0].platforms, ['Windows'])
  assert.equal('windowsSigning' in signed.releases[0], false)
})

test('finds the newest version for each platform independently', () => {
  const history = {
    schemaVersion: 1,
    latest: '2.0.0',
    releases: [
      { version: '2.0.0', platforms: ['Windows'] },
      { version: '1.9.0', platforms: ['macOS'] },
      { version: '1.8.5', platforms: ['Linux'] },
      { version: '1.8.0', platforms: ['macOS', 'Windows'] },
    ],
  }
  assert.equal(latestPlatformVersion(history), '1.9.0')
  assert.equal(latestPlatformVersion(history, 'windows'), '2.0.0')
  assert.equal(latestPlatformVersion(history, 'linux'), '1.8.5')
  assert.throws(
    () => latestPlatformVersion(history, 'freebsd'),
    /Unsupported release platform/
  )
})

test('updates only the active Mac markers on the download page', () => {
  const page = [
    'Mac 1.2.3 · signed and Apple notarized',
    'Mac 1.2.3 · Windows',
    '/releases/1.2.3/StatsKey-1.2.3-mac-arm64.dmg',
    '/releases/1.2.3/StatsKey-1.2.3-mac-arm64.dmg',
    '/releases/1.2.3/StatsKey-1.2.3-mac-x64.dmg',
    'const macVersion = "1.2.3";',
    'Windows 1.2.2 preview</p>',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    'const windowsVersion = "1.2.2";',
    'Historical release 1.2.3 remains text.',
  ].join('\n')
  const next = nextDownloadPage(page, '1.2.3', '1.2.4')
  assert.match(next, /Mac 1\.2\.4 · signed/)
  assert.equal(
    next.match(/releases\/1\.2\.4\/StatsKey-1\.2\.4-mac-arm64\.dmg/g)?.length,
    2
  )
  assert.doesNotMatch(next, /releases\/1\.2\.3\/StatsKey-1\.2\.3-mac-arm64\.dmg/)
  assert.match(next, /Historical release 1\.2\.3 remains text\./)
  assert.match(next, /Windows 1\.2\.2 preview/)
  assert.match(next, /const windowsVersion = "1\.2\.2";/)
})

test('updates only active Windows preview markers while preserving Mac', () => {
  const page = [
    'Mac 1.2.3 · signed and Apple notarized · Windows 1.2.2 preview</p>',
    'Mac 1.2.3 · Windows 1.2.2</span>',
    '/releases/1.2.3/StatsKey-1.2.3-mac-arm64.dmg',
    '/releases/1.2.3/StatsKey-1.2.3-mac-x64.dmg',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    'const macVersion = "1.2.3";',
    'const windowsVersion = "1.2.2";',
    'On Windows, SmartScreen may require\n            <strong>More info → Run anyway</strong> while the Windows preview is unsigned.',
    'Historical Windows release 1.2.2 remains text.',
  ].join('\n')
  const next = nextDownloadPage(page, '1.2.2', '1.2.4', {
    platform: 'windows',
    preview: true,
  })
  assert.match(next, /Windows 1\.2\.4 preview<\/p>/)
  assert.match(next, /Mac 1\.2\.3 · Windows 1\.2\.4<\/span>/)
  assert.equal(
    next.match(/releases\/1\.2\.4\/StatsKey-1\.2\.4-win-x64\.exe/g)?.length,
    2
  )
  assert.doesNotMatch(next, /releases\/1\.2\.2\/StatsKey-1\.2\.2-win-x64\.exe/)
  assert.match(next, /const windowsVersion = "1\.2\.4";/)
  assert.match(next, /Mac 1\.2\.3 · signed and Apple notarized/)
  assert.match(next, /const macVersion = "1\.2\.3";/)
  assert.match(next, /while the Windows preview is unsigned\./)
  assert.match(next, /Historical Windows release 1\.2\.2 remains text\./)
})

test('marks a signed Windows release without unsigned-preview metadata', () => {
  const page = [
    'Mac 1.2.3 · signed and Apple notarized · Windows 1.2.2 preview</p>',
    'Mac 1.2.3 · Windows 1.2.2</span>',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    'const windowsVersion = "1.2.2";',
    'On Windows, SmartScreen may require\n            <strong>More info → Run anyway</strong> while the Windows preview is unsigned.',
  ].join('\n')
  const next = nextDownloadPage(page, '1.2.2', '1.2.4', {
    platform: 'windows',
  })
  assert.match(next, /Windows 1\.2\.4 signed<\/p>/)
  assert.doesNotMatch(next, /Windows 1\.2\.4 preview/)
  assert.match(next, /On Windows, the installer and app are digitally signed\./)
  assert.doesNotMatch(next, /Windows preview is unsigned/)
})

test('prepares only explicitly unsigned Ubuntu preview metadata', () => {
  const current = {
    schemaVersion: 1,
    latest: '1.2.3',
    releases: [
      { version: '1.2.3', platforms: ['macOS'] },
      {
        version: '1.2.1',
        platforms: ['Linux'],
        linuxSigning: 'unsigned-preview',
      },
    ],
  }
  const release = {
    version: '1.2.4',
    date: '2026-08-19',
    title: 'Ubuntu preview',
    summary: 'A complete summary.',
    highlights: ['Ubuntu 26.04 packaging.'],
  }
  const next = nextUpdateHistory(current, release, {
    platform: 'linux',
    preview: true,
  })
  assert.deepEqual(next.releases[0].platforms, ['Linux'])
  assert.equal(next.releases[0].linuxSigning, 'unsigned-preview')
  assert.throws(
    () => nextUpdateHistory(current, release, { platform: 'linux' }),
    /require preview mode/
  )
})

test('updates Ubuntu preview markers without changing Mac or Windows', () => {
  const page = [
    'Mac 1.2.3 · signed and Apple notarized · Windows 1.2.2 preview · Ubuntu 1.2.1 preview</p>',
    'Mac 1.2.3 · Windows 1.2.2 · Ubuntu 1.2.1</span>',
    '/releases/1.2.1/StatsKey-1.2.1-linux-x64.deb',
    'sudo apt install ./StatsKey-1.2.1-linux-x64.deb',
    'const macVersion = "1.2.3";',
    'const windowsVersion = "1.2.2";',
    'const linuxVersion = "1.2.1";',
  ].join('\n')
  const next = nextDownloadPage(page, '1.2.1', '1.2.4', {
    platform: 'linux',
    preview: true,
  })
  assert.match(next, /Ubuntu 1\.2\.4 preview<\/p>/)
  assert.match(next, /Ubuntu 1\.2\.4<\/span>/)
  assert.match(
    next,
    /releases\/1\.2\.4\/StatsKey-1\.2\.4-linux-x64\.deb/
  )
  assert.match(next, /apt install \.\/StatsKey-1\.2\.4-linux-x64\.deb/)
  assert.match(next, /const linuxVersion = "1\.2\.4";/)
  assert.match(next, /const macVersion = "1\.2\.3";/)
  assert.match(next, /const windowsVersion = "1\.2\.2";/)
})

test('rejects preview metadata outside Windows and Linux', () => {
  const history = {
    schemaVersion: 1,
    latest: '1.2.3',
    releases: [{ version: '1.2.3', platforms: ['macOS'] }],
  }
  const release = {
    version: '1.2.4',
    date: '2026-08-17',
    title: 'Mac update',
    summary: 'A complete summary.',
    highlights: ['One improvement.'],
  }
  assert.throws(
    () => nextUpdateHistory(history, release, { preview: true }),
    /only for Windows or Linux/
  )
})

test('fails closed when a download-page marker is missing or duplicated', () => {
  assert.throws(
    () => nextDownloadPage('Mac 1.2.3 · signed and Apple notarized', '1.2.3', '1.2.4'),
    /exactly one release status marker/
  )
  const duplicatedWindowsHero = [
    'Windows 1.2.2 preview</p>',
    'Windows 1.2.2 signed</p>',
  ].join('\n')
  assert.throws(
    () =>
      nextDownloadPage(duplicatedWindowsHero, '1.2.2', '1.2.4', {
        platform: 'windows',
        preview: true,
      }),
    /exactly one hero version marker/
  )

  const incompleteMacDownloads = [
    'Mac 1.2.3 · signed and Apple notarized',
    'Mac 1.2.3 · Windows',
    '/releases/1.2.3/StatsKey-1.2.3-mac-arm64.dmg',
    '/releases/1.2.3/StatsKey-1.2.3-mac-x64.dmg',
    'const macVersion = "1.2.3";',
  ].join('\n')
  assert.throws(
    () => nextDownloadPage(incompleteMacDownloads, '1.2.3', '1.2.4'),
    /exactly 2 Apple Silicon download markers/
  )

  const extraWindowsDownloads = [
    'Mac 1.2.3 · signed and Apple notarized · Windows 1.2.2 preview</p>',
    'Mac 1.2.3 · Windows 1.2.2</span>',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    '/releases/1.2.2/StatsKey-1.2.2-win-x64.exe',
    'const windowsVersion = "1.2.2";',
    'On Windows, SmartScreen may require\n            <strong>More info → Run anyway</strong> while the Windows preview is unsigned.',
  ].join('\n')
  assert.throws(
    () =>
      nextDownloadPage(extraWindowsDownloads, '1.2.2', '1.2.4', {
        platform: 'windows',
        preview: true,
      }),
    /exactly 2 Windows download markers/
  )
})
