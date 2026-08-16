export type DiffLineKind = 'add' | 'remove' | 'context' | 'meta'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFileSection {
  path: string
  oldPath: string | null
  binary: boolean
  hunks: DiffHunk[]
}

export function parseUnifiedDiff(diffText: string): DiffFileSection[] {
  const sections: DiffFileSection[] = []
  let file: DiffFileSection | null = null
  let hunk: DiffHunk | null = null
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const marker = line.lastIndexOf(' b/')
      file = {
        path: marker >= 0 ? line.slice(marker + 3).replace(/"$/, '') : line,
        oldPath: null,
        binary: false,
        hunks: [],
      }
      hunk = null
      sections.push(file)
      continue
    }
    if (!file) continue
    if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) {
      if (line.startsWith('rename from ') || line.startsWith('--- a/')) {
        file.oldPath = line.replace(/^rename from |^--- a\//, '') || null
      }
      if (line.startsWith('Binary files ')) file.binary = true
      continue
    }
    hunk.lines.push({
      kind: line.startsWith('+')
        ? 'add'
        : line.startsWith('-')
          ? 'remove'
          : line.startsWith('\\')
            ? 'meta'
            : 'context',
      text: line.length > 0 && !line.startsWith('\\') ? line.slice(1) : line,
    })
  }
  return sections
}

export function composeCommitNotice(rawOutput: string): string {
  const head = rawOutput.match(/^\[(.+?)\]/m)
  const hash = head?.[1].split(' ').pop()
  if (!hash) return 'Commit created.'
  const changed = rawOutput.match(/(\d+) files? changed/)
  const count = changed ? Number(changed[1]) : null
  return count
    ? `Committed ${hash} — ${count} file${count === 1 ? '' : 's'}`
    : `Committed ${hash}`
}

export function parseGitBranch(statusOutput: string | undefined): string | null {
  const line = statusOutput
    ?.split('\n')
    .find((entry) => entry.startsWith('## '))
  if (!line) return null
  const label = line.slice(3).trim()
  if (!label) return null
  if (label.startsWith('No commits yet on ')) {
    return label.slice('No commits yet on '.length).trim() || null
  }
  if (label.startsWith('HEAD (no branch)')) return 'detached HEAD'
  return label.split('...')[0].trim() || null
}
