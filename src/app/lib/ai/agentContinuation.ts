import {
  hasReviewableWorkspaceChange,
  hasOutstandingFileMutationFailure,
  hasSuccessfulFileChange,
  hasStructuredDeviceRunVerification,
  implementationReadyForHandoff,
  type AgentMode,
  type PersistenceStep,
} from './agentPersistence'
import type { AnthropicContentBlock } from './anthropic'

/**
 * One independent implementation pass retains the provider-specific round
 * budget. Four passes allow investigation, implementation, verification, and
 * one direct-action recovery without permitting an unbounded autonomous run.
 */
export const MAX_INDEPENDENT_IMPLEMENTATION_PASSES = 4

export type IndependentContinuationReason =
  | 'ineligible'
  | 'stopped'
  | 'provider_unavailable'
  | 'global_cap'
  | 'required_verification_cap'
  | 'genuine_blocker'
  | 'completed'
  | 'action_budget'
  | 'explicit_follow_up'
  | 'mutation_incomplete'
  | 'unsupported_claim'
  | 'correction_cap'
  | 'verification_incomplete'
  | 'no_file_change'

export interface IndependentContinuationDecision {
  shouldContinue: boolean
  reason: IndependentContinuationReason
}

/** Keep every original multimodal block byte-for-byte and append only policy. */
export function userContentWithAutomaticContinuation(
  original: string | AnthropicContentBlock[],
  continuation?: string
): string | AnthropicContentBlock[] {
  if (!continuation) return original
  return typeof original === 'string'
    ? `${original}\n\n${continuation}`
    : [...original, { type: 'text', text: continuation }]
}

export function independentImplementationContinuationDecision(input: {
  approvalMode: string
  mode: AgentMode
  workspaceChangeExpected: boolean
  objective?: string
  content: string
  steps: PersistenceStep[]
  stopped: boolean
  /** A provider deadline already produced the terminal saved-work handoff. */
  providerUnavailable?: boolean
  completedPasses: number
  maxPasses?: number
  /** A prior pass admitted a remaining mutation; only a later persisted write clears it. */
  correctiveMutationRequired?: boolean
  correctionBoundary?: number
  /** Code/file claims that still need trusted post-write read or diff evidence. */
  requiredClaimIdentifiers?: string[]
}): IndependentContinuationDecision {
  if (
    input.approvalMode !== 'everything' ||
    !input.workspaceChangeExpected ||
    (input.mode !== 'agent' && input.mode !== 'debug')
  ) {
    return { shouldContinue: false, reason: 'ineligible' }
  }
  if (input.stopped) return { shouldContinue: false, reason: 'stopped' }
  if (input.providerUnavailable) {
    return { shouldContinue: false, reason: 'provider_unavailable' }
  }

  const maxPasses = Math.max(
    1,
    Math.floor(input.maxPasses ?? MAX_INDEPENDENT_IMPLEMENTATION_PASSES)
  )
  const content = String(input.content || '')
  const localActionBudget = reportsLocalActionBudget(content)
  if (reportsConcreteGenuineBlocker(content)) {
    return { shouldContinue: false, reason: 'genuine_blocker' }
  }
  // Provider prose sometimes calls the provider's own round/action ceiling a
  // blocker (for example, "cannot continue because the 14-action budget was
  // exhausted"). That is recoverable at this outer boundary, unlike a real
  // credential, permission, workspace, or user-input dependency.
  if (!localActionBudget && reportsGenericGenuineBlocker(content)) {
    return { shouldContinue: false, reason: 'genuine_blocker' }
  }
  const explicitFollowUp = requiresImplementationFollowUp(content)
  const correctionBoundary = Math.max(
    0,
    Math.floor(input.correctionBoundary ?? input.steps.length)
  )
  const correctionStillRequired =
    input.correctiveMutationRequired === true &&
    !hasSuccessfulFileChange(input.steps.slice(correctionBoundary))
  const mutationIncomplete =
    correctionStillRequired ||
    hasOutstandingFileMutationFailure(input.steps) ||
    reportsOutstandingMutationWork(content)
  const unsupportedClaims = [
    ...new Set([
      ...requiredClaimIdentifiersWithoutEvidence(
        input.requiredClaimIdentifiers ?? [],
        input.steps
      ),
      ...unsupportedImplementationClaimIdentifiers(content, input.steps),
    ]),
  ]
  const hasChangeEvidence =
    hasSuccessfulFileChange(input.steps) ||
    hasReviewableWorkspaceChange(input.steps)
  const missingRecordedVerification = hasChangeEvidence
    ? missingRequiredVerificationKinds(input.objective ?? '', input.steps)
    : []
  const requiredKinds = requiredVerificationKinds(input.objective ?? '')
  const reportedVerificationShortfalls =
    incompleteRequiredVerificationTargets(content)
  const requiredCoreShortfall = [...requiredKinds].some((kind) => {
    const target = verificationTargetForRequiredKind(kind)
    return (
      target != null &&
      (reportedVerificationShortfalls.has(target) ||
        reportedVerificationShortfalls.has('verification'))
    )
  })
  const requiredVerificationIncomplete =
    requiresExplicitImplementationVerification(input.objective ?? '') &&
    (requiredCoreShortfall ||
      (requiredKinds.has('ui exercise') &&
        reportsIncompleteUiExercise(content)) ||
      missingRecordedVerification.length > 0)
  // A continuation pass inherits the reviewed edits and verification from
  // earlier passes. Provider prose such as "no files changed in this pass"
  // must not reopen work after the cumulative completion contract is met.
  // Recorded tool evidence remains authoritative unless the final handoff
  // itself specifically admits that verification required by the objective
  // was downgraded, failed, or never run.
  if (
    !mutationIncomplete &&
    unsupportedClaims.length === 0 &&
    !requiredVerificationIncomplete &&
    (implementationReadyForHandoff(input.mode, input.steps) ||
      explicitExtendedVerificationContractSatisfied(
        input.objective ?? '',
        input.steps
      ))
  ) {
    return { shouldContinue: false, reason: 'completed' }
  }
  if (input.completedPasses >= maxPasses) {
    return {
      shouldContinue: false,
      reason: mutationIncomplete || unsupportedClaims.length > 0
        ? 'correction_cap'
        : requiredVerificationIncomplete
        ? 'required_verification_cap'
        : 'global_cap',
    }
  }
  // A provider may describe the local round budget as a "blocker". That is
  // precisely the recoverable case this outer continuation boundary handles.
  if (mutationIncomplete) {
    return { shouldContinue: true, reason: 'mutation_incomplete' }
  }
  if (unsupportedClaims.length > 0) {
    return { shouldContinue: true, reason: 'unsupported_claim' }
  }
  if (localActionBudget) {
    return { shouldContinue: true, reason: 'action_budget' }
  }
  if (explicitFollowUp) {
    return { shouldContinue: true, reason: 'explicit_follow_up' }
  }
  if (requiredVerificationIncomplete) {
    return { shouldContinue: true, reason: 'verification_incomplete' }
  }
  if (
    hasSuccessfulFileChange(input.steps) ||
    hasReviewableWorkspaceChange(input.steps)
  ) {
    return { shouldContinue: true, reason: 'verification_incomplete' }
  }
  return { shouldContinue: true, reason: 'no_file_change' }
}

