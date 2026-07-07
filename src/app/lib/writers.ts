import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { decodeWaterEntry } from './decoders'
import { endOfDay, localDateString, startOfDay } from './firestore'
import { deriveTrustMetadata } from './provenance'
import type {
  FoodItem,
  GlucoseReading,
  MacroTargets,
  Meal,
  PortionEstimate,
  ReportTopic,
  RoutePoint,
  SavedRoute,
  SubstanceEntry,
  WaterEntry,
  WeightEntry,
  WellnessData,
  WellnessEntry,
  WorkoutComment,
  WorkoutSession,
} from './types'

function encodePortionEstimate(est: PortionEstimate): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (est.draftGrams && est.draftGrams.length) out.draftGrams = est.draftGrams
  if (est.lowGram != null) out.lowGram = est.lowGram
  if (est.highGram != null) out.highGram = est.highGram
  return out
}

/**
 * Encodes a FoodItem back into a plain Firestore payload. Matches the fields
 * written by biometrics/StatsKey/Models/FoodItem.swift so iOS can read the
 * item natively — including the 4.7 trust/provenance/portion metadata, so
 * web-recorded meals carry the same confidence signals and iOS-recorded
 * provenance survives a web edit instead of being stripped.
 */
export function encodeFoodItem(item: FoodItem): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    name: item.name,
    servingSize: item.servingSize,
    servingUnit: item.servingUnit,
    nutrients: item.nutrients,
    isFavorite: item.isFavorite,
    hiddenFromFriends: item.hiddenFromFriends ?? false,
    useCount: item.useCount,
    source: item.source,
    itemCategory: item.itemCategory,
    // iOS always re-derives + persists these on save (sanitizedForPersistence),
    // so the recorded amount is correctly classified and trust stays consistent.
    quantityWasUserAdjusted: item.quantityWasUserAdjusted ?? false,
    trustMetadata: deriveTrustMetadata(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
  if (item.brand) out.brand = item.brand
  if (item.barcode) out.barcode = item.barcode
  if (item.baseNutrients) out.baseNutrients = item.baseNutrients
  if (item.baseServingSize != null) out.baseServingSize = item.baseServingSize
  if (item.baseServingUnit) out.baseServingUnit = item.baseServingUnit
  if (item.gramWeight != null) out.gramWeight = item.gramWeight
  if (item.gramsPerCup != null) out.gramsPerCup = item.gramsPerCup
  if (item.lastUsed) out.lastUsed = item.lastUsed
  if (item.notes) out.notes = item.notes
  if (item.geminiExplanation) out.geminiExplanation = item.geminiExplanation
  if (item.consumedAt) out.consumedAt = item.consumedAt
  // Enrichment / backfill provenance — preserved on round-trip so an iOS-filled
  // item edited on the web keeps its per-nutrient sources and confidence.
  if (item.aiEstimatedNutrientKeys?.length) out.aiEstimatedNutrientKeys = item.aiEstimatedNutrientKeys
  if (item.nutrientFillSources) out.nutrientFillSources = item.nutrientFillSources
  // iOS CodingKey maps `nutrientFillConfidence` to the Firestore key `nutrientConfidence`.
  if (item.nutrientFillConfidence) out.nutrientConfidence = item.nutrientFillConfidence
  if (item.nutrientErrPct) out.nutrientErrPct = item.nutrientErrPct
  if (item.enrichmentMethod) out.enrichmentMethod = item.enrichmentMethod
  if (item.enrichmentCitation) out.enrichmentCitation = item.enrichmentCitation
  if (item.enrichmentSchemaVersion != null) out.enrichmentSchemaVersion = item.enrichmentSchemaVersion
  if (item.portionEstimate) out.portionEstimate = encodePortionEstimate(item.portionEstimate)
  return out
}

/**
 * Encodes a Meal into a plain Firestore payload matching the iOS Meal model.
 * Writes to users/{uid}/meals/{id}.
 */
