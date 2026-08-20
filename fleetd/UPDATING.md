# Updating StatsKey without interrupting service

Applies to the whole fleet: the Ubuntu worker service (`statskey-fleetd`),
the Windows worker (StatsKey Desktop, development mode), the Mac controller
(StatsKey Desktop), and the coordinator (Cloud Functions).

The control plane makes updates safe by construction: leases expire,
ambiguous outcomes fail closed instead of re-running, and the coordinator
stops assigning work to a device the moment its heartbeats stop. No update at
any tier can cause double execution or lost state. The worst case is one
in-flight job ending as `lease_expired_execution_ambiguous`, which the owner
re-runs deliberately.

## Ubuntu worker service (`statskey-fleetd` DEB)

The package is designed for non-disruptive updates:

1. `apt install ./statskey-fleetd_<new>.deb` (or `apt upgrade` from the
   signed APT repo once it exists).
2. `prerm` runs first: it stops the agent (no new polls/claims), stops every
   `statskey-fleet-job-*` unit, and waits — bounded, default 90s — until each
   job cgroup is empty. If a cgroup cannot drain, the upgrade aborts and the
   old version keeps running. Running jobs are never stranded.
3. The package swaps binaries; `postinst` reloads systemd, re-applies
   sysusers/tmpfiles, reloads the AppArmor profile, and re-enables (never
   force-starts) the units.
4. The agent starts, re-attests (attestations live at most 10 minutes, so a
   fresh one is always required after restart), and resumes polling.

Total service impact: the drain window. Queued work simply waits; the
coordinator does not assign new work while the device is offline.

Rules:

- Never `systemctl stop statskey-fleetd` directly to upgrade — always go
  through dpkg/apt so `prerm` drains first.
- Never edit job cgroups or `/var/lib/statskey-fleet-jobs` during an upgrade.
- Rollback is the same operation with the previous DEB; drain semantics are
  identical.
- The desktop preview package (`statskey-desktop`) never installs or updates
  this service; they upgrade independently.

## Windows worker (StatsKey Desktop, development mode)

Packaged Windows workers are intentionally disabled until the privileged
service exists, so the worker today is the dev-mode desktop app.

1. Check the Fleet UI (or `fleetListDevices`) for `activeJobs: 0` — or cancel
   remaining jobs first.
2. `git pull`, `npm ci` in `desktop/`, restart the app.
3. The supervisor re-enrolls from stored identity and resumes heartbeats.

If the app stops mid-job, the lease expires and the job fails closed as
ambiguous; it is never silently re-run. Graceful restarts (step 1) avoid even
that.

## Mac controller (StatsKey Desktop)

Controllers sign and schedule but do not execute. Update in place at any
time; in-flight approvals simply resume after restart.

## Coordinator (Cloud Functions / Firestore)

Stateless functions deploy with rolling replacement; all execution authority
lives in Firestore leases with deadlines. A deploy mid-job surfaces to a
worker at most as a retryable request failure. Deploy order for protocol
changes: indexes/TTL first, then functions, then clients.

## Verifying an update

After any worker update:

```bash
sudo bash /usr/share/statskey-fleetd/verify-install.sh   # packaged verifier
systemctl status statskey-fleet-agent --no-pager         # polling resumed
```

Then confirm in the Fleet UI that the device is online with a fresh
attestation before queueing new work.
