const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ARTIFACT_DOWNLOAD_TTL_MS,
  ARTIFACT_UPLOAD_TTL_MS,
  createGcsFleetArtifactStore,
} = require("./fleetArtifactStore");

const NOW = Date.parse("2026-08-19T07:00:00.000Z");

test("GCS artifact readiness verifies bucket access and URL signing", async () => {
  let now = NOW;
  let saves = 0;
  let metadataChecks = 0;
  let signingChecks = 0;
  let deletes = 0;
  const store = createGcsFleetArtifactStore({
    bucket: {
      file(objectKey) {
        assert.equal(objectKey, ".statskey/fleet-readiness/probe");
        return {
          async save(contents, options) {
            saves += 1;
            assert.equal(contents.length, 0);
            assert.equal(options.resumable, false);
            assert.deepEqual(options.preconditionOpts, {ifGenerationMatch: 0});
          },
          async getMetadata() {
            metadataChecks += 1;
            return [{size: "0"}];
          },
          async getSignedUrl(config) {
            signingChecks += 1;
            assert.equal(config.action, "write");
            assert.equal(config.extensionHeaders["x-goog-if-generation-match"], "0");
            return ["https://storage.googleapis.com/bucket/readiness?signed=1"];
          },
          async delete(options) {
            deletes += 1;
            assert.deepEqual(options, {ignoreNotFound: true});
          },
        };
      },
    },
    now: () => now,
    readinessId: () => "probe",
  });

  assert.deepEqual(await store.preflight(), {ready: true, cached: false});
  assert.deepEqual(await store.preflight(), {ready: true, cached: true});
  assert.equal(saves, 1);
  assert.equal(metadataChecks, 1);
  assert.equal(signingChecks, 1);
  assert.equal(deletes, 1);
  now += 60_001;
  assert.deepEqual(await store.preflight(), {ready: true, cached: false});
  assert.equal(saves, 2);
  assert.equal(metadataChecks, 2);
  assert.equal(signingChecks, 2);
  assert.equal(deletes, 2);
});

test("GCS readiness fails when its probe cannot be deleted", async () => {
  const store = createGcsFleetArtifactStore({
    bucket: {
      file() {
        return {
          async save() {},
          async getMetadata() {
            return [{size: "0"}];
          },
          async getSignedUrl() {
            return ["https://storage.googleapis.com/bucket/readiness?signed=1"];
          },
          async delete() {
            throw new Error("delete denied");
          },
        };
      },
    },
    readinessId: () => "probe",
  });
  await assert.rejects(() => store.preflight(), /delete denied/);
});

test("GCS artifact grants pin object identity, length, and checksums", async () => {
  let signedConfig;
  const store = createGcsFleetArtifactStore({
    bucket: {
      file(objectKey) {
        assert.equal(objectKey, "fleet/v1/object");
        return {
          async getSignedUrl(config) {
            signedConfig = config;
            return ["https://storage.googleapis.com/bucket/object?signed=1"];
          },
        };
      },
    },
    now: () => NOW,
  });
  const grant = await store.createUploadGrant({
    objectKey: "fleet/v1/object",
    artifactId: `artifact_${"a".repeat(32)}`,
    contentHash: "b".repeat(64),
    contentMd5: "YWFhYWFhYWFhYWFhYWFhYQ==",
    mediaType: "application/zip",
    sizeBytes: 1234,
  });

  assert.equal(signedConfig.action, "write");
  assert.equal(signedConfig.version, "v4");
  assert.equal(signedConfig.extensionHeaders["content-length"], "1234");
  assert.equal(signedConfig.extensionHeaders["x-goog-if-generation-match"], "0");
  assert.equal(signedConfig.contentMd5, "YWFhYWFhYWFhYWFhYWFhYQ==");
  assert.equal(
      Date.parse(grant.expiresAt),
      NOW + ARTIFACT_UPLOAD_TTL_MS,
  );
  assert.equal(grant.headers["Content-Length"], "1234");
});

test("GCS artifact inspection returns integrity metadata", async () => {
  const store = createGcsFleetArtifactStore({
    bucket: {
      file() {
        return {
          async getMetadata() {
            return [{
              size: "42",
              md5Hash: "YWFhYWFhYWFhYWFhYWFhYQ==",
              contentType: "application/zip",
              generation: "17",
              metadata: {
                "statskey-artifact-id": `artifact_${"a".repeat(32)}`,
                "statskey-sha256": "b".repeat(64),
              },
            }];
          },
        };
      },
    },
  });
  assert.deepEqual(await store.inspectObject("fleet/v1/object"), {
    sizeBytes: 42,
    contentMd5: "YWFhYWFhYWFhYWFhYWFhYQ==",
    contentHash: "b".repeat(64),
    artifactId: `artifact_${"a".repeat(32)}`,
    mediaType: "application/zip",
    generation: "17",
  });
});

test("artifact downloads are pinned to the committed object generation", async () => {
  let fileOptions;
  let signedConfig;
  const store = createGcsFleetArtifactStore({
    bucket: {
      file(_objectKey, options) {
        fileOptions = options;
        return {
          async getSignedUrl(config) {
            signedConfig = config;
            return ["https://storage.googleapis.com/bucket/object?read=1"];
          },
        };
      },
    },
    now: () => NOW,
  });
  const grant = await store.createDownloadGrant({
    objectKey: "fleet/v1/object",
    generation: "17",
    artifactId: `artifact_${"a".repeat(32)}`,
    mediaType: "application/zip",
    notAfter: NOW + 10 * 60_000,
  });
  assert.deepEqual(fileOptions, {generation: "17"});
  assert.equal(signedConfig.action, "read");
  assert.equal(signedConfig.version, "v4");
  assert.equal(signedConfig.responseType, "application/zip");
  assert.equal(
      signedConfig.responseDisposition,
      `attachment; filename="artifact_${"a".repeat(32)}.zip"`,
  );
  assert.equal(
      Date.parse(grant.expiresAt),
      NOW + ARTIFACT_DOWNLOAD_TTL_MS,
  );
  await assert.rejects(
      () => store.createDownloadGrant({
        objectKey: "fleet/v1/object",
        generation: "17",
        artifactId: `artifact_${"a".repeat(32)}`,
        mediaType: "application/zip",
        notAfter: NOW,
      }),
      /retention deadline/,
  );
});
