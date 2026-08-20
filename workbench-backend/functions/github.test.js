const test = require("node:test");
const assert = require("node:assert/strict");
const github = require("./github");
const {decryptSecret, secretContext} = require("./crypto");
const {FakeDb, fakeResponse} = require("./testHelpers");

const KEY = Buffer.alloc(32, 4).toString("base64");
const TOKEN = `github_pat_${"b".repeat(40)}`;
const NOW = new Date("2026-08-05T22:00:00Z");

test("repository paths reject traversal, duplicates, and unsafe branches", () => {
  assert.equal(github._test.repositoryName("owner/repo"), "owner/repo");
  assert.equal(github._test.branchName("feature/cloud-edit"), "feature/cloud-edit");
  assert.equal(github._test.repositoryPath("src/app.ts"), "src/app.ts");
  assert.throws(() => github._test.repositoryPath("../secret"));
  assert.throws(() => github._test.branchName("bad..branch"));
  assert.throws(() => github._test.repositoryPath(".github/workflows/release.yml"));
  assert.throws(() => github._test.normalizeChanges([
    {path: "a.txt", content: "one"},
    {path: "a.txt", content: "two"},
  ]));
  assert.throws(() => github._test.normalizeChanges([
    {path: "large-a.txt", content: "a".repeat(2 * 1024 * 1024)},
    {path: "large-b.txt", content: "b".repeat(2 * 1024 * 1024)},
    {path: "large-c.txt", content: "c"},
  ]));
});

test("fine-grained token is encrypted and metadata is separated", async () => {
  const db = new FakeDb();
  const result = await github.connect("user-1", {token: TOKEN}, {
    db,
    encryptionKey: KEY,
    now: () => NOW,
    fetchImpl: async (url) =>
      url.endsWith("/user") ?
        fakeResponse(200, {
          id: 77,
          login: "runner",
          avatar_url: "https://avatars.githubusercontent.com/u/77",
        }) :
        fakeResponse(200, []),
  });
  assert.equal(result.status, "connected");
  const secret = db.docs.get("githubWorkspaceSecrets/user-1");
  assert.equal(JSON.stringify(secret).includes(TOKEN), false);
  assert.equal(
      decryptSecret(secret.token, KEY, secretContext("user-1")),
      TOKEN,
  );
  const metadata = db.docs.get("githubWorkspaceConnections/user-1");
  assert.equal(metadata.login, "runner");
  assert.equal(JSON.stringify(metadata).includes(TOKEN), false);
});

test("device flow start stores an encrypted device code", async () => {
  const db = new FakeDb();
  const result = await github.deviceStart("user-1", {}, {
    db,
    encryptionKey: KEY,
    oauthClientId: "Iv23liExample",
    now: () => NOW,
    fetchImpl: async (url) => {
      assert.equal(url, "https://github.com/login/device/code");
      return fakeResponse(200, {
        device_code: "device-code-secret",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        interval: 5,
        expires_in: 900,
      });
    },
  });
  assert.equal(result.userCode, "ABCD-1234");
  assert.equal(result.verificationUri, "https://github.com/login/device");
  const flow = db.docs.get("githubWorkspaceDeviceFlows/user-1");
  assert.equal(JSON.stringify(flow).includes("device-code-secret"), false);
  assert.equal(
      decryptSecret(flow.deviceCode, KEY, secretContext("user-1")),
      "device-code-secret",
  );
});

test("device flow poll stays pending, then connects and clears state", async () => {
  const db = new FakeDb();
  const options = (fetchImpl) => ({
    db,
    encryptionKey: KEY,
    oauthClientId: "Iv23liExample",
    now: () => NOW,
    fetchImpl,
  });
  await github.deviceStart("user-1", {}, options(async () => fakeResponse(200, {
    device_code: "device-code-secret",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    interval: 5,
    expires_in: 900,
  })));
  const pending = await github.devicePoll("user-1", {}, options(async () =>
    fakeResponse(200, {error: "authorization_pending"})));
  assert.equal(pending.status, "pending");
  assert.ok(db.docs.has("githubWorkspaceDeviceFlows/user-1"));
  const oauthToken = `gho_${"c".repeat(36)}`;
  const connected = await github.devicePoll("user-1", {}, options(async (url) => {
    if (url === "https://github.com/login/oauth/access_token") {
      return fakeResponse(200, {access_token: oauthToken, token_type: "bearer"});
    }
    if (url.endsWith("/user")) {
      return fakeResponse(200, {id: 77, login: "runner"});
    }
    return fakeResponse(200, []);
  }));
  assert.equal(connected.status, "connected");
  assert.equal(connected.login, "runner");
  assert.equal(db.docs.has("githubWorkspaceDeviceFlows/user-1"), false);
  const secret = db.docs.get("githubWorkspaceSecrets/user-1");
  assert.equal(JSON.stringify(secret).includes(oauthToken), false);
  assert.equal(
      decryptSecret(secret.token, KEY, secretContext("user-1")),
      oauthToken,
  );
});

test("device flow requires configuration and an existing flow", async () => {
  const db = new FakeDb();
  await assert.rejects(
      () => github.deviceStart("user-1", {}, {
        db,
        encryptionKey: KEY,
        oauthClientId: "",
        now: () => NOW,
        fetchImpl: async () => fakeResponse(200, {}),
      }),
      (error) => error.code === "failed_precondition",
  );
  await assert.rejects(
      () => github.devicePoll("user-1", {}, {
        db,
        encryptionKey: KEY,
        oauthClientId: "Iv23liExample",
        now: () => NOW,
        fetchImpl: async () => fakeResponse(200, {}),
      }),
      (error) => error.code === "failed_precondition",
  );
});

test("commit rejects a moved branch before creating any Git objects", async () => {
  const db = new FakeDb();
  await github.connect("user-1", {token: TOKEN}, {
    db,
    encryptionKey: KEY,
    now: () => NOW,
    fetchImpl: async (url) =>
      url.endsWith("/user") ?
        fakeResponse(200, {id: 77, login: "runner"}) :
        fakeResponse(200, []),
  });
  let calls = 0;
  await assert.rejects(
      () => github.commit("user-1", {
        repository: "owner/repo",
        branch: "main",
        baseCommitSha: "a".repeat(40),
        message: "Update browser file",
        changes: [{path: "README.md", content: "updated"}],
      }, {
        db,
        encryptionKey: KEY,
        now: () => NOW,
        fetchImpl: async () => {
          calls += 1;
          return fakeResponse(200, {object: {sha: "b".repeat(40)}});
        },
      }),
      (error) => error.code === "conflict",
  );
  assert.equal(calls, 1);
});
