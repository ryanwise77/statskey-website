# Fleet control-plane schema

Status: implementation contract  
Database boundary: Workbench operational database  
Access: server only; browser and worker clients never access Firestore directly  
Protocol version: 1  
Last verified: 2026-08-19

## Purpose

This schema stores orchestration metadata for StatsKey Fleet and Jobs. It does
not store nutrition, fitness, health, billing, or model-provider credentials.
It is designed so the same logical records can run in the current Workbench
database or a Windows-hosted coordinator through a storage adapter.

The source of authority for every mutation is one of:

- an authenticated StatsKey owner request;
- a verified enrolled-controller signature;
- a verified enrolled-device Ed25519 signature plus a current job lease;
- a coordinator maintenance task with an audit receipt.

Network location is never authority.

## Implemented account API

The authenticated Workbench API currently exposes:

- `fleetBootstrapDevice`
- `fleetRecoverController`
- `fleetPairDevice`
- `fleetCreateLocalGrant`
- `fleetCreateJob`
- `fleetGetJob`
- `fleetGetCoordinatorTrust`
- `fleetCreateArtifactDownload`
- `fleetListJobs`
- `fleetCancelJob`
- `fleetRecoverJob`
- `fleetListDevices`
- `fleetListGrants`
- `fleetRevokeDevice`
- `fleetRevokeGrant`
- `fleetListJobEvents`
- `fleetRemoteSessionRequest`
- `fleetRemoteSessionApprove`
- `fleetRemoteSessionEnd`
- `fleetRemoteSessionList`

Every read is owner-scoped in the service. Public device views omit key
fingerprints. Public event views omit lease IDs and payload digests. Grant
creation remains proof-bound; listing and revocation are owner-authenticated
account actions. Controller recovery additionally requires an account
authentication time no more than ten minutes old, an explicit Firebase token
revocation check, and proof of possession for the replacement key.
StatsKey Desktop can explicitly discard an accessible but compromised local
controller key and stage a new unenrolled key before invoking this API; the old
key is never required to sign recovery.

Because StatsKey Auth and Workbench are separate Google Cloud projects, the
Workbench Functions runtime service account must receive only the cross-project
Firebase Auth user-read permission needed by `verifyIdToken(..., true)`.
Controller bootstrap/recovery and owner revocation deliberately fail closed
until that IAM grant is installed and tested with a revoked token.
Every account-authenticated Fleet action additionally requires the boolean
StatsKey Auth custom claim `statskey_fleet: true`; ordinary authenticated
accounts have no Fleet storage or execution entitlement.

Coordinator response signing also fails closed until
`FLEET_RESPONSE_SIGNING_KEY_ID` and `FLEET_RESPONSE_SIGNING_PUBLIC_KEY` are set
and the matching base64url PKCS#8 DER private key is installed as the
`FLEET_RESPONSE_SIGNING_KEY` Firebase secret. The service verifies that the
private key derives the configured public pin before signing. Key rotation
must not change these values in place: enrolled nodes currently hold one pin.
Ship and verify an overlapping-trust client/server migration first, or use a
maintenance window and the Fleet UI's account-authenticated **Refresh trust
pin** action on every node. Old-pinned nodes pause until that manual
reactivation succeeds.

The separate `workbenchDeviceApi` accepts only short-lived Ed25519-signed
requests for `device.status`, `heartbeat`, `job.poll`, `job.claim`,
`lease.renew`, `job.event`, `job.transition`, `artifact.reserve`,
`artifact.commit`, `remote-session.poll`, `remote-session.approve`,
`remote-session.activate`, and `remote-session.end`.
Each signature binds the protocol version, derived device ID, action, payload
digest, issue/expiry times, and a one-time request ID. It does not accept a
bearer credential or browser CORS access. Every successful response is
Ed25519-signed over a domain-separated digest of the result plus the exact
device, action, request ID, key ID, and short validity window. Enrollment loads
the coordinator public key through the account-authenticated API, verifies the
first signed `device.status` response, and persists that pin in OS-protected
identity storage. The desktop rejects unsigned, expired, tampered, wrong-key,
or wrong-request responses.

