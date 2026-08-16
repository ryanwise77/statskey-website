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
    description: 'Choose the simplest capable mode from your request.',
  },
  {
    value: 'ask',
    label: 'Ask',
    description: 'Research and answer without changing anything.',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Investigate and create an editable plan.',
  },
  {
    value: 'debug',
    label: 'Fix',
    description: 'Diagnose a specific problem, then repair and verify it.',
  },
  {
    value: 'agent',
    label: 'Execute',
    description: 'Complete the requested work and verify the result.',
  },
] as const

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
