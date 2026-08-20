const {
  createHash,
  randomBytes,
  timingSafeEqual,
} = require("node:crypto");
const protocol = require("./fleetProtocol");
const fleetAuth = require("./fleetAuth");
const helperProtocol = require("./fleetHelperProtocol");

const DEFAULT_LEASE_TTL_MS = 45_000;
const MIN_LEASE_TTL_MS = 15_000;
const MAX_LEASE_TTL_MS = 120_000;
const MAX_POLL_DEPENDENCY_READS = 512;
const MAX_CONTROLLER_RECOVERY_AUTH_AGE_MS = 10 * 60_000;
const MAX_ARTIFACT_SIZE_BYTES = 1024 * 1024 * 1024;
const ARTIFACT_UPLOAD_TTL_MS = 30 * 60_000;
const ARTIFACT_DOWNLOAD_TTL_MS = 5 * 60_000;
const ARTIFACT_UPLOAD_CLEANUP_GRACE_MS = 2 * 60_000;
const ARTIFACT_DELETE_LEASE_MS = 5 * 60_000;
const ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_ARTIFACTS_PER_ATTEMPT = 16;
const MAX_ARTIFACT_BYTES_PER_ATTEMPT = 8 * 1024 * 1024 * 1024;
const MAX_ARTIFACTS_PER_OWNER = 256;
const MAX_ARTIFACT_BYTES_PER_OWNER = 20 * 1024 * 1024 * 1024;
const ARTIFACT_KINDS = new Set([
  "snapshot",
  "patch",
  "commit",
  "log",
  "test-result",
  "xcresult",
  "build",
  "screenshot",
  "release",
]);
const ARTIFACT_PRODUCING_JOB_TYPES = new Set([
  "xcode-build",
  "xcode-test",
  "xcode-archive",
]);
// Terminal-failure reports stay open on Linux so work can always fail closed;
// every other transition requires a fresh helper attestation.
const LINUX_UNGATED_TRANSITIONS = new Set(["cancelled", "failed", "timed_out"]);

function jobRequiresArtifactStore(job) {
  return ARTIFACT_PRODUCING_JOB_TYPES.has(job?.type);
}

async function artifactStoreReady(context) {
  const store = context.artifactStore;
  if (
    !store ||
    typeof store.createUploadGrant !== "function" ||
    typeof store.inspectObject !== "function"
  ) {
    return false;
  }
  if (typeof store.preflight !== "function") return true;
  try {
    const result = await store.preflight();
    return result?.ready !== false;
  } catch {
    return false;
  }
}

async function requireArtifactStoreReady(job, context) {
  if (!jobRequiresArtifactStore(job)) return;
  protocol.requireValue(
      await artifactStoreReady(context),
      "failed_precondition",
      "Fleet artifact storage is not ready for this job.",
      503,
  );
}

function resourceReservation(value = {}) {
  return {
    cpuLogical: Math.max(0, Number(value.cpuLogical || 0)),
    memoryBytes: Math.max(0, Number(value.memoryBytes || 0)),
    diskAvailableBytes: Math.max(0, Number(value.diskAvailableBytes || 0)),
    gpuCount: Math.max(0, Number(value.gpuCount || 0)),
  };
}

function addResourceReservation(current, delta) {
  const left = resourceReservation(current);
  const right = resourceReservation(delta);
  return {
    cpuLogical: left.cpuLogical + right.cpuLogical,
    memoryBytes: left.memoryBytes + right.memoryBytes,
    diskAvailableBytes: left.diskAvailableBytes + right.diskAvailableBytes,
    gpuCount: left.gpuCount + right.gpuCount,
  };
}

function subtractResourceReservation(current, delta) {
  const left = resourceReservation(current);
  const right = resourceReservation(delta);
  return {
    cpuLogical: Math.max(0, left.cpuLogical - right.cpuLogical),
    memoryBytes: Math.max(0, left.memoryBytes - right.memoryBytes),
    diskAvailableBytes: Math.max(
        0,
        left.diskAvailableBytes - right.diskAvailableBytes,
    ),
    gpuCount: Math.max(0, left.gpuCount - right.gpuCount),
  };
}

function contextNow(context) {
  return protocol.validTime(context.now ? context.now() : Date.now());
}

function timestamp(context, millis) {
  if (context.Timestamp && typeof context.Timestamp.fromMillis === "function") {
    return context.Timestamp.fromMillis(millis);
  }
  return new Date(millis);
}

function randomHex(context, bytes) {
  const source = context.randomBytes || randomBytes;
  return source(bytes).toString("hex");
}

function randomToken(context, bytes) {
  const source = context.randomBytes || randomBytes;
  return source(bytes).toString("base64url");
}

function jobIdFor(uid, idempotencyKey) {
  return `job_${createHash("sha256")
      .update(`${uid}\0${idempotencyKey}`)
      .digest("hex")
      .slice(0, 32)}`;
}

function resourceLeaseId(ownerUid, resourceKey) {
  return createHash("sha256")
      .update(`${ownerUid}\0${resourceKey}`)
      .digest("hex");
}

function nonceDigest(nonce) {
  return createHash("sha256").update(nonce).digest("hex");
}

function transitionOperationDigest({
  ownerUid,
  deviceId,
  jobId,
  leaseId,
  attempt,
  state,
  retry,
}) {
  return createHash("sha256")
      .update(fleetAuth.canonicalJson({
        ownerUid,
        deviceId,
        jobId,
        leaseId,
        attempt: Number(attempt),
        state,
        retry: retry || null,
      }))
      .digest("hex");
}

function safeEqual(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function publicTime(value) {
  if (value == null) return null;
  const millis = protocol.toMillis(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function artifactView(id, row) {
  return {
    id,
    schemaVersion: row.schemaVersion,
    jobId: row.jobId,
    attempt: row.attempt,
    deviceId: row.deviceId,
    kind: row.kind,
    contentHash: row.contentHash,
    contentMd5: row.contentMd5,
    sizeBytes: row.sizeBytes,
    mediaType: row.mediaType,
    state: row.state,
    generation: row.generation || null,
    createdAt: publicTime(row.createdAt),
    committedAt: publicTime(row.committedAt),
    expiresAt: publicTime(row.expiresAt),
  };
}

function normalizeArtifactReservation(payload) {
  const credential = normalizeLeaseCredential(payload);
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId),
      "invalid_argument",
      "Invalid artifact job id.",
  );
  const artifact = payload?.artifact;
  protocol.requireValue(
      artifact && typeof artifact === "object" && !Array.isArray(artifact),
      "invalid_argument",
      "Artifact descriptor is required.",
  );
  const artifactId = protocol.cleanString(artifact.id, 64, "artifact.id");
  protocol.requireValue(
      /^artifact_[a-f0-9]{32}$/.test(artifactId),
      "invalid_argument",
      "Invalid artifact id.",
  );
  const kind = protocol.cleanString(artifact.kind, 32, "artifact.kind");
  protocol.requireValue(
      ARTIFACT_KINDS.has(kind),
      "invalid_argument",
      "Unsupported artifact kind.",
  );
  const contentHash = protocol
      .cleanString(artifact.contentHash, 64, "artifact.contentHash")
      .toLowerCase();
  protocol.requireValue(
      /^[a-f0-9]{64}$/.test(contentHash),
      "invalid_argument",
      "Artifact SHA-256 is invalid.",
  );
  const contentMd5 = protocol.cleanString(
      artifact.contentMd5,
      24,
      "artifact.contentMd5",
  );
  protocol.requireValue(
      /^[A-Za-z0-9+/]{22}==$/.test(contentMd5),
      "invalid_argument",
      "Artifact MD5 is invalid.",
  );
  const sizeBytes = protocol.boundedInteger(
      artifact.sizeBytes,
      1,
      MAX_ARTIFACT_SIZE_BYTES,
      "artifact.sizeBytes",
  );
  const mediaType = protocol.cleanString(
      artifact.mediaType,
      120,
      "artifact.mediaType",
  ).toLowerCase();
  protocol.requireValue(
      /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/
          .test(mediaType),
      "invalid_argument",
      "Artifact media type is invalid.",
  );
  return {
    credential,
    jobId,
    artifactId,
    kind,
    contentHash,
    contentMd5,
    sizeBytes,
    mediaType,
  };
}

function artifactObjectKey(ownerUid, descriptor) {
  const ownerHash = createHash("sha256")
      .update(ownerUid)
      .digest("hex")
      .slice(0, 32);
  return [
    "fleet",
    "v1",
    ownerHash,
    descriptor.jobId,
    descriptor.artifactId,
    descriptor.contentHash,
  ].join("/");
}

function jobView(id, row) {
  return {
    id,
    schemaVersion: row.schemaVersion,
    ownerUid: row.ownerUid,
    authorizedByControllerDeviceId: row.authorizedByControllerDeviceId,
    workspaceId: row.workspaceId,
    type: row.type,
    objective: row.objective,
    workspaceSnapshot: row.workspaceSnapshot,
    execution: row.execution || null,
    requiredCapabilities: row.requiredCapabilities,
    target: row.target,
    resources: row.resources,
    exclusiveResources: row.exclusiveResources,
    dependencies: row.dependencies,
    deadlineAt: publicTime(row.deadlineAt),
    maxAttempts: row.maxAttempts,
    approvalPolicy: row.approvalPolicy,
    reconciliationPolicy: row.reconciliationPolicy,
    cage: row.cage,
    state: row.state,
    attempt: row.attempt,
    eventSequence: row.eventSequence,
    artifactIds: (Array.isArray(row.artifactIds) ? row.artifactIds : [])
        .filter((artifactId) => /^artifact_[a-f0-9]{32}$/.test(artifactId))
        .slice(-64),
    assignedDeviceId: row.assignedDeviceId,
    revision: row.revision,
    cancellationRequestedAt: publicTime(row.cancellationRequestedAt),
    lastFailure: row.lastFailure ? {
      code: row.lastFailure.code,
      retryable: row.lastFailure.retryable === true,
      terminationConfirmed: row.lastFailure.terminationConfirmed === true,
      attempt: Number(row.lastFailure.attempt || 0),
      at: publicTime(row.lastFailure.at),
    } : null,
    createdAt: publicTime(row.createdAt),
    updatedAt: publicTime(row.updatedAt),
    finishedAt: publicTime(row.finishedAt),
  };
}

function deviceView(id, row) {
  const resources = row.resources || {};
  return {
    id,
    schemaVersion: row.schemaVersion,
    label: row.label,
    role: row.role,
    workerMode: row.workerMode,
    platform: row.platform,
    status: row.status,
    // Stored Linux capabilities are only ever attestation-derived; heartbeat
    // telemetry is stripped before it can persist, so the stored set is safe
    // to show for every platform.
    capabilities: row.capabilities || [],
    executables: row.executables || [],
    resources: {
      cpuLogical: Number(resources.cpuLogical || 0),
      cpuAvailable: Number(resources.cpuAvailable || 0),
      memoryBytes: Number(resources.memoryBytes || 0),
      memoryAvailableBytes: Number(resources.memoryAvailableBytes || 0),
      diskAvailableBytes: Number(resources.diskAvailableBytes || 0),
      gpuCount: Number(resources.gpuCount || 0),
    },
    activeJobs: Number(row.activeJobs || 0),
    maxConcurrentJobs: Number(row.maxConcurrentJobs || 1),
    connection: row.connection || "offline",
    protocolMinimum: Number(row.protocolMinimum || 0),
    protocolMaximum: Number(row.protocolMaximum || 0),
    softwareVersion: row.softwareVersion || "",
    lastSeenAt: publicTime(row.lastSeenAt),
    createdAt: publicTime(row.createdAt),
    updatedAt: publicTime(row.updatedAt),
  };
}

function requireOwned(row, uid, kind) {
  protocol.requireValue(row, "not_found", `${kind} was not found.`, 404);
  protocol.requireValue(
      row.ownerUid === uid,
      "not_found",
      `${kind} was not found.`,
      404,
  );
}

async function createJob(uid, payload, context) {
  const now = contextNow(context);
  protocol.requireValue(
      payload && typeof payload === "object" && !Array.isArray(payload),
      "invalid_argument",
      "Job payload is required.",
  );
  const {
    controllerAuthorization,
    ...jobInput
  } = payload;
  const normalized = protocol.normalizeCreateJob(jobInput, uid, now);
  const controllerDeviceId =
    typeof controllerAuthorization?.controllerDeviceId === "string" ?
      protocol.cleanString(
          controllerAuthorization.controllerDeviceId,
          64,
          "controllerAuthorization.controllerDeviceId",
      ) :
      "";
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(controllerDeviceId),
      "permission_denied",
      "A controller authorization is required for this job.",
      403,
  );
  const controllerSnapshot = await context.db
      .doc(`fleetDevices/${controllerDeviceId}`)
      .get();
  const controller = controllerSnapshot.exists ?
    controllerSnapshot.data() :
    null;
  protocol.requireValue(
      controller &&
        controller.id === controllerDeviceId &&
        controller.ownerUid === uid &&
        controller.status === "active" &&
        ["controller", "hybrid"].includes(controller.role) &&
        typeof controller.publicKeySpki === "string",
      "permission_denied",
      "The job authorizer is not an active Fleet controller.",
      403,
  );
  let authorizationIdentity;
  try {
    authorizationIdentity = fleetAuth.verifySignedDeviceRequest({
      publicKeySpki: controller.publicKeySpki,
      envelope: controllerAuthorization?.proof,
      payload: {ownerUid: uid, job: jobInput},
      expectedAction: "job.authorize",
      now,
    });
  } catch {
    throw protocol.apiError(
        "permission_denied",
        "The controller authorization does not match this job.",
        403,
    );
  }
  protocol.requireValue(
      authorizationIdentity.deviceId === controllerDeviceId,
      "permission_denied",
      "The controller authorization does not match this device.",
      403,
  );
  await requireArtifactStoreReady(normalized, context);
  const jobId = jobIdFor(uid, normalized.idempotencyKey);
  protocol.requireValue(
      !normalized.dependencies.includes(jobId),
      "invalid_argument",
      "A job cannot depend on itself.",
  );
  const authorized = {
    ...normalized,
    authorizedByControllerDeviceId: controllerDeviceId,
  };
  const digest = protocol.requestDigest(authorized);
  const ref = context.db.doc(`fleetJobs/${jobId}`);

  const result = await context.db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(ref);
    if (existingSnapshot.exists) {
      const existing = existingSnapshot.data();
      requireOwned(existing, uid, "Job");
      protocol.requireValue(
          existing.requestDigest === digest,
          "conflict",
          "This idempotency key was already used for different work.",
          409,
      );
      return jobView(jobId, existing);
    }
    const {idempotencyKey: _idempotencyKey, ...jobSpec} = authorized;
    const stored = {
      ...jobSpec,
      requestDigest: digest,
      state: "queued",
      attempt: 0,
      eventSequence: 0,
      artifactIds: [],
      artifactReservationAttempt: 0,
      artifactReservationCount: 0,
      artifactBytesReserved: 0,
      assignedDeviceId: null,
      activeLeaseId: null,
      cancellationRequestedAt: null,
      finishedAt: null,
      revision: 1,
      deadlineAt: timestamp(context, normalized.deadlineAt),
      createdAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, stored);
    return jobView(jobId, stored);
  });

  return result;
}

async function getJob(uid, payload, context) {
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId),
      "invalid_argument",
      "Invalid job id.",
  );
  const snapshot = await context.db.doc(`fleetJobs/${jobId}`).get();
  const row = snapshot.exists ? snapshot.data() : null;
  requireOwned(row, uid, "Job");
  return jobView(jobId, row);
}

async function listJobs(uid, payload, context) {
  const limit = protocol.boundedInteger(
      payload?.limit,
      1,
      100,
      "limit",
      50,
  );
  const state = payload?.state == null ?
    null :
    protocol.cleanString(payload.state, 32, "state");
  if (state != null) {
    protocol.requireValue(
        protocol.JOB_STATES.includes(state),
        "invalid_argument",
        "Invalid job state.",
    );
  }
  let query = context.db.collection("fleetJobs")
      .where("ownerUid", "==", uid);
  if (state != null) query = query.where("state", "==", state);
  const snapshot = await query
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();
  return {
    jobs: snapshot.docs.map((doc) => jobView(doc.id, doc.data())),
    limit,
    mayHaveMore: snapshot.docs.length === limit,
  };
}

async function listDevices(uid, payload, context) {
  const limit = protocol.boundedInteger(
      payload?.limit,
      1,
      100,
      "limit",
      50,
  );
  const ownerRef = context.db.doc(
      `fleetOwners/${createHash("sha256").update(uid).digest("hex")}`,
  );
  const [snapshot, ownerSnapshot] = await Promise.all([
    context.db.collection("fleetDevices")
        .where("ownerUid", "==", uid)
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get(),
    ownerRef.get(),
  ]);
  const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null;
  return {
    devices: snapshot.docs.map((doc) => deviceView(doc.id, doc.data())),
    bootstrapDeviceId:
      owner?.ownerUid === uid &&
      protocol.DEVICE_ID_PATTERN.test(owner.bootstrapDeviceId || "") ?
        owner.bootstrapDeviceId :
        null,
    limit,
    mayHaveMore: snapshot.docs.length === limit,
  };
}

async function listGrants(uid, payload, context) {
  const limit = protocol.boundedInteger(
      payload?.limit,
      1,
      100,
      "limit",
      50,
  );
  const snapshot = await context.db.collection("fleetGrants")
      .where("ownerUid", "==", uid)
      .orderBy("receipt.expiresAt", "desc")
      .limit(limit)
      .get();
  return {
    grants: snapshot.docs.map((doc) => grantView(doc.id, doc.data())),
    limit,
    mayHaveMore: snapshot.docs.length === limit,
  };
}

