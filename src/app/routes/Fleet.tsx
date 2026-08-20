import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { NavLink } from 'react-router-dom'
import {
  GoogleAuthProvider,
  OAuthProvider,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth'
import {
  cancelFleetJob,
  createFleetArtifactDownload,
  bootstrapFleetDevice,
  createFleetJob,
  createFleetLocalGrant,
  fleetDeviceEndpoint,
  getFleetCoordinatorTrust,
  listFleetDevices,
  listFleetGrants,
  listFleetJobEvents,
  listFleetJobs,
  pairFleetDevice,
  recoverFleetController,
  recoverFleetJob,
  revokeFleetDevice,
  revokeFleetGrant,
} from '../lib/fleet/workbenchFleetApi'
import {
  FLEET_PROTOCOL_VERSION,
  TERMINAL_FLEET_JOB_STATES,
  canCancelFleetJob,
  fleetDeviceCanRunGrantedJob,
  fleetDeviceIsPresent,
  fleetRepositoryIdentity,
  type FleetCapability,
  type CreateFleetJobInput,
  type FleetDevice,
  type FleetGrant,
  type FleetJob,
  type FleetJobEvent,
  type FleetJobState,
  type FleetJobType,
  type PairFleetDeviceInput,
} from '../lib/fleet/types'
import {
  getDesktopBridge,
  type DesktopFleetIdentityState,
  type DesktopFleetRetainedArtifact,
} from '../lib/desktop'
import { auth } from '../lib/firebase'
import { confirmDialog, showToast } from '../lib/ui/dialogs'

const ACTIVE_JOB_STATES = new Set<FleetJobState>([
  'leased',
  'preparing',
  'running',
  'needs_review',
  'waiting',
])

const JOB_REQUIREMENTS: Record<FleetJobType, FleetCapability[]> = {
  agent: [
    'workspace.read',
    'workspace.snapshot',
    'workspace.write',
    'agent.statskey',
  ],
  command: ['workspace.read', 'workspace.snapshot', 'terminal.run'],
  'xcode-build': ['workspace.read', 'workspace.snapshot', 'xcode.build'],
  'xcode-test': ['workspace.read', 'workspace.snapshot', 'xcode.test'],
  'xcode-archive': [
    'workspace.read',
    'workspace.snapshot',
    'xcode.archive',
  ],
  'windows-build': [
    'workspace.read',
    'workspace.snapshot',
    'windows.build',
  ],
  reconcile: [
    'workspace.read',
    'workspace.snapshot',
    'workspace.write',
  ],
  service: ['workspace.read', 'workspace.snapshot', 'service.host'],
  'remote-session': ['screen.view'],
}

const JOB_TYPE_OPTIONS: Array<{ value: FleetJobType; label: string }> = [
  { value: 'agent', label: 'Intelligence task' },
  { value: 'command', label: 'Command' },
  { value: 'xcode-build', label: 'Xcode build' },
  { value: 'xcode-test', label: 'Xcode test' },
  { value: 'xcode-archive', label: 'Xcode archive' },
  { value: 'windows-build', label: 'Windows build' },
  { value: 'reconcile', label: 'Reconcile changes' },
  { value: 'service', label: 'Service operation' },
  { value: 'remote-session', label: 'Remote session' },
]

export function Fleet() {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const [devices, setDevices] = useState<FleetDevice[]>([])
  const [bootstrapDeviceId, setBootstrapDeviceId] = useState<
    `dev_${string}` | null
  >(null)
  const [grants, setGrants] = useState<FleetGrant[]>([])
  const [retainedArtifacts, setRetainedArtifacts] = useState<
    DesktopFleetRetainedArtifact[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [deviceResult, grantResult, localArtifacts] = await Promise.all([
        listFleetDevices({ limit: 50 }, { signal }),
        listFleetGrants({ limit: 50 }, { signal }),
        desktop?.fleet?.listRetainedArtifacts() ?? Promise.resolve([]),
      ])
      setDevices(deviceResult.devices)
      setBootstrapDeviceId(deviceResult.bootstrapDeviceId)
      setGrants(grantResult.grants)
      setRetainedArtifacts(localArtifacts)
      setError(null)
    } catch (nextError) {
      if (signal?.aborted) return
      setError(errorMessage(nextError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [desktop])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | null = null
    let disposed = false
    const poll = async () => {
      await refresh(controller.signal)
      if (!disposed && !controller.signal.aborted) {
        timer = window.setTimeout(() => void poll(), 30_000)
      }
    }
    void poll()
    return () => {
      disposed = true
      controller.abort()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [refresh])

  const online = devices.filter((device) => fleetDeviceIsPresent(device))
  const capacity = online.reduce(
    (total, device) =>
      total +
      (device.workerMode !== 'disabled' ? device.maxConcurrentJobs : 0),
    0
  )
  const activeJobs = devices.reduce(
    (total, device) => total + device.activeJobs,
    0
  )
  const activeControllers = new Set(
    devices
      .filter(
        (device) =>
          device.status === 'active' &&
          ['controller', 'hybrid'].includes(device.role)
      )
      .map((device) => device.id)
  )
  const activeWorkers = new Set(
    devices
      .filter(
        (device) =>
          device.status === 'active' &&
          device.workerMode !== 'disabled' &&
          ['worker', 'hybrid'].includes(device.role)
      )
      .map((device) => device.id)
  )
  const grantEvaluationTime = Date.now()
  const activeGrants = grants.filter(
    (grant) =>
      grant.revokedAt == null &&
      grant.unattended === true &&
      grant.policyVersion === 1 &&
      grant.repositoryIdentities.length > 0 &&
      Date.parse(grant.issuedAt) <= grantEvaluationTime &&
      Date.parse(grant.expiresAt) > grantEvaluationTime &&
      activeControllers.has(grant.controllerDeviceId) &&
      activeWorkers.has(grant.workerDeviceId)
  )

  async function revokeDevice(device: FleetDevice) {
    const controllerLike =
      device.role === 'controller' || device.role === 'hybrid'
    const confirmed = await confirmDialog({
      title: `Revoke ${device.label}?`,
      body: controllerLike
        ? 'This controller will immediately lose signed coordinator access. Grants it issued stop authorizing work or lease renewals.'
        : 'This worker will immediately lose signed coordinator access. Its active lease will expire and can then be recovered.',
      confirmLabel: 'Revoke device',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const updated = await revokeFleetDevice(device.id)
      setDevices((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate
        )
      )
      showToast('Device revoked.', { kind: 'success' })
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  async function revokeGrant(grant: FleetGrant) {
    const confirmed = await confirmDialog({
      title: 'Revoke this capability grant?',
      body: `This removes ${grant.capabilities.join(', ')} access for ${grant.workspaceIds.join(', ')}.`,
      confirmLabel: 'Revoke grant',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const updated = await revokeFleetGrant(grant.id)
      setGrants((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate
        )
      )
      showToast('Grant revoked.', { kind: 'success' })
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  async function revealRetainedArtifact(
    artifact: DesktopFleetRetainedArtifact
  ) {
    try {
      await desktop?.fleet?.revealRetainedArtifact({
        spoolId: artifact.spoolId,
        kind: artifact.kind,
      })
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  async function purgeRetainedArtifact(
    artifact: DesktopFleetRetainedArtifact
  ) {
    try {
      const removed = await desktop?.fleet?.purgeRetainedArtifact({
        spoolId: artifact.spoolId,
      })
      if (!removed) return
      setRetainedArtifacts((current) =>
        current.filter((entry) => entry.spoolId !== artifact.spoolId)
      )
      showToast('Retained Fleet evidence deleted.', { kind: 'success' })
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  return (
    <div className="space-y-6">
      <FleetHeader
        title="Fleet"
        copy="Trusted computers and enabled devices available to StatsKey Workspace."
        action={
          <button
            className="btn btn-secondary"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      <FleetSectionNav />
      <LocalFleetNodeSetup
        devices={devices}
        bootstrapDeviceId={bootstrapDeviceId}
        onChanged={() => void refresh()}
      />

      {retainedArtifacts.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-300/20 bg-amber-300/[0.04]">
          <div className="border-b border-amber-300/10 px-5 py-4">
            <span className="card-title">Retained Fleet evidence</span>
            <p className="mt-1 text-[12px] text-text-muted">
              Publication failed, so these archives remain on this computer.
              Review them before deletion. Local retention is bounded to 32
              entries, seven days, or 16 GiB.
            </p>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {retainedArtifacts.map((artifact) => (
              <article
                key={`${artifact.spoolId}:${artifact.kind}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[12px] text-text-secondary">
                    {artifact.kind} · {formatBytes(artifact.sizeBytes)} · attempt{' '}
                    {artifact.attempt}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
                    {artifact.jobId} · {formatDateTime(artifact.createdAt)}
                  </p>
                  <p className="mt-1 text-[10px] text-text-muted">
                    {artifact.integrity === 'recorded'
                      ? `Recorded SHA-256 ${artifact.contentHash?.slice(0, 12)}… · verified before reveal`
                      : 'Archive integrity requires manual review.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-ghost text-[11px]"
                    onClick={() => void revealRetainedArtifact(artifact)}
                  >
                    Reveal
                  </button>
                  <button
                    className="btn btn-ghost text-[11px] text-red-300"
                    onClick={() => void purgeRetainedArtifact(artifact)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Online now" value={`${online.length}`} />
        <Metric
          label="Enrolled"
          value={`${devices.filter((device) => device.status === 'active').length}`}
        />
        <Metric label="Active jobs" value={`${activeJobs}`} />
        <Metric label="Total capacity" value={`${capacity}`} />
      </section>

      <section className="panel !p-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <span className="card-title">Execution nodes</span>
            <p className="mt-1 text-[12px] text-text-muted">
              Presence expires after 90 seconds. Capabilities are reported by
              the enrolled node and bounded again by grants.
            </p>
          </div>
          <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-text-muted">
            Protocol {FLEET_PROTOCOL_VERSION}
          </span>
        </div>

        {error ? (
          <div className="m-5 error-banner">{error}</div>
        ) : loading && devices.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-text-muted">
            Reading enrolled devices…
          </div>
        ) : devices.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <h2 className="font-display text-[17px] font-semibold text-text-primary">
              No devices enrolled
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-text-muted">
              Set up this computer as a controller, then pair a worker or enable
              local jobs. The launcher stays closed until a live worker reports
              an installed adapter and receives a current capability grant.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onRevoke={
                  device.status === 'active' &&
                  device.id !== bootstrapDeviceId
                    ? () => void revokeDevice(device)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel !p-0 overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <span className="card-title">Capability grants</span>
          <p className="mt-1 text-[12px] text-text-muted">
            {activeGrants.length} active unattended grant
            {activeGrants.length === 1 ? '' : 's'}.
          </p>
        </div>
        {grants.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12px] text-text-muted">
            No Fleet grants issued.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {grants.map((grant) => (
              <article
                key={grant.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-text-secondary">
                    {grant.workspaceIds.join(', ')} ·{' '}
                    {grant.capabilities.join(', ')}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
                    {grant.repositoryIdentities?.join(', ') ||
                      'No repository scope (inactive)'}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-text-muted">
                    {grant.workerDeviceId} · expires{' '}
                    {formatDateTime(grant.expiresAt)}
                  </p>
                </div>
                {grant.revokedAt == null &&
                  Date.parse(grant.expiresAt) > Date.now() && (
                    <button
                      className="btn btn-ghost text-[12px]"
                      onClick={() => void revokeGrant(grant)}
                    >
                      Revoke
                    </button>
                  )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-[12px] leading-relaxed text-text-secondary">
        <b className="text-text-primary">Hard boundary:</b> enrollment does not
        grant work by itself. Every remote job still needs an owner-matched
        workspace and repository grant, exact source snapshot, current lease,
        and compatible device capabilities.
      </section>
    </div>
  )
}

async function ensureRecentFleetAuthentication(user: User): Promise<void> {
  const result = await user.getIdTokenResult()
  const authTimeMs = Number(result.claims.auth_time) * 1000
  const ageMs = Date.now() - authTimeMs
  if (
    Number.isFinite(authTimeMs) &&
    ageMs >= 0 &&
    ageMs < 8 * 60_000
  ) {
    return
  }
  const providerIds = new Set(
    user.providerData.map((profile) => profile.providerId)
  )
  if (providerIds.has(GoogleAuthProvider.PROVIDER_ID)) {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    await reauthenticateWithPopup(user, provider)
    return
  }
  if (providerIds.has('apple.com')) {
    const provider = new OAuthProvider('apple.com')
    provider.addScope('email')
    await reauthenticateWithPopup(user, provider)
    return
  }
  throw new Error(
    'For controller recovery, sign out of StatsKey and sign in again before retrying.'
  )
}

function defaultFleetCapabilities(platform?: string): string {
  if (platform === 'win32') {
    return 'workspace.read, workspace.snapshot, terminal.run, windows.build'
  }
  if (platform === 'linux') return ''
  return 'workspace.read'
}

function LocalFleetNodeSetup({
  devices,
  bootstrapDeviceId,
  onChanged,
}: {
  devices: FleetDevice[]
  bootstrapDeviceId: `dev_${string}` | null
  onChanged: () => void
}) {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const ubuntuControllerOnly = desktop?.platform === 'linux'
  const [identity, setIdentity] = useState<DesktopFleetIdentityState | null>(null)
  const [loading, setLoading] = useState(desktop?.fleet != null)
  const [busy, setBusy] = useState(false)
  const [candidateCard, setCandidateCard] = useState('')
  const [approvalPackage, setApprovalPackage] = useState('')
  const [workspaceScopes, setWorkspaceScopes] = useState('statskey-website')
  const [repositoryScopes, setRepositoryScopes] = useState(
    'github.com/ryanwise77/statskey-website'
  )
  const [capabilityScopes, setCapabilityScopes] = useState(() =>
    defaultFleetCapabilities(desktop?.platform)
  )
  const recoverableControllers = useMemo(
    () =>
      devices.filter(
        (device) =>
          device.id === bootstrapDeviceId &&
          device.status === 'active' &&
          (device.role === 'controller' || device.role === 'hybrid')
      ),
    [bootstrapDeviceId, devices]
  )
  const localFleetDevice = useMemo(
    () => devices.find((device) => device.id === identity?.deviceId) ?? null,
    [devices, identity?.deviceId]
  )
  const [recoveryControllerId, setRecoveryControllerId] = useState('')

  useEffect(() => {
    if (
      recoveryControllerId &&
      recoverableControllers.some(
        (device) => device.id === recoveryControllerId
      )
    ) {
      return
    }
    setRecoveryControllerId(recoverableControllers[0]?.id ?? '')
  }, [recoverableControllers, recoveryControllerId])

  useEffect(() => {
    let active = true
    if (!desktop?.fleet) return
    void desktop.fleet
      .identityState()
      .then((value) => {
        if (active) {
          setIdentity(value)
          if (value?.profile?.platform) {
            setCapabilityScopes(
              defaultFleetCapabilities(value.profile.platform)
            )
          }
        }
      })
      .catch((nextError) => {
        if (active) showToast(errorMessage(nextError), { kind: 'error' })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [desktop])

  if (!desktop?.fleet) return null

  async function createIdentity(role: 'hybrid' | 'worker') {
    if (!desktop?.fleet) return
    if (ubuntuControllerOnly && role === 'worker') {
      showToast(
        'Ubuntu can control Fleet, but unattended worker jobs stay disabled until the protected Linux execution service is installed.',
        { kind: 'info' }
      )
      return
    }
    setBusy(true)
    try {
      const platform =
        desktop.platform === 'win32' || desktop.platform === 'linux'
          ? desktop.platform
          : 'darwin'
      const created = await desktop.fleet.ensureIdentity({
        label:
          role === 'worker'
            ? `${
                platform === 'darwin'
                  ? 'Mac'
                  : platform === 'win32'
                    ? 'Windows'
                    : 'Ubuntu'
              } worker`
            : 'My StatsKey computer',
        role,
        workerMode:
          platform === 'linux'
            ? 'disabled'
            : role === 'worker'
              ? 'dedicated'
              : 'opt-in',
        platform,
        maxConcurrentJobs: 1,
      })
      if (!created) return
      setIdentity(created)
      setCapabilityScopes(defaultFleetCapabilities(created.profile.platform))
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function prepareIdentityReplacement() {
    if (!desktop?.fleet || !identity?.enrollment) return
    const authoritative = identity.deviceId === bootstrapDeviceId
    const confirmed = await confirmDialog({
      title: 'Replace this Fleet key?',
      body: authoritative
        ? 'This replaces the current key in StatsKey identity storage and stops local Fleet work. You must immediately finish account-authenticated recovery with the replacement key.'
        : 'This replaces the revoked key in StatsKey identity storage and stops local Fleet work. An enrolled controller must pair the new key before this computer can run jobs again.',
      confirmLabel: 'Prepare replacement key',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const replacement = await desktop.fleet.replaceIdentity()
      if (!replacement) return
      setIdentity(replacement)
      setCapabilityScopes(
        defaultFleetCapabilities(replacement.profile.platform)
      )
      showToast(
        authoritative
          ? 'Replacement key prepared. Complete controller recovery below.'
          : 'Replacement key prepared. Pair this computer again.',
        { kind: 'info' }
      )
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function registerController() {
    if (!desktop?.fleet) return
    const user = auth.currentUser
    if (!user) {
      showToast('Sign in before registering a Fleet controller.', {
        kind: 'error',
      })
      return
    }
    setBusy(true)
    try {
      const trust = await getFleetCoordinatorTrust()
      const bootstrap = await desktop.fleet.createBootstrap({
        ownerUid: user.uid,
      })
      if (!bootstrap) return
      await bootstrapFleetDevice(bootstrap)
      const state = await desktop.fleet.markEnrolled({
        ownerUid: user.uid,
        endpoint: fleetDeviceEndpoint(),
        coordinatorKeyId: trust.keyId,
        coordinatorPublicKeySpki: trust.publicKeySpki,
      })
      setIdentity(state)
      showToast('This computer is now your Fleet controller.', {
        kind: 'success',
      })
      onChanged()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function activateExistingDevice() {
    if (!desktop?.fleet) return
    const user = auth.currentUser
    if (!user) {
      showToast('Sign in before activating this Fleet device.', {
        kind: 'error',
      })
      return
    }
    setBusy(true)
    try {
      const trust = await getFleetCoordinatorTrust()
      const state = await desktop.fleet.markEnrolled({
        ownerUid: user.uid,
        endpoint: fleetDeviceEndpoint(),
        coordinatorKeyId: trust.keyId,
        coordinatorPublicKeySpki: trust.publicKeySpki,
      })
      setIdentity(state)
      showToast('Fleet device trust pin activated.', { kind: 'success' })
      onChanged()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function recoverController() {
    if (!desktop?.fleet || !recoveryControllerId) return
    const user = auth.currentUser
    if (!user) {
      showToast('Sign in before recovering a Fleet controller.', {
        kind: 'error',
      })
      return
    }
    const confirmed = await confirmDialog({
      title: 'Replace this Fleet controller?',
      body:
        'Use this only when the old controller key is unavailable or compromised. The old device is revoked, and grants it issued stop authorizing new work and lease renewals.',
      confirmLabel: 'Continue recovery',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await ensureRecentFleetAuthentication(user)
      const trust = await getFleetCoordinatorTrust()
      const recovery = await desktop.fleet.createControllerRecovery({
        ownerUid: user.uid,
        expectedControllerDeviceId:
          recoveryControllerId as `dev_${string}`,
      })
      if (!recovery) return
      await recoverFleetController(recovery)
      const state = await desktop.fleet.markEnrolled({
        ownerUid: user.uid,
        endpoint: fleetDeviceEndpoint(),
        coordinatorKeyId: trust.keyId,
        coordinatorPublicKeySpki: trust.publicKeySpki,
      })
      setIdentity(state)
      showToast('Fleet controller recovered with this device key.', {
        kind: 'success',
      })
      onChanged()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function copyDeviceCard() {
    if (!identity) return
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            deviceId: identity.deviceId,
            publicKeyFingerprint: identity.publicKeyFingerprint,
            publicKeySpki: identity.publicKeySpki,
            profile: identity.profile,
          },
          null,
          2
        )
      )
      showToast('Worker device card copied.', { kind: 'success' })
    } catch {
      showToast('The device card could not be copied.', { kind: 'error' })
    }
  }

  const candidateIsController = useMemo(() => {
    try {
      const candidate = JSON.parse(candidateCard) as DesktopFleetIdentityState
      return (
        candidate.profile?.role === 'hybrid' &&
        candidate.profile?.workerMode === 'disabled'
      )
    } catch {
      return false
    }
  }, [candidateCard])

  async function createWorkerApproval() {
    if (!desktop?.fleet) return
    setBusy(true)
    try {
      const candidate = JSON.parse(candidateCard) as DesktopFleetIdentityState
      // Controller-only devices (hybrid with worker mode disabled, such as a
      // phone) pair without any execution scope; the main process builds the
      // controller receipt variant for them.
      const receipt = await desktop.fleet.createPairingReceipt(
        candidateIsController
          ? { candidate }
          : {
              candidate,
              workspaceIds: workspaceScopes
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
              repositoryIdentities: repositoryScopes
                .split(',')
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean),
              capabilities: capabilityScopes
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean) as FleetCapability[],
              unattended: true,
              grantExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
              policyVersion: 1,
            }
      )
      if (!receipt) return
      const controllerProof = await desktop.fleet.signPairing(
        receipt,
        'pairing.approve'
      )
      if (!controllerProof) return
      await navigator.clipboard.writeText(
        JSON.stringify({ receipt, controllerProof }, null, 2)
      )
      showToast(
        candidateIsController
          ? 'Controller approval package copied.'
          : 'Worker approval package copied.',
        { kind: 'success' }
      )
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  function updateCandidateCard(value: string) {
    setCandidateCard(value)
    try {
      const candidate = JSON.parse(value) as DesktopFleetIdentityState
      if (candidate.profile?.platform) {
        setCapabilityScopes(
          defaultFleetCapabilities(candidate.profile.platform)
        )
      }
    } catch {
      // Keep the current scope while a device card is incomplete.
    }
  }

  async function finishWorkerPairing() {
    if (!desktop?.fleet || !identity) return
    const user = auth.currentUser
    if (!user) {
      showToast('Sign in before completing worker pairing.', { kind: 'error' })
      return
    }
    setBusy(true)
    try {
      const trust = await getFleetCoordinatorTrust()
      const parsed = JSON.parse(approvalPackage) as Pick<
        PairFleetDeviceInput,
        'receipt' | 'controllerProof'
      >
      const candidateProof = await desktop.fleet.signPairing(
        parsed.receipt,
        'pairing.candidate'
      )
      if (!candidateProof) return
      await pairFleetDevice({
        receipt: parsed.receipt,
        controllerProof: parsed.controllerProof,
        candidateProof,
      })
      const state = await desktop.fleet.markEnrolled({
        ownerUid: user.uid,
        endpoint: fleetDeviceEndpoint(),
        coordinatorKeyId: trust.keyId,
        coordinatorPublicKeySpki: trust.publicKeySpki,
      })
      setIdentity(state)
      showToast('This worker is paired and ready.', { kind: 'success' })
      onChanged()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function enableLocalWorker() {
    if (!desktop?.fleet) return
    if (ubuntuControllerOnly) {
      showToast(
        'Local Fleet jobs are disabled on Ubuntu until the protected Linux execution service is installed.',
        { kind: 'info' }
      )
      return
    }
    setBusy(true)
    try {
      const input = await desktop.fleet.createLocalGrant({
        workspaceIds: workspaceScopes
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        repositoryIdentities: repositoryScopes
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
        capabilities: capabilityScopes
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean) as FleetCapability[],
        unattended: true,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        policyVersion: 1,
      })
      if (!input) return
      await createFleetLocalGrant(input)
      showToast('Local Fleet work is enabled for 30 days.', {
        kind: 'success',
      })
      onChanged()
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <span className="card-title">This computer</span>
          {loading ? (
            <p className="mt-2 text-[13px] text-text-muted">
              Opening the protected device identity…
            </p>
          ) : identity?.enrollment ? (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                Enrolled as <b>{identity.profile.label}</b>. Signed heartbeats,
                job claims, lease renewals, and worker events leave this
                computer over HTTPS; its private key never leaves protected OS
                storage.
              </p>
              <code className="mt-3 block break-all text-[11px] text-text-muted">
                {identity.deviceId}
              </code>
            </>
          ) : identity ? (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                A protected {identity.profile.role} identity is ready on this
                computer.
              </p>
              {identity.profile.role === 'worker' ? (
                <p className="mt-1 text-[12px] text-text-muted">
                  Copy its device card to an enrolled controller to approve
                  workspace and capability access.
                </p>
              ) : (
                <p className="mt-1 text-[12px] text-text-muted">
                  {identity.deviceId === bootstrapDeviceId
                    ? 'Your account already recognizes this replacement key. Activate it to resume signed Fleet work.'
                    : recoverableControllers.length > 0
                    ? 'Your account already has a controller. Use recovery below to replace it, or copy this device card to pair as a secondary worker.'
                    : 'Register it once to establish the first trusted controller for your account.'}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                Create an OS-protected identity for this computer. Controller
                setup can also accept explicitly targeted work; worker setup is
                dedicated to remote jobs.
              </p>
              {ubuntuControllerOnly && (
                <p className="mt-2 text-[12px] leading-relaxed text-amber-200">
                  Ubuntu 26.04 can pair devices and control Fleet. Unattended
                  jobs stay off until StatsKey can verify a protected Linux
                  execution service.
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!loading && !identity ? (
            <>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void createIdentity('hybrid')}
              >
                Set up controller
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy || ubuntuControllerOnly}
                title={
                  ubuntuControllerOnly
                    ? 'Ubuntu worker execution requires the protected Linux execution service.'
                    : undefined
                }
                onClick={() => void createIdentity('worker')}
              >
                {ubuntuControllerOnly ? 'Worker unavailable' : 'Prepare worker'}
              </button>
            </>
          ) : identity && !identity.enrollment ? (
            localFleetDevice?.status === 'active' ? (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void activateExistingDevice()}
              >
                {busy ? 'Verifying…' : 'Activate enrolled device'}
              </button>
            ) : identity.profile.role === 'worker' ||
            (identity.profile.role === 'hybrid' &&
              identity.deviceId !== bootstrapDeviceId &&
              recoverableControllers.length > 0) ? (
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void copyDeviceCard()}
              >
                Copy device card
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void registerController()}
              >
                {busy ? 'Verifying…' : 'Register controller'}
              </button>
            )
          ) : identity?.enrollment ? (
            <>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-1.5 text-[11px] font-semibold text-emerald-200">
                Signed node enrolled
              </span>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void activateExistingDevice()}
              >
                Refresh trust pin
              </button>
              {identity.profile.role === 'hybrid' &&
                !ubuntuControllerOnly && (
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void enableLocalWorker()}
                >
                  Enable local jobs
                </button>
                )}
              {identity.deviceId === bootstrapDeviceId &&
                ['controller', 'hybrid'].includes(identity.profile.role) && (
                  <button
                    className="btn btn-secondary text-red-200"
                    disabled={busy}
                    onClick={() => void prepareIdentityReplacement()}
                  >
                    Replace compromised key
                  </button>
                )}
              {localFleetDevice?.status === 'revoked' &&
                identity.deviceId !== bootstrapDeviceId && (
                  <button
                    className="btn btn-secondary text-red-200"
                    disabled={busy}
                    onClick={() => void prepareIdentityReplacement()}
                  >
                    Reset revoked key
                  </button>
                )}
            </>
          ) : null}
        </div>
      </div>
      {identity &&
        !identity.enrollment &&
        ['controller', 'hybrid'].includes(identity.profile.role) &&
        recoverableControllers.some(
          (device) => device.id !== identity.deviceId
        ) && (
          <details className="mt-4 rounded-xl border border-red-300/15 bg-red-300/[0.03] p-4">
            <summary className="cursor-pointer text-[12px] font-semibold text-text-secondary">
              Recover a lost controller
            </summary>
            <p className="mt-3 text-[12px] leading-relaxed text-text-muted">
              Account recovery replaces the selected controller with this
              computer&apos;s new protected key. The selected device is
              revoked immediately; grants it issued cannot authorize new work
              or renew active leases. A recent StatsKey sign-in is required.
            </p>
            <label className="mt-3 block space-y-1.5 text-[11px] text-text-secondary">
              <span>Controller to replace</span>
              <select
                className="input"
                value={recoveryControllerId}
                onChange={(event) =>
                  setRecoveryControllerId(event.target.value)
                }
              >
                {recoverableControllers.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label} · {device.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-secondary mt-3 text-red-200"
              disabled={busy || !recoveryControllerId}
              onClick={() => void recoverController()}
            >
              Recover with this computer
            </button>
          </details>
        )}
      {identity?.enrollment &&
        ['controller', 'hybrid'].includes(identity.profile.role) && (
          <details className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <summary className="cursor-pointer text-[12px] font-semibold text-text-secondary">
              Pair another computer
            </summary>
            <p className="mt-3 text-[12px] leading-relaxed text-text-muted">
              Paste the device card, choose its scope, then send the copied
              approval package back to that device. Both devices confirm the
              same receipt with their protected keys. A phone pairs as a
              controller: it can authorize and watch jobs but never executes
              them, so no scope is granted.
            </p>
            <textarea
              className="input mt-3 min-h-[100px] resize-y font-mono text-[10px]"
              value={candidateCard}
              onChange={(event) => updateCandidateCard(event.target.value)}
              placeholder="Paste device card"
            />
            {candidateIsController ? (
              <p className="mt-3 rounded-lg border border-sky-300/20 bg-sky-300/[0.06] px-3 py-2 text-[12px] text-sky-100">
                This card is a controller-only device. Pairing grants no
                workspace, repository, or capability scope and creates no
                grant.
              </p>
            ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="space-y-1.5 text-[11px] text-text-secondary">
                <span>Workspace scopes (comma separated)</span>
                <input
                  className="input"
                  value={workspaceScopes}
                  onChange={(event) => setWorkspaceScopes(event.target.value)}
                />
              </label>
              <label className="space-y-1.5 text-[11px] text-text-secondary">
                <span>Repository identities (comma separated)</span>
                <input
                  className="input"
                  value={repositoryScopes}
                  onChange={(event) => setRepositoryScopes(event.target.value)}
                />
              </label>
              <label className="space-y-1.5 text-[11px] text-text-secondary">
                <span>Capabilities (comma separated)</span>
                <input
                  className="input"
                  value={capabilityScopes}
                  onChange={(event) => setCapabilityScopes(event.target.value)}
                />
              </label>
            </div>
            )}
            <button
              className="btn btn-secondary mt-3"
              disabled={busy || !candidateCard.trim()}
              onClick={() => void createWorkerApproval()}
            >
              {candidateIsController
                ? 'Approve controller and copy package'
                : 'Approve and copy package'}
            </button>
          </details>
        )}
      {identity &&
        !identity.enrollment &&
        ['worker', 'hybrid'].includes(identity.profile.role) &&
        localFleetDevice?.status !== 'active' &&
        (identity.profile.role === 'worker' ||
          recoverableControllers.length > 0) && (
          <details className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <summary className="cursor-pointer text-[12px] font-semibold text-text-secondary">
              Complete worker pairing
            </summary>
            <p className="mt-3 text-[12px] leading-relaxed text-text-muted">
              Paste the approval package returned by your controller. StatsKey
              will ask you to confirm the exact scope before this worker signs
              and enrolls.
            </p>
            <textarea
              className="input mt-3 min-h-[100px] resize-y font-mono text-[10px]"
              value={approvalPackage}
              onChange={(event) => setApprovalPackage(event.target.value)}
              placeholder="Paste controller approval package"
            />
            <button
              className="btn btn-primary mt-3"
              disabled={busy || !approvalPackage.trim()}
              onClick={() => void finishWorkerPairing()}
            >
              Confirm and pair worker
            </button>
          </details>
        )}
    </section>
  )
}

export function Jobs() {
  const [jobs, setJobs] = useState<FleetJob[]>([])
  const [devices, setDevices] = useState<FleetDevice[]>([])
  const [grants, setGrants] = useState<FleetGrant[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'finished'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [launcherOpen, setLauncherOpen] = useState(false)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [jobResult, deviceResult, grantResult] = await Promise.all([
        listFleetJobs({ limit: 50 }, { signal }),
        listFleetDevices({ limit: 50 }, { signal }),
        listFleetGrants({ limit: 50 }, { signal }),
      ])
      setJobs(jobResult.jobs)
      setDevices(deviceResult.devices)
      setGrants(grantResult.grants)
      setSelectedJobId((current) => {
        if (current && jobResult.jobs.some((job) => job.id === current)) {
          return current
        }
        return jobResult.jobs[0]?.id ?? null
      })
      setError(null)
    } catch (nextError) {
      if (signal?.aborted) return
      setError(errorMessage(nextError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let timer: number | null = null
    const poll = async () => {
      await refresh(controller.signal)
      if (!disposed && !controller.signal.aborted) {
        timer = window.setTimeout(() => void poll(), 10_000)
      }
    }
    void poll()
    return () => {
      disposed = true
      controller.abort()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [refresh])

  const selectedJob =
    jobs.find((job) => job.id === selectedJobId) ?? null
  const visibleJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (filter === 'active') {
          return job.state === 'queued' || ACTIVE_JOB_STATES.has(job.state)
        }
        if (filter === 'finished') {
          return TERMINAL_FLEET_JOB_STATES.has(job.state)
        }
        return true
      }),
    [filter, jobs]
  )

  async function cancel(job: FleetJob) {
    const confirmed = await confirmDialog({
      title: 'Cancel this job?',
      body:
        job.state === 'queued'
          ? 'The job will not be leased to a worker.'
          : 'The active worker will be asked to stop at its next cancellation boundary.',
      confirmLabel: 'Request cancellation',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const updated = await cancelFleetJob(job.id, job.revision)
      setJobs((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate
        )
      )
      showToast('Cancellation requested.', { kind: 'success' })
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
      void refresh()
    }
  }

  async function recover(job: FleetJob) {
    try {
      const updated = await recoverFleetJob(job.id)
      setJobs((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate
        )
      )
      showToast(
        updated.state === 'queued'
          ? 'The expired lease was released and the job was requeued.'
          : `The job is now ${sentenceCase(updated.state)}.`,
        { kind: 'success' }
      )
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
      void refresh()
    }
  }

  return (
    <div className="space-y-6">
      <FleetHeader
        title="Jobs"
        copy="Lease-bound work dispatched to exact source snapshots across your fleet."
        action={
          <div className="flex gap-2">
            <button
              className="btn btn-secondary"
              onClick={() => void refresh()}
              disabled={loading}
            >
              Refresh
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setLauncherOpen((open) => !open)}
            >
              {launcherOpen ? 'Close launcher' : 'Queue job'}
            </button>
          </div>
        }
      />
      <FleetSectionNav />

      {launcherOpen && (
        <JobLauncher
          devices={devices}
          grants={grants}
          onCreated={(job) => {
            setJobs((current) => [
              job,
              ...current.filter((candidate) => candidate.id !== job.id),
            ])
            setSelectedJobId(job.id)
            setLauncherOpen(false)
          }}
        />
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="grid min-h-[520px] gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1.2fr)]">
        <section className="panel !p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
            <div className="flex gap-1" role="tablist" aria-label="Job state">
              {(['all', 'active', 'finished'] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={filter === value}
                  className={`rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${
                    filter === value
                      ? 'bg-white/[0.09] text-text-primary'
                      : 'text-text-muted hover:bg-white/[0.04]'
                  }`}
                  onClick={() => setFilter(value)}
                >
                  {sentenceCase(value)}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-text-muted">
              {visibleJobs.length} shown
            </span>
          </div>
          {loading && jobs.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-text-muted">
              Reading jobs…
            </div>
          ) : visibleJobs.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-text-muted">
              No {filter === 'all' ? '' : `${filter} `}jobs.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {visibleJobs.map((job) => (
                <button
                  key={job.id}
                  className={`block w-full px-4 py-3 text-left transition-colors ${
                    selectedJob?.id === job.id
                      ? 'bg-white/[0.06]'
                      : 'hover:bg-white/[0.025]'
                  }`}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-text-primary">
                        {job.objective}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-text-muted">
                        {job.workspaceId} · {jobTypeLabel(job.type)} ·{' '}
                        {relativeTime(job.updatedAt)}
                      </div>
                    </div>
                    <StatePill state={job.state} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel !p-0 overflow-hidden">
          {selectedJob ? (
            <JobDetail
              job={selectedJob}
              onCancel={() => void cancel(selectedJob)}
              onRecover={() => void recover(selectedJob)}
            />
          ) : (
            <div className="flex min-h-[400px] items-center justify-center px-5 text-[13px] text-text-muted">
              Select a job to inspect its lease-bound event stream.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FleetHeader({
  title,
  copy,
  action,
}: {
  title: string
  copy: string
  action: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <span className="card-title">Workspace control plane</span>
        <h1 className="mt-1 font-display text-[28px] font-bold tracking-[-0.025em]">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-[14px] text-text-secondary">{copy}</p>
      </div>
      {action}
    </header>
  )
}

function FleetSectionNav() {
  return (
    <nav
      className="flex w-fit gap-1 rounded-lg border border-white/[0.07] bg-white/[0.025] p-1"
      aria-label="Fleet control plane"
    >
      {[
        { to: '/fleet', label: 'Fleet' },
        { to: '/jobs', label: 'Jobs' },
        { to: '/fleet/remote', label: 'Remote sessions' },
      ].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-[12px] transition-colors ${
              isActive
                ? 'bg-white/[0.1] text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel !p-4">
      <span className="card-title">{label}</span>
      <div className="mt-1 font-display text-[27px] font-bold tracking-[-0.03em] text-text-primary">
        {value}
      </div>
    </div>
  )
}

function DeviceRow({
  device,
  onRevoke,
}: {
  device: FleetDevice
  onRevoke?: () => void
}) {
  const present = fleetDeviceIsPresent(device)
  return (
    <article className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              present ? 'bg-emerald-400' : 'bg-white/20'
            }`}
            aria-hidden="true"
          />
          <h2 className="truncate text-[14px] font-medium text-text-primary">
            {device.label}
          </h2>
        </div>
        <p className="mt-1 text-[11px] text-text-muted">
          {platformLabel(device.platform)} · {sentenceCase(device.role)} ·{' '}
          {device.connection}
        </p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[12px] text-text-secondary">
          {device.capabilities.length > 0
            ? device.capabilities.join(' · ')
            : 'No reported capabilities'}
        </p>
        {device.executables.length > 0 && (
          <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
            Programs: {device.executables.join(' · ')}
          </p>
        )}
        <p className="mt-1 text-[11px] text-text-muted">
          {device.resources.cpuAvailable}/{device.resources.cpuLogical} CPU
          available · {formatBytes(device.resources.memoryAvailableBytes)} RAM ·{' '}
          {formatBytes(device.resources.diskAvailableBytes)} disk
        </p>
      </div>
      <div className="text-left md:text-right">
        <p className="text-[12px] text-text-secondary">
          {device.activeJobs}/{device.maxConcurrentJobs} jobs
        </p>
        <p className="mt-1 text-[11px] text-text-muted">
          {device.status === 'revoked'
            ? 'Revoked'
            : present
              ? 'Online now'
              : relativeTime(device.lastSeenAt)}
        </p>
        {onRevoke && (
          <button
            className="mt-2 text-[11px] text-red-300 hover:text-red-200"
            onClick={onRevoke}
          >
            Revoke device
          </button>
        )}
      </div>
    </article>
  )
}

function JobLauncher({
  devices,
  grants,
  onCreated,
}: {
  devices: FleetDevice[]
  grants: FleetGrant[]
  onCreated: (job: FleetJob) => void
}) {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const [workspaceId, setWorkspaceId] = useState('')
  const [repository, setRepository] = useState('')
  const [commit, setCommit] = useState('')
  const [objective, setObjective] = useState('')
  const [type, setType] = useState<FleetJobType>('agent')
  const [deviceId, setDeviceId] = useState('')
  const [deadlineHours, setDeadlineHours] = useState('2')
  const [xcodeContainerKind, setXcodeContainerKind] = useState<
    'project' | 'workspace'
  >('project')
  const [xcodeContainerPath, setXcodeContainerPath] = useState('')
  const [xcodeScheme, setXcodeScheme] = useState('')
  const [xcodeConfiguration, setXcodeConfiguration] = useState('Debug')
  const [xcodeDestination, setXcodeDestination] = useState('platform=macOS')
  const [onlyTesting, setOnlyTesting] = useState('')
  const [commandExecutable, setCommandExecutable] = useState('')
  const [commandArguments, setCommandArguments] = useState('')
  const [commandWorkingDirectory, setCommandWorkingDirectory] = useState('.')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const repositoryIdentity =
    fleetRepositoryIdentity(repository) ?? '__invalid_repository__'
  const usableGrants = useMemo(() => {
    const activeControllers = new Set(
      devices
        .filter(
          (device) =>
            device.status === 'active' &&
            ['controller', 'hybrid'].includes(device.role)
        )
        .map((device) => device.id)
    )
    return grants.filter((grant) =>
      activeControllers.has(grant.controllerDeviceId)
    )
  }, [devices, grants])
  const supportedJobOptions = useMemo(
    () =>
      JOB_TYPE_OPTIONS.filter((option) =>
        devices.some((device) =>
          fleetDeviceCanRunGrantedJob(
            device,
            usableGrants,
            JOB_REQUIREMENTS[option.value],
            workspaceId,
            repositoryIdentity,
            Date.now(),
            ['command', 'windows-build'].includes(option.value)
              ? commandExecutable
              : ''
          )
        )
      ),
    [
      commandExecutable,
      devices,
      repositoryIdentity,
      usableGrants,
      workspaceId,
    ]
  )
  const eligibleDevices = useMemo(
    () =>
      devices.filter((device) =>
        fleetDeviceCanRunGrantedJob(
          device,
          usableGrants,
          JOB_REQUIREMENTS[type],
          workspaceId,
          repositoryIdentity,
          Date.now(),
          ['command', 'windows-build'].includes(type) ? commandExecutable : ''
        )
      ),
    [
      commandExecutable,
      devices,
      repositoryIdentity,
      type,
      usableGrants,
      workspaceId,
    ]
  )

  useEffect(() => {
    if (!supportedJobOptions.some((option) => option.value === type)) {
      const fallback = supportedJobOptions[0]?.value
      if (fallback) setType(fallback)
    }
  }, [supportedJobOptions, type])

  useEffect(() => {
    if (
      type === 'windows-build' &&
      !['dotnet', 'msbuild'].includes(commandExecutable.toLowerCase())
    ) {
      setCommandExecutable('dotnet')
    }
  }, [commandExecutable, type])

  useEffect(() => {
    if (deviceId && !eligibleDevices.some((device) => device.id === deviceId)) {
      setDeviceId('')
    }
  }, [deviceId, eligibleDevices])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const xcodeJob = type.startsWith('xcode-')
      const commandJob = type === 'command' || type === 'windows-build'
      const selectedDevice = devices.find((device) => device.id === deviceId)
      const jobInput: Omit<
        CreateFleetJobInput,
        'controllerAuthorization'
      > = {
        workspaceId,
        type,
        objective,
        workspaceSnapshot: {
          kind: 'git',
          repository,
          commit,
        },
        execution: xcodeJob
          ? {
              kind: 'xcode',
              containerKind: xcodeContainerKind,
              containerPath: xcodeContainerPath,
              scheme: xcodeScheme,
              configuration: xcodeConfiguration,
              destination: xcodeDestination,
              onlyTesting:
                type === 'xcode-test'
                  ? onlyTesting
                      .split('\n')
                      .map((value) => value.trim())
                      .filter(Boolean)
                  : [],
              timeoutMs:
                Math.max(0.25, Math.min(12, Number(deadlineHours))) *
                60 *
                60 *
                1000,
            }
          : commandJob
            ? {
                kind: 'command',
                executable: commandExecutable,
                arguments: commandArguments
                  .split('\n')
                  .map((value) => value.trim())
                  .filter(Boolean),
                workingDirectory: commandWorkingDirectory || '.',
                timeoutMs:
                  Math.max(0.25, Math.min(12, Number(deadlineHours))) *
                  60 *
                  60 *
                  1000,
              }
            : undefined,
        requiredCapabilities: JOB_REQUIREMENTS[type],
        target: deviceId
          ? {
              deviceIds: [deviceId as `dev_${string}`],
              allowControllerAsWorker: selectedDevice?.workerMode === 'opt-in',
            }
          : {
              allowControllerAsWorker: eligibleDevices.some(
                (device) => device.workerMode === 'opt-in'
              ),
            },
        deadlineAt:
          Date.now() +
          Math.max(0.25, Math.min(72, Number(deadlineHours))) * 60 * 60 * 1000,
        maxAttempts: 2,
        approvalPolicy: 'independent',
        reconciliationPolicy: 'lead',
        cage: {
          enabled: true,
          maxWallTimeMs:
            Math.max(0.25, Math.min(12, Number(deadlineHours))) *
            60 *
            60 *
            1000,
        },
        idempotencyKey: `fleet-ui:${crypto.randomUUID()}`,
      }
      if (typeof desktop?.fleet?.authorizeJob !== 'function') {
        throw new Error(
          'Open StatsKey Desktop on an enrolled controller to authorize this job.'
        )
      }
      const controllerAuthorization =
        await desktop.fleet.authorizeJob(jobInput)
      if (!controllerAuthorization) return
      const job = await createFleetJob({
        ...jobInput,
        controllerAuthorization,
      })
      onCreated(job)
      showToast('Job queued.', { kind: 'success' })
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="panel space-y-4" onSubmit={submit}>
      <div>
        <span className="card-title">Exact job specification</span>
        <p className="mt-1 text-[12px] text-text-muted">
          Jobs reference a remote repository and immutable commit. A worker
          never receives your current uncommitted files through this launcher.
        </p>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {supportedJobOptions.length === 0 && (
        <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-[12px] text-text-secondary">
          No online worker has both an installed adapter and a current
          unattended grant
          {workspaceId.trim() ? ` for ${workspaceId.trim()}` : ''}. Bring a
          compatible worker online or update its grant before queueing work.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5 text-[12px] text-text-secondary">
          <span>Workspace id</span>
          <input
            className="input"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            placeholder="statskey-website"
            required
          />
        </label>
        <label className="space-y-1.5 text-[12px] text-text-secondary">
          <span>Job type</span>
          <select
            className="input"
            value={type}
            onChange={(event) => setType(event.target.value as FleetJobType)}
          >
            {supportedJobOptions.length === 0 ? (
              <option value={type}>No supported job types</option>
            ) : (
              supportedJobOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="space-y-1.5 text-[12px] text-text-secondary">
          <span>Target device</span>
          <select
            className="input"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">Automatic eligible worker</option>
            {eligibleDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label} ({device.platform})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-[12px] text-text-secondary">
          <span>Deadline (hours)</span>
          <input
            className="input"
            type="number"
            min="0.25"
            max="72"
            step="0.25"
            value={deadlineHours}
            onChange={(event) => setDeadlineHours(event.target.value)}
            required
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-[12px] text-text-secondary">
          <span>Remote repository</span>
          <input
            className="input"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="owner/repository or an HTTPS Git URL"
            required
          />
        </label>
        <label className="space-y-1.5 text-[12px] text-text-secondary">
          <span>Commit</span>
          <input
            className="input font-mono"
            value={commit}
            onChange={(event) => setCommit(event.target.value)}
            placeholder="40-character Git commit"
            minLength={40}
            maxLength={64}
            required
          />
        </label>
      </div>
      {type.startsWith('xcode-') && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3">
            <span className="card-title">Typed Xcode execution</span>
            <p className="mt-1 text-[11px] text-text-muted">
              The worker runs one fixed xcodebuild argument list. These fields
              are stored with the signed job; the objective is never parsed as
              a shell command.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5 text-[12px] text-text-secondary">
              <span>Container</span>
              <select
                className="input"
                value={xcodeContainerKind}
                onChange={(event) =>
                  setXcodeContainerKind(
                    event.target.value as 'project' | 'workspace'
                  )
                }
              >
                <option value="project">Xcode project</option>
                <option value="workspace">Xcode workspace</option>
              </select>
            </label>
            <label className="space-y-1.5 text-[12px] text-text-secondary xl:col-span-2">
              <span>Container path</span>
              <input
                className="input font-mono"
                value={xcodeContainerPath}
                onChange={(event) => setXcodeContainerPath(event.target.value)}
                placeholder={
                  xcodeContainerKind === 'project'
                    ? 'App/App.xcodeproj'
                    : 'App/App.xcworkspace'
                }
                required
              />
            </label>
            <label className="space-y-1.5 text-[12px] text-text-secondary">
              <span>Scheme</span>
              <input
                className="input"
                value={xcodeScheme}
                onChange={(event) => setXcodeScheme(event.target.value)}
                placeholder="StatsKey"
                required
              />
            </label>
            <label className="space-y-1.5 text-[12px] text-text-secondary">
              <span>Configuration</span>
              <input
                className="input"
                value={xcodeConfiguration}
                onChange={(event) => setXcodeConfiguration(event.target.value)}
                required
              />
            </label>
            <label className="space-y-1.5 text-[12px] text-text-secondary md:col-span-2">
              <span>Destination</span>
              <input
                className="input font-mono"
                value={xcodeDestination}
                onChange={(event) => setXcodeDestination(event.target.value)}
                placeholder="platform=iOS Simulator,name=iPhone 17 Pro"
                required
              />
            </label>
            {type === 'xcode-test' && (
              <label className="space-y-1.5 text-[12px] text-text-secondary md:col-span-2 xl:col-span-4">
                <span>Only test these identifiers (optional, one per line)</span>
                <textarea
                  className="input min-h-[76px] resize-y font-mono"
                  value={onlyTesting}
                  onChange={(event) => setOnlyTesting(event.target.value)}
                  placeholder="StatsKeyTests/ActivityHistoryStabilityTests"
                />
              </label>
            )}
          </div>
        </div>
      )}
      {(type === 'command' || type === 'windows-build') && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3">
            <span className="card-title">Typed command execution</span>
            <p className="mt-1 text-[11px] text-text-muted">
              No shell is used. The worker must locally allow this executable,
              and every argument is passed separately.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-[12px] text-text-secondary">
              <span>Executable name</span>
              {type === 'windows-build' ? (
                <select
                  className="input font-mono"
                  value={commandExecutable}
                  onChange={(event) => setCommandExecutable(event.target.value)}
                  required
                >
                  <option value="dotnet">dotnet</option>
                  <option value="msbuild">msbuild</option>
                </select>
              ) : (
                <input
                  className="input font-mono"
                  value={commandExecutable}
                  onChange={(event) => setCommandExecutable(event.target.value)}
                  placeholder="npm"
                  required
                />
              )}
            </label>
            <label className="space-y-1.5 text-[12px] text-text-secondary">
              <span>Working directory</span>
              <input
                className="input font-mono"
                value={commandWorkingDirectory}
                onChange={(event) =>
                  setCommandWorkingDirectory(event.target.value)
                }
                placeholder="."
                required
              />
            </label>
            <label className="space-y-1.5 text-[12px] text-text-secondary md:col-span-2">
              <span>Arguments (one per line)</span>
              <textarea
                className="input min-h-[76px] resize-y font-mono"
                value={commandArguments}
                onChange={(event) => setCommandArguments(event.target.value)}
                placeholder={'test\n--\n--runInBand'}
              />
            </label>
          </div>
        </div>
      )}
      <label className="block space-y-1.5 text-[12px] text-text-secondary">
        <span>Objective</span>
        <textarea
          className="input min-h-[96px] resize-y"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="Describe the exact result and verification evidence required."
          maxLength={4_000}
          required
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-text-muted">
          Independent execution · two attempts · unattended owner grant required
        </p>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={
            submitting ||
            supportedJobOptions.length === 0 ||
            eligibleDevices.length === 0
          }
        >
          {submitting ? 'Queueing…' : 'Queue exact job'}
        </button>
      </div>
    </form>
  )
}

function fleetEventArtifactId(
  event: FleetJobEvent
): `artifact_${string}` | null {
  if (!event.payload || typeof event.payload !== 'object') return null
  const artifactId = (event.payload as Record<string, unknown>).artifactId
  return typeof artifactId === 'string' &&
    /^artifact_[a-f0-9]{32}$/.test(artifactId)
    ? (artifactId as `artifact_${string}`)
    : null
}

function JobDetail({
  job,
  onCancel,
  onRecover,
}: {
  job: FleetJob
  onCancel: () => void
  onRecover: () => void
}) {
  const [events, setEvents] = useState<FleetJobEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<
    string | null
  >(null)

  useEffect(() => {
    const controller = new AbortController()
    let cursor = 0
    let inFlight = false
    setEvents([])
    setError(null)
    async function refreshEvents() {
      if (inFlight) return
      inFlight = true
      try {
        const result = await listFleetJobEvents(
          job.id,
          { afterSequence: cursor, limit: 100 },
          { signal: controller.signal }
        )
        if (result.events.length > 0) {
          cursor = result.events[result.events.length - 1].sequence
          setEvents((current) => [...current, ...result.events])
        }
      } catch (nextError) {
        if (!controller.signal.aborted) setError(errorMessage(nextError))
      } finally {
        inFlight = false
      }
    }
    void refreshEvents()
    const interval = window.setInterval(() => {
      void refreshEvents()
    }, 4_000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [job.id])

  const snapshot = `${job.workspaceSnapshot.repository}@${job.workspaceSnapshot.commit.slice(
    0,
    12
  )}`

  async function downloadArtifact(artifactId: `artifact_${string}`) {
    setDownloadingArtifactId(artifactId)
    setError(null)
    try {
      const result = await createFleetArtifactDownload(artifactId)
      const url = new URL(result.download.url)
      const expiresAt = Date.parse(result.download.expiresAt)
      if (
        result.artifact.id !== artifactId ||
        result.artifact.state !== 'ready' ||
        url.protocol !== 'https:' ||
        url.hostname !== 'storage.googleapis.com' ||
        url.username ||
        url.password ||
        url.hash ||
        !url.searchParams.has('X-Goog-Signature') ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() ||
        expiresAt > Date.now() + 5 * 60_000
      ) {
        throw new Error('The artifact download URL was not trusted.')
      }
      const desktop = getDesktopBridge()
      if (typeof desktop?.fleet?.downloadArtifact === 'function') {
        const started = await desktop.fleet.downloadArtifact({
          artifactId,
          url: url.toString(),
          expiresAt: result.download.expiresAt,
        })
        if (!started) {
          throw new Error('The desktop could not start the artifact download.')
        }
      } else {
        window.location.assign(url.toString())
      }
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setDownloadingArtifactId(null)
    }
  }

  return (
    <div>
      <header className="border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatePill state={job.state} />
              <span className="text-[11px] text-text-muted">
                Attempt {job.attempt}/{job.maxAttempts}
              </span>
            </div>
            <h2 className="mt-3 text-[15px] font-medium leading-relaxed text-text-primary">
              {job.objective}
            </h2>
            <p className="mt-2 break-all font-mono text-[10px] text-text-muted">
              {job.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ACTIVE_JOB_STATES.has(job.state) && (
              <button
                className="btn btn-ghost text-[12px]"
                onClick={onRecover}
              >
                Recover expired lease
              </button>
            )}
            {canCancelFleetJob(job) && (
              <button className="btn btn-ghost text-[12px]" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </header>

      <dl className="grid gap-x-5 gap-y-3 border-b border-white/[0.06] px-5 py-4 text-[12px] sm:grid-cols-2">
        <JobFact label="Workspace" value={job.workspaceId} />
        <JobFact label="Type" value={jobTypeLabel(job.type)} />
        <JobFact
          label="Execution"
          value={fleetExecutionSummary(job)}
          mono={job.execution != null}
        />
        <JobFact label="Snapshot" value={snapshot} mono />
        <JobFact
          label="Worker"
          value={job.assignedDeviceId ?? 'Not leased'}
          mono={job.assignedDeviceId != null}
        />
        <JobFact label="Deadline" value={formatDateTime(job.deadlineAt)} />
        <JobFact
          label="Capabilities"
          value={job.requiredCapabilities.join(', ')}
        />
      </dl>

      {(job.artifactIds ?? []).length > 0 && (
        <div className="border-b border-white/[0.06] px-5 py-4">
          <span className="card-title">Retained evidence</span>
          <div className="mt-3 flex flex-wrap gap-2">
            {job.artifactIds.map((artifactId) => (
              <button
                key={artifactId}
                className="btn btn-ghost text-[11px]"
                disabled={downloadingArtifactId === artifactId}
                onClick={() => void downloadArtifact(artifactId)}
                title={artifactId}
              >
                {downloadingArtifactId === artifactId
                  ? 'Preparing download…'
                  : `Download ${artifactId.slice(-8)}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="card-title">Event stream</span>
          <span className="text-[11px] text-text-muted">
            {events.length}/{job.eventSequence} received
          </span>
        </div>
        {job.cancellationRequestedAt && (
          <div className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-[12px] text-text-secondary">
            Cancellation requested {relativeTime(job.cancellationRequestedAt)}.
          </div>
        )}
        {error && <div className="mt-3 error-banner">{error}</div>}
        {events.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-text-muted">
            No worker events yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {events.map((event) => {
              const artifactId = fleetEventArtifactId(event)
              return (
                <li
                key={`${event.attempt}:${event.sequence}`}
                className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-medium text-text-secondary">
                    {event.sequence}. {sentenceCase(event.type)}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {formatDateTime(event.occurredAt)}
                  </span>
                </div>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-text-muted">
                  {safeJson(event.payload)}
                </pre>
                {event.type === 'artifact' && artifactId && (
                    <button
                      className="btn btn-ghost mt-2 text-[11px]"
                      disabled={downloadingArtifactId === artifactId}
                      onClick={() => void downloadArtifact(artifactId)}
                    >
                      {downloadingArtifactId === artifactId
                        ? 'Preparing download…'
                        : 'Download retained evidence'}
                    </button>
                  )}
              </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

function JobFact({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-text-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 break-words text-text-secondary ${
          mono ? 'font-mono text-[10px]' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

function StatePill({ state }: { state: FleetJobState }) {
  const tone = TERMINAL_FLEET_JOB_STATES.has(state)
    ? state === 'succeeded'
      ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
      : 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300'
    : state === 'running'
      ? 'border-sky-400/20 bg-sky-400/[0.08] text-sky-300'
      : 'border-white/[0.08] bg-white/[0.04] text-text-secondary'
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${tone}`}
    >
      {sentenceCase(state)}
    </span>
  )
}

function fleetExecutionSummary(job: FleetJob): string {
  if (!job.execution) return 'Adapter-defined'
  if (job.execution.kind === 'xcode') {
    return `${job.execution.scheme} · ${job.execution.containerPath}`
  }
  const args = job.execution.arguments ?? []
  return [job.execution.executable, ...args].join(' ')
}

function jobTypeLabel(type: FleetJobType): string {
  return JOB_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
}

function sentenceCase(value: string): string {
  const normalized = value.replace(/[-_]/g, ' ')
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function platformLabel(platform: FleetDevice['platform']): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'ios') return 'iPhone/iPad'
  if (platform === 'android') return 'Android'
  return 'Linux'
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024))
  )
  return `${(value / 1024 ** exponent).toFixed(exponent >= 3 ? 1 : 0)} ${
    units[exponent]
  }`
}

function relativeTime(value: string | null): string {
  if (!value) return 'Never seen'
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return 'Unknown time'
  const elapsed = Date.now() - millis
  if (Math.abs(elapsed) < 60_000) return 'Just now'
  const minutes = Math.round(Math.abs(elapsed) / 60_000)
  if (minutes < 60) return `${minutes}m ${elapsed >= 0 ? 'ago' : 'from now'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ${elapsed >= 0 ? 'ago' : 'from now'}`
  const days = Math.round(hours / 24)
  return `${days}d ${elapsed >= 0 ? 'ago' : 'from now'}`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unavailable payload]'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
