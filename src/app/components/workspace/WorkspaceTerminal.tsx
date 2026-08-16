import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  getDesktopBridge,
  type DesktopApprovalMode,
  type DesktopTerminalSession,
  type DesktopWorkspaceNode,
} from '../../lib/desktop'
import { announceWorkspaceMutation } from '../../lib/workspaceContext'
import { getDirectWorkspaceModelPreference } from './WorkspaceInlineEdit'

const TERMINAL_HISTORY_KEY = 'statskey.workspace.terminal-history.v1'
const MAX_TERMINAL_OUTPUT_CHARACTERS = 1_000_000

export function WorkspaceTerminal({
  roots,
  onClose,
  active = true,
}: {
  roots: DesktopWorkspaceNode[]
  onClose: () => void
  active?: boolean
}) {
  const bridge = getDesktopBridge()
  const [rootPath, setRootPath] = useState(roots[0]?.path ?? '')
  const [command, setCommand] = useState('')
  const [sessions, setSessions] = useState<DesktopTerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>(loadTerminalHistory)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [starting, setStarting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [approvalMode, setApprovalMode] =
    useState<DesktopApprovalMode>('review')
  const inputRef = useRef<HTMLInputElement>(null)
  const terminalHostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const pendingOutput = useRef(new Map<string, string>())

  useEffect(() => {
    if (!roots.some((root) => root.path === rootPath)) {
      setRootPath(roots[0]?.path ?? '')
    }
  }, [rootPath, roots])

  useEffect(() => {
    if (!bridge || !terminalHostRef.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        '"SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 11,
      lineHeight: 1.35,
      scrollback: 10_000,
      theme: {
        background: '#0d1520',
        foreground: '#d6e2ef',
        cursor: '#7eb7ff',
        selectionBackground: '#2f5f8f88',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(terminalHostRef.current)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const resize = () => {
      try {
        fitAddon.fit()
      } catch {
        return
      }
      const sessionId = activeSessionIdRef.current
      if (sessionId) {
        void bridge.workspace.resizeTerminal(
          sessionId,
          terminal.cols,
          terminal.rows
        )
      }
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(terminalHostRef.current)
    const inputSubscription = terminal.onData((data) => {
      const sessionId = activeSessionIdRef.current
      if (sessionId) void bridge.workspace.writeTerminal(sessionId, data)
    })
    const unsubscribe = bridge.workspace.onTerminalEvent((event) => {
      if (event.type === 'data' && event.data) {
        setSessions((current) => {
          const index = current.findIndex(
            (session) => session.id === event.sessionId
          )
          if (index < 0) {
            const pending = pendingOutput.current.get(event.sessionId) ?? ''
            pendingOutput.current.set(
              event.sessionId,
              `${pending}${event.data}`.slice(
                -MAX_TERMINAL_OUTPUT_CHARACTERS
              )
            )
            return current
          }
          const next = [...current]
          const session = next[index]
          next[index] = {
            ...session,
            output: `${session.output}${event.data}`.slice(
              -MAX_TERMINAL_OUTPUT_CHARACTERS
            ),
            updatedAt: new Date().toISOString(),
          }
          return next
        })
        if (activeSessionIdRef.current === event.sessionId) {
          terminal.write(event.data)
        }
      }
      if (event.type === 'exit' && event.session) {
        setSessions((current) => upsertSession(current, event.session!))
        announceWorkspaceMutation({
          kind: 'terminal',
          paths: [],
          refreshAll: true,
        })
      }
    })

    let cancelled = false
    void bridge.workspace.listTerminalSessions().then((existing) => {
      if (cancelled) return
      const hydrated = existing.map((session) => mergePendingOutput(session))
      setSessions(hydrated)
      setActiveSessionId((current) =>
        current && hydrated.some((session) => session.id === current)
          ? current
          : (hydrated.find(isRunningSession)?.id ?? hydrated[0]?.id ?? null)
      )
      window.setTimeout(resize, 0)
    })

    return () => {
      cancelled = true
      unsubscribe()
      inputSubscription.dispose()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [bridge])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
    const terminal = terminalRef.current
    const session = sessions.find((item) => item.id === activeSessionId)
    if (!terminal || !session) return
    terminal.reset()
    terminal.writeln(
      `\x1b[90m${session.rootName || session.cwd}\x1b[0m \x1b[1m$ ${session.command}\x1b[0m`
    )
    terminal.write(session.output)
    if (isRunningSession(session)) terminal.focus()
  }, [activeSessionId])

  useEffect(() => {
    if (!active) return
    const session = sessions.find((item) => item.id === activeSessionId)
    if (session && isRunningSession(session)) terminalRef.current?.focus()
    else inputRef.current?.focus()
  }, [active, activeSessionId, sessions])

  useEffect(() => {
    if (!bridge) return
    void bridge.preferences.get().then((preferences) => {
      setApprovalMode(preferences.approvalMode)
    })
  }, [bridge])

  const selectedRoot = roots.find((root) => root.path === rootPath) ?? roots[0]
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId
  )
  const runningSession = sessions.find(isRunningSession)
  const running = runningSession != null

  function mergePendingOutput(
    session: DesktopTerminalSession
  ): DesktopTerminalSession {
    const pending = pendingOutput.current.get(session.id)
    if (!pending) return session
    pendingOutput.current.delete(session.id)
    return {
      ...session,
      output: `${session.output}${pending}`.slice(
        -MAX_TERMINAL_OUTPUT_CHARACTERS
      ),
    }
  }

  async function execute(event?: FormEvent) {
    event?.preventDefault()
    await startCommand(command.trim())
  }

  async function showGitStatus() {
    await startCommand('git status --short --branch')
  }

  async function startCommand(nextCommand: string) {
    if (
      !bridge ||
      !selectedRoot ||
      !nextCommand ||
      running ||
      starting
    ) {
      return
    }
    setStarting(true)
    setGenerationError(null)
    try {
      const terminal = terminalRef.current
      const result = await bridge.workspace.startTerminal(
        nextCommand,
        selectedRoot.path,
        approvalMode,
        {
          cols: terminal?.cols ?? 100,
          rows: terminal?.rows ?? 28,
        }
      )
      if (!result.ok || !result.session) {
        if (!result.cancelled) {
          setGenerationError(result.error || 'Could not start the command.')
        }
        return
      }
      const session = mergePendingOutput(result.session)
      setSessions((current) => upsertSession(current, session))
      setActiveSessionId(session.id)
      setHistory((current) => {
        const next = [
          nextCommand,
          ...current.filter((candidate) => candidate !== nextCommand),
        ].slice(0, 50)
        saveTerminalHistory(next)
        return next
      })
      setHistoryIndex(-1)
      setCommand('')
      window.setTimeout(() => terminalRef.current?.focus(), 0)
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Could not start the command.'
      )
    } finally {
      setStarting(false)
    }
  }

  async function generateCommand() {
    const request = command.trim()
    if (
      !bridge ||
      !selectedRoot ||
      !request ||
      running ||
      starting ||
      generating
    ) {
      return
    }
    const preference = await getDirectWorkspaceModelPreference()
    if (!preference) {
      setGenerationError('Choose My key in model settings first.')
      return
    }
    setGenerating(true)
    setGenerationError(null)
    const requestId = crypto.randomUUID()
    try {
      const response = await bridge.providers.run(
        requestId,
        preference.provider,
        {
          model: preference.modelId,
          systemPrompt:
            'Translate the user request into the safest concise shell command for the current platform and workspace. Return only the command, with no Markdown fence or explanation. Never execute it.',
          messages: [
            {
              role: 'user',
              content: `Platform: ${bridge.platform}\nWorkspace: ${selectedRoot.name}\nRequest: ${request}`,
            },
          ],
          effort: preference.effort,
          reasoningMode: 'standard',
          maxOutputTokens: 1_000,
          webSearch: false,
        }
      )
      const generated = response.content
        .trim()
        .replace(/^```[a-z0-9_-]*\n/i, '')
        .replace(/\n```$/, '')
        .replace(/\0/g, '')
        .slice(0, 4_000)
      if (!generated) throw new Error('No command was generated.')
      setCommand(generated)
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Could not generate a command.'
      )
    } finally {
      setGenerating(false)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  function handleHistory(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      void generateCommand()
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    if (history.length === 0) return
    event.preventDefault()
    const nextIndex =
      event.key === 'ArrowUp'
        ? Math.min(history.length - 1, historyIndex + 1)
        : Math.max(-1, historyIndex - 1)
    setHistoryIndex(nextIndex)
    setCommand(nextIndex === -1 ? '' : history[nextIndex])
  }

  async function cancelRunning() {
    if (!bridge || !runningSession) return
    setSessions((current) =>
      current.map((session) =>
        session.id === runningSession.id
          ? {
              ...session,
              status: 'cancelling',
              updatedAt: new Date().toISOString(),
            }
          : session
      )
    )
    const cancelled = await bridge.workspace.cancelTerminal(runningSession.id)
    if (!cancelled) {
      setGenerationError('The command already finished.')
      const current = await bridge.workspace.listTerminalSessions()
      setSessions(current)
    }
  }

  return (
    <section className="workspace-terminal" aria-label="Workspace terminal">
      <header>
        <div>
          <b>Terminal</b>
          <span>
            {starting
              ? 'Waiting for approval…'
              : runningSession?.status === 'cancelling'
                ? 'Stopping command…'
                : running
                  ? 'Running · type directly below'
              : generating
                ? 'Generating command…'
                : generationError || 'Ready'}
          </span>
        </div>
        <select
          value={selectedRoot?.path ?? ''}
          onChange={(event) => setRootPath(event.target.value)}
          aria-label="Terminal workspace folder"
          disabled={running || starting}
        >
          {roots.map((root) => (
            <option key={root.path} value={root.path}>
              {root.name}
            </option>
          ))}
        </select>
        {sessions.length > 0 && (
          <select
            value={activeSessionId ?? ''}
            onChange={(event) => setActiveSessionId(event.target.value)}
            aria-label="Terminal session"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {isRunningSession(session) ? '● ' : ''}
                {session.rootName || 'Workspace'} · {compactCommand(session.command)}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => void showGitStatus()}
          disabled={!selectedRoot || running || starting}
        >
          Git status
        </button>
        {runningSession ? (
          <button
            className="danger"
            onClick={() => void cancelRunning()}
            disabled={runningSession.status === 'cancelling'}
          >
            {runningSession.status === 'cancelling' ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button
            onClick={() => terminalRef.current?.clear()}
            disabled={!activeSession}
          >
            Clear view
          </button>
        )}
        <button onClick={onClose} aria-label="Close terminal">×</button>
      </header>

      <div className="workspace-terminal__output workspace-terminal__output--xterm">
        <div ref={terminalHostRef} className="workspace-terminal__xterm" />
        {sessions.length === 0 && (
          <p>Run a command in the selected workspace folder.</p>
        )}
      </div>

      {activeSession && (
        <div className="workspace-terminal__session-status">
          <span>{terminalStatus(activeSession)}</span>
          <span>{activeSession.cwd}</span>
        </div>
      )}

      <form onSubmit={execute}>
        <span aria-hidden="true">$</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={handleHistory}
          placeholder={selectedRoot ? `Run in ${selectedRoot.name}` : 'Open a folder first'}
          aria-label="Terminal command"
          autoComplete="off"
          spellCheck={false}
          disabled={!selectedRoot || running || starting || generating}
        />
        <button
          type="button"
          onClick={() => void generateCommand()}
          disabled={
            !selectedRoot ||
            !command.trim() ||
            running ||
            starting ||
            generating
          }
          title="Generate a command from plain language · ⌘K"
        >
          {generating ? 'Generating…' : 'Generate ⌘K'}
        </button>
        <button
          type="submit"
          disabled={
            !selectedRoot || !command.trim() || running || starting || generating
          }
        >
          {starting ? 'Reviewing…' : 'Run'}
        </button>
      </form>
    </section>
  )
}

function isRunningSession(session: DesktopTerminalSession): boolean {
  return session.status === 'running' || session.status === 'cancelling'
}

function upsertSession(
  sessions: DesktopTerminalSession[],
  session: DesktopTerminalSession
): DesktopTerminalSession[] {
  const remaining = sessions.filter((item) => item.id !== session.id)
  return [session, ...remaining].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt)
  )
}

function loadTerminalHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TERMINAL_HISTORY_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 50)
      : []
  } catch {
    return []
  }
}

function saveTerminalHistory(history: string[]) {
  try {
    localStorage.setItem(TERMINAL_HISTORY_KEY, JSON.stringify(history.slice(0, 50)))
  } catch {
    // Command history remains available for this session.
  }
}

function compactCommand(command: string): string {
  const singleLine = command.replace(/\s+/g, ' ').trim()
  return singleLine.length > 54 ? `${singleLine.slice(0, 51)}…` : singleLine
}

function terminalStatus(session: DesktopTerminalSession): string {
  if (session.status === 'running') return 'Running · terminal input is live'
  if (session.status === 'cancelling') return 'Stopping…'
  if (session.status === 'cancelled') return 'Stopped'
  if (session.status === 'exited') return `Finished · exit ${session.exitCode ?? 0}`
  return `Failed${session.exitCode == null ? '' : ` · exit ${session.exitCode}`}`
}
