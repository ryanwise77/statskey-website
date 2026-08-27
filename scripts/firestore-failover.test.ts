import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  configuredEmergencyEndpoint,
  currentMirrorHealth,
  currentMode,
  EMERGENCY_ORIGIN_KEY,
  parseEmergencyEndpoint,
  parseMirrorHealth,
  startFailoverController,
  type FailoverController,
  type MirrorHealth,
} from '../src/app/lib/firestoreFailover.ts'

const NOW = Date.parse('2026-08-25T20:00:00.000Z')
const controllers: FailoverController[] = []

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  }
}

function health(overrides: Partial<MirrorHealth> = {}): MirrorHealth {
  return {
    checkedAt: '2026-08-25T20:00:00.000Z',
    lastMutationAt: '2026-08-25T19:59:50.000Z',
    lastVerifiedAt: '2026-08-25T19:59:50.000Z',
    lagSeconds: 10,
    maxLagSeconds: 120,
    writable: true,
    ...overrides,
  }
}

function gatewayHealth(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'ready',
    mode: 'standby',
    writable: true,
    checkedAt: '2026-08-25T20:00:00.000Z',
    mirror: {
      reachable: true,
      lastMutationAt: '2026-08-25T19:59:50.000Z',
      lastVerifiedAt: '2026-08-25T19:59:50.000Z',
      lagSeconds: 10,
      maxLagSeconds: 120,
      fresh: true,
    },
    auth: { reachable: true, issuer: 'https://auth.statskey.ai' },
    functions: { reachable: true },
    routes: { firestore: '/', functions: '/functions' },
    ...overrides,
  }
}

function start(options: {
  storage?: ReturnType<typeof fakeStorage>
  google: () => boolean
  mirror?: () => MirrorHealth | null
  reload?: () => void
  onHealth?: (value: MirrorHealth | null) => void
}) {
  const storage =
    options.storage ?? fakeStorage({ [EMERGENCY_ORIGIN_KEY]: 'https://emergency.example.com' })
  const controller = startFailoverController({
    storage,
    probe: async () => options.google(),
    probeMirror: async () => (options.mirror ? options.mirror() : health()),
    reload: options.reload ?? (() => {}),
    onMirrorHealth: options.onHealth,
    now: () => NOW,
    runImmediately: false,
    intervalMs: 1_000_000,
  })
  controllers.push(controller)
  return { storage, controller }
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop()
})

describe('emergency endpoint provisioning', () => {
  it('keeps failover disabled when no endpoint is provisioned', async () => {
    const storage = fakeStorage()
    let probes = 0
    const controller = startFailoverController({
      storage,
      probe: async () => {
        probes += 1
        return false
      },
      runImmediately: false,
      configuredBuildOrigin: '',
    })
    controllers.push(controller)

    assert.equal(controller.enabled, false)
    await controller.tick()
    assert.equal(probes, 0)
    assert.equal(currentMode(storage, ''), 'primary')
  })

  it('normalizes HTTPS and private LAN origins without a baked-in default', () => {
    assert.deepEqual(parseEmergencyEndpoint('https://emergency.statskey.ai/'), {
      origin: 'https://emergency.statskey.ai',
      host: 'emergency.statskey.ai',
      ssl: true,
      healthUrl:
        'https://emergency.statskey.ai/.well-known/statskey-emergency-health',
    })
    assert.equal(parseEmergencyEndpoint('http://203.0.113.8:8380'), null)
    assert.equal(parseEmergencyEndpoint('https://user:pass@example.com'), null)
    assert.equal(parseEmergencyEndpoint('https://example.com/firestore'), null)
  })

  it('parses LAN IPv4, DNS, and bracketed IPv6 authorities correctly', () => {
    assert.equal(parseEmergencyEndpoint('http://10.2.3.4:8380')?.host, '10.2.3.4:8380')
    assert.equal(
      parseEmergencyEndpoint('http://statskey-server.local:8380')?.host,
      'statskey-server.local:8380'
    )
    const ipv6 = parseEmergencyEndpoint('http://[fd00::1234]:8380')
    assert.equal(ipv6?.origin, 'http://[fd00::1234]:8380')
    assert.equal(ipv6?.host, '[fd00::1234]:8380')
  })

  it('allows only public HTTPS origins in build-time provisioning', () => {
    assert.equal(
      configuredEmergencyEndpoint(fakeStorage(), 'https://emergency.statskey.ai')?.host,
      'emergency.statskey.ai'
    )
    assert.equal(configuredEmergencyEndpoint(fakeStorage(), 'http://10.0.0.5:8380'), null)
    assert.equal(configuredEmergencyEndpoint(fakeStorage(), 'https://server.local'), null)
  })

  it('keeps explicitly provisioned legacy LAN host:port installations working', () => {
    const storage = fakeStorage({ 'statskey.mirrorHost': '[fd00::5]:8380' })
    assert.equal(configuredEmergencyEndpoint(storage, '')?.host, '[fd00::5]:8380')
  })
})

