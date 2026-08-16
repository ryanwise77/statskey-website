const MAX_WORKSPACE_READ_FILES = 8
const MAX_WORKSPACE_READ_VALUE_CHARS = 32_768
const MAX_ENCODED_LIST_CHARS =
  MAX_WORKSPACE_READ_FILES * MAX_WORKSPACE_READ_VALUE_CHARS + 1_024
const MAX_WORKSPACE_PATCH_EDITS = 16
const MAX_WORKSPACE_PATCH_TEXT_CHARS = 2_000_000
const MAX_ENCODED_PATCH_CHARS = 8_000_000
const MAX_WORKSPACE_READ_LINE_NUMBER = 2_147_483_647

export interface NormalizedWorkspaceReadInput {
  fileRefs: string[]
  filePaths: string[]
  startLine?: number
  endLine?: number
  error?: string
}

export type NormalizedGitDiffInput =
  | { ok: true; filePaths: string[] }
  | { ok: false; error: string }

export type NormalizedWorkspaceWriteEdits =
  | { ok: true; edits: unknown[] | undefined }
  | { ok: false; error: string }

/**
 * Recover the narrowly observed double-encoded JSON array used for patch
 * edits. A present malformed value fails closed so it can never degrade into
 * an empty full-file replacement when a provider also defaults `content` to
 * an empty string.
 */
export function normalizeWorkspaceWriteEdits(
  value: unknown,
  present: boolean
): NormalizedWorkspaceWriteEdits {
  if (!present) return { ok: true, edits: undefined }
  if (value == null) return malformedWorkspaceWriteEdits()

  let candidate: unknown = value
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    if (
      !trimmed ||
      !trimmed.startsWith('[') ||
      !trimmed.endsWith(']') ||
      trimmed.length > MAX_ENCODED_PATCH_CHARS
    ) {
      return malformedWorkspaceWriteEdits()
    }
    try {
      candidate = JSON.parse(trimmed) as unknown
    } catch {
      return malformedWorkspaceWriteEdits()
    }
  }

  if (
    !Array.isArray(candidate) ||
    candidate.length === 0 ||
    candidate.length > MAX_WORKSPACE_PATCH_EDITS
  ) {
    return malformedWorkspaceWriteEdits()
  }

  const edits: Array<Record<string, string>> = []
  for (const item of candidate) {
    if (
      item == null ||
      typeof item !== 'object' ||
      Array.isArray(item)
    ) {
      return malformedWorkspaceWriteEdits()
    }
    const record = item as Record<string, unknown>
    const oldText = record.old_text
    const newText = record.new_text
    if (
      typeof oldText !== 'string' ||
      oldText.length === 0 ||
      oldText.length > MAX_WORKSPACE_PATCH_TEXT_CHARS ||
      typeof newText !== 'string' ||
      newText.length > MAX_WORKSPACE_PATCH_TEXT_CHARS ||
      oldText.includes('\0') ||
      newText.includes('\0')
    ) {
      return malformedWorkspaceWriteEdits()
    }
    if (oldText === newText) {
      return {
        ok: false,
        error:
          'An edit has identical old_text and new_text, so it cannot change the file. If the intended change is already present, confirm it with workspace_read instead of re-writing it; otherwise provide the corrected new_text.',
      }
    }
    edits.push({ old_text: oldText, new_text: newText })
  }
  return { ok: true, edits }
}

function malformedWorkspaceWriteEdits(): NormalizedWorkspaceWriteEdits {
  return {
    ok: false,
    error:
      'Malformed workspace_write edits. Provide an array of up to 16 exact {old_text, new_text} string objects, then retry.',
  }
}

export function normalizeGitDiffInput(
  input: Record<string, unknown>
): NormalizedGitDiffInput {
  const pluralPresent = Object.prototype.hasOwnProperty.call(input, 'file_paths')
  const singularPresent = Object.prototype.hasOwnProperty.call(input, 'file_path')
  if (!pluralPresent && !singularPresent) return { ok: true, filePaths: [] }

  const plural = pluralPresent ? strictStringList(input.file_paths, 24) : []
  const singular = singularPresent ? strictStringList(input.file_path, 24) : []
  if (plural == null || singular == null) return malformedGitDiffScope()
  const filePaths = uniqueWorkspaceReadValues([...plural, ...singular])
  if (filePaths.length === 0 || filePaths.length > 24) {
    return malformedGitDiffScope()
  }
  return { ok: true, filePaths }
}

function malformedGitDiffScope(): NormalizedGitDiffInput {
  return {
    ok: false,
    error:
      'Malformed git_diff file scope. Omit file_paths for the full bound workspace diff, or provide 1 to 24 exact string paths.',
  }
}