export function automaticImplementationContinuationPrompt(input: {
  objective: string
  previousContent: string
  steps: PersistenceStep[]
  nextPass: number
  maxPasses?: number
  correctiveMutationRequired?: boolean
  requiredClaimIdentifiers?: string[]
}): string {
  const maxPasses = Math.max(
    1,
    Math.floor(input.maxPasses ?? MAX_INDEPENDENT_IMPLEMENTATION_PASSES)
  )
  const objective = boundedText(
    String(input.objective || '').split(/\n?<local_evidence>/i)[0],
    8_000
  )
  const previousContent = boundedText(input.previousContent, 12_000)
  const hasChangeEvidence =
    hasSuccessfulFileChange(input.steps) ||
    hasReviewableWorkspaceChange(input.steps)
  const missingVerification = missingRequiredVerificationKinds(
    input.objective,
    input.steps
  )
  const unsupportedClaims = requiredClaimIdentifiersWithoutEvidence(
    input.requiredClaimIdentifiers ??
      unsupportedImplementationClaimIdentifiers(
        input.previousContent,
        input.steps
      ),
    input.steps
  )
  const activity = input.steps
    .filter((step) => step.name !== 'synthesize_answer')
    .slice(-24)
    .map((step, index) => {
      const status = step.status === 'done' ? 'completed' : step.status
      const summary = boundedText(step.summary || step.name, 500)
      const result = step.resultMeta
        ? ` · ${boundedText(step.resultMeta, 500)}`
        : ''
      return `${index + 1}. [${status}] ${summary}${result}`
    })
    .join('\n')

  return [
    `<automatic_implementation_continuation pass="${input.nextPass}" max_passes="${maxPasses}">`,
    'Continue the same active Execute/Fix run automatically. The original user request and its attachment blocks were supplied again unchanged immediately before this instruction. The workspace binding, execution lease, session, and approval mode are also unchanged.',
    'Do not restart broad investigation or ask the user to approve another pass. Resume from the recorded activity, make the smallest remaining safe implementation, verify it, and finish only when the completion contract is met.',
    input.correctiveMutationRequired
      ? 'A prior pass left a file mutation incomplete. Earlier successful edits and checks do not close that gap. Use one exact-path read if needed. If it reports truncated content, continue once with workspace_read start_line/end_line on that same file to expose the exact later target. Then perform the smallest persisted corrective mutation before verification or handoff.'
      : unsupportedClaims.length > 0
        ? `The previous handoff claimed code or file details that conflict with trusted post-write evidence: ${unsupportedClaims.map(claimIdentifierFromObligation).join(', ')}. Read the exact target once. If the claimed result is absent, write the correction; if it is already proven, the exact read or task-scoped diff may resolve the obligation without a redundant edit.`
        : hasChangeEvidence
      ? 'A reviewed change is already recorded. Do not make a redundant edit; complete only the missing recorded requirements. Review a final task-scoped diff only when the original objective explicitly requires it.'
      : 'No valid workspace change is recorded. Evidence collection is closed: do not call broad search, manifest, or status tools, and do not repeat reads or diffs already listed below. Use at most one new exact-path read or task-scoped diff only when essential, then perform a real non-empty workspace mutation before verification or handoff. A proposed file, an empty create, or a path outside the intended captured root does not count.',
    missingVerification.length > 0
      ? `Recorded verification still missing after the reviewed change: ${missingVerification.map(verificationKindPromptLabel).join(', ')}. Run those exact missing checks now; do not substitute or merely describe them.`
      : 'Use the recorded verification evidence and complete only the remaining objective requirements.',
    'If a genuine external, permission, credential, workspace-change, or required-user-input blocker remains, stop and identify it precisely instead of looping.',
    '',
    '<original_objective>',
    objective || 'Complete the original user request.',
    '</original_objective>',
    '',
    '<previous_pass_handoff_untrusted>',
    previousContent || 'The previous pass returned no written handoff.',
    '</previous_pass_handoff_untrusted>',
    '',
    '<recorded_activity>',
    activity || 'No completed tool activity was recorded.',
    '</recorded_activity>',
    '</automatic_implementation_continuation>',
  ].join('\n')
}

/**
 * Detect a concrete provider admission that some requested mutation remains.
 * Generic stale prose such as "implementation incomplete in this pass" is
 * intentionally insufficient; the statement must name an edit/change/apply
 * action or describe a partial persisted result.
 */
export function reportsOutstandingMutationWork(content: string): boolean {
  const bounded = boundedText(content, 16_000)
  return bounded.split(/(?<=[.!?])\s+|\n+/).some((statement) => {
    if (
      /\b(?:no|zero) remaining (?:edits?|changes?|corrections?)\b|\bremaining (?:edits?|changes?|corrections?) (?:were|are|have been) (?:applied|completed|finished)\b/i.test(
        statement
      )
    ) {
      return false
    }
    return (
      /\b(?:remaining|outstanding|follow[- ]?up)\b[^.!?]{0,180}\b(?:edit|change|correction|mutation|patch|apply|implement|replace|update|write)\b/i.test(
        statement
      ) ||
      /\b(?:edit|change|correction|mutation|patch|write)\b[^.!?]{0,180}\b(?:still (?:needs?|has) to be|remains? to be|was not|wasn['’]t|did not|could not|couldn['’]t)\b[^.!?]{0,120}\b(?:applied|completed|persisted|implemented|made|written)?/i.test(
        statement
      ) ||
      /\b(?:partially|partial|only (?:one|some|part of the))\b[^.!?]{0,180}\b(?:persisted|applied|implemented|changed|edited|written)\b/i.test(
        statement
      )
    )
  })
}

/**
 * Return implementation identifiers claimed by the handoff but absent from
 * successful write read-back previews, later exact reads, and scoped diffs.
 * This is deliberately limited to code-shaped identifiers and file paths so
 * ordinary natural-language summaries do not become brittle specifications.
 */
export function unsupportedImplementationClaimIdentifiers(
  content: string,
  steps: PersistenceStep[]
): string[] {
  return unsupportedImplementationClaimObligations(content, steps).map(
    claimIdentifierFromObligation
  )
}

/** Direction-preserving obligations used by automatic continuation state. */
export function unsupportedImplementationClaimObligations(
  content: string,
  steps: PersistenceStep[]
): string[] {
  const evidence = trustedImplementationEvidence(steps)
  if (!evidence.trim()) return []
  const currentEvidence = currentImplementationEvidence(steps) || evidence
  const hasFinalSourceEvidence = hasPostMutationSourceEvidence(steps)
  return [
    ...new Set(
      claimedImplementationClaims(content)
        .filter((claim) =>
          claim.expectation === 'absent'
            ? !hasFinalSourceEvidence ||
              evidenceMatchesIdentifier(currentEvidence, claim.identifier)
            : !evidenceSupportsIdentifier(evidence, claim.identifier)
        )
        .map((claim) =>
          claim.expectation === 'absent'
            ? `absent:${claim.identifier}`
            : claim.identifier
        )
    ),
  ]
}

