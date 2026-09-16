import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, firebaseApp } from '../firebase'
import { nutritionCapturePrompt } from './nutritionCapture'
import { applySourceNutrition, canonicalServingUnit, sourceNutritionRequest } from './nutritionSourceCompletion'
import { newId } from '../writers'
import type { FoodItem, FoodSource, ItemCategory, PortionEstimate } from '../types'

const functions = getFunctions(firebaseApp, 'us-central1')

interface GeminiNutritionRequest {
  query: string
  images?: string[]
  packagingText?: string
  preferToolSearch?: boolean
  searchQuery?: string
  model?: string
  nativeContext?: { version: number; prompt: string }
}

// Match the iOS app's fast vision/enrichment model. The old server default
// (gemini-2.5-pro) was slow enough on photos to blow the callable deadline.
const NUTRITION_MODEL = 'gemini-3.1-flash-lite'

// Photo analysis can take 30-60s; the Firebase callable default (70s) is what
// surfaced as `deadline-exceeded`. Give it real headroom (function caps at 180s).
const CALLABLE_TIMEOUT_MS = 120_000

interface GeminiNutritionResponse {
  success: boolean
  content: string
  resultsCount?: number
}

interface GeminiFood {
  [key: string]: unknown
  name?: string
  productName?: string
  foodName?: string
  title?: string
  description?: string
  brand?: string
  servingSize?: number
  servingUnit?: string
  gramWeight?: number
  gramsPerCup?: number
  // Independent gram drafts the vision model considered before choosing the
  // final amount — the spread is a portion confidence interval. Mirrors the
  // iOS `portionDraftGrams` field (GeminiService.swift) so the same photo
  // portion uncertainty surfaces on the web.
  portionDraftGrams?: unknown
  product?: {
    name?: string
    brand?: string
    variant?: string
  }
  serving?: {
    amount?: number
    unit?: string
    grams?: number
    lowGram?: number
    highGram?: number
    portionDraftGrams?: unknown
  }
  nutrients?: Record<string, unknown>
  dataQuality?: {
    notes?: string
  }
  geminiExplanation?: string
  notes?: string
}

const FOOD_ARRAY_KEYS = [
  'items',
  'foods',
  'results',
  'products',
  'searchResults',
  'search_results',
  'matches',
  'list',
  'response',
  'data',
]

const NUTRIENT_KEY_ALIASES: Record<string, string> = {
  calories: 'calories',
  kcal: 'calories',
  energy: 'calories',
  protein: 'protein',
  carbohydrates: 'carbohydrates',
  carbohydrate: 'carbohydrates',
  totalcarbohydrate: 'carbohydrates',
  totalcarbohydrates: 'carbohydrates',
  carbs: 'carbohydrates',
  totalfat: 'total_fat',
  fat: 'total_fat',
  dietaryfiber: 'dietary_fiber',
  fiber: 'dietary_fiber',
  totalsugars: 'total_sugars',
  sugars: 'total_sugars',
  addedsugars: 'added_sugars',
  sugaralcohols: 'sugar_alcohols',
  saturatedfat: 'saturated_fat',
  transfat: 'trans_fat',
  monounsaturatedfat: 'monounsaturated_fat',
  polyunsaturatedfat: 'polyunsaturated_fat',
  cholesterol: 'cholesterol',
  sodium: 'sodium',
  potassium: 'potassium',
  calcium: 'calcium',
  iron: 'iron',
  magnesium: 'magnesium',
  phosphorus: 'phosphorus',
  zinc: 'zinc',
  copper: 'copper',
  manganese: 'manganese',
  selenium: 'selenium',
  chromium: 'chromium',
  molybdenum: 'molybdenum',
  iodine: 'iodine',
  fluoride: 'fluoride',
  vitamina: 'vitamin_a',
  vitaminc: 'vitamin_c',
  vitamind: 'vitamin_d',
  vitamine: 'vitamin_e',
  vitamink: 'vitamin_k',
  vitaminb1: 'vitamin_b1',
  vitaminb2: 'vitamin_b2',
  vitaminb3: 'vitamin_b3',
  vitaminb5: 'vitamin_b5',
  vitaminb6: 'vitamin_b6',
  vitaminb7: 'vitamin_b7',
  vitaminb9: 'vitamin_b9',
  vitaminb12: 'vitamin_b12',
  caffeine: 'caffeine',
}

const callGeminiNutrition = httpsCallable<GeminiNutritionRequest, GeminiNutritionResponse>(
  functions,
  'geminiNutrition',
  { timeout: CALLABLE_TIMEOUT_MS }
)

