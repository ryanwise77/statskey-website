const {createHash} = require("node:crypto");

const PROTOCOL_VERSION = 1;
const DEVICE_ONLINE_WINDOW_MS = 90_000;
const MAX_JOB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENT_DEPTH = 8;
const MAX_EVENT_KEYS = 400;
const MAX_NORMALIZED_JOB_BYTES = 96 * 1024;
const MAX_COMMAND_ARGUMENT_BYTES = 12 * 1024;
const REPOSITORY_HOSTS = Object.freeze([
  "github.com",
  "origin.cursor.com",
]);
const REPOSITORY_HOST_SET = new Set(REPOSITORY_HOSTS);

const DEVICE_ID_PATTERN = /^dev_[a-f0-9]{32}$/;
const JOB_ID_PATTERN = /^job_[a-f0-9]{32}$/;
const GRANT_ID_PATTERN = /^grant_[a-f0-9]{32}$/;
const LEASE_ID_PATTERN = /^lease_[a-f0-9]{32}$/;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const KEY_FINGERPRINT_PATTERN = /^sha256:[A-Za-z0-9_-]{32,96}$/;
const EXECUTION_SERVICE_ID_PATTERN = /^svc_[a-f0-9]{32}$/;
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const RESOURCE_CEILING_FIELDS = Object.freeze([
  "cpuMilli",
  "memoryBytes",
  "pids",
  "diskBytes",
  "wallTimeMs",
]);

const CAPABILITIES = Object.freeze([
  "workspace.read",
  "workspace.snapshot",
  "workspace.write",
  "terminal.run",
  "git.inspect",
  "git.mutate",
  "git.publish",
  "agent.statskey",
  "agent.claude-code",
  "agent.cursor",
  "xcode.build",
  "xcode.test",
  "xcode.archive",
  "appstore.upload",
  "windows.build",
  "service.host",
  "screen.view",
  "screen.input",
  "device.inspect",
  "device.mutate",
]);
const CAPABILITY_SET = new Set(CAPABILITIES);

const JOB_TYPES = new Set([
  "agent",
  "command",
  "xcode-build",
  "xcode-test",
  "xcode-archive",
  "windows-build",
  "reconcile",
  "service",
  "remote-session",
]);
const JOB_TYPE_CAPABILITY = Object.freeze({
  "command": "terminal.run",
  "xcode-build": "xcode.build",
  "xcode-test": "xcode.test",
  "xcode-archive": "xcode.archive",
  "windows-build": "windows.build",
  "reconcile": "workspace.write",
  "service": "service.host",
  "remote-session": "screen.view",
});

const JOB_STATES = Object.freeze([
  "queued",
  "leased",
  "preparing",
  "running",
  "needs_review",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);
const TERMINAL_STATES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);
const TRANSITIONS = Object.freeze({
  "queued": new Set(["leased", "cancelled", "timed_out"]),
  "leased": new Set(["queued", "preparing", "cancelled", "timed_out"]),
  "preparing": new Set(["running", "failed", "cancelled", "timed_out"]),
  "running": new Set([
    "needs_review",
    "waiting",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
  ]),
  "needs_review": new Set(["running", "failed", "cancelled", "timed_out"]),
  "waiting": new Set(["running", "failed", "cancelled", "timed_out"]),
  "succeeded": new Set(),
  "failed": new Set(),
  "cancelled": new Set(),
  "timed_out": new Set(),
});

const EVENT_TYPES = new Set([
  "accepted",
  "preparation",
  "process-start",
  "process-exit",
  "log",
  "test",
  "artifact",
  "approval-requested",
  "approval-resolved",
  "budget",
  "checkpoint",
  "result",
  "failure",
  "cancellation-acknowledged",
]);

