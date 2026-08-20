/**
 * Cockpit view-model: friendly machine orchestration over the Fleet control
 * plane. Everything here is pure so the route stays a thin composition and
 * the behavior is testable without a renderer.
 */
import { durableGetItem, durableSetItem } from './durableRendererStorage'
import {
  fleetDeviceIsPresent,
  type CreateFleetJobInput,
  type FleetDevice,
  type FleetGrant,
  type FleetJob,
  type FleetJobEvent,
} from './fleet/types'

export const COCKPIT_ONBOARDING_STORAGE_KEY =
  'statskey.desktop.cockpitOnboarding.v1'

export type CockpitOnboardingChoice = 'enabled' | 'notNow'

export function loadCockpitOnboardingChoice(
  storage: Storage = localStorage
): CockpitOnboardingChoice | null {
  const value = durableGetItem(COCKPIT_ONBOARDING_STORAGE_KEY, storage)
  return value === 'enabled' || value === 'notNow' ? value : null
}

export function saveCockpitOnboardingChoice(
  choice: CockpitOnboardingChoice,
  storage: Storage = localStorage
): void {
  durableSetItem(COCKPIT_ONBOARDING_STORAGE_KEY, choice, storage)
}

export function shouldShowCockpitOnboarding({
  isDesktop,
  signedIn,
  choice,
}: {
  isDesktop: boolean
  signedIn: boolean
  choice: CockpitOnboardingChoice | null
}): boolean {
  return isDesktop && signedIn && choice === null
}

export type CockpitMachineState = 'online' | 'offline' | 'attention' | 'revoked'

export function cockpitMachineStateLabel(state: CockpitMachineState): string {
  if (state === 'online') return 'Online'
  if (state === 'offline') return 'Offline'
  if (state === 'attention') return 'Needs setup'
  return 'Revoked'
}

export function cockpitPlatformLabel(
  platform: FleetDevice['platform']
): string {
  if (platform === 'darwin') return 'Mac'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Ubuntu'
  if (platform === 'ios') return 'iPhone/iPad'
  if (platform === 'android') return 'Android'
  return 'Computer'
}

function isWorkerLike(device: FleetDevice): boolean {
  return (
    ['worker', 'hybrid'].includes(device.role) &&
    device.workerMode !== 'disabled'
  )
}

function isControllerLike(device: FleetDevice): boolean {
  return ['controller', 'hybrid'].includes(device.role)
}

/**
 * Grants that can actually authorize work right now: unattended, current,
 * unrevoked, and backed by an active controller and worker. Mirrors the
 * Fleet tab's active-grant computation.
 */
export function activeCockpitGrants(
  devices: FleetDevice[],
  grants: FleetGrant[],
  now = Date.now()
): FleetGrant[] {
  const activeControllers = new Set(
    devices
      .filter((device) => device.status === 'active' && isControllerLike(device))
      .map((device) => device.id)
  )
  const activeWorkers = new Set(
    devices
      .filter((device) => device.status === 'active' && isWorkerLike(device))
      .map((device) => device.id)
  )
  return grants.filter(
    (grant) =>
      grant.revokedAt == null &&
      grant.unattended === true &&
      grant.policyVersion === 1 &&
      grant.repositoryIdentities.length > 0 &&
      Date.parse(grant.issuedAt) <= now &&
      Date.parse(grant.expiresAt) > now &&
      activeControllers.has(grant.controllerDeviceId) &&
      activeWorkers.has(grant.workerDeviceId)
  )
}

export function cockpitGrantForDevice(
  device: FleetDevice,
  activeGrants: FleetGrant[]
): FleetGrant | null {
  return (
    activeGrants.find((grant) => grant.workerDeviceId === device.id) ?? null
  )
}

export function cockpitMachineState(
  device: FleetDevice,
  activeGrants: FleetGrant[],
  now = Date.now()
): CockpitMachineState {
  if (device.status === 'revoked') return 'revoked'
  if (!fleetDeviceIsPresent(device, now)) return 'offline'
  if (
    isWorkerLike(device) &&
    !cockpitGrantForDevice(device, activeGrants)
  ) {
    return 'attention'
  }
  return 'online'
}

