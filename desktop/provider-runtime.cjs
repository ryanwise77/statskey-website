const Anthropic = require('@anthropic-ai/sdk').default
const { OpenAI, AzureOpenAI } = require('openai')
const { GoogleGenAI } = require('@google/genai')
const {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} = require('@aws-sdk/client-bedrock-runtime')

async function runProviderRound({
  provider,
  config,
  request,
  signal,
  onDelta,
}) {
  const normalized = normalizeRequest(request)
  switch (provider) {
    case 'anthropic':
      return runAnthropic(config, normalized, signal, onDelta)
    case 'openai':
    case 'xai':
      return runOpenAIResponses(provider, config, normalized, signal, onDelta)
    case 'moonshot':
      return runKimi(config, normalized, signal, onDelta)
    case 'azure-openai':
      return runAzureResponses(config, normalized, signal, onDelta)
    case 'openai-compatible':
      return runCompatibleChat(config, normalized, signal, onDelta)
    case 'google':
      return runGoogle(config, normalized, signal, onDelta)
    case 'aws-bedrock':
      return runBedrock(config, normalized, signal, onDelta)
    default:
      throw new Error('Unsupported direct provider.')
  }
}

function normalizeRequest(request) {
  if (request == null || typeof request !== 'object') {
    throw new Error('Invalid model request.')
  }
  const model = typeof request.model === 'string' ? request.model.trim() : ''
  if (!model || model.length > 240) throw new Error('Choose a valid model.')
  const systemPrompt =
    typeof request.systemPrompt === 'string'
      ? request.systemPrompt.slice(0, 4_000_000)
      : ''
  const messages = Array.isArray(request.messages)
    ? request.messages.slice(-500).map(normalizeMessage)
    : []
  if (messages.length === 0) throw new Error('The request has no messages.')
  const tools = Array.isArray(request.tools)
    ? request.tools.slice(0, 256).map(normalizeTool).filter(Boolean)
    : []
  const supportedEfforts = new Set([
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ])
  const effort = supportedEfforts.has(request.effort)
    ? request.effort
    : 'medium'
  const maxOutputTokens = Math.min(
    128_000,
    Math.max(1_000, Number(request.maxOutputTokens) || 16_000)
  )
  const reasoningMode = request.reasoningMode === 'pro' ? 'pro' : 'standard'
  const serviceTier = request.serviceTier === 'fast' ? 'fast' : undefined
  const webSearch = request.webSearch !== false
  return {
    model,
    systemPrompt,
    messages,
    tools,
    effort,
    maxOutputTokens,
    reasoningMode,
    serviceTier,
    webSearch,
  }
}

function normalizeMessage(message) {
  const role = message?.role === 'assistant' ? 'assistant' : 'user'
  if (typeof message?.content === 'string') {
    return { role, content: message.content.slice(0, 4_000_000) }
  }
  if (!Array.isArray(message?.content)) return { role, content: '' }
  const content = message.content.slice(0, 512).map((block, blockIndex) => {
    if (block == null || typeof block !== 'object') return { type: 'text', text: '' }
    if (block.type === 'text') {
      return { type: 'text', text: String(block.text || '').slice(0, 4_000_000) }
    }
    if (block.type === 'tool_use') {
      return {
        type: 'tool_use',
        id: String(block.id || '').slice(0, 240),
        name: String(block.name || '').slice(0, 128),
        input:
          block.input != null && typeof block.input === 'object'
            ? block.input
            : {},
      }
    }
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result',
        tool_use_id: String(block.tool_use_id || '').slice(0, 240),
        content:
          typeof block.content === 'string'
            ? block.content.slice(0, 2_000_000)
            : JSON.stringify(block.content ?? '').slice(0, 2_000_000),
        is_error: block.is_error === true,
      }
    }
    if (block.type === 'kimi_preserved_thinking') {
      return {
        type: 'kimi_preserved_thinking',
        reasoning_content: String(block.reasoning_content || '').slice(
          0,
          4_000_000
        ),
      }
    }
    if (
      block.type === 'image' &&
      block.source?.type === 'base64' &&
      typeof block.source?.data === 'string'
    ) {
      const mediaType = String(block.source.media_type || '')
      if (!['image/jpeg', 'image/png'].includes(mediaType)) {
        throw new Error('Unsupported image attachment type.')
      }
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: validatedBase64(
            block.source.data,
            Math.floor(3.5 * 1024 * 1024)
          ),
        },
      }
    }
    if (
      block.type === 'document' &&
      block.source?.type === 'base64' &&
      typeof block.source?.data === 'string'
    ) {
      if (block.source.media_type !== 'application/pdf') {
        throw new Error('Unsupported document attachment type.')
      }
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: validatedBase64(block.source.data, 4 * 1024 * 1024),
        },
        title: `document-${blockIndex + 1}.pdf`,
      }
    }
    // Preserve provider-owned thinking/signature blocks returned by Anthropic.
    return JSON.parse(JSON.stringify(block))
  })
  return { role, content }
}