Worker polling filters revoked and expired grants in the indexed query and uses
bounded cursor pagination across queued jobs. It also caps dependency document
reads per request and returns a signed-request cursor to the worker when either
budget is reached. This prevents a large ineligible queue head or dependency
fan-out from making one request unbounded or permanently hiding later runnable
work.

The `workbenchFleetSweep` scheduled function runs once per minute with one
instance. Each round queries only indexed, unreleased expired leases and queued
jobs whose deadlines have passed, recovers at most 100 of each, and performs at
most five rounds. The same transactional `recoverJob` invariant handles races
with a late renewal, owner cancellation, or another recovery attempt.

Deployment remains an explicit operator step: deploy the lease, queued-job,
and incomplete-artifact sweep indexes before enabling the scheduled function.
Source and tests do not imply that the production scheduler is active. Follow
`FLEET_DEPLOYMENT_RUNBOOK.md`; function deployment alone is insufficient.

## Collections

### `fleetOwners/{ownerUidHash}`

Minimal trust-root metadata. The initial controller can be created only once,
using an authenticated StatsKey account request plus proof of possession for
the submitted Ed25519 key.

```text
schemaVersion: 1
ownerUid: string
bootstrapDeviceId: string
previousBootstrapDeviceId: string | null
trustedDeviceCount: integer
fleetArtifactCount: integer
fleetArtifactBytes: integer
bootstrapProofReplayId: sha256 hex
recoveryGeneration: integer
recoveredAt: timestamp | null
recoveryProofReplayId: sha256 hex | null
createdAt: timestamp
updatedAt: timestamp
```

Artifact reservation atomically caps each owner at 256 retained/incomplete
manifests and 20 GiB. Cleanup decrements these counters only for manifests
created under the quota contract.

### `fleetDevices/{deviceId}`

Durable enrollment plus current worker telemetry.

```text
schemaVersion: 1
id: dev_<32 lowercase hex>
ownerUid: string
label: string
role: controller | worker | hybrid
workerMode: dedicated | opt-in | disabled
platform: darwin | win32 | linux | ios | android
status: active | revoked
publicKeyFingerprint: sha256:<base64url>
publicKeySpki: canonical Ed25519 SPKI DER encoded as base64url
maxConcurrentJobs: integer

capabilities: string[]
executables: string[]          # detected, locally allowlisted command names
resources:
  cpuLogical: number
  cpuAvailable: number
  memoryBytes: number
  memoryAvailableBytes: number
  diskAvailableBytes: number
  gpuCount: number
activeJobs: integer
activeLeaseIds: string[]       # coordinator-owned restart recovery index
reportedActiveJobs: integer
connection: direct | relay | offline
protocolMinimum: integer
protocolMaximum: integer
softwareVersion: string
lastSeenAt: timestamp | null
revokedAt: timestamp | null
replacesDeviceId: string | null
replacedByDeviceId: string | null
createdAt: timestamp
updatedAt: timestamp
```

Enrollment fields are writable only through the pairing service. A heartbeat
may update only capabilities, detected allowlisted executables, resources, the
informational
`reportedActiveJobs`, connection, protocol/software versions, `lastSeenAt`,
and `updatedAt`. The coordinator alone changes the authoritative `activeJobs`
counter and bounded `activeLeaseIds` restart-recovery index while leasing or
releasing work. A heartbeat cannot enroll, unrevoke, change role, change worker
mode, or replace the public key.

Protocol v1 has no coordinator-verifiable Linux execution-service
attestation. The coordinator therefore preserves Ubuntu controller presence
and resource telemetry but stores and returns empty Linux `capabilities` and
`executables`. Polling and direct claim add
`execution-attestation-missing`, and an existing Linux lease cannot renew.
This server-side fence prevents a custom client from bypassing the official
desktop's Linux worker gate. It must not be relaxed based on a heartbeat field;
a future protocol version must verify separately signed service attestation.

