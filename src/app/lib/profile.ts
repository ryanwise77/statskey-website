import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from './firebase'

// Mirrors biometrics/StatsKey/Models/UserProfile.swift exactly. Field names
// and enum raw values must match, otherwise iOS decoding will fall back to
// defaults or fail.

export type BiologicalProfile =
  | 'male'
  | 'female'
  | 'transManNoHRT'
  | 'transManHRT'
  | 'transWomanNoHRT'
  | 'transWomanHRT'
  | 'nonBinaryNoHRT'
  | 'nonBinaryEstrogen'
  | 'nonBinaryTestosterone'

export type ActivityLevel =
  | 'sedentary'
  | 'lightlyActive'
  | 'moderatelyActive'
  | 'veryActive'
  | 'extremelyActive'

export type AppFocus = 'nutrition' | 'exercise' | 'both'

export interface HormoneProfile {
  isOnHRT: boolean
  hormoneType?: 'estrogen' | 'testosterone'
  duration?: 'lessThanOneYear' | 'oneToThreeYears' | 'threeToFiveYears' | 'moreThanFiveYears'
}

export interface UserProfile {
  id: string
  name: string
  email: string
  heightFeet: number
  heightInches: number
  weightLbs: number
  birthYear?: number
  exactBirthday?: Date
  usesImperial: boolean
  biologicalProfile: BiologicalProfile
  hormoneProfile?: HormoneProfile
  activityLevel: ActivityLevel
  appFocus: AppFocus
  dietaryPreferences: string[]
  foodAllergies: string[]
  foodIntolerances: string[]
  medicalConditions: string[]
  healthNotes: string
  skinType?: number // 1..6 (Fitzpatrick)
  typicalOutdoorMinutes?: number
  latitude?: number
  isPro: boolean
  onboardingComplete: boolean
  /** Opt-in home surface. False keeps the dashboard as the signed-in home. */
  startInWorkbench: boolean
  /** Set after the first-run home choice so the choice is not repeated. */
  homePreferenceChosen: boolean
  pendingDeletionAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface SocialProfile {
  username?: string
  phoneHash?: string
  isDiscoverable: boolean
  displayName?: string
  avatarURL?: string
}

function defaultProfile(user: User): UserProfile {
  const now = new Date()
  return {
    id: user.uid,
    name: user.displayName ?? '',
    email: user.email ?? '',
    heightFeet: 5,
    heightInches: 9,
    weightLbs: 160,
    usesImperial: true,
    biologicalProfile: 'male',
    activityLevel: 'moderatelyActive',
    appFocus: 'both',
    dietaryPreferences: [],
    foodAllergies: [],
    foodIntolerances: [],
    medicalConditions: [],
    healthNotes: '',
    isPro: false,
    onboardingComplete: false,
    startInWorkbench: false,
    homePreferenceChosen: false,
    createdAt: now,
    updatedAt: now,
  }
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function decodeProfile(data: Record<string, unknown>, uid: string): UserProfile {
  const base = defaultProfile({ uid, displayName: null, email: null } as User)
  // Dates arrive as Firestore Timestamp from iOS; normalize.
  const toDate = (v: unknown): Date | undefined => {
    if (!v) return undefined
    if (v instanceof Timestamp) return v.toDate()
    if (v instanceof Date) return v
    if (typeof v === 'string') {
      const d = new Date(v)
      return isNaN(d.getTime()) ? undefined : d
    }
    if (typeof v === 'number') return new Date(v * 1000)
    return undefined
  }

  // Height legacy migration (cm -> ft/in)
  let heightFeet = typeof data.heightFeet === 'number' ? data.heightFeet : base.heightFeet
  let heightInches = typeof data.heightInches === 'number' ? data.heightInches : base.heightInches
  if (typeof data.heightCm === 'number' && typeof data.heightFeet !== 'number') {
    const totalInches = (data.heightCm as number) / 2.54
    heightFeet = Math.floor(totalInches / 12)
    heightInches = Math.round(totalInches) % 12
  }

  // Weight legacy migration (kg -> lbs)
  let weightLbs = typeof data.weightLbs === 'number' ? data.weightLbs : base.weightLbs
  if (typeof data.weightKg === 'number' && typeof data.weightLbs !== 'number') {
    weightLbs = (data.weightKg as number) * 2.20462
  }

  return {
    id: uid,
    name: (data.name as string) ?? '',
    email: (data.email as string) ?? '',
    heightFeet,
    heightInches,
    weightLbs,
    birthYear: typeof data.birthYear === 'number' ? (data.birthYear as number) : undefined,
    exactBirthday: toDate(data.exactBirthday),
    usesImperial: typeof data.usesImperial === 'boolean' ? (data.usesImperial as boolean) : true,
    biologicalProfile: (data.biologicalProfile as BiologicalProfile) ?? 'male',
    hormoneProfile: (data.hormoneProfile as HormoneProfile) ?? undefined,
    activityLevel: (data.activityLevel as ActivityLevel) ?? 'moderatelyActive',
    appFocus: (data.appFocus as AppFocus) ?? 'both',
    dietaryPreferences: strArr(data.dietaryPreferences),
    foodAllergies: strArr(data.foodAllergies),
    foodIntolerances: strArr(data.foodIntolerances),
    medicalConditions: strArr(data.medicalConditions),
    healthNotes: typeof data.healthNotes === 'string' ? (data.healthNotes as string) : '',
    skinType: typeof data.skinType === 'number' ? (data.skinType as number) : undefined,
    typicalOutdoorMinutes:
      typeof data.typicalOutdoorMinutes === 'number' ? (data.typicalOutdoorMinutes as number) : undefined,
    latitude: typeof data.latitude === 'number' ? (data.latitude as number) : undefined,
    isPro: Boolean(data.isPro),
    onboardingComplete: Boolean(data.onboardingComplete),
    startInWorkbench: data.startInWorkbench === true,
    homePreferenceChosen: data.homePreferenceChosen === true,
    pendingDeletionAt: toDate(data.pendingDeletionAt),
    createdAt: toDate(data.createdAt) ?? new Date(),
    updatedAt: toDate(data.updatedAt) ?? new Date(),
  }
}

function encodeProfile(profile: UserProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    heightFeet: profile.heightFeet,
    heightInches: profile.heightInches,
    weightLbs: profile.weightLbs,
    usesImperial: profile.usesImperial,
    biologicalProfile: profile.biologicalProfile,
    activityLevel: profile.activityLevel,
    appFocus: profile.appFocus,
    dietaryPreferences: profile.dietaryPreferences,
    foodAllergies: profile.foodAllergies,
    foodIntolerances: profile.foodIntolerances,
    medicalConditions: profile.medicalConditions,
    healthNotes: profile.healthNotes,
    isPro: profile.isPro,
    onboardingComplete: profile.onboardingComplete,
    startInWorkbench: profile.startInWorkbench === true,
    homePreferenceChosen: profile.homePreferenceChosen === true,
    createdAt: profile.createdAt,
    updatedAt: new Date(),
  }
  if (profile.birthYear !== undefined) out.birthYear = profile.birthYear
  if (profile.exactBirthday) out.exactBirthday = profile.exactBirthday
  if (profile.hormoneProfile) out.hormoneProfile = profile.hormoneProfile
  if (profile.skinType !== undefined) out.skinType = profile.skinType
  if (profile.typicalOutdoorMinutes !== undefined) out.typicalOutdoorMinutes = profile.typicalOutdoorMinutes
  if (profile.latitude !== undefined) out.latitude = profile.latitude
  return out
}

/**
 * Load the profile using the same strategy as AuthService.swift:
 *   1. Check the legacy path users/{uid}/profile/current — if present,
 *      migrate it to the canonical users/{uid} doc and delete the legacy.
 *   2. Otherwise, read users/{uid}.
 *   3. If neither exists, return undefined (caller will create a fallback).
 */
export async function loadProfile(uid: string): Promise<UserProfile | undefined> {
  const legacyRef = doc(db, 'users', uid, 'profile', 'current')
  const legacySnap = await getDoc(legacyRef).catch(() => undefined)
  if (legacySnap?.exists()) {
    const legacyData = legacySnap.data() as Record<string, unknown>
    const migrated = decodeProfile(legacyData, uid)
    try {
      await setDoc(doc(db, 'users', uid), encodeProfile(migrated), { merge: true })
      await deleteDoc(legacyRef)
    } catch {
      // migration is best-effort
    }
    return migrated
  }

  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return undefined
  return decodeProfile(snap.data() as Record<string, unknown>, uid)
}

export async function saveProfile(uid: string, profile: UserProfile): Promise<void> {
  const payload = encodeProfile({ ...profile, id: uid })
  await setDoc(doc(db, 'users', uid), payload, { merge: true })
}

/**
 * Mirror of AuthService.ensureProfile(for:). Creates the canonical user doc
 * and the social profile if either is missing. Uses the same field names
 * and defaults iOS uses so the iOS app cannot tell a web-created user from
 * an iOS-created one.
 */
export async function ensureProfile(user: User): Promise<UserProfile> {
  const existing = await loadProfile(user.uid)
  let profile = existing
  if (!profile) {
    profile = defaultProfile(user)
    // iOS sets onboardingComplete=true for fallback profiles but false for
    // newly created ones in signInWith{Apple,Google}. Match the create path.
    profile.onboardingComplete = false
    await saveProfile(user.uid, profile)
  }

  const socialRef = doc(db, 'users', user.uid, 'social', 'profile')
  const socialSnap = await getDoc(socialRef).catch(() => undefined)
  if (!socialSnap?.exists()) {
    const social: SocialProfile = {
      username: (user.email ?? '').split('@')[0] || undefined,
      isDiscoverable: true,
      displayName: user.displayName ?? profile.name,
    }
    try {
      await setDoc(socialRef, social, { merge: true })
    } catch {
      // non-fatal
    }
  }

  return profile
}
