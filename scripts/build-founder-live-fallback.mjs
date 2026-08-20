#!/usr/bin/env node

import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(here, '..')
const projectsRoot = resolve(websiteRoot, '..')
const {
  buildNutritionSnapshot,
  publicMacroTargets,
  publicMealData,
  publicPlanData,
  publicWorkoutData,
  summarizeWorkouts,
} = require(resolve(
  projectsRoot,
  'StatsKey/biometrics/functions/publicFounderReplica.js'
))

const workoutPath = resolve(
  projectsRoot,
  'Training/statskey_data/full_history/workoutSessions.json'
)
const recentWorkoutPath = resolve(
  projectsRoot,
  'Training/statskey_data/workouts_recent_30.json'
)
const mealPath = resolve(
  projectsRoot,
  'Training/statskey_data/meals_30d.json'
)
const planPath = resolve(
  projectsRoot,
  'Training/statskey_data/training_plan_active.json'
)
const goalPath = resolve(
  projectsRoot,
  'Training/statskey_data/training_goals.json'
)
const macroTargetsPath = resolve(
  projectsRoot,
  'Training/statskey_data/settings_macroTargets.json'
)
const outputPath = resolve(
  websiteRoot,
  'public/statskey-app/founder-live-fallback.json'
)

const [
  historicalWorkouts,
  recentWorkouts,
  meals,
  trainingPlan,
  trainingGoals,
  macroTargets,
] = await Promise.all([
  JSON.parse(await readFile(workoutPath, 'utf8')),
  JSON.parse(await readFile(recentWorkoutPath, 'utf8')),
  JSON.parse(await readFile(mealPath, 'utf8')),
  JSON.parse(await readFile(planPath, 'utf8')),
  JSON.parse(await readFile(goalPath, 'utf8')),
  JSON.parse(await readFile(macroTargetsPath, 'utf8')),
])
const workoutsById = new Map(
  [...historicalWorkouts, ...recentWorkouts]
    .filter((workout) => workout?.id)
    .map((workout) => [workout.id, workout])
)
const workouts = [...workoutsById.values()]

const sourceDates = [
  ...workouts.map((workout) => new Date(workout.startDate || workout.createdAt)),
  ...meals.map((meal) => new Date(meal.date || meal.createdAt)),
].filter((date) => Number.isFinite(date.getTime()))
const latestSourceDate = sourceDates.sort((left, right) => right - left)[0]
if (!latestSourceDate) throw new Error('No dated founder records were available')

const snapshotDay = latestSourceDate.toISOString().slice(0, 10)
// Treat the newest exported day as in progress, matching the production
// projection's complete-days-only nutrition window.
const snapshotNow = new Date(`${snapshotDay}T18:00:00.000Z`)
const publicHistoryStartDay = '2025-08-25'
const generatedAt = new Date().toISOString()

const projectedWorkouts = workouts
  .map((workout) => publicWorkoutData(
    workout,
    workout.id,
    'America/Chicago',
    false
  ))
  .filter(Boolean)
  .filter((workout) => workout.day >= publicHistoryStartDay)
  .sort((left, right) => (
    right.day.localeCompare(left.day) ||
    Number(right.startMinute || 0) - Number(left.startMinute || 0)
  ))
const allProjectedMeals = meals
  .map((meal) => publicMealData(
    meal,
    meal.id,
    'America/Chicago'
  ))
  .filter(Boolean)
  .filter((meal) => meal.day >= publicHistoryStartDay)
  .map((meal) => ({ ...meal, updatedAt: generatedAt }))
  .sort((left, right) => (
    right.day.localeCompare(left.day) ||
    String(right.timeLabel || '').localeCompare(String(left.timeLabel || ''))
  ))
const activeGoal = trainingGoals.find((goal) => {
  const label = [
    goal?.targetRace,
    goal?.eventName,
    goal?.name,
    goal?.title,
    goal?.type,
  ].filter(Boolean).join(' ')
  return goal?.isActive === true && /\bmarathon\b/i.test(label)
}) || trainingGoals.find((goal) => goal?.id === trainingPlan?.goalId) ||
  trainingGoals.find((goal) => goal?.isActive === true) ||
  null
const projectedPlanValue = publicPlanData(
  trainingPlan,
  trainingPlan?.id || 'current',
  'America/Chicago',
  activeGoal
)
const projectedPlan = projectedPlanValue
  ? { ...projectedPlanValue, updatedAt: generatedAt }
  : null
const fallbackPrivacy = {
  competitiveFeatures: {
    shareSupplementsInComparisons: true,
    shareMedicationsInComparisons: false,
  },
}
const completeNutrition = {}
const includingTodayNutrition = {}
for (const days of [7, 14, 30, 90]) {
  completeNutrition[String(days)] = buildNutritionSnapshot(
    meals,
    fallbackPrivacy,
    snapshotNow,
    'America/Chicago',
    days,
    false
  )
  includingTodayNutrition[String(days)] = buildNutritionSnapshot(
    meals,
    fallbackPrivacy,
    snapshotNow,
    'America/Chicago',
    days,
    true
  )
}
const nutrition = {
  ...completeNutrition['7'],
  targets: publicMacroTargets(macroTargets),
  ranges: {
    complete: completeNutrition,
    includingToday: includingTodayNutrition,
  },
}

const payload = {
  root: {
    schemaVersion: 1,
    published: true,
    displayName: 'Ryan Sullivan',
    timeZone: 'America/Chicago',
    snapshotDay,
    generatedAt,
    trainingPublished: true,
    nutritionPublished: true,
    mealsPublished: allProjectedMeals.length > 0,
    trainingPlanPublished: Boolean(projectedPlan),
    training: summarizeWorkouts(projectedWorkouts, snapshotDay),
    nutrition,
    mealRecord: {
      startDay: publicHistoryStartDay,
      mealCount: allProjectedMeals.length,
      recordedDays: new Set(allProjectedMeals.map((meal) => meal.day)).size,
      earliestDay: allProjectedMeals.at(-1)?.day || null,
      latestDay: allProjectedMeals[0]?.day || null,
    },
  },
  workouts: projectedWorkouts,
  meals: allProjectedMeals.slice(0, 50),
  plan: projectedPlan,
}

const serialized = JSON.stringify(payload)
for (const forbidden of [
  '"routeCoordinates"',
  '"latitude"',
  '"longitude"',
  '"startDate"',
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
  snapshotDay,
  allWorkouts: projectedWorkouts.length,
  includedWorkoutRows: payload.workouts.length,
  nutritionRecordedDays: nutrition.recordedDays,
  allMeals: allProjectedMeals.length,
  includedMealRows: payload.meals.length,
  planPublished: Boolean(projectedPlan),
}, null, 2))
