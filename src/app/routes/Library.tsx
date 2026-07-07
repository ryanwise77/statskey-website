import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useFoodLibrary } from '../lib/data/useFoodLibrary'
import { useDailyItems } from '../lib/data/useDailyItems'
import {
  deleteDailyItem,
  deleteLibraryFood,
  newId,
  saveFoodToLibrary,
  saveMeal,
  setMealFavorite,
  updateLibraryFood,
} from '../lib/writers'
import { clearFillProvenance } from '../lib/provenance'
import { mealDisplayName, mealTotal } from '../lib/aggregates'
import { EmptyState } from '../components/EmptyState'
import { TrustBadge } from '../components/TrustBadge'
import { NUTRIENT_KEYS, type FoodItem, type Meal } from '../lib/types'

type Tab = 'foods' | 'meals' | 'daily'
type FoodFilter = 'all' | 'saved' | 'favorites'

export function Library() {
  const { user } = useAuth()
  const uid = user?.uid
  const [tab, setTab] = useState<Tab>('foods')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Library</h1>
        <p className="text-text-secondary text-[14px] mt-1">
          Your saved foods, recent meals, and daily supplement set — shared with the iOS app.
        </p>
      </header>

      <div className="tab-strip">
        <button className={tab === 'foods' ? 'active' : ''} onClick={() => setTab('foods')}>Foods</button>
        <button className={tab === 'meals' ? 'active' : ''} onClick={() => setTab('meals')}>Meals</button>
        <button className={tab === 'daily' ? 'active' : ''} onClick={() => setTab('daily')}>Daily items</button>
      </div>

      {tab === 'foods' && <FoodsTab uid={uid} />}
      {tab === 'meals' && <MealsTab uid={uid} />}
      {tab === 'daily' && <DailyItemsTab uid={uid} />}
    </div>
  )
}

