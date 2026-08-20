import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createFleetJob,
  getFleetJob,
  listFleetDevices,
  listFleetGrants,
  listFleetJobEvents,
  listFleetJobs,
  requestFleetRemoteSession,
} from '../lib/fleet/workbenchFleetApi'
import {
  TERMINAL_FLEET_JOB_STATES,
  fleetRepositoryIdentity,
  type FleetDevice,
  type FleetGrant,
  type FleetJob,
  type FleetJobState,
} from '../lib/fleet/types'
import {
  COCKPIT_DIRECTORY_ROOTS,
  activeCockpitGrants,
  buildCockpitFilesJob,
  buildCockpitTaskJob,
  cockpitCanBrowseFiles,
  cockpitCanRunTasks,
  cockpitFormatBytes,
  cockpitGrantForDevice,
  cockpitJobStdout,
  cockpitMachineCapabilities,
  cockpitMachineState,
  cockpitMachineStateLabel,
  cockpitPlatformLabel,
  cockpitRecentActivity,
  cockpitRelativeTime,
  cockpitSupportsRemoteSession,
  parseCockpitDirectoryListing,
  type CockpitDirectoryListing,
  type CockpitDirectoryRootId,
} from '../lib/cockpit'
import {
  getDesktopBridge,
  type DesktopFleetIdentityState,
  type DesktopWorkspaceNode,
} from '../lib/desktop'
import { confirmDialog, promptDialog, showToast } from '../lib/ui/dialogs'

