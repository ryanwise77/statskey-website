const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const WINDOWS_NATIVE_VERIFICATION_FILE =
  'windows-native-verification.json'
const WINDOWS_DEEP_SMOKE_FILE = 'windows-deep-smoke.json'
const WINDOWS_DEEP_SMOKE_SCHEMA = 'statskey.windows-deep-smoke.v1'

function assertWindowsDeepSmoke({
  proofPath,
  installerPath,
  metadataPath,
  releaseRoot,
  version,
  sourceCommit,
  unsignedPreview = false,
}) {
  assertVersionAndCommit(version, sourceCommit)
  const proof = readRegularJsonFile(
    proofPath,
    'Native Windows deep-smoke proof'
  )
  if (
    proof?.schema !== WINDOWS_DEEP_SMOKE_SCHEMA ||
    proof.schemaVersion !== 1 ||
    proof.releaseVersion !== version ||
    proof.sourceCommit !== sourceCommit ||
    proof.github?.sha !== sourceCommit ||
    !cleanText(proof.github?.runId, 120) ||
    !cleanText(proof.github?.runAttempt, 40) ||
    typeof proof.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(proof.capturedAt))
  ) {
    throw new Error(
      'The Windows deep-smoke proof does not pin this version, source commit, and native target.'
    )
  }
  assertFileEvidence(
    proof.installer,
    installerPath,
    'Deep-smoke installer'
  )
  if (
    proof.updateMetadata?.file !== path.basename(metadataPath) ||
    proof.updateMetadata?.sha256 !== sha256File(metadataPath)
  ) {
    throw new Error('Deep-smoke update metadata differs from latest.yml.')
  }
  const metadata = readFileSync(metadataPath, 'utf8')
  const expectedSha512 = metadataSha512ForArtifact(
    metadata,
    path.basename(installerPath)
  )
  if (sha512File(installerPath) !== expectedSha512) {
    throw new Error(
      'The Windows deep-smoke proof does not match latest.yml installer SHA-512.'
    )
  }
  if (
    !versionPrefix(proof.installation?.productVersion, version) ||
    !versionPrefix(proof.installation?.fileVersion, version) ||
    !cleanText(proof.installation?.executable, 2_000)
  ) {
    throw new Error('Windows deep smoke did not verify the installed product version.')
  }
  if (
    !positiveInteger(proof.process?.firstPid) ||
    !positiveInteger(proof.process?.secondPid) ||
    proof.process.firstPid === proof.process.secondPid ||
    proof.process.aliveAfterFirstPhase !== true ||
    proof.process.aliveAfterRestart !== true
  ) {
    throw new Error('Windows deep smoke did not keep two distinct launches alive.')
  }
  if (
    proof.crashChecks?.clean !== true ||
    !Array.isArray(proof.crashChecks?.applicationEvents) ||
    proof.crashChecks.applicationEvents.length !== 0 ||
    !Array.isArray(proof.crashChecks?.werReports) ||
    proof.crashChecks.werReports.length !== 0
  ) {
    throw new Error('Windows deep-smoke crash checks are not clean for both launches.')
  }
  if (
    proof.cdp?.platform !== 'win32' ||
    !cleanText(proof.cdp?.electronVersion, 80) ||
    !/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+\//.test(
      String(proof.cdp?.location || '')
    )
  ) {
    throw new Error('Windows deep smoke did not connect to native win32 CDP.')
  }
  if (
    proof.result?.passed !== true ||
    proof.result?.authenticodeRequired !== !unsignedPreview ||
    proof.result?.nativeWindowsExecution !== true ||
    proof.result?.nsisInstalled !== true ||
    proof.result?.appLaunchedTwice !== true
  ) {
    throw new Error('Windows deep smoke did not report a passing final result.')
  }
  assertWorkspacePersistence(proof.workspace)
  assertTerminalEvidence(proof.terminal, releaseRoot)
  assertBrowserEvidence(proof.browser, releaseRoot)
  assertCapabilityEvidence(proof.updater, releaseRoot, 'updater', version)
  assertCapabilityEvidence(
    proof.applications || proof.discovery?.applications,
    releaseRoot,
    'applications'
  )
  assertCapabilityEvidence(
    proof.devices || proof.discovery?.devices,
    releaseRoot,
    'devices'
  )
  const signature = normalizeSignature(
    proof.authenticode || proof.installer?.authenticode,
    'Deep-smoke installer',
    unsignedPreview
  )
  return {
    proof,
    summary: {
      schema: WINDOWS_DEEP_SMOKE_SCHEMA,
      recordedAt: proof.capturedAt,
      platform: 'win32',
      architecture: 'x64',
      nsisInstalled: true,
      nsisUninstalledByBasicSmoke: true,
      launchesSucceeded: 2,
      crashChecksClean: true,
      workspacePersisted: true,
      terminalSuccess: true,
      terminalFailClosed: true,
      browserScreenshotSha256:
        proof.browser.screenshot.sha256,
      updaterChecked: true,
      applicationsChecked: true,
      devicesChecked: true,
      signatureStatus: signature.status,
    },
  }
}