/**
 * Providers occasionally serialize a JSON-schema array a second time. Accept
 * that bounded shape (and the documented singular aliases) without resolving
 * or trusting any path here; Electron still enforces the captured workspace
 * binding and open-root boundary for every normalized value.
 */
export function normalizeWorkspaceReadInput(
  input: Record<string, unknown>
): NormalizedWorkspaceReadInput {
  const fileRefs = uniqueWorkspaceReadValues([
    ...boundedStringList(input.file_refs, MAX_WORKSPACE_READ_FILES),
    ...boundedStringList(input.file_ref, MAX_WORKSPACE_READ_FILES),
  ]).slice(0, MAX_WORKSPACE_READ_FILES)
  const remaining = Math.max(0, MAX_WORKSPACE_READ_FILES - fileRefs.length)
  const filePaths = uniqueWorkspaceReadValues([
    ...boundedStringList(input.file_paths, MAX_WORKSPACE_READ_FILES),
    ...boundedStringList(input.file_path, MAX_WORKSPACE_READ_FILES),
  ]).slice(0, remaining)
  const startPresent = Object.prototype.hasOwnProperty.call(input, 'start_line')
  const endPresent = Object.prototype.hasOwnProperty.call(input, 'end_line')
  const startLine = positiveLineNumber(input.start_line)
  const endLine = positiveLineNumber(input.end_line)
  const malformedRange =
    (startPresent && startLine == null) || (endPresent && endLine == null)
  return {
    fileRefs,
    filePaths,
    ...(startLine == null ? {} : { startLine }),
    ...(endLine == null ? {} : { endLine }),
    ...(malformedRange
      ? {
          error:
            'Malformed workspace_read line range. start_line and end_line must be positive whole numbers.',
        }
      : {}),
  }
}

function positiveLineNumber(value: unknown): number | undefined {
  let line: number
  if (typeof value === 'number') {
    line = value
  } else if (
    typeof value === 'string' &&
    /^[1-9]\d{0,9}$/.test(value)
  ) {
    line = Number(value)
  } else {
    return undefined
  }
  return Number.isSafeInteger(line) &&
    line >= 1 &&
    line <= MAX_WORKSPACE_READ_LINE_NUMBER
    ? line
    : undefined
}

function boundedStringList(value: unknown, limit: number): string[] {
  if (Array.isArray(value)) return safeWorkspaceReadStrings(value)
  if (typeof value !== 'string') return []
  const trimmed = safeWorkspaceReadString(value)
  if (!trimmed) return []
  if (
    trimmed.startsWith('[') &&
    trimmed.endsWith(']') &&
    trimmed.length <= Math.max(MAX_ENCODED_LIST_CHARS, limit * MAX_WORKSPACE_READ_VALUE_CHARS + 1_024)
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return safeWorkspaceReadStrings(parsed)
    } catch {
      // A normal path may contain brackets; leave it as a single path below.
    }
  }
  return [trimmed]
}

function strictStringList(value: unknown, limit: number): string[] | null {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    const trimmed = safeWorkspaceReadString(candidate)
    if (!trimmed) return null
    if (trimmed.startsWith('[') || trimmed.endsWith(']')) {
      if (
        !trimmed.startsWith('[') ||
        !trimmed.endsWith(']') ||
        trimmed.length >
          Math.max(
            MAX_ENCODED_LIST_CHARS,
            limit * MAX_WORKSPACE_READ_VALUE_CHARS + 1_024
          )
      ) {
        return null
      }
      try {
        candidate = JSON.parse(trimmed) as unknown
      } catch {
        return null
      }
    } else {
      return [trimmed]
    }
  }
  if (
    !Array.isArray(candidate) ||
    candidate.length === 0 ||
    candidate.length > limit
  ) {
    return null
  }
  const values = safeWorkspaceReadStrings(candidate)
  return values.length === candidate.length ? values : null
}

function safeWorkspaceReadStrings(values: unknown[]): string[] {
  return values
    .map((value) =>
      typeof value === 'string' ? safeWorkspaceReadString(value) : null
    )
    .filter((value): value is string => value != null)
}

function safeWorkspaceReadString(value: string): string | null {
  const trimmed = value.trim()
  if (
    !trimmed ||
    trimmed.length > MAX_WORKSPACE_READ_VALUE_CHARS ||
    trimmed.includes('\0')
  ) {
    return null
  }
  return trimmed
}

function uniqueWorkspaceReadValues(values: string[]): string[] {
  return [...new Set(values)]
}
