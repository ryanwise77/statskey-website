# StatsKey Desktop

Secure Electron shell for the existing StatsKey web application on macOS,
Windows, and the Ubuntu 26.04 LTS x64 preview. Production packages contain the
compiled StatsKey client and serve it from a private loopback-only HTTP server,
so the downloadable app does not depend on deploying its interface to
`statskey.ai`. Firebase-backed account data and consent-gated Assistant actions
still use the shared secured backend.

## Develop

```bash
npm install
npm run build:web
npm start
```

Use a local or staging web client without changing the packaged default:

```bash
STATSKEY_DESKTOP_URL=http://localhost:5173/app npm start
```

## Package

```bash
npm run pack
npm run dist
```

Artifacts are written to `release/`. `npm run dist` builds for the current
host platform. Produce macOS and Windows installers on their native CI runners
so each artifact can be signed correctly. The Ubuntu preview is an explicit x64
DEB and must receive native Ubuntu 26.04 release proof.

Private architecture-specific builds:

```bash
npx electron-builder --mac --arm64
npx electron-builder --mac --x64
npx electron-builder --win nsis --x64
npm run build:linux:x64
```

## Client updates

Supported signed desktop channels check the architecture-specific StatsKey
update feed after startup and every six hours. Checks are quiet. An available
update appears as a small in-app notice and downloads quietly in the
background. The unsigned Ubuntu preview fails closed to manual DEB updates from
the StatsKey download page and never raises an administrator prompt on ordinary
app exit.

The application menu and desktop settings area both include **Check for
Updates**. Versions older than 0.8.0 require one final manual installation to
bootstrap the updater.

Prepare the next version and public website metadata from the repository root:

```bash
npm run release:desktop:prepare -- \
  --version 0.21.8 \
  --platform mac \
  --title "Plain-language release title" \
  --summary "One concise public summary." \
  --highlight "First user-visible improvement." \
  --highlight "Second user-visible improvement."
```

This updates the desktop package, lockfile, website download links, and public
release history together while preserving the other platform's active version.
For an explicitly disclosed unsigned Windows preview, use the same command with
`--platform windows --preview`. For Ubuntu 26.04 x64, use `--platform linux
--preview`. Review and commit the release, retain that exact desktop source
commit in the private release repository, then deploy the public website
metadata before publishing a client update.

For a native-architecture local build, install, launch, and verification:

```bash
npm run release:desktop:local
```

For the complete public Mac release:

```bash
git remote add private-source \
  https://github.com/ryanwise77/statskeyapp2.0.git
npm run release:desktop:ship -- \
  --release-source-remote private-source \
  --release-source-ref refs/heads/release/desktop-0.21.9
```

The source remote and retained full branch ref are required for publication.
They may instead be configured with `STATSKEY_RELEASE_SOURCE_REMOTE` and
`STATSKEY_RELEASE_SOURCE_REF`. The repository contract defaults to the private
`ryanwise77/statskeyapp2.0` repository; an intentional migration must set
`--release-source-repository owner/name` (or
`STATSKEY_RELEASE_SOURCE_REPOSITORY`) and the configured remote URL must match it
exactly. The release commit may equal the retained branch tip or be an ancestor
of it. The standard `git remote get-url <name>` form reads the fetch URL and
keeps the provenance check compatible with Apple Git. Public website deployment
is checked independently and must expose the exact release history and all
expected Mac version and download markers.

`--allow-unpushed` is not a normal release path. An emergency use also requires
`--emergency-release-reason "..."` and still cannot bypass the exact live
website checks.

The guarded Mac workflow:

1. Creates a clean detached snapshot of the exact release commit.
2. Confirms that commit is reachable from the configured retained branch in
   the exact private release-source repository.
3. Confirms that the exact update history and all five Mac download-page
   markers are live before changing the client feed.
4. Verifies Apple and Google Cloud credentials, then installs dependencies and
   runs the focused release, helper-model, and response-generation tests.
