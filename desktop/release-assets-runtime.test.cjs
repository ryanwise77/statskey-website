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

test('Mac and Windows use the committed repo-local source icon byte-for-byte', () => {
  const expectedSha256 =
    '41c0385e06ce8106860168346c20f6dcdb60887d66f6fff78f4d1338db5ffd38'
  assert.equal(packageJson.build.mac.icon, 'assets/AppIcon-1024.png')
  assert.equal(packageJson.build.win.icon, packageJson.build.mac.icon)
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
  assert.equal(required.has('desktop/public-release-boundary.cjs'), true)
})

test('the unpublished 0.19.0 notes and fallback use the August 13 date', () => {
  const updates = JSON.parse(
    readFileSync(
      path.join(projectRoot, 'public', 'downloads', 'statskey', 'updates.json'),
      'utf8'
    )
  )
  const release = updates.releases.find((candidate) => candidate.version === '0.19.0')
  assert.equal(release?.date, '2026-08-13')
  const html = readFileSync(
    path.join(projectRoot, 'public', 'downloads', 'statskey', 'index.html'),
    'utf8'
  )
  assert.match(html, /datetime="2026-08-13">August 13, 2026<\/time>/)
  assert.doesNotMatch(html, /datetime="2026-08-12">August 12, 2026<\/time>/)
})

test('download manifest application stays safe when platform versions split', () => {
  const html = readFileSync(
    path.join(projectRoot, 'public', 'downloads', 'statskey', 'index.html'),
    'utf8'
  )
  assert.match(html, /const macVersion = "0\.21\.5";/)
  const history = JSON.parse(
    readFileSync(
      path.join(projectRoot, 'public', 'downloads', 'statskey', 'updates.json'),
      'utf8'
    )
  )
  const windowsRelease = history.releases.find((release) =>
    Array.isArray(release?.platforms) && release.platforms.includes('Windows')
  )
  assert.ok(windowsRelease?.version)
  assert.match(
    html,
    new RegExp(`const windowsVersion = "${windowsRelease.version.replaceAll('.', '\\.')}";`)
  )
  assert.match(html, /new Set\(\[macVersion, windowsVersion\]\)/)
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
