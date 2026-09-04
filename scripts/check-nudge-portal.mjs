import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

// Guard the delivered app, not only the source checkout. A production merge
// previously retained the general login page while dropping the author flow.
const output = resolve(process.argv[2] ?? 'dist')
const seen = new Set()
async function readModule(path) {
  if (seen.has(path)) return ''
  seen.add(path)
  const source = await readFile(path, 'utf8')
  const imports = [...source.matchAll(/["'](\.[^"']+\.js)["']/g)]
    .map((match) => resolve(dirname(path), match[1]))
  return source + (await Promise.all(imports.map(readModule))).join('\n')
}
async function readEntry(htmlFile) {
  seen.clear()
  const html = await readFile(resolve(output, htmlFile), 'utf8')
  const entrypoints = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
    .map((match) => match[1])
    .filter((path) => !/^https?:/.test(path))
  assert.ok(entrypoints.length, `No production entrypoint found for ${htmlFile}`)
  return html + (await Promise.all(entrypoints.map((path) =>
    readModule(resolve(output, path.replace(/^\//, '')))
  ))).join('\n')
}
const app = await readEntry('app.html')

for (const feature of [
  '/nudge-studio',
  '/agency/nudge-studio',
  'miller@statskeybiometrics.com',
  'miller_nudge_author',
  'millerNudgeAuthorSignIn',
  'getRecordingNudgeStudioState',
  'saveRecordingNudgeDraft',
  'publishRecordingNudges',
  'rollbackRecordingNudges',
  'publishFounderJourneyWeekNote',
]) {
  assert.ok(app.includes(feature), `Production app is missing ${feature}`)
}
console.log('Production Miller portal: routes, author sign-in, and all messaging callables present.')

const homepage = await readEntry('index.html')
for (const feature of ['founder-journey-note', 'noteRevision', 'Miller week note']) {
  assert.ok(homepage.includes(feature), `Public founder page is missing ${feature}`)
}
assert.match(homepage, /["']journey["'],["']current["']/, 'Public founder page is missing its live weekly-note reader')
console.log('Public founder page: current weekly-note consumer present.')
