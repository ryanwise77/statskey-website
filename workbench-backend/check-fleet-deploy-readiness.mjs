#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { createPublicKey } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const failures = []
const checks = []

function check(condition, message) {
  checks.push({ ok: Boolean(condition), message })
  if (!condition) failures.push(message)
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    failures.push(`${label} could not be read: ${error.message}`)
    return null
  }
}

function hasIndex(indexes, collectionGroup, expectedFields) {
  return indexes.some(
    (index) =>
      index.collectionGroup === collectionGroup &&
      index.queryScope === 'COLLECTION' &&
      index.density === 'DENSE' &&
      expectedFields.every(
        (expected, position) =>
          index.fields?.[position]?.fieldPath === expected.fieldPath &&
          index.fields?.[position]?.order === expected.order
      ) &&
      index.fields?.length === expectedFields.length
  )
}

function withoutJavaScriptComments(source) {
  let result = ''
  let state = 'code'
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (state === 'line-comment') {
      if (character === '\n') {
        state = 'code'
        result += character
      } else {
        result += ' '
      }
      continue
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        result += '  '
        index += 1
        state = 'code'
      } else {
        result += character === '\n' ? '\n' : ' '
      }
      continue
    }
    if (['single-quote', 'double-quote', 'template'].includes(state)) {
      result += character
      if (character === '\\') {
        result += next || ''
        index += 1
      } else if (
        (state === 'single-quote' && character === "'") ||
        (state === 'double-quote' && character === '"') ||
        (state === 'template' && character === '`')
      ) {
        state = 'code'
      }
      continue
    }
    if (character === '/' && next === '/') {
      result += '  '
      index += 1
      state = 'line-comment'
    } else if (character === '/' && next === '*') {
      result += '  '
      index += 1
      state = 'block-comment'
    } else {
      result += character
      if (character === "'") state = 'single-quote'
      else if (character === '"') state = 'double-quote'
      else if (character === '`') state = 'template'
    }
  }
  return result
}

function hasTopLevelOptionBinding(source, exportName, trigger, constant) {
  const uncommented = withoutJavaScriptComments(source)
  const invocation = new RegExp(
    `exports\\.${exportName}\\s*=\\s*${trigger}\\s*\\(\\s*\\{`
  ).exec(uncommented)
  if (!invocation) return false
  const openingBrace = uncommented.indexOf('{', invocation.index)
  let nesting = 0
  let quote = null
  for (let index = openingBrace + 1; index < uncommented.length; index += 1) {
    const character = uncommented[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '{' || character === '[' || character === '(') {
      nesting += 1
      continue
    }
    if (character === '}' || character === ']' || character === ')') {
      if (character === '}' && nesting === 0) return false
      nesting -= 1
      continue
    }
    if (nesting !== 0 || !/[A-Za-z_$]/.test(character)) continue
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(
      uncommented.slice(index)
    )?.[0]
    if (!identifier) continue
    index += identifier.length - 1
    if (identifier !== 'serviceAccount') continue
    let cursor = index + 1
    while (/\s/.test(uncommented[cursor] || '')) cursor += 1
    if (uncommented[cursor] !== ':') continue
    cursor += 1
    while (/\s/.test(uncommented[cursor] || '')) cursor += 1
    const value = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(
      uncommented.slice(cursor)
    )?.[0]
    return value === constant
  }
  return false
}

function parseEnv(source) {
  const values = new Map()
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (match) values.set(match[1], match[2].trim())
  }
  return values
}

function validEd25519PublicKey(value) {
  if (!/^[A-Za-z0-9_-]{40,256}$/.test(value)) return false
  try {
    const der = Buffer.from(value, 'base64url')
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
    return (
      der.toString('base64url') === value &&
      key.asymmetricKeyType === 'ed25519' &&
      Buffer.from(key.export({ format: 'der', type: 'spki' })).equals(der)
    )
  } catch {
    return false
  }
}

const firebase = await readJson(join(root, 'firebase.json'), 'firebase.json')
const indexConfig = await readJson(
  join(root, 'firestore.indexes.json'),
  'firestore.indexes.json'
)
const functionsPackage = await readJson(
  join(root, 'functions', 'package.json'),
  'functions/package.json'
)
let functionsSource = ''
try {
  functionsSource = await readFile(join(root, 'functions', 'index.js'), 'utf8')
} catch (error) {
  failures.push(`functions/index.js could not be read: ${error.message}`)
}
const uncommentedFunctionsSource = withoutJavaScriptComments(functionsSource)

check(
  firebase?.firestore?.some(
    (entry) =>
      entry.database === 'workbench' &&
      entry.indexes === 'firestore.indexes.json'
  ),
  'firebase.json targets the named workbench database and index file'
)

