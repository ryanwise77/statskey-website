import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useWellnessDetail } from '../lib/data/useWellnessDetail'
import { deleteWellness } from '../lib/writers'
import { WellnessLogForm } from '../components/log/WellnessLogForm'
import { formatDuration } from '../lib/format'
import type { WellnessEntry, WellnessData } from '../lib/types'

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
    if (!user || deleting) return
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

      <div className="panel space-y-4">
        <span className="card-title">{wellnessKindLabel(entry)}</span>
        <DetailGrid data={entry.data} />
      </div>

      {entry.notes && (
        <div className="panel">
          <span className="card-title">Notes</span>
          <p className="text-text-primary text-[14px] mt-2 whitespace-pre-wrap">{entry.notes}</p>
        </div>
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
        { label: 'Bristol type', value: `Type ${entry.bristolType}` },
      ]
      if (entry.color) rows.push({ label: 'Color', value: stoolColorLabel(entry.color) })
      if (entry.urgency != null) rows.push({ label: 'Urgency', value: urgencyLabel(entry.urgency) })
      if (entry.durationInSeconds != null && entry.durationInSeconds > 0) {
        rows.push({ label: 'Duration', value: formatDuration(entry.durationInSeconds) })
      }
      if (entry.notes) rows.push({ label: 'GI notes', value: entry.notes })
      return rows
    }
    case 'symptom': {
      const entry = data.entry
      const rows: Array<{ label: string; value: string | number }> = [
        { label: 'Symptom', value: entry.symptom || 'Symptom' },
        { label: 'Severity', value: `${entry.severity}/5` },
      ]
      if (entry.bodyArea) rows.push({ label: 'Body area', value: entry.bodyArea })
      if (entry.duration) rows.push({ label: 'Duration', value: entry.duration })
      if (entry.triggers.length) rows.push({ label: 'Triggers', value: entry.triggers.join(', ') })
      return rows
    }
    case 'mood': {
      const rows = [{ label: 'Mood', value: `${data.entry.rating}/5` }]
      if (data.entry.tags.length) rows.push({ label: 'Tags', value: data.entry.tags.join(', ') })
      if (data.entry.notes) rows.push({ label: 'Mood notes', value: data.entry.notes })
      return rows
    }
    case 'energy': {
      const rows = [{ label: 'Energy', value: `${data.entry.level}/5` }]
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
      return `Gut Check - Type ${entry.data.entry.bristolType}`
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

function urgencyLabel(level: number): string {
  switch (level) {
    case 1:
      return 'Normal'
    case 2:
      return 'Moderate'
    case 3:
      return 'Urgent'
    default:
      return String(level)
  }
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