const FILES_JOB_POLL_INTERVAL_MS = 2_000
const FILES_JOB_WAIT_MS = 4 * 60_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function Cockpit() {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const navigate = useNavigate()
  const [identity, setIdentity] = useState<DesktopFleetIdentityState | null>(
    null
  )
  const [identityLoaded, setIdentityLoaded] = useState(false)
  const [devices, setDevices] = useState<FleetDevice[]>([])
  const [grants, setGrants] = useState<FleetGrant[]>([])
  const [jobs, setJobs] = useState<FleetJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [identityState, deviceResult, grantResult, jobResult] =
          await Promise.all([
            desktop?.fleet?.identityState() ?? Promise.resolve(null),
            listFleetDevices({ limit: 50 }, { signal }),
            listFleetGrants({ limit: 50 }, { signal }),
            listFleetJobs({ limit: 10 }, { signal }),
          ])
        setIdentity(identityState)
        setIdentityLoaded(true)
        setDevices(deviceResult.devices)
        setGrants(grantResult.grants)
        setJobs(jobResult.jobs)
        setError(null)
      } catch (nextError) {
        if (signal?.aborted) return
        setError(errorMessage(nextError))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [desktop]
  )

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

  const activeGrants = useMemo(
    () => activeCockpitGrants(devices, grants),
    [devices, grants]
  )
  const activity = useMemo(() => cockpitRecentActivity(jobs), [jobs])
  const deviceLabels = useMemo(
    () => new Map(devices.map((device) => [device.id, device.label])),
    [devices]
  )

  async function requestRemoteSession(device: FleetDevice) {
    if (!desktop?.remoteSession) {
      showToast('Remote sessions need the StatsKey desktop app.', {
        kind: 'error',
      })
      return
    }
    const controller =
      devices.find(
        (candidate) =>
          candidate.id === identity?.deviceId &&
          candidate.status === 'active' &&
          ['controller', 'hybrid'].includes(candidate.role)
      ) ??
      devices.find(
        (candidate) =>
          candidate.status === 'active' &&
          ['controller', 'hybrid'].includes(candidate.role)
      )
    if (!controller) {
      showToast('No active controller is set up on this account yet.', {
        kind: 'error',
      })
      return
    }
    const confirmed = await confirmDialog({
      title: `Request a remote session on ${device.label}?`,
      body: [
        'You are requesting screen viewing only.',
        'The host shows a visible indicator while the session is active.',
      ].join('\n'),
      confirmLabel: 'Request session',
    })
    if (!confirmed) return
    try {
      const prepared = await desktop.remoteSession.prepareRequest()
      if (!prepared) {
        throw new Error('The desktop could not prepare the session.')
      }
      await requestFleetRemoteSession({
        controllerDeviceId: controller.id,
        workerDeviceId: device.id,
        capabilities: ['screen.view'],
        transport: 'relay',
        controllerEphemeralKey: prepared.controllerEphemeralKey,
      })
      showToast('Remote session requested.', { kind: 'success' })
      navigate('/fleet/remote')
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  async function createProjectFolder() {
    if (!desktop) return
    const name = await promptDialog({
      title: 'New project folder',
      body: 'Created inside the StatsKey Projects folder in your home directory.',
      label: 'Project name',
      placeholder: 'My project',
      confirmLabel: 'Create folder',
      maxLength: 80,
    })
    if (!name) return
    try {
      const result = await desktop.workspace.createProjectInRoot(name)
      if (!result.ok || !result.workspace) {
        if (!result.cancelled) {
          showToast(result.error || 'The project folder could not be created.', {
            kind: 'error',
          })
        }
        return
      }
      showToast(`Project folder “${name}” is open.`, { kind: 'success' })
      navigate('/workspace')
    } catch (nextError) {
      showToast(errorMessage(nextError), { kind: 'error' })
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="card-title">Machines</span>
          <h1 className="mt-1 font-display text-[28px] font-bold tracking-[-0.025em]">
            Cockpit
          </h1>
          <p className="mt-1 max-w-2xl text-[14px] text-text-secondary">
            See and steer your machines from here.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {identityLoaded && !identity && desktop?.fleet && (
        <section className="panel">
          <span className="card-title">Get started</span>
          <h2 className="mt-1 text-[15px] font-semibold text-text-primary">
            Set up this Mac as your controller
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
            Cockpit steers your other machines from this app. First give this
            computer its protected controller identity — it takes a minute on
            the Fleet tab.
          </p>
          <button
            className="btn btn-primary mt-4"
            onClick={() => navigate('/fleet')}
          >
            Open Fleet setup
          </button>
        </section>
      )}

      {identityLoaded && identity && !identity.enrollment && (
        <section className="panel">
          <span className="card-title">Almost there</span>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
            This computer has a protected identity but is not connected to your
            account yet. Finish setup on the Fleet tab to steer your machines
            from here.
          </p>
          <button
            className="btn btn-primary mt-4"
            onClick={() => navigate('/fleet')}
          >
            Finish setup
          </button>
        </section>
      )}

      {!desktop?.fleet && (
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[12px] leading-relaxed text-text-secondary">
          Machine actions — running tasks, browsing files, and remote sessions —
          need the StatsKey desktop app. This view still shows your machines
          and recent activity.
        </section>
      )}

      <section aria-label="Your machines">
        {loading && devices.length === 0 ? (
          <div className="panel px-5 py-10 text-center text-[13px] text-text-muted">
            Reading your machines…
          </div>
        ) : devices.length === 0 ? (
          <div className="panel px-5 py-10 text-center">
            <h2 className="font-display text-[17px] font-semibold text-text-primary">
              No machines yet
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-text-muted">
              Set up this computer as your controller, then pair another
              machine from the Fleet tab. It will show up here with its tasks,
              files, and remote session actions.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {devices.map((device) => (
              <MachineCard
                key={device.id}
                device={device}
                activeGrants={activeGrants}
                isLocal={device.id === identity?.deviceId}
                canUseDesktopBridge={desktop?.fleet != null}
                onRequestRemote={() => void requestRemoteSession(device)}
                onCreateProjectFolder={() => void createProjectFolder()}
                onJobCreated={(job) =>
                  setJobs((current) => [
                    job,
                    ...current.filter((candidate) => candidate.id !== job.id),
                  ])
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel !p-0 overflow-hidden" aria-label="Recent activity">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <span className="card-title">Recent activity</span>
            <p className="mt-1 text-[12px] text-text-muted">
              The latest tasks across your machines.
            </p>
          </div>
          <Link
            to="/jobs"
            className="text-[12px] font-medium text-text-secondary hover:text-text-primary"
          >
            See all jobs
          </Link>
        </div>
        {activity.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12px] text-text-muted">
            No tasks yet. Run a task from a machine card to see it here.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {activity.map((job) => (
              <article
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-text-primary">
                    {job.objective}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">
                    {(job.assignedDeviceId &&
                      deviceLabels.get(job.assignedDeviceId)) ||
                      'Any machine'}{' '}
                    · {cockpitRelativeTime(job.updatedAt)}
                  </p>
                </div>
                <JobStatePill state={job.state} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function MachineCard({
  device,
  activeGrants,
  isLocal,
  canUseDesktopBridge,
  onRequestRemote,
  onCreateProjectFolder,
  onJobCreated,
}: {
  device: FleetDevice
  activeGrants: FleetGrant[]
  isLocal: boolean
  canUseDesktopBridge: boolean
  onRequestRemote: () => void
  onCreateProjectFolder: () => void
  onJobCreated: (job: FleetJob) => void
}) {
  const [taskOpen, setTaskOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const state = cockpitMachineState(device, activeGrants)
  const grant = cockpitGrantForDevice(device, activeGrants)
  const capabilities = cockpitMachineCapabilities(device)
  const canTask =
    canUseDesktopBridge && cockpitCanRunTasks(device, activeGrants)
  const canBrowse =
    canUseDesktopBridge && cockpitCanBrowseFiles(device, activeGrants)
  const canRemote =
    cockpitSupportsRemoteSession(device) && state === 'online'

  return (
    <section className="panel !p-0 overflow-hidden" aria-label={device.label}>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  state === 'online'
                    ? 'bg-emerald-400'
                    : state === 'attention'
                      ? 'bg-amber-300'
                      : 'bg-white/20'
                }`}
                aria-hidden="true"
              />
              <h2 className="truncate text-[15px] font-semibold text-text-primary">
                {device.label}
              </h2>
              {isLocal && (
                <span className="rounded-full border border-sky-300/20 bg-sky-300/[0.06] px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                  This Mac
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {cockpitPlatformLabel(device.platform)} ·{' '}
              {capabilities.length > 0
                ? capabilities.join(' · ')
                : 'No reported capabilities'}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-text-secondary">
            {cockpitMachineStateLabel(state)}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-text-muted">
          {state === 'online'
            ? 'Online now'
            : state === 'offline'
              ? `Last seen ${cockpitRelativeTime(device.lastSeenAt)}`
              : state === 'attention'
                ? 'Online, but it has not been given permission to run tasks yet. Manage it on the Fleet tab.'
                : 'Access was revoked for this machine.'}
        </p>
        {state === 'offline' && (
          <p className="mt-1 text-[11px] text-text-muted">
            Tasks, files, and remote sessions resume when it reconnects.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {canRemote && (
            <button className="btn btn-secondary text-[12px]" onClick={onRequestRemote}>
              Remote session
            </button>
          )}
          {cockpitSupportsRemoteSession(device) && state === 'offline' && (
            <button
              className="btn btn-secondary text-[12px]"
              disabled
              title="Remote sessions need the machine to be online."
            >
              Remote session
            </button>
          )}
          {canTask && (
            <button
              className="btn btn-secondary text-[12px]"
              onClick={() => setTaskOpen((open) => !open)}
            >
              {taskOpen ? 'Close task' : 'Run a task'}
            </button>
          )}
          {(isLocal || canBrowse || state === 'offline' || state === 'attention') && (
            <button
              className="btn btn-secondary text-[12px]"
              onClick={() => setFilesOpen((open) => !open)}
            >
              {filesOpen ? 'Close files' : 'Files'}
            </button>
          )}
          {isLocal && (
            <button
              className="btn btn-ghost text-[12px]"
              onClick={onCreateProjectFolder}
            >
              New project folder
            </button>
          )}
        </div>
      </div>

      {taskOpen && canTask && grant && (
        <TaskForm
          device={device}
          grant={grant}
          onCreated={(job) => {
            onJobCreated(job)
            setTaskOpen(false)
          }}
        />
      )}
      {filesOpen &&
        (isLocal ? (
          <LocalFilesPanel />
        ) : (
          <RemoteFilesPanel
            device={device}
            grant={grant}
            canBrowse={canBrowse}
            state={state}
            onJobCreated={onJobCreated}
          />
        ))}
    </section>
  )
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-white/[0.06] bg-black/10 px-5 py-4">
      {children}
    </div>
  )
}

function TaskForm({
  device,
  grant,
  onCreated,
}: {
  device: FleetDevice
  grant: FleetGrant
  onCreated: (job: FleetJob) => void
}) {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const [objective, setObjective] = useState('')
  const [executable, setExecutable] = useState('')
  const [args, setArgs] = useState('')
  const [repository, setRepository] = useState(
    grant.repositoryIdentities[0] ?? ''
  )
  const [commit, setCommit] = useState('')
  const [workspaceId, setWorkspaceId] = useState(
    grant.workspaceIds[0] === '*' ? '' : (grant.workspaceIds[0] ?? '')
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (typeof desktop?.fleet?.authorizeJob !== 'function') {
        throw new Error(
          'Open StatsKey Desktop on your controller to run a task.'
        )
      }
      if (!fleetRepositoryIdentity(repository)) {
        throw new Error('That repository is not one this machine can use.')
      }
      const jobInput = buildCockpitTaskJob({
        device,
        grant,
        objective: objective.trim(),
        executable: executable.trim(),
        arguments: args
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        repository: repository.trim(),
        commit: commit.trim(),
        workspaceId: workspaceId.trim(),
      })
      const controllerAuthorization =
        await desktop.fleet.authorizeJob(jobInput)
      if (!controllerAuthorization) return
      const job = await createFleetJob({
        ...jobInput,
        controllerAuthorization,
      })
      onCreated(job)
      showToast('Task queued.', { kind: 'success' })
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelShell>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-[12px] text-text-muted">
          Run a command on {device.label}. No shell is used — the machine must
          allow the program, and every argument is passed separately.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <label className="block space-y-1.5 text-[12px] text-text-secondary">
          <span>What should it do?</span>
          <textarea
            className="input min-h-[64px] resize-y"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Describe the result you expect."
            maxLength={4_000}
            required
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-[12px] text-text-secondary">
            <span>Program</span>
            <input
              className="input font-mono"
              value={executable}
              onChange={(event) => setExecutable(event.target.value)}
              placeholder="npm"
              required
            />
          </label>
          <label className="space-y-1.5 text-[12px] text-text-secondary">
            <span>Arguments (one per line)</span>
            <textarea
              className="input min-h-[64px] resize-y font-mono"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder={'test\n--\n--runInBand'}
            />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
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
            <span>Repository</span>
            <input
              className="input font-mono"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1.5 text-[12px] text-text-secondary">
            <span>Exact commit</span>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-text-muted">
            Tasks run against an exact project version, never your uncommitted
            files.
          </p>
          <button
            className="btn btn-primary text-[12px]"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Queueing…' : 'Run task'}
          </button>
        </div>
      </form>
    </PanelShell>
  )
}

function LocalFilesPanel() {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const [roots, setRoots] = useState<DesktopWorkspaceNode[] | null>(null)
  const [path, setPath] = useState<string[]>([])
  const [entries, setEntries] = useState<DesktopWorkspaceNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!desktop) return
    desktop.workspace
      .getState()
      .then((state) => {
        if (active) setRoots(state.roots)
      })
      .catch((nextError) => {
        if (active) setError(errorMessage(nextError))
      })
    return () => {
      active = false
    }
  }, [desktop])

  useEffect(() => {
    let active = true
    if (!desktop || !roots || path.length === 0) {
      setEntries(null)
      return
    }
    const directory = path[path.length - 1]
    desktop.workspace
      .listDirectory(directory)
      .then((nodes) => {
        if (active) setEntries(nodes)
      })
      .catch((nextError) => {
        if (active) setError(errorMessage(nextError))
      })
    return () => {
      active = false
    }
  }, [desktop, roots, path])

  if (roots === null) {
    return (
      <PanelShell>
        <p className="text-[12px] text-text-muted">Reading this Mac…</p>
      </PanelShell>
    )
  }
  if (roots.length === 0) {
    return (
      <PanelShell>
        <p className="text-[12px] text-text-muted">
          No project is open on this Mac. Open one from the Workspace tab and
          its files will appear here.
        </p>
      </PanelShell>
    )
  }

  const current = path.length > 0 ? path[path.length - 1] : null
  return (
    <PanelShell>
      {error && <div className="error-banner mb-3">{error}</div>}
      {current == null ? (
        <FileList>
          {roots.map((root) => (
            <FileRow
              key={root.path}
              name={root.name}
              kind="directory"
              depth={0}
              onOpen={() => setPath([root.path])}
            />
          ))}
        </FileList>
      ) : (
        <>
          <button
            className="btn btn-ghost mb-2 text-[11px]"
            onClick={() => setPath((currentPath) => currentPath.slice(0, -1))}
          >
            Up one level
          </button>
          {entries === null ? (
            <p className="text-[12px] text-text-muted">Reading folder…</p>
          ) : entries.length === 0 ? (
            <p className="text-[12px] text-text-muted">This folder is empty.</p>
          ) : (
            <FileList>
              {entries.map((entry) => (
                <FileRow
                  key={entry.path}
                  name={entry.name}
                  kind={entry.kind}
                  size={entry.size}
                  depth={0}
                  onOpen={
                    entry.kind === 'directory'
                      ? () => setPath((currentPath) => [...currentPath, entry.path])
                      : undefined
                  }
                />
              ))}
            </FileList>
          )}
        </>
      )}
      <p className="mt-3 text-[11px] text-text-muted">
        Files stay read-only here.
      </p>
    </PanelShell>
  )
}

function RemoteFilesPanel({
  device,
  grant,
  canBrowse,
  state,
  onJobCreated,
}: {
  device: FleetDevice
  grant: FleetGrant | null
  canBrowse: boolean
  state: ReturnType<typeof cockpitMachineState>
  onJobCreated: (job: FleetJob) => void
}) {
  const desktop = useMemo(() => getDesktopBridge(), [])
  const [rootId, setRootId] = useState<CockpitDirectoryRootId>('home')
  const [relativePath, setRelativePath] = useState('')
  const [repository, setRepository] = useState(
    grant?.repositoryIdentities[0] ?? ''
  )
  const [commit, setCommit] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [listing, setListing] = useState<CockpitDirectoryListing | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (state === 'offline') {
    return (
      <PanelShell>
        <p className="text-[12px] text-text-muted">
          This machine is offline. Its files appear here when it reconnects.
        </p>
      </PanelShell>
    )
  }
  if (state === 'revoked') {
    return (
      <PanelShell>
        <p className="text-[12px] text-text-muted">
          Access was revoked for this machine, so its files are unavailable.
        </p>
      </PanelShell>
    )
  }
  if (!canBrowse || !grant) {
    return (
      <PanelShell>
        <p className="text-[12px] text-text-muted">
          This machine can&apos;t run tasks yet, so its files aren&apos;t
          available from here. Give it permission on the Fleet tab.
        </p>
      </PanelShell>
    )
  }

  async function browse(targetRoot: CockpitDirectoryRootId, targetPath: string) {
    if (!desktop?.fleet || !grant) return
    setBrowsing(true)
    setError(null)
    setListing(null)
    setStatus('Queueing a read-only listing…')
    try {
      if (typeof desktop.fleet.authorizeJob !== 'function') {
        throw new Error(
          'Open StatsKey Desktop on your controller to browse files.'
        )
      }
      if (!fleetRepositoryIdentity(repository)) {
        throw new Error('That repository is not one this machine can use.')
      }
      const jobInput = buildCockpitFilesJob({
        device,
        grant,
        rootId: targetRoot,
        relativePath: targetPath,
        repository: repository.trim(),
        commit: commit.trim(),
      })
      const controllerAuthorization =
        await desktop.fleet.authorizeJob(jobInput)
      if (!controllerAuthorization) return
      const job = await createFleetJob({
        ...jobInput,
        controllerAuthorization,
      })
      onJobCreated(job)
      setStatus('Waiting for the machine…')
      const finished = await waitForFilesJob(job.id)
      if (!TERMINAL_FLEET_JOB_STATES.has(finished.state)) {
        throw new Error('The listing is taking too long. It will finish in the background — check the Jobs tab.')
      }
      if (finished.state !== 'succeeded') {
        throw new Error('The machine could not read that folder.')
      }
      const events = await listFleetJobEvents(job.id, { limit: 100 })
      const parsed = parseCockpitDirectoryListing(cockpitJobStdout(events.events))
      if (!parsed) {
        throw new Error(
          'The machine answered in an older format. Update StatsKey on it to browse files.'
        )
      }
      if (parsed.error === 'unknown-root' || parsed.error === 'outside-root') {
        throw new Error('That folder is not available on this machine.')
      }
      setRootId(targetRoot)
      setRelativePath(targetPath)
      setListing(parsed)
      setStatus(null)
    } catch (nextError) {
      setError(errorMessage(nextError))
      setStatus(null)
    } finally {
      setBrowsing(false)
    }
  }

  return (
    <PanelShell>
      <div className="space-y-3">
        <p className="text-[12px] text-text-muted">
          Read-only browse of {device.label}. Each view runs a small signed
          task on that machine.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5 text-[12px] text-text-secondary">
            <span>Folder</span>
            <select
              className="input"
              value={rootId}
              onChange={(event) => {
                setRootId(event.target.value as CockpitDirectoryRootId)
                setRelativePath('')
                setListing(null)
              }}
              disabled={browsing}
            >
              {COCKPIT_DIRECTORY_ROOTS.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[200px] flex-1 space-y-1.5 text-[12px] text-text-secondary">
            <span>Repository this machine may use</span>
            <input
              className="input font-mono"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              disabled={browsing}
              required
            />
          </label>
          <label className="min-w-[200px] flex-1 space-y-1.5 text-[12px] text-text-secondary">
            <span>Exact commit</span>
            <input
              className="input font-mono"
              value={commit}
              onChange={(event) => setCommit(event.target.value)}
              placeholder="40-character Git commit"
              minLength={40}
              maxLength={64}
              disabled={browsing}
              required
            />
          </label>
          <button
            className="btn btn-primary text-[12px]"
            disabled={browsing || !commit.trim() || !repository.trim()}
            onClick={() => void browse(rootId, relativePath)}
          >
            {browsing ? 'Browsing…' : 'Browse'}
          </button>
        </div>
        {status && (
          <p className="text-[12px] text-text-muted" role="status">
            {status}
          </p>
        )}
        {listing && (
          <>
            {relativePath && (
              <button
                className="btn btn-ghost text-[11px]"
                disabled={browsing}
                onClick={() => {
                  const parent = relativePath.split('/').slice(0, -1).join('/')
                  void browse(rootId, parent)
                }}
              >
                Up one level
              </button>
            )}
            {listing.entries.length === 0 ? (
              <p className="text-[12px] text-text-muted">
                This folder is empty.
              </p>
            ) : (
              <FileList>
                {listing.entries.map((entry) => (
                  <FileRow
                    key={entry.path}
                    name={entry.name}
                    kind={entry.type === 'directory' ? 'directory' : 'file'}
                    size={entry.size}
                    depth={entry.depth}
                    unreadable={entry.type === 'unreadable'}
                    onOpen={
                      entry.type === 'directory'
                        ? () => void browse(rootId, entry.path)
                        : undefined
                    }
                  />
                ))}
              </FileList>
            )}
            {listing.truncated && (
              <p className="mt-2 text-[11px] text-text-muted">
                This folder is large, so the list stops early. Open a subfolder
                to keep looking.
              </p>
            )}
          </>
        )}
        <p className="text-[11px] text-text-muted">
          Files stay read-only here.
        </p>
      </div>
    </PanelShell>
  )
}

async function waitForFilesJob(jobId: `job_${string}`): Promise<FleetJob> {
  const startedAt = Date.now()
  let job = await getFleetJob(jobId)
  while (
    !TERMINAL_FLEET_JOB_STATES.has(job.state) &&
    Date.now() - startedAt < FILES_JOB_WAIT_MS
  ) {
    await new Promise((resolve) =>
      globalThis.setTimeout(resolve, FILES_JOB_POLL_INTERVAL_MS)
    )
    job = await getFleetJob(jobId)
  }
  return job
}

function FileList({ children }: { children: ReactNode }) {
  return <ul className="space-y-0.5">{children}</ul>
}

function FileRow({
  name,
  kind,
  size,
  depth,
  unreadable = false,
  onOpen,
}: {
  name: string
  kind: 'directory' | 'file'
  size?: number | null
  depth: number
  unreadable?: boolean
  onOpen?: () => void
}) {
  const label = (
    <>
      <span
        className={`truncate text-[12px] ${
          kind === 'directory'
            ? 'font-medium text-text-primary'
            : 'text-text-secondary'
        }`}
      >
        {name}
        {kind === 'directory' ? '/' : ''}
      </span>
      <span className="shrink-0 text-[10px] text-text-muted">
        {unreadable
          ? 'unreadable'
          : kind === 'file'
            ? cockpitFormatBytes(size ?? null)
            : 'folder'}
      </span>
    </>
  )
  return (
    <li
      className="flex items-center justify-between gap-3 rounded-md px-2 py-1"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
    >
      {onOpen ? (
        <button
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:bg-white/[0.03] rounded-md px-1 py-0.5"
          onClick={onOpen}
        >
          {label}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 px-1 py-0.5">
          {label}
        </span>
      )}
    </li>
  )
}

function JobStatePill({ state }: { state: FleetJobState }) {
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
      {state.charAt(0).toUpperCase() + state.slice(1).replace(/[-_]/g, ' ')}
    </span>
  )
}
