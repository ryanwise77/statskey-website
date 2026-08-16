import { describe, expect, it } from 'vitest'
import {
  normalizeGitDiffInput,
  normalizeWorkspaceReadInput,
  normalizeWorkspaceWriteEdits,
} from './workspaceToolInput'

describe('workspace_read input normalization', () => {
  it('recovers the observed JSON-stringified file_paths array', () => {
    expect(
      normalizeWorkspaceReadInput({
        file_paths:
          '["src/app/routes/Workspace.tsx","src/app/lib/ai/tools.ts"]',
      })
    ).toEqual({
      fileRefs: [],
      filePaths: [
        'src/app/routes/Workspace.tsx',
        'src/app/lib/ai/tools.ts',
      ],
    })
  })

  it('accepts the supported singular file_ref and file_path aliases', () => {
    expect(
      normalizeWorkspaceReadInput({
        file_ref: 'workspace_opaque_ref',
        file_path:
          '/Users/ryansullivan/Projects/StatsKey Website/desktop/main.cjs',
      })
    ).toEqual({
      fileRefs: ['workspace_opaque_ref'],
      filePaths: [
        '/Users/ryansullivan/Projects/StatsKey Website/desktop/main.cjs',
      ],
    })
  })

  it('normalizes positive integer line ranges without broadening paths', () => {
    expect(
      normalizeWorkspaceReadInput({
        file_path: 'Sources/Large.swift',
        start_line: 401,
        end_line: 775,
      })
    ).toEqual({
      fileRefs: [],
      filePaths: ['Sources/Large.swift'],
      startLine: 401,
      endLine: 775,
    })
    expect(
      normalizeWorkspaceReadInput({
        file_path: 'Sources/Large.swift',
        start_line: '401',
        end_line: '775',
      })
    ).toEqual({
      fileRefs: [],
      filePaths: ['Sources/Large.swift'],
      startLine: 401,
      endLine: 775,
    })
  })

  it('fails closed for noncanonical or out-of-bounds line values', () => {
    for (const value of [
      -4,
      0,
      1.5,
      '0',
      '0486',
      ' 486 ',
      '+486',
      '4.86e2',
      '2147483648',
      null,
    ]) {
      expect(
        normalizeWorkspaceReadInput({
          file_path: 'Sources/Large.swift',
          start_line: value,
        })
      ).toMatchObject({
        fileRefs: [],
        filePaths: ['Sources/Large.swift'],
        error: expect.stringContaining('Malformed workspace_read line range'),
      })
    }
  })

  it('remains bounded and never coerces non-string values into paths', () => {
    const values = Array.from({ length: 12 }, (_, index) => `src/${index}.ts`)
    const normalized = normalizeWorkspaceReadInput({
      file_paths: JSON.stringify([...values, { path: '/etc/passwd' }, 42]),
      file_path: '/outside/not-reached.ts',
    })

    expect(normalized.fileRefs).toEqual([])
    expect(normalized.filePaths).toEqual(values.slice(0, 8))
  })

  it('deduplicates values and rejects empty, NUL, and oversized entries', () => {
    expect(
      normalizeWorkspaceReadInput({
        file_refs: ['ref_1', 'ref_1', '', `bad\0ref`, 'x'.repeat(32_769)],
        file_paths: ['src/a.ts', 'src/a.ts'],
      })
    ).toEqual({ fileRefs: ['ref_1'], filePaths: ['src/a.ts'] })
  })

  it('recovers JSON-stringified git_diff paths with the same bounded rules', () => {
    expect(
      normalizeGitDiffInput({
        file_paths: '["src/a.ts","src/b.ts"]',
        file_path: 'src/c.ts',
      })
    ).toEqual({
      ok: true,
      filePaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    })
  })

  it('fails closed instead of broadening an explicitly malformed Git scope', () => {
    for (const filePaths of ['[]', [], {}, [42], ['src/a.ts', 42]]) {
      expect(normalizeGitDiffInput({ file_paths: filePaths })).toMatchObject({
        ok: false,
      })
    }
    expect(normalizeGitDiffInput({})).toEqual({ ok: true, filePaths: [] })
  })

  it('recovers a JSON-stringified workspace patch edit array', () => {
    expect(
      normalizeWorkspaceWriteEdits(
        '[{"old_text":"before","new_text":"after"}]',
        true
      )
    ).toEqual({
      ok: true,
      edits: [{ old_text: 'before', new_text: 'after' }],
    })
  })

  it('fails closed for a malformed present workspace patch value', () => {
    expect(normalizeWorkspaceWriteEdits('not-json', true)).toMatchObject({
      ok: false,
    })
    expect(
      normalizeWorkspaceWriteEdits(
        '[{"old_text":"","new_text":"replacement"}]',
        true
      )
    ).toMatchObject({ ok: false })
    expect(normalizeWorkspaceWriteEdits([], true)).toMatchObject({ ok: false })
    expect(normalizeWorkspaceWriteEdits(null, true)).toMatchObject({ ok: false })
  })
})
