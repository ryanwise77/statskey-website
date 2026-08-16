const test = require('node:test')
const assert = require('node:assert/strict')
const {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  defaultSensitiveWorkspacePath,
  searchWorkspaceDirect,
} = require('./workspace-search-runtime.cjs')

test('default search policy rejects credential and private-key paths for roots and loose files', () => {
  const root = path.join(path.sep, 'workspace')
  const sensitive = [
    '.env',
    '.env.production',
    '.npmrc',
    'config/database-credentials.json',
    'config/service-account-prod.json',
    'certs/server.pem',
    'certs/server.key',
    'certs/identity.p12',
    'certs/identity.pfx',
    '.ssh/config',
    '.ssh/id_rsa',
    '.ssh/id_ed25519',
  ]
  for (const relative of sensitive) {
    assert.equal(
      defaultSensitiveWorkspacePath(path.join(root, relative), root),
      true,
      relative
    )
  }

  assert.equal(
    defaultSensitiveWorkspacePath('/outside/private/.npmrc'),
    true
  )
  assert.equal(
    defaultSensitiveWorkspacePath('/outside/private/client-credentials.json'),
    true
  )
  assert.equal(
    defaultSensitiveWorkspacePath('/outside/private/client.p12'),
    true
  )
  assert.equal(
    defaultSensitiveWorkspacePath('/outside/private/id_rsa'),
    true
  )
  assert.equal(
    defaultSensitiveWorkspacePath(path.join(root, 'src', 'safe-config.json'), root),
    false
  )
})

test('default search policy skips generated desktop copies and failed distributions', () => {
  const root = path.join(path.sep, 'workspace')
  for (const relative of [
    'desktop/installed-backups/StatsKey.app/Contents/app.js',
    'dist-failed-workspace-identity-0.18.13/assets/app.js',
    'biometrics/.statskey-desktop-proof-derived/Build/object.o',
    'Build/Intermediates.noindex/object.d',
  ]) {
    assert.equal(
      defaultSensitiveWorkspacePath(path.join(root, relative), root),
      true,
      relative
    )
  }
})

test('direct search excludes sensitive root and loose files before returning names or previews', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'statskey-direct-search-'))
  const root = path.join(directory, 'workspace')
  const outside = path.join(directory, 'outside')
  mkdirSync(path.join(root, '.ssh'), { recursive: true })
  mkdirSync(path.join(root, 'config'), { recursive: true })
  mkdirSync(path.join(root, 'certs'), { recursive: true })
  mkdirSync(outside, { recursive: true })

  const safeRootFiles = [
    write(path.join(root, 'safe-notes.txt'), 'auditneedle root evidence\n'),
    write(
      path.join(root, 'config', 'safe-config.json'),
      '{"description":"auditneedle safe configuration"}\n'
    ),
  ]
  const sensitiveRootFiles = [
    write(path.join(root, '.env'), 'TOKEN=auditneedle\n'),
    write(path.join(root, '.npmrc'), '//registry/:_authToken=auditneedle\n'),
    write(
      path.join(root, 'config', 'database-credentials.json'),
      '{"password":"auditneedle"}\n'
    ),
    write(path.join(root, 'certs', 'server.pem'), 'auditneedle\n'),
    write(path.join(root, 'certs', 'signing.key'), 'auditneedle\n'),
    write(path.join(root, 'certs', 'identity.p12'), 'auditneedle\n'),
    write(path.join(root, 'certs', 'identity.pfx'), 'auditneedle\n'),
    write(path.join(root, 'id_rsa'), 'auditneedle\n'),
    write(path.join(root, '.ssh', 'id_ed25519'), 'auditneedle\n'),
    write(
      path.join(root, 'auditneedle-private-body.txt'),
      '-----BEGIN OPENSSH PRIVATE KEY-----\nauditneedle\n-----END OPENSSH PRIVATE KEY-----\n'
    ),
  ]

  const safeLooseFile = write(
    path.join(outside, 'loose-safe.md'),
    'auditneedle loose evidence\n'
  )
  const sensitiveLooseFiles = [
    write(path.join(outside, '.env.production'), 'TOKEN=auditneedle\n'),
    write(path.join(outside, '.npmrc'), 'token=auditneedle\n'),
    write(
      path.join(outside, 'cloud-credentials.json'),
      '{"secret":"auditneedle"}\n'
    ),
    write(path.join(outside, 'client.p12'), 'auditneedle\n'),
    write(path.join(outside, 'id_rsa'), 'auditneedle\n'),
    write(
      path.join(outside, 'auditneedle-loose-private-body.txt'),
      '-----BEGIN RSA PRIVATE KEY-----\nauditneedle\n-----END RSA PRIVATE KEY-----\n'
    ),
  ]

  try {
    const canonicalRoot = realpathSync(root)
    const looseFiles = [safeLooseFile, ...sensitiveLooseFiles].map((candidate) =>
      realpathSync(candidate)
    )
    const looseSet = new Set(looseFiles)
    const results = searchWorkspaceDirect('auditneedle', {
      roots: [canonicalRoot],
      looseFiles,
      canonicalize: canonical,
      isAllowed(candidate) {
        return insideRoot(candidate, canonicalRoot) || looseSet.has(candidate)
      },
      containingRootFor(candidate) {
        return insideRoot(candidate, canonicalRoot) ? canonicalRoot : null
      },
      nodeForPath(candidate) {
        const containingRoot = insideRoot(candidate, canonicalRoot)
          ? canonicalRoot
          : null
        return {
          name: path.basename(candidate),
          path: candidate,
          kind: 'file',
          extension: path.extname(candidate).slice(1).toLowerCase(),
          size: statSync(candidate).size,
          relativePath: containingRoot
            ? path.relative(containingRoot, candidate)
            : path.basename(candidate),
        }
      },
    })

    assert.deepEqual(
      [...new Set(results.map((result) => result.name))].sort(),
      ['loose-safe.md', 'safe-config.json', 'safe-notes.txt']
    )
    assert.equal(
      results.every((result) => result.preview.includes('auditneedle')),
      true
    )
    const serialized = JSON.stringify(results)
    for (const sensitiveFile of [
      ...sensitiveRootFiles,
      ...sensitiveLooseFiles,
    ]) {
      assert.equal(
        serialized.includes(path.basename(sensitiveFile)),
        false,
        `leaked ${path.basename(sensitiveFile)}`
      )
    }
    for (const safeFile of [...safeRootFiles, safeLooseFile]) {
      assert.equal(
        results.some((result) => result.path === realpathSync(safeFile)),
        true,
        path.basename(safeFile)
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  return filePath
}

function canonical(candidate) {
  try {
    return realpathSync(candidate)
  } catch {
    return null
  }
}

function insideRoot(candidate, root) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}
