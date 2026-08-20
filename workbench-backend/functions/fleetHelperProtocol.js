const {createHash, verify} = require("node:crypto");
const fleetAuth = require("./fleetAuth");
const protocol = require("./fleetProtocol");

const HELPER_PROTOCOL_VERSION = 1;
const MAX_POLICY_EPOCH = 1_000_000;
const MAX_ATTESTATION_LIFETIME_MS = 10 * 60_000;
const HELPER_CHALLENGE_TTL_MS = 2 * 60_000;

const HELPER_ATTESTATION_DOMAIN = "statskey.fleet.helper-attestation.v1";
const EXECUTION_TICKET_DOMAIN = "statskey.fleet.execution-ticket.v1";
const LEASE_UPDATE_DOMAIN = "statskey.fleet.lease-update.v1";
const TERMINATION_RECEIPT_DOMAIN = "statskey.fleet.termination-receipt.v1";
const EXECUTION_STARTED_DOMAIN = "statskey.fleet.execution-started-receipt.v1";

const CHALLENGE_ID_PATTERN = /^chal_[a-f0-9]{32}$/;
const CHALLENGE_NONCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const HELPER_INSTANCE_ID_PATTERN = /^hi_[a-f0-9]{32}$/;
const TICKET_ID_PATTERN = /^ticket_[a-f0-9]{32}$/;
const BUILD_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BOOT_ID_DIGEST_PATTERN = /^sha256:[A-Za-z0-9_-]{43}$/;
const KERNEL_RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const SYSTEMD_VERSION_PATTERN = /^[0-9]{1,6}$/;
// Job unit names are derived from the ticket ID only; anything else is not
// a Fleet job unit.
const UNIT_NAME_PATTERN = /^statskey-fleet-job-ticket_[a-f0-9]{32}\.service$/;
const CGROUP_PATH_PATTERN = /^\/sys\/fs\/cgroup\/[A-Za-z0-9:_.\-/]{1,300}$/;
// Keep in sync with the daemon's TerminationReasons enum.
const TERMINATION_REASONS = new Set([
  "exited",
  "failed",
  "lease-expired",
  "cancelled",
  "stop-requested",
  "daemon-restart",
  "watchdog",
  "runtime-exceeded",
  "oom",
  "signal",
]);
const COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const EXECUTABLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,119}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,100}$/;
const RFC3339_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const MAX_TICKET_RESOURCES = Object.freeze({
  cpuMilli: 4_096_000,
  memoryBytes: 4 * 1024 ** 4,
  pids: 4_194_304,
  diskBytes: 100 * 1024 ** 4,
  wallTimeMs: 7 * 24 * 60 * 60 * 1000,
});

// Linux execution authority derives only from these attested capabilities;
// heartbeat-reported capabilities never carry authority on Linux.
const LINUX_ATTESTED_CAPABILITIES = Object.freeze([
  "terminal.run",
  "workspace.read",
  "workspace.snapshot",
  "workspace.write",
]);

const LINUX_COMMAND_PROFILES = Object.freeze({
  executorProfileId: "command-v1",
  sandboxProfileId: "ubuntu-build-v1",
  networkProfileId: "none",
});

function requireOnlyKeys(value, allowed, label) {
  const allowedKeys = new Set(allowed);
  protocol.requireValue(
      Object.keys(value).every((key) => allowedKeys.has(key)),
      "invalid_argument",
      `Unexpected ${label} field.`,
  );
}

function parseRfc3339Ms(value, field) {
  const text = protocol.cleanString(value, 32, field);
  const millis = Date.parse(text);
  protocol.requireValue(
      RFC3339_MS_PATTERN.test(text) &&
        Number.isFinite(millis) &&
        new Date(millis).toISOString() === text,
      "invalid_argument",
      `${field} must be an RFC3339 millisecond UTC timestamp.`,
  );
  return millis;
}

function formatRfc3339Ms(millis) {
  return new Date(protocol.validTime(millis)).toISOString();
}

function requireBoolean(value, field) {
  protocol.requireValue(
      typeof value === "boolean",
      "invalid_argument",
      `${field} is invalid.`,
  );
  return value;
}

function splitSignedPayload(input, label, fields) {
  protocol.requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      `${label} is required.`,
  );
  requireOnlyKeys(input, [...fields, "signature"], label);
  const signature = protocol.cleanString(input.signature, 128, `${label}.signature`);
  protocol.requireValue(
      SIGNATURE_PATTERN.test(signature) &&
        Buffer.from(signature, "base64url").toString("base64url") === signature,
      "invalid_argument",
      `${label} signature is invalid.`,
  );
  const unsigned = {};
  for (const field of fields) {
    protocol.requireValue(
        input[field] !== undefined,
        "invalid_argument",
        `${label}.${field} is required.`,
    );
    unsigned[field] = input[field];
  }
  return {unsigned, signature};
}

