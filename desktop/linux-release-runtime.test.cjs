'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  EXPECTED_APPARMOR_PROFILE,
  EXPECTED_APPARMOR_PROFILE_KIND,
  LINUX_NATIVE_VERIFICATION_SCHEMA,
  assertDebContents,
  assertLinuxNativeVerification,
  assertSupportedUbuntuHost,
  inspectLinuxUnpacked,
  parseOsRelease,
  recordLinuxNativeVerification,
} = require('./linux-release-runtime.cjs')

const VERSION = '0.21.8'
const COMMIT = 'a'.repeat(40)
const OS_RELEASE = [
  'ID=ubuntu',
  'VERSION_ID="26.04"',
  'PRETTY_NAME="Ubuntu 26.04 LTS"',
  '',
].join('\n')

test('Ubuntu host verification is pinned to 26.04 LTS x64', () => {
  assert.deepEqual(parseOsRelease(OS_RELEASE), {
    ID: 'ubuntu',
    VERSION_ID: '26.04',
    PRETTY_NAME: 'Ubuntu 26.04 LTS',
  })
  assert.deepEqual(
    assertSupportedUbuntuHost({
      platform: 'linux',
      arch: 'x64',
      osRelease: OS_RELEASE,
    }),
    {
      id: 'ubuntu',
      version: '26.04',
      prettyName: 'Ubuntu 26.04 LTS',
    }
  )
  assert.throws(
    () =>
      assertSupportedUbuntuHost({
        platform: 'linux',
        arch: 'arm64',
        osRelease: OS_RELEASE,
      }),
    /Linux x64/
  )
  assert.throws(
    () =>
      assertSupportedUbuntuHost({
        platform: 'linux',
        arch: 'x64',
        osRelease: OS_RELEASE.replace('26.04', '24.04'),
      }),
    /Ubuntu 26\.04 LTS/
  )
})

test('Ubuntu DEB contents require app, desktop, icon, package type, and AppArmor', () => {
  const contents = debContents()
  assert.equal(assertDebContents(contents), true)
  assert.throws(
    () => assertDebContents(contents.replace(/.*apparmor-profile.*\n/, '')),
    /missing its executable/
  )
})

test('Linux unpacked inspection pins ELF, DEB, and linux-x64 node-pty', (t) => {
  const fixture = linuxFixture(t)
  assert.deepEqual(inspectLinuxUnpacked(fixture.appDirectory), {
    executablePath: path.join(fixture.appDirectory, 'statskey'),
    resources: path.join(fixture.appDirectory, 'resources'),
    packageType: 'deb',
    nodePtyPrebuild: 'linux-x64',
    appArmorProfile: EXPECTED_APPARMOR_PROFILE_KIND,
  })
  const profilePath = path.join(
    fixture.appDirectory,
    'resources',
    'apparmor-profile'
  )
  writeFileSync(profilePath, `${EXPECTED_APPARMOR_PROFILE}capability,\n`)
  assert.throws(
    () => inspectLinuxUnpacked(fixture.appDirectory),
    /AppArmor profile/
  )
  writeFileSync(profilePath, EXPECTED_APPARMOR_PROFILE)
  mkdirSync(
    path.join(
      fixture.appDirectory,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'prebuilds',
      'darwin-arm64'
    )
  )
  assert.throws(
    () => inspectLinuxUnpacked(fixture.appDirectory),
    /only the linux-x64/
  )
})

test('native Ubuntu verification binds package, metadata, source, and host', (t) => {
  const fixture = linuxFixture(t)
  const record = recordLinuxNativeVerification({
    recordPath: fixture.recordPath,
    artifactPath: fixture.artifactPath,
    metadataPath: fixture.metadataPath,
    appDirectory: fixture.appDirectory,
    version: VERSION,
    sourceCommit: COMMIT,
    desktopTestsPassed: true,
    publicBoundaryPassed: true,
    platform: 'linux',
    arch: 'x64',
    osRelease: OS_RELEASE,
    runCommand: fakeDpkg,
    now: () => new Date('2026-08-19T17:00:00.000Z'),
  })
  assert.equal(record.schema, LINUX_NATIVE_VERIFICATION_SCHEMA)
  assert.equal(record.schemaVersion, 2)
  assert.equal(record.package.name, 'statskey-desktop')
  assert.equal(record.target.distributionVersion, '26.04')
  assert.equal(
    record.checks.appArmorProfile,
    EXPECTED_APPARMOR_PROFILE_KIND
  )
  assert.equal(
    assertLinuxNativeVerification({
      recordPath: fixture.recordPath,
      artifactPath: fixture.artifactPath,
      metadataPath: fixture.metadataPath,
      version: VERSION,
      sourceCommit: COMMIT,
    }).checks.nodePtyPrebuild,
    'linux-x64'
  )

  writeFileSync(fixture.artifactPath, 'tampered package')
  assert.throws(
    () =>
      assertLinuxNativeVerification({
        recordPath: fixture.recordPath,
        artifactPath: fixture.artifactPath,
        metadataPath: fixture.metadataPath,
        version: VERSION,
        sourceCommit: COMMIT,
      }),
    /differs from Ubuntu native verification/
  )
})

