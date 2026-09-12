#!/usr/bin/env node

import { isDeepStrictEqual } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { repairFounderNutritionFallback } from './founder-nutrition-fallback-lib.mjs'

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--check')) {
  throw new Error('Usage: node scripts/repair-founder-nutrition-fallback.mjs [--check]')
}
const fallbackPath = new URL('../public/statskey-app/founder-live-fallback.json', import.meta.url)
const historyPath = new URL('../public/statskey-app/founder-history/index.json', import.meta.url)
const [fallback, history] = await Promise.all([fallbackPath, historyPath].map(async (path) => (
  JSON.parse(await readFile(path, 'utf8'))
)))
const repaired = repairFounderNutritionFallback(fallback, history)
if (args.includes('--check')) {
  if (!isDeepStrictEqual(fallback, repaired)) {
    throw new Error('Published nutrition snapshot does not match its public daily archive. Run node scripts/repair-founder-nutrition-fallback.mjs and review the resulting data change.')
  }
  console.log('Published nutrition snapshot matches its public daily archive.')
} else {
  await writeFile(fallbackPath, `${JSON.stringify(repaired, null, 2)}\n`)
  console.log('Repaired published nutrition aggregates; snapshot dates and all other data preserved.')
}