The implemented pairing receipt is signed independently by the candidate key
(`pairing.candidate`) and an already trusted controller
(`pairing.approve`), then submitted through the authenticated account API. The
receipt binds a controller-generated 256-bit challenge, candidate metadata,
role, worker mode, workspace IDs, capabilities, unattended policy, policy
version, and grant expiry. Both one-time proof IDs are consumed in the same
transaction that creates the device and grant.

Two candidate classes are accepted. A `worker` with `dedicated` worker mode
creates the device and its bounded capability grant atomically. A `hybrid`
with `disabled` worker mode is a controller-only device (for example a phone):
it must carry empty workspace/repository/capability scope and
`unattended: false`, and pairing creates no grant. It can authorize jobs with
its device key but is never eligible to execute them.

Revocation is permanent for that device ID. The owner-authenticated recovery
transaction atomically revokes the previous bootstrap controller, installs a
new proof-bound controller key and device ID, and moves the owner trust root.
Every grant is checked against its issuing controller's live enrollment at
poll, claim, renewal, event, and transition time. Recovery therefore stops old
grants from authorizing new output or extending leases without an unbounded
grant rewrite.

### `fleetDeviceRequests/{deviceAndRequestHash}`

Replay fence for the signed device API.

```text
schemaVersion: 1
ownerUid: string
deviceId: string
requestId: req_<32 lowercase hex>
action: device.status | heartbeat | job.poll | job.claim | lease.renew |
        job.event | job.transition | artifact.reserve | artifact.commit |
        controller.recover | helper.bind | helper.challenge | helper.attest
issuedAt: timestamp
expiresAt: timestamp
consumedAt: timestamp
```

The signature and device rate limit are verified before this row is created.
The row is then created transactionally before the action executes, so
concurrent reuse of one request ID cannot run twice. Account-authenticated
controller recovery also consumes its replacement-key proof here in the same
transaction that moves the trust root. Rate-limited attempts do not consume
replay storage. Signatures and payloads are not stored here.
`firestore.indexes.json` enables Firestore TTL on `expiresAt`; delayed TTL
deletion remains safe because retaining a replay fence longer only rejects
reuse. The same deployment config expires the account/device rate-limit
buckets that protect these APIs.

### `fleetHelperBindings/{deviceId}`

Owner-device binding of a privileged Linux helper identity, written only by
the device-signed `helper.bind` action on an active Linux device.

```text
schemaVersion: 1
ownerUid: string
deviceId: string
helperPublicKeySpki: canonical Ed25519 SPKI DER base64url
helperKeyId: sha256:<base64url>
executionServiceId: svc_<32 lowercase hex>
helperBuildId: sha256:<64 lowercase hex>
runnerBuildId: sha256:<64 lowercase hex>
policyEpoch: integer
boundAt: timestamp
updatedAt: timestamp
```

Rebinding requires the same device key and atomically deletes the device's
current attestation, so receipts and attestations from a pre-rebind helper
fail closed.

### `fleetHelperChallenges/{challengeId}`

Single-use attestation challenge from `helper.challenge`.

```text
schemaVersion: 1
id: chal_<32 lowercase hex>
ownerUid: string
deviceId: string
nonceHash: sha256 hex
createdAt: timestamp
expiresAt: timestamp            # 2 minutes; TTL-enabled
consumedAt: timestamp | null
```

The raw nonce is returned once and never stored. `helper.attest` consumes the
challenge in the same transaction that stores the verified attestation.

### `fleetHelperAttestations/{deviceId}`

The device's current coordinator-verified helper attestation. Linux execution
authority derives only from a fresh row here — never from heartbeat telemetry.

