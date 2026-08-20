// The app tsconfig pins browser types only; these node builtins run under
// vitest. Suppress per-line instead of widening the project's global types.
// @ts-expect-error -- node builtin, untyped in this project
import { execFileSync } from 'node:child_process'
// @ts-expect-error -- node builtin, untyped in this project
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
// @ts-expect-error -- node builtin, untyped in this project
import { tmpdir } from 'node:os'
// @ts-expect-error -- node builtin, untyped in this project
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// File-scoped stand-in for the node process global under vitest.
declare const process: { execPath: string }
import {
  COCKPIT_ONBOARDING_STORAGE_KEY,
  activeCockpitGrants,
  buildCockpitDirectoryListingArgs,
  buildCockpitFilesJob,
  buildCockpitTaskJob,
  cockpitCanBrowseFiles,
  cockpitCanRunTasks,
  cockpitJobStdout,
  cockpitMachineCapabilities,
  cockpitMachineState,
  cockpitRecentActivity,
  cockpitSupportsRemoteSession,
  loadCockpitOnboardingChoice,
  parseCockpitDirectoryListing,
  saveCockpitOnboardingChoice,
  shouldShowCockpitOnboarding,
} from './cockpit'
import type {
  FleetDevice,
  FleetGrant,
  FleetJob,
  FleetJobEvent,
} from './fleet/types'