test('Ubuntu verification never accepts missing test or boundary proof', (t) => {
  const fixture = linuxFixture(t)
  assert.throws(
    () =>
      recordLinuxNativeVerification({
        recordPath: fixture.recordPath,
        artifactPath: fixture.artifactPath,
        metadataPath: fixture.metadataPath,
        appDirectory: fixture.appDirectory,
        version: VERSION,
        sourceCommit: COMMIT,
        desktopTestsPassed: true,
        publicBoundaryPassed: false,
        platform: 'linux',
        arch: 'x64',
        osRelease: OS_RELEASE,
        runCommand: fakeDpkg,
      }),
    /desktop tests and the public release boundary/
  )
})

test('desktop package declares an explicit Ubuntu DEB contract', () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(__dirname, 'package.json'), 'utf8')
  )
  assert.equal(packageJson.homepage, 'https://statskey.ai')
  assert.match(packageJson.author.email, /@/)
  assert.equal(packageJson.desktopName, 'statskey.desktop')
  assert.equal(packageJson.build.linux.icon, packageJson.build.mac.icon)
  assert.equal(packageJson.build.linux.executableName, 'statskey')
  assert.equal(
    packageJson.build.linux.artifactName,
    '${productName}-${version}-linux-x64.${ext}'
  )
  assert.deepEqual(packageJson.build.linux.target, [
    { target: 'deb', arch: ['x64'] },
  ])
  assert.equal(packageJson.build.deb.packageName, 'statskey-desktop')
  assert.equal(packageJson.build.deb.packageCategory, 'devel')
  assert.ok(packageJson.build.deb.depends.includes('libasound2t64'))
})

test('container smoke is pinned to Ubuntu and never disables Chromium sandboxing', () => {
  const smoke = readFileSync(
    path.join(__dirname, 'ubuntu-container-smoke.sh'),
    'utf8'
  )
  assert.match(smoke, /ubuntu:26\.04:x86_64/)
  assert.match(smoke, /chrome-sandbox/)
  assert.match(smoke, /statskey-ubuntu-pty-ok/)
  assert.match(smoke, /flags=\(unconfined\)/)
  assert.match(smoke, /apparmor_parser --skip-kernel-load --debug/)
  assert.match(
    smoke,
    /localhost:43127\/\.well-known\/statskey-desktop-health/
  )
  assert.match(smoke, /setsid runuser/)
  assert.match(smoke, /kill -TERM -- "-\$app_pid"/)
  assert.doesNotMatch(smoke, /--no-sandbox/)
})

function linuxFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'statskey-linux-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const artifactPath = path.join(root, `StatsKey-${VERSION}-linux-x64.deb`)
  const metadataPath = path.join(root, 'latest-linux.yml')
  const recordPath = path.join(root, 'linux-native-verification.json')
  const appDirectory = path.join(root, 'linux-unpacked')
  const resources = path.join(appDirectory, 'resources')
  const prebuild = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds',
    'linux-x64'
  )
  mkdirSync(prebuild, { recursive: true })
  writeFileSync(artifactPath, 'debian package bytes')
  writeFileSync(
    metadataPath,
    `version: ${VERSION}\npath: ${path.basename(artifactPath)}\n`
  )
  writeFileSync(path.join(resources, 'app.asar'), 'StatsKey application')
  writeFileSync(path.join(resources, 'package-type'), 'deb\n')
  writeFileSync(
    path.join(resources, 'apparmor-profile'),
    EXPECTED_APPARMOR_PROFILE
  )
  writeFileSync(
    path.join(appDirectory, 'statskey'),
    x64ElfFixture()
  )
  chmodSync(path.join(appDirectory, 'statskey'), 0o755)
  writeFileSync(path.join(prebuild, 'pty.node'), x64ElfFixture())
  return {
    appDirectory,
    artifactPath,
    metadataPath,
    recordPath,
  }
}

function x64ElfFixture() {
  const header = Buffer.alloc(20)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(header)
  header[4] = 2
  header[5] = 1
  header[6] = 1
  header.writeUInt16LE(0x3e, 18)
  return header
}

function fakeDpkg(command, args) {
  assert.equal(command, 'dpkg-deb')
  if (args[0] === '--contents') return debContents()
  const fields = {
    Package: 'statskey-desktop',
    Version: VERSION,
    Architecture: 'amd64',
    Maintainer: 'StatsKey <ryanws@statskeybiometrics.com>',
    Homepage: 'https://statskey.ai',
    Section: 'devel',
    Priority: 'optional',
    Depends: 'libgtk-3-0, libsecret-1-0, libasound2t64',
  }
  return `${fields[args[2]]}\n`
}

function debContents() {
  return [
    '-rwxr-xr-x root/root ./opt/StatsKey/statskey',
    '-rw-r--r-- root/root ./opt/StatsKey/resources/app.asar',
    '-rw-r--r-- root/root ./opt/StatsKey/resources/package-type',
    '-rw-r--r-- root/root ./opt/StatsKey/resources/apparmor-profile',
    '-rw-r--r-- root/root ./usr/share/applications/statskey.desktop',
    '-rw-r--r-- root/root ./usr/share/icons/hicolor/512x512/apps/statskey.png',
    '',
  ].join('\n')
}
