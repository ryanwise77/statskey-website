import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { assertStatsKeyExtensionCurrent } from './extension-overlay.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildRoot = process.env.CODE_OSS_BUILD_ROOT || path.join(os.homedir(), 'Projects', 'StatsKeyWorkbenchBuild')
const checkout = path.join(buildRoot, 'vscode')
const release = path.join(root, 'release')
const brand = JSON.parse(readFileSync(path.join(root, 'product.statskey.json'), 'utf8'))
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

if (!existsSync(path.join(checkout, 'out'))) {
  throw new Error('Compiled output missing. Run npm run build first.')
}
assertStatsKeyExtensionCurrent(root, checkout)

mkdirSync(release, { recursive: true })

const platform = process.platform
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const gulpTarget =
  platform === 'darwin'
    ? `vscode-darwin-${arch}`
    : platform === 'win32'
      ? `vscode-win32-${arch}`
      : `vscode-linux-${arch}`

console.log(`Packaging ${brand.nameLong} via gulp ${gulpTarget}…`)
run('npm', ['run', 'gulp', '--', gulpTarget], checkout)

const candidates = [
  path.join(checkout, '.build'),
  path.join(checkout, 'build', 'vscode-dist'),
  path.join(os.homedir(), 'VSCode-darwin-arm64'),
  path.join(os.homedir(), `VSCode-darwin-${arch}`),
]

const found = []
for (const dir of candidates) {
  if (!existsSync(dir)) continue
  walk(dir, found)
}

const stamped = path.join(
  release,
  brand.artifactName
    .replace('${version}', version)
    .replace('${os}', platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux')
    .replace('${arch}', arch)
    .replace('${ext}', platform === 'darwin' ? 'app' : platform === 'win32' ? 'exe' : 'tar.gz')
)

if (found.length === 0) {
  console.log('Gulp finished. Copy the generated VS Code app from the gulp output into desktop-code/release/.')
  console.log(`Expected artifact naming: ${stamped}`)
  process.exit(0)
}

mkdirSync(release, { recursive: true })
for (const file of found.slice(0, 8)) {
  const dest = path.join(release, path.basename(file))
  copyFileSync(file, dest)
  console.log(`Copied ${dest}`)
}
console.log(`Release folder: ${release}`)
console.log(`Canonical download slug: ${brand.downloadSlug}`)

function walk(dir, out, depth = 0) {
  if (depth > 4) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.endsWith('.app') || entry.name.includes('StatsKey')) out.push(full)
      else walk(full, out, depth + 1)
    } else if (/\.(dmg|zip|exe|AppImage|tar\.gz)$/i.test(entry.name)) {
      out.push(full)
    }
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd, env: process.env })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`)
  }
}