export async function saveMeal(uid: string, meal: Meal): Promise<void> {
  const payload: Record<string, unknown> = {
    id: meal.id,
    userId: uid,
    items: meal.items.map(encodeFoodItem),
    date: meal.date,
    multiplier: meal.multiplier,
    isFavorite: meal.isFavorite,
    createdAt: meal.createdAt,
    updatedAt: new Date(),
  }
  // Keep this explicit so editing an existing meal can clear its prior name.
  payload.name = meal.name ?? null
  if (meal.glucoseResponse) payload.glucoseResponse = meal.glucoseResponse
  if (meal.photoURLs && meal.photoURLs.length) payload.photoURLs = meal.photoURLs
  if (meal.analysisMode) payload.analysisMode = meal.analysisMode
  // Friend-privacy + on-demand AI fields — round-tripped so a web edit doesn't
  // strip the meal's hidden-item snapshot or its Pro/Pro+ insights.
  payload.hiddenItemCount = meal.hiddenItemCount ?? 0
  if (meal.totalNutrientsOverride) payload.totalNutrientsOverride = meal.totalNutrientsOverride
  if (meal.aiExplanation) payload.aiExplanation = meal.aiExplanation
  if (meal.aiItemInsights) payload.aiItemInsights = meal.aiItemInsights

  await setDoc(doc(db, 'users', uid, 'meals', meal.id), payload, { merge: true })
}

export async function deleteMeal(uid: string, mealId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'meals', mealId))
}

export async function saveFoodToLibrary(uid: string, food: FoodItem): Promise<void> {
  const now = new Date()
  await setDoc(
    doc(db, 'users', uid, 'foodLibrary', food.id),
    encodeFoodItem({
      ...food,
      useCount: food.useCount + 1,
      lastUsed: now,
      updatedAt: now,
    }),
    { merge: true }
  )
}

/** Persists edits to an existing library food without inflating its use count. */
export async function updateLibraryFood(uid: string, food: FoodItem): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'foodLibrary', food.id),
    encodeFoodItem({ ...food, updatedAt: new Date() }),
    { merge: true }
  )
}

export async function deleteLibraryFood(uid: string, foodId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'foodLibrary', foodId))
}

export async function saveDailyItem(uid: string, item: FoodItem): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'dailyItems', item.id), encodeFoodItem(item), { merge: true })
}

export async function deleteDailyItem(uid: string, itemId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'dailyItems', itemId))
}

/** Flips the favorite flag on a saved meal without rewriting the whole doc. */
export async function setMealFavorite(uid: string, mealId: string, isFavorite: boolean): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'meals', mealId),
    { isFavorite, updatedAt: new Date() },
    { merge: true }
  )
}

/**
 * Water pipeline — mirrors DatabaseService.swift's per-entry tracking.
 * Per-entry docs live at users/{uid}/waterEntries/{entryId}; the daily rollup
 * at users/{uid}/water/{YYYY-MM-DD} (field `amount`) is kept in sync so every
 * existing reader (dashboards, friends, iOS listeners) still works.
 */

function encodeWaterEntry(entry: WaterEntry): Record<string, unknown> {
  return {
    id: entry.id,
    userId: entry.userId,
    amount: entry.amount,
    date: entry.date,
    createdAt: entry.createdAt,
    updatedAt: new Date(),
  }
}

/** Records a new water entry + atomically bumps the day rollup in one batch. */
export async function logWaterEntry(uid: string, flOz: number, date: Date = new Date()): Promise<void> {
  const now = new Date()
  const entry: WaterEntry = {
    id: newId(),
    userId: uid,
    amount: flOz,
    date,
    createdAt: now,
    updatedAt: now,
  }
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid, 'waterEntries', entry.id), encodeWaterEntry(entry))
  batch.set(
    doc(db, 'users', uid, 'water', localDateString(date)),
    { amount: increment(flOz), date: Timestamp.fromDate(startOfDay(date)) },
    { merge: true }
  )
  await batch.commit()
}

/** Legacy quick-add kept for dashboard buttons — now records a real entry. */
export async function addWaterOz(uid: string, flOz: number, day: Date = new Date()): Promise<void> {
  await logWaterEntry(uid, flOz, day)
}

async function fetchWaterEntriesForDay(uid: string, day: Date): Promise<WaterEntry[]> {
  const snap = await getDocs(
    query(
      collection(db, 'users', uid, 'waterEntries'),
      where('date', '>=', Timestamp.fromDate(startOfDay(day))),
      where('date', '<=', Timestamp.fromDate(endOfDay(day))),
      orderBy('date', 'asc')
    )
  )
  return snap.docs.map((d) => decodeWaterEntry(d.data() as Record<string, unknown>, d.id))
}

