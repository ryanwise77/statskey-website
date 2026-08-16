import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDate } from '../firestore'

export interface PlannedMeal {
  id: string
  slot: string
  title: string
  freeformText: string | null
  calories: number
  protein: number
  carbs: number
}

export interface PlannedMealDay {
  id: string
  dateKey: string
  coachNote: string | null
  isIntelligenceDraft: boolean
  meals: PlannedMeal[]
}

export interface ActiveMealPlan {
  id: string
  preset: string
  summary: string
  generatedAt: Date | null
  days: Array<{
    id: string
    dayNumber: number
    dayLabel: string
    coachNote: string | null
    meals: PlannedMeal[]
  }>
}

export interface ActiveTrainingPlan {
  id: string
  summary: string
  startDate: Date
  generatedAt: Date
  durationWeeks: number
  weeks: Array<{
    id: string
    weekNumber: number
    theme: string
    totalMileage: number
    recovery: boolean
    days: Array<{
      id: string
      dayOfWeek: number
      dayName: string
      workoutType: string
      distance: number | null
      duration: string | null
      paceGuidance: string | null
      description: string
      rest: boolean
      completed: boolean
    }>
  }>
}

interface PlanningState<T> {
  value: T
  loading: boolean
  error: string | null
}

export function useMealCalendar(
  uid: string | undefined,
  fromDateKey: string,
  toDateKey: string
): PlanningState<PlannedMealDay[]> {
  const [state, setState] = useState<PlanningState<PlannedMealDay[]>>({
    value: [],
    loading: true,
    error: null,
  })
  useEffect(() => {
    if (!uid) {
      setState({ value: [], loading: false, error: null })
      return
    }
    const calendarQuery = query(
      collection(db, 'users', uid, 'mealCalendar'),
      where('dateKey', '>=', fromDateKey),
      where('dateKey', '<=', toDateKey)
    )
    return onSnapshot(
      calendarQuery,
      (snapshot) =>
        setState({
          value: snapshot.docs
            .map((document) =>
              decodePlannedDay(
                document.data() as Record<string, unknown>,
                document.id
              )
            )
            .sort((left, right) =>
              left.dateKey.localeCompare(right.dateKey)
            ),
          loading: false,
          error: null,
        }),
      (error) =>
        setState({ value: [], loading: false, error: error.message })
    )
  }, [fromDateKey, toDateKey, uid])
  return state
}

export function useActiveMealPlan(
  uid: string | undefined
): PlanningState<ActiveMealPlan | null> {
  const [state, setState] = useState<PlanningState<ActiveMealPlan | null>>({
    value: null,
    loading: true,
    error: null,
  })
  useEffect(() => {
    if (!uid) {
      setState({ value: null, loading: false, error: null })
      return
    }
    const planQuery = query(
      collection(db, 'users', uid, 'mealPlans'),
      where('isActive', '==', true)
    )
    return onSnapshot(
      planQuery,
      (snapshot) => {
        const plans = snapshot.docs
          .map((document) =>
            decodeMealPlan(
              document.data() as Record<string, unknown>,
              document.id
            )
          )
          .sort(
            (left, right) =>
              (right.generatedAt?.getTime() ?? 0) -
              (left.generatedAt?.getTime() ?? 0)
          )
        setState({ value: plans[0] ?? null, loading: false, error: null })
      },
      (error) =>
        setState({ value: null, loading: false, error: error.message })
    )
  }, [uid])
  return state
}

export function useActiveTrainingPlan(
  uid: string | undefined
): PlanningState<ActiveTrainingPlan | null> {
  const [state, setState] = useState<PlanningState<ActiveTrainingPlan | null>>({
    value: null,
    loading: true,
    error: null,
  })
  useEffect(() => {
    if (!uid) {
      setState({ value: null, loading: false, error: null })
      return
    }
    const planQuery = query(
      collection(db, 'users', uid, 'aiTrainingPlans'),
      where('isActive', '==', true)
    )
    return onSnapshot(
      planQuery,
      (snapshot) => {
        const plans = snapshot.docs
          .map((document) =>
            decodeTrainingPlan(
              document.data() as Record<string, unknown>,
              document.id
            )
          )
          .sort(
            (left, right) =>
              right.generatedAt.getTime() - left.generatedAt.getTime()
          )
        setState({ value: plans[0] ?? null, loading: false, error: null })
      },
      (error) =>
        setState({ value: null, loading: false, error: error.message })
    )
  }, [uid])
  return state
}