export function requiredClaimIdentifiersWithoutEvidence(
  claims: string[],
  steps: PersistenceStep[]
): string[] {
  const evidence = trustedImplementationEvidence(steps)
  if (!evidence.trim()) return [...new Set(claims)]
  const currentEvidence = currentImplementationEvidence(steps) || evidence
  const hasFinalSourceEvidence = hasPostMutationSourceEvidence(steps)
  return [...new Set(claims)].filter((claim) => {
    const identifier = claimIdentifierFromObligation(claim)
    return claim.startsWith('absent:')
      ? !hasFinalSourceEvidence ||
          evidenceMatchesIdentifier(currentEvidence, identifier)
      : !evidenceSupportsIdentifier(evidence, identifier)
  })
}

function claimIdentifierFromObligation(claim: string): string {
  return claim.startsWith('absent:') ? claim.slice('absent:'.length) : claim
}

function trustedImplementationEvidence(steps: PersistenceStep[]): string {
  const values: string[] = []
  for (const step of steps) {
    const successfulMutation = hasSuccessfulFileChange([step])
    const exactRead = step.name === 'workspace_read' && step.status === 'done'
    const scopedDiff =
      step.name === 'git_diff' &&
      step.status === 'done' &&
      step.resultMeta === 'scoped diff read'
    if (!successfulMutation && !exactRead && !scopedDiff) continue
    values.push(
      step.preview?.title ?? '',
      step.preview?.filePath ?? '',
      step.preview?.after ?? '',
      step.preview?.body ?? '',
      ...(step.preview?.items ?? []).flatMap((item) => [
        item.label,
        item.detail ?? '',
      ])
    )
  }
  return values.join('\n')
}

interface ClaimedImplementationDetail {
  identifier: string
  expectation: 'present' | 'absent'
}