/** Rebuilds the day rollup from its entries (after edits/deletes). */
async function recomputeDailyWaterTotal(uid: string, day: Date): Promise<void> {
  const entries = await fetchWaterEntriesForDay(uid, day)
  const total = entries.reduce((sum, e) => sum + e.amount, 0)
  await setDoc(
    doc(db, 'users', uid, 'water', localDateString(day)),
    { amount: total, date: Timestamp.fromDate(startOfDay(day)) },
    { merge: true }
  )
}

/** Persists an edit to an existing entry, then rebuilds affected day rollups. */
export async function updateWaterEntry(uid: string, entry: WaterEntry, originalDate: Date): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'waterEntries', entry.id), encodeWaterEntry(entry))
  await recomputeDailyWaterTotal(uid, entry.date)
  if (localDateString(originalDate) !== localDateString(entry.date)) {
    await recomputeDailyWaterTotal(uid, originalDate)
  }
}

export async function deleteWaterEntry(uid: string, entryId: string, date: Date): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'waterEntries', entryId))
  await recomputeDailyWaterTotal(uid, date)
}

/** Wipes every per-entry record for the day and zeroes the rollup ("Reset"). */
export async function deleteAllWaterEntries(uid: string, day: Date): Promise<void> {
  const entries = await fetchWaterEntriesForDay(uid, day)
  const batch = writeBatch(db)
  for (const e of entries) {
    batch.delete(doc(db, 'users', uid, 'waterEntries', e.id))
  }
  batch.set(
    doc(db, 'users', uid, 'water', localDateString(day)),
    { amount: 0, date: Timestamp.fromDate(startOfDay(day)) },
    { merge: true }
  )
  await batch.commit()
}

/**
 * One-time-per-day backfill mirroring materializeLegacyWaterIfNeeded: if the
 * day has a legacy rollup total but no per-entry records, materialize it as a
 * single entry pinned to the start of day. Idempotent.
 */
export async function materializeLegacyWaterIfNeeded(uid: string, day: Date): Promise<boolean> {
  const existing = await fetchWaterEntriesForDay(uid, day)
  if (existing.length > 0) return false

  const rollup = await getDoc(doc(db, 'users', uid, 'water', localDateString(day))).catch(() => null)
  const legacyTotal = rollup?.exists() ? Number(rollup.data()?.amount ?? 0) : 0
  if (!(legacyTotal > 0)) return false

  const now = new Date()
  const entry: WaterEntry = {
    id: newId(),
    userId: uid,
    amount: legacyTotal,
    date: startOfDay(day),
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(doc(db, 'users', uid, 'waterEntries', entry.id), encodeWaterEntry(entry))
  return true
}

// MARK: - Weight writes
// users/{uid}/weights has a strict field allowlist in firestore.rules:
// ["id", "weightLbs", "bodyFatPercent", "muscleMassKg", "date", "source",
//  "_syncHash", "_syncUpdatedAt"] — do not add fields here.

export async function saveWeightEntry(uid: string, entry: WeightEntry): Promise<void> {
  const payload: Record<string, unknown> = {
    id: entry.id,
    weightLbs: entry.weightLbs,
    date: Timestamp.fromDate(entry.date),
    source: entry.source ?? 'Manual',
  }
  if (entry.bodyFatPercent != null) payload.bodyFatPercent = entry.bodyFatPercent
  if (entry.muscleMassKg != null) payload.muscleMassKg = entry.muscleMassKg
  await setDoc(doc(db, 'users', uid, 'weights', entry.id), payload)
}

export async function deleteWeightEntry(uid: string, entryId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'weights', entryId))
}

// MARK: - Glucose writes
// users/{uid}/glucoseReadings enforces hasOnly(["id", "value", "timestamp",
// "source", "trend", "_syncHash", "_syncUpdatedAt"]) + value in 20...600.

export async function saveGlucoseReading(uid: string, reading: GlucoseReading): Promise<void> {
  if (!(reading.value >= 20 && reading.value <= 600)) {
    throw new Error('Glucose must be between 20 and 600 mg/dL.')
  }
  const payload: Record<string, unknown> = {
    id: reading.id,
    value: reading.value,
    timestamp: Timestamp.fromDate(reading.timestamp),
    source: reading.source,
  }
  if (reading.trend) payload.trend = reading.trend
  await setDoc(doc(db, 'users', uid, 'glucoseReadings', reading.id), payload)
}

