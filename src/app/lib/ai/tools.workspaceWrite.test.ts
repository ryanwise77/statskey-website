import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopWorkspaceBinding,
  DesktopWorkspaceFile,
  DesktopWorkspaceState,
} from '../desktop'
import { AgentDataCache, executeTool, previewForToolCall } from './tools'

const binding: DesktopWorkspaceBinding = {
  workspaceId: '0123456789abcdefabcd',
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('workspace_write recorded change accuracy', () => {
  it('builds the call preview from the unwrapped tool input, not the normalizer wrapper', () => {
    const cache = workspaceCache()
    const preview = previewForToolCall(
      'workspace_write',
      {
        file_path: 'notes.ts',
        edits: [{ old_text: 'const grok = 3', new_text: 'const grok = 4.6' }],
      },
      cache
    )
    expect(preview).toBeDefined()
    expect(preview?.kind).toBe('diff')
    expect(preview?.title).toBe('notes.ts')
    expect(preview?.before).toContain('const grok = 3')
    expect(preview?.after).toContain('const grok = 4.6')
    expect(preview?.additions).toBe(1)
    expect(preview?.deletions).toBe(1)
  })

  it('records the exact verified edit diff on the result preview', async () => {
    const added = workspaceFile('/workspace/notes.ts', 'notes.ts')
    installDesktopWorkspace(new Map([[added.path, added]]), [added])
    const cache = workspaceCache()
    const manifest = await executeTool('user', cache, 'workspace_manifest', {})
    const fileRef = JSON.parse(manifest.content).added_files[0].file_ref

    const result = await executeTool('user', cache, 'workspace_write', {
      file_ref: fileRef,
      edits: [{ old_text: '// notes.ts', new_text: '// notes.ts v2' }],
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toMatch(/^file changed · persisted [a-f0-9]{12}$/)
    expect(result.preview?.kind).toBe('diff')
    expect(result.preview?.title).toBe('notes.ts')
    expect(result.preview?.before).toContain('// notes.ts')
    expect(result.preview?.after).toContain('// notes.ts v2')
    expect(result.preview?.additions).toBe(1)
    expect(result.preview?.deletions).toBe(1)
    expect(
      result.preview?.items?.some(
        (item) => item.label === 'Persisted change verified'
      )
    ).toBe(true)
  })

  it('diffs a full-content replacement against the pre-write content, not itself', async () => {
    const added = workspaceFile('/workspace/notes.ts', 'notes.ts')
    installDesktopWorkspace(new Map([[added.path, added]]), [added])
    const cache = workspaceCache()
    const manifest = await executeTool('user', cache, 'workspace_manifest', {})
    const fileRef = JSON.parse(manifest.content).added_files[0].file_ref
    await executeTool('user', cache, 'workspace_read', { file_ref: fileRef })

    const result = await executeTool('user', cache, 'workspace_write', {
      file_ref: fileRef,
      content: '// notes.ts\nexport const grok = 4.6\n',
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toMatch(/^file changed · persisted [a-f0-9]{12}$/)
    expect(result.preview?.after).toContain('export const grok = 4.6')
    expect(result.preview?.additions ?? 0).toBeGreaterThan(0)
  })

  it('reports a byte-identical write as an honest no-op without touching the bridge', async () => {
    const added = workspaceFile('/workspace/notes.ts', 'notes.ts')
    const { writeFile } = installDesktopWorkspace(
      new Map([[added.path, added]]),
      [added]
    )
    const cache = workspaceCache()
    const manifest = await executeTool('user', cache, 'workspace_manifest', {})
    const fileRef = JSON.parse(manifest.content).added_files[0].file_ref
    await executeTool('user', cache, 'workspace_read', { file_ref: fileRef })

    const result = await executeTool('user', cache, 'workspace_write', {
      file_ref: fileRef,
      content: added.content,
    })

    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.content)
    expect(parsed.no_op).toBe(true)
    expect(parsed.changed).toBe(false)
    expect(parsed.persisted_change_verified).toBe(false)
    expect(parsed.note).toContain('already contains exactly this content')
    expect(result.resultMeta).toBe(
      'no change · file already contained this content'
    )
    expect(result.preview?.title).toContain('No change needed')
    expect(writeFile).not.toHaveBeenCalled()
    expect(result.content).not.toContain('statskeyAccuratePreview')
  })

  it('fails closed when an edit has identical old_text and new_text', async () => {
    const added = workspaceFile('/workspace/notes.ts', 'notes.ts')
    installDesktopWorkspace(new Map([[added.path, added]]), [added])
    const cache = workspaceCache()
    const manifest = await executeTool('user', cache, 'workspace_manifest', {})
    const fileRef = JSON.parse(manifest.content).added_files[0].file_ref

    const result = await executeTool('user', cache, 'workspace_write', {
      file_ref: fileRef,
      edits: [{ old_text: '// notes.ts', new_text: '// notes.ts' }],
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content).error).toContain(
      'identical old_text and new_text'
    )
  })
})

describe('expired workspace reference recovery', () => {
  it('recovers a stale root_ref to the sole open workspace root', async () => {
    const { gitStatus, state } = installDesktopWorkspace(new Map())
    const root = workspaceRoot('/workspace/app', 'app')
    state.roots = [root]
    state.root = root
    const cache = workspaceCache()

    const result = await executeTool('user', cache, 'git_status', {
      root_ref: 'root_00000000-dead-beef-0000-000000000000',
    })

    expect(result.isError).toBe(false)
    expect(gitStatus).toHaveBeenCalledWith('/workspace/app', binding)
  })

  it('recovers a root_ref passed as an exact root path in a multi-root workspace', async () => {
    const { gitStatus, state } = installDesktopWorkspace(new Map())
    const first = workspaceRoot('/workspace/app', 'app')
    const second = workspaceRoot('/workspace/site', 'site')
    state.roots = [first, second]
    state.root = first
    const cache = workspaceCache()

    const result = await executeTool('user', cache, 'git_status', {
      root_ref: '/workspace/site',
    })

    expect(result.isError).toBe(false)
    expect(gitStatus).toHaveBeenCalledWith('/workspace/site', binding)
  })

  it('fails a stale opaque root_ref in a multi-root workspace with recovery guidance', async () => {
    const { gitStatus, state } = installDesktopWorkspace(new Map())
    state.roots = [
      workspaceRoot('/workspace/app', 'app'),
      workspaceRoot('/workspace/site', 'site'),
    ]
    state.root = state.roots[0]
    const cache = workspaceCache()

    const result = await executeTool('user', cache, 'git_status', {
      root_ref: 'root_11111111-dead-beef-1111-111111111111',
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content).error).toContain(
      'Pass the exact absolute path of an open workspace root'
    )
    expect(gitStatus).not.toHaveBeenCalled()
  })

  it('recovers a stale file_ref passed as an exact workspace path for deletion', async () => {
    const added = workspaceFile('/workspace/notes.ts', 'notes.ts')
    const files = new Map([[added.path, added]])
    const { deleteFile } = installDesktopWorkspace(files, [added])
    const cache = workspaceCache()

    const result = await executeTool('user', cache, 'workspace_delete', {
      file_ref: '/workspace/notes.ts',
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toMatch(/^file changed · persisted [a-f0-9]{12}$/)
    expect(deleteFile).toHaveBeenCalledWith(
      '/workspace/notes.ts',
      'everything',
      expect.anything(),
      binding
    )
  })
})

function workspaceCache() {
  return new AgentDataCache(
    'user',
    { sessionId: 'session' },
    {
      agentMode: 'agent',
      approvalMode: 'everything',
      workspaceBinding: binding,
    }
  )
}

function workspaceRoot(path: string, name: string) {
  return {
    name,
    path,
    relativePath: '',
    kind: 'folder',
    extension: '',
    size: 0,
    modifiedAt: '2026-08-12T00:00:00.000Z',
    binary: false,
    tooLarge: false,
  } as unknown as DesktopWorkspaceState['roots'][number]
}

function installDesktopWorkspace(
  files: Map<string, DesktopWorkspaceFile>,
  looseFiles: DesktopWorkspaceFile[] = []
) {
  const readFile = vi.fn(
    async (
      path: string,
      _runHooks: boolean,
      receivedBinding: DesktopWorkspaceBinding
    ) => {
      if (receivedBinding !== binding) return null
      return files.get(path) ?? null
    }
  )
  const state: DesktopWorkspaceState = {
    workspaceId: binding.workspaceId,
    roots: [],
    root: null,
    looseFiles,
    importedWorkspace: null,
  }
  const writeFile = vi.fn(
    async (
      path: string,
      content: string,
      _approvalMode: string,
      _expectedModifiedAt: string,
      _origin: unknown,
      receivedBinding: DesktopWorkspaceBinding
    ) => {
      if (receivedBinding !== binding) {
        return { ok: false, error: 'binding mismatch' }
      }
      const existing = [...files.values()].find((file) => file.path === path)
      if (existing) {
        files.set(path, {
          ...existing,
          content,
          size: content.length,
          modifiedAt: '2026-08-12T00:01:00.000Z',
        })
      }
      return {
        ok: true,
        changed: true,
        file: existing
          ? {
              ...existing,
              content,
              modifiedAt: '2026-08-12T00:01:00.000Z',
            }
          : undefined,
      }
    }
  )
  const deleteFile = vi.fn(
    async (
      path: string,
      _approvalMode: string,
      _origin: unknown,
      receivedBinding: DesktopWorkspaceBinding
    ) => {
      if (receivedBinding !== binding) {
        return { ok: false, error: 'binding mismatch' }
      }
      files.delete(path)
      return { ok: true, changed: true }
    }
  )
  const gitStatus = vi.fn(async () => ({ ok: true, stdout: 'clean' }))
  const gitDiff = vi.fn(async () => ({ ok: true, stdout: '' }))
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: vi.fn(),
      statsKeyDesktop: {
        setBadge: vi.fn(),
        openExternal: vi.fn(),
        workspace: {
          readFile,
          writeFile,
          deleteFile,
          gitStatus,
          gitDiff,
          getState: vi.fn(async () => state),
        },
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
  return { readFile, writeFile, deleteFile, gitStatus, gitDiff, state }
}

function workspaceFile(path: string, name: string): DesktopWorkspaceFile {
  return {
    name,
    path,
    relativePath: name,
    kind: 'file',
    extension: 'ts',
    size: name.length,
    modifiedAt: '2026-08-12T00:00:00.000Z',
    content: `// ${name}`,
    binary: false,
    tooLarge: false,
    language: 'typescript',
  }
}