function verifyDetachedSignature(unsigned, signature, publicKeySpki, code, message) {
  let key;
  try {
    key = fleetAuth.normalizePublicKeySpki(publicKeySpki).key;
  } catch {
    throw protocol.apiError(code, message, 403);
  }
  protocol.requireValue(
      verify(
          null,
          Buffer.from(fleetAuth.canonicalJson(unsigned)),
          key,
          Buffer.from(signature, "base64url"),
      ),
      code,
      message,
      403,
  );
}

function signedPayloadDigest(unsigned) {
  return createHash("sha256")
      .update(fleetAuth.canonicalJson(unsigned))
      .digest("hex");
}

function normalizeDomain(value, expected, label) {
  const domain = protocol.cleanString(value, 64, `${label}.domain`);
  protocol.requireValue(
      domain === expected,
      "invalid_argument",
      `${label} domain is invalid.`,
  );
  return domain;
}

function normalizeAttestationPlatform(input) {
  protocol.requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "attestation.platform is required.",
  );
  requireOnlyKeys(input, [
    "id",
    "versionId",
    "arch",
    "kernelRelease",
    "cgroupVersion",
    "systemdVersion",
  ], "attestation.platform");
  const kernelRelease = protocol.cleanString(
      input.kernelRelease,
      64,
      "attestation.platform.kernelRelease",
  );
  protocol.requireValue(
      KERNEL_RELEASE_PATTERN.test(kernelRelease),
      "invalid_argument",
      "attestation.platform.kernelRelease is invalid.",
  );
  const systemdVersion = protocol.cleanString(
      input.systemdVersion,
      12,
      "attestation.platform.systemdVersion",
  );
  protocol.requireValue(
      SYSTEMD_VERSION_PATTERN.test(systemdVersion),
      "invalid_argument",
      "attestation.platform.systemdVersion is invalid.",
  );
  return {
    id: protocol.cleanString(input.id, 24, "attestation.platform.id"),
    versionId: protocol.cleanString(
        input.versionId,
        24,
        "attestation.platform.versionId",
    ),
    arch: protocol.cleanString(input.arch, 24, "attestation.platform.arch"),
    kernelRelease,
    cgroupVersion: protocol.boundedInteger(
        input.cgroupVersion,
        1,
        2,
        "attestation.platform.cgroupVersion",
    ),
    systemdVersion,
  };
}

function normalizeAttestationSecurity(input) {
  protocol.requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "attestation.security is required.",
  );
  requireOnlyKeys(input, [
    "cgroupKill",
    "delegated",
    "apparmorEnforcing",
    "apparmorProfileDigest",
  ], "attestation.security");
  const apparmorProfileDigest = protocol.cleanString(
      input.apparmorProfileDigest,
      96,
      "attestation.security.apparmorProfileDigest",
  );
  protocol.requireValue(
      BUILD_ID_PATTERN.test(apparmorProfileDigest),
      "invalid_argument",
      "attestation.security.apparmorProfileDigest is invalid.",
  );
  return {
    cgroupKill: requireBoolean(input.cgroupKill, "attestation.security.cgroupKill"),
    delegated: requireBoolean(input.delegated, "attestation.security.delegated"),
    apparmorEnforcing: requireBoolean(
        input.apparmorEnforcing,
        "attestation.security.apparmorEnforcing",
    ),
    apparmorProfileDigest,
  };
}

const HELPER_ATTESTATION_FIELDS = Object.freeze([
  "domain",
  "challengeId",
  "challengeNonce",
  "deviceId",
  "executionServiceId",
  "helperInstanceId",
  "bootIdDigest",
  "helperProtocol",
  "helperBuildId",
  "runnerBuildId",
  "policyEpoch",
  "platform",
  "security",
  "issuedAt",
  "expiresAt",
]);

