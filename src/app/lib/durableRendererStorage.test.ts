import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  durableGetItem,
  durableRemoveItem,
  durableSetItem,
} from './durableRendererStorage'

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

function desktopBridge(durable: Map<string, string>) {
  return {
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
  }
}

describe('durable renderer storage', () => {
  let storage: MemoryStorage
  let durable: Map<string, string>

  beforeEach(() => {
    storage = new MemoryStorage()
    durable = new Map()
    vi.stubGlobal('window', { statsKeyDesktop: desktopBridge(durable) })
  })

  it('restores the main-process checkpoint over a missing browser value', () => {
    durable.set('cad', 'saved-on-disk')

    expect(durableGetItem('cad', storage)).toBe('saved-on-disk')
    expect(storage.getItem('cad')).toBe('saved-on-disk')
  })

  it('seeds the durable checkpoint when upgrading existing browser state', () => {
    storage.setItem('cad', 'existing-browser-state')

    expect(durableGetItem('cad', storage)).toBe('existing-browser-state')
    expect(durable.get('cad')).toBe('existing-browser-state')
  })

  it('writes and removes both storage layers', () => {
    durableSetItem('cad', 'revision-1', storage)
    expect(storage.getItem('cad')).toBe('revision-1')
    expect(durable.get('cad')).toBe('revision-1')

    durableRemoveItem('cad', storage)
    expect(storage.getItem('cad')).toBeNull()
    expect(durable.get('cad')).toBeUndefined()
  })
})
