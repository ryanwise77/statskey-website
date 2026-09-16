import { decodeStrengthSession, type StrengthSession } from './model.ts'

export interface StrengthDraft {
  session: StrengthSession
  duration: string
  restUntil: number | null
}
const key = (uid: string) => `statskey-strength-draft-v1:${uid}`

export function readStrengthDraft(
  uid: string,
  storage?: Pick<Storage, 'getItem'>,
): StrengthDraft | null {
  try {
    const value = JSON.parse(
      (storage ?? sessionStorage).getItem(key(uid)) ?? 'null',
    )
    if (
      !value ||
      value.version !== 1 ||
      value.session?.userId !== uid ||
      typeof value.session.id !== 'string' ||
      value.session.status !== 'active'
    )
      return null
    const session = decodeStrengthSession(value.session, value.session.id, uid)
    if (!session || !session.entries.length) return null
    if (session.recordingMode === 'live' && value.session.timedSetId === undefined) {
      // Drafts created before the single-clock field existed stored the start
      // directly on each row. Recover the latest unfinished clock only.
      session.timedSetId = session.entries.flatMap((e) => e.sets)
        .filter((s) => !s.isCompleted && s.startedAt && s.durationSeconds == null)
        .sort((a, b) => b.startedAt!.getTime() - a.startedAt!.getTime())[0]?.id
    }
    return {
      session,
      duration: typeof value.duration === 'string' ? value.duration : '45',
      restUntil: Number.isFinite(value.restUntil) ? value.restUntil : null,
    }
  } catch {
    return null
  }
}
export function writeStrengthDraft(
  uid: string,
  draft: StrengthDraft,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): boolean {
  try {
    const destination = storage ?? sessionStorage
    if (draft.session.userId !== uid) return false
    if (draft.session.entries.length)
      destination.setItem(key(uid), JSON.stringify({ version: 1, ...draft }))
    else destination.removeItem(key(uid))
    return true
  } catch {
    return false
  }
}
