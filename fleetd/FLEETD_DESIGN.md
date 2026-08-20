# statskey-fleetd — privileged Ubuntu Fleet execution service

Status: design authority for the first implementation. Verified against the
Linux Fleet boundary map and worker threat model on 2026-08-19.

This service is the only way Ubuntu machines may execute Fleet jobs. The
unsigned `statskey-desktop` preview never installs, updates, or runs as this
root component. The service ships as a separately signed, optional
`statskey-fleetd` DEB from an independently trusted APT path.

## Threat model

- Repository contents, command arguments, and job payloads are hostile.
- The desktop process, the unprivileged agent account, and the worker device
  key may be compromised.
- Network messages may be replayed, delayed, reordered, or dropped.
- Workloads may daemonize, create sessions, fork during teardown, race paths,
  or attempt cgroup escape.
- Clocks may jump and services may crash or restart at any point.
- Malicious root and kernel compromise are out of scope; raising that bar
  later requires Secure Boot plus TPM/IMA measured attestation.

## Principals

1. `statskey-fleetd` — small root daemon. No network access. Owns the helper
   key, the coordinator key ring, the ticket journal, lease timers, and every
   job cgroup. The only component that talks to systemd.
2. `statskey-fleet-agent` — unprivileged system user (`statskey-fleet`).
   Holds the worker device key. Polls, claims, renews, publishes events,
   uploads artifacts. Cannot create cgroups, change UID, or read desktop
   credentials.
3. Per-job `DynamicUser` — runs Git and all repository-controlled code. No
   supplementary groups, no capabilities, no SSH agent, no keyring, no system
   bus, no helper socket.

## Mandatory invariants

1. No repository data, command argument, path, or environment value is
   evaluated as UID 0 or with capabilities. The daemon interprets tickets only
   to configure systemd; the fixed runner interprets them only after systemd
   has selected the unprivileged job principal and applied containment.
2. Even a compromised controller or coordinator can authorize only an
   unprivileged sandbox, never root execution. The privileged API has no
   caller-selected executable paths, UIDs, mount paths, cgroup paths,
   environment, or systemd properties.
3. One coordinator-signed ticket starts at most one execution on one helper
   instance. Exact duplicates return the original start receipt.
4. Renewals require strictly increasing sequence numbers. Equal-sequence
   duplicates are accepted only when byte-identical.
5. Lease expiry is enforced with `CLOCK_BOOTTIME`, including suspend time.
6. Daemon death, restart, or watchdog failure stops every active job before
   the daemon accepts new work.
7. Every descendant stays in a non-delegated cgroup; the workload cannot
   write `cgroup.procs`, mount cgroupfs, or obtain `CAP_SYS_ADMIN`.
8. No completion, retry, cleanup, or resource reuse until the job cgroup is
   proven empty (`cgroup.events` `populated 0`).
9. PID/PGID values are never sufficient identity: use systemd unit identity
   and anchored cgroup directory handles.
10. Privileged filesystem operations use trusted dirfds and opaque IDs, never
    caller-provided paths.
11. The control socket is root-owned with peer-UID verification; frames are
    bounded canonical JSON.
12. Ticket resource limits are kernel-enforced at least as tightly as signed;
    the daemon may tighten, never loosen.
13. Linux execution capability derives from fresh helper attestation, never
    from self-reported telemetry.
14. Helper build, runner build, AppArmor digest, and policy epoch must
    satisfy server policy at poll and claim time.
15. An expired attempt that launched any process is ambiguous without a valid
    termination receipt.
16. Private repository credentials are repository-scoped, short-lived,
    unavailable to the job, and never an ambient SSH agent.
17. Unknown fields, unsupported profiles, unsafe filesystem entries, or
    uncertain teardown all fail closed.

## Wire protocol

All signed structures use canonical JSON: UTF-8, no insignificant whitespace,
object keys sorted lexicographically, no duplicate keys, integers only (no
floats, no exponents), strings reject unpaired surrogates and U+2028/U+2029.
Signatures are Ed25519 over the canonical bytes. Public keys are SPKI DER
base64url; key IDs are `sha256:<base64url>` of the canonical SPKI bytes.

### HelperAttestationV1 (helper-signed, challenge-bound)