async function revokeDevice(uid, payload, context) {
  const deviceId = protocol.cleanString(payload?.deviceId, 64, "deviceId");
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(deviceId),
      "invalid_argument",
      "Invalid device id.",
  );
  const now = contextNow(context);
  const ref = context.db.doc(`fleetDevices/${deviceId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    requireOwned(row, uid, "Device");
    if (["controller", "hybrid"].includes(row.role)) {
      const ownerRef = context.db.doc(
          `fleetOwners/${createHash("sha256").update(uid).digest("hex")}`,
      );
      const ownerSnapshot = await transaction.get(ownerRef);
      const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null;
      protocol.requireValue(
          owner?.ownerUid === uid &&
            owner.bootstrapDeviceId !== deviceId,
          "failed_precondition",
          "The authoritative controller must be replaced through recovery.",
          409,
      );
    } else {
      protocol.requireValue(
          row.role === "worker",
          "failed_precondition",
          "This device role cannot be revoked.",
          409,
      );
    }
    if (row.status === "revoked") return deviceView(deviceId, row);
    const updated = {
      ...row,
      status: "revoked",
      workerMode: "disabled",
      revokedAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return deviceView(deviceId, updated);
  });
}

async function revokeGrant(uid, payload, context) {
  const grantId = protocol.cleanString(payload?.grantId, 64, "grantId");
  protocol.requireValue(
      protocol.GRANT_ID_PATTERN.test(grantId),
      "invalid_argument",
      "Invalid grant id.",
  );
  const now = contextNow(context);
  const ref = context.db.doc(`fleetGrants/${grantId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    requireOwned(row, uid, "Grant");
    if (row.revokedAt) return grantView(grantId, row);
    const updated = {
      ...row,
      revokedAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return grantView(grantId, updated);
  });
}

async function listJobEvents(uid, payload, context) {
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId),
      "invalid_argument",
      "Invalid job id.",
  );
  const afterSequence = protocol.boundedInteger(
      payload?.afterSequence,
      0,
      10_000_000,
      "afterSequence",
      0,
  );
  const limit = protocol.boundedInteger(
      payload?.limit,
      1,
      200,
      "limit",
      100,
  );
  const jobSnapshot = await context.db.doc(`fleetJobs/${jobId}`).get();
  const job = jobSnapshot.exists ? jobSnapshot.data() : null;
  requireOwned(job, uid, "Job");
  const snapshot = await context.db.collection(`fleetJobs/${jobId}/events`)
      .where("sequence", ">", afterSequence)
      .orderBy("sequence", "asc")
      .limit(limit)
      .get();
  return {
    events: snapshot.docs.map((doc) => eventView(doc.data())),
    afterSequence,
    limit,
    mayHaveMore: snapshot.docs.length === limit,
  };
}

function eventView(row) {
  return {
    schemaVersion: row.schemaVersion,
    jobId: row.jobId,
    deviceId: row.deviceId,
    attempt: row.attempt,
    sequence: row.sequence,
    type: row.type,
    payload: row.payload,
    occurredAt: publicTime(row.occurredAt),
  };
}

async function cancelJob(uid, payload, context) {
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId),
      "invalid_argument",
      "Invalid job id.",
  );
  const expectedRevision = payload?.expectedRevision == null ?
    null :
    protocol.boundedInteger(
        payload.expectedRevision,
        1,
        10_000_000,
        "expectedRevision",
        1,
    );
  const now = contextNow(context);
  const ref = context.db.doc(`fleetJobs/${jobId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    requireOwned(row, uid, "Job");
    if (protocol.TERMINAL_STATES.has(row.state)) {
      return jobView(jobId, row);
    }
    if (expectedRevision != null) {
      protocol.requireValue(
          Number(row.revision) === expectedRevision,
          "conflict",
          "The job changed before cancellation.",
          409,
      );
    }
    if (row.cancellationRequestedAt) return jobView(jobId, row);
    const cancelledBeforeLease = row.state === "queued";
    const updated = {
      ...row,
      cancellationRequestedAt: timestamp(context, now),
      ...(cancelledBeforeLease ? {
        state: "cancelled",
        finishedAt: timestamp(context, now),
      } : {}),
      revision: Number(row.revision) + 1,
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return jobView(jobId, updated);
  });
}

async function bootstrapDevice(uid, payload, context) {
  const now = contextNow(context);
  const input = payload?.device;
  protocol.requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "Device is required.",
  );
  const authorization = payload?.authorization;
  protocol.requireValue(
      authorization &&
        typeof authorization === "object" &&
        !Array.isArray(authorization),
      "invalid_argument",
      "Bootstrap authorization is required.",
  );
  const ownerUid = protocol.cleanString(
      authorization.ownerUid,
      128,
      "authorization.ownerUid",
  );
  const audience = protocol.cleanString(
      authorization.audience,
      64,
      "authorization.audience",
  );
  protocol.requireValue(
      ownerUid === uid && audience === "statskey-workbench:fleet:v1",
      "permission_denied",
      "Bootstrap authorization does not match this account.",
      403,
  );
  const publicKeySpki = protocol.cleanString(
      input.publicKeySpki,
      256,
      "device.publicKeySpki",
  );
  const keyIdentity = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const proofIdentity = fleetAuth.verifySignedDeviceRequest({
    publicKeySpki,
    envelope: payload?.proof,
    payload: {device: input, authorization: {ownerUid, audience}},
    expectedAction: "pairing.bootstrap",
    now,
  });
  protocol.requireValue(
      keyIdentity.deviceId === proofIdentity.deviceId,
      "permission_denied",
      "Device proof does not match its key.",
      403,
  );
  const normalized = protocol.normalizeDeviceEnrollment({
    ...input,
    id: keyIdentity.deviceId,
    publicKeyFingerprint: keyIdentity.publicKeyFingerprint,
  }, uid);
  protocol.requireValue(
      ["controller", "hybrid"].includes(normalized.role),
      "invalid_argument",
      "The first device must be a controller.",
  );
  protocol.requireValue(
      normalized.workerMode !== "dedicated",
      "invalid_argument",
      "The first controller cannot start as a dedicated worker.",
  );
  protocol.requireValue(
      ["darwin", "win32", "linux"].includes(normalized.platform),
      "invalid_argument",
      "The first controller must be a desktop platform.",
  );

  const ownerRef = context.db.doc(
      `fleetOwners/${createHash("sha256").update(uid).digest("hex")}`,
  );
  const deviceRef = context.db.doc(`fleetDevices/${normalized.id}`);
  return context.db.runTransaction(async (transaction) => {
    const [ownerSnapshot, deviceSnapshot] = await Promise.all([
      transaction.get(ownerRef),
      transaction.get(deviceRef),
    ]);
    const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null;
    const existing = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    if (owner?.bootstrapDeviceId) {
      protocol.requireValue(
          owner.ownerUid === uid &&
            owner.bootstrapDeviceId === normalized.id &&
            existing?.ownerUid === uid &&
            existing.publicKeySpki === publicKeySpki,
          "conflict",
          "This account already has a bootstrap controller.",
          409,
      );
      return deviceView(normalized.id, existing);
    }
    protocol.requireValue(
        !existing,
        "conflict",
        "Device key is already enrolled.",
        409,
    );
    const stored = {
      ...normalized,
      publicKeySpki,
      status: "active",
      revokedAt: null,
      replacesDeviceId: null,
      replacedByDeviceId: null,
      capabilities: [],
      executables: [],
      resources: {},
      activeJobs: 0,
      activeLeaseIds: [],
      reportedActiveJobs: 0,
      connection: "offline",
      protocolMinimum: 0,
      protocolMaximum: 0,
      softwareVersion: "",
      lastSeenAt: null,
      createdAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(deviceRef, stored);
    transaction.set(ownerRef, {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: uid,
      bootstrapDeviceId: normalized.id,
      previousBootstrapDeviceId: null,
      trustedDeviceCount: 1,
      fleetArtifactCount: Number(owner?.fleetArtifactCount || 0),
      fleetArtifactBytes: Number(owner?.fleetArtifactBytes || 0),
      bootstrapProofReplayId: proofIdentity.replayId,
      recoveryGeneration: 0,
      recoveredAt: null,
      recoveryProofReplayId: null,
      createdAt: owner?.createdAt || timestamp(context, now),
      updatedAt: timestamp(context, now),
    });
    return deviceView(normalized.id, stored);
  });
}

async function recoverController(uid, payload, context) {
  const now = contextNow(context);
  const authTimeMs = Number(context.accountAuthTimeMs);
  protocol.requireValue(
      Number.isFinite(authTimeMs) &&
        authTimeMs <= now + 60_000 &&
        now - authTimeMs <= MAX_CONTROLLER_RECOVERY_AUTH_AGE_MS,
      "recent_authentication_required",
      "Sign in again before recovering a Fleet controller.",
      401,
  );
  const input = payload?.device;
  protocol.requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "Replacement device is required.",
  );
  const authorization = payload?.authorization;
  protocol.requireValue(
      authorization &&
        typeof authorization === "object" &&
        !Array.isArray(authorization),
      "invalid_argument",
      "Controller recovery authorization is required.",
  );
  requireOnlyKeys(authorization, [
    "ownerUid",
    "audience",
    "expectedControllerDeviceId",
  ], "controller recovery authorization");
  const ownerUid = protocol.cleanString(
      authorization.ownerUid,
      128,
      "authorization.ownerUid",
  );
  const audience = protocol.cleanString(
      authorization.audience,
      64,
      "authorization.audience",
  );
  const expectedControllerDeviceId = protocol.cleanString(
      authorization.expectedControllerDeviceId,
      64,
      "authorization.expectedControllerDeviceId",
  );
  protocol.requireValue(
      ownerUid === uid &&
        audience === "statskey-workbench:fleet-recovery:v1" &&
        protocol.DEVICE_ID_PATTERN.test(expectedControllerDeviceId),
      "permission_denied",
      "Controller recovery authorization does not match this account.",
      403,
  );
  const publicKeySpki = protocol.cleanString(
      input.publicKeySpki,
      256,
      "device.publicKeySpki",
  );
  const keyIdentity = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const proofPayload = {
    device: input,
    authorization: {ownerUid, audience, expectedControllerDeviceId},
  };
  const proofIdentity = fleetAuth.verifySignedDeviceRequest({
    publicKeySpki,
    envelope: payload?.proof,
    payload: proofPayload,
    expectedAction: "controller.recover",
    now,
  });
  protocol.requireValue(
      keyIdentity.deviceId === proofIdentity.deviceId &&
        keyIdentity.deviceId !== expectedControllerDeviceId,
      "permission_denied",
      "Replacement proof does not match a new device key.",
      403,
  );
  const normalized = protocol.normalizeDeviceEnrollment({
    ...input,
    id: keyIdentity.deviceId,
    publicKeyFingerprint: keyIdentity.publicKeyFingerprint,
  }, uid);
  protocol.requireValue(
      ["controller", "hybrid"].includes(normalized.role) &&
        normalized.workerMode !== "dedicated" &&
        ["darwin", "win32", "linux"].includes(normalized.platform),
      "invalid_argument",
      "The replacement must be a desktop controller.",
  );

  const ownerRef = context.db.doc(
      `fleetOwners/${createHash("sha256").update(uid).digest("hex")}`,
  );
  const previousRef = context.db.doc(
      `fleetDevices/${expectedControllerDeviceId}`,
  );
  const replacementRef = context.db.doc(`fleetDevices/${normalized.id}`);
  const replayRef = context.db.doc(
      `fleetDeviceRequests/${proofIdentity.replayId}`,
  );
  return context.db.runTransaction(async (transaction) => {
    const [
      ownerSnapshot,
      previousSnapshot,
      replacementSnapshot,
      replaySnapshot,
    ] = await Promise.all([
      transaction.get(ownerRef),
      transaction.get(previousRef),
      transaction.get(replacementRef),
      transaction.get(replayRef),
    ]);
    const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null;
    const previous = previousSnapshot.exists ? previousSnapshot.data() : null;
    const replacement = replacementSnapshot.exists ?
      replacementSnapshot.data() :
      null;
    if (
      owner?.ownerUid === uid &&
      owner.bootstrapDeviceId === normalized.id &&
      owner.previousBootstrapDeviceId === expectedControllerDeviceId &&
      replacement?.ownerUid === uid &&
      replacement.publicKeySpki === publicKeySpki &&
      replacement.status === "active"
    ) {
      return deviceView(normalized.id, replacement);
    }
    protocol.requireValue(
        owner?.ownerUid === uid &&
          owner.bootstrapDeviceId === expectedControllerDeviceId,
        "failed_precondition",
        "The expected controller is no longer authoritative.",
        409,
    );
    requireOwned(previous, uid, "Controller");
    protocol.requireValue(
        previous.status === "active" &&
          ["controller", "hybrid"].includes(previous.role),
        "failed_precondition",
        "The expected controller is not active.",
        409,
    );
    protocol.requireValue(
        !replacement,
        "conflict",
        "The replacement key is already enrolled.",
        409,
    );
    protocol.requireValue(
        !replaySnapshot.exists,
        "replayed_request",
        "Controller recovery proof was already used.",
        409,
    );
    const recoveredAt = timestamp(context, now);
    const storedReplacement = {
      ...normalized,
      publicKeySpki,
      status: "active",
      capabilities: [],
      executables: [],
      resources: {},
      activeJobs: 0,
      activeLeaseIds: [],
      reportedActiveJobs: 0,
      connection: "offline",
      protocolMinimum: 0,
      protocolMaximum: 0,
      softwareVersion: "",
      lastSeenAt: null,
      recoveryGeneration: Number(owner.recoveryGeneration || 0) + 1,
      replacesDeviceId: expectedControllerDeviceId,
      replacedByDeviceId: null,
      revokedAt: null,
      createdAt: recoveredAt,
      updatedAt: recoveredAt,
    };
    transaction.set(previousRef, {
      ...previous,
      status: "revoked",
      workerMode: "disabled",
      capabilities: [],
      executables: [],
      connection: "offline",
      revokedAt: recoveredAt,
      replacedByDeviceId: normalized.id,
      updatedAt: recoveredAt,
    });
    transaction.set(replacementRef, storedReplacement);
    transaction.set(ownerRef, {
      ...owner,
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: uid,
      bootstrapDeviceId: normalized.id,
      previousBootstrapDeviceId: expectedControllerDeviceId,
      recoveryGeneration: Number(owner.recoveryGeneration || 0) + 1,
      recoveredAt,
      recoveryProofReplayId: proofIdentity.replayId,
      updatedAt: recoveredAt,
    });
    transaction.set(replayRef, {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: uid,
      deviceId: normalized.id,
      requestId: proofIdentity.requestId,
      action: "controller.recover",
      issuedAt: timestamp(context, proofIdentity.issuedAt),
      expiresAt: timestamp(context, proofIdentity.expiresAt),
      consumedAt: recoveredAt,
    });
    return deviceView(normalized.id, storedReplacement);
  });
}

async function pairDevice(uid, payload, context) {
  const now = contextNow(context);
  const receipt = payload?.receipt;
  protocol.requireValue(
      receipt && typeof receipt === "object" && !Array.isArray(receipt),
      "invalid_argument",
      "Pairing receipt is required.",
  );
  requireOnlyKeys(receipt, [
    "pairingNonce",
    "ownerUid",
    "controllerDeviceId",
    "candidate",
    "workspaceIds",
    "repositoryIdentities",
    "capabilities",
    "unattended",
    "grantExpiresAt",
    "policyVersion",
  ], "pairing receipt");
  protocol.requireValue(
      protocol.cleanString(receipt.ownerUid, 128, "ownerUid") === uid,
      "permission_denied",
      "Pairing receipt does not match this account.",
      403,
  );
  const candidate = receipt.candidate;
  protocol.requireValue(
      candidate && typeof candidate === "object" && !Array.isArray(candidate),
      "invalid_argument",
      "Pairing candidate is required.",
  );
  requireOnlyKeys(candidate, [
    "label",
    "role",
    "workerMode",
    "platform",
    "publicKeySpki",
    "maxConcurrentJobs",
  ], "pairing candidate");
  const pairingNonce = protocol.cleanString(
      receipt.pairingNonce,
      64,
      "pairingNonce",
  );
  protocol.requireValue(
      /^[A-Za-z0-9_-]{43}$/.test(pairingNonce),
      "invalid_argument",
      "Invalid pairing challenge.",
  );
  const publicKeySpki = protocol.cleanString(
      candidate.publicKeySpki,
      256,
      "candidate.publicKeySpki",
  );
  const candidateIdentity = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const candidateProof = fleetAuth.verifySignedDeviceRequest({
    publicKeySpki,
    envelope: payload?.candidateProof,
    payload: receipt,
    expectedAction: "pairing.candidate",
    now,
  });
  protocol.requireValue(
      candidateProof.deviceId === candidateIdentity.deviceId,
      "permission_denied",
      "Candidate proof does not match its key.",
      403,
  );
  const controllerDeviceId = protocol.cleanString(
      receipt.controllerDeviceId,
      64,
      "controllerDeviceId",
  );
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(controllerDeviceId),
      "invalid_argument",
      "Invalid controller device.",
  );
  protocol.requireValue(
      candidateIdentity.deviceId !== controllerDeviceId,
      "invalid_argument",
      "Pairing requires a different candidate device.",
  );
  const controllerRef = context.db.doc(`fleetDevices/${controllerDeviceId}`);
  const controllerSnapshot = await controllerRef.get();
  const controller = controllerSnapshot.exists ? controllerSnapshot.data() : null;
  requireOwned(controller, uid, "Controller");
  protocol.requireValue(
      controller.status === "active" &&
        ["controller", "hybrid"].includes(controller.role) &&
        typeof controller.publicKeySpki === "string",
      "failed_precondition",
      "Controller is not trusted for pairing.",
      409,
  );
  const controllerProof = fleetAuth.verifySignedDeviceRequest({
    publicKeySpki: controller.publicKeySpki,
    envelope: payload?.controllerProof,
    payload: receipt,
    expectedAction: "pairing.approve",
    now,
  });
  protocol.requireValue(
      controllerProof.deviceId === controllerDeviceId,
      "permission_denied",
      "Controller proof does not match the pairing receipt.",
      403,
  );

  const normalizedDevice = protocol.normalizeDeviceEnrollment({
    ...candidate,
    id: candidateIdentity.deviceId,
    publicKeyFingerprint: candidateIdentity.publicKeyFingerprint,
  }, uid);
  const isDedicatedWorkerCandidate =
    normalizedDevice.role === "worker" &&
    normalizedDevice.workerMode === "dedicated";
  const isControllerCandidate =
    normalizedDevice.role === "hybrid" &&
    normalizedDevice.workerMode === "disabled";
  protocol.requireValue(
      isDedicatedWorkerCandidate || isControllerCandidate,
      "invalid_argument",
      "Pairing approval is limited to dedicated workers or controller devices.",
  );
  // A controller candidate (for example a phone) authorizes work but never
  // executes it, so pairing creates no capability grant at all.
  if (isControllerCandidate) {
    protocol.requireValue(
        receipt.unattended === false &&
          Array.isArray(receipt.workspaceIds) &&
          receipt.workspaceIds.length === 0 &&
          Array.isArray(receipt.repositoryIdentities) &&
          receipt.repositoryIdentities.length === 0 &&
          Array.isArray(receipt.capabilities) &&
          receipt.capabilities.length === 0,
        "invalid_argument",
        "Controller pairing cannot grant workspace, repository, or capability scope.",
    );
    protocol.requireValue(
        Number.isSafeInteger(receipt.grantExpiresAt) &&
          receipt.grantExpiresAt > now &&
          receipt.grantExpiresAt <= now + 365 * 24 * 60 * 60 * 1000,
        "invalid_argument",
        "Invalid pairing receipt expiry.",
    );
  }
  const grantId = isDedicatedWorkerCandidate ?
    `grant_${createHash("sha256")
        .update(`${uid}\0${pairingNonce}\0${normalizedDevice.id}`)
        .digest("hex")
        .slice(0, 32)}` :
    null;
  const normalizedGrant = isDedicatedWorkerCandidate ?
    protocol.normalizeGrant({
      id: grantId,
      controllerDeviceId,
      workerDeviceId: normalizedDevice.id,
      workspaceIds: receipt.workspaceIds,
      repositoryIdentities: receipt.repositoryIdentities,
      capabilities: receipt.capabilities,
      unattended: receipt.unattended === true,
      policyVersion: receipt.policyVersion,
      expiresAt: receipt.grantExpiresAt,
    }, uid, now) :
    null;
  protocol.requireValue(
      !normalizedGrant ||
        normalizedGrant.expiresAt <= now + 365 * 24 * 60 * 60 * 1000,
      "invalid_argument",
      "Pairing grants cannot exceed one year.",
  );
  const pairingDigest = protocol.requestDigest(receipt);
  const ownerRef = context.db.doc(
      `fleetOwners/${createHash("sha256").update(uid).digest("hex")}`,
  );
  const deviceRef = context.db.doc(`fleetDevices/${normalizedDevice.id}`);
  const grantRef = grantId ? context.db.doc(`fleetGrants/${grantId}`) : null;
  const candidateReplayRef = context.db.doc(
      `fleetDeviceRequests/${candidateProof.replayId}`,
  );
  const controllerReplayRef = context.db.doc(
      `fleetDeviceRequests/${controllerProof.replayId}`,
  );

  return context.db.runTransaction(async (transaction) => {
    const [
      currentControllerSnapshot,
      deviceSnapshot,
      grantSnapshot,
      ownerSnapshot,
      candidateReplaySnapshot,
      controllerReplaySnapshot,
    ] = await Promise.all([
      transaction.get(controllerRef),
      transaction.get(deviceRef),
      grantRef ? transaction.get(grantRef) : Promise.resolve(null),
      transaction.get(ownerRef),
      transaction.get(candidateReplayRef),
      transaction.get(controllerReplayRef),
    ]);
    const currentController = currentControllerSnapshot.exists ?
      currentControllerSnapshot.data() :
      null;
    const existingDevice = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    const existingGrant = grantSnapshot?.exists ? grantSnapshot.data() : null;
    const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null;
    protocol.requireValue(
        currentController?.ownerUid === uid &&
          currentController.status === "active" &&
          currentController.publicKeySpki === controller.publicKeySpki,
        "failed_precondition",
        "Controller changed during pairing.",
        409,
    );
    if (existingDevice || existingGrant) {
      protocol.requireValue(
          existingDevice?.ownerUid === uid &&
            existingDevice.pairingDigest === pairingDigest &&
            existingDevice.status === "active" &&
            existingDevice.revokedAt == null &&
            (isControllerCandidate ||
              (existingGrant?.ownerUid === uid &&
                existingGrant.pairingDigest === pairingDigest &&
                existingGrant.revokedAt == null &&
                protocol.toMillis(existingGrant.receipt?.expiresAt) > now)),
          "conflict",
          "Pairing identity is already in use or no longer active.",
          409,
      );
      return {
        device: deviceView(normalizedDevice.id, existingDevice),
        ...(isDedicatedWorkerCandidate ?
          {grant: grantView(grantId, existingGrant)} :
          {}),
      };
    }
    protocol.requireValue(
        !candidateReplaySnapshot.exists && !controllerReplaySnapshot.exists,
        "replayed_request",
        "Pairing proof was already used.",
        409,
    );
    const storedDevice = {
      ...normalizedDevice,
      publicKeySpki,
      pairingDigest,
      status: "active",
      revokedAt: null,
      replacesDeviceId: null,
      replacedByDeviceId: null,
      capabilities: [],
      executables: [],
      resources: {},
      activeJobs: 0,
      activeLeaseIds: [],
      reportedActiveJobs: 0,
      connection: "offline",
      protocolMinimum: 0,
      protocolMaximum: 0,
      softwareVersion: "",
      lastSeenAt: null,
      createdAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    const storedGrant = normalizedGrant ? {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: uid,
      receipt: {
        ...normalizedGrant,
        issuedAt: timestamp(context, normalizedGrant.issuedAt),
        expiresAt: timestamp(context, normalizedGrant.expiresAt),
      },
      receiptDigest: protocol.requestDigest({
        ...normalizedGrant,
        issuedAt: null,
      }),
      pairingDigest,
      controllerProofDigest: protocol.requestDigest(payload.controllerProof),
      candidateProofDigest: protocol.requestDigest(payload.candidateProof),
      revokedAt: null,
      createdAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    } : null;
    const replayRow = (proof, action) => ({
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: uid,
      deviceId: proof.deviceId,
      requestId: proof.requestId,
      action,
      issuedAt: timestamp(context, proof.issuedAt),
      expiresAt: timestamp(context, proof.expiresAt),
      consumedAt: timestamp(context, now),
    });
    transaction.set(deviceRef, storedDevice);
    if (storedGrant) transaction.set(grantRef, storedGrant);
    transaction.set(
        candidateReplayRef,
        replayRow(candidateProof, "pairing.candidate"),
    );
    transaction.set(
        controllerReplayRef,
        replayRow(controllerProof, "pairing.approve"),
    );
    transaction.set(ownerRef, {
      ...(owner || {}),
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: uid,
      trustedDeviceCount: Number(owner?.trustedDeviceCount || 0) + 1,
      createdAt: owner?.createdAt || timestamp(context, now),
      updatedAt: timestamp(context, now),
    });
    return {
      device: deviceView(normalizedDevice.id, storedDevice),
      ...(storedGrant ? {grant: grantView(grantId, storedGrant)} : {}),
    };
  });
}

async function createLocalGrant(uid, payload, context) {
  const now = contextNow(context);
  const receipt = payload?.receipt;
  protocol.requireValue(
      receipt && typeof receipt === "object" && !Array.isArray(receipt),
      "invalid_argument",
      "Local worker receipt is required.",
  );
  requireOnlyKeys(receipt, [
    "deviceId",
    "workspaceIds",
    "repositoryIdentities",
    "capabilities",
    "unattended",
    "expiresAt",
    "policyVersion",
  ], "local worker receipt");
  const deviceId = protocol.cleanString(receipt.deviceId, 64, "deviceId");
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(deviceId),
      "invalid_argument",
      "Invalid local worker device.",
  );
  const snapshot = await context.db.doc(`fleetDevices/${deviceId}`).get();
  const device = snapshot.exists ? snapshot.data() : null;
  requireOwned(device, uid, "Device");
  protocol.requireValue(
      device.status === "active" &&
        device.role === "hybrid" &&
        device.workerMode === "opt-in" &&
        typeof device.publicKeySpki === "string",
      "failed_precondition",
      "This device is not an opt-in hybrid worker.",
      409,
  );
  const proof = fleetAuth.verifySignedDeviceRequest({
    publicKeySpki: device.publicKeySpki,
    envelope: payload?.proof,
    payload: receipt,
    expectedAction: "grant.local",
    now,
  });
  protocol.requireValue(
      proof.deviceId === deviceId,
      "permission_denied",
      "Local worker proof does not match this device.",
      403,
  );
  const expiresAt = protocol.validTime(receipt.expiresAt);
  protocol.requireValue(
      expiresAt > now &&
        expiresAt <= now + 365 * 24 * 60 * 60 * 1000,
      "invalid_argument",
      "Local worker grant expiration is invalid.",
  );
  const id = `grant_${protocol.requestDigest(receipt).slice(0, 32)}`;
  return createGrant(uid, {
    id,
    controllerDeviceId: deviceId,
    workerDeviceId: deviceId,
    workspaceIds: receipt.workspaceIds,
    repositoryIdentities: receipt.repositoryIdentities,
    capabilities: receipt.capabilities,
    unattended: receipt.unattended === true,
    policyVersion: receipt.policyVersion,
    expiresAt,
  }, context);
}

function requireOnlyKeys(value, allowed, label) {
  const allowedKeys = new Set(allowed);
  protocol.requireValue(
      Object.keys(value).every((key) => allowedKeys.has(key)),
      "invalid_argument",
      `Unexpected ${label} field.`,
  );
}

// Called only after the pairing service verifies an account-authenticated,
// single-use challenge and proof of possession for publicKeyFingerprint.
async function enrollDevice(uid, payload, context) {
  const now = contextNow(context);
  const normalized = protocol.normalizeDeviceEnrollment(payload, uid);
  const publicKeySpki = payload?.publicKeySpki == null ?
    null :
    protocol.cleanString(payload.publicKeySpki, 256, "device.publicKeySpki");
  if (publicKeySpki) {
    const keyIdentity = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
    protocol.requireValue(
        keyIdentity.deviceId === normalized.id &&
          keyIdentity.publicKeyFingerprint === normalized.publicKeyFingerprint,
        "invalid_argument",
        "Device key does not match its enrollment identity.",
    );
  } else {
    protocol.requireValue(
        context.allowLegacyFingerprintEnrollment === true,
        "invalid_argument",
        "An Ed25519 device public key is required.",
    );
  }
  const ref = context.db.doc(`fleetDevices/${normalized.id}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : null;
    if (existing) {
      requireOwned(existing, uid, "Device");
      protocol.requireValue(
          existing.status !== "revoked",
          "permission_denied",
          "This device was revoked.",
          403,
      );
      protocol.requireValue(
          existing.publicKeyFingerprint === normalized.publicKeyFingerprint,
          "permission_denied",
          "Device key does not match the enrollment.",
          403,
      );
      if (publicKeySpki) {
        protocol.requireValue(
            !existing.publicKeySpki ||
              existing.publicKeySpki === publicKeySpki,
            "permission_denied",
            "Device public key does not match the enrollment.",
            403,
        );
      }
    }
    const stored = {
      ...(existing || {}),
      ...normalized,
      publicKeySpki: existing?.publicKeySpki || publicKeySpki || null,
      status: "active",
      revokedAt: existing?.revokedAt || null,
      replacesDeviceId: existing?.replacesDeviceId || null,
      replacedByDeviceId: existing?.replacedByDeviceId || null,
      capabilities: existing?.capabilities || [],
      executables: existing?.executables || [],
      resources: existing?.resources || {},
      activeJobs: Number(existing?.activeJobs || 0),
      activeLeaseIds: Array.isArray(existing?.activeLeaseIds) ?
        existing.activeLeaseIds.filter((value) =>
          protocol.LEASE_ID_PATTERN.test(value)).slice(0, 128) :
        [],
      connection: existing?.connection || "offline",
      protocolMinimum: Number(existing?.protocolMinimum || 0),
      protocolMaximum: Number(existing?.protocolMaximum || 0),
      softwareVersion: existing?.softwareVersion || "",
      lastSeenAt: existing?.lastSeenAt || null,
      createdAt: existing?.createdAt || timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, stored);
    return deviceView(normalized.id, stored);
  });
}

