import type { AnthropicContentBlock } from './ai/anthropic'

export type ChatAttachmentKind = 'text' | 'image' | 'pdf' | 'opaque'

export interface ChatAttachment {
  id: string
  name: string
  mediaType: string
  size: number
  kind: ChatAttachmentKind
  text?: string
  data?: string
  note?: string
}

export const MAX_CHAT_ATTACHMENTS = 20
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_MEDIA_BYTES = 3.5 * 1024 * 1024
const MAX_TOTAL_TEXT_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_MEDIA_BYTES = 5 * 1024 * 1024

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonc', 'xml', 'html',
  'htm', 'css', 'scss', 'less', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'py', 'rb', 'go', 'rs', 'swift', 'java', 'kt', 'kts', 'c', 'h', 'cc',
  'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql',
  'yaml', 'yml', 'toml', 'ini', 'env', 'log', 'tex', 'r', 'dart', 'vue',
  'svelte', 'graphql', 'gql', 'dockerfile', 'gitignore', 'properties',
])

export async function filesToChatAttachments(
  files: File[]
): Promise<ChatAttachment[]> {
  const attachments: ChatAttachment[] = []
  let remainingTextBytes = MAX_TOTAL_TEXT_BYTES
  let remainingMediaBytes = MAX_TOTAL_MEDIA_BYTES
  for (const file of files.slice(0, MAX_CHAT_ATTACHMENTS)) {
    const kind = hintedKind(file)
    const remainingBytes =
      kind === 'text' ? remainingTextBytes : remainingMediaBytes
    const attachment = await fileToChatAttachment(
      file,
      file.size <= remainingBytes
    )
    attachments.push(attachment)
    if (attachment.kind === 'text') remainingTextBytes -= file.size
    if (attachment.kind === 'image' || attachment.kind === 'pdf') {
      remainingMediaBytes -= file.size
    }
  }
  return attachments
}

export function attachmentContextForPrompt(
  attachments: ChatAttachment[],
  maxCharacters: number
): string {
  let remaining = Math.max(0, maxCharacters)
  const sections: string[] = []
  for (const attachment of attachments) {
    const header = `\n\n--- Chat attachment: ${attachment.name} (${formatBytes(
      attachment.size
    )}, ${attachment.mediaType || 'unknown type'}) ---\n`
    if (header.length >= remaining) break
    const body =
      attachment.kind === 'text' && attachment.text
        ? attachment.text
        : attachment.kind === 'image' || attachment.kind === 'pdf'
          ? 'The binary content is supplied as a model media block when the selected route supports this format.'
        : attachment.note ||
          'Attached as metadata only. The file contents were not read.'
    const content = body.slice(0, remaining - header.length)
    sections.push(`${header}${content}`)
    remaining -= header.length + content.length
  }
  return sections.join('')
}