const LIKELY_SECRET_PATTERNS = Object.freeze([
  /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,})/,
  /(?:sk-[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|rk_(?:live|test)_[A-Za-z0-9]{16,})/,
  /(?:xox[baprs]-[A-Za-z0-9-]{20,}|npm_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /(?:api[-_ ]?key|password|private[-_ ]?key|secret|access[-_ ]?token|refresh[-_ ]?token)\s*[:=]\s*["']?[^\s"',;]{12,}/i,
]);

function sensitiveEventKey(value) {
  const normalized = String(value)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  return normalized === "authorization" ||
    normalized.includes("password") ||
    normalized.includes("passwd") ||
    normalized.includes("privatekey") ||
    normalized.includes("credential") ||
    normalized.includes("cookie") ||
    normalized.includes("secret") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("token");
}

function likelySecret(value) {
  return LIKELY_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function apiError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireValue(condition, code, message, status = 400) {
  if (!condition) throw apiError(code, message, status);
}

function cleanString(value, maximum, field, minimum = 1) {
  requireValue(typeof value === "string", "invalid_argument", `${field} is required.`);
  const cleaned = value.trim();
  requireValue(
      cleaned.length >= minimum && cleaned.length <= maximum,
      "invalid_argument",
      `${field} is invalid.`,
  );
  requireValue(
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned),
      "invalid_argument",
      `${field} contains control characters.`,
  );
  return cleaned;
}

function boundedInteger(value, minimum, maximum, field, fallback) {
  const number = value === undefined ? fallback : Number(value);
  requireValue(
      Number.isInteger(number) && number >= minimum && number <= maximum,
      "invalid_argument",
      `${field} is invalid.`,
  );
  return number;
}

function boundedNumber(value, minimum, maximum, field, fallback = 0) {
  const number = value === undefined ? fallback : Number(value);
  requireValue(
      Number.isFinite(number) && number >= minimum && number <= maximum,
      "invalid_argument",
      `${field} is invalid.`,
  );
  return number;
}

function toMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  return Number(value);
}

function validTime(value) {
  const millis = toMillis(value);
  requireValue(
      Number.isFinite(millis) && millis > 0,
      "invalid_argument",
      "Invalid time.",
  );
  return millis;
}

function uniqueStrings(values, maximum, field, validate) {
  requireValue(Array.isArray(values), "invalid_argument", `${field} must be a list.`);
  requireValue(values.length <= maximum, "invalid_argument", `${field} is too large.`);
  const seen = new Set();
  for (const raw of values) {
    const value = cleanString(raw, 240, field);
    requireValue(validate(value), "invalid_argument", `${field} contains an invalid value.`);
    seen.add(value);
  }
  return [...seen].sort();
}

function normalizeCapabilities(values, field = "capabilities") {
  return uniqueStrings(
      values ?? [],
      CAPABILITIES.length,
      field,
      (value) => CAPABILITY_SET.has(value),
  );
}

function normalizeResources(input = {}, device = false) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "resources must be an object.",
  );
  const tib = 1024 ** 4;
  const resources = {
    cpuLogical: boundedInteger(input.cpuLogical, 0, 512, "resources.cpuLogical", 0),
    cpuAvailable: boundedNumber(input.cpuAvailable, 0, 512, "resources.cpuAvailable", 0),
    memoryBytes: boundedNumber(input.memoryBytes, 0, tib * 4, "resources.memoryBytes", 0),
    memoryAvailableBytes: boundedNumber(
        input.memoryAvailableBytes,
        0,
        tib * 4,
        "resources.memoryAvailableBytes",
        0,
    ),
    diskAvailableBytes: boundedNumber(
        input.diskAvailableBytes,
        0,
        tib * 100,
        "resources.diskAvailableBytes",
        0,
    ),
    gpuCount: boundedInteger(input.gpuCount, 0, 32, "resources.gpuCount", 0),
  };
  if (device) {
    requireValue(
        resources.cpuAvailable <= resources.cpuLogical || resources.cpuLogical === 0,
        "invalid_argument",
        "Available CPU exceeds total CPU.",
    );
    requireValue(
        resources.memoryAvailableBytes <= resources.memoryBytes ||
          resources.memoryBytes === 0,
        "invalid_argument",
        "Available memory exceeds total memory.",
    );
  }
  return resources;
}

