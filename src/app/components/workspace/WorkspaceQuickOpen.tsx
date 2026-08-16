import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  getDesktopBridge,
  type DesktopWorkspaceIndexState,
  type DesktopWorkspaceSearchResult,
} from '../../lib/desktop'
import './WorkspaceQuickOpen.css'

const MAX_QUICK_OPEN_RESULTS = 40
const QUICK_OPEN_SEARCH_DEADLINE_MS = 1_600

export function WorkspaceQuickOpen({
  open,
  onClose,
  onOpenFile,
}: {
  open: boolean
  onClose: () => void
  onOpenFile: (file: DesktopWorkspaceSearchResult, line: number | null) => void
}) {
  const bridge = getDesktopBridge()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DesktopWorkspaceSearchResult[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [indexState, setIndexState] =
    useState<DesktopWorkspaceIndexState | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const requestRef = useRef(0)

  const parsed = useMemo(() => parseQuickOpenQuery(query), [query])

  useEffect(() => {
    if (!open) {
      requestRef.current += 1
      setQuery('')
      setResults([])
      setActiveIndex(0)
      setSearching(false)
      return
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    const keepFocusInside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        dialogRef.current &&
        !dialogRef.current.contains(event.target)
      ) {
        inputRef.current?.focus()
      }
    }
    document.addEventListener('focusin', keepFocusInside, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('focusin', keepFocusInside, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || !bridge) return
    let active = true
    void bridge.workspace.indexState().then((state) => {
      if (active) setIndexState(state)
    })
    const unsubscribe = bridge.workspace.onIndexState((state) => {
      if (active) setIndexState(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge, open])

  useEffect(() => {
    if (!open || !bridge) return
    const requestId = ++requestRef.current
    if (!parsed.term) {
      setResults([])
      setActiveIndex(0)
      setSearching(false)
      return
    }
    setSearching(true)
    setResults([])
    setActiveIndex(0)
    const timer = window.setTimeout(() => {
      void (async () => {
        const named = await settleWithin(
          bridge.workspace.indexSearch(parsed.term, 'files').catch(() => []),
          QUICK_OPEN_SEARCH_DEADLINE_MS,
          []
        )
        if (requestId !== requestRef.current) return
        setResults(
          dedupeByPath(named)
            .filter((result) => result.kind === 'file')
            .slice(0, MAX_QUICK_OPEN_RESULTS)
        )
        setActiveIndex(0)
        setSearching(false)
      })()
    }, 140)
    return () => window.clearTimeout(timer)
  }, [
    bridge,
    indexState?.status,
    open,
    parsed.term,
  ])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  function openResult(result: DesktopWorkspaceSearchResult) {
    onOpenFile(result, parsed.line ?? result.line ?? null)
    onClose()
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not(:disabled)'
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
      return
    }
    if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      setActiveIndex(
        (current) => (current - 1 + results.length) % results.length
      )
      return
    }
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement
      if (target.tagName === 'BUTTON') return
      event.preventDefault()
      const active = results[activeIndex]
      if (active) openResult(active)
    }
  }

  if (!open) return null

  return (
    <div
      className="workspace-quick-open-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={onKeyDown}
    >
      <section
        ref={dialogRef}
        className="workspace-quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Go to file"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Go to file · add :42 to jump to a line"
          aria-label="Go to file"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="workspace-quick-open-results"
          aria-activedescendant={
            results[activeIndex]
              ? `workspace-quick-open-result-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
        />
        <div
          id="workspace-quick-open-results"
          className="workspace-quick-open__results"
          ref={listRef}
          role="listbox"
          aria-label="Matching files"
        >
          {!parsed.term ? (
            <p className="workspace-quick-open__hint">
              Type a file name. ↑↓ to choose, Enter to open, Esc to close.
            </p>
          ) : searching && results.length === 0 ? (
            <p className="workspace-quick-open__hint">Searching…</p>
          ) : indexState?.status === 'indexing' && results.length === 0 ? (
            <p className="workspace-quick-open__hint">
              Preparing this workspace. Matching files will appear automatically.
            </p>
          ) : indexState?.status === 'error' && results.length === 0 ? (
            <p className="workspace-quick-open__hint">
              File search is temporarily unavailable.
            </p>
          ) : results.length === 0 ? (
            <p className="workspace-quick-open__hint">
              No file names match “{parsed.term}”.
            </p>
          ) : (
            results.map((result, index) => (
              <button
                id={`workspace-quick-open-result-${index}`}
                key={result.path}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-active={index === activeIndex || undefined}
                className={index === activeIndex ? 'active' : ''}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openResult(result)}
              >
                <b>
                  {highlightMatch(result.name, parsed.term)}
                  {parsed.line != null && <em>:{parsed.line}</em>}
                </b>
                <small
                  title={
                    result.rootName
                      ? `${result.rootName} · ${result.relativePath}`
                      : result.relativePath
                  }
                >
                  {result.rootName && <em>{result.rootName}</em>}
                  <span>{highlightMatch(result.relativePath, parsed.term)}</span>
                </small>
              </button>
            ))
          )}
        </div>
        <footer>
          <span>↩ Open</span>
          <span>↑↓ Navigate</span>
          <span>Esc Close</span>
          {parsed.line != null && <span>Jump to line {parsed.line}</span>}
        </footer>
      </section>
    </div>
  )
}

export function parseQuickOpenQuery(raw: string): {
  term: string
  line: number | null
} {
  const trimmed = raw.trim()
  const match = /^(.*?):(\d{1,7})$/.exec(trimmed)
  if (match && match[1].trim()) {
    return { term: match[1].trim(), line: Math.max(1, Number(match[2])) }
  }
  return { term: trimmed, line: null }
}

function dedupeByPath(
  results: DesktopWorkspaceSearchResult[]
): DesktopWorkspaceSearchResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    if (seen.has(result.path)) return false
    seen.add(result.path)
    return true
  })
}

function settleWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, milliseconds)
    void promise.then((value) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(value)
    })
  })
}

function highlightMatch(text: string, term: string): ReactNode {
  if (!term) return text
  const lowerText = text.toLowerCase()
  const lowerTerm = term.toLowerCase()
  const start = lowerText.indexOf(lowerTerm)
  if (start >= 0) {
    return (
      <>
        {text.slice(0, start)}
        <mark>{text.slice(start, start + term.length)}</mark>
        {text.slice(start + term.length)}
      </>
    )
  }
  const compactTerm = lowerTerm.replace(/[\s/]/g, '')
  const nodes: ReactNode[] = []
  let termIndex = 0
  let plain = ''
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (
      termIndex < compactTerm.length &&
      character.toLowerCase() === compactTerm[termIndex]
    ) {
      if (plain) {
        nodes.push(plain)
        plain = ''
      }
      nodes.push(<mark key={index}>{character}</mark>)
      termIndex++
    } else {
      plain += character
    }
  }
  if (plain) nodes.push(plain)
  return termIndex === compactTerm.length ? <>{nodes}</> : text
}
