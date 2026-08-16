export interface WorkspacePatchEdit {
  oldText: string
  newText: string
}

export function workspacePatchEdits(value: unknown): WorkspacePatchEdit[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        item != null && typeof item === 'object'
    )
    .map((item) => ({
      oldText: typeof item.old_text === 'string' ? item.old_text : '',
      newText: typeof item.new_text === 'string' ? item.new_text : '',
    }))
    .filter((edit) => edit.oldText.length > 0)
    .slice(0, 16)
}

/**
 * Managed tool adapters can materialize an omitted optional string as `""`.
 * An empty default must not turn an otherwise valid edit-only request into a
 * contradictory full-file replacement. Non-empty content remains explicit so
 * the executor can continue rejecting genuinely mixed write modes.
 */
export function workspaceReplacementContent(
  value: unknown,
  edits: WorkspacePatchEdit[]
): string | undefined {
  if (typeof value !== 'string') return undefined
  if (edits.length > 0 && value.length === 0) return undefined
  return value
}

export function applyWorkspaceEdits(
  content: string,
  edits: WorkspacePatchEdit[]
): string {
  let nextContent = content
  for (const edit of edits) {
    const first = nextContent.indexOf(edit.oldText)
    const second =
      first < 0
        ? -1
        : nextContent.indexOf(edit.oldText, first + edit.oldText.length)
    if (first < 0) {
      throw new Error(
        'An old_text edit did not match the current file. Read the relevant section and retry with exact text.'
      )
    }
    if (second >= 0) {
      throw new Error(
        'An old_text edit matched more than once. Include more surrounding text so the edit is unique.'
      )
    }
    nextContent = `${nextContent.slice(0, first)}${edit.newText}${nextContent.slice(
      first + edit.oldText.length
    )}`
  }
  return nextContent
}
