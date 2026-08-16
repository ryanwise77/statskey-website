import { describe, expect, it } from 'vitest'
import {
  desktopDeviceRunProof,
  type DesktopDeviceEvidenceEvent,
} from './desktopDeviceEvidence'
import type { DesktopDeviceAction } from './desktop'

function event(
  action: DesktopDeviceAction,
  overrides: Partial<DesktopDeviceEvidenceEvent> = {}
): DesktopDeviceEvidenceEvent {
  return {
    id: `${action}-${overrides.at ?? 1}`,
    at: overrides.at ?? 1,
    deviceId: 'sim-1',
    action,
    ok: true,
    appId: 'com.statskey.app',
    ...overrides,
  }
}

describe('desktop device run proof', () => {
  it('does not treat launch prose or a launch action alone as verification', () => {
    expect(
      desktopDeviceRunProof([event('launch')], 'sim-1', 'com.statskey.app')
    ).toMatchObject({ ready: false, label: expect.stringContaining('post-launch') })
  })

  it('requires a later live and crash-free runtime check', () => {
    const proof = desktopDeviceRunProof(
      [
        event('launch', { at: 1 }),
        event('inspect', { at: 2, alive: true, crashFree: true }),
      ],
      'sim-1',
      'com.statskey.app'
    )
    expect(proof).toMatchObject({ ready: true })
    expect(proof.verification?.action).toBe('inspect')
  })

  it('invalidates earlier proof when a later check observes a crash', () => {
    const proof = desktopDeviceRunProof(
      [
        event('launch', { at: 1 }),
        event('process', { at: 2, alive: true, crashFree: true }),
        event('logs', {
          at: 3,
          alive: false,
          crashFree: false,
          crashMarkers: ['SIGABRT'],
        }),
      ],
      'sim-1'
    )
    expect(proof).toMatchObject({ ready: false })
    expect(proof.verification?.crashMarkers).toEqual(['SIGABRT'])
  })
})
