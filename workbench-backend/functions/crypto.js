const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} = require("node:crypto");

const VERSION = 1;
const ALGORITHM = "aes-256-gcm";

function encryptSecret(value, keyMaterial, context) {
  const key = decodeKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  return {
    version: VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptSecret(envelope, keyMaterial, context) {
  if (!envelope || envelope.version !== VERSION ||
      envelope.algorithm !== ALGORITHM) {
    throw new Error("Unsupported secret envelope.");
  }
  const decipher = createDecipheriv(
      ALGORITHM,
      decodeKey(keyMaterial),
      decodeBase64(envelope.iv, 12, "initialization vector"),
  );
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(decodeBase64(envelope.tag, 16, "authentication tag"));
  const plaintext = Buffer.concat([
    decipher.update(decodeBase64(envelope.ciphertext, null, "ciphertext")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function secretContext(uid) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid || ""))) {
    throw new Error("Invalid StatsKey user.");
  }
  return `statskey-workbench:${uid}:github:v${VERSION}`;
}

function decodeKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Workbench encryption key is not configured.");
  }
  const key = decodeBase64(value.trim(), 32, "encryption key");
  return key;
}

function decodeBase64(value, expectedBytes, label) {
  if (typeof value !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (expectedBytes != null && decoded.length !== expectedBytes) {
    throw new Error(`Invalid ${label} length.`);
  }
  return decoded;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  secretContext,
};
