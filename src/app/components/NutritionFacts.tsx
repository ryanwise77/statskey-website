// Full nutrition view for a recorded meal — web mirror of
// biometrics/StatsKey/Views/Record/NutritionFactsView.swift. Renders the
// FDA-style facts label (standard rows + every other nutrient the meal
// actually contains, grouped by category with %DV), an item picker so the
// label can be read per food, per-row accuracy markers with the same
// sources-and-confidence drill-down Insights shows on iOS (Pro+), and the
// macro-percentage summary.

import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useSubscription } from '../lib/data/useSubscription'
import type { Meal } from '../lib/types'
import { mealDisplayName } from '../lib/aggregates'
import {
  NUTRIENT_CATEGORIES,
  labelRdi,
  nutrientById,
  nutrientsInCategory,
  type NutrientDefinition,
} from '../lib/nutrients'
import { macroPercentages, mealAllNutrients, verifyCalories } from '../lib/nutritionFacts'
import {
  allProvenanceSummaries,
  contributionHasPortionEstimate,
  summaryBadge,
  summaryDoubtContributions,
  summaryIsFullyAuthoritative,
  type BadgeIconKind,
  type NutrientContribution,
  type NutrientProvenanceSummary,
} from '../lib/provenanceAggregator'
import {
  confidenceColor,
  confidenceLabel,
  confidenceRank,
  confidenceShortLabel,
  sourceDisplayName,
  sourceIsFilledByStatsKey,
} from '../lib/provenance'

/** Mirrors CreditService.unlimitedUIDs — internal accounts that carry every
 *  Pro+ capability, including per-nutrient accuracy markers. */
const UNLIMITED_UIDS = new Set(['PrY2H241HfP5X1MH4sKhQrxgENQ2'])

/** Nutrient ids already rendered in the standard FDA rows. */
const STANDARD_IDS = new Set([
  'calories',
  'total_fat',
  'saturated_fat',
  'trans_fat',
  'cholesterol',
  'sodium',
  'carbohydrates',
  'dietary_fiber',
  'total_sugars',
  'protein',
  'vitamin_d',
  'calcium',
  'iron',
  'potassium',
])

// iOS SKTheme macro colors (dark variants).
const PROTEIN_COLOR = '#90CAF9'
const CARB_COLOR = '#A5D6A7'
const FAT_COLOR = '#CE93D8'
const WARNING_COLOR = '#ffce6b'
const TEAL_COLOR = '#30d5c8'
const INFO_COLOR = '#6e8eff'

type Summaries = Record<string, NutrientProvenanceSummary>

interface ProvenanceSelection {
  definition: NutrientDefinition
  summary: NutrientProvenanceSummary
}

const trunc = (v: number | undefined) => Math.trunc(v ?? 0)
const onePlace = (v: number) => v.toFixed(1)

/** Value formatting used by the drill-down (NutrientProvenanceDetailView.fmt). */
function fmt(v: number): string {
  if (v >= 100) return String(Math.round(v))
  if (v >= 10) return v.toFixed(0)
  if (v >= 1) return v.toFixed(1)
  return v.toFixed(2)
}

// MARK: - Panel

