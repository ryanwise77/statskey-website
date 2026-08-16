import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopRecentProject,
  DesktopWorkspaceState,
} from './desktop'
import {
  captureWorkspaceBinding,
  consumeWorkspaceQuickTool,
  projectBindingForWorkspace,
  requestWorkspaceQuickTool,
  setActiveWorkspaceDocument,
  WORKSPACE_QUICK_TOOL_EVENT,
  workspaceContextForPrompt,
  workspaceImportResultError,
  type WorkspaceQuickTool,
} from './workspaceContext'

afterEach(() => {
  setActiveWorkspaceDocument(null)
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
  Reflect.deleteProperty(globalThis, 'sessionStorage')
})

function installQuickToolEnvironment() {
  const values = new Map<string, string>()
  const target = new EventTarget()
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: storage,
  })
  return { storage, target }
}

function workspace(
  roots: Array<{ name: string; path: string }>,
  importedName?: string,
  workspaceId: string | null = roots.length > 0
    ? '0123456789abcdefabcd'
    : null,
  looseFiles: Array<{ name: string; path: string }> = []
): DesktopWorkspaceState {
  return {
    workspaceId,
    roots: roots.map(({ name, path }) => ({
      name,
      path,
      relativePath: name,
      kind: 'directory' as const,
      extension: '',
      size: null,
      modifiedAt: '2026-08-09T00:00:00.000Z',
    })),
    root: null,
    looseFiles: looseFiles.map(({ name, path }) => ({
      name,
      path,
      relativePath: name,
      kind: 'file' as const,
      extension: name.includes('.') ? name.split('.').at(-1) || '' : '',
      size: 100,
      modifiedAt: '2026-08-09T00:00:00.000Z',
    })),
    importedWorkspace: importedName
      ? {
          name: importedName,
          sourcePath: null,
          importedFolders: roots.length,
          missingFolders: 0,
        }
      : null,
  }
}