function selectReleaseTargets(
  allTargets,
  { macOnly = false, windowsOnly = false } = {}
) {
  if (macOnly && windowsOnly) {
    throw new Error('--mac-only and --windows-only are mutually exclusive.')
  }
  const targets = windowsOnly
    ? allTargets.filter((target) => target.channel === 'win-x64')
    : macOnly
      ? allTargets.filter((target) => target.channel.startsWith('mac-'))
      : [...allTargets]
  if (targets.length === 0) {
    throw new Error('The requested release target is unavailable.')
  }
  return targets
}

function assertFinalizeNativePreconditions({
  outputRoot,
  targetOutput,
  artifact,
  metadata = 'latest.yml',
  manifest = 'release-manifest.json',
}) {
  if (
    !existsSync(outputRoot) ||
    !lstatSync(outputRoot).isDirectory() ||
    existsSync(path.join(outputRoot, manifest))
  ) {
    throw new Error(
      'Native finalization requires prepared output without a release manifest.'
    )
  }
  const required = [
    path.join(targetOutput, artifact),
    path.join(targetOutput, `${artifact}.blockmap`),
    path.join(targetOutput, metadata),
    path.join(outputRoot, WINDOWS_DEEP_SMOKE_FILE),
    path.join(targetOutput, 'win-unpacked', 'StatsKey.exe'),
    path.join(targetOutput, 'win-unpacked', 'resources', 'app.asar'),
    path.join(targetOutput, 'win-unpacked', 'resources', 'app-update.yml'),
  ]
  const missing = required.filter(
    (candidate) =>
      !existsSync(candidate) ||
      !lstatSync(candidate).isFile() ||
      lstatSync(candidate).isSymbolicLink() ||
      statSync(candidate).size < 1
  )
  if (missing.length > 0) {
    throw new Error(
      'Native finalization requires the complete built and deep-smoked Windows output.'
    )
  }
  return true
}

function assertUnsignedWindowsPreviewDisclosure({
  historyPath,
  pagePath,
  version,
}) {
  let history
  let page
  try {
    history = JSON.parse(readFileSync(historyPath, 'utf8'))
    page = readFileSync(pagePath, 'utf8')
  } catch {
    throw new Error(
      'Unsigned Windows preview publishing requires readable public release disclosure.'
    )
  }
  const release = Array.isArray(history?.releases)
    ? history.releases.find((entry) => entry?.version === version)
    : null
  const listsWindows =
    Array.isArray(release?.platforms) && release.platforms.includes('Windows')
  if (
    !release ||
    !listsWindows ||
    release.windowsSigning !== 'unsigned-preview' ||
    !/Windows[^<.]{0,240}unsigned|unsigned[^<.]{0,240}Windows/i.test(page)
  ) {
    throw new Error(
      `Unsigned Windows preview ${version} must be marked windowsSigning=unsigned-preview in public update history and visibly disclosed on the download page.`
    )
  }
  return true
}

