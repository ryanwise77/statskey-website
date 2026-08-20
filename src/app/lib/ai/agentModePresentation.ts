import type { AgentModeSelection } from './agentPersistence'

export interface AgentModeOption {
  value: AgentModeSelection
  label: string
  description: string
}

export const AGENT_MODE_OPTIONS: readonly AgentModeOption[] = [
  {
    value: 'auto',
    label: 'Automatic',
    description: 'Tell StatsKey what you need. It chooses the safest capable approach.',
  },
  {
    value: 'ask',
    label: 'Ask',
    description: 'Research and explain. Nothing will be changed.',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Create an editable step-by-step plan. Nothing will be changed.',
  },
  {
    value: 'debug',
    label: 'Fix',
    description: 'Find the cause, make the repair, and verify the result.',
  },
  {
    value: 'agent',
    label: 'Execute',
    description: 'Complete the task, make the needed changes, and verify it.',
  },
] as const

export interface AnchoredPanelPlacementInput {
  anchorBottom: number
  anchorRight: number
  viewportHeight: number
  viewportWidth: number
  preferredWidth?: number
  gap?: number
  margin?: number
}

export interface AnchoredPanelPlacement {
  left: number
  maxHeight: number
  top: number
  width: number
}

export function anchoredPanelPlacement({
  anchorBottom,
  anchorRight,
  viewportHeight,
  viewportWidth,
  preferredWidth = 420,
  gap = 6,
  margin = 12,
}: AnchoredPanelPlacementInput): AnchoredPanelPlacement {
  const width = Math.max(0, Math.min(preferredWidth, viewportWidth - margin * 2))
  const left = Math.max(
    margin,
    Math.min(anchorRight - width, viewportWidth - width - margin)
  )
  const top = Math.max(
    margin,
    Math.min(anchorBottom + gap, viewportHeight - margin)
  )

  return {
    left,
    maxHeight: Math.max(0, viewportHeight - top - margin),
    top,
    width,
  }
}

export function agentModeLabel(
  mode: AgentModeSelection | 'ask' | 'plan' | 'debug' | 'agent'
): string {
  return AGENT_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Automatic'
}

export function agentModeCanAct(mode: AgentModeSelection): boolean {
  return mode === 'auto' || mode === 'debug' || mode === 'agent'
}

export function resolvedModeNeedsActionPermission(
  mode: 'ask' | 'plan' | 'debug' | 'agent'
): boolean {
  return mode === 'debug' || mode === 'agent'
}