function normalizeRepository(value) {
  const repository = cleanString(value, 240, "workspaceSnapshot.repository");
  let host;
  let repositoryPath;
  const identity =
    /^([A-Za-z0-9.-]+)\/((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+?)(?:\.git)?$/
        .exec(repository);
  const shorthand =
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(repository);
  const scp =
    /^git@([A-Za-z0-9.-]+):([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/
        .exec(repository);
  if (identity) {
    host = identity[1];
    repositoryPath = identity[2];
  } else if (shorthand) {
    host = "github.com";
    repositoryPath = `${shorthand[1]}/${shorthand[2]}`;
  } else if (scp) {
    host = scp[1];
    repositoryPath = scp[2];
  } else {
    requireValue(
        !repository.includes("%") &&
          !repository.includes("\\") &&
          !/[\t\n\r]/.test(repository) &&
          !/\/\.{1,2}(?:\/|$)/.test(repository),
        "invalid_argument",
        "Repository identity is invalid.",
    );
    let parsed;
    try {
      parsed = new URL(repository);
    } catch {
      requireValue(false, "invalid_argument", "Repository identity is invalid.");
    }
    requireValue(
        ["https:", "ssh:"].includes(parsed.protocol) &&
          !parsed.password &&
          !parsed.port &&
          !parsed.search &&
          !parsed.hash &&
          (!parsed.username ||
            (parsed.protocol === "ssh:" && parsed.username === "git")) &&
          !parsed.pathname.includes("%") &&
          !parsed.pathname.includes("\\"),
        "invalid_argument",
        "Repository identity is invalid.",
    );
    host = parsed.hostname;
    repositoryPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (repositoryPath.endsWith(".git")) {
      repositoryPath = repositoryPath.slice(0, -4);
    }
  }
  requireValue(
      /^[A-Za-z0-9.-]+$/.test(host) &&
        REPOSITORY_HOST_SET.has(host.toLowerCase()) &&
        repositoryPath.split("/").length >= 2 &&
        repositoryPath.split("/").every((part) =>
          /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== ".."),
      "invalid_argument",
      "Repository identity is invalid.",
  );
  return {
    repository,
    repositoryIdentity: `${host}/${repositoryPath}`.toLowerCase(),
  };
}

function normalizeRepositoryIdentity(value) {
  return normalizeRepository(value).repositoryIdentity;
}

function normalizeSnapshot(input) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "workspaceSnapshot is required.",
  );
  const kind = cleanString(input.kind, 16, "workspaceSnapshot.kind");
  requireValue(
      kind === "git",
      "invalid_argument",
      "Only Git snapshots are supported.",
  );
  requireValue(
      input.submodules !== true,
      "invalid_argument",
      "Git submodules are not supported.",
  );
  const {repository, repositoryIdentity} =
    normalizeRepository(input.repository);
  const commit = cleanString(input.commit, 64, "workspaceSnapshot.commit");
  requireValue(COMMIT_PATTERN.test(commit), "invalid_argument", "Invalid source commit.");
  return {
    kind,
    repository,
    repositoryIdentity,
    commit,
    submodules: false,
    snapshotId: `git:${createHash("sha256")
        .update(`${repository}\0${commit}`)
        .digest("hex")}`,
  };
}

function executionRelativePath(value, field, suffixes = []) {
  const relativePath = cleanString(value, 500, field);
  requireValue(
      !relativePath.startsWith(".") &&
        !relativePath.startsWith("/") &&
        !relativePath.includes("\\") &&
        !relativePath.split("/").some((part) => !part || part === "." || part === "..") &&
        (suffixes.length === 0 || suffixes.some((suffix) => relativePath.endsWith(suffix))),
      "invalid_argument",
      `${field} is invalid.`,
  );
  return relativePath;
}

function executionArguments(
    values,
    field,
    maximum = 128,
    maximumBytes = Number.POSITIVE_INFINITY,
) {
  requireValue(
      Array.isArray(values) && values.length <= maximum,
      "invalid_argument",
      `${field} is invalid.`,
  );
  const normalized = values.map((value) => cleanString(value, 2_000, field));
  requireValue(
      Buffer.byteLength(JSON.stringify(normalized), "utf8") <= maximumBytes,
      "payload_too_large",
      `${field} is too large for the worker process transport.`,
  );
  return normalized;
}

function normalizeExecution(input, type) {
  if (input == null) return null;
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "execution must be an object.",
  );
  const kind = cleanString(input.kind, 24, "execution.kind");
  const timeoutMs = boundedInteger(
      input.timeoutMs,
      30_000,
      12 * 60 * 60 * 1000,
      "execution.timeoutMs",
      60 * 60 * 1000,
  );
  if (kind === "xcode") {
    requireValue(
        ["xcode-build", "xcode-test", "xcode-archive"].includes(type),
        "invalid_argument",
        "Xcode execution does not match this job type.",
    );
    const containerKind = cleanString(
        input.containerKind,
        16,
        "execution.containerKind",
    );
    requireValue(
        ["project", "workspace"].includes(containerKind),
        "invalid_argument",
        "Invalid Xcode container kind.",
    );
    const suffix = containerKind === "project" ? ".xcodeproj" : ".xcworkspace";
    return {
      kind,
      action: type.slice("xcode-".length),
      containerKind,
      containerPath: executionRelativePath(
          input.containerPath,
          "execution.containerPath",
          [suffix],
      ),
      scheme: cleanString(input.scheme, 160, "execution.scheme"),
      configuration: cleanString(
          input.configuration ?? "Debug",
          80,
          "execution.configuration",
      ),
      destination: cleanString(
          input.destination ?? "platform=macOS",
          300,
          "execution.destination",
      ),
      onlyTesting: executionArguments(
          input.onlyTesting ?? [],
          "execution.onlyTesting",
          200,
      ),
      timeoutMs,
    };
  }
  if (kind === "command") {
    requireValue(
        ["command", "windows-build"].includes(type),
        "invalid_argument",
        "Command execution does not match this job type.",
    );
    const executable = cleanString(input.executable, 120, "execution.executable");
    requireValue(
        /^[A-Za-z0-9][A-Za-z0-9._+-]{0,119}$/.test(executable),
        "invalid_argument",
        "Command executable must be a program name, not a path or shell expression.",
    );
    requireValue(
        type !== "windows-build" || ["dotnet", "msbuild"].includes(
            executable.toLowerCase(),
        ),
        "invalid_argument",
        "Windows build jobs require dotnet or msbuild.",
    );
    return {
      kind,
      executable,
      arguments: executionArguments(
          input.arguments ?? [],
          "execution.arguments",
          128,
          MAX_COMMAND_ARGUMENT_BYTES,
      ),
      workingDirectory: input.workingDirectory &&
        input.workingDirectory !== "." ?
        executionRelativePath(
            input.workingDirectory,
            "execution.workingDirectory",
        ) :
        ".",
      timeoutMs,
    };
  }
  requireValue(false, "invalid_argument", "Invalid execution kind.");
}

