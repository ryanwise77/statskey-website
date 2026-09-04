export function isNudgeAuthorIdentifier(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'miller' || normalized === 'miller@statskeybiometrics.com'
}

export function hasNudgeAuthorClaims(claims: Record<string, unknown>): boolean {
  return (
    claims.src === 'miller_nudge_author' &&
    claims.nudgeAuthor === true &&
    Number(claims.nudgeAuthorVersion) === 1 &&
    claims.nudgeAuthorId === 'miller'
  )
}
export const NUDGE_AUTHOR_UID = 'miller-nudge-author-v1'
