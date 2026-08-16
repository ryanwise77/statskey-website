const crypto = require('node:crypto')
const http = require('node:http')

const MAX_OAUTH_STATE_BYTES = 256 * 1024

class PersistentMcpOAuthProvider {
  constructor(options = {}) {
    this.redirectUrl = validatedLoopbackRedirectUrl(options.redirectUrl)
    this.clientMetadata = {
      client_name: 'StatsKey Desktop',
      client_uri: 'https://statskey.ai',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
    this.onRedirect =
      typeof options.onRedirect === 'function'
        ? options.onRedirect
        : () => {
            throw new Error(
              'This connection needs browser authorization again. Reconnect it in Settings.'
            )
          }
    this.onStateChange =
      typeof options.onStateChange === 'function'
        ? options.onStateChange
        : async () => {}
    this.data = sanitizeMcpOAuthState(options.state)
    if (
      this.data.redirectUrl &&
      this.data.redirectUrl !== this.redirectUrl &&
      options.preserveRegistration !== true
    ) {
      delete this.data.clientInformation
    }
    this.data.redirectUrl = this.redirectUrl
    this.authorizationStarted = false
  }

  state() {
    const state = crypto.randomBytes(32).toString('base64url')
    this.data.expectedState = state
    return state
  }

  clientInformation() {
    return this.data.clientInformation
  }

  async saveClientInformation(clientInformation) {
    this.data.clientInformation = serializableObject(clientInformation)
    await this.changed()
  }

  tokens() {
    return this.data.tokens
  }

  async saveTokens(tokens) {
    this.data.tokens = serializableObject(tokens)
    await this.changed()
  }

  async redirectToAuthorization(authorizationUrl) {
    const url = validatedOAuthAuthorizationUrl(authorizationUrl)
    this.authorizationStarted = true
    await this.changed()
    await this.onRedirect(url)
  }

  async saveCodeVerifier(codeVerifier) {
    if (
      typeof codeVerifier !== 'string' ||
      codeVerifier.length < 32 ||
      codeVerifier.length > 256
    ) {
      throw new Error('The OAuth verifier is invalid.')
    }
    this.data.codeVerifier = codeVerifier
    await this.changed()
  }

  codeVerifier() {
    if (!this.data.codeVerifier) {
      throw new Error('The OAuth verifier is unavailable. Start authorization again.')
    }
    return this.data.codeVerifier
  }

  async saveDiscoveryState(discoveryState) {
    this.data.discoveryState = serializableObject(discoveryState)
    await this.changed()
  }

  discoveryState() {
    return this.data.discoveryState
  }

  async invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') {
      delete this.data.clientInformation
    }
    if (scope === 'all' || scope === 'tokens') delete this.data.tokens
    if (scope === 'all' || scope === 'verifier') {
      delete this.data.codeVerifier
      delete this.data.expectedState
    }
    if (scope === 'all' || scope === 'discovery') {
      delete this.data.discoveryState
    }
    await this.changed()
  }

  expectedState() {
    return this.data.expectedState || null
  }

  snapshot({ includeTransient = false } = {}) {
    const snapshot = sanitizeMcpOAuthState(this.data)
    if (!includeTransient) {
      delete snapshot.codeVerifier
      delete snapshot.expectedState
    }
    return snapshot
  }

  async changed() {
    await this.onStateChange(this.snapshot({ includeTransient: true }))
  }
}

