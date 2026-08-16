import { describe, expect, it } from 'vitest'
import {
  isNearOutputBottom,
  nextFollowOutputState,
} from './useFollowOutput'

describe('isNearOutputBottom', () => {
  it('keeps following at the bottom', () => {
    expect(isNearOutputBottom(1_000, 600, 400)).toBe(true)
  })

  it('keeps following within the bottom tolerance', () => {
    expect(isNearOutputBottom(1_000, 540, 400)).toBe(true)
  })

  it('pauses following when the reader scrolls up', () => {
    expect(isNearOutputBottom(1_000, 500, 400)).toBe(false)
  })

  it('respects a caller-provided tolerance', () => {
    expect(isNearOutputBottom(1_000, 500, 400, 100)).toBe(true)
  })
})

describe('nextFollowOutputState', () => {
  it('stays settled when a small upward movement remains near the bottom', () => {
    expect(nextFollowOutputState({
      wasFollowing: true,
      previousScrollTop: 540,
      scrollTop: 535,
      scrollHeight: 1_000,
      clientHeight: 400,
    })).toBe(true)
  })

  it('stays paused while output grows above the reader', () => {
    expect(nextFollowOutputState({
      wasFollowing: false,
      previousScrollTop: 500,
      scrollTop: 500,
      scrollHeight: 1_200,
      clientHeight: 400,
    })).toBe(false)
  })

  it('resumes when the reader manually returns to the bottom', () => {
    expect(nextFollowOutputState({
      wasFollowing: false,
      previousScrollTop: 500,
      scrollTop: 800,
      scrollHeight: 1_200,
      clientHeight: 400,
    })).toBe(true)
  })
})
