import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useReportJob, useReports } from '../lib/data/useReports'
import { createReportJob, deleteReport } from '../lib/writers'
import { buildReportPrompts } from '../lib/ai/reportContext'
import { addDays } from '../lib/firestore'
import { EmptyState } from '../components/EmptyState'
import { IntelligenceConsentGate } from '../components/assistant/IntelligenceConsentGate'
import { REPORT_TOPICS, type ReportTopic, type SavedReport } from '../lib/types'
import { confirmDialog } from '../lib/ui/dialogs'

type RangeDays = 7 | 30 | 90 | 365

const RANGE_OPTIONS: Array<{ days: RangeDays; label: string }> = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
]

const MODEL_OPTIONS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (fast)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (deepest)' },
]

export function Reports() {
  const { user, profile } = useAuth()
  const uid = user?.uid
  const { reports, loading, error } = useReports(uid)

  const [topic, setTopic] = useState<ReportTopic>('Nutrition Deep Dive')
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [modelId, setModelId] = useState(MODEL_OPTIONS[1].id)
  const [customQuestion, setCustomQuestion] = useState('')
  const [building, setBuilding] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)

  const jobState = useReportJob(uid, activeJobId ?? undefined)

  async function run() {
    if (!uid || building) return
    setBuilding(true)
    setBuildError(null)
    try {
      const rangeEnd = new Date()
      const rangeStart = addDays(rangeEnd, -(rangeDays - 1))
      const { systemPrompt, userPrompt } = await buildReportPrompts({
        uid,
        topic,
        rangeStart,
        rangeEnd,
        profile,
        customQuestion: topic === 'Custom Analysis' ? customQuestion : undefined,
      })
      const jobId = await createReportJob(uid, {
        topic,
        title: topic === 'Custom Analysis' && customQuestion.trim() ? truncate(customQuestion.trim(), 60) : topic,
        systemPrompt,
        userPrompt,
        modelId,
        modelLabel: MODEL_OPTIONS.find((m) => m.id === modelId)?.label ?? 'Claude',
        rangeStart,
        rangeEnd,
      })
      setActiveJobId(jobId)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  const jobRunning = jobState != null && (jobState.status === 'queued' || jobState.status === 'running')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Deep Dive Reports</h1>
        <p className="text-text-secondary text-[14px] mt-1">
          Long-form analyses of your recorded data, generated server-side — the same reports as the iOS app.
        </p>
      </header>

      <IntelligenceConsentGate requireAssistantActions={false}>
        <section className="panel space-y-4">
          <span className="card-title">New report</span>

        <div>
          <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">Topic</span>
          <div className="flex flex-wrap gap-2">
            {REPORT_TOPICS.map((t) => (
              <button
                key={t}
                className={'btn text-[12px] !py-1.5 !px-3 ' + (topic === t ? 'btn-primary' : 'btn-secondary')}
                onClick={() => setTopic(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {topic === 'Custom Analysis' && (
          <label className="block">
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              What do you want analyzed?
            </span>
            <textarea
              className="input"
              rows={2}
              placeholder="e.g. How does my late-night eating affect next-morning energy?"
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
            />
          </label>
        )}

        <div className="flex flex-wrap gap-4">
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">Time range</span>
            <div className="tab-strip">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.days}
                  className={rangeDays === r.days ? 'active' : ''}
                  onClick={() => setRangeDays(r.days)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">Model</span>
            <div className="tab-strip">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  className={modelId === m.id ? 'active' : ''}
                  onClick={() => setModelId(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {buildError && <div className="error-banner">{buildError}</div>}

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={run} disabled={building || jobRunning || !uid}>
            {building ? 'Preparing data…' : jobRunning ? 'Running…' : 'Generate report'}
          </button>
          {jobRunning && (
            <span className="text-text-muted text-[12px] animate-pulse">
              {jobState?.status === 'queued' ? 'Queued — the report runs in the cloud.' : 'Analyzing your data…'}
            </span>
          )}
          {jobState?.status === 'done' && activeJobId && (
            <Link to={`/reports/${activeJobId}`} className="link text-[13px] font-medium">
              Report ready — view it →
            </Link>
          )}
          {jobState?.status === 'error' && (
            <span className="text-[12px] text-red-300">Report failed: {jobState.error ?? 'unknown error'}</span>
          )}
        </div>
          <p className="text-text-muted text-[12px]">
            Reports keep running after you leave this page and appear below when finished.
          </p>
        </section>
      </IntelligenceConsentGate>

      <section className="space-y-3">
        <h2 className="card-title">Saved reports</h2>
        {loading ? (
          <div className="panel"><p className="text-text-muted text-[13px]">Loading…</p></div>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : reports.length === 0 ? (
          <div className="panel">
            <EmptyState title="No reports yet" subtitle="Generate your first deep dive above." />
          </div>
        ) : (
          <div className="panel divide-y divide-white/[0.04]">
            {reports.map((r) => (
              <ReportRow key={r.id} report={r} uid={uid} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ReportRow({ report, uid }: { report: SavedReport; uid?: string }) {
  async function remove() {
    if (!uid) return
    const confirmed = await confirmDialog({
      title: `Delete "${report.title}"?`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    await deleteReport(uid, report.id).catch(() => {})
  }

  return (
    <div className="py-3 flex items-center justify-between gap-3">
      <Link to={`/reports/${report.id}`} className="min-w-0 flex-1 hover:opacity-80">
        <div className="text-[14px] text-text-primary">{report.title}</div>
        <div className="card-subtext mt-0.5">
          {report.topicRaw} · {report.rangeStart.toLocaleDateString()} – {report.rangeEnd.toLocaleDateString()} ·{' '}
          {report.modelLabel} · {report.createdAt.toLocaleDateString()}
        </div>
      </Link>
      <button className="btn btn-ghost text-[12px] !py-1 !px-2 text-red-300" onClick={remove}>
        Delete
      </button>
    </div>
  )
}

export function ReportDetail() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { reports, loading } = useReports(user?.uid)
  const report = reports.find((r) => r.id === id)

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>
  if (!report) {
    return (
      <div className="panel">
        <p className="text-text-secondary text-[14px]">Report not found (it may still be generating).</p>
        <Link to="/reports" className="link text-[13px] mt-3 inline-block">← Back to reports</Link>
      </div>
    )
  }

  async function remove() {
    if (!user || !report) return
    const confirmed = await confirmDialog({
      title: `Delete "${report.title}"?`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    await deleteReport(user.uid, report.id).catch(() => {})
    navigate('/reports', { replace: true })
  }

  return (
    <div className="space-y-4 max-w-[820px]">
      <header>
        <Link to="/reports" className="text-text-muted hover:text-text-primary text-[12px]">← Reports</Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <div>
            <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">{report.title}</h1>
            <p className="text-text-secondary text-[13px] mt-1">
              {report.topicRaw} · {report.rangeStart.toLocaleDateString()} – {report.rangeEnd.toLocaleDateString()} ·{' '}
              {report.modelLabel}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary text-[12px] !py-1.5 !px-3"
              onClick={() => navigator.clipboard.writeText(report.content).catch(() => {})}
            >
              Copy
            </button>
            <button className="btn btn-ghost text-[12px] !py-1.5 !px-3 text-red-300" onClick={remove}>
              Delete
            </button>
          </div>
        </div>
      </header>

      <div className="panel">
        <MarkdownLite text={report.content} />
      </div>
    </div>
  )
}

/** Small markdown renderer for report content (headers, bold, lists, rules). */
function MarkdownLite({ text }: { text: string }) {
  const blocks = text.split('\n')
  return (
    <div className="space-y-1.5 text-[14px] leading-relaxed text-text-secondary">
      {blocks.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="h-2" />
        if (trimmed.startsWith('### ')) {
          return <h4 key={i} className="text-text-primary font-semibold text-[14px] mt-3">{inline(trimmed.slice(4))}</h4>
        }
        if (trimmed.startsWith('## ')) {
          return <h3 key={i} className="text-text-primary font-semibold text-[16px] mt-4">{inline(trimmed.slice(3))}</h3>
        }
        if (trimmed.startsWith('# ')) {
          return <h2 key={i} className="text-text-primary font-bold text-[18px] mt-4">{inline(trimmed.slice(2))}</h2>
        }
        if (trimmed === '---') return <hr key={i} className="border-white/[0.06] my-3" />
        if (/^[-*•] /.test(trimmed)) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-text-muted">•</span>
              <span>{inline(trimmed.slice(2))}</span>
            </div>
          )
        }
        if (/^\d+\. /.test(trimmed)) {
          const match = trimmed.match(/^(\d+)\. (.*)$/)
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-text-muted">{match?.[1]}.</span>
              <span>{inline(match?.[2] ?? '')}</span>
            </div>
          )
        }
        return <p key={i}>{inline(trimmed)}</p>
      })}
    </div>
  )
}

/** Renders **bold** and `code` spans. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-text-primary font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="text-[12px] bg-white/[0.06] rounded px-1 py-0.5">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}
