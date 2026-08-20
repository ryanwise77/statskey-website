const { execFileSync, spawnSync } = require('node:child_process')
const {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const dns = require('node:dns')
const { tmpdir } = require('node:os')
const invocationRoot = path.resolve(__dirname, '..')
const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const prepareOnly = args.has('--prepare-only')
const finalizeNative = args.has('--finalize-native')
if (!prepareOnly && !args.has('--confirm-publish')) {
  fail('Publishing changes the live update feed. Re-run with --confirm-publish.')
}
if (prepareOnly && args.has('--confirm-publish')) {
  fail('--prepare-only and --confirm-publish are mutually exclusive.')
}
if (prepareOnly && args.has('--reuse-build')) {
  fail('--prepare-only always creates a fresh native build and cannot use --reuse-build.')
}
if (finalizeNative && !prepareOnly) {
  fail('--finalize-native requires --prepare-only.')
}
if (finalizeNative && !args.has('--windows-only')) {
  fail('--finalize-native is available only with --windows-only.')
}
if (finalizeNative && process.platform !== 'win32') {
  fail('--finalize-native must run on the same native Windows release runner.')
}
if (prepareOnly && args.has('--windows-only') && !finalizeNative) {
  fail(
    'Windows preparation is build → deep harness → --finalize-native; the publisher will not write a manifest before deep proof exists.'
  )
}
const {
  assertReleaseSourceUnchanged,
  assertReusableReleaseManifest,
  resolveReleaseSourceSnapshot,
  writeOrReuseReleaseManifest,
} = require('./release-integrity-runtime.cjs')
let sourceContext
try {
  sourceContext = resolveReleaseSourceSnapshot({
    argv: rawArgs,
    env: process.env,
    invocationRoot,
  })
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
const sourceRoot = sourceContext.root
const desktopRoot = sourceContext.desktopRoot
const packageJson = JSON.parse(
  readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')
)
const {
  loadPublicRelease,
  normalizeUpdateMetadata: normalizeReleaseMetadata,
} = require(path.join(desktopRoot, 'release-notes-runtime.cjs'))
const {
  assertPublicDesktopBundle,
} = require(path.join(desktopRoot, 'public-release-boundary.cjs'))
const {
  SHA256_METADATA_KEY,
  assertExactFeedContents,
  assertExactRemoteObject,
  describeLocalObject,
  ensureImmutableRemote,
  fetchWithRetry,
} = require(path.join(desktopRoot, 'publish-recovery-runtime.cjs'))
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
} = require(path.join(desktopRoot, 'windows-release-runtime.cjs'))
const {
  LINUX_NATIVE_VERIFICATION_FILE,
  assertLinuxNativeVerification,
  inspectLinuxUnpacked,
  recordLinuxNativeVerification,
} = require(path.join(desktopRoot, 'linux-release-runtime.cjs'))

dns.setDefaultResultOrder('ipv4first')

const BUCKET = 'statskey-workbench-downloads'
const FEED_ROOT =
  `https://storage.googleapis.com/${BUCKET}/updates`
const RELEASE_ROOT =
  `https://storage.googleapis.com/${BUCKET}/releases`
const version = packageJson.version
const preview = args.has('--preview')
const reuseBuild = args.has('--reuse-build')
const macOnly = args.has('--mac-only')
const windowsOnly = args.has('--windows-only')
const linuxOnly = args.has('--linux-only')
const nativeArchOnly = args.has('--native-arch-only')
if (nativeArchOnly && !prepareOnly) {
  fail('--native-arch-only is limited to local --prepare-only builds.')
}
if (nativeArchOnly && process.platform !== 'darwin') {
  fail('--native-arch-only currently supports macOS release preparation.')
}

const allTargets = [
  {
    channel: 'mac-arm64',
    builder: ['--mac', 'zip', 'dmg', '--arm64'],
    metadata: 'latest-mac.yml',
    artifact: `StatsKey-${version}-mac-arm64.zip`,
    contentType: 'application/zip',
    downloadArtifact: `StatsKey-${version}-mac-arm64.dmg`,
    downloadContentType: 'application/x-apple-diskimage',
    sidecars: [`StatsKey-${version}-mac-arm64.zip.blockmap`],
  },
  {
    channel: 'mac-x64',
    builder: ['--mac', 'zip', 'dmg', '--x64'],
    metadata: 'latest-mac.yml',
    artifact: `StatsKey-${version}-mac-x64.zip`,
    contentType: 'application/zip',
    downloadArtifact: `StatsKey-${version}-mac-x64.dmg`,
    downloadContentType: 'application/x-apple-diskimage',
    sidecars: [`StatsKey-${version}-mac-x64.zip.blockmap`],
  },
  {
    channel: 'win-x64',
    builder: ['--win', 'nsis', '--x64'],
    metadata: 'latest.yml',
    artifact: `StatsKey-${version}-win-x64.exe`,
    contentType: 'application/vnd.microsoft.portable-executable',
    sidecars: [`StatsKey-${version}-win-x64.exe.blockmap`],
  },
  {
    channel: 'linux-x64',
    builder: ['--linux', 'deb', '--x64'],
    metadata: 'latest-linux.yml',
    artifact: `StatsKey-${version}-linux-x64.deb`,
    contentType: 'application/vnd.debian.binary-package',
    sidecars: [],
  },
]
let targets
try {
  targets = selectReleaseTargets(allTargets, {
    macOnly,
    windowsOnly,
    linuxOnly,
  })
  if (nativeArchOnly) {
    targets = targets.filter(
      (target) => target.channel === `mac-${process.arch}`
    )
    if (targets.length !== 1) {
      fail(`No native Mac release target exists for ${process.arch}.`)
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
let nativeDesktopTestsPassed = false

const keepAlive = setInterval(() => {}, 1000)
main()
  .then(() => clearInterval(keepAlive))
  .catch((error) => {
    clearInterval(keepAlive)
    fail(error instanceof Error ? error.message : String(error))
  })

async function main() {
  assertReleaseSourceUnchanged(sourceContext)
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`Invalid package version: ${version}`)
  }
  const releaseEntry = loadPublicRelease(
    path.join(
      sourceRoot,
      'public',
      'downloads',
      'statskey',
      'updates.json'
    ),
    version
  )
  if (
    preview &&
    targets.some((target) => target.channel === 'win-x64')
  ) {
    assertUnsignedWindowsPreviewDisclosure({
      historyPath: path.join(
        sourceRoot,
        'public',
        'downloads',
        'statskey',
        'updates.json'
      ),
      pagePath: path.join(
        sourceRoot,
        'public',
        'downloads',
        'statskey',
        'index.html'
      ),
      version,
    })
  }
  if (
    preview &&
    targets.some((target) => target.channel === 'linux-x64')
  ) {
    assertUnsignedLinuxPreviewDisclosure({
      historyPath: path.join(
        sourceRoot,
        'public',
        'downloads',
        'statskey',
        'updates.json'
      ),
      pagePath: path.join(
        sourceRoot,
        'public',
        'downloads',
        'statskey',
        'index.html'
      ),
      version,
    })
  }
  const outputRoot = path.join(desktopRoot, `release-update-${version}`)
  const manifestPath = path.join(outputRoot, 'release-manifest.json')
  if (existsSync(outputRoot) && !reuseBuild && !finalizeNative) {
    fail(
      `${path.basename(outputRoot)} already exists. Remove it only after ` +
        'confirming no published artifact will be overwritten, or use ' +
        '--reuse-build after a failed upload.'
    )
  }
  if (reuseBuild) {
    assertReusableReleaseManifest({
      manifestPath,
      version,
      sourceCommit: sourceContext.sourceCommit,
    })
  }

  const publishedFeeds = await inspectPublishedFeeds()
  verifySigningPrerequisites()
  const preflightToken = prepareOnly
    ? null
    : await verifyPublishingAccess(accessToken())

  if (!reuseBuild && !finalizeNative) {
    // A release snapshot starts without ignored dependency trees. Recreate
    // both installs from their committed lockfiles before compiling anything.
    run('npm', ['--prefix', '..', 'ci', '--no-audit', '--no-fund'])
    run('npm', ['ci', '--no-audit', '--no-fund'])
    run('npm', ['run', 'test:release'])
    run('npm', ['--prefix', '..', 'run', 'test:desktop:release'])
    if (
      (process.platform === 'win32' &&
        targets.some((target) => target.channel === 'win-x64')) ||
      (process.platform === 'linux' &&
        targets.some((target) => target.channel === 'linux-x64'))
    ) {
      run('npm', ['run', 'test:desktop'])
      nativeDesktopTestsPassed = true
    }
    run('npm', ['--prefix', '..', 'run', 'build:desktop'])
    mkdirSync(outputRoot, { recursive: false })
  }
  if (finalizeNative) {
    run('npm', ['run', 'test:desktop'])
    nativeDesktopTestsPassed = true
  }
  for (const target of targets) {
    target.output = path.join(outputRoot, target.channel)
    if (finalizeNative) {
      assertFinalizeNativePreconditions({
        outputRoot,
        targetOutput: target.output,
        artifact: target.artifact,
        metadata: target.metadata,
      })
    }
    if (reuseBuild && !hasCompleteTargetOutput(target)) {
      fail(
        `Cannot reuse incomplete ${target.channel} output. --reuse-build is ` +
          'only for resuming the exact release after its manifest was written.'
      )
    }
    if (!reuseBuild && !finalizeNative) {
      run('npx', [
        'electron-builder',
        ...target.builder,
        '--publish',
        'never',
        // node-pty ships audited per-platform prebuilds and afterPack retains
        // only the requested target. Rebuilding a Windows/x64 module on an
        // Apple Silicon host is unsupported and would make preview releases
        // fail despite the correct prebuild already being present.
        '--config.npmRebuild=false',
        `--config.directories.output=${target.output}`,
      ])
    }
    prepareWindowsNativeVerification(target)
    prepareDownloadArtifact(target, {
      allowRepair: !reuseBuild && !finalizeNative,
    })
    normalizeUpdateMetadata(target, releaseEntry, {
      allowWrite: !reuseBuild && !finalizeNative,
    })
    validateBuild(target)
    prepareLinuxNativeVerification(target)
  }

  assertReleaseSourceUnchanged(sourceContext)

  const manifestBase = {
    version,
    sourceCommit: sourceContext.sourceCommit,
    preview,
    title: releaseEntry.title,
    summary: releaseEntry.summary,
    notes: releaseEntry.highlights,
    notesUrl: 'https://statskey.ai/downloads/statskey/#updates',
    releaseVerification: {
      passed: true,
      rendererHealthEndpoint:
        '/.well-known/statskey-desktop-health',
      tests: [
        'npm --prefix desktop run test:release',
        'npm run test:desktop:release',
      ],
    },
    artifacts: {},
    downloads: {},
  }
  for (const target of targets) {
    const artifactPath = path.join(target.output, target.artifact)
    manifestBase.artifacts[target.channel] = {
      file: target.artifact,
      bytes: statSync(artifactPath).size,
      sha256: sha256File(artifactPath),
      url: `${RELEASE_ROOT}/${version}/${target.artifact}`,
    }
    const downloadArtifact = target.downloadArtifact || target.artifact
    const downloadPath = path.join(target.output, downloadArtifact)
    manifestBase.downloads[target.channel] = {
      file: downloadArtifact,
      bytes: statSync(downloadPath).size,
      sha256: sha256File(downloadPath),
      url: `${RELEASE_ROOT}/${version}/${downloadArtifact}`,
    }
  }
  const windowsTarget = targets.find((target) => target.channel === 'win-x64')
  if (windowsTarget) {
    const deepSmoke = publicWindowsDeepSmoke(windowsTarget, outputRoot)
    manifestBase.windowsRelease = {
      mode: preview ? 'unsigned-preview' : 'native-authenticode',
      verification: publicWindowsVerification(windowsTarget),
      deepSmoke,
    }
  }
  const linuxTarget = targets.find((target) => target.channel === 'linux-x64')
  if (linuxTarget) {
    manifestBase.linuxRelease = {
      mode: 'unsigned-preview',
      supportedDistribution: 'Ubuntu 26.04 LTS',
      verification: publicLinuxVerification(linuxTarget),
      automaticUpdates: false,
      fleetWorkerExecution: false,
    }
  }
  writeOrReuseReleaseManifest({
    manifestPath,
    manifestBase,
    reuseBuild,
  })

  assertReleaseSourceUnchanged(sourceContext)
  if (prepareOnly) {
    console.log(
      `\nPrepared StatsKey ${version} release output without uploading any objects.`
    )
    console.log(`Release manifest: ${manifestPath}`)
    return
  }
  if (!preflightToken) {
    fail('Google Cloud publishing credentials disappeared after preflight.')
  }
  // Builds and notarization can outlive an OAuth access token. Reacquire one
  // immediately before publication while retaining the early permission gate.
  const token = accessToken()
  await verifyEqualPublishedFeeds(token, publishedFeeds)
  for (const target of targets) {
    await uploadImmutable(
      token,
      path.join(target.output, target.artifact),
      `releases/${version}/${target.artifact}`,
      target.contentType,
      true
    )
    if (target.downloadArtifact && target.downloadArtifact !== target.artifact) {
      await uploadImmutable(
        token,
        path.join(target.output, target.downloadArtifact),
        `releases/${version}/${target.downloadArtifact}`,
        target.downloadContentType,
        true
      )
    }
    await uploadImmutable(
      token,
      path.join(target.output, target.artifact),
      `updates/${target.channel}/${target.artifact}`,
      target.contentType,
      true
    )
    for (const sidecar of target.sidecars || []) {
      await uploadImmutable(
        token,
        path.join(target.output, sidecar),
        `updates/${target.channel}/${sidecar}`,
        'application/octet-stream',
        false
      )
    }
    if (target.channel === 'win-x64') {
      await uploadImmutable(
        token,
        windowsVerificationPath(target),
        `releases/${version}/${WINDOWS_NATIVE_VERIFICATION_FILE}`,
        'application/json',
        false
      )
      await uploadImmutable(
        token,
        windowsDeepSmokePath(outputRoot),
        `releases/${version}/${WINDOWS_DEEP_SMOKE_FILE}`,
        'application/json',
        false
      )
    }
    if (target.channel === 'linux-x64') {
      await uploadImmutable(
        token,
        linuxVerificationPath(target),
        `releases/${version}/${LINUX_NATIVE_VERIFICATION_FILE}`,
        'application/json',
        false
      )
    }
  }
  assertReleaseSourceUnchanged(sourceContext)
  await uploadImmutable(
    token,
    manifestPath,
    `releases/${version}/release-manifest.json`,
    'application/json',
    false
  )

  // Metadata is deliberately published last. Clients cannot discover a build
  // until every referenced artifact and target-specific sidecar is available.
  for (const target of targets) {
    assertReleaseSourceUnchanged(sourceContext)
    if (publishedFeeds.get(target.channel)?.status === 'equal') {
      console.log(
        `Verified existing ${target.channel} feed; leaving it unchanged.`
      )
      continue
    }
    await uploadMutableMetadata(
      token,
      path.join(target.output, target.metadata),
      `updates/${target.channel}/${target.metadata}`
    )
  }

  for (const target of targets) {
    await verifyPublicObject(
      `updates/${target.channel}/${target.metadata}`
    )
    await verifyPublicObject(
      `updates/${target.channel}/${target.artifact}`
    )
  }

  console.log(`\nStatsKey ${version} update published successfully.`)
  console.log(
    `Release manifest: ${RELEASE_ROOT}/${version}/release-manifest.json`
  )
  if (preview) {
    console.warn(
      'Preview mode was used. The notarized Mac release is trusted; Windows ' +
        'and Ubuntu preview installers remain explicitly unsigned.'
    )
  }
}

async function inspectPublishedFeeds() {
  const publishedFeeds = new Map()
  for (const target of targets) {
    const url = `${FEED_ROOT}/${target.channel}/${target.metadata}`
    const response = await fetchWithRetry(
      () =>
        fetch(url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(30 * 1000),
        }),
      `${target.channel} feed inspection`
    )
    if (response.status === 404) {
      publishedFeeds.set(target.channel, { status: 'missing' })
      continue
    }
    if (!response.ok) {
      throw new Error(
        `Could not read ${target.channel} update metadata (${response.status}).`
      )
    }
    const contents = await response.text()
    const current = metadataVersion(contents)
    if (current && compareVersions(version, current) < 0) {
      throw new Error(
        `Version ${version} is not newer than ${current} on ${target.channel}.`
      )
    }
    if (current === version) {
      if (!reuseBuild) {
        throw new Error(
          `Version ${version} is already published on ${target.channel}. ` +
            'Use --reuse-build only to verify and resume the exact local release.'
        )
      }
      publishedFeeds.set(target.channel, {
        status: 'equal',
        contents,
      })
      continue
    }
    publishedFeeds.set(target.channel, {
      status: current ? 'older' : 'unknown',
      current,
    })
  }
  return publishedFeeds
}

function assertUnsignedLinuxPreviewDisclosure({
  historyPath,
  pagePath,
  version: releaseVersion,
}) {
  const history = JSON.parse(readFileSync(historyPath, 'utf8'))
  const release = history?.releases?.find(
    (candidate) => candidate?.version === releaseVersion
  )
  const page = readFileSync(pagePath, 'utf8')
  if (
    !release?.platforms?.includes('Linux') ||
    release.linuxSigning !== 'unsigned-preview' ||
    !page.includes(`Ubuntu ${releaseVersion} preview`) ||
    !/Ubuntu[\s\S]{0,320}unsigned|unsigned[\s\S]{0,320}Ubuntu/i.test(page)
  ) {
    fail(
      `Public metadata must explicitly disclose Ubuntu ${releaseVersion} as an unsigned preview.`
    )
  }
}

function verifySigningPrerequisites() {
  let identities = ''
  try {
    identities = execFileSync(
      'security',
      ['find-identity', '-v', '-p', 'codesigning'],
      { encoding: 'utf8' }
    )
  } catch {
    // The explicit failure below gives the useful remediation.
  }
  const developerId = identities.match(
    /"([^"\n]*Developer ID Application:[^"\n]+)"/
  )?.[1]
  const publishesMac = targets.some((target) =>
    target.channel.startsWith('mac-')
  )
  const publishesWindows = targets.some(
    (target) => target.channel === 'win-x64'
  )
  const publishesLinux = targets.some(
    (target) => target.channel === 'linux-x64'
  )
  if (publishesWindows && !reuseBuild && process.platform !== 'win32') {
    fail(
      'Windows release preparation must run on native Windows. Transfer its complete pinned output and use --windows-only --reuse-build to publish without rebuilding.'
    )
  }
  if (publishesLinux && !reuseBuild && process.platform !== 'linux') {
    fail(
      'Ubuntu release preparation must run on native Ubuntu 26.04 x64. Transfer its complete pinned output and use --linux-only --preview --reuse-build to publish without rebuilding.'
    )
  }
  if (publishesLinux && !preview) {
    fail(
      'Ubuntu publication is currently an explicitly disclosed unsigned preview. Re-run with --linux-only --preview, or implement and verify the release-signing trust path first.'
    )
  }
  if (!developerId && publishesMac) {
    fail(
      'Developer ID Application certificate is required for every public Mac ' +
        'update, including previews.'
    )
  }
  if (developerId && publishesMac) {
    // electron-builder may otherwise prefer an Apple Development identity,
    // which is unsuitable for a public download even when Developer ID is
    // available in the same keychain.
    // electron-builder expects the certificate subject name without the
    // identity-class prefix printed by `security find-identity`.
    process.env.CSC_NAME = developerId.replace(
      /^Developer ID Application:\s*/,
      ''
    )
    verifyDeveloperIdPrivateKey(developerId)
  }
  if (publishesMac) verifyNotaryCredentials()
  if (preview) {
    console.warn(
      targets.some((target) => target.channel === 'win-x64')
        ? 'Publishing an explicitly disclosed unsigned Windows preview.'
        : publishesLinux
          ? 'Publishing an explicitly disclosed unsigned Ubuntu preview.'
        : 'Publishing a Developer ID-signed preview.'
    )
    return
  }
  if (
    publishesWindows &&
    !reuseBuild &&
    !process.env.WIN_CSC_LINK &&
    !process.env.CSC_LINK
  ) {
    fail(
      'A Windows code-signing certificate is required. Configure WIN_CSC_LINK ' +
        'or CSC_LINK on the native Windows release runner.'
    )
  }
}

function verifyNotaryCredentials() {
  const credentials = notarytoolCredentials()
  const result = spawnSync(
    'xcrun',
    ['notarytool', 'history', ...credentials],
    {
      encoding: 'utf8',
      timeout: 30_000,
      killSignal: 'SIGKILL',
    }
  )
  if (result.status === 0) return
  const detail = (result.stderr || result.stdout || '').trim().slice(0, 500)
  fail(
    'Apple notarization credentials failed their preflight check. ' +
      'No release was built or published.' +
      (detail ? ` ${detail}` : '')
  )
}

function verifyDeveloperIdPrivateKey(identity) {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'statskey-signing-preflight-')
  )
  const candidate = path.join(directory, 'preflight')
  try {
    copyFileSync('/usr/bin/true', candidate)
    const result = spawnSync(
      'codesign',
      [
        '--force',
        '--options',
        'runtime',
        '--sign',
        identity,
        candidate,
      ],
      {
        encoding: 'utf8',
        timeout: 15_000,
        killSignal: 'SIGKILL',
      }
    )
    if (result.status !== 0) {
      const timedOut = result.error?.code === 'ETIMEDOUT'
      throw new Error(
        timedOut
          ? 'Developer ID signing is waiting on the locked or unresponsive login keychain. Unlock this Mac, approve private-key access if prompted, and retry.'
          : `Developer ID private-key preflight failed: ${(
              result.stderr || result.error?.message || 'codesign failed'
            ).trim()}`
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function validateBuild(target) {
  for (const file of [
    target.artifact,
    ...(target.sidecars || []),
    target.metadata,
    ...(target.downloadArtifact ? [target.downloadArtifact] : []),
  ]) {
    const candidate = path.join(target.output, file)
    if (!existsSync(candidate) || statSync(candidate).size === 0) {
      fail(`Missing update artifact: ${candidate}`)
    }
  }
  const metadata = readFileSync(
    path.join(target.output, target.metadata),
    'utf8'
  )
  if (
    metadataVersion(metadata) !== version ||
    !metadata.includes(target.artifact) ||
    !metadata.includes('# statskey-release-notes-start') ||
    !metadata.includes('releaseNotes: |-') ||
    !/\bsha512:\s*[A-Za-z0-9+/=]+/.test(metadata)
  ) {
    fail(`Invalid update metadata for ${target.channel}.`)
  }
  if (target.channel.startsWith('mac-')) {
    const appDirectory = path.join(
      target.output,
      target.channel === 'mac-arm64' ? 'mac-arm64' : 'mac',
      'StatsKey.app'
    )
    if (!existsSync(appDirectory)) {
      fail(`Missing packaged Mac application: ${appDirectory}`)
    }
    validatePublicDesktopSurface(path.join(appDirectory, 'Contents', 'Resources'))
    run('codesign', [
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      appDirectory,
    ])
    run('spctl', ['-a', '-t', 'exec', '-vv', appDirectory])
    run('xcrun', ['stapler', 'validate', appDirectory])
    validateDmg(target, appDirectory)
  } else if (target.channel === 'win-x64') {
    validateWindowsBuild(target)
  } else if (target.channel === 'linux-x64') {
    const appDirectory = path.join(target.output, 'linux-unpacked')
    const unpacked = inspectLinuxUnpacked(appDirectory)
    validatePublicDesktopSurface(unpacked.resources)
  }
}

function validatePublicDesktopSurface(resourcesDirectory) {
  try {
    assertPublicDesktopBundle({
      appArchivePath: path.join(resourcesDirectory, 'app.asar'),
      webRoot: path.join(resourcesDirectory, 'web'),
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

function prepareDownloadArtifact(target, { allowRepair }) {
  if (!target.channel.startsWith('mac-') || !target.downloadArtifact) return
  const dmgPath = path.join(target.output, target.downloadArtifact)
  if (!existsSync(dmgPath)) fail(`Missing Mac installer: ${dmgPath}`)
  const ticket = spawnSync('xcrun', ['stapler', 'validate', dmgPath], {
    stdio: 'ignore',
  })
  const signature = spawnSync('codesign', ['--verify', '--verbose=2', dmgPath], {
    stdio: 'ignore',
  })
  if (ticket.status === 0 && signature.status === 0) return
  if (!allowRepair) {
    fail(
      `Reused Mac installer is no longer signed and notarized: ${dmgPath}. ` +
        'Refusing to mutate pinned release output.'
    )
  }

  const identity = process.env.CSC_NAME.startsWith('Developer ID Application:')
    ? process.env.CSC_NAME
    : `Developer ID Application: ${process.env.CSC_NAME}`
  run('codesign', [
    '--force',
    '--sign',
    identity,
    '--timestamp',
    dmgPath,
  ])

  const credentials = notarytoolCredentials()
  run('xcrun', [
    'notarytool',
    'submit',
    dmgPath,
    ...credentials,
    '--wait',
  ])
  run('xcrun', ['stapler', 'staple', dmgPath])
}

function windowsVerificationPath(target) {
  return path.join(target.output, WINDOWS_NATIVE_VERIFICATION_FILE)
}

function windowsProcessOwnerPath(target) {
  return path.join(
    target.output,
    'win-unpacked',
    'resources',
    'app.asar.unpacked',
    'windows-process-owner.ps1'
  )
}

function windowsDeepSmokePath(outputRoot) {
  return path.join(outputRoot, WINDOWS_DEEP_SMOKE_FILE)
}

function prepareWindowsNativeVerification(target) {
  if (target.channel !== 'win-x64') return
  const installerPath = path.join(target.output, target.artifact)
  const executablePath = path.join(
    target.output,
    'win-unpacked',
    'StatsKey.exe'
  )
  const processOwnerPath = windowsProcessOwnerPath(target)
  const recordPath = windowsVerificationPath(target)
  if (finalizeNative) {
    const nativeTests = runNativeWindowsReleaseSmokeTests({
      installerPath,
      executablePath,
      processOwnerPath,
      desktopTestsPassed: nativeDesktopTestsPassed,
    })
    recordWindowsNativeVerification({
      recordPath,
      installerPath,
      executablePath,
      processOwnerPath,
      version,
      sourceCommit: sourceContext.sourceCommit,
      nativeTests,
      unsignedPreview: preview,
    })
    return
  }
  if (process.platform === 'win32' && !reuseBuild) {
    const nativeTests = runNativeWindowsReleaseSmokeTests({
      installerPath,
      executablePath,
      processOwnerPath,
      desktopTestsPassed: nativeDesktopTestsPassed,
    })
    recordWindowsNativeVerification({
      recordPath,
      installerPath,
      executablePath,
      processOwnerPath,
      version,
      sourceCommit: sourceContext.sourceCommit,
      nativeTests,
      unsignedPreview: preview,
    })
    return
  }
  assertWindowsNativeVerification({
    recordPath,
    installerPath,
    executablePath,
    processOwnerPath,
    version,
    sourceCommit: sourceContext.sourceCommit,
    unsignedPreview: preview,
  })
}

function publicWindowsDeepSmoke(target, outputRoot) {
  const proofPath = windowsDeepSmokePath(outputRoot)
  const { summary } = assertWindowsDeepSmoke({
    proofPath,
    installerPath: path.join(target.output, target.artifact),
    metadataPath: path.join(target.output, target.metadata),
    releaseRoot: outputRoot,
    version,
    sourceCommit: sourceContext.sourceCommit,
    unsignedPreview: preview,
  })
  return {
    file: WINDOWS_DEEP_SMOKE_FILE,
    bytes: statSync(proofPath).size,
    sha256: sha256File(proofPath),
    summary,
  }
}

function publicWindowsVerification(target) {
  const record = assertWindowsNativeVerification({
    recordPath: windowsVerificationPath(target),
    installerPath: path.join(target.output, target.artifact),
    executablePath: path.join(
      target.output,
      'win-unpacked',
      'StatsKey.exe'
    ),
    processOwnerPath: windowsProcessOwnerPath(target),
    version,
    sourceCommit: sourceContext.sourceCommit,
    unsignedPreview: preview,
  })
  return {
    file: WINDOWS_NATIVE_VERIFICATION_FILE,
    sha256: sha256File(windowsVerificationPath(target)),
    recordedAt: record.recordedAt,
    verifier: record.verifier,
    signatureStatus: record.authenticode.installer.status,
    ...(preview
      ? {}
      : {
          signerSubject: record.authenticode.installer.subject,
          signerThumbprint: record.authenticode.installer.thumbprint,
        }),
    nativeTests: record.nativeTests,
  }
}

function linuxVerificationPath(target) {
  return path.join(target.output, LINUX_NATIVE_VERIFICATION_FILE)
}

function prepareLinuxNativeVerification(target) {
  if (target.channel !== 'linux-x64') return
  const artifactPath = path.join(target.output, target.artifact)
  const metadataPath = path.join(target.output, target.metadata)
  const recordPath = linuxVerificationPath(target)
  if (!reuseBuild) {
    recordLinuxNativeVerification({
      recordPath,
      artifactPath,
      metadataPath,
      appDirectory: path.join(target.output, 'linux-unpacked'),
      version,
      sourceCommit: sourceContext.sourceCommit,
      desktopTestsPassed: nativeDesktopTestsPassed,
      publicBoundaryPassed: true,
    })
    return
  }
  assertLinuxNativeVerification({
    recordPath,
    artifactPath,
    metadataPath,
    version,
    sourceCommit: sourceContext.sourceCommit,
  })
}

function publicLinuxVerification(target) {
  const record = assertLinuxNativeVerification({
    recordPath: linuxVerificationPath(target),
    artifactPath: path.join(target.output, target.artifact),
    metadataPath: path.join(target.output, target.metadata),
    version,
    sourceCommit: sourceContext.sourceCommit,
  })
  return {
    file: LINUX_NATIVE_VERIFICATION_FILE,
    bytes: statSync(linuxVerificationPath(target)).size,
    sha256: sha256File(linuxVerificationPath(target)),
    recordedAt: record.recordedAt,
    distribution: record.target.distribution,
    distributionVersion: record.target.distributionVersion,
    architecture: record.target.architecture,
    package: record.package,
    checks: record.checks,
  }
}

function normalizeUpdateMetadata(target, releaseEntry, { allowWrite }) {
  const metadataPath = path.join(target.output, target.metadata)
  const metadata = readFileSync(metadataPath, 'utf8')
  const normalized = normalizeReleaseMetadata(metadata, {
    version,
    releaseEntry,
    downloadArtifact:
      target.channel.startsWith('mac-') ? target.downloadArtifact : undefined,
  })
  if (!allowWrite) {
    if (normalized !== metadata) {
      fail(
        `Reused update metadata is not already canonical for ${target.channel}. ` +
          'Refusing to mutate pinned release output.'
      )
    }
    return
  }
  writeFileSync(metadataPath, normalized)
}

async function verifyEqualPublishedFeeds(token, publishedFeeds) {
  for (const target of targets) {
    const published = publishedFeeds.get(target.channel)
    if (published?.status !== 'equal') continue

    const metadataPath = path.join(target.output, target.metadata)
    const localMetadata = readFileSync(metadataPath, 'utf8')
    assertExactFeedContents(
      published.contents,
      localMetadata,
      target.channel
    )

    await assertStoredObjectExact(
      token,
      metadataPath,
      `updates/${target.channel}/${target.metadata}`,
      'text/yaml; charset=utf-8',
      { immutable: false, attachment: false }
    )
    await assertStoredObjectExact(
      token,
      path.join(target.output, target.artifact),
      `updates/${target.channel}/${target.artifact}`,
      target.contentType,
      { immutable: true, attachment: true }
    )
    for (const sidecar of target.sidecars || []) {
      await assertStoredObjectExact(
        token,
        path.join(target.output, sidecar),
        `updates/${target.channel}/${sidecar}`,
        'application/octet-stream',
        { immutable: true, attachment: false }
      )
    }
  }
}

function hasCompleteTargetOutput(target) {
  if (!target.output) return false
  const required = [
    target.artifact,
    ...(target.sidecars || []),
    target.metadata,
    ...(target.downloadArtifact ? [target.downloadArtifact] : []),
  ]
  if (target.channel === 'win-x64') {
    required.push(WINDOWS_NATIVE_VERIFICATION_FILE)
    if (target.output) {
      required.push(
        path.relative(target.output, windowsDeepSmokePath(path.dirname(target.output)))
      )
    }
  }
  if (target.channel === 'linux-x64') {
    required.push(LINUX_NATIVE_VERIFICATION_FILE)
  }
  return required.every((file) => {
    const candidate = path.resolve(target.output, file)
    return existsSync(candidate) && statSync(candidate).size > 0
  })
}

function notarytoolCredentials() {
  if (
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER
  ) {
    return [
      '--key',
      process.env.APPLE_API_KEY,
      '--key-id',
      process.env.APPLE_API_KEY_ID,
      '--issuer',
      process.env.APPLE_API_ISSUER,
    ]
  }
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    return ['--keychain-profile', process.env.APPLE_KEYCHAIN_PROFILE]
  }
  if (
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID
  ) {
    return [
      '--apple-id',
      process.env.APPLE_ID,
      '--password',
      process.env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      process.env.APPLE_TEAM_ID,
    ]
  }
  fail('Apple notarization credentials are required for the Mac DMG.')
}

function validateDmg(target, packagedApp) {
  const dmgPath = path.join(target.output, target.downloadArtifact)
  run('hdiutil', ['verify', dmgPath])
  run('codesign', ['--verify', '--verbose=2', dmgPath])
  run('xcrun', ['stapler', 'validate', dmgPath])
  run('spctl', [
    '-a',
    '-t',
    'open',
    '--context',
    'context:primary-signature',
    '-vv',
    dmgPath,
  ])

  const mountPoint = mkdtempSync(path.join(tmpdir(), 'statskey-dmg-'))
  try {
    run('hdiutil', [
      'attach',
      dmgPath,
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mountPoint,
    ])
    const installedApp = path.join(mountPoint, 'StatsKey.app')
    const applicationsLink = path.join(mountPoint, 'Applications')
    if (!existsSync(installedApp)) {
      fail(`DMG is missing StatsKey.app: ${dmgPath}`)
    }
    if (
      !existsSync(applicationsLink) ||
      !lstatSync(applicationsLink).isSymbolicLink()
    ) {
      fail(`DMG is missing its Applications shortcut: ${dmgPath}`)
    }
    run('codesign', [
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      installedApp,
    ])
    run('spctl', ['-a', '-t', 'exec', '-vv', installedApp])
    run('xcrun', ['stapler', 'validate', installedApp])
  } finally {
    spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'inherit' })
    rmSync(mountPoint, { recursive: true, force: true })
  }

  if (!existsSync(packagedApp)) fail(`Missing packaged app: ${packagedApp}`)
}

function validateWindowsBuild(target) {
  const installerPath = path.join(target.output, target.artifact)
  const appDirectory = path.join(target.output, 'win-unpacked')
  const executable = path.join(appDirectory, 'StatsKey.exe')
  const appArchive = path.join(appDirectory, 'resources', 'app.asar')
  const updateConfig = path.join(appDirectory, 'resources', 'app-update.yml')
  for (const candidate of [executable, appArchive, updateConfig]) {
    if (!existsSync(candidate) || statSync(candidate).size === 0) {
      fail(`Incomplete Windows package: ${candidate}`)
    }
  }
  validatePublicDesktopSurface(path.join(appDirectory, 'resources'))
  assertPeExecutable(installerPath, [0x014c, 0x8664])
  assertPeExecutable(executable, [0x8664])
}

function assertPeExecutable(filePath, allowedMachines) {
  const descriptor = openSync(filePath, 'r')
  const header = Buffer.alloc(4096)
  try {
    readSync(descriptor, header, 0, header.length, 0)
  } finally {
    closeSync(descriptor)
  }
  if (header.toString('ascii', 0, 2) !== 'MZ') {
    fail(`Invalid Windows executable header: ${filePath}`)
  }
  const peOffset = header.readUInt32LE(0x3c)
  if (
    peOffset + 6 > header.length ||
    header.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0'
  ) {
    fail(`Invalid Windows PE signature: ${filePath}`)
  }
  const machine = header.readUInt16LE(peOffset + 4)
  if (!allowedMachines.includes(machine)) {
    fail(`Unexpected Windows architecture in ${filePath}: 0x${machine.toString(16)}`)
  }
}

async function uploadImmutable(
  token,
  filePath,
  objectName,
  contentType,
  attachment
) {
  await uploadFile(token, filePath, objectName, contentType, {
    immutable: true,
    attachment,
  })
}

async function uploadMutableMetadata(token, filePath, objectName) {
  await uploadFile(token, filePath, objectName, 'text/yaml; charset=utf-8', {
    immutable: false,
    attachment: false,
  })
}

async function uploadFile(
  token,
  filePath,
  objectName,
  contentType,
  { immutable, attachment }
) {
  const size = statSync(filePath).size
  const expected = describeLocalObject(filePath, contentType, {
    immutable,
    attachment,
  })
  console.log(
    `Uploading ${objectName} (${(size / (1024 * 1024)).toFixed(1)} MB)`
  )
  // Keep the object bytes and their cache/download metadata in one atomic
  // upload. The previous two-request path could leave a published artifact
  // behind with incomplete metadata if the follow-up PATCH timed out.
  if (immutable) {
    const outcome = await ensureImmutableRemote({
      objectName,
      expected,
      inspect: () => storedObject(token, objectName),
      upload: () =>
        uploadResumable(
          token,
          filePath,
          objectName,
          expected,
          immutable,
          attachment
        ),
    })
    console.log(
      outcome === 'reused'
        ? `Verified existing ${objectName}`
        : outcome === 'recovered'
          ? `Recovered completed ${objectName} after an upload collision`
          : `Published ${objectName}`
    )
    return
  }

  await uploadResumable(
    token,
    filePath,
    objectName,
    expected,
    immutable,
    attachment
  )
  await assertStoredObjectExact(
    token,
    filePath,
    objectName,
    contentType,
    { immutable, attachment }
  )
  console.log(`Published ${objectName}`)
}

async function storedObject(token, objectName) {
  const endpoint = new URL(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/` +
      encodeURIComponent(objectName)
  )
  endpoint.searchParams.set(
    'fields',
    [
      'name',
      'generation',
      'size',
      'md5Hash',
      'contentType',
      'cacheControl',
      'contentDisposition',
      'metadata',
    ].join(',')
  )
  const { response } = await fetchWithTokenRefresh(token, (currentToken) =>
    fetchWithRetry(
      () =>
        fetch(endpoint, {
          headers: { Authorization: `Bearer ${currentToken}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(30 * 1000),
        }),
      `${objectName} inspection`
    )
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(
      `Could not inspect ${objectName} (${response.status}): ` +
        (await response.text()).slice(0, 500)
    )
  }
  return response.json()
}

async function assertStoredObjectExact(
  token,
  filePath,
  objectName,
  contentType,
  options
) {
  const expected = describeLocalObject(filePath, contentType, options)
  const remote = await storedObject(token, objectName)
  assertExactRemoteObject(remote, expected, objectName)
}

async function uploadResumable(
  token,
  filePath,
  objectName,
  expected,
  immutable,
  attachment
) {
  const size = statSync(filePath).size
  const metadata = JSON.stringify({
    contentType: expected.contentType,
    cacheControl: expected.cacheControl,
    md5Hash: expected.md5Hash,
    metadata: { [SHA256_METADATA_KEY]: expected.sha256 },
    ...(attachment
      ? {
          contentDisposition:
            `attachment; filename="${path.basename(filePath)}"`,
        }
      : {}),
  })
  const endpoint = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o`
  )
  endpoint.searchParams.set('uploadType', 'resumable')
  endpoint.searchParams.set('name', objectName)
  if (immutable) endpoint.searchParams.set('ifGenerationMatch', '0')
  let currentToken = token
  const startedRequest = await fetchWithTokenRefresh(
    currentToken,
    (authorizationToken) =>
      fetchWithRetry(
        () =>
          fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${authorizationToken}`,
              'Content-Type': 'application/json',
              'Content-Length': String(Buffer.byteLength(metadata)),
              'X-Upload-Content-Type': expected.contentType,
              'X-Upload-Content-Length': String(size),
            },
            body: metadata,
            signal: AbortSignal.timeout(60 * 1000),
          }),
        `${objectName} upload session`
      )
  )
  const started = startedRequest.response
  currentToken = startedRequest.token
  if (!started.ok) {
    throw new Error(
      `${objectName} upload session failed (${started.status}): ` +
        (await started.text()).slice(0, 500)
    )
  }
  const location = started.headers.get('location')
  if (!isTrustedUploadLocation(location)) {
    throw new Error(`${objectName} returned an invalid upload location.`)
  }

  // Eight MiB is Google's recommended minimum and remains small enough to
  // make bounded progress on a slow release connection.
  const chunkSize = 8 * 1024 * 1024
  let offset = 0
  let failures = 0
  while (offset < size) {
    const end = Math.min(size - 1, offset + chunkSize - 1)
    try {
      const chunkStart = offset
      const chunkRequest = await fetchWithTokenRefresh(
        currentToken,
        (authorizationToken) =>
          fetch(location, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${authorizationToken}`,
              'Content-Type': expected.contentType,
              'Content-Length': String(end - chunkStart + 1),
              'Content-Range': `bytes ${chunkStart}-${end}/${size}`,
              ...(end === size - 1
                ? { 'X-Goog-Hash': `md5=${expected.md5Hash}` }
                : {}),
            },
            body: createReadStream(filePath, { start: chunkStart, end }),
            duplex: 'half',
            signal: AbortSignal.timeout(5 * 60 * 1000),
          })
      )
      const response = chunkRequest.response
      currentToken = chunkRequest.token
      if (response.ok) return
      if (response.status !== 308) {
        throw new Error(
          `${objectName} upload failed (${response.status}): ` +
            (await response.text()).slice(0, 500)
        )
      }
      const acknowledged = uploadedOffset(response.headers.get('range'))
      if (acknowledged < chunkStart || acknowledged > end + 1) {
        throw new Error(
          `${objectName} returned an invalid resumable upload range.`
        )
      }
      if (acknowledged === chunkStart) {
        failures += 1
        if (failures >= 5) {
          throw new Error(
            `${objectName} made no upload progress after five attempts.`
          )
        }
        console.warn(
          `Retrying ${objectName} from byte ${offset} ` +
            `(attempt ${failures + 1}/5).`
        )
        await delay(failures * 1000)
        continue
      }
      offset = acknowledged
      failures = 0
      if (
        offset < size &&
        (offset % (32 * 1024 * 1024) < chunkSize || offset === size)
      ) {
        console.log(
          `Uploaded ${objectName}: ${Math.round((offset / size) * 100)}%`
        )
      }
    } catch (error) {
      failures += 1
      if (failures >= 5) throw error
      try {
        const resumed = await queryUploadOffset(
          currentToken,
          location,
          size
        )
        currentToken = resumed.token
        if (resumed.offset < offset || resumed.offset > size) throw error
        if (resumed.offset > offset) failures = 0
        offset = resumed.offset
      } catch {
        throw error
      }
      if (offset >= size) return
      console.warn(
        `Retrying ${objectName} from byte ${offset} ` +
          `(attempt ${failures + 1}/5).`
      )
      await delay(failures * 1000)
    }
  }
}

async function queryUploadOffset(token, location, size) {
  const result = await fetchWithTokenRefresh(token, (currentToken) =>
    fetchWithRetry(
      () =>
        fetch(location, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${currentToken}`,
            'Content-Length': '0',
            'Content-Range': `bytes */${size}`,
          },
          signal: AbortSignal.timeout(60 * 1000),
        }),
      'resumable upload status check'
    )
  )
  const response = result.response
  if (response.ok) return { offset: size, token: result.token }
  if (response.status !== 308) {
    throw new Error(`Could not resume upload (${response.status}).`)
  }
  return {
    offset: uploadedOffset(response.headers.get('range')),
    token: result.token,
  }
}