const indexes = indexConfig?.indexes ?? []
check(
  hasIndex(indexes, 'fleetLeases', [
    { fieldPath: 'releasedAt', order: 'ASCENDING' },
    { fieldPath: 'expiresAt', order: 'ASCENDING' },
  ]),
  'fleetLeases has the unreleased-expiry sweep index'
)
check(
  hasIndex(indexes, 'fleetJobs', [
    { fieldPath: 'state', order: 'ASCENDING' },
    { fieldPath: 'deadlineAt', order: 'ASCENDING' },
  ]),
  'fleetJobs has the queued-deadline sweep index'
)
check(
  hasIndex(indexes, 'fleetArtifacts', [
    { fieldPath: 'state', order: 'ASCENDING' },
    { fieldPath: 'uploadExpiresAt', order: 'ASCENDING' },
  ]),
  'fleetArtifacts has the incomplete-upload sweep index'
)
check(
  hasIndex(indexes, 'fleetArtifacts', [
    { fieldPath: 'state', order: 'ASCENDING' },
    { fieldPath: 'expiresAt', order: 'ASCENDING' },
  ]),
  'fleetArtifacts has the committed-retention sweep index'
)
check(
  hasIndex(indexes, 'fleetArtifacts', [
    { fieldPath: 'state', order: 'ASCENDING' },
    { fieldPath: 'cleanupStartedAt', order: 'ASCENDING' },
  ]),
  'fleetArtifacts has the stale-deletion recovery index'
)

check(
  functionsPackage?.engines?.node === '22',
  'Functions explicitly target the Node 22 runtime'
)
for (const {
  exportName,
  trigger,
  constant,
  serviceAccount,
} of [
  {
    exportName: 'workbenchApi',
    trigger: 'onRequest',
    constant: 'WORKBENCH_API_SERVICE_ACCOUNT',
    serviceAccount: 'workbench-api@statskey-workbench.iam.gserviceaccount.com',
  },
  {
    exportName: 'workbenchDeviceApi',
    trigger: 'onRequest',
    constant: 'FLEET_DEVICE_SERVICE_ACCOUNT',
    serviceAccount: 'fleet-device-api@statskey-workbench.iam.gserviceaccount.com',
  },
  {
    exportName: 'workbenchFleetSweep',
    trigger: 'onSchedule',
    constant: 'FLEET_SWEEP_SERVICE_ACCOUNT',
    serviceAccount: 'fleet-sweep@statskey-workbench.iam.gserviceaccount.com',
  },
]) {
  const escapedServiceAccount = serviceAccount.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  )
  check(
    new RegExp(
      `const\\s+${constant}\\s*=\\s*["']${escapedServiceAccount}["']\\s*;`
    ).test(uncommentedFunctionsSource),
    `${constant} has the expected service-account identity`
  )
  check(
    hasTopLevelOptionBinding(functionsSource, exportName, trigger, constant),
    `${exportName} is explicitly bound to ${constant}`
  )
}

const overrides = indexConfig?.fieldOverrides ?? []
for (const collectionGroup of ['fleetDeviceRequests', 'rateLimits']) {
  check(
    overrides.some(
      (override) =>
        override.collectionGroup === collectionGroup &&
        override.fieldPath === 'expiresAt' &&
        override.ttl === true
    ),
    `${collectionGroup}.expiresAt has a TTL field override`
  )
}

let environment = null
try {
  environment = parseEnv(
    await readFile(
      join(root, 'functions', '.env.statskey-workbench'),
      'utf8'
    )
  )
} catch {
  failures.push(
    'functions/.env.statskey-workbench is missing; copy the example and configure Fleet parameters'
  )
}

if (environment) {
  for (const name of [
    'FLEET_ARTIFACT_BUCKET',
    'FLEET_RESPONSE_SIGNING_KEY_ID',
    'FLEET_RESPONSE_SIGNING_PUBLIC_KEY',
  ]) {
    check(Boolean(environment.get(name)), `${name} is configured`)
  }
  check(
    /^[a-z][a-z0-9._-]{2,63}$/.test(
      environment.get('FLEET_RESPONSE_SIGNING_KEY_ID') ?? ''
    ),
    'FLEET_RESPONSE_SIGNING_KEY_ID uses the coordinator key-id format'
  )
  check(
    validEd25519PublicKey(
      environment.get('FLEET_RESPONSE_SIGNING_PUBLIC_KEY') ?? ''
    ),
    'FLEET_RESPONSE_SIGNING_PUBLIC_KEY is canonical Ed25519 SPKI data'
  )
  check(
    /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(
      environment.get('FLEET_ARTIFACT_BUCKET') ?? ''
    ),
    'FLEET_ARTIFACT_BUCKET uses a valid bucket-name shape'
  )
}

const output = {
  ready: failures.length === 0,
  checks,
  failures,
  note:
    'This validates repository configuration only. Run the remote checks in FLEET_DEPLOYMENT_RUNBOOK.md before deployment.',
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
} else {
  for (const item of checks) {
    process.stdout.write(`${item.ok ? 'PASS' : 'FAIL'}  ${item.message}\n`)
  }
  for (const failure of failures.filter(
    (message) => !checks.some((item) => item.message === message)
  )) {
    process.stdout.write(`FAIL  ${failure}\n`)
  }
  process.stdout.write(
    output.ready
      ? 'Fleet repository configuration is ready for remote preflight.\n'
      : 'Fleet deployment is blocked until every failure is resolved.\n'
  )
}

process.exitCode = output.ready ? 0 : 1
