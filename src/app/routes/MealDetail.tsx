import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useMealDetail } from '../lib/data/useMealDetail'
import { MealLogForm } from '../components/log/MealLogForm'
import { mealDisplayName, mealTotal } from '../lib/aggregates'
import { deleteMeal } from '../lib/writers'
import { NUTRIENT_KEYS, type FoodItem } from '../lib/types'

export function MealDetail() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { meal, loading, notFound, error } = useMealDetail(user?.uid, id)
  const [isEditing, setIsEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>
  if (error) return <div className="error-banner">{error}</div>
  if (notFound || !meal)
    return (
      <div className="panel">
        <p className="text-text-secondary text-[14px]">Meal not found.</p>
        <Link to="/" className="link text-[13px] mt-3 inline-block">← Back to dashboard</Link>
      </div>
    )

  const time = meal.date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const cal = Math.round(mealTotal(meal, NUTRIENT_KEYS.calories))
  const protein = Math.round(mealTotal(meal, NUTRIENT_KEYS.protein))
  const carbs = Math.round(mealTotal(meal, NUTRIENT_KEYS.carbs))
  const fat = Math.round(mealTotal(meal, NUTRIENT_KEYS.fat))
  const fiber = Math.round(mealTotal(meal, NUTRIENT_KEYS.fiber))

  async function handleDelete() {
    if (!user || deleting) return
    if (!window.confirm('Delete this meal? This cannot be undone.')) return

    setDeleting(true)
    setActionError(null)
    try {
      await deleteMeal(user.uid, meal.id)
      navigate('/history', { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  if (isEditing) {
    return (
      <div className="space-y-6 max-w-[760px]">
        <header>
          <button
            className="text-text-muted hover:text-text-primary text-[12px]"
            type="button"
            onClick={() => setIsEditing(false)}
          >
            ← Back to meal
          </button>
          <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] mt-1">
            Edit Meal
          </h1>
          <p className="text-text-secondary text-[13px] mt-1">
            Updating {meal.date.toLocaleDateString([], { month: 'long', day: 'numeric' })}
          </p>
        </header>
        <div className="panel">
          <MealLogForm
            initialMeal={meal}
            onSaved={() => setIsEditing(false)}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[720px]">
      <header>
        <Link to="/history" className="text-text-muted hover:text-text-primary text-[12px]">← History</Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">{mealDisplayName(meal)}</h1>
          <div className="flex gap-2">
            <button className="btn btn-secondary text-[12px] !py-1.5 !px-3" onClick={() => setIsEditing(true)}>
              Edit
            </button>
            <button
              className="btn btn-ghost text-[12px] !py-1.5 !px-3 text-red-300"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
        <p className="text-text-secondary text-[13px] mt-1">
          {time}
          {meal.multiplier !== 1 && ` · ×${meal.multiplier}`}
          {meal.analysisMode && ` · ${meal.analysisMode}`}
        </p>
      </header>

      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="panel grid grid-cols-5 gap-3 text-center">
        <Stat label="Cal" value={cal} />
        <Stat label="Protein" value={`${protein}g`} />
        <Stat label="Carbs" value={`${carbs}g`} />
        <Stat label="Fat" value={`${fat}g`} />
        <Stat label="Fiber" value={`${fiber}g`} />
      </div>

      {meal.photoURLs && meal.photoURLs.length > 0 && (
        <div className="panel">
          <span className="card-title">Photos</span>
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {meal.photoURLs.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="h-32 rounded-md border border-white/5"
                loading="lazy"
              />
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <span className="card-title">Items ({meal.items.length})</span>
        <div className="mt-3">
          {meal.items.length === 0 ? (
            <p className="text-text-muted text-[13px]">No items.</p>
          ) : (
            meal.items.map((item, idx) => <FoodItemRow key={item.id || idx} item={item} multiplier={meal.multiplier} />)
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="card-subtext">{label}</div>
      <div className="card-number card-number-md mt-1">{value}</div>
    </div>
  )
}

function FoodItemRow({ item, multiplier }: { item: FoodItem; multiplier: number }) {
  const cal = Math.round((item.nutrients[NUTRIENT_KEYS.calories] ?? 0) * multiplier)
  const protein = Math.round((item.nutrients[NUTRIENT_KEYS.protein] ?? 0) * multiplier)
  const servings = `${item.servingSize} ${item.servingUnit}`

  return (
    <div className="py-3 border-b border-white/[0.04] last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] text-text-primary">{item.name || 'Unnamed food'}</div>
          <div className="card-subtext mt-0.5">
            {servings}
            {item.brand && ` · ${item.brand}`}
            {item.itemCategory !== 'food' && ` · ${item.itemCategory}`}
          </div>
        </div>
        <div className="text-right card-subtext font-variant-numeric-tabular whitespace-nowrap">
          {cal > 0 && <div className="text-text-primary">{cal} cal</div>}
          {protein > 0 && <div>{protein}g protein</div>}
        </div>
      </div>
    </div>
  )
}