async function createLoopbackOAuthCallback(options = {}) {
  const timeoutMilliseconds = Number.isFinite(options.timeoutMilliseconds)
    ? Math.max(30_000, Math.min(10 * 60_000, options.timeoutMilliseconds))
    : 4 * 60_000
  let settle
  let rejectCallback
  let timer
  let settled = false
  const callback = new Promise((resolve, reject) => {
    settle = resolve
    rejectCallback = reject
  })
  const server = http.createServer((request, response) => {
    const host = request.headers.host || '127.0.0.1'
    const callbackUrl = new URL(request.url || '/', `http://${host}`)
    if (
      request.method !== 'GET' ||
      callbackUrl.pathname !== '/oauth/callback'
    ) {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      response.end('Not found')
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(oauthCompletionHtml())
    if (!settled) {
      settled = true
      clearTimeout(timer)
      settle(callbackUrl)
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('StatsKey could not start the secure OAuth callback.')
  }
  timer = setTimeout(() => {
    if (settled) return
    settled = true
    rejectCallback(new Error('Browser authorization timed out. Try connecting again.'))
    server.close()
  }, timeoutMilliseconds)
  timer.unref?.()

  return {
    redirectUrl: `http://127.0.0.1:${address.port}/oauth/callback`,
    waitForCallback() {
      return callback
    },
    close() {
      clearTimeout(timer)
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

function validateOAuthCallback(callbackUrl, expectedState) {
  const error = callbackUrl.searchParams.get('error')
  if (error) {
    throw new Error('Authorization was denied or cancelled by the provider.')
  }
  const state = callbackUrl.searchParams.get('state')
  if (
    typeof expectedState !== 'string' ||
    expectedState.length < 20 ||
    state !== expectedState
  ) {
    throw new Error('The OAuth callback did not match this connection attempt.')
  }
  const code = callbackUrl.searchParams.get('code')
  if (!code || code.length > 16_384) {
    throw new Error('The provider did not return a valid authorization code.')
  }
  return code
}

function sanitizeMcpOAuthState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const copy = serializableObject(value)
  const encoded = JSON.stringify(copy)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_OAUTH_STATE_BYTES) {
    throw new Error('The OAuth credential response is too large to store.')
  }
  const sanitized = {}
  if (typeof copy.redirectUrl === 'string') {
    sanitized.redirectUrl = validatedLoopbackRedirectUrl(copy.redirectUrl)
  }
  if (copy.clientInformation && typeof copy.clientInformation === 'object') {
    sanitized.clientInformation = copy.clientInformation
  }
  if (copy.tokens && typeof copy.tokens === 'object') {
    sanitized.tokens = copy.tokens
  }
  if (typeof copy.codeVerifier === 'string') {
    sanitized.codeVerifier = copy.codeVerifier.slice(0, 256)
  }
  if (typeof copy.expectedState === 'string') {
    sanitized.expectedState = copy.expectedState.slice(0, 256)
  }
  if (copy.discoveryState && typeof copy.discoveryState === 'object') {
    sanitized.discoveryState = copy.discoveryState
  }
  return sanitized
}

function validatedLoopbackRedirectUrl(value) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw new Error('The OAuth callback URL is invalid.')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/oauth/callback' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('OAuth callbacks must use StatsKey’s local loopback address.')
  }
  return url.toString()
}

function validatedOAuthAuthorizationUrl(value) {
  const url = value instanceof URL ? new URL(value) : new URL(String(value))
  const local =
    ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) &&
    url.protocol === 'http:'
  if (url.protocol !== 'https:' && !local) {
    throw new Error('OAuth authorization pages must use HTTPS.')
  }
  if (url.username || url.password) {
    throw new Error('The OAuth authorization URL contains embedded credentials.')
  }
  return url
}

function serializableObject(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    throw new Error('The OAuth credential response could not be stored safely.')
  }
}

function oauthCompletionHtml() {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connected to StatsKey</title>
<style>
body{margin:0;background:#f5f8fc;color:#14233a;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:520px;margin:12vh auto;background:#fff;border:1px solid #dce5f0;border-radius:18px;padding:30px;box-shadow:0 18px 60px #203b651c}
b{display:block;font-size:22px;margin-bottom:8px}p{color:#617087;margin:0}
</style>
<main><b>Connected to StatsKey</b><p>Authorization is complete. You can close this page and return to the desktop app.</p></main>
</html>`
}

module.exports = {
  PersistentMcpOAuthProvider,
  createLoopbackOAuthCallback,
  sanitizeMcpOAuthState,
  validateOAuthCallback,
  validatedOAuthAuthorizationUrl,
}
