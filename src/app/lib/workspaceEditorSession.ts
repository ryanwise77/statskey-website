export interface StoredWorkspaceEditorDocument extends Record<string, unknown> {
  path?: unknown
  draft?: unknown
}

export interface StoredWorkspaceEditorSession {
  selectedPath?: unknown
  secondaryPath?: unknown
  focusedPath?: unknown
  documents: StoredWorkspaceEditorDocument[]
}

export interface ResolvedWorkspaceEditorSession {
  source: 'transient' | 'draft-recovery' | 'durable-empty'
  session: StoredWorkspaceEditorSession
}

function parseStoredWorkspaceEditorSession(
  raw: string | null
): StoredWorkspaceEditorSession | null {
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.documents)
    ) {
      return null
    }
    return {
      selectedPath: parsed.selectedPath,
      secondaryPath: parsed.secondaryPath,
      focusedPath: parsed.focusedPath,
      documents: parsed.documents.filter(
        (candidate): candidate is StoredWorkspaceEditorDocument =>
          candidate != null && typeof candidate === 'object'
      ),
    }
  } catch {
    return null
  }
}

export function durableWorkspaceEditorSession(
  session: StoredWorkspaceEditorSession
): StoredWorkspaceEditorSession {
  const documents = session.documents.filter(
    (document) =>
      typeof document.path === 'string' && typeof document.draft === 'string'
  )
  const retainedPaths = new Set(
    documents.map((document) => String(document.path))
  )
  const retainPath = (candidate: unknown) =>
    typeof candidate === 'string' && retainedPaths.has(candidate)
      ? candidate
      : null

  return {
    selectedPath: retainPath(session.selectedPath),
    secondaryPath: retainPath(session.secondaryPath),
    focusedPath: retainPath(session.focusedPath),
    documents,
  }
}

export function resolveWorkspaceEditorSession(
  transientRaw: string | null,
  durableRaw: string | null
): ResolvedWorkspaceEditorSession | null {
  const transient = parseStoredWorkspaceEditorSession(transientRaw)
  if (transient) {
    return { source: 'transient', session: transient }
  }

  const durable = parseStoredWorkspaceEditorSession(durableRaw)
  if (!durable) return null
  const recovery = durableWorkspaceEditorSession(durable)
  if (recovery.documents.length === 0) {
    return { source: 'durable-empty', session: recovery }
  }
  return { source: 'draft-recovery', session: recovery }
}
