const { existsSync, readdirSync, realpathSync, statSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { shell } = require('electron')

const BLOCKED_APPLICATION_PATTERN =
  /(password|keychain|wallet|bank|terminal|console|system settings|activity monitor|script editor|automator|shortcuts)/i
const BLOCKED_WINDOWS_APPLICATION_PATTERN =
  /(command prompt|powershell|windows terminal|settings|control panel|registry|task manager|computer management|services|remote desktop|uninstall|updater?|setup|installer|crash reporter)/i
const MAX_APPLICATIONS = 250
const MAX_WINDOWS_START_MENU_ENTRIES = 2_000
const MAX_WINDOWS_START_MENU_DEPTH = 4

class ControlledApplicationsRuntime {
  constructor({ requestApproval }) {
    this.requestApproval = requestApproval
  }

  list() {
    return safeApplications().map((application) => ({
      name: application.name,
    }))
  }

  async open(rawName, approvalMode) {
    try {
      const name = typeof rawName === 'string' ? rawName.trim() : ''
      if (!name || name.length > 120 || BLOCKED_APPLICATION_PATTERN.test(name)) {
        throw new Error('That application is not available for Agent control.')
      }
      const application = safeApplications().find(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
      )
      if (!application) {
        throw new Error('Choose an application from the approved application list.')
      }
      const approved = await this.requestApproval(
        {
          kind: 'application',
          title: `Open ${application.name}`,
          description:
            'StatsKey can launch this application, but cannot read its credentials or control it silently.',
          command: `launch ${JSON.stringify(application.name)}`,
          before: '',
          after: '',
        },
        approvalMode
      )
      if (!approved) return { ok: false, cancelled: true }
      const error = await shell.openPath(application.path)
      if (error) throw new Error(error)
      return { ok: true, application: application.name }
    } catch (error) {
      return {
        ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          400
        ),
      }
    }
  }
}

function safeApplications(options = {}) {
  const platform = options.platform || process.platform
  if (platform === 'win32') return safeWindowsApplications(options)
  if (platform !== 'darwin') return []
  return safeMacApplications(options)
}

function safeMacApplications({ roots } = {}) {
  const allowedRoots = canonicalApplicationRoots(
    roots || [
      '/Applications',
      '/System/Applications',
      path.join(os.homedir(), 'Applications'),
    ]
  )
  const applications = new Map()
  for (const root of allowedRoots) {
    let names = []
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of names) {
      if (
        !entry.endsWith('.app') ||
        entry.length > 180 ||
        BLOCKED_APPLICATION_PATTERN.test(entry)
      ) {
        continue
      }
      const candidate = path.join(root, entry)
      try {
        const resolved = realpathSync(candidate)
        if (!statSync(resolved).isDirectory()) continue
        if (!pathInsideApplicationRoot(resolved, root)) continue
        const name = entry.slice(0, -4)
        if (!applications.has(name.toLowerCase())) {
          applications.set(name.toLowerCase(), { name, path: resolved })
        }
      } catch {
        // Ignore broken aliases and inaccessible bundles.
      }
    }
  }
  return [...applications.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_APPLICATIONS)
}

