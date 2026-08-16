import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getDesktopBridge,
  type DesktopOperationRequest,
} from '../lib/desktop'
import {
  pauseLatestActiveAgentRunForInput,
  resumeActiveAgentRunAfterInput,
} from '../lib/agentRunState'

export function DesktopOperationGate() {
  const bridge = getDesktopBridge()
  const [queue, setQueue] = useState<DesktopOperationRequest[]>([])
  const knownOperationIds = useRef(new Set<string>())
  const current = queue[0] ?? null

  const resolveOperation = useCallback(
    (operation: DesktopOperationRequest, approved: boolean) => {
      if (!bridge) return
      bridge.workspace.resolveOperation(operation.id, approved)
      resumeActiveAgentRunAfterInput(operation.id)
      knownOperationIds.current.delete(operation.id)
      setQueue((existing) =>
        existing.filter((item) => item.id !== operation.id)
      )
    },
    [bridge]
  )

  useEffect(() => {
    if (!bridge) return
    return bridge.workspace.onOperationRequest((operation) => {
      if (knownOperationIds.current.has(operation.id)) return
      knownOperationIds.current.add(operation.id)
      pauseLatestActiveAgentRunForInput(
        operation.id,
        operation.origin?.sessionId
      )
      setQueue((existing) => [...existing, operation])
    })
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    return bridge.workspace.onOperationSettled((settlement) => {
      if (!knownOperationIds.current.has(settlement.id)) return
      resumeActiveAgentRunAfterInput(settlement.id)
      knownOperationIds.current.delete(settlement.id)
      setQueue((existing) =>
        existing.filter((item) => item.id !== settlement.id)
      )
    })
  }, [bridge])

  useEffect(() => {
    if (!current || !bridge) return
    const onKeyDown = (event: KeyboardEvent) => {
      // While a modal dialog is open it owns the keyboard — its capture-phase
      // handler stops these keys, but belt-and-braces: never let a stray
      // Escape/⌘Enter settle an agent approval behind a dialog.
      if (document.querySelector('.sk-dialog-backdrop') != null) return
      if (event.key === 'Escape') {
        event.preventDefault()
        resolveOperation(current, false)
        return
      }
      // Plain Enter stays on the focused safe default; ⌘Enter approves.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        resolveOperation(current, true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bridge, current, resolveOperation])

  const diff = useMemo(
    () => (current ? compactDiff(current.before ?? '', current.after ?? '') : null),
    [current]
  )

  if (!bridge || !current) return null

  function decide(approved: boolean) {
    resolveOperation(current!, approved)
  }

  return (
    <div className="desktop-operation-overlay" role="presentation">
      <section
        className="desktop-operation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-operation-title"
      >
        <header>
          <div>
            <span>{operationLabel(current.kind)}</span>
            <h2 id="desktop-operation-title">{current.title}</h2>
            <p>{current.description}</p>
          </div>
          {queue.length > 1 && <b>{queue.length - 1} more waiting</b>}
        </header>

        {current.command && (
          <pre className="desktop-operation__command">{current.command}</pre>
        )}
        {current.kind === 'git' && current.before ? (
          <div className="desktop-operation__diff desktop-operation__diff--single">
            <div>
              <span>
                {current.title.startsWith('Push ')
                  ? 'Branch status'
                  : 'Staged changes'}
              </span>
              <pre>{current.before}</pre>
            </div>
          </div>
        ) : !current.command && diff ? (
          <div className="desktop-operation__diff">
            <div>
              <span>Before</span>
              <pre>{diff.before || '(empty)'}</pre>
            </div>
            <div>
              <span>After</span>
              <pre>{diff.after || '(empty)'}</pre>
            </div>
          </div>
        ) : !current.command ? (
          <div className="desktop-operation__summary">
            Review what Intelligence wants to do before it continues.
          </div>
        ) : null}

        <footer>
          <span>
            {current.decisionScope === 'workspace-hooks'
              ? 'Remembered for this project — you will not be asked again'
              : '⌘⏎ allows · Esc cancels'}
          </span>
          <div>
            <button
              className="btn btn-secondary"
              onClick={() => decide(false)}
              autoFocus
            >
              {current.decisionScope === 'workspace-hooks'
                ? 'Keep off'
                : 'Don’t allow'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => decide(true)}
              title="⌘⏎"
            >
              {current.decisionScope === 'workspace-hooks'
                ? 'Enable (⌘⏎)'
                : 'Allow once (⌘⏎)'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function operationLabel(kind: DesktopOperationRequest['kind']): string {
  if (kind === 'terminal') return 'Run a command'
  if (kind === 'mcp') return 'Use a connected service'
  if (kind === 'browser') return 'Use the browser'
  if (kind === 'application') return 'Control an application'
  if (kind === 'hook') return 'Use this project’s setup'
  if (kind === 'git') return 'Change or publish project history'
  if (kind === 'restore') return 'Undo saved changes'
  if (kind === 'delete') return 'Delete a file'
  return 'Change a file'
}

function compactDiff(before: string, after: string): { before: string; after: string } | null {
  if (!before && !after) return null
  if (before.length <= 18_000 && after.length <= 18_000) return { before, after }

  let prefix = 0
  const maximumPrefix = Math.min(before.length, after.length)
  while (prefix < maximumPrefix && before[prefix] === after[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const context = 2_500
  const beforeStart = Math.max(0, prefix - context)
  const beforeEnd = Math.min(before.length, before.length - suffix + context)
  const afterStart = Math.max(0, prefix - context)
  const afterEnd = Math.min(after.length, after.length - suffix + context)
  return {
    before: `${beforeStart > 0 ? '…\n' : ''}${before.slice(beforeStart, beforeEnd)}${
      beforeEnd < before.length ? '\n…' : ''
    }`,
    after: `${afterStart > 0 ? '…\n' : ''}${after.slice(afterStart, afterEnd)}${
      afterEnd < after.length ? '\n…' : ''
    }`,
  }
}
