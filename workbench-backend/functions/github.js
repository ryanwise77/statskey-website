const {encryptSecret, decryptSecret, secretContext} = require("./crypto");

const GITHUB_API = "https://api.github.com";
const GITHUB_OAUTH = "https://github.com";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHANGES = 25;
const MAX_AGGREGATE_BYTES = 4 * 1024 * 1024;

async function connect(uid, payload, options) {
  const token = String(payload?.token || "").trim();
  if (!token.startsWith("github_pat_") || !isPlausibleToken(token)) {
    throw apiError("invalid_argument", "Enter a valid fine-grained GitHub token.", 400);
  }
  return persistConnection(uid, token, options);
}

async function deviceStart(uid, _payload, options) {
  const clientId = requireClientId(options);
  const body = await githubOAuthJson("/login/device/code", {
    client_id: clientId,
    scope: "repo",
  }, options);
  if (!body?.device_code || !body?.user_code) {
    throw apiError("failed_precondition", "GitHub did not start device sign-in.", 412);
  }
  const interval = Math.max(Number(body.interval) || 5, 1);
  const expiresIn = Math.max(Number(body.expires_in) || 900, 60);
  const now = options.now();
  await options.db.doc(`githubWorkspaceDeviceFlows/${uid}`).set({
    uid,
    provider: "github",
    deviceCode: encryptSecret(
        String(body.device_code),
        options.encryptionKey,
        secretContext(uid),
    ),
    interval,
    expiresAtMs: toMillis(now) + expiresIn * 1000,
    createdAt: now,
  });
  return {
    userCode: String(body.user_code),
    verificationUri:
      safeUrl(body.verification_uri) || "https://github.com/login/device",
    interval,
    expiresIn,
  };
}

async function devicePoll(uid, _payload, options) {
  const clientId = requireClientId(options);
  const flowRef = options.db.doc(`githubWorkspaceDeviceFlows/${uid}`);
  const snapshot = await flowRef.get();
  if (!snapshot.exists) {
    throw apiError("failed_precondition", "Start GitHub sign-in first.", 412);
  }
  const flow = snapshot.data();
  if (Number(flow.expiresAtMs || 0) < toMillis(options.now())) {
    await deleteDoc(options.db, flowRef);
    return {status: "expired"};
  }
  const deviceCode = decryptSecret(
      flow.deviceCode,
      options.encryptionKey,
      secretContext(uid),
  );
  const body = await githubOAuthJson("/login/oauth/access_token", {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: DEVICE_GRANT,
  }, options);
  if (body?.error === "authorization_pending") {
    return {status: "pending"};
  }
  if (body?.error === "slow_down") {
    return {status: "pending", interval: Math.max(Number(body.interval) || 10, 5)};
  }
  if (body?.error === "expired_token" || body?.error === "access_denied") {
    await deleteDoc(options.db, flowRef);
    return {status: body.error === "access_denied" ? "denied" : "expired"};
  }
  const token = String(body?.access_token || "");
  if (!isPlausibleToken(token)) {
    throw apiError("failed_precondition", "GitHub returned an unusable sign-in.", 412);
  }
  const result = await persistConnection(uid, token, options);
  await deleteDoc(options.db, flowRef);
  return result;
}

async function persistConnection(uid, token, options) {
  const user = await githubJson("/user", token, options);
  if (!user?.login || !Number.isFinite(user.id)) {
    throw apiError("failed_precondition", "GitHub did not return a usable account.", 412);
  }
  await githubJson("/user/repos?per_page=1&sort=updated", token, options);
  const now = options.now();
  const batch = options.db.batch();
  batch.set(options.db.doc(`githubWorkspaceSecrets/${uid}`), {
    uid,
    provider: "github",
    token: encryptSecret(token, options.encryptionKey, secretContext(uid)),
    updatedAt: now,
  });
  batch.set(options.db.doc(`githubWorkspaceConnections/${uid}`), {
    provider: "github",
    status: "connected",
    login: user.login,
    accountId: user.id,
    avatarUrl: safeUrl(user.avatar_url),
    connectedAt: now,
    updatedAt: now,
  }, {merge: true});
  await batch.commit();
  return {status: "connected", login: user.login};
}

