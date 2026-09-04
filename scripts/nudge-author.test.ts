import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasNudgeAuthorClaims,
  isNudgeAuthorIdentifier,
} from '../src/app/lib/nudgeAuthor.ts'

describe('Miller author sign-in', () => {
  it('recognizes both existing identifiers without changing ordinary email sign-in', () => {
    for (const identifier of ['miller', ' Miller ', 'MILLER@statskeybiometrics.com']) {
      assert.equal(isNudgeAuthorIdentifier(identifier), true)
    }
    for (const identifier of ['', 'miller@example.com', 'ryan@statskeybiometrics.com']) {
      assert.equal(isNudgeAuthorIdentifier(identifier), false)
    }
  })

  it('accepts the backend author claim contract, including its numeric version coercion', () => {
    const claims = {
      src: 'miller_nudge_author',
      nudgeAuthor: true,
      nudgeAuthorVersion: 1,
      nudgeAuthorId: 'miller',
    }
    assert.equal(hasNudgeAuthorClaims(claims), true)
    assert.equal(hasNudgeAuthorClaims({ ...claims, nudgeAuthorVersion: '1' }), true)
    for (const field of Object.keys(claims)) {
      const incomplete: Record<string, unknown> = { ...claims }
      delete incomplete[field]
      assert.equal(hasNudgeAuthorClaims(incomplete), false, `Missing ${field}`)
    }
    for (const replacement of [
      { src: 'miller_demo_access' },
      { nudgeAuthor: 'true' },
      { nudgeAuthorVersion: 2 },
      { nudgeAuthorId: 'another-author' },
    ]) {
      assert.equal(hasNudgeAuthorClaims({ ...claims, ...replacement }), false)
    }
    assert.equal(hasNudgeAuthorClaims({}), false)
  })
})
