#!/usr/bin/env node
// fleet-owner-ops.mjs — owner-side Fleet operations for headless devices.
//
// Drives the account-authenticated Fleet API the same way the desktop app
// does, so a headless worker (statskey-fleetd on Ubuntu) can be enrolled
// without a second desktop UI:
//
//   node fleet-owner-ops.mjs bootstrap-ops-controller
//   node fleet-owner-ops.mjs pair-worker-prepare candidate.json [options]
//   node fleet-owner-ops.mjs pair-worker-submit <receipt.json> <candidate-proof.json>
//   node fleet-owner-ops.mjs approve-device-card <card.json>
//   node fleet-owner-ops.mjs devices
//   node fleet-owner-ops.mjs trust
//
// Auth: mints a Firebase custom token for the owner UID, signed by the
// statskey project's firebase-adminsdk service account through
// `gcloud iam service-accounts sign-blob` (no key ever downloaded), then
// exchanges it for an ID token. The account API re-reads the user record, so
// the statskey_fleet claim on the user record is what authorizes Fleet.
//
// State: .fleet-ops/ (gitignored, 0700/0600) holds the ops controller key.
// This controller is a real enrolled controller; treat its key like a root
// credential for the Fleet account.

import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const fleetAuth = require("./functions/fleetAuth.js");
const pairing = require("../desktop/fleet-pairing-runtime.cjs");

const OWNER_UID = "ie30TVwZXrT3aAYxqT9duTExUBV2";
const STATSKEY_API_KEY = "AIzaSyD7b9XKxV0Z7qdcdgMEVuE-fTTIoYsLCpc";
const ADMIN_SDK_SA = "firebase-adminsdk-fbsvc@statskey.iam.gserviceaccount.com";
const WORKBENCH_API =
  "https://us-central1-statskey-workbench.cloudfunctions.net/workbenchApi";
const STATE_DIR = join(here, ".fleet-ops");
const CONTROLLER_FILE = join(STATE_DIR, "ops-controller.json");

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function loadController() {
  const raw = JSON.parse(readFileSync(CONTROLLER_FILE, "utf8"));
  return {
    ...raw,
    privateKey: createPrivateKey({
      key: Buffer.from(raw.privateKeyPkcs8, "base64url"),
      format: "der",
      type: "pkcs8",
    }),
  };
}

function saveController() {
  mkdirSync(STATE_DIR, { mode: 0o700, recursive: true });
  chmodSync(STATE_DIR, 0o700);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeySpki = fleetAuth.exportPublicKeySpki(publicKey);
  const identity = fleetAuth.deviceIdentityForPublicKey(publicKeySpki);
  const record = {
    deviceId: identity.deviceId,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    publicKeySpki,
    privateKeyPkcs8: b64url(privateKey.export({ format: "der", type: "pkcs8" })),
    profile: {
      label: "StatsKey ops controller",
      role: "controller",
      workerMode: "disabled",
      platform: "darwin",
      maxConcurrentJobs: 1,
    },
    createdAt: new Date().toISOString(),
  };
  writeFileSync(CONTROLLER_FILE, JSON.stringify(record, null, 2) + "\n", {
    mode: 0o600,
  });
  chmodSync(CONTROLLER_FILE, 0o600);
  return record;
}