function requireDeviceIdentity(identity) {
  protocol.requireValue(
      identity && typeof identity === "object",
      "unauthenticated",
      "Device authentication is required.",
      401,
  );
  const deviceId = protocol.cleanString(identity.deviceId, 64, "deviceId");
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(deviceId),
      "unauthenticated",
      "Invalid device identity.",
      401,
  );
  return {
    ownerUid: protocol.cleanString(identity.ownerUid, 128, "ownerUid"),
    deviceId,
    publicKeyFingerprint: protocol.cleanString(
        identity.publicKeyFingerprint,
        120,
        "publicKeyFingerprint",
    ),
  };
}

function verifyDeviceRow(row, identity) {
  requireOwned(row, identity.ownerUid, "Device");
  protocol.requireValue(
      row.id === identity.deviceId &&
        row.publicKeyFingerprint === identity.publicKeyFingerprint,
      "permission_denied",
      "Device identity does not match its enrollment.",
      403,
  );
  protocol.requireValue(
      row.status === "active",
      "permission_denied",
      "Device is not active.",
      403,
  );
}

function freshLinuxAttestation(attestation, now) {
  return attestation && protocol.toMillis(attestation.expiresAt) > now ?
    attestation :
    null;
}

async function readLinuxAttestation(transaction, context, deviceId) {
  const snapshot = await transaction.get(
      context.db.doc(`fleetHelperAttestations/${deviceId}`),
  );
  return snapshot.exists ? snapshot.data() : null;
}

// Linux execution authority derives from a fresh verified helper attestation,
// never from self-reported telemetry (design invariant 13).
function requireLinuxExecutionAuthority(device, attestation, now, operation) {
  if (device.platform !== "linux") return;
  protocol.requireValue(
      attestation != null,
      "failed_precondition",
      `Linux execution attestation is required ${operation}.`,
      409,
  );
  protocol.requireValue(
      protocol.toMillis(attestation.expiresAt) > now,
      "failed_precondition",
      `Linux execution attestation has expired ${operation}.`,
      409,
  );
}

function linuxAttestationPolicyAllows(attestation, grant) {
  const receipt = grant?.receipt || {};
  if (
    receipt.executionServiceId != null &&
    attestation.executionServiceId !== receipt.executionServiceId
  ) {
    return false;
  }
  if (
    Number(attestation.helperProtocol) <
      Number(receipt.minimumHelperProtocol ?? 1) ||
    Number(attestation.policyEpoch) < Number(receipt.minimumPolicyEpoch ?? 1)
  ) {
    return false;
  }
  const profiles = helperProtocol.LINUX_COMMAND_PROFILES;
  if (
    receipt.executorProfileIds != null &&
    !receipt.executorProfileIds.includes(profiles.executorProfileId)
  ) {
    return false;
  }
  if (
    receipt.sandboxProfileIds != null &&
    !receipt.sandboxProfileIds.includes(profiles.sandboxProfileId)
  ) {
    return false;
  }
  if (
    receipt.networkProfileIds != null &&
    !receipt.networkProfileIds.includes(profiles.networkProfileId)
  ) {
    return false;
  }
  return true;
}

function nextLeaseSequence(lease) {
  const current = Number(lease?.leaseSequence);
  return (Number.isSafeInteger(current) && current >= 0 ? current : 0) + 1;
}

function requireFleetPayloadSigner(context) {
  protocol.requireValue(
      typeof context.signFleetPayload === "function",
      "failed_precondition",
      "Fleet ticket signing is not configured.",
      503,
  );
  return context.signFleetPayload;
}

function linuxTicketResources(job, receipt) {
  const requested = job.resources || {};
  const ceilings = receipt?.resourceCeilings || null;
  const clamp = (value, key) =>
    ceilings && Number.isInteger(ceilings[key]) ?
      Math.min(value, ceilings[key]) :
      value;
  const requestedCpu = Number(requested.cpuLogical || 0);
  const requestedMemory = Number(requested.memoryBytes || 0);
  const requestedDisk = Number(requested.diskAvailableBytes || 0);
  const requestedWall = Number(job.execution?.timeoutMs || 0);
  return {
    cpuMilli: clamp(requestedCpu > 0 ? requestedCpu * 1000 : 4_000, "cpuMilli"),
    memoryBytes: clamp(
        requestedMemory > 0 ? requestedMemory : 8 * 1024 ** 3,
        "memoryBytes",
    ),
    pids: clamp(256, "pids"),
    diskBytes: clamp(
        requestedDisk > 0 ? requestedDisk : 20 * 1024 ** 3,
        "diskBytes",
    ),
    wallTimeMs: clamp(
        requestedWall > 0 ? requestedWall : 3_600_000,
        "wallTimeMs",
    ),
  };
}

// The ticket carries no host paths, UIDs, mounts, or environment; the daemon
// may tighten these limits but never loosen them.
async function issueLinuxExecutionTicket({
  context,
  job,
  jobId,
  device,
  grant,
  attestation,
  attempt,
  leaseId,
  leaseSequence,
  ticketId,
  now,
  leaseExpiresAt,
}) {
  protocol.requireValue(
      job.execution?.kind === "command",
      "failed_precondition",
      "Linux execution tickets require a command job.",
      409,
  );
  const signFleetPayload = requireFleetPayloadSigner(context);
  protocol.requireValue(
      /^[a-f0-9]{64}$/.test(String(job.requestDigest || "")) &&
        /^[a-f0-9]{64}$/.test(String(grant?.receiptDigest || "")),
      "failed_precondition",
      "Signed job or grant digests are not available.",
      409,
  );
  protocol.requireValue(
      ticketId == null || helperProtocol.TICKET_ID_PATTERN.test(ticketId),
      "failed_precondition",
      "This Linux lease is not bound to an execution ticket.",
      409,
  );
  const profiles = helperProtocol.LINUX_COMMAND_PROFILES;
  const receipt = grant.receipt || {};
  const unsigned = {
    domain: helperProtocol.EXECUTION_TICKET_DOMAIN,
    ticketId: ticketId || `ticket_${randomHex(context, 16)}`,
    jobRequestDigest: `sha256:${job.requestDigest}`,
    jobId,
    attempt: Number(attempt),
    leaseId,
    leaseSequence: Number.isSafeInteger(Number(leaseSequence)) ?
      Number(leaseSequence) :
      0,
    grantReceiptDigest: `sha256:${grant.receiptDigest}`,
    ownerUid: job.ownerUid,
    workerDeviceId: device.id,
    controllerDeviceId: receipt.controllerDeviceId,
    executionServiceId: attestation.executionServiceId,
    helperInstanceId: attestation.helperInstanceId,
    repositoryIdentity: job.workspaceSnapshot.repositoryIdentity,
    commit: job.workspaceSnapshot.commit,
    executorProfileId: profiles.executorProfileId,
    sandboxProfileId: profiles.sandboxProfileId,
    networkProfileId: profiles.networkProfileId,
    command: {
      executable: job.execution.executable,
      arguments: job.execution.arguments,
      workingDirectory: job.execution.workingDirectory,
    },
    resources: linuxTicketResources(job, receipt),
    serverIssuedAt: helperProtocol.formatRfc3339Ms(now),
    leaseExpiresAt: helperProtocol.formatRfc3339Ms(leaseExpiresAt),
    jobDeadlineAt: helperProtocol.formatRfc3339Ms(
        protocol.toMillis(job.deadlineAt),
    ),
    minimumHelperProtocol: receipt.minimumHelperProtocol ?? 1,
    minimumPolicyEpoch: receipt.minimumPolicyEpoch ?? 1,
  };
  const signature = await signFleetPayload(unsigned);
  // The coordinator only emits tickets that pass its own wire normalization.
  return helperProtocol.normalizeExecutionTicket({...unsigned, signature});
}

