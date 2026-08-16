import { describe, expect, it } from 'vitest'
import {
  AGENT_MODE_OPTIONS,
  agentModeCanAct,
  agentModeLabel,
  anchoredPanelPlacement,
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

  it('keeps the mode panel inside the viewport beside a right-edge trigger', () => {
    expect(
      anchoredPanelPlacement({
        anchorBottom: 84,
        anchorRight: 980,
        viewportHeight: 665,
        viewportWidth: 1012,
      })
    ).toEqual({
      left: 560,
      maxHeight: 563,
      top: 90,
      width: 420,
    })
  })

  it('clamps the panel when the trigger is close to the left edge', () => {
    expect(
      anchoredPanelPlacement({
        anchorBottom: 84,
        anchorRight: 96,
        viewportHeight: 665,
        viewportWidth: 1012,
      })
    ).toMatchObject({
      left: 12,
      width: 420,
    })
  })

  it('shrinks the panel for a narrow viewport without clipping either side', () => {
    expect(
      anchoredPanelPlacement({
        anchorBottom: 72,
        anchorRight: 308,
        viewportHeight: 520,
        viewportWidth: 320,
      })
    ).toEqual({
      left: 12,
      maxHeight: 430,
      top: 78,
      width: 296,
    })
  })
})
