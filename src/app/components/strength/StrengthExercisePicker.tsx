import { useEffect, useMemo, useRef, useState } from 'react'
import { EQUIPMENT } from '../../lib/strength/model'
import { newCustomStrengthExercise, searchStrengthCatalog, STRENGTH_MUSCLES, type StrengthCatalogExercise } from '../../lib/strength/catalog'
import { saveCustomStrengthExercise } from '../../lib/strength/store'

export function StrengthExercisePicker({ uid, customExercises, onAdd, disabled = false }: {
  uid: string; customExercises: StrengthCatalogExercise[]; onAdd: (exercise: StrengthCatalogExercise) => void; disabled?: boolean
}) {
  const [search, setSearch] = useState(''), [equipment, setEquipment] = useState(''), [muscle, setMuscle] = useState('')
  const [limit, setLimit] = useState(12), [editing, setEditing] = useState<StrengthCatalogExercise | null>(null)
  const [original, setOriginal] = useState<StrengthCatalogExercise | null>(null)
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [saved, setSaved] = useState<StrengthCatalogExercise[]>([])
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const custom = useMemo(() => [...customExercises, ...saved.filter((e) => !customExercises.some((v) => v.id === e.id))], [customExercises, saved])
  const matches = useMemo(() => searchStrengthCatalog(custom, search, equipment, muscle), [custom, search, equipment, muscle])
  function edit(exercise?: StrengthCatalogExercise) {
    setOriginal(exercise ?? null); setEditing(exercise ? { ...exercise, primaryMuscles: [...exercise.primaryMuscles] } : newCustomStrengthExercise(search.trim())); setError('')
  }
  async function save() {
    if (!editing || saving) return
    setSaving(true); setError('')
    try {
      await saveCustomStrengthExercise(uid, editing, original, () => active.current)
      if (!active.current) return
      setSaved((current) => [...current.filter((e) => e.id !== editing.id), editing])
      if (!original) onAdd(editing)
      setEditing(null); setSearch('')
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (active.current) setSaving(false) }
  }
  return <section className="strength-add">
    <h3>Exercise library</h3>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="strength-set-fields">
      <label>Search exercises<input className="input" value={search} maxLength={180} placeholder="Name, alias, or muscle" disabled={disabled || saving} onChange={(e) => { setSearch(e.target.value); setLimit(12) }} /></label>
      <label>Filter equipment<select className="input" value={equipment} disabled={disabled || saving} onChange={(e) => { setEquipment(e.target.value); setLimit(12) }}><option value="">All equipment</option>{EQUIPMENT.map((value) => <option key={value} value={value}>{value === 'smithMachine' ? 'Smith machine' : value}</option>)}</select></label>
      <label>Filter muscle<select className="input" value={muscle} disabled={disabled || saving} onChange={(e) => { setMuscle(e.target.value); setLimit(12) }}><option value="">All muscles</option>{STRENGTH_MUSCLES.map((value) => <option key={value} value={value}>{value === 'fullBody' ? 'Full body' : value}</option>)}</select></label>
    </div>
    <p>{matches.length} exercises{custom.length > 0 ? ` · ${custom.length} custom` : ''}</p>
    <div className="strength-suggestions">{matches.slice(0, limit).map((exercise) => <span className="strength-row-actions" key={exercise.id}>
      <button type="button" disabled={disabled || saving} onClick={() => onAdd(exercise)}>{exercise.name}{exercise.isCustom ? ' · custom' : ''} +</button>
      {exercise.isCustom && <button type="button" className="btn btn-ghost" disabled={disabled || saving} aria-label={`Edit custom exercise ${exercise.name}`} onClick={() => edit(exercise)}>Edit</button>}
    </span>)}</div>
    <div className="strength-row-actions">
      {matches.length > limit && <button type="button" className="btn btn-ghost" onClick={() => setLimit((value) => value + 24)}>Show more exercises</button>}
      <button type="button" className="btn btn-secondary" disabled={disabled || saving} onClick={() => edit()}>Create reusable exercise</button>
    </div>
    {editing && <fieldset className="strength-routine-editor" disabled={saving || disabled}>
      <h3>{original ? 'Edit custom exercise' : 'Create custom exercise'}</h3>
      <label>Exercise name<input className="input" value={editing.name} maxLength={180} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
      <div className="strength-set-fields">
        <label>Equipment<select className="input" value={editing.equipment} onChange={(e) => setEditing({ ...editing, equipment: e.target.value })}>{EQUIPMENT.map((value) => <option key={value} value={value}>{value === 'smithMachine' ? 'Smith machine' : value}</option>)}</select></label>
        <label>Measure<select className="input" value={editing.measure} onChange={(e) => setEditing({ ...editing, measure: e.target.value as 'reps' | 'time' })}><option value="reps">Repetitions</option><option value="time">Time / hold</option></select></label>
      </div>
      <fieldset><legend>Primary muscles</legend><div className="strength-row-actions">{STRENGTH_MUSCLES.map((value) => <label key={value}><input type="checkbox" checked={editing.primaryMuscles.includes(value)} onChange={(e) => setEditing({ ...editing, primaryMuscles: e.target.checked ? [...editing.primaryMuscles, value] : editing.primaryMuscles.filter((v) => v !== value) })} />{value === 'fullBody' ? 'Full body' : value}</label>)}</div></fieldset>
      <label>Exercise notes<textarea className="input" rows={2} maxLength={2000} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
      <p>This exercise will be available in your library on your other devices. Existing workout logs keep their recorded names and measurements.</p>
      <div className="strength-row-actions"><button type="button" className="btn strength-primary" onClick={save}>{saving ? 'Saving…' : original ? 'Save exercise' : 'Save and add exercise'}</button><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
    </fieldset>}
  </section>
}