const NOW = Date.parse('2026-08-20T15:00:00.000Z')
const CONTROLLER_ID = 'dev_cccccccccccccccccccccccccccccccccc' as const
const WORKER_ID = 'dev_wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww' as const
const COMMIT = 'c'.repeat(40)

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function device(overrides: Partial<FleetDevice> = {}): FleetDevice {
  return {
    id: WORKER_ID,
    schemaVersion: 1,
    label: 'Office PC',
    role: 'worker',
    workerMode: 'dedicated',
    platform: 'win32',
    status: 'active',
    capabilities: ['workspace.read', 'workspace.snapshot', 'terminal.run'],
    executables: ['node', 'npm'],
    resources: {
      cpuLogical: 8,
      cpuAvailable: 8,
      memoryBytes: 16 * 1024 ** 3,
      memoryAvailableBytes: 8 * 1024 ** 3,
      diskAvailableBytes: 100 * 1024 ** 3,
      gpuCount: 0,
    },
    activeJobs: 0,
    maxConcurrentJobs: 1,
    connection: 'direct',
    protocolMinimum: 1,
    protocolMaximum: 1,
    softwareVersion: '0.21.10',
    lastSeenAt: new Date(NOW - 30_000).toISOString(),
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function controller(overrides: Partial<FleetDevice> = {}): FleetDevice {
  return device({
    id: CONTROLLER_ID,
    label: 'This Mac',
    role: 'hybrid',
    workerMode: 'opt-in',
    platform: 'darwin',
    ...overrides,
  })
}

function grant(overrides: Partial<FleetGrant> = {}): FleetGrant {
  return {
    id: 'grant_gggggggggggggggggggggggggggggggg',
    ownerUid: 'user',
    controllerDeviceId: CONTROLLER_ID,
    workerDeviceId: WORKER_ID,
    workspaceIds: ['statskey-website'],
    repositoryIdentities: ['github.com/ryanwise77/statskey-website'],
    capabilities: ['workspace.read', 'workspace.snapshot', 'terminal.run'],
    unattended: true,
    policyVersion: 1,
    issuedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    revokedAt: null,
    ...overrides,
  }
}

function job(overrides: Partial<FleetJob> = {}): FleetJob {
  return {
    id: 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    updatedAt: new Date(NOW - 5_000).toISOString(),
    ...overrides,
  } as FleetJob
}

describe('cockpit machine state', () => {
  it('reports revoked machines plainly', () => {
    const machine = device({ status: 'revoked' })
    expect(cockpitMachineState(machine, [], NOW)).toBe('revoked')
  })

  it('reports stale machines as offline', () => {
    const machine = device({
      lastSeenAt: new Date(NOW - 10 * 60_000).toISOString(),
    })
    expect(cockpitMachineState(machine, [grant()], NOW)).toBe('offline')
  })

  it('flags an online worker without an active grant as needing setup', () => {
    const machine = device()
    expect(cockpitMachineState(machine, [], NOW)).toBe('attention')
    expect(cockpitMachineState(machine, [grant()], NOW)).toBe('online')
  })

  it('does not flag controller-only machines for missing worker grants', () => {
    const machine = controller({ workerMode: 'disabled' })
    expect(cockpitMachineState(machine, [], NOW)).toBe('online')
  })

  it('flags an opt-in hybrid without a grant as needing setup', () => {
    expect(cockpitMachineState(controller(), [], NOW)).toBe('attention')
  })
})

describe('cockpit capabilities and action gating', () => {
  it('describes machines in plain language', () => {
    expect(cockpitMachineCapabilities(device())).toEqual([
      'runs tasks',
      'remote desktop',
    ])
    expect(
      cockpitMachineCapabilities(
        controller({ capabilities: ['workspace.read'] })
      )
    ).toEqual(['controller'])
  })

  it('offers remote sessions only for active Windows workers', () => {
    expect(cockpitSupportsRemoteSession(device())).toBe(true)
    expect(cockpitSupportsRemoteSession(device({ platform: 'darwin' }))).toBe(
      false
    )
    expect(cockpitSupportsRemoteSession(device({ status: 'revoked' }))).toBe(
      false
    )
    expect(
      cockpitSupportsRemoteSession(device({ workerMode: 'disabled' }))
    ).toBe(false)
    expect(cockpitSupportsRemoteSession(controller())).toBe(false)
  })

  it('runs tasks only on online, granted, capable workers', () => {
    const machine = device()
    const granted = [grant()]
    expect(cockpitCanRunTasks(machine, granted, NOW)).toBe(true)
    expect(cockpitCanRunTasks(machine, [], NOW)).toBe(false)
    expect(
      cockpitCanRunTasks(
        device({ lastSeenAt: new Date(NOW - 10 * 60_000).toISOString() }),
        granted,
        NOW
      )
    ).toBe(false)
    expect(
      cockpitCanRunTasks(
        device({ capabilities: ['workspace.read'] }),
        granted,
        NOW
      )
    ).toBe(false)
    expect(cockpitCanRunTasks(device({ executables: [] }), granted, NOW)).toBe(
      false
    )
    expect(
      cockpitCanRunTasks(
        machine,
        activeCockpitGrants(
          [machine, controller()],
          [grant({ expiresAt: new Date(NOW - 1_000).toISOString() })],
          NOW
        ),
        NOW
      )
    ).toBe(false)
  })

  it('browses files only when the worker allows node', () => {
    expect(cockpitCanBrowseFiles(device(), [grant()], NOW)).toBe(true)
    expect(
      cockpitCanBrowseFiles(device({ executables: ['npm'] }), [grant()], NOW)
    ).toBe(false)
  })

  it('keeps grants unusable when their controller is gone', () => {
    const devices = [device()]
    expect(activeCockpitGrants(devices, [grant()], NOW)).toHaveLength(0)
    expect(
      activeCockpitGrants([...devices, controller()], [grant()], NOW)
    ).toHaveLength(1)
  })
})

describe('cockpit job builders', () => {
  it('pins a task to the chosen machine with the command contract', () => {
    const machine = device()
    const input = buildCockpitTaskJob({
      device: machine,
      grant: grant(),
      objective: 'Run the test suite.',
      executable: 'npm',
      arguments: ['test', '--', '--runInBand'],
      repository: 'github.com/ryanwise77/statskey-website',
      commit: COMMIT,
      now: NOW,
      idempotencyKey: 'cockpit:test:001',
    })
    expect(input.type).toBe('command')
    expect(input.target).toEqual({
      deviceIds: [WORKER_ID],
      allowControllerAsWorker: false,
    })
    expect(input.execution).toEqual({
      kind: 'command',
      executable: 'npm',
      arguments: ['test', '--', '--runInBand'],
      workingDirectory: '.',
      timeoutMs: 60 * 60 * 1000,
    })
    expect(input.requiredCapabilities).toEqual([
      'workspace.read',
      'workspace.snapshot',
      'terminal.run',
    ])
    expect(input.workspaceId).toBe('statskey-website')
    expect(input.workspaceSnapshot).toEqual({
      kind: 'git',
      repository: 'github.com/ryanwise77/statskey-website',
      commit: COMMIT,
    })
    expect(input.idempotencyKey).toBe('cockpit:test:001')
  })

  it('lets an opt-in controller run its own tasks', () => {
    const machine = controller()
    const input = buildCockpitTaskJob({
      device: machine,
      grant: grant({ workerDeviceId: CONTROLLER_ID }),
      objective: 'Build locally.',
      executable: 'make',
      arguments: [],
      repository: 'github.com/ryanwise77/statskey-website',
      commit: COMMIT,
      now: NOW,
      idempotencyKey: 'cockpit:test:002',
    })
    expect(input.target?.allowControllerAsWorker).toBe(true)
  })

  it('builds a single-attempt read-only listing job for the files panel', () => {
    const input = buildCockpitFilesJob({
      device: device(),
      grant: grant(),
      rootId: 'projects',
      relativePath: 'StatsKey',
      repository: 'github.com/ryanwise77/statskey-website',
      commit: COMMIT,
      now: NOW,
      idempotencyKey: 'cockpit:files:001',
    })
    expect(input.maxAttempts).toBe(1)
    expect(input.execution?.kind).toBe('command')
    if (input.execution?.kind === 'command') {
      const args = input.execution.arguments ?? []
      expect(input.execution.executable).toBe('node')
      expect(args[0]).toBe('-e')
      expect(args[2]).toBe('--')
      expect(args[3]).toBe('projects')
      expect(args[4]).toBe('StatsKey')
    }
    expect(input.objective).toContain('read-only')
  })

  it('passes the chosen root and subfolder as separate arguments', () => {
    expect(buildCockpitDirectoryListingArgs('home', 'Documents/Work')).toEqual([
      '-e',
      expect.any(String),
      '--',
      'home',
      'Documents/Work',
    ])
  })
})

describe('cockpit directory listing script', () => {
  let fixture: string

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'statskey-cockpit-'))
    mkdirSync(join(fixture, 'alpha', 'nested'), { recursive: true })
    mkdirSync(join(fixture, 'beta'))
    writeFileSync(join(fixture, 'alpha', 'one.txt'), 'one')
    writeFileSync(join(fixture, 'alpha', 'nested', 'two.txt'), 'two')
    writeFileSync(join(fixture, 'readme.md'), 'readme')
  })

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true })
  })

  function runListing(args: string[]): string {
    return execFileSync(
      process.execPath,
      ['-e', buildCockpitDirectoryListingArgs('workspace')[1], '--', ...args],
      { cwd: fixture, encoding: 'utf8', timeout: 15_000 }
    )
  }

  it('lists folders first with bounded depth', () => {
    const listing = parseCockpitDirectoryListing(runListing(['workspace']))
    expect(listing).not.toBeNull()
    expect(listing?.error).toBeNull()
    // Depth 2: children and grandchildren are listed, but a grandchild
    // folder is not expanded.
    const paths = listing?.entries.map((entry) => entry.path) ?? []
    expect(paths).toEqual([
      'alpha',
      'alpha/nested',
      'alpha/one.txt',
      'beta',
      'readme.md',
    ])
    expect(
      listing?.entries.find((entry) => entry.path === 'alpha')?.type
    ).toBe('directory')
    expect(
      listing?.entries.find((entry) => entry.path === 'readme.md')?.size
    ).toBe(6)
    expect(
      listing?.entries.find((entry) => entry.path === 'alpha/nested')?.depth
    ).toBe(1)
  })

  it('descends into a subfolder within the chosen root', () => {
    const listing = parseCockpitDirectoryListing(
      runListing(['workspace', 'alpha'])
    )
    // Depth is relative to the browsed folder: two levels from alpha.
    expect(listing?.entries.map((entry) => entry.path)).toEqual([
      'nested',
      'nested/two.txt',
      'one.txt',
    ])
  })

  it('refuses to leave the chosen root', () => {
    const listing = parseCockpitDirectoryListing(
      runListing(['workspace', '..'])
    )
    expect(listing?.error).toBe('outside-root')
  })

  it('rejects an unknown root', () => {
    const listing = parseCockpitDirectoryListing(runListing(['elsewhere']))
    expect(listing?.error).toBe('unknown-root')
  })
})

