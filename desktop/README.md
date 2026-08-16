# StatsKey Desktop

Secure Electron shell for the existing StatsKey web application on macOS and
Windows. Production packages contain the compiled StatsKey client and serve it
from a private loopback-only HTTP server, so the downloadable app does not
depend on deploying its interface to `statskey.ai`. Firebase-backed account data
and consent-gated Assistant actions still use the shared secured backend.

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
so each artifact can be signed correctly.

Private architecture-specific builds:

```bash
npx electron-builder --mac --arm64
npx electron-builder --mac --x64
npx electron-builder --win nsis --x64
npx electron-builder --win nsis --arm64
```

## Client updates

Desktop 0.8.0 and later check the architecture-specific StatsKey update feed
after startup and every six hours. Checks are quiet. An available update appears
as a small in-app notice; downloading and restarting remain explicit user
choices. A downloaded update also installs on the next normal app quit.

The application menu and desktop settings area both include **Check for
Updates**. Versions older than 0.8.0 require one final manual installation to
bootstrap the updater.

Production publishing is one guarded command:

```bash
npm run publish:update
```

The publisher:

1. Refuses a version that is not newer than every live feed.
2. Requires macOS and Windows distribution-signing prerequisites.
3. Builds the web client and all three desktop targets.
4. Validates updater metadata and SHA-512 entries.
5. Uploads immutable artifacts and block maps.
6. Publishes `latest-mac.yml` / `latest.yml` last, then verifies public access.

Architecture feeds live under:

```text
updates/mac-arm64/
updates/mac-x64/
updates/win-x64/
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

`notarytool` prompts securely for the app-specific password. Then build both
Mac architectures with the stored profile:

```bash
APPLE_KEYCHAIN_PROFILE=StatsKeyNotary npm run release:mac
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