```text
schemaVersion: 1
ownerUid: string
deviceId: string
executionServiceId: string
helperInstanceId: hi_<32 lowercase hex>
bootIdDigest: sha256:<base64url>
helperProtocol: integer
helperBuildId: sha256:<64 lowercase hex>
runnerBuildId: sha256:<64 lowercase hex>
policyEpoch: integer
platform: {id, versionId, arch, kernelRelease, cgroupVersion, systemdVersion}
security: {cgroupKill, delegated, apparmorEnforcing, apparmorProfileDigest}
helperKeyId: sha256:<base64url>
attestationDigest: sha256 hex
issuedAt: timestamp
expiresAt: timestamp            # <= 10 minutes from acceptance
acceptedAt: timestamp
```

Only attestations matching the current binding, the Ubuntu 26.04 x86_64
cgroup-v2 non-delegated AppArmor-enforcing profile, and a sufficient policy
epoch are accepted. Poll, claim, renewal, events, and artifact operations for
Linux devices all require this row to be present and unexpired; Linux claims
additionally return a coordinator-signed `ExecutionTicketV1`, Linux renewals
return a signed `LeaseUpdateV1` with a strictly increasing `leaseSequence`
stored on the lease, and Linux retries require a helper-signed
`TerminationReceiptV1` bound to the lease ticket with `populated: false`.

### `fleetPairingSessions/{pairingId}`

Short-lived proof-of-possession challenge.

```text
schemaVersion: 1
ownerUid: string
initiatingControllerDeviceId: string
challengeHash: string
requestedRole: controller | worker | hybrid
requestedWorkerMode: dedicated | opt-in | disabled
candidatePublicKey: string
candidateFingerprint: string
displayCodeHash: string
state: pending | approved | consumed | expired
approvedReceiptDigest: string | null
expiresAt: timestamp
consumedAt: timestamp | null
createdAt: timestamp
updatedAt: timestamp
```

The QR/display code contains a random challenge and rendezvous location, not a
credential. Completion requires an authenticated account, candidate-key proof,
and an already enrolled controller signature. Pairing IDs and challenges are
single-use. TTL cleanup may remove terminal rows after seven days.

### `fleetGrants/{grantId}`

Signed authorization from a controller to a worker.

```text
schemaVersion: 1
ownerUid: string
receipt:
  schemaVersion: 1
  id: grant_<32 lowercase hex>
  ownerUid: string
  controllerDeviceId: string
  workerDeviceId: string
  workspaceIds: string[]       # exact IDs or "*"
  repositoryIdentities: string[] # canonical host/owner/repository identities
  capabilities: string[]
  unattended: boolean
  policyVersion: 1
  issuedAt: timestamp
  expiresAt: timestamp
receiptDigest: sha256 hex
controllerProofDigest: sha256 hex
candidateProofDigest: sha256 hex
revokedAt: timestamp | null
createdAt: timestamp
updatedAt: timestamp
```

Capabilities are an allowlist, not arbitrary strings. Advertised device
support and a grant are both required. The first implementation stores the
receipt digest; accepting remote execution additionally requires signature
verification by the pairing/controller service.

Revocation is monotonic. Expired or revoked grants never authorize new leases.
An already running lease follows its own short expiration and stops renewing.

### `fleetJobs/{jobId}`

Immutable task envelope plus coordinator-owned lifecycle summary.