function claimedImplementationClaims(
  content: string
): ClaimedImplementationDetail[] {
  const claims = new Map<string, ClaimedImplementationDetail>()
  const implementationVerb =
    /\b(?:add(?:ed)?|chang(?:e|ed)|convert(?:ed)?|implement(?:ed)?|introduc(?:e|ed)|mov(?:e|ed)|replac(?:e|ed)|switch(?:ed)?|updat(?:e|ed)|wrap(?:ped)?|now (?:uses?|has))\b/i
  const ignored = new Set([
    'Build',
    'Changed',
    'Completed',
    'Debug',
    'Files',
    'StatsKey',
    'Swift',
    'SwiftUI',
    'Tests',
    'Verification',
  ])
  for (const statement of boundedText(content, 16_000).split(
    /(?<=[.!?])\s+|\n+/
  )) {
    const fileSectionClaim = /\bchanged files?\b/i.test(statement)
    if (!implementationVerb.test(statement) && !fileSectionClaim) continue
    for (const match of statement.matchAll(/`([^`\n]{1,180})`/g)) {
      const expression = match[1].trim()
      if (/^[.A-Za-z_][A-Za-z0-9_.]*(?:\([^\n]{0,100}\))$/.test(expression)) {
        const detail = {
          identifier: expression,
          expectation: claimedExpressionExpectation(
            statement,
            match.index ?? 0
          ),
        } as const
        claims.set(detail.identifier, detail)
      }
      for (const token of match[1].match(
        /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_+-]+)*/g
      ) ?? []) {
        if (codeShapedClaim(token, ignored)) {
          const detail = {
            identifier: token,
            expectation: claimedExpressionExpectation(
              statement,
              match.index ?? 0
            ),
          } as const
          claims.set(detail.identifier, detail)
        }
      }
    }
    for (const token of statement.match(
      /\b(?:[A-Z][a-z0-9]+){2,}[A-Za-z0-9_]*\b|(?:[\w@+.-]+\/)+[\w@+.-]+\.[A-Za-z0-9_+-]+|\b[\w@+-]+\.(?:swift|m|mm|h|ts|tsx|js|jsx|cjs|mjs|py|rs|go|java|kt|kts|cs|cpp|cc|c|h|html|css|scss|json|yaml|yml)\b/g
    ) ?? []) {
      if (codeShapedClaim(token, ignored)) {
        const detail = {
          identifier: token,
          expectation: 'present' as const,
        }
        if (!claims.has(detail.identifier)) {
          claims.set(detail.identifier, detail)
        }
      }
    }
  }
  const changedFilesSection = boundedText(content, 16_000).match(
    /(?:^|\n)\s*(?:#{1,6}\s*)?changed files?\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:verification|tests?|limitations?|remaining|outcome)\b|$)/i
  )?.[1]
  if (changedFilesSection) {
    for (const path of changedFilesSection.match(
      /(?:[\w@+.-]+\/)+[\w@+.-]+\.(?:swift|m|mm|h|ts|tsx|js|jsx|cjs|mjs|py|rs|go|java|kt|kts|cs|cpp|cc|c|html|css|scss|json|yaml|yml)|\b[\w@+-]+\.(?:swift|m|mm|h|ts|tsx|js|jsx|cjs|mjs|py|rs|go|java|kt|kts|cs|cpp|cc|c|html|css|scss|json|yaml|yml)\b/g
    ) ?? []) {
      claims.set(path, { identifier: path, expectation: 'present' })
    }
  }
  return [...claims.values()].slice(0, 24)
}

function claimedExpressionExpectation(
  statement: string,
  expressionIndex: number
): 'present' | 'absent' {
  const actions = [
    ...statement.matchAll(
      /\b(?:add(?:ed)?|chang(?:e|ed)|convert(?:ed)?|eliminat(?:e|ed)|implement(?:ed)?|introduc(?:e|ed)|mov(?:e|ed)|remov(?:e|ed)|replac(?:e|ed)|switch(?:ed)?|updat(?:e|ed)|wrap(?:ped)?|now (?:uses?|has))\b/gi
    ),
  ].filter((match) => (match.index ?? 0) <= expressionIndex)
  const action = actions.at(-1)
  if (!action) return 'present'
  if (/\b(?:eliminat(?:e|ed)|remov(?:e|ed))\b/i.test(action[0])) {
    return 'absent'
  }
  if (!/\b(?:convert(?:ed)?|replac(?:e|ed)|switch(?:ed)?)\b/i.test(action[0])) {
    return 'present'
  }
  const delimiter = /\b(?:for|to|with)\b/i.exec(
    statement.slice((action.index ?? 0) + action[0].length)
  )
  const replacementStarts = delimiter
    ? (action.index ?? 0) +
      action[0].length +
      delimiter.index +
      delimiter[0].length
    : Number.POSITIVE_INFINITY
  return expressionIndex < replacementStarts ? 'absent' : 'present'
}

function codeShapedClaim(token: string, ignored: Set<string>): boolean {
  const trimmed = token.replace(/^[.]+|[.,:;]+$/g, '')
  if (trimmed.length < 3 || ignored.has(trimmed)) return false
  return (
    /\//.test(trimmed) ||
    /\.(?:swift|m|mm|h|ts|tsx|js|jsx|cjs|mjs|py|rs|go|java|kt|kts|cs|cpp|cc|c|html|css|scss|json|yaml|yml)$/i.test(
      trimmed
    ) ||
    /[a-z0-9][A-Z]/.test(trimmed)
  )
}

function evidenceSupportsIdentifier(evidence: string, claim: string): boolean {
  if (evidenceMatchesIdentifier(evidence, claim)) return true
  const basename = claim.split(/[\\/]/).at(-1) ?? claim
  return basename !== claim && evidenceMatchesIdentifier(evidence, basename)
}

function evidenceMatchesIdentifier(evidence: string, claim: string): boolean {
  if (evidence.includes(claim)) return true
  if (!/[():]/.test(claim)) return false
  const pattern = claim
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:\\\)/g, ':[^)]*\\)')
    .replace(/\\ /g, '\\s*')
  try {
    return new RegExp(pattern).test(evidence)
  } catch {
    return false
  }
}

/** Prefer the latest exact source read as the authoritative current state. */
function currentImplementationEvidence(steps: PersistenceStep[]): string {
  let latestMutation = -1
  for (let index = 0; index < steps.length; index += 1) {
    if (hasSuccessfulFileChange([steps[index]])) latestMutation = index
  }
  const reads = steps
    .slice(latestMutation + 1)
    .filter(
      (step) => step.name === 'workspace_read' && step.status === 'done'
    )
    .flatMap((step) => [step.preview?.body ?? '', step.preview?.after ?? ''])
    .filter(Boolean)
  if (reads.length > 0) return reads.join('\n')

  const diffs = steps
    .slice(latestMutation + 1)
    .filter(
      (step) =>
        step.name === 'git_diff' &&
        step.status === 'done' &&
        step.resultMeta === 'scoped diff read'
    )
    .flatMap((step) =>
      (step.preview?.body ?? '')
        .split('\n')
        .filter((line) => !line.startsWith('-'))
    )
  if (diffs.length > 0) return diffs.join('\n')

  return steps
    .filter((step) => hasSuccessfulFileChange([step]))
    .flatMap((step) => [step.preview?.after ?? ''])
    .filter(Boolean)
    .join('\n')
}

function hasPostMutationSourceEvidence(steps: PersistenceStep[]): boolean {
  let latestMutation = -1
  for (let index = 0; index < steps.length; index += 1) {
    if (hasSuccessfulFileChange([steps[index]])) latestMutation = index
  }
  return steps.slice(latestMutation + 1).some(
    (step) =>
      (step.name === 'workspace_read' && step.status === 'done') ||
      (step.name === 'git_diff' &&
        step.status === 'done' &&
        step.resultMeta === 'scoped diff read')
  )
}

function reportsLocalActionBudget(content: string): boolean {
  return /\b(?:hit|reached|exceeded|exhausted|ran out of) (?:its |the )?(?:\d+[ -])?(?:action|round|implementation) (?:cap|limit|budget)\b|\b(?:due to|because of) (?:the )?(?:\d+[ -])?(?:action|round|implementation) (?:cap|limit|budget)\b|\b(?:\d+[ -])?(?:action|round|implementation) (?:cap|limit|budget)\b[\s\S]{0,100}\b(?:(?:was|is|has been) )?(?:exhausted|reached|ended|stopped|prevented|incomplete|before finishing)\b|\bexhausted (?:its |the )?(?:bounded )?(?:implementation )?(?:path|rounds?|actions?|budget)\b/i.test(
    content
  )
}

function requiresImplementationFollowUp(content: string): boolean {
  return /\bimplementation (?:is )?incomplete\b|\btask still needs implementation\b|\b(?:requires?|needs?) (?:an? |another )?(?:automatic |manual )?follow[- ]?up (?:implementation )?pass\b|\bcontinue (?:the |with the )?implementation (?:in |with )?(?:another |the next )?pass\b/i.test(
    content
  )
}

/**
 * A candid limitation must only override otherwise-good tool evidence when
 * the original objective actually required a verification action. This keeps
 * optional limitations and stale generic "incomplete" prose from reopening a
 * completed implementation.
 */
function requiresExplicitImplementationVerification(objective: string): boolean {
  const bounded = boundedText(objective, 8_000)
  const target =
    /\b(?:tests?|test suite|build|xcodebuild|typecheck|type-check|tsc|lint|e2e|end-to-end|verification|verify|validation|validate|simulator|ui test|reproduction|task[- ]scoped diff)\b/i
  const requiredAction =
    /\b(?:run|rerun|execute|perform|test|verify|validate|ensure|confirm|launch|exercise|reproduce|review|inspect|must|required|passing|pass|to completion)\b/i
  return target.test(bounded) && requiredAction.test(bounded)
}

type RequiredVerificationKind =
  | 'tests'
  | 'build'
  | 'type check'
  | 'lint'
  | 'ui exercise'
  | 'final scoped diff'

function missingRequiredVerificationKinds(
  objective: string,
  steps: PersistenceStep[]
): RequiredVerificationKind[] {
  const required = requiredVerificationKinds(objective)
  if (required.size === 0) return []
  const completed = completedVerificationKindsAfterChange(steps)
  return [...required].filter((kind) => !completed.has(kind))
}

function requiredVerificationKinds(
  objective: string
): Set<RequiredVerificationKind> {
  const bounded = boundedText(objective, 8_000)
  const required = new Set<RequiredVerificationKind>()
  const clauses = verificationObjectiveClauses(bounded)
  for (const line of clauses) {
    if (
      clauseRequiresVerificationKind(
        line,
        /\b(?:tests?|test suite)\b/i,
        'test'
      )
    ) {
      required.add('tests')
    }
    if (
      clauseRequiresVerificationKind(line, /\bbuilds?\b/i, 'build')
    ) {
      required.add('build')
    }
    if (
      clauseRequiresVerificationKind(
        line,
        /\b(?:typecheck|type-check|tsc)\b/i,
        'typecheck'
      )
    ) {
      required.add('type check')
    }
    if (
      clauseRequiresVerificationKind(line, /\blint\b/i, 'lint')
    ) {
      required.add('lint')
    }
    if (lineRequiresUiExercise(line)) required.add('ui exercise')
    if (lineRequiresFinalScopedDiff(line)) required.add('final scoped diff')
  }
  return required
}

function verificationObjectiveClauses(objective: string): string[] {
  return objective
    .split(/\n+/)
    .flatMap((line) =>
      line.split(
        /(?<=[.!?;])\s+|\s*;\s*|\s*,?\s+\b(?:but|however|then|afterwards?|subsequently)\b\s*/i
      )
    )
    .map((statement) =>
      statement
        // Preserve an absolute executable invocation while still masking
        // artifact paths such as /tmp/.../Build/Products/... below.
        .replace(/(?:~?\/[\w.@+~-]+)*\/xcodebuild\b/gi, 'xcodebuild')
        // Artifact locations are evidence, not build instructions. Mask them
        // before matching so a path component such as /Build/Products/ cannot
        // manufacture a requirement from unrelated nearby prose.
        .replace(
          /(^|[\s("'`=])(?:~\/|\/)[^\s,"'`);]+/g,
          '$1[path]'
        )
        .trim()
    )
    .filter(Boolean)
}