describe('mirror health and freshness', () => {
  it('accepts the v1 gateway health contract', () => {
    assert.deepEqual(parseMirrorHealth(gatewayHealth(), NOW), health())
  })

  it('accepts a minimal compatible LAN health response', () => {
    assert.deepEqual(
      parseMirrorHealth(
        {
          status: 'ok',
          healthy: true,
          updatedAt: '2026-08-25T19:59:30.000Z',
          writable: false,
        },
        NOW
      ),
      {
        checkedAt: '2026-08-25T20:00:00.000Z',
        lastMutationAt: '2026-08-25T19:59:30.000Z',
        lastVerifiedAt: '2026-08-25T19:59:30.000Z',
        lagSeconds: 30,
        maxLagSeconds: 300,
        writable: false,
      }
    )
  })

  it('does not confuse an idle user with a stale replication heartbeat', () => {
    assert.ok(
      parseMirrorHealth(
        gatewayHealth({
          mirror: {
            ...gatewayHealth().mirror,
            lastMutationAt: '2026-08-20T12:00:00.000Z',
          },
        }),
        NOW
      )
    )
  })

  it('rejects unreachable, explicitly stale, old, and inconsistent health', () => {
    assert.equal(
      parseMirrorHealth(
        gatewayHealth({ mirror: { ...gatewayHealth().mirror, reachable: false } }),
        NOW
      ),
      null
    )
    assert.equal(
      parseMirrorHealth(
        gatewayHealth({ mirror: { ...gatewayHealth().mirror, fresh: false } }),
        NOW
      ),
      null
    )
    assert.equal(
      parseMirrorHealth(
        gatewayHealth({
          mirror: {
            ...gatewayHealth().mirror,
            lastVerifiedAt: '2026-08-25T19:50:00.000Z',
            lagSeconds: 1,
          },
        }),
        NOW
      ),
      null
    )
    assert.equal(
      parseMirrorHealth(gatewayHealth({ checkedAt: '2026-08-25T19:54:59.000Z' }), NOW),
      null
    )
    assert.equal(
      parseMirrorHealth(gatewayHealth({ routes: { firestore: '/firestore' } }), NOW),
      null
    )
    assert.equal(
      parseMirrorHealth(
        gatewayHealth({ routes: { firestore: '/', functions: '/wrong-functions' } }),
        NOW
      ),
      null
    )
    assert.equal(parseMirrorHealth(gatewayHealth({ auth: undefined }), NOW), null)
    assert.equal(
      parseMirrorHealth(
        gatewayHealth({
          auth: { reachable: false, issuer: 'https://auth.statskey.ai' },
        }),
        NOW
      ),
      null
    )
    assert.equal(
      parseMirrorHealth(
        gatewayHealth({
          auth: { reachable: true, issuer: 'https://wrong-issuer.example' },
        }),
        NOW
      ),
      null
    )
    assert.equal(parseMirrorHealth(gatewayHealth({ functions: undefined }), NOW), null)
    assert.equal(
      parseMirrorHealth(gatewayHealth({ functions: { reachable: false } }), NOW),
      null
    )
    assert.equal(parseMirrorHealth(gatewayHealth({ writable: undefined }), NOW), null)
    assert.equal(parseMirrorHealth(gatewayHealth({ mode: 'mirror' }), NOW), null)
  })
})

describe('automatic failover transitions', () => {
  it('moves primary -> fresh mirror and stays pinned after primary recovery', async () => {
    let googleUp = false
    let mirrorProbes = 0
    let reloads = 0
    const first = start({
      google: () => googleUp,
      reload: () => {
        reloads += 1
      },
    })

    await first.controller.tick()
    assert.equal(currentMode(first.storage, ''), 'primary')
    await first.controller.tick()
    assert.equal(currentMode(first.storage, ''), 'mirror')
    assert.equal(currentMirrorHealth(first.storage, NOW, '')?.writable, true)
    assert.equal(reloads, 1)

    first.controller.stop()
    googleUp = true
    const second = start({
      storage: first.storage,
      google: () => googleUp,
      mirror: () => {
        mirrorProbes += 1
        return health()
      },
      reload: () => {
        reloads += 1
      },
    })
    await second.controller.tick()
    assert.equal(currentMode(first.storage, ''), 'mirror')
    await second.controller.tick()
    await second.controller.tick()
    assert.equal(currentMode(first.storage, ''), 'mirror')
    assert.equal(mirrorProbes, 3)
    assert.equal(reloads, 1)
  })

  it('refuses a stale mirror and switches when a later health check is fresh', async () => {
    let mirror = null as MirrorHealth | null
    let reloads = 0
    const running = start({
      google: () => false,
      mirror: () => mirror,
      reload: () => {
        reloads += 1
      },
    })

    await running.controller.tick()
    await running.controller.tick()
    assert.equal(currentMode(running.storage, ''), 'primary')
    assert.equal(reloads, 0)

    mirror = health()
    await running.controller.tick()
    assert.equal(currentMode(running.storage, ''), 'mirror')
    assert.equal(reloads, 1)
  })

  it('supports read-only failover but persists the write fence capability', async () => {
    const running = start({
      google: () => false,
      mirror: () => health({ writable: false }),
    })
    await running.controller.tick()
    await running.controller.tick()

    assert.equal(currentMode(running.storage, ''), 'mirror')
    assert.equal(currentMirrorHealth(running.storage, NOW, '')?.writable, false)
  })

  it('monitors freshness in mirror mode without bouncing to a down primary', async () => {
    const observed: Array<MirrorHealth | null> = []
    const storage = fakeStorage({
      [EMERGENCY_ORIGIN_KEY]: 'https://emergency.example.com',
      'statskey.firestoreMode': 'mirror',
    })
    const running = start({
      storage,
      google: () => false,
      mirror: () => null,
      onHealth: (value) => observed.push(value),
    })

    await running.controller.tick()
    assert.equal(currentMode(storage, ''), 'mirror')
    assert.equal(currentMirrorHealth(storage, NOW, ''), null)
    assert.deepEqual(observed, [null])
  })
})
