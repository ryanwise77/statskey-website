const { createHash } = require('node:crypto')
const { createReadStream, existsSync, statSync } = require('node:fs')
const path = require('node:path')

const SHIP_BOOLEAN_FLAGS = new Map([
  ['--prepare-only', 'prepareOnly'],
  ['--install-only', 'installOnly'],
  ['--confirm-publish', 'confirmed'],
  ['--reuse-build', 'reuseBuild'],
  ['--allow-unpushed', 'allowUnpushed'],
])

const SHIP_VALUE_FLAGS = new Map([
  ['--source-snapshot', 'sourceSnapshot'],
  ['--release-source-remote', 'releaseSourceRemote'],
  ['--release-source-ref', 'releaseSourceRef'],
  ['--release-source-repository', 'releaseSourceRepository'],
  ['--emergency-release-reason', 'emergencyReleaseReason'],
])

const DEFAULT_RELEASE_SOURCE_REPOSITORY = 'ryanwise77/statskeyapp2.0'

function parseShipMacArgs(argv) {
  const result = {
    prepareOnly: false,
    installOnly: false,
    confirmed: false,
    reuseBuild: false,
    allowUnpushed: false,
    sourceSnapshot: '',
    releaseSourceRemote: '',
    releaseSourceRef: '',
    releaseSourceRepository: '',
    emergencyReleaseReason: '',
  }
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index])
    if (SHIP_BOOLEAN_FLAGS.has(argument)) {
      if (seen.has(argument)) {
        throw new Error(`Duplicate release flag: ${argument}`)
      }
      seen.add(argument)
      result[SHIP_BOOLEAN_FLAGS.get(argument)] = true
      continue
    }
    const valueFlag = [...SHIP_VALUE_FLAGS.keys()].find(
      (flag) => argument === flag || argument.startsWith(`${flag}=`)
    )
    if (valueFlag) {
      if (seen.has(valueFlag)) {
        throw new Error(`Duplicate release flag: ${valueFlag}`)
      }
      seen.add(valueFlag)
      const value =
        argument === valueFlag
          ? String(argv[++index] || '').trim()
          : argument.slice(valueFlag.length + 1).trim()
      if (!value || value.startsWith('--')) {
        throw new Error(`${valueFlag} requires a value.`)
      }
      result[SHIP_VALUE_FLAGS.get(valueFlag)] = value
      continue
    }
    throw new Error(`Unknown release argument: ${argument || '(empty)'}`)
  }
  return result
}

function resolveReleaseSourceContract(options, environment = process.env) {
  const remote = releaseSourceValue(
    options.releaseSourceRemote,
    environment.STATSKEY_RELEASE_SOURCE_REMOTE
  )
  const ref = releaseSourceValue(
    options.releaseSourceRef,
    environment.STATSKEY_RELEASE_SOURCE_REF
  )
  const repository = normalizeGitHubRepository(
    releaseSourceValue(
      options.releaseSourceRepository,
      environment.STATSKEY_RELEASE_SOURCE_REPOSITORY,
      DEFAULT_RELEASE_SOURCE_REPOSITORY
    )
  )

  if (!remote || !ref) {
    throw new Error(
      'Publishing requires a retained private release source. Set both --release-source-remote and --release-source-ref (or STATSKEY_RELEASE_SOURCE_REMOTE and STATSKEY_RELEASE_SOURCE_REF).'
    )
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) {
    throw new Error(
      '--release-source-remote must be the name of a configured Git remote, not a URL.'
    )
  }
  if (!isFullBranchRef(ref)) {
    throw new Error(
      '--release-source-ref must be a full retained branch ref such as refs/heads/release/desktop-0.21.8.'
    )
  }
  if (!repository) {
    throw new Error(
      '--release-source-repository must identify a GitHub repository as owner/name.'
    )
  }
  return { remote, ref, repository }
}

