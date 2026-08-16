import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export interface NudgeCopy {
  title: string
  body: string
}

export interface NudgeSlotDefinition {
  label: string
  description: string
  surface: 'iPhone' | 'iPhone Notifications' | 'Apple Watch'
  maxTitleLength: number
  maxBodyLength: number
  defaultTitle: string
  defaultBody: string
}

export interface NudgeRevision {
  schemaVersion: number
  locale: 'en'
  revision: number
  slots: Record<string, NudgeCopy>
  publishedAtMillis: number | null
  publishedBy: string | null
  action: 'publish' | 'rollback'
  rollbackOfRevision: number | null
}

export interface NudgeDraft {
  schemaVersion: number
  locale: 'en'
  version: number
  baseRevision: number
  slots: Record<string, NudgeCopy>
  savedAtMillis: number | null
  savedBy: string | null
}

export interface NudgeStudioState {
  definitions: Record<string, NudgeSlotDefinition>
  active: NudgeRevision
  history: NudgeRevision[]
  draft?: NudgeDraft | null
}

export interface LocalNudgeDraft {
  schemaVersion: 1
  baseRevision: number
  slots: Record<string, NudgeCopy>
  savedAtMillis: number
}

const LOCAL_DRAFT_KEY = 'statskey.nudgeStudio.draft.v1'

const getStateCall = httpsCallable<Record<string, never>, NudgeStudioState>(
  functions,
  'getRecordingNudgeStudioState'
)

const saveDraftCall = httpsCallable<
  {
    expectedDraftVersion: number
    baseRevision: number
    slots: Record<string, NudgeCopy>
  },
  NudgeDraft
>(functions, 'saveRecordingNudgeDraft')

const publishCall = httpsCallable<
  { expectedRevision: number; slots: Record<string, NudgeCopy> },
  NudgeStudioState
>(functions, 'publishRecordingNudges', {
  limitedUseAppCheckTokens: true,
})

const rollbackCall = httpsCallable<
  { expectedRevision: number; targetRevision: number },
  NudgeStudioState
>(functions, 'rollbackRecordingNudges', {
  limitedUseAppCheckTokens: true,
})

export async function loadNudgeStudio(): Promise<NudgeStudioState> {
  const result = await getStateCall({})
  return result.data
}

export async function saveNudgeDraft(
  expectedDraftVersion: number,
  baseRevision: number,
  slots: Record<string, NudgeCopy>
): Promise<NudgeDraft> {
  const result = await saveDraftCall({
    expectedDraftVersion,
    baseRevision,
    slots,
  })
  return result.data
}

export function loadLocalNudgeDraft(): LocalNudgeDraft | null {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LocalNudgeDraft>
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.baseRevision !== 'number' ||
      !Number.isInteger(parsed.baseRevision) ||
      typeof parsed.savedAtMillis !== 'number' ||
      !parsed.slots ||
      typeof parsed.slots !== 'object' ||
      Array.isArray(parsed.slots)
    ) {
      return null
    }
    const slots = Object.fromEntries(
      Object.entries(parsed.slots).flatMap(([slotId, copy]) => {
        if (
          !copy ||
          typeof copy !== 'object' ||
          typeof copy.title !== 'string' ||
          typeof copy.body !== 'string'
        ) {
          return []
        }
        return [[slotId, { title: copy.title, body: copy.body }]]
      })
    )
    return {
      schemaVersion: 1,
      baseRevision: parsed.baseRevision,
      slots,
      savedAtMillis: parsed.savedAtMillis,
    }
  } catch {
    return null
  }
}

export function saveLocalNudgeDraft(
  baseRevision: number,
  slots: Record<string, NudgeCopy>
): LocalNudgeDraft | null {
  try {
    const draft: LocalNudgeDraft = {
      schemaVersion: 1,
      baseRevision,
      slots,
      savedAtMillis: Date.now(),
    }
    localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft))
    return draft
  } catch {
    return null
  }
}

export function clearLocalNudgeDraft(): void {
  try {
    localStorage.removeItem(LOCAL_DRAFT_KEY)
  } catch {
    // Storage can be unavailable in hardened browser modes.
  }
}

export async function publishNudges(
  expectedRevision: number,
  slots: Record<string, NudgeCopy>
): Promise<NudgeStudioState> {
  const result = await publishCall({ expectedRevision, slots })
  return result.data
}

export async function rollbackNudges(
  expectedRevision: number,
  targetRevision: number
): Promise<NudgeStudioState> {
  const result = await rollbackCall({ expectedRevision, targetRevision })
  return result.data
}
