import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'
import { newId } from '../writers'
import type { FoodItem, FoodSource, ItemCategory } from '../types'

const functions = getFunctions(firebaseApp, 'us-central1')

interface GeminiNutritionRequest {
  query: string
  images?: string[]
  packagingText?: string
  preferToolSearch?: boolean
  searchQuery?: string
}

interface GeminiNutritionResponse {
  success: boolean
  content: string
  resultsCount?: number
}

interface GeminiFood {
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
  product?: {
    name?: string
    brand?: string
    variant?: string
  }
  serving?: {
    amount?: number
    unit?: string
    grams?: number
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
  'geminiNutrition'
)

export async function analyzeNutritionInput(
  req: GeminiNutritionRequest,
  source: FoodSource,
  itemCategory: ItemCategory = 'food'
): Promise<FoodItem[]> {
  const { data } = await callGeminiNutrition(req)
  if (!data.success) throw new Error('Nutrition analysis failed.')
  return parseGeminiFoods(data.content).map((food) => toFoodItem(food, source, itemCategory))
}

export async function filesToBase64(files: File[]): Promise<string[]> {
  return Promise.all(files.map(fileToBase64))
}

function parseGeminiFoods(content: string): GeminiFood[] {
  const cleaned = content
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  const parsed = parseFirstJsonValue(cleaned)
  const foods = unwrapFoodArray(parsed)
  if (foods.length === 0) throw new Error('Gemini returned no nutrition items.')
  return foods
}

function toFoodItem(food: GeminiFood, source: FoodSource, itemCategory: ItemCategory): FoodItem {
  const now = new Date()
  const nutrients = cleanNutrients(food.nutrients)
  const serving = food.serving
  const servingSize = asNumber(food.servingSize) ?? asNumber(serving?.amount) ?? 1
  const servingUnit = food.servingUnit || serving?.unit || 'serving'
  const gramWeight = asNumber(food.gramWeight) ?? asNumber(serving?.grams)
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

  return {
    id: newId(),
    name: name || 'Analyzed item',
    brand,
    servingSize,
    servingUnit,
    nutrients,
    baseNutrients: nutrients,
    baseServingSize: servingSize,
    baseServingUnit: servingUnit,
    gramWeight,
    gramsPerCup: asNumber(food.gramsPerCup),
    isFavorite: false,
    useCount: 0,
    source,
    itemCategory,
    notes: food.notes,
    geminiExplanation: explanation,
    createdAt: now,
    updatedAt: now,
  }
}

function cleanNutrients(input: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    const n = asNumber(value)
    if (n != null) out[normalizeNutrientKey(key)] = n
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

function fileToBase64(file: File): Promise<string> {
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
