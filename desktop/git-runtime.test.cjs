const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeGitDiffPaths,
  parsePorcelainStatus,
} = require('./git-runtime.cjs')

test('Git status parser separates staged, unstaged, and untracked files', () => {
  const files = parsePorcelainStatus(
    [
      'M  staged.txt',
      ' M working.txt',
      'MM both.txt',
      '?? new file.txt',
      '',
    ].join('\0')
  )
  assert.deepEqual(
    files.map(({ path, staged, unstaged, untracked }) => ({
      path,
      staged,
      unstaged,
      untracked,
    })),
    [
      { path: 'staged.txt', staged: true, unstaged: false, untracked: false },
      { path: 'working.txt', staged: false, unstaged: true, untracked: false },
      { path: 'both.txt', staged: true, unstaged: true, untracked: false },
      { path: 'new file.txt', staged: false, unstaged: true, untracked: true },
    ]
  )
})

test('Git status parser retains rename source and destination paths', () => {
  const files = parsePorcelainStatus('R  new name.txt\0old name.txt\0')
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'new name.txt')
  assert.equal(files[0].originalPath, 'old name.txt')
  assert.equal(files[0].staged, true)
})

test('Git diff paths use literal bounded pathspecs', () => {
  assert.deepEqual(
    normalizeGitDiffPaths(['src/a.ts', './folder/file [1].swift']),
    [':(literal)src/a.ts', ':(literal)folder/file [1].swift']
  )
})

test('Git diff paths reject traversal, absolute paths, magic, and mixed values', () => {
  for (const value of [
    ['../secret'],
    ['/tmp/secret'],
    ['C:\\secret'],
    [':(glob)**'],
    ['src//file'],
    ['.'],
    ['src/./file'],
    ['src/a', 42],
    [],
  ]) {
    assert.throws(() => normalizeGitDiffPaths(value))
  }
})
