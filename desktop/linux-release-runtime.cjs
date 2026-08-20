'use strict'

const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const path = require('node:path')

const LINUX_NATIVE_VERIFICATION_FILE = 'linux-native-verification.json'
const LINUX_NATIVE_VERIFICATION_SCHEMA =
  'statskey.linux-native-verification.v2'
const SUPPORTED_UBUNTU_VERSION = '26.04'
const EXPECTED_DEBIAN_PACKAGE = 'statskey-desktop'
const EXPECTED_APPARMOR_PROFILE = [
  'abi <abi/4.0>,',
  'include <tunables/global>',
  '',
  'profile "statskey" "/opt/StatsKey/statskey" flags=(unconfined) {',
  '  userns,',
  '',
  '  # Site-specific additions and overrides. See local/README for details.',
  '  include if exists <local/statskey>',
  '}',
  '',
].join('\n')
const EXPECTED_APPARMOR_PROFILE_KIND = 'electron-userns-unconfined-v1'

function parseOsRelease(contents) {
  const result = {}
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match || Object.hasOwn(result, match[1])) {
      throw new Error('Ubuntu release metadata is malformed.')
    }
    result[match[1]] = osReleaseValue(match[2])
  }
  return result
}

function assertSupportedUbuntuHost({
  platform = process.platform,
  arch = process.arch,
  osRelease,
} = {}) {
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error(
      'Ubuntu release verification must run natively on Linux x64.'
    )
  }
  const release = parseOsRelease(osRelease)
  if (
    release.ID !== 'ubuntu' ||
    release.VERSION_ID !== SUPPORTED_UBUNTU_VERSION
  ) {
    throw new Error(
      `StatsKey Linux releases currently require Ubuntu ${SUPPORTED_UBUNTU_VERSION} LTS x64.`
    )
  }
  return {
    id: release.ID,
    version: release.VERSION_ID,
    prettyName:
      cleanText(release.PRETTY_NAME, 160) ||
      `Ubuntu ${SUPPORTED_UBUNTU_VERSION} LTS`,
  }
}

function inspectDebPackage({
  artifactPath,
  version,
  runCommand = runChecked,
} = {}) {
  assertRegularFile(artifactPath, 'Ubuntu DEB artifact')
  const fields = {}
  for (const field of [
    'Package',
    'Version',
    'Architecture',
    'Maintainer',
    'Homepage',
    'Section',
    'Priority',
    'Depends',
  ]) {
    fields[field] = runCommand('dpkg-deb', [
      '--field',
      artifactPath,
      field,
    ]).trim()
  }
  assertDebControlFields(fields, version)
  const contents = runCommand('dpkg-deb', ['--contents', artifactPath])
  assertDebContents(contents)
  return {
    name: fields.Package,
    version: fields.Version,
    architecture: fields.Architecture,
    maintainer: fields.Maintainer,
    homepage: fields.Homepage,
    section: fields.Section,
    priority: fields.Priority,
    dependencies: fields.Depends.split(',').map((value) => value.trim()),
  }
}

function assertDebControlFields(fields, version) {
  if (
    fields?.Package !== EXPECTED_DEBIAN_PACKAGE ||
    fields.Version !== version ||
    fields.Architecture !== 'amd64' ||
    !/^StatsKey\s+<[^<>\s]+@[^<>\s]+>$/.test(fields.Maintainer || '') ||
    fields.Homepage !== 'https://statskey.ai' ||
    fields.Section !== 'devel' ||
    fields.Priority !== 'optional' ||
    !String(fields.Depends || '')
      .split(',')
      .map((value) => value.trim())
      .includes('libasound2t64')
  ) {
    throw new Error(
      'Ubuntu DEB control metadata does not match the StatsKey release contract.'
    )
  }
  return true
}

function assertDebContents(contents) {
  const normalized = String(contents).replaceAll('\\', '/')
  const required = [
    /(?:^|\s)\.\/opt\/StatsKey\/statskey(?:\s|$)/m,
    /(?:^|\s)\.\/opt\/StatsKey\/resources\/app\.asar(?:\s|$)/m,
    /(?:^|\s)\.\/opt\/StatsKey\/resources\/package-type(?:\s|$)/m,
    /(?:^|\s)\.\/opt\/StatsKey\/resources\/apparmor-profile(?:\s|$)/m,
    /(?:^|\s)\.\/usr\/share\/applications\/statskey\.desktop(?:\s|$)/m,
    /(?:^|\s)\.\/usr\/share\/icons\/hicolor\/[^\s]+\/apps\/statskey\.png(?:\s|$)/m,
  ]
  if (required.some((pattern) => !pattern.test(normalized))) {
    throw new Error(
      'Ubuntu DEB is missing its executable, application resources, desktop entry, icon, or AppArmor profile.'
    )
  }
  return true
}

