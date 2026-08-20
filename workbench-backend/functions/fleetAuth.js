const {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} = require("node:crypto");

const AUTH_VERSION = 1;
const MAX_LIFETIME_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_CANONICAL_BYTES = 128 * 1024;
const MAX_CANONICAL_DEPTH = 12;
const MAX_CANONICAL_ITEMS = 512;
const DEVICE_ID_PATTERN = /^dev_[a-f0-9]{32}$/;
const REQUEST_ID_PATTERN = /^req_[a-f0-9]{32}$/;
const ACTION_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const RESPONSE_KEY_ID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function authError(code, message, status = 401) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireAuth(condition, code, message, status = 401) {
  if (!condition) throw authError(code, message, status);
}

function canonicalJson(value) {
  const json = canonicalValue(value, 0);
  requireAuth(
      Buffer.byteLength(json, "utf8") <= MAX_CANONICAL_BYTES,
      "payload_too_large",
      "Canonical payload is too large.",
      400,
  );
  return json;
}

function canonicalValue(value, depth) {
  requireAuth(
      depth <= MAX_CANONICAL_DEPTH,
      "payload_too_deep",
      "Canonical payload is too deep.",
      400,
  );
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    requireAuth(
        Number.isFinite(value),
        "invalid_payload",
        "Numbers must be finite.",
        400,
    );
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    requireAuth(
        value.length <= MAX_CANONICAL_ITEMS,
        "invalid_payload",
        "Canonical array has too many items.",
        400,
    );
    return `[${value.map((item) => canonicalValue(item, depth + 1)).join(",")}]`;
  }
  requireAuth(
      value &&
        typeof value === "object" &&
        (Object.getPrototypeOf(value) === Object.prototype ||
          Object.getPrototypeOf(value) === null),
      "invalid_payload",
      "Canonical payload contains an unsupported value.",
      400,
  );
  const keys = Object.keys(value).sort();
  requireAuth(
      keys.length <= MAX_CANONICAL_ITEMS,
      "invalid_payload",
      "Canonical object has too many fields.",
      400,
  );
  const fields = keys.map((key) => {
    requireAuth(
        value[key] !== undefined,
        "invalid_payload",
        "Canonical payload cannot contain undefined.",
        400,
    );
    return `${JSON.stringify(key)}:${canonicalValue(value[key], depth + 1)}`;
  });
  return `{${fields.join(",")}}`;
}

function digestCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

function normalizePublicKeySpki(value) {
  requireAuth(
      typeof value === "string" &&
        value.length >= 40 &&
        value.length <= 256 &&
        BASE64URL_PATTERN.test(value),
      "invalid_public_key",
      "Invalid device public key.",
      400,
  );
  const der = Buffer.from(value, "base64url");
  requireAuth(
      der.toString("base64url") === value,
      "invalid_public_key",
      "Device public key is not canonical.",
      400,
  );
  let key;
  try {
    key = createPublicKey({key: der, format: "der", type: "spki"});
  } catch {
    throw authError(
        "invalid_public_key",
        "Device public key could not be read.",
        400,
    );
  }
  requireAuth(
      key.asymmetricKeyType === "ed25519",
      "invalid_public_key",
      "Device keys must use Ed25519.",
      400,
  );
  const canonicalDer = key.export({format: "der", type: "spki"});
  requireAuth(
      Buffer.isBuffer(canonicalDer) && canonicalDer.equals(der),
      "invalid_public_key",
      "Device public key encoding is not canonical.",
      400,
  );
  return {key, der};
}

function deviceIdentityForPublicKey(publicKeySpki) {
  const {der} = normalizePublicKeySpki(publicKeySpki);
  const digest = createHash("sha256").update(der).digest();
  return {
    deviceId: `dev_${digest.toString("hex").slice(0, 32)}`,
    publicKeyFingerprint: `sha256:${digest.toString("base64url")}`,
    publicKeySpki: der.toString("base64url"),
  };
}

function exportPublicKeySpki(publicKey) {
  let key;
  try {
    key = publicKey?.type === "public" && typeof publicKey.export === "function" ?
      publicKey :
      createPublicKey(publicKey);
  } catch {
    throw authError(
        "invalid_public_key",
        "Device public key could not be read.",
        400,
    );
  }
  requireAuth(
      key.asymmetricKeyType === "ed25519",
      "invalid_public_key",
      "Device keys must use Ed25519.",
      400,
  );
  const der = key.export({format: "der", type: "spki"});
  return Buffer.from(der).toString("base64url");
}