function validatedBase64(value, maximumBytes) {
  const normalized = String(value || '')
  const maximumCharacters = Math.ceil(maximumBytes / 3) * 4
  if (
    !normalized ||
    normalized.length > maximumCharacters ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error('Attachment data is invalid or too large.')
  }
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length > maximumBytes) {
    throw new Error('Attachment data is too large.')
  }
  return normalized
}

function normalizeTool(tool) {
  if (
    tool == null ||
    typeof tool !== 'object' ||
    typeof tool.name !== 'string' ||
    !tool.name
  ) {
    return null
  }
  return {
    name: tool.name.slice(0, 128),
    description: String(tool.description || '').slice(0, 16_000),
    input_schema:
      tool.input_schema != null && typeof tool.input_schema === 'object'
        ? tool.input_schema
        : { type: 'object', properties: {}, required: [] },
  }
}

function withProviderToolCatalog(request, tools) {
  if (!Array.isArray(tools) || tools.length === 0) return request
  return { ...request, tools }
}

async function runAnthropic(config, request, signal, onDelta) {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })
  const providerTools = [
    ...request.tools,
    ...(request.webSearch
      ? [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5,
        }]
      : []),
  ]
  const params = withProviderToolCatalog({
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: request.systemPrompt,
    messages: request.messages,
    thinking: { type: 'adaptive' },
    output_config: { effort: anthropicEffort(request.effort) },
  }, providerTools)
  const stream = client.messages.stream(params, { signal })
  stream.on('text', (text) => {
    if (text) onDelta(text)
  })
  const message = await stream.finalMessage()
  const contentBlocks = message.content || []
  const toolUse = contentBlocks.filter((block) => block.type === 'tool_use')
  return {
    provider: 'anthropic',
    model: message.model || request.model,
    content: contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n'),
    contentBlocks,
    toolUse,
    stopReason: message.stop_reason,
    usage: message.usage || {},
    citations: anthropicCitations(contentBlocks),
  }
}

function anthropicEffort(effort) {
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) return effort
  return 'medium'
}

async function runOpenAIResponses(provider, config, request, signal, onDelta) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    organization: config.organization,
    project: config.project,
  })
  return runResponsesClient(client, provider, request, signal, onDelta)
}

async function runAzureResponses(config, request, signal, onDelta) {
  const client = new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    deployment: config.deployment,
    apiVersion: config.apiVersion,
  })
  return runResponsesClient(
    client,
    'azure-openai',
    { ...request, model: config.deployment },
    signal,
    onDelta
  )
}

async function runResponsesClient(client, provider, request, signal, onDelta) {
  const providerTools = [
    ...(request.webSearch ? [{ type: 'web_search' }] : []),
    ...request.tools.map(toResponsesTool),
  ]
  const params = withProviderToolCatalog({
    model: request.model,
    input: toResponsesInput(request.messages),
    instructions: request.systemPrompt || undefined,
    max_output_tokens: request.maxOutputTokens,
    reasoning: {
      effort: openAIEffort(request.effort),
      ...(request.reasoningMode === 'pro' ? { mode: 'pro' } : {}),
    },
    ...(request.serviceTier === 'fast' ? { service_tier: 'fast' } : {}),
    store: false,
    parallel_tool_calls: true,
  }, providerTools)
  const stream = client.responses.stream(params, { signal })
  stream.on('response.output_text.delta', (event) => {
    if (event.delta) onDelta(event.delta)
  })
  const response = await stream.finalResponse()
  const toolUse = (response.output || [])
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      type: 'tool_use',
      id: item.call_id || item.id,
      name: item.name,
      input: parseJsonObject(item.arguments),
    }))
  const content = response.output_text || ''
  return {
    provider,
    model: response.model || request.model,
    content,
    contentBlocks: [
      ...(content ? [{ type: 'text', text: content }] : []),
      ...toolUse,
    ],
    toolUse,
    stopReason: toolUse.length > 0 ? 'tool_use' : response.status,
    usage: response.usage || {},
    citations: responsesCitations(response),
  }
}

