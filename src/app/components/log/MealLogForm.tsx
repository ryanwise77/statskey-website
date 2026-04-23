import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { newId, saveMeal } from '../../lib/writers'
import type { FoodItem, Meal } from '../../lib/types'

interface Draft {
  name: string
  servingSize: number
  servingUnit: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
}

const EMPTY_DRAFT: Draft = {
  name: '',
  servingSize: 1,
  servingUnit: 'serving',
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
}

export function MealLogForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const now = new Date()
  const [mealName, setMealName] = useState('')
  const [date, setDate] = useState(now)
  const [items, setItems] = useState<Draft[]>([{ ...EMPTY_DRAFT }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof Draft>(idx: number, key: K, value: Draft[K]) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)))
  }

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_DRAFT }])
  }

  function removeItem(idx: number) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  async function save() {
    if (!user) return
    if (items.every((it) => !it.name.trim())) {
      setError('Add at least one item with a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const mealItems: FoodItem[] = items
        .filter((it) => it.name.trim())
        .map((it) => ({
          id: newId(),
          name: it.name.trim(),
          servingSize: it.servingSize || 1,
          servingUnit: it.servingUnit || 'serving',
          nutrients: {
            calories: Number(it.calories) || 0,
            protein: Number(it.protein) || 0,
            carbohydrates: Number(it.carbs) || 0,
            total_fat: Number(it.fat) || 0,
            dietary_fiber: Number(it.fiber) || 0,
          },
          isFavorite: false,
          useCount: 0,
          source: 'manual',
          itemCategory: 'food',
          createdAt: new Date(),
          updatedAt: new Date(),
        }))

      const meal: Meal = {
        id: newId(),
        userId: user.uid,
        name: mealName.trim() || undefined,
        items: mealItems,
        date,
        multiplier: 1,
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await saveMeal(user.uid, meal)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Meal name (optional)">
          <input
            className="input"
            placeholder="e.g. Breakfast"
            value={mealName}
            onChange={(e) => setMealName(e.target.value)}
          />
        </Field>
        <Field label="Date & time">
          <input
            className="input"
            type="datetime-local"
            value={toDatetimeLocal(date)}
            onChange={(e) => setDate(fromDatetimeLocal(e.target.value))}
          />
        </Field>
      </div>

      <div className="space-y-4">
        {items.map((it, idx) => (
          <div key={idx} className="border border-white/[0.06] rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="card-title">Item {idx + 1}</span>
              {items.length > 1 && (
                <button className="btn btn-ghost text-[12px]" onClick={() => removeItem(idx)}>
                  Remove
                </button>
              )}
            </div>
            <Field label="Name">
              <input
                className="input"
                placeholder="e.g. Scrambled eggs"
                value={it.name}
                onChange={(e) => update(idx, 'name', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Serving size">
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min={0}
                  value={it.servingSize}
                  onChange={(e) => update(idx, 'servingSize', Number(e.target.value))}
                />
              </Field>
              <Field label="Serving unit">
                <input
                  className="input"
                  value={it.servingUnit}
                  onChange={(e) => update(idx, 'servingUnit', e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-5 gap-2">
              <NutrientField label="Cal" value={it.calories} onChange={(v) => update(idx, 'calories', v)} />
              <NutrientField label="P" value={it.protein} onChange={(v) => update(idx, 'protein', v)} />
              <NutrientField label="C" value={it.carbs} onChange={(v) => update(idx, 'carbs', v)} />
              <NutrientField label="F" value={it.fat} onChange={(v) => update(idx, 'fat', v)} />
              <NutrientField label="Fib" value={it.fiber} onChange={(v) => update(idx, 'fiber', v)} />
            </div>
          </div>
        ))}
        <button className="btn btn-secondary w-full" onClick={addItem}>
          + Add another item
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save meal'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function NutrientField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="block">
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">{label}</span>
      <input
        className="input !py-1.5 !px-2 text-[13px]"
        type="number"
        step="0.1"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(s: string): Date {
  return new Date(s)
}