async function issueLinuxLeaseUpdate({
  context,
  lease,
  sequence,
  cancelled,
  leaseExpiresAt,
  now,
}) {
  const signFleetPayload = requireFleetPayloadSigner(context);
  protocol.requireValue(
      helperProtocol.TICKET_ID_PATTERN.test(String(lease.ticketId || "")) &&
        helperProtocol.HELPER_INSTANCE_ID_PATTERN.test(
            String(lease.helperInstanceId || ""),
        ),
      "failed_precondition",
      "This Linux lease is not bound to an execution ticket.",
      409,
  );
  const unsigned = {
    domain: helperProtocol.LEASE_UPDATE_DOMAIN,
    ticketId: lease.ticketId,
    jobId: lease.jobId,
    attempt: Number(lease.attempt),
    leaseId: lease.id,
    helperInstanceId: lease.helperInstanceId,
    leaseSequence: sequence,
    cancelled: cancelled === true,
    serverIssuedAt: helperProtocol.formatRfc3339Ms(now),
    leaseExpiresAt: helperProtocol.formatRfc3339Ms(leaseExpiresAt),
  };
  const signature = await signFleetPayload(unsigned);
  return helperProtocol.normalizeLeaseUpdate({...unsigned, signature});
}

// A Linux retry is only safe once the helper proves the previous attempt's
// cgroup is empty; the worker-reported boolean carries no authority there.
async function requireLinuxTerminationReceipt({
  transaction,
  context,
  identity,
  job,
  jobId,
  lease,
  payload,
}) {
  const receiptInput = payload?.retry?.terminationReceipt;
  protocol.requireValue(
      receiptInput != null,
      "failed_precondition",
      "Linux retries require a helper termination receipt.",
      409,
  );
  const receipt = helperProtocol.normalizeTerminationReceipt(receiptInput);
  protocol.requireValue(
      receipt.jobId === jobId &&
        receipt.leaseId === lease.id &&
        Number(receipt.attempt) === Number(job.attempt),
      "permission_denied",
      "Termination receipt does not match this job attempt.",
      403,
  );
  protocol.requireValue(
      receipt.ticketId === lease.ticketId &&
        receipt.helperInstanceId === lease.helperInstanceId,
      "permission_denied",
      "Termination receipt does not match this lease ticket.",
      403,
  );
  const leaseSequence = Number(lease.leaseSequence);
  protocol.requireValue(
      Number.isSafeInteger(leaseSequence) && leaseSequence >= 0 ?
        receipt.highestLeaseSequence <= leaseSequence :
        receipt.highestLeaseSequence === 0,
      "permission_denied",
      "Termination receipt renewal sequence is not valid.",
      403,
  );
  const bindingSnapshot = await transaction.get(
      context.db.doc(`fleetHelperBindings/${identity.deviceId}`),
  );
  const binding = bindingSnapshot.exists ? bindingSnapshot.data() : null;
  protocol.requireValue(
      binding && binding.ownerUid === identity.ownerUid,
      "failed_precondition",
      "No helper binding exists for this device.",
      409,
  );
  helperProtocol.verifyTerminationReceiptSignature(
      receipt,
      binding.helperPublicKeySpki,
  );
}