function normalizeHelperAttestation(input) {
  const {unsigned, signature} = splitSignedPayload(
      input,
      "Helper attestation",
      HELPER_ATTESTATION_FIELDS,
  );
  const challengeId = protocol.cleanString(
      unsigned.challengeId,
      64,
      "attestation.challengeId",
  );
  protocol.requireValue(
      CHALLENGE_ID_PATTERN.test(challengeId),
      "invalid_argument",
      "Helper challenge id is invalid.",
  );
  const challengeNonce = protocol.cleanString(
      unsigned.challengeNonce,
      128,
      "attestation.challengeNonce",
  );
  protocol.requireValue(
      CHALLENGE_NONCE_PATTERN.test(challengeNonce),
      "invalid_argument",
      "Helper challenge nonce is invalid.",
  );
  const deviceId = protocol.cleanString(unsigned.deviceId, 64, "attestation.deviceId");
  protocol.requireValue(
      protocol.DEVICE_ID_PATTERN.test(deviceId),
      "invalid_argument",
      "Helper attestation device id is invalid.",
  );
  const executionServiceId = protocol.cleanString(
      unsigned.executionServiceId,
      64,
      "attestation.executionServiceId",
  );
  protocol.requireValue(
      protocol.EXECUTION_SERVICE_ID_PATTERN.test(executionServiceId),
      "invalid_argument",
      "Helper execution service id is invalid.",
  );
  const helperInstanceId = protocol.cleanString(
      unsigned.helperInstanceId,
      64,
      "attestation.helperInstanceId",
  );
  protocol.requireValue(
      HELPER_INSTANCE_ID_PATTERN.test(helperInstanceId),
      "invalid_argument",
      "Helper instance id is invalid.",
  );
  const bootIdDigest = protocol.cleanString(
      unsigned.bootIdDigest,
      96,
      "attestation.bootIdDigest",
  );
  protocol.requireValue(
      BOOT_ID_DIGEST_PATTERN.test(bootIdDigest),
      "invalid_argument",
      "Helper boot id digest is invalid.",
  );
  const helperBuildId = protocol.cleanString(
      unsigned.helperBuildId,
      96,
      "attestation.helperBuildId",
  );
  const runnerBuildId = protocol.cleanString(
      unsigned.runnerBuildId,
      96,
      "attestation.runnerBuildId",
  );
  protocol.requireValue(
      BUILD_ID_PATTERN.test(helperBuildId) &&
        BUILD_ID_PATTERN.test(runnerBuildId),
      "invalid_argument",
      "Helper build ids are invalid.",
  );
  const issuedAt = protocol.cleanString(unsigned.issuedAt, 32, "attestation.issuedAt");
  const expiresAt = protocol.cleanString(unsigned.expiresAt, 32, "attestation.expiresAt");
  const issuedAtMs = parseRfc3339Ms(issuedAt, "attestation.issuedAt");
  const expiresAtMs = parseRfc3339Ms(expiresAt, "attestation.expiresAt");
  protocol.requireValue(
      expiresAtMs > issuedAtMs,
      "invalid_argument",
      "Helper attestation lifetime is invalid.",
  );
  return {
    domain: normalizeDomain(
        unsigned.domain,
        HELPER_ATTESTATION_DOMAIN,
        "Helper attestation",
    ),
    challengeId,
    challengeNonce,
    deviceId,
    executionServiceId,
    helperInstanceId,
    bootIdDigest,
    helperProtocol: protocol.boundedInteger(
        unsigned.helperProtocol,
        HELPER_PROTOCOL_VERSION,
        1_000,
        "attestation.helperProtocol",
    ),
    helperBuildId,
    runnerBuildId,
    policyEpoch: protocol.boundedInteger(
        unsigned.policyEpoch,
        1,
        MAX_POLICY_EPOCH,
        "attestation.policyEpoch",
    ),
    platform: normalizeAttestationPlatform(unsigned.platform),
    security: normalizeAttestationSecurity(unsigned.security),
    issuedAt,
    expiresAt,
    signature,
  };
}

function unsignedCopy(normalized) {
  const {signature, ...unsigned} = normalized;
  return unsigned;
}

function verifyHelperAttestationSignature(normalized, publicKeySpki) {
  verifyDetachedSignature(
      unsignedCopy(normalized),
      normalized.signature,
      publicKeySpki,
      "invalid_attestation_signature",
      "Helper attestation signature is not valid.",
  );
}

function verifyHelperAttestation(input, publicKeySpki) {
  const attestation = normalizeHelperAttestation(input);
  verifyHelperAttestationSignature(attestation, publicKeySpki);
  return attestation;
}

// The coordinator-side allowlist for helper platform and security posture.
// Anything outside these measured Ubuntu LTS cgroup-v2 profiles fails closed.
// The version floor is feature-based: every property the daemon uses
// (DynamicUser, LoadCredential, cgroup.kill, the hardening set) requires
// systemd >= 255 and a cgroup-v2 kernel with AppArmor enforcing.
const ALLOWED_HELPER_PLATFORMS = Object.freeze([
  {versionId: "26.04", minSystemdVersion: 255},
  {versionId: "24.04", minSystemdVersion: 255},
]);

function requireAllowedHelperProfile(attestation) {
  const platform = attestation.platform;
  const systemdMajor = Number.parseInt(platform.systemdVersion, 10);
  protocol.requireValue(
      platform.id === "ubuntu" &&
        platform.arch === "x86_64" &&
        platform.cgroupVersion === 2 &&
        ALLOWED_HELPER_PLATFORMS.some((allowed) =>
          allowed.versionId === platform.versionId &&
          systemdMajor >= allowed.minSystemdVersion,
        ),
      "failed_precondition",
      "Helper platform is not allowed for Fleet execution.",
      409,
  );
  protocol.requireValue(
      attestation.security.cgroupKill === true &&
        attestation.security.delegated === false &&
        attestation.security.apparmorEnforcing === true,
      "failed_precondition",
      "Helper security posture is not allowed for Fleet execution.",
      409,
  );
}

