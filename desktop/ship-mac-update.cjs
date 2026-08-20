const { execFileSync, spawnSync } = require('node:child_process')
const {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} = require('node:fs')
const { homedir, tmpdir } = require('node:os')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const {
  assertMacArtifact,
  assertEmergencyReleaseContract,
  assertRetainedReleaseSourceIdentity,
  assertRetainedReleaseSourceReachability,
  parseShipMacArgs,
  resolveReleaseSourceContract,
  selectMacDownload,
} = require('./mac-release-runtime.cjs')
const {
  fetchWithRetry,
} = require('./publish-recovery-runtime.cjs')

const BUCKET = 'statskey-workbench-downloads'
const RELEASE_ROOT = `https://storage.googleapis.com/${BUCKET}/releases`
const DESKTOP_HEALTH_PATH = '/.well-known/statskey-desktop-health'
const args = process.argv.slice(2)
let shipOptions
try {
  shipOptions = parseShipMacArgs(args)
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
const {
  prepareOnly,
  installOnly,
  confirmed,
  reuseBuild,
  allowUnpushed,
  sourceSnapshot,
  releaseSourceRemote,
  releaseSourceRef,
  releaseSourceRepository,
} = shipOptions
const invocationRoot = path.resolve(__dirname, '..')
const explicitSnapshot = sourceSnapshot
let managedSnapshot = null

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  if (managedSnapshot) {
    console.error(
      `Release snapshot retained for inspection or recovery: ${managedSnapshot}\n`
    )
  }
  process.exitCode = 1
})

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('The Mac release workflow must run on macOS.')
  }
  if (!prepareOnly && !installOnly && !confirmed) {
    throw new Error(
      'Publishing changes the live client feed. Re-run with --confirm-publish.'
    )
  }
  if (
    installOnly &&
    (prepareOnly || confirmed || reuseBuild || allowUnpushed)
  ) {
    throw new Error(
      '--install-only cannot be combined with publishing or build flags.'
    )
  }
  if (installOnly && !explicitSnapshot) {
    throw new Error(
      '--install-only requires --source-snapshot with pinned release output.'
    )
  }
  if (prepareOnly && reuseBuild) {
    throw new Error('--prepare-only cannot be combined with --reuse-build.')
  }
  const emergencyReason = assertEmergencyReleaseContract(shipOptions)

  const snapshotRoot = explicitSnapshot
    ? path.resolve(explicitSnapshot)
    : createDetachedSnapshot()
  const packageDocument = JSON.parse(
    readFileSync(path.join(snapshotRoot, 'desktop', 'package.json'), 'utf8')
  )
  const version = packageDocument.version
  if (installOnly) {
    await installRelease(snapshotRoot, version, {
      usePublishedArtifact: true,
    })
    console.log(
      `\nStatsKey ${version} was installed from pinned release output, launched, and verified.`
    )
    return
  }
  if (!prepareOnly) {
    if (!allowUnpushed) {
      const releaseSource = resolveReleaseSourceContract(
        {
          releaseSourceRemote,
          releaseSourceRef,
          releaseSourceRepository,
        },
        process.env
      )
      assertRetainedReleaseSource(snapshotRoot, releaseSource)
    } else {
      console.warn(
        `Emergency release source retention bypass: ${emergencyReason}`
      )
    }
    await waitForWebsiteRelease(snapshotRoot, version)
  }

  const publisherArgs = [
    path.join(snapshotRoot, 'desktop', 'publish-update.cjs'),
    prepareOnly ? '--prepare-only' : '--confirm-publish',
    '--mac-only',
    '--source-snapshot',
    snapshotRoot,
    ...(prepareOnly ? ['--native-arch-only'] : []),
    ...(reuseBuild ? ['--reuse-build'] : []),
  ]
  run(process.execPath, publisherArgs, {
    cwd: path.join(snapshotRoot, 'desktop'),
    env: notarizationEnvironment(),
  })

  await installRelease(snapshotRoot, version, {
    usePublishedArtifact: !prepareOnly,
  })
  if (managedSnapshot) {
    const completedSnapshot = managedSnapshot
    removeDetachedSnapshot(completedSnapshot)
    managedSnapshot = null
  }
  console.log(
    `\nStatsKey ${version} was ${
      prepareOnly ? 'built locally' : 'published'
    }, installed, launched, and verified.`
  )
}