async function recordDeviceHeartbeat(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  const heartbeat = protocol.normalizeHeartbeat(payload);
  const {activeJobs: reportedActiveJobs, ...reportedTelemetry} = heartbeat;
  const now = contextNow(context);
  const ref = context.db.doc(`fleetDevices/${identity.deviceId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    verifyDeviceRow(row, identity);
    // Linux capability claims are never accepted from the heartbeat itself;
    // they derive only from a fresh verified helper attestation.
    let attestedCapabilities = null;
    if (row.platform === "linux") {
      const attestation = await readLinuxAttestation(
          transaction,
          context,
          identity.deviceId,
      );
      if (freshLinuxAttestation(attestation, now)) {
        attestedCapabilities = [...helperProtocol.LINUX_ATTESTED_CAPABILITIES];
      }
    }
    const acceptedTelemetry = row.platform === "linux" ?
      {
        ...reportedTelemetry,
        capabilities: attestedCapabilities || [],
        executables: [],
      } :
      reportedTelemetry;
    const updated = {
      ...row,
      ...acceptedTelemetry,
      reportedActiveJobs,
      activeJobs: Number(row.activeJobs || 0),
      lastSeenAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return deviceView(identity.deviceId, updated);
  });
}

async function bindHelper(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  protocol.requireValue(
      payload && typeof payload === "object" && !Array.isArray(payload),
      "invalid_argument",
      "Helper binding payload is required.",
  );
  requireOnlyKeys(payload, [
    "helperPublicKey",
    "executionServiceId",
    "helperBuildId",
    "runnerBuildId",
    "policyEpoch",
  ], "helper.bind");
  const helperPublicKeySpki = protocol.cleanString(
      payload.helperPublicKey,
      256,
      "helperPublicKey",
  );
  const helperKey = fleetAuth.normalizePublicKeySpki(helperPublicKeySpki);
  const helperKeyId = `sha256:${createHash("sha256")
      .update(helperKey.der)
      .digest("base64url")}`;
  const executionServiceId = protocol.cleanString(
      payload.executionServiceId,
      64,
      "executionServiceId",
  );
  protocol.requireValue(
      protocol.EXECUTION_SERVICE_ID_PATTERN.test(executionServiceId),
      "invalid_argument",
      "Invalid execution service id.",
  );
  const helperBuildId = protocol.cleanString(
      payload.helperBuildId,
      96,
      "helperBuildId",
  );
  const runnerBuildId = protocol.cleanString(
      payload.runnerBuildId,
      96,
      "runnerBuildId",
  );
  protocol.requireValue(
      helperProtocol.BUILD_ID_PATTERN.test(helperBuildId) &&
        helperProtocol.BUILD_ID_PATTERN.test(runnerBuildId),
      "invalid_argument",
      "Invalid helper or runner build id.",
  );
  const policyEpoch = protocol.boundedInteger(
      payload.policyEpoch,
      1,
      helperProtocol.MAX_POLICY_EPOCH,
      "policyEpoch",
  );
  const now = contextNow(context);
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  const bindingRef = context.db.doc(`fleetHelperBindings/${identity.deviceId}`);
  const attestationRef = context.db.doc(
      `fleetHelperAttestations/${identity.deviceId}`,
  );
  return context.db.runTransaction(async (transaction) => {
    const deviceSnapshot = await transaction.get(deviceRef);
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    verifyDeviceRow(device, identity);
    protocol.requireValue(
        device.platform === "linux",
        "failed_precondition",
        "Helper binding requires a Linux device.",
        409,
    );
    transaction.set(bindingRef, {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: identity.ownerUid,
      deviceId: identity.deviceId,
      helperPublicKeySpki,
      helperKeyId,
      executionServiceId,
      helperBuildId,
      runnerBuildId,
      policyEpoch,
      boundAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    });
    // A rebinding invalidates every earlier attestation; the helper must
    // re-attest against the new binding before any further execution.
    transaction.delete(attestationRef);
    return {
      deviceId: identity.deviceId,
      helperKeyId,
      executionServiceId,
      helperBuildId,
      runnerBuildId,
      policyEpoch,
      boundAt: new Date(now).toISOString(),
    };
  });
}

async function createHelperChallenge(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  protocol.requireValue(
      payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload).length === 0,
      "invalid_argument",
      "Helper challenge payload must be empty.",
  );
  const now = contextNow(context);
  const deviceSnapshot = await context.db
      .doc(`fleetDevices/${identity.deviceId}`)
      .get();
  const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
  verifyDeviceRow(device, identity);
  protocol.requireValue(
      device.platform === "linux",
      "failed_precondition",
      "Helper challenges require a Linux device.",
      409,
  );
  const challengeId = `chal_${randomHex(context, 16)}`;
  const nonce = randomToken(context, 32);
  const expiresAt = now + helperProtocol.HELPER_CHALLENGE_TTL_MS;
  const ref = context.db.doc(`fleetHelperChallenges/${challengeId}`);
  await context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    protocol.requireValue(
        !snapshot.exists,
        "conflict",
        "Helper challenge id is already in use.",
        409,
    );
    transaction.set(ref, {
      schemaVersion: protocol.PROTOCOL_VERSION,
      id: challengeId,
      ownerUid: identity.ownerUid,
      deviceId: identity.deviceId,
      nonceHash: nonceDigest(nonce),
      createdAt: timestamp(context, now),
      expiresAt: timestamp(context, expiresAt),
      consumedAt: null,
    });
  });
  return {
    challengeId,
    nonce,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

async function attestHelper(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  protocol.requireValue(
      payload && typeof payload === "object" && !Array.isArray(payload),
      "invalid_argument",
      "Helper attestation payload is required.",
  );
  requireOnlyKeys(payload, ["attestation"], "helper.attest");
  const attestation = helperProtocol.normalizeHelperAttestation(
      payload.attestation,
  );
  protocol.requireValue(
      attestation.deviceId === identity.deviceId,
      "permission_denied",
      "Helper attestation does not match this device.",
      403,
  );
  const now = contextNow(context);
  const issuedAtMs = helperProtocol.parseRfc3339Ms(
      attestation.issuedAt,
      "attestation.issuedAt",
  );
  const expiresAtMs = helperProtocol.parseRfc3339Ms(
      attestation.expiresAt,
      "attestation.expiresAt",
  );
  protocol.requireValue(
      issuedAtMs <= now + fleetAuth.MAX_CLOCK_SKEW_MS && expiresAtMs > now,
      "failed_precondition",
      "Helper attestation is expired or not yet valid.",
      409,
  );
  protocol.requireValue(
      expiresAtMs <= now + helperProtocol.MAX_ATTESTATION_LIFETIME_MS,
      "invalid_argument",
      "Helper attestation lifetime exceeds the maximum.",
  );
  helperProtocol.requireAllowedHelperProfile(attestation);
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  const bindingRef = context.db.doc(`fleetHelperBindings/${identity.deviceId}`);
  const challengeRef = context.db.doc(
      `fleetHelperChallenges/${attestation.challengeId}`,
  );
  const attestationRef = context.db.doc(
      `fleetHelperAttestations/${identity.deviceId}`,
  );
  return context.db.runTransaction(async (transaction) => {
    const [deviceSnapshot, bindingSnapshot, challengeSnapshot] =
      await Promise.all([
        transaction.get(deviceRef),
        transaction.get(bindingRef),
        transaction.get(challengeRef),
      ]);
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    verifyDeviceRow(device, identity);
    protocol.requireValue(
        device.platform === "linux",
        "failed_precondition",
        "Helper attestation requires a Linux device.",
        409,
    );
    const binding = bindingSnapshot.exists ? bindingSnapshot.data() : null;
    protocol.requireValue(
        binding && binding.ownerUid === identity.ownerUid,
        "failed_precondition",
        "No helper binding exists for this device.",
        409,
    );
    const challenge = challengeSnapshot.exists ? challengeSnapshot.data() : null;
    protocol.requireValue(
        challenge &&
          challenge.ownerUid === identity.ownerUid &&
          challenge.deviceId === identity.deviceId &&
          challenge.consumedAt == null &&
          protocol.toMillis(challenge.expiresAt) > now &&
          safeEqual(challenge.nonceHash, nonceDigest(attestation.challengeNonce)),
        "failed_precondition",
        "Helper challenge is invalid, expired, or already used.",
        409,
    );
    protocol.requireValue(
        binding.executionServiceId === attestation.executionServiceId &&
          binding.helperBuildId === attestation.helperBuildId &&
          binding.runnerBuildId === attestation.runnerBuildId,
        "permission_denied",
        "Helper attestation does not match the device binding.",
        403,
    );
    protocol.requireValue(
        attestation.policyEpoch >= Number(binding.policyEpoch),
        "failed_precondition",
        "Helper attestation policy epoch is stale.",
        409,
    );
    helperProtocol.verifyHelperAttestationSignature(
        attestation,
        binding.helperPublicKeySpki,
    );
    const {signature: _signature, ...unsigned} = attestation;
    const stored = {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: identity.ownerUid,
      deviceId: identity.deviceId,
      executionServiceId: attestation.executionServiceId,
      helperInstanceId: attestation.helperInstanceId,
      bootIdDigest: attestation.bootIdDigest,
      helperProtocol: attestation.helperProtocol,
      helperBuildId: attestation.helperBuildId,
      runnerBuildId: attestation.runnerBuildId,
      policyEpoch: attestation.policyEpoch,
      platform: attestation.platform,
      security: attestation.security,
      helperKeyId: binding.helperKeyId,
      attestationDigest: helperProtocol.signedPayloadDigest(unsigned),
      issuedAt: timestamp(context, issuedAtMs),
      expiresAt: timestamp(context, expiresAtMs),
      acceptedAt: timestamp(context, now),
    };
    transaction.set(challengeRef, {
      ...challenge,
      consumedAt: timestamp(context, now),
    });
    transaction.set(attestationRef, stored);
    return {
      deviceId: identity.deviceId,
      executionServiceId: attestation.executionServiceId,
      helperInstanceId: attestation.helperInstanceId,
      helperProtocol: attestation.helperProtocol,
      policyEpoch: attestation.policyEpoch,
      attestationDigest: stored.attestationDigest,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  });
}

async function queryPages(
    query,
    pageSize,
    maximumPages = 5,
    initialCursor = null,
) {
  const rows = [];
  let cursor = initialCursor;
  let hasMore = false;
  for (let page = 0; page < maximumPages; page += 1) {
    let pageQuery = query.limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    rows.push(...snapshot.docs);
    hasMore = snapshot.docs.length === pageSize;
    if (!hasMore) break;
    cursor = snapshot.docs.at(-1);
  }
  return {docs: rows, hasMore};
}

async function recoverExpiredDeviceLeases(identity, device, now, context) {
  const leaseIds = [...new Set(
      (Array.isArray(device.activeLeaseIds) ? device.activeLeaseIds : [])
          .filter((value) => protocol.LEASE_ID_PATTERN.test(value))
          .slice(0, 128),
  )];
  const recordedReservation = resourceReservation(device.reservedResources);
  if (
    leaseIds.length === 0 &&
    Object.values(recordedReservation).every((value) => value === 0)
  ) {
    return;
  }
  const snapshots = await Promise.all(
      leaseIds.map((leaseId) =>
        context.db.doc(`fleetLeases/${leaseId}`).get()),
  );
  for (let index = 0; index < leaseIds.length; index += 1) {
    const lease = snapshots[index].exists ? snapshots[index].data() : null;
    if (!lease) {
      const jobs = await context.db.collection("fleetJobs")
          .where("activeLeaseId", "==", leaseIds[index])
          .limit(2)
          .get();
      for (const doc of jobs.docs) {
        const job = doc.data();
        if (
          job?.ownerUid === identity.ownerUid &&
          job.assignedDeviceId === identity.deviceId &&
          !protocol.TERMINAL_STATES.has(job.state)
        ) {
          await recoverJob(identity.ownerUid, {jobId: doc.id}, context);
        }
      }
      continue;
    }
    if (
      lease.ownerUid !== identity.ownerUid ||
      lease.deviceId !== identity.deviceId ||
      lease.releasedAt
    ) {
      continue;
    }
    if (protocol.toMillis(lease.expiresAt) <= now) {
      await recoverJob(identity.ownerUid, {jobId: lease.jobId}, context);
    }
  }
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  await context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(deviceRef);
    const row = snapshot.exists ? snapshot.data() : null;
    verifyDeviceRow(row, identity);
    const candidateLeaseIds = [...new Set(
        (Array.isArray(row.activeLeaseIds) ? row.activeLeaseIds : [])
        .filter((leaseId) => protocol.LEASE_ID_PATTERN.test(leaseId))
        .slice(0, 128),
    )];
    const currentLeaseSnapshots = await Promise.all(
        candidateLeaseIds.map((leaseId) =>
          transaction.get(context.db.doc(`fleetLeases/${leaseId}`))),
    );
    const activeLeases = currentLeaseSnapshots
        .map((leaseSnapshot) =>
          leaseSnapshot.exists ? leaseSnapshot.data() : null)
        .filter((lease) =>
          lease &&
          lease.ownerUid === identity.ownerUid &&
          lease.deviceId === identity.deviceId &&
          !lease.releasedAt &&
          protocol.toMillis(lease.expiresAt) > now);
    const activeLeaseIds = activeLeases.map((lease) => lease.id);
    const reservedResources = activeLeases.reduce(
        (total, lease) =>
          addResourceReservation(total, lease.resourceRequest),
        resourceReservation(),
    );
    transaction.set(deviceRef, {
      ...row,
      activeLeaseIds,
      activeJobs: activeLeaseIds.length,
      reservedResources,
      updatedAt: timestamp(context, now),
    });
  });
}

async function pollJobs(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  const now = contextNow(context);
  const limit = protocol.boundedInteger(
      payload?.limit,
      1,
      50,
      "limit",
      20,
  );
  const cursorJobId = payload?.cursorJobId == null ?
    null :
    protocol.cleanString(payload.cursorJobId, 64, "cursorJobId");
  protocol.requireValue(
      cursorJobId == null || protocol.JOB_ID_PATTERN.test(cursorJobId),
      "invalid_argument",
      "Invalid job poll cursor.",
  );
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  let deviceSnapshot = await deviceRef.get();
  let device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
  verifyDeviceRow(device, identity);
  await recoverExpiredDeviceLeases(identity, device, now, context);
  deviceSnapshot = await deviceRef.get();
  device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
  verifyDeviceRow(device, identity);
  let attestation = null;
  if (device.platform === "linux") {
    const attestationSnapshot = await context.db
        .doc(`fleetHelperAttestations/${identity.deviceId}`)
        .get();
    attestation = attestationSnapshot.exists ? attestationSnapshot.data() : null;
  }
  let initialJobCursor = null;
  if (cursorJobId) {
    const cursorSnapshot = await context.db.doc(`fleetJobs/${cursorJobId}`).get();
    if (cursorSnapshot.exists &&
        cursorSnapshot.data().ownerUid === identity.ownerUid) {
      initialJobCursor = cursorSnapshot;
    }
  }
  const [jobPage, grantPage] = await Promise.all([
    queryPages(
        context.db.collection("fleetJobs")
        .where("ownerUid", "==", identity.ownerUid)
        .where("state", "==", "queued")
        .orderBy("createdAt", "asc"),
        limit,
        5,
        initialJobCursor,
    ),
    queryPages(
        context.db.collection("fleetGrants")
        .where("ownerUid", "==", identity.ownerUid)
        .where("receipt.workerDeviceId", "==", identity.deviceId)
        .where("revokedAt", "==", null)
        .where("receipt.expiresAt", ">", timestamp(context, now))
        .orderBy("receipt.expiresAt", "desc"),
        50,
    ),
  ]);
  const dependencyIds = new Set();
  const jobDocs = [];
  for (const doc of jobPage.docs) {
    const nextDependencyIds = (doc.data().dependencies || [])
        .filter((dependencyId) => !dependencyIds.has(dependencyId));
    if (
      dependencyIds.size + nextDependencyIds.length >
        MAX_POLL_DEPENDENCY_READS
    ) {
      break;
    }
    jobDocs.push(doc);
    for (const dependencyId of nextDependencyIds) {
      dependencyIds.add(dependencyId);
    }
  }
  const dependencyBudgetReached = jobDocs.length < jobPage.docs.length;
  const grantDocs = grantPage.docs;
  const jobs = jobDocs.map((doc) => ({id: doc.id, ...doc.data()}));
  const grants = grantDocs.map((doc) => ({id: doc.id, ...doc.data()}));
  const artifactsReady = jobs.some(jobRequiresArtifactStore) ?
    await artifactStoreReady(context) :
    true;
  const controllerRows = new Map();
  const controllerIds = [...new Set(
    grants.map((grant) => grant.receipt.controllerDeviceId),
  )];
  await Promise.all(controllerIds.map(async (controllerId) => {
    const snapshot = await context.db.doc(`fleetDevices/${controllerId}`).get();
    controllerRows.set(
        controllerId,
        snapshot.exists ? snapshot.data() : null,
    );
  }));
  const dependencyRows = new Map();
  await Promise.all([...dependencyIds].map(async (dependencyId) => {
    const snapshot = await context.db.doc(`fleetJobs/${dependencyId}`).get();
    dependencyRows.set(
        dependencyId,
        snapshot.exists ? snapshot.data() : null,
    );
  }));
  for (const job of jobs) {
    if (jobRequiresArtifactStore(job) && !artifactsReady) continue;
    if (
      job.cancellationRequestedAt ||
      protocol.toMillis(job.deadlineAt) <= now ||
      Number(job.attempt) >= Number(job.maxAttempts)
    ) {
      await recoverJob(identity.ownerUid, {jobId: job.id}, context);
      continue;
    }
    const dependencyFailed = (job.dependencies || []).some((dependencyId) => {
      const dependency = dependencyRows.get(dependencyId);
      return dependency?.ownerUid !== identity.ownerUid ||
        (protocol.TERMINAL_STATES.has(dependency?.state) &&
          dependency.state !== "succeeded");
    });
    if (dependencyFailed) {
      await recoverJob(identity.ownerUid, {jobId: job.id}, context);
      continue;
    }
    const dependenciesReady = (job.dependencies || []).every((dependencyId) => {
      const dependency = dependencyRows.get(dependencyId);
      return dependency?.ownerUid === identity.ownerUid &&
        dependency.state === "succeeded";
    });
    if (!dependenciesReady) continue;
    const grant = grants.find((candidate) =>
      deviceEligible(
          job,
          device,
          candidate,
          controllerRows.get(candidate.receipt.controllerDeviceId),
          now,
          attestation,
      ).length === 0);
    if (!grant) continue;
    return {
      assignment: {
        protocolVersion: protocol.PROTOCOL_VERSION,
        jobId: job.id,
        jobRevision: Number(job.revision),
        grantId: grant.id,
      },
      retryAfterMs: 0,
    };
  }
  return {
    assignment: null,
    cursorJobId: jobPage.hasMore || dependencyBudgetReached ?
      jobDocs.at(-1)?.id || null :
      null,
    retryAfterMs: jobPage.hasMore || dependencyBudgetReached ? 250 : 5_000,
  };
}

async function claimJob(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  protocol.requireValue(
      payload?.deviceId == null || payload.deviceId === identity.deviceId,
      "permission_denied",
      "A worker cannot claim for another device.",
      403,
  );
  protocol.requireValue(
      protocol.LEASE_ID_PATTERN.test(payload?.leaseId || "") &&
        /^[A-Za-z0-9_-]{43,128}$/.test(payload?.leaseNonce || ""),
      "invalid_argument",
      "A worker claim requires a unique lease id and nonce.",
  );
  return leaseJob(identity.ownerUid, {
    jobId: payload?.jobId,
    deviceId: identity.deviceId,
    grantId: payload?.grantId,
    leaseId: payload?.leaseId,
    leaseNonce: payload?.leaseNonce,
    ttlMs: payload?.ttlMs,
  }, context);
}

// Called after an enrolled controller signs an exact grant receipt. The HTTP
// account API must not expose this helper without checking that signature.
async function createGrant(uid, payload, context) {
  const now = contextNow(context);
  const normalized = protocol.normalizeGrant(payload, uid, now);
  const controllerRef = context.db.doc(
      `fleetDevices/${normalized.controllerDeviceId}`,
  );
  const workerRef = context.db.doc(`fleetDevices/${normalized.workerDeviceId}`);
  const grantRef = context.db.doc(`fleetGrants/${normalized.id}`);
  const receiptDigest = protocol.requestDigest({
    ...normalized,
    issuedAt: null,
  });
  return context.db.runTransaction(async (transaction) => {
    const [controllerSnapshot, workerSnapshot, existingSnapshot] =
      await Promise.all([
        transaction.get(controllerRef),
        transaction.get(workerRef),
        transaction.get(grantRef),
      ]);
    const controller = controllerSnapshot.exists ? controllerSnapshot.data() : null;
    const worker = workerSnapshot.exists ? workerSnapshot.data() : null;
    requireOwned(controller, uid, "Controller");
    requireOwned(worker, uid, "Worker");
    protocol.requireValue(
        controller.status === "active" &&
          ["controller", "hybrid"].includes(controller.role),
        "failed_precondition",
        "Controller is not active.",
        409,
    );
    protocol.requireValue(
        worker.status === "active" && ["worker", "hybrid"].includes(worker.role),
        "failed_precondition",
        "Worker is not active.",
        409,
    );
    const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
    if (existing) {
      requireOwned(existing, uid, "Grant");
      protocol.requireValue(
          existing.receiptDigest === receiptDigest,
          "conflict",
          "Grant id is already in use.",
          409,
      );
      return grantView(normalized.id, existing);
    }
    const stored = {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: uid,
      receipt: {
        ...normalized,
        issuedAt: timestamp(context, normalized.issuedAt),
        expiresAt: timestamp(context, normalized.expiresAt),
      },
      receiptDigest,
      revokedAt: null,
      createdAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(grantRef, stored);
    return grantView(normalized.id, stored);
  });
}

function grantView(id, row) {
  return {
    id,
    ownerUid: row.ownerUid,
    controllerDeviceId: row.receipt.controllerDeviceId,
    workerDeviceId: row.receipt.workerDeviceId,
    workspaceIds: row.receipt.workspaceIds,
    repositoryIdentities: Array.isArray(row.receipt.repositoryIdentities) ?
      row.receipt.repositoryIdentities :
      [],
    capabilities: row.receipt.capabilities,
    unattended: row.receipt.unattended,
    policyVersion: row.receipt.policyVersion,
    executionServiceId: row.receipt.executionServiceId ?? null,
    executorProfileIds: row.receipt.executorProfileIds ?? null,
    sandboxProfileIds: row.receipt.sandboxProfileIds ?? null,
    networkProfileIds: row.receipt.networkProfileIds ?? null,
    resourceCeilings: row.receipt.resourceCeilings ?? null,
    minimumHelperProtocol: row.receipt.minimumHelperProtocol ?? null,
    minimumPolicyEpoch: row.receipt.minimumPolicyEpoch ?? null,
    issuedAt: publicTime(row.receipt.issuedAt),
    expiresAt: publicTime(row.receipt.expiresAt),
    revokedAt: publicTime(row.revokedAt),
  };
}

function grantAllows(row, job, device, controller, now) {
  if (
    !row ||
    row.ownerUid !== job.ownerUid ||
    row.revokedAt ||
    row.receipt.unattended !== true ||
    row.receipt.policyVersion !== 1 ||
    job.authorizedByControllerDeviceId !==
      row.receipt.controllerDeviceId ||
    row.receipt.workerDeviceId !== device.id ||
    protocol.toMillis(row.receipt.issuedAt) > now ||
    protocol.toMillis(row.receipt.expiresAt) <= now
  ) {
    return false;
  }
  if (
    !controller ||
    controller.id !== row.receipt.controllerDeviceId ||
    controller.ownerUid !== job.ownerUid ||
    controller.status !== "active" ||
    !["controller", "hybrid"].includes(controller.role)
  ) {
    return false;
  }
  if (
    !row.receipt.workspaceIds.includes("*") &&
    !row.receipt.workspaceIds.includes(job.workspaceId)
  ) {
    return false;
  }
  if (
    typeof job.workspaceSnapshot?.repositoryIdentity !== "string" ||
    !Array.isArray(row.receipt.repositoryIdentities) ||
    !row.receipt.repositoryIdentities.includes(
        job.workspaceSnapshot.repositoryIdentity,
    )
  ) {
    return false;
  }
  const capabilities = new Set(row.receipt.capabilities);
  return job.requiredCapabilities.every((capability) =>
    capabilities.has(capability));
}

function deviceEligible(job, device, grant, controller, now, attestation = null) {
  const reasons = [];
  if (device.ownerUid !== job.ownerUid) reasons.push("owner-mismatch");
  if (device.status !== "active") reasons.push("device-revoked");
  if (device.platform === "linux") {
    if (!attestation) {
      reasons.push("execution-attestation-missing");
    } else if (!freshLinuxAttestation(attestation, now)) {
      reasons.push("execution-attestation-expired");
    } else if (!linuxAttestationPolicyAllows(attestation, grant)) {
      reasons.push("execution-attestation-policy");
    }
  }
  if (!["auto", "independent"].includes(job.approvalPolicy)) {
    reasons.push("approval-required");
  }
  if (protocol.toMillis(device.lastSeenAt) + protocol.DEVICE_ONLINE_WINDOW_MS < now) {
    reasons.push("device-offline");
  }
  if (
    Number(device.protocolMinimum) > protocol.PROTOCOL_VERSION ||
    Number(device.protocolMaximum) < protocol.PROTOCOL_VERSION
  ) {
    reasons.push("protocol-incompatible");
  }
  if (device.workerMode === "disabled") reasons.push("worker-disabled");
  if (
    device.workerMode === "opt-in" &&
    job.target.allowControllerAsWorker !== true
  ) {
    reasons.push("worker-not-opted-in");
  }
  if (
    job.target.deviceIds.length > 0 &&
    !job.target.deviceIds.includes(device.id)
  ) {
    reasons.push("not-targeted");
  }
  if (
    job.target.platforms.length > 0 &&
    !job.target.platforms.includes(device.platform)
  ) {
    reasons.push("platform-mismatch");
  }
  const supported = new Set(device.capabilities || []);
  if (job.requiredCapabilities.some((capability) => !supported.has(capability))) {
    reasons.push("capability-unavailable");
  }
  // Linux executables resolve through the signed ticket and the runner's
  // fixed root-owned search path, so self-reported executable lists carry no
  // authority and are never consulted for Linux workers.
  if (job.execution?.kind === "command" && device.platform !== "linux") {
    const canonicalExecutable = (value) =>
      device.platform === "win32" ? String(value).toLowerCase() : String(value);
    const executables = new Set(
        (device.executables || []).map(canonicalExecutable),
    );
    if (!executables.has(canonicalExecutable(job.execution.executable))) {
      reasons.push("executable-unavailable");
    }
  }
  if (!grantAllows(grant, job, device, controller, now)) {
    reasons.push("grant-missing");
  }
  if (Number(device.activeJobs) >= Number(device.maxConcurrentJobs)) {
    reasons.push("concurrency-full");
  }
  const available = device.resources || {};
  const reserved = resourceReservation(device.reservedResources);
  const requested = job.resources || {};
  if (
    Math.max(0, Number(available.cpuAvailable || 0) - reserved.cpuLogical) <
      Number(requested.cpuLogical || 0)
  ) {
    reasons.push("cpu-insufficient");
  }
  if (
    Math.max(
        0,
        Number(available.memoryAvailableBytes || 0) - reserved.memoryBytes,
    ) <
      Number(requested.memoryBytes || 0)
  ) {
    reasons.push("memory-insufficient");
  }
  if (
    Math.max(
        0,
        Number(available.diskAvailableBytes || 0) -
          reserved.diskAvailableBytes,
    ) <
      Number(requested.diskAvailableBytes || 0)
  ) {
    reasons.push("disk-insufficient");
  }
  if (
    Math.max(0, Number(available.gpuCount || 0) - reserved.gpuCount) <
      Number(requested.gpuCount || 0)
  ) {
    reasons.push("gpu-insufficient");
  }
  return reasons;
}

async function leaseJob(uid, payload, context) {
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  const deviceId = protocol.cleanString(payload?.deviceId, 64, "deviceId");
  const grantId = protocol.cleanString(payload?.grantId, 64, "grantId");
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId) &&
        protocol.DEVICE_ID_PATTERN.test(deviceId) &&
        protocol.GRANT_ID_PATTERN.test(grantId),
      "invalid_argument",
      "Invalid lease target.",
  );
  const now = contextNow(context);
  const ttlMs = protocol.boundedInteger(
      payload?.ttlMs,
      MIN_LEASE_TTL_MS,
      MAX_LEASE_TTL_MS,
      "ttlMs",
      DEFAULT_LEASE_TTL_MS,
  );
  const requestedLeaseId = payload?.leaseId == null ?
    null :
    protocol.cleanString(payload.leaseId, 64, "leaseId");
  const requestedNonce = payload?.leaseNonce == null ?
    null :
    protocol.cleanString(payload.leaseNonce, 128, "leaseNonce");
  protocol.requireValue(
      (requestedLeaseId == null && requestedNonce == null) ||
        (
          protocol.LEASE_ID_PATTERN.test(requestedLeaseId || "") &&
          /^[A-Za-z0-9_-]{43,128}$/.test(requestedNonce || "")
        ),
      "invalid_argument",
      "A requested lease id and nonce must be supplied together.",
  );
  const leaseId = requestedLeaseId || `lease_${randomHex(context, 16)}`;
  const nonce = requestedNonce || randomToken(context, 32);
  const ticketIdCandidate = `ticket_${randomHex(context, 16)}`;
  const jobRef = context.db.doc(`fleetJobs/${jobId}`);
  const deviceRef = context.db.doc(`fleetDevices/${deviceId}`);
  const grantRef = context.db.doc(`fleetGrants/${grantId}`);
  const leaseRef = context.db.doc(`fleetLeases/${leaseId}`);
  const artifactJobSnapshot = await jobRef.get();
  if (
    artifactJobSnapshot.exists &&
    artifactJobSnapshot.data().ownerUid === uid
  ) {
    await requireArtifactStoreReady(artifactJobSnapshot.data(), context);
  }

  const result = await context.db.runTransaction(async (transaction) => {
    const [jobSnapshot, deviceSnapshot, grantSnapshot, existingLeaseSnapshot] =
      await Promise.all([
        transaction.get(jobRef),
        transaction.get(deviceRef),
        transaction.get(grantRef),
        transaction.get(leaseRef),
      ]);
    const job = jobSnapshot.exists ? jobSnapshot.data() : null;
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
    const existingLease = existingLeaseSnapshot.exists ?
      existingLeaseSnapshot.data() :
      null;
    requireOwned(job, uid, "Job");
    requireOwned(device, uid, "Device");
    requireOwned(grant, uid, "Grant");
    const controllerSnapshot = await transaction.get(
        context.db.doc(`fleetDevices/${grant.receipt.controllerDeviceId}`),
    );
    const controller = controllerSnapshot.exists ?
      controllerSnapshot.data() :
      null;
    const attestation = device.platform === "linux" ?
      await readLinuxAttestation(transaction, context, deviceId) :
      null;
    protocol.requireValue(
        grantAllows(grant, job, device, controller, now),
        "permission_denied",
        "The capability grant is no longer valid.",
        403,
    );
    if (existingLease) {
      protocol.requireValue(
          existingLease.ownerUid === uid &&
            existingLease.jobId === jobId &&
            existingLease.deviceId === deviceId &&
            existingLease.grantId === grantId &&
            existingLease.releasedAt == null &&
            protocol.toMillis(existingLease.expiresAt) > now &&
            safeEqual(existingLease.nonceHash, nonceDigest(nonce)),
          "conflict",
          "Lease id is already in use.",
          409,
      );
      const expiresAt = protocol.toMillis(existingLease.expiresAt);
      let replayedTicket = null;
      if (device.platform === "linux") {
        // Re-issuing under an expired attestation would mint new signed
        // authority, so replayed claims stay attestation-gated too.
        requireLinuxExecutionAuthority(
            device,
            attestation,
            now,
            "to reissue an execution ticket",
        );
        replayedTicket = await issueLinuxExecutionTicket({
          context,
          job,
          jobId,
          device,
          grant,
          attestation,
          attempt: Number(existingLease.attempt),
          leaseId,
          leaseSequence: existingLease.leaseSequence,
          ticketId: existingLease.ticketId,
          now,
          leaseExpiresAt: expiresAt,
        });
      }
      return {
        job: jobView(jobId, job),
        expiresAt,
        lease: {
          id: leaseId,
          nonce,
          deviceId,
          jobId,
          attempt: Number(existingLease.attempt),
          expiresAt: new Date(expiresAt).toISOString(),
        },
        ...(replayedTicket ? {executionTicket: replayedTicket} : {}),
      };
    }
    protocol.requireValue(
        job.state === "queued" && !job.cancellationRequestedAt,
        "failed_precondition",
        "Job is not ready to lease.",
        409,
    );
    protocol.requireValue(
        protocol.toMillis(job.deadlineAt) > now,
        "failed_precondition",
        "Job deadline has expired.",
        409,
    );
    const dependencySnapshots = await Promise.all(
        (job.dependencies || []).map((dependencyId) =>
          transaction.get(context.db.doc(`fleetJobs/${dependencyId}`))),
    );
    for (const dependencySnapshot of dependencySnapshots) {
      const dependency = dependencySnapshot.exists ?
        dependencySnapshot.data() :
        null;
      protocol.requireValue(
          dependency &&
            dependency.ownerUid === uid &&
            dependency.state === "succeeded",
          "failed_precondition",
          "Job dependencies are not satisfied.",
          409,
      );
    }
    const reasons = deviceEligible(job, device, grant, controller, now, attestation);
    protocol.requireValue(
        reasons.length === 0,
        "failed_precondition",
        `Worker is not eligible: ${reasons.join(", ")}.`,
        409,
    );
    const attempt = Number(job.attempt) + 1;
    protocol.requireValue(
        attempt <= Number(job.maxAttempts),
        "failed_precondition",
        "Job has no attempts remaining.",
        409,
    );

    const resourceRefs = job.exclusiveResources.map((resourceKey) =>
      context.db.doc(
          `fleetResourceLeases/${resourceLeaseId(uid, resourceKey)}`,
      ));
    for (const ref of resourceRefs) {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) continue;
      const row = snapshot.data();
      protocol.requireValue(
          row.releasedAt || protocol.toMillis(row.expiresAt) <= now,
          "conflict",
          "An exclusive resource is already leased.",
          409,
      );
    }

    const expiresAt = Math.min(now + ttlMs, protocol.toMillis(job.deadlineAt));
    let executionTicket = null;
    if (device.platform === "linux") {
      executionTicket = await issueLinuxExecutionTicket({
        context,
        job,
        jobId,
        device,
        grant,
        attestation,
        attempt,
        leaseId,
        leaseSequence: 0,
        ticketId: ticketIdCandidate,
        now,
        leaseExpiresAt: expiresAt,
      });
    }
    const lease = {
      schemaVersion: protocol.PROTOCOL_VERSION,
      id: leaseId,
      ownerUid: uid,
      jobId,
      deviceId,
      grantId,
      attempt,
      nonceHash: nonceDigest(nonce),
      resourceKeys: job.exclusiveResources,
      resourceRequest: resourceReservation(job.resources),
      leaseSequence: 0,
      ...(executionTicket ? {
        ticketId: executionTicket.ticketId,
        helperInstanceId: attestation.helperInstanceId,
      } : {}),
      issuedAt: timestamp(context, now),
      heartbeatAt: timestamp(context, now),
      expiresAt: timestamp(context, expiresAt),
      releasedAt: null,
    };
    transaction.set(leaseRef, lease);
    for (let index = 0; index < resourceRefs.length; index += 1) {
      transaction.set(resourceRefs[index], {
        schemaVersion: protocol.PROTOCOL_VERSION,
        ownerUid: uid,
        resourceKey: job.exclusiveResources[index],
        leaseId,
        jobId,
        deviceId,
        expiresAt: timestamp(context, expiresAt),
        releasedAt: null,
        updatedAt: timestamp(context, now),
      });
    }
    const updatedJob = {
      ...job,
      state: "leased",
      attempt,
      assignedDeviceId: deviceId,
      activeLeaseId: leaseId,
      revision: Number(job.revision) + 1,
      updatedAt: timestamp(context, now),
    };
    const claimResult = {
      job: jobView(jobId, updatedJob),
      expiresAt,
      lease: {
        id: leaseId,
        nonce,
        deviceId,
        jobId,
        attempt,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      ...(executionTicket ? {executionTicket} : {}),
    };
    // Device responses sign a canonical digest after the handler returns.
    // Preflight the exact claim result before any transactional mutation so a
    // legacy oversized job cannot consume an attempt or worker capacity.
    fleetAuth.canonicalJson(claimResult);
    transaction.set(jobRef, updatedJob);
    transaction.set(deviceRef, {
      ...device,
      activeJobs: Number(device.activeJobs || 0) + 1,
      reservedResources: addResourceReservation(
          device.reservedResources,
          job.resources,
      ),
      activeLeaseIds: [...new Set([
        ...(Array.isArray(device.activeLeaseIds) ? device.activeLeaseIds : []),
        leaseId,
      ])].slice(-128),
      updatedAt: timestamp(context, now),
    });
    return claimResult;
  });

  return result;
}

function requireLease(row, credential, identity, now) {
  protocol.requireValue(row, "permission_denied", "Lease is not valid.", 403);
  protocol.requireValue(
      row.ownerUid === identity.ownerUid &&
        row.deviceId === identity.deviceId &&
        row.id === credential.leaseId &&
        row.releasedAt == null &&
        protocol.toMillis(row.expiresAt) > now &&
        safeEqual(row.nonceHash, nonceDigest(credential.nonce)),
      "permission_denied",
      "Lease is not valid or has expired.",
      403,
  );
}

function normalizeLeaseCredential(payload) {
  const leaseId = protocol.cleanString(payload?.leaseId, 64, "leaseId");
  protocol.requireValue(
      protocol.LEASE_ID_PATTERN.test(leaseId),
      "invalid_argument",
      "Invalid lease id.",
  );
  return {
    leaseId,
    nonce: protocol.cleanString(payload?.nonce, 128, "nonce"),
  };
}

async function renewLease(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  const credential = normalizeLeaseCredential(payload);
  const now = contextNow(context);
  const ttlMs = protocol.boundedInteger(
      payload?.ttlMs,
      MIN_LEASE_TTL_MS,
      MAX_LEASE_TTL_MS,
      "ttlMs",
      DEFAULT_LEASE_TTL_MS,
  );
  const ref = context.db.doc(`fleetLeases/${credential.leaseId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    requireLease(row, credential, identity, now);
    const jobRef = context.db.doc(`fleetJobs/${row.jobId}`);
    const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
    const grantRef = context.db.doc(`fleetGrants/${row.grantId}`);
    const [jobSnapshot, deviceSnapshot, grantSnapshot] = await Promise.all([
        transaction.get(jobRef),
        transaction.get(deviceRef),
        transaction.get(grantRef),
    ]);
    const job = jobSnapshot.exists ? jobSnapshot.data() : null;
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
    requireOwned(job, identity.ownerUid, "Job");
    verifyDeviceRow(device, identity);
    const isLinux = device.platform === "linux";
    const attestation = isLinux ?
      await readLinuxAttestation(transaction, context, identity.deviceId) :
      null;
    requireLinuxExecutionAuthority(device, attestation, now, "before lease renewal");
    const controllerSnapshot = grant ?
      await transaction.get(
          context.db.doc(`fleetDevices/${grant.receipt.controllerDeviceId}`),
      ) :
      null;
    const controller = controllerSnapshot?.exists ?
      controllerSnapshot.data() :
      null;
    protocol.requireValue(
        grantAllows(grant, job, device, controller, now),
        "permission_denied",
        "The capability grant is no longer valid.",
        403,
    );
    protocol.requireValue(
        job.activeLeaseId === row.id &&
          job.assignedDeviceId === identity.deviceId &&
          Number(job.attempt) === Number(row.attempt) &&
          !protocol.TERMINAL_STATES.has(job.state),
        "conflict",
        "Job is no longer bound to this lease.",
        409,
    );
    if (job.cancellationRequestedAt) {
      let cancellationUpdate = null;
      if (isLinux) {
        const sequence = nextLeaseSequence(row);
        transaction.set(ref, {...row, leaseSequence: sequence});
        cancellationUpdate = await issueLinuxLeaseUpdate({
          context,
          lease: row,
          sequence,
          cancelled: true,
          leaseExpiresAt: protocol.toMillis(row.expiresAt),
          now,
        });
      }
      return {
        leaseId: row.id,
        expiresAt: publicTime(row.expiresAt),
        cancellationRequested: true,
        deadlineAt: publicTime(job.deadlineAt),
        ...(cancellationUpdate ? {leaseUpdate: cancellationUpdate} : {}),
      };
    }
    const deadlineAt = protocol.toMillis(job.deadlineAt);
    protocol.requireValue(
        deadlineAt > now,
        "failed_precondition",
        "Job deadline has expired.",
        409,
    );
    const expiresAt = Math.min(now + ttlMs, deadlineAt);
    const updated = {
      ...row,
      heartbeatAt: timestamp(context, now),
      expiresAt: timestamp(context, expiresAt),
    };
    let leaseUpdate = null;
    if (isLinux) {
      const sequence = nextLeaseSequence(row);
      updated.leaseSequence = sequence;
      leaseUpdate = await issueLinuxLeaseUpdate({
        context,
        lease: row,
        sequence,
        cancelled: false,
        leaseExpiresAt: expiresAt,
        now,
      });
    }
    const resourceUpdates = [];
    for (const resourceKey of row.resourceKeys || []) {
      const resourceRef = context.db.doc(
          `fleetResourceLeases/${resourceLeaseId(row.ownerUid, resourceKey)}`,
      );
      const resourceSnapshot = await transaction.get(resourceRef);
      const resource = resourceSnapshot.exists ?
        resourceSnapshot.data() :
        null;
      protocol.requireValue(
          resource &&
            resource.leaseId === row.id &&
            !resource.releasedAt &&
            protocol.toMillis(resource.expiresAt) > now,
          "conflict",
          "An exclusive resource lease was lost.",
          409,
      );
      resourceUpdates.push([resourceRef, {
        ...resource,
        expiresAt: timestamp(context, expiresAt),
        updatedAt: timestamp(context, now),
      }]);
    }
    transaction.set(ref, updated);
    for (const [resourceRef, resourceUpdate] of resourceUpdates) {
      transaction.set(resourceRef, resourceUpdate);
    }
    return {
      leaseId: row.id,
      expiresAt: new Date(expiresAt).toISOString(),
      cancellationRequested: Boolean(job.cancellationRequestedAt),
      deadlineAt: publicTime(job.deadlineAt),
      ...(leaseUpdate ? {leaseUpdate} : {}),
    };
  });
}