export function NutritionFactsPanel({ meal }: { meal: Meal }) {
  const { user } = useAuth()
  const { subscription } = useSubscription(user?.uid)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedProvenance, setSelectedProvenance] = useState<ProvenanceSelection | null>(null)

  const selectedItem = selectedItemId ? meal.items.find((i) => i.id === selectedItemId) : undefined

  // The whole meal, or the selected item wrapped in a one-item meal that keeps
  // the parent multiplier so values match that item's contribution to the total.
  const displayMeal: Meal = selectedItem
    ? {
        ...meal,
        name: selectedItem.name,
        items: [selectedItem],
        totalNutrientsOverride: undefined,
        hiddenItemCount: 0,
      }
    : meal

  // The per-nutrient accuracy evaluation is a Pro+ feature, mirroring the
  // Pro+ gates used on iOS. Suppressed when totals come from a meal-level
  // override (e.g. a friend's meal with hidden items).
  const plan = subscription?.raw['subscriptionPlan']
  const showsAccuracy = plan === 'proPlus' || (user != null && UNLIMITED_UIDS.has(user.uid))
  const summaries: Summaries =
    showsAccuracy && displayMeal.totalNutrientsOverride == null ? allProvenanceSummaries([displayMeal]) : {}

  const nutrients = mealAllNutrients(displayMeal)
  const pcts = macroPercentages(
    nutrients['protein'] ?? 0,
    nutrients['carbohydrates'] ?? 0,
    nutrients['total_fat'] ?? 0
  )
  const calculatedCal = verifyCalories(
    nutrients['protein'] ?? 0,
    nutrients['carbohydrates'] ?? 0,
    nutrients['total_fat'] ?? 0
  )

  return (
    <div className="space-y-3">
      {meal.items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <ItemChip label="Total" selected={selectedItemId == null} onClick={() => setSelectedItemId(null)} />
          {meal.items.map((item, idx) => (
            <ItemChip
              key={item.id || idx}
              label={item.name || 'Unnamed food'}
              selected={selectedItemId === item.id}
              onClick={() => setSelectedItemId(item.id)}
            />
          ))}
        </div>
      )}

      <FactsLabel
        meal={displayMeal}
        nutrients={nutrients}
        summaries={summaries}
        onSelect={(definition, summary) => setSelectedProvenance({ definition, summary })}
      />

      <div className="panel">
        <span className="card-title">Summary</span>
        <div className="mt-3 flex gap-8">
          <MacroPercentPill label="Protein" pct={pcts.protein} color={PROTEIN_COLOR} />
          <MacroPercentPill label="Carbs" pct={pcts.carbs} color={CARB_COLOR} />
          <MacroPercentPill label="Fat" pct={pcts.fat} color={FAT_COLOR} />
        </div>
        <p className="text-text-secondary text-[12px] mt-3">Calculated: {trunc(calculatedCal)} cal</p>
      </div>

      {selectedProvenance && (
        <ProvenanceDetailModal
          definition={selectedProvenance.definition}
          summary={selectedProvenance.summary}
          mealScopeLabel={mealDisplayName(displayMeal)}
          onClose={() => setSelectedProvenance(null)}
        />
      )}
    </div>
  )
}

function ItemChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 max-w-[180px] truncate rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
        selected
          ? 'bg-data text-black'
          : 'bg-white/[0.045] text-text-primary border border-white/10 hover:bg-white/[0.08]'
      }`}
    >
      {label}
    </button>
  )
}

function MacroPercentPill({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-[18px] font-bold" style={{ color }}>
        {trunc(pct)}%
      </div>
      <div className="card-subtext mt-0.5">{label}</div>
    </div>
  )
}

// MARK: - FDA-style label

function FactsLabel({
  meal,
  nutrients,
  summaries,
  onSelect,
}: {
  meal: Meal
  nutrients: Record<string, number>
  summaries: Summaries
  onSelect: (definition: NutrientDefinition, summary: NutrientProvenanceSummary) => void
}) {
  const dvPercent = (id: string): number | null => {
    const value = nutrients[id]
    const def = nutrientById(id)
    const rdi = def ? labelRdi(def) : undefined
    if (value == null || rdi == null || rdi <= 0) return null
    return trunc((value / rdi) * 100)
  }

  const servingText =
    meal.items.length > 1
      ? `${meal.items.length} items`
      : `${meal.items[0] ? onePlace(meal.items[0].servingSize) : '1'} ${meal.items[0]?.servingUnit ?? 'serving'}`

  // Remaining nutrients grouped into stable families: only nutrients the meal
  // actually contains, never repeating the standard FDA rows.
  const additionalGroups = NUTRIENT_CATEGORIES.map((category) => ({
    category,
    nutrients: nutrientsInCategory(category).filter(
      (d) => (nutrients[d.id] ?? 0) > 0 && !STANDARD_IDS.has(d.id)
    ),
  })).filter((g) => g.nutrients.length > 0)

  const showsLegend = Object.values(summaries).some((s) => summaryBadge(s).showsIndicator)

  const rowSelect = (id: string | undefined) => {
    if (!id) return undefined
    const summary = summaries[id]
    const definition = nutrientById(id)
    if (!summary || !definition) return undefined
    return () => onSelect(definition, summary)
  }

  const marker = (id: string | undefined): ReactNode => {
    if (!id) return null
    const summary = summaries[id]
    if (!summary) return null
    const badge = summaryBadge(summary)
    if (!badge.showsIndicator) return null
    return (
      <span title={badge.accessibilityText} className="inline-flex items-center">
        <BadgeIcon kind={badge.icon} color={badge.color} />
      </span>
    )
  }

  const clickable = (id: string | undefined, content: ReactNode, key?: string): ReactNode => {
    const handler = rowSelect(id)
    if (!handler) {
      return (
        <div key={key} className="w-full">
          {content}
        </div>
      )
    }
    return (
      <div
        key={key}
        role="button"
        tabIndex={0}
        onClick={handler}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handler()
        }}
        className="w-full cursor-pointer rounded hover:bg-white/[0.03] transition-colors"
      >
        {content}
      </div>
    )
  }

  const nutrientRow = (name: string, valueText: string, dv: number | null, id?: string) =>
    clickable(
      id,
      <div className="border-t border-white/10">
        <div className="flex items-center gap-1.5 py-1 text-[13px]">
          <span className="font-bold">{name}</span>
          <span>{valueText}</span>
          {marker(id)}
          <span className="flex-1" />
          {dv != null && <span className="font-bold">{dv}%</span>}
        </div>
      </div>,
      `row-${name}`
    )

  const indentedRow = (name: string, value: number | undefined, unit: string, dvId?: string, id?: string) =>
    clickable(
      id,
      <div className="border-t border-white/10">
        <div className="flex items-center gap-1.5 py-1 text-[13px]">
          <span className="pl-4">{name}</span>
          <span>
            {trunc(value)}
            {unit}
          </span>
          {marker(id)}
          <span className="flex-1" />
          {dvId != null && dvPercent(dvId) != null && <span className="font-bold">{dvPercent(dvId)}%</span>}
        </div>
      </div>,
      `row-${name}`
    )

  const smallRow = (name: string, value: number | undefined, unit: string, dvId: string) =>
    clickable(
      dvId,
      <div className="flex items-center gap-1.5 py-0.5 text-[12px]">
        <span>{name}</span>
        <span>
          {trunc(value)}
          {unit}
        </span>
        {marker(dvId)}
        <span className="flex-1" />
        {dvPercent(dvId) != null && <span>{dvPercent(dvId)}%</span>}
      </div>,
      `row-${name}`
    )

  const extraRow = (def: NutrientDefinition) => {
    const value = nutrients[def.id] ?? 0
    const rdi = labelRdi(def)
    return clickable(
      def.id,
      <div className="flex items-center gap-1.5 py-0.5 text-[12px]">
        <span>{def.name}</span>
        <span>
          {onePlace(value)}
          {def.unit}
        </span>
        {marker(def.id)}
        <span className="flex-1" />
        {rdi != null && rdi > 0 && <span>{trunc((value / rdi) * 100)}%</span>}
      </div>,
      def.id
    )
  }

  const sectionHeader = (title: string) => (
    <div className="pt-2 pb-0.5 text-[11px] font-extrabold uppercase tracking-[0.05em] text-text-secondary">
      {title}
    </div>
  )

  return (
    <div className="rounded-2xl border-2 border-white/20 bg-white/[0.025] p-4 text-text-primary">
      <div className="font-display text-[28px] font-black tracking-[-0.02em]">Nutrition Facts</div>
      <div className="h-2 bg-white/25 my-1.5" />

      <div className="flex items-center py-0.5 text-[14px] font-bold">
        <span>Serving Size</span>
        <span className="flex-1" />
        <span>{servingText}</span>
      </div>
      <div className="h-1 bg-white/25 my-1" />

      {clickable(
        'calories',
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="text-[18px] font-bold">Calories</span>
          <span className="flex-1" />
          {marker('calories')}
          <span className="text-[24px] font-bold">{trunc(nutrients['calories'])}</span>
        </div>,
        'row-calories'
      )}
      <div className="border-t border-white/10" />

      <div className="py-0.5 text-right text-[11px] font-bold">% Daily Value*</div>

      {sectionHeader('Core Nutrients')}
      {nutrientRow('Total Fat', `${trunc(nutrients['total_fat'])}g`, dvPercent('total_fat'), 'total_fat')}
      {indentedRow('Saturated Fat', nutrients['saturated_fat'], 'g', 'saturated_fat', 'saturated_fat')}
      {indentedRow('Trans Fat', nutrients['trans_fat'], 'g', undefined, 'trans_fat')}
      {nutrientRow('Cholesterol', `${trunc(nutrients['cholesterol'])}mg`, dvPercent('cholesterol'), 'cholesterol')}
      {nutrientRow('Sodium', `${trunc(nutrients['sodium'])}mg`, dvPercent('sodium'), 'sodium')}
      {nutrientRow(
        'Total Carbohydrate',
        `${trunc(nutrients['carbohydrates'])}g`,
        dvPercent('carbohydrates'),
        'carbohydrates'
      )}
      {indentedRow('Dietary Fiber', nutrients['dietary_fiber'], 'g', 'dietary_fiber', 'dietary_fiber')}
      {indentedRow('Total Sugars', nutrients['total_sugars'], 'g', undefined, 'total_sugars')}
      {nutrientRow('Protein', `${trunc(nutrients['protein'])}g`, dvPercent('protein'), 'protein')}

      <div className="h-1 bg-white/25 my-1" />
      {sectionHeader('Key Vitamins & Minerals')}
      {smallRow('Vitamin D', nutrients['vitamin_d'], 'mcg', 'vitamin_d')}
      {smallRow('Calcium', nutrients['calcium'], 'mg', 'calcium')}
      {smallRow('Iron', nutrients['iron'], 'mg', 'iron')}
      {smallRow('Potassium', nutrients['potassium'], 'mg', 'potassium')}

      {additionalGroups.length > 0 && (
        <>
          <div className="h-1 bg-white/25 my-1" />
          <div className="pt-1 text-[11px] font-bold text-text-secondary">Detailed Nutrient Breakdown</div>
          {additionalGroups.map((group) => (
            <div key={group.category}>
              {sectionHeader(group.category)}
              {group.nutrients.map((def) => extraRow(def))}
            </div>
          ))}
        </>
      )}

      <p className="pt-2 text-[10px] text-text-secondary">
        * Percent Daily Values are based on a 2,000 calorie diet.
      </p>

      {showsLegend && (
        <div className="pt-2 space-y-1">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary">
              <BadgeIcon kind="sparkles" color={WARNING_COLOR} />
              Includes estimates
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary">
              <BadgeIcon kind="sealCheck" color={TEAL_COLOR} />
              Authoritative
            </span>
          </div>
          <p className="text-[10px] text-text-secondary">
            Marker color shows confidence. Click a marked nutrient for its sources, margins &amp; confidence.
          </p>
        </div>
      )}
    </div>
  )
}

// MARK: - Provenance drill-down (NutrientProvenanceDetailView mirror, meal scope)

const MAX_DETAIL_ROWS = 18

function ProvenanceDetailModal({
  definition,
  summary,
  mealScopeLabel,
  onClose,
}: {
  definition: NutrientDefinition
  summary: NutrientProvenanceSummary
  mealScopeLabel: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const unit = definition.unit
  const rdi = labelRdi(definition)
  const rdiPct = rdi != null && rdi > 0 ? Math.trunc((summary.total / rdi) * 100) : null
  const foods = summary.contributions.length
  const shown = summary.contributions.slice(0, MAX_DETAIL_ROWS)
  const doubt = summaryDoubtContributions(summary).slice(0, MAX_DETAIL_ROWS)

  // Amount-weighted average portion error across photo-estimated foods.
  const withPortion = summary.contributions.filter(contributionHasPortionEstimate)
  const portionAmount = withPortion.reduce((acc, c) => acc + c.totalAmount, 0)
  const aggregatePortionErr =
    withPortion.length > 0 && portionAmount > 0
      ? withPortion.reduce((acc, c) => acc + (c.portionErrorPct ?? 0) * c.totalAmount, 0) / portionAmount
      : null

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="mx-auto my-6 w-full max-w-[600px] rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold tracking-[-0.01em]">{definition.name}</h2>
          <button type="button" className="btn btn-secondary text-[12px] !py-1.5 !px-3" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="panel !p-4">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-[30px] font-bold">{fmt(summary.total)}</span>
            <span className="text-[14px] text-text-secondary">{unit}</span>
            <span className="flex-1" />
            {rdiPct != null && (
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] font-semibold text-text-secondary">
                {rdiPct}% RDI
              </span>
            )}
          </div>
          <p className="card-subtext mt-1.5">
            {mealScopeLabel} · {foods} {foods === 1 ? 'food' : 'foods'}
          </p>
        </div>

        <ConfidenceCard summary={summary} definition={definition} aggregatePortionErr={aggregatePortionErr} />

        {(definition.category === 'Vitamins' || definition.category === 'Minerals') && (
          <div
            className="flex items-start gap-2.5 rounded-xl p-3 text-[12px] text-text-secondary"
            style={{ background: 'rgba(110, 142, 255, 0.08)' }}
          >
            <span className="mt-0.5 shrink-0" style={{ color: INFO_COLOR }}>
              <InfoIcon />
            </span>
            <p>
              FDA labeling may treat vitamin or mineral amounts below 2% of the daily reference per serving as
              zero. A stricter nutrition-review recommendation treats 2% or less as a trace contribution, not a
              meaningful standalone source. StatsKey still shows and counts every recorded amount.
            </p>
          </div>
        )}

        <div>
          <span className="card-title">Where it comes from</span>
          <div className="mt-2 space-y-2">
            {shown.map((c) => (
              <ContributionRow key={c.id} contribution={c} summaryTotal={summary.total} unit={unit} />
            ))}
            {summary.contributions.length > shown.length && (
              <p className="text-[12px] text-text-muted">
                + {summary.contributions.length - shown.length} more foods
              </p>
            )}
          </div>
        </div>

        <div>
          <span className="card-title">Where doubt may come from</span>
          <div className="mt-2 space-y-2">
            {doubt.length === 0 ? (
              <div className="panel !p-3.5 flex items-center gap-2.5">
                <span style={{ color: TEAL_COLOR }}>
                  <BadgeIcon kind="sealCheck" color={TEAL_COLOR} size={14} />
                </span>
                <p className="text-[13px] text-text-secondary">
                  No major sources of doubt — this nutrient is well sourced.
                </p>
              </div>
            ) : (
              doubt.map((c) => <DoubtRow key={c.id} contribution={c} summaryTotal={summary.total} />)
            )}
          </div>
        </div>

        <p className="text-[11px] text-text-muted">
          StatsKey separates two kinds of uncertainty. The source margin of error is on a nutrient's value (USDA
          FoodData Central publishes its own and reads as authoritative; product labels and web references are
          estimated). The portion margin of error is on the amount eaten when a serving was estimated from a
          photo — shown first because it's usually the larger of the two. Both are marked, and authoritative
          sources show full confidence.
        </p>
      </div>
    </div>
  )
}

function ConfidenceCard({
  summary,
  definition,
  aggregatePortionErr,
}: {
  summary: NutrientProvenanceSummary
  definition: NutrientDefinition
  aggregatePortionErr: number | null
}) {
  const color = confidenceColor(summary.overallConfidence)
  return (
    <div className="panel !p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BadgeIcon kind={confidenceIconKindFor(summary)} color={color} size={15} />
        <span className="text-[15px] font-bold">{confidenceLabel(summary.overallConfidence)}</span>
        <span className="flex-1" />
        <span className="text-[14px] font-semibold" style={{ color }}>
          {Math.round(summary.overallScore * 100)}%
        </span>
      </div>

      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(4, Math.min(100, summary.overallScore * 100))}%`, background: color }}
        />
      </div>

      <p className="text-[13px] text-text-secondary">{confidenceStatement(summary, definition)}</p>

      <div className="border-t border-white/[0.06] pt-3 flex gap-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted">Food coverage</div>
          <div className="text-[15px] font-bold mt-0.5">{Math.round(summary.coverageFraction * 100)}%</div>
        </div>
        {summary.lowerBound != null && summary.upperBound != null && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted">
              Estimated range
            </div>
            <div className="text-[15px] font-bold mt-0.5">
              {fmt(summary.lowerBound)}–{fmt(summary.upperBound)} {definition.unit}
            </div>
          </div>
        )}
      </div>

      {aggregatePortionErr != null && (
        <div
          className="flex items-start gap-2 rounded-xl p-2.5"
          style={{ background: 'rgba(255, 206, 107, 0.14)' }}
        >
          <span className="mt-0.5 shrink-0" style={{ color: WARNING_COLOR }}>
            <ScaleIcon />
          </span>
          <p className="text-[12px] font-medium text-text-primary">
            The portion estimate adds about ±{Math.round(aggregatePortionErr)}% — usually the largest source of
            error, and separate from each source's own margin.
          </p>
        </div>
      )}
    </div>
  )
}

