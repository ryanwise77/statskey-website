const {randomUUID} = require("node:crypto");

const ARTIFACT_UPLOAD_TTL_MS = 30 * 60_000;
const ARTIFACT_DOWNLOAD_TTL_MS = 5 * 60_000;
const ARTIFACT_READINESS_CACHE_MS = 60_000;

function createGcsFleetArtifactStore({
  bucket,
  now = Date.now,
  readinessId = randomUUID,
} = {}) {
  if (!bucket || typeof bucket.file !== "function") {
    throw new TypeError("A Google Cloud Storage bucket is required.");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function.");
  }
  if (typeof readinessId !== "function") {
    throw new TypeError("readinessId must be a function.");
  }

  let readyUntil = 0;
  let readinessCheck = null;

  return Object.freeze({
    async preflight() {
      const current = Number(now());
      if (readyUntil > current) return {ready: true, cached: true};
      if (readinessCheck) return readinessCheck;
      readinessCheck = (async () => {
        const probe = bucket.file(
            `.statskey/fleet-readiness/${readinessId()}`,
        );
        let created = false;
        try {
          await probe.save(Buffer.alloc(0), {
            resumable: false,
            contentType: "application/octet-stream",
            preconditionOpts: {ifGenerationMatch: 0},
          });
          created = true;
          const [metadata] = await probe.getMetadata();
          if (Number(metadata?.size) !== 0) {
            throw new Error("Fleet artifact readiness probe was not empty.");
          }
          await probe.getSignedUrl({
            action: "write",
            version: "v4",
            expires: current + 5 * 60_000,
            extensionHeaders: {
              "x-goog-if-generation-match": "0",
            },
          });
          await probe.delete({ignoreNotFound: true});
          created = false;
          readyUntil = Number(now()) + ARTIFACT_READINESS_CACHE_MS;
          return {ready: true, cached: false};
        } finally {
          if (created) await probe.delete({ignoreNotFound: true});
        }
      })();
      try {
        return await readinessCheck;
      } finally {
        readinessCheck = null;
      }
    },

    async createUploadGrant({
      objectKey,
      artifactId,
      contentHash,
      contentMd5,
      mediaType,
      sizeBytes,
    }) {
      const expiresAt = Number(now()) + ARTIFACT_UPLOAD_TTL_MS;
      const headers = {
        "Content-Length": String(sizeBytes),
        "Content-MD5": contentMd5,
        "Content-Type": mediaType,
        "x-goog-if-generation-match": "0",
        "x-goog-meta-statskey-artifact-id": artifactId,
        "x-goog-meta-statskey-sha256": contentHash,
      };
      const [url] = await bucket.file(objectKey).getSignedUrl({
        action: "write",
        version: "v4",
        expires: expiresAt,
        contentMd5,
        contentType: mediaType,
        extensionHeaders: {
          "content-length": headers["Content-Length"],
          "x-goog-if-generation-match": "0",
          "x-goog-meta-statskey-artifact-id": artifactId,
          "x-goog-meta-statskey-sha256": contentHash,
        },
      });
      return {
        method: "PUT",
        url,
        headers,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async inspectObject(objectKey) {
      const [metadata] = await bucket.file(objectKey).getMetadata();
      return {
        sizeBytes: Number(metadata.size),
        contentMd5: metadata.md5Hash || null,
        contentHash: metadata.metadata?.["statskey-sha256"] || null,
        artifactId: metadata.metadata?.["statskey-artifact-id"] || null,
        mediaType: metadata.contentType || null,
        generation: String(metadata.generation || ""),
      };
    },

    async createDownloadGrant({
      objectKey,
      generation,
      artifactId,
      mediaType,
      notAfter,
    }) {
      const current = Number(now());
      const retentionDeadline = Number(notAfter);
      if (
        !Number.isFinite(retentionDeadline) ||
        retentionDeadline <= current
      ) {
        throw new TypeError("Artifact download retention deadline is invalid.");
      }
      const expiresAt = Math.min(
          current + ARTIFACT_DOWNLOAD_TTL_MS,
          retentionDeadline,
      );
      const extension = {
        "application/json": ".json",
        "application/zip": ".zip",
        "image/png": ".png",
        "text/plain": ".txt",
      }[mediaType] || "";
      const [url] = await bucket
          .file(objectKey, {generation})
          .getSignedUrl({
            action: "read",
            version: "v4",
            expires: expiresAt,
            responseDisposition:
              `attachment; filename="${artifactId}${extension}"`,
            responseType: mediaType,
          });
      return {
        url,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async deleteObject(objectKey) {
      await bucket.file(objectKey).delete({ignoreNotFound: true});
      return {deleted: true};
    },
  });
}

module.exports = {
  ARTIFACT_UPLOAD_TTL_MS,
  ARTIFACT_DOWNLOAD_TTL_MS,
  createGcsFleetArtifactStore,
};
