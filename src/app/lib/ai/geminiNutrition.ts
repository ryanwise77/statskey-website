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
  brand?: string
  servingSize?: number
  servingUnit?: string
  gramWeight?: number
  gramsPerCup?: number
  nutrients?: Record<string, number>
  geminiExplanation?: string
  notes?: string
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

  const parsed = JSON.parse(cleaned) as unknown
  if (!Array.isArray(parsed)) throw new Error('Gemini returned an unexpected nutrition format.')
  return parsed.filter((item): item is GeminiFood => item != null && typeof item === 'object')
}

function toFoodItem(food: GeminiFood, source: FoodSource, itemCategory: ItemCategory): FoodItem {
  const now = new Date()
  const nutrients = cleanNutrients(food.nutrients)
  return {
    id: newId(),
    name: food.name?.trim() || 'Analyzed item',
    brand: food.brand?.trim() || undefined,
    servingSize: food.servingSize ?? 1,
    servingUnit: food.servingUnit || 'serving',
    nutrients,
    baseNutrients: nutrients,
    baseServingSize: food.servingSize ?? 1,
    baseServingUnit: food.servingUnit || 'serving',
    gramWeight: food.gramWeight,
    gramsPerCup: food.gramsPerCup,
    isFavorite: false,
    useCount: 0,
    source,
    itemCategory,
    notes: food.notes,
    geminiExplanation: food.geminiExplanation,
    createdAt: now,
    updatedAt: now,
  }
}

function cleanNutrients(input: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
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