function inspectLinuxUnpacked(appDirectory) {
  const executablePath = path.join(appDirectory, 'statskey')
  const resources = path.join(appDirectory, 'resources')
  const archivePath = path.join(resources, 'app.asar')
  const packageTypePath = path.join(resources, 'package-type')
  const appArmorProfilePath = path.join(resources, 'apparmor-profile')
  const prebuildRoot = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds'
  )
  const ambiguousNativeBuild = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'build'
  )
  for (const [candidate, label] of [
    [executablePath, 'packaged Ubuntu executable'],
    [archivePath, 'packaged Ubuntu application archive'],
    [packageTypePath, 'packaged Ubuntu package type'],
    [appArmorProfilePath, 'packaged Ubuntu AppArmor profile'],
  ]) {
    assertRegularFile(candidate, label)
  }
  if ((statSync(executablePath).mode & 0o111) === 0) {
    throw new Error('The packaged Ubuntu executable is not executable.')
  }
  assertX64Elf(executablePath, 'packaged Ubuntu executable')
  if (readFileSync(packageTypePath, 'utf8').trim() !== 'deb') {
    throw new Error('The packaged Ubuntu application is not marked as a DEB.')
  }
  if (
    readFileSync(appArmorProfilePath, 'utf8')
      .replaceAll('\r\n', '\n')
      .trimEnd() !== EXPECTED_APPARMOR_PROFILE.trimEnd()
  ) {
    throw new Error(
      'The packaged Ubuntu AppArmor profile does not match the reviewed Electron user-namespace policy.'
    )
  }
  if (
    existsSync(ambiguousNativeBuild) ||
    !existsSync(prebuildRoot) ||
    !lstatSync(prebuildRoot).isDirectory() ||
    readdirSync(prebuildRoot).join('\n') !== 'linux-x64'
  ) {
    throw new Error(
      'The Ubuntu package must contain only the linux-x64 node-pty prebuild and no host-native build fallback.'
    )
  }
  // node-pty uses spawn-helper only on macOS. Linux executes through forkpty,
  // so the required native boundary is its x64 pty.node prebuild.
  const nodePtyBinary = path.join(prebuildRoot, 'linux-x64', 'pty.node')
  assertRegularFile(nodePtyBinary, 'Ubuntu node-pty native prebuild')
  assertX64Elf(nodePtyBinary, 'Ubuntu node-pty native prebuild')
  return {
    executablePath,
    resources,
    packageType: 'deb',
    nodePtyPrebuild: 'linux-x64',
    appArmorProfile: EXPECTED_APPARMOR_PROFILE_KIND,
  }
}

function recordLinuxNativeVerification({
  recordPath,
  artifactPath,
  metadataPath,
  appDirectory,
  version,
  sourceCommit,
  desktopTestsPassed,
  publicBoundaryPassed,
  platform = process.platform,
  arch = process.arch,
  osRelease = readFileSync('/etc/os-release', 'utf8'),
  runCommand = runChecked,
  now = () => new Date(),
} = {}) {
  assertVersionAndCommit(version, sourceCommit)
  if (desktopTestsPassed !== true || publicBoundaryPassed !== true) {
    throw new Error(
      'Ubuntu verification requires passing desktop tests and the public release boundary.'
    )
  }
  const host = assertSupportedUbuntuHost({ platform, arch, osRelease })
  const packageMetadata = inspectDebPackage({
    artifactPath,
    version,
    runCommand,
  })
  const unpacked = inspectLinuxUnpacked(appDirectory)
  assertRegularFile(metadataPath, 'Ubuntu update metadata')
  const record = {
    schema: LINUX_NATIVE_VERIFICATION_SCHEMA,
    schemaVersion: 2,
    recordedAt: now().toISOString(),
    releaseVersion: version,
    sourceCommit,
    target: {
      platform: 'linux',
      architecture: 'x64',
      distribution: host.id,
      distributionVersion: host.version,
      distributionName: host.prettyName,
    },
    artifact: fileEvidence(artifactPath),
    updateMetadata: fileEvidence(metadataPath),
    package: packageMetadata,
    checks: {
      desktopTestsPassed: true,
      publicReleaseBoundaryPassed: true,
      packageType: unpacked.packageType,
      nodePtyPrebuild: unpacked.nodePtyPrebuild,
      appArmorProfile: unpacked.appArmorProfile,
      executableFormat: 'elf',
    },
  }
  writeJsonAtomic(recordPath, record)
  return record
}

