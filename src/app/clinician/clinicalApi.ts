import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'

export const SHARE_CONSENT_VERSION = 1
export const CLINICIAN_TERMS_VERSION = 1
export const CLINICIAN_ACKNOWLEDGEMENT_VERSION = 1

export const clinicalCategories = [
  {
    id: 'activity',
    label: 'Physical activity & energy expenditure',
    description:
      'Steps, exercise minutes, movement distance, and device-estimated energy expenditure.',
  },
  {
    id: 'nutrition',
    label: 'Dietary intake & nutrient exposure',
    description:
      'Recorded energy, macronutrients, micronutrients, coverage, and estimate confidence.',
  },
  {
    id: 'workouts',
    label: 'Exercise sessions',
    description:
      'Modality, duration, distance, heart rate, energy expenditure, and perceived effort.',
  },
  {
    id: 'vitals',
    label: 'Vitals',
    description: 'Heart, respiratory, oxygen saturation, and VO₂ max samples.',
  },
  {
    id: 'sleep',
    label: 'Sleep',
    description: 'Nightly duration and sleep-stage totals.',
  },
  {
    id: 'glucose',
    label: 'Glucose summaries',
    description: 'Daily averages, range, and time-in-range—not raw readings.',
  },
  {
    id: 'body',
    label: 'Anthropometrics',
    description: 'Weight and selected body-composition measurements.',
  },
  {
    id: 'bloodPanels',
    label: 'Blood panels',
    description: 'Patient-entered or scanned results, including review flags.',
  },
  {
    id: 'wellness',
    label: 'Wellness & GI record',
    description:
      'Symptoms, mood, energy, hydration, and structured bowel-pattern observations without notes or photos.',
  },
] as const

export type ClinicalCategoryID = (typeof clinicalCategories)[number]['id']

export interface ClinicianProfile {
  uid: string
  email: string
  fullName: string
  practiceName: string
  professionalType: string
  professionalTypeOther?: string
  specialty?: string
  specialtyOther?: string
  npi?: string
  licenseJurisdiction?: string
  licenseNumber?: string
  cdrNumber?: string
  status: string
  credentialStatus: string
  credentialType?: string
  credentialVerificationSource?: string
  credentialVerificationURL?: string
  credentialVerifiedAt?: string
  credentialVerified: boolean
  pairingCode?: string
  canPair: boolean
  canReceiveShares: boolean
  dashboardModules: ClinicalCategoryID[]
  dashboardSetupComplete: boolean
  termsVersion: number
}

export interface ClinicianContext {
  registered: boolean
  emailVerified: boolean
  email?: string
  profile?: ClinicianProfile
}

export interface ClinicalShareSummary {
  id: string
  recipientLabel: string
  pairingId?: string
  patientDisplayName?: string
  categoryIDs: ClinicalCategoryID[]
  rangeStart: string
  rangeEnd: string
  createdAt: string
  redeemBy?: string
  expiresAt: string
  status: 'pending' | 'active' | 'revoked' | 'expired'
  redeemedAt?: string
  redeemedByName?: string
  redeemedByPractice?: string
  acknowledged: boolean
  lastAccessedAt?: string
  accessCount: number
}

export interface ClinicianPairingRequest {
  id: string
  firstName: string
  lastName: string
  email: string
  emailVerified: boolean
  status: 'pending' | 'confirmed' | 'declined' | 'revoked'
  dataAccessStatus: 'none' | 'awaitingPatientAuthorization'
  createdAt: string
  respondedAt?: string
}

export interface ClinicalManifestEntry {
  categoryID: ClinicalCategoryID
  status: 'included' | 'empty' | 'unavailable'
  recordCount: number
  truncated: boolean
}

export type ClinicalSnapshotRecord = Record<string, unknown>

export interface DietitianMetricEstimate {
  mean: number
  lower95: number
  upper95: number
}

export interface DietitianNutrientEstimate {
  key: string
  label: string
  category: string
  unit: string
  meanPerRecordedDay: number
  lower95: number
  upper95: number
  coverageDays: number
  confidence: 'high' | 'moderate' | 'limited'
  estimatedPercent: number
}

export interface DietitianInterval {
  id: '7d' | '30d' | '90d' | 'all'
  label: string
  startDay: string
  endDay: string
  calendarDays: number
  nutrition: {
    recordedDays: number
    recordingCoveragePercent: number
    mealCount: number
    nutrients: DietitianNutrientEstimate[]
  }
  activity: {
    recordedDays: number
    recordingCoveragePercent: number
    steps: DietitianMetricEstimate
    activeCaloriesKcal: DietitianMetricEstimate
    basalCaloriesKcal: DietitianMetricEstimate
    totalExpenditureKcal: DietitianMetricEstimate
    exerciseMinutes: DietitianMetricEstimate
    walkingRunningMiles: DietitianMetricEstimate
  }
  paired: {
    matchedDays: number
    intakeKcal: DietitianMetricEstimate
    deviceExpenditureKcal: DietitianMetricEstimate
    intakeMinusExpenditureKcal: DietitianMetricEstimate
    proteinGrams: DietitianMetricEstimate
    carbohydrateGrams: DietitianMetricEstimate
    fiberGrams: DietitianMetricEstimate
    steps: DietitianMetricEstimate
    exerciseMinutes: DietitianMetricEstimate
  }
}

