// Fleet remote sessions (fleetRemoteSessions/{sessionId}): short-lived
// authorization to open an end-to-end-encrypted screen tunnel between an
// owner's controller (viewer) and worker (host) device through the session
// relay. See FLEET_CONTROL_PLANE_SCHEMA.md and fleetd/REMOTE_SESSION.md.
//
// Consent model:
//   - The controller requests a session through the authenticated account
//     API; the control plane mints the session id, the 256-bit session key,
//     and records both sides' ephemeral public keys.
//   - A session becomes approved when the signed-in owner approves through
//     the account API, or when the worker device signs an approval and holds
//     an active grant from the session controller covering the requested
//     screen capabilities (the host app's auto-approve path).
//   - The worker receives the session key and relay endpoint only once the
//     session is approved; the relay only ever sees the key's SHA-256.
//
// Everything fails closed: unknown capabilities, unsupported transport,
// missing relay configuration, missing grants, expired sessions, and any
// cross-owner access are rejected.

const {createHash, randomBytes} = require("node:crypto");
const protocol = require("./fleetProtocol");
const fleetAuth = require("./fleetAuth");

const SESSION_ID_PATTERN = /^rs_[a-f0-9]{32}$/;
const RELAY_ENDPOINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}:[0-9]{1,5}$/;
const REMOTE_SESSION_PROTOCOL = "statskey.screen.v1";
const SESSION_TTL_MS = 10 * 60_000;
const SCREEN_CAPABILITIES = new Set(["screen.view", "screen.input"]);
const LIVE_STATES = new Set(["requested", "approved", "active"]);
const TERMINAL_STATES = new Set(["ended", "expired"]);

function contextNow(context) {
  return protocol.validTime(context.now ? context.now() : Date.now());
}

function timestamp(context, millis) {
  if (context.Timestamp && typeof context.Timestamp.fromMillis === "function") {
    return context.Timestamp.fromMillis(millis);
  }
  return new Date(millis);
}

