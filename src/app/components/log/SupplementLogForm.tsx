import { useState, type ReactNode } from 'react'
import { analyzeNutritionInput } from '../../lib/ai/geminiNutrition'
import { useAuth } from '../../lib/auth'
import { newId, saveDailyItem, saveMeal } from '../../lib/writers'
import type { FoodItem, ItemCategory, Meal } from '../../lib/types'

const DOSAGE_UNITS = ['mg', 'mcg', 'g', 'IU', 'ml', 'drops', 'capsule', 'tablet', 'softgel', 'gummy', 'scoop', 'spray']

export function SupplementLogForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const [category, setCategory] = useState<ItemCategory>('supplement')
  const [name, setName] = useState('')
  const [dosage, setDosage] = useState('')
  const [dosageUnit, setDosageUnit] = useState('mg')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(new Date())
  const [saveDaily, setSaveDaily] = useState(false)
  const [lookup, setLookup] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!user) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(`Enter a ${category === 'supplement' ? 'supplement' : 'medication'} name.`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const item = lookup ? await lookupItem(trimmedName) : fallbackItem(trimmedName)

      if (saveDaily) {
        await saveDailyItem(user.uid, item)
      } else {
        const meal: Meal = {
          id: newId(),
          userId: user.uid,
          name: 'Supplements',
          items: [item],
          date,
          multiplier: 1,
          isFavorite: false,
          analysisMode: 'manual',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        await saveMeal(user.uid, meal)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function lookupItem(trimmedName: string): Promise<FoodItem> {
    const dose = [dosage.trim(), dosageUnit].filter(Boolean).join(' ')
    const query = `${trimmedName} ${dose} ${category === 'supplement' ? 'supplement facts' : 'DailyMed medication'}`
    const [item] = await analyzeNutritionInput({ query }, 'supplement', category)
    return item ?? fallbackItem(trimmedName)
  }

  function fallbackItem(trimmedName: string): FoodItem {
    const now = new Date()
    return {
      id: newId(),
      name: trimmedName,
      servingSize: Number(dosage) || 1,
      servingUnit: dosageUnit,
      nutrients: {},
      isFavorite: false,
      useCount: 0,
      source: 'supplement',
      itemCategory: category,
      notes: notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <span className="card-title block mb-2">Type</span>
        <div className="tab-strip">
          {(['supplement', 'medication'] as ItemCategory[]).map((option) => (
            <button
              key={option}
              type="button"
              className={category === option ? 'active' : ''}
              onClick={() => setCategory(option)}
            >
              {option === 'supplement' ? 'Supplement' : 'Medication'}
            </button>
          ))}
        </div>
      </div>

      <Field label={category === 'supplement' ? 'Supplement name' : 'Medication name'}>
        <input
          className="input"
          placeholder={category === 'supplement' ? 'e.g. Vitamin D3, Creatine' : 'e.g. Ibuprofen, Metformin'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            value={dosage}
            onChange={(e) => setDosage(e.target.value)}
          />
        </Field>
        <Field label="Unit">
          <select className="input" value={dosageUnit} onChange={(e) => setDosageUnit(e.target.value)}>
            {DOSAGE_UNITS.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Date & time">
        <input
          className="input"
          type="datetime-local"
          value={toDatetimeLocal(date)}
          onChange={(e) => setDate(new Date(e.target.value))}
        />
      </Field>

      <Field label="Notes (optional)">
        <textarea
          className="input"
          rows={3}
          placeholder="Take with food, before bed, reason, etc."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <label className="flex items-start gap-3 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          className="mt-1"
          checked={lookup}
          onChange={(e) => setLookup(e.target.checked)}
        />
        <span>Look up nutrient content with AI before saving.</span>
      </label>

      <label className="flex items-start gap-3 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          className="mt-1"
          checked={saveDaily}
          onChange={(e) => setSaveDaily(e.target.checked)}
        />
        <span>Record daily instead of adding only to today's record.</span>
      </label>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saveDaily ? 'Save daily item' : 'Save supplement'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