```text
schemaVersion: 1
ownerUid: string
authorizedByControllerDeviceId: string
workspaceId: string
type: agent | command | xcode-build | xcode-test | xcode-archive |
      windows-build | reconcile | service | remote-session
objective: string
workspaceSnapshot:
  kind: git
  repository: string          # HTTPS/SSH remote identity only
  repositoryIdentity: string  # canonical host/owner/repository authority
  commit: string
  submodules: false
  snapshotId: string
requiredCapabilities: string[]
target:
  deviceIds: string[]
  platforms: string[]
  allowControllerAsWorker: boolean
  preferDirect: boolean
resources:
  cpuLogical: number
  memoryBytes: number
  diskAvailableBytes: number
  gpuCount: number
exclusiveResources: string[]
dependencies: jobId[]
deadlineAt: timestamp
maxAttempts: integer
approvalPolicy: review | auto | independent | custom
reconciliationPolicy: lead | manual | best-of-n | adaptive
cage: object                 # disabled by default; strictly bounded fields

requestDigest: sha256 hex
state: queued | leased | preparing | running | needs_review | waiting |
       succeeded | failed | cancelled | timed_out
attempt: integer
eventSequence: integer
artifactIds: string[]               # bounded durable discovery index
artifactReservationAttempt: integer # server-only quota epoch
artifactReservationCount: integer   # server-only, max 16 per attempt
artifactBytesReserved: integer      # server-only, max 8 GiB per attempt
assignedDeviceId: string | null
activeLeaseId: string | null        # server-only; omitted from public views
revision: integer
cancellationRequestedAt: timestamp | null
lastFailure:
  code: string
  retryable: boolean
  terminationConfirmed: boolean
  attempt: integer
  at: timestamp
lastTransition:                       # server-only idempotency fence
  id: op_<32 lowercase hex>
  state: string
  leaseId: string
  attempt: integer
  requestDigest: sha256 hex
  result: object                      # exact bounded public result replay
finishedAt: timestamp | null
createdAt: timestamp
updatedAt: timestamp
```

`jobId` is deterministically derived from owner UID plus the caller's bounded
idempotency key. The key itself is not stored. Reusing a key with an identical
normalized request returns the existing job. Reusing it with different work
fails with conflict.

Job state, assignment, sequence, attempt, and revision are coordinator-owned.
Terminal states are immutable. Cancellation is a monotonic request until the
worker acknowledges a terminal state. A worker may requeue `preparing` or
`running` work only through a signed transition that asserts a bounded
retryable code and confirmed process-tree termination. The transaction releases
the current lease, exclusive locks, and capacity before a later claim increments
the attempt. Lease recovery never automatically requeues work that had reached
`running`; an expired running attempt is recorded as an ambiguous terminal
failure.

A transition operation ID is bound to owner, worker, job, lease, attempt,
target state, and retry metadata. An exact replay returns the original stored
result even if a later attempt has already started; changing any bound field
conflicts instead of acknowledging the current job state.

#### `fleetJobs/{jobId}/events/{sequence}`

Append-only worker evidence.

```text
schemaVersion: 1
ownerUid: string
jobId: string
deviceId: string
grantId: string
attempt: integer
sequence: integer
type: accepted | preparation | process-start | process-exit | log | test |
      artifact | approval-requested | approval-resolved | budget |
      checkpoint | result | failure | cancellation-acknowledged
payload: bounded JSON
payloadDigest: sha256 hex
leaseId: string
occurredAt: timestamp
```

The document ID is the zero-padded sequence. An exact replay is idempotent.
Different content at the same sequence conflicts. The writer must hold the
current lease nonce for the current job attempt.

Payloads reject credential-like keys, common token shapes, non-finite numbers,
unsupported values, excessive depth/fields, and payloads over 64 KiB. The node
must also redact stdout/stderr before upload.

### `fleetLeases/{leaseId}`

Short-lived execution authority.

```text
schemaVersion: 1
id: lease_<32 lowercase hex>
ownerUid: string
jobId: string
deviceId: string
attempt: integer
nonceHash: sha256 hex
resourceKeys: string[]
issuedAt: timestamp
heartbeatAt: timestamp
expiresAt: timestamp
releasedAt: timestamp | null
```

The raw nonce is returned once through the authenticated control transport and
is never persisted. Lease TTL is 15-120 seconds, 45 seconds by default. A
worker stops after renewal failure plus a bounded local grace period.