export async function deleteGlucoseReading(uid: string, readingId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'glucoseReadings', readingId))
}

// MARK: - Wellness writes

/**
 * Encodes the polymorphic WellnessData back to the iOS representation —
 * a `type` discriminator key plus type-specific sub-keys. Matches
 * biometrics/StatsKey/Models/WellnessEntry.swift:123-193.
 */
function encodeWellnessData(data: WellnessData): Record<string, unknown> {
  switch (data.kind) {
    case 'symptom':
      return {
        type: 'symptom',
        symptom: {
          symptom: data.entry.symptom,
          severity: data.entry.severity,
          duration: data.entry.duration ?? null,
          bodyArea: data.entry.bodyArea ?? null,
          triggers: data.entry.triggers,
        },
      }
    case 'mood':
      return {
        type: 'mood',
        mood: {
          rating: data.entry.rating,
          stress: data.entry.stress ?? null,
          tags: data.entry.tags,
          notes: data.entry.notes ?? null,
        },
      }
    case 'energy':
      return {
        type: 'energy',
        energy: {
          level: data.entry.level,
          crashTime: data.entry.crashTime ?? null,
          tags: data.entry.tags ?? [],
          notes: data.entry.notes ?? null,
        },
      }
    case 'bowelMovement':
      return {
        type: 'bowelMovement',
        bowelMovement: {
          bristolType: data.entry.bristolType,
          color: data.entry.color ?? null,
          urgency: data.entry.urgency ?? null,
          durationInSeconds: data.entry.durationInSeconds ?? null,
          notes: data.entry.notes ?? null,
          estimatedSize: data.entry.estimatedSize ?? null,
          // iOS-only private photo attachment survives web edits.
          photoStoragePath: data.entry.photoStoragePath ?? null,
          photoCreatedAt: data.entry.photoCreatedAt ?? null,
        },
      }
    case 'sleep':
      return { type: 'sleep', sleepHours: data.hours, sleepQuality: data.quality }
    case 'hydration':
      return { type: 'hydration', hydrationOz: data.ozConsumed }
    case 'custom':
      return {
        type: 'custom',
        customLabel: data.label,
        customValue: data.value,
        customUnit: data.unit ?? null,
      }
  }
}

export async function saveWellness(uid: string, entry: WellnessEntry): Promise<void> {
  const payload: Record<string, unknown> = {
    id: entry.id,
    userId: uid,
    type: entry.type,
    data: encodeWellnessData(entry.data),
    date: entry.date,
    createdAt: entry.createdAt,
    mealId: entry.mealId ?? null,
    notes: entry.notes ?? null,
    showInDashboardTimeline: entry.showInDashboardTimeline ?? false,
  }

  await setDoc(doc(db, 'users', uid, 'wellness', entry.id), payload, { merge: true })
}

export async function deleteWellness(uid: string, entryId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'wellness', entryId))
}

// MARK: - Substance writes

export async function saveSubstanceEntry(uid: string, entry: SubstanceEntry): Promise<void> {
  const now = new Date()
  const payload: Record<string, unknown> = {
    id: entry.id,
    userId: uid,
    kind: entry.kind,
    isPrivate: entry.isPrivate,
    date: entry.date,
    createdAt: entry.createdAt,
    updatedAt: now,
  }
  if (entry.name) payload.name = entry.name
  if (entry.method) payload.method = entry.method
  if (entry.amount != null) payload.amount = entry.amount
  if (entry.unit) payload.unit = entry.unit
  if (entry.notes) payload.notes = entry.notes

  await setDoc(doc(db, 'users', uid, 'substances', entry.id), payload, { merge: true })
}

export async function deleteSubstanceEntry(uid: string, entryId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'substances', entryId))
}

// MARK: - Macro targets

function encodeMacroTargets(t: MacroTargets): Record<string, unknown> {
  return {
    calories: t.calories,
    protein: t.protein,
    carbs: t.carbs,
    fat: t.fat,
    fiber: t.fiber,
    water: t.water,
    isAIAdaptive: t.isAIAdaptive,
    isWaterCustom: t.isWaterCustom,
    goalType: t.goalType,
    weeklyWeightChangeLbs: t.weeklyWeightChangeLbs,
    proteinGramsPerKg: t.proteinGramsPerKg,
    fatPercentage: t.fatPercentage,
    carbPreference: t.carbPreference,
    exerciseCalorieStrategy: t.exerciseCalorieStrategy,
    calorieFloor: t.calorieFloor,
    usesNetCarbs: t.usesNetCarbs,
  }
}