function normalizeTicketResources(input, label = "ticket.resources") {
  protocol.requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      `${label} is required.`,
  );
  requireOnlyKeys(input, [
    "cpuMilli",
    "memoryBytes",
    "pids",
    "diskBytes",
    "wallTimeMs",
  ], label);
  return {
    cpuMilli: protocol.boundedInteger(
        input.cpuMilli,
        1,
        MAX_TICKET_RESOURCES.cpuMilli,
        `${label}.cpuMilli`,
    ),
    memoryBytes: protocol.boundedInteger(
        input.memoryBytes,
        1,
        MAX_TICKET_RESOURCES.memoryBytes,
        `${label}.memoryBytes`,
    ),
    pids: protocol.boundedInteger(
        input.pids,
        1,
        MAX_TICKET_RESOURCES.pids,
        `${label}.pids`,
    ),
    diskBytes: protocol.boundedInteger(
        input.diskBytes,
        1,
        MAX_TICKET_RESOURCES.diskBytes,
        `${label}.diskBytes`,
    ),
    wallTimeMs: protocol.boundedInteger(
        input.wallTimeMs,
        1_000,
        MAX_TICKET_RESOURCES.wallTimeMs,
        `${label}.wallTimeMs`,
    ),
  };
}

function normalizeTicketCommand(input) {
  protocol.requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "ticket.command is required.",
  );
  requireOnlyKeys(input, [
    "executable",
    "arguments",
    "workingDirectory",
  ], "ticket.command");
  const executable = protocol.cleanString(
      input.executable,
      120,
      "ticket.command.executable",
  );
  protocol.requireValue(
      EXECUTABLE_PATTERN.test(executable),
      "invalid_argument",
      "ticket.command.executable is invalid.",
  );
  protocol.requireValue(
      Array.isArray(input.arguments) && input.arguments.length <= 128,
      "invalid_argument",
      "ticket.command.arguments is invalid.",
  );
  const commandArguments = input.arguments.map((value) =>
    protocol.cleanString(value, 2_000, "ticket.command.arguments"));
  protocol.requireValue(
      Buffer.byteLength(JSON.stringify(commandArguments), "utf8") <= 12 * 1024,
      "payload_too_large",
      "ticket.command.arguments is too large.",
      400,
  );
  const workingDirectory = protocol.cleanString(
      input.workingDirectory,
      500,
      "ticket.command.workingDirectory",
  );
  protocol.requireValue(
      workingDirectory === "." ||
        (!workingDirectory.startsWith(".") &&
          !workingDirectory.startsWith("/") &&
          !workingDirectory.includes("\\") &&
          !workingDirectory.includes("%") &&
          workingDirectory.split("/").every((part) =>
            part && part !== "." && part !== "..")),
      "invalid_argument",
      "ticket.command.workingDirectory is invalid.",
  );
  return {
    executable,
    arguments: commandArguments,
    workingDirectory,
  };
}

const EXECUTION_TICKET_FIELDS = Object.freeze([
  "domain",
  "ticketId",
  "jobRequestDigest",
  "jobId",
  "attempt",
  "leaseId",
  "leaseSequence",
  "grantReceiptDigest",
  "ownerUid",
  "workerDeviceId",
  "controllerDeviceId",
  "executionServiceId",
  "helperInstanceId",
  "repositoryIdentity",
  "commit",
  "executorProfileId",
  "sandboxProfileId",
  "networkProfileId",
  "command",
  "resources",
  "serverIssuedAt",
  "leaseExpiresAt",
  "jobDeadlineAt",
  "minimumHelperProtocol",
  "minimumPolicyEpoch",
]);