function clauseRequiresVerificationKind(
  clause: string,
  target: RegExp,
  xcodeVerb: 'test' | 'build' | 'typecheck' | 'lint'
): boolean {
  const source = target.source
  const flags = target.flags.includes('i') ? 'i' : ''
  const prohibited = new RegExp(
    `\\b(?:do not|don't|must not|should not|need not|no need to|avoid)\\s+(?:re-?)?(?:run|execute|perform|repeat|verify|validate)(?:ning)?\\b[^.!?;]{0,180}${source}|\\bwithout\\s+(?:re-?)?(?:run|execute|perform|verify|validate)(?:ning)?\\b[^.!?;]{0,180}${source}`,
    flags
  )
  if (prohibited.test(clause)) return false

  const completedEvidence = new RegExp(
    `${source}[^.!?;]{0,180}\\b(?:already|previously|earlier|prior)\\b[^.!?;]{0,80}\\b(?:passed|succeeded|completed)\\b|${source}[^.!?;]{0,180}\\b(?:passed|succeeded|completed)\\b[^.!?;]{0,80}\\b(?:already|previously|earlier)\\b|\\b(?:already|previously|earlier|prior)\\b[^.!?;]{0,180}${source}[^.!?;]{0,80}\\b(?:passed|succeeded|completed)\\b`,
    flags
  )
  if (completedEvidence.test(clause)) return false

  if (
    (xcodeVerb === 'test' || xcodeVerb === 'build') &&
    new RegExp(
      `\\bxcodebuild\\b[^\\n]{0,1200}(?:^|\\s)${xcodeVerb}(?=\\s|$|[.;,])`,
      'i'
    ).test(clause)
  ) {
    return true
  }

  const action =
    '\\b(?:run|rerun|re-run|execute|perform|verify|validate|ensure|confirm|test)\\b'
  return (
    new RegExp(`${action}[^.!?;]{0,220}${source}`, flags).test(clause) ||
    new RegExp(`${source}[^.!?;]{0,220}${action}`, flags).test(clause) ||
    new RegExp(
      `\\b(?:must|required to|need(?:s)? to)\\b[^.!?;]{0,180}${source}|${source}[^.!?;]{0,180}\\b(?:must|required)\\b`,
      flags
    ).test(clause)
  )
}

function lineRequiresUiExercise(line: string): boolean {
  const simulatorAction =
    '\\b(?:launch|boot|install|open|navigate|exercise|reproduce|demonstrate|prove|confirm)\\b'
  const simulatorTarget = '\\b(?:an?\\s+)?(?:iOS\\s+)?simulator\\b'
  const exerciseAction =
    '\\b(?:launch|open|navigate|exercise|reproduce|run|execute|perform|demonstrate|prove|confirm)\\b'
  const exerciseTarget =
    '\\b(?:affected\\s+)?(?:Library\\s+)?(?:UI|navigation|open(?:\\/navigation)?|user)\\s+(?:test|flow|exercise|reproduction)\\b'
  return (
    new RegExp(`${simulatorAction}[^.]{0,220}${simulatorTarget}`, 'i').test(
      line
    ) ||
    new RegExp(`${simulatorTarget}[^.]{0,220}${simulatorAction}`, 'i').test(
      line
    ) ||
    new RegExp(`${exerciseAction}[^.]{0,220}${exerciseTarget}`, 'i').test(
      line
    ) ||
    new RegExp(`${exerciseTarget}[^.]{0,220}${exerciseAction}`, 'i').test(
      line
    ) ||
    /\b(?:original|Library|open(?:\/navigation)?)\b[^.]{0,120}\bcrash\b[^.]{0,120}\b(?:demonstrably|proven|confirmed)\s+(?:gone|fixed|absent)\b/i.test(
      line
    ) ||
    /\b(?:UI|XCUITest)\s+tests?\b/i.test(line)
  )
}

function lineRequiresFinalScopedDiff(line: string): boolean {
  return /\b(?:review|inspect|check|confirm)\b[^.]{0,120}\bfinal\b[^.]{0,100}\b(?:task[- ]scoped|scoped)\b[^.]{0,60}\b(?:git\s+)?diff\b|\bfinal\b[^.]{0,100}\b(?:task[- ]scoped|scoped)\b[^.]{0,60}\b(?:git\s+)?diff\b[^.]{0,100}\b(?:review|inspect|check|confirm)\b/i.test(
    line
  )
}

function verificationKindPromptLabel(kind: RequiredVerificationKind): string {
  if (kind === 'ui exercise') return 'Simulator/Library UI exercise'
  if (kind === 'final scoped diff') return 'final task-scoped diff review'
  return kind
}

function explicitExtendedVerificationContractSatisfied(
  objective: string,
  steps: PersistenceStep[]
): boolean {
  if (
    !hasSuccessfulFileChange(steps) &&
    !hasReviewableWorkspaceChange(steps)
  ) {
    return false
  }
  const required = requiredVerificationKinds(objective)
  if (required.size === 0) return false
  const completed = completedVerificationKindsAfterChange(steps)
  return [...required].every((kind) => completed.has(kind))
}