/** Plain-language summary of what a machine can do. */
export function cockpitMachineCapabilities(device: FleetDevice): string[] {
  const capabilities: string[] = []
  if (isControllerLike(device)) capabilities.push('controller')
  if (device.capabilities.includes('terminal.run')) {
    capabilities.push('runs tasks')
  }
  if (device.capabilities.includes('agent.statskey')) {
    capabilities.push('intelligence tasks')
  }
  if (device.capabilities.includes('xcode.build')) {
    capabilities.push('Xcode builds')
  }
  if (device.capabilities.includes('windows.build')) {
    capabilities.push('Windows builds')
  }
  if (cockpitSupportsRemoteSession(device)) capabilities.push('remote desktop')
  return capabilities
}

/** Remote sessions are hosted by active Windows workers. */
export function cockpitSupportsRemoteSession(device: FleetDevice): boolean {
  return (
    device.platform === 'win32' &&
    device.status === 'active' &&
    isWorkerLike(device)
  )
}

/** A machine can accept a task when it is online, worker-capable, and granted. */
export function cockpitCanRunTasks(
  device: FleetDevice,
  activeGrants: FleetGrant[],
  now = Date.now()
): boolean {
  return (
    fleetDeviceIsPresent(device, now) &&
    isWorkerLike(device) &&
    device.capabilities.includes('terminal.run') &&
    device.executables.length > 0 &&
    cockpitGrantForDevice(device, activeGrants) != null
  )
}

/**
 * File browsing rides a small `node` script, so the worker must report the
 * node executable in addition to the usual task requirements.
 */
export function cockpitCanBrowseFiles(
  device: FleetDevice,
  activeGrants: FleetGrant[],
  now = Date.now()
): boolean {
  return (
    cockpitCanRunTasks(device, activeGrants, now) &&
    device.executables.some(
      (executable) => executable.toLowerCase() === 'node'
    )
  )
}

export interface CockpitCommandJobRequest {
  device: FleetDevice
  grant: FleetGrant
  objective: string
  executable: string
  arguments: string[]
  repository: string
  commit: string
  workspaceId?: string
  now?: number
  idempotencyKey?: string
}

const COCKPIT_COMMAND_REQUIREMENTS = [
  'workspace.read',
  'workspace.snapshot',
  'terminal.run',
] as const
const COCKPIT_TASK_TIMEOUT_MS = 60 * 60 * 1000
const COCKPIT_TASK_DEADLINE_MS = 2 * 60 * 60 * 1000
const COCKPIT_FILES_TIMEOUT_MS = 60_000
const COCKPIT_FILES_DEADLINE_MS = 15 * 60_000

function cockpitCommandJob({
  device,
  grant,
  objective,
  executable,
  arguments: args,
  repository,
  commit,
  workspaceId,
  timeoutMs,
  deadlineMs,
  maxAttempts,
  now = Date.now(),
  idempotencyKey = `cockpit:${crypto.randomUUID()}`,
}: CockpitCommandJobRequest & {
  timeoutMs: number
  deadlineMs: number
  maxAttempts: number
}): Omit<CreateFleetJobInput, 'controllerAuthorization'> {
  return {
    workspaceId: workspaceId || grant.workspaceIds[0] || '*',
    type: 'command',
    objective,
    workspaceSnapshot: {
      kind: 'git',
      repository,
      commit,
    },
    execution: {
      kind: 'command',
      executable,
      arguments: args,
      workingDirectory: '.',
      timeoutMs,
    },
    requiredCapabilities: [...COCKPIT_COMMAND_REQUIREMENTS],
    target: {
      deviceIds: [device.id],
      allowControllerAsWorker: device.workerMode === 'opt-in',
    },
    deadlineAt: now + deadlineMs,
    maxAttempts,
    approvalPolicy: 'independent',
    reconciliationPolicy: 'lead',
    cage: { enabled: true, maxWallTimeMs: timeoutMs },
    idempotencyKey,
  }
}

