import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  PLAN_CANVAS_CONFLICT_EVENT,
  PLAN_CANVAS_EVENT,
  PLAN_CANVAS_PERSISTENCE_ERROR_EVENT,
  canonicalPlanCanvasBuildSource,
  getPlanCanvasPersistenceState,
  parsePlanCanvas,
  togglePlanCanvasTask,
  type PlanCanvasDiagram,
  type PlanCanvasDiagramNode,
  type PlanCanvasRecord,
} from '../../lib/planCanvas'

export type PlanCanvasViewMode = 'canvas' | 'source'

export function PlanCanvasArtifact({
  canvas,
  view,
  saving,
  error,
  readOnly = false,
  onView,
  onSource,
  onSaveWorkspace,
  onRevise,
  onBuild,
  onOpenLibrary,
  onClose,
}: {
  canvas: PlanCanvasRecord
  view: PlanCanvasViewMode
  saving: boolean
  error?: string
  readOnly?: boolean
  onView: (view: PlanCanvasViewMode) => void
  onSource: (source: string) => void
  onSaveWorkspace: () => void
  onRevise: () => void
  onBuild: () => void
  onOpenLibrary: () => void
  onClose: () => void
}) {
  const buildSource = useMemo(
    () => canonicalPlanCanvasBuildSource(canvas.source),
    [canvas.source]
  )
  const sourceNeedsReview =
    canvas.sourceTruncated === true || buildSource.requiresNormalization
  const [persistence, setPersistence] = useState(() =>
    getPlanCanvasPersistenceState(canvas.id)
  )
  useEffect(() => {
    const refresh = () =>
      setPersistence(getPlanCanvasPersistenceState(canvas.id))
    refresh()
    window.addEventListener(PLAN_CANVAS_EVENT, refresh)
    window.addEventListener(PLAN_CANVAS_CONFLICT_EVENT, refresh)
    window.addEventListener(PLAN_CANVAS_PERSISTENCE_ERROR_EVENT, refresh)
    return () => {
      window.removeEventListener(PLAN_CANVAS_EVENT, refresh)
      window.removeEventListener(PLAN_CANVAS_CONFLICT_EVENT, refresh)
      window.removeEventListener(PLAN_CANVAS_PERSISTENCE_ERROR_EVENT, refresh)
    }
  }, [canvas.id])
  const persistenceLabel =
    persistence.status === 'saved'
      ? 'Saved automatically'
      : persistence.status === 'pending'
        ? 'Saving…'
        : persistence.status === 'error'
          ? 'Not saved'
          : 'Not saved yet'
  return (
    <section className="plan-canvas-artifact">
      <header className="plan-canvas-artifact__header">
        <div className="plan-canvas-artifact__identity">
          <i aria-hidden="true">⌘</i>
          <span>
            <small>Planning canvas</small>
            <b>{canvas.title}</b>
            <em>
              {canvas.savedPath
                ? `${canvas.savedPath} · revision ${canvas.revision} · ${persistenceLabel}`
                : `${persistenceLabel} · revision ${canvas.revision}`}
            </em>
          </span>
        </div>
        <div className="plan-canvas-artifact__header-actions">
          <button type="button" onClick={onOpenLibrary}>
            All canvases
          </button>
          <button type="button" onClick={onClose} aria-label="Close canvas">
            ×
          </button>
        </div>
      </header>

      <nav className="plan-canvas-artifact__views" aria-label="Canvas view">
        <button
          type="button"
          className={view === 'canvas' ? 'active' : undefined}
          aria-pressed={view === 'canvas'}
          onClick={() => onView('canvas')}
        >
          Canvas
        </button>
        <button
          type="button"
          className={view === 'source' ? 'active' : undefined}
          aria-pressed={view === 'source'}
          onClick={() => onView('source')}
        >
          Source
        </button>
      </nav>

      {view === 'source' ? (
        <textarea
          className="plan-canvas-artifact__source"
          value={canvas.source}
          onChange={(event) => onSource(event.target.value)}
          readOnly={readOnly}
          aria-label="Planning canvas source"
          spellCheck
        />
      ) : (
        <PlanCanvasDocument
          source={canvas.source}
          onSource={onSource}
          readOnly={readOnly}
        />
      )}

      {error && <p className="plan-canvas-artifact__error">{error}</p>}
      {persistence.status === 'error' && persistence.error && (
        <p className="plan-canvas-artifact__error">{persistence.error}</p>
      )}
      {view === 'canvas' && sourceNeedsReview && (
        <p className="plan-canvas-artifact__error">
          Canvas leaves out unsupported or over-limit source, so it is not
          showing the whole source.{' '}
          <button type="button" onClick={() => onView('source')}>
            Review source
          </button>
        </p>
      )}

      {readOnly ? (
        <footer className="plan-canvas-artifact__footer">
          <span>
            Viewing saved revision {canvas.revision}. This snapshot cannot be
            changed.
          </span>
          <button type="button" onClick={onOpenLibrary}>
            Open latest canvas
          </button>
        </footer>
      ) : (
        <footer className="plan-canvas-artifact__footer">
          <div>
            <button type="button" onClick={onRevise}>
              Revise with Intelligence
            </button>
            <button type="button" onClick={onSaveWorkspace} disabled={saving}>
              {saving
                ? 'Saving…'
                : canvas.savedPath
                  ? 'Update workspace copy'
                  : 'Keep in workspace'}
            </button>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (sourceNeedsReview) {
                onSource(buildSource.source)
                onView('source')
                return
              }
              onBuild()
            }}
            disabled={!buildSource.source.trim()}
          >
            {sourceNeedsReview ? 'Clean and review' : 'Start plan'}
          </button>
        </footer>
      )}
    </section>
  )
}

