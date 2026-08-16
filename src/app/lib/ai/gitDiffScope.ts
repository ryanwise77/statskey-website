export function normalizeScopedDiffPath(value: string): string | null {
  const path = value.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\0') ||
    path
      .split('/')
      .some((segment) => segment === '..' || segment === '.' || segment === '')
  ) {
    return null
  }
  return path
}

export function selectGitDiffSections(
  diff: string,
  requestedPaths: Set<string>
): { diff: string; paths: string[] } {
  if (!diff.trim() || requestedPaths.size === 0) return { diff: '', paths: [] }
  const selected: string[] = []
  const paths: string[] = []
  for (const section of diff.split(/(?=^diff --git )/m)) {
    if (!section.startsWith('diff --git ')) continue
    const afterPath = section.match(/^\+\+\+ b\/(.+)$/m)?.[1]
    const beforePath = section.match(/^--- a\/(.+)$/m)?.[1]
    const path = normalizeScopedDiffPath(afterPath || beforePath || '')
    if (!path || !requestedPaths.has(path)) continue
    selected.push(section.trimEnd())
    paths.push(path)
  }
  return { diff: selected.join('\n'), paths: [...new Set(paths)] }
}
