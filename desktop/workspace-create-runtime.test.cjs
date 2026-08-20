'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  DEFAULT_PROJECTS_ROOT_NAME,
  createProjectInDefaultRoot,
  validateProjectFolderName,
} = require('./workspace-create-runtime.cjs')

function withHome(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'statskey-create-'))
  try {
    return run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('project folder names stay a single safe path segment', () => {
  for (const rejected of [
    '',
    '   ',
    '.hidden',
    '..',
    'a/b',
    'a\\b',
    'name.',
    'CON',
    'com1',
    'lpt9',
    'a'.repeat(81),
    'bad\tname',
    'bad\0name',
  ]) {
    assert.equal(
      validateProjectFolderName(rejected).ok,
      false,
      JSON.stringify(rejected)
    )
  }
  assert.deepEqual(validateProjectFolderName('  My Project  '), {
    ok: true,
    name: 'My Project',
  })
  assert.equal(validateProjectFolderName(null).ok, false)
  assert.equal(validateProjectFolderName(42).ok, false)
})

test('the default root is created on first use', () =>
  withHome((home) => {
    const result = createProjectInDefaultRoot({
      homeDirectory: home,
      name: 'Oil Data',
    })
    assert.equal(result.ok, true)
    assert.equal(
      result.path,
      path.join(home, DEFAULT_PROJECTS_ROOT_NAME, 'Oil Data')
    )
    assert.equal(result.root, path.join(home, DEFAULT_PROJECTS_ROOT_NAME))
    assert.ok(fs.statSync(result.path).isDirectory())
  }))

test('creation fails cleanly when the folder already exists', () =>
  withHome((home) => {
    const first = createProjectInDefaultRoot({
      homeDirectory: home,
      name: 'StatsKey',
    })
    assert.equal(first.ok, true)
    const second = createProjectInDefaultRoot({
      homeDirectory: home,
      name: 'StatsKey',
    })
    assert.equal(second.ok, false)
    assert.match(second.error, /already exists/)
  }))

test('invalid names are rejected before touching the filesystem', () =>
  withHome((home) => {
    const escaped = createProjectInDefaultRoot({
      homeDirectory: home,
      name: '../escape',
    })
    assert.equal(escaped.ok, false)
    assert.ok(!fs.existsSync(path.join(home, 'escape')))
    assert.ok(!fs.existsSync(path.join(home, DEFAULT_PROJECTS_ROOT_NAME)))
    assert.equal(
      createProjectInDefaultRoot({ homeDirectory: '', name: 'x' }).ok,
      false
    )
  }))
