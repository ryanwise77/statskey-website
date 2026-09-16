import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  completedExercises,
  EQUIPMENT,
  LOAD_LABELS,
  loadDisplay,
  newSession,
  nextStrengthSet,
  repeatStrengthSession,
  startStrengthSetTimer,
  setDescription,
  strengthTotals,
  validateStrength,
  type LoadKind,
  type StrengthExercise,
  type StrengthSession,
  type StrengthSet,
} from '../lib/strength/model'
import { saveStrengthSession, useStrengthHistory, useStrengthLibrary } from '../lib/strength/store'
import { routineFromStrengthSession, sessionFromStrengthRoutine, type StrengthRoutine } from '../lib/strength/plans'
import { readStrengthDraft, writeStrengthDraft } from '../lib/strength/draft'
import { StrengthShare } from '../components/strength/StrengthShare'
import { StrengthVideo } from '../components/strength/StrengthVideo'
import { StrengthPlanner } from '../components/strength/StrengthPlanner'
import { StrengthProgress } from '../components/strength/StrengthProgress'
import { StrengthExercisePicker } from '../components/strength/StrengthExercisePicker'
import { StrengthSessionEditor } from '../components/strength/StrengthSessionEditor'
import { exerciseFromStrengthCatalog } from '../lib/strength/catalog'
import './Strength.css'

