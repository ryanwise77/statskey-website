import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../lib/auth'
import { analyzeNutritionInput, filesToBase64 } from '../../lib/ai/geminiNutrition'
import { useFoodLibrary } from '../../lib/data/useFoodLibrary'
import { clearFillProvenance } from '../../lib/provenance'
import { availableServingUnits, convertServingAmount, nutrientsForServing } from '../../lib/serving'
import { newId, saveFoodToLibrary, saveMeal } from '../../lib/writers'
import { TrustBadge } from '../TrustBadge'
import type {
  AnalysisMode,
  FoodItem,
  FoodSource,
  ItemCategory,
  Meal,
  PortionEstimate,
} from '../../lib/types'

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
  // 4.7 trust/provenance — round-tripped so a web edit keeps the item's
  // confidence signals and iOS-recorded provenance intact.
  quantityWasUserAdjusted?: boolean
  hiddenFromFriends?: boolean
  aiEstimatedNutrientKeys?: string[]
  nutrientFillSources?: Record<string, string>
  nutrientFillConfidence?: Record<string, string>
  nutrientErrPct?: Record<string, number>
  enrichmentMethod?: string
  enrichmentCitation?: string
  enrichmentSchemaVersion?: number
  portionEstimate?: PortionEstimate
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

interface MealLogFormProps {
  onSaved: (meal: Meal) => void
  initialDate?: Date
  initialMeal?: Meal
  onCancel?: () => void
}

