import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_WELCOME_COPY,
  WORKSPACE_WELCOME_SUGGESTIONS,
} from './workspaceWelcome'

describe('workspace welcome', () => {
  it('asks what to build without assuming a software-engineering task', () => {
    const visibleCopy = [
      WORKSPACE_WELCOME_COPY.heading,
      WORKSPACE_WELCOME_COPY.description,
      WORKSPACE_WELCOME_COPY.control,
      ...WORKSPACE_WELCOME_SUGGESTIONS.flatMap(({ title, description }) => [
        title,
        description,
      ]),
    ].join(' ')

    expect(WORKSPACE_WELCOME_COPY.heading).toBe('What moves this forward?')
    expect(visibleCopy).toMatch(/outcome/i)
    expect(visibleCopy).not.toMatch(
      /\b(?:architecture|codebase|engineer|git|repository|diff)\b/i
    )
  })

  it('starts with discovery before choosing a direction or taking action', () => {
    expect(WORKSPACE_WELCOME_SUGGESTIONS.map(({ title }) => title)).toEqual([
      'Make something',
      'Fix what is stuck',
      'Understand the work',
    ])

    for (const suggestion of WORKSPACE_WELCOME_SUGGESTIONS) {
      expect(suggestion.prompt).toMatch(/\bask(?:ing)?\b/i)
      expect(suggestion.prompt).toMatch(/do not make changes yet/i)
      expect(suggestion.mode).toBe('ask')
    }
  })
})