function normalizeExecutionTicket(input) {
  const {unsigned, signature} = splitSignedPayload(
      input,
      "Execution ticket",
      EXECUTION_TICKET_FIELDS,
  );
  const ticketId = protocol.cleanString(unsigned.ticketId, 64, "ticket.ticketId");
  protocol.requireValue(
      TICKET_ID_PATTERN.test(ticketId),
      "invalid_argument",
      "Execution ticket id is invalid.",
  );
  const jobRequestDigest = protocol.cleanString(
      unsigned.jobRequestDigest,
      96,
      "ticket.jobRequestDigest",
  );
  const grantReceiptDigest = protocol.cleanString(
      unsigned.grantReceiptDigest,
      96,
      "ticket.grantReceiptDigest",
  );
  protocol.requireValue(
      BUILD_ID_PATTERN.test(jobRequestDigest) &&
        BUILD_ID_PATTERN.test(grantReceiptDigest),
      "invalid_argument",
      "Execution ticket digests are invalid.",
  );
  const jobId = protocol.cleanString(unsigned.jobId, 64, "ticket.jobId");
  const leaseId = protocol.cleanString(unsigned.leaseId, 64, "ticket.leaseId");
  const workerDeviceId = protocol.cleanString(
      unsigned.workerDeviceId,
      64,
      "ticket.workerDeviceId",
  );
  const controllerDeviceId = protocol.cleanString(
      unsigned.controllerDeviceId,
      64,
      "ticket.controllerDeviceId",
  );
  protocol.requireValue(
      protocol.JOB_ID_PATTERN.test(jobId) &&
        protocol.LEASE_ID_PATTERN.test(leaseId) &&
        protocol.DEVICE_ID_PATTERN.test(workerDeviceId) &&
        protocol.DEVICE_ID_PATTERN.test(controllerDeviceId),
      "invalid_argument",
      "Execution ticket identities are invalid.",
  );
  const executionServiceId = protocol.cleanString(
      unsigned.executionServiceId,
      64,
      "ticket.executionServiceId",
  );
  const helperInstanceId = protocol.cleanString(
      unsigned.helperInstanceId,
      64,
      "ticket.helperInstanceId",
  );
  protocol.requireValue(
      protocol.EXECUTION_SERVICE_ID_PATTERN.test(executionServiceId) &&
        HELPER_INSTANCE_ID_PATTERN.test(helperInstanceId),
      "invalid_argument",
      "Execution ticket helper identity is invalid.",
  );
  const commit = protocol.cleanString(unsigned.commit, 64, "ticket.commit");
  protocol.requireValue(
      COMMIT_PATTERN.test(commit),
      "invalid_argument",
      "Execution ticket commit is invalid.",
  );
  const executorProfileId = protocol.cleanString(
      unsigned.executorProfileId,
      64,
      "ticket.executorProfileId",
  );
  const sandboxProfileId = protocol.cleanString(
      unsigned.sandboxProfileId,
      64,
      "ticket.sandboxProfileId",
  );
  const networkProfileId = protocol.cleanString(
      unsigned.networkProfileId,
      64,
      "ticket.networkProfileId",
  );
  protocol.requireValue(
      protocol.PROFILE_ID_PATTERN.test(executorProfileId) &&
        protocol.PROFILE_ID_PATTERN.test(sandboxProfileId) &&
        protocol.PROFILE_ID_PATTERN.test(networkProfileId),
      "invalid_argument",
      "Execution ticket profile ids are invalid.",
  );
  const serverIssuedAt = protocol.cleanString(
      unsigned.serverIssuedAt,
      32,
      "ticket.serverIssuedAt",
  );
  const leaseExpiresAt = protocol.cleanString(
      unsigned.leaseExpiresAt,
      32,
      "ticket.leaseExpiresAt",
  );
  const jobDeadlineAt = protocol.cleanString(
      unsigned.jobDeadlineAt,
      32,
      "ticket.jobDeadlineAt",
  );
  parseRfc3339Ms(serverIssuedAt, "ticket.serverIssuedAt");
  const leaseExpiresAtMs = parseRfc3339Ms(leaseExpiresAt, "ticket.leaseExpiresAt");
  const jobDeadlineAtMs = parseRfc3339Ms(jobDeadlineAt, "ticket.jobDeadlineAt");
  protocol.requireValue(
      leaseExpiresAtMs <= jobDeadlineAtMs,
      "invalid_argument",
      "Execution ticket lease outlives the job deadline.",
  );
  return {
    domain: normalizeDomain(
        unsigned.domain,
        EXECUTION_TICKET_DOMAIN,
        "Execution ticket",
    ),
    ticketId,
    jobRequestDigest,
    jobId,
    attempt: protocol.boundedInteger(unsigned.attempt, 1, 10_000, "ticket.attempt"),
    leaseId,
    leaseSequence: protocol.boundedInteger(
        unsigned.leaseSequence,
        0,
        1_000_000,
        "ticket.leaseSequence",
    ),
    grantReceiptDigest,
    ownerUid: protocol.cleanString(unsigned.ownerUid, 128, "ticket.ownerUid"),
    workerDeviceId,
    controllerDeviceId,
    executionServiceId,
    helperInstanceId,
    repositoryIdentity: protocol.normalizeRepositoryIdentity(
        unsigned.repositoryIdentity,
    ),
    commit,
    executorProfileId,
    sandboxProfileId,
    networkProfileId,
    command: normalizeTicketCommand(unsigned.command),
    resources: normalizeTicketResources(unsigned.resources),
    serverIssuedAt,
    leaseExpiresAt,
    jobDeadlineAt,
    minimumHelperProtocol: protocol.boundedInteger(
        unsigned.minimumHelperProtocol,
        HELPER_PROTOCOL_VERSION,
        1_000,
        "ticket.minimumHelperProtocol",
    ),
    minimumPolicyEpoch: protocol.boundedInteger(
        unsigned.minimumPolicyEpoch,
        1,
        MAX_POLICY_EPOCH,
        "ticket.minimumPolicyEpoch",
    ),
    signature,
  };
}

