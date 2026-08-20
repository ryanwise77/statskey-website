import { describe, expect, it } from 'vitest'
import {
  canCancelFleetJob,
  fleetDeviceCanRunGrantedJob,
  fleetDeviceIsPresent,
  fleetRepositoryIdentity,
  isTerminalFleetJob,
  type FleetDevice,
  type FleetGrant,
  type FleetJob,
} from './types'

const NOW = Date.parse('2026-08-19T05:00:00.000Z')

describe('fleet state helpers', () => {
  it('treats every completed outcome as terminal', () => {
    for (const state of ['succeeded', 'failed', 'cancelled', 'timed_out'] as const) {
      expect(isTerminalFleetJob({ state })).toBe(true)
      expect(
        canCancelFleetJob({ state, cancellationRequestedAt: null })
      ).toBe(false)
    }
    expect(isTerminalFleetJob({ state: 'running' })).toBe(false)
  })

  it('allows cancellation only before a request or terminal state', () => {
    expect(
      canCancelFleetJob({ state: 'running', cancellationRequestedAt: null })
    ).toBe(true)
    expect(
      canCancelFleetJob({
        state: 'running',
        cancellationRequestedAt: '2026-08-19T05:00:00.000Z',
      })
    ).toBe(false)
  })

  it('derives presence from server heartbeat time and revocation', () => {
    const device: Pick<FleetDevice, 'status' | 'lastSeenAt'> = {
      status: 'active',
      lastSeenAt: new Date(NOW - 89_999).toISOString(),
    }
    expect(fleetDeviceIsPresent(device, NOW)).toBe(true)
    expect(
      fleetDeviceIsPresent(
        { ...device, lastSeenAt: new Date(NOW - 90_001).toISOString() },
        NOW
      )
    ).toBe(false)
    expect(
      fleetDeviceIsPresent({ ...device, status: 'revoked' }, NOW)
    ).toBe(false)
    expect(
      fleetDeviceIsPresent({ ...device, lastSeenAt: 'not-a-time' }, NOW)
    ).toBe(false)
  })

  it('offers jobs only to live devices with a matching unattended grant', () => {
    const device: FleetDevice = {
      id: `dev_${'a'.repeat(32)}`,
      schemaVersion: 1,
      label: 'Mac worker',
      role: 'worker',
      workerMode: 'dedicated',
      platform: 'darwin',
      status: 'active',
      capabilities: ['workspace.read', 'workspace.snapshot', 'xcode.test'],
      executables: [],
      resources: {
        cpuLogical: 8,
        cpuAvailable: 8,
        memoryBytes: 16_000_000_000,
        memoryAvailableBytes: 12_000_000_000,
        diskAvailableBytes: 100_000_000_000,
        gpuCount: 0,
      },
      activeJobs: 0,
      maxConcurrentJobs: 1,
      connection: 'direct',
      protocolMinimum: 1,
      protocolMaximum: 1,
      softwareVersion: '1.0.0',
      lastSeenAt: new Date(NOW).toISOString(),
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    }
    const grant: FleetGrant = {
      id: `grant_${'b'.repeat(32)}`,
      ownerUid: 'owner',
      controllerDeviceId: `dev_${'c'.repeat(32)}`,
      workerDeviceId: device.id,
      workspaceIds: ['statskey-website'],
      repositoryIdentities: ['github.com/statskey/website'],
      capabilities: ['workspace.read', 'workspace.snapshot', 'xcode.test'],
      unattended: true,
      policyVersion: 1,
      issuedAt: new Date(NOW - 1_000).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revokedAt: null,
    }
    const required = [
      'workspace.read',
      'workspace.snapshot',
      'xcode.test',
    ] as const
    expect(
      fleetDeviceCanRunGrantedJob(
        device,
        [grant],
        [...required],
        'statskey-website',
        'github.com/statskey/website',
        NOW,
        ''
      )
    ).toBe(true)
    expect(
      fleetDeviceCanRunGrantedJob(
        device,
        [grant],
        [...required],
        'another-workspace',
        'github.com/statskey/website',
        NOW
      )
    ).toBe(false)
    expect(
      fleetDeviceCanRunGrantedJob(
        { ...device, lastSeenAt: new Date(NOW - 90_001).toISOString() },
        [grant],
        [...required],
        'statskey-website',
        'github.com/statskey/website',
        NOW
      )
    ).toBe(false)
    expect(
      fleetDeviceCanRunGrantedJob(
        device,
        [{ ...grant, revokedAt: new Date(NOW).toISOString() }],
        [...required],
        'statskey-website',
        'github.com/statskey/website',
        NOW
      )
    ).toBe(false)
    const commandDevice: FleetDevice = {
      ...device,
      capabilities: ['workspace.read', 'workspace.snapshot', 'terminal.run'],
      executables: ['node'],
    }
    const commandGrant: FleetGrant = {
      ...grant,
      capabilities: ['workspace.read', 'workspace.snapshot', 'terminal.run'],
    }
    expect(
      fleetDeviceCanRunGrantedJob(
        commandDevice,
        [commandGrant],
        ['workspace.read', 'workspace.snapshot', 'terminal.run'],
        'statskey-website',
        'github.com/statskey/website',
        NOW,
        'node'
      )
    ).toBe(true)
    expect(
      fleetDeviceCanRunGrantedJob(
        commandDevice,
        [commandGrant],
        ['workspace.read', 'workspace.snapshot', 'terminal.run'],
        'statskey-website',
        'github.com/statskey/website',
        NOW,
        'npm'
      )
    ).toBe(false)
  })

  it('keeps state helpers structurally usable by partial job views', () => {
    const partial: Pick<FleetJob, 'state' | 'cancellationRequestedAt'> = {
      state: 'queued',
      cancellationRequestedAt: null,
    }
    expect(canCancelFleetJob(partial)).toBe(true)
  })

  it('canonicalizes supported repository URL forms', () => {
    expect(fleetRepositoryIdentity('StatsKey/Website.git')).toBe(
      'github.com/statskey/website'
    )
    expect(
      fleetRepositoryIdentity('git@github.com:StatsKey/Website.git')
    ).toBe('github.com/statskey/website')
    expect(
      fleetRepositoryIdentity('https://github.com/StatsKey/Website.git')
    ).toBe('github.com/statskey/website')
    expect(
      fleetRepositoryIdentity('https://user:secret@github.com/StatsKey/Website')
    ).toBeNull()
    expect(
      fleetRepositoryIdentity('https://gitlab.com/StatsKey/Website.git')
    ).toBeNull()
    expect(
      fleetRepositoryIdentity(
        'https://github.com/evil/%2e%2e/StatsKey/Website'
      )
    ).toBeNull()
    expect(
      fleetRepositoryIdentity('https://github.com/evil/../StatsKey/Website')
    ).toBeNull()
    expect(
      fleetRepositoryIdentity(
        'https://github.com/evil\\..\\StatsKey\\Website'
      )
    ).toBeNull()
    expect(
      fleetRepositoryIdentity('https://github.com/StatsKey/\tWebsite')
    ).toBeNull()
    expect(
      fleetRepositoryIdentity('https://github.com/StatsKey/\nWebsite')
    ).toBeNull()
    expect(
      fleetRepositoryIdentity('https://github.com/StatsKey/\rWebsite')
    ).toBeNull()
  })
})
