const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const yaml = require('js-yaml')
const {
  loadPublicRelease,
  normalizeUpdateMetadata,
  safePublicCopy,
  yamlScalar,
} = require('./release-notes-runtime.cjs')

test('loads the exact latest release with bounded public notes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'statskey-notes-'))
  const notesPath = path.join(directory, 'updates.json')
  writeFileSync(
    notesPath,
    JSON.stringify({
      latest: '1.2.3',
      releases: [
        {
          version: '1.2.3',
          title: 'Proof you can inspect',
          summary: 'A concise product summary.',
          highlights: ['First improvement.', 'Second improvement.'],
        },
      ],
    })
  )
  assert.deepEqual(loadPublicRelease(notesPath, '1.2.3'), {
    title: 'Proof you can inspect',
    summary: 'A concise product summary.',
    highlights: ['First improvement.', 'Second improvement.'],
  })
  assert.throws(
    () => loadPublicRelease(notesPath, '1.2.4'),
    /must declare 1\.2\.4/
  )
})

test('normalizes updater metadata and embeds release notes idempotently', () => {
  const source = [
    'version: 1.2.3',
    'files:',
    '  - url: StatsKey-1.2.3-mac-arm64.zip',
    '    sha512: ZIPHASH',
    '    size: 100',
    '  - url: StatsKey-1.2.3-mac-arm64.dmg',
    '    sha512: DMGHASH',
    '    size: 200',
    'path: StatsKey-1.2.3-mac-arm64.zip',
    'sha512: ZIPHASH',
    '',
  ].join('\n')
  const options = {
    version: '1.2.3',
    downloadArtifact: 'StatsKey-1.2.3-mac-arm64.dmg',
    releaseEntry: {
      title: 'Proof you can inspect',
      highlights: ['First improvement.', 'Second improvement.'],
    },
  }
  const normalized = normalizeUpdateMetadata(source, options)
  assert.doesNotMatch(normalized, /DMGHASH|\.dmg/)
  assert.match(normalized, /releaseName: "StatsKey 1\.2\.3 — Proof you can inspect"/)
  assert.match(normalized, /releaseNotes: \|-\n  - First improvement\./)
  assert.deepEqual(yaml.load(normalized), {
    version: '1.2.3',
    files: [
      {
        url: 'StatsKey-1.2.3-mac-arm64.zip',
        sha512: 'ZIPHASH',
        size: 100,
      },
    ],
    path: 'StatsKey-1.2.3-mac-arm64.zip',
    sha512: 'ZIPHASH',
    releaseName: 'StatsKey 1.2.3 — Proof you can inspect',
    releaseNotes: '- First improvement.\n- Second improvement.',
  })
  assert.equal(
    normalizeUpdateMetadata(normalized, options),
    normalized
  )
})

test('rejects markup and emits a quoted YAML scalar', () => {
  assert.equal(safePublicCopy('<script>no</script>', 72), '')
  assert.equal(safePublicCopy('  clear\ncopy  ', 72), 'clear copy')
  assert.equal(yamlScalar('StatsKey 1.2.3 — Ready'), '"StatsKey 1.2.3 — Ready"')
})
