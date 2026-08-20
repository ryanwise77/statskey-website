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
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(here, '..')
const publicHistoryStartDay = '2025-08-25'
const outputPath = resolve(
  websiteRoot,
  'public/statskey-app/founder-live-fallback.json'
)

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
  const [rootSnapshot, workoutSnapshot, mealSnapshot, planSnapshot] =
    await Promise.all([
      getDoc(rootReference),
      getDocs(query(
        collection(rootReference, 'workouts'),
        where('day', '>=', publicHistoryStartDay),
        orderBy('day', 'desc')
      )),
      getDocs(query(
        collection(rootReference, 'meals'),
        orderBy('recordedAt', 'desc'),
        limit(50)
      )),
      getDoc(doc(rootReference, 'plans', 'current')),
    ])

  if (!rootSnapshot.exists()) {
    throw new Error('The public founder projection is unavailable')
  }

  const root = rootSnapshot.data()
  // Miller's public note has its own fail-closed document and is intentionally
  // never copied into a static snapshot.
  delete root.founderJourney

  const workouts = workoutSnapshot.docs.map((snapshot) => ({
    ...snapshot.data(),
    workoutId: snapshot.data().workoutId || snapshot.id,
  })).filter((workout) => (
    !workout.day || workout.day >= publicHistoryStartDay
  ))
  const meals = mealSnapshot.docs.map((snapshot) => ({
    ...snapshot.data(),
    mealId: snapshot.data().mealId || snapshot.id,
  }))
  const latestDay = [
    root.mealRecord?.latestDay,
    root.training?.allTime?.latestDay,
    workouts[0]?.day,
    meals[0]?.day,
  ]
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day)))
    .sort()
    .at(-1)

  if (!latestDay) {
    throw new Error('The public founder projection has no dated records')
  }

  const payload = {
    root: {
      ...root,
      snapshotDay: latestDay,
      generatedAt: new Date().toISOString(),
    },
    workouts,
    meals,
    plan: planSnapshot.exists() ? planSnapshot.data() : null,
  }
  const serialized = JSON.stringify(payload)
  for (const forbidden of [
    '"routeCoordinates"',
    '"coordinates"',
    '"latitude"',
    '"longitude"',
    '"startLocation"',
    '"endLocation"',
    '"healthKitUUID"',
    '"notes"',
    '"photoURLs"',
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Fallback contains forbidden field ${forbidden}`)
    }
  }

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(JSON.stringify({
    outputPath,
    snapshotDay: latestDay,
    workouts: workouts.length,
    meals: meals.length,
    planPublished: Boolean(payload.plan),
  }, null, 2))
} finally {
  await deleteApp(app)
}
