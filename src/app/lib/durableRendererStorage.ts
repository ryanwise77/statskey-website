import { getDesktopBridge } from './desktop'

export function durableGetItem(
  key: string,
  storage: Storage = localStorage
): string | null {
  const browserValue = storage.getItem(key)
  const durableState = getDesktopBridge()?.durableState
  if (!durableState) return browserValue
  try {
    const durableValue = durableState.get(key)
    if (durableValue != null) {
      if (browserValue !== durableValue) storage.setItem(key, durableValue)
      return durableValue
    }
    if (browserValue != null) durableState.set(key, browserValue)
  } catch {
    // Browser storage remains the compatibility fallback.
  }
  return browserValue
}

export function durableSetItem(
  key: string,
  value: string,
  storage: Storage = localStorage
) {
  try {
    getDesktopBridge()?.durableState?.set(key, value)
  } catch {
    // Browser storage remains the compatibility fallback.
  }
  storage.setItem(key, value)
}

export function durableRemoveItem(
  key: string,
  storage: Storage = localStorage
) {
  try {
    getDesktopBridge()?.durableState?.set(key, null)
  } catch {
    // Browser storage remains the compatibility fallback.
  }
  storage.removeItem(key)
}

export const durableRendererStorage: Storage = {
  get length() {
    return localStorage.length
  },
  clear() {
    localStorage.clear()
  },
  getItem(key) {
    return durableGetItem(key)
  },
  key(index) {
    return localStorage.key(index)
  },
  removeItem(key) {
    durableRemoveItem(key)
  },
  setItem(key, value) {
    durableSetItem(key, value)
  },
}