function mintIdToken() {
  mkdirSync(STATE_DIR, { mode: 0o700, recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: ADMIN_SDK_SA,
      sub: ADMIN_SDK_SA,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3500,
      uid: OWNER_UID,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const tmp = join(STATE_DIR, ".token-payload");
  const tmpOut = join(STATE_DIR, ".token-signature");
  writeFileSync(tmp, unsigned, { mode: 0o600 });
  let signature;
  try {
    execFileSync(
      "gcloud",
      [
        "iam", "service-accounts", "sign-blob", tmp, tmpOut,
        `--iam-account=${ADMIN_SDK_SA}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    // sign-blob writes raw signature bytes, not base64.
    signature = readFileSync(tmpOut);
  } finally {
    writeFileSync(tmp, "");
    writeFileSync(tmpOut, "");
  }
  const token = `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
  const res = JSON.parse(execFileSync("curl", [
    "-sf", "-X", "POST",
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${STATSKEY_API_KEY}`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ token, returnSecureToken: true }),
  ], { encoding: "utf8" }));
  if (!res.idToken) throw new Error("custom token exchange failed");
  return res.idToken;
}

async function callFleet(action, payload, idToken) {
  const response = await fetch(WORKBENCH_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = body?.error ?? {};
    throw new Error(
      `${action} failed: ${response.status} ${err.code ?? ""} ${err.message ?? ""}`.trim(),
    );
  }
  return body.data ?? body;
}

function controllerIdentity(record) {
  return {
    deviceId: record.deviceId,
    publicKeySpki: record.publicKeySpki,
    privateKey: record.privateKey,
    profile: record.profile,
  };
}

async function bootstrapOpsController(idToken) {
  let record;
  try {
    record = loadController();
  } catch {
    record = saveController();
    console.error(`ops controller key created at ${CONTROLLER_FILE}`);
  }
  const controller = loadController();
  const device = { ...controller.profile, publicKeySpki: controller.publicKeySpki };
  const authorization = {
    ownerUid: OWNER_UID,
    audience: "statskey-workbench:fleet:v1",
  };
  const proof = fleetAuth.createSignedDeviceRequest({
    privateKey: controller.privateKey,
    deviceId: controller.deviceId,
    action: "pairing.bootstrap",
    payload: { device, authorization },
  });
  const result = await callFleet(
    "fleetBootstrapDevice",
    { device, authorization, proof },
    idToken,
  );
  console.log(JSON.stringify({ bootstrapDeviceId: result.id ?? controller.deviceId, device: result }, null, 2));
}

async function pairWorkerPrepare(candidatePath) {
  const candidatePayload = JSON.parse(readFileSync(candidatePath, "utf8"));
  const controller = loadController();
  const candidateIdentity = fleetAuth.deviceIdentityForPublicKey(
    candidatePayload.publicKeySpki,
  );
  const receipt = pairing.createPairingReceipt({
    controller: controllerIdentity(controller),
    candidate: {
      deviceId: candidateIdentity.deviceId,
      publicKeySpki: candidatePayload.publicKeySpki,
      profile: {
        label: candidatePayload.label,
        role: candidatePayload.role,
        workerMode: candidatePayload.workerMode,
        platform: candidatePayload.platform,
        maxConcurrentJobs: candidatePayload.maxConcurrentJobs,
      },
    },
    ownerUid: OWNER_UID,
    workspaceIds: ["statskey-website", "statskey-energy"],
    repositoryIdentities: [
      "github.com/ryanwise77/statskey-website",
      "github.com/ryanwise77/statskey-energy",
    ],
    capabilities: [
      "workspace.read",
      "workspace.snapshot",
      "workspace.write",
      "terminal.run",
    ],
    unattended: true,
    grantExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    policyVersion: 1,
  });
  const out = join(STATE_DIR, `pairing-${receipt.pairingNonce.slice(0, 12)}.json`);
  writeFileSync(out, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ receiptFile: out, receipt }, null, 2));
  console.error(
    `next: on the worker, sign this receipt:\n` +
    `  sudo -u statskey-fleet statskey-fleet-enroll sign --action pairing.candidate < receipt.json`,
  );
}

async function pairWorkerSubmit(receiptPath, candidateProofPath, idToken) {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const candidateProof = JSON.parse(readFileSync(candidateProofPath, "utf8"));
  const controller = loadController();
  const controllerProof = pairing.signPairingReceipt({
    identity: controllerIdentity(controller),
    receipt,
    action: "pairing.approve",
  });
  const result = await callFleet(
    "fleetPairDevice",
    { receipt, controllerProof, candidateProof },
    idToken,
  );
  const trust = await callFleet("fleetGetCoordinatorTrust", {}, idToken);
  console.log(JSON.stringify({
    device: result.device,
    grant: result.grant,
    accept: {
      endpoint: "https://us-central1-statskey-workbench.cloudfunctions.net/workbenchDeviceApi",
      coordinatorKeyId: trust.keyId,
      coordinatorPublicKeySpki: trust.publicKeySpki,
      deviceId: result.device.id,
    },
  }, null, 2));
}

async function approveDeviceCard(cardPath) {
  const card = JSON.parse(readFileSync(cardPath, "utf8"));
  const controller = loadController();
  const profile = card.profile;
  const receipt = pairing.createPairingReceipt({
    controller: controllerIdentity(controller),
    candidate: {
      deviceId: card.deviceId,
      publicKeySpki: card.publicKeySpki,
      profile,
    },
    ownerUid: OWNER_UID,
    workspaceIds: ["statskey-website", "statskey-energy"],
    repositoryIdentities: [
      "github.com/ryanwise77/statskey-website",
      "github.com/ryanwise77/statskey-energy",
    ],
    capabilities: [
      "workspace.read",
      "workspace.snapshot",
      "workspace.write",
      "terminal.run",
    ],
    unattended: true,
    grantExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    policyVersion: 1,
  });
  const controllerProof = pairing.signPairingReceipt({
    identity: controllerIdentity(controller),
    receipt,
    action: "pairing.approve",
  });
  console.log(JSON.stringify({ receipt, controllerProof }, null, 2));
}

async function runCommand({ repo, commit, executable, execArgs, workspaceId }, idToken) {
  const controller = loadController();
  const job = {
    workspaceId,
    type: "command",
    objective: `Run ${executable} ${execArgs.join(" ")} on the Ubuntu worker`.slice(0, 200),
    workspaceSnapshot: { kind: "git", repository: repo, commit },
    execution: {
      kind: "command",
      executable,
      arguments: execArgs,
      workingDirectory: ".",
      timeoutMs: 120_000,
    },
    requiredCapabilities: ["workspace.read", "workspace.snapshot", "terminal.run"],
    resources: { cpuLogical: 2, memoryBytes: 2 * 1024 ** 3, diskAvailableBytes: 4 * 1024 ** 3 },
    exclusiveResources: [],
    dependencies: [],
    target: {},
    deadlineAt: Date.now() + 30 * 60_000,
    maxAttempts: 1,
    approvalPolicy: "independent",
    reconciliationPolicy: "lead",
    idempotencyKey: `ops:${createHash("sha256").update(`${repo}:${commit}:${executable}:${Date.now()}`).digest("hex").slice(0, 24)}`,
  };
  const proof = fleetAuth.createSignedDeviceRequest({
    privateKey: controller.privateKey,
    deviceId: controller.deviceId,
    action: "job.authorize",
    payload: { ownerUid: OWNER_UID, job },
  });
  const created = await callFleet("fleetCreateJob", {
    ...job,
    controllerAuthorization: { controllerDeviceId: controller.deviceId, proof },
  }, idToken);
  console.log(JSON.stringify({ job: created }, null, 2));
}

const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "run-command":
      await runCommand({
        repo: args[0],
        commit: args[1],
        executable: args[2],
        execArgs: args.slice(3),
        workspaceId: process.env.OPS_WORKSPACE || "statskey-website",
      }, mintIdToken());
      break;
    case "bootstrap-ops-controller":
      await bootstrapOpsController(mintIdToken());
      break;
    case "pair-worker-prepare":
      await pairWorkerPrepare(args[0]);
      break;
    case "pair-worker-submit":
      await pairWorkerSubmit(args[0], args[1], mintIdToken());
      break;
    case "approve-device-card":
      await approveDeviceCard(args[0]);
      break;
    case "devices":
      console.log(JSON.stringify(await callFleet("fleetListDevices", { limit: 50 }, mintIdToken()), null, 2));
      break;
    case "trust":
      console.log(JSON.stringify(await callFleet("fleetGetCoordinatorTrust", {}, mintIdToken()), null, 2));
      break;
    default:
      console.error("commands: bootstrap-ops-controller | pair-worker-prepare <candidate.json> | pair-worker-submit <receipt> <proof> | approve-device-card <card.json> | devices | trust");
      process.exit(2);
  }
} catch (error) {
  console.error(`fatal: ${error.message}`);
  process.exit(1);
}
