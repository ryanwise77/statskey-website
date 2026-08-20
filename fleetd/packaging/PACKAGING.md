# Packaging statskey-fleetd

Debian packaging for the privileged StatsKey Fleet execution service
(`fleetd/FLEETD_DESIGN.md` is the authoritative design). The package ships
the four binaries, systemd units, sysusers/tmpfiles config, the enforcing
AppArmor job profile, and the coordinator key ring + policy seeds.

Target: **Ubuntu 26.04 amd64**, systemd >= 255, kernel AppArmor enabled.

## Layout

```
packaging/
  build-deb.sh                 reproducible package builder (macOS + Linux)
  verify-install.sh            post-install verification (run on the host)
  deb/
    control                    package metadata (Version line is substituted)
    conffiles                  /etc/statskey/fleetd/*.json survive upgrades
    postinst                   sysusers, tmpfiles, AppArmor load, enable-only
    prerm                      stop agent, drain job cgroups, stop daemon
    postrm                     purge state, unload AppArmor, identity marker
  systemd/                     socket + daemon + agent units
  sysusers.d/statskey-fleet.conf
  tmpfiles.d/statskey-fleet.conf
  apparmor/statskey-fleet-job  ENFORCING profile for job units
  config/                      seed conffiles (coordinator keys, policy)
```

## Prerequisites

- Go 1.26 (only when building the binaries from source; the Go module under
  `fleetd/` is a separate workstream).
- `dpkg-deb`:
  - macOS: `brew install dpkg`
  - Debian/Ubuntu: `sudo apt-get install dpkg-dev`
- Optional, for signing: `dpkg-sig` (`brew install dpkg` / `apt-get install
  dpkg-sig`), `debsign` (`apt-get install devscripts`), `reprepro` or
  `aptly` for the APT repository, and GnuPG.

## Build

```sh
cd fleetd/packaging
./build-deb.sh                      # builds ../cmd/* for linux/amd64 itself
./build-deb.sh --bin-dir /path/to/bin   # or use prebuilt binaries
./build-deb.sh --stage-only         # assemble tree only (no dpkg-deb needed)
```

Binaries are built with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build
-trimpath -buildvcs=false -ldflags "-X build.id=$BUILD_ID"` per the design
doc. Outputs land in `dist/`:

- `statskey-fleetd_<version>_amd64.deb`
- `statskey-fleetd_<version>_amd64.deb.sha256` — package checksum (also
  printed at the end of the build)
- `statskey-fleetd_<version>_amd64.manifest.sha256` — SHA-256 of each
  installed binary; consumed by `verify-install.sh`. The daemon/runner
  hashes are the values `helperBuildId` / `runnerBuildId` must match.

Environment knobs: `PKG_VERSION` (default `0.1.0-1`), `BUILD_ID` (default
`PKG_VERSION`), `SOURCE_DATE_EPOCH` (default `1787097600`),
`GO_BUILD_LDFLAGS`.

**Reproducibility.** All archive member mtimes are pinned to
`SOURCE_DATE_EPOCH` and `dpkg-deb --build --root-owner-group` normalizes
ownership and sorts members, so identical source + toolchain + epoch yields
a byte-identical `.deb`. Verify with two clean builds and compare the
printed SHA-256.

## Signing and the APT trust path

This package is a **separately signed, optional DEB from an independently
trusted APT path** (design doc). Do not reuse the desktop preview's
repository or signing key.

1. Sign the package itself (optional but recommended for auditability):

   ```sh
   dpkg-sig --sign builder -k <FLEET_RELEASE_KEY_ID> dist/statskey-fleetd_*_amd64.deb
   ```

   (`debsign` signs `.changes` files instead; use it if the release pipeline
   produces source packages.)

2. Publish through a dedicated APT repository, e.g.
   `https://apt-fleet.statskey.com/ubuntu` (suite `noble`/`resolute` as
   appropriate), generated with `reprepro` (`SignWith:` set to the fleet
   release key) or `apt-ftparchive` + `gpg --clearsign`/`--detach-sign` to
   produce `InRelease` and `Release.gpg`. The `Release` file MUST be signed
   by the fleet release key; apt rejects the repository otherwise.

3. Hosts trust exactly this path:

   ```sh
   sudo install -m 0644 statskey-fleet-archive.gpg /usr/share/keyrings/statskey-fleet-archive.gpg
   sudo tee /etc/apt/sources.list.d/statskey-fleet.sources <<'EOF'
   Types: deb
   URIs: https://apt-fleet.statskey.com/ubuntu
   Suites: resolute
   Components: main
   Signed-By: /usr/share/keyrings/statskey-fleet-archive.gpg
   EOF
   ```

   `Signed-By` scopes the fleet key to this repository only — no global
   `apt-key` / `trusted.gpg` entries. That scoping is the "independently
   trusted APT path": compromising the desktop preview's repo or key does
   not authorize fleetd packages, and vice versa.

## Install

```sh
sudo apt update
sudo apt install statskey-fleetd
# or, from a bare .deb:
sudo dpkg -i statskey-fleetd_*_amd64.deb && sudo apt-get -f install
```

`postinst` then:

