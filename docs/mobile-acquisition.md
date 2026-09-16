# StatsKey mobile advertising links

Use these as the destination URLs in ads. All open the same **mobile-first version of the full website**, led by the app’s nutrition and training benefits, real app previews, and App Store and Google Play choices. The marathon experiment appears after the main app content. Desktop download promotions are hidden. YouTube ads use the YouTube link even when purchased through Google Ads; Google Search uses its own link. Meta combines Facebook and Instagram.

| Advertising platform | Destination | Campaign in download reports |
| --- | --- | --- |
| YouTube | https://statskey.ai/download?utm_source=youtube&utm_medium=paid_video&utm_campaign=youtube_ads | `youtube_ads` |
| Reddit | https://statskey.ai/download?utm_source=reddit&utm_medium=paid_social&utm_campaign=reddit_ads | `reddit_ads` |
| TikTok | https://statskey.ai/download?utm_source=tiktok&utm_medium=paid_social&utm_campaign=tiktok_ads | `tiktok_ads` |
| Meta (Facebook + Instagram) | https://statskey.ai/download?utm_source=meta&utm_medium=paid_social&utm_campaign=meta_ads | `meta_ads` |
| Google Search | https://statskey.ai/download?utm_source=google&utm_medium=cpc&utm_campaign=google_ads | `google_ads` |

## Where to see downloads

**iPhone/iPad:** Open [App Store Connect](https://appstoreconnect.apple.com/) → StatsKey → Analytics → Acquisition → Campaigns. Compare **First-Time Downloads** for the five campaign names above over the same date range. Apple attributes a qualifying first-time download within 24 hours of clicking the tagged store link. Campaign reporting needs at least five first-time users and at least 24 hours; individual metrics have minimum thresholds. Missing rows are unknown, not zero. [Apple's campaign reporting documentation](https://developer.apple.com/help/app-store-connect-analytics/acquisition/campaign-links).

**Android:** In [Google Play Console](https://play.google.com/console/), use StatsKey's downloadable **store performance → traffic source** report, group by **UTM source / UTM campaign**, and compare **Store listing acquisitions**. The exported columns include those dimensions and acquisition counts. [Google's downloadable report documentation](https://support.google.com/googleplay/android-developer/answer/6135870?hl=en).

Google's on-screen Store performance → Conversion analysis now emphasizes **install clicks**, which do not prove completed downloads. Acquisitions remain available through Statistics and downloadable reports. Low-volume UTM data may be grouped as Other. [Google's current measurement definitions](https://support.google.com/googleplay/android-developer/answer/9859173?hl=en).

## What is wired

- Every opted-in mobile store button first visits the StatsKey collector, which saves its source, campaign, mobile store, timestamp, and anonymous visit hash before redirecting to Apple (`pt` / `ct` / `mt`) or Google Play (UTMs plus encoded Install Referrer). Each activation receives a new event ID. Retries retain the same ID and do not count twice. Daily unique selections additionally deduplicate the same visit, store and campaign.
- The provider token `128070906` is the existing public token recorded from StatsKey's generated App Store Connect campaign link in the September 10 Instagram acquisition setup.
- The most recent tagged visit is kept within the same browser tab for up to 24 hours so browsing between pages using the shared store-link code retains the source. Browser storage restrictions do not stop tagging from the current URL.
- Direct visits without a saved campaign are recorded under Direct / other. Without JavaScript or browser UUID support, ordinary store links remain available. Invalid/partial campaign parameters clear cached attribution. Campaign tokens must be at most 30 letters, numbers, underscores, hyphens or periods; tokens are not silently truncated.
- The existing daily email now includes mobile choices by source and mobile store for yesterday, 7 days and 30 days, plus a separate table of the latest available store-reported acquisitions. It retains the current recipients, 07:30 America/Chicago schedule, and delivery deduplication. It does not assign individual social signups or change ads.
- Previously shared homepage campaign links automatically open the new mobile page. The site uses JavaScript to attach campaign parameters and the recording redirect. Actual eligible acquisitions are needed before either store can show these new campaigns; destination checks cannot prove a completed download or store reporting.
- If entering parameters in an ad platform's final URL suffix field, put `utm_source=...&utm_medium=...&utm_campaign=...` there without `?`, and use `https://statskey.ai/download` as the final URL. Keep Google's auto-tagging enabled if it is already enabled.

Machine-readable versions: `mobile-acquisition-links.json`.


## Saved records and email

- `mobileDownloadEvents/{eventId}`: individual website store-button selections; includes advertising source, campaign, iOS/Android destination and server time. No raw IP address, full referrer, email or raw visit ID is stored in these event records.
- `mobileDownloadDaily/{ChicagoDate}`: source/store click and daily unique-selection totals; nested `campaigns` documents retain per-campaign totals.
- `mobileStoreDownloadReports/{reportDate}`: Apple and Google report results, publication dates, source status and missing-data notes.
- `usageReports/{reportDate}.mobileDownloads` and `.mobileStoreDownloads`: the exact sections used by the existing daily email.
- `mobileDownloadTest*` collections hold QA evidence separately and are excluded from the daily email.

Website clicks and store-reported acquisitions are separate metrics. Apple publishes privacy-adjusted first-time downloads; Google reports store-listing acquisitions, with publication delay. Missing campaigns are unknown, not zero. The first tracking day is partial; historical website clicks cannot be reconstructed.

Google Play automated confirmed-download reports require the daily report account's global “View app information and download bulk reports (read-only)” permission. If access is unavailable, the daily email still includes website iOS/Android choices and clearly marks Google’s confirmed-download report unavailable.
