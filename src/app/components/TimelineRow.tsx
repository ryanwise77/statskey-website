import { Link } from 'react-router-dom'
import type { Meal, WellnessEntry } from '../lib/types'
import { mealDisplayName, mealTotal } from '../lib/aggregates'
import { NUTRIENT_KEYS } from '../lib/types'
import { formatDuration } from '../lib/format'

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

interface MealRowProps {
  meal: Meal
}

export function MealTimelineRow({ meal }: MealRowProps) {
  const cal = Math.round(mealTotal(meal, NUTRIENT_KEYS.calories))
  const protein = Math.round(mealTotal(meal, NUTRIENT_KEYS.protein))
  const itemCount = meal.items.length

  return (
    <Link to={`/meals/${meal.id}`} className="timeline-row hover:bg-white/[0.02] transition-colors px-3 -mx-3 rounded-md">
      <div className="timeline-time">{formatTime(meal.date)}</div>
      <div className="timeline-content">
        <div className="timeline-title">
          <span className="timeline-badge">Meal</span>
          {mealDisplayName(meal)}
        </div>
        <div className="timeline-subtitle">
          {cal > 0 && <>{cal} cal</>}
          {cal > 0 && protein > 0 && ' · '}
          {protein > 0 && <>{protein}g protein</>}
          {itemCount > 0 && (cal > 0 || protein > 0) && ' · '}
          {itemCount > 0 && <>{itemCount} {itemCount === 1 ? 'item' : 'items'}</>}
        </div>
      </div>
    </Link>
  )
}

interface WellnessRowProps {
  entry: WellnessEntry
}

function wellnessTitle(entry: WellnessEntry): string {
  switch (entry.data.kind) {
    case 'symptom':
      return entry.data.entry.symptom || 'Symptom'
    case 'mood':
      return `Mood ${entry.data.entry.rating}/5`
    case 'energy':
      return `Energy ${entry.data.entry.level}/5`
    case 'bowelMovement':
      return `Gut Check — Type ${entry.data.entry.bristolType}`
    case 'sleep':
      return `Sleep ${entry.data.hours.toFixed(1)}h`
    case 'hydration':
      return `Hydration ${Math.round(entry.data.ozConsumed)} fl oz`
    case 'custom':
      return entry.data.label
  }
}

function wellnessSubtitle(entry: WellnessEntry): string | undefined {
  switch (entry.data.kind) {
    case 'symptom': {
      const parts: string[] = []
      if (entry.data.entry.severity) parts.push(`Severity ${entry.data.entry.severity}/5`)
      if (entry.data.entry.bodyArea) parts.push(entry.data.entry.bodyArea)
      return parts.join(' · ') || entry.notes
    }
    case 'bowelMovement': {
      const e = entry.data.entry
      const parts: string[] = []
      if (e.color) parts.push(e.color)
      if (e.urgency != null) parts.push(`urgency ${e.urgency}`)
      if (e.durationInSeconds != null && e.durationInSeconds > 0) {
        parts.push(formatDuration(e.durationInSeconds))
      }
      return parts.join(' · ') || entry.notes
    }
    case 'mood':
      return entry.data.entry.tags.join(', ') || entry.data.entry.notes
    case 'energy':
      return entry.data.entry.notes
    case 'sleep':
      return `Quality ${entry.data.quality}/5`
    default:
      return entry.notes
  }
}

export function WellnessTimelineRow({ entry }: WellnessRowProps) {
  const sub = wellnessSubtitle(entry)
  return (
    <div className="timeline-row">
      <div className="timeline-time">{formatTime(entry.date)}</div>
      <div className="timeline-content">
        <div className="timeline-title">
          <span className="timeline-badge">Wellness</span>
          {wellnessTitle(entry)}
        </div>
        {sub && <div className="timeline-subtitle">{sub}</div>}
      </div>
    </div>
  )
}