describe('cockpit directory listing parsing', () => {
  it('reads the last JSON document after noisy output', () => {
    const stdout = [
      'some warning line',
      '{"root":"home","truncated":false,"entries":[{"path":"Projects","name":"Projects","type":"directory","size":null}]}',
      '',
    ].join('\n')
    const listing = parseCockpitDirectoryListing(stdout)
    expect(listing?.entries).toEqual([
      {
        path: 'Projects',
        name: 'Projects',
        type: 'directory',
        size: null,
        depth: 0,
      },
    ])
  })

  it('returns null when no listing document is present', () => {
    expect(parseCockpitDirectoryListing('')).toBeNull()
    expect(parseCockpitDirectoryListing('not json\n{"other":true}')).toBeNull()
  })
})

describe('cockpit job output', () => {
  function event(
    type: FleetJobEvent['type'],
    payload: unknown,
    sequence: number
  ): FleetJobEvent {
    return {
      schemaVersion: 1,
      jobId: 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      deviceId: WORKER_ID,
      attempt: 1,
      sequence,
      type,
      payload,
      occurredAt: new Date(NOW).toISOString(),
    }
  }

  it('concatenates stdout log chunks in order', () => {
    const stdout = cockpitJobStdout([
      event('accepted', { workerDeviceId: WORKER_ID }, 1),
      event('log', { stream: 'stdout', chunk: 'first\n' }, 2),
      event('log', { stream: 'stderr', chunk: 'ignored\n' }, 3),
      event('log', { stream: 'stdout', chunk: 'second\n' }, 4),
      event('process-exit', { exitCode: 0 }, 5),
    ])
    expect(stdout).toBe('first\nsecond\n')
  })

  it('tolerates result-carried output and missing payloads', () => {
    const stdout = cockpitJobStdout([
      event('log', null, 1),
      event('result', { summary: 'done', stdout: 'tail' }, 2),
    ])
    expect(stdout).toBe('tail')
  })
})

