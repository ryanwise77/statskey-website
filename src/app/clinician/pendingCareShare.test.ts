import { describe, expect, it, vi } from 'vitest'
import {
  careShareCodeFromHash,
  clearPendingCareShareCode,
  isCareShareCode,
  readPendingCareShareCode,
  savePendingCareShareCode,
} from './pendingCareShare'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('pending clinician care-share code', () => {
  const code = 'abcdEFGHijklMNOPqrstUVWXyz12_345'

  it('accepts case-sensitive share tokens and strips display spaces', () => {
    expect(isCareShareCode(code)).toBe(true)
    expect(isCareShareCode('abcd EFGH ijkl MNOP qrst UVWX yz12 _345')).toBe(
      true
    )
    expect(isCareShareCode('patient-123')).toBe(false)
  })

  it('captures a code from an encoded mobile link fragment', () => {
    expect(careShareCodeFromHash(`#${encodeURIComponent(code)}`)).toBe(code)
  })

  it('survives signup and verification tabs, then clears after redemption', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T16:00:00Z'))
    const storage = memoryStorage()
    savePendingCareShareCode(code, storage)
    expect(readPendingCareShareCode('', storage)).toBe(code)
    clearPendingCareShareCode(storage)
    expect(readPendingCareShareCode('', storage)).toBe('')
    vi.useRealTimers()
  })

  it('expires an abandoned code after 24 hours', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T16:00:00Z'))
    const storage = memoryStorage()
    savePendingCareShareCode(code, storage)
    expect(
      readPendingCareShareCode(
        '',
        storage,
        Date.parse('2026-08-22T16:00:01Z')
      )
    ).toBe('')
    vi.useRealTimers()
  })

  it('treats an invalid new fragment as authoritative over a stored code', () => {
    const storage = memoryStorage()
    savePendingCareShareCode(code, storage)
    expect(readPendingCareShareCode('#truncated', storage)).toBe('')
    expect(readPendingCareShareCode('', storage)).toBe('')
  })

  it('keeps the code usable when browser storage is unavailable', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(savePendingCareShareCode(code, unavailable)).toBe(code)
    expect(readPendingCareShareCode(`#${code}`, unavailable)).toBe(code)
  })
})