export function MealLogForm({ onSaved, initialDate, initialMeal, onCancel }: MealLogFormProps) {
  const { user } = useAuth()
  const {
    items: libraryItems,
    meals: libraryMeals,
    savedItems: librarySavedItems,
    loading: libraryLoading,
    error: libraryError,
  } = useFoodLibrary(user?.uid)
  const isEditing = initialMeal != null
  const now = initialMeal?.date ?? initialDate ?? new Date()
  const [inputMode, setInputMode] = useState<InputMode>('aiSearch')
  const [mealName, setMealName] = useState(initialMeal?.name ?? '')
  const [date, setDate] = useState(now)
  const [items, setItems] = useState<Draft[]>(
    initialMeal?.items.length ? initialMeal.items.map(itemToDraft) : [emptyDraft()]
  )
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
  // Visibility of system status (Nielsen #1): track elapsed time so a long
  // photo analysis keeps showing progress instead of a frozen-looking button.
  const [analyzeStartAt, setAnalyzeStartAt] = useState<number | null>(null)
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0)
  const [retryable, setRetryable] = useState(false)

  useEffect(() => {
    if (analyzeStartAt == null) {
      setAnalyzeElapsed(0)
      return
    }
    setAnalyzeElapsed(0)
    const id = setInterval(() => {
      setAnalyzeElapsed(Math.floor((Date.now() - analyzeStartAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [analyzeStartAt])

  function update<K extends keyof Draft>(idx: number, key: K, value: Draft[K]) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)))
  }

  function updateNutrient(idx: number, key: string, value: number) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const nutrients = { ...it.nutrients, [key]: Number(value) || 0 }
        // A hand-corrected value is no longer our estimate — drop its fill
        // provenance so it stops being badged as estimated (mirrors iOS).
        return clearFillProvenance(
          {
            ...it,
            nutrients,
            baseNutrients: nutrients,
            baseServingSize: Number(it.servingSize) || 1,
            baseServingUnit: it.servingUnit,
            gramWeight: currentDraftGramWeight(it),
          },
          [key]
        )
      })
    )
  }

  function updateServingSize(idx: number, value: number) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const servingSize = Number.isFinite(value) ? value : 0
        return {
          ...it,
          servingSize,
          nutrients: nutrientsForServing(it, servingSize, it.servingUnit),
          // The amount is now user-confirmed, so photo-portion uncertainty no
          // longer applies (mirrors FoodItem.scaled(by:)).
          quantityWasUserAdjusted: true,
        }
      })
    )
  }

  function updateServingUnit(idx: number, value: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const servingUnit = value.trim() || 'serving'
        return {
          ...it,
          servingUnit,
          nutrients: nutrientsForServing(it, it.servingSize, servingUnit),
          quantityWasUserAdjusted: true,
        }
      })
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
    setAnalyzeStartAt(Date.now())
    setError(null)
    setRetryable(false)
    try {
      if (inputMode === 'aiSearch') {
        if (!query.trim() && selectedFiles.length === 0) {
          throw new Error('Enter a food search or attach a photo.')
        }
        const images = selectedFiles.length ? await filesToBase64(selectedFiles.slice(0, 5)) : undefined
        appendAnalyzed(
          await analyzeNutritionInput(
            {
              query: query.trim() || 'Food photo nutrition analysis',
              images,
            },
            'aiSearch'
          )
        )
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
      // Error recovery (Nielsen #9): translate raw codes like `deadline-exceeded`
      // into a plain, actionable message and offer a one-tap retry.
      setError(friendlyError(e))
      setRetryable(true)
    } finally {
      setAnalyzing(false)
      setAnalyzeStartAt(null)
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

      if (!isEditing && (saveTarget === 'library' || saveTarget === 'both')) {
        await Promise.all(mealItems.map((item) => saveFoodToLibrary(user.uid, item)))
      }

      if (!isEditing && saveTarget === 'library') {
        onSaved(initialMeal ?? {
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
        })
        return
      }

      const meal: Meal = {
        id: initialMeal?.id ?? newId(),
        userId: user.uid,
        name: mealName.trim() || undefined,
        items: mealItems,
        date,
        multiplier: initialMeal?.multiplier ?? 1,
        isFavorite: initialMeal?.isFavorite ?? false,
        analysisMode: initialMeal?.analysisMode ?? inferAnalysisMode(mealItems),
        createdAt: initialMeal?.createdAt ?? new Date(),
        updatedAt: new Date(),
      }
      if (initialMeal?.glucoseResponse) meal.glucoseResponse = initialMeal.glucoseResponse
      if (initialMeal?.photoURLs?.length) meal.photoURLs = initialMeal.photoURLs
      if (initialMeal?.totalNutrientsOverride) meal.totalNutrientsOverride = initialMeal.totalNutrientsOverride
      if (initialMeal?.hiddenItemCount != null) meal.hiddenItemCount = initialMeal.hiddenItemCount
      if (initialMeal?.aiExplanation) meal.aiExplanation = initialMeal.aiExplanation
      if (initialMeal?.aiItemInsights) meal.aiItemInsights = initialMeal.aiItemInsights
      await saveMeal(user.uid, meal)
      onSaved(meal)
    } catch (e) {
      setError(friendlyError(e))
      setRetryable(false)
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
                setSelectedFiles([])
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
        {analyzing && <AnalyzingStatus mode={inputMode} elapsed={analyzeElapsed} />}
        {retryable && error && !analyzing && (
          <div className="error-banner flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              className="btn btn-secondary !py-1 !px-3 text-[12px] whitespace-nowrap"
              type="button"
              onClick={analyze}
            >
              Try again
            </button>
          </div>
        )}
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
                <span className="flex items-center gap-2 text-text-muted text-[11px]">
                  {sourceLabel(it.source)}
                  <TrustBadge item={draftToFoodItem(it)} className="text-[11px]" />
                </span>
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
                  onChange={(e) => updateServingSize(idx, Number(e.target.value))}
                />
              </Field>
              <Field label="Serving unit">
                <ServingUnitInput item={it} onChange={(value) => updateServingUnit(idx, value)} />
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
        {!isEditing && (
          <>
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
          </>
        )}
      </div>

      {isEditing && (
        <div className="rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-[12px] text-text-secondary">
          Changes update this meal in place, even if it belongs to a previous calendar day.
        </div>
      )}

      {error && !retryable && <div className="error-banner">{error}</div>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving
            ? 'Saving...'
            : isEditing
              ? 'Save changes'
              : saveTarget === 'library'
                ? 'Save foods'
                : 'Save meal'}
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
      <div className="space-y-3">
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
        <PhotoInput onFiles={setSelectedFiles} label="Add photos (optional)" />
        <p className="text-text-muted text-[12px]">
          Attach up to 5 photos to analyze alongside your description — or leave the text empty to identify the food from the images alone.
        </p>
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
        No foods match. Record a meal or save foods to your library to populate this list.
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

function PhotoInput({
  capture,
  onFiles,
  label = 'Images',
}: {
  capture?: boolean
  onFiles: (files: File[]) => void
  label?: string
}) {
  return (
    <Field label={label}>
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

function ServingUnitInput({ item, onChange }: { item: Draft; onChange: (unit: string) => void }) {
  const units = availableServingUnits(item)
  const datalistId = `serving-units-${item.id}`

  if (units.length > 1) {
    return (
      <select
        className="input"
        value={item.servingUnit}
        onChange={(e) => onChange(e.target.value)}
      >
        {units.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </select>
    )
  }

  return (
    <>
      <input
        className="input"
        list={datalistId}
        value={item.servingUnit}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={datalistId}>
        {units.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
    </>
  )
}

function AnalyzingStatus({ mode, elapsed }: { mode: InputMode; elapsed: number }) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-3 flex items-center gap-3">
      <Spinner />
      <div className="min-w-0">
        <div className="text-text-primary text-[13px] font-medium">{analyzingMessage(mode, elapsed)}</div>
        <div className="text-text-muted text-[11px] mt-0.5">
          {elapsed < 8
            ? 'This usually takes a few seconds.'
            : `Working — ${elapsed}s elapsed. Photos can take up to a minute.`}
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin shrink-0"
      style={{ color: 'var(--color-accent)' }}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// Staged messages give a sense of forward progress (goal-gradient effect) and
// loosely mirror the iOS app's vision → portion → nutrition pipeline.
function analyzingMessage(mode: InputMode, elapsed: number): string {
  if (mode === 'barcode') return elapsed < 6 ? 'Looking up the barcode…' : 'Pulling nutrition facts…'
  if (elapsed < 3) return 'Uploading…'
  if (elapsed < 9) return 'Reading your food…'
  if (elapsed < 18) return 'Estimating portions…'
  if (elapsed < 34) return 'Pulling nutrition facts…'
  return 'Almost there — finishing up…'
}

// Translate transport/server error codes into plain, recoverable guidance.
function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const code =
    typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
  const hay = `${code} ${raw}`.toLowerCase()
  if (hay.includes('deadline') || hay.includes('timeout')) {
    return 'That took longer than expected. Try again — one clear photo at a time is fastest.'
  }
  if (hay.includes('unauthenticated') || hay.includes('permission-denied')) {
    return 'Your session may have expired. Refresh the page and sign in again.'
  }
  if (hay.includes('resource-exhausted') || hay.includes('quota') || hay.includes('rate')) {
    return 'A lot of requests are coming through right now. Wait a few seconds and try again.'
  }
  if (hay.includes('unavailable') || hay.includes('internal') || hay.includes('empty response')) {
    return 'The analyzer had a brief hiccup. Please try again.'
  }
  if (hay.includes('network') || hay.includes('failed to fetch')) {
    return 'Network issue reaching the analyzer. Check your connection and try again.'
  }
  return raw
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
  const baseNutrients = item.baseNutrients ?? item.nutrients
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
    baseNutrients,
    baseServingSize: item.baseServingSize ?? item.servingSize,
    baseServingUnit: item.baseServingUnit ?? item.servingUnit,
    gramWeight: item.gramWeight ?? currentItemGramWeight(item),
    gramsPerCup: item.gramsPerCup,
    quantityWasUserAdjusted: item.quantityWasUserAdjusted,
    hiddenFromFriends: item.hiddenFromFriends,
    aiEstimatedNutrientKeys: item.aiEstimatedNutrientKeys,
    nutrientFillSources: item.nutrientFillSources,
    nutrientFillConfidence: item.nutrientFillConfidence,
    nutrientErrPct: item.nutrientErrPct,
    enrichmentMethod: item.enrichmentMethod,
    enrichmentCitation: item.enrichmentCitation,
    enrichmentSchemaVersion: item.enrichmentSchemaVersion,
    portionEstimate: item.portionEstimate,
  }
}

function draftToFoodItem(draft: Draft): FoodItem {
  const now = new Date()
  const servingSize = Number(draft.servingSize) || 1
  const servingUnit = draft.servingUnit.trim() || 'serving'
  const baseNutrients = draft.baseNutrients ?? draft.nutrients
  return {
    id: draft.id || newId(),
    name: draft.name.trim(),
    brand: draft.brand.trim() || undefined,
    servingSize,
    servingUnit,
    barcode: draft.barcode.trim() || undefined,
    nutrients: draft.nutrients,
    baseNutrients,
    baseServingSize: draft.baseServingSize ?? servingSize,
    baseServingUnit: draft.baseServingUnit ?? servingUnit,
    gramWeight: draft.gramWeight ?? currentDraftGramWeight(draft),
    gramsPerCup: draft.gramsPerCup,
    isFavorite: false,
    hiddenFromFriends: draft.hiddenFromFriends,
    useCount: 0,
    source: draft.source,
    itemCategory: draft.itemCategory,
    notes: draft.notes.trim() || undefined,
    geminiExplanation: draft.geminiExplanation,
    quantityWasUserAdjusted: draft.quantityWasUserAdjusted ?? false,
    aiEstimatedNutrientKeys: draft.aiEstimatedNutrientKeys,
    nutrientFillSources: draft.nutrientFillSources,
    nutrientFillConfidence: draft.nutrientFillConfidence,
    nutrientErrPct: draft.nutrientErrPct,
    enrichmentMethod: draft.enrichmentMethod,
    enrichmentCitation: draft.enrichmentCitation,
    enrichmentSchemaVersion: draft.enrichmentSchemaVersion,
    portionEstimate: draft.portionEstimate,
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

function currentDraftGramWeight(draft: Draft): number | undefined {
  return currentItemGramWeight({
    ...draft,
    isFavorite: false,
    useCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

function currentItemGramWeight(item: FoodItem): number | undefined {
  const servingSize = Number(item.servingSize)
  if (!Number.isFinite(servingSize) || servingSize <= 0) return undefined
  const converted = convertServingAmount(item, servingSize, item.servingUnit, 'g')
  return converted
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
