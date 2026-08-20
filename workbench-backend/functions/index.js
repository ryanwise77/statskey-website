const {initializeApp} = require("firebase-admin/app");
const {createPrivateKey, createHash, sign} = require("node:crypto");
const {getAuth} = require("firebase-admin/auth");
const {FieldPath, getFirestore, Timestamp} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret, defineString} = require("firebase-functions/params");
const fleet = require("./fleet");
const fleetAuth = require("./fleetAuth");
const fleetRemoteSession = require("./fleetRemoteSession");
const {createGcsFleetArtifactStore} = require("./fleetArtifactStore");
const fleetDeviceApi = require("./fleetDeviceApi");
const github = require("./github");
const {enforceRateLimit} = require("./rateLimit");

const workbenchApp = initializeApp();
const statsKeyAuthApp = initializeApp(
    {projectId: "statskey"},
    "statskey-auth-verifier",
);
const db = getFirestore(workbenchApp, "workbench");
const encryptionKey = defineSecret("WORKBENCH_TOKEN_ENCRYPTION_KEY");
const fleetResponseSigningKey = defineSecret("FLEET_RESPONSE_SIGNING_KEY");
const githubOAuthClientId = defineString("GITHUB_OAUTH_CLIENT_ID", {default: ""});
const fleetResponseSigningKeyId = defineString(
    "FLEET_RESPONSE_SIGNING_KEY_ID",
    {default: ""},
);
const fleetResponseSigningPublicKey = defineString(
    "FLEET_RESPONSE_SIGNING_PUBLIC_KEY",
    {default: ""},
);
const fleetArtifactBucketName = defineString("FLEET_ARTIFACT_BUCKET", {
  default: "",
});
// host:port of the session relay (for example the DigitalOcean droplet
// running statskey-relayd). Empty disables Fleet remote sessions: every
// remote-session action fails closed.
const fleetRemoteRelayEndpoint = defineString("FLEET_REMOTE_RELAY", {
  default: "",
});
const WORKBENCH_API_SERVICE_ACCOUNT =
  "workbench-api@statskey-workbench.iam.gserviceaccount.com";
const FLEET_DEVICE_SERVICE_ACCOUNT =
  "fleet-device-api@statskey-workbench.iam.gserviceaccount.com";
const FLEET_SWEEP_SERVICE_ACCOUNT =
  "fleet-sweep@statskey-workbench.iam.gserviceaccount.com";
let fleetArtifactStore = null;
let fleetResponseSigner = null;
let fleetResponseSignerDigest = null;
const FLEET_SIGNING_PREFLIGHT_ACTIONS = new Set([
  "fleetBootstrapDevice",
  "fleetRecoverController",
  "fleetPairDevice",
  "fleetGetCoordinatorTrust",
]);

const ACTIONS = {
  fleetBootstrapDevice: {
    handler: fleet.bootstrapDevice,
    limit: 10,
    windowSeconds: 3600,
  },
  fleetRecoverController: {
    handler: fleet.recoverController,
    limit: 5,
    windowSeconds: 3600,
  },
  fleetPairDevice: {
    handler: fleet.pairDevice,
    limit: 30,
    windowSeconds: 3600,
  },
  fleetCreateLocalGrant: {
    handler: fleet.createLocalGrant,
    limit: 30,
    windowSeconds: 3600,
  },
  fleetCreateJob: {
    handler: fleet.createJob,
    limit: 120,
    windowSeconds: 3600,
  },
  fleetGetJob: {
    handler: fleet.getJob,
    limit: 600,
    windowSeconds: 3600,
  },
  fleetGetCoordinatorTrust: {
    handler: getFleetCoordinatorTrust,
    limit: 120,
    windowSeconds: 3600,
  },
  fleetCreateArtifactDownload: {
    handler: fleet.createArtifactDownload,
    limit: 120,
    windowSeconds: 3600,
  },
  fleetListJobs: {
    handler: fleet.listJobs,
    limit: 600,
    windowSeconds: 3600,
  },
  fleetListDevices: {
    handler: fleet.listDevices,
    limit: 600,
    windowSeconds: 3600,
  },
  fleetListGrants: {
    handler: fleet.listGrants,
    limit: 600,
    windowSeconds: 3600,
  },
  fleetRevokeDevice: {
    handler: fleet.revokeDevice,
    limit: 30,
    windowSeconds: 3600,
  },
  fleetRevokeGrant: {
    handler: fleet.revokeGrant,
    limit: 60,
    windowSeconds: 3600,
  },
  fleetListJobEvents: {
    handler: fleet.listJobEvents,
    limit: 1_200,
    windowSeconds: 3600,
  },
  fleetCancelJob: {
    handler: fleet.cancelJob,
    limit: 120,
    windowSeconds: 3600,
  },
  fleetRecoverJob: {
    handler: fleet.recoverJob,
    limit: 120,
    windowSeconds: 3600,
  },
  fleetRemoteSessionRequest: {
    handler: fleetRemoteSession.requestRemoteSession,
    limit: 60,
    windowSeconds: 3600,
  },
  fleetRemoteSessionApprove: {
    handler: fleetRemoteSession.approveRemoteSession,
    limit: 120,
    windowSeconds: 3600,
  },
  fleetRemoteSessionEnd: {
    handler: fleetRemoteSession.endRemoteSession,
    limit: 240,
    windowSeconds: 3600,
  },
  fleetRemoteSessionList: {
    handler: fleetRemoteSession.listRemoteSessions,
    limit: 600,
    windowSeconds: 3600,
  },
  connectionStatus: {
    handler: github.connectionStatus,
    limit: 120,
    windowSeconds: 3600,
  },
  connect: {
    handler: github.connect,
    limit: 10,
    windowSeconds: 3600,
  },
  deviceStart: {
    handler: github.deviceStart,
    limit: 12,
    windowSeconds: 3600,
  },
  devicePoll: {
    handler: github.devicePoll,
    limit: 360,
    windowSeconds: 3600,
  },
  disconnect: {
    handler: github.disconnect,
    limit: 10,
    windowSeconds: 3600,
  },
  repositories: {
    handler: github.repositories,
    limit: 60,
    windowSeconds: 3600,
  },
  branches: {
    handler: github.branches,
    limit: 120,
    windowSeconds: 3600,
  },
  tree: {
    handler: github.tree,
    limit: 120,
    windowSeconds: 3600,
  },
  readFile: {
    handler: github.readFile,
    limit: 300,
    windowSeconds: 3600,
  },
  commit: {
    handler: github.commit,
    limit: 60,
    windowSeconds: 3600,
  },
};

