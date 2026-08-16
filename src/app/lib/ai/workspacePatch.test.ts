import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceEdits,
  workspacePatchEdits,
  workspaceReplacementContent,
} from './workspacePatch'

describe('safe workspace patches', () => {
  it('applies multiple exact edits without replacing untouched file content', () => {
    expect(
      applyWorkspaceEdits('before\nkeep\nafter\n', [
        { oldText: 'before', newText: 'changed' },
        { oldText: 'after', newText: 'verified' },
      ])
    ).toBe('changed\nkeep\nverified\n')
  })

  it('rejects ambiguous text instead of changing the wrong location', () => {
    expect(() =>
      applyWorkspaceEdits('same\nkeep\nsame\n', [
        { oldText: 'same', newText: 'changed' },
      ])
    ).toThrow('matched more than once')
  })

  it('decodes only bounded exact edits from tool input', () => {
    expect(
      workspacePatchEdits([
        { old_text: 'old', new_text: 'new' },
        { old_text: '', new_text: 'ignored' },
      ])
    ).toEqual([{ oldText: 'old', newText: 'new' }])
  })

  it('treats a managed-adapter empty content default as omitted for exact edits', () => {
    const edits = [{ oldText: 'old', newText: 'new' }]
    expect(workspaceReplacementContent('', edits)).toBeUndefined()
    expect(workspaceReplacementContent(undefined, edits)).toBeUndefined()
    expect(workspaceReplacementContent('complete file', edits)).toBe(
      'complete file'
    )
    expect(workspaceReplacementContent('', [])).toBe('')
  })
})