function macroTargetsChanged(a: MacroTargets, b: MacroTargets): boolean {
  return (
    Math.round(a.calories) !== Math.round(b.calories) ||
    Math.round(a.protein) !== Math.round(b.protein) ||
    Math.round(a.carbs) !== Math.round(b.carbs) ||
    Math.round(a.fat) !== Math.round(b.fat) ||
    Math.round(a.fiber) !== Math.round(b.fiber) ||
    Math.round(a.water) !== Math.round(b.water) ||
    a.isAIAdaptive !== b.isAIAdaptive ||
    a.goalType !== b.goalType
  )
}

/**
 * Saves users/{uid}/settings/macroTargets and appends a MacroTargetSnapshot to
 * users/{uid}/macroTargetHistory when the target meaningfully changed —
 * matching recordMacroTargetSnapshotIfChanged in DatabaseService.swift so
 * iOS reports keep comparing intake against the target active at the time.
 */
export async function saveMacroTargets(
  uid: string,
  targets: MacroTargets,
  reason: string = 'Edited on web'
): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'settings', 'macroTargets'), encodeMacroTargets(targets))

  try {
    const latestSnap = await getDocs(
      query(collection(db, 'users', uid, 'macroTargetHistory'), orderBy('effectiveAt', 'desc'), limit(1))
    )
    if (!latestSnap.empty) {
      const latestTargets = latestSnap.docs[0].data()?.targets as Record<string, unknown> | undefined
      if (latestTargets) {
        const prev = { ...targets, ...latestTargets } as MacroTargets
        if (!macroTargetsChanged(prev, targets)) return
      }
    }
    const snapshotId = newId()
    await setDoc(doc(db, 'users', uid, 'macroTargetHistory', snapshotId), {
      id: snapshotId,
      targets: encodeMacroTargets(targets),
      effectiveAt: Timestamp.fromDate(new Date()),
      recordedAt: Timestamp.fromDate(new Date()),
      source: 'manual',
      reason,
    })
  } catch {
    // History is best-effort; the live target doc is already saved.
  }
}

// MARK: - Workout social (kudos + comments)

/**
 * Toggles the caller's kudo on a workout. Matches toggleKudo at
 * DatabaseService.swift:1712 — doc ID is the kudo-giver's UID.
 */
export async function toggleWorkoutKudo(params: {
  workoutOwnerId: string
  workoutId: string
  kudoUserId: string
  userName: string
}): Promise<boolean> {
  const { workoutOwnerId, workoutId, kudoUserId, userName } = params
  const ref = doc(db, 'users', workoutOwnerId, 'workoutSessions', workoutId, 'kudos', kudoUserId)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    await deleteDoc(ref)
    return false
  }
  await setDoc(ref, {
    id: kudoUserId,
    userId: kudoUserId,
    userName,
    workoutId,
    createdAt: Timestamp.fromDate(new Date()),
  })
  return true
}

export async function addWorkoutComment(params: {
  workoutOwnerId: string
  comment: WorkoutComment
}): Promise<void> {
  const { workoutOwnerId, comment } = params
  await setDoc(
    doc(db, 'users', workoutOwnerId, 'workoutSessions', comment.workoutId, 'comments', comment.id),
    {
      id: comment.id,
      userId: comment.userId,
      userName: comment.userName,
      workoutId: comment.workoutId,
      text: comment.text,
      createdAt: Timestamp.fromDate(comment.createdAt),
    }
  )
}

// MARK: - Deep Dive reports

/**
 * Queues a remote Deep Dive job at users/{uid}/reportJobs/{jobId}. The
 * processReportJob Cloud Function runs Claude server-side and writes the
 * finished report to users/{uid}/reports/{jobId} (same doc ID).
 */
export async function createReportJob(uid: string, params: {
  topic: ReportTopic
  title: string
  systemPrompt: string
  userPrompt: string
  modelId: string
  modelLabel: string
  rangeStart: Date
  rangeEnd: Date
}): Promise<string> {
  const jobId = newId()
  await setDoc(doc(db, 'users', uid, 'reportJobs', jobId), {
    id: jobId,
    userId: uid,
    topicRaw: params.topic,
    title: params.title,
    promptUsed: params.userPrompt,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    modelId: params.modelId,
    modelLabel: params.modelLabel,
    rangeStart: Timestamp.fromDate(params.rangeStart),
    rangeEnd: Timestamp.fromDate(params.rangeEnd),
    status: 'queued',
    createdAt: Timestamp.fromDate(new Date()),
  })
  return jobId
}

