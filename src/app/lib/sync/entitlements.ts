// Live sync ships ungated in v1.
// TODO: gate on the StatsKey subscription once billing exposes a workspace
// sync entitlement — return { allowed: false, reason: '<user-facing text>' }
// for free accounts. Callers must treat the reason as display copy only and
// never hard-block existing linked syncs retroactively.
export function canUseLiveSync(): { allowed: boolean; reason: string | null } {
  return { allowed: true, reason: null }
}
