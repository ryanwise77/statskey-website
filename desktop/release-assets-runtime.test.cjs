const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, lstatSync, readFileSync, realpathSync } = require('node:fs')
const path = require('node:path')

const desktopRoot = __dirname
const projectRoot = path.resolve(desktopRoot, '..')
const packageJson = JSON.parse(
  readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')
)
const { REQUIRED_RELEASE_SOURCE_FILES } = require('./release-integrity-runtime.cjs')
const { latestPlatformVersion } = require('./prepare-update-runtime.cjs')

function assertWindowsSigningDisclosure(release, html) {
  const windowsVersion = release.version.replaceAll('.', '\\.')
  if (release.windowsSigning === 'unsigned-preview') {
    assert.match(html, new RegExp(`Windows ${windowsVersion} preview`))
    assert.match(
      html,
      /Windows[^<.]{0,240}unsigned|unsigned[^<.]{0,240}Windows/i
    )
  } else {
    assert.equal('windowsSigning' in release, false)
    assert.match(html, new RegExp(`Windows ${windowsVersion} signed`))
    assert.match(html, /On Windows, the installer and app are digitally signed\./)
    assert.doesNotMatch(html, new RegExp(`Windows ${windowsVersion} preview`))
  }
}

function assertLinuxSigningDisclosure(release, html) {
  const linuxVersion = release.version.replaceAll('.', '\\.')
  assert.equal(release.linuxSigning, 'unsigned-preview')
  assert.match(html, new RegExp(`Ubuntu ${linuxVersion} preview`))
  assert.match(
    html,
    /Ubuntu[\s\S]{0,320}unsigned|unsigned[\s\S]{0,320}Ubuntu/i
  )
  assert.match(html, /automatic updates and unattended Fleet jobs are disabled/i)
}

test('Mac, Windows, and Ubuntu use the committed repo-local source icon byte-for-byte', () => {
  const expectedSha256 =
    '41c0385e06ce8106860168346c20f6dcdb60887d66f6fff78f4d1338db5ffd38'
  assert.equal(packageJson.build.mac.icon, 'assets/AppIcon-1024.png')
  assert.equal(packageJson.build.win.icon, packageJson.build.mac.icon)
  assert.equal(packageJson.build.linux.icon, packageJson.build.mac.icon)
  const iconPath = path.resolve(desktopRoot, packageJson.build.mac.icon)
  assert.equal(existsSync(iconPath), true)
  assert.equal(lstatSync(iconPath).isFile(), true)
  assert.equal(realpathSync(iconPath).startsWith(`${realpathSync(desktopRoot)}${path.sep}`), true)
  assert.equal(
    createHash('sha256').update(readFileSync(iconPath)).digest('hex'),
    expectedSha256
  )

  const mainSource = readFileSync(path.join(desktopRoot, 'main.cjs'), 'utf8')
  assert.match(mainSource, /path\.resolve\(__dirname, 'assets', 'AppIcon-1024\.png'\)/)
  assert.doesNotMatch(mainSource, /StatsKey\/biometrics\/StatsKey\/Assets\.xcassets/)
})

test('every packaged desktop source file must be committed in the snapshot', () => {
  const required = new Set(REQUIRED_RELEASE_SOURCE_FILES)
  assert.equal(packageJson.build.files.includes('founder-runtime.cjs'), false)
  for (const relativePath of packageJson.build.files) {
    assert.equal(
      required.has(`desktop/${relativePath}`),
      true,
      `${relativePath} is missing from release source integrity checks`
    )
  }
  assert.equal(required.has(`desktop/${packageJson.build.afterPack}`), true)
  assert.equal(required.has(`desktop/${packageJson.build.mac.icon}`), true)
  assert.equal(required.has(`desktop/${packageJson.build.win.icon}`), true)
  assert.equal(required.has(`desktop/${packageJson.build.linux.icon}`), true)
  assert.equal(required.has('desktop/linux-release-runtime.cjs'), true)
  assert.equal(required.has('desktop/public-release-boundary.cjs'), true)
})