function publicTime(value) {
  if (value == null) return null;
  const millis = protocol.toMillis(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function relayEndpointFor(context) {
  const endpoint = String(context.remoteRelayEndpoint || "").trim();
  protocol.requireValue(
      RELAY_ENDPOINT_PATTERN.test(endpoint),
      "failed_precondition",
      "Fleet remote sessions are not configured on this coordinator.",
      503,
  );
  const port = Number(endpoint.slice(endpoint.lastIndexOf(":") + 1));
  protocol.requireValue(
      Number.isInteger(port) && port >= 1 && port <= 65535,
      "failed_precondition",
      "Fleet remote sessions are not configured on this coordinator.",
      503,
  );
  return endpoint;
}

function normalizeCapabilities(value) {
  protocol.requireValue(
      Array.isArray(value) && value.length >= 1 && value.length <= 2,
      "invalid_argument",
      "Remote session capabilities must be a non-empty list.",
  );
  const capabilities = [...new Set(value)];
  protocol.requireValue(
      capabilities.length === value.length &&
        capabilities.every((capability) => SCREEN_CAPABILITIES.has(capability)),
      "invalid_argument",
      "Remote session capabilities are limited to screen.view and screen.input.",
  );
  protocol.requireValue(
      capabilities.includes("screen.view"),
      "invalid_argument",
      "Remote sessions always include screen.view.",
  );
  return capabilities;
}

function normalizeTransport(value) {
  const transport = protocol.cleanString(value, 16, "transport");
  protocol.requireValue(
      transport === "relay",
      "failed_precondition",
      "Direct transport is not available for remote sessions in v1; use relay.",
      412,
  );
  return transport;
}

// effectiveState folds the handshake-window expiry into the stored state.
function effectiveState(row, now) {
  if (
    LIVE_STATES.has(row.state) &&
    row.state !== "active" &&
    protocol.toMillis(row.expiresAt) <= now
  ) {
    return "expired";
  }
  return row.state;
}

function remoteSessionView(id, row, {now, includeKeyMaterial = false} = {}) {
  const state = effectiveState(row, now ?? protocol.toMillis(row.updatedAt));
  const view = {
    id,
    sessionId: id,
    schemaVersion: row.schemaVersion,
    controllerDeviceId: row.controllerDeviceId,
    workerDeviceId: row.workerDeviceId,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    transport: row.transport,
    protocol: row.protocol,
    state,
    controllerEphemeralKey: row.controllerEphemeralKey,
    workerEphemeralKey: row.workerEphemeralKey || null,
    approvalReceiptDigest: row.approvalReceiptDigest || null,
    expiresAt: publicTime(row.expiresAt),
    startedAt: publicTime(row.startedAt),
    endedAt: publicTime(row.endedAt),
    createdAt: publicTime(row.createdAt),
    updatedAt: publicTime(row.updatedAt),
  };
  if (includeKeyMaterial && LIVE_STATES.has(state)) {
    view.sessionKey = row.sessionKey;
    view.relayEndpoint = row.relayEndpoint;
  }
  return view;
}

async function loadOwnedDevice(context, deviceId, ownerUid, kind) {
  const snapshot = await context.db.doc(`fleetDevices/${deviceId}`).get();
  const device = snapshot.exists ? snapshot.data() : null;
  protocol.requireValue(
      device && device.id === deviceId && device.ownerUid === ownerUid,
      "not_found",
      `${kind} was not found.`,
      404,
  );
  protocol.requireValue(
      device.status === "active",
      "failed_precondition",
      `${kind} is not active.`,
      409,
  );
  return device;
}

// ---------------------------------------------------------------------------
// Account-authenticated actions (controller side)
// ---------------------------------------------------------------------------

async function requestRemoteSession(uid, payload, context) {
  protocol.requireValue(
      payload && typeof payload === "object" && !Array.isArray(payload),
      "invalid_argument",
      "Remote session payload is required.",
  );
  const controllerDeviceId = protocol.cleanString(
      payload?.controllerDeviceId,
      64,
      "controllerDeviceId",
  );
  const workerDeviceId = protocol.cleanString(
      payload?.workerDeviceId,
      64,
      "workerDeviceId",
  );
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(controllerDeviceId) &&
        protocol.DEVICE_ID_PATTERN.test(workerDeviceId),
      "invalid_argument",
      "Invalid remote session device id.",
  );
  const capabilities = normalizeCapabilities(payload?.capabilities);
  const transport = normalizeTransport(payload?.transport);
  const controllerEphemeralKey = protocol.cleanString(
      payload?.controllerEphemeralKey,
      256,
      "controllerEphemeralKey",
  );
  try {
    fleetAuth.normalizePublicKeySpki(controllerEphemeralKey);
  } catch {
    throw Object.assign(
        new Error("The controller ephemeral key is invalid."),
        {code: "invalid_argument", status: 400},
    );
  }
  const relayEndpoint = relayEndpointFor(context);

  const [controller, worker] = await Promise.all([
    loadOwnedDevice(context, controllerDeviceId, uid, "Controller"),
    loadOwnedDevice(context, workerDeviceId, uid, "Worker"),
  ]);
  protocol.requireValue(
      ["controller", "hybrid"].includes(controller.role),
      "failed_precondition",
      "The viewing device is not a Fleet controller.",
      409,
  );
  protocol.requireValue(
      ["worker", "hybrid"].includes(worker.role) &&
        worker.workerMode !== "disabled",
      "failed_precondition",
      "The host device is not a Fleet worker.",
      409,
  );
  protocol.requireValue(
      !capabilities.includes("screen.input") || worker.platform === "win32",
      "failed_precondition",
      "Remote input injection is available on Windows hosts only in v1.",
      412,
  );

  const now = contextNow(context);
  const entropy = context.randomBytes || randomBytes;
  const sessionId = `rs_${entropy(16).toString("hex")}`;
  const sessionKey = entropy(32).toString("base64url");
  const ref = context.db.doc(`fleetRemoteSessions/${sessionId}`);
  const row = {
    schemaVersion: protocol.PROTOCOL_VERSION,
    ownerUid: uid,
    controllerDeviceId,
    workerDeviceId,
    capabilities,
    transport,
    protocol: REMOTE_SESSION_PROTOCOL,
    controllerEphemeralKey,
    workerEphemeralKey: null,
    sessionKey,
    relayEndpoint,
    state: "requested",
    approvalReceiptDigest: null,
    expiresAt: timestamp(context, now + SESSION_TTL_MS),
    startedAt: null,
    endedAt: null,
    createdAt: timestamp(context, now),
    updatedAt: timestamp(context, now),
  };
  await context.db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    protocol.requireValue(
        !existing.exists,
        "already_exists",
        "Remote session id collision; retry the request.",
        409,
    );
    transaction.set(ref, row);
  });
  return remoteSessionView(sessionId, row, {now, includeKeyMaterial: true});
}