function openAIEffort(effort) {
  if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
    return effort
  }
  return 'medium'
}

function toResponsesTool(tool) {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    strict: false,
  }
}

function toResponsesInput(messages) {
  const input = []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      input.push({ role: message.role, content: message.content })
      continue
    }
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    if (text) input.push({ role: message.role, content: text })
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        input.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        })
      } else if (block.type === 'tool_result') {
        input.push({
          type: 'function_call_output',
          call_id: block.tool_use_id,
          output: block.content,
        })
      } else if (block.type === 'image') {
        input.push({
          role: message.role,
          content: [
            {
              type: 'input_image',
              image_url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          ],
        })
      } else if (block.type === 'document') {
        input.push({
          role: message.role,
          content: [
            {
              type: 'input_file',
              filename: block.title || 'document.pdf',
              file_data: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          ],
        })
      }
    }
  }
  return input
}

async function runCompatibleChat(config, request, signal, onDelta) {
  const client = new OpenAI({
    apiKey: config.apiKey || 'local-no-key',
    baseURL: config.baseUrl,
  })
  const providerTools = request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
  const stream = await client.chat.completions.create(
    withProviderToolCatalog({
      model: config.model || request.model,
      messages: toChatMessages(request.messages, request.systemPrompt),
      stream: true,
      max_tokens: request.maxOutputTokens,
      ...(providerTools.length > 0 ? { tool_choice: 'auto' } : {}),
    }, providerTools),
    { signal }
  )
  let content = ''
  let finishReason = null
  const calls = new Map()
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta
    if (delta?.content) {
      content += delta.content
      onDelta(delta.content)
    }
    for (const call of delta?.tool_calls || []) {
      const current = calls.get(call.index) || {
        id: '',
        name: '',
        arguments: '',
      }
      if (call.id) current.id = call.id
      if (call.function?.name) current.name += call.function.name
      if (call.function?.arguments) current.arguments += call.function.arguments
      calls.set(call.index, current)
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason
  }
  const toolUse = [...calls.values()].map((call) => ({
    type: 'tool_use',
    id: call.id,
    name: call.name,
    input: parseJsonObject(call.arguments),
  }))
  return {
    provider: 'openai-compatible',
    model: config.model || request.model,
    content,
    contentBlocks: [
      ...(content ? [{ type: 'text', text: content }] : []),
      ...toolUse,
    ],
    toolUse,
    stopReason: toolUse.length > 0 ? 'tool_use' : finishReason,
    usage: {},
  }
}

async function runKimi(config, request, signal, onDelta) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })
  const providerTools = request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
  const stream = await client.chat.completions.create(
    withProviderToolCatalog({
      model: request.model,
      messages: toKimiMessages(request.messages, request.systemPrompt),
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: kimiEffort(request.effort),
      max_completion_tokens: request.maxOutputTokens,
      ...(providerTools.length > 0 ? { tool_choice: 'auto' } : {}),
    }, providerTools),
    { signal }
  )
  let content = ''
  let reasoningContent = ''
  let finishReason = null
  let usage = {}
  const calls = new Map()
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta
    if (delta?.reasoning_content) {
      reasoningContent += delta.reasoning_content
    }
    if (delta?.content) {
      content += delta.content
      onDelta(delta.content)
    }
    for (const call of delta?.tool_calls || []) {
      const current = calls.get(call.index) || {
        id: '',
        name: '',
        arguments: '',
      }
      if (call.id) current.id = call.id
      if (call.function?.name) current.name += call.function.name
      if (call.function?.arguments) {
        current.arguments += call.function.arguments
      }
      calls.set(call.index, current)
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason
    if (chunk.usage) usage = chunk.usage
  }
  const toolUse = [...calls.values()].map((call) => ({
    type: 'tool_use',
    id: call.id,
    name: call.name,
    input: parseJsonObject(call.arguments),
  }))
  return {
    provider: 'moonshot',
    model: request.model,
    content,
    contentBlocks: [
      ...(reasoningContent
        ? [{
            type: 'kimi_preserved_thinking',
            reasoning_content: reasoningContent,
          }]
        : []),
      ...(content ? [{ type: 'text', text: content }] : []),
      ...toolUse,
    ],
    toolUse,
    stopReason: toolUse.length > 0 ? 'tool_use' : finishReason,
    usage,
  }
}