export function PlanCanvasLibrary({
  canvases,
  onOpen,
  onRemove,
  onClose,
}: {
  canvases: PlanCanvasRecord[]
  onOpen: (canvas: PlanCanvasRecord) => void
  onRemove: (canvas: PlanCanvasRecord) => void
  onClose: () => void
}) {
  return (
    <section className="plan-canvas-library">
      <header>
        <div>
          <small>Workspace artifacts</small>
          <b>Planning canvases</b>
          <span>Saved plans stay available after the chat closes.</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close canvases">
          ×
        </button>
      </header>
      {canvases.length === 0 ? (
        <div className="plan-canvas-library__empty">
          Ask Intelligence to plan a project. Its first plan will appear here
          automatically.
        </div>
      ) : (
        <div className="plan-canvas-library__list">
          {canvases.map((canvas) => (
            <article key={canvas.id}>
              <button type="button" onClick={() => onOpen(canvas)}>
                <i aria-hidden="true">⌘</i>
                <span>
                  <b>{canvas.title}</b>
                  <small>
                    {canvas.workspaceLabel ||
                      (canvas.scope === 'work' ? 'Workspace' : 'Personal')}
                    {' · '}
                    {relativeCanvasTime(canvas.updatedAt)}
                  </small>
                  <em>
                    {canvas.savedPath || `Revision ${canvas.revision} · saved locally`}
                  </em>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(canvas)}
                aria-label={`Remove ${canvas.title} from saved canvases`}
                title="Remove from saved canvases"
              >
                ×
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function PlanCanvasDocument({
  source,
  onSource,
  readOnly = false,
}: {
  source: string
  onSource: (source: string) => void
  readOnly?: boolean
}) {
  const blocks = useMemo(() => parsePlanCanvas(source), [source])
  return (
    <div className="plan-canvas-document">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const Heading = (`h${Math.min(4, Math.max(2, block.level + 1))}` as
            | 'h2'
            | 'h3'
            | 'h4')
          return <Heading key={index}>{inlineCanvasText(block.text)}</Heading>
        }
        if (block.kind === 'paragraph') {
          return <p key={index}>{inlineCanvasText(block.text)}</p>
        }
        if (block.kind === 'rule') return <hr key={index} />
        if (block.kind === 'tasks') {
          return (
            <section key={index} className="plan-canvas-tasks">
              <header>
                <b>Plan</b>
                <span>
                  {block.items.filter((item) => item.checked).length}/
                  {block.items.length} complete
                </span>
              </header>
              <ol>
                {block.items.map((item, taskIndex) => (
                  <li key={item.line} data-complete={item.checked}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={item.checked}
                      disabled={readOnly}
                      onClick={() =>
                        onSource(togglePlanCanvasTask(source, item.line))
                      }
                    >
                      {item.checked ? '✓' : taskIndex + 1}
                    </button>
                    <span>{inlineCanvasText(item.text)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index} className="plan-canvas-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inlineCanvasText(item)}</li>
              ))}
            </List>
          )
        }
        if (block.kind === 'table') {
          return (
            <div key={index} className="plan-canvas-table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, cellIndex) => (
                      <th key={cellIndex}>{inlineCanvasText(header)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {block.headers.map((_header, cellIndex) => (
                        <td key={cellIndex}>
                          {inlineCanvasText(row[cellIndex] || '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'diagram') {
          return (
            <section key={index} className="plan-canvas-diagram-card">
              <header>
                <b>How the plan fits together</b>
                <span>{block.diagram.nodes.length} steps</span>
              </header>
              <PlanCanvasDiagramView diagram={block.diagram} />
            </section>
          )
        }
        return (
          <pre key={index} className="plan-canvas-code">
            <span>{block.language || 'text'}</span>
            <code>{block.source}</code>
          </pre>
        )
      })}
    </div>
  )
}

function PlanCanvasDiagramView({ diagram }: { diagram: PlanCanvasDiagram }) {
  if (diagram.nodes.length === 0) {
    return (
      <div className="plan-canvas-diagram-empty">
        The diagram source is available in Source view.
      </div>
    )
  }
  const layout = layoutCanvasDiagram(diagram)
  const markerId = `canvas-arrow-${diagram.nodes.map((node) => node.id).join('-')}`
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 100)
  return (
    <svg
      className="plan-canvas-diagram"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="Planning flow diagram"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {diagram.edges.map((edge, index) => {
        const start = layout.nodes.get(edge.from)
        const end = layout.nodes.get(edge.to)
        if (!start || !end) return null
        const horizontal = diagram.direction === 'LR' || diagram.direction === 'RL'
        const x1 = start.x + (horizontal ? start.width : start.width / 2)
        const y1 = start.y + (horizontal ? start.height / 2 : start.height)
        const x2 = end.x + (horizontal ? 0 : end.width / 2)
        const y2 = end.y + (horizontal ? end.height / 2 : 0)
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        const path = horizontal
          ? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
        return (
          <g key={`${edge.from}-${edge.to}-${index}`}>
            <path
              className="plan-canvas-diagram__edge"
              data-dashed={edge.dashed}
              d={path}
              markerEnd={`url(#${markerId})`}
            />
            {edge.label && (
              <text className="plan-canvas-diagram__edge-label" x={midX} y={midY - 6}>
                {edge.label.slice(0, 36)}
              </text>
            )}
          </g>
        )
      })}
      {diagram.nodes.map((node) => {
        const position = layout.nodes.get(node.id)
        if (!position) return null
        const lines = wrapCanvasNode(node)
        return (
          <g
            key={node.id}
            className="plan-canvas-diagram__node"
            data-shape={node.shape}
            transform={`translate(${position.x} ${position.y})`}
          >
            {node.shape === 'decision' ? (
              <path
                d={`M ${position.width / 2} 0 L ${position.width} ${position.height / 2} L ${position.width / 2} ${position.height} L 0 ${position.height / 2} Z`}
              />
            ) : (
              <rect
                width={position.width}
                height={position.height}
                rx={node.shape === 'round' ? position.height / 2 : 12}
              />
            )}
            <text x={position.width / 2} y={position.height / 2}>
              {lines.map((line, index) => (
                <tspan
                  key={index}
                  x={position.width / 2}
                  dy={index === 0 ? `${-(lines.length - 1) * 0.58}em` : '1.16em'}
                >
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function layoutCanvasDiagram(diagram: PlanCanvasDiagram) {
  const layers = new Map(diagram.nodes.map((node) => [node.id, 0]))
  for (let pass = 0; pass < diagram.nodes.length; pass += 1) {
    let changed = false
    for (const edge of diagram.edges) {
      const from = layers.get(edge.from) ?? 0
      const to = layers.get(edge.to) ?? 0
      if (to <= from && from + 1 < diagram.nodes.length) {
        layers.set(edge.to, from + 1)
        changed = true
      }
    }
    if (!changed) break
  }
  const grouped = new Map<number, PlanCanvasDiagramNode[]>()
  for (const node of diagram.nodes) {
    const layer = Math.min(diagram.nodes.length - 1, layers.get(node.id) ?? 0)
    grouped.set(layer, [...(grouped.get(layer) ?? []), node])
  }
  const horizontal = diagram.direction === 'LR' || diagram.direction === 'RL'
  const nodeWidth = 176
  const nodeHeight = 62
  const layerGap = horizontal ? 88 : 66
  const itemGap = 34
  const padding = 28
  const maxItems = Math.max(1, ...[...grouped.values()].map((nodes) => nodes.length))
  const layerCount = Math.max(1, grouped.size)
  const width = horizontal
    ? padding * 2 + layerCount * nodeWidth + (layerCount - 1) * layerGap
    : padding * 2 + maxItems * nodeWidth + (maxItems - 1) * itemGap
  const height = horizontal
    ? padding * 2 + maxItems * nodeHeight + (maxItems - 1) * itemGap
    : padding * 2 + layerCount * nodeHeight + (layerCount - 1) * layerGap
  const positions = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >()
  for (const [layer, nodes] of grouped) {
    const crossSize = horizontal ? height : width
    const occupied =
      nodes.length * (horizontal ? nodeHeight : nodeWidth) +
      (nodes.length - 1) * itemGap
    const crossStart = (crossSize - occupied) / 2
    nodes.forEach((node, index) => {
      const forward = padding + layer * ((horizontal ? nodeWidth : nodeHeight) + layerGap)
      const cross = crossStart + index * ((horizontal ? nodeHeight : nodeWidth) + itemGap)
      positions.set(node.id, {
        x: horizontal ? forward : cross,
        y: horizontal ? cross : forward,
        width: nodeWidth,
        height: nodeHeight,
      })
    })
  }
  return { width, height, nodes: positions }
}

function wrapCanvasNode(node: PlanCanvasDiagramNode): string[] {
  const words = node.label.split(/\s+/)
  const lines: string[] = []
  for (const word of words) {
    const current = lines.at(-1)
    if (!current || `${current} ${word}`.length > 23) lines.push(word)
    else lines[lines.length - 1] = `${current} ${word}`
  }
  return lines.slice(0, 3)
}

function inlineCanvasText(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    return part
  })
}

function relativeCanvasTime(value: string): string {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'saved'
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