async function approveRemoteSession(uid, payload, context) {
  const sessionId = protocol.cleanString(payload?.sessionId, 64, "sessionId");
  protocol.requireValue(
      SESSION_ID_PATTERN.test(sessionId),
      "invalid_argument",
      "Invalid remote session id.",
  );
  const now = contextNow(context);
  const ref = context.db.doc(`fleetRemoteSessions/${sessionId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    protocol.requireValue(
        row && row.ownerUid === uid,
        "not_found",
        "Remote session was not found.",
        404,
    );
    const state = effectiveState(row, now);
    if (state === "approved") {
      return remoteSessionView(sessionId, row, {now, includeKeyMaterial: true});
    }
    protocol.requireValue(
        state === "requested",
        "failed_precondition",
        `A remote session in ${state} cannot be approved.`,
        409,
    );
    const updated = {
      ...row,
      state: "approved",
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return remoteSessionView(sessionId, updated, {now, includeKeyMaterial: true});
  });
}

async function endRemoteSession(uid, payload, context) {
  const sessionId = protocol.cleanString(payload?.sessionId, 64, "sessionId");
  protocol.requireValue(
      SESSION_ID_PATTERN.test(sessionId),
      "invalid_argument",
      "Invalid remote session id.",
  );
  const now = contextNow(context);
  const ref = context.db.doc(`fleetRemoteSessions/${sessionId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    protocol.requireValue(
        row && row.ownerUid === uid,
        "not_found",
        "Remote session was not found.",
        404,
    );
    const state = effectiveState(row, now);
    if (TERMINAL_STATES.has(state)) {
      if (state !== row.state) {
        const expired = {...row, state: "expired", updatedAt: timestamp(context, now)};
        transaction.set(ref, expired);
        return remoteSessionView(sessionId, expired, {now});
      }
      return remoteSessionView(sessionId, row, {now});
    }
    const updated = {
      ...row,
      state: "ended",
      endedAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return remoteSessionView(sessionId, updated, {now});
  });
}

async function listRemoteSessions(uid, payload, context) {
  const limit = protocol.boundedInteger(payload?.limit, 1, 50, "limit", 25);
  const now = contextNow(context);
  const snapshot = await context.db.collection("fleetRemoteSessions")
      .where("ownerUid", "==", uid)
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();
  return {
    sessions: snapshot.docs.map((doc) =>
      remoteSessionView(doc.id, doc.data(), {now, includeKeyMaterial: true})),
    limit,
    mayHaveMore: snapshot.docs.length === limit,
  };
}

// ---------------------------------------------------------------------------
// Device-signed actions (worker/host side, via workbenchDeviceApi)
// ---------------------------------------------------------------------------

function requireWorkerSessionRow(row, identity, sessionId) {
  protocol.requireValue(
      row && SESSION_ID_PATTERN.test(sessionId),
      "not_found",
      "Remote session was not found.",
      404,
  );
  protocol.requireValue(
      row.ownerUid === identity.ownerUid &&
        row.workerDeviceId === identity.deviceId,
      "not_found",
      "Remote session was not found.",
      404,
  );
}

// workerGrantCovers finds an active grant from the session's controller to
// this worker covering every requested screen capability.
async function workerGrantCovers(context, row, now) {
  const snapshot = await context.db.collection("fleetGrants")
      .where("ownerUid", "==", row.ownerUid)
      .where("receipt.workerDeviceId", "==", row.workerDeviceId)
      .where("receipt.controllerDeviceId", "==", row.controllerDeviceId)
      .where("revokedAt", "==", null)
      .limit(16)
      .get();
  const controllerSnapshot = await context.db
      .doc(`fleetDevices/${row.controllerDeviceId}`)
      .get();
  const controller = controllerSnapshot.exists ? controllerSnapshot.data() : null;
  if (
    !controller ||
    controller.ownerUid !== row.ownerUid ||
    controller.status !== "active" ||
    !["controller", "hybrid"].includes(controller.role)
  ) {
    return false;
  }
  for (const doc of snapshot.docs) {
    const grant = doc.data();
    const receipt = grant.receipt || {};
    if (
      receipt.policyVersion !== 1 ||
      protocol.toMillis(receipt.issuedAt) > now ||
      protocol.toMillis(receipt.expiresAt) <= now ||
      !Array.isArray(receipt.capabilities)
    ) {
      continue;
    }
    const covered = row.capabilities.every((capability) =>
      receipt.capabilities.includes(capability));
    if (covered) return true;
  }
  return false;
}

async function pollRemoteSessions(identity, payload, context) {
  protocol.requireValue(
      payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload).length === 0,
      "invalid_argument",
      "Remote session poll payload must be empty.",
  );
  const now = contextNow(context);
  const snapshot = await context.db.collection("fleetRemoteSessions")
      .where("workerDeviceId", "==", identity.deviceId)
      .orderBy("updatedAt", "desc")
      .limit(25)
      .get();
  const sessions = [];
  for (const doc of snapshot.docs) {
    const row = doc.data();
    if (row.ownerUid !== identity.ownerUid) continue;
    const state = effectiveState(row, now);
    if (state !== row.state) {
      // Lazily persist the expiry so other readers agree.
      await doc.ref.set({
        ...row,
        state: "expired",
        updatedAt: timestamp(context, now),
      });
    }
    if (TERMINAL_STATES.has(state)) continue;
    sessions.push(
        remoteSessionView(doc.id, row, {
          now,
          includeKeyMaterial: state === "approved" || state === "active",
        }),
    );
    if (sessions.length >= 10) break;
  }
  return {sessions};
}

