import { describe, expect, it } from 'vitest'
import {
  composeCommitNotice,
  parseGitBranch,
  parseUnifiedDiff,
} from './unifiedDiff'

const SAMPLE_DIFF = [
  'diff --git a/src/alpha.ts b/src/alpha.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/alpha.ts',
  '+++ b/src/alpha.ts',
  '@@ -1,3 +1,4 @@',
  ' const one = 1',
  '-const two = 3',
  '+const two = 2',
  '+const three = 3',
  '@@ -10,2 +11,2 @@',
  ' export {}',
  '\\ No newline at end of file',
  'diff --git a/assets/logo.png b/assets/logo.png',
  'Binary files a/assets/logo.png and b/assets/logo.png differ',
].join('\n')

describe('parseUnifiedDiff', () => {
  it('splits files, hunks, and line kinds', () => {
    const sections = parseUnifiedDiff(SAMPLE_DIFF)
    expect(sections).toHaveLength(2)
    expect(sections[0].path).toBe('src/alpha.ts')
    expect(sections[0].hunks).toHaveLength(2)
    expect(sections[0].hunks[0].header).toBe('@@ -1,3 +1,4 @@')
    expect(sections[0].hunks[0].lines.map((line) => line.kind)).toEqual([
      'context',
      'remove',
      'add',
      'add',
    ])
    expect(sections[0].hunks[0].lines[1].text).toBe('const two = 3')
    expect(sections[0].hunks[1].lines[1].kind).toBe('meta')
    expect(sections[1].path).toBe('assets/logo.png')
    expect(sections[1].binary).toBe(true)
    expect(sections[1].hunks).toHaveLength(0)
  })

  it('captures the old path for renames', () => {
    const sections = parseUnifiedDiff(
      [
        'diff --git a/old-name.ts b/new-name.ts',
        'similarity index 96%',
        'rename from old-name.ts',
        'rename to new-name.ts',
      ].join('\n')
    )
    expect(sections[0].path).toBe('new-name.ts')
    expect(sections[0].oldPath).toBe('old-name.ts')
  })

  it('returns nothing for empty or unrecognized text', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('fatal: not a git repository')).toEqual([])
  })
})

describe('composeCommitNotice', () => {
  it('composes hash and file count from commit output', () => {
    const raw = [
      '[main abc1234] Improve the changes panel',
      ' 3 files changed, 41 insertions(+), 9 deletions(-)',
    ].join('\n')
    expect(composeCommitNotice(raw)).toBe('Committed abc1234 — 3 files')
  })

  it('handles root commits and single files', () => {
    const raw = [
      '[main (root-commit) f00dfee] First commit',
      ' 1 file changed, 1 insertion(+)',
    ].join('\n')
    expect(composeCommitNotice(raw)).toBe('Committed f00dfee — 1 file')
  })

  it('falls back when output is not recognizable', () => {
    expect(composeCommitNotice('')).toBe('Commit created.')
  })
})

describe('parseGitBranch', () => {
  it('reads the branch from a status --branch header', () => {
    expect(parseGitBranch('## main...origin/main [ahead 1]\n M a.ts')).toBe(
      'main'
    )
    expect(parseGitBranch('## feature/panel')).toBe('feature/panel')
  })

  it('handles unborn and detached states', () => {
    expect(parseGitBranch('## No commits yet on main')).toBe('main')
    expect(parseGitBranch('## HEAD (no branch)')).toBe('detached HEAD')
  })

  it('returns null when no branch header exists', () => {
    expect(parseGitBranch(undefined)).toBeNull()
    expect(parseGitBranch(' M a.ts')).toBeNull()
  })
})