exports.workbenchApi = onRequest({
  region: "us-central1",
  serviceAccount: WORKBENCH_API_SERVICE_ACCOUNT,
  memory: "512MiB",
  timeoutSeconds: 120,
  maxInstances: 100,
  concurrency: 40,
  secrets: [encryptionKey],
}, async (req, res) => {
  setCors(req, res);
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({error: {code: "method_not_allowed", message: "POST required."}});
    return;
  }
  try {
    const requestedActionName = String(req.body?.action || "");
    const account = await verifyStatsKeyUser(req, {
      checkRevoked: requestedActionName.startsWith("fleet"),
    });
    const uid = account.uid;
    const actionName = requestedActionName;
    const action = ACTIONS[actionName];
    if (!action) {
      throw apiError("invalid_argument", "Unsupported workspace action.", 400);
    }
    if (actionName.startsWith("fleet") && account.statskey_fleet !== true) {
      throw apiError(
          "permission_denied",
          "Fleet access is not enabled for this account.",
          403,
      );
    }
    const fleetCoordinatorTrustForAction =
      FLEET_SIGNING_PREFLIGHT_ACTIONS.has(actionName) ?
        configuredFleetCoordinatorTrust() :
        null;
    if (
      actionName !== "fleetGetCoordinatorTrust" &&
      FLEET_SIGNING_PREFLIGHT_ACTIONS.has(actionName) &&
      !fleetCoordinatorTrustForAction
    ) {
      throw apiError(
          "failed_precondition",
          "Fleet response signing is not configured.",
          503,
      );
    }
    await enforceRateLimit({
      db,
      uid,
      action: actionName,
      limit: action.limit,
      windowSeconds: action.windowSeconds,
      Timestamp,
    });
    const result = await action.handler(uid, req.body?.payload || {}, {
      db,
      encryptionKey: encryptionKey.value().trim(),
      oauthClientId: githubOAuthClientId.value().trim(),
      now: () => Timestamp.now(),
      Timestamp,
      accountAuthTimeMs: Number(account.auth_time) * 1000,
      artifactStore: configuredFleetArtifactStore(),
      coordinatorTrust: fleetCoordinatorTrustForAction,
      remoteRelayEndpoint: fleetRemoteRelayEndpoint.value().trim(),
    });
    res.status(200).json({data: result});
  } catch (error) {
    console.error("[workbenchApi]", safeLogError(error));
    res.status(Number(error?.status) || 500).json({
      error: {
        code: error?.code || "internal",
        message:
          Number(error?.status) >= 500 || !error?.status ?
            "Workbench request failed." :
            error.message,
      },
    });
  }
});

