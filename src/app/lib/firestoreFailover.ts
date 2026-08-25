// Firestore continuity controller.
//
// Firestore instances cannot be safely retargeted while listeners are active,
// so the selected backend is persisted and applied at boot by firebase.ts. A
// sustained primary failure followed by a fresh mirror health response changes
// that selection and reloads the app. Recovery uses the same mechanism.
//
// There is intentionally no built-in emergency address. Public builds remain
// primary-only unless a public HTTPS origin is supplied at build time through
// VITE_STATSKEY_EMERGENCY_ORIGIN. A device-specific HTTPS or private-LAN origin
// can instead be provisioned in localStorage under EMERGENCY_ORIGIN_KEY. This
// keeps a private server address out of public JavaScript bundles.

export type FirestoreMode = 'primary' | 'mirror'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'getItem' | 'setItem'>

export interface EmergencyEndpoint {
  /** Normalized scheme + authority, without a trailing slash. */
  origin: string
  /** Authority passed to initializeFirestore (brackets retained for IPv6). */
  host: string
  /** Whether the Firestore SDK should use HTTPS/WSS. */
  ssl: boolean
  /** Health URL used before and while the mirror is selected. */
  healthUrl: string
}

export interface MirrorHealth {
  checkedAt: string
  lastMutationAt: string
  lastVerifiedAt: string
  lagSeconds: number
  maxLagSeconds: number
  writable: boolean
  endpointOrigin?: string
}

export const EMERGENCY_ORIGIN_KEY = 'statskey.emergencyOrigin'
export const DEFAULT_MIRROR_HOST = ''
export const MAX_MIRROR_LAG_SECONDS = 5 * 60

const MODE_KEY = 'statskey.firestoreMode'
const LEGACY_MIRROR_HOST_KEY = 'statskey.mirrorHost'
const MIRROR_HEALTH_KEY = 'statskey.mirrorHealth'
const HEALTH_PATH = '/.well-known/statskey-emergency-health'
const PROBE_URL =
  'https://firestore.googleapis.com/v1/projects/statskey/databases/(default)/documents/publicFounderReplicas/founder'
const PROBE_INTERVAL_MS = 30_000
const FAILS_TO_SWITCH = 2
const SUCCESSES_TO_RECOVER = 2
const PROBE_TIMEOUT_MS = 6_000
const MAX_HEALTH_REPORT_AGE_MS = 5 * 60_000
const CLOCK_SKEW_SECONDS = 30

function buildEmergencyOrigin(): string {
  const env = import.meta.env as ImportMetaEnv | undefined
  return String(env?.VITE_STATSKEY_EMERGENCY_ORIGIN ?? '').trim()
}

function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}

function isLanHostname(rawHostname: string): boolean {
  const hostname = unbracket(rawHostname).toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === '0.0.0.0' || hostname === '::') return false
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    isPrivateIpv4(hostname)
  ) {
    return true
  }
  // A single-label DNS name is resolved by the device's LAN resolver.
  if (!hostname.includes('.') && !hostname.includes(':')) return true
  // Unique-local, loopback, and link-local IPv6 ranges.
  return (
    hostname === '::1' ||
    /^f[cd][0-9a-f]{2}(?::|$)/i.test(hostname) ||
    /^fe[89ab][0-9a-f](?::|$)/i.test(hostname)
  )
}

/**
 * Parse an explicitly provisioned emergency origin.
 *
 * HTTPS is accepted for routable and LAN hosts. Plain HTTP is restricted to
 * hosts that are unambiguously local/private, because credentials and health
 * data must never cross a public plaintext connection.
 */
export function parseEmergencyEndpoint(raw: unknown): EmergencyEndpoint | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    if (url.protocol === 'http:' && !isLanHostname(url.hostname)) return null
    const origin = url.origin
    return {
      origin,
      host: url.host,
      ssl: url.protocol === 'https:',
      healthUrl: new URL(HEALTH_PATH, `${origin}/`).toString(),
    }
  } catch {
    return null
  }
}

/** Resolve runtime provisioning first, then an explicitly configured build. */
export function configuredEmergencyEndpoint(
  storage: StorageReader = localStorage,
  configuredBuildOrigin: string = buildEmergencyOrigin()
): EmergencyEndpoint | null {
  const runtimeValue = storage.getItem(EMERGENCY_ORIGIN_KEY)
  if (runtimeValue != null) {
    // An invalid explicit override disables failover instead of unexpectedly
    // falling through to another destination.
    return parseEmergencyEndpoint(runtimeValue)
  }

  // Keep already-provisioned desktop installations compatible. The legacy
  // value was a host:port and is still restricted to a private/LAN HTTP host.
  const legacyHost = String(storage.getItem(LEGACY_MIRROR_HOST_KEY) ?? '').trim()
  if (legacyHost) return parseEmergencyEndpoint(`http://${legacyHost}`)

  const builtEndpoint = parseEmergencyEndpoint(configuredBuildOrigin)
  // Private addresses belong in per-device runtime provisioning, never in a
  // public Vite bundle. Build provisioning is HTTPS and publicly routable.
  if (!builtEndpoint || !builtEndpoint.ssl) return null
  const builtHostname = new URL(builtEndpoint.origin).hostname
  return isLanHostname(builtHostname) ? null : builtEndpoint
}

