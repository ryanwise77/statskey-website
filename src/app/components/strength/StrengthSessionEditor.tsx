import { useEffect, useRef, useState } from 'react'
import { EQUIPMENT, LOAD_LABELS, newSet, type LoadKind, type StrengthExercise, type StrengthSession, type StrengthSet } from '../../lib/strength/model'
import { createStrengthEditDraft, validateStrengthEdits } from '../../lib/strength/edits'
import { exerciseFromStrengthCatalog, type StrengthCatalogExercise } from '../../lib/strength/catalog'
import { saveStrengthSessionEdits } from '../../lib/strength/store'
import { StrengthExercisePicker } from './StrengthExercisePicker'

export function StrengthSessionEditor({ session, uid, imperial, customExercises, onSave, onCancel }: {
  session: StrengthSession; uid: string; imperial: boolean; customExercises: StrengthCatalogExercise[]
  onSave: (session: StrengthSession) => void; onCancel: () => void
}) {
  const [draft, setDraft] = useState(() => createStrengthEditDraft(session))
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => { active.current = false; window.removeEventListener('beforeunload', prevent) }
  }, [])
  function updateEntry(id: string, update: (e: StrengthExercise) => StrengthExercise) {
    setDraft((current) => ({ ...current, entries: current.entries.map((entry) => entry.id === id ? update(entry) : entry) }))
  }
  function updateSet(entryID: string, setID: string, patch: Partial<StrengthSet>) {
    updateEntry(entryID, (entry) => ({ ...entry, sets: entry.sets.map((s) => s.id === setID ? { ...s, ...patch } : s) }))
  }
  async function save() {
    if (saving) return
    const invalid = validateStrengthEdits(draft)
    if (invalid) { setError(invalid); return }
    setSaving(true); setError('')
    try {
      const saved = await saveStrengthSessionEdits(uid, session, draft, () => active.current)
      if (active.current) onSave(saved)
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (active.current) setSaving(false) }
  }
  return <fieldset className="strength-routine-editor" disabled={saving}>
    <section className="panel strength-routine-editor">
      <h2>Correct saved workout</h2>
      <p>Update your recorded exercises, sets, and notes. Original watch measurements remain available; your corrections are saved separately.</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <label>Workout title<input className="input" value={draft.title} maxLength={150} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <div className="strength-row-actions"><button className="btn strength-primary" onClick={save}>{saving ? 'Saving corrections…' : 'Save corrections'}</button><button className="btn btn-ghost" onClick={onCancel}>Cancel corrections</button></div>
    </section>
    {draft.entries.map((entry) => <section className="panel strength-exercise" key={entry.id}>
      <header><h3>{entry.name}</h3><button className="btn btn-ghost" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((e) => e.id !== entry.id) })}>Remove exercise</button></header>
      <div className="strength-set-fields">
        <label>Exercise name<input className="input" value={entry.name} maxLength={180} onChange={(e) => updateEntry(entry.id, (v) => ({ ...v, name: e.target.value }))} /></label>
        <label>Equipment<select className="input" value={entry.equipment} onChange={(e) => updateEntry(entry.id, (v) => ({ ...v, equipment: e.target.value }))}>{EQUIPMENT.map((value) => <option key={value} value={value}>{value === 'smithMachine' ? 'Smith machine' : value}</option>)}</select></label>
        <label>Measure<select className="input" value={entry.measure} onChange={(e) => updateEntry(entry.id, (v) => ({ ...v, measure: e.target.value as 'reps' | 'time', sets: v.sets.map((s) => ({ ...s, reps: e.target.value === 'time' ? undefined : s.reps })) }))}><option value="reps">Repetitions</option><option value="time">Time / hold</option></select></label>
      </div>
      {entry.sets.map((set) => <div className="strength-set" key={set.id}>
        <div className="strength-set-heading"><strong>Set {set.number}</strong><button className="btn btn-ghost" aria-label={`Remove set ${set.number} from ${entry.name}`} onClick={() => updateEntry(entry.id, (v) => ({ ...v, sets: v.sets.filter((s) => s.id !== set.id) }))}>Remove set</button></div>
        <div className="strength-set-fields">
          <label>Set type<select className="input" value={set.setType} onChange={(e) => updateSet(entry.id, set.id, { setType: e.target.value })}>{['working', 'warmup', 'drop', 'failure'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Load meaning<select className="input" value={set.loadKind ?? ''} onChange={(e) => updateSet(entry.id, set.id, { loadKind: e.target.value as LoadKind || undefined, ...(e.target.value === 'bodyweightOnly' ? { weightLbs: undefined } : {}) })}><option value="">Unspecified</option>{Object.entries(LOAD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {set.loadKind !== 'bodyweightOnly' && <NumberField label={`Load (${imperial ? 'lb' : 'kg'})`} value={set.weightLbs == null ? undefined : imperial ? set.weightLbs : Math.round(set.weightLbs / 2.20462 * 1000) / 1000} min={0} onChange={(value) => updateSet(entry.id, set.id, { weightLbs: value == null ? undefined : imperial ? value : value * 2.20462 })} />}
          {entry.measure !== 'time' && <NumberField label="Reps" value={set.reps} min={1} step="1" onChange={(value) => updateSet(entry.id, set.id, { reps: value })} />}
          <NumberField label="Work time (sec)" value={set.durationSeconds} min={0.1} onChange={(value) => updateSet(entry.id, set.id, { durationSeconds: value })} />
          <NumberField label="Effort (RPE)" value={set.rpe} min={1} max={10} step="0.5" onChange={(value) => updateSet(entry.id, set.id, { rpe: value })} />
        </div>
        <label>Set notes<textarea className="input" rows={2} maxLength={2000} value={set.notes ?? ''} onChange={(e) => updateSet(entry.id, set.id, { notes: e.target.value })} /></label>
      </div>)}
      <button className="btn btn-secondary" onClick={() => updateEntry(entry.id, (v) => ({ ...v, sets: [...v.sets, { ...newSet(Math.max(0, ...v.sets.map((s) => s.number)) + 1), isCompleted: true }] }))}>+ Add recorded set</button>
      <label>Exercise notes<textarea className="input" rows={2} maxLength={2000} value={entry.notes ?? ''} onChange={(e) => updateEntry(entry.id, (v) => ({ ...v, notes: e.target.value }))} /></label>
    </section>)}
    <section className="panel"><StrengthExercisePicker uid={uid} customExercises={customExercises} disabled={saving} onAdd={(exercise) => setDraft((current) => ({ ...current, entries: [...current.entries, exerciseFromStrengthCatalog(exercise, true)] }))} /></section>
    <section className="panel strength-routine-editor">
      <label>Workout notes<textarea className="input" rows={3} maxLength={4000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
      <div className="strength-row-actions"><button className="btn strength-primary" onClick={save}>{saving ? 'Saving corrections…' : 'Save corrections'}</button><button className="btn btn-ghost" onClick={onCancel}>Cancel corrections</button></div>
    </section>
  </fieldset>
}
function NumberField({ label, value, onChange, min, max, step = 'any' }: { label: string; value?: number; min: number; max?: number; step?: string; onChange: (value: number | undefined) => void }) {
  return <label>{label}<input className="input" type="number" inputMode={step === '1' ? 'numeric' : 'decimal'} value={value ?? ''} min={min} max={max} step={step} placeholder="—" onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></label>
}
