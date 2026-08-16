import { useMemo } from 'react'
import { parseUnifiedDiff } from './unifiedDiff'
import './WorkspaceDiffView.css'

const LINE_MARKERS = { add: '+', remove: '-', context: ' ', meta: ' ' } as const

export function WorkspaceDiffView({
  diffText,
  fallback,
}: {
  diffText: string
  fallback: string
}) {
  const sections = useMemo(() => parseUnifiedDiff(diffText), [diffText])
  if (sections.length === 0) {
    return <p className="workspace-diff-view__empty">{fallback}</p>
  }
  return (
    <div className="workspace-diff-view">
      {sections.map((section) => (
        <section key={section.path} aria-label={`Changes in ${section.path}`}>
          <header title={section.path}>
            {section.oldPath && section.oldPath !== section.path
              ? `${section.oldPath} → ${section.path}`
              : section.path}
          </header>
          {section.binary && (
            <p className="workspace-diff-view__note">
              Binary file — no text preview.
            </p>
          )}
          {section.hunks.map((hunk, hunkIndex) => (
            <div className="workspace-diff-view__hunk" key={hunkIndex}>
              <div className="workspace-diff-view__line workspace-diff-view__line--hunk">
                <span aria-hidden="true"> </span>
                <code>{hunk.header}</code>
              </div>
              {hunk.lines.map((line, lineIndex) => (
                <div
                  className={`workspace-diff-view__line workspace-diff-view__line--${line.kind}`}
                  key={lineIndex}
                >
                  <span aria-hidden="true">{LINE_MARKERS[line.kind]}</span>
                  <code>{line.text || ' '}</code>
                </div>
              ))}
            </div>
          ))}
          {!section.binary && section.hunks.length === 0 && (
            <p className="workspace-diff-view__note">
              No line changes to show for this file.
            </p>
          )}
        </section>
      ))}
    </div>
  )
}
