import { describe, expect, it } from 'vitest'
import {
  adaptiveDelegationAllowed,
  isSimpleFactLookup,
} from './orchestration'

describe('pragmatic agent routing', () => {
  it.each([
    'What is the capital of France?',
    'Who founded Apple?',
    'How many feet are in a mile?',
    'Define photosynthesis.',
  ])('keeps an atomic fact lookup on the lead agent: %s', (prompt) => {
    expect(isSimpleFactLookup('ask', prompt)).toBe(true)
    expect(adaptiveDelegationAllowed('ask', prompt)).toBe(false)
  })

  it.each([
    'Compare the current agent architectures in Cursor and Claude Code.',
    'Investigate this codebase error and identify the root cause.',
    'Research several sources, then recommend an implementation.',
    'What is the latest guidance for multi-agent coding systems?',
  ])('leaves delegation available for separable investigation: %s', (prompt) => {
    expect(adaptiveDelegationAllowed('ask', prompt)).toBe(true)
  })

  it('leaves implementation and debugging decisions to the lead model', () => {
    expect(adaptiveDelegationAllowed('agent', 'Change this label.')).toBe(true)
    expect(adaptiveDelegationAllowed('debug', 'Why does this fail?')).toBe(true)
  })
})