function normalizeTarget(input = {}) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "target must be an object.",
  );
  return {
    deviceIds: uniqueStrings(
        input.deviceIds ?? [],
        16,
        "target.deviceIds",
        (value) => DEVICE_ID_PATTERN.test(value),
    ),
    platforms: uniqueStrings(
        input.platforms ?? [],
        5,
        "target.platforms",
        (value) => ["darwin", "win32", "linux", "ios", "android"].includes(value),
    ),
    allowControllerAsWorker: input.allowControllerAsWorker === true,
    preferDirect: input.preferDirect !== false,
  };
}

function normalizeCage(input) {
  if (!input || input.enabled !== true) return {enabled: false};
  requireValue(
      typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "cage must be an object.",
  );
  return {
    enabled: true,
    maxSpendUsd: boundedNumber(input.maxSpendUsd, 0.01, 100_000, "cage.maxSpendUsd", 25),
    maxOverrunFraction: boundedNumber(
        input.maxOverrunFraction,
        0,
        0.5,
        "cage.maxOverrunFraction",
        0.1,
    ),
    maxWallTimeMs: boundedInteger(
        input.maxWallTimeMs,
        30_000,
        7 * 24 * 60 * 60 * 1000,
        "cage.maxWallTimeMs",
        4 * 60 * 60 * 1000,
    ),
    maxToolCalls: boundedInteger(
        input.maxToolCalls,
        1,
        1_000_000,
        "cage.maxToolCalls",
        2_000,
    ),
    maxChildJobs: boundedInteger(
        input.maxChildJobs,
        0,
        1_000,
        "cage.maxChildJobs",
        16,
    ),
    maxRepeatedFailures: boundedInteger(
        input.maxRepeatedFailures,
        1,
        100,
        "cage.maxRepeatedFailures",
        4,
    ),
    noProgressMs: boundedInteger(
        input.noProgressMs,
        30_000,
        24 * 60 * 60 * 1000,
        "cage.noProgressMs",
        20 * 60 * 1000,
    ),
  };
}

