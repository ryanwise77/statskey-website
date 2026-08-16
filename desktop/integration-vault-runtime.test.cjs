const test = require('node:test')
const assert = require('node:assert/strict')
const {
  integrationMetadataForConfig,
  integrationStatusFromEntry,
  mcpConfigForIntegration,
  sanitizeRemoteIntegration,
  serverNameForIntegration,
  validatedRemoteMcpUrl,
} = require('./integration-vault-runtime.cjs')

test('remote integrations require HTTPS except for local development', () => {
  assert.equal(
    validatedRemoteMcpUrl('https://tools.example.com/mcp'),
    'https://tools.example.com/mcp'
  )
  assert.equal(
    validatedRemoteMcpUrl('http://localhost:43129/mcp'),
    'http://localhost:43129/mcp'
  )
  assert.throws(
    () => validatedRemoteMcpUrl('http://tools.example.com/mcp'),
    /must use HTTPS/
  )
  assert.throws(
    () => validatedRemoteMcpUrl('https://token@tools.example.com/mcp'),
    /authorization field/
  )
})

test('saving a bearer connection preserves its one-time token on updates', () => {
  assert.deepEqual(
    sanitizeRemoteIntegration(
      {
        name: 'Linear',
        url: 'https://mcp.example.com/linear',
        authType: 'bearer',
        token: '',
      },
      { token: 'stored-token' }
    ),
    {
      name: 'Linear',
      url: 'https://mcp.example.com/linear',
      authType: 'bearer',
      token: 'stored-token',
    }
  )
})

test('OAuth connections preserve encrypted credentials only for the same endpoint', () => {
  const existing = {
    name: 'Linear',
    url: 'https://mcp.example.com/linear',
    authType: 'oauth',
    oauth: {
      redirectUrl: 'http://127.0.0.1:43191/oauth/callback',
      tokens: { access_token: 'stored-access', token_type: 'Bearer' },
    },
  }
  assert.equal(
    sanitizeRemoteIntegration(
      {
        name: 'Linear',
        url: existing.url,
        authType: 'oauth',
      },
      existing
    ).oauth.tokens.access_token,
    'stored-access'
  )
  assert.equal(
    sanitizeRemoteIntegration(
      {
        name: 'Linear',
        url: 'https://other.example.com/mcp',
        authType: 'oauth',
      },
      existing
    ).oauth,
    undefined
  )
})

test('public status never exposes bearer tokens or URL query values', () => {
  const config = {
    name: 'Project tools',
    url: 'https://tools.example.com/mcp?private=1',
    authType: 'bearer',
    token: 'secret-token',
  }
  const metadata = integrationMetadataForConfig(config)
  const status = integrationStatusFromEntry('connection_1', {
    ciphertext: 'encrypted',
    updatedAt: '2026-08-15T20:00:00.000Z',
    metadata,
  })

  assert.equal(JSON.stringify(metadata).includes('secret-token'), false)
  assert.equal(status.url, 'https://tools.example.com/mcp')
  assert.equal(status.credentials.token, true)
  assert.equal(status.credentials.oauth, false)
})

test('MCP configuration receives the secret only as an authorization header', () => {
  assert.deepEqual(
    mcpConfigForIntegration({
      name: 'Notion',
      url: 'https://tools.example.com/notion',
      authType: 'bearer',
      token: 'stored-token',
    }),
    {
      url: 'https://tools.example.com/notion',
      type: 'http',
      headers: { Authorization: 'Bearer stored-token' },
    }
  )
  assert.match(serverNameForIntegration('abcdef123456', 'Notion & Docs'), /^connected-notion-docs-/)
})

test('OAuth MCP configuration exposes only encrypted-vault state to the transport', () => {
  const config = mcpConfigForIntegration({
    name: 'Linear',
    url: 'https://mcp.example.com/linear',
    authType: 'oauth',
    oauth: {
      redirectUrl: 'http://127.0.0.1:43191/oauth/callback',
      tokens: {
        access_token: 'stored-access',
        refresh_token: 'stored-refresh',
        token_type: 'Bearer',
      },
    },
  })
  assert.equal(config.headers.Authorization, undefined)
  assert.equal(config.oauth.tokens.refresh_token, 'stored-refresh')
})