function verifyExecutionTicketSignature(normalized, publicKeySpki) {
  verifyDetachedSignature(
      unsignedCopy(normalized),
      normalized.signature,
      publicKeySpki,
      "invalid_ticket_signature",
      "Execution ticket signature is not valid.",
  );
}

function verifyExecutionTicket(input, publicKeySpki) {
  const ticket = normalizeExecutionTicket(input);
  verifyExecutionTicketSignature(ticket, publicKeySpki);
  return ticket;
}

const LEASE_UPDATE_FIELDS = Object.freeze([
  "domain",
  "ticketId",
  "jobId",
  "attempt",
  "leaseId",
  "helperInstanceId",
  "leaseSequence",
  "cancelled",
  "serverIssuedAt",
  "leaseExpiresAt",
]);

function normalizeLeaseUpdate(input) {
  const {unsigned, signature} = splitSignedPayload(
      input,
      "Lease update",
      LEASE_UPDATE_FIELDS,
  );
  const ticketId = protocol.cleanString(unsigned.ticketId, 64, "leaseUpdate.ticketId");
  const jobId = protocol.cleanString(unsigned.jobId, 64, "leaseUpdate.jobId");
  const leaseId = protocol.cleanString(unsigned.leaseId, 64, "leaseUpdate.leaseId");
  const helperInstanceId = protocol.cleanString(
      unsigned.helperInstanceId,
      64,
      "leaseUpdate.helperInstanceId",
  );
  protocol.requireValue(
      TICKET_ID_PATTERN.test(ticketId) &&
        protocol.JOB_ID_PATTERN.test(jobId) &&
        protocol.LEASE_ID_PATTERN.test(leaseId) &&
        HELPER_INSTANCE_ID_PATTERN.test(helperInstanceId),
      "invalid_argument",
      "Lease update identities are invalid.",
  );
  const serverIssuedAt = protocol.cleanString(
      unsigned.serverIssuedAt,
      32,
      "leaseUpdate.serverIssuedAt",
  );
  const leaseExpiresAt = protocol.cleanString(
      unsigned.leaseExpiresAt,
      32,
      "leaseUpdate.leaseExpiresAt",
  );
  parseRfc3339Ms(serverIssuedAt, "leaseUpdate.serverIssuedAt");
  parseRfc3339Ms(leaseExpiresAt, "leaseUpdate.leaseExpiresAt");
  return {
    domain: normalizeDomain(unsigned.domain, LEASE_UPDATE_DOMAIN, "Lease update"),
    ticketId,
    jobId,
    attempt: protocol.boundedInteger(
        unsigned.attempt,
        1,
        10_000,
        "leaseUpdate.attempt",
    ),
    leaseId,
    helperInstanceId,
    leaseSequence: protocol.boundedInteger(
        unsigned.leaseSequence,
        0,
        1_000_000,
        "leaseUpdate.leaseSequence",
    ),
    cancelled: requireBoolean(unsigned.cancelled, "leaseUpdate.cancelled"),
    serverIssuedAt,
    leaseExpiresAt,
    signature,
  };
}

function verifyLeaseUpdateSignature(normalized, publicKeySpki) {
  verifyDetachedSignature(
      unsignedCopy(normalized),
      normalized.signature,
      publicKeySpki,
      "invalid_lease_update_signature",
      "Lease update signature is not valid.",
  );
}

function verifyLeaseUpdate(input, publicKeySpki) {
  const update = normalizeLeaseUpdate(input);
  verifyLeaseUpdateSignature(update, publicKeySpki);
  return update;
}

function normalizeCgroupPath(value, field) {
  const cgroupPath = protocol.cleanString(value, 320, field);
  const beneathPrefix = cgroupPath.slice("/sys/fs/cgroup/".length);
  protocol.requireValue(
      CGROUP_PATH_PATTERN.test(cgroupPath) &&
        beneathPrefix.split("/").every((part) =>
          part !== "" && part !== "." && part !== "..",
        ),
      "invalid_argument",
      `${field} is invalid.`,
  );
  return cgroupPath;
}

const TERMINATION_RECEIPT_FIELDS = Object.freeze([
  "domain",
  "ticketId",
  "jobId",
  "attempt",
  "leaseId",
  "helperInstanceId",
  "highestLeaseSequence",
  "exitStatus",
  "terminationReason",
  "unitName",
  "cgroupPath",
  "populated",
  "accounting",
  "finishedAt",
  "finishedAtMonotonicMs",
]);