export function Strength() {
  const { user, profile } = useAuth()
  if (!user) return null
  return (
    <StrengthWorkspace
      key={user.uid}
      uid={user.uid}
      initialImperial={profile?.usesImperial !== false}
    />
  )
}
function StrengthWorkspace({
  uid,
  initialImperial,
}: {
  uid: string
  initialImperial: boolean
}) {
  const history = useStrengthHistory(uid)
  const library = useStrengthLibrary(uid)
  const [routineSeed, setRoutineSeed] = useState<StrengthRoutine | null>(null)
  const [plannerEditing, setPlannerEditing] = useState(false)
  const [editingSession, setEditingSession] = useState<StrengthSession | null>(null)
  const [search, setSearch] = useSearchParams()
  const [recovered] = useState(() => readStrengthDraft(uid))
  const [draft, setDraft] = useState(
    () => recovered?.session ?? newSession(uid),
  )
  const [draftStored, setDraftStored] = useState(true)
  const [unitOverride, setUnitOverride] = useState<boolean | null>(null)
  const imperial = unitOverride ?? initialImperial
  const [tab, setTab] = useState<'record' | 'history' | 'planner' | 'progress'>(() =>
    search.has('session') || search.get('view') === 'history'
      ? 'history'
      : 'record',
  )
  const [duration, setDuration] = useState(recovered?.duration ?? '45')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(
    recovered ? 'Recovered your unsaved workout draft from this tab.' : '',
  )
  const [error, setError] = useState('')
  const [restUntil, setRestUntil] = useState<number | null>(
    recovered?.restUntil ?? null,
  )
  const [now, setNow] = useState(Date.now())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!draft.entries.length) return
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [draft.entries.length])
  useEffect(() => {
    setDraftStored(
      writeStrengthDraft(uid, { session: draft, duration, restUntil }),
    )
  }, [uid, draft, duration, restUntil])
  const totals = strengthTotals(draft)
  const selected = history.sessions.find((s) => s.id === search.get('session'))
  function updateExercise(
    id: string,
    update: (entry: StrengthExercise) => StrengthExercise,
  ) {
    setDraft((s) => ({
      ...s,
      entries: s.entries.map((e) => (e.id === id ? update(e) : e)),
    }))
  }
  function updateSet(
    entryID: string,
    setID: string,
    patch: Partial<StrengthSet>,
  ) {
    updateExercise(entryID, (entry) => ({
      ...entry,
      sets: entry.sets.map((s) => (s.id === setID ? { ...s, ...patch } : s)),
    }))
  }
  function changeMode(mode: 'live' | 'afterTheFact') {
    setDraft((s) => ({
      ...s,
      recordingMode: mode,
      timedSetId: undefined,
      startDate:
        mode === 'live'
          ? new Date()
          : new Date(
              Date.now() -
                (Number(duration) > 0 ? Number(duration) : 45) * 60_000,
            ),
      entries: s.entries.map((e) => ({
        ...e,
        sets: e.sets.map((set) => ({
          ...set,
          startedAt: undefined,
          completedAt: undefined,
        })),
      })),
    }))
    setRestUntil(null)
  }
  function completeSet(
    entry: StrengthExercise,
    set: StrengthSet,
    done: boolean,
  ) {
    const completedAt = done && draft.recordingMode === 'live'
      ? set.startedAt && draft.timedSetId !== set.id && set.durationSeconds != null
        ? new Date(set.startedAt.getTime() + set.durationSeconds * 1000)
        : new Date()
      : undefined
    const elapsed =
      set.startedAt && completedAt && draft.timedSetId === set.id
        ? (completedAt.getTime() - set.startedAt.getTime()) / 1000
        : undefined
    updateSet(entry.id, set.id, {
      isCompleted: done,
      completedAt,
      startedAt: done && (elapsed == null || elapsed >= 1) ? set.startedAt : undefined,
      ...(elapsed != null && elapsed >= 1
        ? { durationSeconds: Math.round(elapsed * 10) / 10 }
        : {}),
    })
    if (draft.timedSetId === set.id) setDraft((s) => ({ ...s, timedSetId: undefined }))
    if (done && draft.recordingMode === 'live') {
      const seconds = set.plannedTarget?.restSeconds ?? entry.restSeconds ?? draft.defaultRestSeconds
      setRestUntil(seconds > 0 ? Date.now() + seconds * 1000 : null)
    }
  }
  async function save() {
    if (saving) return
    const end = new Date()
    const minutes = Number(duration)
    if (
      draft.recordingMode === 'afterTheFact' &&
      (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    ) {
      setError('Duration must be between 1 and 1440 whole minutes.')
      return
    }
    const candidate: StrengthSession = {
      ...draft,
      status: 'completed',
      endDate:
        draft.recordingMode === 'live'
          ? end
          : new Date(draft.startDate.getTime() + minutes * 60_000),
    }
    const validation = validateStrength(candidate)
    if (validation) {
      setError(validation)
      return
    }
    setSaving(true)
    setError('')
    try {
      await saveStrengthSession(uid, candidate)
      if (!alive.current) return
      setMessage('Workout saved to your StatsKey account across devices.')
      setDraft(newSession(uid))
      setDuration('45')
      setRestUntil(null)
      setSearch({ session: candidate.id })
      setTab('history')
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setSaving(false)
    }
  }
  function repeat(session: StrengthSession) {
    if (saving) return
    if (
      draft.entries.length &&
      !window.confirm('Replace your unsaved workout draft?')
    )
      return
    setDraft(repeatStrengthSession(session, uid))
    setDuration('45')
    setError('')
    setTab('record')
    setSearch({})
    setMessage(
      'Previous values copied as a starting point. Mark only the sets you complete.',
    )
    setRestUntil(null)
  }
  function startRoutine(routine: StrengthRoutine, dayKey?: string) {
    if (plannerEditing && !window.confirm('Discard unsaved routine or schedule changes and start this saved routine?')) return
    if (saving || (draft.entries.length && !window.confirm('Replace your unsaved workout draft?'))) return
    setDraft(sessionFromStrengthRoutine(routine, uid, new Date(), dayKey))
    setDuration('45'); setRestUntil(null); setTab('record'); setSearch({}); setError(''); setPlannerEditing(false)
    setMessage('Routine ready. Mark each set Done as you complete it; targets remain separate from recorded effort.')
  }
  function makeRoutine(session: StrengthSession) {
    setRoutineSeed(routineFromStrengthSession(session)); setTab('planner'); setError(''); setMessage('')
  }
  function showTab(next: 'record' | 'history' | 'planner' | 'progress') {
    if (editingSession && !window.confirm('Discard your unsaved workout corrections?')) return
    setEditingSession(null)
    if (next !== 'planner' && tab === 'planner' && plannerEditing && !window.confirm('Discard your unsaved routine or schedule changes?')) return
    if (next !== 'planner') setPlannerEditing(false)
    if (next === 'planner' && tab !== 'planner') setRoutineSeed(null)
    setTab(next)
  }
  return (
    <div className="strength-page">
      <header className="strength-header">
        <div>
          <div className="strength-eyebrow">TRAINING</div>
          <h1>Strength</h1>
          <p>Record the work. See your progress.</p>
        </div>
        <label className="strength-unit">
          Load units
          <select
            className="input"
            value={imperial ? 'lb' : 'kg'}
            onChange={(e) => setUnitOverride(e.target.value === 'lb')}
          >
            <option value="lb">Pounds (lb)</option>
            <option value="kg">Kilograms (kg)</option>
          </select>
        </label>
      </header>
      <nav className="strength-tabs" aria-label="Strength views">
        <button
          type="button"
          aria-pressed={tab === 'record'}
          onClick={() => showTab('record')}
        >
          Record workout
        </button>
        <button
          type="button"
          aria-pressed={tab === 'history'}
          onClick={() => showTab('history')}
        >
          Strength history
        </button>
        <button type="button" aria-pressed={tab === 'planner'} onClick={() => showTab('planner')}>Routines &amp; week</button>
        <button type="button" aria-pressed={tab === 'progress'} onClick={() => showTab('progress')}>Progress</button>
      </nav>
      {message && (
        <p className="strength-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {editingSession ? <StrengthSessionEditor key={editingSession.id} session={editingSession} uid={uid} imperial={imperial} customExercises={library.customExercises} onCancel={() => setEditingSession(null)} onSave={(session) => { setEditingSession(null); setSearch({ session: session.id }); setMessage('Workout corrections saved across your devices.'); setError('') }} />
        : tab === 'progress' ? <StrengthProgress sessions={history.sessions} imperial={imperial} />
        : tab === 'planner' ? <StrengthPlanner uid={uid} imperial={imperial} library={library} initialRoutine={routineSeed} onStart={startRoutine} onEditingChange={setPlannerEditing} /> : tab === 'record' ? (
        <fieldset disabled={saving} className="strength-layout">
          <div className="strength-main">
            <section className="panel strength-fields">
              <label>
                Workout title
                <input
                  className="input"
                  value={draft.title}
                  maxLength={150}
                  onChange={(e) =>
                    setDraft((s) => ({ ...s, title: e.target.value }))
                  }
                />
              </label>
              <label>
                Recording mode
                <select
                  className="input"
                  value={draft.recordingMode}
                  disabled={totals.sets > 0}
                  onChange={(e) =>
                    changeMode(e.target.value as 'live' | 'afterTheFact')
                  }
                >
                  <option value="afterTheFact">Log a completed workout</option>
                  <option value="live">Train now · set and rest timers</option>
                </select>
              </label>
              {draft.recordingMode === 'afterTheFact' ? (
                <>
                  <label>
                    Workout start
                    <input
                      className="input"
                      type="datetime-local"
                      value={localDateTime(draft.startDate)}
                      onChange={(e) =>
                        setDraft((s) => ({
                          ...s,
                          startDate: new Date(e.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="1440"
                      step="1"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <p className="strength-elapsed">
                  Elapsed{' '}
                  <strong>
                    {clock((now - draft.startDate.getTime()) / 1000)}
                  </strong>
                </p>
              )}
            </section>
            {draft.entries.length === 0 && (
              <section className="strength-empty">
                <h2>Your workout starts here</h2>
                <p>
                  Add an exercise below, enter the work you did, and mark each
                  completed set.
                </p>
              </section>
            )}
            {draft.entries.map((entry) => (
              <section className="panel strength-exercise" key={entry.id}>
                <header>
                  <input
                    aria-label="Exercise name"
                    className="strength-exercise-name"
                    maxLength={180}
                    value={entry.name}
                    onChange={(e) =>
                      updateExercise(entry.id, (value) => ({
                        ...value,
                        name: e.target.value,
                      }))
                    }
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      setDraft((s) => ({
                        ...s,
                        entries: s.entries.filter((e) => e.id !== entry.id),
                      }))
                    }
                    aria-label={`Remove ${entry.name}`}
                  >
                    Remove
                  </button>
                </header>
                {entry.supersetGroup && <p>Superset · alternate with the linked exercise.</p>}
                <div className="strength-set-fields">
                  <label>Equipment<select className="input" value={entry.equipment} onChange={(e) => updateExercise(entry.id, (v) => ({ ...v, equipment: e.target.value }))}>{EQUIPMENT.map((value) => <option value={value} key={value}>{value === 'smithMachine' ? 'Smith machine' : value}</option>)}</select></label>
                  <label>Rest for this exercise (sec)<NumberInput value={entry.restSeconds} min={0} max={1800} step="1" onChange={(value) => updateExercise(entry.id, (v) => ({ ...v, restSeconds: value }))} /></label>
                </div>
                <label className="strength-measure">
                  Measure
                  <select
                    className="input"
                    value={entry.measure}
                    onChange={(e) =>
                      updateExercise(entry.id, (value) => ({
                        ...value,
                        measure: e.target.value as 'reps' | 'time',
                        sets: value.sets.map((s) => ({
                          ...s,
                          reps: e.target.value === 'time' ? undefined : s.reps,
                        })),
                      }))
                    }
                  >
                    <option value="reps">Repetitions</option>
                    <option value="time">Time / hold</option>
                  </select>
                </label>
                <div className="strength-sets">
                  {entry.sets.map((set) => (
                    <div
                      className={`strength-set ${set.isCompleted ? 'is-completed' : ''}`}
                      key={set.id}
                    >
                      <div className="strength-set-heading">
                        <strong>Set {set.number}</strong>
                        <label className="strength-done">
                          <input
                            type="checkbox"
                            checked={set.isCompleted}
                            onChange={(e) =>
                              completeSet(entry, set, e.target.checked)
                            }
                          />{' '}
                          Done
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={`Remove set ${set.number} from ${entry.name}`}
                          onClick={() =>
                            updateExercise(entry.id, (e) => ({
                              ...e,
                              sets: e.sets
                                .filter((s) => s.id !== set.id)
                                .map((s, i) => ({ ...s, number: i + 1 })),
                            }))
                          }
                        >
                          ×
                        </button>
                      </div>
                      {set.plannedTarget && <p className="strength-target">Planned: {[
                        set.plannedTarget.reps != null ? `${set.plannedTarget.reps} reps` : '',
                        set.plannedTarget.durationSeconds != null ? `${set.plannedTarget.durationSeconds}s work` : '',
                        set.plannedTarget.weightLbs != null ? loadDisplay(set.plannedTarget.weightLbs, imperial) : '',
                        set.plannedTarget.targetRPE != null ? `RPE ${set.plannedTarget.targetRPE}` : '',
                        set.plannedTarget.targetHeartRateMin != null ? `HR ≥ ${set.plannedTarget.targetHeartRateMin}` : '',
                        set.plannedTarget.targetHeartRateMax != null ? `HR ≤ ${set.plannedTarget.targetHeartRateMax}` : '',
                        set.plannedTarget.restSeconds != null ? `${set.plannedTarget.restSeconds}s rest` : '',
                      ].filter(Boolean).join(' · ') || 'Complete when ready'}</p>}
                      <div className="strength-set-fields">
                        <label>
                          Set type
                          <select
                            className="input"
                            value={set.setType}
                            onChange={(e) =>
                              updateSet(entry.id, set.id, {
                                setType: e.target.value,
                              })
                            }
                          >
                            <option value="working">Working</option>
                            <option value="warmup">Warm-up</option>
                            <option value="drop">Drop set</option>
                            <option value="failure">To failure</option>
                          </select>
                        </label>
                        <label>
                          Load meaning
                          <select
                            className="input"
                            value={set.loadKind ?? ''}
                            onChange={(e) =>
                              updateSet(entry.id, set.id, {
                                loadKind:
                                  (e.target.value as LoadKind) || undefined,
                              })
                            }
                          >
                            <option value="">Unspecified</option>
                            {Object.entries(LOAD_LABELS).map(
                              ([value, label]) => (
                                <option value={value} key={value}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        {set.loadKind !== 'bodyweightOnly' && (
                          <label>
                            Load ({imperial ? 'lb' : 'kg'})
                            <NumberInput
                              value={
                                set.weightLbs == null
                                  ? undefined
                                  : imperial
                                    ? set.weightLbs
                                    : Math.round(
                                        (set.weightLbs / 2.20462) * 1000,
                                      ) / 1000
                              }
                              min={0}
                              step="any"
                              onChange={(value) =>
                                updateSet(entry.id, set.id, {
                                  weightLbs:
                                    value == null
                                      ? undefined
                                      : imperial
                                        ? value
                                        : value * 2.20462,
                                })
                              }
                            />
                          </label>
                        )}
                        {entry.measure !== 'time' && (
                          <label>
                            Reps
                            <NumberInput
                              value={set.reps}
                              min={1}
                              step="1"
                              onChange={(value) =>
                                updateSet(entry.id, set.id, { reps: value })
                              }
                            />
                          </label>
                        )}
                        <label>
                          {entry.measure === 'time'
                            ? 'Hold time (sec)'
                            : 'Work time (sec)'}
                          <NumberInput
                            value={set.durationSeconds}
                            min={0.1}
                            step="any"
                            onChange={(value) =>
                              updateSet(entry.id, set.id, {
                                durationSeconds: value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Effort (RPE 1–10)
                          <NumberInput
                            value={set.rpe}
                            min={1}
                            max={10}
                            step="0.5"
                            onChange={(value) =>
                              updateSet(entry.id, set.id, { rpe: value })
                            }
                          />
                        </label>
                      </div>
                      {draft.recordingMode === 'live' && !set.isCompleted && (
                        <div className="strength-set-timer">
                          {set.startedAt && draft.timedSetId === set.id ? (
                            <>
                              <span aria-live="off">
                                Work time{' '}
                                {clock((now - set.startedAt.getTime()) / 1000)}
                              </span>
                              <button
                                className="btn btn-secondary"
                                onClick={() => completeSet(entry, set, true)}
                              >
                                Finish set
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-secondary"
                              onClick={() => {
                                setDraft((session) => startStrengthSetTimer(session, set.id))
                                setRestUntil(null)
                              }}
                            >
                              Start set timer
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    updateExercise(entry.id, (value) => ({
                      ...value,
                      sets: [...value.sets, nextStrengthSet(value)],
                    }))
                  }
                >
                  + Add set
                </button>
                <label>Exercise notes<textarea className="input" rows={2} maxLength={2000} value={entry.notes ?? ''} onChange={(e) => updateExercise(entry.id, (v) => ({ ...v, notes: e.target.value }))} /></label>
              </section>
            ))}
            <section className="panel"><StrengthExercisePicker uid={uid} customExercises={library.customExercises} disabled={saving} onAdd={(exercise) => {
              setDraft((current) => ({ ...current, entries: [...current.entries, exerciseFromStrengthCatalog(exercise)] })); setError(''); setMessage('')
            }} /></section>
            <label className="strength-notes">
              Workout notes
              <textarea
                className="input"
                rows={3}
                value={draft.notes}
                maxLength={4000}
                onChange={(e) =>
                  setDraft((s) => ({ ...s, notes: e.target.value }))
                }
              />
            </label>
          </div>
          <aside className="strength-summary panel">
            <div className="strength-eyebrow">THIS WORKOUT</div>
            <StrengthTotals session={draft} imperial={imperial} />
            {draft.recordingMode === 'live' && (
              <div className="strength-rest">
                <label>
                  Rest between sets (seconds)
                  <NumberInput
                    value={draft.defaultRestSeconds}
                    min={0}
                    max={1800}
                    step="15"
                    onChange={(value) =>
                      setDraft((s) => ({
                        ...s,
                        defaultRestSeconds: value ?? 0,
                      }))
                    }
                  />
                </label>
                {restUntil != null && (
                  <div role="status">
                    <strong>
                      {now >= restUntil
                        ? 'Ready for your next set'
                        : clock((restUntil - now) / 1000)}
                    </strong>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setRestUntil(null)}
                    >
                      Dismiss rest timer
                    </button>
                  </div>
                )}
              </div>
            )}
            <p>
              Blank values stay unrecorded. Only sets marked Done are saved.
            </p>
            <button
              className="btn strength-primary"
              onClick={save}
              disabled={saving || totals.sets === 0}
            >
              {saving ? 'Saving workout…' : 'Save workout'}
            </button>
            <button className="btn btn-secondary" disabled={saving || !draft.entries.length} onClick={() => makeRoutine(draft)}>Save as routine</button>
            <p className="strength-draft-note">
              {draftStored
                ? 'Your draft is saved in this tab. Save the workout to sync it to your account.'
                : 'This browser could not keep your draft. Save the workout before leaving this page.'}
            </p>
            {draft.entries.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (window.confirm('Discard this unsaved workout draft?')) {
                    setDraft(newSession(uid))
                    setDuration('45')
                    setRestUntil(null)
                    setError('')
                    setMessage('Draft discarded.')
                  }
                }}
              >
                Discard draft
              </button>
            )}
          </aside>
        </fieldset>
      ) : (
        <div className="strength-history-layout">
          <section className="panel strength-history">
            <h2>Saved strength workouts</h2>
            {history.loading ? (
              <p role="status">Loading strength history…</p>
            ) : history.error ? (
              <p className="error-banner" role="alert">
                Couldn’t load strength history: {history.error}
              </p>
            ) : history.sessions.length === 0 ? (
              <div className="strength-empty">
                <h3>No strength workouts yet</h3>
                <p>
                  Record your first session here, or sign in with the account
                  you use on your other devices.
                </p>
                <button
                  className="btn btn-secondary"
                  onClick={() => setTab('record')}
                >
                  Record workout
                </button>
              </div>
            ) : (
              <ul>
                {history.sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      aria-current={
                        selected?.id === session.id ? 'true' : undefined
                      }
                      onClick={() => setSearch({ session: session.id })}
                    >
                      <strong>{session.title}</strong>
                      <span>
                        {session.startDate.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}{' '}
                        · {strengthTotals(session).sets} sets
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {selected ? (
            <section className="panel strength-detail">
              <header>
                <div>
                  <h2>{selected.title}</h2>
                  <p>
                    {selected.startDate.toLocaleString()}
                    {selected.edited ? ' · Corrected log' : ''}
                  </p>
                </div>
                <button
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => repeat(selected)}
                >
                  Repeat workout
                </button>
                <button className="btn btn-secondary" disabled={saving} onClick={() => makeRoutine(selected)}>Save as routine</button>
                <button className="btn btn-secondary" disabled={saving} onClick={() => { setEditingSession(selected); setError(''); setMessage('') }}>Correct workout</button>
              </header>
              <StrengthTotals session={selected} imperial={imperial} />
              <div className="strength-video-actions">
                <StrengthShare session={selected} imperial={imperial} />
                <StrengthVideo
                  key={selected.id}
                  session={selected}
                  imperial={imperial}
                />
              </div>
              {completedExercises(selected).map((entry) => (
                <section className="strength-detail-exercise" key={entry.id}>
                  <h3>{entry.name}</h3>
                  {entry.notes && <p>{entry.notes}</p>}
                  {entry.sets.map((set) => (
                    <div key={set.id}>
                      <span>Set {set.number}</span>
                      <p>{setDescription(set, entry, imperial)}</p>
                      {set.notes && <p>{set.notes}</p>}
                    </div>
                  ))}
                </section>
              ))}
              {selected.notes && (
                <p className="strength-detail-notes">{selected.notes}</p>
              )}
              {selected.workoutSessionId && (
                <Link
                  className="link"
                  to={`/workouts/${uid}/${selected.workoutSessionId}`}
                >
                  Open linked workout and recorded heart-rate data →
                </Link>
              )}
            </section>
          ) : (
            <section className="strength-empty">
              <h2>Select a workout</h2>
              <p>See your completed sets, loads, and work times.</p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
export function StrengthTotals({
  session,
  imperial,
}: {
  session: StrengthSession
  imperial: boolean
}) {
  const totals = strengthTotals(session)
  return (
    <div className="strength-totals">
      <div>
        <strong>{totals.exercises}</strong>
        <span>Exercises</span>
      </div>
      <div>
        <strong>{totals.sets}</strong>
        <span>Completed sets</span>
      </div>
      <div>
        <strong>
          {totals.volumeLbs > 0 ? loadDisplay(totals.volumeLbs, imperial) : '—'}
        </strong>
        <span>Working load volume</span>
      </div>
    </div>
  )
}
function NumberInput({
  value,
  onChange,
  ...props
}: {
  value?: number
  onChange: (value: number | undefined) => void
  min: number
  max?: number
  step: string
}) {
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      placeholder="—"
      value={value ?? ''}
      onChange={(e) =>
        onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)
      }
      {...props}
    />
  )
}
function localDateTime(date: Date): string {
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : ''
}
function clock(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds))
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}
