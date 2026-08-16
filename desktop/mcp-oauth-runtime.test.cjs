const assert = require('node:assert/strict')
const test = require('node:test')
const {
  PersistentMcpOAuthProvider,
  createLoopbackOAuthCallback,
  sanitizeMcpOAuthState,
  validateOAuthCallback,
  validatedOAuthAuthorizationUrl,
} = require('./mcp-oauth-runtime.cjs')

test('OAuth provider keeps reusable credentials and generates CSRF state', async () => {
  const changes = []
  const redirects = []
  const provider = new PersistentMcpOAuthProvider({
    redirectUrl: 'http://127.0.0.1:43191/oauth/callback',
    state: {},
    onStateChange: (state) => changes.push(state),
    onRedirect: (url) => redirects.push(url.toString()),
  })
  const state = provider.state()
  await provider.saveCodeVerifier('v'.repeat(64))
  await provider.saveClientInformation({ client_id: 'statskey-client' })
  await provider.saveTokens({
    access_token: 'access',
    refresh_token: 'refresh',
    token_type: 'Bearer',
  })
  await provider.redirectToAuthorization(
    new URL(`https://accounts.example.com/authorize?state=${state}`)
  )

  assert.equal(provider.expectedState(), state)
  assert.equal(provider.codeVerifier(), 'v'.repeat(64))
  assert.equal(provider.clientInformation().client_id, 'statskey-client')
  assert.equal(provider.tokens().refresh_token, 'refresh')
  assert.equal(redirects.length, 1)
  assert.equal(changes.length >= 4, true)
  assert.equal(provider.snapshot().codeVerifier, undefined)
  assert.equal(provider.snapshot().expectedState, undefined)
})

test('OAuth callback validates state, code, and provider cancellation', () => {
  const valid = new URL(
    'http://127.0.0.1/oauth/callback?code=code-1&state=state-12345678901234567890'
  )
  assert.equal(
    validateOAuthCallback(valid, 'state-12345678901234567890'),
    'code-1'
  )
  assert.throws(
    () => validateOAuthCallback(valid, 'different-state-123456789012345'),
    /did not match/
  )
  assert.throws(
    () =>
      validateOAuthCallback(
        new URL(
          'http://127.0.0.1/oauth/callback?error=access_denied&state=state-12345678901234567890'
        ),
        'state-12345678901234567890'
      ),
    /denied or cancelled/
  )
})

test('OAuth authorization URLs require HTTPS except for loopback development', () => {
  assert.equal(
    validatedOAuthAuthorizationUrl(
      'https://accounts.example.com/oauth/authorize'
    ).protocol,
    'https:'
  )
  assert.equal(
    validatedOAuthAuthorizationUrl(
      'http://127.0.0.1:9191/oauth/authorize'
    ).hostname,
    '127.0.0.1'
  )
  assert.throws(
    () => validatedOAuthAuthorizationUrl('http://accounts.example.com/oauth'),
    /must use HTTPS/
  )
})

test('OAuth state sanitizer rejects oversized credential responses', () => {
  assert.deepEqual(
    sanitizeMcpOAuthState({
      redirectUrl: 'http://127.0.0.1:43191/oauth/callback',
      tokens: { access_token: 'secret', token_type: 'Bearer' },
      ignored: 'value',
    }),
    {
      redirectUrl: 'http://127.0.0.1:43191/oauth/callback',
      tokens: { access_token: 'secret', token_type: 'Bearer' },
    }
  )
  assert.throws(
    () =>
      sanitizeMcpOAuthState({
        tokens: { access_token: 'x'.repeat(300_000) },
      }),
    /too large/
  )
})

test('loopback callback accepts one browser authorization response', async () => {
  const callback = await createLoopbackOAuthCallback({
    timeoutMilliseconds: 30_000,
  })
  try {
    const state = 'state-12345678901234567890'
    const response = await fetch(
      `${callback.redirectUrl}?code=code-2&state=${state}`
    )
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Connected to StatsKey/)
    const returned = await callback.waitForCallback()
    assert.equal(validateOAuthCallback(returned, state), 'code-2')
  } finally {
    await callback.close()
  }
})