function normalizeCreateJob(input, uid, at) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "Job is required.",
  );
  const createdAt = validTime(at);
  const workspaceId = cleanString(input.workspaceId, 128, "workspaceId");
  requireValue(
      WORKSPACE_ID_PATTERN.test(workspaceId),
      "invalid_argument",
      "Invalid workspace id.",
  );
  const type = cleanString(input.type, 32, "type");
  requireValue(JOB_TYPES.has(type), "invalid_argument", "Invalid job type.");
  const deadlineAt = validTime(input.deadlineAt);
  requireValue(
      deadlineAt > createdAt && deadlineAt - createdAt <= MAX_JOB_LIFETIME_MS,
      "invalid_argument",
      "Job deadline is invalid.",
  );
  const requiredCapabilities = normalizeCapabilities(
      input.requiredCapabilities,
      "requiredCapabilities",
  );
  requireValue(
      requiredCapabilities.length > 0,
      "invalid_argument",
      "Job requires at least one capability.",
  );
  const typeCapability = JOB_TYPE_CAPABILITY[type];
  const mandatoryCapabilities = [
    "workspace.read",
    "workspace.snapshot",
    ...(typeCapability ? [typeCapability] : []),
  ];
  for (const capability of mandatoryCapabilities) {
    requireValue(
        requiredCapabilities.includes(capability),
        "invalid_argument",
        `${type} jobs require ${capability}.`,
    );
  }
  const execution = normalizeExecution(input.execution, type);
  requireValue(
      ![
        "command",
        "windows-build",
        "xcode-build",
        "xcode-test",
        "xcode-archive",
      ].includes(type) || execution != null,
      "invalid_argument",
      `${type} jobs require a typed execution contract.`,
  );
  requireValue(
      type !== "agent" ||
        requiredCapabilities.some((capability) => capability.startsWith("agent.")),
      "invalid_argument",
      "Agent jobs require an agent runtime capability.",
  );
  const approvalPolicy = cleanString(
      input.approvalPolicy ?? "review",
      24,
      "approvalPolicy",
  );
  requireValue(
      ["review", "auto", "independent", "custom"].includes(approvalPolicy),
      "invalid_argument",
      "Invalid approval policy.",
  );
  const reconciliationPolicy = cleanString(
      input.reconciliationPolicy ?? "lead",
      24,
      "reconciliationPolicy",
  );
  requireValue(
      ["lead", "manual", "best-of-n", "adaptive"].includes(reconciliationPolicy),
      "invalid_argument",
      "Invalid reconciliation policy.",
  );
  const idempotencyKey = cleanString(input.idempotencyKey, 128, "idempotencyKey");
  requireValue(
      IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey),
      "invalid_argument",
      "Invalid idempotency key.",
  );
  const normalized = {
    schemaVersion: PROTOCOL_VERSION,
    ownerUid: cleanString(uid, 128, "ownerUid"),
    workspaceId,
    type,
    objective: cleanString(input.objective, 12_000, "objective"),
    workspaceSnapshot: normalizeSnapshot(input.workspaceSnapshot),
    execution,
    requiredCapabilities,
    target: normalizeTarget(input.target),
    resources: normalizeResources(input.resources),
    exclusiveResources: uniqueStrings(
        input.exclusiveResources ?? [],
        64,
        "exclusiveResources",
        (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),
    ),
    dependencies: uniqueStrings(
        input.dependencies ?? [],
        128,
        "dependencies",
        (value) => JOB_ID_PATTERN.test(value),
    ),
    deadlineAt,
    maxAttempts: boundedInteger(input.maxAttempts, 1, 10, "maxAttempts", 2),
    approvalPolicy,
    reconciliationPolicy,
    cage: normalizeCage(input.cage),
    idempotencyKey,
  };
  requireValue(
      Buffer.byteLength(JSON.stringify(normalized), "utf8") <=
        MAX_NORMALIZED_JOB_BYTES,
      "payload_too_large",
      "Job is too large for the signed worker transport.",
      400,
  );
  return normalized;
}

