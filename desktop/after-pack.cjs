const {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const path = require('node:path')

module.exports = async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : path.join(context.appOutDir, 'resources')
  if (context.electronPlatformName === 'darwin') {
    hardenMacInfoPlist(path.join(resources, '..', 'Info.plist'))
  }
  const prebuilds = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds'
  )
  if (!existsSync(prebuilds)) return
  const architecture = architectureName(context.arch)
  const keep = `${context.electronPlatformName}-${architecture}`
  for (const directory of readdirSync(prebuilds)) {
    if (directory !== keep) {
      rmSync(path.join(prebuilds, directory), { recursive: true, force: true })
    }
  }
  const helper = path.join(prebuilds, keep, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}

function hardenMacInfoPlist(infoPath) {
  if (!existsSync(infoPath)) return
  let contents = readFileSync(infoPath, 'utf8')
  contents = contents.replace(
    /(<key>NSAllowsArbitraryLoads<\/key>\s*)<true\/>/,
    '$1<false/>'
  )
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    contents = contents.replace(
      new RegExp(`\\s*<key>${key}</key>\\s*<string>[^<]*</string>`),
      ''
    )
  }
  writeFileSync(infoPath, contents)
}

function architectureName(value) {
  if (typeof value === 'string') return value
  if (value === 0) return 'ia32'
  if (value === 1) return 'x64'
  if (value === 2) return 'armv7l'
  if (value === 3) return 'arm64'
  return process.arch
}