/** A friendly run-a-task job pinned to one machine. */
export function buildCockpitTaskJob(
  request: CockpitCommandJobRequest
): Omit<CreateFleetJobInput, 'controllerAuthorization'> {
  return cockpitCommandJob({
    ...request,
    timeoutMs: COCKPIT_TASK_TIMEOUT_MS,
    deadlineMs: COCKPIT_TASK_DEADLINE_MS,
    maxAttempts: 2,
  })
}

export const COCKPIT_DIRECTORY_ROOTS = [
  { id: 'workspace', label: 'Task workspace' },
  { id: 'home', label: 'Home folder' },
  { id: 'projects', label: 'Projects folder' },
] as const

export type CockpitDirectoryRootId =
  (typeof COCKPIT_DIRECTORY_ROOTS)[number]['id']

export function cockpitDirectoryRootLabel(rootId: string): string {
  return (
    COCKPIT_DIRECTORY_ROOTS.find((root) => root.id === rootId)?.label ??
    'Folder'
  )
}

/**
 * Read-only directory listing for the Cockpit files panel. Prints one JSON
 * document on stdout: folders first, depth-bounded, entry- and size-bounded
 * so the result always fits the worker's bounded stdout log event. The path
 * is confined to a named root chosen in the UI; the job environment redirects
 * HOME into the snapshot, so the real home comes from the OS user record.
 */
export const COCKPIT_DIRECTORY_LISTING_SCRIPT = [
  "const fs=require('fs');const os=require('os');const path=require('path');",
  "const rootName=String(process.argv[1]||'workspace');",
  "const relative=String(process.argv[2]||'');",
  'const MAX_ENTRIES=500;const MAX_DEPTH=2;const MAX_OUTPUT=20000;',
  'function realHome(){try{return os.userInfo().homedir||""}catch(e){return""}}',
  'const home=realHome();',
  'const roots={workspace:path.resolve("."),home:home,projects:home?path.join(home,"Projects"):""};',
  'const base=roots[rootName];',
  'if(!base){console.log(JSON.stringify({error:"unknown-root"}));process.exit(0)}',
  'const target=path.resolve(base,relative);',
  'if(target!==base&&!target.startsWith(base+path.sep)){console.log(JSON.stringify({error:"outside-root"}));process.exit(0)}',
  'const entries=[];let truncated=false;let budget=0;',
  'function walk(dir,rel,depth){',
  'if(truncated)return;',
  'let children;',
  'try{children=fs.readdirSync(dir,{withFileTypes:true})}catch(e){entries.push({path:rel||".",name:rel||".",type:"unreadable",size:null});return}',
  'children.sort((a,b)=>{const ad=a.isDirectory();const bd=b.isDirectory();if(ad!==bd)return ad?-1:1;return a.name.localeCompare(b.name)});',
  'for(const child of children){',
  'if(entries.length>=MAX_ENTRIES||budget>MAX_OUTPUT){truncated=true;break}',
  'if(child.name===".git"||child.name==="node_modules")continue;',
  'const full=path.join(dir,child.name);',
  'const childRel=rel?rel+"/"+child.name:child.name;',
  'const directory=child.isDirectory();',
  'let bytes=null;',
  'if(!directory){try{bytes=fs.statSync(full).size}catch(e){}}',
  'entries.push({path:childRel,name:child.name,type:directory?"directory":"file",size:bytes});',
  'budget+=childRel.length+40;',
  'if(directory&&depth<MAX_DEPTH)walk(full,childRel,depth+1);',
  '}',
  '}',
  'walk(target,"",1);',
  'console.log(JSON.stringify({root:rootName,truncated:truncated,entries:entries}));',
].join('\n')

export function buildCockpitDirectoryListingArgs(
  rootId: CockpitDirectoryRootId,
  relativePath = ''
): string[] {
  return ['-e', COCKPIT_DIRECTORY_LISTING_SCRIPT, '--', rootId, relativePath]
}