function normalizeDeviceEnrollment(input, uid) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "Device is required.",
  );
  const id = cleanString(input.id, 64, "device.id");
  requireValue(DEVICE_ID_PATTERN.test(id), "invalid_argument", "Invalid device id.");
  const role = cleanString(input.role, 24, "device.role");
  requireValue(
      ["controller", "worker", "hybrid"].includes(role),
      "invalid_argument",
      "Invalid device role.",
  );
  const workerMode = cleanString(
      input.workerMode || (role === "controller" ? "disabled" : "dedicated"),
      24,
      "device.workerMode",
  );
  requireValue(
      ["dedicated", "opt-in", "disabled"].includes(workerMode),
      "invalid_argument",
      "Invalid worker mode.",
  );
  const platform = cleanString(input.platform, 24, "device.platform");
  requireValue(
      ["darwin", "win32", "linux", "ios", "android"].includes(platform),
      "invalid_argument",
      "Invalid device platform.",
  );
  const fingerprint = cleanString(
      input.publicKeyFingerprint,
      120,
      "device.publicKeyFingerprint",
  );
  requireValue(
      KEY_FINGERPRINT_PATTERN.test(fingerprint),
      "invalid_argument",
      "Invalid public key fingerprint.",
  );
  return {
    schemaVersion: PROTOCOL_VERSION,
    id,
    ownerUid: cleanString(uid, 128, "ownerUid"),
    label: cleanString(input.label, 80, "device.label"),
    role,
    workerMode,
    platform,
    publicKeyFingerprint: fingerprint,
    maxConcurrentJobs: boundedInteger(
        input.maxConcurrentJobs,
        1,
        128,
        "device.maxConcurrentJobs",
        1,
    ),
  };
}

function normalizeHeartbeat(input) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "Heartbeat is required.",
  );
  const connection = cleanString(input.connection || "offline", 16, "connection");
  requireValue(
      ["direct", "relay", "offline"].includes(connection),
      "invalid_argument",
      "Invalid connection.",
  );
  const protocolMinimum = boundedInteger(
      input.protocolMinimum,
      1,
      PROTOCOL_VERSION,
      "protocolMinimum",
      PROTOCOL_VERSION,
  );
  return {
    capabilities: normalizeCapabilities(input.capabilities),
    executables: uniqueStrings(
        input.executables || [],
        64,
        "executables",
        (value) => /^[A-Za-z0-9][A-Za-z0-9._+-]{0,119}$/.test(value),
    ),
    resources: normalizeResources(input.resources, true),
    activeJobs: boundedInteger(input.activeJobs, 0, 128, "activeJobs", 0),
    connection,
    protocolMinimum,
    protocolMaximum: boundedInteger(
        input.protocolMaximum,
        protocolMinimum,
        1000,
        "protocolMaximum",
        PROTOCOL_VERSION,
    ),
    softwareVersion: cleanString(input.softwareVersion, 64, "softwareVersion"),
  };
}

