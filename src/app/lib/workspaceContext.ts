import {
  getDesktopBridge,
  type DesktopRecentProject,
  type DesktopWorkspaceBinding,
  type DesktopWorkspaceImportResult,
  type DesktopWorkspaceState,
} from './desktop'

export interface WorkspaceAttachment {
  path: string
  name: string
  relativePath: string
}

export interface ActiveWorkspaceDocument extends WorkspaceAttachment {
  content: string
}

export interface WorkspaceMutation {
  kind: 'write' | 'create' | 'delete' | 'rename' | 'terminal' | 'restore'
  paths: string[]
  previousPaths?: string[]
  refreshAll?: boolean
}

const STORAGE_KEY = 'statskey.desktop.workspace-context.v1'
export const WORKSPACE_CONTEXT_EVENT = 'statskey:workspace-context'
export const WORKSPACE_MUTATION_EVENT = 'statskey:workspace-mutation'
export const WORKSPACE_QUICK_TOOL_EVENT = 'statskey:workspace-quick-tool'
export const WORKSPACE_OPEN_FILE_EVENT = 'statskey:workspace-open-file'
const WORKSPACE_PENDING_TOOL_KEY = 'statskey.workspace.pendingQuickTool'
const WORKSPACE_PENDING_FILE_KEY = 'statskey.workspace.pendingFileOpen'
export type WorkspaceQuickTool =
  | 'editor'
  | 'explorer'
  | 'terminal'
  | 'changes'
  | 'agent'
  | 'split'
  | 'more'
  | 'open-project'
  | 'new-project'
  | 'quick-open'
  | 'search-files'
  | 'add-files'

export interface WorkspaceFileOpenRequest {
  path: string
  line?: number
}
let activeWorkspaceDocument: ActiveWorkspaceDocument | null = null

export function setActiveWorkspaceDocument(
  next: ActiveWorkspaceDocument | null
) {
  activeWorkspaceDocument = next
}

export function announceWorkspaceMutation(mutation: WorkspaceMutation) {
  window.dispatchEvent(
    new CustomEvent<WorkspaceMutation>(WORKSPACE_MUTATION_EVENT, {
      detail: mutation,
    })
  )
}

export interface WorkspaceProjectBinding {
  id?: string
  label: string
  roots: string[]
}

export function captureWorkspaceBinding(
  source: DesktopWorkspaceState | WorkspaceProjectBinding | null | undefined
): DesktopWorkspaceBinding | null {
  if (!source) return null
  const candidate =
    'workspaceId' in source ? source.workspaceId : source.id
  if (typeof candidate !== 'string' || !/^[a-f0-9]{20}$/.test(candidate)) {
    return null
  }
  return Object.freeze({ workspaceId: candidate })
}

const DEFAULT_WORKSPACE_IMPORT_ERROR =
  'The workspace file could not be imported.'

export function workspaceImportResultError(
  result: DesktopWorkspaceImportResult
): string | null {
  if (result.cancelled || (result.ok && result.workspace)) return null
  return result.error?.trim() || DEFAULT_WORKSPACE_IMPORT_ERROR
}

export async function currentProjectBinding(): Promise<WorkspaceProjectBinding | null> {
  const bridge = getDesktopBridge()
  if (!bridge) return null
  const [workspace, recents] = await Promise.all([
    bridge.workspace.getState(),
    bridge.workspace.recentProjects(),
  ])
  return projectBindingForWorkspace(workspace, recents)
}

export function projectBindingForWorkspace(
  workspace: DesktopWorkspaceState,
  recents: DesktopRecentProject[]
): WorkspaceProjectBinding | null {
  const roots = workspace.roots.map((root) => root.path).sort()
  const looseFiles = workspace.looseFiles
    .filter((file) => file.kind === 'file')
    .sort((left, right) => left.path.localeCompare(right.path))
  if (roots.length === 0 && looseFiles.length === 0) return null
  const workspaceId =
    typeof workspace.workspaceId === 'string' && workspace.workspaceId.trim()
      ? workspace.workspaceId.trim()
      : undefined
  const recent =
    recents.find((project) => project.id === workspaceId) ||
    (!workspaceId
      ? recents.find((project) => sameProjectRoots(project.roots, roots))
      : undefined)
  const label =
    workspace.importedWorkspace?.name.replace(/\.code-workspace$/i, '') ||
    recent?.name.replace(/\.code-workspace$/i, '') ||
    (workspace.roots.length === 1
      ? workspace.roots[0].name
      : workspace.roots.length > 1
        ? `${workspace.roots[0].name} +${workspace.roots.length - 1}`
        : looseFiles.length === 1
          ? looseFiles[0].name
          : `${looseFiles[0].name} +${looseFiles.length - 1}`)
  const compact = label.trim() || 'Workspace'
  return {
    id: workspaceId || recent?.id,
    label: compact.slice(0, 120),
    roots,
  }
}

export function sameProjectRoots(
  left: string[] | undefined,
  right: string[] | undefined
): boolean {
  if (!left || !right || left.length !== right.length) return false
  const normalizedLeft = [...left].sort()
  const normalizedRight = [...right].sort()
  return normalizedLeft.every((root, index) => root === normalizedRight[index])
}