async function recoverJob(uid, payload, context) {
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId),
      "invalid_argument",
      "Invalid job id.",
  );
  const now = contextNow(context);
  const jobRef = context.db.doc(`fleetJobs/${jobId}`);
  return context.db.runTransaction(async (transaction) => {
    const jobSnapshot = await transaction.get(jobRef);
    const job = jobSnapshot.exists ? jobSnapshot.data() : null;
    requireOwned(job, uid, "Job");
    if (protocol.TERMINAL_STATES.has(job.state)) {
      return jobView(jobId, job);
    }
    if (job.state === "queued") {
      const dependencySnapshots = await Promise.all(
          (job.dependencies || []).map((dependencyId) =>
            transaction.get(context.db.doc(`fleetJobs/${dependencyId}`))),
      );
      const failedDependency = dependencySnapshots.some((snapshot) => {
        const dependency = snapshot.exists ? snapshot.data() : null;
        return dependency?.ownerUid !== uid ||
          (protocol.TERMINAL_STATES.has(dependency?.state) &&
            dependency.state !== "succeeded");
      });
      const nextState = job.cancellationRequestedAt ?
        "cancelled" :
        protocol.toMillis(job.deadlineAt) <= now ?
          "timed_out" :
          Number(job.attempt) >= Number(job.maxAttempts) || failedDependency ?
            "failed" :
            null;
      if (!nextState) return jobView(jobId, job);
      const updatedJob = {
        ...job,
        state: nextState,
        assignedDeviceId: null,
        activeLeaseId: null,
        revision: Number(job.revision) + 1,
        updatedAt: timestamp(context, now),
        finishedAt: timestamp(context, now),
      };
      transaction.set(jobRef, updatedJob);
      return jobView(jobId, updatedJob);
    }
    protocol.requireValue(
        typeof job.activeLeaseId === "string" &&
          protocol.LEASE_ID_PATTERN.test(job.activeLeaseId),
        "conflict",
        "Active job is missing its lease reference.",
        409,
    );
    const leaseRef = context.db.doc(`fleetLeases/${job.activeLeaseId}`);
    const deviceRef = job.assignedDeviceId ?
      context.db.doc(`fleetDevices/${job.assignedDeviceId}`) :
      null;
    const [leaseSnapshot, deviceSnapshot] = await Promise.all([
      transaction.get(leaseRef),
      deviceRef ? transaction.get(deviceRef) : Promise.resolve(null),
    ]);
    const lease = leaseSnapshot.exists ? leaseSnapshot.data() : null;
    if (lease) {
      requireOwned(lease, uid, "Lease");
      protocol.requireValue(
          lease.jobId === jobId &&
            lease.deviceId === job.assignedDeviceId &&
            Number(lease.attempt) === Number(job.attempt),
          "conflict",
          "Active lease does not match this job attempt.",
          409,
      );
      protocol.requireValue(
          lease.releasedAt || protocol.toMillis(lease.expiresAt) <= now,
          "failed_precondition",
          "The active lease has not expired.",
          409,
      );
    }

    const resourceUpdates = [];
    for (const resourceKey of lease?.resourceKeys ||
      job.exclusiveResources ||
      []) {
      const resourceRef = context.db.doc(
          `fleetResourceLeases/${resourceLeaseId(uid, resourceKey)}`,
      );
      const resourceSnapshot = await transaction.get(resourceRef);
      if (resourceSnapshot.exists &&
          resourceSnapshot.data().leaseId === job.activeLeaseId) {
        resourceUpdates.push([resourceRef, {
          ...resourceSnapshot.data(),
          releasedAt: timestamp(context, now),
          updatedAt: timestamp(context, now),
        }]);
      }
    }

    const deadlinePassed = protocol.toMillis(job.deadlineAt) <= now;
    const attemptsExhausted = Number(job.attempt) >= Number(job.maxAttempts);
    const executionOutcomeAmbiguous =
      ["preparing", "running", "needs_review", "waiting"].includes(job.state);
    const state = job.cancellationRequestedAt ?
      "cancelled" :
      deadlinePassed ?
        "timed_out" :
        attemptsExhausted || executionOutcomeAmbiguous ?
          "failed" :
          "queued";
    const terminal = protocol.TERMINAL_STATES.has(state);
    const updatedJob = {
      ...job,
      state,
      assignedDeviceId: null,
      activeLeaseId: null,
      revision: Number(job.revision) + 1,
      updatedAt: timestamp(context, now),
      ...(terminal ? {finishedAt: timestamp(context, now)} : {}),
      ...(state === "failed" && executionOutcomeAmbiguous ? {
        lastFailure: {
          code: "lease_expired_execution_ambiguous",
          retryable: false,
          terminationConfirmed: false,
          attempt: Number(job.attempt),
          at: timestamp(context, now),
        },
      } : {}),
    };
    transaction.set(jobRef, updatedJob);
    if (lease && !lease.releasedAt) {
      transaction.set(leaseRef, {
        ...lease,
        releasedAt: timestamp(context, now),
      });
    }
    const device = deviceSnapshot?.exists ? deviceSnapshot.data() : null;
    if (
      deviceRef &&
      device &&
      device.ownerUid === uid &&
      device.id === job.assignedDeviceId
    ) {
      transaction.set(deviceRef, {
        ...device,
        activeJobs: Math.max(0, Number(device.activeJobs || 0) - 1),
        reservedResources: subtractResourceReservation(
            device.reservedResources,
            lease?.resourceRequest || job.resources,
        ),
        activeLeaseIds: (Array.isArray(device.activeLeaseIds) ?
          device.activeLeaseIds :
          []).filter((leaseId) => leaseId !== job.activeLeaseId),
        updatedAt: timestamp(context, now),
      });
    }
    for (const [resourceRef, resourceUpdate] of resourceUpdates) {
      transaction.set(resourceRef, resourceUpdate);
    }
    return jobView(jobId, updatedJob);
  });
}

async function sweepExpiredFleetWork(context, {limit = 50} = {}) {
  const now = contextNow(context);
  const boundedLimit = protocol.boundedInteger(
      limit,
      1,
      100,
      "limit",
      50,
  );
  const nowTimestamp = timestamp(context, now);
  const [leaseSnapshot, queuedSnapshot] = await Promise.all([
    context.db.collection("fleetLeases")
        .where("releasedAt", "==", null)
        .where("expiresAt", "<=", nowTimestamp)
        .orderBy("expiresAt", "asc")
        .limit(boundedLimit)
        .get(),
    context.db.collection("fleetJobs")
        .where("state", "==", "queued")
        .where("deadlineAt", "<=", nowTimestamp)
        .orderBy("deadlineAt", "asc")
        .limit(boundedLimit)
        .get(),
  ]);
  const candidates = new Map();
  for (const doc of leaseSnapshot.docs) {
    const lease = doc.data();
    if (
      typeof lease?.ownerUid === "string" &&
      protocol.JOB_ID_PATTERN.test(lease?.jobId || "")
    ) {
      candidates.set(lease.jobId, lease.ownerUid);
    }
  }
  for (const doc of queuedSnapshot.docs) {
    const job = doc.data();
    if (
      typeof job?.ownerUid === "string" &&
      protocol.JOB_ID_PATTERN.test(doc.id)
    ) {
      candidates.set(doc.id, job.ownerUid);
    }
  }

  const summary = {
    scannedLeases: leaseSnapshot.docs.length,
    scannedQueuedJobs: queuedSnapshot.docs.length,
    recovered: 0,
    skipped: 0,
    failed: 0,
    hasMore:
      leaseSnapshot.docs.length === boundedLimit ||
      queuedSnapshot.docs.length === boundedLimit,
  };
  for (const [jobId, ownerUid] of candidates) {
    try {
      await recoverJob(ownerUid, {jobId}, context);
      summary.recovered += 1;
    } catch (error) {
      if (
        ["not_found", "conflict", "failed_precondition"].includes(error?.code)
      ) {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
      }
    }
  }
  return summary;
}

