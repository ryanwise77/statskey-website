# Ubuntu release contract

Verified for the initial Linux target on August 19, 2026.

## Supported target

- Distribution: Ubuntu 26.04 LTS
- Architecture: amd64 (`x64` in Node and Electron)
- Package: Debian package (`.deb`)
- Update channel: `linux-x64`
- Update metadata: `latest-linux.yml`
- Installed executable: `/opt/StatsKey/statskey`
- Desktop package name: `statskey-desktop`

Other Linux distributions, AppImage, Snap, Flatpak, and arm64 are not part of
this contract. They must not be inferred from Electron's generic Linux support.

## Current release status

The Ubuntu package is an explicitly unsigned preview. The public page and
release manifest must say so. Automatic updates are disabled in the Ubuntu
client; users install a newer DEB manually from the StatsKey download page.
Do not turn on `electron-updater` for Linux until final DEB bytes are verified
against a release key pinned independently of mutable update metadata.

The package can:

- run the local StatsKey workspace;
- open, edit, search, build, and test approved local projects;
- use the controlled browser and approved Android tooling;
- store credentials only when Electron reports GNOME Keyring/libsecret or
  KWallet; the `basic_text` backend is refused;
- pair devices and act as a Fleet controller.

The package cannot:

- run unattended Fleet jobs;
- silently install an update;
- claim package signing or OS-native repository trust;
- claim support for a Linux distribution or architecture not listed above.

Unattended Fleet execution stays disabled until a separately privileged
service launches each job under a distinct principal, owns a non-delegated
cgroup v2 scope, enforces monotonic lease deadlines, and supplies coordinator-
verifiable service attestation.

That service must be a separately signed, optional `statskey-worker-service`
DEB with an independently trusted APT path. The unsigned desktop preview must
never install or update root code. A same-user systemd scope is useful for
cleanup and quotas but is not an adversarial boundary because jobs share the
desktop user's files, keyring, user bus, and delegated cgroup subtree.

The minimum worker architecture has three principals: an unprivileged
`statskey-fleet-agent` for coordinator transport, a small root
`statskey-fleetd` with no network access, and a fresh systemd `DynamicUser` for
each job. The root service may accept only coordinator-signed typed execution
tickets and start one fixed root-owned runner after containment is installed.
It must never expose the current POSIX process-owner request—which contains a
caller-selected executable, arguments, and paths—as a privileged interface.
Repository checkout and every repository-controlled process run only as the
per-job user inside the non-delegated cgroup.

## Build

A local cross-build is useful for checking package construction, but it is not
release proof:

```bash
npm run build:desktop:linux:x64
```

Release preparation must run from a clean, detached snapshot of the retained
release commit on native Ubuntu 26.04 LTS amd64:

```bash
npm run release:desktop:prepare:linux-preview -- \
  --source-snapshot /path/to/exact-private-source
```

The guarded preparation:

1. reinstalls both dependency trees from committed lockfiles;
2. runs release, website, and full desktop tests;
3. builds the web client and x64 DEB without rebuilding the audited `node-pty`
   prebuild;
4. runs the public release boundary against `linux-unpacked/resources`;
5. checks the ELF executable, `package-type`, exact reviewed AppArmor profile,
   desktop entry, icon, DEB control fields (including the Ubuntu 26.04
   `libasound2t64` dependency), and the sole retained x86-64 `node-pty`
   prebuild;
6. writes `linux-native-verification.json`, binding the Ubuntu version, source
   commit, DEB bytes, update metadata, package metadata, and checks;
7. writes the release manifest only after those checks pass.

The release record is evidence, not a digital package signature.

## Native package smoke

The package smoke is destructive to its test guest: it installs the DEB and
test-only APT dependencies and creates a `statskeytest` user. Run it only as
root inside a disposable Ubuntu 26.04 amd64 machine:

```bash
bash desktop/ubuntu-container-smoke.sh \
  desktop/release/StatsKey-0.21.8-linux-x64.deb \
  0.21.8
```

It verifies the DEB control and content contract, installs through APT, proves
that Chromium has either a working unprivileged-user-namespace sandbox or its
root-owned setuid fallback, runs the packaged x86-64 `node-pty` binding, starts
the app without `--no-sandbox`, verifies the canonical `localhost` health
response and disabled Linux update feed, then confirms process-group teardown.

Electron's packaged AppArmor profile is pinned and checked during this smoke.
It is intentionally `flags=(unconfined)` with a `userns` grant so Chromium's
sandbox can work under Ubuntu mediation; it is not StatsKey application
confinement and must never be described as one.

This smoke passed on August 19, 2026 in a full Ubuntu 26.04 amd64 VM. A
foreign-architecture Docker container on Apple silicon is not native evidence:
user-mode emulation rejects Chromium `clone` and PTY operations with `EINVAL`.
The same VM also removed the package through APT and verified that `/opt/StatsKey`,
the desktop entry, and the alternatives link were removed.

## Publish

Publishing is a separate, explicit action and may reuse only the exact
proof-bound output:

```bash
npm run release:desktop:publish:linux-preview -- \
  --source-snapshot /path/to/exact-private-source
```

Publication uploads immutable DEB and verification objects first, verifies
their bytes and headers, uploads the release manifest, and changes
`latest-linux.yml` last. A DEB has no external blockmap, so the Linux target
must not inherit the Mac/Windows sidecar requirement.

Before publishing, the same version must already be present on the public
download page and in `updates.json` with:

- platform `Linux`;
- `linuxSigning: "unsigned-preview"`;
- an Ubuntu 26.04 x64 download;
- an explicit unsigned-package warning;
- manual-update and Fleet-worker limitations.

## Native GUI acceptance still required

The headless package smoke does not replace interaction and keyring testing.
Before changing Ubuntu from preview to shipped, exercise the installed package
on a normal GNOME 50/Wayland session:

- upgrade over an earlier Ubuntu preview and repeat the APT uninstall;
- launch twice without `--no-sandbox`;
- verify the loopback health endpoint and renderer handshake;
- run a real `node-pty` command with `SHELL` unset;
- persist and reopen a workspace;
- verify Git and controlled-browser behavior;
- save and reopen a test credential through an unlocked GNOME Keyring;
- verify refusal with a locked/missing keyring and with `basic_text`;
- verify AppArmor profile installation;
- confirm that no Fleet worker poll or executable capability is emitted;
- reject a tampered DEB and a stale native-verification record.
