const { execFileSync, spawnSync } = require('node:child_process')
const path = require('node:path')
const packageJson = require('./package.json')

const requested = new Set(process.argv.slice(2))
const architectures =
  requested.has('--arm64') || requested.has('--x64')
    ? ['arm64', 'x64'].filter((arch) => requested.has(`--${arch}`))
    : [process.arch === 'arm64' ? 'arm64' : 'x64']

const identities = runForOutput('security', [
  'find-identity',
  '-v',
  '-p',
  'codesigning',
])
const identityMatch = identities.match(/"([^"]*Developer ID Application:[^"]+)"/)
if (!identityMatch) {
  fail(
    [
      'Developer ID Application certificate not found.',
      '',
      'In Xcode: Settings → Accounts → select team QSKTTJ7A2W →',
      'Manage Certificates → + → Developer ID Application.',
      '',
      'Do not publish another macOS build until this check passes.',
    ].join('\n')
  )
}

const hasApiKey =
  Boolean(process.env.APPLE_API_KEY) &&
  Boolean(process.env.APPLE_API_KEY_ID) &&
  Boolean(process.env.APPLE_API_ISSUER)
const hasAppleId =
  Boolean(process.env.APPLE_ID) &&
  Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD) &&
  Boolean(process.env.APPLE_TEAM_ID)
const hasKeychainProfile = Boolean(process.env.APPLE_KEYCHAIN_PROFILE)

if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
  fail(
    [
      'Apple notarization credentials are not configured.',
      '',
      'Recommended local setup:',
      '  xcrun notarytool store-credentials "StatsKeyNotary" \\',
      '    --apple-id "<your developer Apple ID>" \\',
      '    --team-id "QSKTTJ7A2W"',
      '',
      'The command securely prompts for an app-specific password.',
      'Then run with APPLE_KEYCHAIN_PROFILE=StatsKeyNotary.',
    ].join('\n')
  )
}

const credentialArgs = hasApiKey
  ? [
      '--key',
      process.env.APPLE_API_KEY,
      '--key-id',
      process.env.APPLE_API_KEY_ID,
      '--issuer',
      process.env.APPLE_API_ISSUER,
    ]
  : hasKeychainProfile
    ? ['--keychain-profile', process.env.APPLE_KEYCHAIN_PROFILE]
    : [
        '--apple-id',
        process.env.APPLE_ID,
        '--password',
        process.env.APPLE_APP_SPECIFIC_PASSWORD,
        '--team-id',
        process.env.APPLE_TEAM_ID,
      ]
const credentialCheck = spawnSync(
  'xcrun',
  ['notarytool', 'history', ...credentialArgs],
  { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' }
)
if (credentialCheck.status !== 0) {
  fail(
    'Apple notarization credentials failed their preflight check. ' +
      'No release was built. ' +
      (credentialCheck.stderr || credentialCheck.stdout || '').trim().slice(0, 500)
  )
}

const builderArgs = [
  'electron-builder',
  '--mac',
  'dmg',
  'zip',
  ...architectures.map((arch) => `--${arch}`),
  '--config.mac.notarize=true',
  '--config.npmRebuild=false',
]
const build = spawnSync('npx', builderArgs, {
  cwd: __dirname,
  env: {
    ...process.env,
    CSC_NAME: identityMatch[1].replace(/^Developer ID Application:\s*/, ''),
  },
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status || 1)

for (const architecture of architectures) {
  const appDirectory =
    architecture === 'arm64'
      ? path.join(__dirname, 'release', 'mac-arm64', 'StatsKey.app')
      : path.join(__dirname, 'release', 'mac', 'StatsKey.app')

  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appDirectory])
  run('spctl', ['-a', '-t', 'exec', '-vv', appDirectory])
  run('xcrun', ['stapler', 'validate', appDirectory])
}

console.log(
  `StatsKey ${packageJson.version} is Developer ID signed, notarized, and stapled.`
)

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}

function runForOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' })
  } catch (error) {
    return `${error.stdout || ''}\n${error.stderr || ''}`
  }
}

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