function safeWindowsApplications({
  roots,
  targetRoots,
  readShortcutLink = shell.readShortcutLink?.bind(shell),
  environment = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  const startMenuRoots = roots || [
    environment?.ProgramData && path.join(
      environment.ProgramData,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs'
    ),
    environment?.APPDATA && path.join(
      environment.APPDATA,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs'
    ),
    path.join(
      homeDirectory,
      'AppData',
      'Roaming',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs'
    ),
  ]
  const allowedRoots = canonicalApplicationRoots(startMenuRoots)
  const allowedTargetRoots = canonicalApplicationRoots(targetRoots || [
    environment?.ProgramFiles,
    environment?.['ProgramFiles(x86)'],
    environment?.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs'),
  ])
  if (typeof readShortcutLink !== 'function' || allowedTargetRoots.length === 0) {
    return []
  }
  const applications = new Map()
  let inspectedEntries = 0

  for (const root of allowedRoots) {
    const pending = [{ directory: root, depth: 0 }]
    while (
      pending.length > 0 &&
      inspectedEntries < MAX_WINDOWS_START_MENU_ENTRIES &&
      applications.size < MAX_APPLICATIONS
    ) {
      const current = pending.shift()
      let entries = []
      try {
        entries = readdirSync(current.directory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name))
      } catch {
        continue
      }
      for (const entry of entries) {
        inspectedEntries += 1
        if (inspectedEntries > MAX_WINDOWS_START_MENU_ENTRIES) break
        const candidate = path.join(current.directory, entry.name)
        let resolved
        try {
          resolved = realpathSync(candidate)
        } catch {
          continue
        }
        if (!pathInsideApplicationRoot(resolved, root)) continue
        if (
          entry.isDirectory() &&
          current.depth < MAX_WINDOWS_START_MENU_DEPTH
        ) {
          pending.push({ directory: resolved, depth: current.depth + 1 })
          continue
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.lnk') {
          continue
        }
        const name = path.basename(entry.name, path.extname(entry.name)).trim()
        if (
          !name ||
          name.length > 180 ||
          BLOCKED_APPLICATION_PATTERN.test(name) ||
          BLOCKED_WINDOWS_APPLICATION_PATTERN.test(name)
        ) {
          continue
        }
        let shortcut
        try {
          if (!statSync(resolved).isFile()) continue
          shortcut = readShortcutLink(resolved)
        } catch {
          continue
        }
        const target = safeWindowsShortcutTarget(
          shortcut,
          allowedTargetRoots
        )
        if (!target) continue
        if (!applications.has(name.toLowerCase())) {
          // Open the validated executable itself, not the mutable shortcut and
          // not any shortcut arguments. This prevents a harmless-looking link
          // in the per-user Start Menu from becoming an arbitrary launcher.
          applications.set(name.toLowerCase(), { name, path: target })
        }
        if (applications.size >= MAX_APPLICATIONS) break
      }
    }
  }

  return [...applications.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_APPLICATIONS)
}

function safeWindowsShortcutTarget(shortcut, allowedTargetRoots) {
  if (
    !shortcut ||
    typeof shortcut.target !== 'string' ||
    !shortcut.target ||
    shortcut.target.length > 32_768 ||
    shortcut.target.includes('\0') ||
    (typeof shortcut.args === 'string' && shortcut.args.trim()) ||
    !path.isAbsolute(shortcut.target)
  ) {
    return null
  }
  try {
    const target = realpathSync(shortcut.target)
    if (
      !statSync(target).isFile() ||
      path.extname(target).toLowerCase() !== '.exe' ||
      BLOCKED_APPLICATION_PATTERN.test(path.basename(target)) ||
      BLOCKED_WINDOWS_APPLICATION_PATTERN.test(path.basename(target)) ||
      !allowedTargetRoots.some((root) => pathInsideApplicationRoot(target, root))
    ) {
      return null
    }
    return target
  } catch {
    return null
  }
}

function canonicalApplicationRoots(roots) {
  const canonical = []
  for (const candidate of roots.filter(Boolean).slice(0, 12)) {
    try {
      const resolved = realpathSync(candidate)
      if (!statSync(resolved).isDirectory() || canonical.includes(resolved)) {
        continue
      }
      canonical.push(resolved)
    } catch {
      // Ignore unavailable or inaccessible application roots.
    }
  }
  return canonical
}

function pathInsideApplicationRoot(candidate, root) {
  const relative = path.relative(root, candidate)
  return Boolean(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

module.exports = {
  BLOCKED_APPLICATION_PATTERN,
  BLOCKED_WINDOWS_APPLICATION_PATTERN,
  ControlledApplicationsRuntime,
  safeApplications,
  safeWindowsShortcutTarget,
}
