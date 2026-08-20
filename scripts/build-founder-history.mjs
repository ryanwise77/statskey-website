#!/usr/bin/env node

import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildFounderHistory,
  mergeRecordsById,
  normalizeMealForProjection,
  parseUSDANutrientMap,
} from './founder-history-lib.mjs'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(here, '..')
const projectsRoot = resolve(websiteRoot, '..')
const archiveRoot = resolve(
  websiteRoot,
  'public/statskey-app/founder-history'
)
const archiveMealsRoot = resolve(archiveRoot, 'meals')
const indexPath = resolve(archiveRoot, 'index.json')
const fallbackPath = resolve(
  websiteRoot,
  'public/statskey-app/founder-live-fallback.json'
)
const historicalMealPath = resolve(
  projectsRoot,
  'Training/statskey_data/full_history/meals.json'
)
const recentMealPath = resolve(
  projectsRoot,
  'Training/statskey_data/meals_30d.json'
)
const nutrientMapPath = resolve(
  projectsRoot,
  'StatsKey/biometrics/StatsKey/Utilities/USDANutrientMap.swift'
)
const {
  NUTRIENT_REFERENCES,
  publicMealData,
} = require(resolve(
  projectsRoot,
  'StatsKey/biometrics/functions/publicFounderReplica.js'
))

const optionalJSON = async (path, fallback = null) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

const maxDay = (records) => (records || [])
  .map((record) => record?.day)
  .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')))
  .sort()
  .at(-1) || null

const zonedDay = (value) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  return `${values.year}-${values.month}-${values.day}`
}

const zonedTime = (value) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

const projectRawMeals = (rawMeals, usdaMap, generatedAt) => (
  rawMeals
    .filter((meal) => meal?.id)
    .map((meal) => {
      const legacy = Array.isArray(meal.foods) && !Array.isArray(meal.items)
      const projected = publicMealData(
        normalizeMealForProjection(meal, usdaMap),
        meal.id,
        'America/Chicago'
      )
      if (!projected) return null
      // The original schema stored a calendar-day anchor in `date` and the
      // occurrence clock in `time`. Preserve both instead of moving
      // after-midnight records onto the following recording day.
      return legacy
        ? {
            ...projected,
            day: zonedDay(meal.date) || projected.day,
            timeLabel: zonedTime(meal.time) || projected.timeLabel,
          }
        : projected
    })
    .filter(Boolean)
    .map((meal) => ({ ...meal, updatedAt: meal.updatedAt || generatedAt }))
)

const existingArchiveMeals = async (index) => {
  if (!Array.isArray(index?.months)) return []
  const shards = await Promise.all(
    index.months.map((month) => optionalJSON(
      resolve(websiteRoot, `public${month.path}`),
      { meals: [] }
    ))
  )
  return shards.flatMap((shard) => (
    Array.isArray(shard?.meals) ? shard.meals : []
  ))
}

export async function buildFounderHistoryFromLocal(options = {}) {
  const {
    additionalProjectedMeals = [],
    replaceProjectedFromDay = null,
    reliableThroughDayOverride = null,
    generatedAt = new Date().toISOString(),
  } = options
  const [
    historicalMeals,
    recentMeals,
    nutrientMapSource,
    fallback,
    existingIndex,
  ] = await Promise.all([
    optionalJSON(historicalMealPath, []),
    optionalJSON(recentMealPath, []),
    readFile(nutrientMapPath, 'utf8'),
    optionalJSON(fallbackPath, {}),
    optionalJSON(indexPath, null),
  ])
  const usdaMap = parseUSDANutrientMap(nutrientMapSource)
  const rawMeals = mergeRecordsById(
    [...historicalMeals, ...recentMeals],
    'id'
  )
  const projectedLocal = projectRawMeals(rawMeals, usdaMap, generatedAt)
  const projectedRecent = projectRawMeals(recentMeals, usdaMap, generatedAt)
  const existingArchiveUsed = Number(existingIndex?.sources?.cloudReads) > 0
  const existingMeals = existingArchiveUsed
    ? await existingArchiveMeals(existingIndex)
    : []
  const fallbackMeals = Array.isArray(fallback?.meals) ? fallback.meals : []
  const retained = [
    ...projectedLocal,
    ...fallbackMeals,
    ...existingMeals,
  ].filter((meal) => (
    !replaceProjectedFromDay || meal.day < replaceProjectedFromDay
  ))
  const projectedMeals = mergeRecordsById([
    ...retained,
    ...additionalProjectedMeals,
  ])
  const reliableThroughDay = reliableThroughDayOverride ||
    existingIndex?.reliableThroughDay ||
    maxDay(projectedRecent) ||
    maxDay(projectedLocal)
  const { index, shards } = buildFounderHistory(projectedMeals, {
    generatedAt,
    historyStartDay: '2025-08-25',
    reliableThroughDay,
    nutritionReferences: NUTRIENT_REFERENCES,
  })
  index.sources = {
    historicalCacheThroughDay: maxDay(projectRawMeals(
      historicalMeals,
      usdaMap,
      generatedAt
    )),
    boundedCacheThroughDay: maxDay(projectedRecent),
    publicProjectionRefreshStartDay: replaceProjectedFromDay ||
      existingIndex?.sources?.publicProjectionRefreshStartDay ||
      null,
    cloudReads: additionalProjectedMeals.length ||
      (existingArchiveUsed ? Number(existingIndex?.sources?.cloudReads) : 0),
  }

  const serialized = JSON.stringify({ index, shards })
  for (const forbidden of [
    '"routeCoordinates"',
    '"coordinates"',
    '"latitude"',
    '"longitude"',
    '"startDate"',
    '"healthKitUUID"',
    '"notes"',
    '"photoURLs"',
    '"aiExplanation"',
    '"aiItemInsights"',
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Founder history contains forbidden field ${forbidden}`)
    }
  }

  await mkdir(archiveMealsRoot, { recursive: true })
  await Promise.all([
    writeFile(indexPath, `${JSON.stringify(index)}\n`),
    ...Object.entries(shards).map(([month, shard]) => writeFile(
      resolve(archiveMealsRoot, `${month}.json`),
      `${JSON.stringify(shard)}\n`
    )),
  ])

  return {
    indexPath,
    generatedAt,
    earliestDay: index.earliestDay,
    latestDay: index.latestDay,
    reliableThroughDay: index.reliableThroughDay,
    meals: index.mealCount,
    items: index.itemCount,
    recordedDays: index.recordedDays,
    nutrients: index.nutrientCount,
    months: index.months.length,
    cloudReads: additionalProjectedMeals.length,
  }
}

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const result = await buildFounderHistoryFromLocal()
  console.log(JSON.stringify(result, null, 2))
}
