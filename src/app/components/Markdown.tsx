import React from 'react'

/**
 * Small markdown renderer for Intelligence output: #/##/### headers, ---,
 * bullets, numbered lists, **bold**, `code`. Mirrors the report renderer so
 * chat answers and Deep Dive reports read the same.
 */
export function Markdown({ text }: { text: string }) {
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