function completedVerificationKindsAfterChange(
  steps: PersistenceStep[]
): Set<RequiredVerificationKind> {
  let latestAuthoredChange = -1
  let firstReviewedDiff = -1
  for (let index = 0; index < steps.length; index += 1) {
    if (hasSuccessfulFileChange([steps[index]])) latestAuthoredChange = index
    if (
      firstReviewedDiff < 0 &&
      hasReviewableWorkspaceChange([steps[index]])
    ) {
      firstReviewedDiff = index
    }
  }
  // An authored mutation resets every earlier verification result. For an
  // inherited patch, however, the first scoped review establishes the change
  // boundary. Later scoped diffs are final-review evidence, not new mutations;
  // treating the last one as the boundary discards the tests/build/UI exercise
  // that it was explicitly asked to review.
  const boundary =
    latestAuthoredChange >= 0 ? latestAuthoredChange : firstReviewedDiff
  if (boundary < 0) return new Set()
  const completed = new Set<RequiredVerificationKind>()
  for (const step of steps.slice(boundary + 1)) {
    if (
      step.name === 'git_diff' &&
      step.status === 'done' &&
      step.resultMeta === 'scoped diff read' &&
      hasReviewableWorkspaceChange([step])
    ) {
      completed.add('final scoped diff')
    }
    if (step.name !== 'run_terminal') continue
    // Task-specific failure evidence is authoritative even when a wrapper or
    // trailing command left the terminal session at exit 0. Evaluate it before
    // status/result metadata so a failed Library reproduction cannot be
    // promoted to successful UI evidence.
    if (uiExerciseFailureEvidence(step)) {
      completed.delete('ui exercise')
      continue
    }
    if (
      step.status === 'error' &&
      uiExerciseTargetEvidence(step)
    ) {
      completed.delete('ui exercise')
      continue
    }
    const failedKinds = failedTerminalVerificationKinds(step)
    for (const kind of failedKinds) completed.delete(kind)
    // Canonical failure output is authoritative even when a wrapper or later
    // shell command left this step with status done and nominal exit-zero meta.
    if (failedKinds.size > 0) continue
    if (step.status !== 'done') {
      continue
    }
    const meta = step.resultMeta?.trim() ?? ''
    if (!/^exit 0 · /i.test(meta)) continue
    if (/(?:^| · )tests? passed(?:$| · )/i.test(meta)) completed.add('tests')
    if (/(?:^| · )build passed(?:$| · )/i.test(meta)) completed.add('build')
    if (/(?:^| · )type check passed(?:$| · )/i.test(meta)) {
      completed.add('type check')
    }
    if (/(?:^| · )lint passed(?:$| · )/i.test(meta)) completed.add('lint')
    if (successfulUiExerciseEvidence(step)) completed.add('ui exercise')
  }
  if (hasStructuredDeviceRunVerification(steps.slice(boundary + 1))) {
    completed.add('ui exercise')
  }
  return completed
}

function failedTerminalVerificationKinds(
  step: PersistenceStep
): Set<RequiredVerificationKind> {
  const evidence = [
    step.summary ?? '',
    step.resultMeta ?? '',
    step.preview?.title ?? '',
    step.preview?.body ?? '',
  ].join('\n')
  const positiveFailureEvidence = evidence
    // Test runners commonly include zero-valued failure counters in otherwise
    // successful output. Those are success evidence, not contradictions.
    .replace(/\b(?:0|no|none)\s+(?:tests?\s+)?failed\b/gi, '')
    .replace(/\b(?:0|no|none)\s+failures?\b/gi, '')
    .replace(/\bno\s+build commands failed\b/gi, '')
    .replace(/\bwithout\s+(?:any\s+)?(?:test|build)?\s*failures?\b/gi, '')
  const failed = new Set<RequiredVerificationKind>()
  const explicitXcodeFailure =
    /\bxcodebuild:\s+error:|\bThe following build commands failed:|\bCommand .* failed with a nonzero exit code\b/i.test(
      positiveFailureEvidence
    )
  if (
    /\*\*\s*TEST FAILED\s*\*\*|\bTesting failed:|\btests?\b[^\n]{0,100}\b(?:failed|failing|unsuccessful)\b/i.test(positiveFailureEvidence) ||
    (explicitXcodeFailure &&
      /\bxcodebuild\b[^\n]{0,1200}(?:^|\s)test(?=\s|$|[.;,])/i.test(
        positiveFailureEvidence
      )) ||
    (step.status !== 'done' &&
      /\bxcodebuild\b[^\n]{0,1200}(?:^|\s)test(?=\s|$|[.;,])/i.test(
        positiveFailureEvidence
      ))
  ) {
    failed.add('tests')
  }
  if (
    /\*\*\s*BUILD FAILED\s*\*\*|\bbuild\b[^\n]{0,100}\b(?:failed|failing|unsuccessful)\b/i.test(positiveFailureEvidence) ||
    (explicitXcodeFailure &&
      /\bxcodebuild\b[^\n]{0,1200}(?:^|\s)build(?=\s|$|[.;,])/i.test(
        positiveFailureEvidence
      )) ||
    (step.status !== 'done' &&
      /\bxcodebuild\b[^\n]{0,1200}(?:^|\s)build(?=\s|$|[.;,])/i.test(
        positiveFailureEvidence
      ))
  ) {
    failed.add('build')
  }
  if (/\b(?:type[ -]?check|tsc)\b[^\n]{0,100}\b(?:failed|failing|error)\b/i.test(positiveFailureEvidence)) {
    failed.add('type check')
  }
  if (/\blint\b[^\n]{0,100}\b(?:failed|failing|error)\b/i.test(positiveFailureEvidence)) {
    failed.add('lint')
  }
  return failed
}

function successfulUiExerciseEvidence(step: PersistenceStep): boolean {
  const meta = step.resultMeta?.trim() ?? ''
  if (
    !/^exit 0 · (?:tests?|change check|command) passed(?:$| · )/i.test(meta)
  ) {
    return false
  }
  return uiExerciseTargetEvidence(step)
}

function uiExerciseFailureEvidence(step: PersistenceStep): boolean {
  const evidence = uiExerciseEvidenceText(step)
  return (
    /\bLIBRARY_(?:UI_)?(?:EXERCISE|REPRODUCTION|NAVIGATION)_(?:FAILED|CRASHED)\b/i.test(
      evidence
    ) ||
    /\bLibrary\b[^\n]{0,160}\b(?:still\s+crash(?:es|ed|ing)?|crashes|crashed|crashing|crash\s+(?:persists?|remains?|reproduced|detected|observed)|failed|failure)\b/i.test(
      evidence
    ) ||
    /\b(?:Maestro|XCUITest|XCUIApplication|UI\s+tests?|UITests?)\b[^\n]{0,180}\bLibrary\b[^\n]{0,120}\b(?:failed|failure|crashes|crashed|crashing|crash\s+(?:persists?|remains?|reproduced|detected|observed))\b/i.test(
      evidence
    )
  ) && !/\bLibrary\b[^\n]{0,160}\b(?:without (?:a )?crash|did not crash|no crash|no longer crashes)\b/i.test(
    evidence
  )
}

function uiExerciseTargetEvidence(step: PersistenceStep): boolean {
  const evidence = uiExerciseEvidenceText(step)
  const libraryUiAutomation =
    /\b(?:Maestro|XCUITest|XCUIApplication|UI\s+tests?|UITests?)\b[^\n]{0,180}\bLibrary\b|\bLibrary\b[^\n]{0,180}\b(?:Maestro|XCUITest|XCUIApplication|UI\s+tests?|UITests?)\b/i.test(
      evidence
    )
  return (
    (/\b(?:xcrun\s+)?simctl\s+launch\b/i.test(evidence) &&
      /\bSTATSKEY_DEBUG_RECORD_SURFACE\s*=\s*library\b/i.test(evidence)) ||
    libraryUiAutomation ||
    /\bLIBRARY_(?:UI_)?(?:EXERCISE|REPRODUCTION|NAVIGATION)_(?:PASSED|SUCCEEDED)\b/i.test(
      evidence
    ) ||
    /\bLibrary\s+(?:flow|navigation|open(?:\/navigation)?)\s+(?:exercise|reproduction)\b[^\n]{0,100}\b(?:passed|succeeded|completed without (?:a )?crash)\b/i.test(
      evidence
    ) ||
    /\bLibrary\b[^\n]{0,80}\b(?:opened|navigated)\b[^\n]{0,100}\b(?:without (?:a )?crash|did not crash|no crash)\b/i.test(
      evidence
    )
  )
}

