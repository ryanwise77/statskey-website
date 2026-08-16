import type { DesktopDeviceAction } from './desktop'

export interface DesktopDeviceEvidenceEvent {
  id: string
  at: number
  deviceId: string
  action: DesktopDeviceAction
  ok: boolean
  cancelled?: boolean
  marker?: string
  appId?: string
  alive?: boolean
  crashFree?: boolean
  crashMarkers?: string[]
  error?: string
}

export interface DesktopDeviceRunProof {
  ready: boolean
  label: string
  launch?: DesktopDeviceEvidenceEvent
  verification?: DesktopDeviceEvidenceEvent
}

/**
 * A launch is not proof by itself. The renderer only calls a device run
 * verified when a later inspect/process/log action explicitly reports a live,
 * crash-free app and no later device action contradicts that result.
 */
export function desktopDeviceRunProof(
  events: readonly DesktopDeviceEvidenceEvent[],
  deviceId: string,
  appId?: string
): DesktopDeviceRunProof {
  const relevant = events.filter(
    (event) =>
      event.deviceId === deviceId &&
      (!appId || !event.appId || event.appId === appId)
  )
  let launchIndex = -1
  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const event = relevant[index]
    if (event.action === 'launch' && event.ok && !event.cancelled) {
      launchIndex = index
      break
    }
  }
  if (launchIndex < 0) return { ready: false, label: 'App not launched' }
  const launch = relevant[launchIndex]
  const afterLaunch = relevant.slice(launchIndex + 1)
  const contradiction = afterLaunch.find(
    (event) =>
      !event.ok ||
      event.cancelled ||
      event.alive === false ||
      event.crashFree === false ||
      (event.crashMarkers?.length ?? 0) > 0
  )
  if (contradiction) {
    return {
      ready: false,
      label: contradiction.error || 'A later device check found a failure',
      launch,
      verification: contradiction,
    }
  }
  let verification: DesktopDeviceEvidenceEvent | undefined
  for (let index = afterLaunch.length - 1; index >= 0; index -= 1) {
    const event = afterLaunch[index]
    if (
      (event.action === 'inspect' ||
        event.action === 'process' ||
        event.action === 'logs') &&
      event.ok &&
      event.alive === true &&
      event.crashFree === true &&
      (event.crashMarkers?.length ?? 0) === 0
    ) {
      verification = event
      break
    }
  }
  return verification
    ? {
        ready: true,
        label: 'Launch and post-launch crash check passed',
        launch,
        verification,
      }
    : {
        ready: false,
        label: 'Run a post-launch process, inspect, or log check',
        launch,
      }
}