describe('cockpit recent activity', () => {
  it('keeps the ten most recently updated jobs', () => {
    const jobs = Array.from({ length: 14 }, (_, index) =>
      job({
        id: `job_${String(index).padStart(32, '0')}` as `job_${string}`,
        updatedAt: new Date(NOW - index * 60_000).toISOString(),
      })
    )
    const activity = cockpitRecentActivity(jobs)
    expect(activity).toHaveLength(10)
    expect(activity[0].id).toBe(`job_${'0'.repeat(32)}`)
    expect(
      Date.parse(activity[0].updatedAt) >=
        Date.parse(activity[activity.length - 1].updatedAt)
    ).toBe(true)
  })
})

describe('cockpit onboarding choice', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
  })

  it('shows once for a signed-in desktop user who has never chosen', () => {
    const storage = new MemoryStorage()
    expect(loadCockpitOnboardingChoice(storage)).toBeNull()
    expect(
      shouldShowCockpitOnboarding({
        isDesktop: true,
        signedIn: true,
        choice: loadCockpitOnboardingChoice(storage),
      })
    ).toBe(true)
  })

  it('persists the choice and never re-shows', () => {
    const storage = new MemoryStorage()
    saveCockpitOnboardingChoice('notNow', storage)
    expect(storage.getItem(COCKPIT_ONBOARDING_STORAGE_KEY)).toBe('notNow')
    expect(loadCockpitOnboardingChoice(storage)).toBe('notNow')
    expect(
      shouldShowCockpitOnboarding({
        isDesktop: true,
        signedIn: true,
        choice: loadCockpitOnboardingChoice(storage),
      })
    ).toBe(false)

    saveCockpitOnboardingChoice('enabled', storage)
    expect(loadCockpitOnboardingChoice(storage)).toBe('enabled')
    expect(
      shouldShowCockpitOnboarding({
        isDesktop: true,
        signedIn: true,
        choice: loadCockpitOnboardingChoice(storage),
      })
    ).toBe(false)
  })

  it('never shows on the web or when signed out', () => {
    expect(
      shouldShowCockpitOnboarding({
        isDesktop: false,
        signedIn: true,
        choice: null,
      })
    ).toBe(false)
    expect(
      shouldShowCockpitOnboarding({
        isDesktop: true,
        signedIn: false,
        choice: null,
      })
    ).toBe(false)
  })

  it('restores the desktop durable copy over an empty browser value', () => {
    const durable = new Map([[COCKPIT_ONBOARDING_STORAGE_KEY, 'enabled']])
    vi.stubGlobal('window', {
      statsKeyDesktop: {
        setBadge() {},
        openExternal: async () => true,
        onSummon: () => () => {},
        workspace: { readFile: async () => null },
        providers: { getStatus: async () => [] },
        preferences: { get: async () => ({}) },
        mcp: { tools: async () => [] },
        durableState: {
          get: (key: string) => durable.get(key) ?? null,
          set: (key: string, value: string | null) => {
            if (value === null) durable.delete(key)
            else durable.set(key, value)
            return true
          },
        },
      },
    })
    const storage = new MemoryStorage()
    expect(loadCockpitOnboardingChoice(storage)).toBe('enabled')
    expect(storage.getItem(COCKPIT_ONBOARDING_STORAGE_KEY)).toBe('enabled')
  })
})