/** Compatibility accessor for code that only needs the Firestore authority. */
export function mirrorHost(storage: StorageReader = localStorage): string {
  return configuredEmergencyEndpoint(storage)?.host ?? DEFAULT_MIRROR_HOST
}

export function currentMode(
  storage: StorageReader = localStorage,
  configuredBuildOrigin: string = buildEmergencyOrigin()
): FirestoreMode {
  return storage.getItem(MODE_KEY) === 'mirror' &&
    configuredEmergencyEndpoint(storage, configuredBuildOrigin)
    ? 'mirror'
    : 'primary'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function isoTime(value: unknown): { iso: string; milliseconds: number } | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds)
    ? { iso: new Date(milliseconds).toISOString(), milliseconds }
    : null
}

/**
 * Validate the gateway health document and enforce freshness client-side.
 * The aliases keep the parser compatible with a minimal LAN health service,
 * while the v1 gateway contract is accepted without translation.
 */
export function parseMirrorHealth(
  payload: unknown,
  nowMs: number = Date.now(),
  clientMaxLagSeconds: number = MAX_MIRROR_LAG_SECONDS
): MirrorHealth | null {
  const root = asRecord(payload)
  if (!root) return null
  if (root.schemaVersion != null && root.schemaVersion !== 1) return null
  const isGatewayV1 = root.schemaVersion === 1

  const status = String(root.status ?? '').toLowerCase()
  const ready = status === 'ready' || status === 'ok' || root.healthy === true
  if (!ready) return null
  if (root.mode != null && root.mode !== 'standby' && root.mode !== 'mirror') {
    return null
  }

  const mirror = asRecord(root.mirror) ?? root
  const routes = asRecord(root.routes)
  if (isGatewayV1 && routes?.firestore !== '/') return null
  const reachable = mirror.reachable ?? mirror.healthy
  if (reachable !== true) return null
  const explicitlyFresh = mirror.fresh ?? root.fresh
  if (explicitlyFresh === false || (root.schemaVersion === 1 && explicitlyFresh !== true)) {
    return null
  }

  const mutationTime = isoTime(
    mirror.lastMutationAt ?? mirror.lastUpdatedAt ?? mirror.updatedAt
  )
  if (!mutationTime) return null
  if ((mutationTime.milliseconds - nowMs) / 1000 > CLOCK_SKEW_SECONDS) return null

  // A real mutation can legitimately be old while the user is idle. Freshness
  // comes from the gateway's verification/parity heartbeat, never from making
  // recent user activity a prerequisite for continuity.
  const verifiedTime = isoTime(
    mirror.lastVerifiedAt ?? root.lastVerifiedAt ?? mirror.lastUpdatedAt ?? mirror.updatedAt
  )
  if (isGatewayV1 && mirror.lastVerifiedAt == null) return null
  if (!verifiedTime) return null
  if ((verifiedTime.milliseconds - nowMs) / 1000 > CLOCK_SKEW_SECONDS) return null

  const reportedLag = finiteNonNegative(mirror.lagSeconds)
  if (isGatewayV1 && reportedLag == null) return null
  const observedLag = Math.max(0, (nowMs - verifiedTime.milliseconds) / 1000)
  const lagSeconds = Math.max(reportedLag ?? observedLag, observedLag)
  const serverMaxLag = finiteNonNegative(mirror.maxLagSeconds)
  if (isGatewayV1 && (serverMaxLag == null || serverMaxLag <= 0)) return null
  const maxLagSeconds = Math.min(
    clientMaxLagSeconds,
    serverMaxLag != null && serverMaxLag > 0 ? serverMaxLag : clientMaxLagSeconds
  )
  if (!(maxLagSeconds > 0) || lagSeconds > maxLagSeconds) return null

  const checkedTime = root.checkedAt == null ? null : isoTime(root.checkedAt)
  if (isGatewayV1 && !checkedTime) return null
  if (root.checkedAt != null && !checkedTime) return null
  if (
    checkedTime &&
    (checkedTime.milliseconds - nowMs > CLOCK_SKEW_SECONDS * 1000 ||
      nowMs - checkedTime.milliseconds > MAX_HEALTH_REPORT_AGE_MS)
  ) {
    return null
  }

  return {
    checkedAt: checkedTime?.iso ?? new Date(nowMs).toISOString(),
    lastMutationAt: mutationTime.iso,
    lastVerifiedAt: verifiedTime.iso,
    lagSeconds,
    maxLagSeconds,
    writable: root.writable === true,
  }
}

function saveMirrorHealth(
  storage: StorageWriter,
  health: MirrorHealth | null,
  endpointOrigin: string
): void {
  storage.setItem(
    MIRROR_HEALTH_KEY,
    health ? JSON.stringify({ ...health, endpointOrigin }) : ''
  )
}