export async function deleteReport(uid: string, reportId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'reports', reportId))
  await deleteDoc(doc(db, 'users', uid, 'reportJobs', reportId)).catch(() => {})
}

// MARK: - Account deletion (soft delete, mirrors iOS pendingDeletionAt flow)

export async function requestAccountDeletion(uid: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid),
    { pendingDeletionAt: Timestamp.fromDate(new Date()) },
    { merge: true }
  )
}

export async function cancelAccountDeletion(uid: string): Promise<void> {
  await setDoc(doc(db, 'users', uid), { pendingDeletionAt: null }, { merge: true })
}

// MARK: - Social profile

export async function saveSocialProfile(uid: string, social: {
  username?: string
  displayName?: string
  isDiscoverable: boolean
  avatarURL?: string
}): Promise<void> {
  const payload: Record<string, unknown> = {
    isDiscoverable: social.isDiscoverable,
  }
  if (social.username !== undefined) payload.username = social.username
  if (social.displayName !== undefined) payload.displayName = social.displayName
  if (social.avatarURL !== undefined) payload.avatarURL = social.avatarURL
  await setDoc(doc(db, 'users', uid, 'social', 'profile'), payload, { merge: true })
}

// MARK: - Workout writes

/**
 * Writes a workout session doc. We only write the minimum fields the manual
 * entry form supports; other fields (route, HR samples, zones) are reserved
 * for iOS live recordings and default to empty/zero on iOS's side.
 */
export async function saveWorkout(uid: string, workout: WorkoutSession): Promise<void> {
  const payload: Record<string, unknown> = {
    id: workout.id,
    userId: uid,
    title: workout.title,
    sportType: workout.sportType,
    startDate: workout.startDate,
    duration: workout.duration,
    movingTime: workout.movingTime,
    distance: workout.distance,
    elevationGain: workout.elevationGain,
    elevationLoss: workout.elevationLoss,
    calories: workout.calories,
    averagePace: workout.averagePace,
    bestPace: workout.bestPace,
    averageSpeed: workout.averageSpeed,
    maxSpeed: workout.maxSpeed,
    averageHeartRate: workout.averageHeartRate,
    maxHeartRate: workout.maxHeartRate,
    averageCadence: workout.averageCadence,
    isFavorite: workout.isFavorite,
    relativeEffort: workout.relativeEffort,
    gradeAdjustedPace: workout.gradeAdjustedPace,
    photoURLs: workout.photoURLs,
    source: workout.source,
    isIndoor: workout.isIndoor,
    recordingMode: workout.recordingMode,
    createdAt: workout.createdAt,
  }
  if (workout.endDate) payload.endDate = workout.endDate
  if (workout.notes) payload.notes = workout.notes
  if (workout.perceivedEffort != null) payload.perceivedEffort = workout.perceivedEffort
  if (workout.healthKitUUID) payload.healthKitUUID = workout.healthKitUUID
  if (workout.structuredWorkoutId) payload.structuredWorkoutId = workout.structuredWorkoutId

  await setDoc(doc(db, 'users', uid, 'workoutSessions', workout.id), payload, { merge: true })
}

export async function deleteWorkout(uid: string, workoutId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'workoutSessions', workoutId))
}

// MARK: - Route writes

function encodeRoutePoint(point: RoutePoint): Record<string, unknown> {
  const out: Record<string, unknown> = {
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitude,
    timestamp: point.timestamp,
    speed: point.speed,
  }
  if (point.heartRate != null) out.heartRate = point.heartRate
  return out
}

