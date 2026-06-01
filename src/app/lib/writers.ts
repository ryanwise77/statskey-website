import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  increment,
  setDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { localDateString, startOfDay } from './firestore'
import type {
  FoodItem,
  Meal,
  RoutePoint,
  SavedRoute,
  SubstanceEntry,
  WellnessData,
  WellnessEntry,
  WorkoutSession,
} from './types'

/**
 * Encodes a FoodItem back into a plain Firestore payload. Matches the fields
 * written by biometrics/StatsKey/Models/FoodItem.swift so iOS can read the
 * item natively.
 */
export function encodeFoodItem(item: FoodItem): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    name: item.name,
    servingSize: item.servingSize,
    servingUnit: item.servingUnit,
    nutrients: item.nutrients,
    isFavorite: item.isFavorite,
    useCount: item.useCount,
    source: item.source,
    itemCategory: item.itemCategory,
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

export async function saveDailyItem(uid: string, item: FoodItem): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'dailyItems', item.id), encodeFoodItem(item), { merge: true })
}

/**
 * Water is stored at users/{uid}/water/{YYYY-MM-DD} with a cumulative `amount`.
 * This helper ADDS to the existing amount atomically using FieldValue.increment.
 * The doc ID matches biometrics/StatsKey/Services/DatabaseService.swift:137-141.
 */
export async function addWaterOz(uid: string, flOz: number, day: Date = new Date()): Promise<void> {
  const id = localDateString(day)
  await setDoc(
    doc(db, 'users', uid, 'water', id),
    { amount: increment(flOz), date: Timestamp.fromDate(startOfDay(day)) },
    { merge: true }
  )
}

export async function setWaterOz(uid: string, flOz: number, day: Date = new Date()): Promise<void> {
  const id = localDateString(day)
  await setDoc(
    doc(db, 'users', uid, 'water', id),
    { amount: flOz, date: Timestamp.fromDate(startOfDay(day)) },
    { merge: true }
  )
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
