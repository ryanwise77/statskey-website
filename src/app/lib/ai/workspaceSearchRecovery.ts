const GENERIC_SEARCH_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'code',
  'file',
  'files',
  'find',
  'folder',
  'folders',
  'for',
  'from',
  'in',
  'inside',
  'locate',
  'of',
  'open',
  'project',
  'search',
  'source',
  'the',
  'this',
  'to',
  'workspace',
])

const SOURCE_FILE_PATTERN =
  /(?:^|[\s"'`(])((?:[\w@.+-]+[\\/])*[\w@.+-]+\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|json|jsx|kt|md|mjs|mm|php|plist|py|rb|rs|sh|sql|swift|toml|ts|tsx|vue|xml|ya?ml))(?=$|[\s"'`),:;])/gi

function deCamelCase(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

function searchTokens(value: string): string[] {
  return deCamelCase(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !GENERIC_SEARCH_WORDS.has(token)
    )
}

function addCandidate(target: string[], seen: Set<string>, value: string) {
  const candidate = value.trim().replace(/^["'`]+|["'`]+$/g, '')
  if (!candidate || candidate.length > 200) return
  const key = candidate.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  target.push(candidate)
}

/**
 * Canonicalizes harmless wording differences so an agent cannot spend ten
 * rounds repeating the same failed workspace lookup.
 */
export function workspaceSearchSignature(query: string): string {
  const tokens = [...new Set(searchTokens(query))].sort()
  return tokens.length > 0
    ? tokens.join(':')
    : query.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Produces a small, deterministic broadening plan for the direct workspace
 * scanner. A verbose natural-language query therefore gets one useful retry
 * by filename/identifier instead of a sequence of model-authored misses.
 */
export function workspaceSearchCandidates(query: string): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  const trimmed = query.trim().replace(/\s+/g, ' ')
  addCandidate(candidates, seen, trimmed)

  for (const match of trimmed.matchAll(SOURCE_FILE_PATTERN)) {
    const path = match[1].replace(/\\/g, '/')
    addCandidate(candidates, seen, path)
    addCandidate(candidates, seen, path.split('/').at(-1) || '')
  }

  for (const match of trimmed.matchAll(/["'`]([^"'`]{2,160})["'`]/g)) {
    addCandidate(candidates, seen, match[1])
  }

  const rawIdentifiers = trimmed.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []
  const meaningfulIdentifiers = rawIdentifiers.filter(
    (identifier) =>
      !GENERIC_SEARCH_WORDS.has(identifier.toLowerCase()) &&
      (/[A-Z].*[A-Z]|[a-z][A-Z]|[_$]/.test(identifier) || identifier.length >= 5)
  )
  for (const identifier of meaningfulIdentifiers.slice(0, 3)) {
    addCandidate(candidates, seen, identifier)
  }

  const tokens = [...new Set(searchTokens(trimmed))]
  for (const token of tokens.sort((a, b) => b.length - a.length).slice(0, 3)) {
    addCandidate(candidates, seen, token)
  }

  return candidates.slice(0, 6)
}

export class WorkspaceSearchRecoveryState {
  private misses = new Map<string, number>()

  plan(query: string): {
    signature: string
    candidates: string[]
    repeatedMiss: boolean
    previousMisses: number
  } {
    const signature = workspaceSearchSignature(query)
    const previousMisses = this.misses.get(signature) ?? 0
    return {
      signature,
      candidates: workspaceSearchCandidates(query),
      repeatedMiss: previousMisses > 0,
      previousMisses,
    }
  }

  record(signature: string, matchCount: number) {
    if (matchCount > 0) {
      this.misses.delete(signature)
      return
    }
    this.misses.set(signature, (this.misses.get(signature) ?? 0) + 1)
  }
}

interface SearchStepLike {
  name: string
  status: 'running' | 'done' | 'error'
  resultMeta?: string
}

/** A run's workspace binding is immutable, so one successful manifest is enough. */
export function workspaceManifestAlreadyLoaded(steps: SearchStepLike[]): boolean {
  return steps.some(
    (step) => step.name === 'workspace_manifest' && step.status === 'done'
  )
}

/** After two exhaustive misses, remove search from subsequent model rounds. */
export function workspaceSearchMissBudgetExhausted(
  steps: SearchStepLike[],
  limit = 2
): boolean {
  const misses = steps.filter(
    (step) =>
      step.name === 'workspace_search' &&
      step.status !== 'running' &&
      /workspace scan exhausted|equivalent search skipped/i.test(
        step.resultMeta ?? ''
      )
  ).length
  return misses >= limit
}

export function workspaceManifestProgressMeta(result: Record<string, unknown>): string {
  if (!result.available) return 'no workspace open'
  const rootCount = Array.isArray(result.roots) ? result.roots.length : 0
  const addedCount = Array.isArray(result.added_files)
    ? result.added_files.length
    : 0
  const attachedCount = Number(result.attached_count ?? 0)
  const parts: string[] = []
  if (rootCount > 0) {
    parts.push(`${rootCount} workspace ${rootCount === 1 ? 'folder' : 'folders'} ready`)
  }
  if (addedCount > 0) {
    parts.push(`${addedCount} added ${addedCount === 1 ? 'file' : 'files'}`)
  }
  if (attachedCount > 0) {
    parts.push(`${attachedCount} chat ${attachedCount === 1 ? 'attachment' : 'attachments'}`)
  }
  return parts.join(' · ') || 'workspace ready'
}