function confidenceIconKindFor(summary: NutrientProvenanceSummary): BadgeIconKind {
  switch (summary.overallConfidence) {
    case 'full':
      return 'sealCheck'
    case 'high':
      return 'checkCircle'
    case 'medium':
      return 'sparkles'
    default:
      return 'questionCircle'
  }
}

function confidenceStatement(summary: NutrientProvenanceSummary, definition: NutrientDefinition): string {
  const name = definition.name.toLowerCase()
  if (summaryIsFullyAuthoritative(summary)) {
    return `Every contribution to your ${name} comes from authoritative, measured sources you recorded precisely — full confidence.`
  }
  const estPct = Math.round(summary.estimatedFraction * 100)
  const authPct = Math.round(summary.authoritativeFraction * 100)
  const portionPct = Math.round(summary.portionEstimatedFraction * 100)
  const sentences: string[] = []
  if (estPct > 0) {
    sentences.push(
      authPct > 0
        ? `About ${estPct}% of your ${name} comes from estimated sources; ${authPct}% from authoritative, measured ones.`
        : `About ${estPct}% of your ${name} comes from estimated sources.`
    )
  } else if (summary.authoritativeFraction > 0.999) {
    sentences.push(`Your ${name} comes from authoritative, measured sources.`)
  } else {
    sentences.push(`Your ${name} comes from recorded sources, though not all are independently authoritative.`)
  }
  if (portionPct > 0) {
    sentences.push(
      `For ${portionPct}%, the amount eaten was estimated from a photo — a separate portion margin of error, shown per food below.`
    )
  }
  if (summary.coverageFraction < 0.95) {
    sentences.push(
      `${Math.round(summary.coverageFraction * 100)}% of recorded food energy explicitly reports this nutrient; unreported foods remain unknown, not zero.`
    )
  }
  return sentences.join(' ')
}