function decodePlannedDay(
  raw: Record<string, unknown>,
  id: string
): PlannedMealDay {
  return {
    id,
    dateKey: text(raw.dateKey) || id,
    coachNote: optionalText(raw.coachNote),
    isIntelligenceDraft: raw.isAIDraft === true,
    meals: decodeMeals(raw.meals),
  }
}

function decodeMealPlan(
  raw: Record<string, unknown>,
  id: string
): ActiveMealPlan {
  return {
    id,
    preset: text(raw.preset) || 'balanced',
    summary: text(raw.planSummary),
    generatedAt: toDate(raw.generatedAt) ?? null,
    days: array(raw.days).map((item, index) => {
      const day = record(item)
      return {
        id: text(day.id) || `${id}-day-${index + 1}`,
        dayNumber: number(day.dayNumber, index + 1),
        dayLabel: text(day.dayLabel) || `Day ${index + 1}`,
        coachNote: optionalText(day.coachNote),
        meals: decodeMeals(day.meals),
      }
    }),
  }
}

function decodeTrainingPlan(
  raw: Record<string, unknown>,
  id: string
): ActiveTrainingPlan {
  const generatedAt = toDate(raw.generatedAt) ?? new Date()
  return {
    id,
    summary: text(raw.planSummary),
    startDate: toDate(raw.startDate) ?? generatedAt,
    generatedAt,
    durationWeeks: number(raw.durationWeeks, array(raw.weeklyPlan).length),
    weeks: array(raw.weeklyPlan).map((item, weekIndex) => {
      const week = record(item)
      return {
        id: text(week.id) || `${id}-week-${weekIndex + 1}`,
        weekNumber: number(week.weekNumber, weekIndex + 1),
        theme: text(week.theme),
        totalMileage: number(week.totalMileage, 0),
        recovery: week.isRecoveryWeek === true,
        days: array(week.days).map((dayItem, dayIndex) => {
          const day = record(dayItem)
          return {
            id:
              text(day.id) ||
              `${id}-week-${weekIndex + 1}-day-${dayIndex + 1}`,
            dayOfWeek: number(day.dayOfWeek, dayIndex + 1),
            dayName: text(day.dayName) || weekday(dayIndex),
            workoutType: text(day.workoutType) || 'Fitness',
            distance:
              typeof day.distance === 'number' ? day.distance : null,
            duration: optionalText(day.duration),
            paceGuidance: optionalText(day.paceGuidance),
            description: text(day.description),
            rest: day.isRestDay === true,
            completed: day.isCompleted === true,
          }
        }),
      }
    }),
  }
}

function decodeMeals(value: unknown): PlannedMeal[] {
  return array(value).map((item, index) => {
    const meal = record(item)
    const items = array(meal.items).map(record)
    return {
      id: text(meal.id) || `meal-${index + 1}`,
      slot: text(meal.slot) || 'Meal',
      title:
        text(meal.title) ||
        optionalText(meal.freeformText) ||
        `Planned meal ${index + 1}`,
      freeformText: optionalText(meal.freeformText),
      calories: sumNutrient(items, ['calories']),
      protein: sumNutrient(items, ['protein']),
      carbs: sumNutrient(items, ['carbohydrates', 'carbs']),
    }
  })
}

function sumNutrient(
  items: Array<Record<string, unknown>>,
  keys: string[]
): number {
  return items.reduce((total, item) => {
    const nutrients = record(item.nutrients)
    const value = [...keys.map((key) => nutrients[key]), ...keys.map((key) => item[key])]
      .find((candidate) => typeof candidate === 'number' && Number.isFinite(candidate))
    return total + (typeof value === 'number' ? value : 0)
  }, 0)
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | null {
  const valueText = text(value)
  return valueText || null
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
}

function weekday(index: number): string {
  return [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ][index] ?? `Day ${index + 1}`
}