5. Builds, signs, notarizes, and validates both Mac architectures once.
6. Uses checksum-validated resumable uploads with bounded retry and recovery.
7. Publishes updater metadata only after every immutable object is verified.
8. Downloads the public manifest and matching native DMG, verifies those bytes,
   and atomically installs that downloaded artifact.
9. Launches the app and keeps the rollback copy until the running bundle,
   loopback server, renderer handshake, update feed, signature, Gatekeeper
   acceptance, and notarization all pass verification.

If publication has already succeeded but local installation was interrupted,
reuse the pinned output without rebuilding or republishing. The command
compares the pinned manifest with the public manifest and downloads the public
DMG again before installation:

```bash
npm run release:desktop:install -- \
  --source-snapshot /path/to/pinned-release-snapshot
```

Windows packages must be created and deeply exercised on the private native
Windows runner. Dispatch `Windows native desktop smoke` against the retained
release branch with `require_authenticode=false` only for a visibly disclosed
unsigned preview. After downloading its complete release-tree artifact into an
exact detached checkout of that same commit, publish the proof-bound bytes with:

```bash
npm run release:desktop:publish:windows-preview -- \
  --source-snapshot /path/to/exact-private-source
```

Ubuntu packages must be prepared on native Ubuntu 26.04 LTS amd64 from the same
kind of clean retained source snapshot:

```bash
npm run release:desktop:prepare:linux-preview -- \
  --source-snapshot /path/to/exact-private-source
npm run release:desktop:publish:linux-preview -- \
  --source-snapshot /path/to/exact-private-source
```

The first command runs the full desktop suite, builds and inspects the DEB, and
binds `linux-native-verification.json` to the source commit, package bytes,
update metadata, Ubuntu version, and package contents. The second command only
reuses those proof-bound bytes. This evidence does not make the DEB signed.
The destructive `ubuntu-container-smoke.sh` helper installs and exercises the
DEB only inside a disposable Ubuntu 26.04 amd64 guest. See
`UBUNTU_RELEASE.md` for the complete contract and native acceptance list.

Architecture feeds live under:

```text
updates/mac-arm64/
updates/mac-x64/
updates/win-x64/
updates/linux-x64/
```

For explicitly labeled internal previews only, the certificate gate can be
bypassed with `npm run publish:update:preview`. Preview builds must retain the
warning on the download page and are not substitutes for distribution signing.

## Public macOS release

Website downloads must use a **Developer ID Application** certificate plus
Apple notarization. An Apple Development certificate is not valid for public
distribution and Gatekeeper will reject it.

One-time setup:

1. In Xcode, open **Settings → Accounts**, select team `QSKTTJ7A2W`, choose
   **Manage Certificates**, then add **Developer ID Application**.
2. Create an app-specific password for the Apple ID, then store it in Keychain
   without putting it in this repository or shell history:

```bash
xcrun notarytool store-credentials "StatsKeyNotary" \
  --apple-id "<your developer Apple ID>" \
  --team-id "QSKTTJ7A2W"
```

`notarytool` prompts securely for the app-specific password. The guarded
release commands automatically use configured API-key credentials or the
`StatsKeyNotary` Keychain profile. Run the complete workflow from the repository
root:

```bash
npm run release:desktop:ship -- \
  --release-source-remote private-source \
  --release-source-ref refs/heads/release/desktop-0.21.9
```

The release command refuses to run without a Developer ID identity and
notarization credentials. It also verifies the final signature, Gatekeeper
acceptance, and stapled notarization ticket before reporting success.

## Security boundary

- Renderer pages have no Node.js access.
- Bundled files are served only on `localhost` with host validation, no CORS,
  frame denial, path containment, and strict static-file routing.
- Context isolation, Chromium sandboxing, and web security remain enabled.
- Main-window navigation is restricted to the StatsKey application.
- External links open in the system browser.
- Identity-provider popups are isolated and restricted to allowlisted origins.
- The preload bridge exposes only platform metadata, retry, and desktop
  protocol callbacks.