test('retained public metadata describes active desktop releases safely', () => {
  const history = JSON.parse(
    readFileSync(
      path.join(projectRoot, 'public', 'downloads', 'statskey', 'updates.json'),
      'utf8'
    )
  )
  const html = readFileSync(
    path.join(projectRoot, 'public', 'downloads', 'statskey', 'index.html'),
    'utf8'
  )
  assert.equal(history.schemaVersion, 1)

  const active = {
    macOS: history.releases.find(
      (release) => release?.version === latestPlatformVersion(history, 'mac')
    ),
    Windows: history.releases.find(
      (release) => release?.version === latestPlatformVersion(history, 'windows')
    ),
    Linux: history.releases.find(
      (release) => release?.version === latestPlatformVersion(history, 'linux')
    ),
  }
  for (const [platform, release] of Object.entries(active)) {
    assert.ok(release)
    assert.equal(release.platforms.includes(platform), true)
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(release.title, release.title.trim())
    assert.equal(release.title.length >= 1 && release.title.length <= 72, true)
    assert.doesNotMatch(release.title, /[<>]/)
    assert.equal(release.summary, release.summary.trim())
    assert.equal(release.summary.length >= 1 && release.summary.length <= 240, true)
    assert.doesNotMatch(release.summary, /[<>]/)
    assert.equal(
      release.highlights.length >= 1 && release.highlights.length <= 6,
      true
    )
    for (const highlight of release.highlights) {
      assert.equal(highlight, highlight.trim())
      assert.equal(highlight.length >= 1 && highlight.length <= 180, true)
      assert.doesNotMatch(highlight, /[<>]/)
    }
  }

  assert.equal('windowsSigning' in active.macOS, false)
  assertWindowsSigningDisclosure(active.Windows, html)
  assertLinuxSigningDisclosure(active.Linux, html)
})

test('signed Windows metadata requires signed public copy', () => {
  const release = { version: '1.2.3', platforms: ['Windows'] }
  assert.doesNotThrow(() =>
    assertWindowsSigningDisclosure(
      release,
      'Windows 1.2.3 signed. On Windows, the installer and app are digitally signed.'
    )
  )
  assert.throws(() =>
    assertWindowsSigningDisclosure(
      release,
      'Windows 1.2.3 preview. The Windows preview is unsigned.'
    )
  )
})

test('download manifest application stays safe when platform versions split', () => {
  const html = readFileSync(
    path.join(projectRoot, 'public', 'downloads', 'statskey', 'index.html'),
    'utf8'
  )
  const history = JSON.parse(
    readFileSync(
      path.join(projectRoot, 'public', 'downloads', 'statskey', 'updates.json'),
      'utf8'
    )
  )
  assert.equal(history.latest, packageJson.version)
  const latestRelease = history.releases.find(
    (release) => release?.version === packageJson.version
  )
  assert.ok(latestRelease)
  assert.equal(
    latestRelease.platforms?.some((platform) =>
      ['macOS', 'Windows', 'Linux'].includes(platform)
    ),
    true
  )
  const macVersion = latestPlatformVersion(history, 'mac')
  const windowsVersion = latestPlatformVersion(history, 'windows')
  const linuxVersion = latestPlatformVersion(history, 'linux')
  assert.match(
    html,
    new RegExp(`const macVersion = "${macVersion.replaceAll('.', '\\.')}";`)
  )
  assert.match(
    html,
    new RegExp(`const windowsVersion = "${windowsVersion.replaceAll('.', '\\.')}";`)
  )
  assert.match(
    html,
    new RegExp(`const linuxVersion = "${linuxVersion.replaceAll('.', '\\.')}";`)
  )
  assert.match(
    html,
    /new Set\(\[macVersion, windowsVersion, linuxVersion\]\)/
  )
  assert.match(
    html,
    /userAgent\.includes\("linux"\) && !userAgent\.includes\("android"\)/
  )
  assert.match(
    html,
    /if \(targets\[target\]\?\.version !== version\) continue;/
  )
})

