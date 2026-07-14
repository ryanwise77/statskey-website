import { auth } from '../firebase'
import type {
  AnthropicContentBlock,
  AnthropicChatRequest,
  AnthropicMonthlyUsage,
  AnthropicToolUseBlock,
} from './anthropic'

/**
 * SSE client for the anthropicChatStream Cloud Function — the same streaming
 * endpoint the iOS app uses. Text deltas arrive token-by-token; tool_use
 * blocks surface the moment the model opens them; the final `done` event
 * carries the authoritative content blocks (with parsed tool inputs),
 * credits, and monthly usage.
 */

const STREAM_URL = 'https://us-central1-statskey.cloudfunctions.net/anthropicChatStream'

export interface StreamRoundResult {
  text: string
  contentBlocks: AnthropicContentBlock[]
  toolUse: AnthropicToolUseBlock[]
  stopReason: string | null
  creditsCharged: number
  monthlyUsage?: AnthropicMonthlyUsage
}

export interface StreamCallbacks {
  /** Full visible text so far (already concatenated). */
  onText?: (text: string) => void
  /** A tool_use block just opened — name known, input still streaming. */
  onToolOpen?: (id: string, name: string) => void
}

export async function streamAnthropicRound(
  req: AnthropicChatRequest & { unlimitedAuto?: boolean },
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<StreamRoundResult> {
  const user = auth.currentUser
  if (!user) throw new Error('Sign in required.')
  const idToken = await user.getIdToken()

  const response = await fetch(STREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(req),
    signal,
  })
  if (!response.ok || !response.body) {
    let message = `Stream error (${response.status})`
    try {
      const parsed = (await response.json()) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let text = ''
  let stopReason: string | null = null
  let done: StreamRoundResult | null = null
  const openedTools = new Set<string>()

  const handleEvent = (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case 'content_block_start': {
        const block = data.content_block as { type?: string; id?: string; name?: string } | undefined
        if (block?.type === 'tool_use' && block.id && block.name && !openedTools.has(block.id)) {
          openedTools.add(block.id)
          callbacks.onToolOpen?.(block.id, block.name)
        }
        break
      }
      case 'content_block_delta': {
        const delta = data.delta as { type?: string; text?: string } | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          text += delta.text
          callbacks.onText?.(text)
        }
        break
      }
      case 'message_delta': {
        const delta = data.delta as { stop_reason?: string } | undefined
        if (delta?.stop_reason) stopReason = delta.stop_reason
        break
      }
      case 'done': {
        const blocks = (Array.isArray(data.contentBlocks) ? data.contentBlocks : []) as AnthropicContentBlock[]
        const toolUse = blocks.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use')
        const usage = data.monthlyUsage as AnthropicMonthlyUsage | undefined
        done = {
          text,
          contentBlocks: blocks,
          toolUse,
          stopReason,
          creditsCharged: typeof data.creditsCharged === 'number' ? data.creditsCharged : 0,
          monthlyUsage: usage,
        }
        break
      }
      case 'error': {
        const message = typeof data.message === 'string' ? data.message : 'Stream failed.'
        throw new Error(message)
      }
    }
  }

  for (;;) {
    const { value, done: readerDone } = await reader.read()
    if (readerDone) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line.
    for (;;) {
      const sep = buffer.indexOf('\n\n')
      if (sep === -1) break
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)

      let event = 'message'
      let dataLine = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
      }
      if (!dataLine) continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(dataLine) as Record<string, unknown>
      } catch {
        continue
      }
      handleEvent(event, parsed)
    }
  }

  // `done` is assigned from the nested SSE handler, which TypeScript's
  // control-flow analysis cannot observe across the closure.
  const terminal = done as StreamRoundResult | null

  if (!terminal) {
    // Do not represent a truncated SSE response as a valid, empty model turn.
    // The agent loop will catch this and rerun the same round through the
    // reliable callable endpoint. Returning an empty result here previously
    // allowed a completed tool call to be followed by a blank assistant reply.
    throw new Error('Intelligence stream ended before completion.')
  }

  if (terminal.contentBlocks.length === 0 && terminal.text.trim().length === 0) {
    throw new Error('Intelligence stream completed without a model response.')
  }

  return terminal
}