function kimiEffort(effort) {
  return ['low', 'high', 'max'].includes(effort) ? effort : 'high'
}

function toKimiMessages(messages, systemPrompt) {
  const out = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content })
      continue
    }
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    const preservedThinking = message.content.find(
      (block) => block.type === 'kimi_preserved_thinking'
    )
    const toolCalls = message.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      }))
    if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: text || null,
        ...(preservedThinking?.reasoning_content
          ? { reasoning_content: preservedThinking.reasoning_content }
          : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    } else if (text) {
      out.push({ role: message.role, content: text })
    }
    for (const block of message.content) {
      if (block.type !== 'tool_result') continue
      out.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: block.content,
      })
    }
  }
  return out
}

function toChatMessages(messages, systemPrompt) {
  const out = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content })
      continue
    }
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    const toolCalls = message.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      }))
    if (message.role === 'assistant' && toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls,
      })
    } else if (text) {
      out.push({ role: message.role, content: text })
    }
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: block.content,
        })
      }
    }
  }
  return out
}

async function runGoogle(config, request, signal, onDelta) {
  const client = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: config.baseUrl ? { baseUrl: config.baseUrl } : undefined,
  })
  const providerTools = [
    ...(request.webSearch ? [{ googleSearch: {} }] : []),
    ...(request.tools.length > 0
      ? [{
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.input_schema,
          })),
        }]
      : []),
  ]
  const stream = await client.models.generateContentStream({
    model: request.model,
    contents: toGoogleContents(request.messages),
    config: withProviderToolCatalog({
      abortSignal: signal,
      systemInstruction: request.systemPrompt || undefined,
      maxOutputTokens: request.maxOutputTokens,
      thinkingConfig: {
        thinkingLevel: ['minimal', 'low', 'medium', 'high'].includes(
          request.effort
        )
          ? request.effort
          : request.effort === 'none'
            ? 'minimal'
            : 'high',
      },
    }, providerTools),
  })
  let content = ''
  let usage = {}
  let finishReason = null
  const calls = new Map()
  for await (const chunk of stream) {
    let text = ''
    try {
      text = chunk.text || ''
    } catch {
      text = ''
    }
    if (text) {
      content += text
      onDelta(text)
    }
    for (const call of chunk.functionCalls || []) {
      const id = call.id || `${call.name}-${calls.size}`
      calls.set(id, {
        type: 'tool_use',
        id,
        name: call.name,
        input: call.args || {},
      })
    }
    if (chunk.usageMetadata) usage = chunk.usageMetadata
    const candidate = chunk.candidates?.[0]
    if (candidate?.finishReason) finishReason = candidate.finishReason
  }
  const toolUse = [...calls.values()]
  return {
    provider: 'google',
    model: request.model,
    content,
    contentBlocks: [
      ...(content ? [{ type: 'text', text: content }] : []),
      ...toolUse,
    ],
    toolUse,
    stopReason: toolUse.length > 0 ? 'tool_use' : finishReason,
    usage,
    citations: [],
  }
}

function toGoogleContents(messages) {
  const toolNames = new Map()
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === 'tool_use') toolNames.set(block.id, block.name)
    }
  }
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }
    }
    const parts = []
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text })
      } else if (block.type === 'tool_use') {
        parts.push({
          functionCall: {
            id: block.id,
            name: block.name,
            args: block.input || {},
          },
        })
      } else if (block.type === 'tool_result') {
        parts.push({
          functionResponse: {
            id: block.tool_use_id,
            name: toolNames.get(block.tool_use_id) || 'tool',
            response: parseToolResult(block.content),
          },
        })
      } else if (block.type === 'image' || block.type === 'document') {
        parts.push({
          inlineData: {
            mimeType: block.source.media_type,
            data: block.source.data,
          },
        })
      }
    }
    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts,
    }
  })
}

