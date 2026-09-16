# Strength and campaign website changes

The campaign URL `/download?utm_source=youtube&utm_medium=paid_video&utm_campaign=youtube_ads` now serves the complete homepage with an inviting campaign headline and store choices. `scripts/build-download-page.mjs` regenerates the page from `index.html` on development/build, keeping the two versions aligned. The rejected "Your day, connected" screenshot directory has been removed; the Olympic marathon experiment and its existing connected record occupy that position.

## Campaign measurement

The homepage and campaign page record consented anonymous visit events to `recordCampaignJourney`. The founder report is `/app/campaigns`, using `getCampaignJourney` with a Firebase ID token and founder authorization on the server. It shows source/medium/campaign/creative, daily visit totals, public section views, scroll milestones, video progress, visible engagement time, and ordered click paths. Store handoffs are joined by the same SHA-256 visit identifier as the existing download collector.

No private app screens, account identity, form input, health-record contents, screen recordings, or pointer recording are collected. Declining analytics leaves direct, attributed store links working; privacy signals override saved allowance. Google Ads and Reddit pixels on these two pages load after allowance. No new Meta/TikTok pixel account IDs or Google conversion labels have been invented. Creative dimensions are recorded in the visit trail; the existing store redirect collector still forwards source/campaign rather than creative dimensions to the stores.

Events are best-effort browser measurements, not exhaustive observation or confirmed installs. The report clearly distinguishes store clicks from acquisitions and does not present declined/blocked traffic as zero visitors. Routine no-JavaScript navigation/store links still work.

## Strength training

The authenticated web strength workspace now includes the native 138-exercise catalogue, persistent custom exercises, routines with supersets and prescription targets, recurring weeks and dated overrides, saved-workout corrections, and exercise progress/records. These use the existing native Firestore collections and iOS edit masks, preserving sensor values when a user changes unrelated fields. Transactions reject stale or deleted edits. Measured effort stays separate from planned effort; assistance/bodyweight semantics do not create misleading load records.

Sharing and workout-video controls use browser capability checks with open/download fallbacks. Layouts support narrow phones, tablets, and desktop widths. Native background recording, Watch/Wear OS sensors, machine scan, and energy/linked-activity behavior are not claimed as browser parity. Device compatibility means the tested layouts and graceful capability handling, not certification of every physical device.

## Backend release

Only `recordCampaignJourney` and `getCampaignJourney` were deployed from an isolated source bundle. Backend checks passed 12 tests and live checks for deduplication, origin/auth enforcement, ordered reporting, and store-handoff correlation. All nine retention TTL policies are ACTIVE; reports also exclude expired data before physical cleanup. Founder authorization is covered by tests; a signed-in founder browser session was not available for production end-to-end verification.

## Verification

- Production Vite build and existing deployment bundle checks passed.
- 48 strength tests passed, covering native data compatibility, exercise catalogue and custom records, routine/planner behavior, optimistic editing, accurate progress, and media capability fallbacks.
- 21 campaign/attribution tests passed, covering consent, privacy preference, private-screen exclusion, event ordering, stable retry IDs, storage restrictions, attribution preservation, and full-site generation.
- 15 legal-language/founder tests and 8 nudge-author/founder tests passed.
- In-app browser visual checks at 320, 390, 768, 1024, and 1280 pixels. Saved-workout editor checked at 320/360/1280, including load meanings, set add/remove, corrections, catalogue alias search, and custom-exercise form. Fixed a tablet-width overflow in the download CTA; checked document width equals viewport after correction.
- Full repository TypeScript remains affected by pre-existing missing Vitest declarations in unrelated test files. Production-source TypeScript is checked separately.

Native Android implementation/build evidence and isolated analytics backend verification are recorded under `/Users/ryansullivan/Projects/outputs/strength-cross-device-20260915`.

## Social landing refinement

The shared landing page for YouTube, Reddit, TikTok, Meta, and Google Search now leads with nutrition and training, two real app previews, and direct iPhone/Android store choices. The marathon experiment is below the main app content on both the homepage and campaign page, with its existing IDs and connected record preserved. Desktop download promotions were removed from homepage, generated campaign page, and network navigation; the desktop route remains available for existing direct links. Existing campaign names, attribution, consent handling, and reporting endpoints are unchanged.

Follow-up validation: campaign/attribution checks passed for all five sources. Browser checks at 320, 390, and 768px found no horizontal overflow, no desktop links, and both hero store choices near the top. The desktop layout was visually reviewed at the default 1280px width.