function normalizeTerminationReceipt(input) {
  const {unsigned, signature} = splitSignedPayload(
      input,
      "Termination receipt",
      TERMINATION_RECEIPT_FIELDS,
  );
  const ticketId = protocol.cleanString(unsigned.ticketId, 64, "receipt.ticketId");
  const jobId = protocol.cleanString(unsigned.jobId, 64, "receipt.jobId");
  const leaseId = protocol.cleanString(unsigned.leaseId, 64, "receipt.leaseId");
  const helperInstanceId = protocol.cleanString(
      unsigned.helperInstanceId,
      64,
      "receipt.helperInstanceId",
  );
  protocol.requireValue(
      TICKET_ID_PATTERN.test(ticketId) &&
        protocol.JOB_ID_PATTERN.test(jobId) &&
        protocol.LEASE_ID_PATTERN.test(leaseId) &&
        HELPER_INSTANCE_ID_PATTERN.test(helperInstanceId),
      "invalid_argument",
      "Termination receipt identities are invalid.",
  );
  const terminationReason = protocol.cleanString(
      unsigned.terminationReason,
      64,
      "receipt.terminationReason",
  );
  protocol.requireValue(
      TERMINATION_REASONS.has(terminationReason),
      "invalid_argument",
      "Termination receipt reason is invalid.",
  );
  const unitName = protocol.cleanString(
      unsigned.unitName,
      128,
      "receipt.unitName",
  );
  protocol.requireValue(
      UNIT_NAME_PATTERN.test(unitName),
      "invalid_argument",
      "Termination receipt unit name is invalid.",
  );
  protocol.requireValue(
      unsigned.populated === false,
      "invalid_argument",
      "Termination receipt must prove an empty job cgroup.",
  );
  protocol.requireValue(
      unsigned.accounting &&
        typeof unsigned.accounting === "object" &&
        !Array.isArray(unsigned.accounting),
      "invalid_argument",
      "receipt.accounting is required.",
  );
  requireOnlyKeys(unsigned.accounting, [
    "cpuUsageNs",
    "memoryPeakBytes",
    "pidsPeak",
    "ioReadBytes",
    "ioWriteBytes",
  ], "receipt.accounting");
  const accounting = {};
  for (const key of [
    "cpuUsageNs",
    "memoryPeakBytes",
    "pidsPeak",
    "ioReadBytes",
    "ioWriteBytes",
  ]) {
    accounting[key] = protocol.boundedInteger(
        unsigned.accounting[key],
        0,
        Number.MAX_SAFE_INTEGER,
        `receipt.accounting.${key}`,
    );
  }
  const finishedAt = protocol.cleanString(
      unsigned.finishedAt,
      32,
      "receipt.finishedAt",
  );
  parseRfc3339Ms(finishedAt, "receipt.finishedAt");
  return {
    domain: normalizeDomain(
        unsigned.domain,
        TERMINATION_RECEIPT_DOMAIN,
        "Termination receipt",
    ),
    ticketId,
    jobId,
    attempt: protocol.boundedInteger(unsigned.attempt, 1, 10_000, "receipt.attempt"),
    leaseId,
    helperInstanceId,
    highestLeaseSequence: protocol.boundedInteger(
        unsigned.highestLeaseSequence,
        0,
        Number.MAX_SAFE_INTEGER,
        "receipt.highestLeaseSequence",
    ),
    exitStatus: protocol.boundedInteger(
        unsigned.exitStatus,
        -1,
        255,
        "receipt.exitStatus",
    ),
    terminationReason,
    unitName,
    cgroupPath: normalizeCgroupPath(unsigned.cgroupPath, "receipt.cgroupPath"),
    populated: false,
    accounting,
    finishedAt,
    finishedAtMonotonicMs: protocol.boundedInteger(
        unsigned.finishedAtMonotonicMs,
        0,
        Number.MAX_SAFE_INTEGER,
        "receipt.finishedAtMonotonicMs",
    ),
    signature,
  };
}

function verifyTerminationReceiptSignature(normalized, publicKeySpki) {
  verifyDetachedSignature(
      unsignedCopy(normalized),
      normalized.signature,
      publicKeySpki,
      "invalid_termination_signature",
      "Termination receipt signature is not valid.",
  );
}

function verifyTerminationReceipt(input, publicKeySpki) {
  const receipt = normalizeTerminationReceipt(input);
  verifyTerminationReceiptSignature(receipt, publicKeySpki);
  return receipt;
}

const EXECUTION_STARTED_FIELDS = Object.freeze([
  "domain",
  "ticketId",
  "jobId",
  "attempt",
  "leaseId",
  "helperInstanceId",
  "unitName",
  "cgroupPath",
  "effectiveLimits",
  "runnerBuildId",
  "startedAt",
  "startedAtMonotonicMs",
]);

