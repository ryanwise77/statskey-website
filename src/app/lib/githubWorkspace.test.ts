import { describe, expect, it, vi } from 'vitest'

// gitBlobSha never touches Firebase; mock the module so importing
// githubWorkspace does not initialize the Firebase app in tests.
vi.mock('./firebase', () => ({ auth: { currentUser: null } }))

import { gitBlobSha } from './githubWorkspace'

describe('gitBlobSha', () => {
  it('matches git hash-object for text content', async () => {
    expect(await gitBlobSha('hello world')).toBe(
      '95d09f2b10159347eece71399a7e2e907ea3df4f'
    )
  })

  it('matches git hash-object for empty content', async () => {
    expect(await gitBlobSha('')).toBe(
      'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
    )
  })
})
