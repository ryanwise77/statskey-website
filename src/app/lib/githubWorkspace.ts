import { useEffect, useState } from 'react'
import { auth } from './firebase'

const WORKBENCH_API =
  import.meta.env.VITE_WORKBENCH_API_URL ??
  'https://us-central1-statskey-workbench.cloudfunctions.net/workbenchApi'
const CONNECTION_EVENT = 'statskey:github-workspace-connection'

export interface GitHubWorkspaceConnection {
  status: 'connected' | 'disconnected' | 'unknown'
  login?: string
  avatarUrl?: string
}

export interface GitHubRepository {
  id: number
  fullName: string
  name: string
  owner: string
  private: boolean
  defaultBranch: string
  canPush: boolean
  updatedAt: string | null
}

export interface GitHubBranch {
  name: string
  sha: string | null
  protected: boolean
}

export interface GitHubTreeFile {
  path: string
  sha: string
  size: number
}

export interface GitHubTree {
  headSha: string
  treeSha: string
  truncated: boolean
  files: GitHubTreeFile[]
}

export interface GitHubFile {
  path: string
  sha: string
  size: number
  encoding: string
  content: string
  downloadUrl: string | null
}

export class WorkbenchError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'WorkbenchError'
    this.status = status
    this.code = code
  }
}

/**
 * True when a commit failed because the branch moved ahead of the base
 * commit the browser was editing against.
 */
export function isGitHubConflictError(error: unknown): boolean {
  if (error instanceof WorkbenchError && error.status === 409) return true
  return (
    error instanceof Error &&
    /conflict|fast[- ]?forward|expected.*head|stale/i.test(error.message)
  )
}

function draftStorageKey(repository: string, branch: string, path: string) {
  return `statskey.github.draft:${repository}:${branch}:${path}`
}

export function readStoredDraft(
  repository: string,
  branch: string,
  path: string
): string | null {
  try {
    return localStorage.getItem(draftStorageKey(repository, branch, path))
  } catch {
    return null
  }
}

/** Returns false when storage is unavailable or over quota. */
export function writeStoredDraft(
  repository: string,
  branch: string,
  path: string,
  draft: string
): boolean {
  try {
    localStorage.setItem(draftStorageKey(repository, branch, path), draft)
    return true
  } catch {
    return false
  }
}

export function clearStoredDraft(
  repository: string,
  branch: string,
  path: string
) {
  try {
    localStorage.removeItem(draftStorageKey(repository, branch, path))
  } catch {
    // Storage may be unavailable; nothing to clean up in that case.
  }
}

/**
 * Git blob sha for text content (sha1 over "blob {byteLength}\0{content}"),
 * used to keep local file state consistent after a commit without
 * re-downloading anything. Returns null when WebCrypto is unavailable.
 */
export async function gitBlobSha(content: string): Promise<string | null> {
  try {
    const encoder = new TextEncoder()
    const body = encoder.encode(content)
    const header = encoder.encode(`blob ${body.byteLength}\u0000`)
    const bytes = new Uint8Array(header.byteLength + body.byteLength)
    bytes.set(header, 0)
    bytes.set(body, header.byteLength)
    const digest = await crypto.subtle.digest('SHA-1', bytes)
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

export function useGitHubWorkspaceConnection(uid: string | undefined) {
  const [connection, setConnection] = useState<GitHubWorkspaceConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setConnection(null)
      setLoading(false)
      return
    }
    let active = true
    const refresh = () => {
      setLoading(true)
      workbenchCall<GitHubWorkspaceConnection>('connectionStatus', {})
        .then((next) => {
          if (!active) return
          setConnection(next)
          setError(null)
        })
        .catch((statusError) => {
          if (active) setError(messageFor(statusError))
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }
    const onConnection = () => refresh()
    window.addEventListener(CONNECTION_EVENT, onConnection)
    refresh()
    return () => {
      active = false
      window.removeEventListener(CONNECTION_EVENT, onConnection)
    }
  }, [uid])

  return { connection, loading, error }
}

export interface GitHubDeviceAuthorization {
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

export type GitHubDevicePollResult =
  | { status: 'pending'; interval?: number }
  | { status: 'connected'; login?: string }
  | { status: 'expired' }
  | { status: 'denied' }

export async function connectGitHubWorkspace(token: string) {
  await workbenchCall('connect', { token })
  window.dispatchEvent(new Event(CONNECTION_EVENT))
}

export async function startGitHubDeviceAuthorization() {
  return workbenchCall<GitHubDeviceAuthorization>('deviceStart', {})
}

export async function pollGitHubDeviceAuthorization() {
  const result = await workbenchCall<GitHubDevicePollResult>('devicePoll', {})
  if (result.status === 'connected') {
    window.dispatchEvent(new Event(CONNECTION_EVENT))
  }
  return result
}

export async function disconnectGitHubWorkspace() {
  await workbenchCall('disconnect', {})
  window.dispatchEvent(new Event(CONNECTION_EVENT))
}

export async function listGitHubRepositories() {
  return (await workbenchCall<{ repositories: GitHubRepository[] }>(
    'repositories',
    {}
  )).repositories
}

export async function listGitHubBranches(repository: string) {
  return (await workbenchCall<{ branches: GitHubBranch[] }>(
    'branches',
    { repository }
  )).branches
}

export async function getGitHubTree(repository: string, branch: string) {
  return workbenchCall<GitHubTree>('tree', { repository, branch })
}

export async function readGitHubFile(
  repository: string,
  branch: string,
  path: string
) {
  return workbenchCall<GitHubFile>('readFile', {
    repository,
    branch,
    path,
  })
}

export async function commitGitHubChanges(params: {
  repository: string
  branch: string
  baseCommitSha: string
  message: string
  changes: Array<{ path: string; content: string | null }>
}) {
  return workbenchCall<{
    commitSha: string
    commitUrl: string
    branch: string
  }>('commit', params)
}

async function workbenchCall<T>(
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new Error('Sign in to StatsKey.')
  const idToken = await user.getIdToken()
  let response: Response
  try {
    response = await fetch(WORKBENCH_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, payload }),
    })
  } catch (fetchError) {
    if (fetchError instanceof TypeError) {
      throw new Error(
        'You appear to be offline. Check your connection and try again.'
      )
    }
    throw fetchError
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: T
    error?: { code?: string; message?: string }
  }
  if (!response.ok || body.data === undefined) {
    throw new WorkbenchError(
      body.error?.message || `Workbench request failed (${response.status}).`,
      response.status,
      body.error?.code ?? null
    )
  }
  return body.data
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
