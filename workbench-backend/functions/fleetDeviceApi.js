const fleet = require("./fleet");
const fleetAuth = require("./fleetAuth");
const fleetRemoteSession = require("./fleetRemoteSession");
const protocol = require("./fleetProtocol");

const DEVICE_ACTIONS = Object.freeze({
  "device.status": {
    handler: async (identity, payload) => {
      protocol.requireValue(
          payload &&
            typeof payload === "object" &&
            !Array.isArray(payload) &&
            Object.keys(payload).length === 0,
          "invalid_argument",
          "Device status payload must be empty.",
      );
      return {
        ownerUid: identity.ownerUid,
        deviceId: identity.deviceId,
        publicKeyFingerprint: identity.publicKeyFingerprint,
        status: "active",
      };
    },
    limit: 120,
    windowSeconds: 3_600,
  },
  heartbeat: {
    handler: fleet.recordDeviceHeartbeat,
    limit: 1_200,
    windowSeconds: 3_600,
  },
  "job.poll": {
    handler: fleet.pollJobs,
    limit: 1_200,
    windowSeconds: 3_600,
  },
  "job.claim": {
    handler: fleet.claimJob,
    limit: 600,
    windowSeconds: 3_600,
  },
  "lease.renew": {
    handler: fleet.renewLease,
    limit: 7_200,
    windowSeconds: 3_600,
  },
  "job.event": {
    handler: fleet.appendJobEvent,
    limit: 7_200,
    windowSeconds: 3_600,
  },
  "job.transition": {
    handler: fleet.transitionJob,
    limit: 1_200,
    windowSeconds: 3_600,
  },
  "artifact.reserve": {
    handler: fleet.reserveArtifact,
    limit: 240,
    windowSeconds: 3_600,
  },
  "artifact.commit": {
    handler: fleet.commitArtifact,
    limit: 240,
    windowSeconds: 3_600,
  },
  "helper.bind": {
    handler: fleet.bindHelper,
    limit: 240,
    windowSeconds: 3_600,
  },
  "helper.challenge": {
    handler: fleet.createHelperChallenge,
    limit: 600,
    windowSeconds: 3_600,
  },
  "helper.attest": {
    handler: fleet.attestHelper,
    limit: 600,
    windowSeconds: 3_600,
  },
  "remote-session.poll": {
    handler: fleetRemoteSession.pollRemoteSessions,
    limit: 3_600,
    windowSeconds: 3_600,
  },
  "remote-session.approve": {
    handler: fleetRemoteSession.approveRemoteSessionDevice,
    limit: 240,
    windowSeconds: 3_600,
  },
  "remote-session.activate": {
    handler: fleetRemoteSession.activateRemoteSessionDevice,
    limit: 240,
    windowSeconds: 3_600,
  },
  "remote-session.end": {
    handler: fleetRemoteSession.endRemoteSessionDevice,
    limit: 240,
    windowSeconds: 3_600,
  },
});

function requestTime(context) {
  return protocol.validTime(context.now ? context.now() : Date.now());
}

function timestamp(context, millis) {
  if (context.Timestamp && typeof context.Timestamp.fromMillis === "function") {
    return context.Timestamp.fromMillis(millis);
  }
  return new Date(millis);
}

async function authenticateDeviceRequest(body, context) {
  protocol.requireValue(
      body && typeof body === "object" && !Array.isArray(body),
      "invalid_argument",
      "Device request is required.",
  );
  const actionName = protocol.cleanString(body.action, 64, "action");
  const action = DEVICE_ACTIONS[actionName];
  protocol.requireValue(
      action,
      "invalid_argument",
      "Unsupported device action.",
  );
  const envelope = body.envelope;
  const deviceId = protocol.cleanString(
      envelope?.deviceId,
      64,
      "envelope.deviceId",
  );
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(deviceId),
      "unauthenticated",
      "Invalid device identity.",
      401,
  );
  const snapshot = await context.db.doc(`fleetDevices/${deviceId}`).get();
  const device = snapshot.exists ? snapshot.data() : null;
  protocol.requireValue(
      device &&
        device.id === deviceId &&
        device.status === "active" &&
        typeof device.publicKeySpki === "string",
      "unauthenticated",
      "Device is not enrolled.",
      401,
  );
  const now = requestTime(context);
  const verified = fleetAuth.verifySignedDeviceRequest({
    publicKeySpki: device.publicKeySpki,
    envelope,
    payload: body.payload || {},
    expectedAction: actionName,
    now,
  });
  protocol.requireValue(
      device.ownerUid &&
        device.publicKeyFingerprint === verified.publicKeyFingerprint,
      "unauthenticated",
      "Device enrollment does not match its key.",
      401,
  );

  return {
    action,
    actionName,
    identity: {
      ownerUid: device.ownerUid,
      deviceId,
      publicKeyFingerprint: verified.publicKeyFingerprint,
    },
    replayId: verified.replayId,
    requestId: verified.requestId,
    issuedAt: verified.issuedAt,
    expiresAt: verified.expiresAt,
    now,
  };
}

async function consumeDeviceRequest(authenticated, context) {
  const replayRef = context.db.doc(
      `fleetDeviceRequests/${authenticated.replayId}`,
  );
  await context.db.runTransaction(async (transaction) => {
    const replaySnapshot = await transaction.get(replayRef);
    protocol.requireValue(
        !replaySnapshot.exists,
        "replayed_request",
        "Device request was already used.",
        409,
    );
    transaction.set(replayRef, {
      schemaVersion: protocol.PROTOCOL_VERSION,
      ownerUid: authenticated.identity.ownerUid,
      deviceId: authenticated.identity.deviceId,
      requestId: authenticated.requestId,
      action: authenticated.actionName,
      issuedAt: timestamp(context, authenticated.issuedAt),
      expiresAt: timestamp(context, authenticated.expiresAt),
      consumedAt: timestamp(context, authenticated.now),
    });
  });
}

async function authenticateAndConsume(body, context) {
  const authenticated = await authenticateDeviceRequest(body, context);
  await consumeDeviceRequest(authenticated, context);
  return authenticated;
}

async function handleDeviceRequest(body, context) {
  const authenticated = await authenticateDeviceRequest(body, context);
  if (typeof context.enforceRateLimit === "function") {
    await context.enforceRateLimit({
      deviceId: authenticated.identity.deviceId,
      action: authenticated.actionName,
      limit: authenticated.action.limit,
      windowSeconds: authenticated.action.windowSeconds,
    });
  }
  await consumeDeviceRequest(authenticated, context);
  const result = await authenticated.action.handler(
      authenticated.identity,
      body.payload || {},
      context,
  );
  const response = {
    action: authenticated.actionName,
    deviceId: authenticated.identity.deviceId,
    requestId: authenticated.requestId,
    result,
  };
  protocol.requireValue(
      typeof context.signDeviceResponse === "function",
      "failed_precondition",
      "Fleet response signing is not configured.",
      503,
  );
  return {
    ...response,
    responseSignature: await context.signDeviceResponse(response),
  };
}

module.exports = {
  DEVICE_ACTIONS,
  authenticateAndConsume,
  authenticateDeviceRequest,
  consumeDeviceRequest,
  handleDeviceRequest,
};
