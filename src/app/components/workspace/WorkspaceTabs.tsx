import { useEffect, useRef, useState } from 'react'
import { showToast } from '../../lib/ui/dialogs'
import type { OpenWorkspaceDocument } from './workspaceTypes'
import './WorkspaceTabs.css'

interface TabMenuState {
  path: string
  x: number
  y: number
}

export function WorkspaceTabs({
  documents,
  selectedPath,
  secondaryPath,
  loading = false,
  onSelect,
  onOpenBeside,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onReorder,
  onCloseAll,
}: {
  documents: OpenWorkspaceDocument[]
  selectedPath: string | null
  secondaryPath: string | null
  loading?: boolean
  onSelect: (path: string) => void
  onOpenBeside: (path: string) => void
  onClose: (path: string) => void
  onCloseOthers?: (path: string) => void
  onCloseToRight?: (path: string) => void
  onReorder: (sourcePath: string, targetPath: string) => void
  onCloseAll: () => void
}) {
  const tabsRef = useRef<HTMLElement>(null)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<TabMenuState | null>(null)

  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>(':scope > div.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedPath])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  if (documents.length === 0) return null

  const menuIndex = menu
    ? documents.findIndex((document) => document.file.path === menu.path)
    : -1
  const menuDocument = menuIndex >= 0 ? documents[menuIndex] : null

  async function copyRelativePath(document: OpenWorkspaceDocument) {
    try {
      await navigator.clipboard.writeText(document.file.relativePath)
      showToast('Relative path copied.', { kind: 'success' })
    } catch {
      showToast('The path could not be copied.', { kind: 'error' })
    }
  }

  return (
    <nav
      ref={tabsRef}
      className="workspace-tabs"
      aria-label="Open files"
      role="tablist"
    >
      {documents.map((document, index) => {
        const active = selectedPath === document.file.path
        const beside = secondaryPath === document.file.path
        return (
          <div
            key={document.file.path}
            className={[
              active ? 'active' : '',
              beside ? 'beside' : '',
              document.dirty ? 'dirty' : '',
              draggedPath === document.file.path ? 'dragging' : '',
            ].filter(Boolean).join(' ')}
            draggable
            onDragStart={(event) => {
              setDraggedPath(document.file.path)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(
                'application/x-statskey-tab',
                document.file.path
              )
            }}
            onDragEnd={() => setDraggedPath(null)}
            onDragOver={(event) => {
              if (draggedPath && draggedPath !== document.file.path) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              const source =
                draggedPath ||
                event.dataTransfer.getData('application/x-statskey-tab')
              if (source && source !== document.file.path) {
                onReorder(source, document.file.path)
              }
              setDraggedPath(null)
            }}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(document.file.path)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({
                path: document.file.path,
                x: event.clientX,
                y: event.clientY,
              })
            }}
            title={document.file.relativePath}
          >
            <button
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(document.file.path)}
              onKeyDown={(event) => {
                let nextIndex: number | null = null
                if (event.key === 'ArrowRight') {
                  nextIndex = (index + 1) % documents.length
                } else if (event.key === 'ArrowLeft') {
                  nextIndex =
                    (index - 1 + documents.length) % documents.length
                } else if (event.key === 'Home') {
                  nextIndex = 0
                } else if (event.key === 'End') {
                  nextIndex = documents.length - 1
                }
                if (nextIndex == null) return
                event.preventDefault()
                onSelect(documents[nextIndex].file.path)
                window.setTimeout(() => {
                  tabsRef.current
                    ?.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]'
                    )
                    [nextIndex]?.focus()
                }, 0)
              }}
            >
              <span>{document.file.name}</span>
              {document.dirty && <i aria-label="Unsaved changes">●</i>}
            </button>
            <button
              className="workspace-tab__beside"
              aria-label={`Open ${document.file.name} beside`}
              title="Open beside"
              tabIndex={-1}
              onClick={() => onOpenBeside(document.file.path)}
            >
              ◫
            </button>
            <button
              aria-label={`Close ${document.file.name}`}
              tabIndex={-1}
              onClick={() => onClose(document.file.path)}
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        className="workspace-tabs__close-all"
        onClick={onCloseAll}
        aria-label="Close all file tabs"
        title="Close all tabs"
      >
        Close all
      </button>
      {loading && (
        <div
          className="workspace-tabs__loading"
          role="progressbar"
          aria-label="Opening file"
        >
          <span />
        </div>
      )}
      {menu && menuDocument && (
        <div
          className="workspace-tab-menu-overlay"
          role="presentation"
          onMouseDown={() => setMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu(null)
          }}
        >
          <div
            className="workspace-tab-menu"
            role="menu"
            aria-label={`Actions for ${menuDocument.file.name}`}
            style={{
              left: Math.min(menu.x, Math.max(0, window.innerWidth - 224)),
              top: Math.min(menu.y, Math.max(0, window.innerHeight - 132)),
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              role="menuitem"
              disabled={documents.length < 2 || !onCloseOthers}
              onClick={() => {
                setMenu(null)
                onCloseOthers?.(menuDocument.file.path)
              }}
            >
              Close Others
            </button>
            <button
              role="menuitem"
              disabled={menuIndex >= documents.length - 1 || !onCloseToRight}
              onClick={() => {
                setMenu(null)
                onCloseToRight?.(menuDocument.file.path)
              }}
            >
              Close to the Right
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null)
                void copyRelativePath(menuDocument)
              }}
            >
              Copy Relative Path
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
