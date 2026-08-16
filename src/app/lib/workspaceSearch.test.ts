import { describe, expect, it } from 'vitest'
import type { DesktopWorkspaceSearchResult } from './desktop'
import {
  mergeWorkspaceSearchResults,
  shouldUseDirectWorkspaceSearch,
} from './workspaceSearch'

function result(
  path: string,
  match: DesktopWorkspaceSearchResult['match'],
  line: number | null = null
): DesktopWorkspaceSearchResult {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    relativePath: path,
    kind: 'file',
    extension: 'ts',
    size: 10,
    modifiedAt: '',
    match,
    line,
    preview: path,
  }
}

describe('workspace search fallback', () => {
  it('uses the direct scanner while the index is cold or has no matches', () => {
    expect(shouldUseDirectWorkspaceSearch('indexing', 2)).toBe(true)
    expect(shouldUseDirectWorkspaceSearch('error', 0)).toBe(true)
    expect(shouldUseDirectWorkspaceSearch('ready', 0)).toBe(true)
    expect(shouldUseDirectWorkspaceSearch('ready', 2)).toBe(false)
  })

  it('does not rescan after a ready index returns matches', () => {
    expect(shouldUseDirectWorkspaceSearch('ready', 2)).toBe(false)
  })

  it('merges direct results after indexed results without duplicate locations', () => {
    const indexed = [result('/root/a.ts', 'symbol', 4)]
    const direct = [
      result('/root/a.ts', 'content', 4),
      result('/outside/b.ts', 'name'),
    ]

    expect(mergeWorkspaceSearchResults(indexed, direct, 'hybrid')).toEqual([
      indexed[0],
      direct[1],
    ])
  })

  it('keeps direct fallbacks consistent with file and content modes', () => {
    const direct = [
      result('/root/name.ts', 'name'),
      result('/root/content.ts', 'content', 2),
    ]

    expect(mergeWorkspaceSearchResults([], direct, 'files')).toEqual([direct[0]])
    expect(mergeWorkspaceSearchResults([], direct, 'content')).toEqual([direct[1]])
    expect(mergeWorkspaceSearchResults([], direct, 'symbols')).toEqual(direct)
  })
})
