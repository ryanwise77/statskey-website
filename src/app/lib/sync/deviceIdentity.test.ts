import { beforeEach, describe, expect, it, vi } from 'vitest'

// deviceIdentity pulls randomSyncId from snapshotStore, which imports the
// firebase bootstrap; mock it so no app initializes in the test process.
vi.mock('../firebase', () => ({ db: {} }))

import {
  getSyncDeviceId,
  getSyncDeviceLabel,
  setSyncDeviceLabel,
} from './deviceIdentity'
import { SYNC_DEVICE_ID_KEY, SYNC_DEVICE_LABEL_KEY } from './types'

describe('deviceIdentity', () => {
  let values: Map<string, string>

  beforeEach(() => {
    values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  describe('getSyncDeviceId', () => {
    it('mints and persists a dev_ id on first use', () => {
      const id = getSyncDeviceId()
      expect(id).toMatch(/^dev_[a-f0-9]{20}$/)
      expect(values.get(SYNC_DEVICE_ID_KEY)).toBe(id)
    })

    it('returns the same id on repeat calls', () => {
      expect(getSyncDeviceId()).toBe(getSyncDeviceId())
    })

    it('keeps a valid stored id', () => {
      values.set(SYNC_DEVICE_ID_KEY, 'dev_0123456789abcdef0123')
      expect(getSyncDeviceId()).toBe('dev_0123456789abcdef0123')
    })

    it('replaces a malformed stored id', () => {
      values.set(SYNC_DEVICE_ID_KEY, 'not-a-device-id')
      const id = getSyncDeviceId()
      expect(id).toMatch(/^dev_[a-f0-9]{20}$/)
      expect(values.get(SYNC_DEVICE_ID_KEY)).toBe(id)
    })

    it('replaces an id with the wrong prefix', () => {
      values.set(SYNC_DEVICE_ID_KEY, 'ws_0123456789abcdef0123')
      expect(getSyncDeviceId()).toMatch(/^dev_[a-f0-9]{20}$/)
    })
  })

  describe('getSyncDeviceLabel', () => {
    it('falls back to a generic label with no override or bridge label', () => {
      expect(getSyncDeviceLabel(null)).toBe('This device')
      expect(getSyncDeviceLabel('')).toBe('This device')
      expect(getSyncDeviceLabel('   ')).toBe('This device')
    })

    it('uses the bridge label when no override is stored', () => {
      expect(getSyncDeviceLabel('MacBook Pro')).toBe('MacBook Pro')
      expect(getSyncDeviceLabel('  MacBook Pro  ')).toBe('MacBook Pro')
    })

    it('prefers the stored override to the bridge label', () => {
      values.set(SYNC_DEVICE_LABEL_KEY, 'Studio Machine')
      expect(getSyncDeviceLabel('MacBook Pro')).toBe('Studio Machine')
    })

    it('ignores a blank stored override', () => {
      values.set(SYNC_DEVICE_LABEL_KEY, '   ')
      expect(getSyncDeviceLabel('MacBook Pro')).toBe('MacBook Pro')
    })

    it('clamps labels to 80 characters', () => {
      expect(getSyncDeviceLabel('x'.repeat(120))).toHaveLength(80)
      values.set(SYNC_DEVICE_LABEL_KEY, 'y'.repeat(120))
      expect(getSyncDeviceLabel(null)).toHaveLength(80)
    })
  })

  describe('setSyncDeviceLabel', () => {
    it('stores a trimmed, clamped label', () => {
      setSyncDeviceLabel('  Home Server  ')
      expect(values.get(SYNC_DEVICE_LABEL_KEY)).toBe('Home Server')
      setSyncDeviceLabel('z'.repeat(120))
      expect(values.get(SYNC_DEVICE_LABEL_KEY)).toHaveLength(80)
    })

    it('clears the override for empty input so the bridge label returns', () => {
      setSyncDeviceLabel('Custom')
      setSyncDeviceLabel('   ')
      expect(values.has(SYNC_DEVICE_LABEL_KEY)).toBe(false)
      expect(getSyncDeviceLabel('MacBook Pro')).toBe('MacBook Pro')
    })
  })
})
