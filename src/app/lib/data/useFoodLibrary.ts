import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, Timestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import { decodeFoodItem, decodeMeal } from '../decoders'
import type { FoodItem, Meal } from '../types'

export interface FoodLibraryState {
  /** Merged foods (saved library + items extracted from recent meals), de-duped by lowercased name. */
  items: FoodItem[]
  /** Recent meals (last 30 days) — used for the Meals tab and for extracting foods. */
  meals: Meal[]
  /** Foods that exist in the dedicated `foodLibrary` collection (the "saved" subset). */
  savedItems: FoodItem[]
  loading: boolean
  error: string | null
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Mirrors LibraryView in biometrics/StatsKey/Views/Library/LibraryView.swift.
 *
 * iOS shows:
 * - users/{uid}/foodLibrary  (explicitly saved foods)
 * - foods extracted from users/{uid}/meals in the last 30 days
 * Both lists are merged by lowercased food name, then sorted by lastUsed desc.
 *
 * NOTE: we deliberately don't use Firestore's orderBy('lastUsed') here because
 * older library docs may not have that field set, which would silently exclude
 * them from the result. We sort client-side instead.
 */
export function useFoodLibrary(uid: string | undefined): FoodLibraryState {
  const [savedItems, setSavedItems] = useState<FoodItem[]>([])
  const [savedError, setSavedError] = useState<string | null>(null)
  const [savedLoading, setSavedLoading] = useState(true)

  const [meals, setMeals] = useState<Meal[]>([])
  const [mealsError, setMealsError] = useState<string | null>(null)
  const [mealsLoading, setMealsLoading] = useState(true)

  useEffect(() => {
    if (!uid) {
      setSavedItems([])
      setSavedError(null)
      setSavedLoading(false)
      setMeals([])
      setMealsError(null)
      setMealsLoading(false)
      return
    }

    setSavedLoading(true)
    setMealsLoading(true)
    setSavedError(null)
    setMealsError(null)

    const unsubSaved = onSnapshot(
      collection(db, 'users', uid, 'foodLibrary'),
      (snap) => {
        const items = snap.docs.map((d) =>
          decodeFoodItem(d.data() as Record<string, unknown>, d.id)
        )
        setSavedItems(items)
        setSavedLoading(false)
      },
      (err) => {
        setSavedError(err.message)
        setSavedLoading(false)
      }
    )

    const since = new Date(Date.now() - THIRTY_DAYS_MS)
    const mealsQuery = query(
      collection(db, 'users', uid, 'meals'),
      where('date', '>=', Timestamp.fromDate(since))
    )
    const unsubMeals = onSnapshot(
      mealsQuery,
      (snap) => {
        const decoded = snap.docs.map((d) =>
          decodeMeal(d.data() as Record<string, unknown>, d.id)
        )
        decoded.sort((a, b) => b.date.getTime() - a.date.getTime())
        setMeals(decoded)
        setMealsLoading(false)
      },
      (err) => {
        setMealsError(err.message)
        setMealsLoading(false)
      }
    )

    return () => {
      unsubSaved()
      unsubMeals()
    }
  }, [uid])

  const items = useMemo(() => mergeFoods(savedItems, meals), [savedItems, meals])

  return {
    items,
    meals,
    savedItems,
    loading: savedLoading || mealsLoading,
    error: savedError ?? mealsError,
  }
}

/**
 * Mirrors LibraryView.mergedFoods + extractUniqueFoods. Each unique food is
 * keyed by lowercased name; useCount/lastUsed take the max of the two sources.
 */
function mergeFoods(savedFoods: FoodItem[], meals: Meal[]): FoodItem[] {
  const byName = new Map<string, FoodItem>()
  for (const food of savedFoods) {
    byName.set(food.name.toLowerCase(), food)
  }

  for (const meal of meals) {
    for (const item of meal.items) {
      const key = item.name.toLowerCase()
      const existing = byName.get(key)
      if (existing) {
        const existingLast = existing.lastUsed?.getTime() ?? 0
        const mealLast = meal.date.getTime()
        byName.set(key, {
          ...existing,
          useCount: Math.max(existing.useCount, (existing.useCount ?? 0) + 1),
          lastUsed: mealLast > existingLast ? meal.date : existing.lastUsed,
        })
      } else {
        byName.set(key, {
          ...item,
          useCount: 1,
          lastUsed: meal.date,
        })
      }
    }
  }

  return Array.from(byName.values()).sort(
    (a, b) => (b.lastUsed?.getTime() ?? 0) - (a.lastUsed?.getTime() ?? 0)
  )
}