const callWebEnrichFood = httpsCallable<{ food: Record<string, unknown> }, unknown>(
  functions, 'webEnrichFood', { timeout: 45_000 }
)

export function buildNutritionRecognitionRequest(req: GeminiNutritionRequest): GeminiNutritionRequest {
  return { model: NUTRITION_MODEL, ...req, nativeContext: { version: 1, prompt: nutritionCapturePrompt(req.query) } }
}

export async function analyzeNutritionInput(
  req: GeminiNutritionRequest,
  source: FoodSource,
  itemCategory: ItemCategory = 'food'
): Promise<FoodItem[]> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Sign in to analyze food.')
  const { data } = await callGeminiNutrition(buildNutritionRecognitionRequest(req))
  if (auth.currentUser?.uid !== uid) throw new Error('Your account changed. Please try again.')
  if (!data.success) throw new Error('Nutrition analysis failed.')
  const recognized = parseGeminiFoods(data.content).map((food) => {
    let item = toFoodItem(food, source, itemCategory)
    const barcode = source === 'barcode' ? req.query.match(/^Barcode\s+(\d{8,14})$/i)?.[1] : undefined
    if (barcode) item = { ...item, barcode }
    if (!req.images?.length && (item.brand || item.barcode) && !item.quantityWasUserAdjusted &&
        !item.printedLabel && !item.photoPackageQuantityContext) {
      item = { ...item, servingSize: 1, servingUnit: 'serving', gramWeight: undefined,
        baseServingSize: 1, baseServingUnit: 'serving', quantityBasis: 'model_default' }
    }
    return item
  })
  const completed = await Promise.all(recognized.map(async item => {
    try {
      const response = await callWebEnrichFood(sourceNutritionRequest(item))
      return applySourceNutrition(item, response.data)
    } catch {
      // Keep the observed item available for review/save. The saved-meal
      // source worker can complete it without inventing a calorie value.
      return { ...item, nutritionSourceCompletion: 'unavailable' }
    }
  }))
  if (auth.currentUser?.uid !== uid) throw new Error('Your account changed. Please try again.')
  return completed
}

export async function filesToBase64(files: File[]): Promise<string[]> {
  return Promise.all(files.map(fileToBase64))
}

export function parseGeminiFoods(content: string): GeminiFood[] {
  const cleaned = content
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  const parsed = parseFirstJsonValue(cleaned)
  const foods = unwrapFoodArray(parsed)
  if (foods.length === 0) throw new Error('Gemini returned no nutrition items.')
  return foods
}

