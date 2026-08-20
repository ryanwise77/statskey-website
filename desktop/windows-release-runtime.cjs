const { spawnSync } = require('node:child_process')
const { createHash, createHmac } = require('node:crypto')
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
  { macOnly = false, windowsOnly = false, linuxOnly = false } = {}
) {
  if ([macOnly, windowsOnly, linuxOnly].filter(Boolean).length > 1) {
    throw new Error(
      '--mac-only, --windows-only, and --linux-only are mutually exclusive.'
    )
  }
  const targets = windowsOnly
    ? allTargets.filter((target) => target.channel === 'win-x64')
    : macOnly
      ? allTargets.filter((target) => target.channel.startsWith('mac-'))
      : linuxOnly
        ? allTargets.filter((target) => target.channel === 'linux-x64')
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
    path.join(
      targetOutput,
      'win-unpacked',
      'resources',
      'app.asar.unpacked',
      'windows-process-owner.ps1'
    ),
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
  processOwnerPath,
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
  const processOwner = fileEvidence(processOwnerPath)
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
    files: { installer, application, processOwner },
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
  processOwnerPath,
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
  assertFileEvidence(
    record.files?.processOwner,
    processOwnerPath,
    'packaged Windows process owner'
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
  processOwnerPath,
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
  fileEvidence(processOwnerPath)
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), 'statskey-windows-release-smoke-')
  )
  try {
    const unpackedLaunch = [
      "$ErrorActionPreference = 'Stop';",
      'Set-StrictMode -Version Latest;',
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
    const installedProcessOwner = path.join(
      installRoot,
      'resources',
      'app.asar.unpacked',
      'windows-process-owner.ps1'
    )
    const uninstallExecutable = path.join(installRoot, 'Uninstall StatsKey.exe')
    const installerSmoke = [
      "$ErrorActionPreference = 'Stop';",
      'Set-StrictMode -Version Latest;',
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
    ].join(' ')
    powershellRunner(installerSmoke, {
      STATSKEY_INSTALLER: installerPath,
      STATSKEY_INSTALL_ROOT: installRoot,
      STATSKEY_INSTALLED_EXE: installedExecutable,
      STATSKEY_INSTALLED_PROFILE: path.join(temporaryRoot, 'installed-profile'),
      STATSKEY_UNINSTALLER: uninstallExecutable,
    })
    const childScriptPath = path.join(
      temporaryRoot,
      'process-owner-child.ps1'
    )
    const parentExitProcessIdsPath = path.join(
      temporaryRoot,
      'process-owner-parent-exit-pids.json'
    )
    const leaseExpiryProcessIdsPath = path.join(
      temporaryRoot,
      'process-owner-lease-expiry-pids.json'
    )
    const parentExitPayloadPath = path.join(
      temporaryRoot,
      'process-owner-parent-exit-payload.txt'
    )
    const leaseExpiryPayloadPath = path.join(
      temporaryRoot,
      'process-owner-lease-expiry-payload.txt'
    )
    const authorityFencePath = path.join(
      temporaryRoot,
      'process-owner.authority'
    )
    const ownerLockPath = path.join(temporaryRoot, 'process-owner.lock')
    const authorityToken = 'native-release-smoke-authority-token'
    const authorityKey = Buffer.alloc(32, 0x5a).toString('base64url')
    const authorityDeadlineUnixMilliseconds = Date.now() + 10 * 60_000
    const authorityFields = [
      'statskey-fleet-authority-v1',
      'lease_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      authorityToken,
      String(Date.now() + 5 * 60_000),
      String(authorityDeadlineUnixMilliseconds),
    ]
    writeFileSync(
      authorityFencePath,
      [
        ...authorityFields,
        createHmac('sha256', Buffer.from(authorityKey, 'base64url'))
          .update(authorityFields.join('\n'))
          .digest('base64url'),
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 }
    )
    writeFileSync(
      childScriptPath,
      [
        'param([Parameter(Mandatory = $true)][string]$PidPath)',
        "$descendant = Start-Process -FilePath $env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 120') -PassThru",
        '[pscustomobject]@{ rootPid = $PID; descendantPid = $descendant.Id } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding UTF8',
        'Start-Sleep -Seconds 120',
      ].join('\r\n'),
      { encoding: 'utf8', mode: 0o600 }
    )
    const processOwnerSmoke = [
      "$ErrorActionPreference = 'Stop';",
      'Set-StrictMode -Version Latest;',
      '$parent = $null; $owner = $null; $contender = $null; $owned = $null; [int]$rootPid = 0; [int]$descendantPid = 0;',
      'try {',
      "  if (-not (Test-Path -LiteralPath $env:STATSKEY_PROCESS_OWNER)) { throw 'Installed process owner is missing.' };",
      '  $installedOwnerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $env:STATSKEY_PROCESS_OWNER -ErrorAction Stop).Hash;',
      '  $sourceOwnerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $env:STATSKEY_SOURCE_PROCESS_OWNER -ErrorAction Stop).Hash;',
      "  if (($installedOwnerHash -notmatch '^[A-Fa-f0-9]{64}$') -or ($sourceOwnerHash -notmatch '^[A-Fa-f0-9]{64}$') -or ($installedOwnerHash -ne $sourceOwnerHash)) { throw 'Installed process owner differs from tested output.' };",
      "  $parent = Start-Process -FilePath $env:STATSKEY_POWERSHELL -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 120') -PassThru;",
      '  $request = [ordered]@{',
      '    executable = $env:STATSKEY_POWERSHELL;',
      "    arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$env:STATSKEY_CHILD_SCRIPT,'-PidPath',$env:STATSKEY_PARENT_EXIT_PID_PATH);",
      '    parentProcessId = $parent.Id;',
      '    parentStartedUnixMilliseconds = ([DateTimeOffset]($parent.StartTime.ToUniversalTime())).ToUnixTimeMilliseconds();',
      '    deadlineUnixMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 60000;',
      '    authorityFencePath = $env:STATSKEY_AUTHORITY_FENCE;',
      '    ownerLockPath = $env:STATSKEY_OWNER_LOCK;',
      "    authorityLeaseId = 'lease_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';",
      '    authorityToken = $env:STATSKEY_AUTHORITY_TOKEN;',
      '    authorityKey = $env:STATSKEY_AUTHORITY_KEY;',
      '    maximumAuthorityDeadlineUnixMilliseconds = [long]$env:STATSKEY_AUTHORITY_DEADLINE',
      '  };',
      '  $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Compress)));',
      "  $payload = $base64.TrimEnd('=').Replace('+','-').Replace('/','_');",
      '  $ownerArguments = @(',
      "    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',",
      "    ('\"' + $env:STATSKEY_PROCESS_OWNER + '\"')",
      '  );',
      '  Set-Content -LiteralPath $env:STATSKEY_PARENT_EXIT_PAYLOAD_PATH -Value $payload -Encoding Ascii -NoNewline;',
      '  $owner = Start-Process -FilePath $env:STATSKEY_POWERSHELL -ArgumentList $ownerArguments -RedirectStandardInput $env:STATSKEY_PARENT_EXIT_PAYLOAD_PATH -PassThru;',
      '  $deadline = [DateTime]::UtcNow.AddSeconds(15);',
      '  while ((-not (Test-Path -LiteralPath $env:STATSKEY_PARENT_EXIT_PID_PATH)) -and ([DateTime]::UtcNow -lt $deadline)) { Start-Sleep -Milliseconds 50 };',
      "  if (-not (Test-Path -LiteralPath $env:STATSKEY_PARENT_EXIT_PID_PATH)) { throw 'Owned process did not start.' };",
      '  $owned = Get-Content -LiteralPath $env:STATSKEY_PARENT_EXIT_PID_PATH -Raw | ConvertFrom-Json;',
      '  $rootPid = 0; $descendantPid = 0;',
      "  if ((-not [int]::TryParse([string]$owned.rootPid,[ref]$rootPid)) -or (-not [int]::TryParse([string]$owned.descendantPid,[ref]$descendantPid)) -or ($rootPid -lt 1) -or ($descendantPid -lt 1) -or ($rootPid -eq $descendantPid)) { throw 'Owned process ids are invalid.' };",
      "  if ((-not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) -or (-not (Get-Process -Id $descendantPid -ErrorAction SilentlyContinue))) { throw 'Owned processes are not live.' };",
      '  $contender = Start-Process -FilePath $env:STATSKEY_POWERSHELL -ArgumentList $ownerArguments -RedirectStandardInput $env:STATSKEY_PARENT_EXIT_PAYLOAD_PATH -PassThru;',
      "  if (-not $contender.WaitForExit(5000)) { throw 'Concurrent process owner did not fail closed.' };",
      "  if ($contender.ExitCode -eq 0) { throw 'Concurrent process owner bypassed the exclusive lock.' };",
      '  Stop-Process -Id $parent.Id -Force;',
      "  if (-not $owner.WaitForExit(15000)) { throw 'Process owner did not react to parent exit.' };",
      "  if ($owner.ExitCode -eq 0) { throw 'Process owner reported success after parent exit.' };",
      '  Start-Sleep -Milliseconds 250;',
      "  if (Get-Process -Id $rootPid -ErrorAction SilentlyContinue) { throw 'Owned root survived parent exit.' };",
      "  if (Get-Process -Id $descendantPid -ErrorAction SilentlyContinue) { throw 'Owned descendant survived parent exit.' };",
      "  $parent = Start-Process -FilePath $env:STATSKEY_POWERSHELL -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 120') -PassThru;",
      '  $request.parentProcessId = $parent.Id;',
      '  $request.parentStartedUnixMilliseconds = ([DateTimeOffset]($parent.StartTime.ToUniversalTime())).ToUnixTimeMilliseconds();',
      '  $request.arguments[-1] = $env:STATSKEY_LEASE_EXPIRY_PID_PATH;',
      '  $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Compress)));',
      "  $payload = $base64.TrimEnd('=').Replace('+','-').Replace('/','_');",
      '  Set-Content -LiteralPath $env:STATSKEY_LEASE_EXPIRY_PAYLOAD_PATH -Value $payload -Encoding Ascii -NoNewline;',
      '  $owner = Start-Process -FilePath $env:STATSKEY_POWERSHELL -ArgumentList $ownerArguments -RedirectStandardInput $env:STATSKEY_LEASE_EXPIRY_PAYLOAD_PATH -PassThru;',
      '  $deadline = [DateTime]::UtcNow.AddSeconds(15);',
      '  while ((-not (Test-Path -LiteralPath $env:STATSKEY_LEASE_EXPIRY_PID_PATH)) -and ([DateTime]::UtcNow -lt $deadline)) { Start-Sleep -Milliseconds 50 };',
      "  if (-not (Test-Path -LiteralPath $env:STATSKEY_LEASE_EXPIRY_PID_PATH)) { throw 'Lease-fenced process did not start.' };",
      '  $owned = Get-Content -LiteralPath $env:STATSKEY_LEASE_EXPIRY_PID_PATH -Raw | ConvertFrom-Json;',
      '  $rootPid = 0; $descendantPid = 0;',
      "  if ((-not [int]::TryParse([string]$owned.rootPid,[ref]$rootPid)) -or (-not [int]::TryParse([string]$owned.descendantPid,[ref]$descendantPid)) -or ($rootPid -lt 1) -or ($descendantPid -lt 1) -or ($rootPid -eq $descendantPid)) { throw 'Lease-fenced process ids are invalid.' };",
      "  if ((-not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) -or (-not (Get-Process -Id $descendantPid -ErrorAction SilentlyContinue))) { throw 'Lease-fenced processes are not live.' };",
      '  $authority = Get-Content -LiteralPath $env:STATSKEY_AUTHORITY_FENCE;',
      '  $authority[3] = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 1).ToString();',
      "  $authorityKeyBase64 = $env:STATSKEY_AUTHORITY_KEY.Replace('-','+').Replace('_','/');",
      "  switch ($authorityKeyBase64.Length % 4) { 2 { $authorityKeyBase64 += '==' } 3 { $authorityKeyBase64 += '=' } 1 { throw 'Authority key is invalid.' } };",
      '  $authorityHmac = [Security.Cryptography.HMACSHA256]::new([Convert]::FromBase64String($authorityKeyBase64));',
      '  try { $authoritySignature = $authorityHmac.ComputeHash([Text.Encoding]::UTF8.GetBytes(($authority[0..4] -join "`n"))) } finally { $authorityHmac.Dispose() };',
      "  $authority[5] = [Convert]::ToBase64String($authoritySignature).TrimEnd('=').Replace('+','-').Replace('/','_');",
      '  Set-Content -LiteralPath $env:STATSKEY_AUTHORITY_FENCE -Value $authority -Encoding UTF8;',
      "  if (-not $owner.WaitForExit(15000)) { throw 'Process owner did not react to lease expiry.' };",
      "  if ($owner.ExitCode -eq 0) { throw 'Process owner reported success after lease expiry.' };",
      '  Start-Sleep -Milliseconds 250;',
      "  if (Get-Process -Id $rootPid -ErrorAction SilentlyContinue) { throw 'Owned root survived lease expiry.' };",
      "  if (Get-Process -Id $descendantPid -ErrorAction SilentlyContinue) { throw 'Owned descendant survived lease expiry.' };",
      '} finally {',
      '  if (($null -ne $parent) -and (-not $parent.HasExited)) { Stop-Process -Id $parent.Id -Force };',
      '  if (($null -ne $owner) -and (-not $owner.HasExited)) { Stop-Process -Id $owner.Id -Force };',
      '  if (($null -ne $contender) -and (-not $contender.HasExited)) { Stop-Process -Id $contender.Id -Force };',
      '  if ($rootPid -gt 0) { Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue };',
      '  if ($descendantPid -gt 0) { Stop-Process -Id $descendantPid -Force -ErrorAction SilentlyContinue };',
      '}',
    ].join(' ')
    try {
      powershellRunner(processOwnerSmoke, {
        STATSKEY_POWERSHELL: path.join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        ),
        STATSKEY_PROCESS_OWNER: installedProcessOwner,
        STATSKEY_SOURCE_PROCESS_OWNER: processOwnerPath,
        STATSKEY_CHILD_SCRIPT: childScriptPath,
        STATSKEY_PARENT_EXIT_PID_PATH: parentExitProcessIdsPath,
        STATSKEY_LEASE_EXPIRY_PID_PATH: leaseExpiryProcessIdsPath,
        STATSKEY_PARENT_EXIT_PAYLOAD_PATH: parentExitPayloadPath,
        STATSKEY_LEASE_EXPIRY_PAYLOAD_PATH: leaseExpiryPayloadPath,
        STATSKEY_AUTHORITY_FENCE: authorityFencePath,
        STATSKEY_OWNER_LOCK: ownerLockPath,
        STATSKEY_AUTHORITY_TOKEN: authorityToken,
        STATSKEY_AUTHORITY_KEY: authorityKey,
        STATSKEY_AUTHORITY_DEADLINE: String(
          authorityDeadlineUnixMilliseconds
        ),
      })
    } finally {
      const uninstallSmoke = [
        "$ErrorActionPreference = 'Stop';",
        'Set-StrictMode -Version Latest;',
        "if (-not (Test-Path -LiteralPath $env:STATSKEY_UNINSTALLER)) { throw 'StatsKey uninstaller is missing.' };",
        "$uninstaller = Start-Process -FilePath $env:STATSKEY_UNINSTALLER -ArgumentList '/S' -PassThru -Wait;",
        "if ($uninstaller.ExitCode -ne 0) { throw ('Uninstaller exited ' + $uninstaller.ExitCode) };",
      ].join(' ')
      powershellRunner(uninstallSmoke, {
        STATSKEY_UNINSTALLER: uninstallExecutable,
      })
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  return [
    { name: 'desktop test suite', status: 'passed' },
    {
      name: 'packaged process-owner parent-exit and lease-expiry containment',
      status: 'passed',
    },
    { name: 'packaged application launch smoke test', status: 'passed' },
    { name: 'installer install/uninstall smoke test', status: 'passed' },
  ]
}

function runPowerShell(command, environment) {
  const guardedCommand = [
    "$ErrorActionPreference = 'Stop';",
    'Set-StrictMode -Version Latest;',
    command,
  ].join(' ')
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      guardedCommand,
    ],
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