function createDetachedSnapshot() {
  const status = git(invocationRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (status) {
    throw new Error(
      'The release checkout has uncommitted or untracked work. Commit the exact release first so the website and client use one immutable source.'
    )
  }
  const temporary = mkdtempSync(path.join(tmpdir(), 'statskey-release-source-'))
  rmSync(temporary, { recursive: true })
  run('git', ['worktree', 'add', '--detach', temporary, 'HEAD'], {
    cwd: invocationRoot,
  })
  managedSnapshot = temporary
  return temporary
}

function removeDetachedSnapshot(snapshotRoot) {
  run('git', ['worktree', 'remove', '--force', snapshotRoot], {
    cwd: invocationRoot,
  })
  run('git', ['worktree', 'prune'], { cwd: invocationRoot })
}

function assertRetainedReleaseSource(snapshotRoot, releaseSource) {
  const status = git(snapshotRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  const branch = git(snapshotRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const remoteUrl = git(snapshotRoot, [
    'remote',
    'get-url',
    releaseSource.remote,
  ])
  assertRetainedReleaseSourceIdentity({
    status,
    branch,
    remoteUrl,
    remote: releaseSource.remote,
    repository: releaseSource.repository,
  })
  run(
    'git',
    [
      'fetch',
      '--quiet',
      '--no-tags',
      releaseSource.remote,
      releaseSource.ref,
    ],
    {
      cwd: snapshotRoot,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }
  )
  const sourceCommit = git(snapshotRoot, ['rev-parse', 'HEAD^{commit}'])
  const retainedCommit = git(snapshotRoot, [
    'rev-parse',
    'FETCH_HEAD^{commit}',
  ])
  const ancestry = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', sourceCommit, retainedCommit],
    { cwd: snapshotRoot, stdio: 'ignore' }
  )
  assertRetainedReleaseSourceReachability({
    ref: releaseSource.ref,
    repository: releaseSource.repository,
    sourceCommit,
    isAncestor: ancestry.status === 0,
  })
}

async function waitForWebsiteRelease(snapshotRoot, version) {
  const deadline = Date.now() + 5 * 60_000
  const baseUrl = 'https://statskey.ai/downloads/statskey'
  const expectedHistory = JSON.parse(
    readFileSync(
      path.join(
        snapshotRoot,
        'public',
        'downloads',
        'statskey',
        'updates.json'
      ),
      'utf8'
    )
  )
  const pageMarkers = [
    `Mac ${version} · signed and Apple notarized`,
    `Mac ${version} · Windows`,
    `/releases/${version}/StatsKey-${version}-mac-arm64.dmg`,
    `/releases/${version}/StatsKey-${version}-mac-x64.dmg`,
    `const macVersion = "${version}";`,
  ]
  while (Date.now() < deadline) {
    try {
      const cacheKey = `release=${encodeURIComponent(version)}`
      const [historyResponse, pageResponse] = await Promise.all([
        fetch(`${baseUrl}/updates.json?${cacheKey}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        }),
        fetch(`${baseUrl}/?${cacheKey}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        }),
      ])
      if (historyResponse.ok && pageResponse.ok) {
        const [history, page] = await Promise.all([
          historyResponse.json(),
          pageResponse.text(),
        ])
        if (
          isDeepStrictEqual(history, expectedHistory) &&
          pageMarkers.every((marker) => page.includes(marker))
        ) {
          return
        }
      }
    } catch {
      // The next bounded poll reports the same deployment state.
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(
    `The website did not expose the exact StatsKey ${version} release metadata and download markers within five minutes. The client feed was not changed.`
  )
}

async function installRelease(
  snapshotRoot,
  version,
  { usePublishedArtifact }
) {
  const outputRoot = path.join(
    snapshotRoot,
    'desktop',
    `release-update-${version}`
  )
  const localManifest = JSON.parse(
    readFileSync(path.join(outputRoot, 'release-manifest.json'), 'utf8')
  )
  if (localManifest.version !== version) {
    throw new Error('Release manifest version does not match the package.')
  }
  let downloadRoot = null
  try {
    const manifest = usePublishedArtifact
      ? await readPublishedManifest(version)
      : localManifest
    if (!isDeepStrictEqual(manifest, localManifest)) {
      throw new Error(
        'The public release manifest does not match the pinned local release.'
      )
    }
    const download = selectMacDownload(manifest, process.arch)
    let installerPath
    if (usePublishedArtifact) {
      const expectedUrl =
        `${RELEASE_ROOT}/${encodeURIComponent(version)}/` +
        encodeURIComponent(download.file)
      if (download.url !== expectedUrl) {
        throw new Error(
          'The public release manifest contains an unexpected installer URL.'
        )
      }
      downloadRoot = mkdtempSync(
        path.join(tmpdir(), 'statskey-published-release-')
      )
      installerPath = path.join(downloadRoot, download.file)
      await downloadPublishedInstaller(
        expectedUrl,
        installerPath,
        download
      )
    } else {
      installerPath = path.join(
        outputRoot,
        download.channel,
        download.file
      )
      await assertMacArtifact(installerPath, download)
    }
    const rendererHealthEndpoint =
      manifest?.releaseVerification?.rendererHealthEndpoint
    if (
      rendererHealthEndpoint !== undefined &&
      rendererHealthEndpoint !== DESKTOP_HEALTH_PATH
    ) {
      throw new Error('Release manifest contains an invalid health endpoint.')
    }
    await installMacArtifact(installerPath, version, {
      requireRendererHealth: rendererHealthEndpoint === DESKTOP_HEALTH_PATH,
    })
  } finally {
    if (downloadRoot) {
      rmSync(downloadRoot, { recursive: true, force: true })
    }
  }
}

async function installMacArtifact(
  installerPath,
  version,
  { requireRendererHealth }
) {
  const mountPoint = mkdtempSync(path.join(tmpdir(), 'statskey-release-mount-'))
  const stagedApp = '/Applications/StatsKey.installing.app'
  const installedApp = '/Applications/StatsKey.app'
  const backupApp = `/Applications/.StatsKey.previous-${process.pid}.app`
  let mounted = false
  let replaced = false
  try {
    run('hdiutil', [
      'attach',
      installerPath,
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mountPoint,
    ])
    mounted = true
    const sourceApp = path.join(mountPoint, 'StatsKey.app')
    verifyApplication(sourceApp)
    rmSync(stagedApp, { recursive: true, force: true })
    rmSync(backupApp, { recursive: true, force: true })
    run('ditto', [sourceApp, stagedApp])
    verifyApplication(stagedApp)
    stopStatsKey()
    if (existsSync(installedApp)) renameSync(installedApp, backupApp)
    try {
      renameSync(stagedApp, installedApp)
      replaced = true
    } catch (error) {
      if (existsSync(backupApp) && !existsSync(installedApp)) {
        renameSync(backupApp, installedApp)
      }
      throw error
    }
    run('open', [installedApp])
    await waitForLaunch(installedApp, version, { requireRendererHealth })
    rmSync(backupApp, { recursive: true, force: true })
  } catch (error) {
    if (replaced && existsSync(backupApp)) {
      stopStatsKey()
      rmSync(installedApp, { recursive: true, force: true })
      renameSync(backupApp, installedApp)
      run('open', [installedApp], { allowFailure: true })
    }
    throw error
  } finally {
    rmSync(stagedApp, { recursive: true, force: true })
    if (mounted) {
      run('hdiutil', ['detach', mountPoint], { allowFailure: true })
    }
    rmSync(mountPoint, { recursive: true, force: true })
  }
}

async function readPublishedManifest(version) {
  const url =
    `${RELEASE_ROOT}/${encodeURIComponent(version)}/release-manifest.json` +
    `?release=${encodeURIComponent(version)}`
  const response = await fetchWithRetry(
    () =>
      fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      }),
    `StatsKey ${version} public manifest`
  )
  if (!response.ok) {
    throw new Error(
      `Could not download the public release manifest (${response.status}).`
    )
  }
  try {
    return await response.json()
  } catch {
    throw new Error('The public release manifest is not valid JSON.')
  }
}

async function downloadPublishedInstaller(url, filePath, download) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    rmSync(filePath, { force: true })
    try {
      const response = await fetchWithRetry(
        () =>
          fetch(url, {
            cache: 'no-store',
            signal: AbortSignal.timeout(10 * 60_000),
          }),
        `${download.channel} public installer`
      )
      if (!response.ok || !response.body) {
        throw new Error(
          `Could not download the public installer (${response.status}).`
        )
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(filePath, { mode: 0o600 })
      )
      await assertMacArtifact(filePath, download)
      return
    } catch (error) {
      rmSync(filePath, { force: true })
      if (attempt === 3) throw error
      console.warn(
        `Retrying ${download.channel} public installer download ` +
          `(attempt ${attempt + 1}/3).`
      )
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
    }
  }
}