async function approveRemoteSessionDevice(identity, payload, context) {
  const sessionId = protocol.cleanString(payload?.sessionId, 64, "sessionId");
  protocol.requireValue(
      SESSION_ID_PATTERN.test(sessionId),
      "invalid_argument",
      "Invalid remote session id.",
  );
  const workerEphemeralKey = protocol.cleanString(
      payload?.workerEphemeralKey,
      256,
      "workerEphemeralKey",
  );
  try {
    fleetAuth.normalizePublicKeySpki(workerEphemeralKey);
  } catch {
    throw Object.assign(
        new Error("The worker ephemeral key is invalid."),
        {code: "invalid_argument", status: 400},
    );
  }
  const now = contextNow(context);
  const ref = context.db.doc(`fleetRemoteSessions/${sessionId}`);
  const snapshot = await ref.get();
  const row = snapshot.exists ? snapshot.data() : null;
  requireWorkerSessionRow(row, identity, sessionId);
  const state = effectiveState(row, now);
  if (
    (state === "approved" || state === "active") &&
    row.workerEphemeralKey === workerEphemeralKey
  ) {
    return {
      session: remoteSessionView(sessionId, row, {now, includeKeyMaterial: true}),
      approved: true,
      pending: false,
    };
  }
  // Two consent paths move a session forward:
  //   - requested: the unattended path. The worker auto-approves only with
  //     an active grant from the session controller covering the requested
  //     capabilities; otherwise the session stays pending for the owner.
  //   - approved without a worker ephemeral key: the attended path. The
  //     owner already approved through the account API, so the worker
  //     attaches its ephemeral key when it picks the session up.
  if (state === "approved" && row.workerEphemeralKey == null) {
    const updated = await context.db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(ref);
      const current = currentSnapshot.exists ? currentSnapshot.data() : null;
      requireWorkerSessionRow(current, identity, sessionId);
      const currentState = effectiveState(current, now);
      if (
        (currentState === "approved" || currentState === "active") &&
        current.workerEphemeralKey === workerEphemeralKey
      ) {
        return current;
      }
      protocol.requireValue(
          currentState === "approved" && current.workerEphemeralKey == null,
          "failed_precondition",
          `A remote session in ${currentState} cannot be approved.`,
          409,
      );
      const next = {
        ...current,
        workerEphemeralKey,
        approvalReceiptDigest: approvalDigest(sessionId, current, workerEphemeralKey, now),
        updatedAt: timestamp(context, now),
      };
      transaction.set(ref, next);
      return next;
    });
    return {
      session: remoteSessionView(sessionId, updated, {now, includeKeyMaterial: true}),
      approved: true,
      pending: false,
    };
  }
  protocol.requireValue(
      state === "requested",
      "failed_precondition",
      `A remote session in ${state} cannot be approved.`,
      409,
  );
  // The grant read happens before the state transition write; a grant
  // revoked in the intervening instant still leaves a session the owner can
  // end, and the worker re-verifies listing membership on every poll.
  if (!(await workerGrantCovers(context, row, now))) {
    return {
      session: remoteSessionView(sessionId, row, {now}),
      approved: false,
      pending: true,
    };
  }
  const updated = await context.db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(ref);
    const current = currentSnapshot.exists ? currentSnapshot.data() : null;
    requireWorkerSessionRow(current, identity, sessionId);
    const currentState = effectiveState(current, now);
    if (
      (currentState === "approved" || currentState === "active") &&
      current.workerEphemeralKey === workerEphemeralKey
    ) {
      return current;
    }
    protocol.requireValue(
        currentState === "requested",
        "failed_precondition",
        `A remote session in ${currentState} cannot be approved.`,
        409,
    );
    const next = {
      ...current,
      state: "approved",
      workerEphemeralKey,
      approvalReceiptDigest: approvalDigest(sessionId, current, workerEphemeralKey, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, next);
    return next;
  });
  return {
    session: remoteSessionView(sessionId, updated, {now, includeKeyMaterial: true}),
    approved: true,
    pending: false,
  };
}