async function sweepExpiredArtifactUploads(context, {limit = 50} = {}) {
  const boundedLimit = protocol.boundedInteger(
      limit,
      1,
      100,
      "limit",
      50,
  );
  if (
    !context.artifactStore ||
    typeof context.artifactStore.deleteObject !== "function"
  ) {
    return {
      configured: false,
      scanned: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
      hasMore: false,
    };
  }
  const now = contextNow(context);
  const expiredBefore = now - ARTIFACT_UPLOAD_CLEANUP_GRACE_MS;
  const staleDeleteBefore = now - ARTIFACT_DELETE_LEASE_MS;
  const retentionBackfillRef = context.db.doc(
      "fleetMaintenance/artifactRetentionBackfill",
  );
  const retentionBackfillSnapshot = await retentionBackfillRef.get();
  const retentionBackfill = retentionBackfillSnapshot.exists ?
    retentionBackfillSnapshot.data() :
    null;
  const retentionBackfillComplete =
    protocol.toMillis(retentionBackfill?.completedAt) > 0;
  let retentionBackfillQuery = null;
  if (!retentionBackfillComplete) {
    retentionBackfillQuery = context.db.collection("fleetArtifacts")
        .where("state", "==", "ready")
        .orderBy(context.documentIdField || "__name__", "asc")
        .limit(boundedLimit);
    if (typeof retentionBackfill?.cursor === "string") {
      retentionBackfillQuery = retentionBackfillQuery.startAfter(
          retentionBackfill.cursor,
      );
    }
  }
  const [
    uploadSnapshot,
    readySnapshot,
    legacyReadySnapshot,
    retentionBackfillPage,
    deletingSnapshot,
  ] = await Promise.all([
    context.db.collection("fleetArtifacts")
        .where("state", "==", "uploading")
        .where("uploadExpiresAt", "<=", timestamp(context, expiredBefore))
        .orderBy("uploadExpiresAt", "asc")
        .limit(boundedLimit)
        .get(),
    context.db.collection("fleetArtifacts")
        .where("state", "==", "ready")
        .where("expiresAt", "<=", timestamp(context, now))
        .orderBy("expiresAt", "asc")
        .limit(boundedLimit)
        .get(),
    context.db.collection("fleetArtifacts")
        .where("state", "==", "ready")
        .where("expiresAt", "==", null)
        .limit(boundedLimit)
        .get(),
    retentionBackfillQuery ?
      retentionBackfillQuery.get() :
      Promise.resolve({docs: []}),
    context.db.collection("fleetArtifacts")
        .where("state", "==", "deleting")
        .where("cleanupStartedAt", "<=", timestamp(context, staleDeleteBefore))
        .orderBy("cleanupStartedAt", "asc")
        .limit(boundedLimit)
        .get(),
  ]);
  const retentionBackfillMissingIds = new Set(
      retentionBackfillPage.docs
          .filter((doc) => doc.data()?.expiresAt == null)
          .map((doc) => doc.id),
  );
  let retentionBackfillRetryRequired = false;
  const candidates = new Map();
  for (const snapshot of [
    uploadSnapshot,
    readySnapshot,
    legacyReadySnapshot,
    deletingSnapshot,
  ]) {
    for (const doc of snapshot.docs) candidates.set(doc.id, doc);
  }
  for (const doc of retentionBackfillPage.docs) {
    if (doc.data()?.expiresAt == null) candidates.set(doc.id, doc);
  }
  const summary = {
    configured: true,
    scanned: candidates.size,
    deleted: 0,
    skipped: 0,
    failed: 0,
    hasMore: [
      uploadSnapshot,
      readySnapshot,
      legacyReadySnapshot,
      deletingSnapshot,
    ]
        .some((snapshot) => snapshot.docs.length === boundedLimit) ||
      (
        !retentionBackfillComplete &&
        retentionBackfillPage.docs.length === boundedLimit
      ),
  };
  for (const doc of candidates.values()) {
    const cleanupToken = randomBytes(16).toString("hex");
    let cleanup;
    try {
      cleanup = await context.db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(doc.ref);
        const current = currentSnapshot.exists ? currentSnapshot.data() : null;
        const uploadExpiresAt = protocol.toMillis(current?.uploadExpiresAt);
        const expiresAt = protocol.toMillis(current?.expiresAt);
        const cleanupStartedAt = protocol.toMillis(current?.cleanupStartedAt);
        const expiredUpload =
          current?.state === "uploading" &&
          Number.isFinite(uploadExpiresAt) &&
          uploadExpiresAt > 0 &&
          uploadExpiresAt <= expiredBefore;
        const expiredReady =
          current?.state === "ready" &&
          Number.isFinite(expiresAt) &&
          expiresAt > 0 &&
          expiresAt <= now;
        const legacyReady =
          current?.state === "ready" && current.expiresAt == null;
        const staleDelete =
          current?.state === "deleting" &&
          Number.isFinite(cleanupStartedAt) &&
          cleanupStartedAt > 0 &&
          cleanupStartedAt <= staleDeleteBefore;
        if (!current || typeof current.objectKey !== "string" ||
            (!expiredUpload && !expiredReady && !legacyReady && !staleDelete)) {
          return null;
        }
        const previousState = staleDelete ?
          (current.cleanupPreviousState === "ready" ? "ready" : "uploading") :
          current.state;
        transaction.set(doc.ref, {
          ...current,
          state: "deleting",
          cleanupStartedAt: timestamp(context, now),
          cleanupPreviousState: previousState,
          cleanupToken,
        });
        return {
          objectKey: current.objectKey,
          cleanupToken,
          jobId: current.jobId,
          ownerUid: current.ownerUid,
          sizeBytes: current.sizeBytes,
          quotaAccounted: current.quotaAccounted === true,
        };
      });
    } catch {
      summary.failed += 1;
      if (retentionBackfillMissingIds.has(doc.id)) {
        retentionBackfillRetryRequired = true;
      }
      continue;
    }
    if (!cleanup) {
      summary.skipped += 1;
      if (retentionBackfillMissingIds.has(doc.id)) {
        retentionBackfillRetryRequired = true;
      }
      continue;
    }
    try {
      await context.artifactStore.deleteObject(cleanup.objectKey);
      const finalized = await context.db.runTransaction(async (transaction) => {
        const jobRef = protocol.JOB_ID_PATTERN.test(cleanup.jobId || "") ?
          context.db.doc(`fleetJobs/${cleanup.jobId}`) :
          null;
        const ownerRef =
          cleanup.quotaAccounted && typeof cleanup.ownerUid === "string" ?
            context.db.doc(
                `fleetOwners/${createHash("sha256")
                    .update(cleanup.ownerUid)
                    .digest("hex")}`,
            ) :
            null;
        const [currentSnapshot, jobSnapshot, ownerSnapshot] = await Promise.all([
          transaction.get(doc.ref),
          jobRef ? transaction.get(jobRef) : Promise.resolve(null),
          ownerRef ? transaction.get(ownerRef) : Promise.resolve(null),
        ]);
        const current = currentSnapshot.exists ? currentSnapshot.data() : null;
        if (
          current &&
          current.state === "deleting" &&
          current.objectKey === cleanup.objectKey &&
          current.cleanupToken === cleanup.cleanupToken
        ) {
          transaction.delete(doc.ref);
          const job = jobSnapshot?.exists ? jobSnapshot.data() : null;
          if (job && Array.isArray(job.artifactIds) &&
              job.artifactIds.includes(doc.id)) {
            transaction.set(jobRef, {
              ...job,
              artifactIds: job.artifactIds.filter(
                  (artifactId) => artifactId !== doc.id,
              ),
              updatedAt: timestamp(context, now),
            });
          }
          const owner = ownerSnapshot?.exists ? ownerSnapshot.data() : null;
          if (ownerRef && owner?.ownerUid === cleanup.ownerUid) {
            transaction.set(ownerRef, {
              ...owner,
              fleetArtifactCount: Math.max(
                  0,
                  Number(owner.fleetArtifactCount || 0) - 1,
              ),
              fleetArtifactBytes: Math.max(
                  0,
                  Number(owner.fleetArtifactBytes || 0) -
                    Number(cleanup.sizeBytes || 0),
              ),
              updatedAt: timestamp(context, now),
            });
          }
          return true;
        }
        return false;
      });
      if (finalized) {
        summary.deleted += 1;
      } else {
        summary.skipped += 1;
        if (retentionBackfillMissingIds.has(doc.id)) {
          retentionBackfillRetryRequired = true;
        }
      }
    } catch {
      summary.failed += 1;
      try {
        await context.db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(doc.ref);
          const current = currentSnapshot.exists ? currentSnapshot.data() : null;
          if (
            current &&
            current.state === "deleting" &&
            current.objectKey === cleanup.objectKey &&
            current.cleanupToken === cleanup.cleanupToken
          ) {
            transaction.set(doc.ref, {
              ...current,
              cleanupStartedAt: timestamp(context, now),
              cleanupToken: null,
            });
          }
        });
      } catch {
        // The durable deletion lease remains recoverable by a later sweep.
      }
    }
  }
  if (!retentionBackfillComplete && !retentionBackfillRetryRequired) {
    const lastScanned = retentionBackfillPage.docs.at(-1);
    const backfillFinished =
      retentionBackfillPage.docs.length < boundedLimit;
    await retentionBackfillRef.set({
      schemaVersion: protocol.PROTOCOL_VERSION,
      cursor: backfillFinished ? null : lastScanned?.id || null,
      completedAt: backfillFinished ? timestamp(context, now) : null,
      updatedAt: timestamp(context, now),
    }, {merge: true}).catch(() => {});
  }
  return summary;
}

async function reserveArtifact(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  const descriptor = normalizeArtifactReservation(payload);
  protocol.requireValue(
      context.artifactStore &&
        typeof context.artifactStore.createUploadGrant === "function",
      "failed_precondition",
      "Fleet artifact storage is not configured.",
      409,
  );
  const now = contextNow(context);
  const jobRef = context.db.doc(`fleetJobs/${descriptor.jobId}`);
  const leaseRef = context.db.doc(
      `fleetLeases/${descriptor.credential.leaseId}`,
  );
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  const artifactRef = context.db.doc(
      `fleetArtifacts/${descriptor.artifactId}`,
  );
  const ownerRef = context.db.doc(
      `fleetOwners/${createHash("sha256")
          .update(identity.ownerUid)
          .digest("hex")}`,
  );
  const objectKey = artifactObjectKey(identity.ownerUid, descriptor);
  const manifest = await context.db.runTransaction(async (transaction) => {
    const [
      jobSnapshot,
      leaseSnapshot,
      deviceSnapshot,
      artifactSnapshot,
      ownerSnapshot,
    ] =
      await Promise.all([
        transaction.get(jobRef),
        transaction.get(leaseRef),
        transaction.get(deviceRef),
        transaction.get(artifactRef),
        transaction.get(ownerRef),
      ]);
    const job = jobSnapshot.exists ? jobSnapshot.data() : null;
    const lease = leaseSnapshot.exists ? leaseSnapshot.data() : null;
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    const existing = artifactSnapshot.exists ? artifactSnapshot.data() : null;
    const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null;
    requireOwned(job, identity.ownerUid, "Job");
    if (owner) requireOwned(owner, identity.ownerUid, "Fleet owner");
    const ownerRecord = owner || {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: identity.ownerUid,
      fleetArtifactCount: 0,
      fleetArtifactBytes: 0,
      createdAt: timestamp(context, now),
    };
    requireLease(lease, descriptor.credential, identity, now);
    verifyDeviceRow(device, identity);
    requireLinuxExecutionAuthority(
        device,
        device.platform === "linux" ?
          await readLinuxAttestation(transaction, context, identity.deviceId) :
          null,
        now,
        "to reserve artifacts",
    );
    protocol.requireValue(
        lease.jobId === descriptor.jobId &&
          Number(lease.attempt) === Number(job.attempt) &&
          job.activeLeaseId === lease.id &&
          job.assignedDeviceId === identity.deviceId &&
          ["preparing", "running"].includes(job.state),
        "permission_denied",
        "Lease cannot publish for this job attempt.",
        403,
    );
    const grantSnapshot = await transaction.get(
        context.db.doc(`fleetGrants/${lease.grantId}`),
    );
    const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
    const controllerSnapshot = grant ?
      await transaction.get(
          context.db.doc(`fleetDevices/${grant.receipt.controllerDeviceId}`),
      ) :
      null;
    const controller = controllerSnapshot?.exists ?
      controllerSnapshot.data() :
      null;
    protocol.requireValue(
        grantAllows(grant, job, device, controller, now),
        "permission_denied",
        "The capability grant is no longer valid.",
        403,
    );
    protocol.requireValue(
        !job.cancellationRequestedAt,
        "failed_precondition",
        "Cancellation is pending.",
        409,
    );
    if (existing) {
      protocol.requireValue(
          existing.ownerUid === identity.ownerUid &&
            existing.jobId === descriptor.jobId &&
            Number(existing.attempt) === Number(job.attempt) &&
            existing.deviceId === identity.deviceId &&
            existing.leaseId === lease.id &&
            existing.kind === descriptor.kind &&
            existing.contentHash === descriptor.contentHash &&
            existing.contentMd5 === descriptor.contentMd5 &&
            Number(existing.sizeBytes) === descriptor.sizeBytes &&
            existing.mediaType === descriptor.mediaType &&
            existing.objectKey === objectKey &&
            existing.state === "uploading",
          "conflict",
          "Artifact id is already in use.",
          409,
      );
      const renewed = {
        ...existing,
        uploadExpiresAt: timestamp(context, now + ARTIFACT_UPLOAD_TTL_MS),
      };
      transaction.set(artifactRef, renewed);
      return renewed;
    }
    const sameReservationAttempt =
      Number(job.artifactReservationAttempt) === Number(job.attempt);
    const reservationCount = sameReservationAttempt ?
      Number(job.artifactReservationCount || 0) :
      0;
    const reservedBytes = sameReservationAttempt ?
      Number(job.artifactBytesReserved || 0) :
      0;
    protocol.requireValue(
        Number.isSafeInteger(reservationCount) &&
          Number.isSafeInteger(reservedBytes) &&
          reservationCount >= 0 &&
          reservedBytes >= 0 &&
          reservationCount < MAX_ARTIFACTS_PER_ATTEMPT &&
          reservedBytes + descriptor.sizeBytes <=
            MAX_ARTIFACT_BYTES_PER_ATTEMPT,
        "resource_exhausted",
        "Artifact budget for this job attempt is exhausted.",
        429,
    );
    const ownerArtifactCount = Number(ownerRecord.fleetArtifactCount || 0);
    const ownerArtifactBytes = Number(ownerRecord.fleetArtifactBytes || 0);
    protocol.requireValue(
        Number.isSafeInteger(ownerArtifactCount) &&
          Number.isSafeInteger(ownerArtifactBytes) &&
          ownerArtifactCount >= 0 &&
          ownerArtifactBytes >= 0 &&
          ownerArtifactCount < MAX_ARTIFACTS_PER_OWNER &&
          ownerArtifactBytes + descriptor.sizeBytes <=
            MAX_ARTIFACT_BYTES_PER_OWNER,
        "resource_exhausted",
        "Fleet artifact storage quota is exhausted.",
        429,
    );
    const row = {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: identity.ownerUid,
      jobId: descriptor.jobId,
      attempt: Number(job.attempt),
      deviceId: identity.deviceId,
      leaseId: lease.id,
      kind: descriptor.kind,
      contentHash: descriptor.contentHash,
      contentMd5: descriptor.contentMd5,
      objectKey,
      sizeBytes: descriptor.sizeBytes,
      mediaType: descriptor.mediaType,
      state: "uploading",
      encryption: {mode: "service", keyVersion: "google-managed"},
      generation: null,
      createdAt: timestamp(context, now),
      uploadExpiresAt: timestamp(context, now + ARTIFACT_UPLOAD_TTL_MS),
      committedAt: null,
      expiresAt: null,
      quotaAccounted: true,
    };
    transaction.set(jobRef, {
      ...job,
      artifactReservationAttempt: Number(job.attempt),
      artifactReservationCount: reservationCount + 1,
      artifactBytesReserved: reservedBytes + descriptor.sizeBytes,
      updatedAt: timestamp(context, now),
    });
    transaction.set(artifactRef, row);
    transaction.set(ownerRef, {
      ...ownerRecord,
      fleetArtifactCount: ownerArtifactCount + 1,
      fleetArtifactBytes: ownerArtifactBytes + descriptor.sizeBytes,
      updatedAt: timestamp(context, now),
    });
    return row;
  });
  const upload = await context.artifactStore.createUploadGrant({
    objectKey: manifest.objectKey,
    artifactId: descriptor.artifactId,
    contentHash: descriptor.contentHash,
    contentMd5: descriptor.contentMd5,
    mediaType: descriptor.mediaType,
    sizeBytes: descriptor.sizeBytes,
  });
  return {
    artifact: artifactView(descriptor.artifactId, manifest),
    upload,
  };
}

