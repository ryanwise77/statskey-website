#!/usr/bin/env node
/*
 * Deploy-readiness guard for the StatsKey website.
 *
 * The live site auto-deploys from GitHub `origin/main`. The failure mode this
 * guards against: editing files, deploying, and later having those edits
 * "overwritten" — which really meant the work was never committed/pushed, so a
 * later Git deploy rebuilt origin/main *without* it (or a second environment
 * pushed and diverged).
 *
 * This script verifies that what you have locally is exactly what will deploy:
 *   1. working tree is clean (no uncommitted or untracked-but-not-ignored work)
 *   2. you are NOT behind origin (no other environment pushed work you lack)
 *   3. you have nothing committed-but-unpushed
 *
 * Usage:  npm run check:deploy
 * Exit code 0 = safe to rely on the deploy. Non-zero = fix the reported issue.
 */
import { execSync } from 'node:child_process'

function git(args, opts = {}) {
  return execSync(`git ${args}`, { encoding: 'utf8', ...opts }).trim()
}

const problems = []
let fetched = true

try {
  execSync('git fetch --quiet origin', { stdio: 'ignore' })
} catch {
  fetched = false
  problems.push('Could not reach origin (offline?). Re-run with a connection so the\n     behind/ahead check is accurate.')
}

const branch = git('rev-parse --abbrev-ref HEAD')

// 1) Uncommitted / untracked work will NOT deploy.
const dirty = git('status --porcelain')
if (dirty) {
  problems.push(
    'Uncommitted changes are present. They will NOT deploy — the site builds\n' +
    '     only from pushed commits on origin/' + branch + '. Commit & push them:\n' +
    dirty.split('\n').map((l) => '       ' + l).join('\n')
  )
}

// 2) / 3) Compare against origin.
let behind = 0
let ahead = 0
if (fetched) {
  try {
    const counts = git(`rev-list --left-right --count origin/${branch}...HEAD`)
    const [b, a] = counts.split(/\s+/).map((n) => parseInt(n, 10) || 0)
    behind = b
    ahead = a
  } catch {
    problems.push(`No origin/${branch} to compare against. Is the branch pushed?`)
  }
}

if (behind > 0) {
  problems.push(
    `Your branch is BEHIND origin/${branch} by ${behind} commit(s) — another\n` +
    '     environment pushed work you do not have. Integrate before deploying so\n' +
    '     you do not re-diverge:\n' +
    `       git pull --no-rebase origin ${branch}`
  )
}

if (ahead > 0 && dirty === '' && behind === 0) {
  problems.push(
    `You have ${ahead} commit(s) that are not on origin yet, so they are not live.\n` +
    `     Push to deploy:\n       git push origin ${branch}`
  )
}

if (problems.length === 0) {
  console.log(`\u2713 Deploy-ready: working tree clean and in sync with origin/${branch}.`)
  console.log('  What you see locally is what will be served.')
  process.exit(0)
}

console.error('\n\u2715  Not deploy-ready\n')
for (const p of problems) console.error('  \u2022 ' + p + '\n')
console.error('Fix the above, then re-run: npm run check:deploy\n')
process.exit(1)
