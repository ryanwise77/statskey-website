import { useMemo } from 'react'
import type { FoodItem } from '../lib/types'
import {
  confidenceColor,
  confidenceLabel,
  confidenceShortLabel,
  deriveTrustMetadata,
  foodTrustSummary,
} from '../lib/provenance'

/**
 * Compact provenance signal for a single food — mirrors the iOS
 * NutrientProvenanceBadge. Surfaces only when it carries information: an
 * estimate is present (source or photo portion), or the value is fully
 * authoritative. Returns null otherwise so the neutral middle stays uncluttered.
 */
export function TrustBadge({ item, className = '' }: { item: FoodItem; className?: string }) {
  const summary = useMemo(() => {
    // Live (pre-save) drafts may not have trust metadata yet; derive it so the
    // photo-portion fallback works the same as a saved record.
    const withTrust = item.trustMetadata ? item : { ...item, trustMetadata: deriveTrustMetadata(item) }
    return foodTrustSummary(withTrust)
  }, [item])

  if (!summary.containsEstimates && !summary.isFullyAuthoritative) return null

  const color = confidenceColor(summary.confidence)

  let label: string
  let title: string
  if (summary.hasPortionEstimate && summary.portionErrorPct != null) {
    label = `± ${Math.round(summary.portionErrorPct)}% portion`
    const range = summary.portionGramRange
    title = range
      ? `Photo-estimated amount: ${Math.round(range.low)}–${Math.round(range.high)} g`
      : 'Amount estimated from a photo'
  } else if (summary.containsEstimates) {
    label = `Estimated · ${confidenceShortLabel(summary.confidence)}`
    title = `Includes estimated values, ${confidenceLabel(summary.confidence)}`
  } else {
    label = 'Authoritative'
    title = `${confidenceLabel(summary.confidence)} from recorded sources`
  }

  return (
    <span
      className={'inline-flex items-center gap-1.5 ' + className}
      style={{ color }}
      title={title}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: color, flexShrink: 0 }}
      />
      {label}
    </span>
  )
}
