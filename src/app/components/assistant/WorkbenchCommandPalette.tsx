import { useEffect, useMemo, useRef, useState } from 'react'

export interface WorkbenchCommand {
  id: string
  label: string
  description: string
  shortcut?: string
  run: () => void
}

export function WorkbenchCommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean
  commands: WorkbenchCommand[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const paletteRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return commands
    return commands.filter((command) =>
      `${command.label} ${command.description}`.toLowerCase().includes(normalized)
    )
  }, [commands, query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(0)
      return
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = paletteRef.current?.querySelectorAll<HTMLElement>(
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
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' && filtered.length > 0) {
        event.preventDefault()
        setActiveIndex((current) => (current + 1) % filtered.length)
      }
      if (event.key === 'ArrowUp' && filtered.length > 0) {
        event.preventDefault()
        setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length)
      }
      if (
        event.key === 'Enter' &&
        filtered[activeIndex] &&
        !(document.activeElement instanceof HTMLButtonElement)
      ) {
        event.preventDefault()
        filtered[activeIndex].run()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, filtered, activeIndex])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, filtered])

  if (!open) return null

  return (
    <div
      className="workbench-command-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={paletteRef}
        className="workbench-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Intelligence tools"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tools and actions"
          aria-label="Search Intelligence tools"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="workbench-command-options"
          aria-activedescendant={
            filtered[activeIndex]
              ? `workbench-command-${filtered[activeIndex].id}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
        />
        <div
          ref={listRef}
          id="workbench-command-options"
          role="listbox"
          aria-label="Available commands"
        >
          {filtered.map((command, index) => (
            <button
              key={command.id}
              id={`workbench-command-${command.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                command.run()
                onClose()
              }}
            >
              <span>
                <b>{command.label}</b>
                <small>{command.description}</small>
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
          {filtered.length === 0 && (
            <p>No matching tool. Ask Intelligence in the message box instead.</p>
          )}
        </div>
      </section>
    </div>
  )
}