Windows artifacts still require a separate trusted Windows code-signing
certificate. Apple Developer credentials cannot sign Windows installers.
Ubuntu remains an unsigned preview until a separately provisioned release key
or signed APT repository establishes package authenticity. Protected local
credentials additionally require GNOME Keyring/libsecret or KWallet; Electron's
Linux `basic_text` backend is refused.

## Fleet worker checkpoint

The current Fleet supervisor runs inside the StatsKey Desktop process. Pairing,
grants, signed HTTPS transport, heartbeat/poll/claim, leases, cancellation,
restart recovery for expired local leases, Xcode adapters, and allowlisted
command adapters are implemented. Keep the app process running for the node to
remain available; this is not yet the planned Windows service or macOS daemon.
Windows development verification runs jobs under the native Job Object owner
and authenticated lease fence. Because that owner still shares a security token
with its workload, packaged Windows builds advertise no executable Fleet
capabilities until a separately privileged signed service owns the Job Object.
Packaged macOS workers are also disabled because process groups cannot contain
descendants that create new sessions. Ubuntu is explicitly controller-only:
the main process does not start its worker supervisor, advertise executable
capabilities, or poll for work. Enabling Ubuntu jobs requires an attested,
privileged cgroup service with a distinct workload principal; a process group or
cgroup alone is not treated as a complete isolation boundary.

Production device traffic is pinned to the Workbench device endpoint.
Enrollment additionally pins an account-authenticated Ed25519 coordinator key;
every response must verify against that key and the exact signed request ID. A
401 response, or a device-authority 403 from heartbeat/poll, pauses the local
supervisor until the identity is replaced or reenrolled. Transient startup
outages retry with bounded exponential backoff, while definitive lease-renewal
denials stop the active process immediately. A
development/staging endpoint must also be supplied to the trusted main process:

```bash
VITE_FLEET_DEVICE_API_URL=https://staging.example/device \
STATSKEY_FLEET_DEVICE_ENDPOINT=https://staging.example/device \
npm start
```

Git snapshots accept only `github.com` and `origin.cursor.com`. Program names
remain explicit operator configuration:

```bash
STATSKEY_FLEET_ALLOWED_EXECUTABLES=node,dotnet \
npm start
```

Configured programs are advertised as worker capabilities only when StatsKey
finds the executable on its launch `PATH`; Xcode capabilities additionally
require `xcodebuild` and `ditto`, and every current exact-snapshot adapter
requires `git`.
The supervisor pins each discovered executable's real path for its lifetime
instead of resolving the name again when a job starts. Launching the app from
Finder may provide a narrower `PATH` than an interactive shell.

Command jobs run without a shell, use exact argument arrays, and strip provider
credentials from their environment. Xcode, packaging, and command processes get
per-assignment home, temp, config, and cache directories inside the disposable
workspace. Snapshot materialization uses the same isolated directories and may
receive only the operator's SSH agent socket. System and user Git configuration,
credential helpers, URL rewrites, and HTTP redirects are disabled; provider
tokens and ambient home/config directories are not forwarded. Processes still
run as the signed-in OS user and an executable can
address other absolute paths, so use a dedicated low-privilege worker account
until container/service isolation is implemented.

Each assignment receives a fresh exact-snapshot directory keyed by job and
lease. The supervisor removes that directory after success, failure, or
cancellation; partial Git preparation is removed immediately, and a later job
prunes abandoned assignment directories older than 24 hours. Before cleanup,
successful Xcode work packages and publishes its result bundle; archive jobs
also publish the `.xcarchive`. Artifacts are capped at 1 GiB. Thirty-minute
upload grants pin the exact byte length, GCS-verified MD5, worker-reported
SHA-256 metadata, media type, and generation-zero precondition, and commit
rechecks the active lease and grant. This fails closed until the backend's
dedicated `FLEET_ARTIFACT_BUCKET` and response-signing key have been provisioned
and configured. Dedicated runtime service accounts need only their documented
object and V4 URL-signing permissions. Expired incomplete uploads and stale
deletion leases are swept safely; committed evidence expires after 30 days.
Desktop evidence downloads are validated again in the main process before
Electron starts the transfer.