export interface DietitianPairedDay {
  day: string
  intakeKcal: number
  deviceExpenditureKcal: number
  intakeMinusExpenditureKcal: number
  proteinGrams: number
  carbohydrateGrams: number
  fatGrams: number
  fiberGrams: number
  steps: number
  exerciseMinutes: number
}

export interface DietitianSummary {
  schemaVersion: number
  audience: 'registeredDietitian'
  vocabulary: 'dieteticPractice'
  scope: string
  generatedAt: string
  coverage: {
    startDay: string
    endDay: string
    mealDocuments: number
    nutritionRecordedDays: number
    activityRecordedDays: number
    truncated: {
      meals: boolean
      activity: boolean
    }
  }
  intervals: DietitianInterval[]
  pairedDaily: DietitianPairedDay[]
  methodology: {
    confidenceInterval: string
    nutrition: string
    activity: string
    pairing: string
  }
  disclaimer: string
}

export interface ClinicalSnapshot {
  schemaVersion: number
  generatedAt: string
  patient: {
    displayName: string
  }
  recordWindow: {
    start: string
    end: string
  }
  manifest: ClinicalManifestEntry[]
  sections: Partial<
    Record<ClinicalCategoryID, ClinicalSnapshotRecord[]>
  >
  dietitianSummary?: DietitianSummary
  disclosure: {
    source: string
    use: string
    warning?: string
  }
}

export interface ClinicalShareDraft {
  recipientLabel: string
  pairingId?: string
  categoryIDs: ClinicalCategoryID[]
  rangeStart: string
  rangeEnd: string
  accessDurationDays: number
  consentVersion: number
  confirmed: boolean
}

export interface ClinicianRegistration {
  fullName: string
  practiceName: string
  professionalType: string
  professionalTypeOther?: string
  specialty: string
  specialtyOther?: string
  npi?: string
  licenseJurisdiction?: string
  licenseNumber?: string
  cdrNumber?: string
  termsVersion: number
  termsAccepted: boolean
}

export async function getClinicianContext(): Promise<ClinicianContext> {
  return call<Record<string, never>, ClinicianContext>(
    'getClinicianContext',
    {}
  )
}

export async function registerClinician(
  registration: ClinicianRegistration
): Promise<ClinicianContext> {
  return call<ClinicianRegistration, ClinicianContext>(
    'registerClinician',
    registration
  )
}

export async function updateClinicianDashboard(
  dashboardModules: ClinicalCategoryID[]
): Promise<ClinicianContext> {
  return call('updateClinicianDashboard', { dashboardModules })
}

export async function listClinicianPairingRequests(): Promise<{
  requests: ClinicianPairingRequest[]
}> {
  return call('listClinicianPairingRequests', {})
}

export async function respondClinicalPairingRequest(
  pairingId: string,
  action: 'confirm' | 'decline'
): Promise<{ request: ClinicianPairingRequest }> {
  return call('respondClinicalPairingRequest', { pairingId, action })
}

export async function createClinicalShare(
  draft: ClinicalShareDraft
): Promise<{ share: ClinicalShareSummary; code: string; url: string }> {
  return call('createClinicalShare', draft)
}

export async function listClinicalShares(): Promise<{
  shares: ClinicalShareSummary[]
}> {
  return call('listClinicalShares', {})
}

export async function revokeClinicalShare(shareId: string): Promise<void> {
  await call('revokeClinicalShare', { shareId })
}

export async function redeemClinicalShare(token: string): Promise<{
  shareId: string
  recipientLabel: string
  categoryIDs: ClinicalCategoryID[]
  rangeStart: string
  rangeEnd: string
  expiresAt: string
  acknowledged: boolean
}> {
  return call('redeemClinicalShare', { token })
}

export async function listClinicianShares(): Promise<{
  shares: ClinicalShareSummary[]
}> {
  return call('listClinicianShares', {})
}

export async function acknowledgeClinicalShare(
  shareId: string
): Promise<void> {
  await call('acknowledgeClinicalShare', {
    shareId,
    accepted: true,
    version: CLINICIAN_ACKNOWLEDGEMENT_VERSION,
  })
}

export async function readClinicalShare(shareId: string): Promise<{
  share: ClinicalShareSummary
  snapshot: ClinicalSnapshot
}> {
  return call('readClinicalShare', { shareId })
}

async function call<Request, Response>(
  name: string,
  payload: Request
): Promise<Response> {
  try {
    const callable = httpsCallable<Request, Response>(
      functions,
      name,
      { limitedUseAppCheckTokens: true }
    )
    const result = await callable(payload)
    return result.data
  } catch (error) {
    throw new Error(clinicalErrorMessage(error))
  }
}

function clinicalErrorMessage(error: unknown): string {
  const code = errorCode(error)
  const message =
    error instanceof Error ? error.message.replace(/^Firebase:\s*/i, '') : ''
  switch (code) {
    case 'functions/unauthenticated':
      return 'Your professional session expired. Sign in again.'
    case 'functions/permission-denied':
      return message || 'This patient record is no longer available.'
    case 'functions/not-found':
      return 'That care-share code is invalid or no longer active.'
    case 'functions/resource-exhausted':
      return 'Too many requests. Wait a moment and try again.'
    case 'functions/failed-precondition':
      return message || 'This action is not available yet.'
    case 'appCheck/recaptcha-error':
    case 'appCheck/initial-throttle':
      return 'This browser could not be verified. Refresh and try again.'
    default:
      return message || 'The professional portal could not complete that request.'
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return String((error as { code?: unknown }).code)
}