function verifyApplication(appPath) {
  const infoPath = path.join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(infoPath)) throw new Error(`Invalid application bundle: ${appPath}`)
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  run('spctl', ['-a', '-t', 'exec', '-vv', appPath])
  run('xcrun', ['stapler', 'validate', appPath])
}

function stopStatsKey() {
  run(
    'osascript',
    ['-e', 'tell application id "ai.statskey.desktop" to quit'],
    { allowFailure: true }
  )
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const running = spawnSync('pgrep', [
      '-f',
      '/Applications/StatsKey.app/Contents/MacOS/StatsKey',
    ])
    if (running.status !== 0) return
    sleep(250)
  }
  throw new Error('StatsKey did not quit before the atomic application update.')
}

async function waitForLaunch(appPath, version, { requireRendererHealth }) {
  const infoPath = path.join(appPath, 'Contents', 'Info.plist')
  const installedVersion = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', infoPath],
    { encoding: 'utf8' }
  ).trim()
  if (installedVersion !== version) {
    throw new Error(
      `Installed version ${installedVersion || '(missing)'} does not match ${version}.`
    )
  }
  const deadline = Date.now() + (requireRendererHealth ? 60_000 : 20_000)
  while (Date.now() < deadline) {
    const running = spawnSync('pgrep', [
      '-f',
      '/Applications/StatsKey.app/Contents/MacOS/StatsKey',
    ])
    if (
      running.status === 0 &&
      (!requireRendererHealth || (await rendererHealthIsReady(version)))
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    requireRendererHealth
      ? 'StatsKey did not report renderer readiness after installation.'
      : 'StatsKey did not launch after installation.'
  )
}

