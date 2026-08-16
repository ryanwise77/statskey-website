import { describe, expect, it } from 'vitest'
import { statusSummary } from './RemoteAccessCoordinator'

describe('remote infrastructure status summaries', () => {
  it('reports MacRemote readiness without exposing addresses', () => {
    const summary = statusSummary(
      'mac-mini',
      {
        available: true,
        services: {
          macMini: {
            label: 'Mac mini',
            host: 'private.example',
            sshPort: 48222,
            screenPort: 5900,
            sshOnline: true,
            screenOnline: false,
          },
        },
        readiness: {
          macRemoteExecutable: {
            path: '/private/tool',
            available: true,
            kind: 'file',
          },
          macRemoteConfig: {
            path: '/private/config',
            available: true,
            kind: 'file',
          },
        },
      },
      { ok: true }
    )
    expect(summary).toContain('MacRemote is configured')
    expect(summary).toContain('Encrypted remote SSH is reachable')
    expect(summary).not.toContain('private.example')
    expect(summary).not.toContain('/private/')
  })

  it('reports failed encrypted reachability without leaking diagnostics', () => {
    const summary = statusSummary(
      'mac-mini',
      {
        available: true,
        readiness: {
          macRemoteExecutable: {
            path: '/private/tool',
            available: true,
            kind: 'file',
          },
          macRemoteConfig: {
            path: '/private/config',
            available: true,
            kind: 'file',
          },
        },
      },
      { ok: false, error: 'secret.onion was unreachable' }
    )
    expect(summary).toContain('Encrypted remote SSH is not reachable right now')
    expect(summary).not.toContain('secret.onion')
  })

  it('summarizes data-center services as booleans only', () => {
    const summary = statusSummary('data-center', {
      available: true,
      services: {
        trueNas: {
          label: 'TrueNAS',
          host: '192.168.50.10',
          port: 443,
          online: true,
          url: 'https://192.168.50.10',
        },
        idrac: {
          label: 'iDRAC',
          host: '192.168.50.11',
          port: 443,
          online: true,
          url: 'https://192.168.50.11',
        },
        gpu: {
          label: 'RTX',
          host: null,
          port: 22,
          configured: false,
          online: false,
        },
      },
      storage: {
        path: '/Volumes/StatsKey-Oil',
        mounted: false,
        totalBytes: null,
        freeBytes: null,
        freeRatio: null,
        reserveHealthy: false,
      },
    })
    expect(summary).toContain('TrueNAS is online')
    expect(summary).toContain('GPU workstation is not configured')
    expect(summary).not.toContain('192.168')
  })
})