async function runBedrock(config, request, signal, onDelta) {
  const client = new BedrockRuntimeClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
  })
  const command = new ConverseStreamCommand({
    modelId: request.model,
    system: request.systemPrompt ? [{ text: request.systemPrompt }] : undefined,
    messages: toBedrockMessages(request.messages),
    inferenceConfig: { maxTokens: request.maxOutputTokens },
    ...(request.tools.length > 0
      ? {
          toolConfig: {
            tools: request.tools.map((tool) => ({
              toolSpec: {
                name: tool.name,
                description: tool.description,
                inputSchema: { json: tool.input_schema },
              },
            })),
          },
        }
      : {}),
  })
  const response = await client.send(command, { abortSignal: signal })
  let content = ''
  let usage = {}
  let stopReason = null
  const calls = new Map()
  for await (const event of response.stream || []) {
    const start = event.contentBlockStart
    if (start?.start?.toolUse) {
      calls.set(start.contentBlockIndex, {
        id: start.start.toolUse.toolUseId,
        name: start.start.toolUse.name,
        input: '',
      })
    }
    const delta = event.contentBlockDelta?.delta
    if (delta?.text) {
      content += delta.text
      onDelta(delta.text)
    }
    if (delta?.toolUse?.input != null) {
      const call = calls.get(event.contentBlockDelta.contentBlockIndex)
      if (call) call.input += delta.toolUse.input
    }
    if (event.messageStop?.stopReason) stopReason = event.messageStop.stopReason
    if (event.metadata?.usage) usage = event.metadata.usage
  }
  const toolUse = [...calls.values()].map((call) => ({
    type: 'tool_use',
    id: call.id,
    name: call.name,
    input: parseJsonObject(call.input),
  }))
  return {
    provider: 'aws-bedrock',
    model: request.model,
    content,
    contentBlocks: [
      ...(content ? [{ type: 'text', text: content }] : []),
      ...toolUse,
    ],
    toolUse,
    stopReason: toolUse.length > 0 ? 'tool_use' : stopReason,
    usage,
  }
}

function toBedrockMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: [{ text: message.content }] }
    }
    const content = []
    for (const block of message.content) {
      if (block.type === 'text') {
        content.push({ text: block.text })
      } else if (block.type === 'tool_use') {
        content.push({
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.input || {},
          },
        })
      } else if (block.type === 'tool_result') {
        content.push({
          toolResult: {
            toolUseId: block.tool_use_id,
            content: [{ json: parseToolResult(block.content) }],
            status: block.is_error ? 'error' : 'success',
          },
        })
      } else if (block.type === 'image') {
        content.push({
          image: {
            format: imageFormat(block.source.media_type),
            source: { bytes: Buffer.from(block.source.data, 'base64') },
          },
        })
      } else if (block.type === 'document') {
        content.push({
          document: {
            format: 'pdf',
            name: String(block.title || 'document')
              .replace(/[^a-zA-Z0-9 _.-]/g, '_')
              .slice(0, 120),
            source: { bytes: Buffer.from(block.source.data, 'base64') },
          },
        })
      }
    }
    return { role: message.role, content }
  })
}

function imageFormat(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpeg'
  if (mediaType === 'image/gif') return 'gif'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}

function parseJsonObject(value) {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
}

function parseToolResult(value) {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return { result: String(value || '') }
  }
}

function anthropicCitations(contentBlocks) {
  return collectHttpUrls(
    contentBlocks.flatMap((block) =>
      block && typeof block === 'object' && Array.isArray(block.citations)
        ? block.citations
        : []
    )
  )
}

function responsesCitations(response) {
  const annotations = []
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (Array.isArray(content.annotations)) {
        annotations.push(...content.annotations)
      }
    }
  }
  return collectHttpUrls(annotations)
}

function collectHttpUrls(value) {
  const urls = new Set()
  const visit = (candidate, depth) => {
    if (depth > 6 || candidate == null) return
    if (typeof candidate === 'string') {
      if (/^https?:\/\//i.test(candidate)) urls.add(candidate)
      return
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1)
      return
    }
    if (typeof candidate === 'object') {
      for (const [key, item] of Object.entries(candidate)) {
        if (
          typeof item === 'string' &&
          (key === 'url' || key.endsWith('_url')) &&
          /^https?:\/\//i.test(item)
        ) {
          urls.add(item)
        } else {
          visit(item, depth + 1)
        }
      }
    }
  }
  visit(value, 0)
  return [...urls].slice(0, 50)
}

module.exports = {
  runProviderRound,
  withProviderToolCatalog,
}
