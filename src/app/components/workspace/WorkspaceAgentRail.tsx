import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Flow } from '../../routes/Flow'
import { IntelligenceConsentGate } from '../assistant/IntelligenceConsentGate'
import { LocalWorkIntelligenceGate } from '../assistant/LocalWorkIntelligenceGate'
import type { WorkspaceAgentSide } from './useWorkspaceLayout'
import { useAuth } from '../../lib/auth'
import {
  loadLocalChatSession,
  saveWorkspaceAgentSessionId,
  workspaceAgentSessionId,
} from '../../lib/agentLocalState'

export function WorkspaceAgentRail({
  open,
  workspaceId,
  workspaceLabel,
  side,
  onClose,
  onChangeSide,
  onResize,
}: {
  open: boolean
  workspaceId?: string
  workspaceLabel: string
  side: WorkspaceAgentSide
  onClose: () => void
  onChangeSide: (side: WorkspaceAgentSide) => void
  onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { user } = useAuth()
  const workspaceScope = workspaceId || 'no-project'
  const [sessionId, setSessionId] = useState(() =>
    workspaceAgentSessionId(workspaceScope)
  )
  const [sessionReady, setSessionReady] = useState(false)
  useEffect(() => {
    let active = true
    const rememberedSessionId = workspaceAgentSessionId(workspaceScope)
    setSessionReady(false)
    void loadLocalChatSession(rememberedSessionId).then((session) => {
      if (!active) return
      const nextSessionId =
        session?.contextScope === 'work' &&
        session.projectId &&
        session.projectId !== workspaceScope
          ? crypto.randomUUID().toUpperCase()
          : rememberedSessionId
      if (nextSessionId !== rememberedSessionId) {
        saveWorkspaceAgentSessionId(workspaceScope, nextSessionId)
      }
      setSessionId(nextSessionId)
      setSessionReady(true)
    })
    return () => {
      active = false
    }
  }, [workspaceScope])
  const handleSessionIdChange = useCallback(
    (nextSessionId: string) => {
      saveWorkspaceAgentSessionId(workspaceScope, nextSessionId)
      setSessionId(nextSessionId)
    },
    [workspaceScope]
  )
  const agent = sessionReady ? (
    <Flow
      key={sessionId}
      embedded
      workspaceLabel={workspaceLabel}
      sessionIdOverride={sessionId}
      onSessionIdChange={handleSessionIdChange}
    />
  ) : (
    <div className="workspace-agent__restoring" role="status">
      Restoring Intelligence…
    </div>
  )
  return (
    <aside
      className={`workspace-agent${open ? '' : ' workspace-agent--hidden'}`}
      aria-label="Workspace Intelligence"
      aria-hidden={!open}
    >
      <button
        className="workspace-agent__resize"
        onPointerDown={onResize}
        aria-label="Resize Intelligence panel"
        title="Drag to resize Intelligence"
      />
      <button
        className="workspace-agent__dock"
        onClick={() => onChangeSide(side === 'right' ? 'left' : 'right')}
        aria-label={`Move Intelligence to the ${side === 'right' ? 'left' : 'right'}`}
        title={`Move Intelligence to the ${side === 'right' ? 'left' : 'right'}`}
      >
        <DockSideIcon side={side === 'right' ? 'left' : 'right'} />
      </button>
      <button
        className="workspace-agent__close"
        onClick={onClose}
        aria-label="Close Intelligence panel"
      >
        ×
      </button>
      {user ? (
        <IntelligenceConsentGate>{agent}</IntelligenceConsentGate>
      ) : (
        <LocalWorkIntelligenceGate>{agent}</LocalWorkIntelligenceGate>
      )}
    </aside>
  )
}

function DockSideIcon({ side }: { side: WorkspaceAgentSide }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {side === 'left' ? (
        <>
          <path d="M4 4.5v11" />
          <path d="m10 6-4 4 4 4M6.5 10H16" />
        </>
      ) : (
        <>
          <path d="M16 4.5v11" />
          <path d="m10 6 4 4-4 4M4 10h9.5" />
        </>
      )}
    </svg>
  )
}