function normalizeExecutionStartedReceipt(input) {
  const {unsigned, signature} = splitSignedPayload(
      input,
      "Execution started receipt",
      EXECUTION_STARTED_FIELDS,
  );
  const ticketId = protocol.cleanString(unsigned.ticketId, 64, "startReceipt.ticketId");
  const jobId = protocol.cleanString(unsigned.jobId, 64, "startReceipt.jobId");
  const leaseId = protocol.cleanString(unsigned.leaseId, 64, "startReceipt.leaseId");
  const helperInstanceId = protocol.cleanString(
      unsigned.helperInstanceId,
      64,
      "startReceipt.helperInstanceId",
  );
  protocol.requireValue(
      TICKET_ID_PATTERN.test(ticketId) &&
        protocol.JOB_ID_PATTERN.test(jobId) &&
        protocol.LEASE_ID_PATTERN.test(leaseId) &&
        HELPER_INSTANCE_ID_PATTERN.test(helperInstanceId),
      "invalid_argument",
      "Execution started receipt identities are invalid.",
  );
  const unitName = protocol.cleanString(
      unsigned.unitName,
      128,
      "startReceipt.unitName",
  );
  protocol.requireValue(
      UNIT_NAME_PATTERN.test(unitName),
      "invalid_argument",
      "Execution started receipt unit name is invalid.",
  );
  const runnerBuildId = protocol.cleanString(
      unsigned.runnerBuildId,
      96,
      "startReceipt.runnerBuildId",
  );
  protocol.requireValue(
      BUILD_ID_PATTERN.test(runnerBuildId),
      "invalid_argument",
      "Execution started receipt runner build is invalid.",
  );
  const startedAt = protocol.cleanString(
      unsigned.startedAt,
      32,
      "startReceipt.startedAt",
  );
  parseRfc3339Ms(startedAt, "startReceipt.startedAt");
  return {
    domain: normalizeDomain(
        unsigned.domain,
        EXECUTION_STARTED_DOMAIN,
        "Execution started receipt",
    ),
    ticketId,
    jobId,
    attempt: protocol.boundedInteger(
        unsigned.attempt,
        1,
        10_000,
        "startReceipt.attempt",
    ),
    leaseId,
    helperInstanceId,
    unitName,
    cgroupPath: normalizeCgroupPath(unsigned.cgroupPath, "startReceipt.cgroupPath"),
    effectiveLimits: normalizeTicketResources(
        unsigned.effectiveLimits,
        "startReceipt.effectiveLimits",
    ),
    runnerBuildId,
    startedAt,
    startedAtMonotonicMs: protocol.boundedInteger(
        unsigned.startedAtMonotonicMs,
        0,
        Number.MAX_SAFE_INTEGER,
        "startReceipt.startedAtMonotonicMs",
    ),
    signature,
  };
}

function verifyExecutionStartedReceiptSignature(normalized, publicKeySpki) {
  verifyDetachedSignature(
      unsignedCopy(normalized),
      normalized.signature,
      publicKeySpki,
      "invalid_start_receipt_signature",
      "Execution started receipt signature is not valid.",
  );
}

function verifyExecutionStartedReceipt(input, publicKeySpki) {
  const receipt = normalizeExecutionStartedReceipt(input);
  verifyExecutionStartedReceiptSignature(receipt, publicKeySpki);
  return receipt;
}

module.exports = {
  BOOT_ID_DIGEST_PATTERN,
  BUILD_ID_PATTERN,
  CHALLENGE_ID_PATTERN,
  CHALLENGE_NONCE_PATTERN,
  EXECUTION_STARTED_DOMAIN,
  EXECUTION_TICKET_DOMAIN,
  HELPER_ATTESTATION_DOMAIN,
  HELPER_CHALLENGE_TTL_MS,
  HELPER_INSTANCE_ID_PATTERN,
  HELPER_PROTOCOL_VERSION,
  LEASE_UPDATE_DOMAIN,
  LINUX_ATTESTED_CAPABILITIES,
  LINUX_COMMAND_PROFILES,
  MAX_ATTESTATION_LIFETIME_MS,
  MAX_POLICY_EPOCH,
  TERMINATION_RECEIPT_DOMAIN,
  TICKET_ID_PATTERN,
  formatRfc3339Ms,
  normalizeExecutionStartedReceipt,
  normalizeExecutionTicket,
  normalizeHelperAttestation,
  normalizeLeaseUpdate,
  normalizeTerminationReceipt,
  parseRfc3339Ms,
  requireAllowedHelperProfile,
  requireOnlyKeys,
  signedPayloadDigest,
  verifyExecutionStartedReceipt,
  verifyExecutionStartedReceiptSignature,
  verifyExecutionTicket,
  verifyExecutionTicketSignature,
  verifyHelperAttestation,
  verifyHelperAttestationSignature,
  verifyLeaseUpdate,
  verifyLeaseUpdateSignature,
  verifyTerminationReceipt,
  verifyTerminationReceiptSignature,
};