export function toFoodItem(food: GeminiFood, source: FoodSource, itemCategory: ItemCategory): FoodItem {
  const now = new Date()
  const nutrients: Record<string, number> = {}
  const serving = food.serving
  const packageServing = food.consumedQuantityBasis === 'single_serving_package'
    ? readPrintedPackageServing(food.packageNetVolumeText, food.packageNetMassText) : undefined
  const servingSize = packageServing?.size ?? positive(food.servingSize) ?? positive(serving?.amount) ?? 1
  const servingUnit = packageServing?.unit ?? canonicalServingUnit(food.servingUnit || serving?.unit || 'serving')
  const isPackage = food.consumedQuantityBasis === 'single_serving_package' ||
    typeof food.packageNetVolumeText === 'string' || typeof food.packageNetMassText === 'string'
  const massFactors: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 }
  const printedMass = food.consumedQuantityBasis === 'single_serving_package'
    ? readPrintedPackageServing(undefined, food.packageNetMassText) : undefined
  const nestedMatches = positive(serving?.amount) === servingSize &&
    typeof serving?.unit === 'string' && canonicalServingUnit(serving.unit) === servingUnit
  // A flat amount and a nested mass cannot be joined across two portions.
  // Packaged quantities use literal mass evidence; generated beverage density
  // or a label-serving mass cannot stand in for the entire package.
  const gramWeight = isPackage
    ? massFactors[servingUnit] ? servingSize * massFactors[servingUnit]
      : printedMass && massFactors[printedMass.unit] ? printedMass.size * massFactors[printedMass.unit] : undefined
    : positive(food.gramWeight) ?? (nestedMatches ? positive(serving?.grams) : undefined)
  const labelValues = cleanNutrients(isRecord(food.visibleLabelNutrition) ? food.visibleLabelNutrition : undefined)
  const basis = food.visibleLabelNutritionBasis
  const printedLabel = Object.keys(labelValues).length && (basis === 'per_serving' || basis === 'per_container')
    ? { nutrients: labelValues, nutrientKeys: Object.keys(labelValues), basis,
      ...defined({ servingSize: positive(food.labelServingSize), servingUnit: food.labelServingUnit,
        servingGramWeight: positive(food.labelServingGramWeight), servingVolumeMl: positive(food.labelServingVolumeMl),
        packageNetWeightGrams: positive(food.packageNetWeightGrams),
        ingredientStatement: food.visibleIngredientStatement, productClaims: food.visibleProductClaims,
        dailyValues: food.visibleLabelDailyValues, dailyValueReference: food.visibleLabelDailyValueReference,
        consumedQuantityBasis: food.consumedQuantityBasis }) } : undefined
  const claims = Array.isArray(food.visibleProductClaims) ? food.visibleProductClaims
    .filter((value): value is string => typeof value === 'string' && value.length <= 200).slice(0, 30) : []
  const preparation = claims.some(claim => /^(?:non[-\s]?pasteuri[sz]ed|unpasteuri[sz]ed)$/i.test(claim.trim())) ? 'raw' : undefined
  const ingredients = typeof food.visibleIngredientStatement === 'string' ? food.visibleIngredientStatement.trim().slice(0, 5000) : undefined
  const name = firstText(
    food.name,
    food.product?.name,
    food.productName,
    food.foodName,
    food.title,
    food.description
  )
  const brand = firstText(food.brand, food.product?.brand)
  const explanation = firstText(food.geminiExplanation, food.dataQuality?.notes)
  const portionEstimate = buildPortionEstimate(
    food.portionDraftGrams ?? food.serving?.portionDraftGrams,
    asNumber(food.serving?.lowGram),
    asNumber(food.serving?.highGram)
  )

  // Only the photographed column can populate recognition nutrition, and
  // only when its physical serving relation is known. Lookup guesses are ignored.
  if (printedLabel) {
    const labelAmount = positive(food.labelServingSize)
    const labelUnit = typeof food.labelServingUnit === 'string' ? canonicalServingUnit(food.labelServingUnit) : ''
    const factor = basis === 'per_container' && food.consumedQuantityBasis === 'single_serving_package' ? 1
      : basis === 'per_serving' && labelAmount && labelUnit === servingUnit ? servingSize / labelAmount : undefined
    if (factor != null) for (const [key, value] of Object.entries(labelValues)) nutrients[key] = value * factor
  }
  const printedKeys = Object.keys(nutrients)
  return {
    id: newId(),
    name: name || 'Analyzed item',
    brand,
    servingSize,
    servingUnit,
    nutrients,
    baseNutrients: { ...nutrients },
    nutrientFillSources: Object.fromEntries(printedKeys.map(key => [key, 'product_claim'])),
    nutrientProvenance: Object.fromEntries(printedKeys.map(key => [key, 'label_declared'])),
    nutrientCitations: Object.fromEntries(printedKeys.map(key => [key, 'Printed Nutrition Facts panel (photographed)'])),
    explicitZeroNutrientKeys: printedKeys.filter(key => nutrients[key] === 0),
    baseServingSize: servingSize,
    baseServingUnit: servingUnit,
    gramWeight,
    // A generated density must never convert photographed fluid ounces to mass.
    printedLabel,
    enrichmentIngredients: ingredients || undefined,
    visibleProductClaims: claims,
    preparation,
    photoPackageQuantityContext: food.consumedQuantityBasis === 'single_serving_package' ? 'single_serving_package' : undefined,
    photoPackageObservations: isPackage ? defined({
      packageNetVolumeText: food.packageNetVolumeText, packageNetVolumeMl: positive(food.packageNetVolumeMl),
      packageNetMassText: food.packageNetMassText, packageNetWeightGrams: positive(food.packageNetWeightGrams),
      consumedQuantityBasis: food.consumedQuantityBasis,
    }) : undefined,
    quantityBasis: food.quantityBasis,
    sourceServingContractVersion: 1,
    nutritionSourceCompletion: 'pending',
    isFavorite: false,
    useCount: 0,
    source,
    itemCategory,
    notes: food.notes,
    geminiExplanation: explanation,
    quantityWasUserAdjusted: food.consumedQuantityBasis === 'user_explicit',
    portionEstimate,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Builds a PortionEstimate from the model's independent gram drafts (and any
 * explicit low/high bounds). Matches the iOS parse in GeminiService.swift —
 * keep any positive, finite drafts; the trust model derives the ± range from
 * their spread. Returns undefined when there's nothing usable.
 */
