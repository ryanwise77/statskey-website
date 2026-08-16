import { describe, expect, it } from 'vitest'
import {
  normalizeScopedDiffPath,
  selectGitDiffSections,
} from './gitDiffScope'

const DIFF = `diff --git a/Sources/Activity.swift b/Sources/Activity.swift
index 111..222 100644
--- a/Sources/Activity.swift
+++ b/Sources/Activity.swift
@@ -1 +1 @@
-old
+new
diff --git a/Sources/Unrelated.swift b/Sources/Unrelated.swift
index 333..444 100644
--- a/Sources/Unrelated.swift
+++ b/Sources/Unrelated.swift
@@ -1 +1 @@
-before
+after`

describe('task-scoped Git diff selection', () => {
  it('keeps only explicitly adopted task files', () => {
    const selected = selectGitDiffSections(
      DIFF,
      new Set(['Sources/Activity.swift'])
    )
    expect(selected.paths).toEqual(['Sources/Activity.swift'])
    expect(selected.diff).toContain('Sources/Activity.swift')
    expect(selected.diff).not.toContain('Sources/Unrelated.swift')
  })

  it('returns no implementation evidence for an absent or empty scope', () => {
    expect(
      selectGitDiffSections(DIFF, new Set(['Sources/Missing.swift']))
    ).toEqual({ diff: '', paths: [] })
    expect(selectGitDiffSections('', new Set(['Sources/Activity.swift']))).toEqual({
      diff: '',
      paths: [],
    })
  })

  it('rejects paths that escape the workspace', () => {
    expect(normalizeScopedDiffPath('../Secrets.txt')).toBeNull()
    expect(normalizeScopedDiffPath('/tmp/Secrets.txt')).toBeNull()
    expect(normalizeScopedDiffPath('.')).toBeNull()
    expect(normalizeScopedDiffPath('Sources/./Activity.swift')).toBeNull()
    expect(normalizeScopedDiffPath('Sources/Activity.swift')).toBe(
      'Sources/Activity.swift'
    )
  })
})
