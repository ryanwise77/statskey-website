import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { overlayStatsKeyExtension } from './extension-overlay.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildRoot = process.env.CODE_OSS_BUILD_ROOT || path.join(os.homedir(), 'Projects', 'StatsKeyWorkbenchBuild')
const checkout = path.join(buildRoot, 'vscode')
const pin = existsSync(path.join(root, 'CODE_OSS_REF'))
  ? readFileSync(path.join(root, 'CODE_OSS_REF'), 'utf8').trim()
  : '1.131.0'

if (!existsSync(path.join(checkout, 'package.json'))) {
  throw new Error('Code OSS checkout missing. Run: CODE_OSS_REF=1.131.0 npm run setup')
}

const nvmrc = existsSync(path.join(checkout, '.nvmrc'))
  ? readFileSync(path.join(checkout, '.nvmrc'), 'utf8').trim()
  : '24'
console.log(`Building StatsKey Workbench on Code OSS ${pin} (Node ${nvmrc} recommended).`)

overlayStatsKeyExtension(root, checkout)
run('npm', ['ci'], checkout)
run('npm', ['ci'], path.join(checkout, 'extensions', 'statskey-workbench'))
run('npm', ['run', 'download-builtin-extensions'], checkout)
run('npm', ['run', 'compile'], checkout)
run('npx', ['gulp', 'compile-extensions'], checkout)

console.log('Compile complete. Run npm run package to produce installers.')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd, env: process.env })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`)
  }
}