export function requestWorkspaceQuickTool(tool: WorkspaceQuickTool) {
  sessionStorage.setItem(WORKSPACE_PENDING_TOOL_KEY, tool)
  window.dispatchEvent(
    new CustomEvent<WorkspaceQuickTool>(WORKSPACE_QUICK_TOOL_EVENT, {
      detail: tool,
    })
  )
}

export function consumeWorkspaceQuickTool(): WorkspaceQuickTool | null {
  const stored = sessionStorage.getItem(WORKSPACE_PENDING_TOOL_KEY)
  sessionStorage.removeItem(WORKSPACE_PENDING_TOOL_KEY)
  return isWorkspaceQuickTool(stored) ? stored : null
}

export function requestWorkspaceFileOpen(request: WorkspaceFileOpenRequest) {
  const safe = {
    path: request.path.slice(0, 2_000),
    line:
      typeof request.line === 'number' && Number.isFinite(request.line)
        ? Math.max(1, Math.floor(request.line))
        : undefined,
  }
  sessionStorage.setItem(WORKSPACE_PENDING_FILE_KEY, JSON.stringify(safe))
  window.dispatchEvent(
    new CustomEvent<WorkspaceFileOpenRequest>(WORKSPACE_OPEN_FILE_EVENT, {
      detail: safe,
    })
  )
}

export function consumeWorkspaceFileOpenRequest(): WorkspaceFileOpenRequest | null {
  const stored = sessionStorage.getItem(WORKSPACE_PENDING_FILE_KEY)
  sessionStorage.removeItem(WORKSPACE_PENDING_FILE_KEY)
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored) as Partial<WorkspaceFileOpenRequest>
    if (typeof parsed.path !== 'string' || !parsed.path.trim()) return null
    return {
      path: parsed.path.slice(0, 2_000),
      line:
        typeof parsed.line === 'number' && Number.isFinite(parsed.line)
          ? Math.max(1, Math.floor(parsed.line))
          : undefined,
    }
  } catch {
    return null
  }
}

function isWorkspaceQuickTool(value: unknown): value is WorkspaceQuickTool {
  return [
    'editor',
    'explorer',
    'terminal',
    'changes',
    'agent',
    'split',
    'more',
    'open-project',
    'new-project',
    'quick-open',
    'search-files',
    'add-files',
  ].includes(String(value))
}

export function getWorkspaceAttachments(): WorkspaceAttachment[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is WorkspaceAttachment =>
          item != null &&
          typeof item === 'object' &&
          typeof (item as WorkspaceAttachment).path === 'string' &&
          typeof (item as WorkspaceAttachment).name === 'string' &&
          typeof (item as WorkspaceAttachment).relativePath === 'string'
      )
      .slice(0, 20)
  } catch {
    return []
  }
}

export function setWorkspaceAttachments(next: WorkspaceAttachment[]) {
  const deduplicated = [
    ...new Map(next.map((attachment) => [attachment.path, attachment])).values(),
  ].slice(0, 20)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deduplicated))
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_CONTEXT_EVENT, { detail: deduplicated })
  )
}

export function toggleWorkspaceAttachment(attachment: WorkspaceAttachment): boolean {
  const current = getWorkspaceAttachments()
  const exists = current.some((item) => item.path === attachment.path)
  setWorkspaceAttachments(
    exists
      ? current.filter((item) => item.path !== attachment.path)
      : [...current, attachment]
  )
  return !exists
}

export function clearWorkspaceAttachments() {
  setWorkspaceAttachments([])
}

export async function workspaceContextForPrompt(
  maxCharacters: number,
  binding?: DesktopWorkspaceBinding
): Promise<string> {
  const bridge = getDesktopBridge()
  if (!bridge || maxCharacters <= 0) return ''
  const capturedActiveDocument = activeWorkspaceDocument
  const verifiedActiveDocument =
    binding && capturedActiveDocument
      ? await bridge.workspace
          .readFile(capturedActiveDocument.path, false, binding)
          .then((file) =>
            file?.content == null
              ? null
              : {
                  path: file.path,
                  name: file.name,
                  relativePath: file.relativePath,
                  content: file.content,
                }
          )
      : capturedActiveDocument
  const attachments = getWorkspaceAttachments().filter(
    (attachment) => attachment.path !== verifiedActiveDocument?.path
  )
  if (!verifiedActiveDocument && attachments.length === 0) return ''

  const sections: string[] = []
  let used = 0
  if (verifiedActiveDocument?.content) {
    const header = `\n\n--- Active workspace file: ${verifiedActiveDocument.relativePath} ---\n`
    const remaining = maxCharacters - header.length
    if (remaining > 0) {
      const content = verifiedActiveDocument.content.slice(0, remaining)
      sections.push(`${header}${content}`)
      used += header.length + content.length
    }
  }
  for (const attachment of attachments) {
    const file = await bridge.workspace.readFile(
      attachment.path,
      true,
      binding
    )
    if (!file?.content) continue
    const header = `\n\n--- Workspace file: ${attachment.relativePath} ---\n`
    const remaining = maxCharacters - used - header.length
    if (remaining <= 0) break
    const content = file.content.slice(0, remaining)
    sections.push(`${header}${content}`)
    used += header.length + content.length
  }
  return sections.join('')
}
