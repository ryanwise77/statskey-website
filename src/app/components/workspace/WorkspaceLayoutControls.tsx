import { useEffect, useRef, useState } from 'react'
import {
  WORKSPACE_LAYOUT_PRESETS,
  type WorkspaceAgentSide,
  type WorkspaceLayoutPresetId,
  type WorkspaceLayoutState,
} from './useWorkspaceLayout'

export function WorkspaceLayoutControls({
  layout,
  onPatch,
  onPreset,
  onReset,
}: {
  layout: WorkspaceLayoutState
  onPatch: (patch: Partial<WorkspaceLayoutState>) => void
  onPreset: (preset: WorkspaceLayoutPresetId) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function setAgentSide(side: WorkspaceAgentSide) {
    onPatch({ agentSide: side, agentOpen: true })
  }

  return (
    <div className="workspace-layout-controls" ref={rootRef}>
      <button
        ref={triggerRef}
        className={open ? 'active' : ''}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="workspace-layout-menu"
      >
        Layout
      </button>
      {open && (
        <section
          id="workspace-layout-menu"
          className="workspace-layout-menu"
          role="dialog"
          aria-label="Workspace layout"
        >
          <header>
            <div>
              <b>Choose what you see</b>
              <span>Start with a layout, then show or hide sections.</span>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close layout menu">
              ×
            </button>
          </header>

          <div className="workspace-layout-presets">
            {WORKSPACE_LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={
                  workspaceLayoutMatches(layout, preset.layout) ? 'active' : ''
                }
                aria-pressed={workspaceLayoutMatches(layout, preset.layout)}
                onClick={() => {
                  onPreset(preset.id)
                  setOpen(false)
                }}
              >
                <b>{preset.label}</b>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>

          <div className="workspace-layout-modules">
            <span>Panels</span>
            <label>
              <input
                type="checkbox"
                checked={layout.editorOpen}
                onChange={(event) =>
                  onPatch({ editorOpen: event.target.checked })
                }
              />
              Editor
            </label>
            <label>
              <input
                type="checkbox"
                checked={layout.explorerOpen}
                onChange={(event) =>
                  onPatch({ explorerOpen: event.target.checked })
                }
              />
              Files
            </label>
            <label>
              <input
                type="checkbox"
                checked={layout.agentOpen}
                onChange={(event) =>
                  onPatch({ agentOpen: event.target.checked })
                }
              />
              Intelligence
            </label>
            <label>
              <input
                type="checkbox"
                checked={layout.canvasMode}
                onChange={(event) =>
                  onPatch({ canvasMode: event.target.checked })
                }
              />
              Full window
            </label>
            <label>
              <input
                type="checkbox"
                checked={layout.bottomPanel === 'terminal'}
                onChange={(event) =>
                  onPatch({
                    bottomPanel: event.target.checked ? 'terminal' : null,
                  })
                }
              />
              Terminal
            </label>
            <label>
              <input
                type="checkbox"
                checked={layout.bottomPanel === 'changes'}
                onChange={(event) =>
                  onPatch({
                    bottomPanel: event.target.checked ? 'changes' : null,
                  })
                }
              />
              Changes
            </label>
          </div>

          <div className="workspace-layout-side">
            <span>Intelligence side</span>
            <div>
              {(['left', 'right'] as const).map((side) => (
                <button
                  key={side}
                  className={layout.agentSide === side ? 'active' : ''}
                  onClick={() => setAgentSide(side)}
                >
                  {side === 'left' ? 'Left' : 'Right'}
                </button>
              ))}
            </div>
          </div>

          <button className="workspace-layout-reset" onClick={onReset}>
            Reset layout
          </button>
        </section>
      )}
    </div>
  )
}

function workspaceLayoutMatches(
  current: WorkspaceLayoutState,
  preset: WorkspaceLayoutState
): boolean {
  return (
    current.editorOpen === preset.editorOpen &&
    current.explorerOpen === preset.explorerOpen &&
    current.agentOpen === preset.agentOpen &&
    current.agentSide === preset.agentSide &&
    current.bottomPanel === preset.bottomPanel &&
    current.canvasMode === preset.canvasMode
  )
}
