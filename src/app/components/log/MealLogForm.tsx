import { useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../lib/auth'
import { analyzeNutritionInput, filesToBase64 } from '../../lib/ai/geminiNutrition'
import { useFoodLibrary } from '../../lib/data/useFoodLibrary'
import { newId, saveFoodToLibrary, saveMeal } from '../../lib/writers'
import type { AnalysisMode, FoodItem, FoodSource, ItemCategory, Meal } from '../../lib/types'

type LibrarySubTab = 'foods' | 'meals'
type LibraryFilter = 'saved' | 'recents' | 'favorites'

interface Draft {
  id: string
  name: string
  brand: string
  barcode: string
  servingSize: number
  servingUnit: string
  nutrients: Record<string, number>
  source: FoodSource
  itemCategory: ItemCategory
  notes: string
  geminiExplanation?: string
  baseNutrients?: Record<string, number>
  baseServingSize?: number
  baseServingUnit?: string
  gramWeight?: number
  gramsPerCup?: number
}

const INPUT_OPTIONS = [
  { id: 'aiSearch', label: 'AI search', description: 'Type anything you ate', icon: 'Sparkles' },
  { id: 'camera', label: 'Camera', description: 'Analyze a fresh food photo', icon: 'Camera' },
  { id: 'photoLibrary', label: 'Photos', description: 'Upload up to 5 images', icon: 'Photos' },
  { id: 'barcode', label: 'Barcode', description: 'Look up a UPC or EAN', icon: 'Barcode' },
  { id: 'labelScan', label: 'Label scan', description: 'Read a nutrition label', icon: 'Label' },
  { id: 'library', label: 'Library', description: 'Reuse saved foods', icon: 'Library' },
  { id: 'manual', label: 'Manual', description: 'Enter nutrition yourself', icon: 'Manual' },
] as const

type InputMode = (typeof INPUT_OPTIONS)[number]['id']
type SaveTarget = 'record' | 'library' | 'both'

const NUTRIENT_FIELDS = [
  { key: 'calories', label: 'Cal' },
  { key: 'protein', label: 'P' },
  { key: 'carbohydrates', label: 'C' },
  { key: 'total_fat', label: 'F' },
  { key: 'dietary_fiber', label: 'Fib' },
] as const

export function MealLogForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const {
    items: libraryItems,
    meals: libraryMeals,
    savedItems: librarySavedItems,
    loading: libraryLoading,
    error: libraryError,
  } = useFoodLibrary(user?.uid)
  const now = new Date()
  const [inputMode, setInputMode] = useState<InputMode>('aiSearch')
  const [mealName, setMealName] = useState('')
  const [date, setDate] = useState(now)
  const [items, setItems] = useState<Draft[]>([emptyDraft()])
  const [saveTarget, setSaveTarget] = useState<SaveTarget>('record')
  const [query, setQuery] = useState('')
  const [barcode, setBarcode] = useState('')
  const [labelText, setLabelText] = useState('')
  const [photoHint, setPhotoHint] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [librarySubTab, setLibrarySubTab] = useState<LibrarySubTab>('foods')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('saved')
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof Draft>(idx: number, key: K, value: Draft[K]) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)))
  }

  function updateNutrient(idx: number, key: string, value: number) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, nutrients: { ...it.nutrients, [key]: Number(value) || 0 } } : it
      )
    )
  }

  function addItem() {
    setItems((prev) => [...prev, emptyDraft('manual')])
  }

  function removeItem(idx: number) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  function appendAnalyzed(foodItems: FoodItem[]) {
    if (foodItems.length === 0) {
      setError('No foods were found. Try a more specific input.')
      return
    }
    const drafts = foodItems.map(itemToDraft)
    setItems((prev) => (prev.length === 1 && isBlank(prev[0]) ? drafts : [...prev, ...drafts]))
    setError(null)
  }

  async function analyze() {
    setAnalyzing(true)
    setError(null)
    try {
      if (inputMode === 'aiSearch') {
        if (!query.trim()) throw new Error('Enter a food search first.')
        appendAnalyzed(await analyzeNutritionInput({ query: query.trim() }, 'aiSearch'))
        return
      }

      if (inputMode === 'barcode') {
        if (!barcode.trim()) throw new Error('Enter a barcode number.')
        appendAnalyzed(
          await analyzeNutritionInput(
            {
              query: `Barcode ${barcode.trim()}`,
              searchQuery: `${barcode.trim()} nutrition facts`,
            },
            'barcode'
          )
        )
        return
      }

      if (inputMode === 'labelScan') {
        if (!labelText.trim() && selectedFiles.length === 0) {
          throw new Error('Paste label text or upload a label photo.')
        }
        const images = selectedFiles.length ? await filesToBase64(selectedFiles.slice(0, 5)) : undefined
        appendAnalyzed(
          await analyzeNutritionInput(
            {
              query: labelText.trim() || 'Nutrition facts label',
              packagingText: labelText.trim() || undefined,
              images,
            },
            'labelScan'
          )
        )
        return
      }

      if (inputMode === 'camera' || inputMode === 'photoLibrary') {
        if (selectedFiles.length === 0) throw new Error('Choose at least one photo.')
        const images = await filesToBase64(selectedFiles.slice(0, 5))
        appendAnalyzed(
          await analyzeNutritionInput(
            {
              query: photoHint.trim() || 'Food photo nutrition analysis',
              images,
            },
            inputMode
          )
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  function addFromLibrary(item: FoodItem) {
    appendAnalyzed([{ ...item, id: newId(), source: 'library', createdAt: new Date(), updatedAt: new Date() }])
  }

  function addMealFromLibrary(meal: Meal) {
    if (meal.items.length === 0) {
      setError('That meal has no items.')
      return
    }
    if (!mealName.trim() && meal.name) setMealName(meal.name)
    const drafts = meal.items.map((item) =>
      itemToDraft({
        ...item,
        id: newId(),
        source: 'library',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    )
    setItems((prev) => (prev.length === 1 && isBlank(prev[0]) ? drafts : [...prev, ...drafts]))
    setError(null)
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
        .map(draftToFoodItem)

      if (saveTarget === 'library' || saveTarget === 'both') {
        await Promise.all(mealItems.map((item) => saveFoodToLibrary(user.uid, item)))
      }

      if (saveTarget === 'library') {
        onSaved()
        return
      }

      const meal: Meal = {
        id: newId(),
        userId: user.uid,
        name: mealName.trim() || undefined,
        items: mealItems,
        date,
        multiplier: 1,
        isFavorite: false,
        analysisMode: inferAnalysisMode(mealItems),
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
      <div>
        <span className="card-title block mb-2">Food input</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {INPUT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={
                'text-left rounded-xl border p-3 transition ' +
                (inputMode === option.id
                  ? 'border-accent/70 bg-accent/10'
                  : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]')
              }
              onClick={() => {
                setInputMode(option.id)
                setError(null)
              }}
            >
              <span className="text-text-primary text-[13px] font-semibold">{option.label}</span>
              <span className="block text-text-muted text-[11px] mt-1">{option.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border border-white/[0.06] rounded-xl p-3 space-y-3">
        <InputModePanel
          mode={inputMode}
          query={query}
          setQuery={setQuery}
          barcode={barcode}
          setBarcode={setBarcode}
          labelText={labelText}
          setLabelText={setLabelText}
          photoHint={photoHint}
          setPhotoHint={setPhotoHint}
          setSelectedFiles={setSelectedFiles}
          analyzing={analyzing}
          onAnalyze={analyze}
          librarySearch={librarySearch}
          setLibrarySearch={setLibrarySearch}
          libraryItems={libraryItems}
          librarySavedItems={librarySavedItems}
          libraryMeals={libraryMeals}
          libraryLoading={libraryLoading}
          libraryError={libraryError}
          librarySubTab={librarySubTab}
          setLibrarySubTab={setLibrarySubTab}
          libraryFilter={libraryFilter}
          setLibraryFilter={setLibraryFilter}
          onAddLibraryItem={addFromLibrary}
          onAddLibraryMeal={addMealFromLibrary}
        />
      </div>

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
          <div key={it.id} className="border border-white/[0.06] rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="card-title">Item {idx + 1}</span>
                <span className="block text-text-muted text-[11px]">{sourceLabel(it.source)}</span>
              </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Brand (optional)">
                <input
                  className="input"
                  placeholder="e.g. Chobani"
                  value={it.brand}
                  onChange={(e) => update(idx, 'brand', e.target.value)}
                />
              </Field>
              <Field label="Barcode (optional)">
                <input
                  className="input"
                  value={it.barcode}
                  onChange={(e) => update(idx, 'barcode', e.target.value)}
                />
              </Field>
            </div>
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
              {NUTRIENT_FIELDS.map((field) => (
                <NutrientField
                  key={field.key}
                  label={field.label}
                  value={it.nutrients[field.key] ?? 0}
                  onChange={(v) => updateNutrient(idx, field.key, v)}
                />
              ))}
            </div>
            <Field label="Notes (optional)">
              <textarea
                className="input"
                rows={2}
                value={it.notes}
                onChange={(e) => update(idx, 'notes', e.target.value)}
              />
            </Field>
            {it.geminiExplanation && (
              <p className="text-text-muted text-[12px]">{it.geminiExplanation}</p>
            )}
          </div>
        ))}
        <button className="btn btn-secondary w-full" onClick={addItem}>
          + Add another item
        </button>
      </div>

      <div>
        <span className="card-title block mb-2">Save options</span>
        <div className="tab-strip">
          {(['record', 'library', 'both'] as SaveTarget[]).map((target) => (
            <button
              key={target}
              type="button"
              className={saveTarget === target ? 'active' : ''}
              onClick={() => setSaveTarget(target)}
            >
              {target === 'record'
                ? 'Add to Record'
                : target === 'library'
                  ? 'Save to Library'
                  : 'Record + Library'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saveTarget === 'library' ? 'Save foods' : 'Save meal'}
        </button>
      </div>
    </div>
  )
}

function InputModePanel({
  mode,
  query,
  setQuery,
  barcode,
  setBarcode,
  labelText,
  setLabelText,
  photoHint,
  setPhotoHint,
  setSelectedFiles,
  analyzing,
  onAnalyze,
  librarySearch,
  setLibrarySearch,
  libraryItems,
  librarySavedItems,
  libraryMeals,
  libraryLoading,
  libraryError,
  librarySubTab,
  setLibrarySubTab,
  libraryFilter,
  setLibraryFilter,
  onAddLibraryItem,
  onAddLibraryMeal,
}: {
  mode: InputMode
  query: string
  setQuery: (value: string) => void
  barcode: string
  setBarcode: (value: string) => void
  labelText: string
  setLabelText: (value: string) => void
  photoHint: string
  setPhotoHint: (value: string) => void
  setSelectedFiles: (files: File[]) => void
  analyzing: boolean
  onAnalyze: () => void
  librarySearch: string
  setLibrarySearch: (value: string) => void
  libraryItems: FoodItem[]
  librarySavedItems: FoodItem[]
  libraryMeals: Meal[]
  libraryLoading: boolean
  libraryError: string | null
  librarySubTab: LibrarySubTab
  setLibrarySubTab: (tab: LibrarySubTab) => void
  libraryFilter: LibraryFilter
  setLibraryFilter: (filter: LibraryFilter) => void
  onAddLibraryItem: (item: FoodItem) => void
  onAddLibraryMeal: (meal: Meal) => void
}) {
  if (mode === 'library') {
    return (
      <LibraryPanel
        librarySearch={librarySearch}
        setLibrarySearch={setLibrarySearch}
        libraryItems={libraryItems}
        librarySavedItems={librarySavedItems}
        libraryMeals={libraryMeals}
        libraryLoading={libraryLoading}
        libraryError={libraryError}
        librarySubTab={librarySubTab}
        setLibrarySubTab={setLibrarySubTab}
        libraryFilter={libraryFilter}
        setLibraryFilter={setLibraryFilter}
        onAddLibraryItem={onAddLibraryItem}
        onAddLibraryMeal={onAddLibraryMeal}
      />
    )
  }

  if (mode === 'manual') {
    return (
      <div className="text-text-secondary text-[13px]">
        Fill out the item cards below. Manual entries sync to the same meal schema as the iOS app.
      </div>
    )
  }

  if (mode === 'aiSearch') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <Field label="Search here">
          <input
            className="input"
            placeholder="e.g. 2 eggs, sourdough toast, coffee with milk"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAnalyze()
            }}
          />
        </Field>
        <button className="btn btn-primary" type="button" disabled={analyzing} onClick={onAnalyze}>
          {analyzing ? 'Searching...' : 'Search with AI'}
        </button>
      </div>
    )
  }

  if (mode === 'barcode') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <Field label="Barcode">
          <input
            className="input"
            placeholder="Scan or type the UPC/EAN"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
          />
        </Field>
        <button className="btn btn-primary" type="button" disabled={analyzing} onClick={onAnalyze}>
          {analyzing ? 'Looking up...' : 'Look up barcode'}
        </button>
      </div>
    )
  }

  if (mode === 'labelScan') {
    return (
      <div className="space-y-3">
        <Field label="Nutrition label text">
          <textarea
            className="input"
            rows={4}
            placeholder="Paste OCR text, ingredients, or packaging details"
            value={labelText}
            onChange={(e) => setLabelText(e.target.value)}
          />
        </Field>
        <PhotoInput onFiles={setSelectedFiles} />
        <button className="btn btn-primary" type="button" disabled={analyzing} onClick={onAnalyze}>
          {analyzing ? 'Analyzing...' : 'Analyze label'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Field label="Photo hint (optional)">
        <input
          className="input"
          placeholder="e.g. salmon bowl, side of dressing"
          value={photoHint}
          onChange={(e) => setPhotoHint(e.target.value)}
        />
      </Field>
      <PhotoInput capture={mode === 'camera'} onFiles={setSelectedFiles} />
      <button className="btn btn-primary" type="button" disabled={analyzing} onClick={onAnalyze}>
        {analyzing ? 'Analyzing...' : mode === 'camera' ? 'Analyze camera photo' : 'Analyze photos'}
      </button>
    </div>
  )
}

function LibraryPanel({
  librarySearch,
  setLibrarySearch,
  libraryItems,
  librarySavedItems,
  libraryMeals,
  libraryLoading,
  libraryError,
  librarySubTab,
  setLibrarySubTab,
  libraryFilter,
  setLibraryFilter,
  onAddLibraryItem,
  onAddLibraryMeal,
}: {
  librarySearch: string
  setLibrarySearch: (value: string) => void
  libraryItems: FoodItem[]
  librarySavedItems: FoodItem[]
  libraryMeals: Meal[]
  libraryLoading: boolean
  libraryError: string | null
  librarySubTab: LibrarySubTab
  setLibrarySubTab: (tab: LibrarySubTab) => void
  libraryFilter: LibraryFilter
  setLibraryFilter: (filter: LibraryFilter) => void
  onAddLibraryItem: (item: FoodItem) => void
  onAddLibraryMeal: (meal: Meal) => void
}) {
  const search = librarySearch.trim().toLowerCase()
  const savedNames = useMemo(
    () => new Set(librarySavedItems.map((it) => it.name.toLowerCase())),
    [librarySavedItems]
  )

  const filteredFoods = useMemo(() => {
    let result = libraryItems
    if (libraryFilter === 'favorites') {
      result = result.filter((item) => item.isFavorite)
    } else if (libraryFilter === 'recents') {
      result = result.slice(0, 20)
    }
    if (search) {
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(search) ||
          (item.brand?.toLowerCase().includes(search) ?? false)
      )
    }
    return result
  }, [libraryItems, libraryFilter, search])

  const filteredMeals = useMemo(() => {
    let result = libraryMeals
    if (libraryFilter === 'favorites') {
      result = result.filter((meal) => meal.isFavorite)
    } else if (libraryFilter === 'recents') {
      result = result.slice(0, 20)
    }
    if (search) {
      result = result.filter(
        (meal) =>
          (meal.name?.toLowerCase().includes(search) ?? false) ||
          meal.items.some((item) => item.name.toLowerCase().includes(search))
      )
    }
    return result
  }, [libraryMeals, libraryFilter, search])

  return (
    <div className="space-y-3">
      <div className="tab-strip">
        {(['foods', 'meals'] as LibrarySubTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={librarySubTab === tab ? 'active' : ''}
            onClick={() => setLibrarySubTab(tab)}
          >
            {tab === 'foods' ? 'Foods' : 'Meals'}
          </button>
        ))}
      </div>

      <div className="tab-strip">
        {(['saved', 'recents', 'favorites'] as LibraryFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            className={libraryFilter === filter ? 'active' : ''}
            onClick={() => setLibraryFilter(filter)}
          >
            {filter === 'saved' ? 'Saved' : filter === 'recents' ? 'Recents' : 'Favorites'}
          </button>
        ))}
      </div>

      <Field label="Search foods">
        <input
          className="input"
          placeholder="Search by name or brand..."
          value={librarySearch}
          onChange={(e) => setLibrarySearch(e.target.value)}
        />
      </Field>

      {libraryLoading && <p className="text-text-muted text-[13px]">Loading library...</p>}
      {libraryError && <div className="error-banner">{libraryError}</div>}

      {!libraryLoading && librarySubTab === 'foods' && (
        <FoodResults
          foods={filteredFoods}
          savedNames={savedNames}
          onAdd={onAddLibraryItem}
        />
      )}

      {!libraryLoading && librarySubTab === 'meals' && (
        <MealResults meals={filteredMeals} onAdd={onAddLibraryMeal} />
      )}
    </div>
  )
}

function FoodResults({
  foods,
  savedNames,
  onAdd,
}: {
  foods: FoodItem[]
  savedNames: Set<string>
  onAdd: (item: FoodItem) => void
}) {
  if (foods.length === 0) {
    return (
      <p className="text-text-muted text-[13px]">
        No foods match. Log a meal or save foods to your library to populate this list.
      </p>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-auto">
      {foods.map((item) => {
        const calories = item.nutrients.calories ?? 0
        const isSaved = savedNames.has(item.name.toLowerCase())
        return (
          <button
            key={item.id}
            type="button"
            className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.05]"
            onClick={() => onAdd(item)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-text-primary text-[13px] font-medium truncate">
                {item.isFavorite ? '\u2665 ' : ''}
                {item.name}
              </span>
              <span className="text-text-secondary text-[12px] tabular-nums">
                {Math.round(calories)} cal
              </span>
            </div>
            <div className="text-text-muted text-[11px] mt-1 flex items-center gap-1.5 flex-wrap">
              {item.brand && <span>{item.brand}</span>}
              {item.brand && <span>&middot;</span>}
              <span>
                {formatNumber(item.servingSize)} {item.servingUnit}
              </span>
              {!isSaved && (
                <span className="text-text-secondary">&middot; from meals</span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function MealResults({ meals, onAdd }: { meals: Meal[]; onAdd: (meal: Meal) => void }) {
  if (meals.length === 0) {
    return <p className="text-text-muted text-[13px]">No meals in the last 30 days.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-2 max-h-80 overflow-auto">
      {meals.map((meal) => {
        const calories = meal.items.reduce(
          (sum, item) => sum + (item.nutrients.calories ?? 0),
          0
        )
        return (
          <button
            key={meal.id}
            type="button"
            className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.05]"
            onClick={() => onAdd(meal)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-text-primary text-[13px] font-medium truncate">
                {meal.name?.trim() || meal.items[0]?.name || 'Meal'}
              </span>
              <span className="text-text-secondary text-[12px] tabular-nums">
                {Math.round(calories * meal.multiplier)} cal
              </span>
            </div>
            <div className="text-text-muted text-[11px] mt-1">
              {meal.items.length} {meal.items.length === 1 ? 'item' : 'items'} &middot;{' '}
              {meal.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1).replace(/\.0$/, '')
}

function PhotoInput({ capture, onFiles }: { capture?: boolean; onFiles: (files: File[]) => void }) {
  return (
    <Field label="Images">
      <input
        className="input"
        type="file"
        accept="image/*"
        multiple
        capture={capture ? 'environment' : undefined}
        onChange={(e) => onFiles(Array.from(e.target.files ?? []).slice(0, 5))}
      />
    </Field>
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

function emptyDraft(source: FoodSource = 'manual'): Draft {
  return {
    id: newId(),
    name: '',
    brand: '',
    barcode: '',
    servingSize: 1,
    servingUnit: 'serving',
    nutrients: {
      calories: 0,
      protein: 0,
      carbohydrates: 0,
      total_fat: 0,
      dietary_fiber: 0,
    },
    source,
    itemCategory: 'food',
    notes: '',
  }
}

function isBlank(draft: Draft): boolean {
  return !draft.name.trim() && Object.values(draft.nutrients).every((value) => !value)
}

function itemToDraft(item: FoodItem): Draft {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand ?? '',
    barcode: item.barcode ?? '',
    servingSize: item.servingSize,
    servingUnit: item.servingUnit,
    nutrients: { ...item.nutrients },
    source: item.source,
    itemCategory: item.itemCategory,
    notes: item.notes ?? '',
    geminiExplanation: item.geminiExplanation,
    baseNutrients: item.baseNutrients,
    baseServingSize: item.baseServingSize,
    baseServingUnit: item.baseServingUnit,
    gramWeight: item.gramWeight,
    gramsPerCup: item.gramsPerCup,
  }
}

function draftToFoodItem(draft: Draft): FoodItem {
  const now = new Date()
  return {
    id: draft.id || newId(),
    name: draft.name.trim(),
    brand: draft.brand.trim() || undefined,
    servingSize: Number(draft.servingSize) || 1,
    servingUnit: draft.servingUnit.trim() || 'serving',
    barcode: draft.barcode.trim() || undefined,
    nutrients: draft.nutrients,
    baseNutrients: draft.baseNutrients,
    baseServingSize: draft.baseServingSize,
    baseServingUnit: draft.baseServingUnit,
    gramWeight: draft.gramWeight,
    gramsPerCup: draft.gramsPerCup,
    isFavorite: false,
    useCount: 0,
    source: draft.source,
    itemCategory: draft.itemCategory,
    notes: draft.notes.trim() || undefined,
    geminiExplanation: draft.geminiExplanation,
    createdAt: now,
    updatedAt: now,
  }
}

function inferAnalysisMode(items: FoodItem[]): AnalysisMode {
  if (items.some((item) => item.source === 'barcode')) return 'barcode'
  if (items.some((item) => item.source === 'camera' || item.source === 'photoLibrary' || item.source === 'labelScan')) {
    return 'photo'
  }
  if (items.some((item) => item.source === 'aiSearch')) return 'text'
  return 'manual'
}

function sourceLabel(source: FoodSource): string {
  switch (source) {
    case 'aiSearch':
      return 'AI search'
    case 'photoLibrary':
      return 'Photo library'
    case 'barcode':
      return 'Barcode'
    case 'labelScan':
      return 'Label scan'
    case 'library':
      return 'Library'
    case 'camera':
      return 'Camera'
    case 'supplement':
      return 'Supplement'
    case 'manual':
      return 'Manual'
  }
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(s: string): Date {
  return new Date(s)
}