exports.workbenchDeviceApi = onRequest({
  region: "us-central1",
  serviceAccount: FLEET_DEVICE_SERVICE_ACCOUNT,
  memory: "256MiB",
  timeoutSeconds: 60,
  maxInstances: 100,
  concurrency: 80,
  secrets: [fleetResponseSigningKey],
}, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  if (req.method !== "POST") {
    res.status(405).json({
      error: {code: "method_not_allowed", message: "POST required."},
    });
    return;
  }
  try {
    const bodyBytes = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
    if (bodyBytes > 160 * 1024) {
      throw apiError("invalid_argument", "Device request is too large.", 400);
    }
    const responseSigner = configuredFleetResponseSigner();
    if (!responseSigner) {
      throw apiError(
          "failed_precondition",
          "Fleet response signing is not configured.",
          503,
      );
    }
    const result = await fleetDeviceApi.handleDeviceRequest(req.body || {}, {
      db,
      now: () => Timestamp.now(),
      Timestamp,
      artifactStore: configuredFleetArtifactStore(),
      remoteRelayEndpoint: fleetRemoteRelayEndpoint.value().trim(),
      signDeviceResponse: (response) => responseSigner.sign(response),
      signFleetPayload: (unsigned) => responseSigner.signPayload(unsigned),
      enforceRateLimit: ({
        deviceId,
        action,
        limit,
        windowSeconds,
      }) => enforceRateLimit({
        db,
        uid: `device:${deviceId}`,
        action: `fleet:${action}`,
        limit,
        windowSeconds,
        Timestamp,
      }),
    });
    res.status(200).json({data: result});
  } catch (error) {
    console.error("[workbenchDeviceApi]", safeLogError(error));
    res.status(Number(error?.status) || 500).json({
      error: {
        code: error?.code || "internal",
        message:
          Number(error?.status) >= 500 || !error?.status ?
            "Device request failed." :
            error.message,
      },
    });
  }
});

exports.workbenchFleetSweep = onSchedule({
  region: "us-central1",
  serviceAccount: FLEET_SWEEP_SERVICE_ACCOUNT,
  schedule: "every 1 minutes",
  memory: "256MiB",
  timeoutSeconds: 120,
  maxInstances: 1,
}, async () => {
  const aggregate = {
    rounds: 0,
    scannedLeases: 0,
    scannedQueuedJobs: 0,
    recovered: 0,
    skipped: 0,
    failed: 0,
    hasMore: false,
    artifactsScanned: 0,
    artifactsDeleted: 0,
    artifactFailures: 0,
    artifactsHaveMore: false,
    phaseFailures: 0,
  };
  const sweepWork = async () => {
    for (let round = 0; round < 5; round += 1) {
      const result = await fleet.sweepExpiredFleetWork({
        db,
        now: () => Timestamp.now(),
        Timestamp,
      }, {limit: 100});
      aggregate.rounds += 1;
      aggregate.scannedLeases += result.scannedLeases;
      aggregate.scannedQueuedJobs += result.scannedQueuedJobs;
      aggregate.recovered += result.recovered;
      aggregate.skipped += result.skipped;
      aggregate.failed += result.failed;
      aggregate.hasMore = result.hasMore;
      if (!result.hasMore) break;
    }
  };
  const sweepArtifacts = async () => {
    const artifactStore = configuredFleetArtifactStore();
    for (let round = 0; artifactStore && round < 5; round += 1) {
      const result = await fleet.sweepExpiredArtifactUploads({
        db,
        now: () => Timestamp.now(),
        Timestamp,
        documentIdField: FieldPath.documentId(),
        artifactStore,
      }, {limit: 100});
      aggregate.artifactsScanned += result.scanned;
      aggregate.artifactsDeleted += result.deleted;
      aggregate.artifactFailures += result.failed;
      aggregate.artifactsHaveMore = result.hasMore;
      if (!result.hasMore) break;
    }
  };
  const phases = await Promise.allSettled([sweepWork(), sweepArtifacts()]);
  for (const phase of phases) {
    if (phase.status === "rejected") {
      aggregate.phaseFailures += 1;
      console.error("[workbenchFleetSweep]", safeLogError(phase.reason));
    }
  }
  if (
    aggregate.recovered > 0 ||
    aggregate.failed > 0 ||
    aggregate.hasMore ||
    aggregate.artifactsDeleted > 0 ||
    aggregate.artifactFailures > 0 ||
    aggregate.artifactsHaveMore ||
    aggregate.phaseFailures > 0
  ) {
    console.info("[workbenchFleetSweep]", aggregate);
  }
  if (aggregate.phaseFailures > 0) {
    throw new Error("One or more Fleet sweep phases failed.");
  }
});