async function connectionStatus(uid, _payload, options) {
  const snapshot = await options.db.doc(`githubWorkspaceConnections/${uid}`).get();
  if (!snapshot.exists) return {status: "disconnected"};
  const data = snapshot.data();
  return {
    status: data.status === "connected" ? "connected" : "disconnected",
    login: typeof data.login === "string" ? data.login : null,
    avatarUrl: safeUrl(data.avatarUrl),
  };
}

async function disconnect(uid, _payload, options) {
  const batch = options.db.batch();
  batch.delete(options.db.doc(`githubWorkspaceSecrets/${uid}`));
  batch.delete(options.db.doc(`githubWorkspaceDeviceFlows/${uid}`));
  batch.set(options.db.doc(`githubWorkspaceConnections/${uid}`), {
    provider: "github",
    status: "disconnected",
    updatedAt: options.now(),
  }, {merge: true});
  await batch.commit();
  return {status: "disconnected"};
}

async function repositories(uid, _payload, options) {
  const token = await credentialFor(uid, options);
  const repos = await githubJson(
      "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
      token,
      options,
  );
  return {
    repositories: Array.isArray(repos) ?
      repos
          .filter((repo) => repo?.permissions?.pull === true)
          .slice(0, 100)
          .map((repo) => ({
            id: repo.id,
            fullName: repo.full_name,
            name: repo.name,
            owner: repo.owner?.login,
            private: repo.private === true,
            defaultBranch: repo.default_branch || "main",
            canPush: repo.permissions?.push === true,
            updatedAt: repo.updated_at || null,
          })) :
      [],
  };
}

async function branches(uid, payload, options) {
  const token = await credentialFor(uid, options);
  const repository = repositoryName(payload?.repository);
  const result = await githubJson(
      `/repos/${repository}/branches?per_page=100`,
      token,
      options,
  );
  return {
    branches: Array.isArray(result) ?
      result.slice(0, 100).map((branch) => ({
        name: branch.name,
        sha: branch.commit?.sha || null,
        protected: branch.protected === true,
      })) :
      [],
  };
}

async function tree(uid, payload, options) {
  const token = await credentialFor(uid, options);
  const repository = repositoryName(payload?.repository);
  const branch = branchName(payload?.branch);
  const ref = await githubJson(
      `/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`,
      token,
      options,
  );
  const headSha = ref?.object?.sha;
  if (!headSha) throw apiError("not_found", "GitHub branch was not found.", 404);
  const commit = await githubJson(
      `/repos/${repository}/git/commits/${headSha}`,
      token,
      options,
  );
  const treeSha = commit?.tree?.sha;
  if (!treeSha) {
    throw apiError("failed_precondition", "GitHub tree is unavailable.", 412);
  }
  const result = await githubJson(
      `/repos/${repository}/git/trees/${treeSha}?recursive=1`,
      token,
      options,
  );
  return {
    headSha,
    treeSha,
    truncated: result?.truncated === true,
    files: Array.isArray(result?.tree) ?
      result.tree
          .filter((entry) => entry.type === "blob" && safePath(entry.path))
          .slice(0, 10000)
          .map((entry) => ({
            path: entry.path,
            sha: entry.sha,
            size: Number(entry.size || 0),
          })) :
      [],
  };
}

async function readFile(uid, payload, options) {
  const token = await credentialFor(uid, options);
  const repository = repositoryName(payload?.repository);
  const branch = branchName(payload?.branch);
  const filePath = repositoryPath(payload?.path);
  const file = await githubJson(
      `/repos/${repository}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(branch)}`,
      token,
      options,
  );
  if (file?.type !== "file" || typeof file.content !== "string") {
    throw apiError("not_found", "GitHub file was not found.", 404);
  }
  if (Number(file.size || 0) > MAX_FILE_BYTES) {
    throw apiError("resource_exhausted", "Browser editing is limited to 2 MB files.", 413);
  }
  return {
    path: filePath,
    sha: file.sha,
    size: file.size,
    encoding: file.encoding,
    content: Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8"),
    downloadUrl: safeUrl(file.download_url),
  };
}