export async function saveRoute(uid: string, route: SavedRoute): Promise<void> {
  const payload: Record<string, unknown> = {
    id: route.id,
    name: route.name,
    description: route.description,
    sportType: route.sportType,
    createdBy: uid,
    creatorName: route.creatorName,
    routePoints: route.routePoints.map(encodeRoutePoint),
    distance: route.distance,
    elevationGain: route.elevationGain,
    elevationLoss: route.elevationLoss,
    estimatedDuration: route.estimatedDuration,
    difficulty: route.difficulty,
    isPublic: route.isPublic,
    rating: route.rating,
    ratingCount: route.ratingCount,
    timesCompleted: route.timesCompleted,
    createdAt: route.createdAt,
  }

  await setDoc(doc(db, 'users', uid, 'routes', route.id), payload, { merge: true })
  if (route.isPublic) {
    await setDoc(doc(db, 'publicRoutes', route.id), payload, { merge: true })
  } else {
    await deleteDoc(doc(db, 'publicRoutes', route.id)).catch(() => {})
  }
}

export async function deleteRoute(uid: string, routeId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'routes', routeId))
  await deleteDoc(doc(db, 'publicRoutes', routeId)).catch(() => {})
}

// MARK: - Friendships

/**
 * Resolves a free-form identifier (UID, 8-char friend code, or username) to a UID.
 * Matches biometrics/StatsKey/Services/DatabaseService.swift:578-596.
 */
export async function resolveUserIdentifier(input: string): Promise<string | null> {
  const trimmed = input.trim()
  if (!trimmed) return null

  // (1) treat as raw UID
  const asUidSnap = await getDoc(doc(db, 'users', trimmed)).catch(() => null)
  if (asUidSnap?.exists()) return trimmed

  // (2) friend code (uppercased)
  const upper = trimmed.toUpperCase()
  const upperSnap = await getDoc(doc(db, 'userLookup', upper)).catch(() => null)
  if (upperSnap?.exists()) {
    const raw = upperSnap.data() as Record<string, unknown>
    if (typeof raw.userId === 'string') return raw.userId
  }

  // (3) username (lowercased)
  const lower = trimmed.toLowerCase()
  const lowerSnap = await getDoc(doc(db, 'userLookup', lower)).catch(() => null)
  if (lowerSnap?.exists()) {
    const raw = lowerSnap.data() as Record<string, unknown>
    if (typeof raw.userId === 'string') return raw.userId
  }

  return null
}

/**
 * Sends a friend request by creating a top-level `friendships` doc. Matches
 * sendFriendRequest at biometrics/StatsKey/Services/DatabaseService.swift:475-482.
 */
export async function sendFriendRequest(senderUid: string, targetIdentifier: string): Promise<string> {
  const targetUid = await resolveUserIdentifier(targetIdentifier)
  if (!targetUid) throw new Error('Could not find a user with that code, username, or ID.')
  if (targetUid === senderUid) throw new Error("That's you!")

  const ref = await addDoc(collection(db, 'friendships'), {
    users: [senderUid, targetUid].sort(),
    senderId: senderUid,
    targetIdentifier: targetIdentifier.trim(),
    status: 'pending',
    createdAt: Timestamp.fromDate(new Date()),
  })
  return ref.id
}

export async function acceptFriendship(friendshipId: string): Promise<void> {
  await setDoc(
    doc(db, 'friendships', friendshipId),
    { status: 'accepted' },
    { merge: true }
  )
}

export async function deleteFriendship(friendshipId: string): Promise<void> {
  await deleteDoc(doc(db, 'friendships', friendshipId))
}

/**
 * Mirrors syncUserLookup at DatabaseService.swift:598-611 — writes lookup docs
 * for the user's 8-char uppercased friend code and (if set) their username.
 * Should be called once on login so web users are discoverable.
 */
export async function syncUserLookup(uid: string, opts: {
  displayName?: string
  email?: string
  username?: string
}): Promise<void> {
  const friendCode = uid.slice(0, 8).toUpperCase()
  const base = {
    userId: uid,
    displayName: opts.displayName ?? '',
    username: opts.username ?? '',
    email: opts.email ?? '',
    friendCode,
  }
  await setDoc(doc(db, 'userLookup', friendCode), base, { merge: true })
  if (opts.username) {
    await setDoc(doc(db, 'userLookup', opts.username.toLowerCase()), base, { merge: true })
  }
}

// MARK: - ID helper

export function newId(): string {
  // Firestore doesn't require a specific format for document IDs. iOS uses
  // UUID().uuidString — crypto.randomUUID() matches that format closely enough
  // (both are RFC 4122 strings). Fallback to Firestore auto-id if crypto is
  // unavailable.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().toUpperCase()
  }
  return doc(collection(db, '_tmp')).id
}