function normalizeResourceCeilings(input) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "grant.resourceCeilings must be an object.",
  );
  requireValue(
      Object.keys(input).every((key) => RESOURCE_CEILING_FIELDS.includes(key)),
      "invalid_argument",
      "Unexpected grant.resourceCeilings field.",
  );
  const tib = 1024 ** 4;
  const ceilings = {};
  if (input.cpuMilli != null) {
    ceilings.cpuMilli = boundedInteger(
        input.cpuMilli,
        1,
        4_096_000,
        "grant.resourceCeilings.cpuMilli",
    );
  }
  if (input.memoryBytes != null) {
    ceilings.memoryBytes = boundedInteger(
        input.memoryBytes,
        1,
        tib * 4,
        "grant.resourceCeilings.memoryBytes",
    );
  }
  if (input.pids != null) {
    ceilings.pids = boundedInteger(
        input.pids,
        1,
        4_194_304,
        "grant.resourceCeilings.pids",
    );
  }
  if (input.diskBytes != null) {
    ceilings.diskBytes = boundedInteger(
        input.diskBytes,
        1,
        tib * 100,
        "grant.resourceCeilings.diskBytes",
    );
  }
  if (input.wallTimeMs != null) {
    ceilings.wallTimeMs = boundedInteger(
        input.wallTimeMs,
        1_000,
        7 * 24 * 60 * 60 * 1000,
        "grant.resourceCeilings.wallTimeMs",
    );
  }
  return ceilings;
}

function normalizeGrant(input, uid, at) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "Grant is required.",
  );
  const id = cleanString(input.id, 64, "grant.id");
  requireValue(GRANT_ID_PATTERN.test(id), "invalid_argument", "Invalid grant id.");
  const controllerDeviceId = cleanString(
      input.controllerDeviceId,
      64,
      "grant.controllerDeviceId",
  );
  const workerDeviceId = cleanString(input.workerDeviceId, 64, "grant.workerDeviceId");
  requireValue(
      DEVICE_ID_PATTERN.test(controllerDeviceId) &&
        DEVICE_ID_PATTERN.test(workerDeviceId),
      "invalid_argument",
      "Invalid grant devices.",
  );
  const workspaceIds = uniqueStrings(
      input.workspaceIds || [],
      128,
      "grant.workspaceIds",
      (value) => value === "*" || WORKSPACE_ID_PATTERN.test(value),
  );
  requireValue(workspaceIds.length > 0, "invalid_argument", "Grant needs a workspace.");
  requireValue(
      Array.isArray(input.repositoryIdentities) &&
        input.repositoryIdentities.length <= 128,
      "invalid_argument",
      "grant.repositoryIdentities is invalid.",
  );
  const repositoryIdentities = [...new Set(
    input.repositoryIdentities.map((value) => normalizeRepositoryIdentity(value)),
  )].sort();
  requireValue(
      repositoryIdentities.length > 0,
      "invalid_argument",
      "Grant needs a repository identity.",
  );
  const capabilities = normalizeCapabilities(input.capabilities);
  requireValue(capabilities.length > 0, "invalid_argument", "Grant needs capabilities.");
  const issuedAt = validTime(at);
  const expiresAt = validTime(input.expiresAt);
  requireValue(expiresAt > issuedAt, "invalid_argument", "Invalid grant expiration.");
  const normalized = {
    schemaVersion: PROTOCOL_VERSION,
    id,
    ownerUid: cleanString(uid, 128, "ownerUid"),
    controllerDeviceId,
    workerDeviceId,
    workspaceIds,
    repositoryIdentities,
    capabilities,
    unattended: input.unattended === true,
    policyVersion: boundedInteger(input.policyVersion, 1, 1, "policyVersion", 1),
    issuedAt,
    expiresAt,
  };
  // Grant v2 fields are additive-optional: absent fields keep the v1 receipt
  // shape (and digest) byte-identical.
  if (input.executionServiceId != null) {
    const executionServiceId = cleanString(
        input.executionServiceId,
        64,
        "grant.executionServiceId",
    );
    requireValue(
        EXECUTION_SERVICE_ID_PATTERN.test(executionServiceId),
        "invalid_argument",
        "Invalid grant execution service id.",
    );
    normalized.executionServiceId = executionServiceId;
  }
  for (const field of [
    "executorProfileIds",
    "sandboxProfileIds",
    "networkProfileIds",
  ]) {
    if (input[field] != null) {
      normalized[field] = uniqueStrings(
          input[field],
          16,
          `grant.${field}`,
          (value) => PROFILE_ID_PATTERN.test(value),
      );
    }
  }
  if (input.resourceCeilings != null) {
    normalized.resourceCeilings = normalizeResourceCeilings(input.resourceCeilings);
  }
  if (input.minimumHelperProtocol != null) {
    normalized.minimumHelperProtocol = boundedInteger(
        input.minimumHelperProtocol,
        1,
        1_000,
        "grant.minimumHelperProtocol",
    );
  }
  if (input.minimumPolicyEpoch != null) {
    normalized.minimumPolicyEpoch = boundedInteger(
        input.minimumPolicyEpoch,
        1,
        1_000_000,
        "grant.minimumPolicyEpoch",
    );
  }
  return normalized;
}