export function attachmentMediaBlocks(
  attachments: ChatAttachment[]
): AnthropicContentBlock[] {
  return attachments
    .filter(
      (attachment) =>
        (attachment.kind === 'image' || attachment.kind === 'pdf') &&
        typeof attachment.data === 'string'
    )
    .map((attachment, index) => ({
      type: attachment.kind === 'pdf' ? 'document' : 'image',
      source: {
        type: 'base64',
        media_type: attachment.mediaType,
        data: attachment.data,
      },
      ...(attachment.kind === 'pdf'
        ? { title: `document-${index + 1}.pdf` }
        : {}),
    }))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function fileToChatAttachment(
  file: File,
  allowContent: boolean
): Promise<ChatAttachment> {
  const mediaType = file.type || mediaTypeForName(file.name)
  const base = {
    id: crypto.randomUUID(),
    name: sanitizeFileName(file.name),
    mediaType,
    size: file.size,
  }

  if (!allowContent) {
    return {
      ...base,
      kind: 'opaque',
      note: 'File accepted as metadata, but this message has reached its readable attachment limit.',
    }
  }

  if (mediaType.startsWith('image/')) {
    const detected = await detectedImageType(file)
    if (!detected) {
      return {
        ...base,
        kind: 'opaque',
        note: 'Image metadata retained, but only verified JPEG and PNG files are read.',
      }
    }
    if (file.size > MAX_MEDIA_BYTES) {
      return {
        ...base,
        kind: 'opaque',
        note: `Image accepted, but ${formatBytes(file.size)} exceeds the ${formatBytes(
          MAX_MEDIA_BYTES
        )} direct-analysis limit.`,
      }
    }
    return {
      ...base,
      mediaType: detected,
      kind: 'image',
      data: await fileToBase64(file),
    }
  }

  if (mediaType === 'application/pdf' || extension(file.name) === 'pdf') {
    if (!(await hasPdfSignature(file))) {
      return {
        ...base,
        kind: 'opaque',
        note: 'PDF metadata retained, but the file signature is not a valid PDF.',
      }
    }
    if (file.size > MAX_MEDIA_BYTES) {
      return {
        ...base,
        kind: 'opaque',
        note: `PDF accepted, but ${formatBytes(file.size)} exceeds the ${formatBytes(
          MAX_MEDIA_BYTES
        )} direct-analysis limit.`,
      }
    }
    return {
      ...base,
      mediaType: 'application/pdf',
      kind: 'pdf',
      data: await fileToBase64(file),
    }
  }

  if (isTextFile(file, mediaType)) {
    if (file.size > MAX_TEXT_BYTES) {
      return {
        ...base,
        kind: 'opaque',
        note: `Text file accepted, but ${formatBytes(file.size)} exceeds the ${formatBytes(
          MAX_TEXT_BYTES
        )} inline-text limit.`,
      }
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        await file.arrayBuffer()
      )
      if (!text.includes('\0') && !controlHeavy(text)) {
        return { ...base, kind: 'text', text }
      }
    } catch {
      return {
        ...base,
        kind: 'opaque',
        note: 'Text metadata retained, but the file is not valid bounded UTF-8.',
      }
    }
  }

  return {
    ...base,
    kind: 'opaque',
    note: `File accepted. ${friendlyType(file.name, mediaType)} is retained as an attachment, but this route does not extract its binary contents yet.`,
  }
}

function isTextFile(file: File, mediaType: string): boolean {
  return (
    mediaType.startsWith('text/') ||
    mediaType.includes('json') ||
    mediaType === 'application/xml' ||
    mediaType.endsWith('+xml') ||
    mediaType.includes('yaml') ||
    TEXT_EXTENSIONS.has(extension(file.name)) ||
    file.name === 'Dockerfile' ||
    file.name.startsWith('.env')
  )
}

function hintedKind(file: File): ChatAttachmentKind {
  const mediaType = file.type || mediaTypeForName(file.name)
  if (isTextFile(file, mediaType)) return 'text'
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf' || extension(file.name) === 'pdf') {
    return 'pdf'
  }
  return 'opaque'
}

function mediaTypeForName(name: string): string {
  const ext = extension(name)
  if (ext === 'pdf') return 'application/pdf'
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain'
  return 'application/octet-stream'
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function friendlyType(name: string, mediaType: string): string {
  const ext = extension(name)
  return ext ? `${ext.toUpperCase()} (${mediaType})` : mediaType
}

function sanitizeFileName(value: string): string {
  const cleaned = String(value || 'attachment')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255)
  return cleaned || 'attachment'
}

async function detectedImageType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  return null
}

async function hasPdfSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  return (
    bytes.length === 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
}

function controlHeavy(value: string): boolean {
  const sample = value.slice(0, 32_000)
  if (!sample) return false
  let controls = 0
  for (const character of sample) {
    const code = character.charCodeAt(0)
    if (code < 32 && character !== '\n' && character !== '\r' && character !== '\t') {
      controls += 1
    }
  }
  return controls / sample.length > 0.01
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read ${file.name}.`))
        return
      }
      resolve(reader.result.replace(/^data:[^;]+;base64,/, ''))
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}