async function commit(uid, payload, options) {
  const token = await credentialFor(uid, options);
  const repository = repositoryName(payload?.repository);
  const branch = branchName(payload?.branch);
  const baseCommitSha = commitSha(payload?.baseCommitSha);
  const message = commitMessage(payload?.message);
  const changes = normalizeChanges(payload?.changes);
  const refPath = `/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`;
  const ref = await githubJson(refPath, token, options);
  const currentHead = ref?.object?.sha;
  if (!currentHead || currentHead !== baseCommitSha) {
    throw apiError(
        "conflict",
        "This branch changed on GitHub. Refresh before committing.",
        409,
    );
  }
  const currentCommit = await githubJson(
      `/repos/${repository}/git/commits/${currentHead}`,
      token,
      options,
  );
  const baseTree = currentCommit?.tree?.sha;
  if (!baseTree) {
    throw apiError("failed_precondition", "GitHub base tree is unavailable.", 412);
  }
  const baseTreeListing = await githubJson(
      `/repos/${repository}/git/trees/${baseTree}?recursive=1`,
      token,
      options,
  );
  if (baseTreeListing?.truncated === true) {
    throw apiError(
        "failed_precondition",
        "The repository tree is too large for safe browser commits.",
        412,
    );
  }
  const currentEntries = new Map(
      (baseTreeListing?.tree || []).map((entry) => [entry.path, entry]),
  );
  const entries = [];
  for (const change of changes) {
    const current = currentEntries.get(change.path);
    if (current && current.type !== "blob") {
      throw apiError(
          "invalid_argument",
          "Symlinks, submodules, and directories cannot be edited in the browser.",
          400,
      );
    }
    if (change.content === null) {
      if (!current) {
        throw apiError("invalid_argument", "Cannot delete a missing file.", 400);
      }
      entries.push({
        path: change.path,
        mode: current.mode === "100755" ? "100755" : "100644",
        type: "blob",
        sha: null,
      });
      continue;
    }
    const blob = await githubJson(
        `/repos/${repository}/git/blobs`,
        token,
        options,
        {method: "POST", body: {content: change.content, encoding: "utf-8"}},
    );
    entries.push({
      path: change.path,
      mode: current?.mode === "100755" ? "100755" : "100644",
      type: "blob",
      sha: blob.sha,
    });
  }
  const nextTree = await githubJson(
      `/repos/${repository}/git/trees`,
      token,
      options,
      {method: "POST", body: {base_tree: baseTree, tree: entries}},
  );
  const nextCommit = await githubJson(
      `/repos/${repository}/git/commits`,
      token,
      options,
      {
        method: "POST",
        body: {message, tree: nextTree.sha, parents: [currentHead]},
      },
  );
  try {
    await githubJson(
        `/repos/${repository}/git/refs/heads/${encodeURIComponent(branch)}`,
        token,
        options,
        {method: "PATCH", body: {sha: nextCommit.sha, force: false}},
    );
  } catch (error) {
    if (error?.githubStatus === 409 || error?.githubStatus === 422) {
      throw apiError(
          "conflict",
          "GitHub rejected a non-fast-forward update. Refresh and review the newer branch.",
          409,
      );
    }
    throw error;
  }
  await options.db.doc(`users/${uid}/githubWorkspaceCommits/${nextCommit.sha}`).set({
    repository,
    branch,
    commitSha: nextCommit.sha,
    message,
    paths: changes.map((change) => change.path),
    createdAt: options.now(),
  });
  return {
    commitSha: nextCommit.sha,
    commitUrl: safeUrl(nextCommit.html_url) ||
      `https://github.com/${repository}/commit/${nextCommit.sha}`,
    branch,
  };
}

async function credentialFor(uid, options) {
  const snapshot = await options.db.doc(`githubWorkspaceSecrets/${uid}`).get();
  if (!snapshot.exists) {
    throw apiError("failed_precondition", "Connect GitHub first.", 412);
  }
  const token = decryptSecret(
      snapshot.data().token,
      options.encryptionKey,
      secretContext(uid),
  );
  if (!isPlausibleToken(token)) {
    throw apiError("failed_precondition", "Stored GitHub access is invalid.", 412);
  }
  return token;
}

