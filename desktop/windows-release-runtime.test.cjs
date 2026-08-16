const assert = require('node:assert/strict')
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  WINDOWS_NATIVE_VERIFICATION_FILE,
  WINDOWS_DEEP_SMOKE_FILE,
  assertFinalizeNativePreconditions,
  assertUnsignedWindowsPreviewDisclosure,
  assertWindowsDeepSmoke,
  assertWindowsNativeVerification,
  recordWindowsNativeVerification,
  runNativeWindowsReleaseSmokeTests,
  nativeCommandInvocation,
  selectReleaseTargets,
} = require('./windows-release-runtime.cjs')

const VERSION = '0.19.1'
const SOURCE_COMMIT = 'a'.repeat(40)
const THUMBPRINT = 'B'.repeat(40)
const NATIVE_TESTS = [
  { name: 'desktop test suite', status: 'passed' },
  { name: 'packaged application launch smoke test', status: 'passed' },
  { name: 'installer install/uninstall smoke test', status: 'passed' },
]

test('Windows release commands invoke npm through Node without a shell', () => {
  const npm = nativeCommandInvocation('npm', ['run', 'test'], {
    platform: 'win32',
    execPath: 'C:\\node\\node.exe',
    exists: () => true,
  })
  assert.equal(npm.executable, 'C:\\node\\node.exe')
  assert.deepEqual(npm.args, [
    path.win32.join('C:\\node', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'run',
    'test',
  ])
  assert.deepEqual(
    nativeCommandInvocation('node', ['--version'], { platform: 'win32' }),
    { executable: 'node', args: ['--version'] }
  )
  assert.deepEqual(
    nativeCommandInvocation('npm', ['test'], { platform: 'darwin' }),
    { executable: 'npm', args: ['test'] }
  )
  assert.throws(
    () => nativeCommandInvocation('npx', [], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      exists: () => false,
    }),
    /native Windows npx CLI is unavailable/
  )
})