/** A read-only directory-listing job pinned to one machine. */
export function buildCockpitFilesJob({
  device,
  grant,
  rootId,
  relativePath = '',
  repository,
  commit,
  now,
  idempotencyKey,
}: {
  device: FleetDevice
  grant: FleetGrant
  rootId: CockpitDirectoryRootId
  relativePath?: string
  repository: string
  commit: string
  now?: number
  idempotencyKey?: string
}): Omit<CreateFleetJobInput, 'controllerAuthorization'> {
  return cockpitCommandJob({
    device,
    grant,
    objective: `List ${cockpitDirectoryRootLabel(rootId).toLowerCase()} files on ${device.label} (read-only Cockpit browse).`,
    executable: 'node',
    arguments: buildCockpitDirectoryListingArgs(rootId, relativePath),
    repository,
    commit,
    timeoutMs: COCKPIT_FILES_TIMEOUT_MS,
    deadlineMs: COCKPIT_FILES_DEADLINE_MS,
    maxAttempts: 1,
    now,
    idempotencyKey,
  })
}

export interface CockpitDirectoryEntry {
  path: string
  name: string
  type: 'directory' | 'file' | 'unreadable'
  size: number | null
  depth: number
}

export interface CockpitDirectoryListing {
  entries: CockpitDirectoryEntry[]
  truncated: boolean
  error: string | null
}

/** Extracts the listing document from a worker's stdout. */
export function parseCockpitDirectoryListing(
  stdout: string
): CockpitDirectoryListing | null {
  const lines = stdout.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue
    }
    const record = parsed as Record<string, unknown>
    if (typeof record.error === 'string') {
      return { entries: [], truncated: false, error: record.error }
    }
    if (!Array.isArray(record.entries)) continue
    const entries: CockpitDirectoryEntry[] = []
    for (const item of record.entries) {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) {
        continue
      }
      const entry = item as Record<string, unknown>
      if (typeof entry.path !== 'string' || typeof entry.name !== 'string') {
        continue
      }
      const type =
        entry.type === 'directory' || entry.type === 'unreadable'
          ? entry.type
          : 'file'
      entries.push({
        path: entry.path,
        name: entry.name,
        type,
        size:
          typeof entry.size === 'number' && Number.isFinite(entry.size)
            ? entry.size
            : null,
        depth: entry.path.split('/').length - 1,
      })
    }
    return {
      entries,
      truncated: record.truncated === true,
      error: null,
    }
  }
  return null
}

/** Concatenates stdout chunks from a job's event stream, in order. */
export function cockpitJobStdout(events: FleetJobEvent[]): string {
  const chunks: string[] = []
  for (const event of events) {
    if (event.payload == null || typeof event.payload !== 'object') continue
    const payload = event.payload as Record<string, unknown>
    if (event.type === 'log') {
      if (payload.stream === 'stdout' && typeof payload.chunk === 'string') {
        chunks.push(payload.chunk)
      } else if (typeof payload.stdout === 'string') {
        chunks.push(payload.stdout)
      } else if (typeof payload.text === 'string') {
        chunks.push(payload.text)
      }
    }
    if (event.type === 'result' && typeof payload.stdout === 'string') {
      chunks.push(payload.stdout)
    }
  }
  return chunks.join('')
}

/** The ten most recently updated jobs, for the activity strip. */
export function cockpitRecentActivity(
  jobs: FleetJob[],
  limit = 10
): FleetJob[] {
  return [...jobs]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
}

export function cockpitRelativeTime(
  value: string | null,
  now = Date.now()
): string {
  if (!value) return 'Never seen'
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return 'Unknown time'
  const elapsed = now - millis
  if (Math.abs(elapsed) < 60_000) return 'Just now'
  const minutes = Math.round(Math.abs(elapsed) / 60_000)
  if (minutes < 60) return `${minutes}m ${elapsed >= 0 ? 'ago' : 'from now'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ${elapsed >= 0 ? 'ago' : 'from now'}`
  const days = Math.round(hours / 24)
  return `${days}d ${elapsed >= 0 ? 'ago' : 'from now'}`
}

export function cockpitFormatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return ''
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024))
  )
  return `${(value / 1024 ** exponent).toFixed(exponent >= 3 ? 1 : 0)} ${
    units[exponent]
  }`
}
