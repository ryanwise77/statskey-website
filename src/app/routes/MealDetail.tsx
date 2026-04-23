import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useMealDetail } from '../lib/data/useMealDetail'
import { mealDisplayName, mealTotal } from '../lib/aggregates'
import { NUTRIENT_KEYS, type FoodItem } from '../lib/types'

export function MealDetail() {
  const { user } = useAuth()
  const { id } = useParams<{ id: string }>()
  const { meal, loading, notFound, error } = useMealDetail(user?.uid, id)

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

  return (
    <div className="space-y-6 max-w-[720px]">
      <header>
        <Link to="/" className="text-text-muted hover:text-text-primary text-[12px]">← Dashboard</Link>
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] mt-1">{mealDisplayName(meal)}</h1>
        <p className="text-text-secondary text-[13px] mt-1">
          {time}
          {meal.multiplier !== 1 && ` · ×${meal.multiplier}`}
          {meal.analysisMode && ` · ${meal.analysisMode}`}
        </p>
      </header>

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