test('native Authenticode verification uses the same PowerShell runtime as deep proof', () => {
  const source = readFileSync(
    require.resolve('./windows-release-runtime.cjs'),
    'utf8'
  )
  const authenticodeBody = source.slice(
    source.indexOf('function readNativeAuthenticode'),
    source.indexOf('function normalizeSignature')
  )
  assert.match(authenticodeBody, /spawnSync\(\s*'pwsh\.exe'/)
  assert.doesNotMatch(authenticodeBody, /spawnSync\(\s*'powershell\.exe'/)
})

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-windows-release-'))
  const installerPath = path.join(directory, `StatsKey-${VERSION}-win-x64.exe`)
  const executablePath = path.join(directory, 'StatsKey.exe')
  const recordPath = path.join(directory, WINDOWS_NATIVE_VERIFICATION_FILE)
  writeFileSync(installerPath, Buffer.from('MZ signed installer fixture'))
  writeFileSync(executablePath, Buffer.from('MZ signed application fixture'))
  return { directory, installerPath, executablePath, recordPath }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function deepFixture({ unsignedPreview = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-windows-deep-'))
  const target = path.join(directory, 'win-x64')
  require('node:fs').mkdirSync(path.join(directory, 'proof'), { recursive: true })
  require('node:fs').mkdirSync(target, { recursive: true })
  const installerPath = path.join(target, `StatsKey-${VERSION}-win-x64.exe`)
  const metadataPath = path.join(target, 'latest.yml')
  const proofPath = path.join(directory, WINDOWS_DEEP_SMOKE_FILE)
  const screenshotPath = path.join(directory, 'proof', 'controlled-browser.png')
  const installer = Buffer.from('MZ deep smoke installer')
  const installerSha512 = createHash('sha512').update(installer).digest('base64')
  writeFileSync(installerPath, installer)
  writeFileSync(
    metadataPath,
    `version: ${VERSION}\nfiles:\n  - url: ${path.basename(installerPath)}\n    sha512: ${installerSha512}\n    size: ${installer.length}\n`
  )
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(192, 1),
  ])
  writeFileSync(screenshotPath, png)
  const marker = 'WINDOWS_NATIVE_PERSISTENCE\n'
  const signature = unsignedPreview
    ? { status: 'NotSigned', statusMessage: 'Not signed', subject: '', thumbprint: '' }
    : validSignature()
  const proof = {
    schema: 'statskey.windows-deep-smoke.v1',
    schemaVersion: 1,
    sourceCommit: SOURCE_COMMIT,
    releaseVersion: VERSION,
    capturedAt: '2026-08-13T12:00:00.000Z',
    github: { runId: '123', runAttempt: '1', sha: SOURCE_COMMIT },
    installer: {
      file: path.basename(installerPath),
      path: installerPath,
      bytes: installer.length,
      sha256: sha256(installer),
      authenticode: signature,
    },
    updateMetadata: {
      file: 'latest.yml',
      sha256: sha256(readFileSync(metadataPath)),
    },
    installation: {
      executable: 'C:\\StatsKey\\StatsKey.exe',
      productVersion: VERSION,
      fileVersion: `${VERSION}.0`,
    },
    process: {
      firstPid: 101,
      aliveAfterFirstPhase: true,
      secondPid: 102,
      aliveAfterRestart: true,
    },
    cdp: {
      platform: 'win32',
      electronVersion: '43.2.0',
      location: 'http://127.0.0.1:9335/app',
    },
    workspace: {
      mutation: { ok: true },
      readBackBeforeRestart: marker,
      readBackAfterRestart: marker,
      searchMatchesBeforeRestart: 1,
      searchMatchesAfterRestart: 1,
      diskContent: marker,
      diskSha256: sha256(Buffer.from(marker)),
      persistedAcrossRestart: true,
    },
    terminal: {
      success: {
        status: 'exited', exitCode: 0, failClosed: true,
        output: 'WINDOWS_TERMINAL_SUCCESS',
      },
      failClosed: {
        status: 'failed', exitCode: 17, failClosed: true, output: 'failed',
      },
    },
    browser: {
      snapshot: {
        url: 'https://statskey.ai/downloads/statskey/',
        textIncludesStatsKey: true,
        elementCount: 3,
        revision: 'a9de9a2b-00d1-44cf-998a-b624cc5be903',
      },
      screenshot: {
        path: screenshotPath,
        bytes: png.length,
        width: 800,
        height: 600,
        sha256: sha256(png),
      },
    },
    updater: {
      state: { currentVersion: VERSION },
      stateAfterRestart: { currentVersion: VERSION },
      feed: 'https://storage.googleapis.com/statskey-workbench-downloads/updates/win-x64',
    },
    discovery: {
      applications: { count: 1, names: ['Notepad'] },
      devices: { ok: true, count: 0, tools: { adb: null } },
    },
    crashChecks: { applicationEvents: [], werReports: [], clean: true },
    result: {
      passed: true,
      authenticodeRequired: !unsignedPreview,
      nativeWindowsExecution: true,
      nsisInstalled: true,
      appLaunchedTwice: true,
    },
  }
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`)
  return { directory, installerPath, metadataPath, proofPath, proof }
}

function validSignature() {
  return {
    status: 'Valid',
    statusMessage: 'Signature verified.',
    subject: 'CN=StatsKey Test Signing',
    thumbprint: THUMBPRINT,
  }
}

test('selects Windows without including either Mac update channel', () => {
  const allTargets = [
    { channel: 'mac-arm64' },
    { channel: 'mac-x64' },
    { channel: 'win-x64' },
  ]
  assert.deepEqual(
    selectReleaseTargets(allTargets, { windowsOnly: true }).map(
      (target) => target.channel
    ),
    ['win-x64']
  )
  assert.deepEqual(
    selectReleaseTargets(allTargets, { macOnly: true }).map(
      (target) => target.channel
    ),
    ['mac-arm64', 'mac-x64']
  )
  assert.deepEqual(
    selectReleaseTargets(allTargets).map((target) => target.channel),
    ['mac-arm64', 'mac-x64', 'win-x64']
  )
})

test('rejects conflicting platform-only selections', () => {
  assert.throws(
    () =>
      selectReleaseTargets([{ channel: 'win-x64' }], {
        macOnly: true,
        windowsOnly: true,
      }),
    /mutually exclusive/
  )
})

test('requires version-pinned public disclosure for an unsigned Windows preview', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-windows-disclosure-'))
  const historyPath = path.join(directory, 'updates.json')
  const pagePath = path.join(directory, 'index.html')
  try {
    writeFileSync(
      historyPath,
      JSON.stringify({
        releases: [
          {
            version: VERSION,
            platforms: ['Windows'],
            windowsSigning: 'unsigned-preview',
          },
        ],
      })
    )
    writeFileSync(
      pagePath,
      '<p>The Windows preview is unsigned and may show a SmartScreen warning.</p>'
    )
    assert.equal(
      assertUnsignedWindowsPreviewDisclosure({
        historyPath,
        pagePath,
        version: VERSION,
      }),
      true
    )
    writeFileSync(pagePath, '<p>Download for Windows.</p>')
    assert.throws(
      () =>
        assertUnsignedWindowsPreviewDisclosure({
          historyPath,
          pagePath,
          version: VERSION,
        }),
      /visibly disclosed/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('records and verifies hash-pinned native Windows Authenticode evidence', () => {
  const files = fixture()
  try {
    const record = recordWindowsNativeVerification({
      ...files,
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
      platform: 'win32',
      now: () => new Date('2026-08-13T12:00:00.000Z'),
      authenticodeReader: validSignature,
      nativeTests: NATIVE_TESTS,
    })
    assert.equal(record.nativePlatform, 'win32')
    assert.equal(record.authenticode.installer.status, 'Valid')
    assert.equal(record.authenticode.application.thumbprint, THUMBPRINT)
    assert.deepEqual(record.nativeTests, NATIVE_TESTS)
    assert.deepEqual(
      assertWindowsNativeVerification({
        ...files,
        version: VERSION,
        sourceCommit: SOURCE_COMMIT,
      }),
      JSON.parse(readFileSync(files.recordPath, 'utf8'))
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('refuses to create Authenticode evidence away from native Windows', () => {
  const files = fixture()
  try {
    assert.throws(
      () =>
        recordWindowsNativeVerification({
          ...files,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
          platform: 'darwin',
          authenticodeReader: validSignature,
          nativeTests: NATIVE_TESTS,
        }),
      /native Windows/
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('rejects unsigned, mismatched, and stale Windows verification records', () => {
  const files = fixture()
  try {
    assert.throws(
      () =>
        recordWindowsNativeVerification({
          ...files,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
          platform: 'win32',
          authenticodeReader: () => ({
            status: 'NotSigned',
            subject: '',
            thumbprint: '',
          }),
          nativeTests: NATIVE_TESTS,
        }),
      /did not pass/
    )

    recordWindowsNativeVerification({
      ...files,
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
      platform: 'win32',
      authenticodeReader: validSignature,
      nativeTests: NATIVE_TESTS,
    })
    writeFileSync(files.installerPath, Buffer.from('MZ changed after verification'))
    assert.throws(
      () =>
        assertWindowsNativeVerification({
          ...files,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
        }),
      /differs from its native Windows verification record/
    )
    assert.throws(
      () =>
        assertWindowsNativeVerification({
          ...files,
          version: VERSION,
          sourceCommit: 'c'.repeat(40),
        }),
      /does not pin this release source/
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('requires nonempty native test evidence even when Authenticode is valid', () => {
  const files = fixture()
  try {
    assert.throws(
      () =>
        recordWindowsNativeVerification({
          ...files,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
          platform: 'win32',
          authenticodeReader: validSignature,
        }),
      /native Windows test evidence/
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('unsigned preview still requires native tests and hash-pinned NotSigned proof', () => {
  const files = fixture()
  try {
    const notSigned = () => ({
      status: 'NotSigned',
      statusMessage: 'The file is not digitally signed.',
      subject: '',
      thumbprint: '',
    })
    const record = recordWindowsNativeVerification({
      ...files,
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
      platform: 'win32',
      authenticodeReader: notSigned,
      nativeTests: NATIVE_TESTS,
      unsignedPreview: true,
    })
    assert.equal(record.signingMode, 'unsigned-preview')
    assert.equal(record.authenticode.installer.status, 'NotSigned')
    assert.equal(
      assertWindowsNativeVerification({
        ...files,
        version: VERSION,
        sourceCommit: SOURCE_COMMIT,
        unsignedPreview: true,
      }).files.installer.sha256,
      record.files.installer.sha256
    )
    assert.throws(
      () =>
        assertWindowsNativeVerification({
          ...files,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
        }),
      /does not pin this release source and target/
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('native smoke evidence is returned only after both PowerShell checks pass', () => {
  const calls = []
  assert.deepEqual(
    runNativeWindowsReleaseSmokeTests({
      installerPath: 'C:\\release\\StatsKey.exe',
      executablePath: 'C:\\release\\win-unpacked\\StatsKey.exe',
      platform: 'win32',
      desktopTestsPassed: true,
      powershellRunner(command, environment) {
        calls.push({ command, environment })
      },
    }),
    NATIVE_TESTS
  )
  assert.equal(calls.length, 2)
  assert.match(calls[0].command, /launch smoke test/)
  assert.match(calls[1].command, /Uninstaller/)
  assert.throws(
    () =>
      runNativeWindowsReleaseSmokeTests({
        installerPath: 'C:\\release\\StatsKey.exe',
        executablePath: 'C:\\release\\win-unpacked\\StatsKey.exe',
        platform: 'win32',
        powershellRunner() {},
      }),
    /desktop test suite/
  )
  assert.throws(
    () =>
      runNativeWindowsReleaseSmokeTests({
        installerPath: 'C:\\release\\StatsKey.exe',
        executablePath: 'C:\\release\\win-unpacked\\StatsKey.exe',
        platform: 'darwin',
        desktopTestsPassed: true,
        powershellRunner() {},
      }),
    /native Windows/
  )
})

test('accepts canonical native deep-smoke proof bound to installer and latest.yml', () => {
  const files = deepFixture()
  try {
    const result = assertWindowsDeepSmoke({
      proofPath: files.proofPath,
      installerPath: files.installerPath,
      metadataPath: files.metadataPath,
      releaseRoot: files.directory,
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
    })
    assert.equal(result.summary.schema, 'statskey.windows-deep-smoke.v1')
    assert.equal(result.summary.launchesSucceeded, 2)
    assert.equal(result.summary.signatureStatus, 'Valid')
    assert.equal(
      result.summary.browserScreenshotSha256,
      files.proof.browser.screenshot.sha256
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('accepts NotSigned deep proof only for an explicit preview', () => {
  const files = deepFixture({ unsignedPreview: true })
  try {
    assert.equal(
      assertWindowsDeepSmoke({
        proofPath: files.proofPath,
        installerPath: files.installerPath,
        metadataPath: files.metadataPath,
        releaseRoot: files.directory,
        version: VERSION,
        sourceCommit: SOURCE_COMMIT,
        unsignedPreview: true,
      }).summary.signatureStatus,
      'NotSigned'
    )
    assert.throws(
      () =>
        assertWindowsDeepSmoke({
          proofPath: files.proofPath,
          installerPath: files.installerPath,
          metadataPath: files.metadataPath,
          releaseRoot: files.directory,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
        }),
      /passing final result|Authenticode/
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('deep-smoke validation fails closed for stale bytes or incomplete execution evidence', () => {
  for (const mutate of [
    (proof) => { proof.workspace.persistedAcrossRestart = false },
    (proof) => { proof.process.secondPid = proof.process.firstPid },
    (proof) => { proof.terminal.failClosed.output = 'WINDOWS_TRAILING_COMMAND_RAN' },
    (proof) => { proof.crashChecks.applicationEvents.push({ id: 1000 }) },
    (proof) => { proof.discovery.devices.tools = null },
    (proof) => { proof.browser.snapshot.revision = 4 },
  ]) {
    const files = deepFixture()
    try {
      mutate(files.proof)
      writeFileSync(files.proofPath, JSON.stringify(files.proof))
      assert.throws(() =>
        assertWindowsDeepSmoke({
          proofPath: files.proofPath,
          installerPath: files.installerPath,
          metadataPath: files.metadataPath,
          releaseRoot: files.directory,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
        })
      )
    } finally {
      rmSync(files.directory, { recursive: true, force: true })
    }
  }
  const files = deepFixture()
  try {
    writeFileSync(files.installerPath, Buffer.from('MZ changed'))
    assert.throws(
      () =>
        assertWindowsDeepSmoke({
          proofPath: files.proofPath,
          installerPath: files.installerPath,
          metadataPath: files.metadataPath,
          releaseRoot: files.directory,
          version: VERSION,
          sourceCommit: SOURCE_COMMIT,
        }),
      /differs/
    )
  } finally {
    rmSync(files.directory, { recursive: true, force: true })
  }
})

test('native finalization accepts deep-smoked output before basic proof and manifest exist', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-finalize-native-'))
  const target = path.join(directory, 'win-x64')
  const resources = path.join(target, 'win-unpacked', 'resources')
  const artifact = `StatsKey-${VERSION}-win-x64.exe`
  try {
    mkdirSync(resources, { recursive: true })
    for (const file of [
      path.join(target, artifact),
      path.join(target, `${artifact}.blockmap`),
      path.join(target, 'latest.yml'),
      path.join(directory, WINDOWS_DEEP_SMOKE_FILE),
      path.join(target, 'win-unpacked', 'StatsKey.exe'),
      path.join(resources, 'app.asar'),
      path.join(resources, 'app-update.yml'),
    ]) {
      writeFileSync(file, 'prepared native evidence')
    }
    assert.equal(
      assertFinalizeNativePreconditions({
        outputRoot: directory,
        targetOutput: target,
        artifact,
      }),
      true
    )
    assert.equal(
      require('node:fs').existsSync(
        path.join(target, WINDOWS_NATIVE_VERIFICATION_FILE)
      ),
      false,
      'basic proof is intentionally recorded only after finalization reruns real smoke checks'
    )
    writeFileSync(path.join(directory, 'release-manifest.json'), '{}')
    assert.throws(
      () =>
        assertFinalizeNativePreconditions({
          outputRoot: directory,
          targetOutput: target,
          artifact,
        }),
      /without a release manifest/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('native smoke test failure cannot fabricate passing evidence', () => {
  let calls = 0
  assert.throws(
    () =>
      runNativeWindowsReleaseSmokeTests({
        installerPath: 'C:\\release\\StatsKey.exe',
        executablePath: 'C:\\release\\win-unpacked\\StatsKey.exe',
        platform: 'win32',
        desktopTestsPassed: true,
        powershellRunner() {
          calls += 1
          if (calls === 2) throw new Error('installer launch failed')
        },
      }),
    /installer launch failed/
  )
  assert.equal(calls, 2)
})

test('published signature evidence strips native runner paths', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-signature-privacy-'))
  const installerPath = path.join(directory, 'StatsKey.exe')
  const executablePath = path.join(directory, 'StatsKey-app.exe')
  const recordPath = path.join(directory, WINDOWS_NATIVE_VERIFICATION_FILE)
  try {
    writeFileSync(installerPath, 'installer')
    writeFileSync(executablePath, 'application')
    const record = recordWindowsNativeVerification({
      recordPath,
      installerPath,
      executablePath,
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
      platform: 'win32',
      unsignedPreview: true,
      nativeTests: [{ name: 'native smoke', status: 'passed' }],
      authenticodeReader: () => ({
        status: 'NotSigned',
        statusMessage: `The file ${directory} is not digitally signed.`,
        subject: '',
        thumbprint: '',
      }),
    })
    assert.equal(record.authenticode.installer.statusMessage, 'Not signed.')
    assert.doesNotMatch(
      readFileSync(recordPath, 'utf8'),
      new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