```json
{
  "domain": "statskey.fleet.helper-attestation.v1",
  "challengeId": "chal_<32 lowercase hex>",
  "challengeNonce": "<43-128 base64url>",
  "deviceId": "dev_<32 lowercase hex>",
  "executionServiceId": "svc_<32 lowercase hex>",
  "helperInstanceId": "hi_<32 lowercase hex>",
  "bootIdDigest": "sha256:<base64url>",
  "helperProtocol": 1,
  "helperBuildId": "sha256:<64 lowercase hex>",
  "runnerBuildId": "sha256:<64 lowercase hex>",
  "policyEpoch": 1,
  "platform": {
    "id": "ubuntu",
    "versionId": "26.04",
    "arch": "x86_64",
    "kernelRelease": "<uname -r>",
    "cgroupVersion": 2,
    "systemdVersion": "<systemd --version major>"
  },
  "security": {
    "cgroupKill": true,
    "delegated": false,
    "apparmorEnforcing": true,
    "apparmorProfileDigest": "sha256:<64 lowercase hex>"
  },
  "issuedAt": "<RFC3339 ms UTC>",
  "expiresAt": "<RFC3339 ms UTC>",
  "signature": "<base64url Ed25519 over canonical bytes without signature>"
}
```

### ExecutionTicketV1 (coordinator-signed)

```json
{
  "domain": "statskey.fleet.execution-ticket.v1",
  "ticketId": "ticket_<32 lowercase hex>",
  "jobRequestDigest": "sha256:<64 lowercase hex>",
  "jobId": "job_<32 lowercase hex>",
  "attempt": 1,
  "leaseId": "lease_<32 lowercase hex>",
  "leaseSequence": 0,
  "grantReceiptDigest": "sha256:<64 lowercase hex>",
  "ownerUid": "<uid>",
  "workerDeviceId": "dev_<32 lowercase hex>",
  "controllerDeviceId": "dev_<32 lowercase hex>",
  "executionServiceId": "svc_<32 lowercase hex>",
  "helperInstanceId": "hi_<32 lowercase hex>",
  "repositoryIdentity": "github.com/owner/repo",
  "commit": "<40 lowercase hex>",
  "executorProfileId": "command-v1",
  "sandboxProfileId": "ubuntu-build-v1",
  "networkProfileId": "none",
  "command": {
    "executable": "node",
    "arguments": ["--version"],
    "workingDirectory": "."
  },
  "resources": {
    "cpuMilli": 4000,
    "memoryBytes": 8589934592,
    "pids": 256,
    "diskBytes": 21474836480,
    "wallTimeMs": 3600000
  },
  "serverIssuedAt": "<RFC3339 ms UTC>",
  "leaseExpiresAt": "<RFC3339 ms UTC>",
  "jobDeadlineAt": "<RFC3339 ms UTC>",
  "minimumHelperProtocol": 1,
  "minimumPolicyEpoch": 1,
  "signature": "<base64url Ed25519 over canonical bytes without signature>"
}
```

The ticket contains no host paths, UIDs, mounts, systemd properties, or
environment. `command.executable` is a bare name resolved by the runner
against a fixed root-owned search path (`/usr/bin:/bin:/usr/local/bin`) and
accepted only when the resolved file is a regular root-owned binary that is
neither group- nor world-writable.

### LeaseUpdateV1 (coordinator-signed renewal/cancellation)

Binds ticketId, jobId, attempt, leaseId, helperInstanceId, a strictly
increasing `leaseSequence`, `cancelled` boolean, `serverIssuedAt`, and
absolute `leaseExpiresAt` (never beyond `jobDeadlineAt`). The daemon converts
remaining time to a single `CLOCK_BOOTTIME` deadline at receipt; later
wall-clock changes cannot extend authority.

### ExecutionStartedReceiptV1 / TerminationReceiptV1 (helper-signed)

Domains: `statskey.fleet.execution-started-receipt.v1` and
`statskey.fleet.termination-receipt.v1`. Start receipts bind ticketId, jobId,
attempt, leaseId, helperInstanceId, unit name
(`statskey-fleet-job-<ticketId>.service`), cgroup path (beneath
`/sys/fs/cgroup/`, no dot segments), effective limits, runner build,
`startedAt`, and `startedAtMonotonicMs` (milliseconds: nanoseconds overflow
JS safe-integer range after ~104 days of uptime). Termination receipts bind
ticket/job/attempt/lease, `highestLeaseSequence`, exit status (-1 when no
exit status exists), `terminationReason` from the fixed enum (`exited`,
`failed`, `lease-expired`, `cancelled`, `stop-requested`, `daemon-restart`,
`watchdog`, `runtime-exceeded`, `oom`, `signal`), unit name, cgroup path,
`populated: false`, `accounting` (`cpuUsageNs`, `memoryPeakBytes`,
`pidsPeak`, `ioReadBytes`, `ioWriteBytes`), `finishedAt`,
`finishedAtMonotonicMs`, and the helper signature. The coordinator requires
a valid termination receipt before retrying any attempt that launched a
process. Both sides' canonical encoders and verifiers are pinned by the
`fleetd/scripts/wireinterop` cross-runtime check.