1. creates the `statskey-fleet` system user (`systemd-sysusers`),
2. creates `/var/lib/statskey-fleet{,d,-jobs}` and `/run/statskey-fleetd`
   with design-doc ownership (`systemd-tmpfiles --create`),
3. loads the enforcing AppArmor profile (`apparmor_parser -r`),
4. runs `systemctl daemon-reload`,
5. **enables but does not start** `statskey-fleetd.socket` and
   `statskey-fleet-agent.service`.

Services stay dormant until pairing and attestation succeed. Pair the
device, then verify:

```sh
sudo statskey-fleet-enroll ...        # pairing flow (see fleetd docs)
sudo systemctl start statskey-fleetd.socket statskey-fleet-agent.service
sudo ./verify-install.sh --manifest dist/statskey-fleetd_*_amd64.manifest.sha256
```

`verify-install.sh` checks binary hashes against the manifest, unit syntax
(`systemd-analyze verify`), sysusers/tmpfiles application, AppArmor
enforcing mode, socket permissions, service dormancy, and that the daemon
has no network listeners. It exits nonzero on any FAIL.

## Upgrade and the drain procedure

`apt upgrade` runs the old package's `prerm upgrade`, which:

1. stops `statskey-fleet-agent.service` (no new work can be requested),
2. stops every transient `statskey-fleet-job-*.service` and waits — bounded
   by `STATSKEY_FLEET_DRAIN_TIMEOUT` (default 90s; job units use
   `TimeoutStopSec=30`) — until each unit is inactive AND its cgroup is
   empty (`cgroup.events` `populated 0`),
3. stops `statskey-fleetd.socket`, then `statskey-fleetd.service`.

**If a job cgroup cannot be drained, `prerm` fails and the upgrade aborts.
This is intentional: running work is never stranded.** When it happens:

```sh
systemctl list-units --all 'statskey-fleet-job-*'
cat /sys/fs/cgroup/system.slice/<unit>/cgroup.procs   # who is stuck?
ps -o pid,stat,wchan:30,cmd -p <pid>                  # D-state? hung NFS?
echo 1 | sudo tee /sys/fs/cgroup/system.slice/<unit>/cgroup.kill   # last resort
```

An uninterruptible remnant that cannot be killed means the host fails the
acceptance gate: quarantine it (no new work) and reboot before retrying the
upgrade. After a successful upgrade on an enrolled host, start the units
again (or reboot); the agent re-attests before any Linux claim is enabled:

```sh
sudo systemctl start statskey-fleetd.socket statskey-fleet-agent.service
```

## Remove / purge

- `sudo apt remove statskey-fleetd` — drains and stops everything (same
  `prerm` path), removes binaries/units/profile file, unloads the AppArmor
  profile from the kernel, keeps all state.
- `sudo apt purge statskey-fleetd` — additionally removes
  `/var/lib/statskey-fleet-jobs` and `/var/lib/statskey-fleetd`, but **only
  after confirming no `statskey-fleet-job-*` units exist**; if any remain,
  state is kept and a warning is printed (drain them and purge again).
- **Device identity**: `/var/lib/statskey-fleet` (worker device key + agent
  state) survives even purge, so a reinstall re-attaches to the same device
  identity. To destroy the identity too, create the marker file first:

  ```sh
  sudo touch /etc/statskey/fleetd/.purge-identity
  sudo apt purge statskey-fleetd
  ```

- The `statskey-fleet` system user is intentionally never deleted
  (deleting UIDs risks ownership confusion on UID reuse).

## Maintainer decisions worth knowing

- **Enable vs. design-doc wording.** The design doc's build section says
  postinst "does not enable or start services"; this package *enables but
  never starts* the socket and agent so enrolled hosts come back after a
  reboot, while fresh installs stay dormant until pairing + attestation.
- **`statskey-fleet-enroll` lives in `/usr/bin`** (admin-invoked CLI); the
  daemon, agent, and runner live in `/usr/libexec` (never on PATH), all
  `root:root 0755` per the design doc.
- **AppArmor load failure in postinst warns but does not fail `configure`**
  (containers/chroots lack kernel AppArmor); the daemon fails closed at
  runtime per the acceptance gate, and `verify-install.sh` hard-fails on a
  missing/non-enforcing profile.
- **The AppArmor profile is not a conffile.** Its digest is attested
  (`apparmorProfileDigest`), so local edits must fail closed rather than
  survive upgrades. `/etc/statskey/fleetd/*.json` ARE conffiles so local
  coordinator-key pins survive.
- **AppArmor parser dependency.** On Ubuntu (checked through
  resolute/26.04) the parser binary ships in the `apparmor` package and
  there is no `apparmor-parser` package or virtual `Provides:` in the
  archive, so `deb/control` depends only on `apparmor`.
- **Workspace wildcard, not `@{JOB_ROOT}`**: AppArmor expands variables only
  at parse time, so per-job paths cannot be substituted into the loaded
  kernel profile. Per-job isolation comes from the unit's
  `ProtectSystem=strict` + `ReadWritePaths=<opaque workspace>` and DAC
  ownership; the profile's `/var/lib/statskey-fleet-jobs/*/**` wildcard is
  the coarse outer bound. See the profile's comments.
