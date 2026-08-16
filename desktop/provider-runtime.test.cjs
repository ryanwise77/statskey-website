const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const {
  runProviderRound,
  withProviderToolCatalog,
} = require('./provider-runtime.cjs')

test('direct final handoff omits an empty provider tool catalog', () => {
  const request = withProviderToolCatalog(
    { model: 'test', messages: [{ role: 'user', content: 'Summarize.' }] },
    []
  )

  assert.equal(Object.hasOwn(request, 'tools'), false)
})

test('direct ordinary rounds preserve their provider tool catalog', () => {
  const tools = [{ type: 'function', name: 'workspace_read' }]
  const request = withProviderToolCatalog(
    { model: 'test', messages: [{ role: 'user', content: 'Read it.' }] },
    tools
  )

  assert.deepEqual(request.tools, tools)
})

test('provider runtime rejects corrupt attachment data before dispatch', async () => {
  await assert.rejects(
    () =>
      runProviderRound({
        provider: 'openai-compatible',
        config: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test' },
        request: {
          model: 'test',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Inspect this.' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'not-base64',
                  },
                },
              ],
            },
          ],
        },
        signal: new AbortController().signal,
        onDelta() {},
      }),
    /invalid or too large/
  )
})

test('provider runtime rejects unsupported image types', async () => {
  await assert.rejects(
    () =>
      runProviderRound({
        provider: 'openai-compatible',
        config: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test' },
        request: {
          model: 'test',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/svg+xml',
                    data: 'PHN2Zz48L3N2Zz4=',
                  },
                },
              ],
            },
          ],
        },
        signal: new AbortController().signal,
        onDelta() {},
      }),
    /Unsupported image/
  )
})

test('compatible provider streams text without exposing credentials', async () => {
  const server = await mockServer([
    {
      choices: [{ delta: { content: 'Hello ' }, finish_reason: null }],
    },
    {
      choices: [{ delta: { content: 'workspace' }, finish_reason: 'stop' }],
    },
  ])
  const deltas = []
  try {
    const result = await runProviderRound({
      provider: 'openai-compatible',
      config: {
        apiKey: 'local-test-key',
        baseUrl: `${server.url}/v1`,
        model: 'local-model',
      },
      request: {
        model: 'local-model',
        systemPrompt: 'Be concise.',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
        effort: 'low',
      },
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
    })
    assert.equal(result.content, 'Hello workspace')
    assert.deepEqual(deltas, ['Hello ', 'workspace'])
    assert.equal(result.toolUse.length, 0)
    assert.equal(Object.hasOwn(server.bodies[0], 'tools'), false)
    assert.equal(Object.hasOwn(server.bodies[0], 'tool_choice'), false)
  } finally {
    await server.close()
  }
})

test('compatible provider normalizes streamed tool calls', async () => {
  const server = await mockServer([
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-1',
            function: { name: 'workspace_', arguments: '{"query":' },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { name: 'search', arguments: '"models"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    },
  ])
  try {
    const result = await runProviderRound({
      provider: 'openai-compatible',
      config: {
        baseUrl: `${server.url}/v1`,
        model: 'local-model',
      },
      request: {
        model: 'local-model',
        systemPrompt: '',
        messages: [{ role: 'user', content: 'Search files' }],
        tools: [{
          name: 'workspace_search',
          description: 'Search files.',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        }],
      },
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    assert.deepEqual(result.toolUse, [{
      type: 'tool_use',
      id: 'call-1',
      name: 'workspace_search',
      input: { query: 'models' },
    }])
    assert.equal(server.bodies[0].tool_choice, 'auto')
    assert.equal(server.bodies[0].tools.length, 1)
    assert.equal(
      server.bodies[0].tools[0].function.name,
      'workspace_search'
    )
  } finally {
    await server.close()
  }
})

test('Kimi preserves reasoning state across tool rounds', async () => {
  const server = await mockServer([
    {
      choices: [{
        delta: { reasoning_content: 'fresh reasoning' },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        delta: { content: 'Finished' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 4 },
    },
  ])
  try {
    const result = await runProviderRound({
      provider: 'moonshot',
      config: {
        apiKey: 'test-kimi-key',
        baseUrl: `${server.url}/v1`,
      },
      request: {
        model: 'kimi-k3',
        systemPrompt: 'Use tools carefully.',
        effort: 'max',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'kimi_preserved_thinking',
                reasoning_content: 'complete prior reasoning',
              },
              {
                type: 'tool_use',
                id: 'call-1',
                name: 'workspace_read',
                input: { path: 'README.md' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call-1',
                content: 'Read result',
              },
            ],
          },
        ],
        tools: [],
      },
      signal: new AbortController().signal,
      onDelta: () => {},
    })

    assert.equal(server.bodies[0].model, 'kimi-k3')
    assert.equal(server.bodies[0].reasoning_effort, 'max')
    assert.equal(
      server.bodies[0].messages[1].reasoning_content,
      'complete prior reasoning'
    )
    assert.equal(server.bodies[0].messages[2].role, 'tool')
    assert.equal(result.content, 'Finished')
    assert.deepEqual(result.contentBlocks[0], {
      type: 'kimi_preserved_thinking',
      reasoning_content: 'fresh reasoning',
    })
    assert.equal(result.usage.prompt_tokens, 20)
  } finally {
    await server.close()
  }
})

test('Anthropic direct route preserves streamed text and final content blocks', async () => {
  let requestBody = null
  const server = await rawServer((_request, response) => {
    let rawBody = ''
    _request.on('data', (chunk) => {
      rawBody += chunk
    })
    _request.on('end', () => {
      requestBody = JSON.parse(rawBody)
    })
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    })
    const events = [
      {
        type: 'message_start',
        message: {
          id: 'msg-test',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 3, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Direct Claude' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]
    for (const event of events) {
      response.write(`event: ${event.type}\n`)
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    response.end()
  })
  const deltas = []
  try {
    const result = await runProviderRound({
      provider: 'anthropic',
      config: { apiKey: 'test-key', baseUrl: server.url },
      request: {
        model: 'claude-test',
        systemPrompt: 'Test.',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
        webSearch: false,
        effort: 'low',
        maxOutputTokens: 1000,
      },
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
    })
    assert.equal(result.content, 'Direct Claude')
    assert.deepEqual(deltas, ['Direct Claude'])
    assert.equal(result.contentBlocks[0].type, 'text')
    assert.equal(Object.hasOwn(requestBody, 'tools'), false)
  } finally {
    await server.close()
  }
})

async function mockServer(chunks) {
  let authorization = null
  const bodies = []
  const server = http.createServer((request, response) => {
    authorization = request.headers.authorization
    let rawBody = ''
    request.on('data', (chunk) => {
      rawBody += chunk
    })
    request.on('end', () => {
      bodies.push(JSON.parse(rawBody))
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      })
      for (const chunk of chunks) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    get authorization() {
      return authorization
    },
    bodies,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function rawServer(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