test('desktop web builds use a shell-independent Vite mode', () => {
  const rootPackage = JSON.parse(
    readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  )
  assert.equal(rootPackage.scripts?.['build:desktop'], 'vite build --mode desktop')
  assert.doesNotMatch(rootPackage.scripts?.['build:desktop'] || '', /^[A-Z_]+=./)

  const viteConfig = readFileSync(path.join(projectRoot, 'vite.config.js'), 'utf8')
  assert.match(viteConfig, /mode === 'desktop'/)
  assert.match(viteConfig, /desktopBuildInputs\(desktopOnly\)/)
})

test('root Windows preview publisher forwards appended flags directly', () => {
  const rootPackage = JSON.parse(
    readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  )
  const command = rootPackage.scripts?.['release:desktop:publish:windows-preview']

  assert.equal(
    command,
    'node desktop/publish-update.cjs --confirm-publish --windows-only --preview --reuse-build'
  )
  assert.doesNotMatch(command, /\bnpm\b|--prefix/)
})

test('Ubuntu publisher is native, preview-only, and does not require a blockmap', () => {
  const rootPackage = JSON.parse(
    readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  )
  const desktopPackage = JSON.parse(
    readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')
  )
  const publisher = readFileSync(
    path.join(desktopRoot, 'publish-update.cjs'),
    'utf8'
  )
  assert.equal(
    rootPackage.scripts?.['release:desktop:prepare:linux-preview'],
    'node desktop/publish-update.cjs --prepare-only --linux-only --preview'
  )
  assert.equal(
    rootPackage.scripts?.['release:desktop:publish:linux-preview'],
    'node desktop/publish-update.cjs --confirm-publish --linux-only --preview --reuse-build'
  )
  assert.equal(
    desktopPackage.scripts?.['release:prepare:linux:preview'],
    'node publish-update.cjs --prepare-only --linux-only --preview'
  )
  assert.match(publisher, /channel: 'linux-x64'/)
  assert.match(publisher, /metadata: 'latest-linux\.yml'/)
  assert.match(publisher, /contentType: 'application\/vnd\.debian\.binary-package'/)
  assert.match(
    publisher,
    /Ubuntu release preparation must run on native Ubuntu 26\.04 x64/
  )
  assert.match(publisher, /Ubuntu publication is currently an explicitly disclosed unsigned preview/)
  assert.match(publisher, /for \(const sidecar of target\.sidecars \|\| \[\]\)/)
  assert.doesNotMatch(
    publisher,
    /path\.join\(target\.output, `\$\{target\.artifact\}\.blockmap`\)/
  )
})

test('desktop persistence keeps a stable origin and reloads cancel owned work', () => {
  const mainSource = readFileSync(path.join(desktopRoot, 'main.cjs'), 'utf8')
  const preloadSource = readFileSync(path.join(desktopRoot, 'preload.cjs'), 'utf8')

  assert.match(mainSource, /return app\.isPackaged \? 43_127 : 43_128/)
  assert.doesNotMatch(mainSource, /await listen\(0\)/)
  assert.match(mainSource, /script-src 'self' 'wasm-unsafe-eval'/)
  assert.match(
    mainSource,
    /isCadKernelWorker[\s\S]*script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'/
  )
  assert.match(mainSource, /case '\.wasm': return 'application\/wasm'/)
  assert.match(
    mainSource,
    /did-start-loading[\s\S]*mainWindowReloadRequested[\s\S]*cancelRendererOwnedWork/
  )
  assert.match(
    mainSource,
    /render-process-gone[\s\S]*cancelRendererOwnedWork/
  )
  assert.match(
    mainSource,
    /terminalRuntime\.cancelWhere[\s\S]*metadata\?\.origin\?\.sessionId/
  )
  assert.match(mainSource, /statskey-desktop:durable-state-get/)
  assert.match(mainSource, /writeDurableRendererState[\s\S]*renameSync/)
  assert.match(preloadSource, /statskey\.cad\.session\.v1/)
  assert.match(preloadSource, /sendSync\('statskey-desktop:durable-state-get'/)
})
