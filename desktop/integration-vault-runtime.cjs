const {
  sanitizeMcpOAuthState,
} = require('./mcp-oauth-runtime.cjs')

const REMOTE_INTEGRATION_AUTH_TYPES = new Set(['none', 'bearer', 'oauth'])

function sanitizeRemoteIntegration(input, existing = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Connection settings are invalid.')
  }
  const name = boundedText(input.name, 80)
  if (!name) throw new Error('Connection name is required.')

  const url = validatedRemoteMcpUrl(input.url)
  const authType = REMOTE_INTEGRATION_AUTH_TYPES.has(input.authType)
    ? input.authType
    : 'none'
  const submittedToken = boundedText(input.token, 16_384)
  const token =
    authType === 'bearer'
      ? submittedToken || boundedText(existing.token, 16_384)
      : ''
  if (authType === 'bearer' && !token) {
    throw new Error('Paste the bearer or access token for this connection.')
  }
  const submittedOauth =
    authType === 'oauth' && input.oauth
      ? sanitizeMcpOAuthState(input.oauth)
      : null
  const oauth =
    submittedOauth ||
    (authType === 'oauth' &&
    existing.authType === 'oauth' &&
    existing.url === url &&
    existing.oauth
      ? sanitizeMcpOAuthState(existing.oauth)
      : null)

  return {
    name,
    url,
    authType,
    ...(token ? { token } : {}),
    ...(oauth ? { oauth } : {}),
  }
}

function validatedRemoteMcpUrl(value) {
  const raw = boundedText(value, 4_096)
  if (!raw) throw new Error('A remote MCP endpoint is required.')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Enter a valid remote MCP endpoint.')
  }
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Remote MCP endpoints must use HTTPS. Localhost may use HTTP.')
  }
  if (url.username || url.password) {
    throw new Error('Put credentials in the authorization field, not the endpoint URL.')
  }
  url.hash = ''
  return url.toString()
}

function integrationMetadataForConfig(config) {
  return {
    configured: true,
    name: config.name,
    url: config.url,
    authType: config.authType,
    credentials: {
      token: config.authType === 'bearer' && Boolean(config.token),
      oauth:
        config.authType === 'oauth' &&
        Boolean(config.oauth?.tokens?.access_token),
    },
  }
}

function integrationStatusFromEntry(id, entry) {
  const metadata =
    entry?.metadata != null &&
    typeof entry.metadata === 'object' &&
    !Array.isArray(entry.metadata)
      ? entry.metadata
      : {}
  const hasCiphertext =
    typeof entry?.ciphertext === 'string' && entry.ciphertext.length > 0
  return {
    id,
    name: boundedText(metadata.name, 80) || 'Connected tool',
    url: publicEndpoint(metadata.url),
    authType: ['bearer', 'oauth'].includes(metadata.authType)
      ? metadata.authType
      : 'none',
    configured: hasCiphertext && metadata.configured !== false,
    credentials: {
      token: metadata.credentials?.token === true,
      oauth: metadata.credentials?.oauth === true,
    },
    updatedAt:
      typeof entry?.updatedAt === 'string' ? entry.updatedAt : null,
  }
}

function mcpConfigForIntegration(config) {
  return {
    url: config.url,
    type: 'http',
    headers:
      config.authType === 'bearer' && config.token
        ? { Authorization: `Bearer ${config.token}` }
        : {},
    ...(config.authType === 'oauth' && config.oauth
      ? { oauth: sanitizeMcpOAuthState(config.oauth) }
      : {}),
  }
}

function serverNameForIntegration(id, name) {
  const safeName =
    String(name || 'service')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'service'
  const safeId = String(id || '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
  return `connected-${safeName}${safeId ? `-${safeId}` : ''}`
}

function validIntegrationId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
}

function publicEndpoint(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function boundedText(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

module.exports = {
  integrationMetadataForConfig,
  integrationStatusFromEntry,
  mcpConfigForIntegration,
  sanitizeRemoteIntegration,
  serverNameForIntegration,
  validIntegrationId,
  validatedRemoteMcpUrl,
}