function FoodsTab({ uid }: { uid?: string }) {
  const { items, savedItems, loading, error } = useFoodLibrary(uid)
  const [filter, setFilter] = useState<FoodFilter>('all')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [recordedId, setRecordedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const savedIds = useMemo(() => new Set(savedItems.map((s) => s.id)), [savedItems])
  const savedNames = useMemo(() => new Set(savedItems.map((s) => s.name.toLowerCase())), [savedItems])

  const visible = useMemo(() => {
    let list = items
    if (filter === 'saved') list = list.filter((i) => savedIds.has(i.id) || savedNames.has(i.name.toLowerCase()))
    if (filter === 'favorites') list = list.filter((i) => i.isFavorite)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || i.brand?.toLowerCase().includes(q))
    return list
  }, [items, filter, search, savedIds, savedNames])

  async function recordFood(item: FoodItem) {
    if (!uid) return
    setActionError(null)
    try {
      const now = new Date()
      const mealItem: FoodItem = {
        ...item,
        id: newId(),
        source: 'library',
        useCount: item.useCount + 1,
        lastUsed: now,
        consumedAt: now,
        createdAt: now,
        updatedAt: now,
      }
      const meal: Meal = {
        id: newId(),
        userId: uid,
        items: [mealItem],
        date: now,
        multiplier: 1,
        isFavorite: false,
        analysisMode: 'manual',
        createdAt: now,
        updatedAt: now,
      }
      await saveMeal(uid, meal)
      if (savedIds.has(item.id)) {
        await saveFoodToLibrary(uid, item) // bumps useCount + lastUsed
      }
      setRecordedId(item.id)
      setTimeout(() => setRecordedId(null), 2500)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleFavorite(item: FoodItem) {
    if (!uid) return
    setActionError(null)
    try {
      if (savedIds.has(item.id)) {
        await updateLibraryFood(uid, { ...item, isFavorite: !item.isFavorite })
      } else {
        // Favoriting an extracted food saves it to the library first.
        await saveFoodToLibrary(uid, { ...item, isFavorite: !item.isFavorite })
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function saveExtracted(item: FoodItem) {
    if (!uid) return
    setActionError(null)
    try {
      await saveFoodToLibrary(uid, item)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeSaved(item: FoodItem) {
    if (!uid) return
    if (!window.confirm(`Remove "${item.name}" from your library? Recorded meals keep their copies.`)) return
    setActionError(null)
    try {
      await deleteLibraryFood(uid, item.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="tab-strip">
          {(['all', 'saved', 'favorites'] as FoodFilter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          className="input !w-64"
          placeholder="Search foods…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="panel">
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : visible.length === 0 ? (
          <EmptyState
            title="No foods here yet"
            subtitle="Foods you record and save show up in your library automatically."
          />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {visible.map((item) =>
              editingId === item.id ? (
                <FoodEditor
                  key={item.id}
                  uid={uid!}
                  item={item}
                  onDone={() => setEditingId(null)}
                  onError={setActionError}
                />
              ) : (
                <div key={item.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] text-text-primary">
                      {item.isFavorite && <span className="mr-1.5">★</span>}
                      {item.name || 'Unnamed food'}
                      {savedIds.has(item.id) && <span className="timeline-badge ml-2">Saved</span>}
                    </div>
                    <div className="card-subtext mt-0.5">
                      {item.servingSize} {item.servingUnit}
                      {item.brand && ` · ${item.brand}`}
                      {(item.nutrients[NUTRIENT_KEYS.calories] ?? 0) > 0 &&
                        ` · ${Math.round(item.nutrients[NUTRIENT_KEYS.calories])} cal`}
                      {item.useCount > 1 && ` · used ${item.useCount}×`}
                    </div>
                    <TrustBadge item={item} className="card-subtext mt-1" />
                  </div>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <button
                      className="btn btn-secondary text-[12px] !py-1 !px-2.5"
                      onClick={() => recordFood(item)}
                    >
                      {recordedId === item.id ? 'Recorded ✓' : 'Record'}
                    </button>
                    <button
                      className="btn btn-ghost text-[12px] !py-1 !px-2"
                      title={item.isFavorite ? 'Unfavorite' : 'Favorite'}
                      onClick={() => toggleFavorite(item)}
                    >
                      {item.isFavorite ? '★' : '☆'}
                    </button>
                    {savedIds.has(item.id) ? (
                      <>
                        <button
                          className="btn btn-ghost text-[12px] !py-1 !px-2"
                          onClick={() => setEditingId(item.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300"
                          onClick={() => removeSaved(item)}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost text-[12px] !py-1 !px-2"
                        onClick={() => saveExtracted(item)}
                      >
                        Save
                      </button>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const EDITOR_NUTRIENTS: Array<{ key: string; label: string }> = [
  { key: NUTRIENT_KEYS.calories, label: 'Calories' },
  { key: NUTRIENT_KEYS.protein, label: 'Protein (g)' },
  { key: NUTRIENT_KEYS.carbs, label: 'Carbs (g)' },
  { key: NUTRIENT_KEYS.fat, label: 'Fat (g)' },
  { key: NUTRIENT_KEYS.fiber, label: 'Fiber (g)' },
]

function FoodEditor({
  uid,
  item,
  onDone,
  onError,
}: {
  uid: string
  item: FoodItem
  onDone: () => void
  onError: (msg: string | null) => void
}) {
  const [name, setName] = useState(item.name)
  const [brand, setBrand] = useState(item.brand ?? '')
  const [servingSize, setServingSize] = useState(item.servingSize)
  const [servingUnit, setServingUnit] = useState(item.servingUnit)
  const [nutrients, setNutrients] = useState<Record<string, number>>({ ...item.nutrients })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    onError(null)
    try {
      // Hand-edited values lose their "estimated" provenance, mirroring iOS.
      const editedKeys = Object.keys(nutrients).filter(
        (k) => (nutrients[k] ?? 0) !== (item.nutrients[k] ?? 0)
      )
      const cleared = clearFillProvenance({ ...item }, editedKeys)
      await updateLibraryFood(uid, {
        ...cleared,
        name: name.trim() || item.name,
        brand: brand.trim() || undefined,
        servingSize,
        servingUnit: servingUnit.trim() || item.servingUnit,
        nutrients,
      })
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="py-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">Brand</span>
          <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">Serving size</span>
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            value={servingSize}
            onChange={(e) => setServingSize(Number(e.target.value))}
          />
        </label>
        <label className="block">
          <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">Serving unit</span>
          <input className="input" value={servingUnit} onChange={(e) => setServingUnit(e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {EDITOR_NUTRIENTS.map(({ key, label }) => (
          <label key={key} className="block">
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1">{label}</span>
            <input
              className="input"
              type="number"
              step="0.1"
              min={0}
              value={nutrients[key] ?? 0}
              onChange={(e) => setNutrients({ ...nutrients, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onDone} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function MealsTab({ uid }: { uid?: string }) {
  const { meals, loading, error } = useFoodLibrary(uid)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [recordedId, setRecordedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const visible = favoritesOnly ? meals.filter((m) => m.isFavorite) : meals

  async function recordAgain(meal: Meal) {
    if (!uid) return
    setActionError(null)
    try {
      const now = new Date()
      const copy: Meal = {
        ...meal,
        id: newId(),
        date: now,
        isFavorite: false,
        photoURLs: undefined,
        aiExplanation: undefined,
        aiItemInsights: undefined,
        createdAt: now,
        updatedAt: now,
        items: meal.items.map((it) => ({
          ...it,
          id: newId(),
          source: 'library',
          consumedAt: now,
        })),
      }
      await saveMeal(uid, copy)
      setRecordedId(meal.id)
      setTimeout(() => setRecordedId(null), 2500)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleFavorite(meal: Meal) {
    if (!uid) return
    setActionError(null)
    try {
      await setMealFavorite(uid, meal.id, !meal.isFavorite)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-[13px] text-text-secondary">
        <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
        Favorites only
      </label>

      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="panel">
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : visible.length === 0 ? (
          <EmptyState title="No meals here yet" subtitle="Meals from the last 30 days appear here." />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {visible.map((meal) => (
              <div key={meal.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/meals/${meal.id}`} className="text-[14px] text-text-primary hover:underline">
                    {meal.isFavorite && <span className="mr-1.5">★</span>}
                    {mealDisplayName(meal)}
                  </Link>
                  <div className="card-subtext mt-0.5">
                    {meal.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {` · ${Math.round(mealTotal(meal, NUTRIENT_KEYS.calories))} cal`}
                    {` · ${meal.items.length} item${meal.items.length === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <button
                    className="btn btn-secondary text-[12px] !py-1 !px-2.5"
                    onClick={() => recordAgain(meal)}
                  >
                    {recordedId === meal.id ? 'Recorded ✓' : 'Record again'}
                  </button>
                  <button
                    className="btn btn-ghost text-[12px] !py-1 !px-2"
                    title={meal.isFavorite ? 'Unfavorite' : 'Favorite'}
                    onClick={() => toggleFavorite(meal)}
                  >
                    {meal.isFavorite ? '★' : '☆'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DailyItemsTab({ uid }: { uid?: string }) {
  const { items, loading, error } = useDailyItems(uid)
  const [actionError, setActionError] = useState<string | null>(null)

  async function remove(item: { id: string; name: string }) {
    if (!uid) return
    if (!window.confirm(`Stop recording "${item.name}" daily?`)) return
    setActionError(null)
    try {
      await deleteDailyItem(uid, item.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-text-secondary text-[13px]">
        Items here are recorded automatically each day by StatsKey (your supplement and medication set).
        Add new ones from Record → Supplements.
      </p>

      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="panel">
        {loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No daily items"
            subtitle="Save a supplement or medication as a daily item and it records itself every day."
          />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {items.map((item) => (
              <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] text-text-primary">{item.name}</div>
                  <div className="card-subtext mt-0.5">
                    {item.servingSize} {item.servingUnit}
                    {item.itemCategory !== 'food' && ` · ${item.itemCategory}`}
                    {item.brand && ` · ${item.brand}`}
                  </div>
                </div>
                <button
                  className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300"
                  onClick={() => remove(item)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