function approvalDigest(sessionId, row, workerEphemeralKey, now) {
  return createHash("sha256")
      .update(fleetAuth.canonicalJson({
        sessionId,
        workerDeviceId: row.workerDeviceId,
        controllerDeviceId: row.controllerDeviceId,
        capabilities: row.capabilities,
        workerEphemeralKey,
        approvedAt: new Date(now).toISOString(),
      }))
      .digest("hex");
}

async function activateRemoteSessionDevice(identity, payload, context) {
  const sessionId = protocol.cleanString(payload?.sessionId, 64, "sessionId");
  protocol.requireValue(
      SESSION_ID_PATTERN.test(sessionId),
      "invalid_argument",
      "Invalid remote session id.",
  );
  const now = contextNow(context);
  const ref = context.db.doc(`fleetRemoteSessions/${sessionId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    requireWorkerSessionRow(row, identity, sessionId);
    const state = effectiveState(row, now);
    if (state === "active") {
      return remoteSessionView(sessionId, row, {now, includeKeyMaterial: true});
    }
    protocol.requireValue(
        state === "approved",
        "failed_precondition",
        `A remote session in ${state} cannot become active.`,
        409,
    );
    const updated = {
      ...row,
      state: "active",
      startedAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return remoteSessionView(sessionId, updated, {now, includeKeyMaterial: true});
  });
}

async function endRemoteSessionDevice(identity, payload, context) {
  const sessionId = protocol.cleanString(payload?.sessionId, 64, "sessionId");
  protocol.requireValue(
      SESSION_ID_PATTERN.test(sessionId),
      "invalid_argument",
      "Invalid remote session id.",
  );
  const now = contextNow(context);
  const ref = context.db.doc(`fleetRemoteSessions/${sessionId}`);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? snapshot.data() : null;
    requireWorkerSessionRow(row, identity, sessionId);
    const state = effectiveState(row, now);
    if (TERMINAL_STATES.has(state)) {
      if (state !== row.state) {
        const expired = {...row, state: "expired", updatedAt: timestamp(context, now)};
        transaction.set(ref, expired);
        return remoteSessionView(sessionId, expired, {now});
      }
      return remoteSessionView(sessionId, row, {now});
    }
    const updated = {
      ...row,
      state: "ended",
      endedAt: timestamp(context, now),
      updatedAt: timestamp(context, now),
    };
    transaction.set(ref, updated);
    return remoteSessionView(sessionId, updated, {now});
  });
}

module.exports = {
  REMOTE_SESSION_PROTOCOL,
  SESSION_ID_PATTERN,
  SESSION_TTL_MS,
  activateRemoteSessionDevice,
  approveRemoteSession,
  approveRemoteSessionDevice,
  endRemoteSession,
  endRemoteSessionDevice,
  listRemoteSessions,
  pollRemoteSessions,
  remoteSessionView,
  requestRemoteSession,
};