function normalizePrivateKey(privateKey) {
  let key;
  try {
    key = privateKey?.type === "private" &&
      typeof privateKey.export === "function" ?
      privateKey :
      createPrivateKey(privateKey);
  } catch {
    throw authError(
        "invalid_private_key",
        "Device private key could not be read.",
        400,
    );
  }
  requireAuth(
      key.asymmetricKeyType === "ed25519",
      "invalid_private_key",
      "Device keys must use Ed25519.",
      400,
  );
  return key;
}

function normalizeAction(value) {
  requireAuth(
      typeof value === "string" && ACTION_PATTERN.test(value),
      "invalid_envelope",
      "Invalid device action.",
      400,
  );
  return value;
}

function finiteInteger(value, field) {
  requireAuth(
      Number.isSafeInteger(value) && value >= 0,
      "invalid_envelope",
      `${field} must be a non-negative safe integer.`,
      400,
  );
  return value;
}

function unsignedEnvelope(input) {
  requireAuth(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_envelope",
      "Device request envelope is required.",
      400,
  );
  const protocolVersion = finiteInteger(input.protocolVersion, "protocolVersion");
  requireAuth(
      protocolVersion === AUTH_VERSION,
      "unsupported_version",
      "Unsupported Fleet authentication version.",
      400,
  );
  const deviceId = String(input.deviceId || "");
  const requestId = String(input.requestId || "");
  requireAuth(
      DEVICE_ID_PATTERN.test(deviceId),
      "invalid_envelope",
      "Invalid device id.",
      400,
  );
  requireAuth(
      REQUEST_ID_PATTERN.test(requestId),
      "invalid_envelope",
      "Invalid request id.",
      400,
  );
  const action = normalizeAction(input.action);
  const issuedAt = finiteInteger(input.issuedAt, "issuedAt");
  const expiresAt = finiteInteger(input.expiresAt, "expiresAt");
  requireAuth(
      expiresAt > issuedAt && expiresAt - issuedAt <= MAX_LIFETIME_MS,
      "invalid_envelope",
      "Invalid device request lifetime.",
      400,
  );
  const payloadDigest = String(input.payloadDigest || "");
  requireAuth(
      payloadDigest.length === 43 && BASE64URL_PATTERN.test(payloadDigest),
      "invalid_envelope",
      "Invalid payload digest.",
      400,
  );
  return {
    protocolVersion,
    deviceId,
    requestId,
    action,
    issuedAt,
    expiresAt,
    payloadDigest,
  };
}

function createSignedDeviceRequest({
  privateKey,
  deviceId,
  action,
  payload,
  issuedAt = Date.now(),
  expiresAt = issuedAt + 60_000,
  requestId = `req_${randomBytes(16).toString("hex")}`,
}) {
  const unsigned = unsignedEnvelope({
    protocolVersion: AUTH_VERSION,
    deviceId,
    requestId,
    action,
    issuedAt,
    expiresAt,
    payloadDigest: digestCanonical(payload),
  });
  const signature = sign(
      null,
      Buffer.from(canonicalJson(unsigned)),
      normalizePrivateKey(privateKey),
  );
  return {...unsigned, signature: signature.toString("base64url")};
}

function unsignedDeviceResponse(input) {
  requireAuth(
      input && typeof input === "object" && !Array.isArray(input),
      "invalid_response_envelope",
      "Device response envelope is required.",
      400,
  );
  const protocolVersion = finiteInteger(input.protocolVersion, "protocolVersion");
  const keyId = String(input.keyId || "");
  const deviceId = String(input.deviceId || "");
  const requestId = String(input.requestId || "");
  const action = normalizeAction(input.action);
  const issuedAt = finiteInteger(input.issuedAt, "issuedAt");
  const expiresAt = finiteInteger(input.expiresAt, "expiresAt");
  const resultDigest = String(input.resultDigest || "");
  requireAuth(
      protocolVersion === AUTH_VERSION &&
        RESPONSE_KEY_ID_PATTERN.test(keyId) &&
        DEVICE_ID_PATTERN.test(deviceId) &&
        REQUEST_ID_PATTERN.test(requestId) &&
        expiresAt > issuedAt &&
        expiresAt - issuedAt <= MAX_LIFETIME_MS &&
        resultDigest.length === 43 &&
        BASE64URL_PATTERN.test(resultDigest),
      "invalid_response_envelope",
      "Device response envelope is invalid.",
      400,
  );
  return {
    protocolVersion,
    keyId,
    deviceId,
    requestId,
    action,
    issuedAt,
    expiresAt,
    resultDigest,
  };
}

function responseSigningPayload(unsigned) {
  return {
    domain: "statskey.fleet.response.v1",
    ...unsigned,
  };
}

