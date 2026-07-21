import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useWellnessDetail } from '../lib/data/useWellnessDetail'
import { deleteWellness } from '../lib/writers'
import { WellnessLogForm } from '../components/log/WellnessLogForm'
import { formatDuration } from '../lib/format'
import {
  BRISTOL_INFO,
  CONTROL_LABELS,
  PORTION_LABELS,
  URGENCY_LABELS,
  bristolSummary,
  computeGIBurdenScore,
  isMixedEpisode,
  normalizedSegments,
  parseFeelTagsFromNotes,
} from '../lib/gi'
import type { BowelMovementEntry, WellnessEntry, WellnessData } from '../lib/types'

export function WellnessDetail() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { entry, loading, notFound, error } = useWellnessDetail(user?.uid, id)
  const [isEditing, setIsEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (loading) return <p className="text-text-secondary text-sm">Loading...</p>
  if (error) return <div className="error-banner">{error}</div>
  if (notFound || !entry) {
    return (
      <div className="panel">
        <p className="text-text-secondary text-[14px]">Wellness entry not found.</p>
        <Link to="/history" className="link text-[13px] mt-3 inline-block">
          &larr; Back to history
        </Link>
      </div>
    )
  }

  const editable = isEditableWellness(entry)
  const time = entry.date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  async function handleDelete() {
    if (!user || deleting || !entry) return
    if (!window.confirm('Delete this entry? This cannot be undone.')) return

    setDeleting(true)
    setActionError(null)
    try {
      await deleteWellness(user.uid, entry.id)
      navigate('/history', { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  if (isEditing && editable) {
    return (
      <div className="space-y-6 max-w-[760px]">
        <header>
          <button
            className="text-text-muted hover:text-text-primary text-[12px]"
            type="button"
            onClick={() => setIsEditing(false)}
          >
            &larr; Back to entry
          </button>
          <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] mt-1">
            Edit {wellnessKindLabel(entry)}
          </h1>
          <p className="text-text-secondary text-[13px] mt-1">
            Updating {entry.date.toLocaleDateString([], { month: 'long', day: 'numeric' })}
          </p>
        </header>
        <div className="panel">
          <WellnessLogForm
            initialEntry={entry}
            onSaved={() => setIsEditing(false)}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      </div>
    )
  }

  const bowel = entry.data.kind === 'bowelMovement' ? entry.data.entry : undefined
  const bowelNotes = bowel ? parseFeelTagsFromNotes(bowel.notes ?? entry.notes) : undefined
  const displayNotes = bowel ? bowelNotes?.notes : entry.notes

  return (
    <div className="space-y-6 max-w-[720px]">
      <header>
        <Link to="/history" className="text-text-muted hover:text-text-primary text-[12px]">
          &larr; History
        </Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <div>
            <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">
              {wellnessTitle(entry)}
            </h1>
            <p className="text-text-secondary text-[13px] mt-1">{time}</p>
          </div>
          <div className="flex gap-2">
            {editable && (
              <button
                className="btn btn-secondary text-[12px] !py-1.5 !px-3"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </button>
            )}
            <button
              className="btn btn-ghost text-[12px] !py-1.5 !px-3 text-red-300"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </header>

      {actionError && <div className="error-banner">{actionError}</div>}

      {!editable && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-text-secondary">
          This entry type can be viewed and deleted on the web. Editing is available for gut checks, symptoms, mood,
          and energy entries.
        </div>
      )}

      {bowel && <GIBurdenPanel bowel={bowel} />}

      <div className="panel space-y-4">
        <span className="card-title">{wellnessKindLabel(entry)}</span>
        <DetailGrid data={entry.data} />
        {bowel && bowel.redFlags.length > 0 && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/[0.07] p-3">
            <div className="text-[11px] uppercase tracking-wider text-red-300/90">Worth flagging</div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {bowel.redFlags.map((flag) => (
                <span
                  key={flag}
                  className="rounded-full border border-red-400/40 bg-red-400/10 px-2.5 py-1 text-[12px] text-red-200"
                >
                  {flag}
                </span>
              ))}
            </div>
            <p className="text-[11.5px] text-text-muted mt-2">
              These do not diagnose anything, but they make a clinician summary clearer.
            </p>
          </div>
        )}
        {bowel && bowelNotes && bowelNotes.tags.length > 0 && (
          <div>
            <div className="card-subtext">How it felt</div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {bowelNotes.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-text-secondary"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {displayNotes && (
        <div className="panel">
          <span className="card-title">Notes</span>
          <p className="text-text-primary text-[14px] mt-2 whitespace-pre-wrap">{displayNotes}</p>
        </div>
      )}
    </div>
  )
}

/** Persisted score if present (what iOS saved), otherwise computed live —
 *  mirroring computedGIBurdenScore's stored-value precedence. */
function GIBurdenPanel({ bowel }: { bowel: BowelMovementEntry }) {
  const computed = computeGIBurdenScore(bowel)
  const score = bowel.giBurdenScore ?? computed.score
  return (
    <div className="panel">
      <div className="flex items-center justify-between">
        <div>
          <span className="card-title">GI burden</span>
          <p className="text-text-secondary text-[12.5px] mt-1">
            Form × portion, plus urgency, passage, cleanup, and control — red flags floor it at 8.
          </p>
        </div>
        <span
          className="font-display text-[34px] font-bold tabular-nums leading-none"
          style={{ color: burdenColor(score) }}
        >
          {score}
          <span className="text-[15px] text-text-muted font-normal">/10</span>
        </span>
      </div>
      {computed.breakdown.length > 0 && (
        <ul className="mt-3 border-t border-white/[0.06] pt-2">
          {computed.breakdown.map((row) => (
            <li
              key={row.label}
              className="flex justify-between gap-4 py-1 text-[12px] text-text-secondary font-mono"
            >
              <span>{row.label}</span>
              <span className="text-text-primary whitespace-nowrap">{row.amount}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DetailGrid({ data }: { data: WellnessData }) {
  const rows = detailRows(data)
  if (rows.length === 0) {
    return <p className="text-text-muted text-[13px]">No details recorded.</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="card-subtext">{row.label}</div>
          <div className="text-text-primary text-[15px] font-medium mt-1">{row.value}</div>
        </div>
      ))}
    </div>
  )
}

function detailRows(data: WellnessData): Array<{ label: string; value: string | number }> {
  switch (data.kind) {
    case 'bowelMovement': {
      const entry = data.entry
      const rows: Array<{ label: string; value: string | number }> = [
        { label: 'Form', value: bristolSummary(entry) },
      ]
      if (isMixedEpisode(entry)) {
        rows.push({
          label: 'Phases',
          value: normalizedSegments(entry)
            .map((s) => `T${s.bristolType} · ${PORTION_LABELS[s.portion]}`)
            .join('  →  '),
        })
      } else {
        rows.push({ label: 'Reading', value: BRISTOL_INFO[entry.bristolType].description })
      }
      if (entry.color) rows.push({ label: 'Color', value: stoolColorLabel(entry.color) })
      if (entry.urgency != null) {
        rows.push({ label: 'Urgency', value: URGENCY_LABELS[entry.urgency] ?? String(entry.urgency) })
      }
      if (entry.control) rows.push({ label: 'Control', value: CONTROL_LABELS[entry.control] })
      if (entry.estimatedSize) rows.push({ label: 'Size', value: sizeLabel(entry.estimatedSize) })
      if (entry.durationInSeconds != null && entry.durationInSeconds > 0) {
        rows.push({ label: 'Duration', value: formatDuration(entry.durationInSeconds) })
      }
      if (entry.passageSymptoms.length) {
        rows.push({ label: 'How it passed', value: entry.passageSymptoms.join(', ') })
      }
      if (entry.cleanup.length) {
        rows.push({ label: 'Cleanup & comfort', value: entry.cleanup.join(', ') })
      }
      return rows
    }
    case 'symptom': {
      const entry = data.entry
      const rows: Array<{ label: string; value: string | number }> = [
        { label: 'Symptom', value: entry.symptom || 'Symptom' },
        { label: 'Severity', value: `${entry.severity}/10` },
      ]
      if (entry.bodyArea) rows.push({ label: 'Body area', value: entry.bodyArea })
      if (entry.duration) rows.push({ label: 'Duration', value: entry.duration })
      if (entry.triggers.length) rows.push({ label: 'Triggers', value: entry.triggers.join(', ') })
      return rows
    }
    case 'mood': {
      const rows = [{ label: 'Mood', value: `${data.entry.rating}/5` }]
      if (data.entry.stress != null) rows.push({ label: 'Stress', value: `${data.entry.stress}/10` })
      if (data.entry.tags.length) rows.push({ label: 'Tags', value: data.entry.tags.join(', ') })
      if (data.entry.notes) rows.push({ label: 'Mood notes', value: data.entry.notes })
      return rows
    }
    case 'energy': {
      const rows = [{ label: 'Energy', value: `${data.entry.level}/5` }]
      if (data.entry.tags?.length) rows.push({ label: 'Context', value: data.entry.tags.join(', ') })
      if (data.entry.crashTime) {
        rows.push({ label: 'Crash time', value: data.entry.crashTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })
      }
      if (data.entry.notes) rows.push({ label: 'Energy notes', value: data.entry.notes })
      return rows
    }
    case 'sleep':
      return [
        { label: 'Hours', value: data.hours.toFixed(1) },
        { label: 'Quality', value: `${data.quality}/5` },
      ]
    case 'hydration':
      return [{ label: 'Hydration', value: `${Math.round(data.ozConsumed)} fl oz` }]
    case 'custom':
      return [{ label: data.label || 'Custom', value: `${data.value}${data.unit ? ` ${data.unit}` : ''}` }]
  }
}

function isEditableWellness(entry: WellnessEntry): boolean {
  return (
    entry.data.kind === 'bowelMovement' ||
    entry.data.kind === 'symptom' ||
    entry.data.kind === 'mood' ||
    entry.data.kind === 'energy'
  )
}

function wellnessKindLabel(entry: WellnessEntry): string {
  switch (entry.data.kind) {
    case 'bowelMovement':
      return 'Gut Check'
    case 'symptom':
      return 'Symptom'
    case 'mood':
      return 'Mood'
    case 'energy':
      return 'Energy'
    case 'sleep':
      return 'Sleep'
    case 'hydration':
      return 'Hydration'
    case 'custom':
      return entry.data.label || 'Custom'
  }
}

function wellnessTitle(entry: WellnessEntry): string {
  switch (entry.data.kind) {
    case 'bowelMovement':
      return `Gut Check — ${bristolSummary(entry.data.entry)}`
    case 'symptom':
      return entry.data.entry.symptom || 'Symptom'
    case 'mood':
      return `Mood ${entry.data.entry.rating}/5`
    case 'energy':
      return `Energy ${entry.data.entry.level}/5`
    case 'sleep':
      return `Sleep ${entry.data.hours.toFixed(1)}h`
    case 'hydration':
      return `Hydration ${Math.round(entry.data.ozConsumed)} fl oz`
    case 'custom':
      return entry.data.label || 'Custom'
  }
}

function burdenColor(score: number): string {
  if (score <= 2) return '#51CF66'
  if (score <= 4) return '#FFCE6B'
  if (score <= 7) return '#FFA94D'
  return '#FF6B6B'
}

function stoolColorLabel(color: string): string {
  switch (color) {
    case 'darkBrown':
      return 'Dark brown'
    case 'lightBrown':
      return 'Light brown'
    default:
      return color.charAt(0).toUpperCase() + color.slice(1)
  }
}

function sizeLabel(size: string): string {
  return size === 'veryLarge' ? 'Very large' : size.charAt(0).toUpperCase() + size.slice(1)
}
