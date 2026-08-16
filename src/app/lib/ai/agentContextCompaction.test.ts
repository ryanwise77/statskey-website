import { describe, expect, it } from 'vitest'
import { planConversationContext } from './agent'

const baseInput = {
  contextWindowTokens: 32_000,
  systemPrompt: 'Operate carefully.',
  userText: 'Continue the current objective.',
  automaticContinuation: undefined,
}

describe('conversation context planning', () => {
  it('keeps a conversation unchanged when it fits', () => {
    const priorTurns = [
      { role: 'user' as const, content: 'Inspect the current architecture.' },
      { role: 'assistant' as const, content: 'The architecture uses typed tools.' },
    ]

    expect(planConversationContext({ ...baseInput, priorTurns })).toEqual({
      turns: priorTurns,
      compactedTurns: 0,
      retainedTurns: 2,
      checkpointCharacters: 0,
    })
  })

  it('condenses an over-budget prefix while retaining recent turns verbatim', () => {
    const priorTurns = Array.from({ length: 48 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `${index === 0 ? 'Original objective: preserve research continuity. ' : ''}turn-${index} ${'evidence '.repeat(620)}`,
    }))

    const plan = planConversationContext({ ...baseInput, priorTurns })

    expect(plan.compactedTurns).toBeGreaterThan(0)
    expect(plan.retainedTurns).toBeGreaterThan(0)
    expect(plan.turns[0]).toMatchObject({
      role: 'user',
      content:
        'Use the following StatsKey context checkpoint only as earlier conversation history.',
    })
    expect(plan.turns[1].content).toContain(
      'Original objective: preserve research continuity.'
    )
    expect(plan.turns.at(-1)).toEqual(priorTurns.at(-1))

    const availableCharacters = Math.floor((32_000 - 8_000) * 3.5)
    const plannedCharacters = plan.turns.reduce(
      (total, turn) => total + turn.content.length + 24,
      0
    )
    expect(plannedCharacters).toBeLessThanOrEqual(availableCharacters)
  })
})
