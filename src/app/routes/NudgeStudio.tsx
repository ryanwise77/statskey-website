import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  clearLocalNudgeDraft,
  loadNudgeStudio,
  loadLocalNudgeDraft,
  publishNudges,
  rollbackNudges,
  saveLocalNudgeDraft,
  saveNudgeDraft,
  type NudgeCopy,
  type NudgeRevision,
  type NudgeStudioState,
} from '../lib/nudgeStudio'
import { confirmDialog } from '../lib/ui/dialogs'

type Drafts = Record<string, NudgeCopy>
type DraftSaveState = 'saved' | 'saving' | 'local'

export function NudgeStudio() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [studio, setStudio] = useState<NudgeStudioState | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [draftBaseRevision, setDraftBaseRevision] = useState(0)
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>('saved')
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [draftWarning, setDraftWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'publish' | `rollback-${number}` | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const initializedRef = useRef(false)
  const draftVersionRef = useRef(0)
  const currentDraftRef = useRef('')
  const cloudDraftRef = useRef('')
  const localDraftAvailableRef = useRef(true)
  const saveTimerRef = useRef<number | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    loadNudgeStudio()
      .then((next) => {
        if (cancelled) return
        const serverDraft = next.draft ?? null
        const localDraft = loadLocalNudgeDraft()
        const serverSlots = completeDrafts(
          serverDraft?.slots,
          next.active.slots,
          next.definitions
        )
        const localSlots = completeDrafts(
          localDraft?.slots,
          next.active.slots,
          next.definitions
        )
        const useLocalDraft =
          localDraft !== null &&
          localDraft.baseRevision <= next.active.revision &&
          localDraft.savedAtMillis > (serverDraft?.savedAtMillis ?? 0)
        const selectedDrafts = useLocalDraft
          ? localSlots
          : serverDraft
            ? serverSlots
            : cloneDrafts(next.active.slots)
        const selectedBaseRevision = useLocalDraft
          ? localDraft.baseRevision
          : serverDraft?.baseRevision ?? next.active.revision

        draftVersionRef.current = serverDraft?.version ?? 0
        cloudDraftRef.current = JSON.stringify(
          serverDraft ? serverSlots : next.active.slots
        )
        currentDraftRef.current = JSON.stringify(selectedDrafts)
        initializedRef.current = true
        setStudio(next)
        setDrafts(selectedDrafts)
        setDraftBaseRevision(selectedBaseRevision)
        setDraftSavedAt(
          useLocalDraft
            ? localDraft.savedAtMillis
            : serverDraft?.savedAtMillis ?? null
        )
        setDraftSaveState(
          currentDraftRef.current === cloudDraftRef.current ? 'saved' : 'local'
        )
        if (selectedBaseRevision !== next.active.revision) {
          setDraftWarning(
            'This draft is based on an earlier live revision. It is saved, but review the current copy before publishing.'
          )
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(toStudioError(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const dirty = useMemo(() => {
    if (!studio) return false
    return JSON.stringify(drafts) !== JSON.stringify(studio.active.slots)
  }, [drafts, studio])

  const groupedDefinitions = useMemo(() => {
    if (!studio) return []
    return ['iPhone', 'iPhone Notifications', 'Apple Watch'].map((surface) => ({
      surface,
      slots: Object.entries(studio.definitions).filter(
        ([, definition]) => definition.surface === surface
      ),
    }))
  }, [studio])
  const rawAccountName = user?.displayName?.trim()
  const accountName =
    rawAccountName && !/miller|nudge studio/i.test(rawAccountName)
      ? rawAccountName
      : 'Ryan'
  const draftStatusLabel =
    draftSaveState === 'saving'
      ? 'Saving…'
      : draftSaveState === 'local'
        ? 'Saved on this device'
        : dirty
          ? 'Saved'
          : 'No unpublished changes'

  const persistCloudDraft = useCallback(
    (snapshot: Drafts, baseRevision: number, serialized: string) => {
      const task = saveQueueRef.current
        .catch(() => {})
        .then(async () => {
          if (cloudDraftRef.current === serialized) {
            if (currentDraftRef.current === serialized) {
              setDraftSaveState('saved')
            }
            return
          }

          if (currentDraftRef.current === serialized) {
            setDraftSaveState('saving')
          }
          try {
            const saved = await saveNudgeDraft(
              draftVersionRef.current,
              baseRevision,
              snapshot
            )
            draftVersionRef.current = saved.version
            cloudDraftRef.current = serialized
            if (currentDraftRef.current === serialized) {
              setDraftSavedAt(saved.savedAtMillis)
              setDraftSaveState('saved')
              setDraftWarning(null)
            }
          } catch (saveError) {
            if (currentDraftRef.current === serialized) {
              setDraftSaveState('local')
              setDraftWarning(
                toDraftSaveMessage(saveError, localDraftAvailableRef.current)
              )
            }
          }
        })
      saveQueueRef.current = task
      return task
    },
    []
  )

  useEffect(() => {
    if (!studio || !initializedRef.current) return

    const serialized = JSON.stringify(drafts)
    const activeSerialized = JSON.stringify(studio.active.slots)
    currentDraftRef.current = serialized

    if (serialized === activeSerialized) {
      clearLocalNudgeDraft()
      localDraftAvailableRef.current = true
    } else {
      const localDraft = saveLocalNudgeDraft(draftBaseRevision, drafts)
      localDraftAvailableRef.current = localDraft !== null
      if (localDraft) setDraftSavedAt(localDraft.savedAtMillis)
    }

    if (cloudDraftRef.current === serialized) {
      setDraftSaveState('saved')
      return
    }

    setDraftSaveState('local')
    if (draftBaseRevision !== studio.active.revision) {
      return
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    const snapshot = cloneDrafts(drafts)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistCloudDraft(snapshot, draftBaseRevision, serialized)
    }, 700)

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [draftBaseRevision, drafts, persistCloudDraft, studio])

  function saveDraftNow() {
    if (!studio || draftBaseRevision !== studio.active.revision) return
    const serialized = JSON.stringify(drafts)
    if (serialized === cloudDraftRef.current) return
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    void persistCloudDraft(
      cloneDrafts(drafts),
      draftBaseRevision,
      serialized
    )
  }

  async function publish() {
    if (!studio || !dirty || action) return
    const revision = studio.active.revision + 1
    const confirmed = await confirmDialog({
      title: `Publish revision ${revision} to StatsKey now?`,
      confirmLabel: 'Publish'
    })
    if (!confirmed) return
    setAction('publish')
    setError(null)
    setNotice(null)
    try {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const serialized = JSON.stringify(drafts)
      await persistCloudDraft(
        cloneDrafts(drafts),
        draftBaseRevision,
        serialized
      )
      const next = await publishNudges(studio.active.revision, drafts)
      const activeSerialized = JSON.stringify(next.active.slots)
      draftVersionRef.current = 0
      cloudDraftRef.current = activeSerialized
      currentDraftRef.current = activeSerialized
      clearLocalNudgeDraft()
      setStudio(next)
      setDrafts(cloneDrafts(next.active.slots))
      setDraftBaseRevision(next.active.revision)
      setDraftSavedAt(next.active.publishedAtMillis)
      setDraftSaveState('saved')
      setDraftWarning(null)
      setNotice(`Revision ${next.active.revision} is live.`)
    } catch (publishError) {
      setError(toStudioError(publishError))
    } finally {
      setAction(null)
    }
  }

  async function rollback(target: NudgeRevision) {
    if (!studio || action) return
    const preserveDraft = dirty
    const confirmedRestore = await confirmDialog({
      title: `Restore revision ${target.revision}?`,
      body: 'This publishes it as a new audited revision.',
      confirmLabel: 'Restore',
    })
    if (!confirmedRestore) return

    setAction(`rollback-${target.revision}`)
    setError(null)
    setNotice(null)
    try {
      const next = await rollbackNudges(studio.active.revision, target.revision)
      setStudio(next)
      if (preserveDraft) {
        setDraftWarning(
          `Your saved draft is still here. Review it against live revision ${next.active.revision} before publishing.`
        )
      } else {
        const activeDrafts = cloneDrafts(next.active.slots)
        const activeSerialized = JSON.stringify(activeDrafts)
        currentDraftRef.current = activeSerialized
        cloudDraftRef.current = activeSerialized
        clearLocalNudgeDraft()
        setDrafts(activeDrafts)
        setDraftBaseRevision(next.active.revision)
        setDraftSaveState('saved')
        setDraftWarning(null)
      }
      setNotice(
        preserveDraft
          ? `Revision ${target.revision} is live as revision ${next.active.revision}; your draft was preserved.`
          : `Revision ${target.revision} was restored as revision ${next.active.revision}.`
      )
    } catch (rollbackError) {
      setError(toStudioError(rollbackError))
    } finally {
      setAction(null)
    }
  }

  async function handleSignOut() {
    navigate('/login', { replace: true })
    await signOut()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-secondary text-sm">
        Opening Nudge Studio…
      </div>
    )
  }

  if (!studio) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="panel w-full max-w-[520px] space-y-4">
          <h1 className="font-display text-2xl font-bold">Nudge Studio is unavailable</h1>
          <div className="error-banner">{error ?? 'Try again in a moment.'}</div>
          <button className="btn btn-secondary" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <nav className="app-nav">
        <div className="max-w-[1160px] mx-auto px-4 sm:px-6 h-[58px] flex items-center justify-between gap-4">
          <a href="/" className="app-brand">
            <span className="site-brand__mark" aria-hidden="true" />
            <span>StatsKey</span>
          </a>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.035] py-1.5 pl-1.5 pr-3">
              <span className="h-7 w-7 rounded-full bg-data/15 text-data flex items-center justify-center text-[12px] font-bold">
                {accountName.slice(0, 1).toUpperCase()}
              </span>
              <span className="leading-tight">
                <strong className="block text-text-primary text-[12px] font-semibold">
                  {accountName}
                </strong>
                <small className="block text-text-muted text-[10px]">StatsKey account</small>
              </span>
            </div>
            <button className="btn btn-ghost" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-[1160px] mx-auto px-4 sm:px-6 py-7 sm:py-10 space-y-6">
        <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div className="max-w-[720px]">
            <span className="card-title">Recording momentum</span>
            <h1 className="font-display text-[clamp(30px,5vw,48px)] font-bold tracking-[-0.04em] leading-[1.02] mt-2">
              Write the next gentle nudge.
            </h1>
            <p className="text-text-secondary text-[14px] leading-relaxed mt-3">
              These messages appear in the iPhone app, recording notifications, and
              Apple Watch. Publishing is immediate, revisioned, and reversible.
            </p>
          </div>
          <div className="panel lg:min-w-[270px] !p-4">
            <span className="card-title">Live revision</span>
            <div className="font-display text-3xl font-bold mt-1">
              {studio.active.revision || 'Local'}
            </div>
            <p className="text-text-muted text-[11px] mt-1">
              {studio.active.publishedAtMillis
                ? `Published ${formatDate(studio.active.publishedAtMillis)}`
                : 'App defaults are active until the first publish.'}
            </p>
            <div className="border-t border-white/10 mt-4 pt-3">
              <span className="card-title">Draft</span>
              <div className="text-text-primary text-[13px] font-semibold mt-1">
                {draftStatusLabel}
              </div>
              {draftSavedAt && dirty && (
                <p className="text-text-muted text-[10px] mt-1">
                  Last saved {formatDate(draftSavedAt)}
                </p>
              )}
            </div>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="success-banner">{notice}</div>}
        {draftWarning && (
          <div className="rounded-[14px] border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-amber-100 text-[12px] leading-relaxed">
            {draftWarning}
          </div>
        )}

        {groupedDefinitions.map((group) => (
          <section key={group.surface} className="space-y-3">
            <div>
              <span className="card-title">{group.surface}</span>
              <p className="text-text-muted text-[12px] mt-1">
                {group.surface === 'iPhone'
                  ? 'Recording and workout cards in the iOS app.'
                  : group.surface === 'iPhone Notifications'
                    ? 'Meal reminders and gentle return messages scheduled by the iOS app.'
                    : 'Compact copy sized for the Watch start and summary screens.'}
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {group.slots.map(([slotId, definition]) => {
                const draft = drafts[slotId] ?? { title: '', body: '' }
                return (
                  <article key={slotId} className="panel space-y-4">
                    <div>
                      <h2 className="font-display text-[18px] font-bold">
                        {definition.label}
                      </h2>
                      <p className="text-text-muted text-[11px] leading-relaxed mt-1">
                        {definition.description}
                      </p>
                    </div>

                    <label className="block">
                      <span className="flex justify-between gap-3 text-text-secondary text-[11px] font-medium mb-1.5">
                        <span>Title</span>
                        <span>
                          {draft.title.length}/{definition.maxTitleLength}
                        </span>
                      </span>
                      <input
                        className="input"
                        value={draft.title}
                        maxLength={definition.maxTitleLength}
                        disabled={action !== null}
                        onChange={(event) =>
                          updateDraft(setDrafts, slotId, 'title', event.target.value)
                        }
                        onBlur={saveDraftNow}
                      />
                    </label>

                    <label className="block">
                      <span className="flex justify-between gap-3 text-text-secondary text-[11px] font-medium mb-1.5">
                        <span>Message</span>
                        <span>
                          {draft.body.length}/{definition.maxBodyLength}
                        </span>
                      </span>
                      <textarea
                        className="input min-h-[96px] resize-y"
                        value={draft.body}
                        maxLength={definition.maxBodyLength}
                        disabled={action !== null}
                        onChange={(event) =>
                          updateDraft(setDrafts, slotId, 'body', event.target.value)
                        }
                        onBlur={saveDraftNow}
                      />
                    </label>

                    <div className="rounded-[14px] border border-white/10 bg-white/[0.035] p-4">
                      <span className="card-title">Preview</span>
                      <strong className="block text-text-primary text-[14px] mt-2">
                        {draft.title || 'Title preview'}
                      </strong>
                      <p className="text-text-secondary text-[12px] leading-relaxed mt-1">
                        {draft.body || 'Message preview'}
                      </p>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}

        <section className="panel flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-[18px] font-bold">Review and publish</h2>
            <p className="text-text-muted text-[11px] leading-relaxed mt-1">
              Drafts save as you write. Publishing separately checks every surface,
              pressure-based wording, and product language.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              className="btn btn-secondary"
              disabled={!dirty || action !== null}
              onClick={() => {
                setDrafts(cloneDrafts(studio.active.slots))
                setDraftBaseRevision(studio.active.revision)
                setError(null)
                setNotice(null)
                setDraftWarning(null)
              }}
            >
              Reset edits
            </button>
            <button
              className="btn btn-primary"
              disabled={!dirty || action !== null}
              onClick={publish}
            >
              {action === 'publish'
                ? 'Publishing…'
                : `Publish revision ${studio.active.revision + 1}`}
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <span className="card-title">Audit history</span>
            <p className="text-text-muted text-[12px] mt-1">
              Every publish and rollback remains in the record.
            </p>
          </div>
          {studio.history.length === 0 ? (
            <div className="panel text-text-muted text-[12px]">
              History begins with the first publish.
            </div>
          ) : (
            <ol className="grid gap-3">
              {studio.history.map((revision) => (
                <li
                  key={revision.revision}
                  className="panel !p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="font-display text-[15px]">
                        Revision {revision.revision}
                      </strong>
                      {revision.revision === studio.active.revision && (
                        <span className="token-pack-badge">Live</span>
                      )}
                    </div>
                    <p className="text-text-muted text-[11px] mt-1">
                      {revision.action === 'rollback'
                        ? `Rollback of revision ${revision.rollbackOfRevision}`
                        : 'Direct publish'}
                      {revision.publishedAtMillis
                        ? ` · ${formatDate(revision.publishedAtMillis)}`
                        : ''}
                    </p>
                  </div>
                  {revision.revision < studio.active.revision && (
                    <button
                      className="btn btn-secondary"
                      disabled={action !== null}
                      onClick={() => rollback(revision)}
                    >
                      {action === `rollback-${revision.revision}`
                        ? 'Restoring…'
                        : 'Restore as new revision'}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  )
}

function cloneDrafts(slots: Drafts): Drafts {
  return Object.fromEntries(
    Object.entries(slots).map(([slotId, copy]) => [slotId, { ...copy }])
  )
}

function completeDrafts(
  candidate: Drafts | undefined,
  active: Drafts,
  definitions: NudgeStudioState['definitions']
): Drafts {
  return Object.fromEntries(
    Object.entries(definitions).map(([slotId, definition]) => {
      const copy = candidate?.[slotId]
      if (
        copy &&
        typeof copy.title === 'string' &&
        typeof copy.body === 'string'
      ) {
        return [slotId, { title: copy.title, body: copy.body }]
      }
      const activeCopy = active[slotId]
      return [
        slotId,
        activeCopy
          ? { ...activeCopy }
          : {
              title: definition.defaultTitle,
              body: definition.defaultBody,
            },
      ]
    })
  )
}

function updateDraft(
  setDrafts: Dispatch<SetStateAction<Drafts>>,
  slotId: string,
  field: keyof NudgeCopy,
  value: string
) {
  setDrafts((current) => ({
    ...current,
    [slotId]: {
      ...(current[slotId] ?? { title: '', body: '' }),
      [field]: value,
    },
  }))
}

function toDraftSaveMessage(error: unknown, localAvailable: boolean): string {
  if (!localAvailable) {
    return 'Draft saving is unavailable in this browser. Copy your work before leaving this page.'
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (code === 'functions/failed-precondition') {
    return 'Saved on this device. A newer live revision needs review before cloud backup can continue.'
  }
  if (code === 'functions/aborted') {
    return 'Saved on this device. A newer cloud draft exists; reload before replacing it.'
  }
  return 'Saved on this device. Cloud backup will retry after your next edit.'
}

function formatDate(milliseconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(milliseconds))
}

function toStudioError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (code === 'functions/aborted') {
    return 'A newer revision is live. Reload Nudge Studio before publishing.'
  }
  if (code === 'functions/permission-denied' || code === 'functions/unauthenticated') {
    return 'This session no longer has Nudge Studio access. Sign in again.'
  }
  if (code === 'functions/resource-exhausted') {
    return 'Too many requests. Wait a few minutes and try again.'
  }
  if (error instanceof Error) return error.message
  return String(error)
}