Stale leases cannot emit events, change job state, renew resources, or publish
artifacts. Released leases cannot be revived.

An expired attempt in `preparing`, `running`, `waiting`, or `needs_review` is
execution-ambiguous and fails rather than requeueing: preparation may already
have launched Git or another native process. Protocol v1's worker-reported
`terminationConfirmed` retry is retained only for current non-Linux
development workers. Linux leases cannot enter an execution state, self-confirm
a retry, renew, publish events, or reserve/commit artifacts. Future unattended
Linux retries require a helper-signed termination receipt proving the job
cgroup is empty.

### `fleetResourceLeases/{ownerAndResourceHash}`

Exclusive machine or workspace resource lock.

```text
schemaVersion: 1
ownerUid: string
resourceKey: string
leaseId: string
jobId: string
deviceId: string
expiresAt: timestamp
releasedAt: timestamp | null
updatedAt: timestamp
```

Examples:

- `workspace:statskey-website:write`
- `xcode:simulator-lane-1`
- `derived-data:<snapshotId>:lane-1`
- `port:windows-server:443`
- `gpu:windows-server:0`

Acquiring a job lease transactionally checks and writes every exclusive
resource. An expired/released lock may be replaced. Renewal and release compare
the owning lease ID so a stale job cannot modify a successor's lock.

### `fleetArtifacts/{artifactId}`

Small manifest only. Bytes live in content-addressed object storage.

```text
schemaVersion: 1
ownerUid: string
jobId: string
attempt: integer
deviceId: string
kind: snapshot | patch | commit | log | test-result | xcresult | build |
      screenshot | release
contentHash: worker-reported sha256 hex
objectKey: opaque string
sizeBytes: number
mediaType: string
contentMd5: base64
state: uploading | ready | deleting
leaseId: string
generation: string | null
encryption:
  mode: owner-envelope | service
  keyVersion: string
createdAt: timestamp
uploadExpiresAt: timestamp
committedAt: timestamp | null
expiresAt: timestamp | null
cleanupStartedAt: timestamp | null
cleanupPreviousState: uploading | ready | null
cleanupToken: opaque string | null
```

The implemented coordinator issues 30-minute, single-object V4 upload grants
for artifacts no larger than 1 GiB.
The object key is derived server-side from a hash of the owner, the job, the
artifact ID, and its SHA-256; a worker cannot choose a bucket key. The signed
request pins content length, MD5, media type, artifact ID, worker-reported
SHA-256 metadata, and `x-goog-if-generation-match: 0`. Commit rechecks the
current lease, device, grant, job attempt, object metadata, GCS-computed MD5,
and immutable GCS generation
before moving the manifest from `uploading` to `ready`. Owner-authenticated
downloads are five-minute grants pinned to that committed generation and
capped by the artifact retention deadline; downloads fail closed once less
than five minutes of retention remains. Cleanup
waits through a bounded grace period after upload-grant expiry before deleting
an incomplete object and manifest, while the worker aborts an in-flight transfer
at that expiry. A just-expired signed URL therefore cannot race the sweeper and
recreate an untracked object. A five-minute deletion lease makes `deleting`
manifests reclaimable after a crash, and committed evidence expires after 30
days unless a later owner policy explicitly shortens it. Legacy ready
manifests without an expiration are unavailable for download and are reclaimed
by the same bounded sweep. A one-time
`fleetMaintenance/artifactRetentionBackfill` cursor scans ready manifests by
document ID so omitted fields are found without an unbounded collection read;
explicit `null` values remain covered by the normal retention query. Commit
also links the artifact ID into
the job transactionally, so evidence remains discoverable if the worker exits
before its separate timeline event is acknowledged. Reservation counters cap
each attempt at 16 manifests and 8 GiB total, including abandoned reservations,
so a compromised enrolled worker cannot turn one lease into unbounded storage
grants.