describe('workspace project identity', () => {
  it('uses the exact saved name for an exact root set', () => {
    const state = workspace([
      { name: 'StatsKey', path: '/Projects/StatsKey' },
      { name: 'Shared', path: '/Projects/Shared' },
    ], undefined, '0123456789abcdefabcd')
    const recents: DesktopRecentProject[] = [
      {
        id: '0123456789abcdefabcd',
        name: 'StatsKey Desktop and Shared Components',
        roots: ['/Projects/Shared', '/Projects/StatsKey'],
        rootCount: 2,
        availableRootCount: 2,
        lastOpenedAt: '2026-08-09T00:00:00.000Z',
        saved: true,
      },
    ]

    expect(projectBindingForWorkspace(state, recents)).toEqual({
      id: '0123456789abcdefabcd',
      label: 'StatsKey Desktop and Shared Components',
      roots: ['/Projects/Shared', '/Projects/StatsKey'],
    })
  })

  it('keeps an imported workspace name and falls back to the folder set', () => {
    expect(
      projectBindingForWorkspace(
        workspace(
          [
            { name: 'App', path: '/Projects/App' },
            { name: 'API', path: '/Projects/API' },
          ],
          'Product.code-workspace'
        ),
        []
      )?.label
    ).toBe('Product')
    expect(
      projectBindingForWorkspace(
        workspace([
          { name: 'App', path: '/Projects/App' },
          { name: 'API', path: '/Projects/API' },
        ]),
        []
      )?.label
    ).toBe('App +1')
  })

  it('returns no work identity when no folders are open', () => {
    expect(projectBindingForWorkspace(workspace([]), [])).toBeNull()
  })

  it('keeps an exact binding for a loose-file-only workspace', () => {
    const state = workspace(
      [],
      undefined,
      'fedcba9876543210fedc',
      [
        { name: 'notes.md', path: '/Projects/notes.md' },
        { name: 'brief.txt', path: '/Projects/brief.txt' },
      ]
    )

    expect(projectBindingForWorkspace(state, [])).toEqual({
      id: 'fedcba9876543210fedc',
      label: 'brief.txt +1',
      roots: [],
    })
    expect(captureWorkspaceBinding(state)).toEqual({
      workspaceId: 'fedcba9876543210fedc',
    })
  })

  it('captures an immutable exact workspace id for an in-flight turn', () => {
    const state = workspace(
      [{ name: 'StatsKey', path: '/Projects/StatsKey' }],
      undefined,
      '0123456789abcdefabcd'
    )
    const captured = captureWorkspaceBinding(state)
    state.workspaceId = 'fedcba9876543210fedc'
    expect(captured).toEqual({ workspaceId: '0123456789abcdefabcd' })
    expect(Object.isFrozen(captured)).toBe(true)
  })

  it('does not substitute a root-only recent id for Electron identity', () => {
    const state = workspace(
      [{ name: 'StatsKey', path: '/Projects/StatsKey' }],
      undefined,
      'fedcba9876543210fedc'
    )
    const binding = projectBindingForWorkspace(state, [
      {
        id: '0123456789abcdefabcd',
        name: 'Different loose-file workspace',
        roots: ['/Projects/StatsKey'],
        rootCount: 1,
        availableRootCount: 1,
        lastOpenedAt: '2026-08-09T00:00:00.000Z',
        saved: true,
      },
    ])
    expect(binding?.id).toBe('fedcba9876543210fedc')
    expect(binding?.label).toBe('StatsKey')
  })

  it('re-reads the active document under the captured binding', async () => {
    const binding = Object.freeze({
      workspaceId: '0123456789abcdefabcd',
    })
    const readFile = vi.fn(async () => ({
      name: 'current.ts',
      path: '/Projects/Current/current.ts',
      relativePath: 'current.ts',
      kind: 'file' as const,
      extension: 'ts',
      size: 21,
      modifiedAt: '2026-08-09T00:00:00.000Z',
      content: 'verified disk content',
      binary: false,
      tooLarge: false,
      language: 'typescript',
    }))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        statsKeyDesktop: {
          setBadge: vi.fn(),
          openExternal: vi.fn(),
          workspace: { readFile },
          providers: { getStatus: vi.fn() },
          preferences: { get: vi.fn() },
          mcp: { tools: vi.fn() },
          onSummon: vi.fn(),
        },
      },
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => '[]') },
    })
    setActiveWorkspaceDocument({
      name: 'stale.ts',
      path: '/Projects/Current/current.ts',
      relativePath: 'stale.ts',
      content: 'stale cached content',
    })

    const context = await workspaceContextForPrompt(1_000, binding)

    expect(readFile).toHaveBeenCalledWith(
      '/Projects/Current/current.ts',
      false,
      binding
    )
    expect(context).toContain('verified disk content')
    expect(context).not.toContain('stale cached content')
  })
})

describe('workspace file import results', () => {
  it('does not turn cancellation or a successful import into an error', () => {
    expect(
      workspaceImportResultError({ ok: false, cancelled: true })
    ).toBeNull()
    expect(
      workspaceImportResultError({ ok: true, workspace: workspace([]) })
    ).toBeNull()
  })

  it('preserves a useful import error and supplies a safe fallback', () => {
    expect(
      workspaceImportResultError({
        ok: false,
        error: 'The referenced folder is no longer available.',
      })
    ).toBe('The referenced folder is no longer available.')
    expect(workspaceImportResultError({ ok: false })).toBe(
      'The workspace file could not be imported.'
    )
  })
})

describe('workspace quick tools', () => {
  for (const tool of ['quick-open', 'search-files', 'add-files'] as const) {
    it(`queues and emits ${tool}`, () => {
      const { storage, target } = installQuickToolEnvironment()
      const received: WorkspaceQuickTool[] = []
      target.addEventListener(WORKSPACE_QUICK_TOOL_EVENT, (event) => {
        received.push((event as CustomEvent<WorkspaceQuickTool>).detail)
      })

      requestWorkspaceQuickTool(tool)

      expect(received).toEqual([tool])
      expect(storage.setItem).toHaveBeenCalledOnce()
      expect(consumeWorkspaceQuickTool()).toBe(tool)
      expect(consumeWorkspaceQuickTool()).toBeNull()
      expect(storage.removeItem).toHaveBeenCalledTimes(2)
    })
  }
})
