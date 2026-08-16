const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  WORKSPACE_BINDING_ERROR,
  assertUnprefixedWorkspaceCreatePath,
  assertWorkspaceOperationBinding,
  currentWorkspaceIdentity,
  cursorWorkspaceLocations,
  defaultWorkspaceLabel,
  parseWorkspaceDefinitionText,
  readWorkspaceDirectoryEntries,
  resolveWorkspaceDefinitionFile,
  resolveWorkspaceFolderDefinitions,
  workspaceDisplayPath,
  workspaceIdentity,
} = require('./workspace-runtime.cjs')

function withWorkspaceFixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'statskey-workspace-'))
  try {
    return run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function directoryResolver(candidate) {
  try {
    const resolved = fs.realpathSync(candidate)
    return fs.statSync(resolved).isDirectory() ? resolved : null
  } catch {
    return null
  }
}

function fileResolver(candidate) {
  try {
    const resolved = fs.realpathSync(candidate)
    return fs.statSync(resolved).isFile() ? resolved : null
  } catch {
    return null
  }
}

function importWorkspace(workspaceFile, options = {}) {
  return resolveWorkspaceDefinitionFile(workspaceFile, {
    readFile: (candidate) => fs.readFileSync(candidate),
    resolveFile: fileResolver,
    resolveDirectory: directoryResolver,
    ...options,
  })
}

test('workspace import resolves relative paths and file URLs without duplicates', () => {
  const base = path.resolve(path.sep, 'projects')
  const alpha = path.join(base, 'alpha')
  const beta = path.join(base, 'beta')
  const available = new Set([alpha, beta])
  const result = resolveWorkspaceFolderDefinitions(
    [
      { path: 'alpha' },
      { uri: pathToFileURL(beta).href },
      { path: './alpha' },
      { path: 'missing' },
    ],
    base,
    (candidate) => available.has(candidate) ? candidate : null
  )
  assert.deepEqual(result, {
    roots: [alpha, beta],
    missingFolders: 1,
  })
})

test('Cursor workspace migration reads local folders and workspace files safely', () => {
  const statsKey = path.resolve(path.sep, 'Users', 'person', 'Projects', 'StatsKey')
  const workspaceFile = path.resolve(
    path.sep,
    'Users',
    'person',
    'Projects',
    'Personal Training.code-workspace'
  )
  const storage = {
    profileAssociations: {
      workspaces: {
        [pathToFileURL(statsKey).href]: '__default__profile__',
        [pathToFileURL(workspaceFile).href]: '__default__profile__',
        'https://example.com/remote': '__default__profile__',
        'untitled:Untitled-1': '__default__profile__',
      },
    },
    backupWorkspaces: {
      workspaces: [{ configURIPath: pathToFileURL(workspaceFile).href }],
      folders: [{ folderUri: pathToFileURL(statsKey).href }],
    },
  }

  assert.deepEqual(cursorWorkspaceLocations(storage), [statsKey, workspaceFile])
  assert.deepEqual(cursorWorkspaceLocations(null), [])
})

test('workspace import bounds definitions and treats invalid entries as missing', () => {
  const folders = Array.from({ length: 105 }, (_, index) => ({
    path: `folder-${index}`,
  }))
  const result = resolveWorkspaceFolderDefinitions(
    [{ uri: 'file:%zz' }, ...folders],
    path.sep,
    (candidate) => candidate
  )
  assert.equal(result.roots.length, 99)
  assert.equal(result.missingFolders, 1)
})

test('multi-folder workspace labels stay compact', () => {
  assert.equal(defaultWorkspaceLabel(['/projects/StatsKey']), 'StatsKey')
  assert.equal(
    defaultWorkspaceLabel(['/projects/StatsKey', '/projects/Research']),
    'StatsKey +1'
  )
})

test('one-folder workspaces report paths relative to the open root', () => {
  assert.equal(
    workspaceDisplayPath('/projects/MacRemote/Package.swift', [
      '/projects/MacRemote',
    ]),
    'Package.swift'
  )
  assert.equal(
    workspaceDisplayPath('/projects/MacRemote/Sources/App.swift', [
      '/projects/MacRemote',
    ]),
    'Sources/App.swift'
  )
  assert.equal(
    workspaceDisplayPath('/projects/B/Sources/App.swift', [
      '/projects/A',
      '/projects/B',
    ]),
    'B/Sources/App.swift'
  )
})

test('workspace create rejects an unambiguous duplicated root-name prefix', () => {
  withWorkspaceFixture((parent) => {
    const root = path.join(parent, 'StatsKey')
    fs.mkdirSync(path.join(root, 'biometrics'), { recursive: true })
    assert.throws(
      () =>
        assertUnprefixedWorkspaceCreatePath(
          root,
          'StatsKey/biometrics/StatsKey/Utilities/Helper.swift',
          { exists: fs.existsSync }
        ),
      /already prefixed.*Use "biometrics\/StatsKey\/Utilities\/Helper\.swift"/i
    )
    for (const prefixed of [
      './StatsKey/biometrics/StatsKey/Utilities/Helper.swift',
      'placeholder/../StatsKey/biometrics/StatsKey/Utilities/Helper.swift',
    ]) {
      assert.throws(
        () =>
          assertUnprefixedWorkspaceCreatePath(root, prefixed, {
            exists: fs.existsSync,
          }),
        /already prefixed/i
      )
    }
    assert.throws(
      () =>
        assertUnprefixedWorkspaceCreatePath(
          root,
          path.join(root, 'StatsKey/biometrics/StatsKey/Utilities/Helper.swift'),
          { exists: fs.existsSync }
        ),
      /relative to the selected workspace root/i
    )
    assert.equal(fs.existsSync(path.join(root, 'StatsKey')), false)
  })
})

test('workspace create preserves a legitimate existing nested directory matching the root name', () => {
  withWorkspaceFixture((parent) => {
    const root = path.join(parent, 'StatsKey')
    fs.mkdirSync(path.join(root, 'StatsKey'), { recursive: true })
    assert.doesNotThrow(() =>
      assertUnprefixedWorkspaceCreatePath(root, 'StatsKey/Sources/App.swift', {
        exists: fs.existsSync,
      })
    )
  })
})

test('workspace identity includes loose files as well as roots', () => {
  const roots = ['/projects/StatsKey']
  const first = workspaceIdentity(roots, ['/notes/first.md'])
  const second = workspaceIdentity(roots, ['/notes/second.md'])
  assert.notEqual(first, second)
  assert.equal(
    first,
    workspaceIdentity(['/projects/StatsKey'], ['/notes/first.md'])
  )
  assert.equal(
    currentWorkspaceIdentity([], ['/notes/first.md']),
    workspaceIdentity([], ['/notes/first.md'])
  )
  assert.equal(currentWorkspaceIdentity([], []), null)
})

test('a workspace switch blocks a bound operation before it can write', () => {
  const original = currentWorkspaceIdentity(
    ['/projects/StatsKey'],
    ['/notes/plan.md']
  )
  const switched = currentWorkspaceIdentity(
    ['/projects/Other'],
    ['/notes/plan.md']
  )
  const binding = { workspaceId: original }
  let wrote = false
  assert.doesNotThrow(() => assertWorkspaceOperationBinding(binding, original))
  assert.throws(
    () => {
      assertWorkspaceOperationBinding(binding, switched)
      wrote = true
    },
    (error) =>
      error?.code === 'WORKSPACE_BINDING_MISMATCH' &&
      error.message === WORKSPACE_BINDING_ERROR
  )
  assert.equal(wrote, false)
})

test('workspace directory reads distinguish empty folders from sanitized failures', () => {
  withWorkspaceFixture((directory) => {
    const empty = path.join(directory, 'empty')
    const file = path.join(directory, 'file.txt')
    fs.mkdirSync(empty)
    fs.writeFileSync(file, 'not a directory')
    const isAllowed = (candidate) => candidate === fs.realpathSync(empty)

    assert.deepEqual(
      readWorkspaceDirectoryEntries(empty, { isAllowed }),
      { path: fs.realpathSync(empty), entries: [] }
    )
    assert.throws(
      () =>
        readWorkspaceDirectoryEntries(path.join(directory, 'missing'), {
          isAllowed: () => true,
        }),
      (error) =>
        error?.code === 'WORKSPACE_DIRECTORY_READ_FAILED' &&
        error.message ===
          'This workspace folder is no longer available. Reopen it or remove it from the workspace.' &&
        !error.message.includes(directory)
    )
    assert.throws(
      () =>
        readWorkspaceDirectoryEntries(file, { isAllowed: () => true }),
      /This workspace item is not a folder/
    )
    assert.throws(
      () =>
        readWorkspaceDirectoryEntries(empty, {
          isAllowed: () => false,
        }),
      /outside the open workspace/
    )

    const permissionError = new Error(`EACCES: ${directory}/private`)
    permissionError.code = 'EACCES'
    assert.throws(
      () =>
        readWorkspaceDirectoryEntries(empty, {
          isAllowed,
          readDirectory() {
            throw permissionError
          },
        }),
      (error) =>
        error?.code === 'WORKSPACE_DIRECTORY_READ_FAILED' &&
        error.message ===
          'StatsKey cannot read this workspace folder. Check its permissions and try again.' &&
        !error.message.includes(directory)
    )
  })
})

test('workspace definition parser accepts a BOM, comments, and trailing commas', () => {
  const parsed = parseWorkspaceDefinitionText(`\uFEFF{
    // Cursor and VS Code both use JSON with comments here.
    "folders": [
      { "path": "project", },
    ],
    "settings": { "example": "// remains text", },
  }`)
  assert.deepEqual(parsed, {
    folders: [{ path: 'project' }],
    settings: { example: '// remains text' },
  })
})

test('workspace import supports compatible path and file URI variants', () => {
  withWorkspaceFixture((directory) => {
    const definitions = path.join(directory, 'definitions')
    const alpha = path.join(directory, 'alpha')
    const spaced = path.join(directory, 'space name')
    fs.mkdirSync(definitions)
    fs.mkdirSync(alpha)
    fs.mkdirSync(spaced)
    const workspaceFile = path.join(definitions, 'Portable.code-workspace')
    const portableRelative =
      process.platform === 'win32' ? '..\\alpha' : '..\\alpha'
    fs.writeFileSync(
      workspaceFile,
      `\uFEFF{
        // A portable multi-root workspace.
        "folders": [
          { "path": ${JSON.stringify(portableRelative)} },
          { "path": "../space%20name" },
          { "uri": ${JSON.stringify(
            pathToFileURL(spaced).href.replace(/^file:/, 'FILE:')
          )} },
        ],
      }`
    )

    const result = importWorkspace(workspaceFile)
    assert.deepEqual(result, {
      roots: [fs.realpathSync(alpha), fs.realpathSync(spaced)],
      missingFolders: 0,
      sourcePath: fs.realpathSync(workspaceFile),
      name: 'Portable.code-workspace',
    })
  })
})

test('workspace import accepts a top-level folder path or file URI', () => {
  withWorkspaceFixture((directory) => {
    const folder = path.join(directory, 'single folder')
    fs.mkdirSync(folder)
    const pathFile = path.join(directory, 'path.json')
    const uriFile = path.join(directory, 'uri.json')
    fs.writeFileSync(pathFile, JSON.stringify({ path: 'single folder' }))
    fs.writeFileSync(
      uriFile,
      JSON.stringify({ folderUri: pathToFileURL(folder).href })
    )

    assert.deepEqual(importWorkspace(pathFile).roots, [fs.realpathSync(folder)])
    assert.deepEqual(importWorkspace(uriFile).roots, [fs.realpathSync(folder)])
  })
})

test('workspace import follows local workspace references recursively', () => {
  withWorkspaceFixture((directory) => {
    const project = path.join(directory, 'project')
    fs.mkdirSync(project)
    const nested = path.join(directory, 'nested.code-workspace')
    const entry = path.join(directory, 'entry.json')
    fs.writeFileSync(nested, JSON.stringify({ folders: [{ path: 'project' }] }))
    fs.writeFileSync(
      entry,
      JSON.stringify({
        workspace: {
          configPath: pathToFileURL(nested).href.replace(/^file:/, 'FiLe:'),
        },
      })
    )

    const result = importWorkspace(entry)
    assert.deepEqual(result.roots, [fs.realpathSync(project)])
    assert.equal(result.sourcePath, fs.realpathSync(entry))
    assert.equal(result.name, 'entry.json')
  })
})

test('workspace references reject remote, circular, and overly deep imports', () => {
  withWorkspaceFixture((directory) => {
    const remote = path.join(directory, 'remote.json')
    fs.writeFileSync(
      remote,
      JSON.stringify({ workspace: 'vscode-remote://ssh-remote+host/project' })
    )
    assert.throws(
      () => importWorkspace(remote),
      /Only local workspace files can be imported/
    )

    const first = path.join(directory, 'first.json')
    const second = path.join(directory, 'second.json')
    const third = path.join(directory, 'third.json')
    fs.writeFileSync(first, JSON.stringify({ workspace: 'second.json' }))
    fs.writeFileSync(second, JSON.stringify({ workspace: 'first.json' }))
    assert.throws(
      () => importWorkspace(first),
      /circular workspace reference/
    )

    fs.writeFileSync(second, JSON.stringify({ workspace: 'third.json' }))
    fs.writeFileSync(third, JSON.stringify({ folders: [] }))
    assert.throws(
      () => importWorkspace(first, { maxDepth: 1 }),
      /too many nested workspace references/
    )
  })
})

test('workspace path decoding preserves literal names and rejects encoded separators', () => {
  withWorkspaceFixture((directory) => {
    const literal = path.join(directory, 'space%20name')
    const decoded = path.join(directory, 'space name')
    const nested = path.join(directory, 'escape', 'target')
    fs.mkdirSync(literal)
    fs.mkdirSync(decoded)
    fs.mkdirSync(nested, { recursive: true })

    const literalFile = path.join(directory, 'literal.json')
    fs.writeFileSync(literalFile, JSON.stringify({ path: 'space%20name' }))
    assert.deepEqual(importWorkspace(literalFile).roots, [fs.realpathSync(literal)])

    const encodedSeparatorFile = path.join(directory, 'encoded-separator.json')
    fs.writeFileSync(
      encodedSeparatorFile,
      JSON.stringify({ path: 'escape%2Ftarget' })
    )
    assert.throws(
      () => importWorkspace(encodedSeparatorFile),
      /None of the folders in this workspace are available/
    )
  })
})

test('workspace import reports missing, oversized, and incompatible definitions', () => {
  withWorkspaceFixture((directory) => {
    const missing = path.join(directory, 'missing.json')
    fs.writeFileSync(missing, JSON.stringify({ folders: [{ path: 'gone' }] }))
    assert.throws(
      () => importWorkspace(missing),
      /None of the folders in this workspace are available/
    )

    const empty = path.join(directory, 'empty.json')
    fs.writeFileSync(empty, JSON.stringify({ folders: [] }))
    assert.throws(
      () => importWorkspace(empty),
      /does not contain any folders/
    )

    const incompatible = path.join(directory, 'incompatible.json')
    fs.writeFileSync(incompatible, JSON.stringify({ settings: {} }))
    assert.throws(
      () => importWorkspace(incompatible),
      /not a compatible workspace file/
    )

    const oversized = path.join(directory, 'oversized.json')
    fs.writeFileSync(oversized, JSON.stringify({ folders: [] }))
    assert.throws(
      () => importWorkspace(oversized, { maxBytes: 4 }),
      /Workspace file is too large/
    )
  })
})