function assertEmergencyReleaseContract(options) {
  const allowUnpushed = options.allowUnpushed === true
  const reason = String(options.emergencyReleaseReason || '').trim()
  if (allowUnpushed && !reason) {
    throw new Error(
      '--allow-unpushed is emergency-only and also requires --emergency-release-reason.'
    )
  }
  if (!allowUnpushed && reason) {
    throw new Error(
      '--emergency-release-reason can only be used with --allow-unpushed.'
    )
  }
  return reason
}

function assertRetainedReleaseSourceState(state) {
  assertRetainedReleaseSourceIdentity(state)
  assertRetainedReleaseSourceReachability(state)
}

function assertRetainedReleaseSourceIdentity(state) {
  if (state.status) {
    throw new Error(
      'The release source snapshot is not clean. Publish only from the exact committed source.'
    )
  }
  if (state.branch !== 'HEAD') {
    throw new Error(
      'The release source must be a detached snapshot of the exact release commit.'
    )
  }
  const actualRepository = normalizeGitHubRepository(state.remoteUrl)
  if (actualRepository !== state.repository) {
    throw new Error(
      `Release source remote ${state.remote} points to ${
        actualRepository || 'an unsupported repository URL'
      }, not ${state.repository}.`
    )
  }
}

function assertRetainedReleaseSourceReachability(state) {
  if (!state.isAncestor) {
    throw new Error(
      `The release commit ${state.sourceCommit} is not reachable from retained private ref ${state.ref} in ${state.repository}. Push that exact source commit before publishing the client update.`
    )
  }
}

function normalizeGitHubRepository(value) {
  const candidate = String(value || '').trim().replace(/\.git$/, '')
  const match = candidate.match(
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i
  )
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : ''
}

function releaseSourceValue(primary, secondary, fallback = '') {
  return String(primary || secondary || fallback || '').trim()
}

function isFullBranchRef(ref) {
  return (
    /^refs\/heads\/.+/.test(ref) &&
    !/[ ~^:?*\\[]/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.includes('@{') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.') &&
    !ref.endsWith('.lock')
  )
}

function selectMacDownload(manifest, architecture) {
  const channel =
    architecture === 'arm64'
      ? 'mac-arm64'
      : architecture === 'x64'
        ? 'mac-x64'
        : null
  if (!channel) {
    throw new Error(`Unsupported Mac architecture: ${architecture}`)
  }
  const download = manifest?.downloads?.[channel]
  if (
    typeof manifest?.version !== 'string' ||
    !download ||
    typeof download.file !== 'string' ||
    path.basename(download.file) !== download.file ||
    !download.file.endsWith('.dmg') ||
    !Number.isSafeInteger(download.bytes) ||
    download.bytes <= 0 ||
    typeof download.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(download.sha256)
  ) {
    throw new Error(`Release manifest is missing a valid ${channel} download.`)
  }
  return {
    channel,
    version: manifest.version,
    file: download.file,
    bytes: download.bytes,
    sha256: download.sha256,
    url: download.url,
  }
}

async function assertMacArtifact(filePath, download) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`Release installer is missing: ${filePath}`)
  }
  if (statSync(filePath).size !== download.bytes) {
    throw new Error('Release installer size does not match its manifest.')
  }
  const digest = await sha256File(filePath)
  if (digest !== download.sha256) {
    throw new Error('Release installer digest does not match its manifest.')
  }
  return digest
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.on('end', () => resolve(digest.digest('hex')))
  })
}

module.exports = {
  DEFAULT_RELEASE_SOURCE_REPOSITORY,
  assertEmergencyReleaseContract,
  assertMacArtifact,
  assertRetainedReleaseSourceIdentity,
  assertRetainedReleaseSourceReachability,
  assertRetainedReleaseSourceState,
  normalizeGitHubRepository,
  parseShipMacArgs,
  resolveReleaseSourceContract,
  selectMacDownload,
}