async function githubJson(path, token, options, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await (options.fetchImpl || globalThis.fetch)(`${GITHUB_API}${path}`, {
      method: init.method || "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "StatsKey-Workbench",
        ...(init.body ? {"Content-Type": "application/json"} : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) {
    const error = new Error(
        typeof body?.message === "string" ?
          body.message :
          `GitHub request failed (${response.status}).`,
    );
    error.githubStatus = response.status;
    throw error;
  }
  return body;
}

async function githubOAuthJson(path, body, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await (options.fetchImpl || globalThis.fetch)(`${GITHUB_OAUTH}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "StatsKey-Workbench",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    throw apiError(
        "unavailable",
        `GitHub sign-in request failed (${response.status}).`,
        502,
    );
  }
  return parsed;
}

function requireClientId(options) {
  const clientId = String(options.oauthClientId || "").trim();
  if (!clientId) {
    throw apiError(
        "failed_precondition",
        "GitHub sign-in is not configured. Paste a fine-grained token instead.",
        412,
    );
  }
  return clientId;
}

async function deleteDoc(db, ref) {
  const batch = db.batch();
  batch.delete(ref);
  await batch.commit();
}

function toMillis(now) {
  return typeof now?.toMillis === "function" ? now.toMillis() : now.getTime();
}

function isPlausibleToken(value) {
  return typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 512 &&
    (value.startsWith("github_pat_") ||
      value.startsWith("gho_") ||
      value.startsWith("ghu_"));
}

function repositoryName(value) {
  const candidate = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(candidate)) {
    throw apiError("invalid_argument", "Choose a valid GitHub repository.", 400);
  }
  return candidate;
}

function branchName(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 255 ||
      /[\x00-\x20~^:?*\[\]\\]/.test(candidate) ||
      candidate.startsWith("/") || candidate.endsWith("/") ||
      candidate.includes("..")) {
    throw apiError("invalid_argument", "Choose a valid GitHub branch.", 400);
  }
  return candidate;
}

function repositoryPath(value) {
  const candidate = String(value || "").trim().replace(/\\/g, "/");
  if (!safePath(candidate)) {
    throw apiError("invalid_argument", "Choose a valid repository path.", 400);
  }
  if (candidate.toLowerCase().startsWith(".github/workflows/")) {
    throw apiError(
        "permission_denied",
        "Browser edits to GitHub workflow files are disabled.",
        403,
    );
  }
  return candidate;
}

function safePath(candidate) {
  return typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= 1000 &&
    !candidate.startsWith("/") &&
    !candidate.includes("\0") &&
    !candidate.split("/").some((part) => !part || part === "." || part === "..");
}

function commitSha(value) {
  const candidate = String(value || "");
  if (!/^[a-f0-9]{40}$/i.test(candidate)) {
    throw apiError("invalid_argument", "Refresh the branch before committing.", 400);
  }
  return candidate;
}

function commitMessage(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 500) {
    throw apiError("invalid_argument", "Enter a concise commit message.", 400);
  }
  return candidate;
}

function normalizeChanges(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGES) {
    throw apiError("invalid_argument", "Choose between 1 and 25 file changes.", 400);
  }
  const seen = new Set();
  let aggregateBytes = 0;
  const changes = value.map((raw) => {
    const path = repositoryPath(raw?.path);
    if (seen.has(path)) {
      throw apiError("invalid_argument", "Each repository path may change once.", 400);
    }
    seen.add(path);
    if (raw.content === null) return {path, content: null};
    if (typeof raw?.content !== "string" ||
        Buffer.byteLength(raw.content, "utf8") > MAX_FILE_BYTES) {
      throw apiError("invalid_argument", "GitHub file content is too large.", 400);
    }
    aggregateBytes += Buffer.byteLength(raw.content, "utf8");
    return {path, content: raw.content};
  });
  if (aggregateBytes > MAX_AGGREGATE_BYTES) {
    throw apiError(
        "invalid_argument",
        "A browser commit may contain at most 4 MB of text changes.",
        400,
    );
  }
  return changes;
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function apiError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

module.exports = {
  connect,
  connectionStatus,
  deviceStart,
  devicePoll,
  disconnect,
  repositories,
  branches,
  tree,
  readFile,
  commit,
  _test: {
    repositoryName,
    branchName,
    repositoryPath,
    normalizeChanges,
  },
};