Set `FLEET_ARTIFACT_BUCKET` to a dedicated Workbench evidence bucket colocated
with `nam5`, with uniform bucket-level access, lifecycle retention, and no
dependency on the separate StatsKey health-data bucket. The three explicitly
pinned runtime service accounts need only their documented API, device-upload,
or sweep permissions; the account and device APIs also need V4 URL-signing
permission. No bucket is provisioned or deployed by this repository change; if
the parameter is blank, artifact reservation fails closed and jobs that require
retained evidence cannot complete publication.

### `fleetRemoteSessions/{sessionId}`

Short-lived authorization to open a native screen tunnel.

```text
schemaVersion: 1
ownerUid: string
controllerDeviceId: string
workerDeviceId: string
capabilities: [screen.view] | [screen.view, screen.input]
transport: relay                 # v1: relay only; direct fails closed
protocol: statskey.screen.v1     # first-party wire protocol (not rdp/vnc)
controllerEphemeralKey: string   # per-session Ed25519 SPKI base64url
workerEphemeralKey: string | null
sessionKey: string               # server-issued 256-bit AES key, base64url
relayEndpoint: string            # host:port from FLEET_REMOTE_RELAY
state: requested | approved | active | ended | expired
approvalReceiptDigest: string | null
expiresAt: timestamp             # request + 10 minutes (handshake window)
startedAt: timestamp | null
endedAt: timestamp | null
createdAt: timestamp
updatedAt: timestamp
```

The relay sees opaque encrypted frames. It cannot mint a session or expand
view-only into input. Default audit records session metadata, not video.

The session key is generated by the control plane at request time and leaves
the server only over authenticated channels: to the controller in the
account-API request/list responses, and to the worker in device-API
poll/approve responses once the session is approved or active. The relay
receives only its SHA-256 from each endpoint and compares the hashes. A
session is approved when the owner approves through the account API, or when
the worker device signs `remote-session.approve` while holding an active
grant from the session controller covering the requested capabilities;
without such a grant the session stays pending. `screen.input` requires a
Windows host in v1. The collection is disabled fail-closed when
`FLEET_REMOTE_RELAY` is unset. Remote session metadata is retained 90 days
by default (see Retention).

### `fleetAuditReceipts/{receiptId}`

Append-only security and ownership evidence.

```text
schemaVersion: 1
ownerUid: string
actor:
  kind: user | controller | worker | coordinator
  id: string
action: string
target:
  kind: string
  id: string
requestDigest: sha256 hex
policyVersion: integer
outcome: allowed | denied | cancelled | failed
reasonCodes: string[]
previousReceiptHash: sha256 hex | null
receiptHash: sha256 hex
createdAt: timestamp
```

Receipts never store prompts, file content, credentials, or raw logs.

## Indexes

Implemented in `firestore.indexes.json` for the account list endpoints:

- `fleetJobs`: `ownerUid ASC, updatedAt DESC`
- `fleetJobs`: `ownerUid ASC, state ASC, updatedAt DESC`
- `fleetJobs`: `ownerUid ASC, state ASC, createdAt ASC`
- `fleetDevices`: `ownerUid ASC, updatedAt DESC`
- `fleetGrants`: `ownerUid ASC, receipt.workerDeviceId ASC,
  revokedAt ASC, receipt.expiresAt DESC`
- `fleetGrants`: `ownerUid ASC, receipt.expiresAt DESC`
- `fleetLeases`: `releasedAt ASC, expiresAt ASC`
- `fleetJobs`: `state ASC, deadlineAt ASC`
- `fleetArtifacts`: `state ASC, uploadExpiresAt ASC`
- `fleetArtifacts`: `state ASC, expiresAt ASC`
- `fleetArtifacts`: `state ASC, cleanupStartedAt ASC`
- `fleetRemoteSessions`: `ownerUid ASC, updatedAt DESC`
- `events`: `sequence ASC`

Create with the corresponding future list endpoints:

- `fleetArtifacts`: `ownerUid ASC, jobId ASC, createdAt DESC`
- `fleetAuditReceipts`: `ownerUid ASC, createdAt DESC`

All twelve are explicit dense indexes because the Workbench database is Firestore
Enterprise Native mode, which does not create automatic single-field indexes.
The generic `events` collection-group index supports the ordered query inside
an already owner-verified job subcollection.

## Transaction invariants

1. Create job: verify an active controller's payload-bound authorization,
   derive a deterministic ID, compare the request digest, and write once.
2. Consume device request: verify the key-bound signature and time window, then
   atomically reject or record its one-time request ID before execution.
3. Recover controller: require recent account authentication and replacement
   key proof; read owner, old/new devices, and replay fence, then atomically
   revoke the old key, install the new controller, move the owner trust root,
   and consume the proof.
4. Lease job: read job/device/grant/issuing controller/all resource locks,
   validate, then atomically write job assignment, lease, resource locks, and
   worker active count.
5. Renew lease: validate nonce hash, expiry, active device identity, the
   still-current grant recorded on the lease, and its active issuing
   controller; read owned resource locks, then atomically extend all matching
   expirations. Grant or controller revocation and grant expiry stop the next
   renewal, and neither the lease nor resource locks may extend beyond the job
   deadline. A cancellation acknowledgement never extends the existing lease.
6. Recover job: require an expired or released matching lease, release worker
   and resource capacity once, remove its active lease reference, then requeue
   or enter a terminal state; worker polling first reconciles its bounded active
   lease references so a process restart cannot strand capacity. Queued jobs
   also expire deadlines and terminal dependency failures transactionally.
7. Append event: validate current lease, attempt, active device, current grant
   and issuing controller, and absence of cancellation; check exact replay,
   require next sequence, then atomically write event and advance job
   sequence/revision.
8. Retry or terminal transition: validate state, lease, device, grant, and issuing
   controller, while still allowing failed/cancelled/timed-out cleanup after
   authority loss; read resource locks, then atomically requeue only a
   termination-confirmed retry or finish the job, release lease/locks, and
   decrement active worker load.
9. Cancellation: owner and optional revision check; finish an unleased queued
   job immediately, otherwise set one monotonic cancellation timestamp.
10. Revoke grant/device: owner check, monotonic revocation timestamp, and no
    operation may reactivate the same key or grant. The bootstrap controller
    can only be revoked by the atomic recovery operation.
11. Publish artifact: reserve only under the current lease/grant/job attempt;
    verify storage checksums and generation before atomically marking ready.
    The scheduled sweeper first fences an expired incomplete upload as
    `deleting`, removes its object, then deletes its manifest so commit and
    cleanup cannot race.

All reads happen before writes inside Firestore transactions so the same
invariants remain portable to serializable SQL transactions.

## Retention

- presence telemetry: overwrite current device document;
- pairing sessions: delete seven days after terminal state;
- consumed device request IDs: Firestore TTL is configured on `expiresAt`
  (seven-day audit retention requires a separate bounded archive because
  request signatures themselves expire within minutes);
- leases/resource locks: retain 30 days for incident reconstruction, then
  export receipt and delete;
- high-volume log events: compact to encrypted log artifacts after 30 days;
- test/result/checkpoint events: retain with the job for one year by default;
- failed/cancelled jobs: one year unless user shortens retention;
- audit receipts: minimum one year, configurable upward;
- remote session metadata: 90 days by default;
- workspace snapshots and build artifacts: explicit owner policy plus
  object-store lifecycle.

## Migration and portability

The persistence adapter must expose serializable:

- get document;
- create/replace document;
- compare-and-set transaction;
- ordered owner-scoped list;
- append event;
- TTL cleanup.

Firestore field names and document paths are implementation details. Protocol
records use stable IDs, versions, state names, and digests so the Windows
coordinator can map them to PostgreSQL or another durable store without
changing node/controller behavior.