function ContributionRow({
  contribution: c,
  summaryTotal,
  unit,
}: {
  contribution: NutrientContribution
  summaryTotal: number
  unit: string
}) {
  const share = summaryTotal > 0 ? Math.round((c.totalAmount / summaryTotal) * 100) : 0
  const color = confidenceColor(c.resolved.confidence)
  const emphasized = c.resolved.isEstimated || contributionHasPortionEstimate(c)

  return (
    <div
      className="rounded-xl bg-white/[0.03] p-3 space-y-2"
      style={{ border: `1px solid ${color}${emphasized ? '59' : '1f'}` }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold">{c.name}</span>
            {c.occurrences > 1 && <span className="text-[11px] text-text-muted">×{c.occurrences}</span>}
          </div>
          {c.brand && <div className="truncate text-[11px] text-text-muted">{c.brand}</div>}
        </div>
        <div className="ml-auto shrink-0 text-right">
          <div className="text-[13px] font-semibold">
            {fmt(c.totalAmount)} {unit}
          </div>
          <div className="text-[11px] text-text-muted">{share}% of total</div>
        </div>
      </div>

      {contributionHasPortionEstimate(c) && (
        <div
          className="flex items-center gap-2 rounded-lg px-2.5 py-2"
          style={{ background: 'rgba(255, 206, 107, 0.14)' }}
        >
          <span className="shrink-0" style={{ color: WARNING_COLOR }}>
            <ScaleIcon />
          </span>
          <div>
            <div className="text-[13px] font-bold">{portionPrimaryText(c)}</div>
            <div className="text-[11px] text-text-secondary">
              Estimated portion — usually the biggest source of error
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-text-muted">Source</span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: `${color}1f`, color }}
        >
          {sourceDisplayName(c.resolved.source)}
        </span>
        <span className="text-[11px] text-text-secondary">{sourceErrorText(c)}</span>
      </div>

      <Citation citation={c.resolved.citation} />
    </div>
  )
}

function portionPrimaryText(c: NutrientContribution): string {
  let main = ''
  if (c.portionErrorPct != null && c.portionErrorPct > 0) main = `±${Math.round(c.portionErrorPct)}%`
  if (c.portionLowGram != null && c.portionHighGram != null && c.portionHighGram > c.portionLowGram) {
    const range = `≈${fmt(c.portionLowGram)}–${fmt(c.portionHighGram)} g`
    main = main ? `${main} · ${range}` : range
  }
  return main || 'Amount estimated from photo'
}

function sourceErrorText(c: NutrientContribution): string {
  const measured = c.resolved.isEstimated ? 'Estimated' : 'Measured'
  const err = c.resolved.estErrorPct
  if (err != null && err > 0) return `${measured} · ±${Math.round(err)}% margin`
  return c.resolved.isEstimated ? measured : `${measured} · authoritative`
}

function Citation({ citation }: { citation?: string }) {
  if (!citation) return null
  if (citation.toLowerCase().startsWith('http')) {
    return (
      <a
        href={citation}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-medium"
        style={{ color: INFO_COLOR }}
      >
        <LinkIcon />
        Source
      </a>
    )
  }
  return <p className="text-[11px] text-text-muted line-clamp-2">{citation}</p>
}

function DoubtRow({ contribution: c, summaryTotal }: { contribution: NutrientContribution; summaryTotal: number }) {
  const share = summaryTotal > 0 ? Math.round((c.totalAmount / summaryTotal) * 100) : 0
  const color = confidenceColor(c.resolved.confidence)
  const portionOnly =
    contributionHasPortionEstimate(c) && !c.resolved.isEstimated && confidenceRank(c.resolved.confidence) > confidenceRank('medium')

  const icon = portionOnly ? (
    <ScaleIcon />
  ) : sourceIsFilledByStatsKey(c.resolved.source) ? (
    <BadgeIcon kind="sparkles" color={color} size={13} />
  ) : (
    <WarningIcon />
  )

  return (
    <div className="panel !p-3 flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0" style={{ color }}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold">{c.name}</div>
        <div className="text-[12px] text-text-secondary">{doubtReason(c)}</div>
      </div>
      <span className="ml-auto shrink-0 text-[12px] font-semibold text-text-muted">{share}%</span>
    </div>
  )
}

function doubtReason(c: NutrientContribution): string {
  if (
    contributionHasPortionEstimate(c) &&
    !c.resolved.isEstimated &&
    confidenceRank(c.resolved.confidence) > confidenceRank('medium')
  ) {
    if (c.portionErrorPct != null && c.portionErrorPct > 0) {
      return `Amount estimated from a photo · about ±${Math.round(c.portionErrorPct)}% portion`
    }
    return 'Amount estimated from a photo'
  }
  const parts = [`${sourceDisplayName(c.resolved.source)} · ${confidenceShortLabel(c.resolved.confidence)} confidence`]
  if (c.resolved.estErrorPct != null && c.resolved.estErrorPct > 0) {
    parts.push(`±${Math.round(c.resolved.estErrorPct)}% source`)
  }
  if (c.portionErrorPct != null && c.portionErrorPct > 0) {
    parts.push(`±${Math.round(c.portionErrorPct)}% portion`)
  }
  return parts.join(' · ')
}

// MARK: - Icons

function BadgeIcon({ kind, color, size = 11 }: { kind: BadgeIconKind; color: string; size?: number }) {
  switch (kind) {
    case 'sparkles':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden="true">
          <path d="M6 1l1.2 3.3L10.5 5.5 7.2 6.7 6 10 4.8 6.7 1.5 5.5l3.3-1.2L6 1z" />
          <path d="M12 8l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9L12 8z" />
        </svg>
      )
    case 'sealCheck':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden="true">
          <path d="M8 0l1.7 1.5 2.2-.4.7 2.1 2.1.7-.4 2.2L16 8l-1.7 1.9.4 2.2-2.1.7-.7 2.1-2.2-.4L8 16l-1.7-1.5-2.2.4-.7-2.1-2.1-.7.4-2.2L0 8l1.7-1.9-.4-2.2 2.1-.7.7-2.1 2.2.4L8 0z" />
          <path d="M4.5 8.2l2.2 2.2 4.6-4.8" fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'checkCircle':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden="true">
          <circle cx="8" cy="8" r="8" />
          <path d="M4.6 8.2l2.2 2.2 4.6-4.8" fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'questionCircle':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden="true">
          <circle cx="8" cy="8" r="8" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="rgba(0,0,0,0.85)">
            ?
          </text>
        </svg>
      )
    case 'coverage':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden="true">
          <rect x="1" y="9" width="3.4" height="6" rx="0.8" />
          <rect x="6.3" y="5" width="3.4" height="10" rx="0.8" />
          <rect x="11.6" y="1" width="3.4" height="14" rx="0.8" />
        </svg>
      )
  }
}

function ScaleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1a2 2 0 0 1 2 2h2.4a1 1 0 0 1 1 .8L15 13a2 2 0 0 1-2 2.4H3A2 2 0 0 1 1 13L2.6 3.8a1 1 0 0 1 1-.8H6a2 2 0 0 1 2-2zm0 1.4a.9.9 0 0 0-.9.9h1.8A.9.9 0 0 0 8 2.4z" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.2L15.6 14a1 1 0 0 1-.9 1.5H1.3a1 1 0 0 1-.9-1.5L8 1.2z" />
      <rect x="7.3" y="6" width="1.4" height="4.4" rx="0.7" fill="rgba(0,0,0,0.85)" />
      <circle cx="8" cy="12.6" r="0.9" fill="rgba(0,0,0,0.85)" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 1.4A6.6 6.6 0 1 1 8 14.6 6.6 6.6 0 0 1 8 1.4z" />
      <circle cx="8" cy="4.6" r="1" />
      <rect x="7.3" y="6.6" width="1.4" height="5.4" rx="0.7" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12L12 4" />
      <path d="M6 4h6v6" />
    </svg>
  )
}