async function fetchWithTokenRefresh(token, request) {
  let currentToken = token
  let response = await request(currentToken)
  if (response.status === 401) {
    currentToken = accessToken()
    response = await request(currentToken)
  }
  return { response, token: currentToken }
}

async function verifyPublicObject(objectName) {
  const response = await fetchWithRetry(
    () =>
      fetch(`https://storage.googleapis.com/${BUCKET}/${objectName}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(30 * 1000),
      }),
    `${objectName} public verification`
  )
  if (!response.ok) {
    throw new Error(
      `Published object is unavailable: ${objectName} (${response.status})`
    )
  }
}

async function verifyPublishingAccess(token) {
  const endpoint = new URL(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/iam/testPermissions`
  )
  const requiredPermissions = [
    'storage.objects.create',
    'storage.objects.delete',
    'storage.objects.get',
  ]
  for (const permission of requiredPermissions) {
    endpoint.searchParams.append('permissions', permission)
  }
  const result = await fetchWithTokenRefresh(token, (currentToken) =>
    fetchWithRetry(
      () =>
        fetch(endpoint, {
          headers: { Authorization: `Bearer ${currentToken}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        }),
      'Google Cloud release permission preflight'
    )
  )
  const response = result.response
  if (!response.ok) {
    throw new Error(
      `Could not verify Google Cloud release permissions (${response.status}).`
    )
  }
  const body = await response.json()
  const granted = new Set(
    Array.isArray(body?.permissions) ? body.permissions : []
  )
  const missing = requiredPermissions.filter(
    (permission) => !granted.has(permission)
  )
  if (missing.length > 0) {
    throw new Error(
      `Google Cloud release permissions are missing: ${missing.join(', ')}.`
    )
  }
  return result.token
}

function accessToken() {
  try {
    const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      timeout: 2 * 60 * 1000,
      killSignal: 'SIGKILL',
    }).trim()
    if (!token) throw new Error('Google Cloud returned an empty access token.')
    return token
  } catch {
    fail('Google Cloud authentication is required to publish updates.')
  }
}

function run(command, commandArgs) {
  const invocation = nativeCommandInvocation(command, commandArgs)
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: desktopRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status || 1}.`)
  }
}

function sha256File(filePath) {
  return createHash('sha256')
    .update(readFileSync(filePath))
    .digest('hex')
}

function metadataVersion(contents) {
  const match = String(contents).match(/^version:\s*['"]?([^'"\s]+)['"]?/m)
  return match ? match[1] : null
}

function compareVersions(left, right) {
  const a = left.split('-')[0].split('.').map(Number)
  const b = right.split('-')[0].split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  if (left === right) return 0
  return left.includes('-') ? -1 : 1
}

function isTrustedUploadLocation(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'storage.googleapis.com'
  } catch {
    return false
  }
}

function uploadedOffset(range) {
  const match = String(range || '').match(/^bytes=0-([0-9]+)$/)
  return match ? Number(match[1]) + 1 : 0
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
