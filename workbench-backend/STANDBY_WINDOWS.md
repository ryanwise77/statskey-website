# Windows-server backend standby (Google redundancy)

Branch: `backend-standby-windows`. Status: phase 1 (warm standby capability).

## Goal

The Windows server (`DESKTOP-781S1U3`) must remain *capable* of serving the
StatsKey backend without Google Cloud, as a standby path. Production stays on
GCP; the Windows box is the verified fallback.

## What runs where

Production (GCP, `statskey-workbench`):

- `workbenchApi` (account API), `workbenchDeviceApi` (signed device API),
  `workbenchFleetSweep` (scheduler) — Cloud Functions Gen 2, us-central1.
- Firestore Enterprise database `workbench` (nam5).
- GCS `statskey-fleet-artifacts` (evidence) and `statskey-workbench-downloads`
  (release/update hosting).

Standby (Windows server):

- Firebase Emulator Suite runs `firestore` (127.0.0.1:8180) and `functions`
  (127.0.0.1:5199) from this exact source tree (`C:\StatsKey\website\workbench-backend`).
- Java 21 (Temurin JRE) for the Firestore emulator; Node 26 + firebase-tools
  for the functions emulator.

## Phase 1 — warm standby (this branch)

- `firebase.json` gains an `emulators` block (firestore 8180, functions 5199,
  loopback only, no emulator UI).
- On the server: `npm install` in `functions/`, then
  `npx firebase-tools@latest emulators:start --only firestore,functions --project statskey-workbench`.
- Smoke: the emulated `workbenchDeviceApi` rejects unsigned requests exactly
  like production; the emulated `workbenchApi` rejects unauthenticated calls.

## Phase 2 — data warmth

- Periodic Firestore managed export from GCP to a GCS export prefix, then
  `firebase emulators:start --import` on the Windows side after transfer.
- The export cadence and transfer path are defined here before reliance.

## Phase 3 — secret custody for real failover

- The standby cannot sign device responses without `FLEET_RESPONSE_SIGNING_KEY`
  and cannot verify StatsKey tokens without the cross-project Auth path. A real
  failover requires those secrets provisioned into the Windows credential store
  through the documented break-glass procedure — never committed, never in
  plain env files on disk longer than the failover window.

## Hard limits (honest scope)

- The emulator is API-compatible, not production-identical: no Enterprise
  TTL policies, no real IAM, no Cloud Scheduler (the sweep runs on demand),
  no GCS (artifact store preflight fails closed without a bucket shim).
- Full Google-free production parity (porting off Firestore semantics) is a
  separate, larger program. This branch keeps the capability verified and warm.