function buildPortionEstimate(
  rawDrafts: unknown,
  lowGram: number | undefined,
  highGram: number | undefined
): PortionEstimate | undefined {
  const drafts = Array.isArray(rawDrafts)
    ? rawDrafts.map(asNumber).filter((g): g is number => g != null && g > 0)
    : []
  const estimate: PortionEstimate = {}
  if (drafts.length) estimate.draftGrams = drafts
  if (lowGram != null && lowGram > 0) estimate.lowGram = lowGram
  if (highGram != null && highGram > 0) estimate.highGram = highGram
  if (!estimate.draftGrams && estimate.lowGram == null && estimate.highGram == null) {
    return undefined
  }
  return estimate
}

/** Literal printed NET text is an observed package size, not an inferred density. */
export function readPrintedPackageServing(volume: unknown, mass: unknown): { size: number; unit: string } | undefined {
  for (const [text, pattern] of [
    [volume, /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|fluid ounces?|ml|milliliters?|l|liters?)\b/i],
    [mass, /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(kg|g|grams?|oz\.?|ounces?|lb|pounds?)\b/i],
  ] as const) {
    if (typeof text !== 'string') continue
    const match = text.match(pattern)
    if (match && Number(match[1]) > 0) return { size: Number(match[1]), unit: canonicalServingUnit(match[2]) }
  }
  return undefined
}

function positive(value: unknown): number | undefined {
  const n = asNumber(value)
  return n != null && n > 0 ? n : undefined
}
function defined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, value]) => value != null))
}

function cleanNutrients(input: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    const n = asNumber(value)
    if (n != null && n >= 0) out[normalizeNutrientKey(key)] = n
  }
  return out
}

function parseFirstJsonValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const extracted = extractFirstBalancedJsonValue(text)
    if (!extracted) throw new Error('Gemini returned an unexpected nutrition format.')
    return JSON.parse(extracted) as unknown
  }
}

function unwrapFoodArray(parsed: unknown): GeminiFood[] {
  if (Array.isArray(parsed)) return parsed.filter(isGeminiFood)
  if (!isRecord(parsed)) throw new Error('Gemini returned an unexpected nutrition format.')

  for (const key of FOOD_ARRAY_KEYS) {
    const value = parsed[key]
    if (Array.isArray(value)) return value.filter(isGeminiFood)
  }

  return isGeminiFood(parsed) ? [parsed] : []
}

function isGeminiFood(value: unknown): value is GeminiFood {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined

  const normalized = value.replace(/,/g, '').trim()
  const exact = Number(normalized)
  if (Number.isFinite(exact)) return exact

  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  if (!match) return undefined
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function normalizeNutrientKey(key: string): string {
  const compact = key.replace(/[\s_-]/g, '').toLowerCase()
  const aliased = NUTRIENT_KEY_ALIASES[compact]
  if (aliased) return aliased
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase()
}

function extractFirstBalancedJsonValue(text: string): string | undefined {
  for (let start = 0; start < text.length; start += 1) {
    const opener = text[start]
    if (opener !== '{' && opener !== '[') continue

    const closer = opener === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (inString) {
        if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === opener) depth += 1
      else if (ch === closer) {
        depth -= 1
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
  }
  return undefined
}

// Downscale + JPEG-compress before upload, like the iOS app. A raw phone photo
// is several MB; sending it full-resolution dominated the analyze time (the
// model itself returns in a couple of seconds). 1280px is plenty for food
// recognition and portion/reference-object scale.
const MAX_IMAGE_DIM = 1280
const IMAGE_JPEG_QUALITY = 0.72

async function fileToBase64(file: File): Promise<string> {
  try {
    return await downscaleToJpegBase64(file, MAX_IMAGE_DIM, IMAGE_JPEG_QUALITY)
  } catch {
    // HEIC or canvas-unavailable: fall back to the raw bytes so analysis still works.
    return await readRawBase64(file)
  }
}

async function downscaleToJpegBase64(file: File, maxDim: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > maxDim ? maxDim / longest : 1
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const comma = dataUrl.indexOf(',')
    if (comma === -1 || !dataUrl.startsWith('data:image/jpeg')) {
      throw new Error('JPEG encoding failed')
    }
    return dataUrl.slice(comma + 1)
  } finally {
    bitmap.close()
  }
}

function readRawBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error(`Could not read ${file.name}.`))
        return
      }
      resolve(result.replace(/^data:[^;]+;base64,/, ''))
    }
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}