## Local IPC (agent → daemon)

- Socket: `/run/statskey-fleetd/control.sock`, owned `root:statskey-fleet`,
  mode `0660`, created by `statskey-fleetd.socket` (socket activation).
- Peer auth: `SO_PEERCRED`; peer UID must equal the `statskey-fleet` service
  user. One request per connection. Frames: 4-byte big-endian length prefix,
  canonical JSON body, maximum 64 KiB.
- Methods: `attest`, `start`, `renew`, `stop`, `status`, `settle`,
  `publicKey`. `stop` is always accepted (it only reduces authority).
- Every request and response is length-bounded and fully parsed before any
  side effect.

## Execution flow

1. Agent obtains a coordinator challenge (`helper.challenge`), asks the
   daemon to sign it (`attest`), and submits it (`helper.attest`). The
   coordinator stores a verified attestation bound to device, boot, build,
   policy, and expiry.
2. Agent polls. Linux devices are eligible only with a fresh accepted
   attestation. `job.claim` returns the lease plus an `ExecutionTicketV1`.
3. Agent calls `start(ticket)`. The daemon verifies the coordinator
   signature, key pin, expiry, attempt/lease binding, profile IDs, and
   policy epoch; journals the ticket (fsync); then starts a transient
   systemd unit via D-Bus.
4. The unit runs `/usr/libexec/statskey-fleet-runner` as a `DynamicUser`.
   The request file never touches a job-readable path: the unit carries
   `LoadCredential=fleet-request:<root-owned journal path>`, so systemd
   copies it as root into the unit's read-only credentials tmpfs before the
   runner starts, and the runner reads `$CREDENTIALS_DIRECTORY/fleet-request`
   (argv sentinel `@fleet-request`). The runner then materializes the Git
   snapshot (exact commit, hooks/config/credentials disabled) and `exec`s
   the resolved command. All of this happens inside the unit's cgroup and
   sandbox.
5. The daemon owns the lease timer. Renewal updates the `CLOCK_BOOTTIME`
   deadline. Expiry, cancellation, daemon restart, or watchdog failure stops
   the unit (`systemctl stop`, `KillMode=control-group`).
6. After stop, the daemon waits for `cgroup.events populated 0`, then signs
   a termination receipt. Only then may the agent report a terminal state or
   request retry, and only then is the workspace removed.

## Job unit properties (minimum)

```
Type=exec
DynamicUser=yes
LoadCredential=fleet-request:<root-owned journal request path>
Delegate=no
KillMode=control-group
SendSIGKILL=yes
TimeoutStopSec=30
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes      # lifted only by a signed profile that needs it
RestrictNamespaces=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
DevicePolicy=closed
TasksMax=<ticket.pids>
MemoryMax=<ticket.memoryBytes>
MemorySwapMax=0
CPUQuota=<ticket.cpuMilli/10 %>  CPUWeight=100
IOWeight=100
RuntimeMaxSec=<ticket.wallTime>
ReadWritePaths=<opaque job workspace only>
StateDirectory=statskey-fleet-jobs/<ticketId>
NetworkNamespacePath=<none by default; network jobs need a signed profile>
AppArmorProfile=statskey-fleet-job
BindsTo=statskey-fleetd.service
StandardOutput=append:<root-owned log>
StandardError=append:<root-owned log>
```

## Directories and ownership

```
/usr/libexec/statskey-fleetd          root:root 0755 (daemon, runner binaries)
/usr/libexec/statskey-fleet-agent     root:root 0755
/etc/statskey/fleetd/                 root:root 0755
  coordinator-keys.json               root:root 0644  (pinned coordinator SPKI + key ids)
  policy.json                         root:root 0644  (host ceilings, profile registry, policy epoch)
/var/lib/statskey-fleetd/             root:root 0700
  helper.key                          root:root 0600  (Ed25519; TPM sealing later)
  helper.pub                          root:root 0644
  instance-id                         root:root 0644
  jobs/<ticketId>/request.json        root:root 0644  (journal, fsync + rename)
  jobs/<ticketId>/receipts/           root:root 0755
/var/lib/statskey-fleet/              statskey-fleet:statskey-fleet 0700 (agent state, device key)
/var/lib/statskey-fleet-jobs/         root:root 0751 (per-job opaque dirs created by daemon)
/run/statskey-fleetd/                 root:statskey-fleet 0750 (socket)
```

