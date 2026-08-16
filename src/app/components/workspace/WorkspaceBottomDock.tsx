import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DesktopWorkspaceNode } from '../../lib/desktop'
import type { WorkspaceBottomPanel } from './useWorkspaceLayout'
import { WorkspaceChanges } from './WorkspaceChanges'
import { WorkspaceTerminal } from './WorkspaceTerminal'

export function WorkspaceBottomDock({
  panel,
  roots,
  hasUnsavedChanges,
  onClose,
  onResize,
}: {
  panel: WorkspaceBottomPanel
  roots: DesktopWorkspaceNode[]
  hasUnsavedChanges: boolean
  onClose: () => void
  onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  if (roots.length === 0) return null

  return (
    <section
      className={`workspace-bottom-dock${
        panel ? '' : ' workspace-bottom-dock--hidden'
      }`}
      aria-hidden={!panel}
    >
      <button
        className="workspace-bottom-dock__resize"
        onPointerDown={onResize}
        aria-label={`Resize ${panel} panel`}
        title={`Drag to resize ${panel}`}
      />
      <div
        className={
          panel === 'terminal'
            ? 'workspace-bottom-dock__panel'
            : 'workspace-bottom-dock__panel workspace-bottom-dock__panel--hidden'
        }
      >
        <WorkspaceTerminal
          roots={roots}
          onClose={onClose}
          active={panel === 'terminal'}
        />
      </div>
      <div
        className={
          panel === 'changes'
            ? 'workspace-bottom-dock__panel'
            : 'workspace-bottom-dock__panel workspace-bottom-dock__panel--hidden'
        }
      >
        <WorkspaceChanges
          roots={roots}
          hasUnsavedChanges={hasUnsavedChanges}
          active={panel === 'changes'}
          onClose={onClose}
        />
      </div>
    </section>
  )
}
