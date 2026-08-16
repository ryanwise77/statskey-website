import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase'

const functions = getFunctions(firebaseApp, 'us-central1')

export interface AssistantEmailSummary {
  id: string
  threadId: string
  from: string
  to: string
  subject: string
  date: string
  snippet: string
  unread: boolean
}

export interface AssistantEmailThreadMessage extends AssistantEmailSummary {
  cc?: string
  bodyText: string
  truncated: boolean
}

const listUnreadCall = httpsCallable<
  { query?: string; maxResults?: number },
  {
    provider: 'google'
    query: string
    count: number
    messages: AssistantEmailSummary[]
    stored: false
  }
>(functions, 'listAssistantUnreadEmails')

const readThreadCall = httpsCallable<
  { threadId: string },
  {
    provider: 'google'
    threadId: string
    count: number
    messages: AssistantEmailThreadMessage[]
    stored: false
  }
>(functions, 'readAssistantEmailThread')

export async function listAssistantUnreadEmails(options: {
  query?: string
  maxResults?: number
} = {}) {
  const { data } = await listUnreadCall({
    ...(options.query ? { query: options.query } : {}),
    ...(options.maxResults ? { maxResults: options.maxResults } : {}),
  })
  return data
}

export async function readAssistantEmailThread(threadId: string) {
  const { data } = await readThreadCall({ threadId })
  return data
}

let digestCache: { maximum: number; loadedAt: number; text: string } | null =
  null

/**
 * A deliberately small inbox snapshot for automatic context. It carries only
 * message metadata and bounded snippets—not thread bodies—and is cached for
 * five minutes so ordinary follow-ups do not repeatedly read the inbox.
 */
export async function compactAutomaticEmailContext(
  maximum: 3 | 5 | 10
): Promise<string> {
  if (
    digestCache &&
    digestCache.maximum === maximum &&
    Date.now() - digestCache.loadedAt < 5 * 60 * 1_000
  ) {
    return digestCache.text
  }
  const result = await listAssistantUnreadEmails({ maxResults: maximum })
  const lines = result.messages.slice(0, maximum).map((message, index) => {
    const from = compactLine(message.from, 140)
    const subject = compactLine(message.subject || '(no subject)', 180)
    const snippet = compactLine(message.snippet, 260)
    const date = compactLine(message.date, 80)
    return `${index + 1}. ${from} · ${subject} · ${date}${
      snippet ? `\n   ${snippet}` : ''
    }`
  })
  const text = lines.length
    ? `--- RECENT UNREAD EMAIL DIGEST (automatic, metadata and snippets only) ---\n${lines.join(
        '\n'
      )}\nOpen a specific thread only if the user's request actually requires its body.`
    : ''
  digestCache = { maximum, loadedAt: Date.now(), text: text.slice(0, 4_000) }
  return digestCache.text
}

function compactLine(value: string, maximum: number): string {
  const compact = String(value ?? '').replace(/\s+/g, ' ').trim()
  return compact.length <= maximum
    ? compact
    : `${compact.slice(0, Math.max(0, maximum - 1))}…`
}