function assertLinuxNativeVerification({
  recordPath,
  artifactPath,
  metadataPath,
  version,
  sourceCommit,
} = {}) {
  assertVersionAndCommit(version, sourceCommit)
  assertRegularFile(recordPath, 'Ubuntu native verification')
  let record
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch {
    throw new Error('Ubuntu native verification is not valid JSON.')
  }
  if (
    record?.schema !== LINUX_NATIVE_VERIFICATION_SCHEMA ||
    record.schemaVersion !== 2 ||
    record.releaseVersion !== version ||
    record.sourceCommit !== sourceCommit ||
    record.target?.platform !== 'linux' ||
    record.target?.architecture !== 'x64' ||
    record.target?.distribution !== 'ubuntu' ||
    record.target?.distributionVersion !== SUPPORTED_UBUNTU_VERSION ||
    !Number.isFinite(Date.parse(record.recordedAt)) ||
    record.checks?.desktopTestsPassed !== true ||
    record.checks?.publicReleaseBoundaryPassed !== true ||
    record.checks?.packageType !== 'deb' ||
    record.checks?.nodePtyPrebuild !== 'linux-x64' ||
    record.checks?.appArmorProfile !== EXPECTED_APPARMOR_PROFILE_KIND ||
    record.checks?.executableFormat !== 'elf'
  ) {
    throw new Error(
      'Ubuntu native verification does not match this release contract.'
    )
  }
  assertFileEvidence(record.artifact, artifactPath, 'Ubuntu DEB artifact')
  assertFileEvidence(
    record.updateMetadata,
    metadataPath,
    'Ubuntu update metadata'
  )
  assertDebControlFields(
    {
      Package: record.package?.name,
      Version: record.package?.version,
      Architecture: record.package?.architecture,
      Maintainer: record.package?.maintainer,
      Homepage: record.package?.homepage,
      Section: record.package?.section,
      Priority: record.package?.priority,
      Depends: record.package?.dependencies?.join(', '),
    },
    version
  )
  return record
}

function fileEvidence(filePath) {
  assertRegularFile(filePath, 'Release file')
  return {
    file: path.basename(filePath),
    bytes: statSync(filePath).size,
    sha256: sha256File(filePath),
  }
}

function assertFileEvidence(evidence, filePath, label) {
  assertRegularFile(filePath, label)
  if (
    evidence?.file !== path.basename(filePath) ||
    evidence.bytes !== statSync(filePath).size ||
    evidence.sha256 !== sha256File(filePath)
  ) {
    throw new Error(`${label} differs from Ubuntu native verification.`)
  }
}

function assertRegularFile(filePath, label) {
  if (
    typeof filePath !== 'string' ||
    !existsSync(filePath) ||
    !lstatSync(filePath).isFile()
  ) {
    throw new Error(`${label} is missing or is not a regular file.`)
  }
}

function assertX64Elf(filePath, label) {
  const header = Buffer.alloc(20)
  const file = openSync(filePath, 'r')
  try {
    if (readSync(file, header, 0, header.length, 0) !== header.length) {
      throw new Error(`${label} header is incomplete.`)
    }
  } finally {
    closeSync(file)
  }
  if (
    !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header.readUInt16LE(18) !== 0x3e
  ) {
    throw new Error(`${label} is not a little-endian x86-64 ELF binary.`)
  }
}

function assertVersionAndCommit(version, sourceCommit) {
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(
      String(version || '')
    ) ||
    !/^[a-f0-9]{40}$/.test(String(sourceCommit || ''))
  ) {
    throw new Error('Ubuntu verification requires a valid version and commit.')
  }
}

function osReleaseValue(rawValue) {
  const value = String(rawValue)
  if (!value.startsWith('"')) return value.trim()
  if (!value.endsWith('"')) {
    throw new Error('Ubuntu release metadata contains an unterminated value.')
  }
  return value
    .slice(1, -1)
    .replace(/\\(["\\$`])/g, '$1')
}

function cleanText(value, maximum) {
  if (typeof value !== 'string') return ''
  const result = value.replace(/[\r\n\t]+/g, ' ').trim()
  return result && result.length <= maximum ? result : ''
}

function runChecked(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  })
  if (result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '')
      .trim()
      .slice(0, 500)
    throw new Error(
      `${command} could not verify the Ubuntu package.${detail ? ` ${detail}` : ''}`
    )
  }
  return result.stdout
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
  renameSync(temporary, filePath)
}

module.exports = {
  EXPECTED_APPARMOR_PROFILE,
  EXPECTED_APPARMOR_PROFILE_KIND,
  EXPECTED_DEBIAN_PACKAGE,
  LINUX_NATIVE_VERIFICATION_FILE,
  LINUX_NATIVE_VERIFICATION_SCHEMA,
  SUPPORTED_UBUNTU_VERSION,
  assertDebContents,
  assertDebControlFields,
  assertLinuxNativeVerification,
  assertSupportedUbuntuHost,
  inspectDebPackage,
  inspectLinuxUnpacked,
  parseOsRelease,
  recordLinuxNativeVerification,
}
