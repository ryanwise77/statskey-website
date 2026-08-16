import type {
  DesktopWorkspaceIndexState,
  DesktopWorkspaceSearchMode,
  DesktopWorkspaceSearchResult,
} from './desktop'

const DEFAULT_RESULT_LIMIT = 150

export function shouldUseDirectWorkspaceSearch(
  indexStatus: DesktopWorkspaceIndexState['status'] | null | undefined,
  indexedResultCount: number
): boolean {
  return indexStatus !== 'ready' || indexedResultCount === 0
}

export function mergeWorkspaceSearchResults(
  indexed: DesktopWorkspaceSearchResult[],
  direct: DesktopWorkspaceSearchResult[],
  mode: DesktopWorkspaceSearchMode,
  limit = DEFAULT_RESULT_LIMIT
): DesktopWorkspaceSearchResult[] {
  const merged: DesktopWorkspaceSearchResult[] = []
  const seen = new Set<string>()

  const append = (result: DesktopWorkspaceSearchResult) => {
    const key = `${result.path}\u0000${result.line ?? ''}`
    if (seen.has(key) || merged.length >= limit) return
    seen.add(key)
    merged.push(result)
  }

  indexed.forEach(append)
  direct.filter((result) => directResultMatchesMode(result, mode)).forEach(append)
  return merged
}

function directResultMatchesMode(
  result: DesktopWorkspaceSearchResult,
  mode: DesktopWorkspaceSearchMode
): boolean {
  if (mode === 'files') return result.match === 'name'
  if (mode === 'content') return result.match === 'content'
  // The direct scanner does not classify symbols or fuzzy matches. When the
  // richer index is unavailable, its name/content hits are still useful.
  return true
}