function uiExerciseEvidenceText(step: PersistenceStep): string {
  return [
    step.summary ?? '',
    step.preview?.title ?? '',
    step.preview?.body ?? '',
  ].join('\n')
}

function reportsIncompleteUiExercise(content: string): boolean {
  const bounded = boundedText(content, 16_000)
  const shortfallPatterns = [
    /\b(?:Library|UI|simulator|reproduction|navigation)\b[^.!?\n]{0,180}\b(?:failed|failing|incomplete|could not|couldn['’]t|unable to|not yet|was not|did not|didn['’]t)\b[^.!?\n]{0,100}\b(?:launch|open|navigate|exercise|reproduce|run|pass|complete|verify|work)?/i,
    /\b(?:Library|open(?:\/navigation)?|navigation)\b[^.!?\n]{0,160}\b(?:still|continues? to|continued to)\s+crash(?:es|ed|ing)?\b/i,
    /\b(?:Library|open(?:\/navigation)?|navigation)\b[^.!?\n]{0,160}\bcrash\b[^.!?\n]{0,80}\b(?:persists?|remains?|not (?:fixed|gone|resolved))\b/i,
    /\b(?:original|Library)\s+(?:open(?:\/navigation)?|navigation|UI)?\s*crash\b[^.!?\n]{0,100}\b(?:not (?:gone|fixed|resolved)|still present|persists?|remains?)\b/i,
  ]
  const successPatterns = [
    /\bLibrary\b[^.!?\n]{0,160}\b(?:UI|flow|navigation|open(?:ed)?|reproduction|exercise)\b[^.!?\n]{0,120}\b(?:passed|succeeded|completed without (?:a )?crash|did not crash|no longer crashes)\b/i,
    /\b(?:Library|original)\b[^.!?\n]{0,140}\bcrash\b[^.!?\n]{0,80}\b(?:gone|fixed|resolved|no longer (?:occurs|reproduces))\b/i,
  ]
  let incomplete = false
  for (const statement of bounded.split(/(?<=[.!?])\s+|\n+/)) {
    if (shortfallPatterns.some((pattern) => pattern.test(statement))) {
      incomplete = true
    }
    if (successPatterns.some((pattern) => pattern.test(statement))) {
      if (!incomplete || explicitlyRecoversUiExercise(statement)) {
        incomplete = false
      }
    }
  }
  return incomplete
}

function explicitlyRecoversUiExercise(statement: string): boolean {
  if (
    /\b(?:earlier|previous|prior|initial|historical|before the (?:latest|final))\b/i.test(
      statement
    ) &&
    !/\b(?:then|subsequently|after(?:ward)?s?|later)\b[^.!?]{0,100}\b(?:re-?ran|ran again|retr(?:ied|y))\b/i.test(
      statement
    )
  ) {
    return false
  }
  return /\b(?:re-?ran|ran again|retr(?:ied|y)|recovered|after(?:ward)?s?|subsequently|then)\b/i.test(
    statement
  )
}

function incompleteRequiredVerificationTargets(
  content: string
): Set<VerificationTarget> {
  const bounded = boundedText(content, 16_000)
  const pending = new Set<VerificationTarget>()
  let pendingRerunTarget: VerificationTarget | undefined
  const statements = bounded
    .split(/(?<=[.!?])\s+|\n+/)
    .map((statement) => statement.trim())
    .filter(Boolean)

  for (const statement of statements) {
    const events = verificationEvents(statement)
    for (const event of events) {
      if (event.kind === 'shortfall') {
        pending.add(event.target)
        continue
      }
      if (event.target) {
        pending.delete(event.target)
        if (pendingRerunTarget === event.target) pendingRerunTarget = undefined
        // A later explicit "verification passed" resolves a generic
        // verification shortfall as well as its concrete category.
        if (event.target === 'verification') pending.clear()
        continue
      }
      // "I reran it against the concrete simulator and it passed" carries no
      // repeated noun. Resolve only the most recent pending category when the
      // sentence clearly describes a rerun/retry, never for an unrelated
      // trailing command that merely happened to pass.
      if (
        statementClearlyResolvesPendingVerification(statement)
      ) {
        const latest = pendingRerunTarget ?? [...pending].at(-1)
        if (latest) pending.delete(latest)
        pendingRerunTarget = undefined
      }
    }
    if (
      /\b(?:re-?ran|re-?run|retr(?:ied|y)|ran again)\b/i.test(statement) &&
      statementClearlyRefersToPendingVerification(statement) &&
      !events.some((event) => event.kind === 'success')
    ) {
      const explicitTarget = verificationTargetInStatement(statement)
      pendingRerunTarget = explicitTarget ?? [...pending].at(-1)
    } else if (
      pendingRerunTarget &&
      events.some((event) => event.kind === 'success' && !event.target) &&
      /\b(?:it|that|this|rerun|retry)\b/i.test(statement) &&
      !/\b(?:unrelated|different|separate|other)\b/i.test(statement)
    ) {
      pending.delete(pendingRerunTarget)
      pendingRerunTarget = undefined
    }
  }
  return pending
}

function verificationTargetForRequiredKind(
  kind: RequiredVerificationKind
): VerificationTarget | undefined {
  if (kind === 'tests') return 'test'
  if (kind === 'build') return 'build'
  if (kind === 'type check') return 'typecheck'
  if (kind === 'lint') return 'lint'
  return undefined
}

function statementClearlyRefersToPendingVerification(statement: string): boolean {
  const anaphoricRerun =
    /\b(?:re-?ran|retr(?:ied|y)|ran again)\s+(?:it|that|this)(?=\s*(?:$|[.,;:]|\b(?:against|on|with|using|under|for)\b))/i.test(
      statement
    )
  const concreteDestinationRerun =
    /\b(?:concrete|specific|named)\s+(?:iOS\s+)?(?:simulator|destination|device)\b[^.!?]{0,80}\b(?:re-?run|retry|re-?ran|retried)\b|\b(?:re-?run|retry|re-?ran|retried)\b[^.!?]{0,80}\b(?:against|on|using)\s+(?:the\s+)?(?:concrete|specific|named)\s+(?:iOS\s+)?(?:simulator|destination|device)\b/i.test(
      statement
    )
  return (
    verificationTargetInStatement(statement) != null ||
    anaphoricRerun ||
    concreteDestinationRerun
  ) && !/\b(?:unrelated|different|separate|other)\b/i.test(statement)
}

