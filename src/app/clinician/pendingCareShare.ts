const STORAGE_KEY = 'statskey.clinician.pendingCareShare'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface PendingCareShare {
  code: string
  savedAt: number
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function normalizeCareShareCode(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

export function isCareShareCode(value: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(normalizeCareShareCode(value))
}

export function careShareCodeFromHash(hash: string): string {
  const raw = hash.replace(/^#/, '')
  if (!raw) return ''
  try {
    const decoded = decodeURIComponent(raw)
    return isCareShareCode(decoded) ? normalizeCareShareCode(decoded) : ''
  } catch {
    return isCareShareCode(raw) ? normalizeCareShareCode(raw) : ''
  }
}

export function savePendingCareShareCode(
  value: string,
  storage: StorageLike | null = browserLocalStorage()
): string {
  const code = normalizeCareShareCode(value)
  if (!isCareShareCode(code)) return ''
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ code, savedAt: Date.now() } satisfies PendingCareShare)
    )
  } catch {
    // The URL fragment and in-memory form state remain usable in this tab.
  }
  return code
}

export function readPendingCareShareCode(
  hash = typeof window === 'undefined' ? '' : window.location.hash,
  storage: StorageLike | null = browserLocalStorage(),
  now = Date.now()
): string {
  const hasFragment = hash.replace(/^#/, '').length > 0
  const fragmentCode = careShareCodeFromHash(hash)
  if (fragmentCode) {
    savePendingCareShareCode(fragmentCode, storage)
    return fragmentCode
  }
  if (hasFragment) {
    removeStoredCode(storage)
    return ''
  }
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return ''
    const pending = JSON.parse(raw) as Partial<PendingCareShare>
    if (
      typeof pending.code !== 'string' ||
      typeof pending.savedAt !== 'number' ||
      now - pending.savedAt > MAX_AGE_MS ||
      !isCareShareCode(pending.code)
    ) {
      storage?.removeItem(STORAGE_KEY)
      return ''
    }
    return normalizeCareShareCode(pending.code)
  } catch {
    storage?.removeItem(STORAGE_KEY)
    return ''
  }
}

export function clearPendingCareShareCode(
  storage: StorageLike | null = browserLocalStorage(),
  clearHash = true
) {
  removeStoredCode(storage)
  if (
    clearHash &&
    typeof window !== 'undefined' &&
    window.location.hash.length > 1
  ) {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`
    )
  }
}

function removeStoredCode(storage: StorageLike | null) {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing else is required after successful redemption.
  }
}

function browserLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