async function rendererHealthIsReady(version) {
  try {
    const response = await fetch(
      `http://localhost:43127${DESKTOP_HEALTH_PATH}`,
      {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(2_000),
      }
    )
    if (!response.ok) return false
    const health = await response.json()
    return (
      health?.status === 'ready' &&
      health?.version === version &&
      health?.architecture === process.arch &&
      health?.updateFeed ===
        `https://storage.googleapis.com/${BUCKET}/updates/mac-${process.arch}`
    )
  } catch {
    return false
  }
}

function notarizationEnvironment() {
  const environment = { ...process.env }
  const hasConfiguredRoute =
    (environment.APPLE_API_KEY &&
      environment.APPLE_API_KEY_ID &&
      environment.APPLE_API_ISSUER) ||
    (environment.APPLE_ID &&
      environment.APPLE_APP_SPECIFIC_PASSWORD &&
      environment.APPLE_TEAM_ID) ||
    environment.APPLE_KEYCHAIN_PROFILE
  if (hasConfiguredRoute) return environment

  const configPath = path.join(homedir(), '.config', 'statskey-asc.json')
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      if (
        typeof config.keyPath === 'string' &&
        path.isAbsolute(config.keyPath) &&
        existsSync(config.keyPath) &&
        typeof config.keyId === 'string' &&
        config.keyId &&
        typeof config.issuerId === 'string' &&
        config.issuerId
      ) {
        return {
          ...environment,
          APPLE_API_KEY: config.keyPath,
          APPLE_API_KEY_ID: config.keyId,
          APPLE_API_ISSUER: config.issuerId,
        }
      }
    } catch {
      // Publisher preflight reports malformed or unavailable credentials.
    }
  }
  return { ...environment, APPLE_KEYCHAIN_PROFILE: 'StatsKeyNotary' }
}

function git(cwd, gitArgs) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8' }).trim()
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.allowFailure ? 'ignore' : 'inherit',
  })
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`)
  }
  return result
}

function sleep(milliseconds) {
  const marker = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(marker, 0, 0, milliseconds)
}