function statementClearlyResolvesPendingVerification(statement: string): boolean {
  return (
    statementClearlyRefersToPendingVerification(statement) &&
    /\b(?:re-?ran|re-?run|retr(?:ied|y)|ran again|then|subsequently|after(?:ward)?s?|ultimately)\b/i.test(
      statement
    )
  )
}

function verificationTargetInStatement(
  statement: string
): VerificationTarget | undefined {
  const match = statement.match(
    /\b(verification(?: step)?|validation|tests?|test suite|build|xcodebuild|typecheck|type-check|tsc|lint|e2e|end-to-end)\b/i
  )
  return match ? verificationTarget(match[0], statement) : undefined
}

type VerificationTarget =
  | 'verification'
  | 'test'
  | 'build'
  | 'typecheck'
  | 'lint'
  | 'e2e'

type VerificationEvent =
  | {
      index: number
      kind: 'shortfall'
      target: VerificationTarget
    }
  | {
      index: number
      kind: 'success'
      target?: VerificationTarget
    }

function verificationEvents(statement: string): VerificationEvent[] {
  const targets = [...statement.matchAll(
    /\b(verification(?: step)?|validation|tests?|test suite|build|xcodebuild|typecheck|type-check|tsc|lint|e2e|end-to-end)\b/gi
  )].map((match) => ({
    index: match.index ?? 0,
    target: verificationTarget(match[0], statement),
  }))
  const nearestTarget = (index: number): VerificationTarget | undefined => {
    const candidate = targets
      .map((target) => ({ ...target, distance: Math.abs(target.index - index) }))
      .filter((target) => target.distance <= 160)
      .sort((left, right) => left.distance - right.distance)[0]
    return candidate?.target
  }

  const events: VerificationEvent[] = []
  const shortfallPattern =
    /\b(downgraded|incomplete|partial(?:ly)?|failed|failing|unsuccessful|could not|couldn[\u2019']t|unable to|did not|didn[\u2019']t|not yet (?:run|passed|completed)|not (?:run|passed|completed))\b/gi
  for (const match of statement.matchAll(shortfallPattern)) {
    const index = match.index ?? 0
    if (negatesVerificationShortfall(statement, index, match[0])) continue
    const target = nearestTarget(index)
    if (target) events.push({ index, kind: 'shortfall', target })
  }

  const successPattern =
    /\b(passed|succeeded|successful|test succeeded|build succeeded|exit(?:ed)? 0)\b/gi
  for (const match of statement.matchAll(successPattern)) {
    const index = match.index ?? 0
    if (/\b(?:not|never|didn[\u2019']t|did not)\s*$/i.test(statement.slice(Math.max(0, index - 18), index))) {
      continue
    }
    const candidateTarget = nearestTarget(index)
    const targetPosition = candidateTarget
      ? [...targets]
          .filter((target) => target.target === candidateTarget)
          .sort(
            (left, right) =>
              Math.abs(left.index - index) - Math.abs(right.index - index)
          )[0]?.index
      : undefined
    const between =
      typeof targetPosition === 'number'
        ? statement.slice(
            Math.min(targetPosition, index),
            Math.max(targetPosition, index)
          )
        : ''
    const containsEarlierShortfall =
      typeof targetPosition === 'number' &&
      targetPosition < index &&
      /\b(?:downgraded|incomplete|partial(?:ly)?|failed|failing|unsuccessful|could not|couldn[\u2019']t|unable to|did not|didn[\u2019']t|not yet|not (?:run|passed|completed))\b/i.test(
        between
      )
    const explicitlyResolvesEarlierShortfall =
      /\b(?:re-?ran|re-?run|retr(?:ied|y)|ran again|then|subsequently|after(?:ward)?s?|ultimately|but)\b/i.test(
        between
      ) &&
      !/\b(?:unrelated|different|separate|other)\b/i.test(between)
    events.push({
      index,
      kind: 'success',
      target:
        containsEarlierShortfall && !explicitlyResolvesEarlierShortfall
          ? undefined
          : candidateTarget,
    })
  }
  return events.sort((left, right) => left.index - right.index)
}

function verificationTarget(
  value: string,
  statement: string
): VerificationTarget {
  const normalized = value.toLowerCase()
  if (/test/.test(normalized)) return 'test'
  if (normalized === 'xcodebuild') {
    return /\btests?|test suite\b/i.test(statement) ? 'test' : 'build'
  }
  if (normalized === 'build') return 'build'
  if (/type|tsc/.test(normalized)) return 'typecheck'
  if (normalized === 'lint') return 'lint'
  if (/e2e|end-to-end/.test(normalized)) return 'e2e'
  return 'verification'
}

function negatesVerificationShortfall(
  statement: string,
  index: number,
  phrase: string
): boolean {
  const before = statement.slice(Math.max(0, index - 18), index)
  const after = statement.slice(index + phrase.length, index + phrase.length + 28)
  if (/\b(?:not|never)\s*$/i.test(before)) return true
  if (/\bno\s+(?:verification|validation|tests?|test suite|build|xcodebuild|typecheck|type-check|tsc|lint|e2e|end-to-end)\s*$/i.test(before)) {
    return true
  }
  return /^(?:\s+)(?:fail(?:ed|ing)?|incomplete|unsuccessful)\b/i.test(after) &&
    /^(?:did not|didn[\u2019']t|could not|couldn[\u2019']t)$/i.test(phrase)
}

function reportsConcreteGenuineBlocker(content: string): boolean {
  return [
    /\bprovider (?:remained |is |was )?(?:unavailable|offline)\b/i,
    /\b(?:cannot|can['’]t|unable to) (?:safely )?(?:continue|proceed|complete)(?: this pass)?\b[\s\S]{0,180}\b(?:without|until|because|due to)\b[\s\S]{0,120}\b(?:credentials?|permission|access|user input)\b/i,
    /\b(?:requires?|needs?) (?:the )?(?:user|your) (?:input|choice|credentials?|permission|access)\b/i,
    /\b(?:permission|access) (?:was |is )?(?:denied|required|unavailable)\b/i,
    /\bworkspace (?:changed|closed|is no longer available|must be reopened)\b/i,
    /\bmissing (?:a |the )?(?:required )?(?:credentials?|permission|access|dependency|user input)\b/i,
    /\bblocked (?:by|because of|until)\b[\s\S]{0,180}\b(?:permission|credential|access|user input|workspace change|external service)\b/i,
  ].some((pattern) => pattern.test(content))
}

function reportsGenericGenuineBlocker(content: string): boolean {
  return /\b(?:cannot|can['’]t|unable to) (?:safely )?(?:continue|proceed|complete)(?: this pass)?\b[\s\S]{0,180}\b(?:without|until|because|due to)\b/i.test(
    content
  )
}

function boundedText(value: string, limit: number): string {
  const normalized = String(value || '').replace(/\0/g, '').trim()
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit)}\n[truncated]`
}