function createSignedDeviceResponse({
  privateKey,
  keyId,
  deviceId,
  requestId,
  action,
  result,
  issuedAt = Date.now(),
  expiresAt = issuedAt + 60_000,
}) {
  const unsigned = unsignedDeviceResponse({
    protocolVersion: AUTH_VERSION,
    keyId,
    deviceId,
    requestId,
    action,
    issuedAt,
    expiresAt,
    resultDigest: digestCanonical(result),
  });
  const signature = sign(
      null,
      Buffer.from(canonicalJson(responseSigningPayload(unsigned))),
      normalizePrivateKey(privateKey),
  );
  return {...unsigned, signature: signature.toString("base64url")};
}

function verifySignedDeviceResponse({
  publicKeySpki,
  envelope,
  deviceId,
  requestId,
  action,
  result,
  keyId,
  now = Date.now(),
}) {
  const unsigned = unsignedDeviceResponse(envelope);
  const current = finiteInteger(now, "now");
  requireAuth(
      unsigned.keyId === keyId &&
        unsigned.deviceId === deviceId &&
        unsigned.requestId === requestId &&
        unsigned.action === normalizeAction(action) &&
        unsigned.issuedAt <= current + MAX_CLOCK_SKEW_MS &&
        unsigned.expiresAt > current &&
        safeTextEqual(unsigned.resultDigest, digestCanonical(result)),
      "response_mismatch",
      "Coordinator response does not match this request.",
  );
  const signatureText = String(envelope?.signature || "");
  requireAuth(
      signatureText.length >= 80 &&
        signatureText.length <= 100 &&
        BASE64URL_PATTERN.test(signatureText),
      "invalid_response_signature",
      "Coordinator response signature is invalid.",
  );
  const signature = Buffer.from(signatureText, "base64url");
  requireAuth(
      signature.toString("base64url") === signatureText &&
        verify(
            null,
            Buffer.from(canonicalJson(responseSigningPayload(unsigned))),
            normalizePublicKeySpki(publicKeySpki).key,
            signature,
        ),
      "invalid_response_signature",
      "Coordinator response signature is not valid.",
  );
  return unsigned;
}

function verifySignedDeviceRequest({
  publicKeySpki,
  envelope,
  payload,
  expectedAction,
  now = Date.now(),
}) {
  const unsigned = unsignedEnvelope(envelope);
  requireAuth(
      unsigned.action === normalizeAction(expectedAction),
      "action_mismatch",
      "Device request action does not match.",
  );
  const current = finiteInteger(now, "now");
  requireAuth(
      unsigned.issuedAt <= current + MAX_CLOCK_SKEW_MS &&
        unsigned.expiresAt > current,
      "expired_request",
      "Device request is expired or not yet valid.",
  );
  requireAuth(
      safeTextEqual(unsigned.payloadDigest, digestCanonical(payload)),
      "payload_mismatch",
      "Device request payload does not match its signature.",
  );
  const identity = deviceIdentityForPublicKey(publicKeySpki);
  requireAuth(
      identity.deviceId === unsigned.deviceId,
      "device_mismatch",
      "Device key does not match the request identity.",
  );
  const signatureText = String(envelope?.signature || "");
  requireAuth(
      signatureText.length >= 80 &&
        signatureText.length <= 100 &&
        BASE64URL_PATTERN.test(signatureText),
      "invalid_signature",
      "Invalid device request signature.",
  );
  const signature = Buffer.from(signatureText, "base64url");
  requireAuth(
      signature.toString("base64url") === signatureText &&
        verify(
            null,
            Buffer.from(canonicalJson(unsigned)),
            normalizePublicKeySpki(publicKeySpki).key,
            signature,
        ),
      "invalid_signature",
      "Device request signature is not valid.",
  );
  return {
    ...identity,
    requestId: unsigned.requestId,
    action: unsigned.action,
    issuedAt: unsigned.issuedAt,
    expiresAt: unsigned.expiresAt,
    replayId: createHash("sha256")
        .update(`${unsigned.deviceId}\0${unsigned.requestId}`)
        .digest("hex"),
  };
}

function safeTextEqual(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

module.exports = {
  ACTION_PATTERN,
  AUTH_VERSION,
  DEVICE_ID_PATTERN,
  MAX_CLOCK_SKEW_MS,
  MAX_LIFETIME_MS,
  REQUEST_ID_PATTERN,
  authError,
  canonicalJson,
  createSignedDeviceResponse,
  createSignedDeviceRequest,
  deviceIdentityForPublicKey,
  digestCanonical,
  exportPublicKeySpki,
  normalizePublicKeySpki,
  verifySignedDeviceResponse,
  verifySignedDeviceRequest,
};
