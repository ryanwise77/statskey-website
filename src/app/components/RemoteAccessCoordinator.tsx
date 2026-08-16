import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  getDesktopBridge,
  type DesktopFounderResult,
  type DesktopFounderState,
} from '../lib/desktop'
import {
  claimRemoteCommand,
  completeRemoteCommand,
  DEFAULT_REMOTE_ACCESS_PREFERENCES,
  getOrCreateRemoteExecutorId,
  heartbeatRemoteExecutor,
  stageRemoteAgentCommand,
  subscribeRemoteAccessPreferences,
  subscribeRemoteCommands,
  type RemoteAccessPreferences,
  type RemoteAccessTarget,
  type RemoteCommand,
} from '../lib/remoteAccess'

const EXECUTOR_LABEL = 'StatsKey Desktop'

export function RemoteAccessCoordinator() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const bridge = getDesktopBridge()
  const enabledHere = bridge?.founderMode === true && bridge.founder != null
  const executorId = useMemo(
    () => (enabledHere ? getOrCreateRemoteExecutorId() : ''),
    [enabledHere]
  )
  const [preferences, setPreferences] = useState<RemoteAccessPreferences>(
    DEFAULT_REMOTE_ACCESS_PREFERENCES
  )
  const [commands, setCommands] = useState<RemoteCommand[]>([])
  const claimedIds = useRef(new Set<string>())

  useEffect(() => {
    if (!enabledHere || !user) {
      setPreferences(DEFAULT_REMOTE_ACCESS_PREFERENCES)
      setCommands([])
      return
    }
    const stopPreferences = subscribeRemoteAccessPreferences(
      user.uid,
      setPreferences
    )
    const stopCommands = subscribeRemoteCommands(user.uid, setCommands)
    return () => {
      stopPreferences()
      stopCommands()
    }
  }, [enabledHere, user])

  useEffect(() => {
    if (!enabledHere || !user || !preferences.enabled || !executorId) return
    const capabilities: RemoteAccessTarget[] = [
      ...(preferences.allowMacMini ? (['mac-mini'] as const) : []),
      ...(preferences.allowDataCenter ? (['data-center'] as const) : []),
    ]
    if (capabilities.length === 0) return
    const heartbeat = () =>
      heartbeatRemoteExecutor({
        executorId,
        label: EXECUTOR_LABEL,
        capabilities,
      }).catch(() => {})
    void heartbeat()
    const timer = window.setInterval(heartbeat, 60_000)
    return () => window.clearInterval(timer)
  }, [
    enabledHere,
    executorId,
    preferences.allowDataCenter,
    preferences.allowMacMini,
    preferences.enabled,
    user,
  ])

  useEffect(() => {
    if (!enabledHere || !preferences.enabled || !executorId) return
    const next = [...commands]
      .reverse()
      .find(
        (command) =>
          command.status === 'queued' && !claimedIds.current.has(command.id)
      )
    if (!next) return
    claimedIds.current.add(next.id)
    void executeCommand(next).catch(() => {
      claimedIds.current.delete(next.id)
    })

    async function executeCommand(command: RemoteCommand) {
      const claim = await claimRemoteCommand(
        command.id,
        executorId,
        EXECUTOR_LABEL
      )
      if (
        claim.status !== 'running' ||
        !claim.claimToken ||
        !claim.command
      ) {
        return
      }
      try {
        if (claim.command.kind === 'status.check') {
          const founder = getDesktopBridge()?.founder
          if (!founder) {
            throw new RemoteExecutionError(
              'executor_unavailable',
              'Private Desktop controls are unavailable on this computer.'
            )
          }
          const state = await founder.state()
          const connectivity =
            claim.command.target === 'mac-mini'
              ? await founder.runCheck('macremote-connectivity')
              : undefined
          await completeRemoteCommand({
            commandId: claim.commandId,
            executorId,
            claimToken: claim.claimToken,
            status: 'succeeded',
            summary: statusSummary(
              claim.command.target,
              state,
              connectivity
            ),
          })
          return
        }

        const prompt = claim.command.prompt?.trim()
        if (!prompt) {
          throw new RemoteExecutionError(
            'invalid_prompt',
            'The remote prompt was empty.'
          )
        }
        if (claim.command.target === 'data-center') {
          const workspaceResult = await getDesktopBridge()?.founder?.perform(
            'open-oil-workspace'
          )
          if (workspaceResult && !workspaceResult.ok) {
            throw new RemoteExecutionError(
              'workspace_unavailable',
              workspaceResult.error || 'The Oil Data workspace is unavailable.'
            )
          }
        }
        const sessionId = `REMOTE-${crypto.randomUUID().toUpperCase()}`
        stageRemoteAgentCommand({
          commandId: claim.commandId,
          executorId,
          claimToken: claim.claimToken,
          target: claim.command.target,
          prompt,
          sessionId,
        })
        navigate(
          `/flow?session=${encodeURIComponent(sessionId)}&scope=work&remote=1`
        )
      } catch (error) {
        const failure =
          error instanceof RemoteExecutionError
            ? error
            : new RemoteExecutionError(
                'desktop_error',
                error instanceof Error
                  ? error.message
                  : 'Desktop could not run the remote command.'
              )
        await completeRemoteCommand({
          commandId: claim.commandId,
          executorId,
          claimToken: claim.claimToken,
          status: 'failed',
          summary: failure.message,
          errorCode: failure.code,
        })
      }
    }
  }, [
    commands,
    enabledHere,
    executorId,
    navigate,
    preferences.enabled,
  ])

  return null
}

export function statusSummary(
  target: RemoteAccessTarget,
  state: DesktopFounderState,
  connectivity?: DesktopFounderResult
): string {
  if (!state.available) {
    return state.error || 'Private infrastructure controls are unavailable.'
  }
  if (target === 'mac-mini') {
    const mac = state.services?.macMini
    const configured =
      state.readiness?.macRemoteExecutable?.available === true &&
      state.readiness?.macRemoteConfig?.available === true
    return [
      `MacRemote ${configured ? 'is configured' : 'still needs setup'}.`,
      connectivity
        ? `Encrypted remote SSH is ${connectivity.ok ? 'reachable' : 'not reachable right now'}.`
        : `SSH is ${mac?.sshOnline ? 'reachable' : 'offline'}.`,
      `Screen Sharing is ${mac?.screenOnline ? 'reachable' : 'offline'}.`,
    ].join(' ')
  }
  const trueNas = state.services?.trueNas?.online === true
  const idrac = state.services?.idrac?.online === true
  const gpu = state.services?.gpu
  return [
    `Oil storage is ${state.storage?.mounted ? 'mounted' : 'not mounted'}.`,
    `TrueNAS is ${trueNas ? 'online' : 'offline'}.`,
    `iDRAC is ${idrac ? 'online' : 'offline'}.`,
    gpu?.configured
      ? `The GPU workstation is ${gpu.online ? 'online' : 'offline'}.`
      : 'The GPU workstation is not configured yet.',
  ].join(' ')
}

class RemoteExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}
