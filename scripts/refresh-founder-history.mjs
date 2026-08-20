#!/usr/bin/env node

import { deleteApp, initializeApp } from 'firebase/app'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFounderHistoryFromLocal } from './build-founder-history.mjs'
import { shiftDay } from './founder-history-lib.mjs'

const MAX_INCREMENTAL_LOOKBACK_DAYS = 45
const MAX_INCREMENTAL_DOCUMENTS = 1_200
const PUBLIC_PROJECTION_START_DAY = '2025-09-01'
const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(here, '..')
const indexPath = resolve(
  websiteRoot,
  'public/statskey-app/founder-history/index.json'
)

const index = JSON.parse(await readFile(indexPath, 'utf8'))
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(index.reliableThroughDay || ''))) {
  throw new Error(
    'Founder history has no reliable watermark. Run build:founder-history first.'
  )
}

const today = new Date().toISOString().slice(0, 10)
const staleDays = Math.max(
  0,
  Math.floor((
    new Date(`${today}T12:00:00.000Z`) -
    new Date(`${index.reliableThroughDay}T12:00:00.000Z`)
  ) / 86_400_000)
)
if (
  staleDays > MAX_INCREMENTAL_LOOKBACK_DAYS &&
  !process.argv.includes('--allow-long-lookback')
) {
  throw new Error(
    `Incremental watermark is ${staleDays} days old. Refusing an unbounded ` +
    `Firestore read; pass --allow-long-lookback only after reviewing the cost.`
  )
}

const refreshStartDay = [
  shiftDay(index.reliableThroughDay, -2),
  PUBLIC_PROJECTION_START_DAY,
].sort().at(-1)
const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY ??
    'AIzaSyD7b9XKxV0Z7qdcdgMEVuE-fTTIoYsLCpc',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN ??
    'statskey.firebaseapp.com',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID ?? 'statskey',
  appId: process.env.VITE_FIREBASE_APP_ID ??
    '1:1081412767986:web:15dbdf5870c78be674c06b',
})
const database = getFirestore(app)

try {
  const rootReference = doc(
    database,
    'publicFounderReplicas',
    'founder'
  )
  const [rootSnapshot, mealSnapshot] = await Promise.all([
    getDoc(rootReference),
    getDocs(query(
      collection(rootReference, 'meals'),
      where('day', '>=', refreshStartDay),
      orderBy('day', 'asc'),
      limit(MAX_INCREMENTAL_DOCUMENTS)
    )),
  ])
  if (!rootSnapshot.exists()) {
    throw new Error('The public founder projection is unavailable')
  }
  if (mealSnapshot.size >= MAX_INCREMENTAL_DOCUMENTS) {
    throw new Error(
      `Incremental meal query reached its ${MAX_INCREMENTAL_DOCUMENTS}-document ` +
      'safety limit. No archive files were changed.'
    )
  }

  const projectedMeals = mealSnapshot.docs.map((snapshot) => ({
    ...snapshot.data(),
    mealId: snapshot.data().mealId || snapshot.id,
  }))
  const remoteLatestDay = projectedMeals
    .map((meal) => meal.day)
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')))
    .sort()
    .at(-1)
  const root = rootSnapshot.data()
  const reliableThroughDay = [
    index.reliableThroughDay,
    root.mealRecord?.latestDay,
    remoteLatestDay,
  ]
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')))
    .sort()
    .at(-1)

  const result = await buildFounderHistoryFromLocal({
    additionalProjectedMeals: projectedMeals,
    replaceProjectedFromDay: refreshStartDay,
    reliableThroughDayOverride: reliableThroughDay,
  })
  console.log(JSON.stringify({
    ...result,
    refreshStartDay,
    firestoreDocumentReads: mealSnapshot.size + 1,
  }, null, 2))
} finally {
  await deleteApp(app)
}
