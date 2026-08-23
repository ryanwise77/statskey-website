// firestoreFailover — keeps StatsKey working when Google is interrupted by
// switching the app's Firestore binding to the self-hosted mirror on
// statskey-server, and back again when Google recovers.
//
// Design: the data mode is decided at BOOT (firebase.ts reads it before the
// first Firestore call), because a live Firestore instance cannot be
// retargeted under active listeners. The controller probes Google in the
// background; on sustained failure it flips the mode flag and reloads the
// app — every listener then rebinds cleanly against the mirror. On sustained
// recovery it flips back the same way. The reload is deliberate: it is the
// one mechanism that guarantees every open snapshot listener, query, and
// cached reference moves to the new backend at once.
//
// Scope note (v1): the mirror holds the founder's own data subtree, streamed
// live from Google by mirror-daemon.mjs on statskey-server. Writes made while
// failed over land on the mirror (not lost); they are pushed back to Google
// after recovery by workbench-backend/uplink-mirror-writes.mjs.

export type FirestoreMode = 'primary' | 'mirror'

const MODE_KEY = 'statskey.firestoreMode'
const MIRROR_HOST_KEY = 'statskey.mirrorHost'
// There is deliberately NO built-in mirror address. A mirror is only ever used
// when the device owner has explicitly configured one (host:port) on this
// device; a public client must never dial a baked-in private address, and a
// Google outage must never make the app bind to whatever answers on the LAN.
export const DEFAULT_MIRROR_HOST = ''
const MIRROR_HOST_PATTERN =
  /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*)(?::\d{1,5})?$/

const PROBE_URL =
  'https://firestore.googleapis.com/v1/projects/statskey/databases/(default)/documents/publicFounderReplicas/founder'
const PROBE_INTERVAL_MS = 30_000
const FAILS_TO_SWITCH = 2
const SUCCESSES_TO_RECOVER = 2
const PROBE_TIMEOUT_MS = 6_000

export function currentMode(storage: Pick<Storage, 'getItem'> = localStorage): FirestoreMode {
  // Mirror mode is only effective when a mirror host is configured; a stale
  // mode flag without a host always resolves to the primary backend.
  return storage.getItem(MODE_KEY) === 'mirror' && mirrorHost(storage)
    ? 'mirror'
    : 'primary'
}

export function mirrorHost(storage: Pick<Storage, 'getItem'> = localStorage): string {
  const configured = String(storage.getItem(MIRROR_HOST_KEY) || '').trim()
  return MIRROR_HOST_PATTERN.test(configured) ? configured : DEFAULT_MIRROR_HOST
}

export interface FailoverDeps {
  probe?: () => Promise<boolean>
  probeMirror?: () => Promise<boolean>
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  reload?: () => void
  intervalMs?: number
  onModeChange?: (mode: FirestoreMode) => void
}

async function fetchProbe(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    return response.status === 200
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Creates the background controller. Returns a handle with stop() and a
// test-only tick() that runs one probe cycle deterministically.
export function startFailoverController(deps: FailoverDeps = {}) {
  const storage = deps.storage ?? localStorage
  const reload = deps.reload ?? (() => window.location.reload())
  const probeGoogle = deps.probe ?? (() => fetchProbe(PROBE_URL))
  const probeMirror =
    deps.probeMirror ?? (() => fetchProbe(`http://${mirrorHost(storage)}/`))
  let fails = 0
  let successes = 0
  let stopped = false

  async function tick(): Promise<void> {
    if (stopped) return
    const mode = currentMode(storage)
    const googleUp = await probeGoogle()
    if (mode === 'primary') {
      if (googleUp) {
        fails = 0
        return
      }
      fails += 1
      if (fails < FAILS_TO_SWITCH) return
      // Never fail over unless this device has an explicitly configured
      // mirror host, and only if that mirror is actually reachable; a dead
      // mirror plus a Google blip must not strand the app on a broken backend.
      if (!mirrorHost(storage)) return
      if (!(await probeMirror())) return
      storage.setItem(MODE_KEY, 'mirror')
      deps.onModeChange?.('mirror')
      reload()
      return
    }
    // mirror mode: watch for sustained Google recovery
    if (googleUp) {
      successes += 1
      if (successes >= SUCCESSES_TO_RECOVER) {
        storage.setItem(MODE_KEY, 'primary')
        deps.onModeChange?.('primary')
        reload()
      }
      return
    }
    successes = 0
  }

  const interval = setInterval(() => {
    void tick()
  }, deps.intervalMs ?? PROBE_INTERVAL_MS)

  return {
    stop() {
      stopped = true
      clearInterval(interval)
    },
    tick, // test hook: run one deterministic cycle
  }
}
