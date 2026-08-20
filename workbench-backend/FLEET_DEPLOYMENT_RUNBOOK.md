# Fleet deployment runbook

Fleet is fail-closed by design. Do not deploy the device API or scheduler until
every prerequisite below is ready. Run commands from `workbench-backend/` and
keep `--project statskey-workbench` explicit.

## Observed state on 2026-08-19 (post-deployment)

- `projects/statskey-workbench/databases/workbench` is Firestore Enterprise,
  Native mode, in `nam5`, with delete protection and 7-day point-in-time
  recovery enabled.
- All twelve Fleet indexes are READY; TTL is ACTIVE on
  `fleetDeviceRequests.expiresAt` and `rateLimits.expiresAt`.
- `workbenchApi`, `workbenchDeviceApi`, and `workbenchFleetSweep` are deployed
  (Gen 2, Node 22, `us-central1`), each pinned to its dedicated service
  account. The sweep runs every minute through Cloud Scheduler.
- `gs://statskey-fleet-artifacts` exists in `us-central1` with uniform
  bucket-level access, enforced public access prevention, and a 35-day
  lifecycle delete rule. Bucket-scoped custom roles grant the account API
  probe/read/download, the device API create/read, and the sweep delete-only.
- `FLEET_RESPONSE_SIGNING_KEY` version 1 exists in Secret Manager; the public
  key and key id `fleet-2026-08-19-01` are in `functions/.env.statskey-workbench`.
- The owner account carries the `statskey_fleet: true` custom claim.

Recheck this state immediately before any production change.

## 1. Confirm the exact project and database

```sh
npx -y firebase-tools@latest --version
npx -y firebase-tools@latest use
npx -y firebase-tools@latest firestore:databases:list \
  --project statskey-workbench
npx -y firebase-tools@latest firestore:databases:get workbench \
  --project statskey-workbench
```

Stop if the active project, database ID, edition, or location differs from the
values above. Production should also enable database delete protection and
point-in-time recovery through an approved infrastructure change.

## 2. Prepare a dedicated artifact bucket

Use a bucket dedicated to Fleet evidence, in an approved location compatible
with `nam5`. It must have:

- uniform bucket-level access;
- public access prevention;
- a lifecycle rule deleting objects after 35 days as a backstop for the
  coordinator's 30-day retention;
- no dependency on the StatsKey health-data bucket.

Create and use the three runtime identities pinned in `functions/index.js`:

```sh
WORKBENCH_API_SA="workbench-api@statskey-workbench.iam.gserviceaccount.com"
FLEET_DEVICE_SA="fleet-device-api@statskey-workbench.iam.gserviceaccount.com"
FLEET_SWEEP_SA="fleet-sweep@statskey-workbench.iam.gserviceaccount.com"
```

Do not deploy against the default Compute Engine service account. Give all
three identities only the Firestore access their function requires. Give the
account API bucket probe/read/download-signing access, the device API
create/read/upload-signing access, and the sweep identity delete-only access.
Prefer reviewed bucket-scoped custom roles; `roles/storage.objectAdmin` is
broader because it permits listing. The account and device API identities also
need `iam.serviceAccounts.signBlob`, commonly provided by a self-binding of
`roles/iam.serviceAccountTokenCreator`, to create V4 signed URLs.

Verify, without printing object contents:

```sh
gcloud storage buckets describe "gs://$FLEET_ARTIFACT_BUCKET"
gcloud storage buckets get-iam-policy "gs://$FLEET_ARTIFACT_BUCKET"
for service_account in \
  "$WORKBENCH_API_SA" "$FLEET_DEVICE_SA" "$FLEET_SWEEP_SA"
do
  gcloud iam service-accounts get-iam-policy "$service_account" \
    --project statskey-workbench
done
```

Do not continue until bucket access, URL signing, and lifecycle behavior have
been tested using the runtime service account.

## 3. Grant cross-project Auth verification

`workbenchApi` verifies StatsKey ID tokens against the separate `statskey`
project, including revocation checks. Grant only `$WORKBENCH_API_SA` the
minimum role containing `firebaseauth.users.get` in that project (normally
`roles/firebaseauth.viewer`), then inspect the binding:

```sh
gcloud projects get-iam-policy statskey \
  --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:$WORKBENCH_API_SA" \
  --format='table(bindings.role)'
```

Test both a current token and a revoked token. A revoked token must fail.

Fleet account actions also require the boolean StatsKey Auth custom claim
`statskey_fleet: true`. Connect that claim to the approved entitlement source
before rollout; do not grant it merely because an account exists. Verify an
otherwise valid token without the claim receives `permission_denied`. The
account API reads the current Auth user record for every Fleet action, so
removing the claim blocks the next account-side operation even when the
presented ID token still contains an older claim. Revoke refresh tokens as
defense in depth, and revoke the owner's active devices/grants to stop already
enrolled workers.

## 4. Generate and install the coordinator response key

Generate the Ed25519 key offline. The private file below is temporary and must
never be committed, pasted into chat, or stored in a dotenv file.

```sh
KEY_DIR="$(mktemp -d)"
export KEY_DIR
umask 077
node <<'NODE'
const { generateKeyPairSync } = require('node:crypto')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
writeFileSync(
  join(process.env.KEY_DIR, 'private-key.b64url'),
  privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  { mode: 0o600 }
)
writeFileSync(
  join(process.env.KEY_DIR, 'public-key.b64url'),
  publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
  { mode: 0o600 }
)
NODE
npx -y firebase-tools@latest functions:secrets:set \
  FLEET_RESPONSE_SIGNING_KEY \
  --data-file "$KEY_DIR/private-key.b64url" \
  --project statskey-workbench
```