function configuredFleetArtifactStore() {
  const bucketName = fleetArtifactBucketName.value().trim();
  if (!bucketName) return null;
  if (!fleetArtifactStore) {
    fleetArtifactStore = createGcsFleetArtifactStore({
      bucket: getStorage(workbenchApp).bucket(bucketName),
    });
  }
  return fleetArtifactStore;
}

function configuredFleetResponseSigner() {
  let encoded = "";
  try {
    encoded = fleetResponseSigningKey.value().trim();
  } catch {
    return null;
  }
  const trust = configuredFleetCoordinatorTrust();
  if (!encoded || !trust) return null;
  const keyId = trust.keyId;
  if (
    !/^[A-Za-z0-9_-]{40,4096}$/.test(encoded) ||
    !/^[a-z][a-z0-9._-]{2,63}$/.test(keyId)
  ) {
    throw apiError(
        "failed_precondition",
        "Fleet response signing configuration is invalid.",
        503,
    );
  }
  const digest = createHash("sha256")
      .update(`${keyId}\0${trust.publicKeySpki}\0${encoded}`)
      .digest("hex");
  if (fleetResponseSigner && fleetResponseSignerDigest === digest) {
    return fleetResponseSigner;
  }
  let privateKey;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(encoded, "base64url"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    throw apiError(
        "failed_precondition",
        "Fleet response signing configuration is invalid.",
        503,
    );
  }
  if (fleetAuth.exportPublicKeySpki(privateKey) !== trust.publicKeySpki) {
    throw apiError(
        "failed_precondition",
        "Fleet response signing key does not match its public pin.",
        503,
    );
  }
  fleetResponseSigner = Object.freeze({
    trust,
    sign(response) {
      const issuedAt = Date.now();
      return fleetAuth.createSignedDeviceResponse({
        privateKey,
        keyId,
        deviceId: response.deviceId,
        requestId: response.requestId,
        action: response.action,
        result: response.result,
        issuedAt,
        expiresAt: issuedAt + 60_000,
      });
    },
    // Signs canonical-JSON Fleet structures (execution tickets, lease
    // updates) with the same coordinator response signing key.
    signPayload(unsigned) {
      return sign(
          null,
          Buffer.from(fleetAuth.canonicalJson(unsigned)),
          privateKey,
      ).toString("base64url");
    },
  });
  fleetResponseSignerDigest = digest;
  return fleetResponseSigner;
}

function configuredFleetCoordinatorTrust() {
  const keyId = fleetResponseSigningKeyId.value().trim();
  const publicKeySpki = fleetResponseSigningPublicKey.value().trim();
  if (!keyId || !publicKeySpki) return null;
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(keyId)) {
    throw apiError(
        "failed_precondition",
        "Fleet response signing configuration is invalid.",
        503,
    );
  }
  try {
    fleetAuth.normalizePublicKeySpki(publicKeySpki);
  } catch {
    throw apiError(
        "failed_precondition",
        "Fleet response signing configuration is invalid.",
        503,
    );
  }
  return Object.freeze({
    keyId,
    publicKeySpki,
    algorithm: "Ed25519",
  });
}

async function getFleetCoordinatorTrust(_uid, payload, context) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 0
  ) {
    throw apiError("invalid_argument", "Trust payload must be empty.", 400);
  }
  if (!context.coordinatorTrust) {
    throw apiError(
        "failed_precondition",
        "Fleet response signing is not configured.",
        503,
    );
  }
  return context.coordinatorTrust;
}

async function verifyStatsKeyUser(req, {checkRevoked = false} = {}) {
  const authorization = req.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw apiError("unauthenticated", "Sign in to StatsKey.", 401);
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token || token.length > 8192) {
    throw apiError("unauthenticated", "Invalid StatsKey session.", 401);
  }
  try {
    const auth = getAuth(statsKeyAuthApp);
    const decoded = await auth.verifyIdToken(
        token,
        checkRevoked === true,
    );
    if (!decoded.uid || decoded.firebase?.sign_in_provider === "anonymous") {
      throw new Error("Unsupported identity.");
    }
    if (checkRevoked !== true) return decoded;
    const currentUser = await auth.getUser(decoded.uid);
    return {
      ...decoded,
      statskey_fleet: currentUser.customClaims?.statskey_fleet === true,
    };
  } catch {
    throw apiError("unauthenticated", "StatsKey session expired.", 401);
  }
}

function setCors(req, res) {
  const origin = req.get("Origin") || "";
  const allowed =
    origin === "https://statskey.ai" ||
    origin === "https://www.statskey.ai" ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (allowed) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
}

function apiError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function safeLogError(error) {
  return {
    code: error?.code || "internal",
    status: Number(error?.status) || 500,
    message: String(error?.message || "Unknown error")
        .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
        .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]")
        .slice(0, 500),
  };
}
