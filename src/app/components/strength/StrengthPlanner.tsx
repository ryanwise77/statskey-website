import { useEffect, useState } from 'react'
import { EQUIPMENT, newStrengthID, type StrengthPlannedSet } from '../../lib/strength/model'
import { StrengthExercisePicker } from './StrengthExercisePicker'
import {
  decodeStrengthRoutine, newStrengthPlanDay, newStrengthRoutine, newStrengthWeekPlan,
  STRENGTH_DAYS, strengthDateKey, strengthPlanDay, validateStrengthRoutine,
  type StrengthRoutine, type StrengthRoutineExercise, type StrengthWeekPlan,
} from '../../lib/strength/plans'
import { deleteStrengthRoutine, saveStrengthRoutine, saveStrengthWeekPlan, type useStrengthLibrary } from '../../lib/strength/store'

type Library = ReturnType<typeof useStrengthLibrary>
export function StrengthPlanner({ uid, imperial, library, initialRoutine, onStart, onEditingChange }: {
  uid: string; imperial: boolean; library: Library; initialRoutine?: StrengthRoutine | null
  onStart: (routine: StrengthRoutine, dayKey?: string) => void
  onEditingChange?: (editing: boolean) => void
}) {
  const [routine, setRoutine] = useState<StrengthRoutine | null>(initialRoutine ?? null)
  const [routineRevision, setRoutineRevision] = useState<Date | null>(null)
  const [plan, setPlan] = useState<StrengthWeekPlan | null>(null)
  const [planRevision, setPlanRevision] = useState<Date | null>(null)
  const [date, setDate] = useState(strengthDateKey(new Date()))
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const editing = routine != null || plan != null
  useEffect(() => {
    onEditingChange?.(editing)
    if (!editing) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [editing, onEditingChange])
  const today = library.plan && strengthPlanDay(library.plan, new Date())
  const todaysRoutine = library.routines.find((r) => r.id === today?.routineId)
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(''); setMessage('')
    try { await action(); setMessage(success) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  function editRoutine(value: StrengthRoutine | null) {
    if (routine && !window.confirm('Discard your unsaved routine changes?')) return
    setRoutine(value ? decodeStrengthRoutine(value, value.id) : newStrengthRoutine())
    setRoutineRevision(value?.updatedAt ?? null); setError(''); setMessage('')
  }
  function updateExercise(id: string, update: (e: StrengthRoutineExercise) => StrengthRoutineExercise) {
    setRoutine((r) => r && ({ ...r, exercises: r.exercises.map((e) => e.id === id ? update(e) : e) }))
  }
  function moveExercise(id: string, offset: number) {
    setRoutine((r) => {
      if (!r) return r
      const exercises = [...r.exercises], index = exercises.findIndex((e) => e.id === id)
      if (index + offset < 0 || index + offset >= exercises.length) return r
      ;[exercises[index], exercises[index + offset]] = [exercises[index + offset], exercises[index]]
      return { ...r, exercises }
    })
  }
  function changeDay(dayOfWeek: number, selection: string, dateKey?: string) {
    setPlan((p) => {
      if (!p) return p
      const existing = dateKey ? p.dateOverrides[dateKey] ?? p.days.find((d) => d.dayOfWeek === dayOfWeek) : p.days.find((d) => d.dayOfWeek === dayOfWeek)
      const selected = library.routines.find((r) => r.id === selection)
      const day = { ...(existing ?? newStrengthPlanDay(dayOfWeek)), dayOfWeek, isRest: selection === 'rest', routineId: selected?.id, routineName: selected?.name }
      return dateKey ? { ...p, dateOverrides: { ...p.dateOverrides, [dateKey]: day } } : { ...p, days: p.days.map((d) => d.dayOfWeek === dayOfWeek ? day : d) }
    })
  }
  const selection = (day: ReturnType<typeof strengthPlanDay>) => day?.isRest ? 'rest' : day?.routineId ?? ''
  const dayOptions = <><option value="">Unplanned</option><option value="rest">Rest day</option>{library.routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</>
  return <div className="strength-planner">
    {(error || library.error) && <p role="alert" className="error-banner">{error || library.error}</p>}
    {message && <p role="status" className="strength-success">{message}</p>}
    <section className="panel strength-fields">
      <h2>Your strength week</h2>
      <p>Routines and schedules sync with your StatsKey account on iOS, Android, and the web.</p>
      {library.planLoading ? <p role="status">Loading your week…</p> : <>
        <p>Today: {today?.isRest ? 'Rest day' : todaysRoutine?.name ?? 'Unplanned'}</p>
        <div className="strength-row-actions">
          {todaysRoutine && !today?.isRest && <button className="btn strength-primary" disabled={busy} onClick={() => onStart(todaysRoutine, strengthDateKey(new Date()))}>Start today’s workout</button>}
          <button className="btn btn-secondary" disabled={busy || !!library.error} onClick={() => {
            if (plan && !window.confirm('Discard your unsaved schedule changes?')) return
            setPlan(library.plan ? { ...library.plan, days: library.plan.days.map((d) => ({ ...d })), dateOverrides: { ...library.plan.dateOverrides } } : newStrengthWeekPlan())
            setPlanRevision(library.plan?.updatedAt ?? null); setError('')
          }}>{library.plan ? 'Edit week' : 'Plan your week'}</button>
        </div>
      </>}
      {!plan && library.plan && <div className="strength-plan-days">{STRENGTH_DAYS.map((name, index) => {
        const day = library.plan!.days.find((d) => d.dayOfWeek === index + 1)
        const value = library.routines.find((r) => r.id === day?.routineId)
        return <div className="strength-plan-day" key={name}><strong>{name}</strong><span>{day?.isRest ? 'Rest' : value?.name ?? 'Unplanned'}</span></div>
      })}</div>}
    </section>
    {plan && <fieldset className="panel strength-routine-editor" disabled={busy}>
      <h2>Edit strength week</h2>
      <label>Plan name<input className="input" value={plan.name} maxLength={150} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></label>
      <h3>Repeating schedule</h3>
      <div className="strength-plan-days">{STRENGTH_DAYS.map((name, index) => <label className="strength-plan-day" key={name}>{name}
        <select className="input" value={selection(plan.days.find((d) => d.dayOfWeek === index + 1))} onChange={(e) => changeDay(index + 1, e.target.value)}>{dayOptions}</select>
      </label>)}</div>
      <h3>Change one date</h3>
      <p>A date override replaces the repeating schedule for that day.</p>
      <label>Date<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {date && <label>Workout for {date}<select className="input" value={selection(strengthPlanDay(plan, new Date(`${date}T12:00:00`)))} onChange={(e) => changeDay(new Date(`${date}T12:00:00`).getDay() || 7, e.target.value, date)}>{dayOptions}</select></label>}
      {plan.dateOverrides[date] && <button className="btn btn-ghost" onClick={() => { const overrides = { ...plan.dateOverrides }; delete overrides[date]; setPlan({ ...plan, dateOverrides: overrides }) }}>Use repeating schedule for this date</button>}
      <div className="strength-row-actions"><button className="btn strength-primary" onClick={() => run(async () => { await saveStrengthWeekPlan(uid, plan, planRevision); setPlan(null) }, 'Week plan saved.')}>{busy ? 'Saving…' : 'Save week plan'}</button><button className="btn btn-ghost" onClick={() => setPlan(null)}>Cancel</button></div>
    </fieldset>}
    <section className="panel strength-routine-list">
      <header><h2>Your routines</h2><button className="btn btn-secondary" disabled={busy} onClick={() => editRoutine(null)}>New routine</button></header>
      {library.routinesLoading ? <p role="status">Loading routines…</p> : library.routines.length === 0 ? <p>Build a reusable workout with exercises, set targets, and rest times.</p> : library.routines.map((r) => <div className="strength-plan-day" key={r.id}>
        <div><h3>{r.name}</h3><p>{r.exercises.length} exercises · {r.exercises.reduce((n, e) => n + e.plannedSets.length, 0)} planned sets</p></div>
        <div className="strength-row-actions"><button className="btn strength-primary" disabled={busy} onClick={() => onStart(r)}>Start workout</button><button className="btn btn-secondary" disabled={busy} onClick={() => editRoutine(r)}>Edit</button></div>
      </div>)}
    </section>
    {routine && <fieldset className="panel strength-routine-editor" disabled={busy}>
      <h2>{routineRevision ? 'Edit routine' : 'New routine'}</h2>
      <label>Routine name<input className="input" value={routine.name} maxLength={150} onChange={(e) => setRoutine({ ...routine, name: e.target.value })} /></label>
      <p>Targets are starting points. Effort and heart-rate targets stay separate from your recorded measurements.</p>
      {routine.exercises.map((exercise, index) => <section className="strength-exercise" key={exercise.id}>
        <header><h3>{index + 1}. {exercise.name}</h3><div className="strength-row-actions">
          <button className="btn btn-ghost" aria-label={`Move ${exercise.name} up`} disabled={index === 0} onClick={() => moveExercise(exercise.id, -1)}>↑</button>
          <button className="btn btn-ghost" aria-label={`Move ${exercise.name} down`} disabled={index === routine.exercises.length - 1} onClick={() => moveExercise(exercise.id, 1)}>↓</button>
          <button className="btn btn-ghost" onClick={() => setRoutine({ ...routine, exercises: routine.exercises.filter((e) => e.id !== exercise.id) })}>Remove</button>
        </div></header>
        <div className="strength-set-fields">
          <label>Exercise name<input className="input" value={exercise.name} maxLength={180} onChange={(e) => updateExercise(exercise.id, (v) => ({ ...v, name: e.target.value }))} /></label>
          <label>Equipment<select className="input" value={exercise.equipment} onChange={(e) => updateExercise(exercise.id, (v) => ({ ...v, equipment: e.target.value }))}>{EQUIPMENT.map((e) => <option key={e} value={e}>{e === 'smithMachine' ? 'Smith machine' : e}</option>)}</select></label>
          <label>Measure<select className="input" value={exercise.measure} onChange={(e) => updateExercise(exercise.id, (v) => ({ ...v, measure: e.target.value as 'time' | 'reps', plannedSets: v.plannedSets.map((s) => ({ ...s, reps: e.target.value === 'time' ? undefined : s.reps })) }))}><option value="reps">Repetitions</option><option value="time">Time / hold</option></select></label>
          <TargetInput label="Exercise rest (sec)" value={exercise.restSeconds} min={0} max={1800} onChange={(value) => updateExercise(exercise.id, (e) => ({ ...e, restSeconds: value }))} />
        </div>
        {exercise.supersetGroup && <p>Superset · alternate with the linked exercise.</p>}
        {index < routine.exercises.length - 1 && <button className="btn btn-ghost" onClick={() => {
          const next = routine.exercises[index + 1], group = next.supersetGroup ?? newStrengthID()
          setRoutine({ ...routine, exercises: routine.exercises.map((e) => exercise.supersetGroup
            ? e.supersetGroup === exercise.supersetGroup ? { ...e, supersetGroup: undefined } : e
            : e.id === exercise.id || e.id === next.id ? { ...e, supersetGroup: group } : e) })
        }}>{exercise.supersetGroup ? 'Unlink superset' : 'Superset with next'}</button>}
        {exercise.plannedSets.map((set, setIndex) => <div className="strength-set" key={set.id}>
          <div className="strength-set-heading"><strong>Set {setIndex + 1}</strong><button className="btn btn-ghost" aria-label={`Remove planned set ${setIndex + 1} from ${exercise.name}`} onClick={() => updateExercise(exercise.id, (e) => ({ ...e, plannedSets: e.plannedSets.filter((s) => s.id !== set.id) }))}>Remove set</button></div>
          <PlannedSetFields set={set} measure={exercise.measure} imperial={imperial} onChange={(patch) => updateExercise(exercise.id, (e) => ({ ...e, plannedSets: e.plannedSets.map((s) => s.id === set.id ? { ...s, ...patch } : s) }))} />
        </div>)}
        <button className="btn btn-secondary" onClick={() => updateExercise(exercise.id, (e) => ({ ...e, plannedSets: [...e.plannedSets, { ...(e.plannedSets.at(-1) ?? { setType: 'working' }), id: newStrengthID() }] }))}>+ Add set</button>
        <label>Exercise notes<textarea className="input" rows={2} maxLength={2000} value={exercise.notes ?? ''} onChange={(e) => updateExercise(exercise.id, (v) => ({ ...v, notes: e.target.value }))} /></label>
      </section>)}
      <StrengthExercisePicker uid={uid} customExercises={library.customExercises} disabled={busy} onAdd={(exercise) => setRoutine((current) => current && ({ ...current, exercises: [...current.exercises, {
        id: newStrengthID(), exerciseId: exercise.id, name: exercise.name, equipment: exercise.equipment, measure: exercise.measure,
        primaryMuscles: [...exercise.primaryMuscles], notes: exercise.notes, plannedSets: [{ id: newStrengthID(), setType: 'working' }],
      }] }))} />
      <label>Routine notes<textarea className="input" rows={3} maxLength={4000} value={routine.notes} onChange={(e) => setRoutine({ ...routine, notes: e.target.value })} /></label>
      <div className="strength-row-actions">
        <button className="btn strength-primary" onClick={() => { const invalid = validateStrengthRoutine(routine); if (invalid) { setError(invalid); return }; void run(async () => { await saveStrengthRoutine(uid, routine, routineRevision); setRoutine(null) }, 'Routine saved.') }}>{busy ? 'Saving…' : 'Save routine'}</button>
        <button className="btn btn-ghost" onClick={() => setRoutine(null)}>Cancel</button>
        {routineRevision && <button className="btn btn-ghost" onClick={() => { if (window.confirm('Delete this routine? Completed workouts are kept. Scheduled days using it will become unplanned.')) void run(async () => { await deleteStrengthRoutine(uid, { ...routine, updatedAt: routineRevision }); setRoutine(null) }, 'Routine deleted.') }}>Delete routine</button>}
      </div>
    </fieldset>}
  </div>
}
function PlannedSetFields({ set, measure, imperial, onChange }: { set: StrengthPlannedSet; measure: string; imperial: boolean; onChange: (patch: Partial<StrengthPlannedSet>) => void }) {
  return <div className="strength-set-fields">
    <label>Set type<select className="input" value={set.setType} onChange={(e) => onChange({ setType: e.target.value })}>{['working', 'warmup', 'drop', 'failure'].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    <TargetInput label={`Target load (${imperial ? 'lb' : 'kg'})`} value={set.weightLbs == null ? undefined : imperial ? set.weightLbs : Math.round(set.weightLbs / 2.20462 * 1000) / 1000} min={0} step="any" onChange={(value) => onChange({ weightLbs: value == null ? undefined : imperial ? value : value * 2.20462 })} />
    {measure === 'time' ? <TargetInput label="Target work (sec)" value={set.durationSeconds} min={1} onChange={(value) => onChange({ durationSeconds: value })} /> : <TargetInput label="Target reps" value={set.reps} min={1} onChange={(value) => onChange({ reps: value })} />}
    <TargetInput label="Rest after set (sec)" value={set.restSeconds} min={0} max={1800} onChange={(value) => onChange({ restSeconds: value })} />
    <TargetInput label="Target effort (RPE)" value={set.targetRPE} min={1} max={10} step="0.5" onChange={(value) => onChange({ targetRPE: value })} />
    <TargetInput label="Heart rate minimum" value={set.targetHeartRateMin} min={30} max={250} onChange={(value) => onChange({ targetHeartRateMin: value })} />
    <TargetInput label="Heart rate maximum" value={set.targetHeartRateMax} min={30} max={250} onChange={(value) => onChange({ targetHeartRateMax: value })} />
  </div>
}
function TargetInput({ label, value, onChange, min, max, step = '1' }: { label: string; value?: number; min: number; max?: number; step?: string; onChange: (value: number | undefined) => void }) {
  return <label>{label}<input className="input" type="number" inputMode={step === '1' ? 'numeric' : 'decimal'} min={min} max={max} step={step} value={value ?? ''} placeholder="—" onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></label>
}