async function commitArtifact(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  const credential = normalizeLeaseCredential(payload);
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  const artifactId = protocol.cleanString(
      payload?.artifactId,
      64,
      "artifactId",
  );
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId) &&
        /^artifact_[a-f0-9]{32}$/.test(artifactId),
      "invalid_argument",
      "Artifact commit ids are invalid.",
  );
  protocol.requireValue(
      context.artifactStore &&
        typeof context.artifactStore.inspectObject === "function",
      "failed_precondition",
      "Fleet artifact storage is not configured.",
      409,
  );
  const artifactRef = context.db.doc(`fleetArtifacts/${artifactId}`);
  const initialSnapshot = await artifactRef.get();
  const initial = initialSnapshot.exists ? initialSnapshot.data() : null;
  requireOwned(initial, identity.ownerUid, "Artifact");
  protocol.requireValue(
      initial.jobId === jobId &&
        initial.deviceId === identity.deviceId &&
        initial.leaseId === credential.leaseId,
      "permission_denied",
      "Artifact does not belong to this lease.",
      403,
  );
  let uploaded;
  try {
    uploaded = await context.artifactStore.inspectObject(initial.objectKey);
  } catch (error) {
    protocol.requireValue(
        Number(error?.code) !== 404,
        "failed_precondition",
        "Artifact upload is not complete.",
        409,
    );
    throw error;
  }
  const now = contextNow(context);
  const jobRef = context.db.doc(`fleetJobs/${jobId}`);
  const leaseRef = context.db.doc(`fleetLeases/${credential.leaseId}`);
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  return context.db.runTransaction(async (transaction) => {
    const [jobSnapshot, leaseSnapshot, deviceSnapshot, artifactSnapshot] =
      await Promise.all([
        transaction.get(jobRef),
        transaction.get(leaseRef),
        transaction.get(deviceRef),
        transaction.get(artifactRef),
      ]);
    const job = jobSnapshot.exists ? jobSnapshot.data() : null;
    const lease = leaseSnapshot.exists ? leaseSnapshot.data() : null;
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    const artifact = artifactSnapshot.exists ? artifactSnapshot.data() : null;
    requireOwned(job, identity.ownerUid, "Job");
    requireOwned(artifact, identity.ownerUid, "Artifact");
    requireLease(lease, credential, identity, now);
    verifyDeviceRow(device, identity);
    requireLinuxExecutionAuthority(
        device,
        device.platform === "linux" ?
          await readLinuxAttestation(transaction, context, identity.deviceId) :
          null,
        now,
        "to commit artifacts",
    );
    protocol.requireValue(
        lease.jobId === jobId &&
          Number(lease.attempt) === Number(job.attempt) &&
          job.activeLeaseId === lease.id &&
          job.assignedDeviceId === identity.deviceId &&
          ["preparing", "running"].includes(job.state) &&
          !job.cancellationRequestedAt,
        "permission_denied",
        "Lease cannot commit for this job attempt.",
        403,
    );
    const grantSnapshot = await transaction.get(
        context.db.doc(`fleetGrants/${lease.grantId}`),
    );
    const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
    const controllerSnapshot = grant ?
      await transaction.get(
          context.db.doc(`fleetDevices/${grant.receipt.controllerDeviceId}`),
      ) :
      null;
    const controller = controllerSnapshot?.exists ?
      controllerSnapshot.data() :
      null;
    protocol.requireValue(
        grantAllows(grant, job, device, controller, now),
        "permission_denied",
        "The capability grant is no longer valid.",
        403,
    );
    protocol.requireValue(
        artifact.jobId === jobId &&
          artifact.deviceId === identity.deviceId &&
          artifact.leaseId === lease.id &&
          Number(artifact.attempt) === Number(job.attempt) &&
          ["uploading", "ready"].includes(artifact.state),
        "conflict",
        "Artifact manifest does not match this job attempt.",
        409,
    );
    protocol.requireValue(
        Number(uploaded.sizeBytes) === Number(artifact.sizeBytes) &&
          uploaded.contentMd5 === artifact.contentMd5 &&
          uploaded.contentHash === artifact.contentHash &&
          uploaded.artifactId === artifactId &&
          uploaded.mediaType === artifact.mediaType &&
          typeof uploaded.generation === "string" &&
          uploaded.generation.length > 0,
        "artifact_integrity_failed",
        "Uploaded artifact did not match its manifest.",
        409,
    );
    if (
      !(Array.isArray(job.artifactIds) && job.artifactIds.includes(artifactId))
    ) {
      transaction.set(jobRef, {
        ...job,
        artifactIds: [
          ...(Array.isArray(job.artifactIds) ? job.artifactIds : []),
          artifactId,
        ].slice(-64),
        updatedAt: timestamp(context, now),
      });
    }
    if (artifact.state === "ready") {
      protocol.requireValue(
          artifact.generation === uploaded.generation,
          "conflict",
          "Committed artifact generation changed.",
          409,
      );
      if (artifact.expiresAt != null) return artifactView(artifactId, artifact);
      const migrated = {
        ...artifact,
        expiresAt: timestamp(context, now + ARTIFACT_RETENTION_MS),
      };
      transaction.set(artifactRef, migrated);
      return artifactView(artifactId, migrated);
    }
    const committed = {
      ...artifact,
      state: "ready",
      generation: uploaded.generation,
      committedAt: timestamp(context, now),
      expiresAt: timestamp(context, now + ARTIFACT_RETENTION_MS),
    };
    transaction.set(artifactRef, committed);
    return artifactView(artifactId, committed);
  });
}

async function createArtifactDownload(uid, payload, context) {
  const artifactId = protocol.cleanString(
      payload?.artifactId,
      64,
      "artifactId",
  );
  protocol.requireValue(
      /^artifact_[a-f0-9]{32}$/.test(artifactId),
      "invalid_argument",
      "Invalid artifact id.",
  );
  protocol.requireValue(
      context.artifactStore &&
        typeof context.artifactStore.createDownloadGrant === "function",
      "failed_precondition",
      "Fleet artifact storage is not configured.",
      409,
  );
  const snapshot = await context.db.doc(`fleetArtifacts/${artifactId}`).get();
  const artifact = snapshot.exists ? snapshot.data() : null;
  requireOwned(artifact, uid, "Artifact");
  const now = contextNow(context);
  const artifactExpiresAt = protocol.toMillis(artifact.expiresAt);
  protocol.requireValue(
      artifact.state === "ready" &&
        typeof artifact.generation === "string" &&
        artifact.generation.length > 0 &&
        Number.isFinite(artifactExpiresAt) &&
        artifactExpiresAt >= now + ARTIFACT_DOWNLOAD_TTL_MS,
      "failed_precondition",
      "Artifact is not available.",
      409,
  );
  const download = await context.artifactStore.createDownloadGrant({
    objectKey: artifact.objectKey,
    generation: artifact.generation,
    artifactId,
    mediaType: artifact.mediaType,
    notAfter: artifactExpiresAt,
  });
  return {
    artifact: artifactView(artifactId, artifact),
    download,
  };
}

async function appendJobEvent(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  const credential = normalizeLeaseCredential(payload);
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId),
      "invalid_argument",
      "Invalid job id.",
  );
  const event = protocol.normalizeEvent(payload?.event);
  const now = contextNow(context);
  const jobRef = context.db.doc(`fleetJobs/${jobId}`);
  const leaseRef = context.db.doc(`fleetLeases/${credential.leaseId}`);
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  const eventId = String(event.sequence).padStart(10, "0");
  const eventRef = context.db.doc(`fleetJobs/${jobId}/events/${eventId}`);
  return context.db.runTransaction(async (transaction) => {
    const [jobSnapshot, leaseSnapshot, existingEventSnapshot] =
      await Promise.all([
        transaction.get(jobRef),
        transaction.get(leaseRef),
        transaction.get(eventRef),
      ]);
    const job = jobSnapshot.exists ? jobSnapshot.data() : null;
    const lease = leaseSnapshot.exists ? leaseSnapshot.data() : null;
    requireOwned(job, identity.ownerUid, "Job");
    requireLease(lease, credential, identity, now);
    protocol.requireValue(
        lease.jobId === jobId &&
          Number(lease.attempt) === Number(job.attempt) &&
          job.assignedDeviceId === identity.deviceId,
        "permission_denied",
        "Lease does not own this job attempt.",
        403,
    );
    if (existingEventSnapshot.exists) {
      const existing = existingEventSnapshot.data();
      protocol.requireValue(
          existing.payloadDigest === event.payloadDigest &&
            existing.type === event.type &&
            existing.leaseId === lease.id,
          "conflict",
          "Event sequence already has different content.",
          409,
      );
      return {accepted: true, duplicate: true, sequence: event.sequence};
    }
    const [deviceSnapshot, grantSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(context.db.doc(`fleetGrants/${lease.grantId}`)),
    ]);
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
    verifyDeviceRow(device, identity);
    requireLinuxExecutionAuthority(
        device,
        device.platform === "linux" ?
          await readLinuxAttestation(transaction, context, identity.deviceId) :
          null,
        now,
        "to publish events",
    );
    const controllerSnapshot = grant ?
      await transaction.get(
          context.db.doc(`fleetDevices/${grant.receipt.controllerDeviceId}`),
      ) :
      null;
    const controller = controllerSnapshot?.exists ?
      controllerSnapshot.data() :
      null;
    protocol.requireValue(
        grantAllows(grant, job, device, controller, now),
        "permission_denied",
        "The capability grant is no longer valid.",
        403,
    );
    protocol.requireValue(
        !job.cancellationRequestedAt,
        "failed_precondition",
        "Cancellation is pending.",
        409,
    );
    protocol.requireValue(
        event.sequence === Number(job.eventSequence) + 1,
        "conflict",
        "Event is not the next expected sequence.",
        409,
    );
    protocol.requireValue(
        !protocol.TERMINAL_STATES.has(job.state),
        "failed_precondition",
        "Job is already complete.",
        409,
    );
    transaction.set(eventRef, {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: identity.ownerUid,
      jobId,
      deviceId: identity.deviceId,
      attempt: Number(job.attempt),
      sequence: event.sequence,
      type: event.type,
      payload: event.payload,
      payloadDigest: event.payloadDigest,
      leaseId: lease.id,
      occurredAt: timestamp(context, now),
    });
    transaction.set(jobRef, {
      ...job,
      eventSequence: event.sequence,
      revision: Number(job.revision) + 1,
      updatedAt: timestamp(context, now),
    });
    return {accepted: true, duplicate: false, sequence: event.sequence};
  });
}

async function transitionJob(identityInput, payload, context) {
  const identity = requireDeviceIdentity(identityInput);
  const credential = normalizeLeaseCredential(payload);
  const jobId = protocol.cleanString(payload?.jobId, 64, "jobId");
  const state = protocol.cleanString(payload?.state, 32, "state");
  const transitionId = payload?.transitionId == null ?
    null :
    protocol.cleanString(payload.transitionId, 64, "transitionId");
  const retryTransition = state === "queued";
  const retryCode = retryTransition ?
    protocol.cleanString(payload?.retry?.code, 64, "retry.code") :
    null;
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId) &&
        protocol.JOB_STATES.includes(state) &&
        (transitionId == null || /^op_[a-f0-9]{32}$/.test(transitionId)) &&
        (retryTransition ?
          (payload?.retry?.terminationConfirmed === true &&
            /^[a-z][a-z0-9_-]{0,63}$/.test(retryCode)) :
          payload?.retry == null),
      "invalid_argument",
      "Invalid job transition.",
  );
  protocol.requireValue(
      state !== "leased",
      "permission_denied",
      "Only the coordinator may lease jobs.",
      403,
  );
  const now = contextNow(context);
  const jobRef = context.db.doc(`fleetJobs/${jobId}`);
  const leaseRef = context.db.doc(`fleetLeases/${credential.leaseId}`);
  const deviceRef = context.db.doc(`fleetDevices/${identity.deviceId}`);
  return context.db.runTransaction(async (transaction) => {
    const [jobSnapshot, leaseSnapshot, deviceSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(leaseRef),
      transaction.get(deviceRef),
    ]);
    const job = jobSnapshot.exists ? jobSnapshot.data() : null;
    const lease = leaseSnapshot.exists ? leaseSnapshot.data() : null;
    const device = deviceSnapshot.exists ? deviceSnapshot.data() : null;
    requireOwned(job, identity.ownerUid, "Job");
    verifyDeviceRow(device, identity);
    const isLinux = device.platform === "linux";
    if (isLinux && !LINUX_UNGATED_TRANSITIONS.has(state)) {
      requireLinuxExecutionAuthority(
          device,
          await readLinuxAttestation(transaction, context, identity.deviceId),
          now,
          "for this transition",
      );
    }
    if (transitionId && job.lastTransition?.id === transitionId) {
      const replayDigest = transitionOperationDigest({
        ownerUid: identity.ownerUid,
        deviceId: identity.deviceId,
        jobId,
        leaseId: credential.leaseId,
        attempt: Number(lease?.attempt),
        state,
        retry: retryTransition ? {
          code: retryCode,
          terminationConfirmed: true,
        } : null,
      });
      protocol.requireValue(
          safeEqual(job.lastTransition.requestDigest, replayDigest) &&
            job.lastTransition.leaseId === lease?.id &&
            lease?.ownerUid === identity.ownerUid &&
            lease?.deviceId === identity.deviceId &&
            lease?.jobId === jobId &&
            safeEqual(lease?.nonceHash, nonceDigest(credential.nonce)) &&
            job.lastTransition.result &&
            typeof job.lastTransition.result === "object",
          "conflict",
          "Transition id is already in use.",
          409,
      );
      return job.lastTransition.result;
    }
    requireLease(lease, credential, identity, now);
    const grantSnapshot = await transaction.get(
        context.db.doc(`fleetGrants/${lease.grantId}`),
    );
    const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
    const controllerSnapshot = grant ?
      await transaction.get(
          context.db.doc(`fleetDevices/${grant.receipt.controllerDeviceId}`),
      ) :
      null;
    const controller = controllerSnapshot?.exists ?
      controllerSnapshot.data() :
      null;
    if (!grantAllows(grant, job, device, controller, now)) {
      protocol.requireValue(
          ["cancelled", "failed", "timed_out"].includes(state),
          "permission_denied",
          "The capability grant is no longer valid.",
          403,
      );
    }
    protocol.requireValue(
        lease.jobId === jobId &&
          Number(lease.attempt) === Number(job.attempt) &&
          job.assignedDeviceId === identity.deviceId,
        "permission_denied",
        "Lease does not own this job attempt.",
        403,
    );
    protocol.requireValue(
        retryTransition ?
          ["preparing", "running"].includes(job.state) :
          protocol.canTransition(job.state, state),
        "failed_precondition",
        `Job cannot transition from ${job.state} to ${state}.`,
        409,
    );
    if (retryTransition) {
      protocol.requireValue(
          !job.cancellationRequestedAt &&
            Number(job.attempt) < Number(job.maxAttempts) &&
            protocol.toMillis(job.deadlineAt) > now,
          "failed_precondition",
          "This job attempt cannot be retried.",
          409,
      );
      if (isLinux) {
        await requireLinuxTerminationReceipt({
          transaction,
          context,
          identity,
          job,
          jobId,
          lease,
          payload,
        });
      }
    }
    if (job.cancellationRequestedAt) {
      protocol.requireValue(
          ["cancelled", "failed", "timed_out"].includes(state),
          "failed_precondition",
          "Cancellation is pending.",
          409,
      );
    }
    const terminal = protocol.TERMINAL_STATES.has(state);
    const releasesLease = terminal || retryTransition;
    const resourceUpdates = [];
    if (releasesLease) {
      for (const resourceKey of lease.resourceKeys || []) {
        const resourceRef = context.db.doc(
            `fleetResourceLeases/${resourceLeaseId(identity.ownerUid, resourceKey)}`,
        );
        const resourceSnapshot = await transaction.get(resourceRef);
        if (resourceSnapshot.exists &&
            resourceSnapshot.data().leaseId === lease.id) {
          resourceUpdates.push([resourceRef, {
            ...resourceSnapshot.data(),
            releasedAt: timestamp(context, now),
            updatedAt: timestamp(context, now),
          }]);
        }
      }
    }
    const transitionDigest = transitionOperationDigest({
      ownerUid: identity.ownerUid,
      deviceId: identity.deviceId,
      jobId,
      leaseId: lease.id,
      attempt: Number(job.attempt),
      state,
      retry: retryTransition ? {
        code: retryCode,
        terminationConfirmed: true,
      } : null,
    });
    const updatedJobWithoutTransition = {
      ...job,
      state,
      revision: Number(job.revision) + 1,
      updatedAt: timestamp(context, now),
      ...(terminal ? {finishedAt: timestamp(context, now)} : {}),
      ...(releasesLease ? {
        activeLeaseId: null,
        assignedDeviceId: null,
      } : {}),
      ...(retryTransition ? {
        lastFailure: {
          code: retryCode,
          retryable: true,
          terminationConfirmed: true,
          attempt: Number(job.attempt),
          at: timestamp(context, now),
        },
      } : {}),
    };
    const transitionResult = jobView(jobId, updatedJobWithoutTransition);
    const updatedJob = {
      ...updatedJobWithoutTransition,
      lastTransition: transitionId ? {
        id: transitionId,
        state,
        leaseId: lease.id,
        attempt: Number(job.attempt),
        requestDigest: transitionDigest,
        result: transitionResult,
      } : null,
    };
    transaction.set(jobRef, updatedJob);
    if (releasesLease) {
      transaction.set(leaseRef, {
        ...lease,
        releasedAt: timestamp(context, now),
      });
      transaction.set(deviceRef, {
        ...device,
        activeJobs: Math.max(0, Number(device.activeJobs || 0) - 1),
        reservedResources: subtractResourceReservation(
            device.reservedResources,
            lease.resourceRequest,
        ),
        activeLeaseIds: (Array.isArray(device.activeLeaseIds) ?
          device.activeLeaseIds :
          []).filter((leaseId) => leaseId !== lease.id),
        updatedAt: timestamp(context, now),
      });
      for (const [resourceRef, resourceUpdate] of resourceUpdates) {
        transaction.set(resourceRef, resourceUpdate);
      }
    }
    return transitionResult;
  });
}

module.exports = {
  appendJobEvent,
  attestHelper,
  bindHelper,
  bootstrapDevice,
  cancelJob,
  claimJob,
  commitArtifact,
  createGrant,
  createArtifactDownload,
  createHelperChallenge,
  createLocalGrant,
  createJob,
  enrollDevice,
  getJob,
  listDevices,
  listGrants,
  listJobEvents,
  listJobs,
  leaseJob,
  pairDevice,
  pollJobs,
  recordDeviceHeartbeat,
  recoverJob,
  recoverController,
  reserveArtifact,
  revokeDevice,
  revokeGrant,
  renewLease,
  sweepExpiredFleetWork,
  sweepExpiredArtifactUploads,
  transitionJob,
  _test: {
    deviceEligible,
    grantAllows,
    jobIdFor,
    jobView,
    nonceDigest,
    resourceLeaseId,
  },
};
