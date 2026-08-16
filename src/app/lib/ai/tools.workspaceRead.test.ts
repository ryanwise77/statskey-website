import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopWorkspaceBinding,
  DesktopWorkspaceFile,
  DesktopWorkspaceState,
} from '../desktop'
import {
  independentImplementationContinuationDecision,
  unsupportedImplementationClaimObligations,
} from './agentContinuation'
import { AgentDataCache, executeTool } from './tools'

const binding: DesktopWorkspaceBinding = {
  workspaceId: '0123456789abcdefabcd',
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('workspace_read execution', () => {
  it('reads the exact observed JSON-stringified file_paths shape under the captured binding', async () => {
    const files = new Map([
      [
        'src/app/routes/Workspace.tsx',
        workspaceFile('/workspace/src/app/routes/Workspace.tsx', 'Workspace.tsx'),
      ],
      [
        'src/app/lib/ai/tools.ts',
        workspaceFile('/workspace/src/app/lib/ai/tools.ts', 'tools.ts'),
      ],
    ])
    const { readFile } = installDesktopWorkspace(files)
    const cache = workspaceCache()

    const result = await executeTool('user', cache, 'workspace_read', {
      file_paths:
        '["src/app/routes/Workspace.tsx","src/app/lib/ai/tools.ts"]',
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toBe('2 files read')
    expect(JSON.parse(result.content).files).toHaveLength(2)
    expect(readFile).toHaveBeenNthCalledWith(
      1,
      'src/app/routes/Workspace.tsx',
      true,
      binding
    )
    expect(readFile).toHaveBeenNthCalledWith(
      2,
      'src/app/lib/ai/tools.ts',
      true,
      binding
    )
  })

  it('accepts singular file_ref after the manifest issues an opaque reference', async () => {
    const added = workspaceFile('/workspace/notes.ts', 'notes.ts')
    installDesktopWorkspace(new Map([[added.path, added]]), [added])
    const cache = workspaceCache()
    const manifest = await executeTool('user', cache, 'workspace_manifest', {})
    const fileRef = JSON.parse(manifest.content).added_files[0].file_ref

    const result = await executeTool('user', cache, 'workspace_read', {
      file_ref: fileRef,
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toBe('1 files read')
    expect(JSON.parse(result.content).files[0]).toMatchObject({
      name: 'notes.ts',
      content: '// notes.ts',
    })
  })

  it('continues a large exact file by bounded line range and edits a later chunk', async () => {
    const content = Array.from(
      { length: 775 },
      (_, index) => `line ${index + 1}: ${'x'.repeat(38)}`
    ).join('\n')
    const source = {
      ...workspaceFile('/workspace/Sources/Large.swift', 'Large.swift'),
      relativePath: 'Sources/Large.swift',
      content,
      size: content.length,
      language: 'swift',
    }
    const files = new Map([['Sources/Large.swift', source]])
    const { writeFile } = installDesktopWorkspace(files)
    const cache = workspaceCache()

    const first = await executeTool('user', cache, 'workspace_read', {
      file_path: 'Sources/Large.swift',
    })
    const firstFile = JSON.parse(first.content).files[0]
    expect(first.isError).toBe(false)
    expect(first.resultMeta).toMatch(
      /^1 files read · truncated · continue at line \d+$/
    )
    expect(firstFile.content.length).toBeLessThanOrEqual(12_000)
    expect(firstFile.content).not.toContain('line 700:')

    const ranged = await executeTool('user', cache, 'workspace_read', {
      file_path: 'Sources/Large.swift',
      start_line: 600,
      end_line: 775,
    })
    const rangedFile = JSON.parse(ranged.content).files[0]
    expect(ranged.isError).toBe(false)
    expect(ranged.resultMeta).toBe('1 files read · lines 600-775 of 775')
    expect(rangedFile).toMatchObject({
      ranged: true,
      start_line: 600,
      end_line: 775,
      total_lines: 775,
      next_start_line: null,
    })
    expect(rangedFile.content.length).toBeLessThanOrEqual(12_000)
    expect(rangedFile.content).toContain('line 700:')

    const write = await executeTool('user', cache, 'workspace_write', {
      file_path: 'Sources/Large.swift',
      edits: [
        {
          old_text: `line 700: ${'x'.repeat(38)}`,
          new_text: 'line 700: corrected later chunk',
        },
      ],
    })
    expect(write.isError).toBe(false)
    expect(write.resultMeta).toMatch(/^file changed · persisted [a-f0-9]{12}$/)
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('follows a canonical string next-line range and closes the exact completion claim', async () => {
    const lines = Array.from(
      { length: 520 },
      (_, index) => `line ${index + 1}`
    )
    lines[484] = '  .frame(minHeight: 44)'
    lines[485] =
      '  .accessibilityAddTraits(isSelected ? [.isSelected] : [])'
    const content = lines.join('\n')
    const source = {
      ...workspaceFile(
        '/workspace/Sources/CameraCaptureView.swift',
        'CameraCaptureView.swift'
      ),
      relativePath: 'Sources/CameraCaptureView.swift',
      content,
      size: content.length,
      language: 'swift',
    }
    installDesktopWorkspace(
      new Map([['Sources/CameraCaptureView.swift', source]])
    )
    const cache = workspaceCache()

    const prefix = await executeTool('user', cache, 'workspace_read', {
      file_path: 'Sources/CameraCaptureView.swift',
      start_line: 440,
      end_line: 485,
    })
    expect(prefix.resultMeta).toBe(
      '1 files read · lines 440-485 of 520 · continue at line 486'
    )
    expect(prefix.preview?.body).toContain('.frame(minHeight: 44)')
    expect(prefix.preview?.body).not.toContain('.accessibilityAddTraits')

    const contentClaim =
      'Completed. Updated the selected chip with `.accessibilityAddTraits` and `.isSelected`.'
    const persistedChange = {
      name: 'workspace_write',
      status: 'done' as const,
      resultMeta: 'file changed · persisted abcdef123456',
      preview: {
        title: 'Sources/CameraCaptureView.swift',
        items: [{ label: 'Persisted change verified' }],
      },
    }
    const prefixStep = {
      name: 'workspace_read',
      status: 'done' as const,
      resultMeta: prefix.resultMeta,
      preview: prefix.preview,
    }
    const buildPassed = {
      name: 'run_terminal',
      status: 'done' as const,
      resultMeta: 'exit 0 · Build passed',
      preview: { title: 'Build passed', body: '** BUILD SUCCEEDED **' },
    }
    const finalDiff = {
      name: 'git_diff',
      status: 'done' as const,
      resultMeta: 'scoped diff read',
      preview: {
        title: 'Task-scoped existing changes',
        additions: 1,
        deletions: 0,
        body: 'diff --git a/Sources/CameraCaptureView.swift b/Sources/CameraCaptureView.swift',
        items: [{ label: 'Sources/CameraCaptureView.swift' }],
      },
    }
    const beforeContinuation = [
      persistedChange,
      prefixStep,
      buildPassed,
      finalDiff,
    ]
    const obligations = unsupportedImplementationClaimObligations(
      contentClaim,
      beforeContinuation
    )
    expect(obligations).toContain(
      'accessibilityAddTraits'
    )

    const continuation = await executeTool('user', cache, 'workspace_read', {
      file_path: 'Sources/CameraCaptureView.swift',
      start_line: '486',
      end_line: '500',
    })
    expect(continuation.isError).toBe(false)
    expect(continuation.resultMeta).toBe(
      '1 files read · lines 486-500 of 520 · continue at line 501'
    )
    expect(continuation.preview?.body).toContain(
      '.accessibilityAddTraits(isSelected ? [.isSelected] : [])'
    )

    expect(
      independentImplementationContinuationDecision({
        approvalMode: 'everything',
        mode: 'agent',
        workspaceChangeExpected: true,
        objective:
          'Add the selected accessibility trait, run the build, and review the final task-scoped diff.',
        content: contentClaim,
        steps: [
          ...beforeContinuation,
          {
            name: 'workspace_read',
            status: 'done',
            resultMeta: continuation.resultMeta,
            preview: continuation.preview,
          },
        ],
        stopped: false,
        completedPasses: 4,
        requiredClaimIdentifiers: obligations,
      })
    ).toEqual({ shouldContinue: false, reason: 'completed' })
  })

  it('does not broaden an explicitly malformed line range into a prefix read', async () => {
    const source = workspaceFile('/workspace/Large.swift', 'Large.swift')
    const { readFile } = installDesktopWorkspace(
      new Map([['Large.swift', source]])
    )

    const result = await executeTool(
      'user',
      workspaceCache(),
      'workspace_read',
      {
        file_path: 'Large.swift',
        start_line: ' 486 ',
        end_line: '500',
      }
    )

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content).error).toContain(
      'Malformed workspace_read line range'
    )
    expect(readFile).not.toHaveBeenCalled()
  })

  it('fails closed for multi-file, oversized, and exhausted ranged reads', async () => {
    const source = {
      ...workspaceFile('/workspace/Large.swift', 'Large.swift'),
      content: Array.from({ length: 900 }, (_, index) => `line ${index + 1}`).join('\n'),
    }
    installDesktopWorkspace(
      new Map([
        ['Large.swift', source],
        ['Other.swift', workspaceFile('/workspace/Other.swift', 'Other.swift')],
      ])
    )
    const cache = workspaceCache()

    const multiple = await executeTool('user', cache, 'workspace_read', {
      file_paths: ['Large.swift', 'Other.swift'],
      start_line: 1,
      end_line: 10,
    })
    expect(multiple.isError).toBe(true)
    expect(JSON.parse(multiple.content).error).toContain('exactly one file')

    const oversized = await executeTool('user', cache, 'workspace_read', {
      file_path: 'Large.swift',
      start_line: 1,
      end_line: 401,
    })
    expect(oversized.isError).toBe(true)
    expect(JSON.parse(oversized.content).error).toContain('limited to 400 lines')

    for (const start of [1, 101, 201]) {
      const result = await executeTool('user', cache, 'workspace_read', {
        file_path: 'Large.swift',
        start_line: start,
        end_line: start + 99,
      })
      expect(result.isError).toBe(false)
    }
    const exhausted = await executeTool('user', cache, 'workspace_read', {
      file_path: 'Large.swift',
      start_line: 301,
      end_line: 400,
    })
    expect(exhausted.isError).toBe(true)
    expect(JSON.parse(exhausted.content).error).toContain(
      'ranged-read budget is exhausted'
    )
  })

  it('applies an exact JSON-stringified workspace_write edit without replacing the file', async () => {
    const source = {
      ...workspaceFile('/workspace/src/note.ts', 'note.ts'),
      relativePath: 'src/note.ts',
      content: 'before\nkeep\n',
    }
    const { writeFile } = installDesktopWorkspace(
      new Map([['src/note.ts', source]])
    )
    const cache = workspaceCache()

    await executeTool('user', cache, 'workspace_read', {
      file_path: 'src/note.ts',
    })
    const result = await executeTool('user', cache, 'workspace_write', {
      file_path: 'src/note.ts',
      edits: '[{"old_text":"before","new_text":"after"}]',
      content: '',
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toMatch(
      /^file changed · persisted [a-f0-9]{12}$/
    )
    expect(JSON.parse(result.content)).toMatchObject({
      changed: true,
      persisted_change_verified: true,
      verified_path: 'src/note.ts',
    })
    expect(JSON.parse(result.content).verified_content_sha256).toMatch(
      /^[a-f0-9]{64}$/
    )
    expect(JSON.parse(result.content).verified_operation_sha256).toMatch(
      /^[a-f0-9]{64}$/
    )
    expect(JSON.parse(result.content).verified_operation_sha256).not.toBe(
      JSON.parse(result.content).verified_content_sha256
    )
    expect(result.preview?.items).toContainEqual(
      expect.objectContaining({ label: 'Persisted change verified' })
    )
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith(
      '/workspace/src/note.ts',
      'after\nkeep\n',
      'everything',
      source.modifiedAt,
      { sessionId: 'session' },
      binding
    )
  })

  it('prevalidates a multi-edit batch atomically before dispatching any write', async () => {
    const source = {
      ...workspaceFile('/workspace/src/note.ts', 'note.ts'),
      relativePath: 'src/note.ts',
      content: 'first\nkeep\nlast\n',
    }
    const files = new Map([['src/note.ts', source]])
    const { writeFile } = installDesktopWorkspace(files)
    const cache = workspaceCache()

    const result = await executeTool('user', cache, 'workspace_write', {
      file_path: 'src/note.ts',
      edits: [
        { old_text: 'first', new_text: 'changed' },
        { old_text: 'missing later target', new_text: 'must not persist' },
      ],
    })

    expect(result.isError).toBe(true)
    expect(result.resultMeta).toMatch(/^failed/)
    expect(result.resultMeta).not.toMatch(/persisted [a-f0-9]{12}/)
    expect(writeFile).not.toHaveBeenCalled()
    expect(files.get('src/note.ts')?.content).toBe('first\nkeep\nlast\n')
  })

  it('rejects a claimed write when exact post-write read-back does not match', async () => {
    const source = {
      ...workspaceFile('/workspace/src/note.ts', 'note.ts'),
      relativePath: 'src/note.ts',
      content: 'before\n',
    }
    const files = new Map([['src/note.ts', source]])
    const { writeFile } = installDesktopWorkspace(files)
    writeFile.mockImplementationOnce(async () => ({
      ok: true,
      changed: true,
      file: {
        ...source,
        content: 'after\n',
        modifiedAt: '2026-08-12T00:01:00.000Z',
      },
    }))
    const cache = workspaceCache()

    const result = await executeTool('user', cache, 'workspace_write', {
      file_path: 'src/note.ts',
      edits: [{ old_text: 'before', new_text: 'after' }],
    })

    expect(result.isError).toBe(true)
    expect(result.resultMeta).toMatch(/^failed/)
    expect(result.resultMeta).not.toBe('file changed')
    expect(JSON.parse(result.content).error).toContain(
      'exact post-write read did not match'
    )
    expect(files.get('src/note.ts')?.content).toBe('before\n')
  })

  it('fails closed when a present malformed edits value could otherwise empty a file', async () => {
    const source = {
      ...workspaceFile('/workspace/src/note.ts', 'note.ts'),
      relativePath: 'src/note.ts',
      content: 'must remain\n',
    }
    const { writeFile } = installDesktopWorkspace(
      new Map([['src/note.ts', source]])
    )
    const cache = workspaceCache()

    await executeTool('user', cache, 'workspace_read', {
      file_path: 'src/note.ts',
    })
    const result = await executeTool('user', cache, 'workspace_write', {
      file_path: 'src/note.ts',
      edits: 'not-json',
      content: '',
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content).error).toContain(
      'Malformed workspace_write edits'
    )
    expect(writeFile).not.toHaveBeenCalled()
  })

  it.each([
    { content: '', meta: 'empty file created' },
    { content: 'export const ready = true\n', meta: /^file changed · persisted [a-f0-9]{12}$/ },
  ])(
    'distinguishes an empty create from a durable nonempty create after exact read-back',
    async ({ content, meta }) => {
      const files = new Map<string, DesktopWorkspaceFile>()
      const { state } = installDesktopWorkspace(files)
      const root = {
        name: 'workspace',
        path: '/workspace',
        relativePath: '.',
        kind: 'directory' as const,
        extension: '',
        size: null,
        modifiedAt: '2026-08-12T00:00:00.000Z',
      }
      state.roots = [root]
      state.root = root
      const cache = workspaceCache()
      const manifest = await executeTool('user', cache, 'workspace_manifest', {})
      const rootRef = JSON.parse(manifest.content).roots[0].root_ref

      const result = await executeTool('user', cache, 'workspace_create', {
        root_ref: rootRef,
        relative_path: 'src/created.ts',
        content,
      })

      expect(result.isError).toBe(false)
      if (typeof meta === 'string') expect(result.resultMeta).toBe(meta)
      else expect(result.resultMeta).toMatch(meta)
      expect(JSON.parse(result.content)).toMatchObject({
        changed: true,
        persisted_change_verified: true,
        implementation_nonempty: content.length > 0,
      })
      expect(files.get('/workspace/src/created.ts')?.content).toBe(content)
    }
  )

  it.each([[], '[]', null])(
    'does not dispatch an empty replacement for explicitly empty edits: %j',
    async (edits) => {
      const source = {
        ...workspaceFile('/workspace/src/note.ts', 'note.ts'),
        relativePath: 'src/note.ts',
        content: 'must remain\n',
      }
      const { writeFile } = installDesktopWorkspace(
        new Map([['src/note.ts', source]])
      )
      const cache = workspaceCache()
      await executeTool('user', cache, 'workspace_read', {
        file_path: 'src/note.ts',
      })

      const result = await executeTool('user', cache, 'workspace_write', {
        file_path: 'src/note.ts',
        edits,
        content: '',
      })

      expect(result.isError).toBe(true)
      expect(writeFile).not.toHaveBeenCalled()
    }
  )

  it('keeps a JSON-stringified git_diff path list task-scoped', async () => {
    const { state, gitDiff } = installDesktopWorkspace(new Map())
    const root = {
      name: 'Project',
      path: '/workspace',
      relativePath: '.',
      kind: 'directory' as const,
      extension: '',
      size: null,
      modifiedAt: '2026-08-12T00:00:00.000Z',
    }
    state.roots = [root]
    state.root = root
    gitDiff.mockResolvedValue({
      ok: true,
      stdout: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
        'diff --git a/src/private.ts b/src/private.ts',
        '--- a/src/private.ts',
        '+++ b/src/private.ts',
        '@@ -1 +1 @@',
        '-private before',
        '+private after',
      ].join('\n'),
    })
    const cache = workspaceCache()
    const manifest = await executeTool('user', cache, 'workspace_manifest', {})
    const rootRef = JSON.parse(manifest.content).roots[0].root_ref

    const result = await executeTool('user', cache, 'git_diff', {
      root_ref: rootRef,
      file_paths: '["src/a.ts"]',
    })

    expect(result.isError).toBe(false)
    const payload = JSON.parse(result.content)
    expect(payload).toMatchObject({ scoped: true, paths: ['src/a.ts'] })
    expect(payload.diff).toContain('diff --git a/src/a.ts b/src/a.ts')
    expect(payload.diff).not.toContain('private.ts')
    expect(gitDiff).toHaveBeenCalledWith(
      '/workspace',
      false,
      ['src/a.ts'],
      binding
    )
  })

  it.each(['[]', [], {}, [42]])(
    'does not broaden an explicitly malformed git_diff scope: %j',
    async (filePaths) => {
      const { state, gitDiff } = installDesktopWorkspace(new Map())
      const root = {
        name: 'Project',
        path: '/workspace',
        relativePath: '.',
        kind: 'directory' as const,
        extension: '',
        size: null,
        modifiedAt: '2026-08-12T00:00:00.000Z',
      }
      state.roots = [root]
      state.root = root
      const cache = workspaceCache()
      const manifest = await executeTool('user', cache, 'workspace_manifest', {})
      const rootRef = JSON.parse(manifest.content).roots[0].root_ref

      const result = await executeTool('user', cache, 'git_diff', {
        root_ref: rootRef,
        file_paths: filePaths,
      })

      expect(result.isError).toBe(true)
      expect(gitDiff).not.toHaveBeenCalled()
    }
  )
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

function installDesktopWorkspace(
  files: Map<string, DesktopWorkspaceFile>,
  looseFiles: DesktopWorkspaceFile[] = []
) {
  const readFile = vi.fn(
    async (path: string, _runHooks: boolean, receivedBinding: DesktopWorkspaceBinding) => {
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
  const gitDiff = vi.fn(async () => ({ ok: true, stdout: '' }))
  const createFile = vi.fn(
    async (
      rootPath: string,
      relativePath: string,
      content: string,
      _approvalMode: string,
      _origin: unknown,
      receivedBinding: DesktopWorkspaceBinding
    ) => {
      if (receivedBinding !== binding) {
        return { ok: false, error: 'binding mismatch' }
      }
      const path = `${rootPath}/${relativePath}`.replace(/\/+/g, '/')
      const file: DesktopWorkspaceFile = {
        ...workspaceFile(path, relativePath.split('/').at(-1) || 'created.ts'),
        relativePath,
        content,
        size: content.length,
        modifiedAt: '2026-08-12T00:01:00.000Z',
      }
      files.set(path, file)
      return { ok: true, changed: true, file }
    }
  )
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
          createFile,
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
  return { readFile, writeFile, createFile, gitDiff, state }
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