Choose an immutable key ID such as `fleet-2026-08-19-01`. Copy
`public-key.b64url` only into the public parameter file in the next step.
Securely delete the temporary directory after Secret Manager confirms the
version. Rotation requires an overlapping-trust protocol or manual trust-pin
refresh on every enrolled node; never replace this key in place silently.

## 5. Configure non-secret parameters

```sh
cp functions/.env.statskey-workbench.example \
  functions/.env.statskey-workbench
```

Set all three values:

```text
FLEET_ARTIFACT_BUCKET=<dedicated bucket name>
FLEET_RESPONSE_SIGNING_KEY_ID=<immutable key id>
FLEET_RESPONSE_SIGNING_PUBLIC_KEY=<base64url SPKI DER>
```

Do not put the private signing key in this file. Then run:

```sh
node check-fleet-deploy-readiness.mjs
npm --prefix functions test
```

Both commands must pass.

## 6. Deploy and wait for all five indexes

The scheduler needs five composite indexes:

1. `fleetLeases(releasedAt ASC, expiresAt ASC)`
2. `fleetJobs(state ASC, deadlineAt ASC)`
3. `fleetArtifacts(state ASC, uploadExpiresAt ASC)`
4. `fleetArtifacts(state ASC, expiresAt ASC)`
5. `fleetArtifacts(state ASC, cleanupStartedAt ASC)`

The same index configuration enables TTL for
`fleetDeviceRequests.expiresAt` and `rateLimits.expiresAt`.

```sh
npx -y firebase-tools@latest deploy \
  --only firestore:indexes \
  --project statskey-workbench
npx -y firebase-tools@latest firestore:indexes \
  --database workbench \
  --project statskey-workbench
```

Wait until every Fleet index reports ready before deploying the scheduler.
Confirm the two TTL field policies in the deployed database as well.

## 7. Deploy only the Fleet-bearing functions

```sh
npx -y firebase-tools@latest deploy \
  --only functions:workbenchApi,functions:workbenchDeviceApi,functions:workbenchFleetSweep \
  --project statskey-workbench
npx -y firebase-tools@latest functions:list \
  --project statskey-workbench
```

Do not use an unscoped functions deployment for this rollout. Confirm all three
functions are Gen 2, Node 22, and in `us-central1`; the sweep must be scheduled
once per minute with a maximum of one instance. Lease/job recovery and artifact
cleanup run as isolated concurrent phases; force either phase to fail in
staging and verify the other still completes before the invocation reports
failure.

## 8. Production smoke tests

Use a disposable worker identity and a test repository explicitly included in
its signed `repositoryIdentities` grant.

1. Fetch coordinator trust through authenticated `workbenchApi`.
2. Enroll the worker and verify its first signed `device.status` response.
3. Confirm a tampered or wrong-key response pauses the desktop worker.
4. Queue and complete one command job at an immutable commit.
5. Verify a different repository under the same workspace is not offered and
   cannot be claimed.
6. Queue one artifact-producing job and verify reserve, V4 upload, commit, and
   generation-pinned five-minute download. Verify the account API refuses to
   issue a new download during the final five minutes of artifact retention.
7. Cancel one running job and verify the process tree is gone before workspace
   cleanup.
8. Create an expired test lease and incomplete artifact; verify the scheduled
   sweep releases capacity and removes only the expired upload after grace.
9. Interrupt one artifact deletion after it enters `deleting`; verify a later
   sweep reclaims it after the deletion lease, and verify a committed test
   artifact is removed after its 30-day control-plane retention deadline.
   Seed one staging-only ready manifest with an omitted `expiresAt` field and
   verify the bounded retention backfill finds and removes it.
10. Revoke the grant and verify polling, renewal, event publication, and
   artifact commit all fail closed as designed.
11. Enroll a disposable Linux identity with a custom client that reports
   executable capabilities but never attests. Verify the coordinator stores
   and returns empty capabilities/executables, offers no job, rejects a direct
   claim with `execution-attestation-missing`, and refuses renewal if a
   staging-only preexisting lease is reassigned to that identity. Verify that
   lease cannot enter `preparing`, self-confirm a retry, publish events, or
   reserve/commit artifacts, but can report `failed` for authority-reducing
   cleanup.
12. Exercise the attestation path with a disposable Linux identity:
   `helper.bind` (and a replay rejection), `helper.challenge`,
   `helper.attest` with a helper-signed attestation, then verify a command-job
   claim returns a coordinator-signed execution ticket bound to the exact job,
   lease, attempt, grant, and helper instance; verify renewal returns a signed
   `LeaseUpdateV1` with a strictly increasing sequence; verify a retry without
   a valid helper termination receipt is rejected. Also verify expired,
   reused-challenge, wrong-key, wrong-platform (24.04/arm64/cgroup-v1/
   delegated/unconfined), and stale-policy attestations are all rejected.
13. Expire a staging job while it is `preparing`; verify recovery marks it
   failed with `lease_expired_execution_ambiguous` and never requeues it.

Do not release the Fleet desktop UI until every smoke test passes and the
scheduler shows no index, IAM, signing, or artifact-preflight errors.