The daemon always pre-creates `/var/lib/statskey-fleet-jobs/<ticketId>` as a
real root-owned directory before starting the unit, so systemd's
`StateDirectory` uses the existing directory (chowning it to the dynamic
user for the unit's lifetime) and never takes its `/var/lib/private` symlink
path. Job workspaces must not be created by any other component.

## systemd units

- `statskey-fleetd.socket` — `ListenStream=/run/statskey-fleetd/control.sock`,
  `SocketUser=root`, `SocketGroup=statskey-fleet`, `SocketMode=0660`.
- `statskey-fleetd.service` — socket-activated, `NoNewPrivileges`,
  `ProtectSystem=strict` with `ReadWritePaths=/var/lib/statskey-fleetd
  /var/lib/statskey-fleet-jobs`, private network (`PrivateNetwork=yes`),
  restricted address families `AF_UNIX AF_NETLINK`, watchdog.
- `statskey-fleet-agent.service` — `User=statskey-fleet`,
  `After=statskey-fleetd.socket network-online.target`, hardened like the job
  units minus DynamicUser, `ReadWritePaths=/var/lib/statskey-fleet`.

## sysusers.d / tmpfiles.d

```
# sysusers.d/statskey-fleet.conf
u statskey-fleet - "StatsKey Fleet agent" /var/lib/statskey-fleet /usr/sbin/nologin

# tmpfiles.d/statskey-fleet.conf
d /var/lib/statskey-fleet 0700 statskey-fleet statskey-fleet -
d /var/lib/statskey-fleetd 0700 root root -
d /var/lib/statskey-fleet-jobs 0751 root root -
d /run/statskey-fleetd 0750 root statskey-fleet -
```

## Coordinator changes (protocol v2)

- `helper.bind` (device-signed): binds a helper public key, execution service
  ID, build IDs, and policy epoch to an enrolled Linux device. Replay-fenced.
- `helper.challenge` (device-signed): returns a single-use challenge.
- `helper.attest` (device-signed envelope carrying the helper-signed
  attestation): verifies challenge, helper signature, binding, build/policy
  allowlists; stores a verified attestation with expiry.
- `job.claim` on Linux requires a fresh accepted attestation and returns the
  execution ticket signed by the coordinator response key.
- `lease.renew` on Linux returns a signed `LeaseUpdateV1`.
- Retry of any attempt with a start receipt requires a valid termination
  receipt (replaces worker-reported `terminationConfirmed` for Linux).
- Grant v2 adds `executionServiceId`, `executorProfileIds`,
  `sandboxProfileIds`, `networkProfileIds`, `resourceCeilings`,
  `minimumHelperProtocol`, `minimumPolicyEpoch`.

## Build and packaging

- Go module `statskey/fleetd`, Go 1.26, `CGO_ENABLED=0`, `-trimpath`,
  `-buildvcs=false`, pinned `-ldflags '-X build.id=...'`. Reproducible:
  same source + toolchain must produce identical `helperBuildId` /
  `runnerBuildId` (SHA-256 of the binary).
- Target: `linux/amd64` only.
- DEB `statskey-fleetd` ships binaries, units, sysusers/tmpfiles, AppArmor
  profile, coordinator key ring, and policy. `postinst` runs
  `systemd-sysusers`, `systemd-tmpfiles --create`, `apparmor_parser`, and
  `daemon-reload`; it does not enable or start services. Services stay
  dormant until pairing and attestation succeed.
- Upgrades stop and drain every job cgroup before binary replacement, then
  re-attest.

## Native acceptance gate (before any Linux claim is enabled)

- setsid/double-fork/daemonize/orphan/fork-during-kill escape tests.
- PID-reuse safety; unrelated processes untouched.
- cgroup migration/namespace/mount/systemd-run/system-bus denial.
- `cgroup.kill` then mandatory `populated 0`; uninterruptible remnant →
  quarantine and no new work.
- Memory OOM, swap refusal, PID exhaustion, CPU throttle, IO cap, disk quota,
  wall-time enforcement.
- Host file/keyring/socket/workspace isolation tests.
- Symlink/FIFO/socket/device/hardlink/rename races in checkout and output
  collection.
- Clock jumps, suspend past TTL, coordinator outage, revocation, stale
  renewal, downgrade, replay across reboot.
- AppArmor profile enforcing with exact digest; `unconfined` fails closed.
