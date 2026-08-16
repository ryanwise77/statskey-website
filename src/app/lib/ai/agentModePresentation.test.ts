import { describe, expect, it } from 'vitest'
import {
  AGENT_MODE_OPTIONS,
  agentModeCanAct,
  agentModeLabel,
  resolvedModeNeedsActionPermission,
} from './agentModePresentation'

describe('agent mode presentation', () => {
  it('presents agent mode as Execute without changing its stored value', () => {
    expect(agentModeLabel('agent')).toBe('Execute')
    expect(AGENT_MODE_OPTIONS.at(-1)).toMatchObject({
      value: 'agent',
      label: 'Execute',
    })
  })

  it('requests standing permission only for resolved action modes', () => {
    expect(resolvedModeNeedsActionPermission('ask')).toBe(false)
    expect(resolvedModeNeedsActionPermission('plan')).toBe(false)
    expect(resolvedModeNeedsActionPermission('debug')).toBe(true)
    expect(resolvedModeNeedsActionPermission('agent')).toBe(true)
    expect(agentModeCanAct('auto')).toBe(true)
  })
})
