const {
  PersistentMcpOAuthProvider,
  createLoopbackOAuthCallback,
  validateOAuthCallback,
} = require('./mcp-oauth-runtime.cjs')

class LocalMcpManager {
  constructor() {
    this.connections = new Map()
    this.toolRoutes = new Map()
  }

  async listTools(configurations) {
    const definitions = []
    const listedServers = new Set(Object.keys(configurations || {}))
    for (const [name, route] of this.toolRoutes) {
      if (listedServers.has(route.serverName)) this.toolRoutes.delete(name)
    }
    for (const [serverName, config] of Object.entries(configurations || {})) {
      if (config?.disabled === true) continue
      try {
        const connection = await this.connect(serverName, config)
        const response = await withMcpDeadline(
          connection.client.listTools(),
          30_000,
          `${serverName} did not return its tools`
        )
        for (const tool of response.tools || []) {
          const exposedName = uniqueToolName(
            serverName,
            tool.name,
            this.toolRoutes
          )
          this.toolRoutes.set(exposedName, {
            serverName,
            toolName: tool.name,
          })
          definitions.push({
            name: exposedName,
            description: `[${serverName}] ${tool.description || tool.name}`,
            input_schema:
              tool.inputSchema || {
                type: 'object',
                properties: {},
                required: [],
              },
            server: serverName,
            originalName: tool.name,
          })
        }
      } catch (error) {
        definitions.push({
          name: `mcp_error__${safeName(serverName)}`,
          description: `MCP server ${serverName} is unavailable: ${safeMessage(error)}`,
          input_schema: { type: 'object', properties: {}, required: [] },
          server: serverName,
          unavailable: true,
        })
      }
    }
    return definitions
  }

  async callTool(exposedName, args) {
    const route = this.toolRoutes.get(exposedName)
    if (!route) throw new Error('Unknown MCP tool.')
    const connection = this.connections.get(route.serverName)
    if (!connection) throw new Error('MCP server is disconnected.')
    return await withMcpDeadline(
      connection.client.callTool({
        name: route.toolName,
        arguments: args || {},
      }),
      2 * 60_000,
      `${route.serverName} did not finish the tool request`
    )
  }

  async connect(serverName, config) {
    const signature = JSON.stringify(config)
    const existing = this.connections.get(serverName)
    if (existing?.signature === signature) return existing
    if (existing) await this.close(serverName)

    const [{ Client }, transport] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      createTransport(config),
    ])
    const client = new Client(
      { name: 'statskey-desktop', version: '0.1.0' },
      { capabilities: {} }
    )
    try {
      await withMcpDeadline(
        client.connect(transport),
        30_000,
        `${serverName} did not finish connecting`
      )
    } catch (error) {
      try {
        await transport.close()
      } catch {
        // Best effort cleanup after a failed connection.
      }
      throw error
    }
    const connection = { client, transport, signature }
    this.connections.set(serverName, connection)
    return connection
  }

  async close(serverName) {
    const connection = this.connections.get(serverName)
    this.connections.delete(serverName)
    if (!connection) return
    try {
      await connection.client.close()
    } catch {
      try {
        await connection.transport.close()
      } catch {
        // Best effort shutdown.
      }
    }
  }

  async closeAll() {
    await Promise.all([...this.connections.keys()].map((name) => this.close(name)))
    this.toolRoutes.clear()
  }
}

async function createTransport(config) {
  if (typeof config?.command === 'string' && config.command) {
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    )
    return new StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      env: {
        ...process.env,
        ...(config.env && typeof config.env === 'object' ? config.env : {}),
      },
      cwd: typeof config.cwd === 'string' ? config.cwd : undefined,
      stderr: 'pipe',
    })
  }
  if (typeof config?.url === 'string' && config.url) {
    const url = new URL(config.url)
    const requestInit =
      config.headers && typeof config.headers === 'object'
        ? { headers: config.headers }
        : undefined
    if (config.type === 'sse') {
      const { SSEClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/sse.js'
      )
      return new SSEClientTransport(url, { requestInit })
    }
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )
    const authProvider =
      config.oauth && typeof config.oauth === 'object'
        ? new PersistentMcpOAuthProvider({
            redirectUrl: config.oauth.redirectUrl,
            state: config.oauth,
            preserveRegistration: true,
            onStateChange: config.onOAuthStateChange,
            onRedirect: config.onOAuthRedirect,
          })
        : undefined
    return new StreamableHTTPClientTransport(url, {
      requestInit,
      authProvider,
    })
  }
  throw new Error('MCP server needs a command or URL.')
}

async function authorizeRemoteMcp(config, options = {}) {
  if (typeof config?.url !== 'string' || !config.url) {
    throw new Error('A remote MCP endpoint is required for browser authorization.')
  }
  if (typeof options.openExternal !== 'function') {
    throw new Error('Browser authorization is unavailable.')
  }
  const callback = await createLoopbackOAuthCallback({
    timeoutMilliseconds: options.timeoutMilliseconds,
  })
  const provider = new PersistentMcpOAuthProvider({
    redirectUrl: callback.redirectUrl,
    state: config.oauth,
    onRedirect: async (url) => {
      await options.openExternal(url.toString())
    },
  })
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ])
  const endpoint = new URL(config.url)
  let client = null
  let transport = null

  async function connect() {
    client = new Client(
      { name: 'statskey-desktop', version: '0.19.1' },
      { capabilities: {} }
    )
    transport = new StreamableHTTPClientTransport(endpoint, {
      authProvider: provider,
    })
    await withMcpDeadline(
      client.connect(transport),
      30_000,
      'The MCP service did not finish connecting'
    )
  }

  try {
    try {
      await connect()
    } catch (error) {
      if (!provider.authorizationStarted || !transport) throw error
      const callbackUrl = await callback.waitForCallback()
      const code = validateOAuthCallback(
        callbackUrl,
        provider.expectedState()
      )
      await withMcpDeadline(
        transport.finishAuth(code),
        30_000,
        'The OAuth service did not finish exchanging credentials'
      )
      await closeMcpClient(client, transport)
      client = null
      transport = null
      await connect()
    }
    const response = await withMcpDeadline(
      client.listTools(),
      30_000,
      'The MCP service did not return its tools'
    )
    const tools = (response.tools || []).map((tool) => ({
      name: String(tool.name || '').slice(0, 160),
      description: String(tool.description || '').slice(0, 500),
    }))
    const oauth = provider.snapshot()
    if (typeof options.onStateChange === 'function') {
      await options.onStateChange(oauth)
    }
    return { oauth, tools, toolCount: tools.length }
  } finally {
    await closeMcpClient(client, transport)
    await callback.close()
  }
}

async function closeMcpClient(client, transport) {
  try {
    await client?.close()
  } catch {
    try {
      await transport?.close()
    } catch {
      // Best effort cleanup after authorization or connection failure.
    }
  }
}

function uniqueToolName(server, tool, routes) {
  const base = `mcp__${safeName(server)}__${safeName(tool)}`.slice(0, 120)
  let candidate = base
  let index = 2
  while (routes.has(candidate)) {
    candidate = `${base.slice(0, 112)}_${index}`
    index += 1
  }
  return candidate
}

function safeName(value) {
  return String(value || 'tool')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 52) || 'tool'
}

function safeMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(token|key|secret|password)=?[^,\s]*/gi, '$1=[redacted]')
    .slice(0, 240)
}

async function withMcpDeadline(promise, milliseconds, message) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} before the safety deadline.`)), milliseconds)
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

module.exports = {
  LocalMcpManager,
  authorizeRemoteMcp,
}
