import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { overlayStatsKeyExtension } from './extension-overlay.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const ref = process.env.CODE_OSS_REF || '1.131.0'
// node-gyp cannot compile native modules under a path containing spaces, so the
// heavy checkout lives outside the repo at a space-free build root by default.
const buildRoot = process.env.CODE_OSS_BUILD_ROOT || path.join(os.homedir(), 'Projects', 'StatsKeyWorkbenchBuild')
const vendor = path.join(buildRoot)
const checkout = path.join(vendor, 'vscode')
const reset = process.env.CODE_OSS_RESET === '1'

mkdirSync(vendor, { recursive: true })

if (reset && existsSync(checkout)) {
  rmSync(checkout, { recursive: true, force: true })
}

if (!existsSync(path.join(checkout, '.git'))) {
  run('git', [
    'clone',
    '--filter=blob:none',
    '--branch',
    ref,
    '--single-branch',
    'https://github.com/microsoft/vscode.git',
    checkout,
  ])
} else {
  run('git', ['-C', checkout, 'fetch', '--depth', '1', 'origin', `refs/tags/${ref}:refs/tags/${ref}`])
  removePatchGeneratedFiles(checkout)
  run('git', ['-C', checkout, 'checkout', '--force', ref])
}

run('git', ['-C', checkout, 'lfs', 'install', '--local'])
run('git', ['-C', checkout, 'lfs', 'pull'])

applyCorePatches(checkout)
applyPackageVersion(checkout)
applyProductBrand(checkout)
overlayStatsKeyExtension(root, checkout)

const pinPath = path.join(root, 'CODE_OSS_REF')
writeFileSync(pinPath, `${ref}\n`)

console.log(`Code OSS ${ref} is checked out, branded, and the StatsKey Workbench extension is overlaid.`)
console.log('Next: npm run build (requires Node matching vendor/vscode/.nvmrc).')

function applyCorePatches(checkoutDir) {
  const patchPath = path.join(root, 'patches', 'desktop-core.patch')
  if (!existsSync(patchPath)) {
    throw new Error(`Missing desktop core patch: ${patchPath}`)
  }
  run('git', ['-C', checkoutDir, 'apply', '--check', patchPath])
  run('git', ['-C', checkoutDir, 'apply', '--whitespace=nowarn', patchPath])
}

function removePatchGeneratedFiles(checkoutDir) {
  // `git checkout --force` restores tracked files but intentionally leaves
  // untracked files behind. These two files are created by desktop-core.patch;
  // removing only those known generated paths keeps ordinary setup rerunnable
  // without touching unrelated user files in the vendor checkout.
  for (const relativePath of [
    'src/vs/workbench/contrib/browserView/test/common/browserEditorInput.test.ts',
    'src/vs/workbench/contrib/chat/common/codexAccountCommands.ts',
    'src/vs/workbench/contrib/chat/test/common/codexAccountCommands.test.ts',
  ]) {
    rmSync(path.join(checkoutDir, relativePath), { force: true })
  }
}

function applyPackageVersion(checkoutDir) {
  const packagePath = path.join(checkoutDir, 'package.json')
  const lockPath = path.join(checkoutDir, 'package-lock.json')
  writeFileSync(packagePath, replaceVersion(readFileSync(packagePath, 'utf8'), desktopVersion))

  let lock = replaceVersion(readFileSync(lockPath, 'utf8'), desktopVersion)
  const packagesIndex = lock.indexOf('"packages"')
  const rootPackageIndex = lock.indexOf('"": {', packagesIndex)
  if (rootPackageIndex < 0) {
    throw new Error(`Could not find the root package entry in ${lockPath}`)
  }
  lock = `${lock.slice(0, rootPackageIndex)}${replaceVersion(lock.slice(rootPackageIndex), desktopVersion)}`
  writeFileSync(lockPath, lock)
}

function replaceVersion(contents, version) {
  const next = contents.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${version}"`)
  if (next === contents) {
    throw new Error('Could not find a package version to stamp')
  }
  return next
}

function applyProductBrand(checkoutDir) {
  const brandPath = path.join(root, 'product.statskey.json')
  const productPath = path.join(checkoutDir, 'product.json')
  if (!existsSync(productPath)) {
    throw new Error(`Missing product.json in ${checkoutDir}`)
  }
  const brand = JSON.parse(readFileSync(brandPath, 'utf8'))
  const product = JSON.parse(readFileSync(productPath, 'utf8'))
  const merged = {
    ...product,
    nameShort: brand.nameShort,
    nameLong: brand.nameLong,
    applicationName: brand.applicationName,
    dataFolderName: brand.dataFolderName,
    sharedDataFolderName: `${brand.dataFolderName}-shared`,
    win32MutexName: 'statskeyworkbench',
    win32DirName: brand.nameLong,
    win32NameVersion: brand.nameLong,
    win32RegValueName: 'StatsKeyWorkbench',
    win32AppUserModelId: brand.win32AppUserModelId,
    win32ShellNameShort: 'S&tatsKey Workbench',
    win32TunnelServiceMutex: 'statskeyworkbench-tunnelservice',
    win32TunnelMutex: 'statskeyworkbench-tunnel',
    darwinBundleIdentifier: brand.darwinBundleIdentifier,
    linuxIconName: brand.applicationName,
    urlProtocol: brand.urlProtocol,
    serverApplicationName: `${brand.applicationName}-server`,
    serverDataFolderName: `.${brand.applicationName}-server`,
    tunnelApplicationName: `${brand.applicationName}-tunnel`,
    reportIssueUrl: 'https://statskey.ai/support',
    licenseName: product.licenseName || 'MIT',
    agentSdks: brand.agentSdks || product.agentSdks,
  }
  // StatsKey Workbench ships its own Intelligence surface; the default
  // Copilot entry point and its auto-update hooks are disabled in the fork.
  delete merged.defaultChatAgent
  delete merged.builtInExtensionsEnabledWithAutoUpdates
  writeFileSync(productPath, `${JSON.stringify(merged, null, '\t')}\n`)
  writeFileSync(
    path.join(checkoutDir, 'product.statskey.overlay.json'),
    `${JSON.stringify(brand, null, 2)}\n`
  )
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`)
  }
}
