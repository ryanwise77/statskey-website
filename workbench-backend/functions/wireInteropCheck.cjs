#!/usr/bin/env node
// Cross-runtime wire interop check: verifies Go-signed receipts with the
// coordinator's fleetHelperProtocol, then produces a coordinator-signed
// ExecutionTicketV1 for the Go daemon to verify. Usage:
//   node wireInteropCheck.cjs <go-emit.json> <ticket-out.json> <spki-out.txt>
"use strict";
const {generateKeyPairSync, sign} = require("node:crypto");
const {readFileSync, writeFileSync} = require("node:fs");
const fleetAuth = require("./fleetAuth");
const helperProtocol = require("./fleetHelperProtocol");

const [emitPath, ticketOut, spkiOut] = process.argv.slice(2);
if (!emitPath || !ticketOut || !spkiOut) {
  console.error("usage: wireInteropCheck.cjs <go-emit.json> <ticket-out> <spki-out>");
  process.exit(2);
}

const emitted = JSON.parse(readFileSync(emitPath, "utf8"));

const termination = helperProtocol.verifyTerminationReceipt(
    JSON.parse(emitted.terminationReceipt),
    emitted.helperPublicKeySpki,
);
console.log("go termination receipt verified:", termination.ticketId,
    termination.terminationReason, termination.accounting.pidsPeak);

const started = helperProtocol.verifyExecutionStartedReceipt(
    JSON.parse(emitted.startedReceipt),
    emitted.helperPublicKeySpki,
);
console.log("go started receipt verified:", started.unitName,
    started.effectiveLimits.cpuMilli);

const coordinator = generateKeyPairSync("ed25519");
const spki = fleetAuth.exportPublicKeySpki(coordinator.publicKey);
const unsignedTicket = {
  domain: "statskey.fleet.execution-ticket.v1",
  ticketId: `ticket_${"3".repeat(32)}`,
  jobRequestDigest: `sha256:${"4".repeat(64)}`,
  jobId: `job_${"5".repeat(32)}`,
  attempt: 1,
  leaseId: `lease_${"6".repeat(32)}`,
  leaseSequence: 0,
  grantReceiptDigest: `sha256:${"7".repeat(64)}`,
  ownerUid: "owner-123",
  workerDeviceId: `dev_${"2".repeat(32)}`,
  controllerDeviceId: `dev_${"8".repeat(32)}`,
  executionServiceId: `svc_${"9".repeat(32)}`,
  helperInstanceId: `hi_${"1".repeat(32)}`,
  repositoryIdentity: "github.com/statskey/website",
  commit: "a".repeat(40),
  executorProfileId: "command-v1",
  sandboxProfileId: "ubuntu-build-v1",
  networkProfileId: "none",
  command: {executable: "node", arguments: ["--version"], workingDirectory: "."},
  resources: {
    cpuMilli: 4000,
    memoryBytes: 8 * 1024 ** 3,
    pids: 256,
    diskBytes: 20 * 1024 ** 3,
    wallTimeMs: 3_600_000,
  },
  serverIssuedAt: "2026-08-19T06:30:00.000Z",
  leaseExpiresAt: "2026-08-19T06:30:45.000Z",
  jobDeadlineAt: "2026-08-19T07:30:00.000Z",
  minimumHelperProtocol: 1,
  minimumPolicyEpoch: 1,
};
const signature = sign(
    null,
    Buffer.from(fleetAuth.canonicalJson(unsignedTicket)),
    coordinator.privateKey,
).toString("base64url");
const ticket = helperProtocol.normalizeExecutionTicket({...unsignedTicket, signature});
writeFileSync(ticketOut, fleetAuth.canonicalJson(ticket));
writeFileSync(spkiOut, spki);
console.log("coordinator ticket written for go verification");