function validateEventPayload(value, depth = 0, counter = {keys: 0}) {
  requireValue(depth <= MAX_EVENT_DEPTH, "invalid_argument", "Event payload is too deep.");
  if (value == null || typeof value === "boolean") return;
  if (typeof value === "number") {
    requireValue(Number.isFinite(value), "invalid_argument", "Event number is invalid.");
    return;
  }
  if (typeof value === "string") {
    requireValue(value.length <= 32_000, "invalid_argument", "Event string is too large.");
    requireValue(!likelySecret(value), "invalid_argument", "Secrets are not allowed.");
    return;
  }
  if (Array.isArray(value)) {
    requireValue(value.length <= 400, "invalid_argument", "Event list is too large.");
    for (const item of value) validateEventPayload(item, depth + 1, counter);
    return;
  }
  requireValue(
      value && typeof value === "object" &&
        (Object.getPrototypeOf(value) === Object.prototype ||
          Object.getPrototypeOf(value) === null),
      "invalid_argument",
      "Event payload contains an unsupported value.",
  );
  for (const [key, item] of Object.entries(value)) {
    counter.keys += 1;
    requireValue(counter.keys <= MAX_EVENT_KEYS, "invalid_argument", "Too many event fields.");
    requireValue(!sensitiveEventKey(key), "invalid_argument", "Secrets are not allowed.");
    validateEventPayload(item, depth + 1, counter);
  }
}

function normalizeEvent(input) {
  requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_argument",
      "Event is required.",
  );
  const type = cleanString(input.type, 64, "event.type");
  requireValue(EVENT_TYPES.has(type), "invalid_argument", "Invalid event type.");
  const sequence = boundedInteger(input.sequence, 1, 10_000_000, "event.sequence", 1);
  const payload = input.payload || {};
  validateEventPayload(payload);
  const encoded = stableStringify(payload);
  requireValue(
      Buffer.byteLength(encoded) <= MAX_EVENT_BYTES,
      "invalid_argument",
      "Event payload is too large.",
  );
  return {
    type,
    sequence,
    payload,
    payloadDigest: createHash("sha256").update(encoded).digest("hex"),
  };
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) =>
    `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function requestDigest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function canTransition(from, to) {
  return TRANSITIONS[from]?.has(to) === true;
}

module.exports = {
  ARTIFACT_ID_PATTERN,
  CAPABILITIES,
  DEVICE_ID_PATTERN,
  DEVICE_ONLINE_WINDOW_MS,
  EXECUTION_SERVICE_ID_PATTERN,
  GRANT_ID_PATTERN,
  JOB_ID_PATTERN,
  JOB_STATES,
  LEASE_ID_PATTERN,
  PROFILE_ID_PATTERN,
  PROTOCOL_VERSION,
  REPOSITORY_HOSTS,
  TERMINAL_STATES,
  apiError,
  boundedInteger,
  canTransition,
  cleanString,
  normalizeCreateJob,
  normalizeCage,
  normalizeDeviceEnrollment,
  normalizeEvent,
  normalizeExecution,
  normalizeGrant,
  normalizeHeartbeat,
  normalizeRepositoryIdentity,
  requestDigest,
  requireValue,
  stableStringify,
  toMillis,
  validTime,
};