function recordWindowsNativeVerification({
  recordPath,
  installerPath,
  executablePath,
  version,
  sourceCommit,
  platform = process.platform,
  now = () => new Date(),
  authenticodeReader = readNativeAuthenticode,
  nativeTests,
  unsignedPreview = false,
}) {
  if (platform !== 'win32') {
    throw new Error(
      'Windows Authenticode verification must be recorded on native Windows.'
    )
  }
  assertVersionAndCommit(version, sourceCommit)
  const installer = fileEvidence(installerPath)
  const application = fileEvidence(executablePath)
  const installerSignature = normalizeSignature(
    authenticodeReader(installerPath),
    'Windows installer',
    unsignedPreview
  )
  const applicationSignature = normalizeSignature(
    authenticodeReader(executablePath),
    'packaged Windows application',
    unsignedPreview
  )
  if (
    !unsignedPreview &&
    installerSignature.thumbprint !== applicationSignature.thumbprint
  ) {
    throw new Error(
      'The Windows installer and packaged application were not signed by the same certificate.'
    )
  }
  const recordedAt = now().toISOString()
  if (!Number.isFinite(Date.parse(recordedAt))) {
    throw new Error('Windows verification time is invalid.')
  }
  const record = {
    schemaVersion: 1,
    verificationKind: 'native-windows-authenticode',
    signingMode: unsignedPreview ? 'unsigned-preview' : 'authenticode',
    nativePlatform: 'win32',
    architecture: 'x64',
    version,
    sourceCommit,
    recordedAt,
    verifier: 'Get-AuthenticodeSignature',
    nativeTests: normalizeNativeTests(nativeTests),
    files: { installer, application },
    authenticode: {
      installer: installerSignature,
      application: applicationSignature,
    },
  }
  const temporaryPath = `${recordPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
  renameSync(temporaryPath, recordPath)
  return record
}

function assertWindowsNativeVerification({
  recordPath,
  installerPath,
  executablePath,
  version,
  sourceCommit,
  unsignedPreview = false,
}) {
  assertVersionAndCommit(version, sourceCommit)
  if (
    !existsSync(recordPath) ||
    !lstatSync(recordPath).isFile() ||
    lstatSync(recordPath).isSymbolicLink()
  ) {
    throw new Error(
      `Windows publishing requires ${WINDOWS_NATIVE_VERIFICATION_FILE} from a native Windows runner.`
    )
  }
  let record
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch {
    throw new Error('The native Windows verification record is invalid JSON.')
  }
  if (
    record?.schemaVersion !== 1 ||
    record.verificationKind !== 'native-windows-authenticode' ||
    record.signingMode !==
      (unsignedPreview ? 'unsigned-preview' : 'authenticode') ||
    record.nativePlatform !== 'win32' ||
    record.architecture !== 'x64' ||
    record.version !== version ||
    record.sourceCommit !== sourceCommit ||
    record.verifier !== 'Get-AuthenticodeSignature' ||
    normalizeNativeTests(record.nativeTests).length === 0 ||
    typeof record.recordedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.recordedAt))
  ) {
    throw new Error(
      'The native Windows verification record does not pin this release source and target.'
    )
  }
  assertFileEvidence(record.files?.installer, installerPath, 'Windows installer')
  assertFileEvidence(
    record.files?.application,
    executablePath,
    'packaged Windows application'
  )
  const installerSignature = normalizeSignature(
    record.authenticode?.installer,
    'Windows installer',
    unsignedPreview
  )
  const applicationSignature = normalizeSignature(
    record.authenticode?.application,
    'packaged Windows application',
    unsignedPreview
  )
  if (
    !unsignedPreview &&
    installerSignature.thumbprint !== applicationSignature.thumbprint
  ) {
    throw new Error(
      'The native Windows verification record contains different signer certificates.'
    )
  }
  return record
}

function normalizeNativeTests(candidate) {
  if (!Array.isArray(candidate)) {
    throw new Error(
      'Windows release verification requires native Windows test evidence.'
    )
  }
  const tests = candidate.map((entry) => ({
    name: cleanText(entry?.name, 160),
    status: entry?.status === 'passed' ? 'passed' : '',
  }))
  if (
    tests.length < 1 ||
    tests.length > 24 ||
    tests.some((entry) => !entry.name || entry.status !== 'passed')
  ) {
    throw new Error(
      'Windows release verification requires named, passing native Windows tests.'
    )
  }
  return tests
}

function readNativeAuthenticode(filePath) {
  if (process.platform !== 'win32') {
    throw new Error(
      'Get-AuthenticodeSignature is only available on native Windows.'
    )
  }
  const command = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:STATSKEY_AUTHENTICODE_PATH;',
    "$subject = ''; $thumbprint = '';",
    'if ($null -ne $signature.SignerCertificate) {',
    '  $subject = [string]$signature.SignerCertificate.Subject;',
    '  $thumbprint = [string]$signature.SignerCertificate.Thumbprint;',
    '}',
    '[pscustomobject]@{',
    '  status = [string]$signature.Status;',
    '  statusMessage = [string]$signature.StatusMessage;',
    '  subject = $subject;',
    '  thumbprint = $thumbprint',
    '} | ConvertTo-Json -Compress',
  ].join(' ')
  const result = spawnSync(
    'pwsh.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      encoding: 'utf8',
      env: { ...process.env, STATSKEY_AUTHENTICODE_PATH: filePath },
      timeout: 30_000,
      windowsHide: true,
    }
  )
  if (result.status !== 0) {
    throw new Error(
      `Native Authenticode verification failed: ${String(
        result.stderr || result.error?.message || 'PowerShell failed'
      ).trim().slice(0, 500)}`
    )
  }
  try {
    return JSON.parse(String(result.stdout || '').trim())
  } catch {
    throw new Error('Native Authenticode verification returned invalid output.')
  }
}

function normalizeSignature(candidate, label, unsignedPreview) {
  const status = typeof candidate?.status === 'string' ? candidate.status : ''
  const subject = cleanText(candidate?.subject, 500)
  const thumbprint =
    typeof candidate?.thumbprint === 'string'
      ? candidate.thumbprint.replace(/\s+/g, '').toUpperCase()
      : ''
  if (unsignedPreview) {
    if (status !== 'NotSigned' || subject || thumbprint) {
      throw new Error(
        `${label} is not an unsigned Windows preview as declared.`
      )
    }
    return {
      status: 'NotSigned',
      subject: '',
      thumbprint: '',
      statusMessage: 'Not signed.',
    }
  }
  if (status !== 'Valid' || !subject || !/^[A-F0-9]{40,128}$/.test(thumbprint)) {
    throw new Error(
      `${label} did not pass native Windows Authenticode verification.`
    )
  }
  return {
    status: 'Valid',
    subject,
    thumbprint,
    statusMessage: 'Signature verified.',
  }
}

function runNativeWindowsReleaseSmokeTests({
  installerPath,
  executablePath,
  platform = process.platform,
  powershellRunner = runPowerShell,
  desktopTestsPassed = false,
}) {
  if (platform !== 'win32') {
    throw new Error('Windows release smoke tests must run on native Windows.')
  }
  if (!desktopTestsPassed) {
    throw new Error(
      'Windows release smoke evidence requires the desktop test suite to pass first.'
    )
  }
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), 'statskey-windows-release-smoke-')
  )
  try {
    const unpackedLaunch = [
      "$process = Start-Process -FilePath $env:STATSKEY_EXE -ArgumentList ('--user-data-dir=' + $env:STATSKEY_USER_DATA) -PassThru;",
      'Start-Sleep -Seconds 8;',
      "if ($process.HasExited) { throw 'Packaged StatsKey exited during launch smoke test.' };",
      'Stop-Process -Id $process.Id -Force;',
    ].join(' ')
    powershellRunner(unpackedLaunch, {
      STATSKEY_EXE: executablePath,
      STATSKEY_USER_DATA: path.join(temporaryRoot, 'unpacked-profile'),
    })
    const installRoot = path.join(temporaryRoot, 'installed')
    const installedExecutable = path.join(installRoot, 'StatsKey.exe')
    const uninstallExecutable = path.join(installRoot, 'Uninstall StatsKey.exe')
    const installerSmoke = [
      '$application = $null;',
      'try {',
      "  $installer = Start-Process -FilePath $env:STATSKEY_INSTALLER -ArgumentList @('/S',('/D=' + $env:STATSKEY_INSTALL_ROOT)) -PassThru -Wait;",
      "  if ($installer.ExitCode -ne 0) { throw ('Installer exited ' + $installer.ExitCode) };",
      "  if (-not (Test-Path -LiteralPath $env:STATSKEY_INSTALLED_EXE)) { throw 'Installed StatsKey.exe is missing.' };",
      "  $application = Start-Process -FilePath $env:STATSKEY_INSTALLED_EXE -ArgumentList ('--user-data-dir=' + $env:STATSKEY_INSTALLED_PROFILE) -PassThru;",
      '  Start-Sleep -Seconds 8;',
      "  if ($application.HasExited) { throw 'Installed StatsKey exited during launch smoke test.' };",
      '} finally {',
      '  if (($null -ne $application) -and (-not $application.HasExited)) { Stop-Process -Id $application.Id -Force };',
      '}',
      "if (-not (Test-Path -LiteralPath $env:STATSKEY_UNINSTALLER)) { throw 'StatsKey uninstaller is missing.' };",
      "$uninstaller = Start-Process -FilePath $env:STATSKEY_UNINSTALLER -ArgumentList '/S' -PassThru -Wait;",
      "if ($uninstaller.ExitCode -ne 0) { throw ('Uninstaller exited ' + $uninstaller.ExitCode) };",
    ].join(' ')
    powershellRunner(installerSmoke, {
      STATSKEY_INSTALLER: installerPath,
      STATSKEY_INSTALL_ROOT: installRoot,
      STATSKEY_INSTALLED_EXE: installedExecutable,
      STATSKEY_INSTALLED_PROFILE: path.join(temporaryRoot, 'installed-profile'),
      STATSKEY_UNINSTALLER: uninstallExecutable,
    })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  return [
    { name: 'desktop test suite', status: 'passed' },
    { name: 'packaged application launch smoke test', status: 'passed' },
    { name: 'installer install/uninstall smoke test', status: 'passed' },
  ]
}

function runPowerShell(command, environment) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      encoding: 'utf8',
      env: { ...process.env, ...environment },
      timeout: 120_000,
      windowsHide: true,
    }
  )
  if (result.status !== 0) {
    throw new Error(
      `Native Windows release smoke test failed: ${String(
        result.stderr || result.stdout || result.error?.message || 'PowerShell failed'
      ).trim().slice(0, 1_000)}`
    )
  }
}

function nativeCommandInvocation(
  command,
  commandArgs,
  {
    platform = process.platform,
    execPath = process.execPath,
    exists = existsSync,
  } = {}
) {
  if (platform !== 'win32' || (command !== 'npm' && command !== 'npx')) {
    return { executable: command, args: commandArgs }
  }
  const cliPath = path.win32.join(
    path.win32.dirname(execPath),
    'node_modules',
    'npm',
    'bin',
    `${command}-cli.js`
  )
  if (!exists(cliPath)) {
    throw new Error(`The native Windows ${command} CLI is unavailable.`)
  }
  return { executable: execPath, args: [cliPath, ...commandArgs] }
}

function fileEvidence(filePath) {
  if (
    !existsSync(filePath) ||
    !lstatSync(filePath).isFile() ||
    lstatSync(filePath).isSymbolicLink()
  ) {
    throw new Error(`Windows release file is unavailable: ${filePath}`)
  }
  return {
    file: path.basename(filePath),
    bytes: statSync(filePath).size,
    sha256: sha256File(filePath),
  }
}

function assertFileEvidence(candidate, filePath, label) {
  const actual = fileEvidence(filePath)
  if (
    candidate?.file !== actual.file ||
    candidate.bytes !== actual.bytes ||
    candidate.sha256 !== actual.sha256
  ) {
    throw new Error(`${label} differs from its native Windows verification record.`)
  }
}

function readRegularJsonFile(filePath, label) {
  if (
    !existsSync(filePath) ||
    !lstatSync(filePath).isFile() ||
    lstatSync(filePath).isSymbolicLink()
  ) {
    throw new Error(`${label} is missing or is not a regular file.`)
  }
  const size = statSync(filePath).size
  if (size < 2 || size > 2 * 1024 * 1024) {
    throw new Error(`${label} has an invalid size.`)
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    throw new Error(`${label} is invalid JSON.`)
  }
}

function metadataSha512ForArtifact(metadata, artifact) {
  const escaped = artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(metadata).match(
    new RegExp(
      `(?:^|\\n)\\s*-\\s+url:\\s*${escaped}\\s*\\r?\\n\\s+sha512:\\s*([A-Za-z0-9+/=]+)`,
      'm'
    )
  )
  if (!match || !/^[A-Za-z0-9+/=]{40,}$/.test(match[1])) {
    throw new Error('latest.yml does not pin the Windows installer SHA-512.')
  }
  return match[1]
}

function assertWorkspacePersistence(workspace) {
  const diskContent =
    typeof workspace?.diskContent === 'string' ? workspace.diskContent : ''
  if (
    workspace?.persistedAcrossRestart !== true ||
    workspace?.mutation?.ok !== true ||
    !diskContent ||
    Buffer.byteLength(diskContent) > 1024 * 1024 ||
    workspace.readBackBeforeRestart !== diskContent ||
    workspace.readBackAfterRestart !== diskContent ||
    !positiveInteger(workspace.searchMatchesBeforeRestart) ||
    !positiveInteger(workspace.searchMatchesAfterRestart) ||
    workspace.diskSha256 !== sha256Buffer(Buffer.from(diskContent, 'utf8'))
  ) {
    throw new Error(
      'Windows deep smoke did not prove persisted workspace read-back after restart.'
    )
  }
}

function assertTerminalEvidence(terminal, releaseRoot) {
  if (
    terminal?.success?.exitCode !== 0 ||
    terminal.success.status !== 'exited' ||
    terminal.success.failClosed !== true ||
    !String(terminal.success.output || '').includes('WINDOWS_TERMINAL_SUCCESS')
  ) {
    throw new Error('Windows deep smoke did not prove a successful terminal command.')
  }
  if (
    terminal?.failClosed?.status !== 'failed' ||
    terminal.failClosed.failClosed !== true ||
    !Number.isInteger(terminal.failClosed.exitCode) ||
    terminal.failClosed.exitCode === 0 ||
    String(terminal.failClosed.output || '').includes(
      'WINDOWS_TRAILING_COMMAND_RAN'
    )
  ) {
    throw new Error('Windows deep smoke did not prove fail-closed terminal behavior.')
  }
}

function assertBrowserEvidence(browser, releaseRoot) {
  if (
    !/^https:\/\/statskey\.ai\//.test(String(browser?.snapshot?.url || '')) ||
    browser.snapshot.textIncludesStatsKey !== true ||
    !positiveInteger(browser.snapshot.elementCount) ||
    !/^[A-Za-z0-9._:-]{8,160}$/.test(String(browser.snapshot.revision || ''))
  ) {
    throw new Error('Windows deep smoke did not exercise the controlled browser.')
  }
  const candidate = browser.screenshot
  const relocated = {
    file: `proof/${path.basename(String(candidate?.path || ''))}`,
    bytes: candidate?.bytes,
    sha256: candidate?.sha256,
  }
  const screenshot = assertRootEvidenceFile(
    relocated,
    releaseRoot,
    'browser screenshot'
  )
  if (
    screenshot.bytes < 100 ||
    path.extname(screenshot.path).toLowerCase() !== '.png' ||
    !positiveInteger(candidate?.width) ||
    !positiveInteger(candidate?.height)
  ) {
    throw new Error('Windows deep-smoke browser screenshot is empty or not PNG.')
  }
  const header = readFileSync(screenshot.absolutePath).subarray(0, 8)
  if (!header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Windows deep-smoke browser evidence has an invalid PNG header.')
  }
}

function assertCapabilityEvidence(candidate, releaseRoot, label, version) {
  if (label === 'updater') {
    if (
      !candidate?.state ||
      !candidate?.stateAfterRestart ||
      candidate.state.currentVersion !== version ||
      candidate.stateAfterRestart.currentVersion !== version ||
      candidate.feed !==
        'https://storage.googleapis.com/statskey-workbench-downloads/updates/win-x64'
    ) {
      throw new Error('Windows deep smoke did not exercise the updater.')
    }
    return
  }
  if (label === 'applications') {
    if (
      !Number.isSafeInteger(candidate?.count) ||
      candidate.count < 0 ||
      !Array.isArray(candidate?.names) ||
      candidate.names.some((name) => !cleanText(name, 200)) ||
      candidate.names.length > candidate.count
    ) {
      throw new Error('Windows deep smoke did not exercise application discovery.')
    }
    return
  }
  if (
    candidate?.ok !== true ||
    !Number.isSafeInteger(candidate?.count) ||
    candidate.count < 0 ||
    !candidate.tools ||
    typeof candidate.tools !== 'object' ||
    Array.isArray(candidate.tools)
  ) {
    throw new Error('Windows deep smoke did not exercise device discovery.')
  }
}

function assertRootEvidenceFile(candidate, releaseRoot, label) {
  const relativePath =
    typeof candidate?.file === 'string'
      ? candidate.file.replaceAll('\\', '/')
      : ''
  const normalized = path.posix.normalize(relativePath)
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Windows deep-smoke ${label} path is invalid.`)
  }
  const absolutePath = path.resolve(releaseRoot, ...normalized.split('/'))
  const canonicalRoot = path.resolve(releaseRoot)
  if (
    absolutePath === canonicalRoot ||
    !absolutePath.startsWith(`${canonicalRoot}${path.sep}`)
  ) {
    throw new Error(`Windows deep-smoke ${label} escapes the release output.`)
  }
  const actual = fileEvidence(absolutePath)
  if (
    path.basename(normalized) !== actual.file ||
    candidate.bytes !== actual.bytes ||
    candidate.sha256 !== actual.sha256
  ) {
    throw new Error(
      `Windows deep-smoke ${label} differs from its native Windows verification record.`
    )
  }
  return {
    path: normalized,
    absolutePath,
    bytes: candidate.bytes,
    sha256: candidate.sha256,
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function versionPrefix(value, version) {
  return (
    typeof value === 'string' &&
    (value === version || value.startsWith(`${version}.`))
  )
}

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha512File(filePath) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64')
}

function assertVersionAndCommit(version, sourceCommit) {
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(
      String(version || '')
    ) ||
    !/^[0-9a-f]{40,64}$/.test(String(sourceCommit || ''))
  ) {
    throw new Error('Windows verification requires an exact version and source commit.')
  }
}

function cleanText(value, maximum) {
  return typeof value === 'string'
    ? value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : ''
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

module.exports = {
  WINDOWS_DEEP_SMOKE_FILE,
  WINDOWS_DEEP_SMOKE_SCHEMA,
  WINDOWS_NATIVE_VERIFICATION_FILE,
  assertUnsignedWindowsPreviewDisclosure,
  assertFinalizeNativePreconditions,
  assertWindowsDeepSmoke,
  assertWindowsNativeVerification,
  readNativeAuthenticode,
  recordWindowsNativeVerification,
  runNativeWindowsReleaseSmokeTests,
  nativeCommandInvocation,
  selectReleaseTargets,
}