/** Last validated mirror capability, used to explain read-only failover. */
export function currentMirrorHealth(
  storage: StorageReader = localStorage,
  nowMs: number = Date.now(),
  configuredBuildOrigin: string = buildEmergencyOrigin()
): MirrorHealth | null {
  const endpoint = configuredEmergencyEndpoint(storage, configuredBuildOrigin)
  const encoded = storage.getItem(MIRROR_HEALTH_KEY)
  if (!endpoint || !encoded) return null
  try {
    const saved = asRecord(JSON.parse(encoded))
    if (!saved || saved.endpointOrigin !== endpoint.origin) return null
    return parseMirrorHealth(
      {
        status: 'ready',
        mode: 'standby',
        writable: saved.writable,
        checkedAt: saved.checkedAt,
        mirror: {
          reachable: true,
          fresh: true,
          lastMutationAt: saved.lastMutationAt,
          lastVerifiedAt: saved.lastVerifiedAt,
          lagSeconds: saved.lagSeconds,
          maxLagSeconds: saved.maxLagSeconds,
        },
      },
      nowMs
    )
  } catch {
    return null
  }
}

async function fetchProbe(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    })
    return response.status === 200
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchMirrorHealth(
  endpoint: EmergencyEndpoint,
  nowMs: number = Date.now()
): Promise<MirrorHealth | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint.healthUrl, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    })
    if (response.status !== 200) return null
    return parseMirrorHealth(await response.json(), nowMs)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface FailoverDeps {
  probe?: () => Promise<boolean>
  probeMirror?: (endpoint: EmergencyEndpoint) => Promise<MirrorHealth | null>
  storage?: StorageWriter
  reload?: () => void
  intervalMs?: number
  onModeChange?: (mode: FirestoreMode) => void
  onMirrorHealth?: (health: MirrorHealth | null) => void
  now?: () => number
  /** Disable the eager first check only for deterministic tests. */
  runImmediately?: boolean
  /** Inject build provisioning in tests; runtime provisioning still wins. */
  configuredBuildOrigin?: string
}

export interface FailoverController {
  enabled: boolean
  stop: () => void
  tick: () => Promise<void>
}

/** Start the single-flight background continuity controller. */
export function startFailoverController(deps: FailoverDeps = {}): FailoverController {
  const storage = deps.storage ?? localStorage
  const configuredBuildOrigin = deps.configuredBuildOrigin ?? buildEmergencyOrigin()
  const endpoint = configuredEmergencyEndpoint(storage, configuredBuildOrigin)
  const reload = deps.reload ?? (() => window.location.reload())
  const probeGoogle = deps.probe ?? (() => fetchProbe(PROBE_URL))
  const now = deps.now ?? Date.now
  const probeMirror =
    deps.probeMirror ?? ((target: EmergencyEndpoint) => fetchMirrorHealth(target, now()))
  let fails = 0
  let successes = 0
  let stopped = false
  let transitioning = false
  let interval: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> | null = null

  const stop = () => {
    stopped = true
    if (interval !== undefined) clearInterval(interval)
    interval = undefined
  }

  if (!endpoint) {
    // With no explicit endpoint, preserve ordinary production behavior: no
    // extra probes, storage mutations, timers, or reloads.
    return { enabled: false, stop, tick: async () => {} }
  }

  const transition = (mode: FirestoreMode) => {
    if (transitioning || stopped) return
    transitioning = true
    if (interval !== undefined) clearInterval(interval)
    interval = undefined
    storage.setItem(MODE_KEY, mode)
    deps.onModeChange?.(mode)
    reload()
  }

  const runTick = async (): Promise<void> => {
    if (stopped || transitioning) return
    const mode = currentMode(storage, configuredBuildOrigin)

    if (mode === 'primary') {
      const googleUp = await probeGoogle()
      if (stopped || transitioning) return
      if (googleUp) {
        fails = 0
        return
      }
      fails += 1
      if (fails < FAILS_TO_SWITCH) return

      const health = await probeMirror(endpoint)
      if (stopped || transitioning) return
      saveMirrorHealth(storage, health, endpoint.origin)
      deps.onMirrorHealth?.(health)
      if (!health) return
      transition('mirror')
      return
    }

    // Keep validating the selected mirror while independently looking for a
    // sustained primary recovery. If both are impaired, do not bounce users
    // onto a known-down primary; report degraded mirror health and stay put.
    const [googleUp, health] = await Promise.all([
      probeGoogle(),
      probeMirror(endpoint),
    ])
    if (stopped || transitioning) return
    saveMirrorHealth(storage, health, endpoint.origin)
    deps.onMirrorHealth?.(health)

    if (!googleUp) {
      successes = 0
      return
    }
    successes += 1
    if (successes >= SUCCESSES_TO_RECOVER) transition('primary')
  }

  const tick = (): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = runTick().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  interval = setInterval(() => {
    void tick()
  }, deps.intervalMs ?? PROBE_INTERVAL_MS)
  if (deps.runImmediately !== false) void tick()

  return { enabled: true, stop, tick }
}
